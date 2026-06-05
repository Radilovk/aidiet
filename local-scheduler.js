/**
 * GameNotifier – система за локални нотификации.
 *
 * Поддържа три слоя за изпращане (в ред на предпочитание):
 *   1. Capacitor LocalNotifications (APK / нативен Android)  ✅ най-надежден
 *   2. Calendar feed fallback (Huawei/без Google services) ✅ системен календар
 *   3. SW postMessage → SW sets a timeout (PWA fallback – работи само докато браузърът е жив)  ⚠️
 *
 * Нотификации:
 *   morning_check  – сутрешна проверка (по подразбиране 07:00)
 *   evening_check  – вечерна проверка (по подразбиране 20:00)
 *
 * Backend config sync:
 *   – Пести бекенда: максимум 1 лек version check на 24 часа.
 *   – Локален APK/PWA график от *notifyme не прави backend заявки.
 *   – forceSyncBackendConfig() игнорира кеша само при ръчен/admin тест.
 */

const GameNotifier = {

    // Keep a rolling monthly buffer so OEM battery restrictions or missed app opens
    // do not leave users without reminders after the first week.
    SCHEDULE_WINDOW_DAYS: 30,
    LS_CONFIG_KEY:        'gameNotifierConfig',
    LS_LOCAL_KEY:         'gameNotifierLocalConfig',
    LS_VERSION_KEY:       'gameNotifierConfigVersion',
    LS_LAST_REFRESH_KEY:  'gameNotifierLastRefresh',
    CALENDAR_URL:   'https://aidiet.radilov-k.workers.dev/api/calendar.ics',
    CHANNEL_ID:     'nutriplan_daily_checkins',
    MORNING_CHANNEL_ID: 'nutriplan_morning',
    EVENING_CHANNEL_ID: 'nutriplan_evening',
    NOTIFICATION_SOUND: 'nutriplan_checkin.wav',
    BRAND_TEAL:     '#009A9E',
    BRAND_TEAL_DARK: '#0F766E',
    QUICK_ANSWER_PATH: '/quick-answer.html',
    MORNING_ACTION_TYPE_ID: 'nutriplan_morning_check',
    EVENING_ACTION_TYPE_ID: 'nutriplan_evening_check',
    ACK_NOTIFICATION_ID:  9997,
    PENDING_DB_NAME:        'nutriplan-game-pending',
    PENDING_STORE:          'actions',

    // Same wording as the in-app AI assistant bubbles (plan.html showBubble).
    COPY: {
        morning: {
            title: 'AI Асистент',
            body:  'Спахте ли добре тази нощ?',
            actions: [
                { id: 'sleep_yes', title: 'Да' },
                { id: 'sleep_no',  title: 'Не' },
                { id: 'skip',      title: 'Пропуск' }
            ]
        },
        evening: {
            title: 'AI Асистент',
            body:  'Ниво на активност?\nЕмоционален баланс?\nИзпихте ли поне 2 л вода?',
            actions: [
                { id: 'water_no',  title: 'Не' },
                { id: 'water_yes', title: 'Да' },
                { id: 'skip',      title: 'Пропуск' }
            ]
        }
    },

    SILENT_ACTIONS: new Set(['sleep_yes', 'sleep_no', 'water_yes', 'water_no', 'skip']),

    _swReg:     null,
    _capacitor: null,   // @capacitor/local-notifications handle
    _listenersBound: false,
    _initialized: false,
    _initPromise: null,

    /* ------------------------------------------------------------------ */
    /*  Public API                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Returns the webcal:// URL that calendar apps use to subscribe to the
     * NutriPlan notification feed (works on Huawei Calendar, iOS Calendar,
     * Google Calendar, Outlook, etc.).  Once subscribed the calendar app
     * re-fetches the feed ~daily so admin config changes propagate automatically.
     */
    getCalendarSubscribeUrl() {
        return this.CALENDAR_URL.replace('https://', 'webcal://');
    },

    async init() {
        if (this._initialized) {
            console.log('[GameNotifier] Already ready – skipping re-init.');
            return true;
        }
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            console.log('[GameNotifier] Initialising...');

            // Detect Capacitor (APK context)
            this._capacitor = this._detectCapacitor();

            if (this._capacitor) {
                console.log('[GameNotifier] Running in Capacitor (APK) context');
                const granted = await this._requestCapacitorPermission();
                if (!granted) {
                    console.warn('[GameNotifier] Capacitor notification permission denied');
                    return false;
                }
                await this._registerCapacitorActionTypes();
                this._bindCapacitorListeners();
            } else {
                // Web / PWA path
                if (!('Notification' in window) || !('serviceWorker' in navigator)) {
                    if (this._isHuawei()) {
                        console.log('[GameNotifier] Huawei device detected – use calendar subscription:', this.getCalendarSubscribeUrl());
                    } else {
                        console.warn('[GameNotifier] Notifications not supported on this platform.');
                    }
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

            // Backend sync is intentionally rare to keep KV/Worker costs low.
            // Local APK/PWA schedules never hit the backend.
            if (this._shouldSyncBackendConfig()) {
                await this._maybeSyncBackendConfig();
                localStorage.setItem(this.LS_LAST_REFRESH_KEY, String(Date.now()));
            }

            // Schedule the rolling monthly buffer using the (now up-to-date) config.
            await this.scheduleNotifications();
            this._initialized = true;
            localStorage.setItem(this.LS_LAST_REFRESH_KEY, String(Date.now()));
            console.log('[GameNotifier] Ready.');
            return true;
        })();

        let ready = false;
        try {
            ready = await this._initPromise;
        } finally {
            this._initPromise = null;
        }
        return !!ready;
    },

    /**
     * Lightweight config refresh for APK app-resume events.
     * Skips the full re-init (permission checks, channel setup, listener binding).
     * Does one version check against the backend; reschedules only when the admin
     * has saved a new config since the last sync.  Throttled to once per 24 hours.
     */
    async refreshConfig() {
        if (!this._initialized) return false;
        if (!this._shouldSyncBackendConfig()) return false;
        const prevVersion = localStorage.getItem(this.LS_VERSION_KEY);
        await this._maybeSyncBackendConfig();
        localStorage.setItem(this.LS_LAST_REFRESH_KEY, String(Date.now()));
        const newVersion = localStorage.getItem(this.LS_VERSION_KEY);
        if (newVersion !== prevVersion) {
            console.log('[GameNotifier] Config updated (v' + newVersion + ') – rescheduling notifications.');
            await this.scheduleNotifications();
            return true;
        }
        return false;
    },

    async scheduleNotifications() {
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
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'CANCEL_GAME_NOTIFICATIONS' });
            }
        } catch (e) {
            console.warn('[GameNotifier] cancelAll SW message error:', e);
        }
    },

    isSilentAction(action) {
        return !!action && this.SILENT_ACTIONS.has(action);
    },

    /**
     * Unified handler for notification action buttons vs body taps.
     * Silent actions save in-place without opening the app.
     */
    handleNotificationAction(msg) {
        const notifType = (msg && (msg.notificationType || msg.type)) || '';
        const action = (msg && (msg.action || msg.actionId)) || '';
        const recordKey = this._normalizeRecordKey(msg && msg.recordKey);
        const result = { silent: false, saved: false, needsApp: false, ack: null, recordKey, notifType, action };

        if (action === 'skip') {
            this._recordNotificationChoice(recordKey, notifType, 'skip');
            result.silent = true;
            result.ack = 'skip';
            return result;
        }

        if (notifType === 'morning_check' && (action === 'sleep_yes' || action === 'sleep_no')) {
            result.saved = this._saveMorningAnswer(recordKey, action === 'sleep_yes');
            result.silent = true;
            result.ack = action;
            return result;
        }

        if (notifType === 'evening_check' && (action === 'water_yes' || action === 'water_no')) {
            result.saved = this._saveEveningWaterQuick(recordKey, action === 'water_yes');
            result.silent = true;
            result.ack = action;
            return result;
        }

        result.needsApp = true;
        return result;
    },

    showSilentAck(ackKey) {
        const patterns = {
            sleep_yes: [40, 30, 60],
            sleep_no:  [60, 30, 40],
            water_yes: [30, 20, 30],
            water_no:  [50, 30],
            skip:      [20]
        };
        try {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(patterns[ackKey] || [30]);
            }
        } catch (_) {}

        if (ackKey === 'skip') return;
        if (!this._capacitor) this._capacitor = this._detectCapacitor();
        if (!this._capacitor) return;
        const text = {
            sleep_yes: '✓ Добре!',
            sleep_no:  '✓ Записано',
            water_yes: '✓ Вода',
            water_no:  '✓ Записано'
        }[ackKey];
        if (!text) return;
        this._flashAckNotification(text).catch(() => {});
    },

    async _flashAckNotification(body) {
        const { LocalNotifications } = this._capacitor || {};
        if (!LocalNotifications || typeof LocalNotifications.schedule !== 'function') return;
        await LocalNotifications.schedule({
            notifications: [{
                id: this.ACK_NOTIFICATION_ID,
                channelId: this.CHANNEL_ID,
                title: '',
                body,
                silent: true,
                autoCancel: true,
                schedule: { at: new Date(Date.now() + 80), allowWhileIdle: false },
                iconColor: this.BRAND_TEAL
            }]
        });
    },

    async drainPendingSwActions() {
        if (typeof indexedDB === 'undefined') return 0;
        let db;
        try {
            db = await new Promise((resolve, reject) => {
                const req = indexedDB.open(this.PENDING_DB_NAME, 1);
                req.onupgradeneeded = () => {
                    if (!req.result.objectStoreNames.contains(this.PENDING_STORE)) {
                        req.result.createObjectStore(this.PENDING_STORE, { keyPath: 'id', autoIncrement: true });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (_) {
            return 0;
        }

        const pending = await new Promise((resolve, reject) => {
            const tx = db.transaction(this.PENDING_STORE, 'readonly');
            const req = tx.objectStore(this.PENDING_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
        if (!pending.length) return 0;

        let applied = 0;
        pending.forEach((item) => {
            const outcome = this.handleNotificationAction(item);
            if (outcome.saved || outcome.ack === 'skip') applied += 1;
        });

        await new Promise((resolve, reject) => {
            const tx = db.transaction(this.PENDING_STORE, 'readwrite');
            tx.objectStore(this.PENDING_STORE).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        return applied;
    },

    async applyConfig(cfg, localOnly = false) {
        const merged = Object.assign(this._getConfig(), cfg);
        localStorage.setItem(this.LS_CONFIG_KEY, JSON.stringify(merged));
        if (localOnly) localStorage.setItem(this.LS_LOCAL_KEY, '1');
        console.log('[GameNotifier] Config updated:', merged, localOnly ? '(local APK/PWA)' : '(backend/admin)');
        if (!this._initialized) {
            await this.init();
            return;
        }
        await this.cancelAll();
        await this.scheduleNotifications();
    },

    async scheduleTestGameQuestionNotification(delaySeconds = 10) {
        const safeDelaySeconds = Math.max(1, Number(delaySeconds) || 10);
        const fireAtTs = Date.now() + safeDelaySeconds * 1000;
        const recordKey = this._dateKeyForTimestamp(fireAtTs);
        const cfg = this._getConfig();
        const title = cfg.eveningTitle || 'Вечерна проверка';
        const body = cfg.eveningBody || 'Как мина денят ти?';
        const url = this._buildQuickAnswerUrl('evening_check', { date: recordKey });

        if (this._capacitor) {
            const { LocalNotifications } = this._capacitor;
            await LocalNotifications.schedule({
                notifications: [{
                    id: (fireAtTs % 1000000000) | 0,
                    channelId: this.CHANNEL_ID,
                    title,
                    body,
                    actionTypeId: this.EVENING_ACTION_TYPE_ID,
                    sound: this.NOTIFICATION_SOUND,
                    silent: true,
                    schedule: { at: new Date(fireAtTs), allowWhileIdle: true },
                    extra: { url, type: 'evening_check', recordKey },
                    iconColor: this.BRAND_TEAL_DARK
                }]
            });
            return { fireAtTs, mode: 'capacitor' };
        }

        if (this._swReg && navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SCHEDULE_GAME_NOTIFICATIONS',
                schedule: [{
                    ts: fireAtTs,
                    title,
                    body,
                    tag: 'gn-test-' + fireAtTs,
                    type: 'evening_check',
                    url,
                    recordKey,
                    vibrate: [200, 100, 200],
                    requireInteraction: false
                }]
            });
            return { fireAtTs, mode: 'sw' };
        }

        throw new Error('GameNotifier is not ready');
    },

    /* ------------------------------------------------------------------ */
    /*  Capacitor detection                                                 */
    /* ------------------------------------------------------------------ */

    _detectCapacitor() {
        if (typeof window === 'undefined') return null;
        try {
            // In the APK, plan.html is loaded in an iframe so window.Capacitor may be
            // undefined there. Mirror the getCap() fallback from platform.js: check
            // window.top.Capacitor as well (same-origin cross-frame access is allowed).
            const cap = window.Capacitor ||
                (window.top !== window && window.top && window.top.Capacitor) ||
                null;
            if (!cap) return null;
            const isNative = typeof cap.isNativePlatform === 'function'
                ? cap.isNativePlatform()
                : false;
            if (!isNative) return null;

            const plugins = cap.Plugins || {};
            let localNotifications = plugins.LocalNotifications || null;

            if (!localNotifications && typeof cap.registerPlugin === 'function') {
                localNotifications = cap.registerPlugin('LocalNotifications');
            }

            if (localNotifications) {
                return { LocalNotifications: localNotifications };
            }
        } catch (_) {}
        return null;
    },

    _isHuawei() {
        if (typeof navigator === 'undefined') return false;
        return /huawei/i.test(navigator.userAgent) || /harmony/i.test(navigator.userAgent);
    },

    async _requestCapacitorPermission() {
        try {
            const { LocalNotifications } = this._capacitor;
            const current = typeof LocalNotifications.checkPermissions === 'function'
                ? await LocalNotifications.checkPermissions()
                : {};
            const status = current.display === 'granted'
                ? current
                : await LocalNotifications.requestPermissions();
            if (status.display !== 'granted') return false;

            await this._ensureAndroidChannel();
            return true;
        } catch (e) {
            console.error('[GameNotifier] Capacitor permission error:', e);
            return false;
        }
    },

    async _ensureAndroidChannel() {
        try {
            const { LocalNotifications } = this._capacitor;
            if (typeof LocalNotifications.createChannel !== 'function') return;
            // Legacy channel kept for backward compatibility (existing installs)
            await LocalNotifications.createChannel({
                id: this.CHANNEL_ID,
                name: 'NutriPlan дневни проверки',
                description: 'Сутрешни и вечерни напомняния за проследяване на хранене, сън и настроение.',
                importance: 4,
                visibility: 1,
                sound: this.NOTIFICATION_SOUND,
                vibration: true,
                lights: true,
                lightColor: this.BRAND_TEAL
            });
            // Separate morning channel — uses system notification sound
            await LocalNotifications.createChannel({
                id: this.MORNING_CHANNEL_ID,
                name: 'NutriPlan — Сутрешна проверка',
                description: 'Сутрешно напомняне за сън и начало на деня.',
                importance: 4,
                visibility: 1,
                sound: this.NOTIFICATION_SOUND,
                vibration: true,
                lights: true,
                lightColor: this.BRAND_TEAL
            });
            // Separate evening channel — uses system notification sound
            await LocalNotifications.createChannel({
                id: this.EVENING_CHANNEL_ID,
                name: 'NutriPlan — Вечерна проверка',
                description: 'Вечерно напомняне за хидратация и края на деня.',
                importance: 4,
                visibility: 1,
                sound: this.NOTIFICATION_SOUND,
                vibration: true,
                lights: true,
                lightColor: this.BRAND_TEAL_DARK
            });
        } catch (e) {
            console.warn('[GameNotifier] Android channel setup warning:', e);
        }
    },

    async _registerCapacitorActionTypes() {
        try {
            const { LocalNotifications } = this._capacitor;
            if (typeof LocalNotifications.registerActionTypes !== 'function') return;
            await LocalNotifications.registerActionTypes({
                types: [
                    {
                        id: this.MORNING_ACTION_TYPE_ID,
                        actions: [
                            { id: 'sleep_yes', title: 'Да', foreground: false },
                            { id: 'sleep_no', title: 'Не', foreground: false },
                            { id: 'skip', title: 'Пропуск', foreground: false }
                        ]
                    },
                    {
                        id: this.EVENING_ACTION_TYPE_ID,
                        actions: [
                            { id: 'water_no',  title: 'Не', foreground: false },
                            { id: 'water_yes', title: 'Да', foreground: false },
                            { id: 'skip',      title: 'Пропуск', foreground: false }
                        ]
                    }
                ]
            });
        } catch (e) {
            console.warn('[GameNotifier] Action type registration warning:', e);
        }
    },

    _bindCapacitorListeners() {
        if (!this._capacitor || this._listenersBound) return;
        try {
            if (window.top && window.top !== window) return;
        } catch (_) {}
        const { LocalNotifications } = this._capacitor;
        LocalNotifications.addListener('localNotificationReceived', (notification) => {
            this._handleForegroundNotification(notification);
        });
        LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
            this._handleCapacitorNotificationAction(action);
        });
        this._listenersBound = true;
    },

    _handleCapacitorNotificationAction(action) {
        const notification = action && action.notification ? action.notification : {};
        const extra = notification.extra || {};
        const type = extra.type || '';
        const recordKey = this._normalizeRecordKey(extra.recordKey);
        const actionId = action && typeof action.actionId === 'string' ? action.actionId : '';

        const outcome = this.handleNotificationAction({
            notificationType: type,
            action: actionId,
            recordKey
        });

        if (outcome.silent) {
            if (outcome.ack) this.showSilentAck(outcome.ack);
            return;
        }

        if (type === 'morning_check') {
            if (typeof window._gameShowMorning === 'function') {
                window._gameShowMorning(true, recordKey);
                return;
            }
            if (extra.url) window.location.href = extra.url;
            return;
        }

        if (type === 'evening_check') {
            if (typeof window._gameShowEvening === 'function') {
                window._gameShowEvening(true, recordKey);
                return;
            }
            if (extra.url) window.location.href = extra.url;
            return;
        }

        if (extra.url) window.location.href = extra.url;
    },


    _handleForegroundNotification(notification) {
        const extra = (notification && notification.extra) || {};
        const type = extra.type || '';
        if (type !== 'morning_check' && type !== 'evening_check') return;

        // Foreground UX stays inside the already-open app/chat flow.
        // Do not show a second custom dialog; just remove a delivered native
        // notification if the platform rendered one while the app was active.
        const id = notification && notification.id;
        const { LocalNotifications } = this._capacitor || {};
        try {
            if (LocalNotifications && typeof LocalNotifications.removeDeliveredNotifications === 'function' && typeof id === 'number') {
                LocalNotifications.removeDeliveredNotifications({ notifications: [{ id }] });
            }
        } catch (_) {}
    },

    _recordNotificationChoice(recordKey, type, choice) {
        try {
            const key = this._normalizeRecordKey(recordKey);
            const log = JSON.parse(localStorage.getItem('notificationResponses') || '[]');
            log.push({ date: key, type, choice, ts: new Date().toISOString() });
            localStorage.setItem('notificationResponses', JSON.stringify(log.slice(-200)));
            return true;
        } catch (_) {
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
            morningTitle: this.COPY.morning.title,
            morningBody:  this.COPY.morning.body,
            eveningTitle: this.COPY.evening.title,
            eveningBody:  this.COPY.evening.body,
            extraNotifications: [],
        };
        try {
            const stored = localStorage.getItem(this.LS_CONFIG_KEY);
            const merged = stored ? Object.assign({}, defaults, JSON.parse(stored)) : defaults;
            if (!Array.isArray(merged.extraNotifications)) merged.extraNotifications = [];
            return merged;
        } catch (e) {
            return defaults;
        }
    },

    _hasLocalConfig() {
        return localStorage.getItem(this.LS_LOCAL_KEY) === '1';
    },

    _shouldSyncBackendConfig() {
        if (this._hasLocalConfig()) return false;
        if (!localStorage.getItem(this.LS_CONFIG_KEY)) return true;
        const MIN_SYNC_MS = 24 * 60 * 60 * 1000;
        const last = parseInt(localStorage.getItem(this.LS_LAST_REFRESH_KEY) || '0', 10);
        return Date.now() - last >= MIN_SYNC_MS;
    },

    /* ------------------------------------------------------------------ */
    /*  Backend config sync (only when admin changes config)               */
    /* ------------------------------------------------------------------ */

    async _maybeSyncBackendConfig() {
        // Version-based ETag check: send the locally cached version as ?v=N.
        // When the server version matches, the Worker returns { upToDate: true }
        // (a single KV read, ~50 bytes) without transmitting the full config blob.
        // Only when the admin has saved a new config (bumping the server version)
        // does the Worker return the full payload, which the client then stores and
        // uses to reschedule notifications.
        //
        // Cost guard: callers use _shouldSyncBackendConfig(), so normal users do
        // at most one backend check per 24h; local APK/PWA configs do zero checks.
        // Admin/manual force sync bypasses this by clearing the local version.
        const WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
        try {
            const localVersion = parseInt(localStorage.getItem(this.LS_VERSION_KEY) || '0', 10);
            const res = await fetch(`${WORKER_URL}/api/notification-config?v=${localVersion}`, { method: 'GET' });
            if (!res.ok) return;
            const data = await res.json();
            // Server says our cached version is still current — nothing to do.
            if (data.upToDate) return;
            if (!data.config) return;
            const serverVersion = data.version || 0;
            if (serverVersion > localVersion) {
                localStorage.setItem(this.LS_CONFIG_KEY, JSON.stringify(data.config));
                localStorage.setItem(this.LS_VERSION_KEY, String(serverVersion));
                console.log('[GameNotifier] Config updated from backend (version', serverVersion, ').');
            }
        } catch (_) { /* offline / endpoint not deployed yet */ }
    },

    /**
     * Force an immediate config sync regardless of the cached version.
     * Called by the admin panel after a config change is saved.
     */
    async forceSyncBackendConfig() {
        // Temporarily clear the local version so the server always returns full config.
        const saved = localStorage.getItem(this.LS_VERSION_KEY);
        localStorage.removeItem(this.LS_VERSION_KEY);
        await this._maybeSyncBackendConfig();
        // Restore if sync failed (offline) so we don't lose the cached version.
        if (!localStorage.getItem(this.LS_VERSION_KEY) && saved !== null) {
            localStorage.setItem(this.LS_VERSION_KEY, saved);
        }
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

        for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
            const morningTs = this._tsForDayOffset(day, mH, mM);
            if (morningTs > Date.now()) {
                const recordKey = this._dateKeyForTimestamp(morningTs);
                notifications.push({
                    id: 1000 + day,
                    channelId: this.MORNING_CHANNEL_ID,
                    title: cfg.morningTitle,
                    body:  cfg.morningBody,
                    actionTypeId: this.MORNING_ACTION_TYPE_ID,
                    sound: this.NOTIFICATION_SOUND,
                    silent: true,
                    // allowWhileIdle uses setExactAndAllowWhileIdle() so Huawei's
                    // aggressive battery optimization (Doze mode) cannot kill the alarm.
                    schedule: { at: new Date(morningTs), allowWhileIdle: true },
                    extra: {
                        url: this._buildPlanActionUrl('morning_check', recordKey),
                        type: 'morning_check',
                        recordKey
                    },
                    iconColor: this.BRAND_TEAL
                });
            }
            const eveningTs = this._tsForDayOffset(day, eH, eM);
            if (eveningTs > Date.now()) {
                const recordKey = this._dateKeyForTimestamp(eveningTs);
                notifications.push({
                    id: 2000 + day,
                    channelId: this.EVENING_CHANNEL_ID,
                    title: cfg.eveningTitle,
                    body:  cfg.eveningBody,
                    actionTypeId: this.EVENING_ACTION_TYPE_ID,
                    sound: this.NOTIFICATION_SOUND,
                    silent: true,
                    schedule: { at: new Date(eveningTs), allowWhileIdle: true },
                    extra: {
                        url: this._buildPlanActionUrl('evening_check', recordKey),
                        type: 'evening_check',
                        recordKey
                    },
                    iconColor: this.BRAND_TEAL_DARK
                });
            }
        }

        // Extra custom notifications (admin-defined arbitrary slots)
        const extras = Array.isArray(cfg.extraNotifications) ? cfg.extraNotifications : [];
        extras.forEach((extra, idx) => {
            if (!extra || !extra.time) return;
            const [xH, xM] = String(extra.time).split(':').map(Number);
            if (isNaN(xH) || isNaN(xM)) return;
            for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
                const xTs = this._tsForDayOffset(day, xH, xM);
                if (xTs > Date.now()) {
                    notifications.push({
                        id: 3000 + idx * 100 + day,
                        channelId: this.CHANNEL_ID,
                        title: extra.title || 'NutriPlan',
                        body:  extra.body  || '',
                        schedule: { at: new Date(xTs), allowWhileIdle: true },
                        sound: this.NOTIFICATION_SOUND,
                        silent: true,
                        extra: { url: extra.url || '/plan.html', type: 'extra_' + idx },
                        iconColor: this.BRAND_TEAL
                    });
                }
            }
        });

        try {
            await LocalNotifications.schedule({ notifications });
            console.log('[GameNotifier] Capacitor: scheduled', notifications.length, 'notifications');
        } catch (e) {
            console.error('[GameNotifier] Capacitor schedule error:', e);
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

        for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
            const morning = this._tsForDayOffset(day, mH, mM);
            if (morning > now) {
                const recordKey = this._dateKeyForTimestamp(morning);
                schedule.push({
                    ts: morning,
                    title: cfg.morningTitle,
                    body:  cfg.morningBody,
                    tag:   `gn-morning-${morning}`,
                    type:  'morning_check',
                    url:   this._buildPlanActionUrl('morning_check', recordKey),
                    recordKey,
                    actions: this._swActionsForType('morning_check'),
                    vibrate: [300, 100, 300, 100, 300],
                    requireInteraction: true
                });
            }
            const evening = this._tsForDayOffset(day, eH, eM);
            if (evening > now) {
                const recordKey = this._dateKeyForTimestamp(evening);
                schedule.push({
                    ts: evening,
                    title: cfg.eveningTitle,
                    body:  cfg.eveningBody,
                    tag:   `gn-evening-${evening}`,
                    type:  'evening_check',
                    url:   this._buildPlanActionUrl('evening_check', recordKey),
                    recordKey,
                    actions: this._swActionsForType('evening_check'),
                    vibrate: [200, 100, 200, 100, 200],
                    requireInteraction: false
                });
            }
        }

        // Extra custom notifications (admin-defined arbitrary slots)
        const extras = Array.isArray(cfg.extraNotifications) ? cfg.extraNotifications : [];
        extras.forEach((extra, idx) => {
            if (!extra || !extra.time) return;
            const [xH, xM] = String(extra.time).split(':').map(Number);
            if (isNaN(xH) || isNaN(xM)) return;
            for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
                const xTs = this._tsForDayOffset(day, xH, xM);
                if (xTs > now) {
                    schedule.push({
                        ts: xTs,
                        title: extra.title || 'NutriPlan',
                        body:  extra.body  || '',
                        tag:   `gn-extra-${idx}-${xTs}`,
                        type:  'extra_' + idx,
                        url:   extra.url || '/plan.html',
                        vibrate: [200, 100, 200],
                        requireInteraction: false
                    });
                }
            }
        });

        navigator.serviceWorker.controller.postMessage({
            type: 'SCHEDULE_GAME_NOTIFICATIONS',
            schedule
        });
        console.log('[GameNotifier] Sent', schedule.length, 'items to SW for scheduling');
    },

    /* ------------------------------------------------------------------ */
    /*  Immediate notification helper (for test pages)                      */
    /* ------------------------------------------------------------------ */

    async _showImmediateNotification(type) {
        const cfg = this._getConfig();
        let title, body, url;
        let actionTypeId;
        let recordKey = this._dateKeyForTimestamp(Date.now());
        if (type === 'morning_check') {
            title = cfg.morningTitle;
            body  = cfg.morningBody;
            url   = this._buildQuickAnswerUrl('morning_check', { date: recordKey });
            actionTypeId = this.MORNING_ACTION_TYPE_ID;
        } else if (type === 'evening_check') {
            title = cfg.eveningTitle;
            body  = cfg.eveningBody;
            url   = this._buildQuickAnswerUrl('evening_check', { date: recordKey });
            actionTypeId = this.EVENING_ACTION_TYPE_ID;
        } else {
            title = 'NutriPlan тест';
            body  = 'Тестово известие от GameNotifier.';
            url   = '/plan.html';
        }

        if (this._capacitor) {
            const { LocalNotifications } = this._capacitor;
            await LocalNotifications.schedule({ notifications: [{
                id: 9999,
                channelId: this.CHANNEL_ID,
                title,
                body,
                actionTypeId,
                sound: this.NOTIFICATION_SOUND,
                silent: true,
                schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
                extra: { url, type, recordKey },
                iconColor: this.BRAND_TEAL
            }]});
            return;
        }

        // Web / PWA path
        if (this._swReg) {
            await this._swReg.showNotification(title, {
                body,
                icon: '/icon-192x192.png',
                badge: '/icon-192x192.png',
                tag: 'gn-immediate-' + Date.now(),
                data: { url, type, recordKey },
                actions: type === 'morning_check'
                    ? this._swActionsForType('morning_check')
                    : type === 'evening_check'
                        ? this._swActionsForType('evening_check')
                        : undefined
            });
        }
    },

    /* ------------------------------------------------------------------ */
    /*  Helper                                                              */
    /* ------------------------------------------------------------------ */

    _tsForDayOffset(dayOffset, hours, minutes) {
        const d = new Date();
        d.setDate(d.getDate() + dayOffset);
        d.setHours(hours, minutes, 0, 0);
        return d.getTime();
    },

    _normalizeRecordKey(recordKey) {
        if (typeof recordKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(recordKey)) return recordKey;
        return this._dateKeyForTimestamp(Date.now());
    },

    _dateKeyForTimestamp(ts) {
        const d = new Date(ts);
        const pad = (n) => n < 10 ? '0' + n : '' + n;
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    _swActionsForType(type) {
        const copy = type === 'morning_check' ? this.COPY.morning : this.COPY.evening;
        return (copy.actions || []).map((item) => ({
            action: item.id,
            title: item.title
        }));
    },

    _saveMorningAnswer(recordKey, sleptWell) {
        const gm = typeof window !== 'undefined' && window.gameModule;
        if (gm && typeof gm.getRecord === 'function' && typeof gm.saveRecord === 'function') {
            try {
                const rec = gm.getRecord(recordKey);
                if (rec.morningCheck) return false;
                rec.morningCheck = { sleptWell: !!sleptWell, ts: new Date().toISOString() };
                gm.saveRecord(recordKey, rec);
                if (typeof gm.recalcAndShowScore === 'function') gm.recalcAndShowScore(recordKey);
                return true;
            } catch (_) { /* fall through */ }
        }
        return this._saveQuickAnswer(recordKey, 'morning_check', { sleptWell: !!sleptWell });
    },

    _saveEveningWaterQuick(recordKey, waterIntake) {
        const gm = typeof window !== 'undefined' && window.gameModule;
        if (gm && typeof gm.getRecord === 'function' && typeof gm.saveRecord === 'function') {
            try {
                const rec = gm.getRecord(recordKey);
                if (rec.eveningCheck) return false;
                rec.eveningCheck = {
                    activityLevel: 2,
                    emotionalBalance: 2,
                    waterIntake: !!waterIntake,
                    ts: new Date().toISOString()
                };
                gm.saveRecord(recordKey, rec);
                if (typeof gm.recalcAndShowScore === 'function') gm.recalcAndShowScore(recordKey);
                return true;
            } catch (_) { /* fall through */ }
        }
        return this._saveQuickAnswer(recordKey, 'evening_check', {
            activityLevel: 2,
            emotionalBalance: 2,
            waterIntake: !!waterIntake
        });
    },

    _emptyGameRecord(key) {
        return {
            date: key,
            meals: {},
            extraMeals: [],
            freeMealRatings: {},
            morningCheck: null,
            eveningCheck: null,
            plannedCalories: null,
            mealCalories: {},
            dailyScore: null,
            missing: false
        };
    },

    _saveQuickAnswer(recordKey, type, payload) {
        try {
            const key = this._normalizeRecordKey(recordKey);
            const allData = JSON.parse(localStorage.getItem('gameData') || '{}') || {};
            const record = allData[key] || this._emptyGameRecord(key);
            if (type === 'morning_check') {
                if (record.morningCheck) return false;
                record.morningCheck = {
                    sleptWell: !!(payload && payload.sleptWell),
                    ts: new Date().toISOString()
                };
            } else if (type === 'evening_check' && payload) {
                if (record.eveningCheck) return false;
                record.eveningCheck = {
                    activityLevel: payload.activityLevel,
                    emotionalBalance: payload.emotionalBalance,
                    waterIntake: !!payload.waterIntake,
                    ts: new Date().toISOString()
                };
            } else {
                return false;
            }
            allData[key] = record;
            localStorage.setItem('gameData', JSON.stringify(allData));
            return true;
        } catch (e) {
            console.warn('[GameNotifier] Quick answer save failed:', e);
            return false;
        }
    },

    _buildPlanActionUrl(type, recordKey) {
        const key = this._normalizeRecordKey(recordKey);
        return `/plan.html?action=${encodeURIComponent(type)}&date=${encodeURIComponent(key)}`;
    },

    _buildQuickAnswerUrl(type, params) {
        const search = new URLSearchParams();
        search.set('type', type);
        Object.keys(params || {}).forEach((key) => {
            const value = params[key];
            if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
        });
        return this.QUICK_ANSWER_PATH + '?' + search.toString();
    }
};

if (typeof window !== 'undefined') {
    window.GameNotifier = GameNotifier;
}
