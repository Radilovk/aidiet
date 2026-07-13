/**
 * FitPlan AI — service worker (само /fitness/ scope).
 *
 * Стратегия: онлайн = винаги мрежа (без stale CSS/HTML); офлайн = кеш fallback.
 */

const VERSION = 'v6';
const APP_CACHE = `fitplan-app-${VERSION}`;
const IMG_CACHE = 'fitplan-img-v1';
const IMG_CACHE_MAX_ENTRIES = 300;

const MEDIA_HOSTS = ['cdn.jsdelivr.net', 'raw.githubusercontent.com'];

const PRECACHE_ASSETS = [
  './app.html',
  './manifest.json',
  './base.css',
  './app.css',
  './app.js',
  './questions.js',
  './exercise-labels-bg.js',
  './common.js',
  '../icon-192x192.png',
  '../icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await Promise.allSettled(PRECACHE_ASSETS.map((asset) => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== APP_CACHE && k !== IMG_CACHE && k.startsWith('fitplan-'))
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    for (const key of keys.slice(0, keys.length - maxEntries)) {
      await cache.delete(key);
    }
  } catch { /* quota */ }
}

/** Онлайн: само мрежа (cache: no-store). Офлайн: кеш fallback. */
async function networkPrefer(request) {
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    if (fresh && fresh.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cache = await caches.open(APP_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const app = await cache.match('./app.html');
      if (app) return app;
    }
    return Response.error();
  }
}

async function mediaCacheFirst(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(request, res.clone());
    trimCache(IMG_CACHE, IMG_CACHE_MAX_ENTRIES);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (MEDIA_HOSTS.includes(url.hostname) && request.destination === 'image') {
    event.respondWith(mediaCacheFirst(request));
    return;
  }

  if (!request.url.startsWith(self.registration.scope)) return;

  event.respondWith(networkPrefer(request));
});
