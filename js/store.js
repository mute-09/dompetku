import { ApiError, SessionExpired, api, onSessionExpired, resetExpiryGuard } from './api.js';
import { uid, toDateStr, todayStr } from './utils.js';

const CACHE_KEY = 'dompetku.v2';
const OUTBOX_KEY = 'dompetku.outbox';
const LEGACY_KEY = 'dompetku_data';
const POLL_MS = 20000;

export const CATEGORIES = [
  { id: 'Makanan', label: 'Makanan', icon: '🍜', color: '#f97362' },
  { id: 'Belanja', label: 'Belanja', icon: '🛒', color: '#fb923c' },
  { id: 'Transportasi', label: 'Transportasi', icon: '🛵', color: '#fbbf24' },
  { id: 'Tagihan', label: 'Tagihan', icon: '🧾', color: '#60a5fa' },
  { id: 'Rumah Tangga', label: 'Rumah Tangga', icon: '🏠', color: '#22d3ee' },
  { id: 'Kesehatan', label: 'Kesehatan', icon: '💊', color: '#34d399' },
  { id: 'Pendidikan', label: 'Pendidikan', icon: '📚', color: '#4ade80' },
  { id: 'Hiburan', label: 'Hiburan', icon: '🎮', color: '#a78bfa' },
  { id: 'Pakaian', label: 'Pakaian', icon: '👕', color: '#f472b6' },
  { id: 'Lainnya', label: 'Lainnya', icon: '📦', color: '#94a3b8' }
];

export const SOURCES = [
  { id: 'Gaji', label: 'Gaji', icon: '💼', color: '#34d399' },
  { id: 'Freelance', label: 'Freelance', icon: '💻', color: '#22d3ee' },
  { id: 'Usaha', label: 'Usaha', icon: '🏪', color: '#60a5fa' },
  { id: 'Investasi', label: 'Investasi', icon: '📈', color: '#a78bfa' },
  { id: 'Bonus', label: 'Bonus', icon: '🎁', color: '#fbbf24' },
  { id: 'Lainnya', label: 'Lainnya', icon: '💰', color: '#94a3b8' }
];

const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.id, c]));
const SOURCE_MAP = new Map(SOURCES.map((s) => [s.id, s]));

export function categoryMeta(id) {
  return CATEGORY_MAP.get(id) || { id: 'Lainnya', label: id || 'Lainnya', icon: '📦', color: '#94a3b8' };
}

export function sourceMeta(id) {
  return SOURCE_MAP.get(id) || { id: 'Lainnya', label: id || 'Lainnya', icon: '💰', color: '#94a3b8' };
}

export const DEFAULT_SETTINGS = {
  threshold: 1.5,
  theme: 'auto',
  onboarded: false
};

const state = {
  rev: 0,
  version: 2,
  expenses: [],
  incomes: [],
  settings: { ...DEFAULT_SETTINGS }
};

const meta = {
  user: null,
  status: 'memuat',
  pending: 0,
  lastSync: null,
  error: ''
};

const listeners = new Set();
const statusListeners = new Set();
let outbox = [];
let flushing = false;
let ready = false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onStatus(fn) {
  statusListeners.add(fn);
  fn(statusSnapshot());
  return () => statusListeners.delete(fn);
}

export function statusSnapshot() {
  return { ...meta };
}

export function getState() {
  return state;
}

export function isReady() {
  return ready;
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

function setStatus(patch) {
  Object.assign(meta, patch);
  statusListeners.forEach((fn) => fn(statusSnapshot()));
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Penyimpanan lokal penuh.', err);
    return false;
  }
}

