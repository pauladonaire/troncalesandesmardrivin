// ============================================================
// ARCHIVO GAS: Aker.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Aker" y pegar este contenido.
//
// Integración MANUAL con Aker Control (POST /ws/itinerario/import).
// No se dispara desde doPost ni desde ningún trigger — se corre a mano
// desde este editor, función por función, fila por fila.
//
// Requiere 2 propiedades del script (Configuración del proyecto >
// Propiedades del script), igual que SERVICE_ACCOUNT_JSON:
//   - AKER_DOMINIO  → ej: "midominio.akercontrol.com" (SIN https:// ni /ws/...)
//   - AKER_TOKEN    → el Bearer token que provee Aker
// ============================================================

var AKER_LOG_SHEET_ID = '1ke5jO5ODxMrKyR7EsVAJOiSvv7Vclf_2JCAyVyBK8Dw';
var AKER_LOG_TAB       = 'LogsAker';

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
 *                       posicion_parada) + el destino real al final (Código
 *                       de dirección). Si no tiene Ruta Maestra, solo se
 *                       manda el destino (comportamiento anterior).
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
  var fechaInicioCol   = val('Fecha Inicio Viaje'); // columna CZ — ver Excel.gs registrarViajesEnSheet_

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

  var vehiculos = [];
  if (vehiculo) {
    var vehObj = { patente: vehiculo };
    if (arrastre) vehObj.acoplado = arrastre;
    vehiculos.push(vehObj);
  }

  // Si el viaje tiene Ruta Maestra, se arma el itinerario completo: las
  // paradas intermedias de esa ruta (sin código propio en DireccionesTroncales,
  // por eso se les arma un codigo_externo sintético "{despacho}-P{n}") y el
  // destino real al final. El destino real SIEMPRE conserva su propio
  // Código de dirección como codigo_externo (para que Aker lo siga
  // reconociendo como la misma referencia de siempre).
  var paradasRuta = rutaMaestra ? buscarParadasRutaMaestra_(rutaMaestra) : [];

  var paradas = [];
  var orden   = 0;

  paradasRuta.forEach(function(p) {
    orden++;
    paradas.push({
      orden:          orden - 1,
      codigo_externo: codigoDespacho + '-P' + orden,
      fecha_ingreso:  combinarFechaConHora_(fechaInicio, p.horaInicio),
      stop_type:      'drop',
      nombre:         p.nombre,
      latitud:        p.lat,
      longitud:       p.lng
    });
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

  return {
    codigo_externo: codigoDespacho,
    fecha_inicio:   fechaInicio,
    fecha_fin:      fechaFin,
    nota:           nota,
    armar_ruta:     true,
    vehiculos:      vehiculos,
    paradas:        paradas
  };
}

/** Completa una fecha 'YYYY-MM-DD' con una hora si no la tiene ya. */
function completarFechaHora_(fecha, horaDefault) {
  fecha = String(fecha || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha + ' ' + horaDefault;
  return fecha; // ya viene con hora, o es un formato inesperado — se manda tal cual
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
        'Payload enviado', 'Respuesta Aker'
      ]);
      hoja.getRange(1, 1, 1, 11).setFontWeight('bold');
    }
    var usuario = '';
    try { usuario = Session.getActiveUser().getEmail() || ''; } catch(eUser) { /* falta el scope userinfo.email — no crítico */ }

    hoja.appendRow([
      new Date().toISOString(),
      usuario,
      datos.filaSheet != null ? datos.filaSheet : '',
      datos.codigoExterno || '',
      datos.simulado ? 'SI' : 'NO',
      datos.ok ? 'OK' : 'ERROR',
      datos.httpStatus || '',
      (datos.respuesta && datos.respuesta.accion) || '',
      datos.error || '',
      datos.payload ? JSON.stringify(datos.payload) : '',
      datos.respuesta ? JSON.stringify(datos.respuesta) : ''
    ]);
  } catch(eLog) {
    console.error('logIntentoAker_ error: ' + eLog.message);
  }
  return datos;
}
