const CACHE_NAME = 'dompetku-1.16';
const APP_SHELL = [
  './',
  './index.html',
  './laporan.html',
  './login.html',
  './manifest.json',
  './css/base.css',
  './css/catat.css',
  './css/laporan.css',
  './css/auth.css',
  './css/receipt.css',
  './js/utils.js',
  './js/api.js',
  './js/receipt.js',
  './js/store.js',
  './js/analytics.js',
  './js/ui.js',
  './js/auth.js',
  './js/charts.js',
  './js/quick-form.js',
  './js/tx-view.js',
  './js/catat.js',
  './js/laporan.js',
  './vendor/chart.umd.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/** Isi cache shell langsung dari jaringan, melewati cache HTTP browser.
 *
 * Cloudflare memaksa `max-age=14400` pada berkas .js/.css dan menimpa
 * `Cache-Control: no-cache` dari server. Pemanggilan cache.add biasa ikut
 * memakai cache HTTP tersebut, jadi service worker baru bisa menyimpan
 * versi lama -> APP_VERSION tak pernah naik dan notifikasi "Muat ulang"
 * muncul berulang. `cache: 'reload'` memaksa ambil segar dari jaringan.
 */
async function isiCacheShell(cache) {
  await Promise.allSettled(
    APP_SHELL.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && res.status === 200) await cache.put(new Request(url), res);
      } catch {
        /* berkas lain tetap dicoba; yang gagal diisi saat runtime */
      }
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(isiCacheShell)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return url.pathname.includes('/api/');
}

function isShell(url) {
  /* Cocokkan pathname penuh (tanpa query) supaya `icons/icon.svg?v=1.14`
     tetap mengenai cache `icons/icon.svg`. */
  const pathname = url.pathname.replace(/^\/+/, '');
  return APP_SHELL.some((path) => path.replace(/^\.\//, '') === pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          /* Hanya 200 yang layak menggantikan shell tersimpan: halaman error
             5xx atau 1033 Cloudflare saat tunnel mati akan meracuni cache dan
             app tidak bisa dibuka offline lagi sampai versi berikutnya. */
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = url.pathname.includes('laporan')
            ? await caches.match('./laporan.html')
            : await caches.match('./index.html');
          return fallback || Response.error();
        })
    );
    return;
  }

  if (!isShell(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request, { cache: 'no-cache' })
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});