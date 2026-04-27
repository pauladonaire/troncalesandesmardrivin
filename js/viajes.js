// viajes.js

let SESSION    = null;
let planCreado = null;
let codigoDespacho = '';
const filaRefs = {}; // { idx: { dir, veh, arr, prov, ruta, cond, cond2, rutaFiltro } }
const msRefs   = {}; // { 'ms-costo-1': multiSelectRef, 'ms-ingreso-1': multiSelectRef }

document.addEventListener('DOMContentLoaded', async () => {
  SESSION = requireSession();
  if (!SESSION) return;
  document.getElementById('userName').textContent     = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;
  document.getElementById('initLoader').style.display = 'flex';
  document.getElementById('contenido').style.display  = 'none';
  const loaderTxt = document.getElementById('initLoaderTxt');
  if (loaderTxt) loaderTxt.textContent = 'Conectando...';
  try {
    const t0 = Date.now();
    if (loaderTxt) loaderTxt.textContent = 'Cargando datos maestros...';
    const res = await gasCall('getDatosMaestros');
    if (res.ok === false) throw new Error(res.error || 'Error al cargar datos maestros');
    window.DATOS = res;
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('Datos maestros en ' + seg + 's' + (res.fromCache ? ' (caché)' : ' (Sheets)'));
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('contenido').style.display  = 'block';
    inicializarPaso1();
    _mostrarResumenDatos(res);
  } catch (e) {
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('initError').textContent    = 'Error al cargar datos: ' + e.message;
    document.getElementById('initError').style.display  = 'block';
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

  // Sync visible para TODOS los roles (Mejora 6/14)
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
  if (SESSION.rol === 'OPERACION_TRAFICO') {
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('fechaViaje').min      = hoy;
    document.getElementById('fechaMaxEntrega').min = hoy;
  }
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
  transicionarPaso(2);
}

// ── PASO 2 ──

function generarFilas() {
  const cantidad = parseInt(document.getElementById('cantidadFilas').value, 10);
  if (!cantidad || cantidad < 1 || cantidad > 50) { alert('Ingresá una cantidad entre 1 y 50.'); return; }
  for (const k in filaRefs) delete filaRefs[k];
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  codigoDespacho = `${String(now.getFullYear()).slice(-2)}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${SESSION.iniciales}`;
  const tbody = document.getElementById('tripsTbody');
  tbody.innerHTML = '';
  for (let i = 0; i < cantidad; i++) tbody.appendChild(crearFila(i));
  document.getElementById('tablaSection').style.display    = 'block';
  document.getElementById('btnCargarViajes').style.display = 'inline-flex';
  document.getElementById('validacionError').style.display = 'none';
}

function crearFila(idx) {
  const tr = document.createElement('tr');
  tr.dataset.idx = idx;
  tr.innerHTML = `
    <td class="col-del"><button class="btn-del-row" onclick="eliminarFila(this)" title="Eliminar fila">×</button></td>
    <td class="col-despacho"><input type="text" class="f-despacho" value="${escapeHtml(codigoDespacho + '-' + (idx + 1))}" readonly></td>
    <td class="col-alt"><input type="text" class="f-alt" data-campo="codigoAlternativo" placeholder="*"></td>
    <td class="col-uni"><input type="number" class="f-uni1" min="1" step="1" placeholder="*"></td>
    <td class="col-uni"><input type="number" class="f-uni2" min="0" step="1" placeholder="0"></td>
    <td class="col-uni"><input type="number" class="f-uni3" min="0" step="1" placeholder="0"></td>
    <td class="col-dir"      id="td-dir-${idx}"></td>
    <td class="col-vehiculo" id="td-veh-${idx}"></td>
    <td class="col-arrastre" id="td-arr-${idx}"></td>
    <td class="col-empleador" id="td-emp-${idx}"><span class="empleador-value text-muted">—</span></td>
    <td class="col-etiqueta"  id="td-costo-${idx}"><span class="no-etiquetas text-muted">—</span></td>
    <td class="col-proveedor" id="td-prov-${idx}"></td>
    <td class="col-etiqueta"  id="td-ingreso-${idx}"><span class="no-etiquetas text-muted">—</span></td>
    <td class="col-ruta"      id="td-ruta-${idx}"></td>
    <td class="col-conductor" id="td-cond-${idx}"></td>
    <td class="col-conductor" id="td-cond2-${idx}"></td>
    <td class="col-descripcion"><input type="text" class="f-desc" placeholder="Opcional"></td>
  `;

  const refs = { rutaFiltro: '' };

  refs.dir = crearDropdownBuscable({
    inputClass:  'f-dir',
    placeholder: 'Buscar dirección... *',
    opcionesFn:  () => (window.DATOS.direcciones || []).map(d => ({
      value: d.code, labelCorto: d.code,
      label: `[${d.code}] — ${d.name} | ${d.address1}, ${d.city}`
    }))
  });

  refs.veh = crearDropdownBuscable({
    inputClass:   'f-vehiculo',
    placeholder:  'Buscar vehículo... *',
    opcionesFn:   () => (window.DATOS.flota || []).map(v => ({
      value: v.code,
      label: `${v.code}${v.description ? ' — ' + v.description : ''} | ${v.employer_name || 'Sin empleador'}`
    })),
    deshabilitadosFn: () => Object.keys(filaRefs)
      .filter(k => Number(k) !== idx)
      .map(k => filaRefs[k]?.veh?.getValue())
      .filter(Boolean),
    onChange: (value) => onVehiculoChange(idx, value)
  });

  refs.arr = crearDropdownBuscable({
    inputClass:  'f-arrastre',
    placeholder: '— arrastre —',
    opcionesFn:  () => (window.DATOS.arrastres || []).map(a => {
      const vals = Object.values(a);
      const v = String(vals[0] || '');
      return { value: v, label: v + (vals[1] ? ' — ' + vals[1] : '') };
    })
  });

  refs.prov = crearDropdownBuscable({
    inputClass:  'f-proveedor',
    placeholder: 'Buscar proveedor... *',
    opcionesFn:  () => (window.DATOS.socios || [])
      .filter(s => String(s.type || '').toLowerCase() === 'supplier')
      .map(s => ({ value: s.name || '', label: s.name || '' })),
    onChange: (value) => onProveedorChange(idx, value)
  });

  refs.ruta = crearDropdownBuscable({
    inputClass:  'f-ruta',
    placeholder: 'Buscar ruta... *',
    opcionesFn:  () => {
      const filtro = filaRefs[idx]?.rutaFiltro || '';
      const all = (window.DATOS.rutas || []).map(r => {
        const vals = Object.values(r);
        const nombre = String(vals[0] || '');
        const prov   = String(vals[1] || '');
        return { value: nombre, label: nombre + (prov ? ' [' + prov + ']' : ''), rutaProv: prov };
      });
      if (!filtro) return all;
      const norm = filtro.toLowerCase();
      return all.filter(r => r.rutaProv.toLowerCase() === norm || r.rutaProv === '');
    }
  });

  refs.cond = crearDropdownBuscable({
    inputClass:       'f-conductor',
    placeholder:      'Buscar conductor... *',
    opcionesFn:       () => (window.DATOS.tripulantes || []).map(t => ({
      value: t.nombre_completo, labelCorto: t.nombre_completo,
      label: t.nombre_completo + ' — ' + t.email,
      extra: { nombre: t.nombre_completo, email: t.email }
    })),
    deshabilitadosFn: () => getConductoresYaUsados(idx, 'conductor')
  });

  refs.cond2 = crearDropdownBuscable({
    inputClass:       'f-segundo',
    placeholder:      '2do conductor...',
    opcionesFn:       () => (window.DATOS.tripulantes || []).map(t => ({
      value: t.nombre_completo, labelCorto: t.nombre_completo,
      label: t.nombre_completo + ' — ' + t.email,
      extra: { nombre: t.nombre_completo, email: t.email }
    })),
    deshabilitadosFn: () => getConductoresYaUsados(idx, 'segundoConductor')
  });

  filaRefs[idx] = refs;

  tr.querySelector(`#td-dir-${idx}`).appendChild(refs.dir.wrap);
  tr.querySelector(`#td-veh-${idx}`).appendChild(refs.veh.wrap);
  tr.querySelector(`#td-arr-${idx}`).appendChild(refs.arr.wrap);
  tr.querySelector(`#td-prov-${idx}`).appendChild(refs.prov.wrap);
  tr.querySelector(`#td-ruta-${idx}`).appendChild(refs.ruta.wrap);
  tr.querySelector(`#td-cond-${idx}`).appendChild(refs.cond.wrap);
  tr.querySelector(`#td-cond2-${idx}`).appendChild(refs.cond2.wrap);
  return tr;
}

// ── Eliminar fila ──

function eliminarFila(btn) {
  const tr  = btn.closest('tr');
  const idx = Number(tr.dataset.idx);
  delete filaRefs[idx];
  tr.remove();
  if (!document.querySelector('#tripsTbody tr')) {
    document.getElementById('tablaSection').style.display    = 'none';
    document.getElementById('btnCargarViajes').style.display = 'none';
  }
}

// ── Dropdown buscable unificado (Mejora 9) ──

function crearDropdownBuscable({ inputClass = '', placeholder = '', opcionesFn, onChange = null, deshabilitadosFn = null }) {
  const wrap  = document.createElement('div');
  wrap.className = 'dropdown-wrap';

  const input = document.createElement('input');
  input.type         = 'text';
  input.className    = 'dropdown-input' + (inputClass ? ' ' + inputClass : '');
  input.placeholder  = placeholder;
  input.autocomplete = 'off';
  input.dataset.value = '';

  const list = document.createElement('div');
  list.className = 'dropdown-list';

  function poblar(q) {
    list.innerHTML = '';
    const opciones      = opcionesFn ? opcionesFn() : [];
    const deshabilitados = deshabilitadosFn ? deshabilitadosFn() : [];
    const norm      = q.trim().toLowerCase();
    const filtradas = norm ? opciones.filter(o => o.label.toLowerCase().includes(norm)) : opciones;

    if (!filtradas.length) {
      const el = document.createElement('div');
      el.className = 'dropdown-option no-results';
      el.textContent = 'Sin resultados';
      list.appendChild(el);
      return;
    }
    filtradas.slice(0, 120).forEach(opcion => {
      const el       = document.createElement('div');
      const disabled = deshabilitados.includes(opcion.value);
      el.className   = 'dropdown-option' + (disabled ? ' disabled' : '');
      el.textContent = opcion.label;
      if (disabled) {
        el.title = 'Ya seleccionado en otra fila';
      } else {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          input.dataset.value = opcion.value;
          input.value = opcion.labelCorto || opcion.label;
          if (opcion.extra !== undefined) input.dataset.extra = JSON.stringify(opcion.extra);
          list.classList.remove('open');
          input.classList.remove('error');
          if (onChange) onChange(opcion.value, opcion.label, opcion);
        });
      }
      list.appendChild(el);
    });
  }

  input.addEventListener('focus', () => { poblar(input.value); abrirDropdown(input, list); });
  input.addEventListener('input', () => { input.dataset.value = ''; poblar(input.value); abrirDropdown(input, list); });
  input.addEventListener('blur',  () => setTimeout(() => {
    list.classList.remove('open');
    if (!input.dataset.value) input.value = '';
  }, 160));

  wrap.appendChild(input);
  wrap.appendChild(list);

  return {
    wrap,
    input,
    getValue:   () => input.dataset.value || '',
    getExtra:   () => { try { return JSON.parse(input.dataset.extra || '{}'); } catch { return {}; } },
    setValue:   (v, label) => { input.dataset.value = v; input.value = label || v; },
    clearValue: () => { input.dataset.value = ''; input.value = ''; }
  };
}

