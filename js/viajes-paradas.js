// viajes-paradas.js — Módulo "Viajes con Paradas" (solo ADMIN_GENERAL y ADMIN_TRAFICO)
//
// Cada "grupo" = un vehículo con su propio recorrido de paradas (mínimo 2:
// origen y destino). Al cargar, cada parada se convierte en una fila más de
// ViajesTotalesTroncales (mismo formato que "Generar Viajes"), pero:
//   - "Código de despacho" = {códigoBase}-{n° vehículo} ({n° parada})   → única por fila
//   - "Código de ruta"     = {códigoBase}-{n° vehículo}                → compartida por
//     todas las paradas de ese vehículo — es lo que usa el envío automático a
//     Aker para agruparlas y mandarlas como UN solo itinerario (ver Aker.gs).

let SESSION      = null;
let planCreado    = null;
let codigoBase    = '';
let grupoContador = 0;
const grupoRefs = {}; // { idx: { veh, arr, prov, ruta, cond, cond2, paradas: [dropdownRef,...] } }
const msRefs    = {}; // { 'ms-costo-1': multiSelectRef, 'ms-ingreso-1': multiSelectRef }

// ── Caché localStorage ──

const CACHE_KEY    = 'troncales_datosMaestros';
const CACHE_TTL_MS = 30 * 60 * 1000;

function cargarDesdeCacheOGAS() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw);
    if (Date.now() - timestamp < CACHE_TTL_MS) return { fromCache: true, data };
  } catch(e) {}
  return null;
}

function guardarEnCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
  } catch(e) {}
}

// ── Loader con feedback ──

let loaderInterval = null;
let loaderSeconds  = 0;

function iniciarLoaderConFeedback() {
  const loaderTxt    = document.getElementById('initLoaderTxt');
  const loaderSubtxt = document.getElementById('initLoaderSubtxt');
  loaderSeconds = 0;
  loaderInterval = setInterval(() => {
    loaderSeconds++;
    if (loaderTxt) loaderTxt.textContent = 'Cargando datos maestros... (' + loaderSeconds + 's)';
    if (loaderSeconds === 8 && loaderSubtxt)
      loaderSubtxt.textContent = 'Esto puede demorar unos segundos en el primer acceso del día.';
    if (loaderSeconds === 20 && loaderSubtxt)
      loaderSubtxt.textContent = 'Conectando con Google Apps Script, por favor esperá...';
    if (loaderSeconds === 90) {
      clearInterval(loaderInterval);
      loaderInterval = null;
      if (loaderSubtxt) loaderSubtxt.innerHTML = 'La conexión está tardando más de lo esperado. <button onclick="location.reload()" style="color:#01feff;background:none;border:1px solid #01feff;padding:4px 12px;border-radius:4px;cursor:pointer;margin-left:8px;">Reintentar</button>';
    }
  }, 1000);
}

function detenerLoader() {
  if (loaderInterval) { clearInterval(loaderInterval); loaderInterval = null; }
}

async function refrescarDatosSilencioso() {
  try {
    const res = await gasCallDatosMaestros();
    if (res.ok !== false) {
      guardarEnCache(res);
      if (!Object.keys(grupoRefs).length) {
        window.DATOS = res;
      } else {
        mostrarToast('Datos maestros actualizados. Serán aplicados en la próxima carga.');
      }
    }
  } catch(e) {}
}

// ── Init ──

document.addEventListener('DOMContentLoaded', async () => {
  SESSION = requireRole(['ADMIN_GENERAL', 'ADMIN_TRAFICO']);
  if (!SESSION) return;
  window.SESSION = SESSION;
  document.getElementById('userName').textContent     = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;

  const cached = cargarDesdeCacheOGAS();

  if (cached) {
    window.DATOS = cached.data;
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('contenido').style.display  = 'block';
    inicializarPaso1();
    _mostrarResumenDatos(cached.data);
    refrescarDatosSilencioso();
  } else {
    document.getElementById('initLoader').style.display = 'flex';
    document.getElementById('contenido').style.display  = 'none';
    iniciarLoaderConFeedback();
    try {
      const res = await gasCallDatosMaestros((msg) => {
        const sub = document.getElementById('initLoaderSubtxt');
        if (sub) sub.textContent = msg;
      });
      detenerLoader();
      if (res.ok === false) throw new Error(res.error || 'Error al cargar datos maestros');
      window.DATOS = res;
      guardarEnCache(res);
      document.getElementById('initLoader').style.display = 'none';
      document.getElementById('contenido').style.display  = 'block';
      inicializarPaso1();
      _mostrarResumenDatos(res);
    } catch (e) {
      detenerLoader();
      document.getElementById('initLoader').style.display = 'none';
      document.getElementById('initError').textContent    = 'Error al cargar datos: ' + e.message;
      document.getElementById('initError').style.display  = 'block';
    }
  }
});

function _mostrarResumenDatos(datos) {
  const el = document.getElementById('resumenDatos');
  if (!el) return;
  el.innerHTML =
    '<span>' + (datos.direcciones  ? datos.direcciones.length  : 0) + ' direcciones</span>' +
    '<span>' + (datos.flota        ? datos.flota.length        : 0) + ' vehículos</span>'   +
    '<span>' + (datos.tripulantes  ? datos.tripulantes.length  : 0) + ' conductores</span>' +
    '<span>' + (datos.socios       ? datos.socios.length       : 0) + ' socios</span>';
  el.style.display = 'flex';
}

// ── PASO 1 ──

