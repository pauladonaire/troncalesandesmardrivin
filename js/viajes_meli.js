// viajes_meli.js — Carga de viajes desde Excel de Mercado Libre

let SESSION    = null;
let planCreado = null;
let codigoDespacho = '';
const filaRefs = {};

// ── COLUMNAS ESPERADAS EN EL EXCEL MELI ──
// Travel ID        → Código Alternativo
// Destino          → Dirección (se intenta matchear con DATOS.direcciones)
// Vehículo tractor → Vehículo  (se intenta matchear con DATOS.flota)
// Vehículo de carga→ Arrastre  (se intenta matchear con DATOS.arrastres)
// Servicio         → Descripción
// Conductor Princ. → Conductor (se intenta matchear con DATOS.tripulantes)
// Conductor Adic.  → 2do Conductor
// Unidad 1         → 25000 (fijo)
// Proveedor        → TECH PACK SRL (fijo, matchea contra socios)

const PROVEEDOR_MELI_FIJO = 'TECH PACK SRL';
const UNIDADES_MELI_FIJAS = '25000';

// ── INIT ──

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

// ── PASO 2 — Importar Excel de Meli ──

function procesarExcelMeli(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    try {
      const data = new Uint8Array(ev.target.result);
      const wb   = XLSX.read(data, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) { alert('El archivo no contiene datos.'); return; }
      _generarDesdeRows(rows);
    } catch (err) {
      alert('Error al leer el Excel: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function _normHeader(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _detectarColumnas(headers) {
  const map = {};
  // Primera pasada: buscar columnas con "nombre" (prioridad alta, evita "ID del Conductor")
  headers.forEach((h, i) => {
    const n = _normHeader(h);
    if (map.altCode   === undefined && (n.includes('Travel ID') || n.includes('id viaje') || n.includes('id de envio') || n.includes('shipment') || n === 'id')) map.altCode = i;
    if (map.destino   === undefined && (n.includes('destino') || n.includes('destination') || n.includes('punto de entrega') || n.includes('cod dir') || n.includes('codigo dir') || n.includes('cod. dir'))) map.destino = i;
    if (map.tractor   === undefined && (n.includes('tractor') || n.includes('vehiculo tractor') || n.includes('unidad tractora') || n.includes('patente tractor') || n.includes('camion'))) map.tractor = i;
    if (map.arrastre  === undefined && ((n.includes('carga') && !n.includes('unidades de carga') && !n.includes('carga horaria')) || n.includes('arrastre') || n.includes('semirremolque') || n.includes('remolque') || n.includes('trailer'))) map.arrastre = i;
    if (map.servicio  === undefined && (n.includes('servicio') || n.includes('service') || n === 'descripcion' || n.includes('tipo de servicio'))) map.servicio = i;
    // Conductor: requiere "nombre" + "conductor" (excluye "ID del Conductor")
    if (map.conductor === undefined && n.includes('nombre') && n.includes('conductor') && !n.includes('adicional') && !n.includes('secundario')) map.conductor = i;
    // 2do conductor: requiere "nombre" + "adicional"/"secundario"/"2do"
    if (map.cond2     === undefined && n.includes('nombre') && n.includes('conductor') && (n.includes('adicional') || n.includes('secundario') || n.includes('2do'))) map.cond2 = i;
  });
  // Segunda pasada: fallback sin "nombre" (solo si no se encontró en la primera)
  headers.forEach((h, i) => {
    const n = _normHeader(h);
    if (map.conductor === undefined && (n === 'conductor' || (n.includes('conductor') && n.includes('principal') && !n.includes('id')))) map.conductor = i;
    if (map.cond2     === undefined && n.includes('conductor') && (n.includes('adicional') || n.includes('segundo') || n.includes('2do')) && !n.includes('id')) map.cond2 = i;
  });
  return map;
}

function _generarDesdeRows(rows) {
  const headers  = rows[0];
  const colMap   = _detectarColumnas(headers);
  const dataRows = rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''));

  if (!dataRows.length) { alert('No hay filas con datos en el archivo.'); return; }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  codigoDespacho = `${String(now.getFullYear()).slice(-2)}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${SESSION.iniciales}`;

  for (const k in filaRefs) delete filaRefs[k];
  const tbody = document.getElementById('tripsTbody');
  tbody.innerHTML = '';

  let noValidados = 0;

  dataRows.forEach((row, i) => {
    const altCode   = colMap.altCode   !== undefined ? String(row[colMap.altCode]   || '').trim() : '';
    const destRaw   = colMap.destino   !== undefined ? String(row[colMap.destino]   || '').trim() : '';
    const tractRaw  = colMap.tractor   !== undefined ? String(row[colMap.tractor]   || '').trim() : '';
    const arrastRaw = colMap.arrastre  !== undefined ? String(row[colMap.arrastre]  || '').trim() : '';
    const servicio  = colMap.servicio  !== undefined ? String(row[colMap.servicio]  || '').trim() : '';
    const condRaw   = colMap.conductor !== undefined ? String(row[colMap.conductor] || '').trim() : '';
    const cond2Raw  = colMap.cond2     !== undefined ? String(row[colMap.cond2]     || '').trim() : '';

    const dirMatch   = _buscarDireccion(destRaw);
    const vehMatch   = _buscarVehiculo(tractRaw);
    const arrMatch   = _buscarArrastre(arrastRaw);
    const condMatch  = _buscarConductor(condRaw);
    const cond2Match = _buscarConductor(cond2Raw);
    const provMatch  = _buscarProveedor(PROVEEDOR_MELI_FIJO);

    if (!dirMatch  && destRaw)  noValidados++;
    if (!vehMatch  && tractRaw) noValidados++;
    if (!condMatch && condRaw)  noValidados++;

    const datos = {
      codigoDespacho: codigoDespacho + '-' + (i + 1),
      altCode, unidades1: UNIDADES_MELI_FIJAS,
      dirMatch, dirRaw: destRaw,
      vehMatch, vehRaw: tractRaw,
      arrMatch, arrastRaw,
      servicio,
      condMatch, condRaw,
      cond2Match, cond2Raw,
      provMatch
    };
    const tr = crearFilaMeli(i, datos);
    tbody.appendChild(tr);
    tr._postInit();
  });

  document.getElementById('tablaSection').style.display    = 'block';
  document.getElementById('btnCargarViajes').style.display = 'inline-flex';
  document.getElementById('validacionError').style.display = 'none';

  const alerta = document.getElementById('meliAlertaNoValidados');
  if (noValidados > 0) {
    alerta.textContent = `${noValidados} campo(s) con valores no encontrados en el sistema (marcados en naranja). Podés corregirlos antes de cargar.`;
    alerta.style.display = 'block';
  } else {
    alerta.style.display = 'none';
  }

  const uploadBox = document.getElementById('uploadBox');
  if (uploadBox) {
    uploadBox.style.borderColor = '#01feff';
    uploadBox.style.background  = 'rgba(1,254,255,0.04)';
    const label = uploadBox.querySelector('div:nth-child(2)');
    if (label) label.textContent = `${dataRows.length} fila(s) importadas — ${uploadBox.querySelector('div:nth-child(2)')?.textContent}`;
  }
}