function normalizeTx(tx, type) {
  const nominal = Math.round(Number(tx.nominal) || 0);
  if (!nominal) return null;
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(tx.tanggal || '') ? tx.tanggal : todayStr();
  const base = {
    id: tx.id || uid(type === 'expense' ? 'e' : 'i'),
    type,
    nominal,
    tanggal,
    keterangan: String(tx.keterangan || '').trim().slice(0, 140),
    frekuensi: tx.frekuensi || 'harian',
    dibuat: tx.dibuat || new Date().toISOString(),
    oleh: tx.oleh || meta.user?.username || ''
  };
  if (type === 'expense') {
    base.kategori = CATEGORY_MAP.has(tx.kategori) ? tx.kategori : 'Lainnya';
  } else {
    base.sumber = SOURCE_MAP.has(tx.sumber) ? tx.sumber : 'Lainnya';
  }
  return base;
}

function adopt(payload, { bumpRev = false } = {}) {
  const source = payload?.state || payload || {};
  state.expenses = (source.expenses || []).map((t) => normalizeTx(t, 'expense')).filter(Boolean);
  state.incomes = (source.incomes || []).map((t) => normalizeTx(t, 'income')).filter(Boolean);
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...(source.settings || {}),
    threshold: Number(source.settings?.threshold) || DEFAULT_SETTINGS.threshold
  };
  if (bumpRev || typeof payload?.rev === 'number') state.rev = payload.rev;
  state.version = 2;
  writeJSON(CACHE_KEY, state);
  notify();
}

function loadCache() {
  const cached = readJSON(CACHE_KEY, null);
  if (cached) return cached;
  const legacy = readJSON(LEGACY_KEY, null);
  if (!legacy) return null;
  return {
    rev: 0,
    expenses: Array.isArray(legacy.expenses) ? legacy.expenses : [],
    incomes: Array.isArray(legacy.incomes) ? legacy.incomes : [],
    settings: legacy.settings || {}
  };
}

// Settings dibaca begitu modul dimuat, bukan menunggu init(). Halaman memanggil
// initTheme() di module scope sebelum init() selesai (dan bisa dilewati kalau
// init() gagal), jadi tema harus sudah benar sejak baris pertama.
const cachedSettings = loadCache()?.settings;
if (cachedSettings) {
  state.settings = {
    ...DEFAULT_SETTINGS,
    ...cachedSettings,
    threshold: Number(cachedSettings.threshold) || DEFAULT_SETTINGS.threshold
  };
}

/* --- antrean offline --- */

function loadOutbox() {
  const raw = readJSON(OUTBOX_KEY, []);
  outbox = Array.isArray(raw) ? raw.filter((job) => job && job.op && job.payload) : [];
  setStatus({ pending: outbox.length });
}

function enqueue(op, payload) {
  outbox.push({ op, payload, at: new Date().toISOString() });
  writeJSON(OUTBOX_KEY, outbox);
  setStatus({ pending: outbox.length });
}

function dequeue(count = 1) {
  outbox.splice(0, count);
  writeJSON(OUTBOX_KEY, outbox);
  setStatus({ pending: outbox.length });
}

function send(job) {
  if (job.op === 'create') return api.create(job.payload);
  if (job.op === 'update') {
    const { id, ...rest } = job.payload;
    return api.update(id, rest);
  }
  if (job.op === 'delete') return api.remove(job.payload.id);
  if (job.op === 'settings') return api.saveSettings(job.payload);
  if (job.op === 'import') return api.importState(job.payload);
  if (job.op === 'reset') return api.reset();
  throw new Error('Operasi tidak dikenal.');
}

export async function flush() {
  try {
    return await runFlush();
  } catch (err) {
    if (err instanceof SessionExpired) {
      ready = false;
      throw err;
    }
    setStatus({ status: navigator.onLine ? 'gagal' : 'offline', error: err.message });
    return false;
  }
}

