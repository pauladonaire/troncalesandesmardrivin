// ============================================================
// ARCHIVO GAS: Aker.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Aker" y pegar este contenido.
//
// Integración con Aker Control (POST /ws/itinerario/import).
//
// Envío AUTOMÁTICO: desde la fila AKER_FILA_INICIAL (8788) en adelante,
// todo viaje nuevo que se registra en ViajesTotalesTroncales (vía
// subirExcelADrive o crearPlanillaViajes) se manda solo a Aker, real, en
// segundo plano por un trigger (ver programarEnvioAkerEnSegundoPlano_ /
// procesarColaAker_ más abajo). Las filas viejas (<= 8788) nunca se tocan
// solas. Lo que no se pueda enviar (falta un dato, Aker lo rechaza, etc.)
// queda igual registrado en LogsAker con el error, para revisar a mano.
//
// Filas agrupadas ("Viajes con Paradas"): cuando varias filas comparten el
// mismo "Código de ruta" (una fila por parada, mismo vehículo), se arman y
// mandan como UN solo itinerario con todas esas paradas — no una llamada a
// Aker por fila. No se consulta RUTAS_DETALLE en ese caso: las paradas ya
// vienen explícitas. Ver construirPayloadItinerarioAgrupado_.
//
// Código de dirección en paradas de Ruta Maestra: las paradas intermedias
// (sheet RUTAS_DETALLE) no tienen código propio, solo nombre_parada. Se
// manda como codigo_externo el Código de dirección real de
// DireccionesTroncales (buscado por nombre, ver buscarCodigoDireccionPorNombre_)
// en vez de un código sintético "{despacho}-P{n}" — Aker reportó que ese
// código sintético creaba una referencia nueva por cada itinerario en lugar
// de reusar siempre la misma para el mismo punto físico.
//
// Datos extra que suma la API v1.1 de Aker (ver buscarConductorPorEmail_ /
// armarDatosChoferAker_ / eventosAker_):
//   - choferes[] + vehiculos[].chofer_documento: se busca el DNI/CUIL del
//     conductor en TripulantesTroncales por email (columna "dni", sincronizada
//     desde Driv.in en syncTripulantes/Drivin.gs). Si no hay email o no se
//     encuentra el documento, el viaje se manda igual, sin choferes.
//   - choferes[].transporte_codigo_externo: código (CUIT) del Empleador del
//     viaje (Texto 13), buscado en SociosDeNegocioTroncales (columna "code",
//     type="employer"). Si no hay match único, se manda el chofer igual sin
//     ese campo — ver buscarCodigoSocioPorNombre_.
//   - eventos: entrada_salida + panico + motivo_detencion, siempre en true.
//   - NO se manda bill/nro_contenedor/es_custodio (no aplica a la operación)
//     ni fecha_egreso por parada (no hay tiempo de servicio real cargado).
//
// Errores y reintentos (pantalla "Errores Aker", solo admin): cada intento
// fallido se clasifica en LogsAker (columna "Categoría Error") como
// SERVICIO_NO_ENCONTRADO, ERROR_SERVIDOR u OTRO — ver clasificarErrorAker_.
// listarErroresAker() lista los itinerarios cuyo ÚLTIMO intento quedó en
// error; reintentarEnvioAker() los reintenta re-armando el payload desde
// ViajesTotalesTroncales. Si es SERVICIO_NO_ENCONTRADO, exige que el
// frontend mande confirmoServicioCreado=true (el usuario confirmó que ya
// dio de alta la patente en Aker) — si no, ni siquiera lo intenta.
//
// probarEnvioAkerFila() sigue disponible para pruebas puntuales manuales,
// fila por fila, con o sin simulación — se corre a mano desde este editor.
//
// Requiere 2 propiedades del script (Configuración del proyecto >
// Propiedades del script), igual que SERVICE_ACCOUNT_JSON:
//   - AKER_DOMINIO  → ej: "midominio.akercontrol.com" (SIN https:// ni /ws/...)
//   - AKER_TOKEN    → el Bearer token que provee Aker
// ============================================================

var AKER_LOG_SHEET_ID = '1ke5jO5ODxMrKyR7EsVAJOiSvv7Vclf_2JCAyVyBK8Dw';
var AKER_LOG_TAB       = 'LogsAker';

// ── Envío automático (a partir de la fila 8788) ──────────────────────────
// Desde acá en adelante, cada viaje nuevo que se registra en
// ViajesTotalesTroncales se intenta enviar a Aker DE VERDAD (sin
// simulación), en segundo plano vía un trigger — no adentro de
// subirExcelADrive/crearPlanillaViajes, para no atrasar esa respuesta.
// Las filas <= AKER_FILA_INICIAL (históricas) nunca se tocan solas.
var AKER_FILA_INICIAL    = 8788;
var AKER_CURSOR_PROP     = 'AKER_ULTIMA_FILA_ENVIADA';
var AKER_MAX_POR_CORRIDA = 25; // por ejecución de trigger, para no pasarse del límite de tiempo de GAS

/**
 * Se llama después de registrar viajes nuevos en el Sheet. Programa (si no
 * hay ya uno programado) un trigger de una sola vez que envía a Aker todo
 * lo pendiente desde AKER_ULTIMA_FILA_ENVIADA en adelante.
 */
function programarEnvioAkerEnSegundoPlano_() {
  var yaProgramado = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'procesarColaAker_';
  });
  if (yaProgramado) return;
  ScriptApp.newTrigger('procesarColaAker_').timeBased().after(15000).create();
}

function limpiarTriggersAker_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'procesarColaAker_') ScriptApp.deleteTrigger(t);
  });
}

/**
 * Procesa la cola de envío automático a Aker: manda cada fila pendiente de
 * ViajesTotalesTroncales (desde el cursor guardado en Propiedades del
 * script, arrancando en AKER_FILA_INICIAL) de a lotes de
 * AKER_MAX_POR_CORRIDA, real (no simulado). Si un itinerario no se puede
 * armar o Aker lo rechaza, el intento queda igual registrado en LogsAker
 * con el error — no se reintenta solo, pero tampoco frena a los demás.
 * Si sobra trabajo, se reprograma a sí mismo para seguir en unos segundos.
 */
