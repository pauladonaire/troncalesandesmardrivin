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
// ─── Sincronización de Esquemas de Costos e Ingresos ─────────────────────────

function syncEsquemas() {
  const url  = CONFIG.DRIVIN.BASE_URL + '/cost_schemas?limit=100000';
  const resp = UrlFetchApp.fetch(url, {
    headers: { 'X-API-KEY': CONFIG.DRIVIN.API_KEY },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const json = JSON.parse(resp.getContentText());
  if (code !== 200) {
    throw new Error('Driv.in API error en /cost_schemas: HTTP ' + code + ' - ' + resp.getContentText());
  }
  const data = json.all_cost_schemas || json.cost_schemas || json.response || [];

  // Lookup maps id → nombre para supplier y employer
  const supplierMap = {};
  (json.suppliers || []).forEach(function(s) { supplierMap[s.id] = s.name || ''; });
  const employerMap = {};
  (json.employers || []).forEach(function(e) { employerMap[e.id] = e.name || ''; });

  const rowsCosto   = [];
  const rowsIngreso = [];

  (Array.isArray(data) ? data : []).forEach(function(schema) {
    (schema.cost_concepts || []).forEach(function(cc) {
      var row = [
        schema.id                                                              || '',
        schema.name                                                            || '',
        schema.cost_schema_type                                                || '',
        schema.multi_employer != null ? schema.multi_employer                 : '',
        schema.multi_supplier != null ? schema.multi_supplier                 : '',
        cc.id                                                                  || '',
        cc.name                                                                || '',
        cc.cost              != null ? cc.cost                                : '',
        cc.start_cost        != null ? cc.start_cost                          : '',
        cc.days              != null ? cc.days                                : '',
        cc.cost_concept_type_id                                                || '',
        cc.supplier_id != null ? (supplierMap[cc.supplier_id] || String(cc.supplier_id)) : '',
        cc.employer_id != null ? (employerMap[cc.employer_id] || String(cc.employer_id)) : '',
        cc.is_max            != null ? cc.is_max                              : '',
        cc.min_range         != null ? cc.min_range                           : '',
        cc.max_range         != null ? cc.max_range                           : '',
        cc.cost_unit_id                                                        || '',
        cc.factor            != null ? cc.factor                              : '',
        cc.factor_1          != null ? cc.factor_1                            : '',
        cc.factor_2          != null ? cc.factor_2                            : '',
        cc.factor_3          != null ? cc.factor_3                            : '',
        cc.factor_function                                                     || '',
        cc.output_tag                                                          || '',
        cc.output_tag2                                                         || '',
        cc.output_tag3                                                         || '',
        cc.baseline_cost     != null ? cc.baseline_cost                       : 0,
        (cc.cost_allocation_tags || []).map(function(t) { return t.name; }).join(', '),
        (cc.cost_vehicle_tags    || []).map(function(t) { return t.name || t; }).join(', '),
        (cc.reason && cc.reason.id)          || '',
        (cc.reason && cc.reason.code)        || '',
        (cc.reason && cc.reason.description) || ''
      ];
      if (schema.cost_schema_type === 'cost') {
        rowsCosto.push(row);
      } else if (schema.cost_schema_type === 'revenue') {
        rowsIngreso.push(row);
      }
    });
  });

  var headers = [
    'schema_id','schema_name','cost_schema_type','multi_employer','multi_supplier',
    'cost_concept_id','cost_concept_name','cost','start_cost','days',
    'cost_concept_type','supplier_name','employer_name','is_max','min_range','max_range',
    'cost_unit','factor','factor_1','factor_2','factor_3','factor_function',
    'output_tag','output_tag2','output_tag3','baseline_cost',
    'cost_allocation_tags','cost_vehicle_tags','reason_id','reason_code','reason_description'
  ];

  var tabCostos   = CONFIG.SHEETS.OTROS_DATOS.tabs.ESQUEMAS_COSTOS;
  var tabIngresos = CONFIG.SHEETS.OTROS_DATOS.tabs.ESQUEMAS_INGRESOS;
  var sheetId     = CONFIG.SHEETS.OTROS_DATOS.id;

  sheetsClear_(sheetId, tabCostos   + '!A:AE');
  sheetsWrite_(sheetId, tabCostos   + '!A1', [headers].concat(rowsCosto));
  sheetsClear_(sheetId, tabIngresos + '!A:AE');
  sheetsWrite_(sheetId, tabIngresos + '!A1', [headers].concat(rowsIngreso));

  invalidarCacheDatosMaestros();
  return { ok: true, count: rowsCosto.length + rowsIngreso.length, countCosto: rowsCosto.length, countIngreso: rowsIngreso.length };
}

function syncManualEsquemas(token) {
  var session = validateSession(token);
  if (!session) return { ok: false, error: 'Sesión inválida' };
  try {
    return syncEsquemas();
  } catch(e) {
    console.error('syncEsquemas error: ' + e.message);
    return { ok: false, error: e.message };
  }
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
