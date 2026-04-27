// rutas.js

let SESSION = null;
let RUTAS   = [];
let SOCIOS  = [];
let HEADERS = [];

document.addEventListener('DOMContentLoaded', async () => {
  SESSION = requireRole(['ADMIN_GENERAL', 'ADMIN_TRAFICO']);
  if (!SESSION) return;
  document.getElementById('userName').textContent     = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;
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
    renderTablaRutas(RUTAS);
  } catch(e) {
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('initError').textContent    = 'Error al cargar: ' + e.message;
    document.getElementById('initError').style.display  = 'block';
  }
}

function renderTablaRutas(rutas) {
  const thead = document.getElementById('theadRutas');
  const tbody = document.getElementById('tbodyRutas');
  const badge = document.getElementById('badgeCantidad');
  const sinDatos = document.getElementById('sinDatos');

  thead.innerHTML = '<tr>' + HEADERS.map(h => '<th>' + escapeHtml(String(h)) + '</th>').join('') + '</tr>';

  tbody.innerHTML = '';
  rutas.forEach(row => {
    const tr = document.createElement('tr');
    HEADERS.forEach((_, i) => {
      const td = document.createElement('td');
      td.textContent = row[i] != null ? String(row[i]) : '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  badge.textContent = rutas.length + (rutas.length === 1 ? ' ruta' : ' rutas');
  sinDatos.style.display = rutas.length === 0 ? 'block' : 'none';
}

function filtrarRutas() {
  const q = document.getElementById('buscadorRutas').value.trim().toLowerCase();
  const filtradas = q
    ? RUTAS.filter(row => row.some(cell => String(cell || '').toLowerCase().includes(q)))
    : RUTAS;
  renderTablaRutas(filtradas);
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
    const resAct = await gasCall('getDatosRutas');
    if (resAct.ok) { RUTAS = resAct.rutas || []; renderTablaRutas(RUTAS); }
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
