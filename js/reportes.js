// reportes.js — Módulo historial de viajes (solo ADMIN_GENERAL y ADMIN_TRAFICO)

let SESSION = null;
let todosLosViajes  = [];
let viajesFiltrados = [];
let ordenActual     = { col: null, asc: true };
let paginaActual    = 1;

const POR_PAGINA = 50;

document.addEventListener('DOMContentLoaded', () => {
  SESSION = requireSession();
  if (!SESSION) return;

  document.getElementById('userName').textContent    = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;

  document.getElementById('btn-aplicar').addEventListener('click', () => {
    viajesFiltrados = aplicarFiltros(todosLosViajes);
    paginaActual = 1;
    actualizarKPIs(viajesFiltrados);
    renderizarTabla(viajesFiltrados, 1);
  });

  document.getElementById('btn-limpiar').addEventListener('click', () => {
    document.querySelectorAll('#panel-filtros input, #panel-filtros select').forEach(el => {
      if (el.type === 'checkbox') el.checked = false;
      else el.value = '';
    });
    viajesFiltrados = [...todosLosViajes];
    paginaActual = 1;
    actualizarKPIs(viajesFiltrados);
    renderizarTabla(viajesFiltrados, 1);
  });

  document.getElementById('btn-exportar').addEventListener('click', () => {
    exportarExcel(viajesFiltrados);
  });

  iniciar();
});

// ── CARGA INICIAL ────────────────────────────────────────

async function iniciar() {
  mostrarLoader('Cargando historial de viajes...');
  try {
    const res = await gasCall('getViajesHistorico');
    if (!res.ok) { mostrarError(res.error || 'Error al cargar el historial'); return; }

    window.HEADERS_VIAJES = res.headers || [];
    todosLosViajes        = res.viajes  || [];
    viajesFiltrados       = [...todosLosViajes];

    ocultarLoader();
    document.getElementById('contenido-reportes').style.display = 'block';

    popularFiltrosSelect(todosLosViajes);
    actualizarKPIs(viajesFiltrados);
    renderizarTabla(viajesFiltrados, 1);
  } catch(e) {
    mostrarError('Error de conexión: ' + e.message);
  }
}

// ── SELECTS DE FILTRO ────────────────────────────────────

function popularFiltrosSelect(viajes) {
  const empleadores = [...new Set(viajes.map(v => (v[90] || '')).filter(Boolean))].sort();
  const proveedores = [...new Set(viajes.map(v => v[34]).filter(Boolean))].sort();
  const vehiculos   = [...new Set(viajes.map(v => v[26]).filter(Boolean))].sort();
  const conductores = [...new Set(viajes.map(v => (v[91] || '')).filter(Boolean))].sort();
  const usuarios    = [...new Set(viajes.map(v => v[100]).filter(Boolean))].sort();

  llenarSelect('filtro-empleador', empleadores);
  llenarSelect('filtro-proveedor', proveedores);
  llenarSelect('filtro-vehiculo',  vehiculos);
  llenarSelect('filtro-conductor', conductores);
  llenarSelect('filtro-usuario',   usuarios);
}

function llenarSelect(id, opciones) {
  const sel = document.getElementById(id);
  sel.innerHTML = '<option value="">Todos</option>';
  opciones.forEach(op => {
    const opt = document.createElement('option');
    opt.value = op;
    opt.textContent = op;
    sel.appendChild(opt);
  });
}

// ── KPIs ─────────────────────────────────────────────────

function actualizarKPIs(viajes) {
  document.getElementById('kpi-total').textContent       = viajes.length;
  document.getElementById('kpi-vehiculos').textContent   = new Set(viajes.map(v => v[26]).filter(Boolean)).size;
  document.getElementById('kpi-proveedores').textContent = new Set(viajes.map(v => v[34]).filter(Boolean)).size;
  document.getElementById('kpi-empleadores').textContent = new Set(viajes.map(v => (v[90] || '')).filter(Boolean)).size;
  document.getElementById('kpi-usuarios').textContent    = new Set(viajes.map(v => v[100]).filter(Boolean)).size;
}

// ── FILTRADO ─────────────────────────────────────────────

