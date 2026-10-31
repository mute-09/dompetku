/* Halaman Kalender — jadwal anak, ulang tahun, dan tagihan. */

import * as store from './store.js';
import { ApiError, SessionExpired, api } from './api.js';
import {
  initTheme,
  openSettings,
  openSheet,
  confirmSheet,
  setupInstall,
  setupSyncBadge,
  setupThemeToggle,
  setupUpdateCheck,
  toast
} from './ui.js';
import {
  clearNode,
  daysBetween,
  el,
  formatDate,
  formatNominalInput,
  formatRupiah,
  parseDate,
  parseNominalInput,
  todayStr
} from './utils.js';

const CACHE_KEY = 'dompetku.calendar';

const TYPES = [
  { id: 'schedule', label: 'Jadwal Anak', short: 'Jadwal' },
  { id: 'birthday', label: 'Ulang Tahun', short: 'Ulang tahun' },
  { id: 'bill', label: 'Tagihan', short: 'Tagihan' }
];
const FILTERS = [{ id: 'all', label: 'Semua' }, ...TYPES];

const dom = {
  filterChips: document.getElementById('calendarFilterChips'),
  list: document.getElementById('calendarList'),
  empty: document.getElementById('calendarEmpty'),
  addBtn: document.getElementById('addCalendarBtn'),
  appbar: document.getElementById('appbar')
};

const view = { filter: 'all', showPast: false };
let items = readCache();

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeCache(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    /* penyimpanan penuh: cukup lewati cache */
  }
}

function typeMeta(id) {
  return TYPES.find((t) => t.id === id) || TYPES[0];
}

function itemDate(it) {
  return it.date || it.start_date || '';
}

function isOverdue(it, today) {
  return it.type === 'bill' && it.status !== 'paid' && itemDate(it) < today;
}

/** Label tanggal yang melihat ke depan: Hari ini, Besok, Dalam 3 hari, Kemarin, … */
function dayLabel(date) {
  const diff = daysBetween(new Date(), parseDate(date));
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Besok';
  if (diff === -1) return 'Kemarin';
  if (diff > 1 && diff < 7) return `Dalam ${diff} hari`;
  return formatDate(date, 'day');
}

function byDateTime(a, b) {
  const d = itemDate(a).localeCompare(itemDate(b));
  return d || (a.time || '').localeCompare(b.time || '');
}

