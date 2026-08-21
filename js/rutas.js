// rutas.js

let SESSION = null;
let RUTAS   = [];
let SOCIOS  = [];
let HEADERS = [];
let puedeGestionarRutas = false;

document.addEventListener('DOMContentLoaded', async () => {
  SESSION = requireSession();
  if (!SESSION) return;
  document.getElementById('userName').textContent     = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;
  puedeGestionarRutas = SESSION.rol === 'ADMIN_GENERAL' || SESSION.rol === 'ADMIN_TRAFICO';
  await iniciar();
});

async function iniciar() {
  document.getElementById('initLoader').style.display = 'flex';
  document.getElementById('contenido').style.display  = 'none';
  try {
    const res = await gasCall('getDatosRutas');
    if (!res.ok) throw new Error(res.error || 'Error al cargar rutas maestras');
    RUTAS   = res.rutas   || [];
    SOCIOS  = res.socios  || [];
    HEADERS = res.headers || ['Nombre', 'Proveedor'];
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('contenido').style.display  = 'block';
    filtrarRutas();
  } catch(e) {
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('initError').textContent    = 'Error al cargar: ' + e.message;
    document.getElementById('initError').style.display  = 'block';
  }
}

function renderTablaRutas(entries) {
  const thead = document.getElementById('theadRutas');
  const tbody = document.getElementById('tbodyRutas');
  const badge = document.getElementById('badgeCantidad');
  const sinDatos = document.getElementById('sinDatos');

  thead.innerHTML = '<tr>'
    + HEADERS.map(h => '<th>' + escapeHtml(String(h)) + '</th>').join('')
    + (puedeGestionarRutas ? '<th>Acciones</th>' : '')
    + '</tr>';

  tbody.innerHTML = '';
  entries.forEach(({ row, idx }) => {
    const tr = document.createElement('tr');
    HEADERS.forEach((_, i) => {
      const td = document.createElement('td');
      td.textContent = row[i] != null ? String(row[i]) : '';
      tr.appendChild(td);
    });
    if (puedeGestionarRutas) {
      const tdAcciones = document.createElement('td');
      tdAcciones.style.whiteSpace = 'nowrap';

      const btnEditar = document.createElement('button');
      btnEditar.className   = 'btn btn-outline btn-sm';
      btnEditar.textContent = 'Editar nombre';
      btnEditar.style.marginRight = '6px';
      btnEditar.onclick = () => editarNombreRuta(idx);

      const btnEliminar = document.createElement('button');
      btnEliminar.className   = 'btn btn-danger btn-sm';
      btnEliminar.textContent = 'Eliminar';
      btnEliminar.onclick = () => eliminarRutaMaestra(idx);

      tdAcciones.appendChild(btnEditar);
      tdAcciones.appendChild(btnEliminar);
      tr.appendChild(tdAcciones);
    }
    tbody.appendChild(tr);
  });

  badge.textContent = entries.length + (entries.length === 1 ? ' ruta' : ' rutas');
  sinDatos.style.display = entries.length === 0 ? 'block' : 'none';
}

function filtrarRutas() {
  const q = document.getElementById('buscadorRutas').value.trim().toLowerCase();
  const entries = RUTAS
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => !q || row.some(cell => String(cell || '').toLowerCase().includes(q)));
  renderTablaRutas(entries);
}

// ── Eliminar / editar (solo ADMIN_GENERAL y ADMIN_TRAFICO) ──

async function recargarRutas() {
  const res = await gasCall('getDatosRutas');
  if (res.ok) {
    RUTAS = res.rutas || [];
    filtrarRutas();
  }
}

