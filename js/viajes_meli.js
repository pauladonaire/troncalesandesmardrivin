// viajes_meli.js — Carga de viajes desde Excel de Mercado Libre

let SESSION    = null;
let planCreado = null;
let codigoDespacho = '';
const filaRefs = {};
const msRefs   = {};

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
    if (loaderSeconds === 40) {
      clearInterval(loaderInterval);
      loaderInterval = null;
      if (loaderSubtxt) loaderSubtxt.innerHTML = 'La conexión está tardando más de lo esperado. <button onclick="location.reload()" style="color:#01feff;background:none;border:1px solid #01feff;padding:4px 12px;border-radius:4px;cursor:pointer;margin-left:8px;">Reintentar</button>';
    }
  }, 1000);
}

function detenerLoader() {
  if (loaderInterval) { clearInterval(loaderInterval); loaderInterval = null; }
}

async function getDatosMaestrosConTimeout() {
  return Promise.race([
    gasCall('getDatosMaestros'),
    new Promise((_, reject) => setTimeout(() =>
      reject(new Error('Timeout: el servidor tardó demasiado. Recargá la página para reintentar.')), 45000))
  ]);
}

async function refrescarDatosSilencioso() {
  try {
    const res = await gasCall('getDatosMaestros');
    if (res.ok !== false) {
      guardarEnCache(res);
      if (!Object.keys(filaRefs).length) {
        window.DATOS = res;
      } else {
        mostrarToast('Datos maestros actualizados. Serán aplicados en la próxima carga.');
      }
    }
  } catch(e) {}
}

// ── INIT ──

