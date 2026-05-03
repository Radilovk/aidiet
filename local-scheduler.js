/**
 * GameNotifier – автономна система за локални нотификации.
 *
 * Поддържа три слоя за изпращане (в ред на предпочитание):
 *   1. Capacitor LocalNotifications (APK / нативен Android)  ✅ най-надежден
 *   2. Notification Triggers API (TimestampTrigger) – Chrome/Edge Android, TWA  ✅
 *   3. SW postMessage → SW sets a timeout (fallback – работи само пока браузърът е жив)  ⚠️
 *
 * Нотификации (всички конфигурируеми от admin панела):
 *   morning_check  – събуждане след 05:00 (motion detection или фиксиран час 07:00)
 *   evening_check  – вечерна проверка (по подразбиране 20:00)
 *
 * Wake detection (Android):
 *   A. DeviceMotion – значително ускорение (>12 m/s²) между 05:00 и 09:00
 *   B. Capacitor Motion plugin (ако е наличен) – по-надеждно четене на акселерометъра
 *   → Ако нито едно не работи, нотификацията излиза в зададения час (morningTime).
 *
 * Backend config sync:
 *   – GET /api/notification-config (max веднъж на 24 ч, освен при force)
 *   – Съхранява се в localStorage → 'gameNotifierConfig'
 *   – forceSyncBackendConfig() изчиства throttle и синхронизира веднага
 */