function aplicarFiltros(viajes) {
  let r = [...viajes];

  const fechaDesde   = document.getElementById('filtro-fecha-desde').value;
  const fechaHasta   = document.getElementById('filtro-fecha-hasta').value;
  const cargaDesde   = document.getElementById('filtro-carga-desde').value;
  const cargaHasta   = document.getElementById('filtro-carga-hasta').value;
  const empleador    = document.getElementById('filtro-empleador').value.toLowerCase();
  const proveedor    = document.getElementById('filtro-proveedor').value.toLowerCase();
  const vehiculo     = document.getElementById('filtro-vehiculo').value.toLowerCase();
  const conductor    = document.getElementById('filtro-conductor').value.toLowerCase();
  const usuario      = document.getElementById('filtro-usuario').value.toLowerCase();
  const esquema      = document.getElementById('filtro-esquema').value;
  const plan         = document.getElementById('filtro-plan').value.trim().toLowerCase();
  const soloAnterior = document.getElementById('filtro-fecha-anterior').checked;

  if (fechaDesde) r = r.filter(v => { const d = parseFecha(v[0]); return d && d >= new Date(fechaDesde); });
  if (fechaHasta) r = r.filter(v => { const d = parseFecha(v[0]); return d && d <= new Date(fechaHasta + 'T23:59:59'); });
  if (cargaDesde) r = r.filter(v => new Date(v[102]) >= new Date(cargaDesde));
  if (cargaHasta) r = r.filter(v => new Date(v[102]) <= new Date(cargaHasta + 'T23:59:59'));
  if (empleador)  r = r.filter(v => (v[90] || '').toLowerCase().includes(empleador));
  if (proveedor)  r = r.filter(v => (v[34] || '').toLowerCase().includes(proveedor));
  if (vehiculo)   r = r.filter(v => (v[26] || '').toLowerCase().includes(vehiculo));
  if (conductor)  r = r.filter(v => (v[91] || '').toLowerCase().includes(conductor));
  if (usuario)    r = r.filter(v => (v[100] || '').toLowerCase().includes(usuario));
  if (esquema)    r = r.filter(v => (v[2]   || '') === esquema);
  if (plan)       r = r.filter(v => (v[101] || '').toLowerCase().includes(plan));
  if (soloAnterior) r = r.filter(v => esViajeConFechaAnterior(v));

  return r;
}

// ── TABLA ─────────────────────────────────────────────────

function renderizarTabla(viajes, pagina) {
  const inicio   = (pagina - 1) * POR_PAGINA;
  const fin      = inicio + POR_PAGINA;
  const paginados = viajes.slice(inicio, fin);

  const tbody = document.getElementById('tbody-viajes');
  tbody.innerHTML = '';

  if (viajes.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 16;
    td.style.cssText = 'text-align:center;color:var(--color-text-muted);padding:40px;';
    td.textContent = 'Sin viajes para los filtros aplicados';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    paginados.forEach(v => {
      const esAnterior = esViajeConFechaAnterior(v);
      const tr = document.createElement('tr');
      if (esAnterior) tr.className = 'fila-fecha-anterior';

      const esquemaVal = v[2] || '';
      const badgeClass = esquemaVal === 'CL-ARG' ? 'badge-arg' : 'badge-chile';

      tr.innerHTML =
        '<td>' + (esAnterior ? '<span class="icono-alerta" title="Este viaje fue cargado con una fecha anterior al día de carga">⚠</span>' : '') + '</td>' +
        '<td>' + escapeHtml(formatearFecha(v[0]))   + '</td>' +
        '<td>' + escapeHtml(formatearFecha(v[102]))  + '</td>' +
        '<td>' + escapeHtml(v[101] || '')            + '</td>' +
        '<td><span class="' + badgeClass + '">' + escapeHtml(esquemaVal) + '</span></td>' +
        '<td>' + escapeHtml(v[3]  || '') + '</td>' +
        '<td>' + escapeHtml(v[26] || '') + '</td>' +
        '<td>' + escapeHtml(v[53] || '') + '</td>' +
        '<td>' + escapeHtml(v[90] || '') + '</td>' +
        '<td>' + escapeHtml(v[34] || '') + '</td>' +
        '<td>' + escapeHtml(v[66] || '') + '</td>' +
        '<td>' + escapeHtml(v[91] || '') + '</td>' +
        '<td>' + escapeHtml(v[56] || '') + '</td>' +
        '<td>' + escapeHtml(v[8]  || '') + '</td>' +
        '<td>' + escapeHtml(v[4]  || '') + '</td>' +
        '<td>' + escapeHtml(v[100]|| '') + '</td>';

      tbody.appendChild(tr);
    });
  }

  document.getElementById('contador-viajes').textContent =
    viajes.length === 0
      ? 'Sin resultados'
      : 'Mostrando ' + (inicio + 1) + '–' + Math.min(fin, viajes.length) + ' de ' + viajes.length + ' viajes';

  renderizarPaginacion(viajes.length, pagina);
}

// ── ORDENAMIENTO ─────────────────────────────────────────

const COL_INDICES = [null, 0, 102, 101, 2, 3, 26, 53, 90, 34, 66, 91, 56, 8, 4, 100];