function procesarColaAker_() {
  limpiarTriggersAker_();

  var props  = PropertiesService.getScriptProperties();
  var cursor = Number(props.getProperty(AKER_CURSOR_PROP)) || AKER_FILA_INICIAL;

  var cfg, values;
  try {
    cfg    = CONFIG.SHEETS.VIAJES;
    values = sheetsRead_(cfg.id, cfg.tab + '!A:DA');
  } catch(eRead) {
    console.error('procesarColaAker_: error leyendo ViajesTotalesTroncales: ' + eRead.message);
    // Sin borrar el cursor — se reintenta en la próxima carga (o corrida manual).
    return;
  }
  if (!values || values.length < 2) return;

  var headers    = values[0];
  var ultimaFila = values.length; // values[0] = fila 1 (encabezados)
  if (cursor >= ultimaFila) return; // nada nuevo que mandar

  var desde = cursor + 1;
  var hasta = Math.min(ultimaFila, desde + AKER_MAX_POR_CORRIDA - 1);

  var iCodigoRuta = headers.indexOf('Código de ruta');

  // No cortar un grupo de "Viajes con Paradas" a la mitad entre corridas:
  // si la última fila del lote comparte Código de ruta con la fila
  // siguiente (todavía sin procesar), se extiende el lote para completarlo.
  while (hasta < ultimaFila && iCodigoRuta !== -1) {
    var rutaActual    = values[hasta - 1][iCodigoRuta];
    var rutaSiguiente = values[hasta][iCodigoRuta]; // values[hasta] = fila (hasta+1)
    if (rutaActual && rutaActual === rutaSiguiente) { hasta++; } else { break; }
  }

  // Agrupa las filas del lote por "Código de ruta". En el flujo normal cada
  // despacho es su propio grupo de 1 (Código de ruta = Código de despacho).
  // En "Viajes con Paradas", varias filas — una por parada — comparten el
  // mismo Código de ruta y se mandan a Aker como UN solo itinerario.
  var grupos      = {};
  var ordenGrupos = [];
  for (var fila = desde; fila <= hasta; fila++) {
    var row = values[fila - 1];
    var codigoRuta = (iCodigoRuta !== -1 ? row[iCodigoRuta] : '') || row[3]; // col [3] = Código de despacho
    if (!grupos[codigoRuta]) { grupos[codigoRuta] = []; ordenGrupos.push(codigoRuta); }
    grupos[codigoRuta].push({ fila: fila, row: row });
  }

  ordenGrupos.forEach(function(codigoRuta) {
    var items = grupos[codigoRuta];
    if (items.length > 1) {
      var filasStr = items.map(function(it) { return it.fila; }).join(',');
      try {
        var payload = construirPayloadItinerarioAgrupado_(headers, items);
        enviarPayloadAker_(payload, filasStr);
      } catch(eBuild) {
        logIntentoAker_({ ok: false, filaSheet: filasStr, error: 'Error armando itinerario agrupado: ' + eBuild.message });
      }
    } else {
      var it = items[0];
      try {
        var payload = construirPayloadItinerarioAker_(headers, it.row, {});
        enviarPayloadAker_(payload, it.fila);
      } catch(eBuild) {
        logIntentoAker_({ ok: false, filaSheet: it.fila, error: 'Error armando payload: ' + eBuild.message });
      }
    }
  });

  props.setProperty(AKER_CURSOR_PROP, String(hasta));

  if (hasta < ultimaFila) {
    ScriptApp.newTrigger('procesarColaAker_').timeBased().after(5000).create();
  }
}

/**
 * Diagnóstico manual: cuántas filas quedan pendientes de mandar a Aker
 * ahora mismo, sin procesarlas. Correr desde el editor si hace falta
 * revisar el estado de la cola.
 */
function verEstadoColaAker() {
  var props  = PropertiesService.getScriptProperties();
  var cursor = Number(props.getProperty(AKER_CURSOR_PROP)) || AKER_FILA_INICIAL;
  var cfg    = CONFIG.SHEETS.VIAJES;
  var values = sheetsRead_(cfg.id, cfg.tab + '!A:A'); // solo col A, alcanza para contar filas
  var ultimaFila = values.length;
  var pendientes = Math.max(0, ultimaFila - cursor);
  var msg = 'Cursor actual: fila ' + cursor + ' | Última fila con datos: ' + ultimaFila + ' | Pendientes: ' + pendientes;
  console.log(msg);
  return msg;
}

/**
 * Diagnóstico manual: muestra en el log qué valor lee el código para los
 * campos clave de una fila puntual de ViajesTotalesTroncales — tanto por
 * nombre de columna (header) como por posición fija. Útil si
 * construirPayloadItinerarioAker_ dice que falta un dato y no se entiende
 * por qué (típicamente: el header de la fila 1 no coincide exacto con el
 * texto esperado, o la fila es de antes de que existiera esa columna).
 */
function TEST_inspeccionarFilaViajes() {
  var FILA = 8789; // ← cambiar por la fila a inspeccionar

  var cfg    = CONFIG.SHEETS.VIAJES;
  var values = sheetsRead_(cfg.id, cfg.tab + '!A:DA');
  var headers = values[0];
  var row     = values[FILA - 1];

  console.log('headers.length=' + headers.length + ' | row.length=' + (row ? row.length : 'undefined (fila fuera de rango, hay ' + (values.length - 1) + ' filas de datos)'));
  if (!row) return;

  ['Código de despacho', 'Fecha Maxima de Entrega', 'Fecha Inicio Viaje', 'Ruta Maestra', 'Código de dirección']
    .forEach(function(c) {
      var i = headers.indexOf(c);
      console.log(c + ' → índice header: ' + i + ' | valor: ' + JSON.stringify(i === -1 ? undefined : row[i]));
    });
  console.log('row[103] (posición fija, columna CZ): ' + JSON.stringify(row[103]));
}

/**
 * ── PUNTO DE ENTRADA MANUAL ──
 * Editá los valores de acá abajo y ejecutá esta función desde el editor
 * (▶ Ejecutar, con "probarEnvioAkerFila" seleccionada en el desplegable).
 *
 * FILA: número de fila tal como se ve en el Sheet ViajesTotalesTroncales
 *       (la fila 1 son los encabezados, así que el primer viaje es la fila 2).
 * MODO_SIMULACION: true → arma el payload y lo deja registrado en LogsAker,
 *       pero NO llama a Aker. false → llama a Aker de verdad.
 * FECHA_INICIO_MANUAL: dejalo vacío ('') para filas nuevas, que ya van a
 *       tener la fecha de inicio guardada en la columna CZ ("Fecha Inicio
 *       Viaje"). Para probar filas viejas que no tienen esa columna cargada,
 *       poné acá la fecha ('YYYY-MM-DD' o 'YYYY-MM-DD HH:MM:SS').
 */
