/* Service worker for Money — offline app shell.
   Serves cached files instantly and quietly refreshes them in the background,
   so a new version appears the next time the app is opened. */
const CACHE = 'goobs-money-v1';
const PREFIX = 'goobs-money-';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function respond(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
  if (cached) return { response: cached, refresh };
  try {
    return { response: await refresh, refresh };
  } catch (err) {
    if (req.mode === 'navigate') {
      const fallback = await cache.match('index.html');
      if (fallback) return { response: fallback, refresh: Promise.resolve() };
    }
    return { response: Response.error(), refresh: Promise.resolve() };
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // weather/geocoding calls go straight to the network
  const work = respond(req);
  e.respondWith(work.then(r => r.response));
  e.waitUntil(work.then(r => r.refresh.catch(() => {})));
});
