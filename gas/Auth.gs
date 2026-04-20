// ============================================================
// ARCHIVO GAS: Auth.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Auth" y pegar este contenido
// ============================================================

// Columnas del Sheet UsuariosTroncales (índice 0)
// A:email | B:nombre_completo | C:password_hash | D:salt | E:rol | F:activo | G:fecha_creacion | H:fecha_modificacion

function hashPassword_(password, salt) {
  const input = password + salt;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return bytes.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function generateSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/**
 * Autentica un usuario y crea una sesión.
 * @returns {{ ok: boolean, token?: string, usuario?: object, error?: string }}
 */
function login(email, password) {
  try {
    const rows = sheetsRead_(CONFIG.SHEETS.USUARIOS.id, CONFIG.SHEETS.USUARIOS.tab);
    if (rows.length < 2) return { ok: false, error: 'Credenciales incorrectas' };

    const dataRows = rows.slice(1);
    const userRow  = dataRows.find(function(r) { return r[0] === email; });
    if (!userRow) return { ok: false, error: 'Credenciales incorrectas' };

    const activo = userRow[5];
    if (activo !== 'TRUE' && activo !== true && String(activo).toLowerCase() !== 'true') {
      return { ok: false, error: 'Usuario inactivo. Contactar al administrador.' };
    }

    const storedHash = userRow[2] || '';
    const salt       = userRow[3] || '';
    const inputHash  = hashPassword_(password, salt);
    if (inputHash !== storedHash) return { ok: false, error: 'Credenciales incorrectas' };

    const token         = Utilities.getUuid();
    const nombreCompleto = userRow[1] || '';
    const rol            = userRow[4] || 'OPERACION_TRAFICO';
    const partes         = nombreCompleto.trim().split(/\s+/);
    const iniciales      = ((partes[0] ? partes[0][0] : '') + (partes[1] ? partes[1][0] : '')).toUpperCase();

    const sessionData = {
      email:           email,
      nombre_completo: nombreCompleto,
      rol:             rol,
      iniciales:       iniciales,
      expiry:          Date.now() + CONFIG.SESSION_DURATION_HOURS * 3600 * 1000
    };
    PropertiesService.getScriptProperties().setProperty('SESSION_' + token, JSON.stringify(sessionData));

    return {
      ok: true,
      token: token,
      usuario: {
        email:           email,
        nombre_completo: nombreCompleto,
        rol:             rol,
        iniciales:       iniciales
      }
    };
  } catch(e) {
    console.error('login error: ' + e.message);
    return { ok: false, error: 'Error interno. Intentar nuevamente.' };
  }
}

/**
 * Valida un token de sesión.
 * @returns {object|null} Datos del usuario o null si la sesión es inválida/expirada
 */
function validateSession(token) {
  if (!token) return null;
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('SESSION_' + token);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() > session.expiry) {
      PropertiesService.getScriptProperties().deleteProperty('SESSION_' + token);
      return null;
    }
    return session;
  } catch(e) {
    return null;
  }
}

/**
 * Elimina la sesión del usuario.
 */
function logout(token) {
  if (!token) return;
  PropertiesService.getScriptProperties().deleteProperty('SESSION_' + token);
}

/**
 * Cambia la contraseña de un usuario autenticado.
 * @returns {{ ok: boolean, error?: string }}
 */
function changePassword(token, passwordActual, passwordNuevo) {
  const session = validateSession(token);
  if (!session) return { ok: false, error: 'Sesión inválida o expirada' };

  try {
    const rows = sheetsRead_(CONFIG.SHEETS.USUARIOS.id, CONFIG.SHEETS.USUARIOS.tab);
    if (rows.length < 2) return { ok: false, error: 'Usuario no encontrado' };

    const dataRows = rows.slice(1);
    const idx      = dataRows.findIndex(function(r) { return r[0] === session.email; });
    if (idx === -1) return { ok: false, error: 'Usuario no encontrado' };

    const userRow    = dataRows[idx];
    const storedHash = userRow[2] || '';
    const salt       = userRow[3] || '';

    if (hashPassword_(passwordActual, salt) !== storedHash) {
      return { ok: false, error: 'La contraseña actual es incorrecta' };
    }

    const nuevoSalt = generateSalt_();
    const nuevoHash = hashPassword_(passwordNuevo, nuevoSalt);
    const sheetRow  = idx + 2; // +1 por header, +1 por base 1

    sheetsWrite_(
      CONFIG.SHEETS.USUARIOS.id,
      CONFIG.SHEETS.USUARIOS.tab + '!C' + sheetRow + ':D' + sheetRow,
      [[nuevoHash, nuevoSalt]]
    );
    sheetsWrite_(
      CONFIG.SHEETS.USUARIOS.id,
      CONFIG.SHEETS.USUARIOS.tab + '!H' + sheetRow,
      [[new Date().toISOString()]]
    );

    return { ok: true };
  } catch(e) {
    console.error('changePassword error: ' + e.message);
    return { ok: false, error: 'Error al cambiar la contraseña' };
  }
}
