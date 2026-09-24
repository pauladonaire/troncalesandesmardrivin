// ============================================================
// ARCHIVO GAS: Viajes.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Viajes" y pegar este contenido
// ============================================================

var CACHE_KEY_DM     = 'DATOS_MAESTROS_V1';
var CACHE_KEY_DM_URL = 'DATOS_MAESTROS_URL_V1';
var CACHE_TTL_DM     = 6 * 60 * 60; // 6 horas

/**
 * Función de prueba SIN guion bajo al final — así aparece en el desplegable
 * "Ejecutar" del editor (las que terminan en "_" no se listan ahí). Ya no
 * hace falta para el flujo normal, queda solo como diagnóstico.
 */
function TEST_autorizarDrive() {
  DriveApp.getRootFolder();
  console.log('Drive autorizado OK');
}

/**
 * Prueba manual: intenta crear y compartir un archivo, exactamente lo mismo
 * que hace driveSubirJsonPublico_, para ver si el problema es específico de
 * las ejecuciones automáticas (doPost/trigger) o si ahora falla en general.
 */
/**
 * Crea un archivo SIN llamar a setSharing — para probar si hereda el
 * permiso de la carpeta (que hay que compartir una sola vez a mano desde
 * la interfaz de Drive, ya que setSharing por script está bloqueado).
 */
function TEST_crearArchivoSinCompartir() {
  var folder  = DriveApp.getFolderById(CONFIG.DRIVE.FOLDER_ID);
  var blob    = Utilities.newBlob('{"test":true}', 'application/json', 'test_hereda_permiso.json');
  var archivo = folder.createFile(blob);
  console.log('Archivo creado OK, id=' + archivo.getId());
}

/**
 * Se asegura de que los datos maestros estén frescos en la planilla cache
 * (menos de 6hs). Si hace falta, hace el trabajo pesado ACÁ MISMO,
 * sincrónico, dentro del pedido. No importa si esta respuesta llega bien
 * al navegador — el frontend no depende de ella: lee los datos directo de
 * la planilla (fetch a export CSV), una vía de entrega distinta a la
 * respuesta de doPost, que venía fallando de forma intermitente
 * (script.googleusercontent.com/macros/echo devuelve 404 aunque la
 * ejecución haya terminado bien) y además el archivo de Drive que
 * probamos antes no se puede leer por fetch() por falta de headers CORS
 * — por eso los datos van directo en celdas de la planilla, no en Drive.
 */
function asegurarDatosMaestrosFrescos(token) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');

  const cache = CacheService.getScriptCache();
  if (cache.get(CACHE_KEY_DM_URL)) return { ok: true };

  // Lock: si varios usuarios entran con el cache frío a la vez, que solo
  // uno regenere y el resto espere.
  const lock = LockService.getScriptLock();
  let tieneLock = false;
  try { tieneLock = lock.tryLock(30000); } catch(eLock) { tieneLock = false; }

  try {
    if (cache.get(CACHE_KEY_DM_URL)) return { ok: true };

    console.log('asegurarDatosMaestrosFrescos: leyendo Sheets...');
    const datos = leerTodosLosDatos_();
    escribirDatosMaestrosEnSheet_(JSON.stringify(datos));
    cache.put(CACHE_KEY_DM_URL, 'true', CACHE_TTL_DM);

    return { ok: true };

  } catch(e) {
    console.error('asegurarDatosMaestrosFrescos error: ' + e.message);
    return { ok: false, error: 'Error al preparar datos maestros: ' + e.message };
  } finally {
    if (tieneLock) lock.releaseLock();
  }
}

/**
 * Escribe el JSON completo de datos maestros partido en celdas de una
 * columna (una celda de Sheets admite ~50.000 caracteres), en una planilla
 * dedicada compartida ("cualquiera con el link" heredado de la carpeta —
 * no podemos llamar a setSharing() por script, bloqueado por política de
 * Workspace). El frontend lee esa planilla vía export CSV y reconstruye el
 * JSON concatenando las celdas en orden.
 */