function probarEnvioAkerFila() {
  var FILA                 = 20;              // ← cambiar por la fila a probar
  var MODO_SIMULACION      = true;             // ← false para enviar de verdad
  var HORA_INICIO          = '08:00:00';       // hora a pegarle a la fecha de inicio si viene sin hora
  var FECHA_INICIO_MANUAL  = '';               // override manual (ver comentario arriba)

  var resultado = enviarItinerarioAkerDesdeFila_(FILA, {
    simulacion:         MODO_SIMULACION,
    horaInicio:         HORA_INICIO,
    fechaInicioManual:  FECHA_INICIO_MANUAL
  });

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/**
 * Arma (y opcionalmente envía) el itinerario de Aker para una fila puntual
 * del Sheet ViajesTotalesTroncales. Registra SIEMPRE el intento en LogsAker,
 * se haya enviado de verdad o solo simulado.
 */
function enviarItinerarioAkerDesdeFila_(numeroFilaSheet, opciones) {
  opciones = opciones || {};
  var simulacion = opciones.simulacion !== false; // por defecto, simula (más seguro)

  var cfg;
  var values;
  try {
    cfg    = CONFIG.SHEETS.VIAJES;
    values = sheetsRead_(cfg.id, cfg.tab + '!A:DA');
  } catch(eRead) {
    return logIntentoAker_({ ok: false, filaSheet: numeroFilaSheet, error: 'Error leyendo ViajesTotalesTroncales: ' + eRead.message });
  }

  if (!values || values.length < 2) {
    return logIntentoAker_({ ok: false, filaSheet: numeroFilaSheet, error: 'Sheet de viajes vacío o sin encabezados' });
  }

  var headers   = values[0];
  var dataIndex = numeroFilaSheet - 2; // fila 1 = headers → primer dato es índice 0
  if (dataIndex < 0 || dataIndex >= values.length - 1) {
    return logIntentoAker_({ ok: false, filaSheet: numeroFilaSheet, error: 'Fila ' + numeroFilaSheet + ' fuera de rango (hay ' + (values.length - 1) + ' filas de datos)' });
  }
  var row = values[dataIndex + 1];

  var payload;
  try {
    payload = construirPayloadItinerarioAker_(headers, row, opciones);
  } catch(eBuild) {
    return logIntentoAker_({ ok: false, filaSheet: numeroFilaSheet, error: 'Error armando payload: ' + eBuild.message });
  }

  if (simulacion) {
    return logIntentoAker_({
      ok: true, simulado: true, filaSheet: numeroFilaSheet,
      codigoExterno: payload.codigo_externo, payload: payload
    });
  }

  return enviarPayloadAker_(payload, numeroFilaSheet);
}

/**
 * Construye el JSON del itinerario a partir de una fila de ViajesTotalesTroncales.
 *
 * Mapeo acordado:
 *  - codigo_externo   = Código de despacho
 *  - fecha_inicio     = columna "Fecha Inicio Viaje" (CZ) + hora, o el override manual
 *  - fecha_fin        = Fecha Máxima de Entrega (fin del día)
 *  - nota             = Texto 8 (código de despacho-empleador-proveedor)
 *  - vehiculos        = 1 objeto: { patente: Asignación vehículo, acoplado: Texto 7 (arrastre) }
 *  - paradas          = si el viaje tiene Ruta Maestra asignada, se arma el
 *                       itinerario COMPLETO: todas las paradas intermedias de
 *                       esa ruta (sheet RUTAS_DETALLE, ordenadas por
 *                       posicion_parada) + el destino real al final. TODAS
 *                       van con su Código de dirección real como
 *                       codigo_externo (buscado por nombre para las
 *                       intermedias vía buscarCodigoDireccionPorNombre_) —
 *                       nunca un código sintético por itinerario. Si no
 *                       tiene Ruta Maestra, solo se manda el destino
 *                       (comportamiento anterior).
 *  - armar_ruta       = true
 */
function construirPayloadItinerarioAker_(headers, row, opciones) {
  opciones = opciones || {};

  function val(nombreCol) {
    var i = headers.indexOf(nombreCol);
    return (i === -1 || row[i] == null) ? '' : String(row[i]);
  }

  var codigoDespacho  = val('Código de despacho');
  var fechaMaxEntrega = val('Fecha Maxima de Entrega');
  var codigoDireccion = val('Código de dirección');
  var vehiculo        = val('Asignación vehículo');
  var arrastre         = val('Texto 7');
  var nota             = val('Texto 8');
  var rutaMaestra      = val('Ruta Maestra');
  var conductorEmail   = val('Correo Conductor');
  var conductorNombre  = val('Texto 14');
  var empleadorNombre  = val('Texto 13');
  var fechaInicioCol   = val('Fecha Inicio Viaje'); // columna CZ — ver Excel.gs registrarViajesEnSheet_
  if (!fechaInicioCol && row.length > 103) {
    // Respaldo por posición fija: "Fecha Inicio Viaje" es SIEMPRE la 4ta
    // columna de metadatos que agrega registrarViajesEnSheet_ (después de
    // las 100 columnas del Excel) → índice 103 (columna CZ), sin importar
    // si el texto del header en la fila 1 tiene alguna diferencia.
    fechaInicioCol = row[103] != null ? String(row[103]) : '';
  }

  if (!codigoDespacho)  throw new Error('La fila no tiene Código de despacho');
  if (!fechaMaxEntrega) throw new Error('La fila no tiene Fecha Máxima de Entrega — no se puede armar fecha_fin');

  var fechaInicioBase = opciones.fechaInicioManual || fechaInicioCol;
  if (!fechaInicioBase) {
    throw new Error('No hay fecha de inicio para esta fila (columna "Fecha Inicio Viaje" vacía). ' +
      'Si es una fila cargada antes de sumar esa columna, pasá FECHA_INICIO_MANUAL al probarla.');
  }

  var horaInicio = opciones.horaInicio || '08:00:00';
  var fechaInicio = completarFechaHora_(fechaInicioBase, horaInicio);
  var fechaFin    = completarFechaHora_(fechaMaxEntrega, '23:59:59');

  var datosChofer = armarDatosChoferAker_(conductorEmail, conductorNombre, empleadorNombre);

  var vehiculos = [];
  if (vehiculo) {
    var vehObj = { patente: vehiculo };
    if (arrastre) vehObj.acoplado = arrastre;
    if (datosChofer) vehObj.chofer_documento = datosChofer.chofer_documento;
    vehiculos.push(vehObj);
  }

  // Si el viaje tiene Ruta Maestra, se arma el itinerario completo: las
  // paradas intermedias de esa ruta (sheet RUTAS_DETALLE, que no tiene
  // código propio por parada, solo nombre_parada) + el destino real al
  // final. TODAS las paradas mandan como codigo_externo el Código de
  // dirección real de DireccionesTroncales (buscado por nombre para las
  // intermedias) — NUNCA un código sintético derivado del itinerario, porque
  // eso crea una referencia nueva en Aker por cada envío en vez de reusar
  // el mismo punto (bug reportado por Aker: "Servicio no encontrado"/
  // referencias duplicadas). Solo si una parada intermedia no tiene match
  // único en DireccionesTroncales se cae al código sintético como último
  // recurso, para no bloquear el envío del itinerario.
  var paradasRuta = rutaMaestra ? buscarParadasRutaMaestra_(rutaMaestra) : [];

  var paradas = [];
  var orden   = 0;

  paradasRuta.forEach(function(p) {
    orden++;
    var codigoDireccionParada = buscarCodigoDireccionPorNombre_(p.nombre);
    var parada = {
      orden:          orden - 1,
      codigo_externo: codigoDireccionParada || (codigoDespacho + '-P' + orden),
      fecha_ingreso:  combinarFechaConHora_(fechaInicio, p.horaInicio),
      stop_type:      'drop',
      nombre:         p.nombre,
      latitud:        p.lat,
      longitud:       p.lng
    };
    if (codigoDireccionParada) {
      // Hay match único en DireccionesTroncales: usamos nombre/lat/lng de la
      // dirección (la referencia ya existente en Aker), no los de RUTAS_DETALLE,
      // para evitar coordenadas/nombres levemente distintos para el mismo punto.
      var direccionParada = buscarDireccionPorCodigo_(codigoDireccionParada);
      if (direccionParada) {
        parada.nombre   = direccionParada.name || p.nombre;
        parada.latitud  = direccionParada.lat  || p.lat;
        parada.longitud = direccionParada.lng  || p.lng;
      }
    }
    paradas.push(parada);
  });

  if (codigoDireccion) {
    orden++;
    var parada = {
      orden: orden - 1,
      codigo_externo: codigoDireccion,
      fecha_ingreso: fechaFin,
      stop_type: 'drop'
    };
    var direccion = buscarDireccionPorCodigo_(codigoDireccion);
    if (direccion) {
      // Se mandan igual aunque la referencia ya exista en Aker — no molestan,
      // y son obligatorios si Aker tuviera que crearla de cero. Si en
      // DireccionesTroncales el nombre quedó vacío, usamos el código como
      // respaldo — Aker exige "nombre" para crear la referencia la primera vez.
      parada.nombre   = direccion.name || codigoDireccion;
      parada.latitud  = direccion.lat;
      parada.longitud = direccion.lng;
    }
    paradas.push(parada);
  }

  var payload = {
    codigo_externo: codigoDespacho,
    fecha_inicio:   fechaInicio,
    fecha_fin:      fechaFin,
    nota:           nota,
    armar_ruta:     true,
    vehiculos:      vehiculos,
    paradas:        paradas,
    eventos:        eventosAker_()
  };
  if (datosChofer) payload.choferes = [datosChofer.chofer];
  return payload;
}

/**
 * Arma el itinerario de Aker para un GRUPO de filas de ViajesTotalesTroncales
 * que comparten "Código de ruta" — el caso de "Viajes con Paradas", donde
 * cada fila es UNA parada del mismo vehículo/recorrido. A diferencia de
 * construirPayloadItinerarioAker_, acá NO se consulta RUTAS_DETALLE — las
 * paradas ya vienen explícitas, una por fila, cada una con su propio
 * Código de dirección.
 *
 * @param {Array}  headers
 * @param {Array<{fila:number, row:Array}>} items  filas del grupo, en
 *        cualquier orden — se ordenan acá por la columna "Posicion".
 */
function construirPayloadItinerarioAgrupado_(headers, items) {
  function val(row, nombreCol) {
    var i = headers.indexOf(nombreCol);
    return (i === -1 || row[i] == null) ? '' : String(row[i]);
  }

  var iPosicion = headers.indexOf('Posicion');
  items = items.slice().sort(function(a, b) {
    var pa = iPosicion !== -1 ? (Number(a.row[iPosicion]) || 0) : 0;
    var pb = iPosicion !== -1 ? (Number(b.row[iPosicion]) || 0) : 0;
    return pa - pb;
  });

  var primero = items[0].row;
  var codigoRuta      = val(primero, 'Código de ruta') || val(primero, 'Código de despacho');
  var fechaMaxEntrega = val(primero, 'Fecha Maxima de Entrega');
  var vehiculo        = val(primero, 'Asignación vehículo');
  var arrastre         = val(primero, 'Texto 7');
  var nota             = val(primero, 'Texto 8');
  var conductorEmail   = val(primero, 'Correo Conductor');
  var conductorNombre  = val(primero, 'Texto 14');
  var empleadorNombre  = val(primero, 'Texto 13');
  var fechaInicioCol   = val(primero, 'Fecha Inicio Viaje');
  if (!fechaInicioCol && primero.length > 103) {
    fechaInicioCol = primero[103] != null ? String(primero[103]) : ''; // respaldo posicional, ver construirPayloadItinerarioAker_
  }

  if (!codigoRuta)      throw new Error('El grupo no tiene Código de ruta/despacho');
  if (!fechaMaxEntrega) throw new Error('El grupo no tiene Fecha Máxima de Entrega — no se puede armar fecha_fin');
  if (!fechaInicioCol)  throw new Error('El grupo no tiene fecha de inicio (columna "Fecha Inicio Viaje" vacía)');

  var fechaInicio = completarFechaHora_(fechaInicioCol, '08:00:00');
  var fechaFin    = completarFechaHora_(fechaMaxEntrega, '23:59:59');

  var datosChofer = armarDatosChoferAker_(conductorEmail, conductorNombre, empleadorNombre);

  var vehiculos = [];
  if (vehiculo) {
    var vehObj = { patente: vehiculo };
    if (arrastre) vehObj.acoplado = arrastre;
    if (datosChofer) vehObj.chofer_documento = datosChofer.chofer_documento;
    vehiculos.push(vehObj);
  }

  var paradas = items.map(function(item, i) {
    var row = item.row;
    var codigoDireccion = val(row, 'Código de dirección');
    var parada = {
      orden:          i,
      codigo_externo: codigoDireccion,
      // Última parada = destino real → usa el vencimiento del viaje. Las
      // intermedias no tienen un horario propio en este módulo (a
      // diferencia de una Ruta Maestra con hora_inicio por parada), así
      // que van con la misma fecha/hora de inicio del viaje.
      fecha_ingreso:  (i === items.length - 1) ? fechaFin : fechaInicio,
      stop_type:      'drop'
    };
    var direccion = buscarDireccionPorCodigo_(codigoDireccion);
    if (direccion) {
      parada.nombre   = direccion.name || codigoDireccion;
      parada.latitud  = direccion.lat;
      parada.longitud = direccion.lng;
    }
    return parada;
  });

  var payload = {
    codigo_externo: codigoRuta,
    fecha_inicio:   fechaInicio,
    fecha_fin:      fechaFin,
    nota:           nota,
    armar_ruta:     true,
    vehiculos:      vehiculos,
    paradas:        paradas,
    eventos:        eventosAker_()
  };
  if (datosChofer) payload.choferes = [datosChofer.chofer];
  return payload;
}

/** Completa una fecha 'YYYY-MM-DD' con una hora si no la tiene ya. */
function completarFechaHora_(fecha, horaDefault) {
  fecha = String(fecha || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha + ' ' + horaDefault;
  return fecha; // ya viene con hora, o es un formato inesperado — se manda tal cual
}

/**
 * Busca un conductor en TripulantesTroncales por email y devuelve su
 * documento (DNI/CUIL) y teléfono para mandarlos a Aker en choferes[].
 * La columna "dni" viene de la API de Driv.in (campo "dni" — antes se leía
 * mal como "document_number" y por eso quedaba siempre vacía, ver
 * syncTripulantes en Drivin.gs). Si no hay email, o no se encuentra, o no
 * tiene documento cargado, devuelve null y el llamador simplemente no manda
 * choferes para ese viaje (no rompe nada de lo que ya funciona).
 */
function buscarConductorPorEmail_(email) {
  if (!email) return null;
  var cfg  = CONFIG.SHEETS.TRIPULANTES;
  var rows = sheetsRead_(cfg.id, cfg.tab);
  if (rows.length < 2) return null;

  var norm = String(email).trim().toLowerCase();
  // Columnas de TripulantesTroncales (ver syncTripulantes en Drivin.gs):
  // [0] id, [1] email, [2] first_name, [3] last_name, [4] nombre_completo,
  // [5] phone, [6] dni, [7] role_name, [8] is_active, [9] tags
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1] || '').trim().toLowerCase() === norm) {
      var documento = String(rows[i][6] || '').trim();
      if (!documento) return null;
      return { documento: documento, telefono: String(rows[i][5] || '').trim() };
    }
  }
  return null;
}

