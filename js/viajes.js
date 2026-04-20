// viajes.js

// ── Estado global ──
let SESSION    = null;
let planCreado = null;
let codigoDespacho = '';
const vehiculosEnUso = {};  // { rowIdx: vehicleCode }

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  SESSION = requireSession();
  if (!SESSION) return;

  document.getElementById('userName').textContent     = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;

  document.getElementById('initLoader').style.display = 'flex';
  document.getElementById('contenido').style.display  = 'none';
  try {
    const res = await gasCall('getDatosMaestros');
    if (res.ok === false) throw new Error(res.error || 'Error al cargar datos maestros');
    window.DATOS = res;
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('contenido').style.display  = 'block';
    inicializarPaso1();
  } catch (e) {
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('initError').textContent    = 'Error al cargar datos: ' + e.message;
    document.getElementById('initError').style.display  = 'block';
  }
});

// ── PASO 1 — Datos del Plan ──

function inicializarPaso1() {
  renderSteps(1);
  document.getElementById('paso1').classList.add('active');

  if (SESSION.rol === 'OPERACION_TRAFICO') {
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('fechaViaje').min      = hoy;
    document.getElementById('fechaMaxEntrega').min = hoy;
  }

  document.getElementById('formPlan').addEventListener('submit', submitCrearPlan);
}

async function submitCrearPlan(e) {
  e.preventDefault();
  const btn    = document.getElementById('btnCrearPlan');
  const errEl  = document.getElementById('errorPlan');
  errEl.textContent = '';

  const fecha      = document.getElementById('fechaViaje').value;
  const nombre     = document.getElementById('nombrePlan').value.trim();
  const pais       = document.getElementById('pais').value;
  const fechaMax   = document.getElementById('fechaMaxEntrega').value;
  const schemaCode = pais === 'argentina' ? 'CL-ARG' : 'CL-CHILE';

  setLoading(btn, true);
  try {
    const res = await gasCall('crearPlanDrivin', {
      planDatos: { description: nombre, date: fecha, schema_code: schemaCode }
    });
    if (!res.ok) throw new Error(res.error || 'Error al crear plan en Driv.in');

    planCreado = { id: res.response?.id || '', nombre, fecha, fechaMaxEntrega: fechaMax, schemaCode, pais };
    transicionarPaso(2);
  } catch (e) {
    errEl.textContent = e.message;
  } finally {
    setLoading(btn, false);
  }
}

// ── PASO 2 — Tabla de viajes ──

function generarFilas() {
  const cantidad = parseInt(document.getElementById('cantidadFilas').value, 10);
  if (!cantidad || cantidad < 1 || cantidad > 50) {
    alert('Ingresá una cantidad entre 1 y 50.');
    return;
  }

  for (const k in vehiculosEnUso) delete vehiculosEnUso[k];

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  codigoDespacho = `${String(now.getFullYear()).slice(-2)}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${cantidad}-${SESSION.iniciales}`;

  const tbody = document.getElementById('tripsTbody');
  tbody.innerHTML = '';
  for (let i = 0; i < cantidad; i++) tbody.appendChild(crearFila(i));

  // Poblar vehículos después de crear filas
  document.querySelectorAll('.f-vehiculo').forEach((sel, i) => poblarSelectVehiculo(sel, i));

  document.getElementById('tablaSection').style.display    = 'block';
  document.getElementById('btnCargarViajes').style.display = 'inline-flex';
  document.getElementById('validacionError').style.display = 'none';
}

