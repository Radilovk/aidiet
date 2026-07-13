/**
 * FitPlan AI — service worker (app-like, офлайн, безопасни ъпдейти).
 *
 * ПРИ ВСЯКА ПРОМЯНА ПО CSS/JS/HTML: вдигни VERSION. Новата версия създава
 * празен кеш → следващото зареждане е атомарно свежо (никакви смесени файлове).
 *
 * Стратегии:
 *   - Навигации (HTML):  network-first с cache:'no-cache' (винаги ревалидира
 *     срещу сървъра — HTTP кешът на хостинга не може да върне стара страница),
 *     при офлайн → кеш → кеширан app.html.
 *   - Активи в scope-а:  stale-while-revalidate; ревалидацията също е
 *     cache:'no-cache', за да не се "залепи" стара версия от HTTP кеша.
 *   - CDN медия (thumbnails/GIF): cache-first с таван на записите.
 */

const VERSION = 'v5';
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
    // cache:'reload' → precache-ът байпасва HTTP кеша на браузъра.
    // Без това install можеше да запише СТАРИ файлове (max-age на хостинга)
    // и следващият reload да "върне" старата версия.
    await Promise.allSettled(
      PRECACHE_ASSETS.map((asset) => cache.add(new Request(asset, { cache: 'reload' }))),
    );
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

/**
 * Каноничен кеш ключ: URL без query. Така precache записът (app.css) и
 * версионираната заявка (app.css?v=5) са ЕДИН запис — иначе ignoreSearch
 * намираше първо стария precache и новата версия никога не се показваше.
 */
function cacheKey(request) {
  const url = new URL(request.url);
  url.search = '';
  return url.href;
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const key = cacheKey(request);
  try {
    // no-cache: ревалидация срещу сървъра (ETag) — никога стар HTML от HTTP кеша.
    const fresh = await fetch(request, { cache: 'no-cache' });
    if (fresh && fresh.ok) cache.put(key, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(key);
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
  const key = cacheKey(request);
  const cached = await cache.match(key);
  const network = fetch(request, { cache: 'no-cache' })
    .then((res) => {
      if (res && res.ok) cache.put(key, res.clone());
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
