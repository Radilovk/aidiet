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
 *   – Клиентът НЕ прави автоматични заявки към бекенда при отваряне на приложението.
 *   – Конфигурацията се зарежда САМО от localStorage → 'gameNotifierConfig' (или hardcoded defaults).
 *   – _maybeSyncBackendConfig() се извиква единствено от forceSyncBackendConfig(), което
 *     се вика от admin панела след ръчно запазване на нова конфигурация.
 */

const GameNotifier = {

    // Keep a rolling monthly buffer so OEM battery restrictions or missed app opens
    // do not leave users without reminders after the first week.
    SCHEDULE_WINDOW_DAYS: 30,
    LS_CONFIG_KEY:   'gameNotifierConfig',
    LS_VERSION_KEY:  'gameNotifierConfigVersion',
    CALENDAR_URL:   'https://aidiet.radilov-k.workers.dev/api/calendar.ics',
    CHANNEL_ID:     'nutriplan_daily_checkins',
    BRAND_TEAL:     '#009A9E',
    BRAND_TEAL_DARK: '#0F766E',
    QUICK_ANSWER_PATH: '/quick-answer.html',
    MORNING_ACTION_TYPE_ID: 'nutriplan_morning_check',
    EVENING_ACTION_TYPE_ID: 'nutriplan_evening_check',

    _swReg:     null,
    _capacitor: null,   // @capacitor/local-notifications handle
    _listenersBound: false,

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
        console.log('[GameNotifier] Initialising...');

        // Detect Capacitor (APK context)
        this._capacitor = this._detectCapacitor();

        if (this._capacitor) {
            console.log('[GameNotifier] Running in Capacitor (APK) context');
            const granted = await this._requestCapacitorPermission();
            if (!granted) {
                console.warn('[GameNotifier] Capacitor notification permission denied');
                return;
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
        }

        // Schedule 7-day block with hardcoded defaults (or admin-overridden times).
        // No automatic backend sync here — config is fetched only when the admin
        // explicitly saves a new notification config via the admin panel.
        await this.scheduleNotifications();

        console.log('[GameNotifier] Ready.');
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
        if (!this._swReg) return;
        try {
            const pending = await this._swReg.getNotifications({ tag: 'gn-' });
            pending.forEach(n => n.close());
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
            await LocalNotifications.createChannel({
                id: this.CHANNEL_ID,
                name: 'NutriPlan дневни проверки',
                description: 'Сутрешни и вечерни напомняния за проследяване на хранене, сън и настроение.',
                importance: 5,
                visibility: 1,
                sound: 'default',
                vibration: true,
                lights: true,
                lightColor: this.BRAND_TEAL
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
                            { id: 'sleep_yes', title: 'Да 🌞' },
                            { id: 'sleep_no', title: 'Не 😴' }
                        ]
                    },
                    {
                        id: this.EVENING_ACTION_TYPE_ID,
                        actions: [
                            { id: 'open_evening', title: 'Бърз отговор ⚡' },
                            { id: 'water_yes', title: 'Пих вода 💧' }
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
        const { LocalNotifications } = this._capacitor;
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

        if (type === 'morning_check' && (actionId === 'sleep_yes' || actionId === 'sleep_no')) {
            const sleptWell = actionId === 'sleep_yes';
            // Use gameModule when available so the in-memory cache stays consistent
            // and the daily score card is refreshed without any page navigation.
            let saved = false;
            const gm = typeof window !== 'undefined' && window.gameModule;
            if (gm && typeof gm.getRecord === 'function' && typeof gm.saveRecord === 'function') {
                try {
                    const rec = gm.getRecord(recordKey);
                    if (!rec.morningCheck) {
                        rec.morningCheck = { sleptWell, ts: new Date().toISOString() };
                        gm.saveRecord(recordKey, rec);
                    }
                    if (typeof gm.recalcAndShowScore === 'function') {
                        gm.recalcAndShowScore(recordKey);
                    }
                    saved = true;
                } catch (_) { /* fall through to _saveQuickAnswer */ }
            }
            if (!saved) {
                saved = this._saveQuickAnswer(recordKey, 'morning_check', { sleptWell });
            }
            // Haptic feedback – distinct pattern per answer
            try {
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    navigator.vibrate(sleptWell ? [40, 30, 60] : [60, 30, 40]);
                }
            } catch (_) {}
            if (saved) return;
            // Fallback: show in-app morning modal or open quick-answer page.
            if (typeof window._gameShowMorning === 'function') {
                window._gameShowMorning(true, recordKey);
                return;
            }
            window.location.href = this._buildQuickAnswerUrl('morning_check', {
                date: recordKey,
                auto: sleptWell ? 'morning_yes' : 'morning_no'
            });
            return;
        }

        if (type === 'morning_check') {
            // Body tap – show in-app morning check modal without reloading.
            if (typeof window._gameShowMorning === 'function') {
                window._gameShowMorning(true, recordKey);
                return;
            }
            if (extra.url) window.location.href = extra.url;
            return;
        }

        if (type === 'evening_check' && actionId === 'water_yes') {
            // Pre-fill water intake, then show the evening flow modal.
            if (typeof window._gameShowEvening === 'function') {
                window._gameShowEvening(true, recordKey, { prefillWater: true });
                return;
            }
            window.location.href = this._buildQuickAnswerUrl('evening_check', {
                date: recordKey,
                water: '1'
            });
            return;
        }

        if (type === 'evening_check') {
            // open_evening action or body tap – show in-app evening modal.
            if (typeof window._gameShowEvening === 'function') {
                window._gameShowEvening(true, recordKey);
                return;
            }
            if (extra.url) window.location.href = extra.url;
            return;
        }

        if (extra.url) {
            window.location.href = extra.url;
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
        // There is intentionally no time-based throttle: each app open (init() call)
        // triggers exactly one lightweight check. Backend cost is negligible for the
        // common case (version unchanged), and admin changes propagate to all users
        // on their very next app open.
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

        // Warn on Android 12+ if exact-alarm permission was not granted by the user.
        // Without it, AlarmManager.setExact() calls are silently dropped by the OS.
        await this._warnIfExactAlarmDenied(LocalNotifications);

        const [mH, mM] = cfg.morningTime.split(':').map(Number);
        const [eH, eM] = cfg.eveningTime.split(':').map(Number);
        const notifications = [];

        for (let day = 0; day < this.SCHEDULE_WINDOW_DAYS; day++) {
            const morningTs = this._tsForDayOffset(day, mH, mM);
            if (morningTs > Date.now()) {
                const recordKey = this._dateKeyForTimestamp(morningTs);
                notifications.push({
                    id: 1000 + day,
                    channelId: this.CHANNEL_ID,
                    title: cfg.morningTitle,
                    body:  cfg.morningBody,
                    actionTypeId: this.MORNING_ACTION_TYPE_ID,
                    // allowWhileIdle uses setExactAndAllowWhileIdle() so Huawei's
                    // aggressive battery optimization (Doze mode) cannot kill the alarm.
                    schedule: { at: new Date(morningTs), allowWhileIdle: true },
                    extra: {
                        url: this._buildQuickAnswerUrl('morning_check', { date: recordKey }),
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
                    channelId: this.CHANNEL_ID,
                    title: cfg.eveningTitle,
                    body:  cfg.eveningBody,
                    actionTypeId: this.EVENING_ACTION_TYPE_ID,
                    schedule: { at: new Date(eveningTs), allowWhileIdle: true },
                    extra: {
                        url: this._buildQuickAnswerUrl('evening_check', { date: recordKey }),
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
                    url:   this._buildQuickAnswerUrl('morning_check', { date: recordKey }),
                    recordKey,
                    actions: [
                        { action: 'sleep_yes', title: 'Да 🌞' },
                        { action: 'sleep_no', title: 'Не 😴' }
                    ],
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
                    url:   this._buildQuickAnswerUrl('evening_check', { date: recordKey }),
                    recordKey,
                    actions: [
                        { action: 'open_evening', title: 'Бърз отговор ⚡' },
                        { action: 'water_yes', title: 'Пих вода 💧' }
                    ],
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
                    ? [{ action: 'sleep_yes', title: 'Да 🌞' }, { action: 'sleep_no', title: 'Не 😴' }]
                    : type === 'evening_check'
                        ? [{ action: 'open_evening', title: 'Бърз отговор ⚡' }, { action: 'water_yes', title: 'Пих вода 💧' }]
                        : undefined
            });
        }
    },

    /* ------------------------------------------------------------------ */
    /*  Helper                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * On Android 12+ (API 31+) the SCHEDULE_EXACT_ALARM permission requires
     * explicit user approval in Settings → Apps → Special permissions →
     * Alarms & reminders.  If it has not been granted the OS silently drops
     * all setExact() calls.  We use checkPermissions() to detect this and
     * warn in the console; a future improvement would be to open the system
     * settings page via an ACTION_REQUEST_SCHEDULE_EXACT_ALARM intent.
     */
    async _warnIfExactAlarmDenied(LocalNotifications) {
        try {
            if (typeof LocalNotifications.checkPermissions !== 'function') return;
            const perms = await LocalNotifications.checkPermissions();
            // Capacitor 5+ exposes `exactAlarm` in the permissions result.
            if (perms?.exactAlarm && perms.exactAlarm !== 'granted') {
                console.warn(
                    '[GameNotifier] SCHEDULE_EXACT_ALARM not granted by user (' + perms.exactAlarm + '). ' +
                    'On Android 12+ go to Settings → Apps → NutriPlan → Special permissions → Alarms & Reminders ' +
                    'and enable it, otherwise notifications will not fire on schedule.'
                );
            }
        } catch (_) { /* non-critical */ }
    },

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
                record.morningCheck = {
                    sleptWell: !!(payload && payload.sleptWell),
                    ts: new Date().toISOString()
                };
            } else if (type === 'evening_check' && payload) {
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