function crearFila(idx) {
  const tr = document.createElement('tr');
  tr.dataset.idx = idx;

  // Col 8 — Arrastre opciones
  const optsArrastre = (window.DATOS.arrastres || []).map(a => {
    const val = Object.values(a)[0] || '';
    return `<option value="${escapeHtml(val)}">${escapeHtml(val)}</option>`;
  }).join('');

  // Col 11 — Proveedor opciones (socios tipo supplier)
  const optsSocios = (window.DATOS.socios || [])
    .filter(s => String(s.type || '').toLowerCase() === 'supplier')
    .map(s => `<option value="${escapeHtml(s.name||'')}">${escapeHtml(s.name||'')}</option>`)
    .join('');

  // Col 13 — Ruta Maestra opciones
  const optsRutas = (window.DATOS.rutas || []).map(r => {
    const vals  = Object.values(r);
    const nombre = String(vals[0] || '');
    const prov   = String(vals[1] || '');
    return `<option value="${escapeHtml(nombre)}" data-proveedor="${escapeHtml(prov)}">${escapeHtml(nombre)}</option>`;
  }).join('');

  tr.innerHTML = `
    <td class="col-despacho">
      <input type="text" value="${escapeHtml(codigoDespacho)}" readonly>
    </td>
    <td class="col-alt">
      <input type="text" class="f-alt" placeholder="Opcional">
    </td>
    <td class="col-uni">
      <input type="number" class="f-uni1" min="1" step="1" placeholder="*">
    </td>
    <td class="col-uni">
      <input type="number" class="f-uni2" min="0" step="1" placeholder="0">
    </td>
    <td class="col-uni">
      <input type="number" class="f-uni3" min="0" step="1" placeholder="0">
    </td>
    <td class="col-dir"      id="td-dir-${idx}"></td>
    <td class="col-vehiculo">
      <select class="f-vehiculo" onchange="onVehiculoChange(${idx}, this)">
        <option value="">— vehículo —</option>
      </select>
    </td>
    <td class="col-arrastre">
      <select class="f-arrastre">
        <option value="">—</option>
        ${optsArrastre}
      </select>
    </td>
    <td class="col-empleador" id="td-emp-${idx}">
      <span class="empleador-value text-muted">—</span>
    </td>
    <td class="col-etiqueta"  id="td-costo-${idx}">
      <span class="no-etiquetas">—</span>
    </td>
    <td class="col-proveedor">
      <select class="f-proveedor" onchange="onProveedorChange(${idx}, this)">
        <option value="">—</option>
        ${optsSocios}
      </select>
    </td>
    <td class="col-etiqueta"  id="td-ingreso-${idx}">
      <span class="no-etiquetas">—</span>
    </td>
    <td class="col-ruta"      id="td-ruta-${idx}">
      <select class="f-ruta">
        <option value="">—</option>
        ${optsRutas}
      </select>
    </td>
    <td class="col-conductor" id="td-cond-${idx}"></td>
    <td class="col-conductor" id="td-cond2-${idx}"></td>
    <td class="col-descripcion">
      <input type="text" class="f-desc" placeholder="Opcional">
    </td>
  `;

  tr.querySelector(`#td-dir-${idx}`).appendChild(crearDropdownDir(idx));
  tr.querySelector(`#td-cond-${idx}`).appendChild(crearDropdownConductor(idx, 'cond'));
  tr.querySelector(`#td-cond2-${idx}`).appendChild(crearDropdownConductor(idx, 'cond2'));
  return tr;
}

// ── Dropdowns de búsqueda ──

function crearDropdownDir(idx) {
  return crearDropdownBusqueda({
    inputClass:  'f-dir',
    placeholder: 'Buscar dirección... *',
    items:       window.DATOS.direcciones || [],
    labelFn:     d => `[${d.code}] — ${d.name} | ${d.address1}, ${d.city}, ${d.state}`,
    valueFn:     d => d.code
  });
}

function crearDropdownConductor(idx, tipo) {
  return crearDropdownBusqueda({
    inputClass:  tipo === 'cond' ? 'f-conductor' : 'f-segundo',
    placeholder: tipo === 'cond' ? 'Buscar conductor... *' : 'Buscar 2do conductor...',
    items:       window.DATOS.tripulantes || [],
    labelFn:     t => t.nombre_completo,
    valueFn:     t => t.nombre_completo,
    extraFn:     t => JSON.stringify({ nombre: t.nombre_completo, email: t.email })
  });
}