/**
 * Busca en SociosDeNegocioTroncales el "code" (CUIT/código externo) de un
 * socio por nombre — se usa para mandar transporte_codigo_externo en
 * choferes[] a partir del nombre de Empleador guardado en el viaje (Texto 13).
 * Filtra por type = "employer" para no cruzar por error con un socio de otro
 * tipo que tenga el mismo nombre. Si no hay match único, devuelve ''.
 */
function buscarCodigoSocioPorNombre_(nombre) {
  if (!nombre) return '';
  var cfg  = CONFIG.SHEETS.SOCIOS;
  var rows = sheetsRead_(cfg.id, cfg.tab);
  if (rows.length < 2) return '';

  var norm = String(nombre).trim().toUpperCase();
  // Columnas de SociosDeNegocioTroncales (ver syncSocios en Drivin.gs):
  // [0] id, [1] code, [2] name, [3] type, [4] address, [5] city, [6] country, [7] phone, [8] email, [9] tags
  var encontrados = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim().toUpperCase() === norm && String(rows[i][3] || '').trim().toLowerCase() === 'employer') {
      encontrados.push(rows[i]);
    }
  }
  if (encontrados.length !== 1) return ''; // sin match, o ambiguo (más de uno) — mejor no mandar nada
  return String(encontrados[0][1] || '').trim();
}