async function runFlush() {
  if (flushing || !ready || !outbox.length) return true;
  flushing = true;
  setStatus({ status: outbox.length ? 'menyinkron' : meta.status });
  try {
    while (outbox.length) {
      const batch = outbox.slice(0, 5);
      for (const job of batch) {
        try {
          const result = await send(job);
          dequeue(1);
          if (result && typeof result.transaction === 'object') mergeServer(result.transaction);
          if (result && result.settings) adopt({ rev: result.rev, settings: result.settings }, { bumpRev: true });
        } catch (err) {
          if (err instanceof SessionExpired) throw err;
          if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
            if (job.op === 'update' || job.op === 'delete') dropLocally(job.payload.id);
            dequeue(1);
            setStatus({ error: err.message });
            continue;
          }
          setStatus({ status: 'offline', error: 'Menunggu koneksi.' });
          return false;
        }
      }
      await pull({ quiet: true });
    }
    setStatus({ status: 'sinkron', error: '', lastSync: new Date().toISOString() });
    return true;
  } finally {
    flushing = false;
    if (outbox.length) setStatus({ status: navigator.onLine ? 'menunggu' : 'offline' });
  }
}

function mergeServer(tx) {
  if (!tx || !tx.id) return;
  const list = tx.type === 'income' ? state.incomes : state.expenses;
  const index = list.findIndex((item) => item.id === tx.id);
  const clean = normalizeTx(tx, tx.type === 'income' ? 'income' : 'expense');
  if (!clean) return;
  if (index === -1) list.unshift(clean);
  else list.splice(index, 1, clean);
  writeJSON(CACHE_KEY, state);
  notify();
}

function dropLocally(id) {
  state.expenses = state.expenses.filter((t) => t.id !== id);
  state.incomes = state.incomes.filter((t) => t.id !== id);
  writeJSON(CACHE_KEY, state);
  notify();
}

/* --- tarik data --- */

export async function pull({ quiet = false, force = false } = {}) {
  if (!ready && !force) return;
  try {
    const data = await api.state(force ? 0 : state.rev);
    if (data?.unchanged) {
      if (!quiet) setStatus({ status: 'sinkron', error: '', lastSync: new Date().toISOString() });
      return;
    }
    adopt(data);
    if (!quiet) setStatus({ status: 'sinkron', error: '', lastSync: new Date().toISOString() });
  } catch (err) {
    if (err instanceof SessionExpired) throw err;
    if (!quiet) setStatus({ status: navigator.onLine ? 'gagal' : 'offline', error: err.message });
  }
}

/* --- siklus hidup --- */

export async function init() {
  loadOutbox();
  const cached = loadCache();
  if (cached) adopt({ rev: 0, ...cached });

  const session = await api.session();
  resetExpiryGuard();
  meta.user = session.user;
  onSessionExpired(() => {
    ready = false;
    setStatus({ status: 'keluar' });
    const next = new URL('login.html', document.baseURI).href;
    if (!location.pathname.endsWith('login.html')) location.replace(next);
  });

  ready = true;
  try {
    await pull({ force: true, quiet: true });
    await flush();
  } catch (err) {
    if (!(err instanceof SessionExpired)) throw err;
    return { user: meta.user, sessions: [], slots: null };
  }
  setStatus({ status: outbox.length ? 'menunggu' : 'sinkron', lastSync: new Date().toISOString() });

  window.addEventListener('online', () => {
    setStatus({ status: 'menyinkron' });
    flush();
  });
  window.addEventListener('offline', () => setStatus({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') flush();
  }, POLL_MS);

  return { user: meta.user, sessions: session.sessions || [], slots: session.slots };
}

export function currentUser() {
  return meta.user;
}

/* --- transaksi --- */

export async function addTransaction(data) {
  const type = data.type === 'income' ? 'income' : 'expense';
  const tx = normalizeTx({ ...data, dibuat: new Date().toISOString() }, type);
  if (!tx) return null;
  (type === 'expense' ? state.expenses : state.incomes).unshift(tx);
  writeJSON(CACHE_KEY, state);
  notify();
  enqueue('create', tx);
  await safeFlush();
  return tx;
}

export async function updateTransaction(id, patch) {
  const type = state.expenses.some((t) => t.id === id)
    ? 'expense'
    : state.incomes.some((t) => t.id === id)
      ? 'income'
      : null;
  if (!type) return null;
  const list = type === 'expense' ? state.expenses : state.incomes;
  const index = list.findIndex((t) => t.id === id);
  if (index === -1) return null;
  const updated = normalizeTx({ ...list[index], ...patch, id, type }, type);
  if (!updated) return null;
  updated.dibuat = list[index].dibuat;
  list.splice(index, 1, updated);
  writeJSON(CACHE_KEY, state);
  notify();
  enqueue('update', updated);
  await safeFlush();
  return updated;
}

export async function removeTransaction(id) {
  const list = state.expenses.some((t) => t.id === id) ? state.expenses : state.incomes;
  const index = list.findIndex((t) => t.id === id);
  if (index === -1) return null;
  const [removed] = list.splice(index, 1);
  writeJSON(CACHE_KEY, state);
  notify();
  enqueue('delete', { id });
  await safeFlush();
  return removed;
}

export function restoreTransaction(tx) {
  if (!tx) return;
  (tx.type === 'expense' ? state.expenses : state.incomes).unshift(tx);
  writeJSON(CACHE_KEY, state);
  notify();
  enqueue('create', tx);
}

export async function setSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  writeJSON(CACHE_KEY, state);
  notify();
  enqueue('settings', patch);
  await safeFlush();
  return state.settings;
}

