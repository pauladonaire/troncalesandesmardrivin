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
  const cfg  = CONFIG.SHEETS.OTROS_DATOS;
  const rows = sheetsRead_(cfg.id, cfg.tabs.ESQUEMAS_COSTOS + '!A:AA');
  return rows || [];
}

function getEsquemasIngresos() {
  const cfg  = CONFIG.SHEETS.OTROS_DATOS;
  const rows = sheetsRead_(cfg.id, cfg.tabs.ESQUEMAS_INGRESOS + '!A:AA');
  return rows || [];
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