/**
 * Arma, si es posible, el bloque {choferes, chofer_documento} para sumar al
 * payload de Aker a partir del email/nombre del conductor y el empleador del
 * viaje. Si no hay email o no se encuentra el documento del conductor,
 * devuelve null (sin choferes) — transporte_codigo_externo es siempre
 * opcional: si no se encuentra el socio, el chofer se manda igual sin él.
 */
function armarDatosChoferAker_(conductorEmail, conductorNombre, empleadorNombre) {
  var datos = buscarConductorPorEmail_(conductorEmail);
  if (!datos) return null;
  var chofer = {
    chofer_documento: datos.documento,
    nombre: conductorNombre || '',
    telefono: datos.telefono || ''
  };
  var transporteCodigo = buscarCodigoSocioPorNombre_(empleadorNombre);
  if (transporteCodigo) chofer.transporte_codigo_externo = transporteCodigo;
  return {
    chofer_documento: datos.documento,
    chofer: chofer
  };
}

/** Eventos de monitoreo habilitados para los itinerarios que mandamos a Aker. */
function eventosAker_() {
  return { entrada_salida: true, panico: true, motivo_detencion: true };
}

/**
 * Diagnóstico manual: para un email de conductor puntual, muestra qué
 * encuentra (o no) buscarConductorPorEmail_ en TripulantesTroncales. Correr
 * desde el editor (▶ Ejecutar, con "TEST_verificarChoferAker" seleccionada)
 * después de cambiar el EMAIL de acá abajo por el "Correo Conductor" real
 * de la fila que no mandó choferes a Aker.
 *
 * Causas típicas si da null:
 *  - Todavía no corriste syncTripulantes() después del fix de Drivin.gs
 *    (la columna DNI sigue vacía de antes).
 *  - Ese email no tiene fila en TripulantesTroncales.
 *  - Tiene fila pero la columna DNI está vacía en Driv.in para ese usuario.
 */
