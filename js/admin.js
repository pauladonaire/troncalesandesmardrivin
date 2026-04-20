// admin.js

let SESSION = null;
let USUARIOS = [];
let editandoEmail = null;

document.addEventListener('DOMContentLoaded', async () => {
  SESSION = requireRole(['ADMIN_GENERAL']);
  if (!SESSION) return;

  document.getElementById('userName').textContent   = SESSION.nombre_completo;
  document.getElementById('userRolBadge').textContent = SESSION.rol;

  await cargarUsuarios();
  document.getElementById('searchInput').addEventListener('input', filtrarTabla);
});

async function cargarUsuarios() {
  const tbody = document.getElementById('usuariosTbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px;">Cargando...</td></tr>';
  try {
    const res = await gasCall('getUsuarios');
    if (!res.ok) throw new Error(res.error);
    USUARIOS = res.usuarios || [];
    renderTabla(USUARIOS);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger" style="padding:16px;">Error: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderTabla(lista) {
  const tbody = document.getElementById('usuariosTbody');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:20px;">Sin usuarios</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(u => `
    <tr>
      <td>${escapeHtml(u.nombre_completo)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td><span class="badge badge-info">${escapeHtml(u.rol)}</span></td>
      <td>${u.activo === 'TRUE' || u.activo === true
        ? '<span class="badge badge-success">Activo</span>'
        : '<span class="badge badge-danger">Inactivo</span>'}</td>
      <td class="actions-cell">
        <button class="btn btn-outline btn-sm" onclick="abrirEditar('${escapeHtml(u.email)}')">Editar</button>
        <button class="btn btn-sm ${u.activo === 'TRUE' || u.activo === true ? 'btn-danger' : 'btn-secondary'}"
          onclick="toggleActivo('${escapeHtml(u.email)}', ${u.activo === 'TRUE' || u.activo === true})">
          ${u.activo === 'TRUE' || u.activo === true ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>`).join('');
}

function filtrarTabla() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  renderTabla(USUARIOS.filter(u =>
    u.nombre_completo.toLowerCase().includes(q) ||
    u.email.toLowerCase().includes(q) ||
    u.rol.toLowerCase().includes(q)
  ));
}

// ── Nuevo usuario ──

function abrirNuevo() {
  document.getElementById('formNuevo').reset();
  document.getElementById('nuevoError').textContent = '';
  document.getElementById('modalNuevo').classList.add('active');
}

function cerrarNuevo() {
  document.getElementById('modalNuevo').classList.remove('active');
}

async function guardarNuevo(e) {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarNuevo');
  const errEl = document.getElementById('nuevoError');
  errEl.textContent = '';
  const usuario = {
    email:          document.getElementById('nuevoEmail').value.trim(),
    nombre_completo: document.getElementById('nuevoNombre').value.trim(),
    password:       document.getElementById('nuevoPass').value,
    rol:            document.getElementById('nuevoRol').value
  };
  setLoading(btn, true);
  try {
    const res = await gasCall('createUsuario', { usuario });
    if (res.ok) {
      cerrarNuevo();
      await cargarUsuarios();
    } else {
      errEl.textContent = res.error || 'Error al crear usuario.';
    }
  } catch (e) {
    errEl.textContent = 'Error de conexión.';
  } finally {
    setLoading(btn, false);
  }
}

// ── Editar usuario ──

function abrirEditar(email) {
  const u = USUARIOS.find(x => x.email === email);
  if (!u) return;
  editandoEmail = email;
  document.getElementById('editNombre').value = u.nombre_completo;
  document.getElementById('editEmail').value  = u.email;
  document.getElementById('editRol').value    = u.rol;
  document.getElementById('editError').textContent = '';
  document.getElementById('modalEditar').classList.add('active');
}

function cerrarEditar() {
  document.getElementById('modalEditar').classList.remove('active');
  editandoEmail = null;
}

async function guardarEditar(e) {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarEditar');
  const errEl = document.getElementById('editError');
  errEl.textContent = '';
  const datos = {
    nombre_completo: document.getElementById('editNombre').value.trim(),
    rol:             document.getElementById('editRol').value
  };
  setLoading(btn, true);
  try {
    const res = await gasCall('updateUsuario', { emailTarget: editandoEmail, datos });
    if (res.ok) {
      cerrarEditar();
      await cargarUsuarios();
    } else {
      errEl.textContent = res.error || 'Error al actualizar.';
    }
  } catch (e) {
    errEl.textContent = 'Error de conexión.';
  } finally {
    setLoading(btn, false);
  }
}

// ── Toggle activo ──

async function toggleActivo(email, estaActivo) {
  const nuevoEstado = !estaActivo;
  const accion = nuevoEstado ? 'activar' : 'desactivar';
  if (!confirm(`¿Seguro que querés ${accion} al usuario ${email}?`)) return;
  try {
    const res = await gasCall('toggleUsuarioActivo', { emailTarget: email, activo: nuevoEstado });
    if (res.ok) {
      await cargarUsuarios();
    } else {
      alert('Error: ' + (res.error || 'No se pudo actualizar.'));
    }
  } catch (e) {
    alert('Error de conexión.');
  }
}