function abrirDropdown(inputEl, listaEl) {
  const rect = inputEl.getBoundingClientRect();
  listaEl.style.top   = (rect.bottom + 2) + 'px';
  listaEl.style.left  = rect.left + 'px';
  listaEl.style.width = Math.max(rect.width, 240) + 'px';
  listaEl.classList.add('open');
}

// ── Conductores sin duplicar (Mejora 16) ──

function getConductoresYaUsados(filaIdx, campo) {
  const usados = new Set();
  Object.keys(filaRefs).forEach(k => {
    const i = Number(k);
    const r = filaRefs[i];
    if (!r) return;
    const c1 = r.cond?.getValue();
    const c2 = r.cond2?.getValue();
    if (i === filaIdx) {
      if (campo === 'conductor'       && c2) usados.add(c2);
      if (campo === 'segundoConductor' && c1) usados.add(c1);
    } else {
      if (c1) usados.add(c1);
      if (c2) usados.add(c2);
    }
  });
  return Array.from(usados);
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
  const td  = document.getElementById('td-emp-' + idx);
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

function getEmpleadorDeFila(idx) {
  return document.getElementById('td-emp-' + idx)?.dataset.empleador || '';
}

// ── Vigencia (Mejora 15) ──

function estaVigente(vigenciaDesde, vigenciaHasta) {
  if (!vigenciaDesde || !vigenciaHasta) return false;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const desde = parsearFecha(vigenciaDesde);
  const hasta  = parsearFecha(vigenciaHasta);
  if (!desde || !hasta) return false;
  return hoy >= desde && hoy <= hasta;
}

function parsearFecha(valor) {
  if (!valor) return null;
  const str = String(valor).trim();
  const m1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return new Date(+m1[3], +m1[2] - 1, +m1[1]);
  const m2 = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// ── Etiquetas Costo — vehículo → employer → col M(12) → col AA(26) (Mejora 7) ──

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
  const items = (window.DATOS.esquemasCostos || []).slice(1)
    .filter(r => String(r[12] || '').trim().toLowerCase() === norm)
    .map(r => ({ etiqueta: String(r[26] || '').trim(), vigenciaDesde: r[22] || '', vigenciaHasta: r[23] || '' }))
    .filter(e => e.etiqueta !== '');
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

// ── Etiquetas Ingreso — proveedor → col L(11) → col AA(26) (Mejora 7) ──

function actualizarEtiquetasIngreso(idx, proveedorNombre) {
  const td = document.getElementById('td-ingreso-' + idx);
  if (!td) return;
  td.innerHTML = '';
  if (!proveedorNombre) {
    td.innerHTML = '<span class="no-etiquetas text-muted">Seleccioná un proveedor primero</span>';
    return;
  }
  const norm  = proveedorNombre.trim().toLowerCase();
  const items = (window.DATOS.esquemasIngresos || []).slice(1)
    .filter(r => String(r[11] || '').trim().toLowerCase() === norm)
    .map(r => ({ etiqueta: String(r[26] || '').trim(), vigenciaDesde: r[22] || '', vigenciaHasta: r[23] || '' }))
    .filter(e => e.etiqueta !== '');
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

// ── Proveedor change → ingreso + rutas (Mejoras 7+8) ──

function onProveedorChange(idx, prov) {
  actualizarEtiquetasIngreso(idx, prov);
  if (filaRefs[idx]) filaRefs[idx].rutaFiltro = prov;
}

// ── Multi-select (Mejora 15 — reescritura completa) ──

function crearMultiSelect({ opciones = [], placeholder = 'Seleccionar...', mensajeVacio = 'Sin opciones disponibles', onChange = () => {} }) {

  // Cada opción puede ser string o { etiqueta, vigenciaDesde, vigenciaHasta }
  function getEtiqueta(op) { return typeof op === 'object' ? op.etiqueta : op; }
  function getVigente(op)  { return typeof op !== 'object' || estaVigente(op.vigenciaDesde, op.vigenciaHasta); }

  let seleccionadas    = [];
  let opcionesActuales = [...opciones];

  const contenedor = document.createElement('div');
  contenedor.className = 'ms-contenedor';

  const pillsDiv = document.createElement('div');
  pillsDiv.className = 'ms-pills';
  contenedor.appendChild(pillsDiv);

  const trigger = document.createElement('div');
  trigger.className   = 'ms-trigger';
  trigger.textContent = placeholder;
  contenedor.appendChild(trigger);

  // Panel va al body para evitar clipping por overflow de la tabla
  const panel = document.createElement('div');
  panel.className      = 'ms-panel';
  panel.style.display  = 'none';
  document.body.appendChild(panel);

  function renderPills() {
    pillsDiv.innerHTML = '';
    seleccionadas.forEach(val => {
      const opcion  = opcionesActuales.find(o => getEtiqueta(o) === val);
      const vigente = opcion ? getVigente(opcion) : true;
      const pill  = document.createElement('span');
      pill.className = 'ms-pill' + (vigente ? '' : ' ms-pill--vencida');
      if (!vigente) pill.title = 'Fuera de período de vigencia';
      const texto = document.createElement('span');
      texto.textContent = val;
      const x = document.createElement('span');
      x.className   = 'ms-pill-x';
      x.textContent = '×';
      x.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        seleccionadas = seleccionadas.filter(s => s !== val);
        renderPills();
        renderPanel();
        onChange([...seleccionadas]);
      });
      pill.appendChild(texto);
      pill.appendChild(x);
      pillsDiv.appendChild(pill);
    });
    trigger.textContent = seleccionadas.length === 0 ? placeholder : seleccionadas.length + ' seleccionada(s)';
  }

  function renderPanel() {
    panel.innerHTML = '';
    if (opcionesActuales.length === 0) {
      const msg = document.createElement('div');
      msg.className   = 'ms-vacio';
      msg.textContent = mensajeVacio;
      panel.appendChild(msg);
      return;
    }
    opcionesActuales.forEach(opcion => {
      const etiqueta = getEtiqueta(opcion);
      const vigente  = getVigente(opcion);
      const item     = document.createElement('label');
      item.className = 'ms-item';
      if (!vigente) item.title = 'Fuera de período de vigencia';
      const checkbox = document.createElement('input');
      checkbox.type      = 'checkbox';
      checkbox.className = 'ms-checkbox' + (vigente ? '' : ' ms-checkbox--vencido');
      checkbox.value     = etiqueta;
      checkbox.checked   = seleccionadas.includes(etiqueta);
      checkbox.addEventListener('change', function() {
        if (checkbox.checked) {
          if (!seleccionadas.includes(etiqueta)) seleccionadas.push(etiqueta);
        } else {
          seleccionadas = seleccionadas.filter(s => s !== etiqueta);
        }
        renderPills();
        onChange([...seleccionadas]);
      });
      const labelTexto     = document.createElement('span');
      labelTexto.className = 'ms-item-texto' + (vigente ? '' : ' ms-item-texto--vencida');
      labelTexto.textContent = etiqueta;
      item.appendChild(checkbox);
      item.appendChild(labelTexto);
      panel.appendChild(item);
    });
  }

  function posicionar() {
    const rect         = trigger.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top      = (rect.bottom + 4) + 'px';
    panel.style.left     = rect.left + 'px';
    panel.style.width    = Math.max(rect.width, 260) + 'px';
    panel.style.zIndex   = '9999';
  }

  function abrir() {
    renderPanel();
    posicionar();
    panel.style.display = 'block';
  }

  function cerrar() {
    panel.style.display = 'none';
  }

  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    if (panel.style.display === 'none') { abrir(); } else { cerrar(); }
  });

  document.addEventListener('click', function(e) {
    if (!contenedor.contains(e.target) && !panel.contains(e.target)) cerrar();
  });

  window.addEventListener('scroll', function() {
    if (panel.style.display !== 'none') posicionar();
  }, true);

  renderPills();

  return {
    contenedor,
    getValores:   () => [...seleccionadas],
    setOpciones:  function(nuevasOpciones) {
      opcionesActuales = [...nuevasOpciones];
      seleccionadas    = seleccionadas.filter(s => opcionesActuales.some(o => getEtiqueta(o) === s));
      renderPills();
      if (panel.style.display !== 'none') renderPanel();
    },
    setSeleccion: function(vals) {
      seleccionadas = vals.filter(v => opcionesActuales.some(o => getEtiqueta(o) === v));
      renderPills();
      onChange([...seleccionadas]);
    },
    reset: function() {
      seleccionadas    = [];
      opcionesActuales = [];
      renderPills();
      cerrar();
    }
  };
}

