const CACHE = 'mordecai-shell-v2';
const SHELL = ['./', './index.html', './styles.css', './app.js', './logo-data.js', './manifest.json',
               './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  // Cache each shell file independently so one missing/renamed file can't
  // reject the whole install and leave the app uninstallable.
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(url).catch((err) => console.warn('SW: skip', url, err))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// App shell only - never cache API calls, so data is always live/real.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
});
