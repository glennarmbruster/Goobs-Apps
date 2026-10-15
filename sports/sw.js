/* Service worker for Sports — offline app shell.
   The page itself (index.html) is fetched from the network first, so a new version shows up the
   next time the app opens; if the network is slow or offline it falls back to the saved copy after 4 s.
   Icons and the manifest are served from the cache and refreshed quietly. */
const CACHE = 'goobs-sports-v2';
const PREFIX = 'goobs-sports-';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const WAIT_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* pages: network first (bypassing the browser HTTP cache), saved copy as the fallback */
async function page(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req, { cache: 'no-store' }).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
    return res;
  });
  const saved = () => cache.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true });
  const timer = new Promise(r => setTimeout(() => r(null), WAIT_MS));
  try {
    const res = await Promise.race([net, timer.then(async () => (await saved()) || net)]);
    return res;
  } catch (err) {
    return (await saved()) || Response.error();
  }
}

/* everything else: cached copy now, quiet refresh for next time */
async function asset(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const refresh = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
  if (cached) { refresh.catch(() => {}); return cached; }
  try { return await refresh; } catch (err) { return Response.error(); }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return; // weather/geocoding/Firebase calls go straight to the network
  const isPage = req.mode === 'navigate' || /\/(index\.html|library\.json)?$|\/library\/[^/]+\.json$/.test(new URL(req.url).pathname);
  e.respondWith(isPage ? page(req) : asset(req));
});