function TEST_verificarChoferAker() {
  var EMAIL     = 'conductor@ejemplo.com'; // ← cambiar por el email real a probar
  var EMPLEADOR = '';                      // ← opcional: nombre de Empleador (Texto 13) para probar transporte_codigo_externo

  var cfg  = CONFIG.SHEETS.TRIPULANTES;
  var rows = sheetsRead_(cfg.id, cfg.tab);
  console.log('TripulantesTroncales: ' + (rows.length - 1) + ' filas de datos.');

  var norm = EMAIL.trim().toLowerCase();
  var encontrado = null;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1] || '').trim().toLowerCase() === norm) { encontrado = rows[i]; break; }
  }
  if (!encontrado) {
    console.log('No hay ninguna fila en TripulantesTroncales con email = "' + EMAIL + '". Revisá que el email cargado en el viaje coincida EXACTO con el de la planilla.');
  } else {
    console.log('Fila encontrada: email=' + encontrado[1] + ' | nombre=' + encontrado[4] + ' | phone=' + encontrado[5] + ' | dni="' + encontrado[6] + '"');
    if (!encontrado[6]) {
      console.log('→ La columna DNI está vacía para este conductor. Si syncTripulantes() ya corrió después del fix de Drivin.gs y sigue vacía, es que Driv.in no tiene cargado el DNI para este usuario puntual.');
    }
  }

  if (EMPLEADOR) {
    var codigoSocio = buscarCodigoSocioPorNombre_(EMPLEADOR);
    console.log('buscarCodigoSocioPorNombre_("' + EMPLEADOR + '") devuelve: "' + codigoSocio + '"' +
      (codigoSocio ? '' : ' (vacío = no hay match único type=employer en SociosDeNegocioTroncales con ese nombre exacto)'));
  }

  var resultado = armarDatosChoferAker_(EMAIL, encontrado ? encontrado[4] : '', EMPLEADOR);
  console.log('armarDatosChoferAker_ devuelve: ' + JSON.stringify(resultado));
  return resultado;
}

/**
 * Diagnóstico manual: para una Ruta Maestra puntual, muestra qué código de
 * dirección le encuentra (o no) buscarCodigoDireccionPorNombre_ a cada
 * parada intermedia (sheet RUTAS_DETALLE) — así se puede revisar, antes de
 * que se mande un itinerario real, si el nombre_parada de RUTAS_DETALLE
 * coincide EXACTO (ignorando mayúsculas/espacios) con el "name" de algún
 * registro de DireccionesTroncales. Si da vacío, va a caer al código
 * sintético de siempre — hay que corregir el nombre_parada en RUTAS_DETALLE
 * o el name en DireccionesTroncales para que coincidan.
 * Correr desde el editor (▶ Ejecutar, con "TEST_verificarParadasRutaMaestra"
 * seleccionada) después de cambiar RUTA_MAESTRA acá abajo por el valor real
 * de la columna "Ruta Maestra" del viaje.
 */
function TEST_verificarParadasRutaMaestra_() {
  var RUTA_MAESTRA = '#104-Avellaneda/San Luis/San Martin/Mendoza'; // ← cambiar por la ruta real a probar

  var paradasRuta = buscarParadasRutaMaestra_(RUTA_MAESTRA);
  console.log('buscarParadasRutaMaestra_("' + RUTA_MAESTRA + '") devuelve ' + paradasRuta.length + ' parada(s).');

  paradasRuta.forEach(function(p, i) {
    var codigo = buscarCodigoDireccionPorNombre_(p.nombre);
    console.log((i + 1) + '. nombre_parada="' + p.nombre + '" → código de dirección: ' +
      (codigo ? ('"' + codigo + '"') : '(SIN MATCH — va a usar código sintético)'));
  });
}

/** Busca una dirección en DireccionesTroncales por su código. */
function buscarDireccionPorCodigo_(codigo) {
  if (!codigo) return null;
  var cfg  = CONFIG.SHEETS.DIRECCIONES;
  var rows = sheetsRead_(cfg.id, cfg.tab);
  if (rows.length < 2) return null;

  var headers = rows[0];
  var iCode = headers.indexOf('code');
  var iName = headers.indexOf('name');
  var iLat  = headers.indexOf('lat');
  var iLng  = headers.indexOf('lng');
  if (iCode === -1) return null;

  var norm = String(codigo).trim().toUpperCase();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][iCode] || '').trim().toUpperCase() === norm) {
      return {
        name: rows[i][iName] || '',
        lat:  Number(rows[i][iLat]) || null,
        lng:  Number(rows[i][iLng]) || null
      };
    }
  }
  return null;
}

/**
 * Busca en DireccionesTroncales el "code" de una dirección por su nombre
 * exacto — se usa para que las paradas intermedias de una Ruta Maestra
 * (sheet RUTAS_DETALLE, que no tiene código propio por parada, solo
 * nombre_parada) manden el MISMO código de dirección que ya usa Aker para
 * ese punto, en vez de un código sintético por itinerario. Si no hay match
 * único, devuelve '' (mejor no mandar nada a adivinar).
 */
function buscarCodigoDireccionPorNombre_(nombre) {
  if (!nombre) return '';
  var cfg  = CONFIG.SHEETS.DIRECCIONES;
  var rows = sheetsRead_(cfg.id, cfg.tab);
  if (rows.length < 2) return '';

  var headers = rows[0];
  var iCode = headers.indexOf('code');
  var iName = headers.indexOf('name');
  if (iCode === -1 || iName === -1) return '';

  var norm = String(nombre).trim().toUpperCase();
  var encontrados = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][iName] || '').trim().toUpperCase() === norm) {
      encontrados.push(rows[i]);
    }
  }
  if (encontrados.length !== 1) return ''; // sin match, o ambiguo — mejor no mandar nada
  return String(encontrados[0][iCode] || '').trim();
}

/**
 * Busca en el sheet RUTAS_DETALLE todas las paradas de una ruta maestra,
 * ordenadas por posicion_parada. codigoRutaMaestra debe ser exactamente el
 * mismo valor guardado en la columna "Ruta Maestra" del viaje (columna
 * codigo_ruta_maestra del detalle — es el mismo texto que la columna RUTA
 * de RutasMaestras, ej: "#104-Avellaneda/San Luis/San Martin/Mendoza").
 * NOTA: no filtra por "esquema" — los códigos de ruta ya son únicos por sí
 * solos (Argentina y Chile no comparten nombres de ruta).
 */
