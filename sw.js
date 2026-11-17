// Bewaart de app op de telefoon zodat hij zonder internet werkt.
// Verhoog VERSION bij elke wijziging aan de app-bestanden, samen met APP_VERSION in app.js.
const VERSION = 'ws-v3';
const FILES = ['./', 'index.html', 'app.js', 'jspdf.umd.min.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(hit => hit || fetch(e.request).catch(() => caches.match('index.html')))
  );
});