// ── Match helpers ──

function _buscarDireccion(raw) {
  if (!raw) return null;
  const norm = raw.trim().toUpperCase();
  return (window.DATOS.direcciones || []).find(d =>
    String(d.code || '').toUpperCase() === norm ||
    String(d.name || '').toUpperCase() === norm
  ) || null;
}

function _buscarVehiculo(raw) {
  if (!raw) return null;
  const norm = raw.trim().toUpperCase();
  return (window.DATOS.flota || []).find(v =>
    String(v.code || '').toUpperCase() === norm
  ) || null;
}

function _buscarArrastre(raw) {
  if (!raw) return null;
  const norm = raw.trim().toUpperCase();
  const item = (window.DATOS.arrastres || []).find(a => {
    const vals = Object.values(a);
    return String(vals[0] || '').toUpperCase() === norm;
  });
  return item ? String(Object.values(item)[0] || '') : null;
}

function _buscarProveedor(nombre) {
  if (!nombre) return null;
  const norm = nombre.trim().toLowerCase();
  return (window.DATOS.socios || []).find(s =>
    String(s.type || '').toLowerCase() === 'supplier' &&
    String(s.name || '').toLowerCase() === norm
  ) || null;
}

function _buscarConductor(raw) {
  if (!raw) return null;
  const norm = raw.trim().toLowerCase();
  return (window.DATOS.tripulantes || []).find(t =>
    String(t.nombre_completo || '').toLowerCase() === norm
  ) || null;
}