// ── Validación (Mejoras 5+18) ──

function validarFilas() {
  let ok = true;
  document.querySelectorAll('#tripsTbody tr').forEach(tr => {
    const idx  = Number(tr.dataset.idx);
    const refs = filaRefs[idx] || {};

    const altEl = tr.querySelector('.f-alt');
    toggleError(altEl, !altEl?.value?.trim()) && (ok = false);

    const uni1 = tr.querySelector('.f-uni1');
    toggleError(uni1, !uni1?.value || parseInt(uni1.value, 10) < 1) && (ok = false);

    toggleError(refs.dir?.input,  !refs.dir?.getValue())  && (ok = false);
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
  });
  return ok;
}

function toggleError(el, hasError) {
  if (!el) return hasError;
  el.classList.toggle('error', hasError);
  return hasError;
}

// ── Recolectar datos ──

function recolectarViajes() {
  const viajes = [];
  document.querySelectorAll('#tripsTbody tr').forEach(tr => {
    const idx   = Number(tr.dataset.idx);
    const refs  = filaRefs[idx] || {};
    const msC   = document.getElementById(`ms-costo-${idx}`);
    const msI   = document.getElementById(`ms-ingreso-${idx}`);
    const cExtra  = refs.cond?.getExtra()  || {};
    const c2Extra = refs.cond2?.getExtra() || {};
    viajes.push({
      codigoDespacho: tr.querySelector('.f-despacho')?.value || '',
      codigoAlternativo:      tr.querySelector('.f-alt')?.value  || '',
      unidades1:              tr.querySelector('.f-uni1')?.value  || '',
      unidades2:              tr.querySelector('.f-uni2')?.value  || '',
      unidades3:              tr.querySelector('.f-uni3')?.value  || '',
      codigoDireccion:        refs.dir?.getValue()                || '',
      vehiculo:               refs.veh?.getValue()                || '',
      arrastre:               refs.arr?.getValue()                || '',
      empleador:              getEmpleadorDeFila(idx),
      etiquetasCosto:         msC ? JSON.parse(msC.dataset.selected || '[]') : [],
      proveedor:              refs.prov?.getValue()               || '',
      etiquetasIngreso:       msI ? JSON.parse(msI.dataset.selected || '[]') : [],
      rutaMaestra:            refs.ruta?.getValue()               || '',
      conductorEmail:         cExtra.email                        || '',
      segundoConductorNombre: c2Extra.nombre                      || '',
      descripcionViaje:       tr.querySelector('.f-desc')?.value  || ''
    });
  });
  return viajes;
}

