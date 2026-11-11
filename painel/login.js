import { api } from './common.js';

const f = document.getElementById('f');
const err = document.getElementById('err');
const ok = document.getElementById('ok');

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true; ok.disabled = true; ok.textContent = 'Entrando...';
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: f.email.value, senha: f.senha.value } });
    location.href = r.destino;
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
    ok.disabled = false; ok.textContent = 'Entrar';
  }
});
