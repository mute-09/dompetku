import { APP_VERSION, ICONS, el, formatRupiah, svgIcon, clearNode, clamp, formatDate } from './utils.js';
import { api } from './api.js';
import * as store from './store.js';

export function cssVar(name, fallback = '') {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const listeners = new Set();
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(mode) {
  return mode === 'light' || mode === 'dark' ? mode : systemTheme();
}

export function applyTheme(mode) {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f6f7fb' : '#0b0d14');
  listeners.forEach((fn) => fn(resolved));
  return resolved;
}

export function initTheme() {
  const settings = store.getState().settings;
  return applyTheme(settings.theme || 'auto');
}

export function setupThemeToggle(button, mode) {
  const render = () => {
    const resolved = resolveTheme(mode());
    clearNode(button);
    button.append(svgIcon(resolved === 'dark' ? ICONS.sun : ICONS.moon, 20));
    button.setAttribute('aria-label', resolved === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
  };
  render();
  button.addEventListener('click', () => {
    const next = resolveTheme(mode()) === 'dark' ? 'light' : 'dark';
    store.setSettings({ theme: next });
    applyTheme(next);
    render();
  });
  return render;
}

/* === Toast === */

let toastRoot;
function ensureToastRoot() {
  if (!toastRoot) {
    toastRoot = el('div', { class: 'toast-stack', id: 'toastStack', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRoot);
  }
  return toastRoot;
}

export function toast({ message, tone = 'neutral', icon, actionLabel, onAction, duration = 4000 }) {
  const root = ensureToastRoot();
  const node = el('div', { class: `toast toast--${tone}` }, [
    icon ? svgIcon(icon === 'undo' ? ICONS.undo : ICONS.alert, 18) : null,
    el('span', { class: 'toast__text', text: message }),
    actionLabel
      ? el('button', {
          class: 'toast__action',
          type: 'button',
          text: actionLabel,
          onClick: () => {
            onAction?.();
            dismiss();
          }
        })
      : null,
    el('button', { class: 'toast__close', type: 'button', 'aria-label': 'Tutup', onClick: () => dismiss() }, [svgIcon(ICONS.close, 14)])
  ]);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 220);
  };

  root.append(node);
  timer = setTimeout(dismiss, duration);
  return dismiss;
}

/* === Deteksi Pembaruan === */

let updateDismiss = null;

/** Muat ulang shell dengan service worker dijamin terisi versi baru. */
async function muatUlangShell() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        const baru = reg.installing || reg.waiting;
        if (baru) {
          await new Promise((resolve) => {
            const selesai = () => {
              if (baru.state === 'activated' || baru.state === 'redundant') resolve();
            };
            baru.addEventListener('statechange', selesai);
            selesai();
            setTimeout(resolve, 5000);
          });
        }
      }
    } catch {
      /* gagal cek: muat ulang saja, andalkan service worker mengisi cache */
    }
  }
  location.reload();
}

/**
 * PWA yang terpasang di home screen tidak punya tombol refresh. Server
 * melaporkan versinya lewat /api/health (tidak pernah di-cache); kalau lebih
 * baru dari shell yang sedang berjalan, tawarkan tombol muat ulang.
 */
export function setupUpdateCheck({ intervalMs = 10 * 60 * 1000 } = {}) {
  let sedangCek = false;

  const cek = async () => {
    if (sedangCek || document.visibilityState !== 'visible') return;
    sedangCek = true;
    try {
      const res = await fetch('/api/health', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.version || data.version === APP_VERSION || updateDismiss) return;
      updateDismiss = toast({
        message: `Pembaruan DompetKu tersedia (${data.version}). Muat ulang agar fitur terbaru muncul.`,
        tone: 'warn',
        actionLabel: 'Muat ulang',
        onAction: muatUlangShell,
        duration: 60 * 1000
      });
    } catch {
      /* offline atau server tak terjangkau: coba lagi nanti */
    } finally {
      sedangCek = false;
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') cek();
  });
  setTimeout(cek, 4000);
  setInterval(cek, intervalMs);
}

/* === Bottom Sheet === */

let openSheets = 0;

