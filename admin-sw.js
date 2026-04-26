// Service Worker for NutriPlan Admin Panel PWA
const CACHE_NAME = 'nutriplan-admin-v1';

const STATIC_CACHE = [
  '/admin.html',
  '/admin-manifest.json',
  '/design-system.css',
  '/icon-192x192.png',
  '/icon-192x192.svg',
  '/icon-512x512.png',
  '/icon-512x512.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Install event - cache admin resources
self.addEventListener('install', (event) => {
  console.log('[Admin SW] Installing admin service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Admin SW] Caching admin resources');
      return cache.addAll(STATIC_CACHE)
        .catch((err) => {
          console.warn('[Admin SW] Some resources failed to cache:', err);
        });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old admin caches
self.addEventListener('activate', (event) => {
  console.log('[Admin SW] Activating admin service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('nutriplan-admin-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[Admin SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip API calls - always fetch from network
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Stale-while-revalidate for HTML pages
  const acceptHeader = request.headers.get('accept');
  if (acceptHeader && acceptHeader.includes('text/html')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const networkFetch = fetch(request)
            .then((response) => {
              if (response && response.status === 200) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => {
              return caches.match('/admin.html');
            });

          if (cachedResponse) {
            event.waitUntil(networkFetch);
            return cachedResponse;
          }
          return networkFetch;
        });
      })
    );
    return;
  }

  // Cache first for static assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        return response;
      });
    })
  );
});
