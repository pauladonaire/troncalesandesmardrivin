// ============================================================
// ARCHIVO GAS: ServiceAccount.gs
// JWT + OAuth2 para Service Account de Google. Wrappers de Sheets API v4 y Drive API.
// ============================================================

/**
 * Obtiene un access token de OAuth2 para la Service Account.
 * Cachea el token 55 min para no regenerarlo en cada request.
 */
function getServiceAccountToken_(scopes) {
  const cacheKey = 'SA_TOKEN_' + scopes.slice().sort().join('_').replace(/[^a-zA-Z0-9_]/g, '');
  const cache    = CacheService.getScriptCache();
  const cached   = cache.get(cacheKey);
  if (cached) return cached;

  const saJson = PropertiesService.getScriptProperties().getProperty('SERVICE_ACCOUNT_JSON');
  if (!saJson) throw new Error('SERVICE_ACCOUNT_JSON no configurado en propiedades del script.');
  const sa = JSON.parse(saJson);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const headerB64 = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimsB64 = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss:   sa.client_email,
    scope: scopes.join(' '),
    aud:   'https://oauth2.googleapis.com/token',
    exp:   exp,
    iat:   now
  }));

  const sigInput  = headerB64 + '.' + claimsB64;
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(sigInput, sa.private_key)
  );
  const jwt = sigInput + '.' + signature;

  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method:      'post',
    contentType: 'application/x-www-form-urlencoded',
    payload:     'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt,
    muteHttpExceptions: true
  });

  const tokenData = JSON.parse(resp.getContentText());
  if (!tokenData.access_token) {
    throw new Error('Error al obtener token SA: ' + resp.getContentText());
  }

  cache.put(cacheKey, tokenData.access_token, 3300);
  return tokenData.access_token;
}

/**
 * Ejecuta una llamada a la API de Sheets reintentando si Google responde 429
 * (cuota de lecturas por minuto agotada). Espera el resto de la ventana de
 * un minuto antes de reintentar — reintentar rápido solo empeora el atasco.
 * Silencioso para el usuario: pasa dentro de una misma ejecución de GAS.
 */
function fetchSheetsConReintento429_(url, options) {
  const ESPERAS_MS = [5000, 15000, 30000]; // hasta 3 reintentos, ventana de 1 min
  for (let intento = 0; intento <= ESPERAS_MS.length; intento++) {
    const resp = UrlFetchApp.fetch(url, options);
    const data = JSON.parse(resp.getContentText());
    if (data.error && data.error.status === 'RESOURCE_EXHAUSTED' && intento < ESPERAS_MS.length) {
      console.warn('Sheets 429 — reintentando en ' + ESPERAS_MS[intento] + 'ms (intento ' + (intento + 1) + ')');
      Utilities.sleep(ESPERAS_MS[intento]);
      continue;
    }
    return data;
  }
}