function inicializarPaso1() {
  renderSteps(1);
  document.getElementById('paso1').classList.add('active');

  const secSync = document.getElementById('secSyncViajes');
  if (secSync) secSync.style.display = 'block';
  const sbSync = document.getElementById('sbSyncItems');
  if (sbSync) sbSync.style.display = 'block';

  if (SESSION.rol === 'ADMIN_GENERAL') {
    const sbAdmin = document.getElementById('sbAdminLink');
    const sbDiv   = document.getElementById('sbAdminDivider');
    if (sbAdmin) sbAdmin.style.display = 'flex';
    if (sbDiv)   sbDiv.style.display   = 'block';
  }
  const sbRutas        = document.getElementById('sbRutasLink');
  const sbArrastres    = document.getElementById('sbArrastresLink');
  const sbReportes     = document.getElementById('sbReportesLink');
  const sbDatosDivider = document.getElementById('sbDatosDivider');
  if (sbRutas)        sbRutas.style.display        = 'flex';
  if (sbArrastres)    sbArrastres.style.display    = 'flex';
  if (sbDatosDivider) sbDatosDivider.style.display = 'block';
  if (sbReportes) sbReportes.style.display = 'flex';

  document.getElementById('formPlan').addEventListener('submit', submitCrearPlan);
}

function submitCrearPlan(e) {
  e.preventDefault();
  const errEl = document.getElementById('errorPlan');
  errEl.textContent = '';
  const nombre     = document.getElementById('nombrePlan').value.trim();
  const fecha      = document.getElementById('fechaViaje').value;
  const pais       = document.getElementById('pais').value;
  const fechaMax   = document.getElementById('fechaMaxEntrega').value;
  const schemaCode = pais === 'argentina' ? 'CL-ARG' : 'CL-CHILE';
  planCreado = { nombre, fecha, fechaMaxEntrega: fechaMax, schemaCode, pais };

  // Código base para todo el plan — cada vehículo agrega "-N", cada parada
  // agrega " (n)" sobre el código de SU vehículo (ver agregarGrupo/recolectarViajes).
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  codigoBase = `${String(now.getFullYear()).slice(-2)}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${SESSION.iniciales}`;

  transicionarPaso(2);
}

// ── PASO 2 — Grupos (vehículos) ──

function getRutasOpciones(filtroProveedor) {
  const all = (window.DATOS.rutas || []).map(r => {
    const vals    = Object.values(r);
    const nombre  = String(vals[0] || '');
    const prov    = String(vals[1] || '');
    const km      = String(r.KM      || vals[2] || '').trim();
    const origen  = String(r.ORIGEN  || vals[3] || '').trim();
    const destino = String(r.DESTINO || vals[4] || '').trim();
    const kmOrigenDestino = [km, origen, destino].join(',');
    return { value: nombre, label: nombre + (prov ? ' [' + prov + ']' : ''), rutaProv: prov, extra: { kmOrigenDestino } };
  });
  if (!filtroProveedor) return all;
  const norm = filtroProveedor.toLowerCase();
  return all.filter(r => r.rutaProv.toLowerCase() === norm || r.rutaProv === '');
}

function agregarGrupo() {
  const idx = grupoContador++;
  const div = crearGrupo(idx);
  document.getElementById('gruposContainer').appendChild(div);
  document.getElementById('btnCargarViajes').style.display = 'inline-flex';
  document.getElementById('validacionError').style.display = 'none';
}

