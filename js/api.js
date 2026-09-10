// api.js — Wrapper fetch hacia GAS Web App + utilidades de sesión

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxqymlzy5_IUBkgXEDIppgg7QG4kNzrlmlGqriiFbBoWJPookVJMHnSSt-JCyVGDx8AFg/exec';  // reemplazar con la URL real al deployar

// Códigos de error transitorios (cuota de ejecuciones simultáneas de Apps Script,
// caídas puntuales de la infraestructura de Google, etc.) — vale la pena reintentar.
const GAS_STATUS_REINTENTABLES = [404, 429, 500, 502, 503, 504];
const GAS_MAX_REINTENTOS       = 2;   // total: 1 intento inicial + 2 reintentos
const GAS_ESPERA_BASE_MS       = 1000;

function esperar_(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function gasCall(action, params = {}) {
  const token = getToken();
  const body  = JSON.stringify({ action, token, ...params });

  let ultimoError;
  for (let intento = 0; intento <= GAS_MAX_REINTENTOS; intento++) {
    try {
      const res = await fetch(GAS_URL, {
        method:  'POST',
        body,
        headers: { 'Content-Type': 'text/plain' }
        // text/plain evita el preflight CORS en GAS
      });
      if (!res.ok) {
        if (GAS_STATUS_REINTENTABLES.includes(res.status) && intento < GAS_MAX_REINTENTOS) {
          await esperar_(GAS_ESPERA_BASE_MS * (intento + 1));
          continue;
        }
        throw new Error('Error de red: ' + res.status);
      }
      return await res.json();
    } catch (e) {
      ultimoError = e;
      if (intento < GAS_MAX_REINTENTOS) {
        await esperar_(GAS_ESPERA_BASE_MS * (intento + 1));
        continue;
      }
    }
  }
  throw ultimoError;
}

function getToken()   { return localStorage.getItem('troncales_token'); }
function getSession() { return JSON.parse(localStorage.getItem('troncales_session') || 'null'); }

function saveSession(token, usuario) {
  localStorage.setItem('troncales_token', token);
  localStorage.setItem('troncales_session', JSON.stringify(usuario));
}

function clearSession() {
  localStorage.removeItem('troncales_token');
  localStorage.removeItem('troncales_session');
}

function requireSession() {
  const session = getSession();
  if (!session || !getToken()) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

function requireRole(rolesPermitidos) {
  const session = requireSession();
  if (!session) return null;
  if (!rolesPermitidos.includes(session.rol)) {
    window.location.href = 'dashboard.html';
    return null;
  }
  return session;
}

function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>';
  } else {
    btn.disabled  = false;
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}

async function handleLogout() {
  const token = getToken();
  if (token) {
    try { await gasCall('logout'); } catch (e) { /* ignorar errores de red al cerrar sesión */ }
  }
  clearSession();
  window.location.href = 'index.html';
}
