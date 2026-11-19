const CACHE_PREFIX = 'goobs-exops-';
const CACHE_NAME = 'goobs-exops-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          caches.match(event.request).then((cached) => {
            if (cached && !settled) {
              settled = true;
              resolve(cached);
            }
          });
        }
      }, 4000);

      fetch(event.request)
        .then((response) => {
          clearTimeout(timer);
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          if (!settled) {
            settled = true;
            resolve(response);
          }
        })
        .catch(() => {
          clearTimeout(timer);
          caches.match(event.request).then((cached) => {
            if (!settled) {
              settled = true;
              resolve(cached || caches.match('./index.html'));
            }
          });
        });
    })
  );
});
