/* Klien API DompetKu — pembungkus fetch tipis dengan error terstruktur. */

export class ApiError extends Error {
  constructor(message, { status = 0, data = null, kind = 'http' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.kind = kind;
  }

  get unauthorized() {
    return this.status === 401;
  }

  get isOffline() {
    return this.kind === 'offline';
  }
}

export class SessionExpired extends Error {
  constructor() {
    super('Sesi berakhir. Silakan masuk kembali.');
    this.name = 'SessionExpired';
  }
}

const listeners = new Set();
let expiredNotified = false;

export function onSessionExpired(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announceExpiry() {
  if (expiredNotified) return;
  expiredNotified = true;
  listeners.forEach((fn) => fn());
}

export function resetExpiryGuard() {
  expiredNotified = false;
}

export function apiPath(action) {
  return `api/${action}`;
}

async function request(method, action, { body, query, timeout = 15000 } = {}) {
  const url = new URL(apiPath(action), document.baseURI);
  url.search = '';
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
  }

  let response;
  try {
    response = await fetch(url.href, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'follow',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    throw new ApiError('Tidak bisa menghubungi server.', { kind: 'offline' });
  }

  const type = response.headers.get('Content-Type') || '';
  let data = null;
  if (type.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (response.status === 401) {
    if (action === 'login') {
      throw new ApiError(data?.error || 'Username atau password salah.', { status: 401, data });
    }
    announceExpiry();
    throw new SessionExpired(data?.error || 'Sesi berakhir. Silakan masuk kembali.');
  }
  if (!response.ok) {
    throw new ApiError(data?.error || `Gagal memuat data (${response.status}).`, { status: response.status, data });
  }
  return data;
}

export const api = {
  health: () => request('GET', 'health', { timeout: 6000 }),
  slots: () => request('GET', 'slots', { timeout: 6000 }),
  session: () => request('GET', 'session'),
  login: (username, password) => request('POST', 'login', { body: { username, password }, timeout: 12000 }),
  logout: (scope = 'self') => request('POST', 'logout', { body: { scope }, timeout: 10000 }),
  password: (current, next) => request('POST', 'password', { body: { current, next } }),
  state: (rev) => request('GET', 'state', { query: rev ? { rev } : {} }),
  settings: () => request('GET', 'settings'),
  saveSettings: (settings) => request('POST', 'settings', { body: { settings } }),
  create: (tx) => request('POST', 'transaction', { body: tx }),
  update: (id, patch) => request('PATCH', 'transaction', { body: { ...patch, id } }),
  remove: (id) => request('DELETE', 'transaction', { body: { id } }),
  ocr: (image, psm) => request('POST', 'ocr', { body: { image, psm }, timeout: 120000 }),
  parseReceipt: (text) => request('POST', 'receipt-parse', { body: { text }, timeout: 20000 }),
  importState: (state) => request('POST', 'import', { body: { state }, timeout: 60000 }),
  reset: () => request('POST', 'reset', { body: { confirm: 'HAPUS SEMUA' } }),
  exportUrl: () => new URL(apiPath('export'), document.baseURI).href
};