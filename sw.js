// ===== SERVICE WORKER — offline app shell; cache name tied to VERSION so every release refreshes =====
const VERSION = '1.3.2';
const CACHE = `debts-${VERSION}`;
const SHELL = ['./', 'index.html', 'css/app.css', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/api.js', 'js/ui.js', 'js/providers.js', 'js/config.js'];
const CDN = 'cdn.jsdelivr.net';                  // pinned supabase-js

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE)
  .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())));
// origin is shared with HomeApp: delete only this app's old caches
self.addEventListener('activate', (e) => e.waitUntil(caches.keys()
  .then((ks) => Promise.all(ks.filter((k) => k.startsWith('debts-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

// shell + pinned CDN: cache-first; everything else (Supabase API) goes to the network untouched
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || (u.origin !== location.origin && u.hostname !== CDN)) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && (u.hostname === CDN || SHELL.some((s) => u.pathname.endsWith(s.replace('./', '/'))))) {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  })));
});