function crearGrupo(idx) {
  const codigoGrupo = `${codigoBase}-${idx + 1}`;

  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.style.marginBottom = '16px';
  wrap.dataset.idx = idx;
  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Vehículo ${idx + 1} <span style="color:var(--color-text-muted);font-weight:400;font-size:13px">— ${escapeHtml(codigoGrupo)}</span></h3>
      <button class="btn-del-row" onclick="eliminarGrupo(this)" title="Eliminar vehículo">×</button>
    </div>

    <div class="plan-grid" style="margin-bottom:16px">
      <div class="form-group"><label>Cód. Alternativo *</label><input type="text" class="f-alt" placeholder="*"></div>
      <div class="form-group" style="grid-column: span 2">
        <label>Unid. 1 (KG) *</label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select class="f-modo-kg" style="flex:0 0 auto;width:auto" onchange="actualizarModoKg(this)">
            <option value="total">Cargar un total (se reparte entre las paradas)</option>
            <option value="parada">Cargar uno distinto por cada parada</option>
          </select>
          <span class="f-uni1-label" style="font-size:12px;color:var(--color-text-muted)">Total de KG del vehículo:</span>
          <input type="number" class="f-uni1" min="1" step="1" placeholder="* Ej: 1000" style="width:120px">
        </div>
      </div>
      <div class="form-group"><label>Unid. 2</label><input type="number" class="f-uni2" min="0" step="1" placeholder="0"></div>
      <div class="form-group"><label>Unid. 3</label><input type="number" class="f-uni3" min="0" step="1" placeholder="0"></div>
      <div class="form-group"><label>Vehículo *</label><div id="td-veh-${idx}"></div></div>
      <div class="form-group"><label>Arrastre</label><div id="td-arr-${idx}"></div></div>
      <div class="form-group"><label>Empleador</label><div id="td-emp-${idx}"><span class="empleador-value text-muted">—</span></div></div>
      <div class="form-group"><label>Etiq. Costo</label><div id="td-costo-${idx}"><span class="no-etiquetas text-muted">—</span></div></div>
      <div class="form-group"><label>Proveedor *</label><div id="td-prov-${idx}"></div></div>
      <div class="form-group"><label>Etiq. Ingreso</label><div id="td-ingreso-${idx}"><span class="no-etiquetas text-muted">—</span></div></div>
      <div class="form-group"><label>Ruta Maestra (informativa) *</label><div id="td-ruta-${idx}"></div></div>
      <div class="form-group"><label>Conductor *</label><div id="td-cond-${idx}"></div></div>
      <div class="form-group"><label>2do Conductor</label><div id="td-cond2-${idx}"></div></div>
      <div class="form-group"><label>Descripción</label><input type="text" class="f-desc" placeholder="Opcional"></div>
    </div>

    <div class="cantidad-section">
      <div class="form-group">
        <label>Cantidad de paradas (mín. 2 — origen y destino)</label>
        <input type="number" class="f-cant-paradas" min="2" max="30" value="2" style="width:100px">
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="generarParadas(this)">Generar paradas</button>
    </div>
    <div class="paradas-list" style="margin-top:12px;display:flex;flex-direction:column;gap:8px"></div>
  `;

  const tripOpciones = (window.DATOS.tripulantes || []).map(t => ({
    value: t.nombre_completo,
    labelCorto: t.nombre_completo,
    label: t.nombre_completo + ' — ' + t.email,
    extra: { nombre: t.nombre_completo, email: t.email }
  }));

  const refs = { paradas: [] };

  refs.veh = crearDropdownSimple({
    opciones: (window.DATOS.flota || [])
      .filter(v => v.is_active === true || String(v.is_active).toLowerCase() === 'true')
      .map(v => ({
        value: v.code,
        labelCorto: v.code,
        label: v.code + (v.description ? ' — ' + v.description : '') + ' | ' + (v.employer_name || 'Sin empleador')
      })),
    placeholder:      'Buscar vehículo... *',
    mensajeVacio:     'No hay vehículos disponibles',
    deshabilitadosFn: () => Object.keys(grupoRefs)
      .filter(k => Number(k) !== idx)
      .map(k => grupoRefs[k]?.veh?.getValue())
      .filter(Boolean),
    onChange: (value) => onVehiculoChange(idx, value)
  });

  refs.arr = crearDropdownSimple({
    opciones: (window.DATOS.arrastres || []).map(a => {
      const vals = Object.values(a);
      const v = String(vals[0] || '');
      return { value: v, label: v + (vals[1] ? ' — ' + vals[1] : '') };
    }),
    placeholder:  '— arrastre —',
    mensajeVacio: 'No hay arrastres cargados',
    onChange: () => {}
  });

  refs.prov = crearDropdownSimple({
    opciones: (window.DATOS.socios || [])
      .filter(s => String(s.type || '').toLowerCase() === 'supplier')
      .map(s => ({ value: s.name || '', label: s.name || '' })),
    placeholder:  'Buscar proveedor... *',
    mensajeVacio: 'No hay proveedores disponibles',
    onChange: (value) => onProveedorChange(idx, value)
  });

  refs.ruta = crearDropdownSimple({
    opciones:     getRutasOpciones(''),
    placeholder:  'Buscar ruta... *',
    mensajeVacio: 'No hay rutas maestras cargadas',
    onChange: () => {}
  });

  refs.cond = crearDropdownSimple({
    opciones:         tripOpciones,
    placeholder:      'Buscar conductor... *',
    mensajeVacio:     'No hay conductores disponibles',
    deshabilitadosFn: () => getConductoresYaUsados(idx, 'conductor'),
    onChange: () => {}
  });

  refs.cond2 = crearDropdownSimple({
    opciones:         tripOpciones,
    placeholder:      '2do conductor...',
    mensajeVacio:     'No hay conductores disponibles',
    deshabilitadosFn: () => getConductoresYaUsados(idx, 'segundoConductor'),
    onChange: () => {}
  });

  grupoRefs[idx] = refs;

  wrap.querySelector(`#td-veh-${idx}`).appendChild(refs.veh.contenedor);
  wrap.querySelector(`#td-arr-${idx}`).appendChild(refs.arr.contenedor);
  wrap.querySelector(`#td-prov-${idx}`).appendChild(refs.prov.contenedor);
  wrap.querySelector(`#td-ruta-${idx}`).appendChild(refs.ruta.contenedor);
  wrap.querySelector(`#td-cond-${idx}`).appendChild(refs.cond.contenedor);
  wrap.querySelector(`#td-cond2-${idx}`).appendChild(refs.cond2.contenedor);

  // Arranca ya con las 2 paradas mínimas generadas.
  setTimeout(() => generarParadas(wrap.querySelector('.f-cant-paradas')), 0);

  return wrap;
}

