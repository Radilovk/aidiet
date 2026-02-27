// Service Worker for NutriPlan PWA
// Configure base path - use '/' for custom domain (biocode.website) or '/aidiet' for GitHub Pages
const BASE_PATH = '';

// GLOBAL NOTIFICATION KILL SWITCH - set to true to disable ALL notifications
const NOTIFICATIONS_DISABLED = true;
const CACHE_NAME = 'nutriplan-v2';
const DEFAULT_ICON = `${BASE_PATH}/icon-192x192.png`;
const DEFAULT_BADGE = `${BASE_PATH}/icon-192x192.png`;
const DEFAULT_TITLE = 'NutriPlan';
const DEFAULT_BODY = 'Ново напомняне от NutriPlan';
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
  if (NOTIFICATIONS_DISABLED) {
    console.log('[SW] Notifications are globally disabled. Ignoring push event.');
    return;
  }
  console.log('[SW] Push notification received');
  console.log('[SW] event.data:', event.data);
  
  const notificationPromise = (async () => {
    let notificationData = {
      title: DEFAULT_TITLE,
      body: DEFAULT_BODY,
      url: '/plan.html',
      icon: DEFAULT_ICON,
      notificationType: 'general'
    };
    
    // Parse notification data if available
    if (event.data) {
      try {
        const parsedData = await event.data.json();
        console.log('[SW] Parsed JSON data:', parsedData);
        notificationData = parsedData;
      } catch (e) {
        // Fallback to text if JSON parsing fails
        console.warn('[SW] JSON parse failed, trying text:', e);
        try {
          const textData = await event.data.text();
          console.log('[SW] Text data:', textData);
          notificationData.body = textData;
        } catch (textError) {
          console.error('[SW] Failed to parse text data:', textError);
        }
      }
    } else {
      console.warn('[SW] No event.data - using defaults');
    }
    
    console.log('[SW] Final notification data:', notificationData);
    
    // Customize notification based on type
    let title = notificationData.title || DEFAULT_TITLE;
    let icon = notificationData.icon || DEFAULT_ICON;
    let body = notificationData.body || DEFAULT_BODY;
    let badge = DEFAULT_BADGE;
    let vibrate = [200, 100, 200];
    let timestamp = Date.now();
    let tag = `nutriplan-${notificationData.notificationType || 'general'}`;
    let requireInteraction = false;
    
    // Type-specific customizations
    switch (notificationData.notificationType) {
      case 'chat':
        vibrate = [100, 50, 100];
        // Unique tag for each chat message using crypto.randomUUID() for better uniqueness
        tag = `nutriplan-chat-${crypto.randomUUID()}`;
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
      body: body,
      icon: icon,
      badge: badge,
      vibrate: vibrate,
      tag: tag,
      requireInteraction: requireInteraction,
      silent: false,
      timestamp: timestamp,
      data: {
        url: notificationData.url || '/plan.html',
        notificationType: notificationData.notificationType
      }
    };

    console.log('[SW] Showing notification with title:', title, 'body:', body);

    return self.registration.showNotification(title, options);
  })();

  event.waitUntil(notificationPromise.catch(err => {
    console.error('[SW] Failed to show notification:', err);
    // Show default notification as fallback
    return self.registration.showNotification(DEFAULT_TITLE, {
      body: DEFAULT_BODY,
      icon: DEFAULT_ICON,
      badge: DEFAULT_BADGE
    });
  }));
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

// ========================================================================
// PERIODIC BACKGROUND SYNC FOR LOCAL NOTIFICATIONS
// ========================================================================

// Periodic Background Sync - Check for due notifications
// This event fires when the browser wakes up the Service Worker
// Frequency controlled by browser (typically every 12-24 hours minimum)
self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync event:', event.tag);
  
  if (NOTIFICATIONS_DISABLED) {
    console.log('[SW] Notifications are globally disabled. Ignoring periodic sync.');
    return;
  }
  
  if (event.tag === 'check-notifications') {
    event.waitUntil(checkAndShowDueNotifications());
  }
});

/**
 * Check IndexedDB for due notifications and show them
 * Called by periodic sync or other triggers
 */
async function checkAndShowDueNotifications() {
  console.log('[SW] Checking for due notifications');
  
  try {
    // Import NotificationDB (inline version for SW context)
    await importNotificationDB();
    
    // Get notifications due within 5 minutes
    const dueNotifications = await NotificationDB.getDueNotifications(5);
    
    if (dueNotifications.length === 0) {
      console.log('[SW] No notifications due');
      return;
    }
    
    console.log(`[SW] Found ${dueNotifications.length} due notifications`);
    
    // Show each notification
    for (const notif of dueNotifications) {
      try {
        await self.registration.showNotification(notif.title, {
          body: notif.body,
          icon: notif.icon || DEFAULT_ICON,
          badge: DEFAULT_BADGE,
          tag: `${notif.type}-${notif.id}`,
          data: notif.data,
          requireInteraction: notif.type === 'meal',
          vibrate: getVibrationPattern(notif.type),
          timestamp: notif.scheduledTime
        });
        
        // Mark as shown in IndexedDB
        await NotificationDB.markAsShown(notif.id);
        
        console.log('[SW] Showed notification:', notif.type, notif.title);
      } catch (error) {
        console.error('[SW] Failed to show notification:', error);
      }
    }
  } catch (error) {
    console.error('[SW] Error checking notifications:', error);
  }
}

/**
 * Get vibration pattern by notification type
 */
function getVibrationPattern(type) {
  const patterns = {
    meal: [300, 100, 300],
    water: [200],
    sleep: [200, 100, 200, 100, 200],
    activity: [100, 100, 100],
    supplements: [150, 50, 150],
    chat: [100, 50, 100]
  };
  return patterns[type] || [200, 100, 200];
}

/**
 * Import NotificationDB for use in Service Worker
 * This is a minimal inline version of the IndexedDB wrapper
 */
async function importNotificationDB() {
  if (self.NotificationDB) return; // Already imported
  
  // Inline minimal NotificationDB implementation for SW
  self.NotificationDB = {
    dbName: 'NutriPlanNotifications',
    version: 1,
    db: null,
    
    async init() {
      if (this.db) return this.db;
      
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.version);
        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };
        request.onerror = () => reject(request.error);
      });
    },
    
    async getDueNotifications(windowMinutes = 5) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['notifications'], 'readonly');
        const store = transaction.objectStore('notifications');
        const index = store.index('status');
        const request = index.getAll('pending');
        
        request.onsuccess = () => {
          const pending = request.result;
          const now = Date.now();
          const window = windowMinutes * 60 * 1000;
          
          const due = pending.filter(notif => {
            const timeDiff = notif.scheduledTime - now;
            return timeDiff <= window && timeDiff >= -window;
          });
          
          resolve(due);
        };
        
        request.onerror = () => reject(request.error);
      });
    },
    
    async markAsShown(id) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['notifications'], 'readwrite');
        const store = transaction.objectStore('notifications');
        const request = store.get(id);
        
        request.onsuccess = () => {
          const notification = request.result;
          if (notification) {
            notification.status = 'shown';
            notification.shownAt = Date.now();
            
            const updateRequest = store.put(notification);
            updateRequest.onsuccess = () => resolve(true);
            updateRequest.onerror = () => reject(updateRequest.error);
          } else {
            resolve(false);
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    }
  };
}
