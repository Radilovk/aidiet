/**
 * NotificationDB - IndexedDB wrapper for local notification scheduling
 * Stores notification queue locally for offline-first approach
 * 
 * Schema:
 * - notifications: {id, type, title, body, icon, scheduledTime, data, status}
 * - sync_metadata: {lastSync, version}
 */

const NotificationDB = {
    dbName: 'NutriPlanNotifications',
    version: 1,
    db: null,
    
    /**
     * Initialize IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => {
                console.error('[NotificationDB] Failed to open database:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                console.log('[NotificationDB] Database opened successfully');
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create notifications store
                if (!db.objectStoreNames.contains('notifications')) {
                    const notifStore = db.createObjectStore('notifications', { 
                        keyPath: 'id',
                        autoIncrement: true 
                    });
                    
                    // Indexes for efficient queries
                    notifStore.createIndex('scheduledTime', 'scheduledTime', { unique: false });
                    notifStore.createIndex('type', 'type', { unique: false });
                    notifStore.createIndex('status', 'status', { unique: false });
                    
                    console.log('[NotificationDB] Created notifications store');
                }
                
                // Create sync metadata store
                if (!db.objectStoreNames.contains('sync_metadata')) {
                    db.createObjectStore('sync_metadata', { keyPath: 'key' });
                    console.log('[NotificationDB] Created sync_metadata store');
                }
            };
        });
    },
    
    /**
     * Add notification to queue
     */
    async addNotification(notification) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notifications'], 'readwrite');
            const store = transaction.objectStore('notifications');
            
            const notif = {
                type: notification.type,
                title: notification.title,
                body: notification.body,
                icon: notification.icon || '/icon-192x192.png',
                scheduledTime: notification.scheduledTime, // timestamp
                data: notification.data || {},
                status: 'pending', // pending, shown, cancelled
                createdAt: Date.now()
            };
            
            const request = store.add(notif);
            
            request.onsuccess = () => {
                console.log('[NotificationDB] Added notification:', notif.type, 'at', new Date(notif.scheduledTime).toLocaleString());
                resolve(request.result);
            };
            
            request.onerror = () => {
                console.error('[NotificationDB] Failed to add notification:', request.error);
                reject(request.error);
            };
        });
    },
    
    /**
     * Add multiple notifications in batch
     */
    async addBatch(notifications) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notifications'], 'readwrite');
            const store = transaction.objectStore('notifications');
            
            let added = 0;
            
            notifications.forEach(notification => {
                const notif = {
                    type: notification.type,
                    title: notification.title,
                    body: notification.body,
                    icon: notification.icon || '/icon-192x192.png',
                    scheduledTime: notification.scheduledTime,
                    data: notification.data || {},
                    status: 'pending',
                    createdAt: Date.now()
                };
                
                store.add(notif);
            });
            
            transaction.oncomplete = () => {
                console.log(`[NotificationDB] Added ${notifications.length} notifications in batch`);
                resolve(notifications.length);
            };
            
            transaction.onerror = () => {
                console.error('[NotificationDB] Batch add failed:', transaction.error);
                reject(transaction.error);
            };
        });
    },
    
    /**
     * Get pending notifications (not yet shown)
     */
    async getPendingNotifications() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notifications'], 'readonly');
            const store = transaction.objectStore('notifications');
            const index = store.index('status');
            const request = index.getAll('pending');
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    },
    
    /**
     * Get notifications due now (within time window)
     */
    async getDueNotifications(windowMinutes = 5) {
        const pending = await this.getPendingNotifications();
        const now = Date.now();
        const window = windowMinutes * 60 * 1000;
        
        return pending.filter(notif => {
            const timeDiff = notif.scheduledTime - now;
            return timeDiff <= window && timeDiff >= -window;
        });
    },
    
    /**
     * Mark notification as shown
     */
    async markAsShown(id) {
        if (!this.db) await this.init();
        
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
    },
    
    /**
     * Clear old notifications (older than N days)
     */
    async clearOldNotifications(daysOld = 7) {
        if (!this.db) await this.init();
        
        const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notifications'], 'readwrite');
            const store = transaction.objectStore('notifications');
            const index = store.index('scheduledTime');
            const range = IDBKeyRange.upperBound(cutoffTime);
            const request = index.openCursor(range);
            
            let deleted = 0;
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                }
            };
            
            transaction.oncomplete = () => {
                console.log(`[NotificationDB] Deleted ${deleted} old notifications`);
                resolve(deleted);
            };
            
            transaction.onerror = () => reject(transaction.error);
        });
    },
    
    /**
     * Clear all pending notifications
     */
    async clearPending() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notifications'], 'readwrite');
            const store = transaction.objectStore('notifications');
            const index = store.index('status');
            const request = index.openCursor(IDBKeyRange.only('pending'));
            
            let deleted = 0;
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                }
            };
            
            transaction.oncomplete = () => {
                console.log(`[NotificationDB] Cleared ${deleted} pending notifications`);
                resolve(deleted);
            };
            
            transaction.onerror = () => reject(transaction.error);
        });
    },
    
    /**
     * Update sync metadata
     */
    async updateSyncMetadata(data) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sync_metadata'], 'readwrite');
            const store = transaction.objectStore('sync_metadata');
            
            const metadata = {
                key: 'last_sync',
                timestamp: Date.now(),
                ...data
            };
            
            const request = store.put(metadata);
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    },
    
    /**
     * Get sync metadata
     */
    async getSyncMetadata() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sync_metadata'], 'readonly');
            const store = transaction.objectStore('sync_metadata');
            const request = store.get('last_sync');
            
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            
            request.onerror = () => reject(request.error);
        });
    },
    
    /**
     * Get all notifications (for debugging)
     */
    async getAllNotifications() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['notifications'], 'readonly');
            const store = transaction.objectStore('notifications');
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.NotificationDB = NotificationDB;
}

// Make available in Service Worker
if (typeof self !== 'undefined' && self.constructor.name === 'ServiceWorkerGlobalScope') {
    self.NotificationDB = NotificationDB;
}