function ordenarPor(thIndex) {
  const colIndex = COL_INDICES[thIndex];
  if (colIndex === null) return;

  if (ordenActual.col === colIndex) {
    ordenActual.asc = !ordenActual.asc;
  } else {
    ordenActual.col = colIndex;
    ordenActual.asc = true;
  }

  document.querySelectorAll('.tabla-viajes-hist th').forEach((th, i) => {
    th.classList.toggle('ordenado', i === thIndex);
  });

  viajesFiltrados.sort((a, b) => {
    const va = (a[colIndex] || '').toString().toLowerCase();
    const vb = (b[colIndex] || '').toString().toLowerCase();
    return ordenActual.asc ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  paginaActual = 1;
  renderizarTabla(viajesFiltrados, 1);
}

// ── PAGINACIÓN ───────────────────────────────────────────

function renderizarPaginacion(total, pagina) {
  const totalPags = Math.ceil(total / POR_PAGINA);
  const cont = document.getElementById('paginacion');
  cont.innerHTML = '';
  if (totalPags <= 1) return;

  const btnAnterior = document.createElement('button');
  btnAnterior.className   = 'pag-btn';
  btnAnterior.textContent = '← Anterior';
  btnAnterior.disabled    = pagina === 1;
  btnAnterior.onclick = () => { paginaActual--; renderizarTabla(viajesFiltrados, paginaActual); };
  cont.appendChild(btnAnterior);

  const rangoInicio = Math.max(1, pagina - 2);
  const rangoFin    = Math.min(totalPags, pagina + 2);
  for (let i = rangoInicio; i <= rangoFin; i++) {
    const btn = document.createElement('button');
    btn.className   = 'pag-btn' + (i === pagina ? ' activo' : '');
    btn.textContent = i;
    btn.onclick = ((p) => () => { paginaActual = p; renderizarTabla(viajesFiltrados, p); })(i);
    cont.appendChild(btn);
  }

  const btnSiguiente = document.createElement('button');
  btnSiguiente.className   = 'pag-btn';
  btnSiguiente.textContent = 'Siguiente →';
  btnSiguiente.disabled    = pagina === totalPags;
  btnSiguiente.onclick = () => { paginaActual++; renderizarTabla(viajesFiltrados, paginaActual); };
  cont.appendChild(btnSiguiente);
}

// ── EXPORTACIÓN EXCEL ────────────────────────────────────

function exportarExcel(viajes) {
  if (!viajes || viajes.length === 0) {
    mostrarToast('No hay viajes para exportar con los filtros aplicados');
    return;
  }

  const headers = window.HEADERS_VIAJES || [];
  const headersCompletos = [...headers, 'Cargado con Fecha Anterior'];

  const rows = viajes.map(v => {
    const fila = [...v];
    while (fila.length < headers.length) fila.push('');
    fila.push(esViajeConFechaAnterior(v) ? 'SÍ' : 'NO');
    return fila;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headersCompletos, ...rows]);
  ws['!cols'] = headersCompletos.map(() => ({ wch: 20 }));

  XLSX.utils.book_append_sheet(wb, ws, 'Historial Viajes');

  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, 'Historial_Viajes_' + fecha + '.xlsx');

  mostrarToast('✓ Exportados ' + viajes.length + ' viajes — ' + headersCompletos.length + ' columnas');
}

// ── UTILIDADES ───────────────────────────────────────────

function esViajeConFechaAnterior(fila) {
  const fechaViaje = parseFecha(fila[0]);
  const fechaCarga = new Date(fila[102]);
  if (!fechaViaje || !fechaCarga || isNaN(fechaCarga)) return false;
  const diffDias = (fechaCarga - fechaViaje) / (1000 * 60 * 60 * 24);
  return diffDias > 1;
}

function parseFecha(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return isNaN(d) ? null : d;
}

function formatearFecha(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  if (isNaN(d)) return String(valor);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── UI HELPERS ───────────────────────────────────────────

function mostrarLoader(msg) {
  document.getElementById('rep-loader').style.display = 'flex';
  document.getElementById('rep-loader-msg').textContent = msg;
  document.getElementById('rep-error').style.display   = 'none';
  document.getElementById('contenido-reportes').style.display = 'none';
}

function ocultarLoader() {
  document.getElementById('rep-loader').style.display = 'none';
}

function mostrarError(msg) {
  document.getElementById('rep-loader').style.display = 'none';
  document.getElementById('rep-error').style.display  = 'block';
  document.getElementById('rep-error').textContent    = msg;
}

function mostrarToast(msg) {
  const toast = document.getElementById('toastRep');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ── SIDEBAR ──────────────────────────────────────────────

function abrirSidebar() {
  document.getElementById('sidebarNavPanel').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('active');
}

function cerrarSidebar() {
  document.getElementById('sidebarNavPanel').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}
