// Service Worker for NutriPlan PWA
// Configure base path - use '/' for custom domain (biocode.website) or '/aidiet' for GitHub Pages
const BASE_PATH = '';
const CACHE_NAME = 'nutriplan-v2';
const DEFAULT_ICON = `${BASE_PATH}/icon-192x192.png`;
const DEFAULT_BADGE = `${BASE_PATH}/icon-192x192.png`;
const STATIC_CACHE = [
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/questionnaire.html`,
  `${BASE_PATH}/plan.html`,
  `${BASE_PATH}/profile.html`,
  `${BASE_PATH}/admin.html`,
  `${BASE_PATH}/icon-192x192.png`,
  `${BASE_PATH}/icon-192x192.svg`,
  `${BASE_PATH}/icon-512x512.png`,
  `${BASE_PATH}/icon-512x512.svg`,
  `${BASE_PATH}/manifest.json`,
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Install event - cache static resources
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static resources');
      return cache.addAll(STATIC_CACHE)
        .catch((err) => {
          console.warn('[SW] Some resources failed to cache:', err);
          // Continue even if some resources fail
        });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - serve from cache or network
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

  // Network first for HTML pages (to get latest content)
  const acceptHeader = request.headers.get('accept');
  if (acceptHeader && acceptHeader.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Handle 404 responses for navigation requests - redirect to index.html
          if (response.status === 404 && request.mode === 'navigate') {
            return caches.match(`${BASE_PATH}/index.html`).then(cachedIndex => {
              if (cachedIndex) {
                return cachedIndex;
              }
              return fetch(`${BASE_PATH}/index.html`);
            });
          }
          
          // Clone response and update cache
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // If network fails, try cache
          return caches.match(request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Fallback to index.html for navigation requests to root or app base paths
            if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === BASE_PATH || url.pathname === BASE_PATH + '/') {
              return caches.match(`${BASE_PATH}/index.html`);
            }
            // Return a basic 404 response
            return new Response('Not found', { status: 404 });
          });
        })
    );
    return;
  }

  // Cache first for other resources (CSS, JS, images)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        // Clone and cache the response
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });

        return response;
      });
    })
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  let notificationData = {
    title: 'NutriPlan',
    body: 'Ново напомняне от NutriPlan',
    url: '/plan.html',
    icon: DEFAULT_ICON,
    notificationType: 'general'
  };
  
  // Parse notification data if available
  if (event.data) {
    try {
      notificationData = event.data.json();
      console.log('[SW] Parsed notification data:', notificationData);
    } catch (e) {
      // Fallback to text if JSON parsing fails
      notificationData.body = event.data.text();
      console.log('[SW] Failed to parse JSON, using text:', notificationData.body);
    }
  }
  
  console.log('[SW] Final notification data - Title:', notificationData.title, 'Body:', notificationData.body);
  
  // Customize notification based on type
  let icon = notificationData.icon || DEFAULT_ICON;
  let badge = DEFAULT_BADGE;
  let vibrate = [200, 100, 200];
  let tag = `nutriplan-${notificationData.notificationType || 'general'}`;
  let requireInteraction = false;
  
  // Type-specific customizations
  switch (notificationData.notificationType) {
    case 'chat':
      vibrate = [100, 50, 100];
      tag = 'nutriplan-chat';
      break;
    case 'water':
      vibrate = [200];
      tag = 'nutriplan-water';
      requireInteraction = false;
      break;
    case 'meal':
      vibrate = [300, 100, 300];
      tag = 'nutriplan-meal';
      requireInteraction = true; // Meal reminders are more important
      break;
    case 'snack':
      vibrate = [150];
      tag = 'nutriplan-snack';
      break;
    case 'sleep':
      vibrate = [200, 100, 200, 100, 200];
      tag = 'nutriplan-sleep';
      requireInteraction = false;
      break;
    case 'activity':
      vibrate = [100, 100, 100];
      tag = 'nutriplan-activity';
      requireInteraction = false;
      break;
    case 'supplements':
      vibrate = [150, 50, 150];
      tag = 'nutriplan-supplements';
      requireInteraction = false;
      break;
    default:
      break;
  }
  
  const options = {
    body: notificationData.body,
    icon: icon,
    badge: badge,
    vibrate: vibrate,
    tag: tag,
    requireInteraction: requireInteraction,
    data: {
      url: notificationData.url || '/plan.html',
      notificationType: notificationData.notificationType
    }
  };

  console.log('[SW] Showing notification with title:', notificationData.title, 'and options:', options);

  event.waitUntil(
    self.registration.showNotification(notificationData.title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  event.notification.close();
  
  // Get the URL from notification data
  const url = event.notification.data?.url || '/plan.html';
  const targetUrl = url.startsWith('http') ? url : `${BASE_PATH}${url}`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(BASE_PATH) && 'focus' in client) {
            return client.focus().then(() => {
              // Navigate to the target URL
              return client.navigate(targetUrl);
            });
          }
        }
        // If no window is open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