const GameNotifier = {

    DAYS_AHEAD:        7,
    MOTION_THRESHOLD:  12,   // m/s² – значително ускорение/вдигане
    MORNING_WAKE_START: 5,   // час – начало на wake-detection прозореца
    MORNING_WAKE_END:   9,   // час – край на wake-detection прозореца
    LS_CONFIG_KEY:      'gameNotifierConfig',
    LS_MOTION_SENT_KEY: 'gameNotifierMotionSentDate',

    _swReg:         null,
    _motionCleanup: null,
    _capacitor:     null,   // @capacitor/local-notifications handle

    /* ------------------------------------------------------------------ */
    /*  Public API                                                          */
    /* ------------------------------------------------------------------ */

    async init() {
        console.log('[GameNotifier] Initialising...');

        // Detect Capacitor (APK context)
        this._capacitor = this._detectCapacitor();

        if (this._capacitor) {
            // Native Capacitor path
            console.log('[GameNotifier] Running in Capacitor (APK) context');
            const granted = await this._requestCapacitorPermission();
            if (!granted) {
                console.warn('[GameNotifier] Capacitor notification permission denied');
                return;
            }
        } else {
            // Web / PWA path – check for browser Notification API
            if (!('Notification' in window) || !('serviceWorker' in navigator)) {
                console.warn('[GameNotifier] Notifications not supported on this platform.');
                return;
            }
            const perm = await this._requestPermission();
            if (perm !== 'granted') {
                console.warn('[GameNotifier] Permission not granted:', perm);
                return;
            }
            try {
                this._swReg = await navigator.serviceWorker.ready;
            } catch (e) {
                console.error('[GameNotifier] SW not ready:', e);
                return;
            }
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

        if (this._capacitor) {
            await this._scheduleWithCapacitor(cfg);
        } else if ('showTrigger' in Notification.prototype) {
            await this._scheduleWithTriggers(cfg);
        } else {
            await this._scheduleViaSW(cfg);
        }
    },

    /** Cancel all pending triggers / notifications. */
    async cancelAll() {
        if (this._capacitor) {
            try {
                const { LocalNotifications } = this._capacitor;
                const pending = await LocalNotifications.getPending();
                if (pending.notifications && pending.notifications.length > 0) {
                    await LocalNotifications.cancel({ notifications: pending.notifications });
                }
            } catch (e) {
                console.warn('[GameNotifier] Capacitor cancelAll error:', e);
            }
            return;
        }
        if (!this._swReg) return;
        try {
            const pending = await this._swReg.getNotifications({ tag: 'game-notifier' });
            pending.forEach(n => n.close());
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
    /*  Capacitor detection                                                 */
    /* ------------------------------------------------------------------ */

    _detectCapacitor() {
        // window.Capacitor is injected by Capacitor runtime in APK context
        if (typeof window === 'undefined' || !window.Capacitor) return null;
        try {
            const { Plugins } = window.Capacitor;
            if (Plugins && Plugins.LocalNotifications) {
                return { LocalNotifications: Plugins.LocalNotifications };
            }
        } catch (_) {}
        return null;
    },

    async _requestCapacitorPermission() {
        try {
            const { LocalNotifications } = this._capacitor;
            const status = await LocalNotifications.requestPermissions();
            return status.display === 'granted';
        } catch (e) {
            console.error('[GameNotifier] Capacitor permission error:', e);
            return false;
        }
    },

    /* ------------------------------------------------------------------ */
    /*  Permission (web/PWA)                                                */
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
            morningTime:  '07:00',
            eveningTime:  '20:00',
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
        const LS_LAST_SYNC_KEY = 'gameNotifierConfigLastSync';
        const MIN_INTERVAL_MS  = 24 * 60 * 60 * 1000; // 24 hours
        const lastSync = parseInt(localStorage.getItem(LS_LAST_SYNC_KEY) || '0', 10);
        if (Date.now() - lastSync < MIN_INTERVAL_MS) return;

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
            localStorage.setItem(LS_LAST_SYNC_KEY, String(Date.now()));
        } catch (_) { /* offline / endpoint not deployed yet */ }
    },

    /**
     * Force an immediate config sync from the backend (bypasses the 24-hour throttle).
     * Intended for use by the admin panel after a config change is pushed.
     */
    async forceSyncBackendConfig() {
        localStorage.removeItem('gameNotifierConfigLastSync');
        await this._maybeSyncBackendConfig();
    },

    /* ------------------------------------------------------------------ */
    /*  Capacitor LocalNotifications – Method A (APK)                       */
    /* ------------------------------------------------------------------ */

    async _scheduleWithCapacitor(cfg) {
        console.log('[GameNotifier] Using Capacitor LocalNotifications');
        const { LocalNotifications } = this._capacitor;
        await this.cancelAll();

        const [mH, mM] = cfg.morningTime.split(':').map(Number);
        const [eH, eM] = cfg.eveningTime.split(':').map(Number);
        const notifications = [];

        for (let day = 0; day < this.DAYS_AHEAD; day++) {
            const morningTs = this._tsForDayOffset(day, mH, mM);
            if (morningTs > Date.now()) {
                notifications.push({
                    id: 1000 + day,
                    title: cfg.morningTitle,
                    body:  cfg.morningBody,
                    schedule: { at: new Date(morningTs) },
                    extra: { url: '/plan.html?action=morning_check', type: 'morning_check' },
                    iconColor: '#FF8C00',
                    smallIcon: 'ic_stat_icon_config_sample'
                });
            }
            const eveningTs = this._tsForDayOffset(day, eH, eM);
            if (eveningTs > Date.now()) {
                notifications.push({
                    id: 2000 + day,
                    title: cfg.eveningTitle,
                    body:  cfg.eveningBody,
                    schedule: { at: new Date(eveningTs) },
                    extra: { url: '/plan.html?action=evening_check', type: 'evening_check' },
                    iconColor: '#6A0DAD',
                    smallIcon: 'ic_stat_icon_config_sample'
                });
            }
        }

        try {
            await LocalNotifications.schedule({ notifications });
            console.log('[GameNotifier] Capacitor: scheduled', notifications.length, 'notifications');
        } catch (e) {
            console.error('[GameNotifier] Capacitor schedule error:', e);
        }

        // Listen for notification action (tap) to navigate to action URL
        LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
            const extra = action.notification.extra || {};
            if (extra.url) {
                window.location.href = extra.url;
            }
        });
    },

    /* ------------------------------------------------------------------ */
    /*  Notification Triggers API (Chrome Android / TWA) – Method B        */
    /* ------------------------------------------------------------------ */

    async _scheduleWithTriggers(cfg) {
        console.log('[GameNotifier] Using Notification Triggers API');
        await this.cancelAll();

        if (typeof TimestampTrigger === 'undefined') {
            console.warn('[GameNotifier] TimestampTrigger unexpectedly undefined; falling back to SW scheduling');
            return this._scheduleViaSW(cfg);
        }

        const [mH, mM] = cfg.morningTime.split(':').map(Number);
        const [eH, eM] = cfg.eveningTime.split(':').map(Number);
        const now = Date.now();

        for (let day = 0; day < this.DAYS_AHEAD; day++) {
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
    /*  SW message fallback – Method C                                      */
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
        // Runs on Android (TWA / Capacitor) only
        if (!/Android/i.test(navigator.userAgent)) return;

        const h = new Date().getHours();
        if (h < this.MORNING_WAKE_START || h >= this.MORNING_WAKE_END) return;

        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem(this.LS_MOTION_SENT_KEY) === today) return;

        // Skip if morning question already answered today
        try {
            const gameData = JSON.parse(localStorage.getItem('gameData') || '{}');
            const rec = gameData[today];
            if (rec && rec.morningCheck) return;
        } catch (_) {}

        // Try Capacitor Motion plugin first
        if (this._tryCapacitorMotion()) return;

        // Fallback: Web DeviceMotion API
        if (typeof DeviceMotionEvent === 'undefined') return;

        console.log('[GameNotifier] Starting DeviceMotion wake detection');

        const onMotion = (e) => {
            const acc = e.acceleration || e.accelerationIncludingGravity;
            if (!acc) return;
            const mag = Math.sqrt(
                (acc.x || 0) ** 2 +
                (acc.y || 0) ** 2 +
                (acc.z || 0) ** 2
            );
            if (mag < this.MOTION_THRESHOLD) return;

            const nowH = new Date().getHours();
            if (nowH < this.MORNING_WAKE_START || nowH >= this.MORNING_WAKE_END) {
                this._stopMotionDetect();
                return;
            }

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

    /**
     * Attempt to use Capacitor Motion plugin for wake detection.
     * Returns true if successfully started, false otherwise.
     */
    _tryCapacitorMotion() {
        if (typeof window === 'undefined' || !window.Capacitor) return false;
        try {
            const { Motion } = window.Capacitor.Plugins || {};
            if (!Motion) return false;

            console.log('[GameNotifier] Starting Capacitor Motion wake detection');

            const handler = Motion.addListener('accel', (event) => {
                const acc = event.acceleration;
                if (!acc) return;
                const mag = Math.sqrt(
                    (acc.x || 0) ** 2 +
                    (acc.y || 0) ** 2 +
                    (acc.z || 0) ** 2
                );
                if (mag < this.MOTION_THRESHOLD) return;

                const nowH = new Date().getHours();
                if (nowH < this.MORNING_WAKE_START || nowH >= this.MORNING_WAKE_END) {
                    handler.remove();
                    this._motionCleanup = null;
                    return;
                }

                const d = new Date().toISOString().slice(0, 10);
                if (localStorage.getItem(this.LS_MOTION_SENT_KEY) === d) {
                    handler.remove();
                    this._motionCleanup = null;
                    return;
                }

                localStorage.setItem(this.LS_MOTION_SENT_KEY, d);
                handler.remove();
                this._motionCleanup = null;

                console.log('[GameNotifier] Capacitor Motion wake detected – showing morning notification');
                this._showImmediateNotification('morning_check');
            });

            this._motionCleanup = () => handler.remove();
            return true;
        } catch (e) {
            console.warn('[GameNotifier] Capacitor Motion unavailable:', e);
            return false;
        }
    },

    _stopMotionDetect() {
        if (this._motionCleanup) {
            this._motionCleanup();
            this._motionCleanup = null;
        }
    },

    async _showImmediateNotification(type) {
        const cfg = this._getConfig();
        const isMorning = type === 'morning_check';
        const title = isMorning ? cfg.morningTitle : cfg.eveningTitle;
        const body  = isMorning ? cfg.morningBody  : cfg.eveningBody;

        if (this._capacitor) {
            try {
                const { LocalNotifications } = this._capacitor;
                await LocalNotifications.schedule({
                    notifications: [{
                        id: isMorning ? 9001 : 9002,
                        title,
                        body,
                        schedule: { at: new Date(Date.now() + 500) },
                        extra: { url: `/plan.html?action=${type}`, type },
                        iconColor: isMorning ? '#FF8C00' : '#6A0DAD',
                        smallIcon: 'ic_stat_icon_config_sample'
                    }]
                });
            } catch (e) {
                console.error('[GameNotifier] Capacitor immediate notification failed:', e);
            }
            return;
        }

        if (!this._swReg) return;
        try {
            await this._swReg.showNotification(title, {
                body,
                icon:   '/icon-192x192.png',
                badge:  '/icon-192x192.png',
                tag:    `gn-${type}-immediate`,
                data:   { url: `/plan.html?action=${type}`, type },
                requireInteraction: isMorning,
                vibrate: isMorning ? [300, 100, 300, 100, 300] : [200, 100, 200, 100, 200]
            });
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
