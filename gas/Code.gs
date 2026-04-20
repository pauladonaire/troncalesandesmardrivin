// ============================================================
// ARCHIVO GAS: Code.gs
// Entry point de la Web App — recibe todas las llamadas del frontend via doPost
// ============================================================

function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action;
    const token  = data.token || null;

    const routes = {
      'login':                 () => login(data.email, data.password),
      'logout':                () => logout(token),
      'changePassword':        () => changePassword(token, data.passwordActual, data.passwordNuevo),
      'getDatosMaestros':      () => getDatosMaestros(token),
      'syncManualDirecciones': () => syncManualDirecciones(token),
      'syncManualTripulantes': () => syncManualTripulantes(token),
      'syncManualFlota':       () => syncManualFlota(token),
      'syncManualSocios':      () => syncManualSocios(token),
      'crearPlanDrivin':       () => crearPlanDrivin(token, data.planDatos),
      'subirExcelADrive':      () => subirExcelADrive(token, data.base64, data.nombreArchivo, data.viajes, data.planDatos),
      'getUsuarios':           () => getUsuarios(token),
      'createUsuario':         () => createUsuario(token, data.usuario),
      'updateUsuario':         () => updateUsuario(token, data.emailTarget, data.datos),
      'toggleUsuarioActivo':   () => toggleUsuarioActivo(token, data.emailTarget, data.activo),
      'addRutaMaestra':        () => addRutaMaestra(token, data.datos),
      'addArrastre':           () => addArrastre(token, data.datos),
    };

    const handler = routes[action];
    if (!handler) return jsonResponse({ ok: false, error: 'Acción no encontrada: ' + action });
    return jsonResponse(handler());

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doGet(e) {
  return jsonResponse({ ok: true, message: 'Troncales API funcionando' });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
