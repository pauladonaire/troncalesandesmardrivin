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
// esquemas de costo/ingreso) son lentos de generar (varias lecturas a Sheets).
// Cualquier respuesta de Apps Script que tarde más de 1-2s en generarse falla
// de forma intermitente en la capa de entrega interna de Google
// (script.googleusercontent.com/macros/echo devuelve 404 aunque la ejecución
// haya terminado bien) — sin importar qué tan chica sea esa respuesta. Y el
// archivo de Drive que probamos como alternativa tampoco sirve: su link de
// descarga no manda headers CORS, así que el navegador bloquea leerlo con
// fetch() aunque el archivo esté público. Por eso los datos van directo en
// celdas de una planilla (partidos, porque una celda admite ~50.000
// caracteres) — el export CSV de Sheets sí manda CORS correctamente.
const DATOS_MAESTROS_CSV_URL = 'https://docs.google.com/spreadsheets/d/1CcAOABZiFXyLr_0-RUXYQVGKFrgDHsIYQc_vu6jzpRs/export?format=csv&gid=0';

function reconstruirJsonDesdeCsv_(csvTexto) {
  // Cada línea es UNA celda (una sola columna) — puede venir entre comillas
  // con comillas internas duplicadas (escape RFC4180) porque el JSON tiene
  // muchas comillas propias. Se saca el wrapping y se desduplican, y se
  // concatenan las líneas en orden para reconstruir el JSON completo.
  const lineas = csvTexto.split('\n');
  let resultado = '';
  for (let linea of lineas) {
    linea = linea.replace(/\r$/, '');
    if (linea === '') continue;
    if (linea.charAt(0) === '"' && linea.charAt(linea.length - 1) === '"') {
      linea = linea.slice(1, -1).replace(/""/g, '"');
    }
    resultado += linea;
  }
  return resultado;
}

async function gasCallDatosMaestros(onProgreso) {
  if (onProgreso) onProgreso('Preparando datos maestros...');

  // No importa si esta respuesta llega bien al navegador — solo dispara la
  // regeneración del lado de GAS si hace falta. Los datos en sí se leen
  // siempre de la planilla, más abajo.
  try { await gasCall('asegurarDatosMaestrosFrescos'); } catch (e) { /* seguimos igual */ }

  if (onProgreso) onProgreso('Descargando datos maestros...');

  for (let intento = 0; intento < 40; intento++) { // hasta ~2 minutos de espera
    try {
      const csvRes = await fetch(DATOS_MAESTROS_CSV_URL + '&_=' + Date.now(), { cache: 'no-store' });
      if (csvRes.ok) {
        const jsonTexto = reconstruirJsonDesdeCsv_(await csvRes.text());
        if (jsonTexto) {
          try {
            const datos = JSON.parse(jsonTexto);
            return Object.assign({ ok: true }, datos);
          } catch (eParse) { /* todavía no terminó de escribirse, reintentar */ }
        }
      }
    } catch (e) { /* reintentar */ }
    await esperar_(3000);
  }

  return { ok: false, error: 'Los datos maestros están tardando demasiado en prepararse. Probá de nuevo en un momento.' };
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
