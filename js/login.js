// login.js

document.addEventListener('DOMContentLoaded', () => {
  if (getToken() && getSession()) {
    window.location.href = 'dashboard.html';
    return;
  }
  document.getElementById('loginForm').addEventListener('submit', handleSubmit);
});

async function handleSubmit(e) {
  e.preventDefault();
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btn      = document.getElementById('btnLogin');
  const errorDiv = document.getElementById('errorMsg');

  errorDiv.style.display = 'none';
  setLoading(btn, true);

  try {
    const res = await gasCall('login', { email, password });
    if (res.ok) {
      saveSession(res.token, res.usuario);
      window.location.href = 'dashboard.html';
    } else {
      showError(res.error || 'Credenciales incorrectas.');
    }
  } catch (e) {
    showError('Error de conexión. Verificá tu acceso a internet e intentá de nuevo.');
  } finally {
    setLoading(btn, false);
  }
}

function showError(msg) {
  const errorDiv = document.getElementById('errorMsg');
  errorDiv.textContent = msg;
  errorDiv.style.display = 'block';
}
