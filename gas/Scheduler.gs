// ============================================================
// ARCHIVO GAS: Scheduler.gs  (tipo: Script de Apps Script)
// INSTRUCCIÓN: En el editor de GAS, crear un nuevo archivo de script
//              con el nombre "Scheduler" y pegar este contenido
// ============================================================

/**
 * Configura el disparador diario a las 3 AM.
 * Ejecutar manualmente UNA SOLA VEZ desde el editor GAS.
 */
function setupDailyTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailySync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailySync')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();
  console.log('Disparador diario configurado correctamente.');
}

/**
 * Sincroniza todos los datos desde Driv.in. Se ejecuta automáticamente a las 3 AM.
 */
function dailySync() {
  var errores = [];
  try { syncDirecciones(); } catch(e) { errores.push('Direcciones: ' + e.message); }
  try { syncTripulantes(); } catch(e) { errores.push('Tripulantes: ' + e.message); }
  try { syncFlota();       } catch(e) { errores.push('Flota: ' + e.message); }
  try { syncSocios();      } catch(e) { errores.push('Socios: ' + e.message); }
  try { syncEsquemas();   } catch(e) { errores.push('Esquemas: ' + e.message); }
  if (errores.length > 0) {
    console.error('Errores en dailySync: ' + errores.join(' | '));
  } else {
    console.log('dailySync completado OK — ' + new Date().toISOString());
  }
}
