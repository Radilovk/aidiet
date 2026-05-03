/**
 * GameNotifier – replaces the old NotificationScheduler.
 *
 * Two primary notifications are scheduled daily for N days ahead:
 *   1. morning_check – "Добро утро! Спахте ли добре?" (default 07:00)
 *      Triggered earlier (after 05:00) when device motion wake detection fires.
 *   2. evening_check – "Добър вечер! Как мина денят?" (default 20:00)
 *
 * Scheduling strategy (best available):
 *   A. Notification Triggers API (TimestampTrigger) – Chrome/Edge Android, TWA  ✅
 *   B. Service Worker postMessage → SW sets a timeout               (fallback)  ✅
 *
 * DeviceMotion wake detection (Android / TWA):
 *   – Between 05:00 and 09:00, listens for significant acceleration.
 *   – On first detection fires the morning notification immediately.
 *   – Stops listening after the notification is sent for that day.
 *
 * Backend admin override:
 *   – Admin can push a JSON config via /api/notification-config.
 *   – Stored in localStorage as 'gameNotifierConfig'.
 *   – Re-schedules automatically when config changes.
 */

const GameNotifier = {

    DAYS_AHEAD: 7,
    MOTION_THRESHOLD: 12,  // m/s² – significant shake/lift
    MORNING_WAKE_START: 5, // hour – start of wake-detection window
    MORNING_WAKE_END:   9, // hour – end   of wake-detection window
    LS_CONFIG_KEY: 'gameNotifierConfig',
    LS_MOTION_SENT_KEY: 'gameNotifierMotionSentDate',

    _swReg: null,
    _motionCleanup: null,

    /* ------------------------------------------------------------------ */
    /*  Public API                                                          */
    /* ------------------------------------------------------------------ */

    async init() {
        console.log('[GameNotifier] Initialising...');

        if (!('Notification' in window) || !('serviceWorker' in navigator)) {
            console.warn('[GameNotifier] Notifications not supported on this platform.');
            return;
        }

        // Request permission
        const perm = await this._requestPermission();
        if (perm !== 'granted') {
            console.warn('[GameNotifier] Permission not granted:', perm);
            return;
        }

        // Get SW registration
        try {
            this._swReg = await navigator.serviceWorker.ready;
        } catch (e) {
            console.error('[GameNotifier] SW not ready:', e);
            return;
        }

        // Fetch backend config (non-blocking, silent fail)
        await this._maybeSyncBackendConfig();

        // Schedule 7-day block
        await this.scheduleNotifications();

        // Start motion-based wake detection for today's morning if not yet sent
        this._startMotionWakeDetect();

        console.log('[GameNotifier] Ready.');
    },

    /**
     * Schedule morning + evening notifications for the next DAYS_AHEAD days.
     * Cancels any previously scheduled notifications first.
     */
    async scheduleNotifications() {
        const cfg = this._getConfig();
        console.log('[GameNotifier] Scheduling with config:', cfg);

        if ('showTrigger' in Notification.prototype) {
            await this._scheduleWithTriggers(cfg);
        } else {
            await this._scheduleViaSW(cfg);
        }
    },

    /** Cancel all pending triggers (Triggers API only). */
    async cancelAll() {
        if (!this._swReg) return;
        try {
            const pending = await this._swReg.getNotifications({ tag: 'game-notifier' });
            pending.forEach(n => n.close());
            // Also cancel scheduled (Triggers API)
            if ('getScheduledNotifications' in this._swReg) {
                const scheduled = await this._swReg.getScheduledNotifications();
                scheduled
                    .filter(n => n.tag && n.tag.startsWith('gn-'))
                    .forEach(n => n.close());
            }
        } catch (e) {
            console.warn('[GameNotifier] cancelAll error:', e);
        }
    },

    /**
     * Apply a new config (e.g. from admin backend).
     * Persists to localStorage and reschedules.
     */
    async applyConfig(cfg) {
        const merged = Object.assign(this._getConfig(), cfg);
        localStorage.setItem(this.LS_CONFIG_KEY, JSON.stringify(merged));
        console.log('[GameNotifier] Config updated:', merged);
        await this.cancelAll();
        await this.scheduleNotifications();
    },

    /* ------------------------------------------------------------------ */
    /*  Permission                                                          */
    /* ------------------------------------------------------------------ */

    async _requestPermission() {
        if (Notification.permission === 'granted') return 'granted';
        if (Notification.permission === 'denied')  return 'denied';
        try {
            return await Notification.requestPermission();
        } catch (e) {
            return 'denied';
        }
    },

    /* ------------------------------------------------------------------ */
    /*  Configuration                                                       */
    /* ------------------------------------------------------------------ */

    _getConfig() {
        const defaults = {
            morningTime: '07:00',
            eveningTime: '20:00',
            morningTitle: 'Добро утро! 🌅',
            morningBody:  'Как спахте тази нощ? Отговорете на сутрешния въпрос.',
            eveningTitle: 'Добър вечер! 🌙',
            eveningBody:  'Как мина денят? Отговорете на вечерните въпроси.',
        };
        try {
            const stored = localStorage.getItem(this.LS_CONFIG_KEY);
            return stored ? Object.assign({}, defaults, JSON.parse(stored)) : defaults;
        } catch (e) {
            return defaults;
        }
    },

    /* ------------------------------------------------------------------ */
    /*  Backend config sync                                                 */
    /* ------------------------------------------------------------------ */

    async _maybeSyncBackendConfig() {
        const WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
        const LS_VERSION_KEY = 'gameNotifierConfigVersion';
        try {
            const res = await fetch(`${WORKER_URL}/api/notification-config`, { method: 'GET' });
            if (!res.ok) return;
            const data = await res.json();
            if (!data || !data.config) return;
            const serverVersion = data.version || 0;
            const localVersion  = parseInt(localStorage.getItem(LS_VERSION_KEY) || '0', 10);
            if (serverVersion > localVersion) {
                localStorage.setItem(this.LS_CONFIG_KEY, JSON.stringify(data.config));
                localStorage.setItem(LS_VERSION_KEY, String(serverVersion));
                console.log('[GameNotifier] Config updated from backend.');
            }
        } catch (_) { /* offline / endpoint not deployed yet */ }
    },

    /* ------------------------------------------------------------------ */
    /*  Notification Triggers API (Chrome Android / TWA) – Method A        */
    /* ------------------------------------------------------------------ */

    async _scheduleWithTriggers(cfg) {
        console.log('[GameNotifier] Using Notification Triggers API');
        // Cancel previously scheduled ones
        await this.cancelAll();

        // TimestampTrigger is a browser global provided by the Notification Triggers API.
        // We only reach this method when 'showTrigger' in Notification.prototype, so the
        // global is always present. The typeof guard is an extra safety net.
        if (typeof TimestampTrigger === 'undefined') {
            console.warn('[GameNotifier] TimestampTrigger unexpectedly undefined; falling back to SW scheduling');
            return this._scheduleViaSW(cfg);
        }

        const [mH, mM] = cfg.morningTime.split(':').map(Number);
        const [eH, eM] = cfg.eveningTime.split(':').map(Number);
        const now = Date.now();

        for (let day = 0; day < this.DAYS_AHEAD; day++) {
            // Morning
            const morning = this._tsForDayOffset(day, mH, mM);
            if (morning > now) {
                try {
                    await this._swReg.showNotification(cfg.morningTitle, {
                        body: cfg.morningBody,
                        icon: '/icon-192x192.png',
                        badge: '/icon-192x192.png',
                        tag: `gn-morning-${morning}`,
                        data: { url: '/plan.html?action=morning_check', type: 'morning_check' },
                        showTrigger: new TimestampTrigger(morning),
                        requireInteraction: true,
                        vibrate: [300, 100, 300, 100, 300]
                    });
                } catch (e) {
                    console.warn('[GameNotifier] Trigger (morning) failed:', e);
                }
            }

            // Evening
            const evening = this._tsForDayOffset(day, eH, eM);
            if (evening > now) {
                try {
                    await this._swReg.showNotification(cfg.eveningTitle, {
                        body: cfg.eveningBody,
                        icon: '/icon-192x192.png',
                        badge: '/icon-192x192.png',
                        tag: `gn-evening-${evening}`,
                        data: { url: '/plan.html?action=evening_check', type: 'evening_check' },
                        showTrigger: new TimestampTrigger(evening),
                        requireInteraction: false,
                        vibrate: [200, 100, 200, 100, 200]
                    });
                } catch (e) {
                    console.warn('[GameNotifier] Trigger (evening) failed:', e);
                }
            }
        }
        console.log('[GameNotifier] Triggers scheduled for', this.DAYS_AHEAD, 'days');
    },

    /* ------------------------------------------------------------------ */
    /*  SW message fallback – Method B                                      */
    /* ------------------------------------------------------------------ */

    async _scheduleViaSW(cfg) {
        console.log('[GameNotifier] Using SW message scheduling (fallback)');
        if (!this._swReg || !navigator.serviceWorker.controller) {
            console.warn('[GameNotifier] No active SW controller for message scheduling');
            return;
        }

        const [mH, mM] = cfg.morningTime.split(':').map(Number);
        const [eH, eM] = cfg.eveningTime.split(':').map(Number);
        const now = Date.now();
        const schedule = [];

        for (let day = 0; day < this.DAYS_AHEAD; day++) {
            const morning = this._tsForDayOffset(day, mH, mM);
            if (morning > now) {
                schedule.push({
                    ts: morning,
                    title: cfg.morningTitle,
                    body:  cfg.morningBody,
                    tag:   `gn-morning-${morning}`,
                    type:  'morning_check',
                    url:   '/plan.html?action=morning_check',
                    vibrate: [300, 100, 300, 100, 300],
                    requireInteraction: true
                });
            }
            const evening = this._tsForDayOffset(day, eH, eM);
            if (evening > now) {
                schedule.push({
                    ts: evening,
                    title: cfg.eveningTitle,
                    body:  cfg.eveningBody,
                    tag:   `gn-evening-${evening}`,
                    type:  'evening_check',
                    url:   '/plan.html?action=evening_check',
                    vibrate: [200, 100, 200, 100, 200],
                    requireInteraction: false
                });
            }
        }

        navigator.serviceWorker.controller.postMessage({
            type: 'SCHEDULE_GAME_NOTIFICATIONS',
            schedule
        });
        console.log('[GameNotifier] Sent', schedule.length, 'items to SW for scheduling');
    },

    /* ------------------------------------------------------------------ */
    /*  DeviceMotion wake detection                                         */
    /* ------------------------------------------------------------------ */

    _startMotionWakeDetect() {
        // Only run on Android (TWA) – iOS requires explicit permission request
        if (!/Android/i.test(navigator.userAgent)) return;

        const h = new Date().getHours();
        if (h < this.MORNING_WAKE_START || h >= this.MORNING_WAKE_END) return;

        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem(this.LS_MOTION_SENT_KEY) === today) return;

        // Check if morning question already answered
        try {
            const gameData = JSON.parse(localStorage.getItem('gameData') || '{}');
            const rec = gameData[today];
            if (rec && rec.morningCheck) return; // already answered
        } catch (_) {}

        if (typeof DeviceMotionEvent === 'undefined') return;

        console.log('[GameNotifier] Starting motion wake detection');

        const onMotion = (e) => {
            const acc = e.acceleration || e.accelerationIncludingGravity;
            if (!acc) return;
            const mag = Math.sqrt(
                (acc.x || 0) ** 2 +
                (acc.y || 0) ** 2 +
                (acc.z || 0) ** 2
            );
            if (mag < this.MOTION_THRESHOLD) return;

            // Significant motion detected – user picked up the phone
            const nowH = new Date().getHours();
            if (nowH < this.MORNING_WAKE_START || nowH >= this.MORNING_WAKE_END) {
                this._stopMotionDetect();
                return;
            }

            // Check daily sent flag
            const d = new Date().toISOString().slice(0, 10);
            if (localStorage.getItem(this.LS_MOTION_SENT_KEY) === d) {
                this._stopMotionDetect();
                return;
            }

            localStorage.setItem(this.LS_MOTION_SENT_KEY, d);
            this._stopMotionDetect();

            console.log('[GameNotifier] Motion wake detected – showing morning notification');
            this._showImmediateNotification('morning_check');
        };

        window.addEventListener('devicemotion', onMotion, { passive: true });
        this._motionCleanup = () => window.removeEventListener('devicemotion', onMotion);
    },

    _stopMotionDetect() {
        if (this._motionCleanup) {
            this._motionCleanup();
            this._motionCleanup = null;
        }
    },

    async _showImmediateNotification(type) {
        if (!this._swReg) return;
        const cfg = this._getConfig();
        const isMorning = type === 'morning_check';
        try {
            await this._swReg.showNotification(
                isMorning ? cfg.morningTitle : cfg.eveningTitle,
                {
                    body:   isMorning ? cfg.morningBody : cfg.eveningBody,
                    icon:   '/icon-192x192.png',
                    badge:  '/icon-192x192.png',
                    tag:    `gn-${type}-immediate`,
                    data:   { url: `/plan.html?action=${type}`, type },
                    requireInteraction: isMorning,
                    vibrate: isMorning ? [300, 100, 300, 100, 300] : [200, 100, 200, 100, 200]
                }
            );
        } catch (e) {
            console.error('[GameNotifier] Immediate notification failed:', e);
        }
    },

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                             */
    /* ------------------------------------------------------------------ */

    _tsForDayOffset(dayOffset, hours, minutes) {
        const d = new Date();
        d.setDate(d.getDate() + dayOffset);
        d.setHours(hours, minutes, 0, 0);
        return d.getTime();
    }
};

// Expose globally
if (typeof window !== 'undefined') {
    window.GameNotifier = GameNotifier;
}