function escribirDatosMaestrosEnSheet_(jsonString) {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('PUNTERO_DM_SHEET_ID');
  let ss;

  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch(e) { ss = null; }
  }

  if (!ss) {
    ss = SpreadsheetApp.create('Datos Maestros Cache (no borrar)');
    DriveApp.getFolderById(CONFIG.DRIVE.FOLDER_ID).addFile(DriveApp.getFileById(ss.getId()));
    props.setProperty('PUNTERO_DM_SHEET_ID', ss.getId());
    console.log('escribirDatosMaestrosEnSheet_: planilla creada, id=' + ss.getId());
  }

  const CHUNK = 45000;
  const filas = [];
  for (let i = 0; i < jsonString.length; i += CHUNK) {
    filas.push([jsonString.substring(i, i + CHUNK)]);
  }

  const sheet = ss.getSheets()[0];
  sheet.clearContents();
  sheet.getRange(1, 1, filas.length, 1).setValues(filas);
}

/**
 * Retorna todos los datos maestros. Primera llamada lee desde Sheets (~8-15s).
 * Las siguientes dentro de las 6 horas responden desde cache (~1s).
 */
function getDatosMaestros(token) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');

  const cache = CacheService.getScriptCache();

  // Intentar cache simple
  const cached = cache.get(CACHE_KEY_DM);
  if (cached) {
    console.log('getDatosMaestros: cache hit');
    return JSON.parse(cached);
  }

  // Intentar cache por partes (cuando el JSON supera 100KB)
  const enPartes = cache.get(CACHE_KEY_DM + '_partes');
  if (enPartes) {
    console.log('getDatosMaestros: cache hit (partes)');
    return leerCacheEnPartes_(cache);
  }

  // Cache miss — usar un lock para que, si varios usuarios entran a la vez
  // con el caché frío, SOLO UNO vaya a leer Sheets y el resto espere y
  // aproveche ese resultado. Sin esto, cada usuario simultáneo dispara su
  // propia tanda de lecturas y se agota la cuota de Sheets (429).
  const lock = LockService.getScriptLock();
  let tieneLock = false;
  try {
    tieneLock = lock.tryLock(30000);
  } catch(eLock) {
    tieneLock = false;
  }

  try {
    // Re-chequear cache: mientras esperábamos el lock, otra ejecución
    // puede haber terminado de leer y cachear los datos.
    const cached2 = cache.get(CACHE_KEY_DM);
    if (cached2) {
      console.log('getDatosMaestros: cache hit tras esperar lock');
      return JSON.parse(cached2);
    }
    const enPartes2 = cache.get(CACHE_KEY_DM + '_partes');
    if (enPartes2) {
      console.log('getDatosMaestros: cache hit (partes) tras esperar lock');
      return leerCacheEnPartes_(cache);
    }

    // Sigue en miss — leer desde Sheets
    console.log('getDatosMaestros: leyendo desde Sheets...');
    const datos = leerTodosLosDatos_();

    // Guardar en cache; si supera 100KB, dividir en partes
    try {
      var json = JSON.stringify(datos);
      if (json.length < 90000) {
        cache.put(CACHE_KEY_DM, json, CACHE_TTL_DM);
      } else {
        guardarCacheEnPartes_(cache, datos);
      }
    } catch(eCacheWrite) {
      console.warn('getDatosMaestros: no se pudo cachear — ' + eCacheWrite.message);
    }

    return datos;

  } catch(e) {
    console.error('getDatosMaestros error: ' + e.message);
    throw new Error('Error al obtener datos maestros: ' + e.message);
  } finally {
    if (tieneLock) lock.releaseLock();
  }
}

