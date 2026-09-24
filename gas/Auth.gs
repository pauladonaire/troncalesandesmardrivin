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
    guardarSesion_(token, sessionData);

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

// Las sesiones se guardan en CacheService (no en Propiedades del Script):
// se autolimpian solas al vencer, sin acumular nada para siempre. El tope
// de CacheService es 6 horas, así que en validateSession() renovamos el TTL
// en cada request válido para sostener las SESSION_DURATION_HOURS (8h)
// reales mientras el usuario esté activo; si queda inactivo más de 6h, se
// desloguea un poco antes de esas 8h — caso de borde aceptable.
const SESSION_CACHE_TTL_SEG_ = 6 * 60 * 60;

function guardarSesion_(token, sessionData) {
  CacheService.getScriptCache().put('SESSION_' + token, JSON.stringify(sessionData), SESSION_CACHE_TTL_SEG_);
}

/**
 * Valida un token de sesión.
 * @returns {object|null} Datos del usuario o null si la sesión es inválida/expirada
 */
function validateSession(token) {
  if (!token) return null;
  try {
    const cache = CacheService.getScriptCache();
    const raw   = cache.get('SESSION_' + token);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() > session.expiry) {
      cache.remove('SESSION_' + token);
      return null;
    }
    guardarSesion_(token, session); // renueva el TTL del cache mientras esté activa
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
  CacheService.getScriptCache().remove('SESSION_' + token);
}

/**
 * Limpieza única de las sesiones viejas acumuladas en Propiedades del Script
 * (de cuando se guardaban ahí). Ejecutar UNA SOLA VEZ desde el editor para
 * liberar espacio — no rompe nada, como mucho todos tienen que volver a
 * loguearse. Después se puede borrar esta función.
 */
function limpiarSesionesViejas_UNA_VEZ() {
  const props  = PropertiesService.getScriptProperties();
  const claves = Object.keys(props.getProperties()).filter(function(k) { return k.indexOf('SESSION_') === 0; });
  claves.forEach(function(k) { props.deleteProperty(k); });
  console.log('Propiedades SESSION_ eliminadas: ' + claves.length);
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