function crearDropdownBusqueda({ inputClass, placeholder, items, labelFn, valueFn, extraFn }) {
  const wrap  = document.createElement('div');
  wrap.className = 'dropdown-wrap';

  const input = document.createElement('input');
  input.type          = 'text';
  input.className     = 'dropdown-input ' + (inputClass || '');
  input.placeholder   = placeholder;
  input.dataset.value = '';
  if (extraFn) input.dataset.extra = '{}';

  const list = document.createElement('div');
  list.className = 'dropdown-list';

  function poblar(q) {
    list.innerHTML = '';
    const filtrados = q
      ? items.filter(item => labelFn(item).toLowerCase().includes(q.toLowerCase()))
      : items;

    if (!filtrados.length) {
      const el = document.createElement('div');
      el.className   = 'dropdown-option no-results';
      el.textContent = 'Sin resultados';
      list.appendChild(el);
      return;
    }
    filtrados.slice(0, 100).forEach(item => {
      const el = document.createElement('div');
      el.className   = 'dropdown-option';
      el.textContent = labelFn(item);
      el.addEventListener('mousedown', () => {
        input.value         = valueFn(item);
        input.dataset.value = valueFn(item);
        if (extraFn) input.dataset.extra = extraFn(item);
        list.classList.remove('open');
        input.classList.remove('error');
      });
      list.appendChild(el);
    });
  }

  input.addEventListener('focus', () => { poblar(input.value); list.classList.add('open'); });
  input.addEventListener('input', () => { poblar(input.value); list.classList.add('open'); });
  input.addEventListener('blur',  () => setTimeout(() => list.classList.remove('open'), 160));

  wrap.appendChild(input);
  wrap.appendChild(list);
  return wrap;
}

// ── Vehículos con exclusividad ──

function poblarSelectVehiculo(sel, idx) {
  const actual = vehiculosEnUso[idx] || '';
  sel.innerHTML = '<option value="">— vehículo —</option>';
  (window.DATOS.flota || []).forEach(v => {
    const enUso = Object.entries(vehiculosEnUso).some(([k, c]) => Number(k) !== idx && c === v.code);
    if (!enUso || v.code === actual) {
      const opt      = document.createElement('option');
      opt.value      = v.code;
      opt.textContent = v.code + (v.name ? ` — ${v.name}` : '');
      if (v.code === actual) opt.selected = true;
      sel.appendChild(opt);
    }
  });
}

function refrescarTodosVehiculos() {
  document.querySelectorAll('.f-vehiculo').forEach((sel, i) => poblarSelectVehiculo(sel, i));
}

function onVehiculoChange(idx, sel) {
  const code = sel.value;
  if (code) vehiculosEnUso[idx] = code;
  else      delete vehiculosEnUso[idx];
  refrescarTodosVehiculos();
  actualizarEmpleador(idx, code);
  actualizarEtiquetasCosto(idx, code);
  actualizarEtiquetasIngreso(idx);
}

// ── Empleador ──

function getEmpleadorDeVehiculo(code) {
  if (!code) return '';
  const v = (window.DATOS.flota || []).find(v => v.code === code);
  return v ? (v.employer_name || '') : '';
}

function actualizarEmpleador(idx, code) {
  const td  = document.getElementById('td-emp-' + idx);
  if (!td) return;
  const emp = getEmpleadorDeVehiculo(code);
  if (!code) {
    td.innerHTML = '<span class="empleador-value text-muted">—</span>';
  } else if (emp) {
    td.innerHTML = `<span class="empleador-value text-muted">${escapeHtml(emp)}</span>`;
    td.dataset.empleador = emp;
  } else {
    td.innerHTML = `<div class="empleador-warn">⚠ Sin employer — actualizar en Driv.in</div>`;
    td.dataset.empleador = '';
  }
}

function getEmpleadorDeFila(idx) {
  const td = document.getElementById('td-emp-' + idx);
  if (!td) return '';
  return td.dataset.empleador || '';
}

// ── Etiquetas Costo (col M idx 12 → employer, col AA idx 26 → etiqueta) ──

function actualizarEtiquetasCosto(idx, vehiculoCode) {
  const td  = document.getElementById('td-costo-' + idx);
  if (!td) return;
  const emp = getEmpleadorDeVehiculo(vehiculoCode);
  const items = (window.DATOS.esquemasCostos || []).slice(1)
    .filter(r => emp && String(r[12] || '').toLowerCase() === emp.toLowerCase())
    .map(r => String(r[26] || ''))
    .filter(Boolean);

  td.innerHTML = '';
  if (!items.length) {
    td.innerHTML = '<span class="no-etiquetas text-muted">Sin costos cargados</span>';
    return;
  }
  td.appendChild(crearMultiSelect(idx, 'costo', items));
}

// ── Etiquetas Ingreso (col L idx 11 → employer, col AA idx 26 → etiqueta) ──