function generarParadas(elDentroDelGrupo) {
  const card = elDentroDelGrupo.closest('.card');
  const idx  = Number(card.dataset.idx);
  const cantEl = card.querySelector('.f-cant-paradas');
  const cantidad = parseInt(cantEl.value, 10);
  if (!cantidad || cantidad < 2 || cantidad > 30) { alert('La cantidad de paradas tiene que ser un número entre 2 y 30.'); return; }

  const lista = card.querySelector('.paradas-list');
  lista.innerHTML = '';
  const refs = grupoRefs[idx];
  refs.paradas = [];

  for (let p = 0; p < cantidad; p++) {
    const fila = document.createElement('div');
    fila.style.cssText = 'display:flex;align-items:center;gap:10px';
    const etiqueta = p === 0 ? 'Parada 1 (Origen) *' : (p === cantidad - 1 ? `Parada ${p + 1} (Destino) *` : `Parada ${p + 1} *`);
    const label = document.createElement('span');
    label.textContent = etiqueta;
    label.style.cssText = 'min-width:150px;font-size:13px;color:var(--color-text-muted)';
    const mount = document.createElement('div');
    mount.style.flex = '1';
    fila.appendChild(label);
    fila.appendChild(mount);

    const kgInput = document.createElement('input');
    kgInput.type        = 'number';
    kgInput.className   = 'f-parada-kg';
    kgInput.min         = '0';
    kgInput.step        = '1';
    kgInput.placeholder = 'KG *';
    kgInput.style.cssText = 'width:90px;flex:0 0 auto';
    fila.appendChild(kgInput);

    lista.appendChild(fila);

    const refParada = crearDropdownSimple({
      opciones: (window.DATOS.direcciones || []).map(d => ({
        value: d.code,
        labelCorto: d.code,
        label: '[' + d.code + '] — ' + (d.name || '') + ' | ' + (d.address1 || '') + ', ' + (d.city || '')
      })),
      placeholder:  'Buscar dirección... *',
      mensajeVacio: 'No hay direcciones cargadas',
      onChange: () => {}
    });
    mount.appendChild(refParada.contenedor);
    refs.paradas.push({ dir: refParada, kg: kgInput });
  }

  actualizarModoKg(card.querySelector('.f-modo-kg'));
}

// ── Modo de carga de KG (Unid. 1): total repartido entre todas las paradas, o uno por parada ──

function actualizarModoKg(selectEl) {
  const card  = selectEl.closest('.card');
  const modo  = selectEl.value; // 'total' | 'parada'
  const uni1  = card.querySelector('.f-uni1');
  const label = card.querySelector('.f-uni1-label');
  if (uni1)  uni1.style.display  = modo === 'total' ? '' : 'none';
  if (label) label.style.display = modo === 'total' ? '' : 'none';
  card.querySelectorAll('.f-parada-kg').forEach(k => {
    k.style.display = modo === 'parada' ? '' : 'none';
  });
}

function eliminarGrupo(btn) {
  const card = btn.closest('.card');
  const idx  = Number(card.dataset.idx);
  delete grupoRefs[idx];
  card.remove();
  if (!document.querySelector('#gruposContainer .card')) {
    document.getElementById('btnCargarViajes').style.display = 'none';
  }
}

// ── Dropdown Simple — provisto por componentes.js (crearDropdownSimple, crearMultiSelect, getEstadoTarifa) ──

// ── Conductores sin duplicar entre vehículos ──

function getConductoresYaUsados(grupoIdx, campo) {
  const usados = new Set();
  Object.keys(grupoRefs).forEach(k => {
    const i = Number(k);
    const r = grupoRefs[i];
    if (!r) return;
    const c1 = r.cond?.getValue();
    const c2 = r.cond2?.getValue();
    if (i === grupoIdx) {
      if (campo === 'conductor'       && c2) usados.add(c2);
      if (campo === 'segundoConductor' && c1) usados.add(c1);
    } else {
      if (c1) usados.add(c1);
      if (c2) usados.add(c2);
    }
  });
  return Array.from(usados);
}

// ── Vehículos/patentes sin duplicar en el mismo plan ──

function getPatentesRepetidas() {
  const conteo = {};
  Object.keys(grupoRefs).forEach(k => {
    const v = grupoRefs[k]?.veh?.getValue();
    if (v) conteo[v] = (conteo[v] || 0) + 1;
  });
  return new Set(Object.keys(conteo).filter(v => conteo[v] > 1));
}

function marcarPatentesDuplicadas() {
  const repetidas = getPatentesRepetidas();
  document.querySelectorAll('#gruposContainer .card').forEach(card => {
    const idx  = Number(card.dataset.idx);
    const refs = grupoRefs[idx] || {};
    const v    = refs.veh?.getValue();
    if (v && repetidas.has(v)) refs.veh?.input?.classList.add('error');
  });
  return repetidas.size > 0;
}

// ── Vehículo ──

function onVehiculoChange(idx, code) {
  actualizarEmpleador(idx, code);
  actualizarEtiquetasCosto(idx, code);
}

function getEmpleadorDeVehiculo(code) {
  if (!code) return '';
  const v = (window.DATOS.flota || []).find(v => v.code === code);
  return v ? (v.employer_name || '') : '';
}

function actualizarEmpleador(idx, code) {
  const td = document.getElementById('td-emp-' + idx);
  if (!td) return;
  const emp = getEmpleadorDeVehiculo(code);
  td.dataset.empleador = emp || '';
  if (!code) {
    td.innerHTML = '<span class="empleador-value text-muted">—</span>';
  } else if (emp) {
    td.innerHTML = `<span class="empleador-value text-muted">${escapeHtml(emp)}</span>`;
  } else {
    td.innerHTML = `<div class="empleador-warn">⚠ Sin employer — actualizar en Driv.in</div>`;
  }
}

function getEmpleadorDeGrupo(idx) {
  return document.getElementById('td-emp-' + idx)?.dataset.empleador || '';
}

// ── Etiquetas Costo — vehículo → employer → col M(12) → col AA(26) ──

