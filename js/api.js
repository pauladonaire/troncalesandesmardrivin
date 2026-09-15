// api.js — Wrapper fetch hacia GAS Web App + utilidades de sesión

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxqymlzy5_IUBkgXEDIppgg7QG4kNzrlmlGqriiFbBoWJPookVJMHnSSt-JCyVGDx8AFg/exec';  // reemplazar con la URL real al deployar

// Códigos de error transitorios (cuota de ejecuciones simultáneas de Apps Script,
// caídas puntuales de la infraestructura de Google, etc.) — vale la pena reintentar.
const GAS_STATUS_REINTENTABLES = [404, 429, 500, 502, 503, 504];
const GAS_MAX_REINTENTOS       = 2;   // total: 1 intento inicial + 2 reintentos
const GAS_ESPERA_BASE_MS       = 1000;
const GAS_TIMEOUT_MS           = 30000; // corta la espera si Google no responde nada

function esperar_(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function gasCall(action, params = {}) {
  const token = getToken();
  const body  = JSON.stringify({ action, token, ...params });

  let ultimoError;
  for (let intento = 0; intento <= GAS_MAX_REINTENTOS; intento++) {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);
    try {
      const res = await fetch(GAS_URL, {
        method:  'POST',
        body,
        headers: { 'Content-Type': 'text/plain' },
        // text/plain evita el preflight CORS en GAS
        signal:  controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        if (GAS_STATUS_REINTENTABLES.includes(res.status) && intento < GAS_MAX_REINTENTOS) {
          await esperar_(GAS_ESPERA_BASE_MS * (intento + 1));
          continue;
        }
        throw new Error('Error de red: ' + res.status);
      }
      return await res.json();
    } catch (e) {
      clearTimeout(timeoutId);
      ultimoError = e.name === 'AbortError' ? new Error('Tiempo de espera agotado (30s) — Google no respondió.') : e;
      if (intento < GAS_MAX_REINTENTOS) {
        await esperar_(GAS_ESPERA_BASE_MS * (intento + 1));
        continue;
      }
    }
  }
  throw ultimoError;
}

// getDatosMaestros devuelve TODO junto (direcciones, tripulantes, flota, socios,
// rutas, arrastres, esquemas de costo/ingreso) en una sola respuesta — se volvió
// demasiado grande para que Apps Script la entregue de forma confiable a través
// del endpoint interno de googleusercontent.com (ni partida en 2 alcanzó). Se
// pide de a una parte por vez (secuencial, no en paralelo, para no exigir de más
// a la cuota de ejecuciones de Apps Script) y se combina acá — más lento, pero
// cada pedido es del mismo tamaño que getDatosRutas/getDatosArrastres, que sí
// funcionan siempre.
const GAS_PARTES_DATOS_MAESTROS = [
  'getParteDirecciones', 'getParteTripulantes', 'getParteFlota', 'getParteSocios',
  'getParteRutas', 'getParteArrastres', 'getParteEsquemasCostos', 'getParteEsquemasIngresos'
];

async function gasCallDatosMaestros(onProgreso) {
  const combinado = { ok: true };
  for (let i = 0; i < GAS_PARTES_DATOS_MAESTROS.length; i++) {
    const accion = GAS_PARTES_DATOS_MAESTROS[i];
    if (onProgreso) onProgreso(i + 1, GAS_PARTES_DATOS_MAESTROS.length);
    const parte = await gasCall(accion);
    if (parte && parte.ok === false) return parte;
    Object.assign(combinado, parte);
  }
  return combinado;
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
