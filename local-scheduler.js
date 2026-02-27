/**
 * LocalNotificationScheduler - Offline-first notification scheduling
 * Uses Notification Triggers API (Chrome Android) and Periodic Background Sync
 * Minimizes server calls - data synced once, then scheduled locally
 */

const LocalNotificationScheduler = {
    db: null,
    supportsShowTrigger: false,
    supportsPeriodicSync: false,
    
    /**
     * Initialize scheduler and detect capabilities
     */
    async init() {
        console.log('[LocalScheduler] Initializing...');
        
        // Initialize IndexedDB
        this.db = NotificationDB;
        await this.db.init();
        
        // Detect Notification Triggers API support
        this.supportsShowTrigger = 'showTrigger' in Notification.prototype;
        console.log('[LocalScheduler] Notification Triggers API:', this.supportsShowTrigger ? 'Supported ✅' : 'Not supported ❌');
        
        // Detect Periodic Background Sync support
        if ('serviceWorker' in navigator && 'periodicSync' in ServiceWorkerRegistration.prototype) {
            this.supportsPeriodicSync = true;
            console.log('[LocalScheduler] Periodic Background Sync: Supported ✅');
        } else {
            this.supportsPeriodicSync = false;
            console.log('[LocalScheduler] Periodic Background Sync: Not supported ❌');
        }
        
        // Clean old notifications
        await this.db.clearOldNotifications(7);
        
        console.log('[LocalScheduler] Initialization complete');
        return {
            supportsShowTrigger: this.supportsShowTrigger,
            supportsPeriodicSync: this.supportsPeriodicSync
        };
    },
    
    /**
     * Generate notification schedule from user preferences
     * Returns array of notification objects ready to be stored
     */
    generateSchedule(preferences, daysAhead = 7) {
        console.log('[LocalScheduler] Generating schedule for', daysAhead, 'days');
        
        const schedule = [];
        const now = new Date();
        const globalSettings = this.getGlobalSettings();
        
        // Generate for next N days
        for (let day = 0; day < daysAhead; day++) {
            const date = new Date(now);
            date.setDate(date.getDate() + day);
            
            // Meal notifications
            if (preferences.meals?.enabled) {
                const mealTimes = globalSettings?.mealReminders || {
                    breakfast: '08:00',
                    lunch: '13:00',
                    dinner: '19:00'
                };
                
                Object.entries(mealTimes).forEach(([mealType, time]) => {
                    if (typeof time === 'object' && !time.enabled) return;
                    const timeStr = typeof time === 'string' ? time : time.time || '12:00';
                    
                    const [hours, minutes] = timeStr.split(':').map(Number);
                    const scheduledDate = new Date(date);
                    scheduledDate.setHours(hours, minutes, 0, 0);
                    
                    // Only schedule future notifications
                    if (scheduledDate > now) {
                        schedule.push({
                            type: 'meal',
                            title: this.getMealTitle(mealType),
                            body: this.getMealBody(mealType),
                            icon: '/icon-192x192.png',
                            scheduledTime: scheduledDate.getTime(),
                            data: {
                                mealType: mealType,
                                url: '/plan.html'
                            }
                        });
                    }
                });
            }
            
            // Water notifications
            if (preferences.water?.enabled) {
                const waterSettings = globalSettings?.waterReminders || {
                    frequency: 2,
                    startHour: 8,
                    endHour: 22
                };
                
                for (let hour = waterSettings.startHour; hour <= waterSettings.endHour; hour += waterSettings.frequency) {
                    const scheduledDate = new Date(date);
                    scheduledDate.setHours(hour, 0, 0, 0);
                    
                    if (scheduledDate > now) {
                        schedule.push({
                            type: 'water',
                            title: 'Време за вода 💧',
                            body: 'Не забравяйте да пиете вода!',
                            icon: '/icon-192x192.png',
                            scheduledTime: scheduledDate.getTime(),
                            data: { url: '/plan.html' }
                        });
                    }
                }
            }
            
            // Sleep notification (once per day)
            if (preferences.sleep?.enabled) {
                const sleepTime = preferences.sleep.time || '22:00';
                const [hours, minutes] = sleepTime.split(':').map(Number);
                const scheduledDate = new Date(date);
                scheduledDate.setHours(hours, minutes, 0, 0);
                
                if (scheduledDate > now) {
                    schedule.push({
                        type: 'sleep',
                        title: 'Време за сън 😴',
                        body: 'Подгответе се за почивка. Добър сън е важен!',
                        icon: '/icon-192x192.png',
                        scheduledTime: scheduledDate.getTime(),
                        data: { url: '/plan.html' }
                    });
                }
            }
            
            // Activity notifications
            if (preferences.activity?.enabled) {
                // Morning activity
                if (preferences.activity.morningTime) {
                    const [hours, minutes] = preferences.activity.morningTime.split(':').map(Number);
                    const scheduledDate = new Date(date);
                    scheduledDate.setHours(hours, minutes, 0, 0);
                    
                    if (scheduledDate > now) {
                        schedule.push({
                            type: 'activity',
                            title: 'Сутрешна активност 🏃',
                            body: 'Започнете деня с физическа активност!',
                            icon: '/icon-192x192.png',
                            scheduledTime: scheduledDate.getTime(),
                            data: { url: '/plan.html' }
                        });
                    }
                }
                
                // Day activity
                if (preferences.activity.dayTime) {
                    const [hours, minutes] = preferences.activity.dayTime.split(':').map(Number);
                    const scheduledDate = new Date(date);
                    scheduledDate.setHours(hours, minutes, 0, 0);
                    
                    if (scheduledDate > now) {
                        schedule.push({
                            type: 'activity',
                            title: 'Време за движение 🚶',
                            body: 'Направете кратка разходка!',
                            icon: '/icon-192x192.png',
                            scheduledTime: scheduledDate.getTime(),
                            data: { url: '/plan.html' }
                        });
                    }
                }
            }
        }
        
        console.log('[LocalScheduler] Generated', schedule.length, 'notifications');
        return schedule;
    },
    
    /**
     * Schedule notifications using best available method
     */
    async scheduleAll(preferences) {
        console.log('[LocalScheduler] Notifications are globally disabled. Skipping scheduling.');
        return;
    },
    
    /**
     * Schedule using Notification Triggers API (Chrome Android)
     */
    async scheduleWithTriggers(schedule) {
        console.log('[LocalScheduler] Scheduling with Notification Triggers API');
        
        const registration = await navigator.serviceWorker.ready;
        
        for (const notif of schedule) {
            try {
                // Note: Notification Triggers API syntax
                await registration.showNotification(notif.title, {
                    body: notif.body,
                    icon: notif.icon,
                    badge: notif.icon,
                    tag: `${notif.type}-${notif.scheduledTime}`,
                    data: notif.data,
                    showTrigger: new TimestampTrigger(notif.scheduledTime),
                    requireInteraction: notif.type === 'meal',
                    vibrate: this.getVibrationPattern(notif.type)
                });
                
                console.log('[LocalScheduler] Scheduled trigger:', notif.type, 'at', new Date(notif.scheduledTime).toLocaleString());
            } catch (error) {
                console.error('[LocalScheduler] Failed to schedule trigger:', error);
            }
        }
    },
    
    /**
     * Setup Periodic Background Sync (fallback for devices without Triggers)
     */
    async setupPeriodicSync() {
        console.log('[LocalScheduler] Setting up Periodic Background Sync');
        
        try {
            const registration = await navigator.serviceWorker.ready;
            
            // Register periodic sync (minimum 12 hours on most browsers)
            await registration.periodicSync.register('check-notifications', {
                minInterval: 12 * 60 * 60 * 1000 // 12 hours in milliseconds
            });
            
            console.log('[LocalScheduler] Periodic sync registered');
        } catch (error) {
            console.error('[LocalScheduler] Periodic sync registration failed:', error);
        }
    },
    
    /**
     * Fallback scheduling for browsers without advanced APIs
     * Uses Service Worker postMessage to keep it alive longer
     */
    async setupFallbackScheduling() {
        console.log('[LocalScheduler] Using fallback scheduling method');
        
        // Set up visibility change listener to reschedule on page focus
        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden) {
                console.log('[LocalScheduler] Page visible, checking notifications');
                await this.checkAndShowDueNotifications();
            }
        });
        
        // Check immediately
        await this.checkAndShowDueNotifications();
    },
    
    /**
     * Check for due notifications and show them
     * Called by Service Worker periodic sync or fallback
     */
    async checkAndShowDueNotifications() {
        console.log('[LocalScheduler] Notifications are globally disabled. Skipping due notification check.');
    },
    
    /**
     * Helper: Get meal title from templates
     */
    getMealTitle(mealType) {
        const templates = {
            breakfast: 'Време за закуска 🍳',
            lunch: 'Време за обяд 🥗',
            dinner: 'Време за вечеря 🍽️',
            snack: 'Време за закуска 🍎'
        };
        return templates[mealType] || 'Време за хранене';
    },
    
    /**
     * Helper: Get meal body from templates
     */
    getMealBody(mealType) {
        const templates = {
            breakfast: 'Започнете деня със здравословна закуска',
            lunch: 'Време е за вашия здравословен обяд',
            dinner: 'Не забравяйте вечерята си',
            snack: 'Време е за здравословна междинна закуска'
        };
        return templates[mealType] || 'Време е за хранене';
    },
    
    /**
     * Helper: Get vibration pattern by type
     */
    getVibrationPattern(type) {
        const patterns = {
            meal: [300, 100, 300],
            water: [200],
            sleep: [200, 100, 200, 100, 200],
            activity: [100, 100, 100],
            supplements: [150, 50, 150],
            chat: [100, 50, 100]
        };
        return patterns[type] || [200, 100, 200];
    },
    
    /**
     * Helper: Get global settings from localStorage
     */
    getGlobalSettings() {
        const stored = localStorage.getItem('globalNotificationSettings');
        return stored ? JSON.parse(stored) : {
            mealReminders: {
                breakfast: '08:00',
                lunch: '13:00',
                dinner: '19:00'
            },
            waterReminders: {
                frequency: 2,
                startHour: 8,
                endHour: 22
            }
        };
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.LocalNotificationScheduler = LocalNotificationScheduler;
}