function actualizarEtiquetasCosto(idx, vehiculoCode) {
  const td = document.getElementById('td-costo-' + idx);
  if (!td) return;
  td.innerHTML = '';
  const emp = getEmpleadorDeVehiculo(vehiculoCode);
  if (!emp) {
    td.innerHTML = '<span class="no-etiquetas text-muted">Sin costos cargados para este empleador</span>';
    return;
  }
  const norm  = emp.trim().toLowerCase();
  const nombresVistosCosto = new Set();
  const items = [];
  (window.DATOS.esquemasCostos || []).slice(1)
    .filter(r => {
      const schemaName = String(r[1]  || '').trim().toLowerCase();
      const employer   = String(r[12] || '').trim().toLowerCase();
      return schemaName === norm || employer === norm;
    })
    .forEach(r => {
      const nombre = String(r[26] || '').trim();
      if (!nombre || nombresVistosCosto.has(nombre)) return;
      nombresVistosCosto.add(nombre);
      const outputTag  = String(r[22] || '').trim();
      const outputTag2 = String(r[23] || '').trim();
      items.push({ nombre, outputTag, outputTag2, estado: getEstadoTarifa(outputTag, outputTag2) });
    });
  items.sort((a, b) => {
    const p = { vigente: 0, 'sin-periodo': 1, vencida: 2 };
    return (p[a.estado] ?? 1) !== (p[b.estado] ?? 1)
      ? (p[a.estado] ?? 1) - (p[b.estado] ?? 1)
      : a.nombre.localeCompare(b.nombre);
  });
  if (!items.length) {
    td.innerHTML = '<span class="no-etiquetas text-muted">Sin costos cargados para este empleador</span>';
    return;
  }
  const msId = `ms-costo-${idx}`;
  let ms;
  ms = crearMultiSelect({
    opciones:     items,
    placeholder:  'Etiquetas costo...',
    mensajeVacio: 'Sin costos cargados para este empleador',
    onChange:     (vals) => { ms.contenedor.dataset.selected = JSON.stringify(vals); }
  });
  ms.contenedor.id             = msId;
  ms.contenedor.dataset.selected = '[]';
  msRefs[msId] = ms;
  td.appendChild(ms.contenedor);
}

// ── Etiquetas Ingreso — proveedor → col L(11) → col AA(26) ──

function actualizarEtiquetasIngreso(idx, proveedorNombre) {
  const td = document.getElementById('td-ingreso-' + idx);
  if (!td) return;
  td.innerHTML = '';
  if (!proveedorNombre) {
    td.innerHTML = '<span class="no-etiquetas text-muted">Seleccioná un proveedor primero</span>';
    return;
  }
  const norm  = proveedorNombre.trim().toLowerCase();
  const nombresVistosIngreso = new Set();
  const items = [];
  (window.DATOS.esquemasIngresos || []).slice(1)
    .filter(r => {
      const schemaName   = String(r[1]  || '').trim().toLowerCase();
      const supplierName = String(r[11] || '').trim().toLowerCase();
      return schemaName === norm || supplierName === norm;
    })
    .forEach(r => {
      const nombre = String(r[26] || '').trim();
      if (!nombre || nombresVistosIngreso.has(nombre)) return;
      nombresVistosIngreso.add(nombre);
      const outputTag  = String(r[22] || '').trim();
      const outputTag2 = String(r[23] || '').trim();
      items.push({ nombre, outputTag, outputTag2, estado: getEstadoTarifa(outputTag, outputTag2) });
    });
  items.sort((a, b) => {
    const p = { vigente: 0, 'sin-periodo': 1, vencida: 2 };
    return (p[a.estado] ?? 1) !== (p[b.estado] ?? 1)
      ? (p[a.estado] ?? 1) - (p[b.estado] ?? 1)
      : a.nombre.localeCompare(b.nombre);
  });
  if (!items.length) {
    td.innerHTML = '<span class="no-etiquetas text-muted">Sin tarifas cargadas para este proveedor</span>';
    return;
  }
  const msId = `ms-ingreso-${idx}`;
  let ms;
  ms = crearMultiSelect({
    opciones:     items,
    placeholder:  'Etiquetas ingreso...',
    mensajeVacio: 'Sin tarifas cargadas para este proveedor',
    onChange:     (vals) => { ms.contenedor.dataset.selected = JSON.stringify(vals); }
  });
  ms.contenedor.id             = msId;
  ms.contenedor.dataset.selected = '[]';
  msRefs[msId] = ms;
  td.appendChild(ms.contenedor);
}

function onProveedorChange(idx, prov) {
  actualizarEtiquetasIngreso(idx, prov);
  const refs = grupoRefs[idx];
  if (refs && refs.ruta) refs.ruta.setOpciones(getRutasOpciones(prov));
}

// ── Validación ──