function actualizarEtiquetasIngreso(idx) {
  const td  = document.getElementById('td-ingreso-' + idx);
  if (!td) return;
  const emp = getEmpleadorDeFila(idx);
  const items = (window.DATOS.esquemasIngresos || []).slice(1)
    .filter(r => emp && String(r[11] || '').toLowerCase() === emp.toLowerCase())
    .map(r => String(r[26] || ''))
    .filter(Boolean);

  td.innerHTML = '';
  if (!items.length) {
    td.innerHTML = '<span class="no-etiquetas text-muted">Sin tarifa cargada</span>';
    return;
  }
  td.appendChild(crearMultiSelect(idx, 'ingreso', items));
}

// ── Multi-select con pills ──

function crearMultiSelect(idx, tipo, items) {
  const wrap = document.createElement('div');
  wrap.className    = 'multi-select-wrap';
  wrap.id           = `ms-${tipo}-${idx}`;
  wrap.dataset.selected = '[]';

  const pills = document.createElement('div');
  pills.className = 'multi-pills';

  const ph = document.createElement('span');
  ph.className   = 'pills-placeholder';
  ph.textContent = 'Seleccionar...';
  pills.appendChild(ph);

  const dropdown = document.createElement('div');
  dropdown.className = 'multi-dropdown';

  items.forEach(item => {
    const lbl = document.createElement('label');
    lbl.className = 'multi-option';
    const cb  = document.createElement('input');
    cb.type   = 'checkbox';
    cb.value  = item;
    cb.addEventListener('change', () => actualizarMultiSelect(wrap, pills, ph));
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + item));
    dropdown.appendChild(lbl);
  });

  pills.addEventListener('click', e => {
    if (e.target.classList.contains('pill-remove')) return;
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) dropdown.classList.remove('open');
  }, { capture: false });

  wrap.appendChild(pills);
  wrap.appendChild(dropdown);
  return wrap;
}

function actualizarMultiSelect(wrap, pills, ph) {
  const selected = Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked'))
    .map(c => c.value);
  wrap.dataset.selected = JSON.stringify(selected);
  renderPills(pills, ph, selected, wrap);
}

function renderPills(pills, ph, selected, wrap) {
  pills.innerHTML = '';
  if (!selected.length) {
    pills.appendChild(ph);
    return;
  }
  selected.forEach(val => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    const txt = document.createTextNode(val);
    const rm  = document.createElement('span');
    rm.className   = 'pill-remove';
    rm.textContent = '×';
    rm.addEventListener('click', e => {
      e.stopPropagation();
      wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.value === val) cb.checked = false;
      });
      actualizarMultiSelect(wrap, pills, ph);
    });
    pill.appendChild(txt);
    pill.appendChild(rm);
    pills.appendChild(pill);
  });
}

// ── Proveedor → filtrar Ruta Maestra ──

function onProveedorChange(idx, sel) {
  const prov  = sel.value;
  const tdRuta = document.getElementById('td-ruta-' + idx);
  if (!tdRuta) return;
  const sr = tdRuta.querySelector('.f-ruta');
  if (!sr) return;
  Array.from(sr.options).forEach(opt => {
    if (!opt.value) return;
    opt.hidden = prov ? opt.dataset.proveedor !== prov : false;
  });
  sr.value = '';
}

// ── Validación ──

function validarFilas() {
  let ok = true;
  document.querySelectorAll('#tripsTbody tr').forEach(tr => {
    const uni1 = tr.querySelector('.f-uni1');
    const dir  = tr.querySelector('.f-dir');
    const veh  = tr.querySelector('.f-vehiculo');
    const cond = tr.querySelector('.f-conductor');

    // Unidades 1
    if (!uni1?.value || parseInt(uni1.value, 10) < 1) {
      uni1?.classList.add('error'); ok = false;
    } else { uni1?.classList.remove('error'); }

    // Dirección
    if (!dir?.dataset?.value) {
      dir?.classList.add('error'); ok = false;
    } else { dir?.classList.remove('error'); }

    // Vehículo
    if (!veh?.value) {
      veh?.classList.add('error'); ok = false;
    } else { veh?.classList.remove('error'); }

    // Conductor
    if (!cond?.dataset?.value) {
      cond?.classList.add('error'); ok = false;
    } else { cond?.classList.remove('error'); }
  });
  return ok;
}

// ── Recolectar datos ──

