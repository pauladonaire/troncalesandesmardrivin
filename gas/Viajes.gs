// ============================================================
// ARCHIVO GAS: Viajes.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Viajes" y pegar este contenido
// ============================================================

var CACHE_KEY_DM = 'DATOS_MAESTROS_V1';
var CACHE_TTL_DM = 6 * 60 * 60; // 6 horas

/**
 * Retorna todos los datos maestros. Primera llamada lee desde Sheets (~8-15s).
 * Las siguientes dentro de las 6 horas responden desde cache (~1s).
 */
function getDatosMaestros(token) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');

  try {
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

    // Cache miss — leer desde Sheets
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
  const rowsRutas       = sheetsRead_(cfgOtr.id, cfgOtr.tabs.RUTAS);
  const rowsArrastres   = sheetsRead_(cfgOtr.id, cfgOtr.tabs.ARRASTRES);
  const rowsCostos      = sheetsRead_(cfgOtr.id, cfgOtr.tabs.ESQUEMAS_COSTOS);
  const rowsIngresos    = sheetsRead_(cfgOtr.id, cfgOtr.tabs.ESQUEMAS_INGRESOS);

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

function invalidarCacheDatosMaestros() {
  var cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEY_DM);
  cache.remove(CACHE_KEY_DM + '_parte1');
  cache.remove(CACHE_KEY_DM + '_parte2');
  cache.remove(CACHE_KEY_DM + '_parte3');
  cache.remove(CACHE_KEY_DM + '_partes');
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
