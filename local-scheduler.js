/**
 * GameNotifier – система за локални нотификации.
 *
 * Поддържа три слоя за изпращане (в ред на предпочитание):
 *   1. Capacitor LocalNotifications (APK / нативен Android)  ✅ най-надежден
 *   2. Calendar feed fallback (Huawei/без Google services) ✅ системен календар
 *   3. SW postMessage → SW sets a timeout (PWA fallback – работи само докато браузърът е жив)  ⚠️
 *
 * Нотификации:
 *   morning_check       – сутрешна проверка (по подразбиране 07:00)
 *   evening_activity    – вечер: активност (по подразбиране 20:00)
 *   evening_balance     – вечер: емоционален баланс (20:05)
 *   evening_water       – вечер: вода (20:10)
 *
 * Backend config sync:
 *   – При всяко отваряне: 1 лека GET ?v=N (~50 bytes ако няма промяна).
 *   – Пълен config + препланиране САМО при нова server version.
 *   – Локален APK/PWA график от *notifyme не прави backend заявки.
 */

const GameNotifier = {

    // Keep a rolling monthly buffer so OEM battery restrictions or missed app opens
    // do not leave users without reminders after the first week.
    SCHEDULE_WINDOW_DAYS: 30,
    LS_CONFIG_KEY:        'gameNotifierConfig',
    LS_LOCAL_KEY:         'gameNotifierLocalConfig',
    LS_VERSION_KEY:       'gameNotifierConfigVersion',
    LS_SCHEDULED_VERSION_KEY: 'gameNotifierScheduledVersion',
    CALENDAR_URL:   'https://aidiet.radilov-k.workers.dev/api/calendar.ics',
    CHANNEL_ID:     'nutriplan_daily_checkins',
    MORNING_CHANNEL_ID: 'nutriplan_morning',
    EVENING_CHANNEL_ID: 'nutriplan_evening',
    NOTIFICATION_SOUND: 'nutriplan_checkin.wav',
    BRAND_TEAL:     '#009A9E',
    BRAND_TEAL_DARK: '#0F766E',
    QUICK_ANSWER_PATH: '/quick-answer.html',
    MORNING_ACTION_TYPE_ID: 'nutriplan_morning_check',
    EVENING_ACTIVITY_ACTION_TYPE_ID: 'nutriplan_evening_activity',
    EVENING_BALANCE_ACTION_TYPE_ID:  'nutriplan_evening_balance',
    EVENING_WATER_ACTION_TYPE_ID:    'nutriplan_evening_water',
    ACK_NOTIFICATION_ID:  9997,
    PENDING_DB_NAME:        'nutriplan-game-pending',
    PENDING_STORE:          'actions',

    // Same wording as the in-app AI assistant bubbles (plan.html showBubble).
    COPY: {
        morning: {
            title: 'AI Асистент',
            body:  'Спахте ли добре тази нощ?',
            actions: [
                { id: 'sleep_yes', title: 'Да', value: true },
                { id: 'sleep_no',  title: 'Не', value: false },
                { id: 'skip',      title: 'Пропуск', value: null }
            ]
        },
        eveningActivity: {
            title: 'AI Асистент',
            body:  'Ниво на активност?',
            actions: [
                { id: 'activity_1', title: 'Ниска', value: 1 },
                { id: 'activity_2', title: 'Умерена', value: 2 },
                { id: 'activity_3', title: 'Висока', value: 3 }
            ]
        },
        eveningBalance: {
            title: 'AI Асистент',
            body:  'Емоционален баланс?',
            actions: [
                { id: 'balance_1', title: 'Напрегнат', value: 1 },
                { id: 'balance_2', title: 'Спокоен', value: 2 },
                { id: 'balance_3', title: 'Позитивен', value: 3 }
            ]
        },
        eveningWater: {
            title: 'AI Асистент',
            body:  'Изпихте ли поне 2 л вода?',
            actions: [
                { id: 'water_no',  title: 'Не', value: false },
                { id: 'water_yes', title: 'Да', value: true },
                { id: 'skip',      title: 'Пропуск', value: null }
            ]
        }
    },

    EVENING_SLOT_DEFS: [
        { type: 'evening_activity', copyKey: 'eveningActivity', actionsKey: 'eveningActivityActions', actionTypeKey: 'EVENING_ACTIVITY_ACTION_TYPE_ID', idBase: 2000, defaultOffsetMin: 0, saveKind: 'activityLevel' },
        { type: 'evening_balance',  copyKey: 'eveningBalance',  actionsKey: 'eveningBalanceActions',  actionTypeKey: 'EVENING_BALANCE_ACTION_TYPE_ID',  idBase: 2200, defaultOffsetMin: 5, saveKind: 'emotionalBalance' },
        { type: 'evening_water',    copyKey: 'eveningWater',    actionsKey: 'eveningWaterActions',    actionTypeKey: 'EVENING_WATER_ACTION_TYPE_ID',    idBase: 2400, defaultOffsetMin: 10, saveKind: 'waterIntake' }
    ],

    MORNING_META: {
        type: 'morning_check',
        timeKey: 'morningTime',
        titleKey: 'morningTitle',
        bodyKey: 'morningBody',
        actionsKey: 'morningActions',
        copyKey: 'morning',
        actionTypeKey: 'MORNING_ACTION_TYPE_ID',
        idBase: 1000,
        saveKind: 'morning'
    },

    MAX_NOTIFICATION_ACTIONS: 3,

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

            // Cheap version check on every open; full config + reschedule only when version changes.
            let configChanged = false;
            if (!this._hasLocalConfig()) {
                configChanged = await this._maybeSyncBackendConfig();
            }

            const currentVersion = localStorage.getItem(this.LS_VERSION_KEY) || '0';
            const scheduledVersion = localStorage.getItem(this.LS_SCHEDULED_VERSION_KEY) || '';
            const needsSchedule = configChanged || scheduledVersion !== String(currentVersion);

            if (needsSchedule) {
                if (this._capacitor) await this._registerCapacitorActionTypes();
                await this.scheduleNotifications();
                localStorage.setItem(this.LS_SCHEDULED_VERSION_KEY, String(currentVersion));
            }

            this._initialized = true;
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
     * One version check per resume; reschedules only when admin saved a new config.
     */
    async refreshConfig() {
        if (!this._initialized || this._hasLocalConfig()) return false;
        const prevVersion = localStorage.getItem(this.LS_VERSION_KEY) || '0';
        const configChanged = await this._maybeSyncBackendConfig();
        const newVersion = localStorage.getItem(this.LS_VERSION_KEY) || '0';
        if (configChanged || newVersion !== prevVersion) {
            console.log('[GameNotifier] Config updated (v' + newVersion + ') – rescheduling notifications.');
            if (this._capacitor) await this._registerCapacitorActionTypes();
            await this.scheduleNotifications();
            localStorage.setItem(this.LS_SCHEDULED_VERSION_KEY, String(newVersion));
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

    cancelTodaysNotification(notifType, recordKey) {
        this._cancelNotificationForDay(notifType, recordKey);
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

    questionBody(type) {
        const cfg = this._getConfig();
        if (type === 'morning_check') return cfg.morningBody || this.COPY.morning.body;
        const meta = this._slotMetaByType(type);
        if (!meta) return '';
        const prefix = meta.type.replace('evening_', '');
        const bodyKey = 'evening' + prefix.charAt(0).toUpperCase() + prefix.slice(1) + 'Body';
        return cfg[bodyKey] || (this.COPY[meta.copyKey] && this.COPY[meta.copyKey].body) || '';
    },

    bubbleAnswersForType(type) {
        const cfg = this._getConfig();
        const meta = this._slotMetaByType(type);
        if (!meta) return null;
        const actions = this._actionsFromConfig(cfg, meta).filter((a) => a.id !== 'skip');
        if (!actions.length) return null;
        const starI = '<i class="fas fa-star" style="color:#fbbf24;font-size:0.9em"></i>';
        const isStars = type === 'evening_activity' || type === 'evening_balance';
        return actions.map((a) => {
            if (isStars) {
                const v = Number(a.value) || 1;
                let icons = starI;
                if (v >= 2) icons += starI;
                if (v >= 3) icons += starI;
                return { label: a.title, icons, value: v, stars: true };
            }
            const val = a.value;
            const isYes = val === true;
            return {
                label: a.title,
                icon: isYes
                    ? '<i class="fas fa-check" style="color:#10b981"></i>'
                    : '<i class="fas fa-xmark" style="color:#ef4444"></i>',
                value: val,
                cls: isYes ? 'yes' : 'no'
            };
        });
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
        const cfg = this._getConfig();
        const meta = this._slotMetaByType(notifType);

        if (action && meta) {
            const actions = this._actionsFromConfig(cfg, meta);
            const hit = actions.find((a) => a.id === action);
            if (hit) {
                if (action === 'skip' || hit.value === null) {
                    this._recordNotificationChoice(recordKey, notifType, 'skip');
                    this._cancelNotificationForDay(notifType, recordKey);
                    result.silent = true;
                    result.ack = 'skip';
                    return result;
                }
                const value = this._actionValueForSave(meta, action, cfg);
                if (meta.type === 'morning_check') {
                    result.saved = this._saveMorningAnswer(recordKey, value);
                } else {
                    result.saved = this._saveEveningField(recordKey, meta.saveKind, value);
                }
                if (result.saved) this._cancelNotificationForDay(notifType, recordKey);
                result.silent = true;
                result.ack = action;
                return result;
            }
        }

        if (this._isEveningNotificationType(notifType)) {
            result.needsApp = true;
            result.eveningStep = notifType.replace('evening_', '');
            return result;
        }

        if (notifType === 'evening_check') {
            result.needsApp = true;
            return result;
        }

        if (notifType === 'morning_check') {
            result.needsApp = true;
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
            water_no:  '✓ Записано',
            skip:      null
        }[ackKey] || '✓ Записано';
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
        if (this._capacitor) await this._registerCapacitorActionTypes();
        await this.scheduleNotifications();
        if (localOnly) {
            localStorage.setItem(this.LS_SCHEDULED_VERSION_KEY, 'local-' + Date.now());
        } else {
            localStorage.setItem(this.LS_SCHEDULED_VERSION_KEY, localStorage.getItem(this.LS_VERSION_KEY) || '0');
        }
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
            const cfg = this._getConfig();
            const types = [
                {
                    id: this.MORNING_ACTION_TYPE_ID,
                    actions: this._actionsFromConfig(cfg, this.MORNING_META).map((item) => ({
                        id: item.id, title: item.title, foreground: false
                    }))
                }
            ];
            this.EVENING_SLOT_DEFS.forEach((def) => {
                types.push({
                    id: this[def.actionTypeKey],
                    actions: this._actionsFromConfig(cfg, def).map((item) => ({
                        id: item.id, title: item.title, foreground: false
                    }))
                });
            });
            await LocalNotifications.registerActionTypes({ types });
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

        if (this._isEveningNotificationType(type)) {
            const step = type.replace('evening_', '');
            if (typeof window._gameShowEveningStep === 'function') {
                window._gameShowEveningStep(step, recordKey);
                return;
            }
            if (typeof window._gameShowEvening === 'function') {
                window._gameShowEvening(true, recordKey);
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
        if (type !== 'morning_check' && !this._isEveningNotificationType(type) && type !== 'evening_check') return;

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

    _getConfigDefaults() {
        return {
            morningTime:  '07:00',
            morningTitle: this.COPY.morning.title,
            morningBody:  this.COPY.morning.body,
            morningActions: this._defaultActionsFor('morningActions'),
            eveningActivityTime:  '20:00',
            eveningActivityTitle: this.COPY.eveningActivity.title,
            eveningActivityBody:  this.COPY.eveningActivity.body,
            eveningActivityActions: this._defaultActionsFor('eveningActivityActions'),
            eveningBalanceTime:   '20:05',
            eveningBalanceTitle:  this.COPY.eveningBalance.title,
            eveningBalanceBody:   this.COPY.eveningBalance.body,
            eveningBalanceActions: this._defaultActionsFor('eveningBalanceActions'),
            eveningWaterTime:     '20:10',
            eveningWaterTitle:    this.COPY.eveningWater.title,
            eveningWaterBody:     this.COPY.eveningWater.body,
            eveningWaterActions:  this._defaultActionsFor('eveningWaterActions'),
            extraNotifications: [],
        };
    },

    _defaultActionsFor(key) {
        const map = {
            morningActions: this.COPY.morning.actions,
            eveningActivityActions: this.COPY.eveningActivity.actions,
            eveningBalanceActions: this.COPY.eveningBalance.actions,
            eveningWaterActions: this.COPY.eveningWater.actions
        };
        return (map[key] || []).map((a) => Object.assign({}, a));
    },

    _normalizeActionList(raw, fallback, max) {
        max = max || this.MAX_NOTIFICATION_ACTIONS;
        const src = Array.isArray(raw) && raw.length ? raw : fallback;
        const out = [];
        const seen = new Set();
        for (let i = 0; i < src.length; i++) {
            const item = src[i];
            if (!item || typeof item !== 'object') continue;
            const id = String(item.id || '').trim();
            const title = String(item.title || '').trim();
            if (!id || !title || seen.has(id)) continue;
            seen.add(id);
            const row = { id, title };
            if (item.value !== undefined) row.value = item.value;
            out.push(row);
            if (out.length >= max) break;
        }
        return out.length ? out : fallback.map((a) => Object.assign({}, a));
    },

    _slotMetaByType(type) {
        if (type === 'morning_check') return this.MORNING_META;
        if (type === 'evening_check') return this.EVENING_SLOT_DEFS.find((s) => s.type === 'evening_water') || null;
        return this.EVENING_SLOT_DEFS.find((s) => s.type === type) || null;
    },

    _actionsFromConfig(config, meta) {
        if (!meta) return [];
        const fb = this._defaultActionsFor(meta.actionsKey);
        return this._normalizeActionList(config[meta.actionsKey], fb);
    },

    _actionValueForSave(meta, actionId, config) {
        const hit = this._actionsFromConfig(config, meta).find((a) => a.id === actionId);
        return hit ? hit.value : undefined;
    },

    _getGameRecord(recordKey) {
        const key = this._normalizeRecordKey(recordKey);
        const gm = typeof window !== 'undefined' && window.gameModule;
        if (gm && typeof gm.getRecord === 'function') {
            try { return gm.getRecord(key); } catch (_) {}
        }
        try {
            const allData = JSON.parse(localStorage.getItem('gameData') || '{}') || {};
            return allData[key] || null;
        } catch (_) {
            return null;
        }
    },

    _isQuestionAnswered(recordKey, notifType) {
        try {
            const log = JSON.parse(localStorage.getItem('notificationResponses') || '[]');
            if (log.some((e) => e.date === recordKey && e.type === notifType)) return true;
        } catch (_) {}
        const meta = this._slotMetaByType(notifType);
        if (!meta) return false;
        const rec = this._getGameRecord(recordKey);
        if (!rec) return false;
        if (meta.type === 'morning_check') return rec.morningCheck != null;
        if (!rec.eveningCheck) return false;
        return rec.eveningCheck[meta.saveKind] != null;
    },

    _notificationIdForDay(notifType, dayOffset) {
        if (notifType === 'morning_check') return this.MORNING_META.idBase + dayOffset;
        const def = this.EVENING_SLOT_DEFS.find((s) => s.type === notifType);
        return def ? def.idBase + dayOffset : null;
    },

    _cancelNotificationForDay(notifType, recordKey) {
        const todayKey = this._dateKeyForTimestamp(Date.now());
        if (recordKey !== todayKey) return;
        const id = this._notificationIdForDay(notifType, 0);
        if (id == null) return;

        if (this._capacitor) {
            try {
                const { LocalNotifications } = this._capacitor;
                LocalNotifications.cancel({ notifications: [{ id }] });
            } catch (_) {}
            return;
        }
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'CANCEL_GAME_NOTIFICATION',
                    notifType,
                    recordKey
                });
            }
        } catch (_) {}
    },

    normalizeConfig(raw) {
        const defaults = this._getConfigDefaults();
        const merged = Object.assign({}, defaults, raw || {});
        if (!Array.isArray(merged.extraNotifications)) merged.extraNotifications = [];

        const legacyTime = merged.eveningTime || '20:00';
        if (!raw || (!raw.eveningActivityTime && legacyTime)) {
            merged.eveningActivityTime = merged.eveningActivityTime || legacyTime;
            merged.eveningBalanceTime = merged.eveningBalanceTime || this._offsetTimeString(legacyTime, 5);
            merged.eveningWaterTime = merged.eveningWaterTime || this._offsetTimeString(legacyTime, 10);
        }
        if (merged.eveningTitle && !merged.eveningActivityTitle) {
            merged.eveningActivityTitle = merged.eveningTitle;
            merged.eveningBalanceTitle = merged.eveningTitle;
            merged.eveningWaterTitle = merged.eveningTitle;
        }
        if (merged.eveningBody && !merged.eveningActivityBody) {
            merged.eveningActivityBody = this.COPY.eveningActivity.body;
            merged.eveningBalanceBody = this.COPY.eveningBalance.body;
            merged.eveningWaterBody = this.COPY.eveningWater.body;
        }
        merged.morningActions = this._normalizeActionList(merged.morningActions, this._defaultActionsFor('morningActions'));
        merged.eveningActivityActions = this._normalizeActionList(merged.eveningActivityActions, this._defaultActionsFor('eveningActivityActions'));
        merged.eveningBalanceActions = this._normalizeActionList(merged.eveningBalanceActions, this._defaultActionsFor('eveningBalanceActions'));
        merged.eveningWaterActions = this._normalizeActionList(merged.eveningWaterActions, this._defaultActionsFor('eveningWaterActions'));
        return merged;
    },

    _getConfig() {
        try {
            const stored = localStorage.getItem(this.LS_CONFIG_KEY);
            const parsed = stored ? JSON.parse(stored) : {};
            return this.normalizeConfig(parsed);
        } catch (e) {
            return this.normalizeConfig({});
        }
    },

    _offsetTimeString(timeStr, addMinutes) {
        const parts = String(timeStr || '20:00').split(':').map(Number);
        const d = new Date(2000, 0, 1, parts[0] || 20, parts[1] || 0, 0, 0);
        d.setMinutes(d.getMinutes() + addMinutes);
        const pad = (n) => (n < 10 ? '0' + n : '' + n);
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
    },

    _isEveningNotificationType(type) {
        return type === 'evening_activity' || type === 'evening_balance' || type === 'evening_water';
    },

    _getEveningSlots(cfg) {
        const normalized = this.normalizeConfig(cfg);
        return this.EVENING_SLOT_DEFS.map((def) => {
            const prefix = def.type.replace('evening_', '');
            const timeKey = 'evening' + prefix.charAt(0).toUpperCase() + prefix.slice(1) + 'Time';
            const titleKey = timeKey.replace('Time', 'Title');
            const bodyKey = timeKey.replace('Time', 'Body');
            const copy = this.COPY[def.copyKey] || {};
            return {
                type: def.type,
                time: normalized[timeKey] || this._offsetTimeString('20:00', def.defaultOffsetMin),
                title: normalized[titleKey] || copy.title || 'AI Асистент',
                body: normalized[bodyKey] || copy.body || '',
                actions: this._actionsFromConfig(normalized, def),
                actionTypeId: this[def.actionTypeKey],
                idBase: def.idBase,
                copyKey: def.copyKey,
                saveKind: def.saveKind
            };
        });
    },

    _hasLocalConfig() {
        return localStorage.getItem(this.LS_LOCAL_KEY) === '1';
    },

    /* ------------------------------------------------------------------ */
    /*  Backend config sync (only when admin changes config)               */
    /* ------------------------------------------------------------------ */

    async _maybeSyncBackendConfig() {
        // Version-based check: send cached version as ?v=N (~50 bytes when up-to-date).
        const WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
        try {
            const localVersion = parseInt(localStorage.getItem(this.LS_VERSION_KEY) || '0', 10);
            const res = await fetch(`${WORKER_URL}/api/notification-config?v=${localVersion}`, { method: 'GET' });
            if (!res.ok) return false;
            const data = await res.json();
            if (data.upToDate) return false;
            if (!data.config) return false;
            const serverVersion = data.version || 0;
            if (serverVersion > localVersion) {
                localStorage.setItem(this.LS_CONFIG_KEY, JSON.stringify(data.config));
                localStorage.setItem(this.LS_VERSION_KEY, String(serverVersion));
                console.log('[GameNotifier] Config updated from backend (version', serverVersion, ').');
                return true;
            }
        } catch (_) { /* offline */ }
        return false;
    },

    /**
     * Force an immediate config sync regardless of the cached version.
     * Called by the admin panel after a config change is saved.
     */
    async forceSyncBackendConfig() {
        const saved = localStorage.getItem(this.LS_VERSION_KEY);
        localStorage.removeItem(this.LS_VERSION_KEY);
        const changed = await this._maybeSyncBackendConfig();
        if (!localStorage.getItem(this.LS_VERSION_KEY) && saved !== null) {
            localStorage.setItem(this.LS_VERSION_KEY, saved);
        }
        return changed;
    },

    /* ------------------------------------------------------------------ */
    /*  Capacitor LocalNotifications – APK path                            */
    /* ------------------------------------------------------------------ */

    async _scheduleWithCapacitor(cfg) {
        console.log('[GameNotifier] Using Capacitor LocalNotifications');
        const { LocalNotifications } = this._capacitor;
        await this.cancelAll();

        const cfgNorm = this.normalizeConfig(cfg);
        const [mH, mM] = cfgNorm.morningTime.split(':').map(Number);
        const notifications = [];

        for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
            const morningTs = this._tsForDayOffset(day, mH, mM);
            if (morningTs > Date.now()) {
                const recordKey = this._dateKeyForTimestamp(morningTs);
                if (this._isQuestionAnswered(recordKey, 'morning_check')) continue;
                notifications.push({
                    id: 1000 + day,
                    channelId: this.MORNING_CHANNEL_ID,
                    title: cfgNorm.morningTitle,
                    body:  cfgNorm.morningBody,
                    actionTypeId: this.MORNING_ACTION_TYPE_ID,
                    sound: this.NOTIFICATION_SOUND,
                    schedule: { at: new Date(morningTs), allowWhileIdle: true },
                    extra: {
                        url: this._buildPlanActionUrl('morning_check', recordKey),
                        type: 'morning_check',
                        recordKey
                    },
                    iconColor: this.BRAND_TEAL
                });
            }
        }

        this._getEveningSlots(cfgNorm).forEach((slot) => {
            const [eH, eM] = slot.time.split(':').map(Number);
            for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
                const eveningTs = this._tsForDayOffset(day, eH, eM);
                if (eveningTs <= Date.now()) continue;
                const recordKey = this._dateKeyForTimestamp(eveningTs);
                if (this._isQuestionAnswered(recordKey, slot.type)) continue;
                notifications.push({
                    id: slot.idBase + day,
                    channelId: this.EVENING_CHANNEL_ID,
                    title: slot.title,
                    body:  slot.body,
                    actionTypeId: slot.actionTypeId,
                    sound: this.NOTIFICATION_SOUND,
                    schedule: { at: new Date(eveningTs), allowWhileIdle: true },
                    extra: {
                        url: this._buildPlanActionUrl(slot.type, recordKey),
                        type: slot.type,
                        recordKey
                    },
                    iconColor: this.BRAND_TEAL_DARK
                });
            }
        });

        // Extra custom notifications (admin-defined arbitrary slots)
        const extras = Array.isArray(cfgNorm.extraNotifications) ? cfgNorm.extraNotifications : [];
        extras.forEach((extra, idx) => {
            if (!extra || !extra.time) return;
            const [xH, xM] = String(extra.time).split(':').map(Number);
            if (isNaN(xH) || isNaN(xM)) return;
            for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
                const xTs = this._tsForDayOffset(day, xH, xM);
                if (xTs > Date.now()) {
                    notifications.push({
                        id: 5000 + idx * 100 + day,
                        channelId: this.CHANNEL_ID,
                        title: extra.title || 'NutriPlan',
                        body:  extra.body  || '',
                        schedule: { at: new Date(xTs), allowWhileIdle: true },
                        sound: this.NOTIFICATION_SOUND,
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

        const cfgNorm = this.normalizeConfig(cfg);
        const [mH, mM] = cfgNorm.morningTime.split(':').map(Number);
        const now = Date.now();
        const schedule = [];

        for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
            const morning = this._tsForDayOffset(day, mH, mM);
            if (morning > now) {
                const recordKey = this._dateKeyForTimestamp(morning);
                if (this._isQuestionAnswered(recordKey, 'morning_check')) continue;
                const morningActions = this._actionsFromConfig(cfgNorm, this.MORNING_META);
                schedule.push({
                    ts: morning,
                    title: cfgNorm.morningTitle,
                    body:  cfgNorm.morningBody,
                    tag:   `gn-morning-${morning}`,
                    type:  'morning_check',
                    url:   this._buildPlanActionUrl('morning_check', recordKey),
                    recordKey,
                    actions: this._swActionsFromList(morningActions),
                    silentActionIds: morningActions.map((a) => a.id),
                    vibrate: [300, 100, 300, 100, 300],
                    requireInteraction: true
                });
            }
        }

        this._getEveningSlots(cfgNorm).forEach((slot) => {
            const [eH, eM] = slot.time.split(':').map(Number);
            for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
                const evening = this._tsForDayOffset(day, eH, eM);
                if (evening <= now) continue;
                const recordKey = this._dateKeyForTimestamp(evening);
                if (this._isQuestionAnswered(recordKey, slot.type)) continue;
                schedule.push({
                    ts: evening,
                    title: slot.title,
                    body:  slot.body,
                    tag:   `gn-${slot.type}-${evening}`,
                    type:  slot.type,
                    url:   this._buildPlanActionUrl(slot.type, recordKey),
                    recordKey,
                    actions: this._swActionsFromList(slot.actions),
                    silentActionIds: (slot.actions || []).map((a) => a.id),
                    vibrate: [200, 100, 200, 100, 200],
                    requireInteraction: false
                });
            }
        });

        // Extra custom notifications (admin-defined arbitrary slots)
        const extras = Array.isArray(cfgNorm.extraNotifications) ? cfgNorm.extraNotifications : [];
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
        const cfg = this.normalizeConfig(this._getConfig());
        let title, body, url;
        let actionTypeId;
        let recordKey = this._dateKeyForTimestamp(Date.now());
        const slot = this._getEveningSlots(cfg).find((item) => item.type === type);

        if (type === 'morning_check') {
            title = cfg.morningTitle;
            body  = cfg.morningBody;
            url   = this._buildPlanActionUrl('morning_check', recordKey);
            actionTypeId = this.MORNING_ACTION_TYPE_ID;
        } else if (slot) {
            title = slot.title;
            body  = slot.body;
            url   = this._buildPlanActionUrl(slot.type, recordKey);
            actionTypeId = slot.actionTypeId;
        } else if (type === 'evening_check') {
            title = cfg.eveningWaterTitle;
            body  = cfg.eveningWaterBody;
            url   = this._buildPlanActionUrl('evening_water', recordKey);
            actionTypeId = this.EVENING_WATER_ACTION_TYPE_ID;
            type = 'evening_water';
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
                actions: (() => {
                    const meta = this._slotMetaByType(type);
                    return meta ? this._swActionsFromList(this._actionsFromConfig(cfg, meta)) : undefined;
                })()
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

    _swActionsFromList(actions) {
        if (!Array.isArray(actions) || !actions.length) return undefined;
        return actions.map((item) => ({ action: item.id, title: item.title }));
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

    _saveEveningField(recordKey, field, value) {
        const gm = typeof window !== 'undefined' && window.gameModule;
        if (gm && typeof gm.getRecord === 'function' && typeof gm.saveRecord === 'function') {
            try {
                const rec = gm.getRecord(recordKey);
                if (!rec.eveningCheck) {
                    rec.eveningCheck = {
                        activityLevel: null,
                        emotionalBalance: null,
                        waterIntake: null,
                        ts: new Date().toISOString()
                    };
                }
                if (rec.eveningCheck[field] != null) return false;
                rec.eveningCheck[field] = value;
                if (!rec.eveningCheck.ts) rec.eveningCheck.ts = new Date().toISOString();
                gm.saveRecord(recordKey, rec);
                if (typeof gm.recalcAndShowScore === 'function') gm.recalcAndShowScore(recordKey);
                return true;
            } catch (_) { /* fall through */ }
        }
        try {
            const key = this._normalizeRecordKey(recordKey);
            const allData = JSON.parse(localStorage.getItem('gameData') || '{}') || {};
            const record = allData[key] || this._emptyGameRecord(key);
            if (!record.eveningCheck) {
                record.eveningCheck = {
                    activityLevel: null,
                    emotionalBalance: null,
                    waterIntake: null,
                    ts: new Date().toISOString()
                };
            }
            if (record.eveningCheck[field] != null) return false;
            record.eveningCheck[field] = value;
            allData[key] = record;
            localStorage.setItem('gameData', JSON.stringify(allData));
            return true;
        } catch (e) {
            console.warn('[GameNotifier] Evening field save failed:', e);
            return false;
        }
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