function leerTodosLosDatos_() {
  const cfgDir = CONFIG.SHEETS.DIRECCIONES;
  const cfgTri = CONFIG.SHEETS.TRIPULANTES;
  const cfgFlo = CONFIG.SHEETS.FLOTA;
  const cfgSoc = CONFIG.SHEETS.SOCIOS;
  const cfgOtr = CONFIG.SHEETS.OTROS_DATOS;

  const rowsDirecciones = sheetsRead_(cfgDir.id, cfgDir.tab);
  const rowsTripulantes = sheetsRead_(cfgTri.id, cfgTri.tab);
  const rowsFlota       = sheetsRead_(cfgFlo.id, cfgFlo.tab);
  const rowsSocios      = sheetsRead_(cfgSoc.id, cfgSoc.tab);

  // Las 4 pestañas de OTROS_DATOS están en el mismo spreadsheet — se leen
  // juntas en una sola llamada (batchGet) en vez de 4 viajes de ida y vuelta.
  var otrosDatos    = sheetsBatchRead_(cfgOtr.id, [
    cfgOtr.tabs.RUTAS, cfgOtr.tabs.ARRASTRES, cfgOtr.tabs.ESQUEMAS_COSTOS, cfgOtr.tabs.ESQUEMAS_INGRESOS
  ]);
  const rowsRutas       = otrosDatos[0];
  const rowsArrastres   = otrosDatos[1];
  const rowsCostos      = otrosDatos[2];
  const rowsIngresos    = otrosDatos[3];

  const direcciones = rowsDirecciones.slice(1).map(function(r) {
    return {
      id:          r[0]  || '',
      code:        r[1]  || '',
      name:        r[2]  || '',
      address1:    r[3]  || '',
      address2:    r[4]  || '',
      city:        r[5]  || '',
      state:       r[6]  || '',
      country:     r[7]  || '',
      postal_code: r[8]  || '',
      lat:         r[9]  || '',
      lng:         r[10] || ''
    };
  });

  const tripulantes = rowsTripulantes.slice(1).map(function(r) {
    return {
      id:              r[0] || '',
      email:           r[1] || '',
      first_name:      r[2] || '',
      last_name:       r[3] || '',
      nombre_completo: r[4] || ((r[2] || '') + ' ' + (r[3] || '')).trim(),
      phone:           r[5] || '',
      is_active:       r[8] !== 'false' && r[8] !== 'FALSE'
    };
  });

  const flota = rowsFlota.slice(1)
    .map(function(r) {
      return {
        id:                   r[0]  || '',
        code:                 r[1]  || '',
        name:                 r[2]  || '',
        plate:                r[3]  || '',
        type:                 r[4]  || '',
        is_active:            r[7] === 'true' || r[7] === 'TRUE',
        employer_name:        r[8]  || '',
        tags:                 r[9]  || '',
        cost_allocation_tags: r[10] || ''
      };
    })
    .filter(function(v) { return v.is_active; });

  const socios = rowsSocios.slice(1).map(function(r) {
    return {
      id:      r[0] || '',
      code:    r[1] || '',
      name:    r[2] || '',
      type:    r[3] || '',
      address: r[4] || '',
      city:    r[5] || '',
      country: r[6] || ''
    };
  });

  const hRut = rowsRutas.length > 0 ? rowsRutas[0] : [];
  const rutas = rowsRutas.slice(1).map(function(r) {
    var obj = {};
    hRut.forEach(function(h, i) { obj[h] = r[i] || ''; });
    return obj;
  });

  const hArr = rowsArrastres.length > 0 ? rowsArrastres[0] : [];
  const arrastres = rowsArrastres.slice(1).map(function(r) {
    var obj = {};
    hArr.forEach(function(h, i) { obj[h] = r[i] || ''; });
    return obj;
  });

  return {
    direcciones:      direcciones,
    tripulantes:      tripulantes,
    flota:            flota,
    socios:           socios,
    rutas:            rutas,
    arrastres:        arrastres,
    esquemasCostos:   rowsCostos   || [],
    esquemasIngresos: rowsIngresos || []
  };
}

