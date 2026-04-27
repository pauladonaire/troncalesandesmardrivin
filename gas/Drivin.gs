// ============================================================
// ARCHIVO GAS: Drivin.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Drivin" y pegar este contenido
// ============================================================

/**
 * Realiza un GET a la API de Driv.in.
 * @returns {object|Array} response del JSON
 */
function drivinGet_(endpoint) {
  const url  = CONFIG.DRIVIN.BASE_URL + endpoint;
  const resp = UrlFetchApp.fetch(url, {
    headers: { 'X-API-KEY': CONFIG.DRIVIN.API_KEY },
    muteHttpExceptions: true
  });
  const json = JSON.parse(resp.getContentText());
  if (json.status !== 'OK') {
    throw new Error('Driv.in API error en ' + endpoint + ': ' + JSON.stringify(json));
  }
  return json.response;
}

/**
 * Realiza un POST a la API de Driv.in.
 * @returns {object|Array} response del JSON
 */
function drivinPost_(endpoint, payload) {
  const url  = CONFIG.DRIVIN.BASE_URL + endpoint;
  const resp = UrlFetchApp.fetch(url, {
    method:      'post',
    contentType: 'application/json',
    headers:     { 'X-API-KEY': CONFIG.DRIVIN.API_KEY },
    payload:     JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const json = JSON.parse(resp.getContentText());
  if (json.status !== 'OK') {
    throw new Error('Driv.in API error en POST ' + endpoint + ': ' + JSON.stringify(json));
  }
  return json.response;
}

// ─── Sincronización de Direcciones ───────────────────────────────────────────

function syncDirecciones() {
  const data = drivinGet_('/addresses');
  const rows = (Array.isArray(data) ? data : []).map(function(a) {
    return [
      a.id              || '',
      a.code            || '',
      a.name            || '',
      a.address1        || '',
      a.address2        || '',
      a.city            || '',
      a.state           || '',
      a.country         || '',
      a.postal_code     || '',
      a.lat             || '',
      a.lng             || '',
      a.time_zone       || '',
      a.contact_name    || '',
      a.contact_phone   || '',
      a.contact_email   || '',
      a.delivery_time_min != null ? a.delivery_time_min : '',
      Array.isArray(a.tags) ? a.tags.join(',') : (a.tags || '')
    ];
  });

  const cfg = CONFIG.SHEETS.DIRECCIONES;
  sheetsClear_(cfg.id, cfg.tab + '!A2:Z');
  if (rows.length > 0) sheetsWrite_(cfg.id, cfg.tab + '!A2', rows);
  invalidarCacheDatosMaestros();
  return { ok: true, count: rows.length };
}

// ─── Sincronización de Tripulantes ───────────────────────────────────────────

function syncTripulantes() {
  const data = drivinGet_('/users?role_name=driver');
  const rows = (Array.isArray(data) ? data : []).map(function(u) {
    const nombreCompleto = ((u.first_name || '') + ' ' + (u.last_name || '')).trim();
    return [
      u.id              || '',
      u.email           || '',
      u.first_name      || '',
      u.last_name       || '',
      nombreCompleto,
      u.phone           || '',
      u.document_number || '',
      u.role_name       || '',
      u.is_active != null ? String(u.is_active) : '',
      Array.isArray(u.tags) ? u.tags.join(',') : (u.tags || '')
    ];
  });

  const cfg = CONFIG.SHEETS.TRIPULANTES;
  sheetsClear_(cfg.id, cfg.tab + '!A2:Z');
  if (rows.length > 0) sheetsWrite_(cfg.id, cfg.tab + '!A2', rows);
  invalidarCacheDatosMaestros();
  return { ok: true, count: rows.length };
}

// ─── Sincronización de Flota ─────────────────────────────────────────────────

function syncFlota() {
  const data = drivinGet_('/vehicles');
  const rows = (Array.isArray(data) ? data : []).map(function(v) {
    return [
      v.id            || '',
      v.code          || '',
      v.name          || '',
      v.plate         || '',
      v.type          || '',
      v.max_weight    != null ? v.max_weight    : '',
      v.max_volume    != null ? v.max_volume    : '',
      v.is_active     != null ? String(v.is_active) : '',
      v.employer_name || '',
      Array.isArray(v.tags)               ? v.tags.join(',')               : (v.tags               || ''),
      Array.isArray(v.cost_allocation_tags) ? v.cost_allocation_tags.join(',') : (v.cost_allocation_tags || '')
    ];
  });

  const cfg = CONFIG.SHEETS.FLOTA;
  sheetsClear_(cfg.id, cfg.tab + '!A2:Z');
  if (rows.length > 0) sheetsWrite_(cfg.id, cfg.tab + '!A2', rows);
  invalidarCacheDatosMaestros();
  return { ok: true, count: rows.length };
}

// ─── Sincronización de Socios ─────────────────────────────────────────────────

function syncSocios() {
  const data = drivinGet_('/business_partners');
  const rows = (Array.isArray(data) ? data : []).map(function(s) {
    return [
      s.id      || '',
      s.code    || '',
      s.name    || '',
      s.type    || '',
      s.address || '',
      s.city    || '',
      s.country || '',
      s.phone   || '',
      s.email   || '',
      Array.isArray(s.tags) ? s.tags.join(',') : (s.tags || '')
    ];
  });

  const cfg = CONFIG.SHEETS.SOCIOS;
  sheetsClear_(cfg.id, cfg.tab + '!A2:Z');
  if (rows.length > 0) sheetsWrite_(cfg.id, cfg.tab + '!A2', rows);
  invalidarCacheDatosMaestros();
  return { ok: true, count: rows.length };
}

// ─── Sincronizaciones manuales (requieren sesión) ────────────────────────────

function syncManualDirecciones(token) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  return syncDirecciones();
}

function syncManualTripulantes(token) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  return syncTripulantes();
}

function syncManualFlota(token) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  return syncFlota();
}

function syncManualSocios(token) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  return syncSocios();
}

// ─── Crear Plan en Driv.in ───────────────────────────────────────────────────

/**
 * Crea un plan/escenario en Driv.in.
 * @param {string} token - Token de sesión
 * @param {{ description, date, fleet_name, schema_code }} planDatos
 */
function crearPlanDrivin(token, planDatos) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');

  try {
    const response = drivinPost_('/scenarios', {
      description: planDatos.description,
      date:        planDatos.date,
      fleet_name:  planDatos.fleet_name || 'FLOTA A',
      schema_code: planDatos.schema_code
    });
    return { ok: true, response: response };
  } catch(e) {
    console.error('crearPlanDrivin error: ' + e.message);
    return { ok: false, error: e.message };
  }
}