document.addEventListener('DOMContentLoaded', async () => {
  SESSION = requireSession();
  if (!SESSION) return;
  document.getElementById('userName').textContent     = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;

  const cached = cargarDesdeCacheOGAS();

  if (cached) {
    window.DATOS = cached.data;
    console.log('Datos maestros desde localStorage (caché)');
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('contenido').style.display  = 'block';
    inicializarPaso1();
    refrescarDatosSilencioso();
  } else {
    document.getElementById('initLoader').style.display = 'flex';
    document.getElementById('contenido').style.display  = 'none';
    iniciarLoaderConFeedback();
    try {
      const res = await getDatosMaestrosConTimeout();
      detenerLoader();
      if (res.ok === false) throw new Error(res.error || 'Error al cargar datos maestros');
      window.DATOS = res;
      guardarEnCache(res);
      document.getElementById('initLoader').style.display = 'none';
      document.getElementById('contenido').style.display  = 'block';
      inicializarPaso1();
    } catch (e) {
      detenerLoader();
      document.getElementById('initLoader').style.display = 'none';
      document.getElementById('initError').textContent    = 'Error al cargar datos: ' + e.message;
      document.getElementById('initError').style.display  = 'block';
    }
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
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _detectarColumnas(headers) {
  const map = {};
  // Primera pasada: buscar columnas con "nombre" (prioridad alta, evita "ID del Conductor")
  headers.forEach((h, i) => {
    const n = _normHeader(h);
    if (map.altCode === undefined && (n === 'travel id' || n === 'id viaje' || n === 'id de envio' || n === 'shipment')) map.altCode = i;
    if (map.destino   === undefined && (n.includes('destino') || n.includes('destination') || n.includes('punto de entrega') || n.includes('cod dir') || n.includes('codigo dir') || n.includes('cod. dir'))) map.destino = i;
    if (map.tractor   === undefined && (n.includes('tractor') || n.includes('vehiculo tractor') || n.includes('unidad tractora') || n.includes('patente tractor') || n.includes('camion'))) map.tractor = i;
    if (map.arrastre  === undefined && ((n.includes('carga') && !n.includes('unidades de carga') && !n.includes('carga horaria')) || n.includes('arrastre') || n.includes('semirremolque') || n.includes('remolque') || n.includes('trailer'))) map.arrastre = i;
    if (map.servicio    === undefined && (n.includes('servicio') || n.includes('service') || n === 'descripcion' || n.includes('tipo de servicio'))) map.servicio = i;
    if (map.tipoVehiculo === undefined && !n.includes('tractor') && !n.includes('carga') && (n.includes('tipo de vehiculo') || n === 'tipo vehiculo' || n.includes('vehicle type') || n.includes('tipo de unidad'))) map.tipoVehiculo = i;
    // Conductor: requiere "nombre" + "conductor" (excluye "ID del Conductor")
    if (map.conductor === undefined && n.includes('nombre') && n.includes('conductor') && !n.includes('adicional') && !n.includes('secundario')) map.conductor = i;
    // 2do conductor: requiere "nombre" + "adicional"/"secundario"/"2do"
    if (map.cond2     === undefined && n.includes('nombre') && n.includes('conductor') && (n.includes('2') || n.includes('2') || n.includes('2do'))) map.cond2 = i;
  });
  // Segunda pasada: fallback sin "nombre" (solo si no se encontró en la primera)
  headers.forEach((h, i) => {
    const n = _normHeader(h);
    if (map.conductor === undefined && (n === 'conductor' || (n.includes('conductor') && n.includes('principal') && !n.includes('id')))) map.conductor = i;
    if (map.cond2     === undefined && n.includes('conductor') && (n.includes('adicional') || n.includes('2') || n.includes('2do')) && !n.includes('id')) map.cond2 = i;
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
    const servicio     = colMap.servicio     !== undefined ? String(row[colMap.servicio]     || '').trim() : '';
    const tipoVehiculo = colMap.tipoVehiculo !== undefined ? String(row[colMap.tipoVehiculo] || '').trim() : '';
    const condRaw      = colMap.conductor    !== undefined ? String(row[colMap.conductor]    || '').trim() : '';
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
      servicio, tipoVehiculo,
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

function getRutasOpciones(filtroProveedor) {
  const all = (window.DATOS.rutas || []).map(r => {
    const vals   = Object.values(r);
    const nombre = String(vals[0] || '');
    const prov   = String(vals[1] || '');
    return { value: nombre, label: nombre + (prov ? ' [' + prov + ']' : ''), rutaProv: prov };
  });
  if (!filtroProveedor) return all;
  const norm = filtroProveedor.toLowerCase();
  return all.filter(r => r.rutaProv.toLowerCase() === norm || r.rutaProv === '');
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

  const refs = {};

  const tripOpciones = (window.DATOS.tripulantes || []).map(t => ({
    value: t.nombre_completo,
    labelCorto: t.nombre_completo,
    label: t.nombre_completo + ' — ' + t.email,
    extra: { nombre: t.nombre_completo, email: t.email }
  }));

  refs.dir = crearDropdownSimple({
    opciones: (window.DATOS.direcciones || []).map(d => ({
      value: d.code, labelCorto: d.code,
      label: '[' + d.code + '] — ' + (d.name || '') + ' | ' + (d.address1 || '') + ', ' + (d.city || '')
    })),
    placeholder:  'Buscar dirección... *',
    mensajeVacio: 'No hay direcciones cargadas',
    onChange: () => {}
  });

  refs.veh = crearDropdownSimple({
    opciones: (window.DATOS.flota || []).map(v => ({
      value: v.code, labelCorto: v.code,
      label: v.code + (v.description ? ' — ' + v.description : '') + ' | ' + (v.employer_name || 'Sin empleador')
    })),
    placeholder:      'Buscar vehículo... *',
    mensajeVacio:     'No hay vehículos disponibles',
    deshabilitadosFn: () => Object.keys(filaRefs)
      .filter(k => Number(k) !== idx)
      .map(k => filaRefs[k]?.veh?.getValue())
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

  filaRefs[idx] = refs;

  tr.querySelector(`#td-dir-${idx}`).appendChild(refs.dir.wrap);
  tr.querySelector(`#td-veh-${idx}`).appendChild(refs.veh.wrap);
  tr.querySelector(`#td-arr-${idx}`).appendChild(refs.arr.wrap);
  tr.querySelector(`#td-prov-${idx}`).appendChild(refs.prov.wrap);
  tr.querySelector(`#td-ruta-${idx}`).appendChild(refs.ruta.wrap);
  tr.querySelector(`#td-cond-${idx}`).appendChild(refs.cond.wrap);
  tr.querySelector(`#td-cond2-${idx}`).appendChild(refs.cond2.wrap);

  // Pre-fill valores desde Excel (encontrado → normal, no encontrado → naranja)
  if (datos.dirMatch) {
    refs.dir.setValue(datos.dirMatch.code, '[' + datos.dirMatch.code + '] — ' + datos.dirMatch.name);
  } else if (datos.dirRaw) {
    refs.dir.setValue(datos.dirRaw);
  }

  if (datos.vehMatch) {
    refs.veh.setValue(datos.vehMatch.code);
  } else if (datos.vehRaw) {
    refs.veh.setValue(datos.vehRaw);
  }

  if (datos.arrMatch) {
    refs.arr.setValue(datos.arrMatch);
  } else if (datos.arrastRaw) {
    refs.arr.setValue(datos.arrastRaw);
  }

  const _provNombre = datos.provMatch ? datos.provMatch.name : PROVEEDOR_MELI_FIJO;
  refs.prov.setValue(_provNombre);

  if (datos.condMatch) {
    refs.cond.setValue(datos.condMatch.nombre_completo);
  } else if (datos.condRaw) {
    refs.cond.setValue(datos.condRaw);
  }

  if (datos.cond2Match) {
    refs.cond2.setValue(datos.cond2Match.nombre_completo);
  } else if (datos.cond2Raw) {
    refs.cond2.setValue(datos.cond2Raw);
  }

  // _postInit: llamar DESPUÉS de que el tr esté en el DOM
  tr._postInit = function() {
    if (datos.vehMatch) onVehiculoChange(idx, datos.vehMatch.code);
    onProveedorChange(idx, _provNombre);
    if (datos.servicio) refs.ruta.setValue(datos.servicio);
    _autoSeleccionarEtiquetaIngreso(idx, datos.servicio, datos.tipoVehiculo);
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
  const etiquetasCosto = [...new Set(
    (window.DATOS.esquemasCostos || []).slice(1)
      .filter(r => {
        const schemaName = String(r[1]  || '').trim().toLowerCase();
        const employer   = String(r[12] || '').trim().toLowerCase();
        return schemaName === norm || employer === norm;
      })
      .map(r => String(r[26] || '').trim())
      .filter(e => e !== '')
  )];
  const items = etiquetasCosto.map(e => ({ etiqueta: e, vigenciaDesde: '', vigenciaHasta: '' }));
  if (!items.length) {
    td.innerHTML = '<span class="no-etiquetas text-muted">Sin costos cargados para este empleador</span>';
    return;
  }
  const msId = 'ms-costo-' + idx;
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
  const etiquetasIngreso = [...new Set(
    (window.DATOS.esquemasIngresos || []).slice(1)
      .filter(r => String(r[1] || '').trim().toLowerCase() === norm)
      .map(r => String(r[26] || '').trim().toUpperCase())
      .filter(e => e !== '')
  )];
  const items = etiquetasIngreso.map(e => ({ etiqueta: e, vigenciaDesde: '', vigenciaHasta: '' }));
  if (!items.length) {
    td.innerHTML = '<span class="no-etiquetas text-muted">Sin tarifas cargadas para este proveedor</span>';
    return;
  }
  const msId = 'ms-ingreso-' + idx;
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
  const refs = filaRefs[idx];
  if (refs && refs.ruta) refs.ruta.setOpciones(getRutasOpciones(prov));
}

function _autoSeleccionarEtiquetaIngreso(idx, servicio, tipoVehiculo) {
  if (!servicio) return;
  const etiqueta = (tipoVehiculo
    ? servicio + ' / ' + tipoVehiculo
    : servicio
  ).toUpperCase();
  const tr = document.querySelector(`#tripsTbody tr[data-idx="${idx}"]`);
  if (tr) tr.dataset.etiquetaAutoIngreso = etiqueta;
  const msId = 'ms-ingreso-' + idx;
  const ms = msRefs[msId];
  if (!ms) return;
  const current = JSON.parse(document.getElementById(msId)?.dataset.selected || '[]');
  if (!current.length) ms.setSeleccion([etiqueta]);
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
    const triggerC = msC?.querySelector('.ms-trigger');
    if (triggerC) { triggerC.classList.toggle('error', !costoSel.length); if (!costoSel.length) ok = false; }

    const msI = document.getElementById(`ms-ingreso-${idx}`);
    const ingresoSel = msI ? JSON.parse(msI.dataset.selected || '[]') : [];
    const etiquetaAutoIngreso = tr.dataset.etiquetaAutoIngreso || '';
    const efectivoIngreso = ingresoSel.length ? ingresoSel : (etiquetaAutoIngreso ? [etiquetaAutoIngreso] : []);
    const triggerI = msI?.querySelector('.ms-trigger');
    if (triggerI) { triggerI.classList.toggle('error', !efectivoIngreso.length); if (!efectivoIngreso.length) ok = false; }
    else if (!efectivoIngreso.length) ok = false;
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
    const _despacho = tr.querySelector('.f-despacho')?.value || '';
    const _alt      = tr.querySelector('.f-alt')?.value      || '';
    const ingresoSel = msI ? JSON.parse(msI.dataset.selected || '[]') : [];
    const etiquetaAutoIngreso = tr.dataset.etiquetaAutoIngreso || '';
    viajes.push({
      codigoDespacho:         _alt ? (_despacho + ' | ' + _alt) : _despacho,
      codigoAlternativo:      _alt,
      unidades1:              tr.querySelector('.f-uni1')?.value     || '',
      unidades2:              tr.querySelector('.f-uni2')?.value     || '',
      unidades3:              tr.querySelector('.f-uni3')?.value     || '',
      codigoDireccion:        refs.dir?.getValue()                   || '',
      vehiculo:               refs.veh?.getValue()                   || '',
      arrastre:               refs.arr?.getValue()                   || '',
      empleador:              getEmpleadorDeFila(idx),
      etiquetasCosto:         msC ? JSON.parse(msC.dataset.selected || '[]') : [],
      proveedor:              refs.prov?.getValue()                  || '',
      etiquetasIngreso:       ingresoSel.length ? ingresoSel : (etiquetaAutoIngreso ? [etiquetaAutoIngreso] : []),
      rutaMaestra:            refs.ruta?.getValue() || tr.querySelector('.f-desc')?.value || '',
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
      localStorage.removeItem(CACHE_KEY);
      const nuevosDatos = await gasCall('getDatosMaestros');
      if (nuevosDatos.ok !== false) {
        window.DATOS = nuevosDatos;
        guardarEnCache(nuevosDatos);
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
  const tripOpciones = (window.DATOS.tripulantes || []).map(t => ({
    value: t.nombre_completo,
    labelCorto: t.nombre_completo,
    label: t.nombre_completo + ' — ' + t.email,
    extra: { nombre: t.nombre_completo, email: t.email }
  }));

  document.querySelectorAll('#tripsTbody tr').forEach(tr => {
    const idx  = Number(tr.dataset.idx);
    const refs = filaRefs[idx];
    if (!refs) return;

    const msC = document.getElementById(`ms-costo-${idx}`);
    const msI = document.getElementById(`ms-ingreso-${idx}`);
    const prevCosto   = msC ? JSON.parse(msC.dataset.selected || '[]') : [];
    const prevIngreso = msI ? JSON.parse(msI.dataset.selected || '[]') : [];

    if (refs.dir) refs.dir.setOpciones((window.DATOS.direcciones || []).map(d => ({
      value: d.code, labelCorto: d.code,
      label: '[' + d.code + '] — ' + (d.name || '') + ' | ' + (d.address1 || '') + ', ' + (d.city || '')
    })));

    if (refs.veh) refs.veh.setOpciones((window.DATOS.flota || []).map(v => ({
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

    const vCode   = refs.veh?.getValue();
    const pNombre = refs.prov?.getValue();

    if (vCode) {
      actualizarEtiquetasCosto(idx, vCode);
      _restaurarMultiSelect('ms-costo-' + idx, prevCosto);
    }
    if (pNombre) {
      actualizarEtiquetasIngreso(idx, pNombre);
      _restaurarMultiSelect('ms-ingreso-' + idx, prevIngreso);
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