/**
 * getDatosMaestros() devuelve TODO junto — la respuesta se volvió demasiado
 * grande para que Apps Script la entregue de forma confiable en una sola
 * llamada (falla en el paso interno de googleusercontent.com), y ni siquiera
 * partirla en 2 alcanzó. Estas funciones parten esa misma información (ya
 * cacheada por getDatosMaestros, cero lecturas extra a Sheets) en una
 * respuesta chica POR TIPO DE DATO, para pedirlas de a una desde el frontend
 * — el mismo tamaño que getDatosRutas/getDatosArrastres, que sí funcionan.
 */
function getParteDirecciones(token)      { return { direcciones:      getDatosMaestros(token).direcciones }; }
function getParteTripulantes(token)      { return { tripulantes:      getDatosMaestros(token).tripulantes }; }
function getParteFlota(token)            { return { flota:            getDatosMaestros(token).flota }; }
function getParteSocios(token)           { return { socios:           getDatosMaestros(token).socios }; }
function getParteRutas(token)            { return { rutas:            getDatosMaestros(token).rutas }; }
function getParteArrastres(token)        { return { arrastres:        getDatosMaestros(token).arrastres }; }
function getParteEsquemasCostos(token)   { return { esquemasCostos:   getDatosMaestros(token).esquemasCostos }; }
function getParteEsquemasIngresos(token) { return { esquemasIngresos: getDatosMaestros(token).esquemasIngresos }; }

function invalidarCacheDatosMaestros() {
  var cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEY_DM);
  cache.remove(CACHE_KEY_DM + '_parte1');
  cache.remove(CACHE_KEY_DM + '_parte2');
  cache.remove(CACHE_KEY_DM + '_parte3');
  cache.remove(CACHE_KEY_DM + '_partes');
  cache.remove(CACHE_KEY_DM_URL);
  console.log('Cache de datos maestros invalidado');
}

function guardarCacheEnPartes_(cache, datos) {
  cache.put(CACHE_KEY_DM + '_parte1', JSON.stringify({ direcciones: datos.direcciones, tripulantes: datos.tripulantes }), CACHE_TTL_DM);
  cache.put(CACHE_KEY_DM + '_parte2', JSON.stringify({ flota: datos.flota, socios: datos.socios }), CACHE_TTL_DM);
  cache.put(CACHE_KEY_DM + '_parte3', JSON.stringify({ rutas: datos.rutas, arrastres: datos.arrastres, esquemasCostos: datos.esquemasCostos, esquemasIngresos: datos.esquemasIngresos }), CACHE_TTL_DM);
  cache.put(CACHE_KEY_DM + '_partes', 'true', CACHE_TTL_DM);
}

function leerCacheEnPartes_(cache) {
  var p1 = JSON.parse(cache.get(CACHE_KEY_DM + '_parte1') || '{}');
  var p2 = JSON.parse(cache.get(CACHE_KEY_DM + '_parte2') || '{}');
  var p3 = JSON.parse(cache.get(CACHE_KEY_DM + '_parte3') || '{}');
  return Object.assign({}, p1, p2, p3);
}

// ── Historial de viajes para el módulo Reportes ──────────

function getViajesHistorico(token) {
  var session = validateSession(token);
  if (!session) return { ok: false, error: 'Sesión inválida' };

  try {
    var cache    = CacheService.getScriptCache();
    var cacheKey = 'VIAJES_HISTORICO_V1';
    var cached   = cache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    var values = sheetsRead_(
      CONFIG.SHEETS.VIAJES.id,
      CONFIG.SHEETS.VIAJES.tab + '!A:DA'
    );

    if (!values || values.length <= 1) {
      return { ok: true, headers: [], viajes: [] };
    }

    var headers = values[0];
    var viajes  = values.slice(1).filter(function(row) { return row[3]; });

    var resultado = { ok: true, headers: headers, viajes: viajes };
    var json = JSON.stringify(resultado);
    if (json.length < 90000) {
      cache.put(cacheKey, json, 60 * 30);
    }

    return resultado;
  } catch(e) {
    console.error('getViajesHistorico error: ' + e.message);
    return { ok: false, error: e.message };
  }
}
