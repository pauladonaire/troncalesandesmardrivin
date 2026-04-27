// arrastres.js

let SESSION   = null;
let ARRASTRES = [];
let HEADERS   = [];

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
    const res = await gasCall('getDatosArrastres');
    if (!res.ok) throw new Error(res.error || 'Error al cargar arrastres');
    ARRASTRES = res.arrastres || [];
    HEADERS   = res.headers  || ['Código', 'Descripción'];
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('contenido').style.display  = 'block';
    renderTablaArrastres(ARRASTRES);
  } catch(e) {
    document.getElementById('initLoader').style.display = 'none';
    document.getElementById('initError').textContent    = 'Error al cargar: ' + e.message;
    document.getElementById('initError').style.display  = 'block';
  }
}

function renderTablaArrastres(arrastres) {
  const thead = document.getElementById('theadArrastres');
  const tbody = document.getElementById('tbodyArrastres');
  const badge = document.getElementById('badgeCantidad');
  const sinDatos = document.getElementById('sinDatos');

  thead.innerHTML = '<tr>' + HEADERS.map(h => '<th>' + escapeHtml(String(h)) + '</th>').join('') + '</tr>';

  tbody.innerHTML = '';
  arrastres.forEach(row => {
    const tr = document.createElement('tr');
    HEADERS.forEach((_, i) => {
      const td = document.createElement('td');
      td.textContent = row[i] != null ? String(row[i]) : '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  badge.textContent = arrastres.length + (arrastres.length === 1 ? ' arrastre' : ' arrastres');
  sinDatos.style.display = arrastres.length === 0 ? 'block' : 'none';
}

function filtrarArrastres() {
  const q = document.getElementById('buscadorArrastres').value.trim().toLowerCase();
  const filtrados = q
    ? ARRASTRES.filter(row => row.some(cell => String(cell || '').toLowerCase().includes(q)))
    : ARRASTRES;
  renderTablaArrastres(filtrados);
}

function cambiarPestana(tab) {
  const isVer = tab === 'ver';
  document.getElementById('panelVer').style.display    = isVer ? 'block' : 'none';
  document.getElementById('panelCargar').style.display = isVer ? 'none'  : 'block';
  document.getElementById('tabVer').classList.toggle('activa', isVer);
  document.getElementById('tabCargar').classList.toggle('activa', !isVer);
}

function generarFilasArrastres() {
  const cant = parseInt(document.getElementById('cantArrastres').value, 10);
  if (!cant || cant < 1 || cant > 20) { alert('Ingresá una cantidad entre 1 y 20.'); return; }

  const contenedor = document.getElementById('filasArrastres');
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

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'fila-input';
      input.placeholder = j === 0 ? 'Código del arrastre (obligatorio)' : String(header);
      input.dataset.col = j;
      group.appendChild(input);

      fila.appendChild(group);
    });

    contenedor.appendChild(fila);
  }

  document.getElementById('btnGuardarArrastres').style.display = 'inline-flex';
  document.getElementById('errorArrastres').style.display = 'none';
}

async function guardarArrastres() {
  const filasEl = document.querySelectorAll('#filasArrastres .fila-datos');
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
    document.getElementById('errorArrastres').textContent = 'El código del arrastre es obligatorio en todas las filas.';
    document.getElementById('errorArrastres').style.display = 'block';
    return;
  }
  document.getElementById('errorArrastres').style.display = 'none';

  const btn = document.getElementById('btnGuardarArrastres');
  setLoading(btn, true);
  try {
    const res = await gasCall('addArrastres', { filas });
    if (!res.ok) throw new Error(res.error || 'Error al guardar');
    mostrarToast('✓ ' + filas.length + ' arrastre(s) guardado(s) correctamente');
    const resAct = await gasCall('getDatosArrastres');
    if (resAct.ok) { ARRASTRES = resAct.arrastres || []; renderTablaArrastres(ARRASTRES); }
    document.getElementById('filasArrastres').innerHTML = '';
    document.getElementById('btnGuardarArrastres').style.display = 'none';
    cambiarPestana('ver');
  } catch(e) {
    document.getElementById('errorArrastres').textContent = 'Error: ' + e.message;
    document.getElementById('errorArrastres').style.display = 'block';
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