// ── Cargar viajes ──

function cargarViajes() {
  if (!validarFilas()) {
    const errEl = document.getElementById('validacionError');
    errEl.textContent = 'Completá los campos obligatorios marcados en rojo (*).';
    errEl.style.display = 'block';
    document.querySelector('#tripsTbody .error')?.closest('tr')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  document.getElementById('validacionError').style.display = 'none';
  const viajes = recolectarViajes();
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
  document.getElementById('successFileUrl').href = res.fileUrl || '#';
  document.getElementById('paso2').classList.remove('active');
  document.getElementById('pasoExito').style.display = 'block';
  renderSteps(3);
}

// ── Nuevo plan ──

function nuevoPlan() {
  planCreado = null;
  codigoDespacho = '';
  for (const k in filaRefs) delete filaRefs[k];
  document.getElementById('tripsTbody').innerHTML          = '';
  document.getElementById('tablaSection').style.display    = 'none';
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

// ── Sync + refrescar (Mejoras 6/14/19) ──

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
      const nuevosDatos = await gasCall('getDatosMaestros');
      if (nuevosDatos.ok !== false) {
        window.DATOS = nuevosDatos;
        refrescarFilasExistentes();
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

// Mejora 19: refrescar etiquetas preservando selección
function refrescarFilasExistentes() {
  document.querySelectorAll('#tripsTbody tr').forEach(tr => {
    const idx  = Number(tr.dataset.idx);
    const refs = filaRefs[idx];
    if (!refs) return;

    const msC = document.getElementById(`ms-costo-${idx}`);
    const msI = document.getElementById(`ms-ingreso-${idx}`);
    const prevCosto   = msC ? JSON.parse(msC.dataset.selected || '[]') : [];
    const prevIngreso = msI ? JSON.parse(msI.dataset.selected || '[]') : [];

    const vCode = refs.veh?.getValue();
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
