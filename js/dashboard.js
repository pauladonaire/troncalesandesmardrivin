// dashboard.js

let SESSION = null;

document.addEventListener('DOMContentLoaded', () => {
  SESSION = requireSession();
  if (!SESSION) return;

  document.getElementById('userName').textContent   = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;

  const isAdmin  = ['ADMIN_GENERAL', 'ADMIN_TRAFICO'].includes(SESSION.rol);
  const isSuperAdmin = SESSION.rol === 'ADMIN_GENERAL';

  if (isAdmin)     document.getElementById('navActualizar').style.display = 'flex';
  if (isSuperAdmin) document.getElementById('navAdmin').style.display     = 'flex';
  if (isAdmin)     document.getElementById('navRutas').style.display      = 'flex';
  if (isAdmin)     document.getElementById('navArrastres').style.display  = 'flex';
  if (!isAdmin)    document.getElementById('secActualizar').style.display = 'none';

  document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword);
});

// ── Sync handlers ──

async function syncDatos(action, label, resultEl, btn) {
  setLoading(btn, true);
  resultEl.textContent = '';
  resultEl.className   = 'sync-result';
  try {
    const res = await gasCall(action);
    if (res.ok) {
      resultEl.textContent = `✓ ${res.count} registros`;
      resultEl.classList.add('text-success');
    } else {
      resultEl.textContent = '✗ ' + (res.error || 'Error');
      resultEl.classList.add('text-danger');
    }
  } catch (e) {
    resultEl.textContent = '✗ Sin conexión';
    resultEl.classList.add('text-danger');
  } finally {
    setLoading(btn, false);
  }
}

function syncDirecciones() {
  syncDatos('syncManualDirecciones', 'Direcciones',
    document.getElementById('resDirecciones'),
    document.getElementById('btnSyncDir'));
}
function syncConductores() {
  syncDatos('syncManualTripulantes', 'Conductores',
    document.getElementById('resConductores'),
    document.getElementById('btnSyncCond'));
}
function syncVehiculos() {
  syncDatos('syncManualFlota', 'Vehículos',
    document.getElementById('resVehiculos'),
    document.getElementById('btnSyncVeh'));
}
function syncSocios() {
  syncDatos('syncManualSocios', 'Socios',
    document.getElementById('resSocios'),
    document.getElementById('btnSyncSoc'));
}

// ── Cambiar contraseña ──

async function handleChangePassword(e) {
  e.preventDefault();
  const actual   = document.getElementById('passActual').value;
  const nuevo    = document.getElementById('passNuevo').value;
  const confirma = document.getElementById('passConfirma').value;
  const btn      = document.getElementById('btnChangePass');
  const msgEl    = document.getElementById('changePwMsg');

  msgEl.textContent = '';
  msgEl.className   = '';

  if (nuevo !== confirma) {
    msgEl.textContent = 'Las contraseñas nuevas no coinciden.';
    msgEl.className   = 'error-msg';
    return;
  }
  if (nuevo.length < 6) {
    msgEl.textContent = 'La contraseña nueva debe tener al menos 6 caracteres.';
    msgEl.className   = 'error-msg';
    return;
  }

  setLoading(btn, true);
  try {
    const res = await gasCall('changePassword', { passwordActual: actual, passwordNuevo: nuevo });
    if (res.ok) {
      msgEl.textContent = '✓ Contraseña actualizada correctamente.';
      msgEl.className   = 'success-msg';
      e.target.reset();
    } else {
      msgEl.textContent = res.error || 'No se pudo cambiar la contraseña.';
      msgEl.className   = 'error-msg';
    }
  } catch (err) {
    msgEl.textContent = 'Error de conexión.';
    msgEl.className   = 'error-msg';
  } finally {
    setLoading(btn, false);
  }
}