async function eliminarRutaMaestra(idx) {
  const row = RUTAS[idx];
  if (!row) return;
  const nombre = row[0] || '(sin nombre)';
  if (!confirm(`¿Eliminar la ruta maestra "${nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    const res = await gasCall('deleteRutaMaestra', { indice: idx });
    if (!res.ok) throw new Error(res.error || 'Error al eliminar');
    mostrarToast('✓ Ruta eliminada correctamente');
    await recargarRutas();
  } catch(e) {
    alert('Error al eliminar: ' + e.message);
  }
}

async function editarNombreRuta(idx) {
  const row = RUTAS[idx];
  if (!row) return;
  const nombreActual = row[0] || '';
  const nuevoNombre = prompt('Nuevo nombre de la ruta:', nombreActual);
  if (nuevoNombre === null) return;
  const nombre = nuevoNombre.trim();
  if (!nombre) { alert('El nombre no puede estar vacío.'); return; }
  if (nombre === nombreActual) return;
  try {
    const res = await gasCall('renombrarRutaMaestra', { indice: idx, nuevoNombre: nombre });
    if (!res.ok) throw new Error(res.error || 'Error al renombrar');
    mostrarToast('✓ Ruta renombrada correctamente');
    await recargarRutas();
  } catch(e) {
    alert('Error al renombrar: ' + e.message);
  }
}

function cambiarPestana(tab) {
  const isVer = tab === 'ver';
  document.getElementById('panelVer').style.display    = isVer ? 'block' : 'none';
  document.getElementById('panelCargar').style.display = isVer ? 'none'  : 'block';
  document.getElementById('tabVer').classList.toggle('activa', isVer);
  document.getElementById('tabCargar').classList.toggle('activa', !isVer);
}

function generarFilasRutas() {
  const cant = parseInt(document.getElementById('cantRutas').value, 10);
  if (!cant || cant < 1 || cant > 20) { alert('Ingresá una cantidad entre 1 y 20.'); return; }

  const contenedor = document.getElementById('filasRutas');
  contenedor.innerHTML = '';

  for (let i = 0; i < cant; i++) {
    const fila = document.createElement('div');
    fila.className = 'fila-datos';
    fila.dataset.idx = i;

    HEADERS.forEach((header, j) => {
      const group = document.createElement('div');
      group.className = 'fila-campo';

      const label = document.createElement('label');
      label.textContent = header + (j === 0 ? ' *' : '');
      group.appendChild(label);

      // Columna de proveedor (índice 1): dropdown select si hay socios
      if (j === 1 && SOCIOS.length > 0) {
        const sel = document.createElement('select');
        sel.className = 'fila-input';
        sel.dataset.col = j;
        const optVacio = document.createElement('option');
        optVacio.value = ''; optVacio.textContent = '— Sin proveedor —';
        sel.appendChild(optVacio);
        SOCIOS.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.name; opt.textContent = s.name;
          sel.appendChild(opt);
        });
        group.appendChild(sel);
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'fila-input';
        input.placeholder = j === 0 ? 'Nombre de la ruta (obligatorio)' : String(header);
        input.dataset.col = j;
        group.appendChild(input);
      }

      fila.appendChild(group);
    });

    contenedor.appendChild(fila);
  }

  document.getElementById('btnGuardarRutas').style.display = 'inline-flex';
  document.getElementById('errorRutas').style.display = 'none';
}

async function guardarRutas() {
  const filasEl = document.querySelectorAll('#filasRutas .fila-datos');
  if (!filasEl.length) return;

  let valido = true;
  const filas = [];

  filasEl.forEach(filaEl => {
    const fila = [];
    filaEl.querySelectorAll('.fila-input').forEach(input => {
      fila.push(input.value.trim());
    });
    const primero = filaEl.querySelector('[data-col="0"]');
    if (!primero || !primero.value.trim()) {
      if (primero) primero.classList.add('error');
      valido = false;
    } else {
      if (primero) primero.classList.remove('error');
    }
    filas.push(fila);
  });

  if (!valido) {
    document.getElementById('errorRutas').textContent = 'El nombre de la ruta es obligatorio en todas las filas.';
    document.getElementById('errorRutas').style.display = 'block';
    return;
  }
  document.getElementById('errorRutas').style.display = 'none';

  const btn = document.getElementById('btnGuardarRutas');
  setLoading(btn, true);
  try {
    const res = await gasCall('addRutasMaestras', { filas });
    if (!res.ok) throw new Error(res.error || 'Error al guardar');
    mostrarToast('✓ ' + filas.length + ' ruta(s) guardada(s) correctamente');
    await recargarRutas();
    document.getElementById('filasRutas').innerHTML = '';
    document.getElementById('btnGuardarRutas').style.display = 'none';
    cambiarPestana('ver');
  } catch(e) {
    document.getElementById('errorRutas').textContent = 'Error: ' + e.message;
    document.getElementById('errorRutas').style.display = 'block';
  } finally {
    setLoading(btn, false);
  }
}

function mostrarToast(msg) {
  const toast = document.getElementById('toastNotif');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}