export function openSheet({ title, subtitle, body, footer, onClose, size = 'default' }) {
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const sheet = el('div', { class: `sheet sheet--${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Panel' });

  const head = el('div', { class: 'sheet__head' }, [
    el('div', { class: 'sheet__handle' }),
    el('div', { class: 'sheet__titles' }, [
      title ? el('h3', { class: 'sheet__title', text: title }) : null,
      subtitle ? el('p', { class: 'sheet__subtitle', text: subtitle }) : null
    ]),
    el('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': 'Tutup', onClick: () => close() }, [svgIcon(ICONS.close, 18)])
  ]);

  const content = el('div', { class: 'sheet__body' });
  if (body) content.append(body);

  sheet.append(head, content);
  if (footer) sheet.append(el('div', { class: 'sheet__foot' }, [footer]));
  backdrop.append(sheet);
  document.body.append(backdrop);
  document.body.classList.add('is-locked');
  openSheets += 1;

  requestAnimationFrame(() => backdrop.classList.add('is-open'));

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    openSheets = Math.max(0, openSheets - 1);
    setTimeout(() => backdrop.remove(), 240);
    onClose?.();
  }

  return { close, content, sheet };
}

export function confirmSheet({ title, message, confirmLabel = 'Ya, lanjutkan', cancelLabel = 'Batal', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const footer = el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', text: cancelLabel, onClick: () => { finish(false); handle.close(); } }),
      el('button', {
        class: danger ? 'btn btn--danger' : 'btn btn--primary',
        type: 'button',
        text: confirmLabel,
        onClick: () => { finish(true); handle.close(); }
      })
    ]);
    const handle = openSheet({
      title,
      body: el('p', { class: 'sheet__text', text: message }),
      footer,
      onClose: () => finish(false)
    });
  });
}

/* === Pengaturan === */

export function openSettings() {
  const settings = store.getState().settings;

  const thresholdValue = el('output', { class: 'range__value', text: `${Number(settings.threshold).toFixed(1)}×` });
  const thresholdInput = el('input', {
    class: 'range',
    type: 'range',
    min: '1.1',
    max: '3',
    step: '0.1',
    value: String(settings.threshold)
  });
  thresholdInput.addEventListener('input', () => {
    const value = clamp(Number(thresholdInput.value), 1.1, 3);
    thresholdValue.textContent = `${value.toFixed(1)}×`;
    store.setSettings({ threshold: value });
  });

  const themeSelect = el('select', { class: 'field__control' }, [
    el('option', { value: 'auto', text: 'Ikuti sistem', selected: settings.theme === 'auto' }),
    el('option', { value: 'dark', text: 'Gelap', selected: settings.theme === 'dark' }),
    el('option', { value: 'light', text: 'Terang', selected: settings.theme === 'light' })
  ]);
  themeSelect.addEventListener('change', () => {
    store.setSettings({ theme: themeSelect.value });
    applyTheme(themeSelect.value);
  });

  const importInput = el('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const payload = await store.readJSONFile(file);
      const result = await store.replaceAll(payload);
      if (!result.ok) {
        toast({ message: result.queued ? 'Offline: backup disimpan lokal.' : result.error, tone: 'warn' });
        return;
      }
      handle.close();
      toast({
        message: result.imported
          ? `${result.imported} transaksi dipulihkan.`
          : 'Tidak ada transaksi baru untuk dipulihkan.',
        tone: 'good'
      });
    } catch (err) {
      toast({ message: err.message, tone: 'bad' });
    }
  });

  const stats = store.totals();
  const count = store.getState().expenses.length + store.getState().incomes.length;

  const body = el('div', { class: 'settings' }, [
    el('div', { class: 'settings__stat' }, [
      el('span', { class: 'settings__stat-label', text: `${count} transaksi tersimpan` }),
      el('span', { class: 'settings__stat-value', text: formatRupiah(stats.balance, { sign: stats.balance >= 0 }) })
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Ambang pengeluaran tidak biasa' }),
      el('div', { class: 'range__wrap' }, [thresholdInput, thresholdValue]),
      el('p', { class: 'field__hint', text: `Transaksi harian ditandai tidak biasa bila melebihi ${Number(settings.threshold).toFixed(1)}× rata-rata pengeluaran harian.` })
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'themeSelect', text: 'Tampilan' }),
      themeSelect
    ]),
    el('div', { class: 'settings__actions' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { store.downloadJSON(); toast({ message: 'Backup JSON diunduh.' }); } }, [svgIcon(ICONS.download, 18), 'Unduh backup']),
      el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => importInput.click() }, [svgIcon(ICONS.upload, 18), 'Pulihkan backup']),
      importInput
    ]),
    el('button', {
      class: 'btn btn--danger-ghost btn--block',
      type: 'button',
      onClick: async () => {
        const ok = await confirmSheet({
          title: 'Hapus semua data?',
          message: 'Seluruh transaksi dan pengaturan akan dihapus permanen. Pastikan kamu sudah mengunduh backup.',
          confirmLabel: 'Hapus semua',
          danger: true
        });
        if (!ok) return;
        const terhapus = await store.clearAll();
        if (!terhapus) {
          toast({
            message: store.isReadOnly() ? store.PESAN_OFFLINE : 'Gagal menghapus data.',
            tone: 'warn'
          });
          return;
        }
        handle.close();
        toast({ message: 'Semua data dihapus.', tone: 'warn' });
      }
    }, [svgIcon(ICONS.trash, 18), 'Hapus semua data'])
  ]);

  const handle = openSheet({ title: 'Pengaturan', subtitle: 'Preferensi aplikasi & data', body });
  return handle;
}

/* === Akun & sinkronisasi === */

const STATUS_TEXT = {
  memuat: 'Memuat…',
  sinkron: 'Tersinkron',
  menyinkron: 'Menyinkron…',
  menunggu: 'Menunggu sinkron',
  offline: 'Offline',
  gagal: 'Gagal sinkron',
  keluar: 'Sesi berakhir'
};

/** "baru saja" / "12 menit lalu" / "3 jam lalu" — untuk data yang belum segar. */
function sejakLabel(iso) {
  if (!iso) return null;
  const selisih = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(selisih) || selisih < 0) return null;
  const menit = Math.round(selisih / 60000);
  if (menit < 1) return 'baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.round(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.round(jam / 24)} hari lalu`;
}

/** Banner di bawah appbar saat data yang tampil bukan data terbaru. */
function bannerOffline() {
  let banner = document.getElementById('offlineBanner');
  if (!banner) {
    banner = el('div', {
      class: 'offline-banner',
      id: 'offlineBanner',
      role: 'status',
      'aria-live': 'polite',
      hidden: true
    });
    const appbar = document.querySelector('.appbar');
    if (appbar?.parentElement) appbar.parentElement.insertBefore(banner, appbar.nextSibling);
    else document.body.prepend(banner);
  }
  return banner;
}

export function setupSyncBadge(badge, accountBtn) {
  if (badge) {
    const banner = bannerOffline();
    store.onStatus((status) => {
      const tone = status.status === 'offline' || status.status === 'gagal'
        ? 'warn'
        : status.status === 'sinkron' ? 'good' : 'idle';
      badge.dataset.tone = tone;
      const basi = status.status === 'offline' ? sejakLabel(status.lastSync) : null;
      const parts = [STATUS_TEXT[status.status] || '', basi, status.pending || null]
        .filter((bagian) => bagian !== null && bagian !== '');
      badge.textContent = parts.join(' · ');
      badge.hidden = !badge.textContent;

      if (status.status === 'offline') {
        banner.textContent = basi
          ? `Offline · menampilkan data tersimpan · terakhir sinkron ${basi}`
          : 'Offline · menampilkan data tersimpan';
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
    });
  }
  if (accountBtn) {
    const render = () => {
      const user = store.currentUser();
      const initial = (user?.username || '?').slice(0, 1).toUpperCase();
      clearNode(accountBtn);
      accountBtn.append(el('span', { class: 'avatar', text: initial }));
      accountBtn.setAttribute('aria-label', `Akun ${user?.username || ''} — ketuk untuk kelola sesi`);
      accountBtn.title = user ? `Masuk sebagai ${user.username}` : '';
    };
    render();
    store.onStatus(render);
    accountBtn.addEventListener('click', () => openAccountSheet());
  }
}

function sessionRow(session) {
  const aktif = new Date(session.terakhir || session.sejak);
  return el('li', { class: `session${session.ini ? ' is-self' : ''}` }, [
    el('div', {}, [
      el('strong', { text: session.perangkat }),
      el('span', { class: 'session__meta', text: `${session.alamat || '-'} · aktif ${formatDate(aktif, 'short')}` })
    ]),
    el('span', { class: 'session__tag', text: session.ini ? 'Perangkat ini' : session.username })
  ]);
}

export function openAccountSheet() {
  const user = store.currentUser() || { username: '?' };
  const list = el('ul', { class: 'sessions' });
  const note = el('p', { class: 'field__hint', text: 'Memuat daftar perangkat…' });

  const currentInput = el('input', { class: 'field__control', type: 'password', autocomplete: 'current-password', placeholder: 'Password lama' });
  const nextInput = el('input', { class: 'field__control', type: 'password', autocomplete: 'new-password', placeholder: 'Password baru (min. 6 karakter)' });
  const confirmInput = el('input', { class: 'field__control', type: 'password', autocomplete: 'new-password', placeholder: 'Ulangi password baru' });
  const passwordNote = el('p', { class: 'field__hint' });

  const savePassword = el('button', { class: 'btn btn--ghost', type: 'submit', text: 'Ganti password' });

  const form = el('form', {
    class: 'account__form',
    novalidate: true,
    onSubmit: async (event) => {
      event.preventDefault();
      if (nextInput.value !== confirmInput.value) {
        passwordNote.textContent = 'Password baru tidak sama.';
        passwordNote.style.color = 'var(--expense)';
        return;
      }
      savePassword.disabled = true;
      try {
        const result = await api.password(currentInput.value, nextInput.value);
        passwordNote.textContent = result.message || 'Password diperbarui.';
        passwordNote.style.color = 'var(--income)';
        currentInput.value = nextInput.value = confirmInput.value = '';
        toast({ message: 'Password diperbarui.', tone: 'good' });
        refreshSessions();
      } catch (err) {
        passwordNote.textContent = err.message;
        passwordNote.style.color = 'var(--expense)';
      } finally {
        savePassword.disabled = false;
      }
    }
  }, [
    el('div', { class: 'field' }, [el('label', { class: 'field__label', text: 'Ganti password' })]),
    currentInput,
    nextInput,
    confirmInput,
    savePassword,
    passwordNote
  ]);

  async function refreshSessions() {
    try {
      const session = await api.session();
      clearNode(list);
      (session.sessions || []).forEach((s) => list.append(sessionRow(s)));
      note.textContent = `Kuota ${session.slots?.used || 0}/${session.slots?.max || 2} sesi terpakai. Sesi idle lebih dari 30 hari akan kedaluwarsa.`;
    } catch (err) {
      note.textContent = err.message;
    }
  }

  const body = el('div', { class: 'account' }, [
    el('div', { class: 'account__head' }, [
      el('span', { class: 'account__avatar', text: (user.username || '?').slice(0, 1).toUpperCase() }),
      el('div', {}, [
        el('strong', { class: 'account__name', text: user.username }),
        el('span', { class: 'account__role', text: 'Anggota dompet keluarga' })
      ])
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Perangkat yang sedang login' }),
      list,
      note
    ]),
    form,
    el('div', { class: 'settings__actions' }, [
      el('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: 'Keluar di perangkat lain',
        onClick: async () => {
          const ok = await confirmSheet({
            title: 'Keluar di perangkat lain?',
            message: 'Semua sesi selain perangkat ini akan diakhiri.',
            confirmLabel: 'Akhiri sesi lain'
          });
          if (!ok) return;
          try {
            await api.logout('others');
          } catch (err) {
            toast({ message: err.message || 'Gagal mengeluarkan sesi lain.', tone: 'bad' });
            return;
          }
          toast({ message: 'Sesi lain dikeluarkan.', tone: 'good' });
          refreshSessions();
        }
      }),
      el('button', {
        class: 'btn btn--danger-ghost',
        type: 'button',
        text: 'Keluar',
        onClick: async () => {
          handle.close();
          // Sesi yang sudah habis pun tetap keluar ke halaman login; hanya
          // kegagalan jaringan yang perlu diberi tahu pengguna.
          let alasan = 'keluar';
          try {
            await api.logout('self');
          } catch (err) {
            if (!err.unauthorized) alasan = 'gagal';
          }
          location.replace(new URL(`login.html?alasan=${alasan}`, document.baseURI).href);
        }
      })
    ])
  ]);

  const handle = openSheet({ title: 'Akun', subtitle: 'Masuk, perangkat, dan keamanan', body });
  refreshSessions();
  return handle;
}

/* === PWA install === */

export function setupInstall() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    const dismiss = toast({
      message: 'Pasang DompetKu untuk akses offline.',
      icon: 'undo',
      actionLabel: 'Pasang',
      duration: 9000,
      onAction: async () => {
        if (!deferred) return;
        deferred.prompt();
        await deferred.userChoice;
        deferred = null;
      }
    });
    window.addEventListener('appinstalled', dismiss, { once: true });
  });
}

export function scrollTop(smooth = true) {
  window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
}