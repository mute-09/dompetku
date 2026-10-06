import { SessionExpired, api, resetExpiryGuard } from './api.js';
import { initTheme } from './ui.js';

const dom = {
  form: document.getElementById('loginForm'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  button: document.getElementById('loginButton'),
  error: document.getElementById('loginError'),
  slots: document.getElementById('loginSlots'),
  toggle: document.getElementById('togglePassword')
};

const HOME = new URL('index.html', document.baseURI).href;
let busy = false;

// Halaman login ikut tema yang tersimpan, sama seperti halaman utama.
initTheme();

function showError(message) {
  dom.error.textContent = message;
  dom.error.hidden = !message;
}

function showSlots(sessions, max) {
  if (!Array.isArray(sessions) || !sessions.length) {
    dom.slots.hidden = true;
    return;
  }
  const lines = sessions.map((s) => `• ${s.username} · ${s.perangkat}`);
  dom.slots.textContent = `Sesi terpakai (${sessions.length}/${max}):\n${lines.join('\n')}`;
  dom.slots.hidden = false;
}

function setBusy(value) {
  busy = value;
  dom.button.disabled = value;
  dom.button.textContent = value ? 'Memproses…' : 'Masuk';
}

async function redirectHome() {
  const next = new URLSearchParams(location.search).get('next');
  const target = next && next.startsWith('/') === false && !next.includes('://') ? next : HOME;
  location.replace(target);
}

async function guard() {
  try {
    await api.session();
    resetExpiryGuard();
    redirectHome();
    return true;
  } catch (err) {
    if (err instanceof SessionExpired) resetExpiryGuard();
    return false;
  }
}

async function refreshSlots() {
  try {
    const info = await api.slots();
    const max = info.max || 2;
    if (info.available <= 0) {
      dom.slots.textContent = `Semua ${max} sesi sedang terpakai. Keluar dari salah satu perangkat lain, lalu coba lagi.`;
      dom.slots.hidden = false;
    } else {
      dom.slots.hidden = true;
    }
  } catch {
    dom.slots.hidden = true;
  }
}

dom.toggle.addEventListener('click', () => {
  const reveal = dom.password.type === 'password';
  dom.password.type = reveal ? 'text' : 'password';
  dom.toggle.textContent = reveal ? 'Sembunyikan' : 'Lihat';
  dom.toggle.setAttribute('aria-label', reveal ? 'Sembunyikan password' : 'Tampilkan password');
});

dom.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const username = dom.username.value.trim().toLowerCase();
  const password = dom.password.value;
  if (!username || !password) {
    showError('Isi nama pengguna dan password dulu.');
    return;
  }
  setBusy(true);
  showError('');
  try {
    await api.login(username, password);
    resetExpiryGuard();
    dom.password.value = '';
    await redirectHome();
  } catch (err) {
    if (err instanceof SessionExpired) {
      showError(err.message);
    } else if (err.status === 409) {
      showError('Kuota sesi penuh. Putuskan salah satu perangkat yang sedang login.');
      showSlots(err.data?.sessions, err.data?.sessions?.length || 2);
    } else {
      showError(err.message || 'Gagal masuk. Coba lagi.');
      dom.password.select();
    }
    setBusy(false);
    refreshSlots();
  }
});

function showAlasanKeluar() {
  const params = new URLSearchParams(location.search);
  const alasan = params.get('alasan');
  if (!alasan) return;
  params.delete('alasan');
  const cleaned = `${location.pathname}${params.toString() ? `?${params}` : ''}`;
  history.replaceState(null, '', cleaned);
  if (alasan === 'keluar') {
    dom.slots.textContent = 'Anda sudah keluar. Silakan masuk kembali.';
    dom.slots.hidden = false;
  } else if (alasan === 'gagal') {
    showError('Gagal menghubungi server saat keluar. Periksa koneksi, lalu coba lagi.');
  }
}

guard().then((passed) => {
  if (!passed) {
    refreshSlots().then(showAlasanKeluar);
    dom.username.focus();
  }
});

dom.username.value = new URLSearchParams(location.search).get('u') || '';