function validarGrupos() {
  let ok = true;
  const cards = document.querySelectorAll('#gruposContainer .card');
  if (!cards.length) ok = false;

  cards.forEach(card => {
    const idx  = Number(card.dataset.idx);
    const refs = grupoRefs[idx] || {};

    const altEl = card.querySelector('.f-alt');
    toggleError(altEl, !altEl?.value?.trim()) && (ok = false);

    const modoKg = card.querySelector('.f-modo-kg')?.value || 'total';
    if (modoKg === 'total') {
      const uni1 = card.querySelector('.f-uni1');
      toggleError(uni1, !uni1?.value || parseInt(uni1.value, 10) < 1) && (ok = false);
    } else {
      (refs.paradas || []).forEach(p => {
        toggleError(p?.kg, !p?.kg?.value || parseInt(p.kg.value, 10) < 1) && (ok = false);
      });
    }

    toggleError(refs.veh?.input,  !refs.veh?.getValue())  && (ok = false);
    toggleError(refs.prov?.input, !refs.prov?.getValue()) && (ok = false);
    toggleError(refs.ruta?.input, !refs.ruta?.getValue()) && (ok = false);
    toggleError(refs.cond?.input, !refs.cond?.getValue()) && (ok = false);

    const msC = document.getElementById(`ms-costo-${idx}`);
    const costoSel = msC ? JSON.parse(msC.dataset.selected || '[]') : [];
    const triggerC = msC?.querySelector('.ms-trigger');
    if (triggerC) { triggerC.classList.toggle('error', !costoSel.length); if (!costoSel.length) ok = false; }

    const msI = document.getElementById(`ms-ingreso-${idx}`);
    const ingresoSel = msI ? JSON.parse(msI.dataset.selected || '[]') : [];
    const triggerI = msI?.querySelector('.ms-trigger');
    if (triggerI) { triggerI.classList.toggle('error', !ingresoSel.length); if (!ingresoSel.length) ok = false; }

    if (!refs.paradas || refs.paradas.length < 2) { ok = false; }
    (refs.paradas || []).forEach(p => {
      toggleError(p?.dir?.input, !p?.dir?.getValue()) && (ok = false);
    });
  });

  if (marcarPatentesDuplicadas()) ok = false;
  return ok;
}

function toggleError(el, hasError) {
  if (!el) return hasError;
  el.classList.toggle('error', hasError);
  return hasError;
}

// ── Recolectar datos — expande cada grupo en N filas (una por parada) ──

function recolectarViajes() {
  const viajes = [];
  document.querySelectorAll('#gruposContainer .card').forEach(card => {
    const idx   = Number(card.dataset.idx);
    const refs  = grupoRefs[idx] || {};
    const msC   = document.getElementById(`ms-costo-${idx}`);
    const msI   = document.getElementById(`ms-ingreso-${idx}`);
    const cExtra  = refs.cond?.getExtra()  || {};
    const c2Extra = refs.cond2?.getExtra() || {};

    const codigoGrupo = `${codigoBase}-${idx + 1}`;
    const paradas = refs.paradas || [];

    // KG (Unidades_1) por parada: o el valor propio de cada una, o el total
    // del vehículo repartido en partes iguales entre TODAS las paradas
    // (incluido el origen) — el resto de la división exacta va a las
    // primeras paradas, para que la suma dé el total cargado.
    const modoKg = card.querySelector('.f-modo-kg')?.value || 'total';
    let kgPorParada;
    if (modoKg === 'parada') {
      kgPorParada = paradas.map(p => p.kg?.value || '');
    } else {
      const total = parseInt(card.querySelector('.f-uni1')?.value, 10) || 0;
      const n     = paradas.length || 1;
      const base  = Math.floor(total / n);
      const resto = total - base * n;
      kgPorParada = paradas.map((_, i) => String(base + (i < resto ? 1 : 0)));
    }

    const camposComunes = {
      codigoAlternativo:      card.querySelector('.f-alt')?.value  || '',
      unidades2:              card.querySelector('.f-uni2')?.value || '',
      unidades3:              card.querySelector('.f-uni3')?.value || '',
      vehiculo:               refs.veh?.getValue()                || '',
      arrastre:               refs.arr?.getValue()                || '',
      empleador:              getEmpleadorDeGrupo(idx),
      etiquetasCosto:         msC ? JSON.parse(msC.dataset.selected || '[]') : [],
      proveedor:              refs.prov?.getValue()               || '',
      etiquetasIngreso:       msI ? JSON.parse(msI.dataset.selected || '[]') : [],
      rutaMaestra:            refs.ruta?.getValue()               || '',
      rutaKmOrigenDestino:    refs.ruta?.getExtra()?.kmOrigenDestino || '',
      conductorEmail:         cExtra.email                        || '',
      conductorNombre:        cExtra.nombre                       || '',
      segundoConductorNombre: c2Extra.nombre                      || '',
      descripcionViaje:       card.querySelector('.f-desc')?.value || '',
      // La Ruta Maestra elegida arriba es solo informativa acá (queda en
      // Texto 11) — no se escribe en la columna "Ruta Maestra" real, para
      // que el envío automático a Aker no la trate como una ruta a expandir.
      omitirRutaMaestraColumna: true,
      numeroViaje:              1
    };

    // El Código de ruta de este módulo lleva el prefijo "CRPP-" para
    // distinguirlo de los códigos de ruta de los demás módulos (Aker lo usa
    // tal cual como clave de agrupación, así que el prefijo no afecta el
    // agrupado, solo lo identifica).
    const codigoRutaConPrefijo = `CRPP-${codigoGrupo}`;

    paradas.forEach((paradaRef, p) => {
      viajes.push(Object.assign({}, camposComunes, {
        codigoDespacho:     `${codigoGrupo} (${p + 1})`,
        codigoRuta:         codigoRutaConPrefijo,
        posicion:           p + 1,
        prioridadSecuencia: p + 1,
        codigoDireccion:    paradaRef.dir.getValue() || '',
        unidades1:          kgPorParada[p] || ''
      }));
    });
  });
  return viajes;
}

// ── Cargar viajes ──