function buscarParadasRutaMaestra_(codigoRutaMaestra) {
  if (!codigoRutaMaestra) return [];

  var cfg  = CONFIG.SHEETS.RUTAS_DETALLE;
  var hoja = sheetsPrimeraHoja_(cfg.id);
  var rows = sheetsRead_(cfg.id, hoja);
  if (rows.length < 2) return [];

  var headers   = rows[0];
  var iCodigo   = headers.indexOf('codigo_ruta_maestra');
  var iPosicion = headers.indexOf('posicion_parada');
  var iNombre   = headers.indexOf('nombre_parada');
  var iLat      = headers.indexOf('lat');
  var iLng      = headers.indexOf('lng');
  var iHora     = headers.indexOf('hora_inicio');
  if (iCodigo === -1) return [];

  var norm     = String(codigoRutaMaestra).trim();
  var paradas  = [];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][iCodigo] || '').trim() === norm) {
      paradas.push({
        posicion:   Number(rows[i][iPosicion]) || (paradas.length + 1),
        nombre:     rows[i][iNombre] || '',
        lat:        parsearCoordenadaAker_(rows[i][iLat]),
        lng:        parsearCoordenadaAker_(rows[i][iLng]),
        horaInicio: iHora !== -1 ? rows[i][iHora] : ''
      });
    }
  }
  paradas.sort(function(a, b) { return a.posicion - b.posicion; });
  return paradas;
}

/**
 * Las lat/lng del sheet RUTAS_DETALLE vienen en formato fijo ×1e9 (ej:
 * -34663963800 = -34.6639638), no como decimal directo. Se limpian comas
 * de miles por si Sheets las devuelve formateadas.
 */
function parsearCoordenadaAker_(valorCrudo) {
  var limpio = String(valorCrudo || '').replace(/,/g, '').trim();
  var num = Number(limpio);
  if (!num) return null;
  return num / 1e9;
}

/**
 * Combina la FECHA de fechaConHora ('YYYY-MM-DD HH:MM:SS') con la hora
 * propia de una parada intermedia (columna hora_inicio del detalle de ruta).
 * Si la parada no tiene hora propia (vacía o "0:00:00"), se usa la misma
 * fecha/hora de inicio del viaje tal cual.
 */
function combinarFechaConHora_(fechaConHora, horaParada) {
  var horaLimpia = String(horaParada || '').trim();
  if (!horaLimpia || horaLimpia === '0:00:00' || horaLimpia === '00:00:00') {
    return fechaConHora;
  }
  var fecha = String(fechaConHora).trim().split(' ')[0];
  var m = horaLimpia.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  var horaNormalizada = m ? (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2] + ':' + m[3] : horaLimpia;
  return fecha + ' ' + horaNormalizada;
}

/** Envía el payload a Aker y registra la respuesta. */
function enviarPayloadAker_(payload, filaSheet) {
  var props   = PropertiesService.getScriptProperties();
  var dominio = props.getProperty('AKER_DOMINIO');
  var token   = props.getProperty('AKER_TOKEN');

  if (!dominio || !token) {
    return logIntentoAker_({
      ok: false, filaSheet: filaSheet, payload: payload,
      error: 'Faltan las propiedades de script AKER_DOMINIO / AKER_TOKEN (Configuración del proyecto > Propiedades del script)'
    });
  }

  // Normaliza el dominio por si quedó guardado con "https://" y/o "/" al final.
  dominio = dominio.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  var url = 'https://' + dominio + '/ws/itinerario/import';
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch(eFetch) {
    return logIntentoAker_({ ok: false, filaSheet: filaSheet, payload: payload, error: 'Error de red: ' + eFetch.message });
  }

  var status = resp.getResponseCode();
  var body;
  try { body = JSON.parse(resp.getContentText()); } catch(eParse) { body = { raw: resp.getContentText() }; }

  return logIntentoAker_({
    ok:            status === 200 && body.success !== false,
    filaSheet:     filaSheet,
    codigoExterno: payload.codigo_externo,
    httpStatus:    status,
    payload:       payload,
    respuesta:     body
  });
}

/**
 * Clasifica un intento fallido de envío a Aker para que la pantalla de
 * "Errores Aker" sepa qué mostrar y si hace falta pedir confirmación antes
 * de reintentar:
 *  - SERVICIO_NO_ENCONTRADO: Aker devuelve "Servicio no encontrado para la
 *    patente X" (la patente no está dada de alta como servicio en Aker).
 *    Reintentar sin corregir esto va a fallar de nuevo — por eso la pantalla
 *    exige confirmar que ya se dio de alta antes de habilitar el reintento.
 *  - ERROR_SERVIDOR: error de red, timeout, o respuesta no-JSON / HTTP 5xx
 *    (ej. 502 Bad Gateway) — no es un problema de los datos, se puede
 *    reintentar directo.
 *  - OTRO: cualquier otro error de validación de Aker — se muestra el
 *    mensaje tal cual para que un humano lo revise antes de reintentar.
 */
function clasificarErrorAker_(datos) {
  if (datos.ok) return { categoria: '', patentes: '' };

  var resp   = datos.respuesta;
  var status = datos.httpStatus;

  if (datos.error && !resp) {
    return { categoria: 'ERROR_SERVIDOR', patentes: '' }; // no llegó a pegarle a Aker (red, o error armando el payload)
  }
  if ((resp && resp.raw) || (status && status >= 500)) {
    return { categoria: 'ERROR_SERVIDOR', patentes: '' }; // respuesta no-JSON (ej. 502 de nginx) o 5xx
  }
  if (resp && resp.errors && typeof resp.errors === 'object') {
    var patentes = [];
    for (var key in resp.errors) {
      var msg = String(resp.errors[key] || '');
      var m = msg.match(/Servicio no encontrado para la patente\s+(\S+)/i);
      if (m) patentes.push(m[1]);
    }
    if (patentes.length) {
      return { categoria: 'SERVICIO_NO_ENCONTRADO', patentes: patentes.join(',') };
    }
  }
  return { categoria: 'OTRO', patentes: '' };
}

/** Arma un mensaje legible de error a partir de lo registrado (para mostrar en la UI). */
function mensajeErrorAker_(datos) {
  if (datos.error) return datos.error;
  var resp = datos.respuesta;
  if (!resp) return 'Error desconocido';
  if (resp.raw) return 'Respuesta no válida del servidor de Aker (HTTP ' + (datos.httpStatus || '?') + ')';
  if (resp.message) return resp.message;
  if (resp.errors) {
    var partes = [];
    for (var key in resp.errors) partes.push(key + ': ' + resp.errors[key]);
    return partes.join(' | ');
  }
  return 'Error desconocido';
}