// ── Crear fila desde datos Meli ──

function crearFilaMeli(idx, datos) {
  const tr = document.createElement('tr');
  tr.dataset.idx = idx;
  tr.innerHTML = `
    <td class="col-del"><button class="btn-del-row" onclick="eliminarFila(this)" title="Eliminar fila">×</button></td>
    <td class="col-despacho"><input type="text" class="f-despacho" value="${escapeHtml(datos.codigoDespacho)}" readonly></td>
    <td class="col-alt"><input type="text" class="f-alt" data-campo="codigoAlternativo" value="${escapeHtml(datos.altCode)}" placeholder="*"></td>
    <td class="col-uni"><input type="number" class="f-uni1" min="1" step="1" value="${escapeHtml(datos.unidades1)}" placeholder="*"></td>
    <td class="col-uni"><input type="number" class="f-uni2" min="0" step="1" placeholder="0"></td>
    <td class="col-uni"><input type="number" class="f-uni3" min="0" step="1" placeholder="0"></td>
    <td class="col-dir"       id="td-dir-${idx}"></td>
    <td class="col-vehiculo"  id="td-veh-${idx}"></td>
    <td class="col-arrastre"  id="td-arr-${idx}"></td>
    <td class="col-empleador" id="td-emp-${idx}"><span class="empleador-value text-muted">—</span></td>
    <td class="col-etiqueta"  id="td-costo-${idx}"><span class="no-etiquetas text-muted">—</span></td>
    <td class="col-proveedor" id="td-prov-${idx}"></td>
    <td class="col-etiqueta"  id="td-ingreso-${idx}"><span class="no-etiquetas text-muted">—</span></td>
    <td class="col-ruta"      id="td-ruta-${idx}"></td>
    <td class="col-conductor" id="td-cond-${idx}"></td>
    <td class="col-conductor" id="td-cond2-${idx}"></td>
    <td class="col-descripcion"><input type="text" class="f-desc" value="${escapeHtml(datos.servicio)}" placeholder="Opcional"></td>
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
    inputClass:  'f-vehiculo',
    placeholder: 'Buscar vehículo... *',
    opcionesFn:  () => (window.DATOS.flota || []).map(v => ({
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
        const vals   = Object.values(r);
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

  // Pre-fill valores de input (DOM-independiente — solo modifica el input)
  if (datos.dirMatch) {
    refs.dir.setValue(datos.dirMatch.code, `[${datos.dirMatch.code}] — ${datos.dirMatch.name}`);
  } else if (datos.dirRaw) {
    refs.dir.input.value         = datos.dirRaw;
    refs.dir.input.dataset.value = datos.dirRaw;
    refs.dir.input.classList.add('no-validado');
  }

  if (datos.vehMatch) {
    refs.veh.setValue(datos.vehMatch.code, datos.vehMatch.code);
  } else if (datos.vehRaw) {
    refs.veh.input.value         = datos.vehRaw;
    refs.veh.input.dataset.value = datos.vehRaw;
    refs.veh.input.classList.add('no-validado');
  }

  if (datos.arrMatch) {
    refs.arr.setValue(datos.arrMatch, datos.arrMatch);
  } else if (datos.arrastRaw) {
    refs.arr.input.value         = datos.arrastRaw;
    refs.arr.input.dataset.value = datos.arrastRaw;
    refs.arr.input.classList.add('no-validado');
  }

  const _provNombre = datos.provMatch ? datos.provMatch.name : PROVEEDOR_MELI_FIJO;
  refs.prov.setValue(_provNombre, _provNombre);
  if (!datos.provMatch) refs.prov.input.classList.add('no-validado');

  if (datos.condMatch) {
    refs.cond.setValue(datos.condMatch.nombre_completo, datos.condMatch.nombre_completo);
    refs.cond.input.dataset.extra = JSON.stringify({ nombre: datos.condMatch.nombre_completo, email: datos.condMatch.email || '' });
  } else if (datos.condRaw) {
    refs.cond.input.value         = datos.condRaw;
    refs.cond.input.dataset.value = datos.condRaw;
    refs.cond.input.classList.add('no-validado');
  }

  if (datos.cond2Match) {
    refs.cond2.setValue(datos.cond2Match.nombre_completo, datos.cond2Match.nombre_completo);
    refs.cond2.input.dataset.extra = JSON.stringify({ nombre: datos.cond2Match.nombre_completo, email: datos.cond2Match.email || '' });
  } else if (datos.cond2Raw) {
    refs.cond2.input.value         = datos.cond2Raw;
    refs.cond2.input.dataset.value = datos.cond2Raw;
    refs.cond2.input.classList.add('no-validado');
  }

  // _postInit: llamar DESPUÉS de que el tr esté en el DOM
  tr._postInit = function() {
    if (datos.vehMatch) onVehiculoChange(idx, datos.vehMatch.code);
    onProveedorChange(idx, _provNombre);
  };

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
    document.getElementById('meliAlertaNoValidados').style.display = 'none';
  }
}

// ── Dropdown buscable ──

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
    const opciones       = opcionesFn ? opcionesFn() : [];
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
          input.value         = opcion.labelCorto || opcion.label;
          if (opcion.extra !== undefined) input.dataset.extra = JSON.stringify(opcion.extra);
          input.classList.remove('error', 'no-validado');
          list.classList.remove('open');
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

// ── Conductores sin duplicar ──

function getConductoresYaUsados(filaIdx, campo) {
  const usados = new Set();
  Object.keys(filaRefs).forEach(k => {
    const i = Number(k);
    const r = filaRefs[i];
    if (!r) return;
    const c1 = r.cond?.getValue();
    const c2 = r.cond2?.getValue();
    if (i === filaIdx) {
      if (campo === 'conductor'        && c2) usados.add(c2);
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

// ── Vigencia ──

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

// ── Etiquetas Costo ──

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
  td.appendChild(crearMultiSelect(idx, 'costo', items));
}

// ── Etiquetas Ingreso ──

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
  td.appendChild(crearMultiSelect(idx, 'ingreso', items));
}

function onProveedorChange(idx, prov) {
  actualizarEtiquetasIngreso(idx, prov);
  if (filaRefs[idx]) filaRefs[idx].rutaFiltro = prov;
}

// ── Multi-select con vigencia ──

function crearMultiSelect(idx, tipo, items) {
  const wrap = document.createElement('div');
  wrap.className        = 'multi-select-wrap';
  wrap.id               = `ms-${tipo}-${idx}`;
  wrap.dataset.selected = '[]';

  const pills = document.createElement('div');
  pills.className = 'multi-pills';
  const ph = document.createElement('span');
  ph.className   = 'pills-placeholder';
  ph.textContent = 'Seleccionar...';
  pills.appendChild(ph);

  const dropdown = document.createElement('div');
  dropdown.className = 'multi-dropdown';

  const searchWrap = document.createElement('div');
  searchWrap.className = 'multi-search-wrap';
  const searchInput = document.createElement('input');
  searchInput.type        = 'text';
  searchInput.placeholder = 'Buscar...';
  searchInput.className   = 'multi-search';
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    dropdown.querySelectorAll('label.multi-option').forEach(lbl => {
      lbl.style.display = q ? (lbl.textContent.trim().toLowerCase().includes(q) ? '' : 'none') : '';
    });
  });
  searchInput.addEventListener('mousedown', e => e.stopPropagation());
  searchInput.addEventListener('keydown',   e => { if (e.key === 'Escape') dropdown.classList.remove('open'); });
  searchWrap.appendChild(searchInput);
  dropdown.appendChild(searchWrap);

  items.forEach(item => {
    const lbl = document.createElement('label');
    lbl.className = 'multi-option';
    const vigente = estaVigente(item.vigenciaDesde, item.vigenciaHasta);
    if (!vigente) { lbl.classList.add('fuera-vigencia'); lbl.title = 'Fuera de período de vigencia'; }
    const cb = document.createElement('input');
    cb.type  = 'checkbox';
    cb.value = item.etiqueta;
    cb.addEventListener('change', () => actualizarMultiSelect(wrap, pills, ph, items));
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + item.etiqueta));
    dropdown.appendChild(lbl);
  });

  pills.addEventListener('click', e => {
    if (e.target.classList.contains('pill-remove')) return;
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
    } else {
      const rect = pills.getBoundingClientRect();
      dropdown.style.top   = (rect.bottom + 2) + 'px';
      dropdown.style.left  = rect.left + 'px';
      dropdown.style.width = Math.max(rect.width, 320) + 'px';
      dropdown.classList.add('open');
      searchInput.value = '';
      dropdown.querySelectorAll('label.multi-option').forEach(lbl => lbl.style.display = '');
      setTimeout(() => searchInput.focus(), 10);
    }
  });
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) dropdown.classList.remove('open');
  });

  wrap.appendChild(pills);
  wrap.appendChild(dropdown);
  return wrap;
}

function actualizarMultiSelect(wrap, pills, ph, items) {
  const selected = Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
  wrap.dataset.selected = JSON.stringify(selected);
  renderPills(pills, ph, selected, wrap, items);
}

function renderPills(pills, ph, selected, wrap, items) {
  pills.innerHTML = '';
  if (!selected.length) { pills.appendChild(ph); return; }
  selected.forEach(val => {
    const item    = items ? items.find(i => i.etiqueta === val) : null;
    const vigente = item ? estaVigente(item.vigenciaDesde, item.vigenciaHasta) : true;
    const pill    = document.createElement('span');
    pill.className = 'pill' + (vigente ? '' : ' pill-fuera-vigencia');
    if (!vigente) pill.title = 'Fuera de período de vigencia';
    const rm = document.createElement('span');
    rm.className   = 'pill-remove';
    rm.textContent = '×';
    rm.addEventListener('click', e => {
      e.stopPropagation();
      wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => { if (cb.value === val) cb.checked = false; });
      actualizarMultiSelect(wrap, pills, ph, items);
    });
    pill.appendChild(document.createTextNode(val));
    pill.appendChild(rm);
    pills.appendChild(pill);
  });
}

// ── Validación ──

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
    const pillsC = msC?.querySelector('.multi-pills');
    if (pillsC) { pillsC.classList.toggle('error', !costoSel.length); if (!costoSel.length) ok = false; }

    const msI = document.getElementById(`ms-ingreso-${idx}`);
    const ingresoSel = msI ? JSON.parse(msI.dataset.selected || '[]') : [];
    const pillsI = msI?.querySelector('.multi-pills');
    if (pillsI) { pillsI.classList.toggle('error', !ingresoSel.length); if (!ingresoSel.length) ok = false; }
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
      codigoDespacho:         tr.querySelector('.f-despacho')?.value || '',
      codigoAlternativo:      tr.querySelector('.f-alt')?.value      || '',
      unidades1:              tr.querySelector('.f-uni1')?.value     || '',
      unidades2:              tr.querySelector('.f-uni2')?.value     || '',
      unidades3:              tr.querySelector('.f-uni3')?.value     || '',
      codigoDireccion:        refs.dir?.getValue()                   || '',
      vehiculo:               refs.veh?.getValue()                   || '',
      arrastre:               refs.arr?.getValue()                   || '',
      empleador:              getEmpleadorDeFila(idx),
      etiquetasCosto:         msC ? JSON.parse(msC.dataset.selected || '[]') : [],
      proveedor:              refs.prov?.getValue()                  || '',
      etiquetasIngreso:       msI ? JSON.parse(msI.dataset.selected || '[]') : [],
      rutaMaestra:            refs.ruta?.getValue()                  || '',
      conductorEmail:         cExtra.email                           || '',
      segundoConductorNombre: c2Extra.nombre                         || '',
      descripcionViaje:       tr.querySelector('.f-desc')?.value     || ''
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

// ── Ejecutar carga ──

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
  planCreado     = null;
  codigoDespacho = '';
  for (const k in filaRefs) delete filaRefs[k];
  document.getElementById('tripsTbody').innerHTML          = '';
  document.getElementById('tablaSection').style.display    = 'none';
  document.getElementById('btnCargarViajes').style.display = 'none';
  document.getElementById('pasoExito').style.display       = 'none';
  document.getElementById('meliAlertaNoValidados').style.display = 'none';
  document.getElementById('formPlan').reset();
  document.getElementById('errorPlan').textContent         = '';
  const uploadBox = document.getElementById('uploadBox');
  if (uploadBox) {
    uploadBox.style.borderColor = '';
    uploadBox.style.background  = '';
  }
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

// ── Sync datos maestros ──

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

function refrescarFilasExistentes() {
  document.querySelectorAll('#tripsTbody tr').forEach(tr => {
    const idx  = Number(tr.dataset.idx);
    const refs = filaRefs[idx];
    if (!refs) return;
    const msC = document.getElementById(`ms-costo-${idx}`);
    const msI = document.getElementById(`ms-ingreso-${idx}`);
    const prevCosto   = msC ? JSON.parse(msC.dataset.selected || '[]') : [];
    const prevIngreso = msI ? JSON.parse(msI.dataset.selected || '[]') : [];
    const vCode  = refs.veh?.getValue();
    const pNombre = refs.prov?.getValue();
    if (vCode) { actualizarEtiquetasCosto(idx, vCode);    _restaurarMultiSelect(`ms-costo-${idx}`,   prevCosto); }
    if (pNombre) { actualizarEtiquetasIngreso(idx, pNombre); _restaurarMultiSelect(`ms-ingreso-${idx}`, prevIngreso); }
  });
}

function _restaurarMultiSelect(msId, prevSelected) {
  const ms = document.getElementById(msId);
  if (!ms || !prevSelected.length) return;
  ms.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (prevSelected.includes(cb.value)) cb.checked = true;
  });
  const pills = ms.querySelector('.multi-pills');
  const ph    = ms.querySelector('.pills-placeholder');
  const stillValid = prevSelected.filter(v =>
    Array.from(ms.querySelectorAll('input[type="checkbox"]')).some(cb => cb.value === v)
  );
  ms.dataset.selected = JSON.stringify(stillValid);
  if (pills && ph) {
    const items = Array.from(ms.querySelectorAll('label.multi-option')).map(lbl => {
      const cb = lbl.querySelector('input');
      return { etiqueta: cb?.value || '', vigenciaDesde: '', vigenciaHasta: '' };
    });
    renderPills(pills, ph, stillValid, ms, items);
  }
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

// ── Cerrar dropdowns al hacer scroll ──

document.addEventListener('scroll', function() {
  document.querySelectorAll('.dropdown-list.open').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.multi-dropdown.open').forEach(el => el.classList.remove('open'));
}, { capture: true, passive: true });