function cargarViajes() {
  if (!validarGrupos()) {
    const errEl = document.getElementById('validacionError');
    errEl.textContent = getPatentesRepetidas().size > 0
      ? 'Hay un mismo vehículo/patente asignado a más de un bloque (marcadas en rojo). Cada vehículo solo puede usarse una vez por plan.'
      : 'Completá los campos obligatorios marcados en rojo (*) — cada vehículo necesita al menos 2 paradas con dirección elegida.';
    errEl.style.display = 'block';
    document.querySelector('#gruposContainer .error')?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  document.getElementById('validacionError').style.display = 'none';
  const viajes = recolectarViajes();
  const nGrupos = document.querySelectorAll('#gruposContainer .card').length;
  document.getElementById('resNGrupos').textContent    = nGrupos;
  document.getElementById('resNViajes').textContent    = viajes.length;
  document.getElementById('resNombrePlan').textContent = planCreado.nombre;
  document.getElementById('resFecha').textContent      = planCreado.fecha;
  document.getElementById('resEsquema').textContent    = planCreado.schemaCode;
  document.getElementById('resFechaMax').textContent   = planCreado.fechaMaxEntrega;
  window._viajesParaCargar = viajes;
  document.getElementById('modalConfirm').classList.add('active');
}

function cerrarConfirm() {
  document.getElementById('modalConfirm').classList.remove('active');
}

async function confirmarCarga() {
  cerrarConfirm();
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.add('active');
  try {
    await ejecutarCarga(window._viajesParaCargar);
  } catch (e) {
    overlay.classList.remove('active');
    alert('Error al cargar viajes: ' + e.message);
  }
}

// ── Ejecutar carga — crea plan en Driv.in y luego planilla en Drive ──
// (Igual que en "Generar Viajes": el Excel/planilla es lo único que se genera
// acá — no se manda nada directo a la API de órdenes de Driv.in.)

async function ejecutarCarga(viajes) {
  const overlay = document.getElementById('loadingOverlay');
  const resPlan = await gasCall('crearPlanDrivin', {
    planDatos: { description: planCreado.nombre, date: planCreado.fecha, schema_code: planCreado.schemaCode }
  });
  if (!resPlan.ok) throw new Error(resPlan.error || 'Error al crear plan en Driv.in');
  planCreado.id = resPlan.response?.id || '';
  const res = await gasCall('crearPlanillaViajes', { viajes, planDatos: planCreado });
  overlay.classList.remove('active');
  if (!res.ok) throw new Error(res.error || 'Error al crear planilla en Drive');
  const urlPlanilla = res.fileUrl || (res.fileId ? 'https://docs.google.com/spreadsheets/d/' + res.fileId + '/edit' : '');
  if (!urlPlanilla) {
    alert('Los viajes se cargaron, pero no se pudo obtener el link de la planilla. Buscala en Drive como "Troncales_' + planCreado.nombre + '_' + planCreado.fecha + '".');
  }
  document.getElementById('successFileUrl').href = urlPlanilla || '#';
  document.getElementById('paso2').classList.remove('active');
  document.getElementById('pasoExito').style.display = 'block';
  renderSteps(3);
}

// ── Nuevo plan ──

function nuevoPlan() {
  planCreado    = null;
  codigoBase    = '';
  grupoContador = 0;
  for (const k in grupoRefs) delete grupoRefs[k];
  document.getElementById('gruposContainer').innerHTML     = '';
  document.getElementById('btnCargarViajes').style.display = 'none';
  document.getElementById('pasoExito').style.display       = 'none';
  document.getElementById('formPlan').reset();
  document.getElementById('errorPlan').textContent         = '';
  transicionarPaso(1);
}

// ── Navegación ──

function transicionarPaso(paso) {
  document.querySelectorAll('.paso').forEach(p => p.classList.remove('active'));
  if (paso === 1) {
    document.getElementById('paso1').classList.add('active');
  } else if (paso === 2) {
    document.getElementById('paso2').classList.add('active');
    document.getElementById('resumenNombrePlan').textContent = planCreado.nombre;
    document.getElementById('resumenFecha').textContent      = planCreado.fecha;
    document.getElementById('resumenEsquema').textContent    = planCreado.schemaCode;
  }
  renderSteps(paso);
}

function renderSteps(activo) {
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    if      (i + 1 < activo)  s.classList.add('done');
    else if (i + 1 === activo) s.classList.add('active');
  });
}

// ── Sidebar ──

function abrirSidebar() {
  document.getElementById('sidebarOverlay').classList.add('open');
  document.getElementById('sidebarNavPanel').classList.add('open');
}
function cerrarSidebar() {
  document.getElementById('sidebarOverlay').classList.remove('open');
  document.getElementById('sidebarNavPanel').classList.remove('open');
}
function toggleSidebarSync() {
  const panel = document.getElementById('sbSyncPanel');
  const arrow = document.getElementById('sbSyncArrow');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
}
function toggleSyncPanel() {
  const panel = document.getElementById('syncPanelContent');
  const arrow = document.getElementById('syncToggleArrow');
  panel.classList.toggle('open');
  if (arrow) arrow.textContent = panel.classList.contains('open') ? '▲' : '▼';
}
function toggleSyncPanel2() {
  const panel = document.getElementById('syncPanelContent2');
  const arrow = document.getElementById('syncToggleArrow2');
  panel.classList.toggle('open');
  if (arrow) arrow.textContent = panel.classList.contains('open') ? '▲' : '▼';
}

// ── Sync + refrescar ──

