/**
 * FitPlan AI — service worker (app-like, офлайн, безопасни ъпдейти).
 *
 * Стратегии:
 *   - Навигации (HTML):      network-first → кеш → кеширан app.html.
 *     Така новите деплойти стигат до клиента веднага щом има мрежа,
 *     а офлайн приложението пак се отваря.
 *   - Активи в scope-а:      stale-while-revalidate — мигновено от кеша,
 *     обновяване на заден план (без "залепване" на стари версии).
 *   - CDN медия (thumbnails/GIF): cache-first с таван на записите —
 *     планът работи офлайн с изображенията, без да издува квотата.
 */

const VERSION = 'v3';
const APP_CACHE = `fitplan-app-${VERSION}`;
const IMG_CACHE = 'fitplan-img-v1';
const IMG_CACHE_MAX_ENTRIES = 300;

const MEDIA_HOSTS = ['cdn.jsdelivr.net', 'raw.githubusercontent.com'];

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './app.html',
  './manifest.json',
  './base.css',
  './landing.css',
  './landing.js',
  './common.js',
  './app.css',
  './app.js',
  './questions.js',
  './exercise-labels-bg.js',
  '../icon-192x192.png',
  '../icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // Кеширане поединично: един липсващ файл не бива да проваля целия install.
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

/** Ограничава броя записи в кеш (изхвърля най-старите). */
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    for (const key of keys.slice(0, keys.length - maxEntries)) {
      await cache.delete(key);
    }
  } catch { /* quota/приватен режим — не е критично */ }
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    // Офлайн навигация към непозната страница → отвори приложението.
    if (request.mode === 'navigate') {
      const app = await cache.match('./app.html');
      if (app) return app;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function mediaCacheFirst(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  // opaque (no-cors) отговорите от CDN също се кешират — нужни за офлайн план.
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

  // CDN медия (thumbnail/GIF на упражнения)
  if (MEDIA_HOSTS.includes(url.hostname) && request.destination === 'image') {
    event.respondWith(mediaCacheFirst(request));
    return;
  }

  // Само собствения scope (работи и локално, и на прод домейна)
  if (!request.url.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
