// Service Worker for XBody Ability PWA
// Minimal, isolated from the NutriPlan service worker
const CACHE_NAME = 'xbody-v5';
// Core files that MUST be cached for the PWA shell to work offline.
const STATIC_CACHE = [
  'xbody.html',
  'xbody-manifest.json'
];
// Icons are optional – missing icons should not fail the SW install.
const OPTIONAL_CACHE = [
  'xbody-icon-192.png',
  'xbody-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Required files – any failure here aborts SW installation intentionally.
      await cache.addAll(STATIC_CACHE);
      // Best-effort: cache icons individually so a missing file doesn't
      // prevent the service worker from installing.
      for (const url of OPTIONAL_CACHE) {
        try {
          const resp = await fetch(url);
          // Only cache a successful response; a 404 (missing icon) is silently
          // skipped.  Other errors (network failure, quota exceeded) are also
          // swallowed here because icons are non-critical – the PWA shell works
          // without them.  Errors appear in DevTools console via the unhandled
          // fetch warning, which is sufficient for debugging.
          if (resp.ok) await cache.put(url, resp);
        } catch (_) { /* network error or quota exceeded – skip icon */ }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('xbody-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Cache-first for same-origin static files, except the main shell page.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return; // pass through cross-origin requests
  }

  // Always refresh xbody.html from network first so users do not stay on a
  // stale shell that can disable/skip translation logic.
  const isXbodyShell = event.request.mode === 'navigate' || url.pathname.endsWith('/xbody.html');
  if (isXbodyShell) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(event.request);
        if (fresh && fresh.ok) await cache.put(event.request, fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw _;
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
