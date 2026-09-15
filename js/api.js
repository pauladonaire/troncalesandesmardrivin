// api.js — Wrapper fetch hacia GAS Web App + utilidades de sesión

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxe5WUMBLMOYhw-zdYOqE74Vd_6ZktHfrslEXpBgSxdmDpzfvcdhMy-3BlFZvDRx5IIjg/exec';  // deployment nuevo (el anterior venía acumulando fallas de entrega tras 43 versiones)

// Códigos de error transitorios (cuota de ejecuciones simultáneas de Apps Script,
// caídas puntuales de la infraestructura de Google, etc.) — vale la pena reintentar.
const GAS_STATUS_REINTENTABLES = [404, 429, 500, 502, 503, 504];
const GAS_MAX_REINTENTOS       = 2;   // total: 1 intento inicial + 2 reintentos
const GAS_ESPERA_BASE_MS       = 1000;
const GAS_TIMEOUT_MS           = 90000; // corta la espera si Google no responde nada
// 90s: la primera lectura en frío de datos maestros (8 sheets) puede tardar bastante
// más que 30s. Con 2 reintentos, el peor caso ronda los 4-5 minutos — mucho, pero
// preferible a cortar la conexión justo antes de que Google termine de responder.

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
          // 429 = cuota de Sheets agotada por minuto — esperar el resto del minuto,
          // no unos pocos segundos, porque reintentar rápido solo empeora el atasco.
          const espera = res.status === 429 ? 20000 * (intento + 1) : GAS_ESPERA_BASE_MS * (intento + 1);
          await esperar_(espera);
          continue;
        }
        throw new Error('Error de red: ' + res.status);
      }
      return await res.json();
    } catch (e) {
      clearTimeout(timeoutId);
      ultimoError = e.name === 'AbortError' ? new Error('Tiempo de espera agotado (90s) — Google no respondió.') : e;
      if (intento < GAS_MAX_REINTENTOS) {
        await esperar_(GAS_ESPERA_BASE_MS * (intento + 1));
        continue;
      }
    }
  }
  throw ultimoError;
}

// Los datos maestros (direcciones, tripulantes, flota, socios, rutas, arrastres,
// esquemas de costo/ingreso) son demasiado grandes/lentos de generar como para
// que Apps Script los entregue de forma confiable en la respuesta de doPost —
// esas respuestas fallan de forma intermitente en la capa de entrega interna
// de Google (script.googleusercontent.com/macros/echo devuelve 404 aunque la
// ejecución haya terminado bien), sin importar cuánto se las divida.
// En cambio: le pedimos a GAS un link de descarga (respuesta minúscula, rápida,
// nunca pisa ese problema) y bajamos el archivo real directo desde Drive.
async function gasCallDatosMaestros(onProgreso) {
  if (onProgreso) onProgreso('Preparando datos maestros...');
  const resp = await gasCall('getUrlDatosMaestros');
  if (resp && resp.ok === false) return resp;

  if (onProgreso) onProgreso('Descargando datos maestros...');
  const res = await fetch(resp.url, { cache: 'no-store' });
  if (!res.ok) {
    return { ok: false, error: 'No se pudo descargar el archivo de datos maestros (' + res.status + ')' };
  }
  const datos = await res.json();
  return Object.assign({ ok: true }, datos);
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