export async function replaceAll(payload) {
  const next = payload?.state || payload || {};
  try {
    const result = await api.importState(next);
    await pull({ force: true, quiet: true });
    return { ok: true, imported: result.imported, skipped: result.skipped };
  } catch (err) {
    if (err instanceof SessionExpired) throw err;
    if (err instanceof ApiError && err.isOffline) {
      enqueue('import', next);
      adopt({ rev: 0, expenses: next.expenses || [], incomes: next.incomes || [], settings: next.settings || {} });
      setStatus({ status: 'offline', error: 'Backup disimpan lokal, menunggu koneksi.' });
      return { ok: false, queued: true };
    }
    setStatus({ status: 'gagal', error: err.message });
    return { ok: false, error: err.message };
  }
}

export async function clearAll() {
  outbox = [];
  writeJSON(OUTBOX_KEY, outbox);
  setStatus({ pending: 0 });
  state.expenses = [];
  state.incomes = [];
  writeJSON(CACHE_KEY, state);
  notify();
  try {
    await api.reset();
  } catch (err) {
    if (err instanceof SessionExpired) throw err;
    enqueue('reset', {});
    setStatus({ status: err.isOffline ? 'offline' : 'gagal', error: err.message });
    return false;
  }
  try {
    await pull({ force: true, quiet: true });
  } catch (err) {
    if (err instanceof SessionExpired) throw err;
  }
  return true;
}

async function safeFlush() {
  try {
    await flush();
  } catch (err) {
    if (err instanceof SessionExpired) throw err;
  }
}

/* --- selector --- */

export function allTransactions() {
  return [...state.expenses, ...state.incomes].sort(
    (a, b) => b.tanggal.localeCompare(a.tanggal) || (b.dibuat || '').localeCompare(a.dibuat || '')
  );
}

export function expenses() {
  return [...state.expenses].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
}

export function incomes() {
  return [...state.incomes].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
}

export function totals() {
  const income = state.incomes.reduce((s, t) => s + t.nominal, 0);
  const expense = state.expenses.reduce((s, t) => s + t.nominal, 0);
  return { income, expense, balance: income - expense };
}

/* --- backup --- */

export function exportPayload() {
  return {
    app: 'DompetKu',
    version: 2,
    exportedAt: new Date().toISOString(),
    state: {
      expenses: state.expenses,
      incomes: state.incomes,
      settings: state.settings
    }
  };
}

export function downloadJSON() {
  const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dompetku-backup-${toDateStr(new Date())}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readJSONFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        reject(new Error('Berkas bukan JSON yang valid.'));
      }
    };
    reader.onerror = () => reject(new Error('Gagal membaca berkas.'));
    reader.readAsText(file);
  });
}

export function exportCSV(rows, filename) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((row) => row.map(esc).join(';')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { dropLocally };