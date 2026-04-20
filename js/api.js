// api.js — Wrapper fetch hacia GAS Web App + utilidades de sesión

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxqymlzy5_IUBkgXEDIppgg7QG4kNzrlmlGqriiFbBoWJPookVJMHnSSt-JCyVGDx8AFg/exec';  // reemplazar con la URL real al deployar

async function gasCall(action, params = {}) {
  const token = getToken();
  const body  = JSON.stringify({ action, token, ...params });
  const res   = await fetch(GAS_URL, {
    method:  'POST',
    body,
    headers: { 'Content-Type': 'text/plain' }
    // text/plain evita el preflight CORS en GAS
  });
  if (!res.ok) throw new Error('Error de red: ' + res.status);
  return res.json();
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
