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
 *   evening_activity    – вечер: активност (по подразбиране 20:00); при трениращ —
 *                         „Тренирахте ли днес?“, при крачкомер без тренировки — без въпрос
 *                         (activity-tracker.js)
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
    LS_LAST_SCHEDULE_DAY_KEY: 'gameNotifierLastScheduleDay',
    LS_ACTIVITY_MODE_KEY: 'gameNotifierActivityMode',
    CALENDAR_URL:   'https://aidiet.radilov-k.workers.dev/api/calendar.ics',
    CHANNEL_ID:     'nutriplan_daily_checkins_v3',
    MORNING_CHANNEL_ID: 'nutriplan_morning_v3',
    EVENING_CHANNEL_ID: 'nutriplan_evening_v3',
    LS_PENDING_ACTIONS_KEY: 'gameNotifierPendingActions',
    LS_SILENT_APPLY_UNTIL_KEY: 'gameNotifierSilentApplyUntil',
    SILENT_APPLY_SUPPRESS_MS: 120000,
    BRAND_TEAL:     '#009A9E',
    BRAND_TEAL_DARK: '#0F766E',
    QUICK_ANSWER_PATH: '/quick-answer.html',
    MORNING_ACTION_TYPE_ID: 'nutriplan_morning_check',
    EVENING_ACTIVITY_ACTION_TYPE_ID: 'nutriplan_evening_activity',
    EVENING_BALANCE_ACTION_TYPE_ID:  'nutriplan_evening_balance',
    EVENING_WATER_ACTION_TYPE_ID:    'nutriplan_evening_water',
    // Въпрос след всяко хранене: „Изядохте ли обяда?“ (APK, бутоните работят и при затворено приложение).
    MEAL_ACTION_TYPE_ID: 'nutriplan_meal_check',
    MEAL_TYPE_PREFIX: 'meal_check:',
    MEAL_ID_BASE: 3000,
    MEAL_WINDOW_DAYS: 7,
    MEAL_ASK_AFTER_MIN: 45,
    MEAL_DEFAULT_TIME: {
        'Хранене 1': '08:00', 'Закуска': '08:00',
        'Хранене 2': '13:00', 'Обяд': '13:00', 'Свободно хранене': '13:00',
        'Хранене 3': '16:00', 'Следобедна закуска': '16:00', 'Следобедна': '16:00',
        'Хранене 4': '19:00', 'Вечеря': '19:00',
        'Хранене 5': '21:00', 'Късна закуска': '21:00'
    },
    MEAL_LABEL: {
        'Хранене 1': 'закуската', 'Закуска': 'закуската',
        'Хранене 2': 'обяда', 'Обяд': 'обяда', 'Свободно хранене': 'свободното хранене',
        'Хранене 3': 'следобедната закуска', 'Следобедна закуска': 'следобедната закуска', 'Следобедна': 'следобедната закуска',
        'Хранене 4': 'вечерята', 'Вечеря': 'вечерята',
        'Хранене 5': 'късната закуска', 'Късна закуска': 'късната закуска'
    },
    ACK_NOTIFICATION_ID:  9997,
    PENDING_DB_NAME:        'nutriplan-game-pending',
    PENDING_STORE:          'actions',

    // Same wording as the in-app AI assistant bubbles (plan.html showBubble).
    COPY: {
        morning: {
            title: 'NutriPlan',
            body:  'Спа ли добре тази нощ?',
            actions: [
                { id: 'sleep_yes', title: 'Да', value: true },
                { id: 'sleep_no',  title: 'Не', value: false }
            ]
        },
        eveningActivity: {
            title: 'NutriPlan',
            body:  'Колко се движи днес?',
            actions: [
                { id: 'activity_1', title: 'Малко', value: 1 },
                { id: 'activity_2', title: 'Умерено', value: 2 },
                { id: 'activity_3', title: 'Много', value: 3 }
            ]
        },
        eveningBalance: {
            title: 'NutriPlan',
            body:  'Как се чувстваше днес?',
            actions: [
                { id: 'balance_1', title: 'Напрегнато', value: 1 },
                { id: 'balance_2', title: 'Спокойно', value: 2 },
                { id: 'balance_3', title: 'Позитивно', value: 3 }
            ]
        },
        eveningWater: {
            title: 'NutriPlan',
            body:  'Пи ли достатъчно вода днес?',
            actions: [
                { id: 'water_no',  title: 'Не', value: false },
                { id: 'water_yes', title: 'Да', value: true }
            ]
        }
    },

    EVENING_SLOT_DEFS: [
        { type: 'evening_activity', copyKey: 'eveningActivity', actionsKey: 'eveningActivityActions', actionTypeKey: 'EVENING_ACTIVITY_ACTION_TYPE_ID', idBase: 2000, defaultOffsetMin: 0, saveKind: 'activityLevel' },
        { type: 'evening_balance',  copyKey: 'eveningBalance',  actionsKey: 'eveningBalanceActions',  actionTypeKey: 'EVENING_BALANCE_ACTION_TYPE_ID',  idBase: 2200, defaultOffsetMin: 5, saveKind: 'emotionalBalance' },
        { type: 'evening_water',    copyKey: 'eveningWater',    actionsKey: 'eveningWaterActions',    actionTypeKey: 'EVENING_WATER_ACTION_TYPE_ID',    idBase: 2400, defaultOffsetMin: 10, saveKind: 'waterIntake' }
    ],

    /** Canonical order for same-day catch-up queue (app open → quick-answer chain). */
    QUESTION_TYPE_ORDER: ['morning_check', 'evening_activity', 'evening_balance', 'evening_water'],

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
    _pwaResumeBound: false,
    _nativeDrainBound: false,
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

    async init(options) {
        this._forcePermissionPrompt = !!(options && options.askPermission);
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
                // Web / PWA — any browser with SW + Notification API (Chrome, Firefox, Samsung, Edge, iOS 16.4+ PWA, etc.)
                const compat = typeof window !== 'undefined' && window.NutriPlanCompat;
                const swOk = compat && typeof compat.supportsSwGameNotifications === 'function'
                    ? compat.supportsSwGameNotifications()
                    : (('Notification' in window) && ('serviceWorker' in navigator));
                if (!swOk) {
                    const mode = compat && compat.getNotificationDeliveryMode
                        ? compat.getNotificationDeliveryMode()
                        : 'calendar';
                    console.warn('[GameNotifier] Web notifications unavailable on this client (mode:', mode, '). Calendar:', this.getCalendarSubscribeUrl());
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
                this._bindPwaResumeRefresh();
            }

            // Cheap version check on every open; full config + reschedule only when version changes.
            let configChanged = false;
            if (!this._hasLocalConfig()) {
                configChanged = await this._maybeSyncBackendConfig();
            }

            const currentVersion = localStorage.getItem(this.LS_VERSION_KEY) || '0';
            const scheduledVersion = localStorage.getItem(this.LS_SCHEDULED_VERSION_KEY) || '';
            // Roll the SCHEDULE_WINDOW_DAYS buffer forward at most once per day —
            // without this the APK runs out of scheduled notifications after the
            // window passes with no config change (PWA refreshes on focus instead).
            // Смяна на режима на въпроса за активност (попълнен въпросник, включен крачкомер)
            // сменя бутоните и маха/връща въпроса — графикът се пренарежда.
            // Режимът за графика (без деня): денят с неотбелязана тренировка не праща известие.
            const activityMode = this._activityMode(null);
            const needsSchedule = configChanged ||
                scheduledVersion !== String(currentVersion) ||
                localStorage.getItem(this.LS_ACTIVITY_MODE_KEY) !== activityMode ||
                this._scheduleWindowStale();

            if (needsSchedule) {
                if (this._capacitor) await this._registerCapacitorActionTypes();
                await this.scheduleNotifications();
                localStorage.setItem(this.LS_SCHEDULED_VERSION_KEY, String(currentVersion));
                localStorage.setItem(this.LS_ACTIVITY_MODE_KEY, activityMode);
            }

            await this.drainAllPendingActions();

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
        // Най-много веднъж на 30 минути — настройките на известията се сменят рядко.
        const now = Date.now();
        if (now - (this._lastConfigRefreshAt || 0) < 30 * 60 * 1000) return false;
        this._lastConfigRefreshAt = now;
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

    /* ------------------------------------------------------------------ */
    /*  Еднократни известия по плана (ново седмично меню, седмичен преглед) */
    /*  Пазят се локално и влизат в графика при всяко пренасрочване —       */
    /*  без сървър, без разход.                                             */
    /* ------------------------------------------------------------------ */
    LS_PLAN_REMINDERS_KEY: 'np_plan_reminders',

    _planReminders() {
        try {
            const list = JSON.parse(localStorage.getItem(this.LS_PLAN_REMINDERS_KEY) || '[]');
            const now = Date.now();
            return Array.isArray(list) ? list.filter(r => r && r.ts > now && r.key) : [];
        } catch (_) {
            return [];
        }
    },

    /**
     * @param {{ key: string, ts: number, title: string, body: string, url?: string }} reminder
     *   key е уникален за вида (повторно добавяне го заменя)
     */
    async addPlanReminder(reminder) {
        if (!reminder || !reminder.key || !(reminder.ts > Date.now())) return;
        const list = this._planReminders().filter(r => r.key !== reminder.key);
        list.push({ key: reminder.key, ts: reminder.ts, title: reminder.title, body: reminder.body, url: reminder.url || '/plan.html' });
        try { localStorage.setItem(this.LS_PLAN_REMINDERS_KEY, JSON.stringify(list.slice(-6))); } catch (_) {}
        try { await this.scheduleNotifications(); } catch (e) { console.warn('[GameNotifier] plan reminder schedule failed:', e); }
    },

    _planReminderId(key) {
        let h = 0;
        for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
        return 7000 + (Math.abs(h) % 900);
    },

    async scheduleNotifications() {
        const cfg = this._getConfig();
        console.log('[GameNotifier] Scheduling with config:', cfg);

        if (this._capacitor) {
            await this._dedupeDeliveredGamificationNotifications();
            await this._scheduleWithCapacitor(cfg);
        } else {
            await this._scheduleViaSW(cfg);
        }
    },

    /** True when the rolling schedule window has not been (re)planned today. */
    _scheduleWindowStale() {
        try {
            return localStorage.getItem(this.LS_LAST_SCHEDULE_DAY_KEY) !==
                this._dateKeyForTimestamp(Date.now());
        } catch (_) {
            return true;
        }
    },

    _markScheduleWindowFresh() {
        try {
            localStorage.setItem(this.LS_LAST_SCHEDULE_DAY_KEY, this._dateKeyForTimestamp(Date.now()));
        } catch (_) {}
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
        if (type === 'evening_activity' && this._activityMode() === 'training') return this.TRAINING_COPY.body;
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

        const activityIcons = {
            1: '<i class="fas fa-couch" style="color:#fff;font-size:1em"></i>',
            2: '<i class="fas fa-person-walking" style="color:#fff;font-size:1em"></i>',
            3: '<i class="fas fa-person-running" style="color:#fff;font-size:1em"></i>',
        };
        const activityCls = { 1: 'tier-low', 2: 'tier-mid', 3: 'tier-high' };
        const balanceIcons = {
            1: '<i class="fas fa-face-grimace" style="color:#fff;font-size:1.15em"></i>',
            2: '<i class="fas fa-face-smile" style="color:#fff;font-size:1.15em"></i>',
            3: '<i class="fas fa-face-grin-beam" style="color:#fff;font-size:1.15em"></i>',
        };
        const balanceCls = { 1: 'tier-calm', 2: 'tier-mid', 3: 'tier-high' };

        if (type === 'evening_activity' && this._activityMode() === 'training') {
            const trainIcons = {
                am: '<i class="fas fa-sun" style="color:#fff;font-size:1em"></i>',
                pm: '<i class="fas fa-dumbbell" style="color:#fff;font-size:1em"></i>',
                no: '<i class="fas fa-couch" style="color:#fff;font-size:1em"></i>'
            };
            return actions.map((a) => ({ label: a.title, icon: trainIcons[a.value] || trainIcons.pm, value: a.value, cls: a.value === 'no' ? 'tier-low' : 'tier-high' }));
        }
        return actions.map((a) => {
            const v = Number(a.value) || (a.value === false ? 0 : 1);
            if (type === 'evening_activity') {
                return { label: a.title, icon: activityIcons[v] || activityIcons[2], value: v, cls: activityCls[v] || 'tier-mid' };
            }
            if (type === 'evening_balance') {
                return { label: a.title, icon: balanceIcons[v] || balanceIcons[2], value: v, cls: balanceCls[v] || 'tier-mid' };
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

        if (notifType.indexOf(this.MEAL_TYPE_PREFIX) === 0) {
            const mealKey = notifType.slice(this.MEAL_TYPE_PREFIX.length);
            if (action === 'meal_yes' || action === 'meal_no') {
                result.saved = this._saveMealAnswer(recordKey, mealKey, action === 'meal_yes', msg && msg.calories);
                result.silent = true;
                result.ack = null;
                this.markSilentApply();
                return result;
            }
            result.needsApp = true;
            return result;
        }
        const cfg = this._getConfig();
        const meta = this._slotMetaByType(notifType);

        if (action && meta) {
            const actions = this._actionsFromConfig(cfg, meta);
            const hit = actions.find((a) => a.id === action);
            if (hit) {
                // Skip / empty actions are not real answers — never mark answered.
                if (action === 'skip' || hit.value === null) {
                    result.needsApp = true;
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
                this.markSilentApply();
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

    markSilentApply() {
        try {
            localStorage.setItem(
                this.LS_SILENT_APPLY_UNTIL_KEY,
                String(Date.now() + this.SILENT_APPLY_SUPPRESS_MS)
            );
        } catch (_) {}
    },

    shouldSuppressGamificationUi() {
        try {
            const until = parseInt(localStorage.getItem(this.LS_SILENT_APPLY_UNTIL_KEY) || '0', 10);
            return until > Date.now();
        } catch (_) {
            return false;
        }
    },

    clearSilentApplyFlag() {
        try { localStorage.removeItem(this.LS_SILENT_APPLY_UNTIL_KEY); } catch (_) {}
    },

    /** Лице или човече пред отговора в системното известие (там бутоните са само текст). */
    ACTION_EMOJI: {
        activity_1: '🛋️', activity_2: '🚶', activity_3: '🏃',
        train_am: '🌅', train_pm: '💪', train_no: '🛋️',
        balance_1: '😣', balance_2: '🙂', balance_3: '😄'
    },

    _notificationActionTitle(item) {
        const title = String(item && item.title || '').trim();
        const emoji = item && this.ACTION_EMOJI[item.id];
        return emoji && title.indexOf(emoji) !== 0 ? emoji + ' ' + title : title;
    },

    _capacitorActionTitle(title) {
        const compact = {
            'Пропуск': 'Проп.'
        };
        const raw = String(title || '').trim();
        const t = compact[raw] || raw;
        return t.length > 14 ? t.slice(0, 14) : t;
    },

    _getCapacitorPlugin(name) {
        try {
            // Мостът на горния прозорец: отговорите от Android стигат само до него.
            const cap = (window.top !== window && window.top && window.top.Capacitor) ||
                window.Capacitor ||
                null;
            if (!cap) return null;
            let plugin = cap.Plugins && cap.Plugins[name];
            if (!plugin && typeof cap.registerPlugin === 'function') {
                try { plugin = cap.registerPlugin(name); } catch (_) {}
            }
            return plugin || null;
        } catch (_) {
            return null;
        }
    },

    /** Close APK task completely — no background process in recents. */
    exitAppSilently() {
        try {
            if (typeof window !== 'undefined' && window.NutriPlanPlatform &&
                typeof window.NutriPlanPlatform.exitNativeApp === 'function') {
                if (window.NutriPlanPlatform.exitNativeApp()) return true;
            }
            const app = this._getCapacitorPlugin('App');
            if (app && typeof app.exitApp === 'function') {
                // Скриване само когато наистина излизаме (APK) — в браузъра
                // скриването оставяше празен тъмен екран.
                if (typeof document !== 'undefined' && document.documentElement) {
                    document.documentElement.style.visibility = 'hidden';
                    document.documentElement.style.background = '#0A1A1A';
                }
                app.exitApp().catch(() => {});
                return true;
            }
        } catch (_) {}
        return false;
    },

    _ensureText(value, fallback) {
        const s = String(value == null ? '' : value).trim();
        const fb = String(fallback == null ? '' : fallback).trim();
        return s || fb;
    },

    /**
     * Notification title/body/largeBody for OS display (heads-up, shade).
     * Question only — answers live exclusively in action buttons (no inline duplication).
     */
    _notificationDisplayFields(type) {
        const display = this.getQuestionDisplay(type);
        if (!display) {
            return { title: 'NutriPlan', body: 'NutriPlan', largeBody: 'NutriPlan' };
        }
        const question = this._ensureText(display.body, 'Проверка');
        return {
            title: question,
            body: 'NutriPlan',
            largeBody: question
        };
    },

    /** After any standalone save (quick-answer / heads-up), refresh stored score + notify UI. */
    notifyAnswerSaved(recordKey) {
        const key = this._normalizeRecordKey(recordKey);
        try {
            localStorage.setItem('gameDataDirtyKey', key);
        } catch (_) {}
        const gm = typeof window !== 'undefined' && window.gameModule;
        if (gm && typeof gm.recalcAndShowScore === 'function') {
            try { gm.recalcAndShowScore(key); } catch (_) {}
        }
        try {
            if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'NUTRIPLAN_GAMEDATA_UPDATED', recordKey: key }, window.location.origin);
            }
        } catch (_) {}
    },

    extractCapacitorActionId(actionEvent) {
        if (!actionEvent) return '';
        let id = actionEvent.actionId;
        if (typeof id !== 'string' || !id) {
            id = actionEvent.action;
        }
        if (typeof id !== 'string') return '';
        id = id.trim();
        if (!id || id === 'tap' || id === 'MESSAGE' || id === 'CLOSE') return '';
        return id;
    },

    /** Brief haptic only — no second notification (avoids delayed heads-up flash). */
    showSilentAck(ackKey) {
        const patterns = {
            sleep_yes: [35, 25, 35],
            sleep_no:  [45, 25],
            activity_1: [20, 15, 20],
            activity_2: [25, 20, 25],
            activity_3: [30, 25, 30, 25, 30],
            balance_1:  [20],
            balance_2:  [25, 20, 25],
            balance_3:  [30, 25, 30],
            water_yes: [30, 20, 30],
            water_no:  [40, 25],
            train_am:  [30, 25, 30, 25, 30],
            train_pm:  [30, 25, 30, 25, 30],
            train_no:  [20, 15, 20],
            skip:      [15]
        };
        try {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(patterns[ackKey] || [25]);
            }
        } catch (_) {}
    },

    getQuestionDisplay(type) {
        const cfg = this.normalizeConfig(this._getConfig());
        const meta = this._slotMetaByType(type);
        if (!meta) return null;
        if (type === 'morning_check') {
            return {
                title: cfg.morningTitle || this.COPY.morning.title,
                body:  cfg.morningBody || this.COPY.morning.body,
                actions: this._actionsFromConfig(cfg, meta)
            };
        }
        const prefix = meta.type.replace('evening_', '');
        const cap = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        const titleKey = 'evening' + cap + 'Title';
        const bodyKey = 'evening' + cap + 'Body';
        const copy = this.COPY[meta.copyKey] || {};
        const training = type === 'evening_activity' && this._activityMode() === 'training';
        return {
            title: cfg[titleKey] || copy.title || 'NutriPlan',
            body:  training ? this.TRAINING_COPY.body : (cfg[bodyKey] || copy.body || ''),
            actions: this._actionsFromConfig(cfg, meta)
        };
    },

    encouragementForAction(actionId) {
        const map = {
            sleep_yes:    { title: 'Супер! ✨', message: 'Добър старт на деня!', confetti: 28 },
            sleep_no:     { title: 'Записано', message: 'Благодарим за честността.', confetti: 12 },
            activity_1:   { title: 'Записано', message: 'Спокоен ден — важно е да се отдъхнеш.', confetti: 14 },
            activity_2:   { title: 'Браво! 💪', message: 'Умерен ритъм — точно в целта.', confetti: 22 },
            activity_3:   { title: 'Страхотно! 🔥', message: 'Висока активност — блестящо!', confetti: 32 },
            balance_1:    { title: 'Записано', message: 'Утре е нов ден — полека.', confetti: 10 },
            balance_2:    { title: 'Добре! 🙂', message: 'Спокойствието си струва.', confetti: 18 },
            balance_3:    { title: 'Чудесно! ✨', message: 'Позитивният заряд помага.', confetti: 30 },
            water_yes:    { title: 'Браво! 💧', message: 'Пиеш достатъчно вода — чудесно.', confetti: 26 },
            water_no:     { title: 'Записано', message: 'Утре опитай да пиеш малко повече.', confetti: 10 },
            train_am:     { title: 'Браво! 💪', message: 'Тренировката е отчетена в деня.', confetti: 30 },
            train_pm:     { title: 'Браво! 💪', message: 'Тренировката е отчетена в деня.', confetti: 30 },
            train_no:     { title: 'Записано', message: 'Активността за деня е по крачките.', confetti: 12 },
            skip:         { title: 'Добре', message: 'Пропуснато за днес.', confetti: 0 }
        };
        return map[actionId] || { title: 'Готово ✨', message: 'Отговорът е записан.', confetti: 16 };
    },

    queuePendingActionForLaunch(payload) {
        try {
            const list = JSON.parse(localStorage.getItem(this.LS_PENDING_ACTIONS_KEY) || '[]');
            list.push(Object.assign({}, payload, { ts: Date.now() }));
            localStorage.setItem(this.LS_PENDING_ACTIONS_KEY, JSON.stringify(list.slice(-50)));
            return true;
        } catch (_) {
            return false;
        }
    },

    drainPendingLaunchActions() {
        let applied = 0;
        try {
            const list = JSON.parse(localStorage.getItem(this.LS_PENDING_ACTIONS_KEY) || '[]');
            if (!list.length) return 0;
            list.forEach((item) => {
                if (!item || item.action === 'skip') return;
                const outcome = this.handleNotificationAction(item);
                if (outcome.saved) {
                    applied += 1;
                    this.notifyAnswerSaved(item.recordKey);
                }
            });
            localStorage.removeItem(this.LS_PENDING_ACTIONS_KEY);
        } catch (_) {}
        return applied;
    },

    /**
     * Drain answers queued by GameNotificationActionReceiver (Capacitor Preferences).
     * Runs on every app open so heads-up taps never need to launch the WebView.
     */
    async _drainNativePendingActions() {
        if (!this._capacitor) return 0;
        let applied = 0;
        try {
            const Preferences = this._getCapacitorPlugin('Preferences');
            if (!Preferences || typeof Preferences.get !== 'function') return 0;

            const result = await Preferences.get({ key: this.LS_PENDING_ACTIONS_KEY });
            const value = result && result.value;
            if (!value) return 0;

            let list;
            try { list = JSON.parse(value); } catch (_) { list = []; }
            await Preferences.remove({ key: this.LS_PENDING_ACTIONS_KEY });
            if (!Array.isArray(list) || !list.length) return 0;

            list.forEach((item) => {
                if (!item || item.action === 'skip') return;
                const outcome = this.handleNotificationAction(item);
                if (outcome.saved) {
                    applied += 1;
                    this.notifyAnswerSaved(item.recordKey);
                }
            });
        } catch (e) {
            console.warn('[GameNotifier] Native pending drain:', e);
        }
        return applied;
    },

    drainAllPendingActions() {
        return this._drainNativePendingActions().then((fromNative) => {
            const fromLs = this.drainPendingLaunchActions();
            return this.drainPendingSwActions().then((fromIdb) => fromNative + fromLs + fromIdb);
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
            if (!item || item.action === 'skip') return;
            const outcome = this.handleNotificationAction(item);
            if (outcome.saved) applied += 1;
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
            // Мостът на горния прозорец: отговорите от Android стигат само до него.
            const cap = (window.top !== window && window.top && window.top.Capacitor) ||
                window.Capacitor ||
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

    /**
     * Системният въпрос за известия не се показва при първото отваряне (клиентът
     * още не знае защо му трябват), а след първия ден и най-много веднъж на 7 дни.
     * Бутонът „Разреши“ в плана го показва веднага.
     */
    _mayPromptPermission() {
        if (this._forcePermissionPrompt) return true;
        try {
            const now = Date.now();
            const firstOpen = Number(localStorage.getItem('np_first_open_at') || 0);
            if (!firstOpen) {
                localStorage.setItem('np_first_open_at', String(now));
                return false;
            }
            if (now - firstOpen < 20 * 60 * 60 * 1000) return false;
            const askedAt = Number(localStorage.getItem('np_notif_perm_asked_at') || 0);
            return !askedAt || now - askedAt >= 7 * 24 * 60 * 60 * 1000;
        } catch (_) {
            return false;
        }
    },

    async _requestCapacitorPermission() {
        try {
            const { LocalNotifications } = this._capacitor;
            const current = typeof LocalNotifications.checkPermissions === 'function'
                ? await LocalNotifications.checkPermissions()
                : {};
            if (current.display !== 'granted' && !this._mayPromptPermission()) return false;
            if (current.display !== 'granted') {
                try { localStorage.setItem('np_notif_perm_asked_at', String(Date.now())); } catch (_) {}
            }
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
            const channelBase = {
                importance: 4,
                visibility: 1,
                vibration: true,
                lights: true
            };
            await LocalNotifications.createChannel(Object.assign({}, channelBase, {
                id: this.CHANNEL_ID,
                name: 'NutriPlan дневни проверки',
                description: 'Сутрешни и вечерни напомняния за проследяване на хранене, сън и настроение.',
                lightColor: this.BRAND_TEAL
            }));
            await LocalNotifications.createChannel(Object.assign({}, channelBase, {
                id: this.MORNING_CHANNEL_ID,
                name: 'NutriPlan — Сутрешна проверка',
                description: 'Сутрешно напомняне за сън и начало на деня.',
                lightColor: this.BRAND_TEAL
            }));
            await LocalNotifications.createChannel(Object.assign({}, channelBase, {
                id: this.EVENING_CHANNEL_ID,
                name: 'NutriPlan — Вечерна проверка',
                description: 'Вечерно напомняне за хидратация и края на деня.',
                lightColor: this.BRAND_TEAL_DARK
            }));
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
                        id: item.id, title: this._capacitorActionTitle(this._notificationActionTitle(item)), foreground: false
                    }))
                }
            ];
            this.EVENING_SLOT_DEFS.forEach((def) => {
                types.push({
                    id: this[def.actionTypeKey],
                    actions: this._actionsFromConfig(cfg, def).map((item) => ({
                        id: item.id, title: this._capacitorActionTitle(this._notificationActionTitle(item)), foreground: false
                    }))
                });
            });
            const mq = this._mealQuestion('храненето');
            types.push({
                id: this.MEAL_ACTION_TYPE_ID,
                actions: [
                    { id: 'meal_yes', title: this._capacitorActionTitle(mq.yes), foreground: false },
                    { id: 'meal_no', title: this._capacitorActionTitle(mq.no), foreground: false }
                ]
            });
            await LocalNotifications.registerActionTypes({ types });
        } catch (e) {
            console.warn('[GameNotifier] Action type registration warning:', e);
        }
    },

    _bindPwaResumeRefresh() {
        if (this._pwaResumeBound || typeof document === 'undefined') return;
        this._pwaResumeBound = true;
        let lastRefresh = 0;
        const refresh = () => {
            if (this._capacitor || !this._initialized) return;
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            if (Notification.permission !== 'granted') return;
            const now = Date.now();
            if (now - lastRefresh < 60000) return;
            lastRefresh = now;
            this.scheduleNotifications().catch(() => {});
        };
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('pageshow', refresh);
        window.addEventListener('focus', refresh);
    },

    getCompatibilitySummary() {
        if (typeof window !== 'undefined' && window.NutriPlanCompat &&
            typeof window.NutriPlanCompat.getCompatibilityProfile === 'function') {
            return window.NutriPlanCompat.getCompatibilityProfile();
        }
        return {
            deliveryMode: this._capacitor ? 'apk-native' : 'pwa-sw',
            recommendations: []
        };
    },

    _bindCapacitorListeners() {
        if (!this._capacitor || this._listenersBound) return;
        try {
            if (window.top && window.top !== window) return;
        } catch (_) {}
        const { LocalNotifications } = this._capacitor;
        LocalNotifications.addListener('localNotificationReceived', (notification) => {
            this._handleForegroundNotification(notification);
            this._dedupeDeliveredGamificationNotifications().catch(() => {});
        });
        if (!window.__nutriplanNotificationLaunch) {
            LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
                this._handleCapacitorNotificationAction(action);
            });
        }
        this._bindCapacitorNativePendingDrain();
        this._listenersBound = true;
    },

    _bindCapacitorNativePendingDrain() {
        if (this._nativeDrainBound || typeof document === 'undefined') return;
        this._nativeDrainBound = true;
        const drain = () => {
            if (!this._capacitor) return;
            this._drainNativePendingActions().catch(() => {});
            this._dedupeDeliveredGamificationNotifications().catch(() => {});
            // Daily roll of the schedule window on app resume (no backend calls).
            if (this._initialized && this._scheduleWindowStale()) {
                this.scheduleNotifications().catch(() => {});
            }
        };
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') drain();
        });
        const app = this._getCapacitorPlugin('App');
        if (app && typeof app.addListener === 'function') {
            app.addListener('appStateChange', (state) => {
                if (state && state.isActive) drain();
            });
        }
    },

    _handleCapacitorNotificationAction(action) {
        const notification = action && action.notification ? action.notification : {};
        const extra = notification.extra || {};
        const type = extra.type || '';
        const recordKey = this._normalizeRecordKey(extra.recordKey);
        const actionId = this.extractCapacitorActionId(action);

        const qaType = type === 'evening_check' ? 'evening_water' : type;
        if (actionId && qaType) {
            const outcome = this.handleNotificationAction({
                notificationType: qaType,
                action: actionId,
                recordKey
            });
            if (outcome.silent) {
                if (outcome.ack && typeof this.showSilentAck === 'function') this.showSilentAck(outcome.ack);
                if (typeof this.notifyAnswerSaved === 'function') this.notifyAnswerSaved(recordKey);
                this._dismissAfterSilentHeadUp();
                return;
            }
            window.location.replace(this._buildQuickAnswerUrl(qaType, { date: recordKey }));
            return;
        }

        if (extra.url && String(extra.url).indexOf('quick-answer') !== -1) {
            window.location.replace(String(extra.url).replace(/^\//, ''));
            return;
        }

        if (qaType) {
            window.location.replace(this._buildQuickAnswerUrl(qaType, { date: recordKey }));
        } else if (extra.url) {
            window.location.href = String(extra.url);
        }
    },

    _dismissAfterSilentHeadUp() {
        if (this.exitAppSilently()) return;
        try {
            if (typeof window !== 'undefined' && window.history.length > 1) {
                window.history.back();
            }
        } catch (_) {}
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
        const list = out.length ? out : fallback.map((a) => Object.assign({}, a));
        return list.filter((a) => a.id !== 'skip');
    },

    _slotMetaByType(type) {
        if (type === 'morning_check') return this.MORNING_META;
        if (type === 'evening_check') return this.EVENING_SLOT_DEFS.find((s) => s.type === 'evening_water') || null;
        return this.EVENING_SLOT_DEFS.find((s) => s.type === type) || null;
    },

    _actionsFromConfig(config, meta) {
        if (!meta) return [];
        // Трениращият отговаря дали е тренирал — не колко се е движил (то се смята).
        if (meta.type === 'evening_activity' && this._activityMode() === 'training') {
            return this.TRAINING_COPY.actions.map((a) => Object.assign({}, a));
        }
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

    _hasRealMorningAnswer(rec) {
        return !!(rec && rec.morningCheck && typeof rec.morningCheck.sleptWell === 'boolean');
    },

    _hasRealEveningField(rec, field, recordKey) {
        if (!rec || !rec.eveningCheck) return false;
        const val = rec.eveningCheck[field];
        if (field === 'waterIntake') return typeof val === 'boolean';
        if (field === 'activityLevel' && this._activityMode(recordKey || rec.date) === 'training' && !rec.eveningCheck.trained) return false;
        return typeof val === 'number' && val >= 1 && val <= 3;
    },

    /** Only a persisted gameData value counts — never skip logs or empty shells. */
    _isQuestionAnswered(recordKey, notifType) {
        const meta = this._slotMetaByType(notifType);
        if (!meta) return false;
        const rec = this._getGameRecord(recordKey);
        if (!rec) return false;
        if (meta.type === 'morning_check') return this._hasRealMorningAnswer(rec);
        return this._hasRealEveningField(rec, meta.saveKind, recordKey);
    },

    _notificationIdForDay(notifType, dayOffset) {
        if (notifType === 'morning_check') return this.MORNING_META.idBase + dayOffset;
        const def = this.EVENING_SLOT_DEFS.find((s) => s.type === notifType);
        return def ? def.idBase + dayOffset : null;
    },

    /** Stable Android/SW tag — new notification replaces previous of same question type. */
    _notificationTagForType(notifType) {
        if (!notifType || String(notifType).indexOf('extra_') === 0) return '';
        return 'gn-' + String(notifType);
    },

    /** Drop older delivered gamification notifications so only the latest per type stays visible. */
    async _dedupeDeliveredGamificationNotifications() {
        if (!this._capacitor) return;
        const { LocalNotifications } = this._capacitor;
        try {
            const result = await LocalNotifications.getDeliveredNotifications();
            const list = (result && result.notifications) || [];
            if (!list.length) return;

            const keepByTag = {};
            list.forEach((n) => {
                const tag = String(n.tag || '');
                if (!tag.startsWith('gn-') || tag.startsWith('gn-extra-') || tag.startsWith('gn-test-')) return;
                const prev = keepByTag[tag];
                if (!prev || Number(n.id) > Number(prev.id)) keepByTag[tag] = n;
            });

            const toCancel = [];
            list.forEach((n) => {
                const tag = String(n.tag || '');
                const keep = keepByTag[tag];
                if (keep && Number(n.id) !== Number(keep.id)) toCancel.push({ id: n.id });
            });
            if (toCancel.length) await LocalNotifications.cancel({ notifications: toCancel });
        } catch (_) {}
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

    /** Старите текстове от запазени настройки → новите (същите стойности, по-човешки думи). */
    LEGACY_COPY: {
        'AI Асистент': 'NutriPlan',
        'Ниво на активност?': 'Колко се движи днес?',
        'Емоционален баланс?': 'Как се чувстваше днес?',
        'Изпи ли поне 2 л вода?': 'Пи ли достатъчно вода днес?',
        'Ниска': 'Малко', 'Умерена': 'Умерено', 'Висока': 'Много',
        'Напрегнат': 'Напрегнато', 'Спокоен': 'Спокойно', 'Позитивен': 'Позитивно'
    },

    _migrateLegacyCopy(cfg) {
        const map = this.LEGACY_COPY;
        const fix = (v) => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v.trim()) ? map[v.trim()] : v);
        Object.keys(cfg).forEach((key) => {
            const v = cfg[key];
            if (typeof v === 'string' && /(Title|Body)$/.test(key)) cfg[key] = fix(v);
            else if (Array.isArray(v) && /Actions$/.test(key)) {
                cfg[key] = v.map((a) => (a && typeof a === 'object' ? Object.assign({}, a, { title: fix(a.title) }) : a));
            }
        });
        return cfg;
    },

    normalizeConfig(raw) {
        const defaults = this._getConfigDefaults();
        const merged = this._migrateLegacyCopy(Object.assign({}, defaults, raw || {}));
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
        merged.morningTitle = this._ensureText(merged.morningTitle, defaults.morningTitle);
        merged.morningBody = this._ensureText(merged.morningBody, defaults.morningBody);
        merged.eveningActivityTitle = this._ensureText(merged.eveningActivityTitle, defaults.eveningActivityTitle);
        merged.eveningActivityBody = this._ensureText(merged.eveningActivityBody, defaults.eveningActivityBody);
        merged.eveningBalanceTitle = this._ensureText(merged.eveningBalanceTitle, defaults.eveningBalanceTitle);
        merged.eveningBalanceBody = this._ensureText(merged.eveningBalanceBody, defaults.eveningBalanceBody);
        merged.eveningWaterTitle = this._ensureText(merged.eveningWaterTitle, defaults.eveningWaterTitle);
        merged.eveningWaterBody = this._ensureText(merged.eveningWaterBody, defaults.eveningWaterBody);
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

    _getEveningSlots(cfg, opts) {
        const normalized = this.normalizeConfig(cfg);
        // Нетрениращ с крачкомер: активността се смята от крачките — без известие.
        // includeActivity: часът на слота е нужен и тогава (въпросът в ден с много крачки).
        const activityMode = this._activityMode(null);
        const keepActivity = !!(opts && opts.includeActivity);
        return this.EVENING_SLOT_DEFS.filter((def) => !(def.type === 'evening_activity' && activityMode === 'steps' && !keepActivity)).map((def) => {
            const prefix = def.type.replace('evening_', '');
            const timeKey = 'evening' + prefix.charAt(0).toUpperCase() + prefix.slice(1) + 'Time';
            const titleKey = timeKey.replace('Time', 'Title');
            const bodyKey = timeKey.replace('Time', 'Body');
            const copy = this.COPY[def.copyKey] || {};
            return {
                type: def.type,
                time: normalized[timeKey] || this._offsetTimeString('20:00', def.defaultOffsetMin),
                title: normalized[titleKey] || copy.title || 'NutriPlan',
                body: def.type === 'evening_activity' && activityMode === 'training' ? this.TRAINING_COPY.body : (normalized[bodyKey] || copy.body || ''),
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
                const morningDisplay = this._notificationDisplayFields('morning_check');
                notifications.push({
                    id: 1000 + day,
                    tag: this._notificationTagForType('morning_check'),
                    channelId: this.MORNING_CHANNEL_ID,
                    title: morningDisplay.title,
                    body:  morningDisplay.body,
                    largeBody: morningDisplay.largeBody,
                    actionTypeId: this.MORNING_ACTION_TYPE_ID,
                    schedule: { at: new Date(morningTs), allowWhileIdle: true },
                    extra: {
                        url: this._buildQuickAnswerUrl('morning_check', { date: recordKey }),
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
                const slotDisplay = this._notificationDisplayFields(slot.type);
                notifications.push({
                    id: slot.idBase + day,
                    tag: this._notificationTagForType(slot.type),
                    channelId: this.EVENING_CHANNEL_ID,
                    title: slotDisplay.title,
                    body:  slotDisplay.body,
                    largeBody: slotDisplay.largeBody,
                    actionTypeId: slot.actionTypeId,
                    schedule: { at: new Date(eveningTs), allowWhileIdle: true },
                    extra: {
                        url: this._buildQuickAnswerUrl(slot.type, { date: recordKey }),
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
                        extra: { url: extra.url || '/plan.html', type: 'extra_' + idx },
                        iconColor: this.BRAND_TEAL
                    });
                }
            }
        });

        // Бутоните на въпроса след хранене — по тона на персоната (всички типове наведнъж).
        await this._registerCapacitorActionTypes();
        this._mealNotifications().forEach((n) => notifications.push(n));
        this._supportNudges().forEach((n) => notifications.push(n));

        this._planReminders().forEach((r) => {
            notifications.push({
                id: this._planReminderId(r.key),
                channelId: this.CHANNEL_ID,
                title: r.title,
                body: r.body,
                schedule: { at: new Date(r.ts), allowWhileIdle: true },
                extra: { url: r.url, type: 'plan_' + r.key },
                iconColor: this.BRAND_TEAL
            });
        });

        try {
            await LocalNotifications.schedule({ notifications });
            this._markScheduleWindowFresh();
            console.log('[GameNotifier] Capacitor: scheduled', notifications.length, 'notifications');
        } catch (e) {
            // Window day-key stays stale so the next app open/resume retries.
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
                const morningDisplay = this._notificationDisplayFields('morning_check');
                schedule.push({
                    ts: morning,
                    title: morningDisplay.title,
                    body:  morningDisplay.body,
                    tag:   this._notificationTagForType('morning_check'),
                    type:  'morning_check',
                    url:   this._buildQuickAnswerUrl('morning_check', { date: recordKey }),
                    recordKey,
                    actions: this._swActionsFromList(morningActions),
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
                const slotDisplay = this._notificationDisplayFields(slot.type);
                schedule.push({
                    ts: evening,
                    title: slotDisplay.title,
                    body:  slotDisplay.body,
                    tag:   this._notificationTagForType(slot.type),
                    type:  slot.type,
                    url:   this._buildQuickAnswerUrl(slot.type, { date: recordKey }),
                    recordKey,
                    actions: this._swActionsFromList(slot.actions),
                    vibrate: [200, 100, 200, 100, 200],
                    requireInteraction: true
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

        this._planReminders().forEach((r) => {
            schedule.push({
                ts: r.ts,
                title: r.title,
                body: r.body,
                tag: 'gn-plan-' + r.key,
                type: 'plan_' + r.key,
                url: r.url,
                vibrate: [200, 100, 200],
                requireInteraction: false
            });
        });

        navigator.serviceWorker.controller.postMessage({
            type: 'SCHEDULE_GAME_NOTIFICATIONS',
            schedule
        });
        this._markScheduleWindowFresh();
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
            const disp = this._notificationDisplayFields('morning_check');
            title = disp.title;
            body  = disp.body;
            url   = this._buildQuickAnswerUrl('morning_check', { date: recordKey });
            actionTypeId = this.MORNING_ACTION_TYPE_ID;
        } else if (slot) {
            const disp = this._notificationDisplayFields(slot.type);
            title = disp.title;
            body  = disp.body;
            url   = this._buildQuickAnswerUrl(slot.type, { date: recordKey });
            actionTypeId = slot.actionTypeId;
        } else if (type === 'evening_check') {
            const disp = this._notificationDisplayFields('evening_water');
            title = disp.title;
            body  = disp.body;
            url   = this._buildQuickAnswerUrl('evening_water', { date: recordKey });
            actionTypeId = this.EVENING_WATER_ACTION_TYPE_ID;
            type = 'evening_water';
        } else {
            title = 'NutriPlan тест';
            body  = 'Тестово известие от GameNotifier.';
            url   = '/plan.html';
        }

        if (this._capacitor) {
            const { LocalNotifications } = this._capacitor;
            const disp = this._notificationDisplayFields(type);
            await LocalNotifications.schedule({ notifications: [{
                id: 9999,
                channelId: this.CHANNEL_ID,
                title: title || disp.title,
                body: body || disp.body,
                largeBody: disp.largeBody,
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
        return actions.map((item) => ({ action: item.id, title: this._notificationActionTitle(item) }));
    },

    /* ------------------------------------------------------------------ */
    /*  Хранения: въпрос след очаквания час на всяко хранене от плана      */
    /* ------------------------------------------------------------------ */

    /** Персоната (persona.js): режим на въпросите, тон, рисков час. */
    _persona() {
        try {
            const P = typeof window !== 'undefined' && window.NutriPlanPersona;
            if (P) return P.current();
            return JSON.parse(localStorage.getItem('np_persona') || 'null');
        } catch (_) { return null; }
    },

    _mealChecksMode() {
        const p = this._persona();
        return (p && p.mealChecks) || 'all';
    },

    _mealChecksEnabled() {
        return this._mealChecksMode() !== 'off';
    },

    _mealQuestion(label) {
        const P = typeof window !== 'undefined' && window.NutriPlanPersona;
        if (P) return P.mealQuestion(this._persona(), label);
        return { title: 'Изяде ли ' + label + '?', yes: 'Да, изядох', no: 'Пропуснах' };
    },

    /** Едно напомняне на ден в рисковия час (само при осезаемо емоционално хранене). */
    _supportNudges() {
        const p = this._persona();
        if (!p || !p.nudge || p.mealChecks === 'off') return [];
        const out = [];
        for (let day = 0; day < this.MEAL_WINDOW_DAYS; day++) {
            const ts = this._tsForDayOffset(day, Math.floor(p.nudge.minute / 60), p.nudge.minute % 60);
            if (ts <= Date.now()) continue;
            out.push({
                id: this.MEAL_ID_BASE + 500 + day,
                channelId: this.CHANNEL_ID,
                title: p.nudge.title,
                body: p.nudge.body,
                schedule: { at: new Date(ts), allowWhileIdle: true },
                extra: { url: '/index.html?app=1&tab=plan', type: 'support_nudge' },
                iconColor: this.BRAND_TEAL
            });
        }
        return out;
    },

    /** Храненията за дата: денят от плана по ден от седмицата (пн = day1), както в plan.html. */
    _plannedMealsForDate(date) {
        let plan = null;
        try { plan = JSON.parse(localStorage.getItem('dietPlan') || 'null'); } catch (_) {}
        const week = plan && plan.weekPlan;
        if (!week) return [];
        const js = date.getDay();
        const day = week['day' + (js === 0 ? 7 : js)] || week.day1;
        const meals = (day && Array.isArray(day.meals) ? day.meals : []).filter((m) => m && m.type && m.type !== 'Напитка');
        const seen = {};
        return meals.map((m) => {
            seen[m.type] = (seen[m.type] || 0) + 1;
            return {
                key: seen[m.type] === 1 ? m.type : m.type + '_' + seen[m.type],
                type: m.type,
                name: String(m.name || '').trim(),
                calories: Math.round(Number(m.calories || m._plannedCalories) || 0)
            };
        });
    },

    _hhmmToMin(t) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
        return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    },

    /**
     * Кога да се пита за храненето: 20 мин след часа, в който клиентът
     * обикновено го отмята (медиана от последните 14 дни, поне 3 пъти);
     * иначе 45 мин след обичайния час за това хранене.
     */
    _mealAskMinute(type) {
        const base = type.replace(/_\d+$/, '');
        const def = this._hhmmToMin(this.MEAL_DEFAULT_TIME[base] || '13:00');
        const samples = [];
        try {
            const all = JSON.parse(localStorage.getItem('gameData') || '{}') || {};
            const cutoff = Date.now() - 14 * 86400000;
            Object.keys(all).forEach((k) => {
                const rec = all[k];
                if (!rec || !rec.mealCheckedAt || Date.parse(k) < cutoff) return;
                Object.keys(rec.mealCheckedAt).forEach((mk) => {
                    if (mk.replace(/_\d+$/, '') !== base) return;
                    const v = this._hhmmToMin(rec.mealCheckedAt[mk]);
                    // Само правдоподобни — не отметки „на куп“ вечерта.
                    if (v != null && Math.abs(v - def) <= 180) samples.push(v);
                });
            });
        } catch (_) {}
        if (samples.length >= 3) {
            samples.sort((a, b) => a - b);
            return samples[Math.floor(samples.length / 2)] + 20;
        }
        return def + this.MEAL_ASK_AFTER_MIN;
    },

    _mealAnswered(rec, mealKey) {
        return !!(rec && ((rec.meals && rec.meals[mealKey] === true) || (rec.mealSkipped && rec.mealSkipped[mealKey])));
    },

    _mealNotifications() {
        if (!this._mealChecksEnabled()) return [];
        const out = [];
        for (let day = 0; day < this.MEAL_WINDOW_DAYS; day++) {
            const date = new Date();
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() + day);
            const recordKey = this._dateKeyForTimestamp(date.getTime());
            const rec = this._getGameRecord(recordKey);
            const mode = this._mealChecksMode();
            this._plannedMealsForDate(date).slice(0, 10).forEach((meal, idx) => {
                if (this._mealAnswered(rec, meal.key)) return;
                // „Основните“: само обядът и вечерята.
                if (mode === 'main' && !/^(Хранене 2|Обяд|Свободно хранене|Хранене 4|Вечеря)(_\d+)?$/.test(meal.key)) return;
                const at = this._mealAskMinute(meal.key);
                const ts = this._tsForDayOffset(day, Math.floor(at / 60), at % 60);
                if (ts <= Date.now()) return;
                const label = this.MEAL_LABEL[meal.type.replace(/_\d+$/, '')] || 'храненето';
                const q = this._mealQuestion(label);
                out.push({
                    id: this.MEAL_ID_BASE + day * 10 + idx,
                    channelId: this.CHANNEL_ID,
                    title: q.title,
                    body: meal.name ? meal.name + ' — отбележи с едно докосване.' : 'Отбележи с едно докосване.',
                    actionTypeId: this.MEAL_ACTION_TYPE_ID,
                    schedule: { at: new Date(ts), allowWhileIdle: true },
                    extra: {
                        url: '/index.html?app=1&tab=plan',
                        type: this.MEAL_TYPE_PREFIX + meal.key,
                        recordKey,
                        calories: meal.calories
                    },
                    iconColor: this.BRAND_TEAL
                });
            });
        }
        return out;
    },

    /** Отметка от приложението — въпросът за това хранене днес отпада. */
    cancelMealCheck(recordKey, mealKey) {
        if (!this._capacitor) return;
        const key = this._normalizeRecordKey(recordKey);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const day = Math.round((Date.parse(key + 'T00:00:00') - today.getTime()) / 86400000);
        if (day < 0 || day >= this.MEAL_WINDOW_DAYS) return;
        const idx = this._plannedMealsForDate(new Date(key + 'T00:00:00')).findIndex((m) => m.key === mealKey);
        if (idx < 0 || idx >= 10) return;
        try {
            this._capacitor.LocalNotifications.cancel({ notifications: [{ id: this.MEAL_ID_BASE + day * 10 + idx }] });
        } catch (_) {}
    },

    _saveMealAnswer(recordKey, mealKey, eaten, calories) {
        const key = this._normalizeRecordKey(recordKey);
        const apply = (rec) => {
            if (!rec.meals) rec.meals = {};
            // Записаният вече ден: само храненията от него (иначе се раздува знаменателят).
            const frozen = Array.isArray(rec.mealSlots) && rec.mealSlots.length > 0;
            if (frozen && !(mealKey in rec.meals)) return false;
            if (eaten) {
                rec.meals[mealKey] = true;
                if (!rec.mealCalories) rec.mealCalories = {};
                const planned = this._plannedMealsForDate(new Date(key + 'T00:00:00')).find((m) => m.key === mealKey);
                const kcal = Math.round(Number(calories) || (planned && planned.calories) || 0);
                if (kcal > 0 && !rec.mealCalories[mealKey]) rec.mealCalories[mealKey] = kcal;
            } else {
                if (!(mealKey in rec.meals)) rec.meals[mealKey] = false;
                if (!rec.mealSkipped) rec.mealSkipped = {};
                rec.mealSkipped[mealKey] = true;
            }
            return true;
        };
        const gm = typeof window !== 'undefined' && window.gameModule;
        if (gm && typeof gm.getRecord === 'function' && typeof gm.saveRecord === 'function') {
            try {
                const rec = gm.getRecord(key);
                if (!apply(rec)) return false;
                gm.saveRecord(key, rec);
                if (typeof gm.recalcAndShowScore === 'function') gm.recalcAndShowScore(key);
                this.notifyAnswerSaved(key);
                return true;
            } catch (_) { /* fall through */ }
        }
        try {
            const allData = JSON.parse(localStorage.getItem('gameData') || '{}') || {};
            const rec = allData[key] || this._emptyGameRecord(key);
            if (!apply(rec)) return false;
            allData[key] = rec;
            localStorage.setItem('gameData', JSON.stringify(allData));
            this.notifyAnswerSaved(key);
            return true;
        } catch (e) {
            console.warn('[GameNotifier] Meal answer save failed:', e);
            return false;
        }
    },

    _saveMorningAnswer(recordKey, sleptWell) {
        const gm = typeof window !== 'undefined' && window.gameModule;
        if (gm && typeof gm.getRecord === 'function' && typeof gm.saveRecord === 'function') {
            try {
                const rec = gm.getRecord(recordKey);
                if (this._hasRealMorningAnswer(rec)) return false;
                rec.morningCheck = { sleptWell: !!sleptWell, ts: new Date().toISOString() };
                gm.saveRecord(recordKey, rec);
                if (typeof gm.recalcAndShowScore === 'function') gm.recalcAndShowScore(recordKey);
                this.notifyAnswerSaved(recordKey);
                return true;
            } catch (_) { /* fall through */ }
        }
        const saved = this._saveQuickAnswer(recordKey, 'morning_check', { sleptWell: !!sleptWell });
        if (saved) this.notifyAnswerSaved(recordKey);
        return saved;
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
                if (this._hasRealEveningField(rec, field, recordKey)) return false;
                this._applyEveningValue(rec.eveningCheck, field, value, recordKey);
                if (!rec.eveningCheck.ts) rec.eveningCheck.ts = new Date().toISOString();
                gm.saveRecord(recordKey, rec);
                if (typeof gm.recalcAndShowScore === 'function') gm.recalcAndShowScore(recordKey);
                this.notifyAnswerSaved(recordKey);
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
            if (this._hasRealEveningField(record, field, key)) return false;
            this._applyEveningValue(record.eveningCheck, field, value, key);
            allData[key] = record;
            localStorage.setItem('gameData', JSON.stringify(allData));
            this.notifyAnswerSaved(key);
            return true;
        } catch (e) {
            console.warn('[GameNotifier] Evening field save failed:', e);
            return false;
        }
    },

    /**
     * Режимът на въпроса за активност (activity-tracker.js): 'training' — „Тренирахте ли днес?“,
     * 'steps' — без въпрос (от крачките), 'ask' — „Колко се движихте днес?“.
     * recordKey: денят (по подразбиране днес) — в ден с много крачки 'steps' става
     * 'training' само в приложението; null — режимът за графика на известията.
     */
    _activityMode(recordKey) {
        try {
            const A = typeof window !== 'undefined' && (window.NutriPlanActivity || (window.top && window.top.NutriPlanActivity));
            if (A && typeof A.mode === 'function') {
                if (recordKey === null) return A.mode();
                return A.mode(this._normalizeRecordKey(recordKey === undefined ? Date.now() : recordKey));
            }
            const data = JSON.parse(localStorage.getItem('userData') || '{}') || {};
            const sport = String(data.sportActivity || '');
            return sport && !/^Никаква/.test(sport) ? 'training' : 'ask';
        } catch (_) {
            return 'ask';
        }
    },

    TRAINING_COPY: {
        body: 'Тренира ли днес?',
        actions: [
            { id: 'train_am', title: 'Да, до обяд', value: 'am' },
            { id: 'train_pm', title: 'Да, следобед', value: 'pm' },
            { id: 'train_no', title: 'Не', value: 'no' }
        ]
    },

    /** Отговорът за тренировка става ниво на деня + оценка на разхода; другите — както са. */
    _applyEveningValue(ec, field, value, recordKey) {
        if (field === 'activityLevel' && (value === 'am' || value === 'pm' || value === 'no')) {
            const A = typeof window !== 'undefined' && (window.NutriPlanActivity || (window.top && window.top.NutriPlanActivity));
            if (A && typeof A.applyAnswer === 'function') {
                A.applyAnswer(ec, value, this._normalizeRecordKey(recordKey));
                return;
            }
            ec.trained = value;
            ec.activityLevel = value === 'no' ? 2 : 3;
            ec.activitySource = 'training';
            return;
        }
        ec[field] = value;
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
                if (this._hasRealMorningAnswer(record)) return false;
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

    _notificationSlotTsForDate(recordKey, notifType) {
        const key = this._normalizeRecordKey(recordKey);
        const cfg = this.normalizeConfig(this._getConfig());
        let timeStr;
        if (notifType === 'morning_check') {
            timeStr = cfg.morningTime || '07:00';
        } else {
            const slot = this._getEveningSlots(cfg, { includeActivity: true }).find((s) => s.type === notifType);
            if (!slot) return null;
            timeStr = slot.time;
        }
        const parts = key.split('-').map(Number);
        const [h, m] = timeStr.split(':').map(Number);
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        d.setHours(h, m, 0, 0);
        return d.getTime();
    },

    _hasNotificationSlotPassed(recordKey, notifType) {
        const ts = this._notificationSlotTsForDate(recordKey, notifType);
        return ts != null && Date.now() >= ts;
    },

    /**
     * Unanswered gamification questions for a calendar day whose notification
     * slot has already fired (ignored / opened-without-answer catch-up).
     */
    getUnansweredTypesForDate(recordKey, options) {
        const opts = options || {};
        const requireSlotPassed = opts.requireSlotPassed !== false;
        const key = this._normalizeRecordKey(recordKey);
        const out = [];
        const activityAsked = this._activityMode(key) !== 'steps';
        this.QUESTION_TYPE_ORDER.forEach((type) => {
            if (type === 'evening_activity' && !activityAsked) return;
            if (this._isQuestionAnswered(key, type)) return;
            if (requireSlotPassed && !this._hasNotificationSlotPassed(key, type)) return;
            out.push(type);
        });
        return out;
    },

    getCatchUpTypesForToday() {
        return this.getUnansweredTypesForDate(this._dateKeyForTimestamp(Date.now()), { requireSlotPassed: true });
    },

    buildCatchUpQuickAnswerUrl(recordKey, types) {
        const key = this._normalizeRecordKey(recordKey);
        const list = types || this.getUnansweredTypesForDate(key, { requireSlotPassed: true });
        if (!list.length) return null;
        return this._buildQuickAnswerUrl(list[0], {
            date: key,
            queue: '1',
            source: 'app'
        });
    },

    shouldUseInAppGamification() {
        if (typeof window === 'undefined' || typeof document === 'undefined') return false;
        const path = window.location.pathname || '';
        if (path.indexOf('plan.html') !== -1) return true;
        if (path.indexOf('index.html') !== -1 && (window.location.search || '').indexOf('app=1') !== -1) return true;
        if (document.documentElement && document.documentElement.getAttribute('data-embedded-tab') === '1') return true;
        try {
            if (window.parent !== window && window.parent.document &&
                window.parent.document.querySelector('[data-tab-view="plan"]')) {
                return true;
            }
        } catch (_) {}
        return false;
    },

    shouldRedirectCatchUpOnOpen() {
        try {
            if (!localStorage.getItem('dietPlan')) return false;
        } catch (_) {
            return false;
        }
        return this.getCatchUpTypesForToday().length > 0;
    },

    _shouldAutoCatchUpOnPage() {
        if (typeof window === 'undefined') return false;
        const path = window.location.pathname || '';
        // Само началната страница пренасочва към бързия въпрос. Книгата с плана,
        // изборът на храни и другите страници се отварят, без да бъдат прекъсвани.
        const file = path.split('/').pop() || 'index.html';
        if (file !== 'index.html') return false;
        try {
            const params = new URLSearchParams(window.location.search || '');
            if (params.has('login') || params.has('logout')) return false;
            if (params.has('stay') && !params.has('app')) return false;
            if (!localStorage.getItem('dietPlan')) return false;
            if (!localStorage.getItem('userId')) return false;
        } catch (_) {
            return false;
        }
        return true;
    },

    _navigateToCatchUpUrl(url) {
        const target = String(url).replace(/^\//, '');
        try {
            if (window.top && window.top !== window) {
                window.top.location.replace(target);
            } else {
                window.location.replace(target);
            }
        } catch (_) {
            window.location.replace(target);
        }
    },

    redirectToCatchUpIfNeeded() {
        if (!this._shouldAutoCatchUpOnPage()) return false;
        if (this.shouldUseInAppGamification()) return false;
        const url = this.buildCatchUpQuickAnswerUrl(this._dateKeyForTimestamp(Date.now()));
        if (!url) return false;
        this._navigateToCatchUpUrl(url);
        return true;
    },

    /**
     * Cross-platform open/resume flow: drain queued heads-up taps, then redirect
     * to quick-answer catch-up for any still-unanswered same-day questions.
     */
    async runOpenAppCatchUpFlow() {
        if (!this._shouldAutoCatchUpOnPage()) return false;
        try {
            if (!localStorage.getItem('dietPlan')) return false;
        } catch (_) {
            return false;
        }
        if (window.__nutriplanCatchUpInFlight) {
            return window.__nutriplanCatchUpInFlight;
        }
        const self = this;
        window.__nutriplanCatchUpInFlight = (async () => {
            try {
                if (!self._initialized) await self.init();
                await self.drainAllPendingActions();
                return self.redirectToCatchUpIfNeeded();
            } catch (_) {
                return false;
            } finally {
                setTimeout(() => { window.__nutriplanCatchUpInFlight = null; }, 1500);
            }
        })();
        return window.__nutriplanCatchUpInFlight;
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

    (function bootstrapCatchUpOnAppPages() {
        if (typeof document === 'undefined') return;

        function scheduleCatchUp() {
            if (!GameNotifier._shouldAutoCatchUpOnPage()) return;
            if (GameNotifier.shouldUseInAppGamification()) return;
            try {
                if (!localStorage.getItem('dietPlan')) return;
            } catch (_) {
                return;
            }
            GameNotifier.runOpenAppCatchUpFlow();
        }

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') return;
            if (GameNotifier.shouldUseInAppGamification()) return;
            scheduleCatchUp();
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', scheduleCatchUp, { once: true });
        } else {
            setTimeout(scheduleCatchUp, 50);
        }
    })();
}
