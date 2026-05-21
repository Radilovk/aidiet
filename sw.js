// Service Worker for NutriPlan PWA
// Configure base path - use '/' for custom domain (biocode.website) or '/aidiet' for GitHub Pages
const BASE_PATH = '';

const CACHE_NAME = 'nutriplan-v11';
const DEFAULT_ICON = `${BASE_PATH}/icon-192x192.png`;
const DEFAULT_BADGE = `${BASE_PATH}/icon-192x192.png`;
const DEFAULT_TITLE = 'NutriPlan';
const DEFAULT_BODY = 'Ново напомняне от NutriPlan';
const STATIC_CACHE = [
  `${BASE_PATH}/app.html`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/questionnaire.html`,
  `${BASE_PATH}/questionnaire2.html`,
  `${BASE_PATH}/plan.html`,
  `${BASE_PATH}/plan.js`,
  `${BASE_PATH}/quick-answer.html`,
  `${BASE_PATH}/profile.html`,
  `${BASE_PATH}/profile.js`,
  `${BASE_PATH}/guidelines.html`,
  `${BASE_PATH}/guidelines.js`,
  `${BASE_PATH}/game-analytics.html`,
  `${BASE_PATH}/game-analytics.js`,
  `${BASE_PATH}/analysis.html`,
  `${BASE_PATH}/admin.html`,
  `${BASE_PATH}/design-system.css`,
  `${BASE_PATH}/icon-192x192.png`,
  `${BASE_PATH}/icon-192x192.svg`,
  `${BASE_PATH}/icon-512x512.png`,
  `${BASE_PATH}/icon-512x512.svg`,
  `${BASE_PATH}/manifest.json`,
  `${BASE_PATH}/local-scheduler.js`,
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

function buildQuickAnswerUrl(type, params = {}) {
  const search = new URLSearchParams({ type });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  return `${BASE_PATH}/quick-answer.html?${search.toString()}`;
}

function getGameNotificationActions(type) {
  if (type === 'morning_check') {
    return [
      { action: 'sleep_yes', title: 'Да 🌞' },
      { action: 'sleep_no', title: 'Не 😴' }
    ];
  }
  if (type === 'evening_check') {
    return [
      { action: 'open_evening', title: 'Бърз отговор ⚡' },
      { action: 'water_yes', title: 'Пих вода 💧' }
    ];
  }
  return undefined;
}

function resolveNotificationTarget(data = {}, action = '') {
  const type = data.type || data.notificationType || '';
  const recordKey = data.recordKey || '';
  if (type === 'morning_check' && action === 'sleep_yes') {
    return buildQuickAnswerUrl('morning_check', { date: recordKey, auto: 'morning_yes' });
  }
  if (type === 'morning_check' && action === 'sleep_no') {
    return buildQuickAnswerUrl('morning_check', { date: recordKey, auto: 'morning_no' });
  }
  if (type === 'evening_check' && action === 'water_yes') {
    return buildQuickAnswerUrl('evening_check', { date: recordKey, water: '1' });
  }
  if (type === 'evening_check' && action === 'open_evening') {
    return buildQuickAnswerUrl('evening_check', { date: recordKey });
  }
  return data.url || `${BASE_PATH}/plan.html`;
}

function toAbsoluteAppUrl(url) {
  if (url.startsWith('http')) return url;
  if (BASE_PATH && url.startsWith(`${BASE_PATH}/`)) return url;
  return `${BASE_PATH}${url}`;
}

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

  // Stale-while-revalidate for HTML pages: serve from cache immediately,
  // update cache in the background so the next visit gets fresh content.
  const acceptHeader = request.headers.get('accept');
  if (acceptHeader && acceptHeader.includes('text/html')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          // Always kick off a background network request to refresh the cache
          const networkFetch = fetch(request)
            .then((response) => {
              if (response.status === 404 && request.mode === 'navigate') {
                return caches.match(`${BASE_PATH}/index.html`).then(cachedIndex => {
                  const fallback = cachedIndex || fetch(`${BASE_PATH}/index.html`);
                  return Promise.resolve(fallback).then(r => {
                    cache.put(request, r.clone());
                    return r;
                  });
                });
              }
              if (response && response.status === 200) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => {
              // Network failed – fall back to cached index.html for navigation
              if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === BASE_PATH || url.pathname === BASE_PATH + '/') {
                return caches.match(`${BASE_PATH}/index.html`);
              }
              return new Response('Not found', { status: 404 });
            });

          if (cachedResponse) {
            // Serve stale cache immediately; keep SW alive until cache is updated
            event.waitUntil(networkFetch);
            return cachedResponse;
          }
          // No cache yet – wait for network
          return networkFetch;
        });
      })
    );
    return;
  }

  // Stale-while-revalidate for other resources (CSS, JS, images):
  // serve from cache immediately if available, always refresh cache in the background.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const networkFetch = fetch(request).then((response) => {
          if (response && response.status === 200 && response.type !== 'error') {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(() => cachedResponse || new Response('Not found', { status: 404 }));

        if (cachedResponse) {
          event.waitUntil(networkFetch.catch(() => {}));
          return cachedResponse;
        }
        return networkFetch;
      });
    })
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  let data = { title: DEFAULT_TITLE, body: DEFAULT_BODY, url: '/plan.html' };
  if (event.data) {
    try { data = Object.assign(data, event.data.json()); } catch (_) {
      data.body = event.data.text() || DEFAULT_BODY;
    }
  }

  const tag = data.notificationType
    ? `nutriplan-${data.notificationType}`
    : 'nutriplan-general';

  event.waitUntil(
    self.registration.showNotification(data.title || DEFAULT_TITLE, {
      body:              data.body || DEFAULT_BODY,
      icon:              data.icon || DEFAULT_ICON,
      badge:             DEFAULT_BADGE,
      tag,
      vibrate:           [200, 100, 200],
      requireInteraction: data.notificationType === 'morning_check',
      actions:           getGameNotificationActions(data.notificationType),
      data:              {
        url: data.url || (data.notificationType ? buildQuickAnswerUrl(data.notificationType, { date: data.recordKey || '' }) : '/plan.html'),
        type: data.notificationType || '',
        recordKey: data.recordKey || ''
      }
    }).catch(err => {
      console.error('[SW] showNotification failed:', err);
      return self.registration.showNotification(DEFAULT_TITLE, {
        body: DEFAULT_BODY, icon: DEFAULT_ICON, badge: DEFAULT_BADGE
      });
    })
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action || '';
  const data = event.notification.data || {};
  const url = resolveNotificationTarget(data, action);
  const targetUrl = toAbsoluteAppUrl(url);
  const notificationType = data.type || '';
  const recordKey = data.recordKey || '';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If app.html (shell) or plan.html is open, post a message so it shows an in-app
        // modal without any page navigation (no full app reload, no index.html).
        const planClient = clientList.find(c =>
            c.url.includes('/app.html') || c.url.includes('/plan.html')
        );
        if (planClient && 'postMessage' in planClient) {
          planClient.postMessage({
            type: 'NOTIFICATION_ACTION',
            action,
            notificationType,
            recordKey
          });
          return planClient.focus();
        }

        // Reuse an existing quick-answer window if one is already open.
        const qaClient = clientList.find(c => c.url.includes('/quick-answer.html'));
        if (qaClient && 'focus' in qaClient) {
          return qaClient.focus().then(() => qaClient.navigate(targetUrl)).catch(() => clients.openWindow ? clients.openWindow(targetUrl) : undefined);
        }

        // No suitable window open – open quick-answer.html in a new window.
        return clients.openWindow ? clients.openWindow(targetUrl) : undefined;
      })
  );
});

// ========================================================================
// GAME NOTIFIER – SW-side scheduled notification fallback
// ========================================================================

const _scheduledGameNotifs = [];
let   _scheduleTimers = [];

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'SCHEDULE_GAME_NOTIFICATIONS') return;
  if (!Array.isArray(msg.schedule)) return;

  console.log('[SW] Received SCHEDULE_GAME_NOTIFICATIONS with', msg.schedule.length, 'items');

  _scheduleTimers.forEach(id => clearTimeout(id));
  _scheduleTimers = [];
  _scheduledGameNotifs.length = 0;

  const now = Date.now();
  msg.schedule.forEach(item => {
    const delay = item.ts - now;
    if (delay < 0) return;
    _scheduledGameNotifs.push(item);
    const tid = setTimeout(async () => {
      try {
        await self.registration.showNotification(item.title, {
          body:               item.body,
          icon:               '/icon-192x192.png',
          badge:              '/icon-192x192.png',
          tag:                item.tag,
          actions:            item.actions || getGameNotificationActions(item.type),
          data:               { url: item.url, type: item.type, recordKey: item.recordKey || '' },
          requireInteraction: item.requireInteraction || false,
          vibrate:            item.vibrate || [200, 100, 200]
        });
      } catch (e) {
        console.error('[SW] Failed to show scheduled notification:', e);
      }
    }, delay);
    _scheduleTimers.push(tid);
  });

  console.log('[SW] Scheduled', _scheduleTimers.length, 'game notification timers');
});
