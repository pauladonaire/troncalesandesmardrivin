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

function sheetsRead_(spreadsheetId, range) {
  const token = getServiceAccountToken_(['https://www.googleapis.com/auth/spreadsheets']);
  const url   = 'https://sheets.googleapis.com/v4/spreadsheets/'
              + encodeURIComponent(spreadsheetId)
              + '/values/'
              + encodeURIComponent(range);
  const resp  = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  const data = JSON.parse(resp.getContentText());
  if (data.error) throw new Error('sheetsRead_: ' + JSON.stringify(data.error));
  return data.values || [];
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
 * Sube un archivo XLSX a Google Drive via multipart upload.
 * @returns {{ id: string, webViewLink: string }}
 */
function driveUploadFile_(nombre, base64, folderId) {
  const token    = getServiceAccountToken_(['https://www.googleapis.com/auth/drive']);
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const boundary = 'troncales_' + Utilities.getUuid().replace(/-/g, '');
  const metadata = JSON.stringify({ name: nombre, parents: [folderId] });

  const body = '--' + boundary + '\r\n'
             + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
             + metadata + '\r\n'
             + '--' + boundary + '\r\n'
             + 'Content-Type: ' + mimeType + '\r\n'
             + 'Content-Transfer-Encoding: base64\r\n\r\n'
             + base64 + '\r\n'
             + '--' + boundary + '--';

  const resp = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method:      'post',
      contentType: 'multipart/related; boundary=' + boundary,
      headers:     { Authorization: 'Bearer ' + token },
      payload:     body,
      muteHttpExceptions: true
    }
  );

  const data = JSON.parse(resp.getContentText());
  if (data.error) throw new Error('driveUploadFile_: ' + JSON.stringify(data.error));
  return data;
}
