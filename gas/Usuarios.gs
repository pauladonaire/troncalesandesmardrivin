// ============================================================
// ARCHIVO GAS: Usuarios.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Usuarios" y pegar este contenido
// ============================================================

/**
 * Retorna todos los usuarios sin exponer password_hash ni salt.
 */
function getUsuarios(token) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  if (session.rol !== 'ADMIN_GENERAL') throw new Error('Sin permisos para esta operación');

  const rows = sheetsRead_(CONFIG.SHEETS.USUARIOS.id, CONFIG.SHEETS.USUARIOS.tab);
  if (rows.length < 2) return [];

  return rows.slice(1).map(function(r) {
    return {
      email:            r[0] || '',
      nombre_completo:  r[1] || '',
      rol:              r[4] || '',
      activo:           String(r[5]).toLowerCase() === 'true' || r[5] === 'TRUE',
      fecha_creacion:   r[6] || '',
      fecha_modificacion: r[7] || ''
    };
  });
}

/**
 * Crea un nuevo usuario.
 */
function createUsuario(token, datos) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  if (session.rol !== 'ADMIN_GENERAL') throw new Error('Sin permisos para esta operación');

  const { email, nombre_completo, password, rol } = datos;
  if (!email || !nombre_completo || !password || !rol) {
    return { ok: false, error: 'Todos los campos son obligatorios' };
  }

  try {
    const rows = sheetsRead_(CONFIG.SHEETS.USUARIOS.id, CONFIG.SHEETS.USUARIOS.tab);
    const existe = rows.slice(1).some(function(r) { return r[0] === email; });
    if (existe) return { ok: false, error: 'Ya existe un usuario con ese email' };

    const salt = generateSalt_();
    const hash = hashPassword_(password, salt);
    const now  = new Date().toISOString();

    sheetsAppend_(
      CONFIG.SHEETS.USUARIOS.id,
      CONFIG.SHEETS.USUARIOS.tab,
      [[email, nombre_completo, hash, salt, rol, 'TRUE', now, now]]
    );
    return { ok: true };
  } catch(e) {
    console.error('createUsuario error: ' + e.message);
    return { ok: false, error: 'Error al crear el usuario' };
  }
}

/**
 * Actualiza nombre y rol de un usuario.
 */
function updateUsuario(token, emailTarget, datos) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  if (session.rol !== 'ADMIN_GENERAL') throw new Error('Sin permisos para esta operación');

  try {
    const rows     = sheetsRead_(CONFIG.SHEETS.USUARIOS.id, CONFIG.SHEETS.USUARIOS.tab);
    const dataRows = rows.slice(1);
    const idx      = dataRows.findIndex(function(r) { return r[0] === emailTarget; });
    if (idx === -1) return { ok: false, error: 'Usuario no encontrado' };

    const sheetRow = idx + 2;
    const now      = new Date().toISOString();

    if (datos.nombre_completo) {
      sheetsWrite_(CONFIG.SHEETS.USUARIOS.id,
        CONFIG.SHEETS.USUARIOS.tab + '!B' + sheetRow, [[datos.nombre_completo]]);
    }
    if (datos.rol) {
      sheetsWrite_(CONFIG.SHEETS.USUARIOS.id,
        CONFIG.SHEETS.USUARIOS.tab + '!E' + sheetRow, [[datos.rol]]);
    }
    sheetsWrite_(CONFIG.SHEETS.USUARIOS.id,
      CONFIG.SHEETS.USUARIOS.tab + '!H' + sheetRow, [[now]]);

    return { ok: true };
  } catch(e) {
    console.error('updateUsuario error: ' + e.message);
    return { ok: false, error: 'Error al actualizar el usuario' };
  }
}

/**
 * Activa o desactiva un usuario.
 */
function toggleUsuarioActivo(token, emailTarget, activo) {
  const session = validateSession(token);
  if (!session) throw new Error('Sesión inválida o expirada');
  if (session.rol !== 'ADMIN_GENERAL') throw new Error('Sin permisos para esta operación');

  try {
    const rows     = sheetsRead_(CONFIG.SHEETS.USUARIOS.id, CONFIG.SHEETS.USUARIOS.tab);
    const dataRows = rows.slice(1);
    const idx      = dataRows.findIndex(function(r) { return r[0] === emailTarget; });
    if (idx === -1) return { ok: false, error: 'Usuario no encontrado' };

    const sheetRow = idx + 2;
    const now      = new Date().toISOString();

    sheetsWrite_(CONFIG.SHEETS.USUARIOS.id,
      CONFIG.SHEETS.USUARIOS.tab + '!F' + sheetRow, [[activo ? 'TRUE' : 'FALSE']]);
    sheetsWrite_(CONFIG.SHEETS.USUARIOS.id,
      CONFIG.SHEETS.USUARIOS.tab + '!H' + sheetRow, [[now]]);

    return { ok: true };
  } catch(e) {
    console.error('toggleUsuarioActivo error: ' + e.message);
    return { ok: false, error: 'Error al cambiar estado del usuario' };
  }
}