async function syncViajesDatos(accion, badgeId, btnId) {
  const btn   = document.getElementById(btnId);
  const badge = document.getElementById(badgeId);
  if (!btn) return;
  setLoading(btn, true);
  if (badge) badge.textContent = '';
  try {
    const res = await gasCall(accion);
    if (res.ok) {
      if (badge) badge.textContent = '✓ ' + (res.count || '');
      localStorage.removeItem(CACHE_KEY);
      const nuevosDatos = await gasCallDatosMaestros();
      if (nuevosDatos.ok !== false) {
        window.DATOS = nuevosDatos;
        guardarEnCache(nuevosDatos);
        refrescarGruposExistentes();
        mostrarToast('Datos actualizados — los desplegables ahora tienen información nueva');
      }
    } else {
      if (badge) badge.textContent = '✗';
      mostrarToast('Error: ' + (res.error || 'No se pudo sincronizar'));
    }
  } catch(e) {
    if (badge) badge.textContent = '✗';
    mostrarToast('Error de conexión');
  } finally {
    setLoading(btn, false);
  }
}

function refrescarGruposExistentes() {
  const tripOpciones = (window.DATOS.tripulantes || []).map(t => ({
    value: t.nombre_completo,
    labelCorto: t.nombre_completo,
    label: t.nombre_completo + ' — ' + t.email,
    extra: { nombre: t.nombre_completo, email: t.email }
  }));
  const dirOpciones = (window.DATOS.direcciones || []).map(d => ({
    value: d.code, labelCorto: d.code,
    label: '[' + d.code + '] — ' + (d.name || '') + ' | ' + (d.address1 || '') + ', ' + (d.city || '')
  }));

  document.querySelectorAll('#gruposContainer .card').forEach(card => {
    const idx  = Number(card.dataset.idx);
    const refs = grupoRefs[idx];
    if (!refs) return;

    const msC = document.getElementById(`ms-costo-${idx}`);
    const msI = document.getElementById(`ms-ingreso-${idx}`);
    const prevCosto   = msC ? JSON.parse(msC.dataset.selected || '[]') : [];
    const prevIngreso = msI ? JSON.parse(msI.dataset.selected || '[]') : [];

    if (refs.veh) refs.veh.setOpciones((window.DATOS.flota || [])
      .filter(v => v.is_active === true || String(v.is_active).toLowerCase() === 'true')
      .map(v => ({
        value: v.code, labelCorto: v.code,
        label: v.code + (v.description ? ' — ' + v.description : '') + ' | ' + (v.employer_name || 'Sin empleador')
      })));

    if (refs.arr) refs.arr.setOpciones((window.DATOS.arrastres || []).map(a => {
      const vals = Object.values(a);
      const v = String(vals[0] || '');
      return { value: v, label: v + (vals[1] ? ' — ' + vals[1] : '') };
    }));

    if (refs.prov) refs.prov.setOpciones((window.DATOS.socios || [])
      .filter(s => String(s.type || '').toLowerCase() === 'supplier')
      .map(s => ({ value: s.name || '', label: s.name || '' })));

    if (refs.ruta) refs.ruta.setOpciones(getRutasOpciones(refs.prov ? refs.prov.getValue() : ''));

    if (refs.cond)  refs.cond.setOpciones(tripOpciones);
    if (refs.cond2) refs.cond2.setOpciones(tripOpciones);

    (refs.paradas || []).forEach(p => p.dir.setOpciones(dirOpciones));

    const vCode   = refs.veh?.getValue();
    const pNombre = refs.prov?.getValue();

    if (vCode) {
      actualizarEtiquetasCosto(idx, vCode);
      _restaurarMultiSelect(`ms-costo-${idx}`, prevCosto);
    }
    if (pNombre) {
      actualizarEtiquetasIngreso(idx, pNombre);
      _restaurarMultiSelect(`ms-ingreso-${idx}`, prevIngreso);
    }
  });
}

function _restaurarMultiSelect(msId, prevSelected) {
  if (!prevSelected.length) return;
  const ms = msRefs[msId];
  if (ms) ms.setSeleccion(prevSelected);
}

// ── Toast ──

function mostrarToast(msg) {
  const toast = document.getElementById('toastNotif');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── Cambiar contraseña ──

function abrirCambiarPassModal() {
  cerrarSidebar();
  document.getElementById('formCambiarPass').reset();
  document.getElementById('cpMsg').textContent = '';
  document.getElementById('cpMsg').className   = '';
  document.getElementById('modalCambiarPass').classList.add('active');
}
function cerrarCambiarPassModal() {
  document.getElementById('modalCambiarPass').classList.remove('active');
}
async function submitCambiarPass(e) {
  e.preventDefault();
  const actual   = document.getElementById('cpActual').value;
  const nuevo    = document.getElementById('cpNuevo').value;
  const confirma = document.getElementById('cpConfirma').value;
  const btn      = document.getElementById('btnCambiarPassViajes');
  const msgEl    = document.getElementById('cpMsg');
  msgEl.textContent = ''; msgEl.className = '';
  if (nuevo !== confirma) { msgEl.textContent = 'Las contraseñas nuevas no coinciden.'; msgEl.className = 'error-msg'; return; }
  setLoading(btn, true);
  try {
    const res = await gasCall('changePassword', { passwordActual: actual, passwordNuevo: nuevo });
    if (res.ok) { cerrarCambiarPassModal(); mostrarToast('Contraseña actualizada correctamente'); }
    else { msgEl.textContent = res.error || 'No se pudo cambiar la contraseña.'; msgEl.className = 'error-msg'; }
  } catch(err) {
    msgEl.textContent = 'Error de conexión.'; msgEl.className = 'error-msg';
  } finally {
    setLoading(btn, false);
  }
}

// Cerrar dropdowns al hacer scroll
document.addEventListener('scroll', function() {
  document.querySelectorAll('.dropdown-list.open').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.multi-dropdown.open').forEach(el => el.classList.remove('open'));
}, { capture: true, passive: true });
