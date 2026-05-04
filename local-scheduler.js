/**
 * GameNotifier – система за локални нотификации.
 *
 * Поддържа два слоя за изпращане (в ред на предпочитание):
 *   1. Capacitor LocalNotifications (APK / нативен Android)  ✅ най-надежден
 *   2. SW postMessage → SW sets a timeout (PWA fallback – работи само докато браузърът е жив)  ⚠️
 *
 * Нотификации:
 *   morning_check  – сутрешна проверка (по подразбиране 07:00)
 *   evening_check  – вечерна проверка (по подразбиране 20:00)
 *
 * Backend config sync:
 *   – GET /api/notification-config (max веднъж на 24 ч, освен при force)
 *   – Конфигурацията се кешира в localStorage → 'gameNotifierConfig'
 *   – Backend се извиква само ако версията от сървъра е по-нова
 */

const GameNotifier = {

    DAYS_AHEAD:     30, // Rolling 30-day window is more reliable on Android than only queuing 7 days.
    LS_CONFIG_KEY:  'gameNotifierConfig',

    _swReg:     null,
    _capacitor: null,   // @capacitor/local-notifications handle
    _actionListenerAttached: false,
    _nextImmediateId: 900000000,

    /* ------------------------------------------------------------------ */
    /*  Public API                                                          */
    /* ------------------------------------------------------------------ */

    async init() {
        console.log('[GameNotifier] Initialising...');

        // Detect Capacitor (APK context)
        this._capacitor = this._detectCapacitor();

        if (this._capacitor) {
            console.log('[GameNotifier] Running in Capacitor (APK) context');
            const permission = await this.getPermissionState();
            if (permission !== 'granted') {
                console.warn('[GameNotifier] Capacitor notification permission not granted:', permission);
                return false;
            }
            await this._checkCapacitorAlarmReadiness();
        } else {
            // Web / PWA path
            if (!('Notification' in window) || !('serviceWorker' in navigator)) {
                console.warn('[GameNotifier] Notifications not supported on this platform.');
                return false;
            }
            if (Notification.permission !== 'granted') {
                console.warn('[GameNotifier] Permission not granted:', Notification.permission);
                return false;
            }
            try {
                this._swReg = await navigator.serviceWorker.ready;
            } catch (e) {
                console.error('[GameNotifier] SW not ready:', e);
                return false;
            }
        }

        // Sync backend config (at most once per 24 h, no-op if unchanged)
        await this._maybeSyncBackendConfig();

        // Schedule rolling block with hardcoded defaults (or admin-overridden times)
        await this.scheduleNotifications();

        console.log('[GameNotifier] Ready.');
        return true;
    },

    async scheduleNotifications() {
        // Re-detect here because diagnostics/test pages may call scheduleNotifications() directly
        // without a preceding init() call.
        this._capacitor = this._detectCapacitor();
        const cfg = this._getConfig();
        console.log('[GameNotifier] Scheduling with config:', cfg);

        if (this._capacitor) {
            await this._scheduleWithCapacitor(cfg);
        } else {
            await this._scheduleViaSW(cfg);
        }
    },

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
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_GAME_NOTIFICATIONS' });
            }
            const pending = await this._swReg.getNotifications();
            pending
                .filter(n => typeof n.tag === 'string' && n.tag.startsWith('gn-'))
                .forEach(n => n.close());
        } catch (e) {
            console.warn('[GameNotifier] cancelAll error:', e);
        }
    },

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

    isNativePlatform() {
        return !!this._detectCapacitor();
    },

    async getPermissionState() {
        const capacitor = this._detectCapacitor();
        if (capacitor) {
            try {
                const { LocalNotifications } = capacitor;
                if (LocalNotifications.checkPermissions) {
                    const status = await LocalNotifications.checkPermissions();
                    return status && status.display ? status.display : 'prompt';
                }
                return 'prompt';
            } catch (e) {
                console.warn('[GameNotifier] Capacitor checkPermissions error:', e);
                return 'prompt';
            }
        }

        if (typeof Notification === 'undefined') return 'unsupported';
        return Notification.permission || 'default';
    },

    async requestPermission() {
        const capacitor = this._detectCapacitor();
        if (capacitor) {
            this._capacitor = capacitor;
            try {
                const { LocalNotifications } = capacitor;
                const current = LocalNotifications.checkPermissions
                    ? await LocalNotifications.checkPermissions()
                    : null;
                if (current && current.display === 'granted') {
                    return 'granted';
                }
                const status = await LocalNotifications.requestPermissions();
                return status && status.display ? status.display : 'prompt';
            } catch (e) {
                console.error('[GameNotifier] Capacitor permission error:', e);
                return 'denied';
            }
        }

        if (typeof Notification === 'undefined' || !Notification.requestPermission) {
            return 'unsupported';
        }

        try {
            return await Notification.requestPermission();
        } catch (e) {
            console.warn('[GameNotifier] Notification.requestPermission error:', e);
            return 'denied';
        }
    },

    _detectCapacitor() {
        if (typeof window === 'undefined' || !window.Capacitor) return null;
        try {
            const cap = window.Capacitor;
            const isNative = typeof cap.isNativePlatform === 'function'
                ? cap.isNativePlatform()
                : (typeof cap.getPlatform === 'function' ? cap.getPlatform() !== 'web' : true);
            const plugins = cap.Plugins || {};
            if (isNative && plugins.LocalNotifications) {
                return { LocalNotifications: plugins.LocalNotifications };
            }
        } catch (_) {}
        return null;
    },

    async _checkCapacitorAlarmReadiness() {
        const capacitor = this._capacitor || this._detectCapacitor();
        if (!capacitor) return true;
        try {
            const { LocalNotifications } = capacitor;
            if (!LocalNotifications.checkExactNotificationSetting) return true;
            const exactState = await LocalNotifications.checkExactNotificationSetting();
            const enabled = exactState === true
                || exactState?.granted === true
                || exactState?.exact === true
                || exactState?.enabled === true
                || exactState?.canScheduleExactAlarms === true
                || exactState?.value === 'granted'
                || exactState?.value === 'enabled';
            if (!enabled) {
                console.warn('[GameNotifier] Exact alarms are disabled. Android may delay scheduled notifications.');
                return false;
            }
            return true;
        } catch (e) {
            console.warn('[GameNotifier] Exact alarm check failed:', e);
            return false;
        }
    },

    /* ------------------------------------------------------------------ */
    /*  Configuration (hardcoded defaults, overridden by admin backend)     */
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
    /*  Backend config sync (only when admin changes config)               */
    /* ------------------------------------------------------------------ */

    async _maybeSyncBackendConfig() {
        const LS_LAST_SYNC_KEY = 'gameNotifierConfigLastSync';
        const MIN_INTERVAL_MS  = 24 * 60 * 60 * 1000; // 24 h throttle
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
                console.log('[GameNotifier] Config updated from backend (version', serverVersion, ').');
            }
            localStorage.setItem(LS_LAST_SYNC_KEY, String(Date.now()));
        } catch (_) { /* offline / endpoint not deployed yet */ }
    },

    /**
     * Force an immediate config sync (bypasses the 24 h throttle).
     * Called by the admin panel after a config change is saved.
     */
    async forceSyncBackendConfig() {
        localStorage.removeItem('gameNotifierConfigLastSync');
        await this._maybeSyncBackendConfig();
    },

    /* ------------------------------------------------------------------ */
    /*  Capacitor LocalNotifications – APK path                            */
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
                const def = this._getDefinition('morning_check', cfg);
                notifications.push({
                    id: 1000 + day,
                    title: def.title,
                    body:  def.body,
                    schedule: { at: new Date(morningTs), allowWhileIdle: true },
                    extra: def.extra,
                    iconColor: def.iconColor,
                    smallIcon: 'ic_stat_nutriplan'
                });
            }
            const eveningTs = this._tsForDayOffset(day, eH, eM);
            if (eveningTs > Date.now()) {
                const def = this._getDefinition('evening_check', cfg);
                notifications.push({
                    id: 2000 + day,
                    title: def.title,
                    body:  def.body,
                    schedule: { at: new Date(eveningTs), allowWhileIdle: true },
                    extra: def.extra,
                    iconColor: def.iconColor,
                    smallIcon: 'ic_stat_nutriplan'
                });
            }
        }

        try {
            await LocalNotifications.schedule({ notifications });
            console.log('[GameNotifier] Capacitor: scheduled', notifications.length, 'notifications');
        } catch (e) {
            console.error('[GameNotifier] Capacitor schedule error:', e);
        }

        // Navigate to action URL on notification tap
        if (!this._actionListenerAttached && LocalNotifications.addListener) {
            LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
                const extra = action.notification.extra || {};
                if (extra.url) {
                    window.location.href = extra.url;
                }
            });
            this._actionListenerAttached = true;
        }
    },

    /* ------------------------------------------------------------------ */
    /*  SW postMessage – PWA fallback (active while browser is open)       */
    /* ------------------------------------------------------------------ */

    async _scheduleViaSW(cfg) {
        console.log('[GameNotifier] Using SW postMessage scheduling');
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
                const def = this._getDefinition('morning_check', cfg);
                schedule.push({
                    ts: morning,
                    title: def.title,
                    body:  def.body,
                    tag:   `gn-morning-${morning}`,
                    type:  def.extra.type,
                    url:   def.extra.url,
                    vibrate: [300, 100, 300, 100, 300],
                    requireInteraction: true
                });
            }
            const evening = this._tsForDayOffset(day, eH, eM);
            if (evening > now) {
                const def = this._getDefinition('evening_check', cfg);
                schedule.push({
                    ts: evening,
                    title: def.title,
                    body:  def.body,
                    tag:   `gn-evening-${evening}`,
                    type:  def.extra.type,
                    url:   def.extra.url,
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
    /*  Helper                                                              */
    /* ------------------------------------------------------------------ */

    async _showImmediateNotification(type) {
        const cfg = this._getConfig();
        const def = this._getDefinition(type, cfg);
        if (!def) {
            throw new Error(`Unsupported notification type: ${type}`);
        }

        this._capacitor = this._detectCapacitor();

        if (this._capacitor) {
            const { LocalNotifications } = this._capacitor;
            const immediateId = this._getNextImmediateId();
            await LocalNotifications.schedule({
                notifications: [{
                    id: immediateId,
                    title: def.title,
                    body: def.body,
                    schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
                    extra: def.extra,
                    iconColor: def.iconColor,
                    smallIcon: 'ic_stat_nutriplan'
                }]
            });
            return;
        }

        const swReg = this._swReg || (('serviceWorker' in navigator) ? await navigator.serviceWorker.ready : null);
        if (swReg) {
            this._swReg = swReg;
            await swReg.showNotification(def.title, {
                body: def.body,
                icon: '/icon-192x192.png',
                badge: '/icon-192x192.png',
                tag: `gn-immediate-${type}-${Date.now()}`,
                data: { url: def.extra.url, type: def.extra.type },
                requireInteraction: type === 'morning_check',
                vibrate: type === 'morning_check' ? [300, 100, 300, 100, 300] : [200, 100, 200]
            });
            return;
        }

        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            throw new Error('Notification permission not granted');
        }

        const notification = new Notification(def.title, {
            body: def.body,
            icon: '/icon-192x192.png',
            tag: `gn-immediate-${type}-${Date.now()}`
        });
        notification.onclick = () => {
            window.location.href = def.extra.url;
            notification.close();
        };
    },

    _getDefinition(type, cfg) {
        if (type === 'morning_check') {
            return {
                title: cfg.morningTitle,
                body: cfg.morningBody,
                iconColor: '#FF8C00',
                extra: { url: '/plan.html?action=morning_check', type: 'morning_check' }
            };
        }
        if (type === 'evening_check') {
            return {
                title: cfg.eveningTitle,
                body: cfg.eveningBody,
                iconColor: '#6A0DAD',
                extra: { url: '/plan.html?action=evening_check', type: 'evening_check' }
            };
        }
        return null;
    },

    _getNextImmediateId() {
        this._nextImmediateId += 1;
        if (this._nextImmediateId >= 999999999) {
            this._nextImmediateId = 900000000;
        }
        return this._nextImmediateId;
    },

    _tsForDayOffset(dayOffset, hours, minutes) {
        const d = new Date();
        d.setDate(d.getDate() + dayOffset);
        d.setHours(hours, minutes, 0, 0);
        return d.getTime();
    }
};

if (typeof window !== 'undefined') {
    window.GameNotifier = GameNotifier;
}