/** Agrega las columnas 12-13 (Categoría Error / Patentes afectadas) a LogsAker si todavía no existen. */
function asegurarColumnasExtraLogsAker_(hoja) {
  var header = hoja.getRange(1, 1, 1, 13).getValues()[0];
  if (!header[11]) hoja.getRange(1, 12).setValue('Categoría Error').setFontWeight('bold');
  if (!header[12]) hoja.getRange(1, 13).setValue('Patentes afectadas').setFontWeight('bold');
}

/** Registra el intento (simulado o real) en la hoja LogsAker. Crea la pestaña si no existe. */
function logIntentoAker_(datos) {
  try {
    var ss   = SpreadsheetApp.openById(AKER_LOG_SHEET_ID);
    var hoja = ss.getSheetByName(AKER_LOG_TAB);
    if (!hoja) {
      hoja = ss.insertSheet(AKER_LOG_TAB);
      hoja.appendRow([
        'Fecha/hora', 'Usuario', 'Fila Sheet', 'Código externo',
        'Simulado', 'OK', 'HTTP Status', 'Acción Aker', 'Error',
        'Payload enviado', 'Respuesta Aker', 'Categoría Error', 'Patentes afectadas'
      ]);
      hoja.getRange(1, 1, 1, 13).setFontWeight('bold');
    } else {
      asegurarColumnasExtraLogsAker_(hoja);
    }
    var usuario = '';
    try { usuario = Session.getActiveUser().getEmail() || ''; } catch(eUser) { /* falta el scope userinfo.email — no crítico */ }

    var clasif = clasificarErrorAker_(datos);
    // Para que la columna "Error" siempre tenga un mensaje legible: si no
    // vino un error de red/armado de payload, se arma a partir de la
    // respuesta de Aker (ej. "Servicio no encontrado para la patente X").
    var mensajeError = datos.ok ? '' : (datos.error || mensajeErrorAker_(datos));

    hoja.appendRow([
      new Date().toISOString(),
      usuario,
      datos.filaSheet != null ? datos.filaSheet : '',
      datos.codigoExterno || '',
      datos.simulado ? 'SI' : 'NO',
      datos.ok ? 'OK' : 'ERROR',
      datos.httpStatus || '',
      (datos.respuesta && datos.respuesta.accion) || '',
      mensajeError,
      datos.payload ? JSON.stringify(datos.payload) : '',
      datos.respuesta ? JSON.stringify(datos.respuesta) : '',
      clasif.categoria,
      clasif.patentes
    ]);
  } catch(eLog) {
    console.error('logIntentoAker_ error: ' + eLog.message);
  }
  return datos;
}

/**
 * Lista, para la pantalla de "Errores Aker", los itinerarios cuyo ÚLTIMO
 * intento registrado en LogsAker quedó en error (si un reintento posterior
 * ya salió OK para el mismo "Código externo", ya no aparece acá). Requiere
 * rol admin — ver reintentarEnvioAker para el reintento en sí.
 */
function listarErroresAker(token) {
  var session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  if (session.rol !== 'ADMIN_GENERAL' && session.rol !== 'ADMIN_TRAFICO') {
    throw new Error('Sin permisos para esta operación');
  }

  var ss   = SpreadsheetApp.openById(AKER_LOG_SHEET_ID);
  var hoja = ss.getSheetByName(AKER_LOG_TAB);
  if (!hoja) return { ok: true, errores: [] };

  var rows = hoja.getDataRange().getValues();
  if (rows.length < 2) return { ok: true, errores: [] };

  var vistos  = {};
  var errores = [];
  for (var i = rows.length - 1; i >= 1; i--) {
    var row = rows[i];
    var codigoExterno = row[3];
    if (!codigoExterno || vistos[codigoExterno]) continue;
    vistos[codigoExterno] = true;
    if (row[5] === 'OK') continue; // el intento más reciente de este código ya salió bien

    errores.push({
      fechaHora:     row[0],
      usuario:       row[1],
      filaSheet:     String(row[2] || ''),
      codigoExterno: codigoExterno,
      httpStatus:    row[6],
      error:         row[8],
      categoria:     row[11] || 'OTRO',
      patentes:      row[12] || ''
    });
  }

  return { ok: true, errores: errores };
}

/**
 * Reintenta el envío a Aker de un itinerario puntual (fila simple o grupo de
 * "Viajes con Paradas", identificado por el mismo "Fila Sheet" que quedó en
 * LogsAker) — re-arma el payload desde ViajesTotalesTroncales, por si algún
 * dato (ej. el DNI del conductor) se corrigió desde el intento original.
 *
 * Si la categoría es SERVICIO_NO_ENCONTRADO, exige confirmoServicioCreado =
 * true — si no, ni siquiera intenta, porque va a volver a fallar con el
 * mismo error hasta que alguien dé de alta esa patente como servicio en Aker.
 */
function reintentarEnvioAker(token, filaSheet, categoria, confirmoServicioCreado) {
  var session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  if (session.rol !== 'ADMIN_GENERAL' && session.rol !== 'ADMIN_TRAFICO') {
    throw new Error('Sin permisos para esta operación');
  }
  if (categoria === 'SERVICIO_NO_ENCONTRADO' && confirmoServicioCreado !== true) {
    throw new Error('Confirmá que el vehículo ya está dado de alta como servicio en Aker antes de reintentar — si no, va a volver a fallar con el mismo error.');
  }

  var filas = String(filaSheet).split(',').map(function(f) { return Number(String(f).trim()); }).filter(function(n) { return n > 0; });
  if (!filas.length) throw new Error('Fila Sheet inválida: ' + filaSheet);

  var cfg    = CONFIG.SHEETS.VIAJES;
  var values = sheetsRead_(cfg.id, cfg.tab + '!A:DA');
  var headers = values[0];

  var items = filas.map(function(fila) {
    var row = values[fila - 1];
    if (!row) throw new Error('La fila ' + fila + ' ya no existe en ViajesTotalesTroncales');
    return { fila: fila, row: row };
  });

  var payload;
  try {
    payload = items.length > 1
      ? construirPayloadItinerarioAgrupado_(headers, items)
      : construirPayloadItinerarioAker_(headers, items[0].row, {});
  } catch(eBuild) {
    return logIntentoAker_({ ok: false, filaSheet: filaSheet, error: 'Error armando payload al reintentar: ' + eBuild.message });
  }

  return enviarPayloadAker_(payload, filaSheet);
}
