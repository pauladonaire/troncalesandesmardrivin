// ============================================================
// ARCHIVO GAS: Excel.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Excel" y pegar este contenido
// ============================================================

/**
 * Sube el Excel a Drive y registra los viajes en el Sheet de histórico.
 * @param {string} token
 * @param {string} base64 - Contenido del .xlsx en base64
 * @param {string} nombreArchivo - Nombre del archivo a crear en Drive
 * @param {Array}  viajes - Array de objetos con datos de cada viaje
 * @param {object} planDatos - { nombre, fechaViaje, schemaCode, fechaMaxEntrega }
 * @returns {{ ok: boolean, fileUrl?: string, fileId?: string, error?: string }}
 */
function subirExcelADrive(token, base64, nombreArchivo, viajes, planDatos) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');

  try {
    const archivo = driveUploadFile_(
      nombreArchivo,
      base64,
      CONFIG.DRIVE.FOLDER_ID
    );

    registrarViajesEnSheet_(viajes, planDatos, session.email);

    return {
      ok:      true,
      fileUrl: archivo.webViewLink,
      fileId:  archivo.id
    };
  } catch(e) {
    console.error('subirExcelADrive error: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Registra viajes en el Sheet ViajesTotalesTroncales.
 * Columnas 1-100: datos del Excel. Columnas 101-103: metadatos.
 */
function registrarViajesEnSheet_(viajes, planDatos, emailUsuario) {
  const cfg  = CONFIG.SHEETS.VIAJES;
  const now  = new Date().toISOString();

  const rows = viajes.map(function(v) {
    // 100 columnas en el mismo orden del Excel
    var fila = construirFilaViaje_(v, planDatos, emailUsuario);
    // Columnas 101-103
    fila.push(emailUsuario);
    fila.push(planDatos.nombre);
    fila.push(now);
    return fila;
  });

  if (rows.length > 0) {
    sheetsAppend_(cfg.id, cfg.tab, rows);
  }
}

/**
 * Construye el array de 100 valores para un viaje.
 * Este mismo orden se usa en el Excel generado en el frontend (viajes.js.html).
 */
function construirFilaViaje_(v, planDatos, emailUsuario) {
  var etiquetas = [].concat(
    Array.isArray(v.etiquetasCosto)    ? v.etiquetasCosto    : [],
    Array.isArray(v.etiquetasIngreso)  ? v.etiquetasIngreso  : []
  ).join(',');

  return [
    planDatos.fechaMaxEntrega          || '', // [0]  Fecha Maxima de Entrega
    planDatos.nombre                   || '', // [1]  Nombre Plan
    planDatos.schemaCode               || '', // [2]  Esquema
    v.codigoDespacho                   || '', // [3]  Código de despacho
    v.unidades1                        || '', // [4]  Unidades_1
    v.unidades2                        || '', // [5]  Unidades_2
    v.unidades3                        || '', // [6]  Unidades_3
    '',                                       // [7]  Prioridad
    v.codigoDireccion                  || '', // [8]  Código de dirección
    '',                                       // [9]  Nombre dirección
    '',                                       // [10] Nombre cliente
    '',                                       // [11] Tipo
    '',                                       // [12] Dirección 1
    '',                                       // [13] Referencias
    '',                                       // [14] Descripción
    '',                                       // [15] Comuna
    '',                                       // [16] Provincia
    '',                                       // [17] Región
    '',                                       // [18] País
    '',                                       // [19] Código Postal
    '',                                       // [20] Latitud
    '',                                       // [21] Longitud
    '',                                       // [22] Tiempo de servicio
    '',                                       // [23] Inicio Ventana 1
    '',                                       // [24] Fin Ventana 1
    '',                                       // [25] Características
    v.vehiculo                         || '', // [26] Asignación vehículo
    '',                                       // [27] Telefono de Contacto
    '',                                       // [28] Email de Contacto
    '',                                       // [29] Unidades del artículo
    '',                                       // [30] Código del artículo
    '',                                       // [31] Descripción del artículo
    '',                                       // [32] Exclusividad
    '',                                       // [33] Posicion
    v.proveedor                        || '', // [34] Proveedor
    '',                                       // [35] Inicio ventana 2
    '',                                       // [36] Fin ventana 2
    '',                                       // [37] Código cliente
    '',                                       // [38] Nombre de contacto
    v.codigoAlternativo                || '', // [39] Código Alternativo
    '',                                       // [40] Mail aprobar ruta
    '',                                       // [41] Mail iniciar ruta
    '',                                       // [42] Mail en camino a direccion
    '',                                       // [43] Mail entrega finalizada
    v.codigoDespacho                   || '', // [44] Código de ruta (= col [3])
    '',                                       // [45] Número de viaje
    '',                                       // [46] Tipo Unidad
    '',                                       // [47] Texto 1
    '',                                       // [48] Texto 2
    '',                                       // [49] Texto 3
    '',                                       // [50] Texto 4
    '',                                       // [51] Texto 5
    etiquetas,                                // [52] Texto 6
    v.arrastre                         || '', // [53] Texto 7
    [v.codigoDespacho, v.empleador, v.proveedor].filter(Boolean).join('-'), // [54] Texto 8
    v.descripcionViaje                 || '', // [55] Texto 9
    v.segundoConductorNombre           || '', // [56] Texto 10
    v.rutaMaestra                      || '', // [57] Texto 11
    '',                                       // [58] Número 1
    '',                                       // [59] Número 2
    '',                                       // [60] Número 3
    '',                                       // [61] Número 4
    v.conductorEmail                   || '', // [62] Correo Conductor
    etiquetas,                                // [63] Costo Asignación
    '',                                       // [64] Columna dummy
    '',                                       // [65] Fecha Facturación
    v.rutaMaestra                      || '', // [66] Ruta Maestra
    '',                                       // [67] Descripción Despacho
    '',                                       // [68] Telefono contacto ruta aprobada
    '',                                       // [69] Telefono contacto ruta iniciada
    '',                                       // [70] Telefono contacto cerca del lugar
    '',                                       // [71] Telefono contacto entrega
    '',                                       // [72] Código zona de ventas
    '',                                       // [73] Unidades requeridas por item
    '',                                       // [74] Tag de Busqueda
    '',                                       // [75] Fecha de proceso
    '',                                       // [76] Folio
    '',                                       // [77] Orden de compra
    '',                                       // [78] Nombre 2do Contacto
    '',                                       // [79] Teléfono 2do Contacto
    emailUsuario,                             // [80] Email 2do Contacto
    '',                                       // [81] Categoría
    '',                                       // [82] url
    '',                                       // [83] token
    '',                                       // [84] url con token
    '',                                       // [85] Unidades_4
    '',                                       // [86] Tipo de orden
    '',                                       // [87] Paquete de datos
    '',                                       // [88] Código proveedor
    emailUsuario,                             // [89] Texto 12
    '',                                       // [90] Texto 13
    '',                                       // [91] Texto 14
    '',                                       // [92] Texto 15
    '',                                       // [93] Texto 16
    '',                                       // [94] Texto 17
    '',                                       // [95] Texto 18
    '',                                       // [96] Texto 19
    '',                                       // [97] Texto 20
    '',                                       // [98] Código Empleador
    ''                                        // [99] Prioridad de Secuencia
  ];
}
