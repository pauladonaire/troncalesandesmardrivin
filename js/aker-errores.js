// aker-errores.js — Módulo "Errores Aker" (solo ADMIN_GENERAL y ADMIN_TRAFICO)
// Lista los itinerarios cuyo último envío a Aker quedó en error y permite
// reintentarlos. Si la categoría es SERVICIO_NO_ENCONTRADO, exige confirmar
// que la patente ya fue dada de alta en Aker antes de habilitar el reintento
// — reintentar sin eso solo repite el mismo error.

let SESSION = null;
let erroresActuales = [];
let itemEnRetry = null;

const CATEGORIA_INFO = {
  SERVICIO_NO_ENCONTRADO: { label: 'Servicio no encontrado', clase: 'badge-cat-servicio' },
  ERROR_SERVIDOR:         { label: 'Error de servidor',       clase: 'badge-cat-servidor' },
  OTRO:                   { label: 'Otro / validación',       clase: 'badge-cat-otro' }
};

document.addEventListener('DOMContentLoaded', () => {
  SESSION = requireRole(['ADMIN_GENERAL', 'ADMIN_TRAFICO']);
  if (!SESSION) return;

  document.getElementById('userName').textContent    = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;

  cargarErrores();
});

async function cargarErrores() {
  document.getElementById('ak-loader').style.display   = 'flex';
  document.getElementById('ak-error').style.display    = 'none';
  document.getElementById('contenido-ak').style.display = 'none';

  try {
    const res = await gasCall('listarErroresAker');
    if (!res.ok) { mostrarErrorPagina(res.error || 'Error al cargar los errores de Aker'); return; }

    erroresActuales = res.errores || [];
    document.getElementById('ak-loader').style.display    = 'none';
    document.getElementById('contenido-ak').style.display = 'block';

    actualizarKPIs(erroresActuales);
    renderizarTabla(erroresActuales);
  } catch(e) {
    mostrarErrorPagina('Error de conexión: ' + e.message);
  }
}

function mostrarErrorPagina(msg) {
  document.getElementById('ak-loader').style.display = 'none';
  document.getElementById('ak-error').style.display  = 'block';
  document.getElementById('ak-error').textContent    = msg;
}

function actualizarKPIs(errores) {
  document.getElementById('kpi-total').textContent    = errores.length;
  document.getElementById('kpi-servicio').textContent = errores.filter(e => e.categoria === 'SERVICIO_NO_ENCONTRADO').length;
  document.getElementById('kpi-servidor').textContent = errores.filter(e => e.categoria === 'ERROR_SERVIDOR').length;
  document.getElementById('kpi-otro').textContent      = errores.filter(e => e.categoria !== 'SERVICIO_NO_ENCONTRADO' && e.categoria !== 'ERROR_SERVIDOR').length;
}

function renderizarTabla(errores) {
  const tbody = document.getElementById('tbody-ak');
  tbody.innerHTML = '';

  if (errores.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.style.cssText = 'text-align:center;color:var(--color-text-muted);padding:40px;';
    td.textContent = 'No hay itinerarios con errores pendientes 🎉';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    errores.forEach((item, idx) => {
      const info = CATEGORIA_INFO[item.categoria] || CATEGORIA_INFO.OTRO;
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(formatearFechaHora(item.fechaHora)) + '</td>' +
        '<td>' + escapeHtml(item.codigoExterno || '') + '</td>' +
        '<td>' + escapeHtml(item.filaSheet || '') + '</td>' +
        '<td><span class="' + info.clase + '">' + info.label + '</span></td>' +
        '<td>' + escapeHtml(item.patentes || '—') + '</td>' +
        '<td class="celda-mensaje">' + escapeHtml(item.error || '') + '</td>' +
        '<td><button class="btn-reintentar" data-idx="' + idx + '">Reintentar</button></td>';
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-reintentar').forEach(btn => {
      btn.addEventListener('click', () => abrirRetryModal(errores[Number(btn.dataset.idx)]));
    });
  }

  document.getElementById('contador-ak').textContent =
    errores.length === 0 ? 'Sin errores pendientes' : errores.length + ' itinerario(s) pendiente(s) de reintentar';
}

// ── Modal de reintento ──────────────────────────────────────

function abrirRetryModal(item) {
  itemEnRetry = item;
  const info = CATEGORIA_INFO[item.categoria] || CATEGORIA_INFO.OTRO;

  document.getElementById('retryCodigo').textContent       = item.codigoExterno || '';
  document.getElementById('retryFilas').textContent        = item.filaSheet || '';
  document.getElementById('retryCategoriaTxt').textContent = info.label;
  document.getElementById('retryMensaje').textContent      = item.error || '';

  const necesitaConfirmacion = item.categoria === 'SERVICIO_NO_ENCONTRADO';
  document.getElementById('retryConfirmBox').style.display = necesitaConfirmacion ? 'block' : 'none';
  document.getElementById('retryPatentesTxt').textContent   = item.patentes || '';

  const check = document.getElementById('retryCheckConfirma');
  check.checked = false;

  actualizarBotonRetry();
  document.getElementById('modalRetry').classList.add('active');
}

function cerrarRetryModal() {
  document.getElementById('modalRetry').classList.remove('active');
  itemEnRetry = null;
}

function actualizarBotonRetry() {
  const btn = document.getElementById('btnConfirmarRetry');
  if (!itemEnRetry) { btn.disabled = true; return; }
  if (itemEnRetry.categoria === 'SERVICIO_NO_ENCONTRADO') {
    btn.disabled = !document.getElementById('retryCheckConfirma').checked;
  } else {
    btn.disabled = false;
  }
}

async function confirmarRetry() {
  if (!itemEnRetry) return;
  const btn = document.getElementById('btnConfirmarRetry');
  const confirmoServicioCreado = document.getElementById('retryCheckConfirma').checked;

  setLoading(btn, true);
  try {
    const res = await gasCall('reintentarEnvioAker', {
      filaSheet: itemEnRetry.filaSheet,
      categoria: itemEnRetry.categoria,
      confirmoServicioCreado: confirmoServicioCreado
    });

    if (res.ok) {
      mostrarToast('✓ Reintento enviado — ' + (res.codigoExterno || itemEnRetry.codigoExterno) + ' quedó OK en Aker.');
    } else {
      mostrarToast('✗ El reintento volvió a fallar: ' + (res.error || 'ver LogsAker para el detalle'));
    }
  } catch(e) {
    mostrarToast('Error de conexión: ' + e.message);
  } finally {
    setLoading(btn, false);
    cerrarRetryModal();
    cargarErrores();
  }
}

// ── Utilidades ───────────────────────────────────────────

function formatearFechaHora(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  if (isNaN(d)) return String(valor);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function mostrarToast(msg) {
  const toast = document.getElementById('toastRep');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

// ── Sidebar ──────────────────────────────────────────────

function abrirSidebar() {
  document.getElementById('sidebarNavPanel').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
}

function cerrarSidebar() {
  document.getElementById('sidebarNavPanel').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}