function sheetsRead_(spreadsheetId, range) {
  const token = getServiceAccountToken_(['https://www.googleapis.com/auth/spreadsheets']);
  const url   = 'https://sheets.googleapis.com/v4/spreadsheets/'
              + encodeURIComponent(spreadsheetId)
              + '/values/'
              + encodeURIComponent(range);
  const data = fetchSheetsConReintento429_(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (data.error) throw new Error('sheetsRead_: ' + JSON.stringify(data.error));
  return data.values || [];
}

/**
 * Lee varios rangos del MISMO spreadsheet en una sola llamada HTTP (batchGet)
 * en vez de una llamada por rango — reduce la cantidad de viajes de ida y
 * vuelta a la API de Sheets cuando hay que leer varias pestañas juntas.
 * @returns {Array<Array<Array>>} un array de "values" (mismo formato que
 *          sheetsRead_), en el mismo orden que los rangos pedidos.
 */
function sheetsBatchRead_(spreadsheetId, ranges) {
  const token = getServiceAccountToken_(['https://www.googleapis.com/auth/spreadsheets']);
  const query = ranges.map(function(r) { return 'ranges=' + encodeURIComponent(r); }).join('&');
  const url   = 'https://sheets.googleapis.com/v4/spreadsheets/'
              + encodeURIComponent(spreadsheetId)
              + '/values:batchGet?' + query;
  const data = fetchSheetsConReintento429_(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (data.error) throw new Error('sheetsBatchRead_: ' + JSON.stringify(data.error));
  return (data.valueRanges || []).map(function(vr) { return vr.values || []; });
}

/**
 * Devuelve el nombre de la primera pestaña de un spreadsheet (cacheado 6h).
 * Evita hardcodear el nombre de una pestaña que alguien puede renombrar.
 */
function sheetsPrimeraHoja_(spreadsheetId) {
  const cache    = CacheService.getScriptCache();
  const cacheKey = 'TAB0_' + spreadsheetId;
  const cached   = cache.get(cacheKey);
  if (cached) return cached;

  const token = getServiceAccountToken_(['https://www.googleapis.com/auth/spreadsheets']);
  const url   = 'https://sheets.googleapis.com/v4/spreadsheets/'
              + encodeURIComponent(spreadsheetId)
              + '?fields=sheets.properties(title)';
  const resp  = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  const data = JSON.parse(resp.getContentText());
  if (data.error) throw new Error('sheetsPrimeraHoja_: ' + JSON.stringify(data.error));
  const titulo = data.sheets[0].properties.title;
  cache.put(cacheKey, titulo, 21600);
  return titulo;
}

function sheetsWrite_(spreadsheetId, range, values) {
  const token = getServiceAccountToken_(['https://www.googleapis.com/auth/spreadsheets']);
  const url   = 'https://sheets.googleapis.com/v4/spreadsheets/'
              + encodeURIComponent(spreadsheetId)
              + '/values/'
              + encodeURIComponent(range)
              + '?valueInputOption=RAW';
  const resp  = UrlFetchApp.fetch(url, {
    method:      'put',
    contentType: 'application/json',
    headers:     { Authorization: 'Bearer ' + token },
    payload:     JSON.stringify({ values: values }),
    muteHttpExceptions: true
  });
  const data = JSON.parse(resp.getContentText());
  if (data.error) throw new Error('sheetsWrite_: ' + JSON.stringify(data.error));
  return data;
}

function sheetsClear_(spreadsheetId, range) {
  const token = getServiceAccountToken_(['https://www.googleapis.com/auth/spreadsheets']);
  const url   = 'https://sheets.googleapis.com/v4/spreadsheets/'
              + encodeURIComponent(spreadsheetId)
              + '/values/'
              + encodeURIComponent(range)
              + ':clear';
  const resp  = UrlFetchApp.fetch(url, {
    method:      'post',
    headers:     { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  const data = JSON.parse(resp.getContentText());
  if (data.error) throw new Error('sheetsClear_: ' + JSON.stringify(data.error));
  return data;
}

function sheetsAppend_(spreadsheetId, range, values) {
  const token = getServiceAccountToken_(['https://www.googleapis.com/auth/spreadsheets']);
  const url   = 'https://sheets.googleapis.com/v4/spreadsheets/'
              + encodeURIComponent(spreadsheetId)
              + '/values/'
              + encodeURIComponent(range)
              + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
  const resp  = UrlFetchApp.fetch(url, {
    method:      'post',
    contentType: 'application/json',
    headers:     { Authorization: 'Bearer ' + token },
    payload:     JSON.stringify({ values: values }),
    muteHttpExceptions: true
  });
  const data = JSON.parse(resp.getContentText());
  if (data.error) throw new Error('sheetsAppend_: ' + JSON.stringify(data.error));
  return data;
}

/**
 * Sube un objeto como archivo JSON a Drive, compartido "cualquiera con el
 * link", y devuelve su URL de descarga directa. Se usa para entregar datos
 * grandes/lentos de generar sin pasar por la respuesta de doPost — esas
 * respuestas fallan de forma intermitente en la capa de entrega interna de
 * Apps Script (script.googleusercontent.com/macros/echo devuelve 404 aunque
 * la ejecución haya terminado bien), mientras que un archivo de Drive se
 * sirve por una vía mucho más robusta. Si ya existe un archivo con el mismo
 * nombre en la carpeta, lo reemplaza (evita acumular basura).
 * @returns {string} URL de descarga directa
 */
function driveSubirJsonPublico_(nombre, objeto, folderId) {
  const folder     = DriveApp.getFolderById(folderId);
  const existentes = folder.getFilesByName(nombre);
  while (existentes.hasNext()) { existentes.next().setTrashed(true); }

  const blob    = Utilities.newBlob(JSON.stringify(objeto), 'application/json', nombre);
  const archivo = folder.createFile(blob);

  // NOTA: no llamamos a archivo.setSharing() acá — una política de Google
  // Workspace bloquea que un script cambie permisos de "compartir"
  // (confirmado: "Acceso denegado" tanto para ANYONE_WITH_LINK como para
  // DOMAIN_WITH_LINK, incluso corriendo manualmente). El archivo hereda el
  // permiso de la CARPETA en la que se crea — esa carpeta hay que
  // compartirla una sola vez a mano, desde la interfaz de Drive.

  return 'https://drive.google.com/uc?export=download&id=' + archivo.getId();
}

/**
 * Sube un archivo XLSX a Google Drive usando DriveApp nativo.
 * Usa permisos del dueño del script (no de la SA) para evitar el error 403
 * "Service Accounts do not have storage quota".
 * @returns {{ id: string, webViewLink: string }}
 */
function driveUploadFile_(nombre, base64, folderId) {
  try {
    const bytes   = Utilities.base64Decode(base64);
    const blob    = Utilities.newBlob(
      bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      nombre
    );
    const folder  = DriveApp.getFolderById(folderId);
    const archivo = folder.createFile(blob);
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return {
      id:          archivo.getId(),
      webViewLink: archivo.getUrl()
    };
  } catch(e) {
    throw new Error('driveUploadFile_: ' + e.message);
  }
}
