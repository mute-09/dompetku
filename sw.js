const CACHE_NAME = 'dompetku-v4';
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
  './js/catat.js',
  './js/laporan.js',
  './vendor/chart.umd.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
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
  return APP_SHELL.some((path) => {
    const clean = path.replace(/^\.\//, '');
    return clean === url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
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
      const network = fetch(request)
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