function recolectarViajes() {
  const viajes = [];
  document.querySelectorAll('#tripsTbody tr').forEach(tr => {
    const idx  = Number(tr.dataset.idx);
    const cond = tr.querySelector('.f-conductor');
    const cond2= tr.querySelector('.f-segundo');
    const msC  = document.getElementById(`ms-costo-${idx}`);
    const msI  = document.getElementById(`ms-ingreso-${idx}`);

    const condExtra  = (() => { try { return JSON.parse(cond?.dataset?.extra || '{}'); } catch { return {}; } })();
    const cond2Extra = (() => { try { return JSON.parse(cond2?.dataset?.extra || '{}'); } catch { return {}; } })();

    viajes.push({
      codigoDespacho,
      codigoAlternativo:      tr.querySelector('.f-alt')?.value        || '',
      unidades1:              tr.querySelector('.f-uni1')?.value        || '',
      unidades2:              tr.querySelector('.f-uni2')?.value        || '',
      unidades3:              tr.querySelector('.f-uni3')?.value        || '',
      codigoDireccion:        tr.querySelector('.f-dir')?.dataset?.value || '',
      vehiculo:               tr.querySelector('.f-vehiculo')?.value    || '',
      arrastre:               tr.querySelector('.f-arrastre')?.value    || '',
      empleador:              getEmpleadorDeFila(idx),
      etiquetasCosto:         msC  ? JSON.parse(msC.dataset.selected  || '[]') : [],
      proveedor:              tr.querySelector('.f-proveedor')?.value   || '',
      etiquetasIngreso:       msI  ? JSON.parse(msI.dataset.selected  || '[]') : [],
      rutaMaestra:            tr.querySelector('.f-ruta')?.value        || '',
      conductorEmail:         condExtra.email                           || '',
      segundoConductorNombre: cond2Extra.nombre                         || '',
      descripcionViaje:       tr.querySelector('.f-desc')?.value        || ''
    });
  });
  return viajes;
}

// ── Cargar viajes (con modal confirmación) ──

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
  document.getElementById('resNViajes').textContent   = viajes.length;
  document.getElementById('resNombrePlan').textContent = planCreado.nombre;
  document.getElementById('resFecha').textContent     = planCreado.fecha;
  document.getElementById('resEsquema').textContent   = planCreado.schemaCode;
  document.getElementById('resFechaMax').textContent  = planCreado.fechaMaxEntrega;

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