function groupByDate(list) {
  const map = new Map();
  for (const it of list) {
    const key = itemDate(it);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return [...map.entries()];
}

/* === Render === */

function renderChips() {
  clearNode(dom.filterChips);
  for (const f of FILTERS) {
    const count = f.id === 'all' ? items.length : items.filter((x) => x.type === f.id).length;
    dom.filterChips.append(
      el(
        'button',
        {
          class: `chip${view.filter === f.id ? ' is-active' : ''}`,
          type: 'button',
          'aria-pressed': view.filter === f.id ? 'true' : 'false',
          onClick: () => {
            view.filter = f.id;
            renderChips();
            renderList();
          }
        },
        count ? `${f.label} · ${count}` : f.label
      )
    );
  }
}

function itemRow(it, today) {
  const overdue = isOverdue(it, today);
  const meta = [typeMeta(it.type).short, it.time, it.child].filter(Boolean).join(' · ');
  const aside = [];
  if (it.type === 'bill') {
    if (it.amount != null) aside.push(el('span', { class: 'tx__amount num is-out', text: formatRupiah(it.amount) }));
    aside.push(
      el('span', {
        class: `cal__status${it.status === 'paid' ? ' is-paid' : ''}`,
        text: it.status === 'paid' ? 'Lunas' : 'Belum lunas'
      })
    );
  }
  return el(
    'button',
    {
      class: `tx cal__row cal__row--${it.type}`,
      type: 'button',
      'aria-label': `${it.title}, ${meta}, ${formatDate(itemDate(it))}. Ketuk untuk mengubah.`,
      onClick: () => openForm(it)
    },
    [
      el('span', { class: 'tx__body' }, [
        el('span', { class: 'tx__name' }, [
          it.title || '(Tanpa judul)',
          overdue ? el('span', { class: 'tx__flag', text: 'Terlambat' }) : null
        ]),
        meta ? el('span', { class: 'tx__meta', text: meta }) : null
      ]),
      aside.length ? el('span', { class: 'cal__aside' }, aside) : null
    ]
  );
}

function dayGroup(date, list, today) {
  return el('section', { class: 'daygroup' }, [
    el('div', { class: 'daygroup__head' }, [
      el('div', {}, [
        el('span', { class: 'daygroup__label', text: date ? dayLabel(date) : 'Tanpa tanggal' }),
        date ? el('span', { class: 'daygroup__sub', text: formatDate(date) }) : null
      ])
    ]),
    el('div', { class: 'tx-list' }, list.map((it) => itemRow(it, today)))
  ]);
}

function renderList() {
  clearNode(dom.list);
  const today = todayStr();
  const data = items.filter((x) => view.filter === 'all' || x.type === view.filter);

  // Agenda mendatang dulu; tagihan lewat jatuh tempo yang belum lunas tetap di atas karena masih perlu ditindak.
  const upcoming = data.filter((x) => itemDate(x) >= today || isOverdue(x, today)).sort(byDateTime);
  const past = data.filter((x) => !upcoming.includes(x)).sort((a, b) => byDateTime(b, a));

  dom.empty.hidden = data.length > 0;
  if (!data.length) return;

  if (!upcoming.length) {
    dom.list.append(el('p', { class: 'cal__note', text: 'Tidak ada agenda mendatang.' }));
  }
  for (const [date, list] of groupByDate(upcoming)) dom.list.append(dayGroup(date, list, today));

  if (past.length) {
    dom.list.append(
      el(
        'button',
        {
          class: 'btn btn--ghost btn--block cal__past-toggle',
          type: 'button',
          'aria-expanded': view.showPast ? 'true' : 'false',
          onClick: () => {
            view.showPast = !view.showPast;
            renderList();
          }
        },
        view.showPast ? 'Sembunyikan agenda lewat' : `Tampilkan agenda lewat (${past.length})`
      )
    );
    if (view.showPast) {
      for (const [date, list] of groupByDate(past)) dom.list.append(dayGroup(date, list, today));
    }
  }
}

function render() {
  renderChips();
  renderList();
}

/* === Data === */

async function load({ quiet = true } = {}) {
  try {
    const res = await api.calendarItems(500);
    items = Array.isArray(res?.items) ? res.items : [];
    writeCache(items);
  } catch (err) {
    if (err instanceof SessionExpired) return;
    if (!(err instanceof ApiError && err.isOffline) || !quiet) {
      toast({ message: err.message || 'Gagal memuat agenda.', tone: 'bad' });
    }
  }
  render();
}

function blockedOffline() {
  if (!store.isReadOnly()) return false;
  toast({ message: store.PESAN_OFFLINE, tone: 'warn' });
  return true;
}

/* === Form tambah / ubah === */

let formSeq = 0;

function field(label, control, extra = {}) {
  return el('div', { class: 'field', ...extra }, [el('label', { class: 'field__label', text: label }), control]);
}

function openForm(item = null) {
  if (!item && blockedOffline()) return;
  const isEdit = Boolean(item);
  const formId = `calendarForm${++formSeq}`;
  let type = item?.type || (view.filter !== 'all' ? view.filter : 'schedule');

  const form = el('form', { class: 'form', id: formId, novalidate: true });

  const typeBtns = TYPES.map((t) =>
    el('button', { class: 'segmented__btn', type: 'button', 'data-type': t.id, onClick: () => setType(t.id) }, t.label)
  );
  const titleInput = el('input', {
    class: 'field__control',
    name: 'title',
    maxlength: '120',
    autocomplete: 'off',
    value: item?.title || ''
  });
  const dateInput = el('input', { class: 'field__control field__control--date', type: 'date', name: 'date', value: itemDate(item || {}) || todayStr() });
  const timeInput = el('input', { class: 'field__control', type: 'time', name: 'time', value: item?.time || '' });
  const childInput = el('input', { class: 'field__control', name: 'child', maxlength: '60', autocomplete: 'off', value: item?.child || '' });
  const amountInput = el('input', {
    class: 'field__control num',
    name: 'amount',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder: '0',
    value: item?.amount != null ? formatNominalInput(item.amount) : ''
  });
  amountInput.addEventListener('input', () => {
    amountInput.value = formatNominalInput(amountInput.value);
  });
  const paidInput = el('input', { type: 'checkbox', name: 'paid', checked: item?.status === 'paid' });
  const notesInput = el('textarea', { class: 'field__control', name: 'notes', rows: '3', maxlength: '500' }, item?.notes || '');
  const err = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const childField = field('Nama anak (opsional)', childInput);
  const billFields = el('div', {}, [
    field('Nominal tagihan (opsional)', amountInput),
    el('label', { class: 'cal__check' }, [paidInput, el('span', { text: 'Sudah lunas' })])
  ]);

  form.append(
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'Jenis agenda' }, typeBtns),
    field('Judul', titleInput),
    el('div', { class: 'field-row' }, [field('Tanggal', dateInput), field('Jam (opsional)', timeInput)]),
    childField,
    billFields,
    field('Catatan (opsional)', notesInput),
    err
  );

  const placeholders = {
    schedule: 'Contoh: Les renang',
    birthday: 'Contoh: Ulang tahun Aisyah',
    bill: 'Contoh: Listrik PLN'
  };

  function setType(next) {
    type = next;
    typeBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.type === type));
    titleInput.placeholder = placeholders[type];
    childField.hidden = type === 'bill';
    billFields.hidden = type !== 'bill';
  }
  setType(type);

  const footer = el('div', { class: 'btn-row' });
  if (isEdit) {
    footer.append(el('button', { class: 'btn btn--danger-ghost', type: 'button', text: 'Hapus', onClick: hapus }));
  } else {
    footer.append(el('button', { class: 'btn btn--ghost', type: 'button', text: 'Batal', onClick: () => handle.close() }));
  }
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit', form: formId, text: 'Simpan' });
  footer.append(saveBtn);

  function showError(message) {
    err.textContent = message;
    err.hidden = false;
  }

  async function hapus() {
    if (blockedOffline()) return;
    const ok = await confirmSheet({
      title: 'Hapus agenda?',
      message: `"${item.title}" akan dihapus untuk semua anggota keluarga.`,
      confirmLabel: 'Hapus',
      danger: true
    });
    if (!ok) return;
    try {
      await api.deleteCalendarItem(item.id);
      handle.close();
      toast({ message: 'Agenda dihapus.', tone: 'good' });
      await load();
    } catch (e) {
      if (!(e instanceof SessionExpired)) showError(e.message || 'Gagal menghapus.');
    }
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    if (blockedOffline()) return;
    const title = titleInput.value.trim();
    if (!title) {
      showError('Judul wajib diisi.');
      titleInput.focus();
      return;
    }
    if (!dateInput.value) {
      showError('Tanggal wajib diisi.');
      dateInput.focus();
      return;
    }
    const isBill = type === 'bill';
    const payload = {
      type,
      title,
      date: dateInput.value,
      time: timeInput.value || '',
      child: isBill ? '' : childInput.value.trim(),
      amount: isBill && amountInput.value ? parseNominalInput(amountInput.value) : '',
      status: isBill && paidInput.checked ? 'paid' : 'pending',
      notes: notesInput.value.trim()
    };
    saveBtn.disabled = true;
    try {
      if (isEdit) await api.updateCalendarItem({ ...payload, id: item.id });
      else await api.createCalendarItem(payload);
      handle.close();
      toast({ message: isEdit ? 'Agenda diperbarui.' : 'Agenda ditambahkan.', tone: 'good' });
      await load();
    } catch (e) {
      if (!(e instanceof SessionExpired)) showError(e.message || 'Gagal menyimpan.');
    } finally {
      saveBtn.disabled = false;
    }
  });

  const handle = openSheet({
    title: isEdit ? 'Ubah Agenda' : 'Tambah Agenda',
    subtitle: 'Jadwal anak, ulang tahun & tagihan',
    body: el('div', { class: 'sheet-form' }, [form]),
    footer
  });
  if (!isEdit) setTimeout(() => titleInput.focus(), 260);
}

/* === Init === */

initTheme();
setupThemeToggle(document.getElementById('themeToggle'), () => store.getState().settings.theme);
setupSyncBadge(document.getElementById('syncBadge'), document.getElementById('accountBtn'));
setupInstall();
setupUpdateCheck();
document.getElementById('settingsBtn')?.addEventListener('click', () => openSettings());
dom.addBtn?.addEventListener('click', () => openForm());

render();

store.init().then(({ expired, offline } = {}) => {
  if (expired) return;
  initTheme();
  if (!offline) load();
}).catch((err) => console.warn('Gagal memuat data:', err));

window.addEventListener('online', () => load());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !store.isReadOnly()) load();
});

window.addEventListener(
  'scroll',
  () => dom.appbar?.classList.toggle('is-scrolled', window.scrollY > 8),
  { passive: true }
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Pendaftaran service worker gagal:', err));
  });
}
