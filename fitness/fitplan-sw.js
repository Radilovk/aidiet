/**
 * FitPlan AI — service worker за офлайн кеш на приложението.
 * Scope: /fitness/
 */
const CACHE = 'fitplan-app-v1';
const ASSETS = [
  './',
  './index.html',
  './app.html',
  './app.css',
  './app.js',
  './questions.js',
  './exercise-labels-bg.js',
  './fitplan-sw.js',
  '../icon-192x192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes('/fitness/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return res;
      }).catch(() => cached);
    }),
  );
});
