/**
 * GameNotifier – минималистична система за локални нотификации.
 *
 * Изпраща сутрешна/вечерна нотификация чрез SW postMessage (fallback, докато
 * браузърът е отворен). Основните нотификации се изпращат от сървъра чрез
 * Web Push (cron job в worker.js), така че тук се обработва само fallback.
 *
 * Backend config sync:
 *   – GET /api/notification-config (max веднъж на 24 ч)
 *   – Съхранява се в localStorage → 'gameNotifierConfig'
 */

const GameNotifier = {

    DAYS_AHEAD:     7,
    LS_CONFIG_KEY:  'gameNotifierConfig',

    _swReg: null,

    /* ------------------------------------------------------------------ */
    /*  Public API                                                          */
    /* ------------------------------------------------------------------ */

    async init() {
        if (!('Notification' in window) || !('serviceWorker' in navigator)) {
            console.warn('[GameNotifier] Notifications not supported.');
            return;
        }
        if (Notification.permission !== 'granted') {
            console.warn('[GameNotifier] Permission not granted:', Notification.permission);
            return;
        }
        try {
            this._swReg = await navigator.serviceWorker.ready;
        } catch (e) {
            console.error('[GameNotifier] SW not ready:', e);
            return;
        }

        await this._maybeSyncBackendConfig();
        await this.scheduleNotifications();
        console.log('[GameNotifier] Ready (SW postMessage fallback).');
    },

    async scheduleNotifications() {
        await this._scheduleViaSW(this._getConfig());
    },

    async applyConfig(cfg) {
        const merged = Object.assign(this._getConfig(), cfg);
        localStorage.setItem(this.LS_CONFIG_KEY, JSON.stringify(merged));
        await this.scheduleNotifications();
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
        const MIN_INTERVAL_MS  = 24 * 60 * 60 * 1000;
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
        } catch (_) {}
    },

    async forceSyncBackendConfig() {
        localStorage.removeItem('gameNotifierConfigLastSync');
        await this._maybeSyncBackendConfig();
    },

    /* ------------------------------------------------------------------ */
    /*  SW postMessage fallback                                             */
    /* ------------------------------------------------------------------ */

    async _scheduleViaSW(cfg) {
        if (!this._swReg || !navigator.serviceWorker.controller) {
            console.warn('[GameNotifier] No active SW controller');
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
