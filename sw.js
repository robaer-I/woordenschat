// Bewaart de app op de telefoon zodat hij zonder internet werkt.
// Verhoog VERSION bij elke wijziging aan de app-bestanden, samen met APP_VERSION in app.js.
const VERSION = 'ws-v4';
const FILES = ['./', 'index.html', 'app.js', 'jspdf.umd.min.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const TIMEOUT = 4000; // ms: daarna de bewaarde versie gebruiken (traag of geen internet)

self.addEventListener('install', e => {
  // cache: 'reload' haalt verse bestanden op, niet uit de browser- of servercache
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(FILES.map(f =>
    fetch(f, {cache: 'reload'}).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return c.put(f, r); })
  ))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Eerst internet (zodat je altijd de nieuwste versie hebt), anders de bewaarde kopie.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const net = await Promise.race([
        fetch(req, {cache: 'no-cache'}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT)),
      ]);
      if (net.ok) cache.put(req, net.clone());
      return net;
    } catch {
      return (await cache.match(req, {ignoreSearch: true})) || (await cache.match('index.html')) || Response.error();
    }
  })());
});