async function ejecutarCarga(viajes) {
  const overlay = document.getElementById('loadingOverlay');
  const wb      = XLSX.utils.book_new();
  const headers = getHeadersExcel();
  const rows    = viajes.map(v => mapearViaje(v, planCreado, SESSION.email));
  const ws      = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, planCreado.nombre.substring(0, 31));
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

  const nombreArchivo = ('Troncales_' + planCreado.nombre + '_' + planCreado.fecha + '.xlsx')
    .replace(/[/\\?%*:|"<>]/g, '_');

  const res = await gasCall('subirExcelADrive', { base64, nombreArchivo, viajes, planDatos: planCreado });
  overlay.classList.remove('active');

  if (!res.ok) throw new Error(res.error || 'Error al subir a Drive');

  document.getElementById('successFileUrl').href = res.fileUrl || '#';
  document.getElementById('paso2').classList.remove('active');
  document.getElementById('pasoExito').style.display = 'block';
  renderSteps(3);
}

// ── Nuevo plan ──

function nuevoPlan() {
  planCreado = null;
  codigoDespacho = '';
  for (const k in vehiculosEnUso) delete vehiculosEnUso[k];
  document.getElementById('tripsTbody').innerHTML          = '';
  document.getElementById('tablaSection').style.display    = 'none';
  document.getElementById('btnCargarViajes').style.display = 'none';
  document.getElementById('pasoExito').style.display       = 'none';
  document.getElementById('formPlan').reset();
  document.getElementById('errorPlan').textContent         = '';
  transicionarPaso(1);
}

// ── Navegación pasos ──

function transicionarPaso(paso) {
  document.querySelectorAll('.paso').forEach(p => p.classList.remove('active'));
  if (paso === 1) {
    document.getElementById('paso1').classList.add('active');
  } else if (paso === 2) {
    document.getElementById('paso2').classList.add('active');
    document.getElementById('resumenNombrePlan').textContent = planCreado.nombre;
    document.getElementById('resumenFecha').textContent     = planCreado.fecha;
    document.getElementById('resumenEsquema').textContent   = planCreado.schemaCode;
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

// ── Excel 100 columnas (mismo orden que construirFilaViaje_ en Excel.gs) ──

function mapearViaje(v, p, emailUsuario) {
  const etq = [...(v.etiquetasCosto || []), ...(v.etiquetasIngreso || [])].join(',');
  return [
    p.fechaMaxEntrega || '',     // [0]
    p.nombre          || '',     // [1]
    p.schemaCode      || '',     // [2]
    v.codigoDespacho  || '',     // [3]
    v.unidades1       || '',     // [4]
    v.unidades2       || '',     // [5]
    v.unidades3       || '',     // [6]
    '',                          // [7]  Prioridad
    v.codigoDireccion || '',     // [8]
    '','','','','','','','',     // [9]-[16]
    '','','','','','','','','',  // [17]-[25]
    v.vehiculo        || '',     // [26]
    '','','','','','','',        // [27]-[33]
    v.proveedor       || '',     // [34]
    '','','','',                 // [35]-[38]
    v.codigoAlternativo || '',   // [39]
    '','','','',                 // [40]-[43]
    v.codigoDespacho  || '',     // [44] Código de ruta
    '','',                       // [45]-[46]
    '','','','','',              // [47]-[51] Texto 1-5
    etq,                         // [52] Texto 6
    v.arrastre        || '',     // [53] Texto 7
    [v.codigoDespacho, v.empleador, v.proveedor].filter(Boolean).join('-'), // [54] Texto 8
    v.descripcionViaje       || '', // [55] Texto 9
    v.segundoConductorNombre || '', // [56] Texto 10
    v.rutaMaestra            || '', // [57] Texto 11
    '','','','',                 // [58]-[61] Número 1-4
    v.conductorEmail  || '',     // [62]
    etq,                         // [63] Costo Asignación
    '','',                       // [64]-[65]
    v.rutaMaestra     || '',     // [66]
    '','','','','','','','','','','','','', // [67]-[79]
    emailUsuario,                // [80]
    '','','','','','','','',     // [81]-[88]
    emailUsuario,                // [89]
    '','','','','','','','','',  // [90]-[98]
    ''                           // [99]
  ];
}

function getHeadersExcel() {
  return [
    'Fecha Maxima de Entrega','Nombre Plan','Esquema','Código de despacho',
    'Unidades_1','Unidades_2','Unidades_3','Prioridad','Código de dirección',
    'Nombre dirección','Nombre cliente','Tipo','Dirección 1','Referencias',
    'Descripción','Comuna','Provincia','Región','País','Código Postal',
    'Latitud','Longitud','Tiempo de servicio','Inicio Ventana 1','Fin Ventana 1',
    'Características','Asignación vehículo','Telefono de Contacto','Email de Contacto',
    'Unidades del artículo','Código del artículo','Descripción del artículo',
    'Exclusividad','Posicion','Proveedor','Inicio ventana 2','Fin ventana 2',
    'Código cliente','Nombre de contacto','Código Alternativo',
    'Mail aprobar ruta','Mail iniciar ruta','Mail en camino a direccion',
    'Mail entrega finalizada','Código de ruta','Número de viaje','Tipo Unidad',
    'Texto 1','Texto 2','Texto 3','Texto 4','Texto 5','Texto 6','Texto 7',
    'Texto 8','Texto 9','Texto 10','Texto 11','Número 1','Número 2','Número 3',
    'Número 4','Correo Conductor','Costo Asignación','Columna dummy',
    'Fecha Facturación','Ruta Maestra','Descripción Despacho',
    'Tel contacto ruta aprobada','Tel contacto ruta iniciada',
    'Tel contacto cerca del lugar','Tel contacto entrega',
    'Código zona de ventas','Unidades requeridas por item','Tag de Busqueda',
    'Fecha de proceso','Folio','Orden de compra','Nombre 2do Contacto',
    'Teléfono 2do Contacto','Email 2do Contacto','Categoría','url','token',
    'url con token','Unidades_4','Tipo de orden','Paquete de datos',
    'Código proveedor','Texto 12','Texto 13','Texto 14','Texto 15','Texto 16',
    'Texto 17','Texto 18','Texto 19','Texto 20','Código Empleador',
    'Prioridad de Secuencia'
  ];
}
