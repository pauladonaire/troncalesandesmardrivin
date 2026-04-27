// ============================================================
// ARCHIVO GAS: OtrosDatos.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "OtrosDatos" y pegar este contenido
// ============================================================

function getRutasMaestras() {
  const cfg  = CONFIG.SHEETS.OTROS_DATOS;
  const rows = sheetsRead_(cfg.id, cfg.tabs.RUTAS);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(function(r) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = r[i] || ''; });
    return obj;
  });
}

function getArrastres() {
  const cfg  = CONFIG.SHEETS.OTROS_DATOS;
  const rows = sheetsRead_(cfg.id, cfg.tabs.ARRASTRES);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(function(r) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = r[i] || ''; });
    return obj;
  });
}

function getEsquemasCostos() {
  const cfg = CONFIG.SHEETS.OTROS_DATOS;
  return sheetsRead_(cfg.id, cfg.tabs.ESQUEMAS_COSTOS + '!A:AA') || [];
}

function getEsquemasIngresos() {
  const cfg = CONFIG.SHEETS.OTROS_DATOS;
  return sheetsRead_(cfg.id, cfg.tabs.ESQUEMAS_INGRESOS + '!A:AA') || [];
}

/**
 * Agrega una ruta maestra (requiere rol admin).
 */
function addRutaMaestra(token, datos) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  if (session.rol !== 'ADMIN_GENERAL' && session.rol !== 'ADMIN_TRAFICO') {
    throw new Error('Sin permisos para esta operación');
  }

  const cfg  = CONFIG.SHEETS.OTROS_DATOS;
  const rows = sheetsRead_(cfg.id, cfg.tabs.RUTAS);
  if (rows.length === 0) throw new Error('Encabezados no encontrados en RutasMaestras');

  const headers = rows[0];
  const newRow  = headers.map(function(h) { return datos[h] || ''; });
  sheetsAppend_(cfg.id, cfg.tabs.RUTAS, [newRow]);
  return { ok: true };
}

/**
 * Agrega un arrastre (requiere rol admin).
 */
function addArrastre(token, datos) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  if (session.rol !== 'ADMIN_GENERAL' && session.rol !== 'ADMIN_TRAFICO') {
    throw new Error('Sin permisos para esta operación');
  }

  const cfg  = CONFIG.SHEETS.OTROS_DATOS;
  const rows = sheetsRead_(cfg.id, cfg.tabs.ARRASTRES);
  if (rows.length === 0) throw new Error('Encabezados no encontrados en Arrastres');

  const headers = rows[0];
  const newRow  = headers.map(function(h) { return datos[h] || ''; });
  sheetsAppend_(cfg.id, cfg.tabs.ARRASTRES, [newRow]);
  return { ok: true };
}

// ─── Funciones con sesión para páginas Rutas y Arrastres ─────────────────────

function getDatosRutas(token) {
  var session = validateSession(token);
  if (!session) return { ok: false, error: 'Sesión inválida o expirada' };
  try {
    // Reutiliza el cache de getDatosMaestros (6h TTL) — cero lecturas extra si está caliente
    var maestros   = getDatosMaestros(token);
    var rutasObjs  = maestros.rutas || [];
    var headers    = rutasObjs.length > 0 ? Object.keys(rutasObjs[0]) : ['Nombre', 'Proveedor'];
    var rutas      = rutasObjs.map(function(r) { return Object.values(r); });
    var socios     = (maestros.socios || [])
      .filter(function(s) { return s.type === 'supplier'; })
      .map(function(s) { return { name: s.name }; });
    return { ok: true, rutas: rutas, headers: headers, socios: socios };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function addRutasMaestras(token, filas) {
  var session = validateSession(token);
  if (!session) return { ok: false, error: 'Sesión inválida o expirada' };
  try {
    var cfg  = CONFIG.SHEETS.OTROS_DATOS;
    var rows = filas.map(function(f) { return Array.isArray(f) ? f : Object.values(f); });
    sheetsAppend_(cfg.id, cfg.tabs.RUTAS, rows);
    invalidarCacheDatosMaestros();
    return { ok: true, count: filas.length };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function getDatosArrastres(token) {
  var session = validateSession(token);
  if (!session) return { ok: false, error: 'Sesión inválida o expirada' };
  try {
    // Reutiliza el cache de getDatosMaestros (6h TTL) — cero lecturas extra si está caliente
    var maestros  = getDatosMaestros(token);
    var arrObjs   = maestros.arrastres || [];
    var headers   = arrObjs.length > 0 ? Object.keys(arrObjs[0]) : ['Código', 'Descripción'];
    var arrastres = arrObjs.map(function(r) { return Object.values(r); });
    return { ok: true, arrastres: arrastres, headers: headers };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function addArrastres(token, filas) {
  var session = validateSession(token);
  if (!session) return { ok: false, error: 'Sesión inválida o expirada' };
  try {
    var cfg  = CONFIG.SHEETS.OTROS_DATOS;
    var rows = filas.map(function(f) { return Array.isArray(f) ? f : Object.values(f); });
    sheetsAppend_(cfg.id, cfg.tabs.ARRASTRES, rows);
    invalidarCacheDatosMaestros();
    return { ok: true, count: filas.length };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}
