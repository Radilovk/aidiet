(function () {
    'use strict';

    var params = new URLSearchParams(window.location.search);
    if (params.has('embedded')) {
        if (window.NutriPlanDiagnostics) {
            window.NutriPlanDiagnostics.ensureSession('shell');
            window.NutriPlanDiagnostics.info('shell', 'embedded-tab-ready', window.location.pathname.split('/').pop() || 'unknown');
        }
        document.documentElement.setAttribute('data-embedded-tab', '1');
        window.parent && window.parent.postMessage({ type: 'NUTRIPLAN_TAB_READY' }, window.location.origin);
        return;
    }

    var TAB_ROUTES = {
        plan: 'plan.html',
        guidelines: 'guidelines.html',
        profile: 'profile.html',
        analytics: 'game-analytics.html'
    };
    var FRAME_SOURCES = {
        plan: 'plan.html?embedded=1',
        guidelines: 'guidelines.html?embedded=1',
        profile: 'profile.html?embedded=1',
        analytics: 'game-analytics.html?embedded=1'
    };
    var STORAGE_KEYS = (window.NutriPlanSession && typeof window.NutriPlanSession.getManagedStorageKeys === 'function'
        ? window.NutriPlanSession.getManagedStorageKeys()
        : [
        'dietPlan',
        'userId',
        'userData',
        'pendingClientId',
        'planJobId',
        'planJobSource',
        'pendingPlanPayload',
        'planHistory',
        'questionnaireAnswers',
        'warningData',
        'canProceedWithWarning',
        'validationSource',
        'planJustification',
        'longTermStrategy',
        'modifierReasoning',
        'hydrationStrategy',
        'mealCountJustification',
        'afterDinnerMealJustification',
        'planSource',
        'hasSeenPlanJustification',
        'authKvSynced',
        'np_profile_synced',
        'np_profile_sync_sig',
        'planSyncPending',
        'theme',
        'colorScheme',
        'gameEnabled',
        'gameData',
        'gameWeeklyAI',
        'gameNotifierConfig'
    ]).slice();
    var state = {
        initialized: false,
        activeTab: 'plan',
        scroll: Object.create(null),
        raw: Object.create(null),
        parsed: Object.create(null)
    };
    var shellChatFrame = null;
    var _shellChatVpHandler = null;
    var deferredPreloadScheduled = false;
    var nativeNotificationBridgeBound = false;

    function getPreferences() {
        return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences
            ? window.Capacitor.Plugins.Preferences
            : null;
    }

    function safeParse(value) {
        if (!value || typeof value !== 'string') return null;
        try {
            return JSON.parse(value);
        } catch (_) {
            return null;
        }
    }

    async function readPreference(preferences, key) {
        if (!preferences || !preferences.get) return null;
        try {
            var result = await preferences.get({ key: key });
            return result && typeof result.value === 'string' ? result.value : null;
        } catch (_) {
            return null;
        }
    }

    async function writePreference(preferences, key, value) {
        if (!preferences || !preferences.set || typeof value !== 'string') return;
        try {
            await preferences.set({ key: key, value: value });
        } catch (_) {
            /* localStorage remains the source of truth if native preferences fail */
        }
    }

    async function cacheJsonAtStartup() {
        var preferences = getPreferences();
        var writes = [];

        for (var i = 0; i < STORAGE_KEYS.length; i++) {
            var key = STORAGE_KEYS[i];
            var localValue = localStorage.getItem(key);
            var value = localValue || await readPreference(preferences, key);

            if (value) {
                state.raw[key] = value;
                state.parsed[key] = safeParse(value);
                if (!localValue) localStorage.setItem(key, value);
                if (localValue) writes.push([key, localValue]);
            }
        }

        // Резервното копие в Preferences (целият план минава през моста към Android)
        // не бива да бави показването на плана — записва се след като се отвори.
        if (writes.length && preferences) {
            setTimeout(function () {
                writes.forEach(function (entry) { writePreference(preferences, entry[0], entry[1]); });
            }, 3000);
        }
        if (window.NutriPlanDiagnostics) {
            window.NutriPlanDiagnostics.ok('shell', 'cache-startup-data', Object.keys(state.raw).length + ' keys');
        }
        window.NutriPlanAppData = {
            raw: state.raw,
            parsed: state.parsed,
            get: function (key) { return state.parsed[key] || null; },
            getRaw: function (key) { return state.raw[key] || null; }
        };
    }

    async function ensureNativeStorageReady() {
        if (typeof window.NativeBackup === 'undefined' || !window.NativeBackup || typeof window.NativeBackup.init !== 'function') {
            return;
        }
        await window.NativeBackup.init().catch(function () {});
    }

    function getStoredValue(key) {
        var localValue = localStorage.getItem(key);
        if (localValue !== null) return localValue;
        return Object.prototype.hasOwnProperty.call(state.raw, key) ? state.raw[key] : null;
    }

    function getPreferredTheme() {
        return getStoredValue('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }

    function setDocumentTheme(targetDocument, theme) {
        if (!targetDocument) return;
        var root = targetDocument.documentElement;
        if (root) root.setAttribute('data-theme', theme);
        if (typeof targetDocument.querySelectorAll === 'function') {
            var color = theme === 'dark' ? '#0A1A1A' : '#F0FDFA';
            targetDocument.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
                meta.setAttribute('content', color);
            });
        }
    }

    /**
     * Системните ленти на Android (статус бар и навигация) следват екрана —
     * тема, отворен лист. Докато се вижда стартовият екран, остават в неговия
     * цвят; последната заявка се прилага, щом той изчезне.
     */
    var pendingBars = null;
    function setSystemNavColor(color) {
        var light = color === '#F0FDFA';
        if (document.documentElement.classList.contains('app-booting')) {
            if (!pendingBars) {
                // Стартовият екран може да изчезне и по резервния таймер в index.html.
                var obs = new MutationObserver(function () {
                    if (document.documentElement.classList.contains('app-booting')) return;
                    obs.disconnect();
                    if (pendingBars) { var b = pendingBars; pendingBars = null; setSystemNavColor(b.color); }
                });
                obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            }
            pendingBars = { color: color, light: light };
            return;
        }
        var platform = window.NutriPlanPlatform;
        if (platform && typeof platform.setSystemBars === 'function') platform.setSystemBars(color, light);
    }

    function themeNavColor() {
        return (state.raw.theme || getPreferredTheme()) === 'dark' ? '#0A1A1A' : '#F0FDFA';
    }

    /** Дърпане за обновяване в плана: принудителна проверка за нова версия. */
    function runPullRefresh(sourceWindow) {
        var frame = document.querySelector('[data-tab-view="plan"]');
        var reply = function (status) {
            if (frame) dispatchFrameEvent(frame, 'NUTRIPLAN_PULL_REFRESH_DONE', { status: status });
        };
        var sync = window.NutriPlanPlanSync;
        var uid = getStoredValue('userId') || '';
        if (!sync || !uid || typeof sync.maybeDailyPlanVersionCheck !== 'function') { reply('current'); return; }
        sync.maybeDailyPlanVersionCheck(uid, Object.assign({}, buildPlanSyncOptions(), { force: true }))
            .then(function (result) {
                if (result && result.weeklyShown) { reply('updated'); return; }
                if (result && result.pending) {
                    reply('updated');
                    promptAdminPlanUpdate(result.planUpdatedAt || '');
                    return;
                }
                reply(result && result.checked === false && result.reason !== 'recent' ? 'error' : 'current');
            })
            .catch(function () { reply('error'); });
    }

    function applyTheme(theme, persist) {
        theme = theme || getPreferredTheme();
        // Записва се само изричен избор — иначе темата следва телефона (светла/тъмна).
        if (persist) localStorage.setItem('theme', theme);
        state.raw.theme = theme;
        state.parsed.theme = theme;
        setDocumentTheme(document, theme);

        setSystemNavColor(theme === 'dark' ? '#0A1A1A' : '#F0FDFA');

        document.querySelectorAll('[data-tab-view]').forEach(function (frame) {
            try {
                var frameWindow = frame.contentWindow;
                var frameDocument = frame.contentDocument;
                if (frameWindow && typeof frameWindow.initializeTheme === 'function') {
                    frameWindow.initializeTheme();
                    if (typeof frameWindow.applyGameAnalyticsColorScheme === 'function') {
                        frameWindow.applyGameAnalyticsColorScheme();
                    }
                } else if (frameDocument) {
                    setDocumentTheme(frameDocument, theme);
                }
            } catch (_) {}
        });
    }

    function normalizeTab(tab) {
        return TAB_ROUTES[tab] ? tab : 'plan';
    }

    function tabFromUrl(url) {
        var path = url.pathname.split('/').pop() || 'index.html';
        for (var tab in TAB_ROUTES) {
            if (TAB_ROUTES[tab] === path) return tab;
        }
        // Also handle index.html?app=1&tab=X format used in bottom-nav links
        if (path === 'index.html' || path === '') {
            var tabParam = url.searchParams.get('tab');
            if (tabParam && TAB_ROUTES[tabParam]) return tabParam;
        }
        return null;
    }

    function ensureFrameLoaded(tab) {
        var normalizedTab = normalizeTab(tab);
        var frame = document.querySelector('[data-tab-view="' + normalizedTab + '"]');
        if (!frame) return null;
        var expectedSrc = FRAME_SOURCES[normalizedTab] || FRAME_SOURCES.plan;
        var currentSrc = frame.getAttribute('src');
        if (!currentSrc) {
            frame.setAttribute('src', expectedSrc);
            return frame;
        }
        try {
            var currentUrl = new URL(currentSrc, window.location.href);
            var currentPath = currentUrl.pathname.split('/').pop() || '';
            if (currentPath !== (TAB_ROUTES[normalizedTab] || '')) {
                frame.setAttribute('src', expectedSrc);
            }
        } catch (_) {
            frame.setAttribute('src', expectedSrc);
        }
        return frame;
    }

    function scheduleDeferredFramePreload(initialTab) {
        if (deferredPreloadScheduled) return;
        deferredPreloadScheduled = true;
        var preload = function () {
            Object.keys(FRAME_SOURCES).filter(function (tab) {
                return tab !== initialTab;
            }).forEach(function (tab, index) {
                window.setTimeout(function () {
                    ensureFrameLoaded(tab);
                }, index * 180);
            });
        };
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(preload, { timeout: 1200 });
        } else {
            window.setTimeout(preload, 450);
        }
    }

    function getNotificationRecordKey(recordKey) {
        if (typeof recordKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(recordKey)) return recordKey;
        var d = new Date();
        var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function forwardSilentRecalc(payload) {
        var frame = ensureFrameLoaded('plan');
        if (!frame) return false;
        try {
            var frameWindow = frame.contentWindow;
            var gm = frameWindow && frameWindow.gameModule;
            if (!gm || typeof gm.recalcAndShowScore !== 'function') return false;
            var recordKey = payload && payload.recordKey;
            if (typeof recordKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(recordKey)) {
                var d = new Date();
                var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
                recordKey = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
            }
            gm.recalcAndShowScore(recordKey);
            return true;
        } catch (_) {
            return false;
        }
    }

    function forwardNativeNotificationToPlan(payload) {
        var frame = ensureFrameLoaded('plan');
        if (!frame) return false;
        try {
            var frameWindow = frame.contentWindow;
            if (!frameWindow || typeof frameWindow.NutriPlanHandleNotificationAction !== 'function') {
                return false;
            }
            switchTab('plan', true);
            frameWindow.NutriPlanHandleNotificationAction(payload);
            return true;
        } catch (_) {
            return false;
        }
    }

    function extractNotificationActionId(event) {
        if (window.GameNotifier && typeof window.GameNotifier.extractCapacitorActionId === 'function') {
            return window.GameNotifier.extractCapacitorActionId(event);
        }
        var id = event && typeof event.actionId === 'string' ? event.actionId : '';
        if (id === 'tap') return '';
        return id;
    }

    function dismissAfterSilentHeadUp() {
        if (window.GameNotifier && typeof window.GameNotifier._dismissAfterSilentHeadUp === 'function') {
            window.GameNotifier._dismissAfterSilentHeadUp();
            return;
        }
        try {
            document.documentElement.style.visibility = 'hidden';
            if (window.history.length > 1) window.history.back();
        } catch (_) {}
    }

    function handleNativeNotificationAction(payload) {
        var gn = window.GameNotifier;
        if (!gn || typeof gn.handleNotificationAction !== 'function') return false;
        var outcome = gn.handleNotificationAction(payload);
        if (!outcome.silent) return false;
        if (outcome.ack && typeof gn.showSilentAck === 'function') {
            gn.showSilentAck(outcome.ack);
        }
        dismissAfterSilentHeadUp();
        return true;
    }

    function initApkGameNotifier() {
        if (!window.GameNotifier || typeof window.GameNotifier.init !== 'function') return Promise.resolve(false);
        var cap = window.Capacitor;
        if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) {
            return Promise.resolve(false);
        }
        return window.GameNotifier.init().catch(function () { return false; });
    }

    function runOpenAppCatchUpFlow() {
        var gn = window.GameNotifier;
        if (!gn || typeof gn.runOpenAppCatchUpFlow !== 'function') {
            return Promise.resolve(false);
        }
        return gn.runOpenAppCatchUpFlow();
    }

    function buildPlanSyncOptions() {
        var opts = {};
        var uid = getStoredValue('userId') || '';
        if (uid.indexOf('fb_') === 0 && window.__npPlanAuth && window.__npPlanAuth.currentUser) {
            opts.getIdToken = function () { return window.__npPlanAuth.currentUser.getIdToken(); };
        }
        return opts;
    }

    function reloadPlanFrameIfUpdated(result) {
        if (!result || (!result.updated && !result.applied)) return;
        refreshPlanTab(result);
    }

    function refreshPlanTab(result) {
        var planFrame = document.querySelector('[data-tab-view="plan"]');
        if (!planFrame || !planFrame.contentWindow) return;
        try {
            if (typeof planFrame.contentWindow.loadDietData === 'function') {
                planFrame.contentWindow.loadDietData({ force: true });
            }
            if (result && result.notice) {
                dispatchFrameEvent(planFrame, 'NUTRIPLAN_WEEKLY_ADAPT_READY', result.notice);
            } else {
                dispatchFrameEvent(planFrame, 'NUTRIPLAN_PLAN_SYNCED', { weekly: !!(result && result.planApplied) });
            }
        } catch (_) {}
    }

    function confirmPlanUpdateFromNotification(planUpdatedAt) {
        var sync = window.NutriPlanPlanSync;
        var uid = getStoredValue('userId') || '';
        if (!sync || typeof sync.confirmPlanUpdate !== 'function' || uid.indexOf('fb_') !== 0) {
            return Promise.resolve({ updated: false });
        }
        if (planUpdatedAt && typeof sync.markPlanUpdatePending === 'function') {
            sync.markPlanUpdatePending(planUpdatedAt);
        }
        if (params.has('app')) switchTab('plan', true);
        return sync.confirmPlanUpdate(uid, buildPlanSyncOptions())
            .then(function (result) {
                reloadPlanFrameIfUpdated(result);
                return result;
            });
    }

    function promptAdminPlanUpdate(planUpdatedAt) {
        var sync = window.NutriPlanPlanSync;
        var uid = getStoredValue('userId') || '';
        if (!sync || typeof sync.markPlanUpdatePending !== 'function') return;
        sync.markPlanUpdatePending(planUpdatedAt || '');
        if (params.has('app')) switchTab('plan', true);
        if (typeof sync.showPlanUpdatePrompt === 'function') {
            sync.showPlanUpdatePrompt(uid, buildPlanSyncOptions())
                .then(function (outcome) {
                    reloadPlanFrameIfUpdated(outcome && outcome.result);
                });
        }
    }

    function runPlanUpdateCatchUp() {
        var sync = window.NutriPlanPlanSync;
        var uid = getStoredValue('userId') || '';
        if (!sync || !uid) return Promise.resolve(false);
        var opts = buildPlanSyncOptions();
        var weeklyFirst = (typeof sync.maybeCheckWeeklyAdaptNotice === 'function')
            ? sync.maybeCheckWeeklyAdaptNotice(uid, opts)
            : Promise.resolve({ applied: false });
        return weeklyFirst.then(function (weekly) {
            if (weekly && weekly.applied) {
                refreshPlanTab(weekly);
                return true;
            }
            return sync.maybeDailyPlanVersionCheck(uid, Object.assign({}, opts, { weeklyAlreadyChecked: true }))
                .then(function (result) {
                    if (result && result.pending) {
                        promptAdminPlanUpdate(result.planUpdatedAt || '');
                        return true;
                    }
                    if (sync.hasPlanUpdatePending && sync.hasPlanUpdatePending()) {
                        if (typeof sync.maybePromptPendingPlanUpdate === 'function') {
                            sync.maybePromptPendingPlanUpdate(uid, buildPlanSyncOptions())
                                .then(function (outcome) {
                                    reloadPlanFrameIfUpdated(outcome && outcome.result);
                                });
                        }
                        return true;
                    }
                    return false;
                })
                .catch(function () { return false; });
        });
    }

    function bindCatchUpOnResume() {
        if (window.__nutriplanCatchUpResumeBound) return;
        window.__nutriplanCatchUpResumeBound = true;
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') return;
            if (!params.has('app')) return;
            if (!state.initialized) {
                runOpenAppCatchUpFlow();
                return;
            }
            // Приложението е било на заден план: ново седмично меню или промяна от
            // специалиста се показва веднага (известие в приложението), без logout.
            // Най-много веднъж на 15 минути — едно KV четене на проверка.
            var nowMs = Date.now();
            if (nowMs - (window.__nutriplanResumeCheckAt || 0) < 15 * 60 * 1000) return;
            window.__nutriplanResumeCheckAt = nowMs;
            runPlanUpdateCatchUp().catch(function () {});
        });
    }

    function openQuickAnswerFromNotification(msg) {
        var gn = window.GameNotifier;
        var type = (msg && (msg.notificationType || msg.type)) || '';
        var recordKey = getNotificationRecordKey(msg && msg.recordKey);
        if (!type) return false;
        var qaType = type === 'evening_check' ? 'evening_water' : type;
        var path = gn && typeof gn._buildQuickAnswerUrl === 'function'
            ? gn._buildQuickAnswerUrl(qaType, { date: recordKey })
            : '/quick-answer.html?type=' + encodeURIComponent(qaType) + '&date=' + encodeURIComponent(recordKey);
        window.location.replace(path.replace(/^\//, ''));
        return true;
    }

    function bindNativeNotificationBridge() {
        if (nativeNotificationBridgeBound) return;
        if (window.__nutriplanNotificationLaunch) {
            nativeNotificationBridgeBound = true;
            return;
        }
        var cap = window.Capacitor;
        if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
        var localNotifications = (cap.Plugins || {}).LocalNotifications || null;
        if (!localNotifications && typeof cap.registerPlugin === 'function') {
            try {
                localNotifications = cap.registerPlugin('LocalNotifications');
            } catch (_) {
                localNotifications = null;
            }
        }
        if (!localNotifications || typeof localNotifications.addListener !== 'function') return;
        localNotifications.addListener('localNotificationActionPerformed', function (event) {
            var notification = event && event.notification ? event.notification : {};
            var extra = notification.extra || {};
            var actionId = extractNotificationActionId(event);
            var payload = {
                notificationType: extra.type || extra.notificationType || '',
                action: actionId,
                recordKey: extra.recordKey || ''
            };
            if (payload.notificationType === 'plan_updated') {
                if (actionId === 'plan_load') {
                    confirmPlanUpdateFromNotification(extra.planUpdatedAt || '');
                } else {
                    promptAdminPlanUpdate(extra.planUpdatedAt || '');
                }
                return;
            }
            if (actionId) {
                if (handleNativeNotificationAction(payload)) return;
                openQuickAnswerFromNotification(payload);
                return;
            }
            if (openQuickAnswerFromNotification(payload)) return;
            if (forwardNativeNotificationToPlan(payload)) return;
            switchTab('plan', true);
        });
        nativeNotificationBridgeBound = true;
    }

    function bindSwNotificationBridge() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.addEventListener('message', function (event) {
            var msg = event.data;
            if (!msg) return;
            if (msg.type === 'PLAN_UPDATE_CONFIRM') {
                confirmPlanUpdateFromNotification(msg.planUpdatedAt || '');
                return;
            }
            if (msg.type === 'NUTRIPLAN_PLAN_UPDATE_PENDING') {
                promptAdminPlanUpdate(msg.planUpdatedAt || '');
                return;
            }
            if (msg.type !== 'NOTIFICATION_ACTION') return;
            var payload = {
                notificationType: msg.notificationType || '',
                action: msg.action || '',
                recordKey: msg.recordKey || ''
            };
            if (payload.notificationType === 'plan_updated') {
                if (payload.action === 'plan_load') {
                    confirmPlanUpdateFromNotification(msg.planUpdatedAt || '');
                    return;
                }
                if (payload.action === 'plan_later') return;
            }
            if (msg.silent && payload.action) {
                if (handleNativeNotificationAction(payload)) return;
                return;
            }
            if (msg.openApp || !payload.action) {
                if (payload.notificationType === 'plan_updated') {
                    promptAdminPlanUpdate(msg.planUpdatedAt || '');
                    return;
                }
                openQuickAnswerFromNotification(payload);
            }
        });
    }

    function dispatchFrameEvent(frame, type, detail) {
        try {
            var frameWindow = frame && frame.contentWindow;
            if (frameWindow && typeof frameWindow.dispatchEvent === 'function' && typeof frameWindow.CustomEvent === 'function') {
                frameWindow.dispatchEvent(new frameWindow.CustomEvent(type, { detail: detail || {} }));
            }
        } catch (_) {}
    }

    function replayBodyFade(frameWindow, frameDocument) {
        if (!frameDocument || !frameDocument.body) return;
        frameDocument.body.style.transition = 'none';
        frameDocument.body.style.opacity = '0';
        frameWindow.requestAnimationFrame(function () {
            frameWindow.requestAnimationFrame(function () {
                frameDocument.body.style.transition = 'opacity 120ms ease-out';
                frameDocument.body.style.opacity = '1';
            });
        });
    }

    function replayRevealSections(frameWindow, frameDocument) {
        var sections = frameDocument.querySelectorAll('.reveal');
        if (!sections.length) return;
        sections.forEach(function (section) {
            section.classList.remove('active');
        });
        frameWindow.requestAnimationFrame(function () {
            var viewportHeight = frameWindow.innerHeight || frameDocument.documentElement.clientHeight || 0;
            sections.forEach(function (section) {
                var rect = section.getBoundingClientRect();
                if (rect.top < viewportHeight - 150) {
                    section.classList.add('active');
                }
            });
        });
    }

    function replayGaAnimations(frameWindow, frameDocument) {
        var animatedCards = Array.prototype.slice.call(frameDocument.querySelectorAll('.ga-card-enter'));
        if (animatedCards.length) {
            animatedCards.forEach(function (el, index) {
                if (frameWindow.getComputedStyle(el).display === 'none') return;
                el.style.animation = 'none';
                void el.offsetWidth;
                el.style.animation = '';
                el.style.animationDelay = (index * 0.07) + 's';
            });
        }

        var ringOffsets = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-ring-offset]'));
        var ringTargets = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-ring-target]'));
        var barWidths = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-bar]'));
        var barHeights = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-bar-h]'));
        var bidirHeights = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-bidir-h]'));
        if (!ringOffsets.length && !ringTargets.length && !barWidths.length && !barHeights.length && !bidirHeights.length) return;

        ringOffsets.forEach(function (el) {
            var startOffset = el.getAttribute('stroke-dasharray');
            if (startOffset) el.style.strokeDashoffset = startOffset;
        });
        ringTargets.forEach(function (el) {
            var target = parseInt(el.getAttribute('data-ga-ring-target'), 10);
            el.textContent = isNaN(target) ? '?' : '0%';
        });
        barWidths.forEach(function (el) {
            el.style.width = '0%';
        });
        barHeights.forEach(function (el) {
            el.style.height = '0px';
        });
        bidirHeights.forEach(function (el) {
            el.style.height = '0px';
        });

        var GA_RING_START = 120;
        var GA_RING_STAGGER = 130;
        var GA_RING_COUNTER = 900;
        var GA_BAR_START = 350;
        var GA_BAR_STAGGER = 60;
        var GA_CHART_START = 400;
        var GA_CHART_STAGGER = 25;

        frameWindow.requestAnimationFrame(function () {
            frameWindow.requestAnimationFrame(function () {
                ringOffsets.forEach(function (el, i) {
                    frameWindow.setTimeout(function () {
                        el.style.strokeDashoffset = el.getAttribute('data-ga-ring-offset');
                    }, GA_RING_START + i * GA_RING_STAGGER);
                });

                ringTargets.forEach(function (el, i) {
                    var target = parseInt(el.getAttribute('data-ga-ring-target'), 10);
                    if (isNaN(target)) return;
                    var start = GA_RING_START + i * GA_RING_STAGGER;
                    var startTime = null;
                    function step(ts) {
                        if (!startTime) startTime = ts;
                        var progress = Math.min((ts - startTime) / GA_RING_COUNTER, 1);
                        var ease = 1 - Math.pow(1 - progress, 3);
                        el.textContent = Math.round(target * ease) + '%';
                        if (progress < 1) frameWindow.requestAnimationFrame(step);
                    }
                    frameWindow.setTimeout(function () {
                        frameWindow.requestAnimationFrame(step);
                    }, start);
                });

                barWidths.forEach(function (el, i) {
                    frameWindow.setTimeout(function () {
                        el.style.width = el.getAttribute('data-ga-bar') + '%';
                    }, GA_BAR_START + i * GA_BAR_STAGGER);
                });
                barHeights.forEach(function (el, i) {
                    frameWindow.setTimeout(function () {
                        el.style.height = el.getAttribute('data-ga-bar-h');
                    }, GA_CHART_START + i * GA_CHART_STAGGER);
                });
                bidirHeights.forEach(function (el, i) {
                    frameWindow.setTimeout(function () {
                        el.style.height = el.getAttribute('data-ga-bidir-h');
                    }, GA_CHART_START + i * GA_CHART_STAGGER);
                });
            });
        });
    }

    function replayTabAnimations(frame) {
        var frameWindow = frame && frame.contentWindow;
        var frameDocument = frame && frame.contentDocument;
        if (!frameWindow || !frameDocument) return;

        replayBodyFade(frameWindow, frameDocument);
        replayRevealSections(frameWindow, frameDocument);
        replayGaAnimations(frameWindow, frameDocument);
    }

    function shouldReplayTabAnimations(tab) {
        return tab !== 'plan';
    }

    /** Отстъпите за изреза/статус лентата на телефона, измерени в горния прозорец. */
    function readSafeAreaInsets() {
        // По-голямото от env() и --safe-area-inset-* (Capacitor на Android подава
        // отстъпите като CSS променливи, когато WebView-то не поддържа env()).
        function measure(css) {
            var probe = document.createElement('div');
            probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;' + css;
            document.body.appendChild(probe);
            var cs = getComputedStyle(probe);
            var out = {
                top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
                bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0
            };
            probe.remove();
            return out;
        }
        var fromEnv = measure('padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);');
        var fromVar = measure('padding:var(--safe-area-inset-top,0px) var(--safe-area-inset-right,0px) var(--safe-area-inset-bottom,0px) var(--safe-area-inset-left,0px);');
        return {
            top: Math.max(fromEnv.top, fromVar.top) + 'px',
            right: Math.max(fromEnv.right, fromVar.right) + 'px',
            bottom: Math.max(fromEnv.bottom, fromVar.bottom) + 'px',
            left: Math.max(fromEnv.left, fromVar.left) + 'px'
        };
    }

    /**
     * В iframe env(safe-area-inset-*) винаги е 0 — без това заглавията на табовете
     * влизат под статус лентата/изреза на телефона. Табовете свършват над долната
     * навигация, затова долният отстъп им е 0; чатът е на цял екран и го получава.
     */
    function applyFrameSafeArea(frame) {
        try {
            var root = frame.contentDocument && frame.contentDocument.documentElement;
            if (!root) return;
            var insets = readSafeAreaInsets();
            var fullScreen = frame.id === 'spaShellChatFrame';
            root.style.setProperty('--safe-area-inset-top', insets.top);
            root.style.setProperty('--safe-area-inset-right', insets.right);
            root.style.setProperty('--safe-area-inset-left', insets.left);
            if (fullScreen) root.style.setProperty('--safe-area-inset-bottom', insets.bottom);
        } catch (_) {}
    }

    function patchFrame(frame) {
        var frameWindow = frame.contentWindow;
        var frameDocument = frame.contentDocument;
        if (!frameWindow || !frameDocument) return;
        applyFrameSafeArea(frame);

        try {
            var frameUrl = new URL(frameWindow.location.href, window.location.href);
            if (frameUrl.origin === window.location.origin && frameUrl.searchParams.has('embedded')) {
                frameDocument.documentElement.setAttribute('data-embedded-tab', '1');
            }
        } catch (_) {}

        var style = frameDocument.getElementById('spaEmbeddedPatch');
        if (!style) {
            style = frameDocument.createElement('style');
            style.id = 'spaEmbeddedPatch';
            style.textContent = 'body{opacity:1!important}.bottom-nav{display:none!important}.fab-chat,.fab-food{bottom:calc(16px + var(--safe-area-inset-bottom,0px))!important}';
            frameDocument.head.appendChild(style);
        }

        frameWindow.NutriPlanAppData = window.NutriPlanAppData;
        frameDocument.addEventListener('click', function (event) {
            var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (!link) return;
            var targetUrl;
            try {
                targetUrl = new URL(link.getAttribute('href'), frameWindow.location.href);
            } catch (_) {
                return;
            }
            if (targetUrl.origin !== window.location.origin) return;
            var targetTab = tabFromUrl(targetUrl);
            if (!targetTab) return;
            event.preventDefault();
            var targetFrame = ensureFrameLoaded(targetTab);
            if (targetFrame) {
                var search = new URLSearchParams(targetUrl.search);
                search.delete('app');
                search.delete('tab');
                search.set('embedded', '1');
                var targetPath = TAB_ROUTES[targetTab] || (targetUrl.pathname.split('/').pop() || 'index.html');
                var nextSrc = targetPath + (search.toString() ? '?' + search.toString() : '') + (targetUrl.hash || '');
                if (targetFrame.getAttribute('src') !== nextSrc) {
                    targetFrame.setAttribute('src', nextSrc);
                }
            }
            switchTab(targetTab, true);
        }, true);
    }

    function ensureShellChatOverlay() {
        if (shellChatFrame) return;
        var shell = document.getElementById('spaShell');
        if (!shell) return;
        var el = document.createElement('iframe');
        el.id = 'spaShellChatFrame';
        el.title = 'Чат асистент';
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;border:0;z-index:10003;display:none;overflow:hidden;background:var(--bg-color,#F0FDFA);';
        shell.appendChild(el);
        shellChatFrame = el;

        // Keep fullscreen chat aligned with visual viewport (mobile keyboard)
        var syncFrame = function() {
            if (!shellChatFrame || shellChatFrame.style.display === 'none') return;
            if (window.visualViewport) {
                var vv = window.visualViewport;
                shellChatFrame.style.top = vv.offsetTop + 'px';
                shellChatFrame.style.left = vv.offsetLeft + 'px';
                shellChatFrame.style.width = vv.width + 'px';
                shellChatFrame.style.height = vv.height + 'px';
            } else {
                shellChatFrame.style.top = '0';
                shellChatFrame.style.left = '0';
                shellChatFrame.style.width = '100%';
                shellChatFrame.style.height = '100%';
            }
        };
        _shellChatVpHandler = syncFrame;
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', syncFrame);
            window.visualViewport.addEventListener('scroll', syncFrame);
        } else {
            syncFrame._baseH = window.innerHeight;
            window.addEventListener('resize', syncFrame);
        }
    }

    var shellChatLoaded = false;
    var shellChatOpenPending = false;

    /** Зарежда прозореца на чата (preload = без да го отваря). */
    function loadShellChatFrame(preload) {
        ensureShellChatOverlay();
        if (!shellChatFrame || shellChatFrame.getAttribute('src')) return;
        shellChatFrame.addEventListener('load', function onShellChatLoad() {
            shellChatFrame.removeEventListener('load', onShellChatLoad);
            shellChatLoaded = true;
            applyFrameSafeArea(shellChatFrame);
            try {
                if (shellChatFrame.contentWindow) {
                    shellChatFrame.contentWindow.NutriPlanAppData = window.NutriPlanAppData;
                }
            } catch (_) {}
            if (shellChatOpenPending) {
                shellChatOpenPending = false;
                dispatchShellChatOpen();
            }
        });
        shellChatFrame.setAttribute('src', 'plan.html?chat=1&embedded=1&shellChat=1' + (preload ? '&preload=1' : ''));
    }

    function dispatchShellChatOpen() {
        try {
            shellChatFrame.contentWindow.NutriPlanAppData = window.NutriPlanAppData;
            shellChatFrame.contentWindow.dispatchEvent(new CustomEvent('NUTRIPLAN_SHELL_CHAT_OPEN'));
        } catch (_) {}
    }

    /**
     * Чатът е готов предварително, когато телефонът е свободен — отваря се веднага.
     * Не на слаби устройства (под 3 GB RAM), там се зарежда при първото отваряне.
     */
    function scheduleShellChatPreload() {
        if (navigator.deviceMemory && navigator.deviceMemory < 3) return;
        var run = function () { loadShellChatFrame(true); };
        setTimeout(function () {
            if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
            else run();
        }, 6000);
    }

    function openShellChat() {
        ensureShellChatOverlay();
        if (!shellChatFrame) return;
        if (!shellChatFrame.getAttribute('src')) {
            // Първо отваряне без предварително зареждане: страницата сама отваря чата.
            loadShellChatFrame(false);
        } else if (shellChatLoaded) {
            dispatchShellChatOpen();
        } else {
            shellChatOpenPending = true;
        }
        shellChatFrame.style.display = 'block';
        shellChatFrame.setAttribute('aria-hidden', 'false');
        if (_shellChatVpHandler) _shellChatVpHandler();
    }

    function closeShellChat() {
        if (!shellChatFrame) return;
        shellChatFrame.style.display = 'none';
        shellChatFrame.setAttribute('aria-hidden', 'true');
        shellChatFrame.style.top = '';
        shellChatFrame.style.left = '';
        shellChatFrame.style.width = '';
        shellChatFrame.style.height = '';
    }

    function isKnownShellFrameSource(source) {
        if (!source) return false;
        return Array.prototype.some.call(document.querySelectorAll('[data-tab-view]'), function (frame) {
            try {
                return !!frame && frame.contentWindow === source;
            } catch (_) {
                return false;
            }
        });
    }

    function isTrustedShellMessage(event) {
        if (!event || !event.data || typeof event.data.type !== 'string') return false;
        if (event.origin === window.location.origin) return true;
        if (!isKnownShellFrameSource(event.source)) return false;
        return event.origin === 'null'
            || window.location.origin === 'null'
            || window.location.protocol === 'capacitor:'
            || window.location.protocol === 'file:';
    }

    /** Clear the signed-in user's data from shell storage; never throws. */
    function clearShellSession(full) {
        var session = window.NutriPlanSession;
        var signedOut = Promise.resolve();
        try {
            if (typeof window.NutriPlanAuthSignOut === 'function') {
                signedOut = Promise.resolve(window.NutriPlanAuthSignOut()).catch(function () {});
            }
        } catch (_) {}
        return signedOut.then(function () { return clearShellStorage(session, full); });
    }

    /** full — след изтрит профил: без запазена аналитика на устройството. */
    function clearShellStorage(session, full) {
        try {
            if (full && session && typeof session.clearUserSessionData === 'function') {
                return Promise.resolve(session.clearUserSessionData()).catch(function () {});
            }
            if (session && typeof session.clearAuthSessionKeepingAnalytics === 'function') {
                return Promise.resolve(session.clearAuthSessionKeepingAnalytics()).catch(function () {});
            }
            if (session && typeof session.clearUserSessionData === 'function') {
                return Promise.resolve(session.clearUserSessionData()).catch(function () {});
            }
        } catch (_) {}
        return Promise.resolve();
    }

    function handleShellMessage(event) {
        if (!isTrustedShellMessage(event)) return;
        var data = event.data;
        if (data.type === 'NUTRIPLAN_THEME_CHANGE') {
            applyTheme(data.theme, true);
            return;
        }
        if (data.type === 'NUTRIPLAN_OPEN_CHAT') {
            openShellChat();
            return;
        }
        if (data.type === 'NUTRIPLAN_SHEET_STATE') {
            // Под отворен лист фонът е затъмнен — лентата отдолу също.
            setSystemNavColor(data.state === 'open' ? '#050C0C' : themeNavColor());
            return;
        }
        if (data.type === 'NUTRIPLAN_PULL_REFRESH') {
            runPullRefresh(event.source);
            return;
        }
        if (data.type === 'NUTRIPLAN_WEEKLY_TEST') {
            closeShellChat();
            switchTab('plan', true);
            var planFrameWeekly = document.querySelector('[data-tab-view="plan"]');
            if (planFrameWeekly) {
                ensureFrameLoaded('plan');
                setTimeout(function () {
                    dispatchFrameEvent(planFrameWeekly, 'NUTRIPLAN_RUN_WEEKLY_TEST');
                }, 400);
            }
            return;
        }
        if (data.type === 'NUTRIPLAN_CLOSE_CHAT') {
            closeShellChat();
            return;
        }
        if (data.type === 'NUTRIPLAN_SWITCH_TAB') {
            if (data.tab) switchTab(data.tab, true);
            if (data.tab === 'profile' && data.open) openProfileSection(data.open);
            return;
        }
        if (data.type === 'NUTRIPLAN_GAMEDATA_UPDATED') {
            forwardSilentRecalc({
                recordKey: data.recordKey || ''
            });
            var analyticsFrame = document.querySelector('[data-tab-view="analytics"]');
            if (analyticsFrame) {
                dispatchFrameEvent(analyticsFrame, 'NUTRIPLAN_TAB_ACTIVATED', { tab: 'analytics' });
            }
            var planFrame = document.querySelector('[data-tab-view="plan"]');
            if (planFrame) {
                dispatchFrameEvent(planFrame, 'NUTRIPLAN_APP_DATA_READY', { keys: ['gameData'] });
            }
            return;
        }
        if (data.type === 'NUTRIPLAN_LOGOUT') {
            // Hide SPA shell immediately so nav bar / tabs are not visible during navigation
            var shell = document.getElementById('spaShell');
            if (shell) shell.hidden = true;
            document.body.classList.remove('spa-mode');
            // Clear here too. The tab that asked for logout is expected to have
            // signed out and cleared already, but the shell owns the storage the
            // next screen reads — leaving that to the caller is how logout came
            // to be "navigate only" inside the app.
            // deleted — профилът е изтрит: всичко от устройството и към началото със съобщение.
            var deleted = data.deleted === true;
            clearShellSession(deleted).then(function() {
                // Излязъл потребител не получава повече напомняния за плана.
                try {
                    if (window.GameNotifier && typeof window.GameNotifier.cancelAll === 'function') window.GameNotifier.cancelAll();
                } catch (_) {}
                window.location.replace(deleted ? 'index.html?stay=1&deleted=1' : 'index.html?stay=1&login=1');
            });
            return;
        }
        if (data.type === 'NUTRIPLAN_HAPTIC') {
            try {
                var cap = window.Capacitor;
                if (cap) {
                    // registerPlugin must be called to create the JS-side proxy;
                    // @capacitor/haptics dist/plugin.js is never loaded directly so we do it lazily.
                    if (!cap.Plugins.Haptics && typeof cap.registerPlugin === 'function') {
                        cap.registerPlugin('Haptics', {});
                    }
                    if (cap.Plugins.Haptics) {
                        cap.Plugins.Haptics.impact({ style: data.style || 'Light' });
                    }
                } else if (navigator.vibrate) {
                    navigator.vibrate(data.style === 'Heavy' ? 15 : 4);
                }
            } catch (_) {}
            return;
        }
        if (data.type !== 'NUTRIPLAN_NAVIGATE' || typeof data.url !== 'string' || !data.url) return;
        try {
            var targetUrl = new URL(data.url, window.location.href);
            if (targetUrl.origin !== window.location.origin) return;
            var targetTab = !data.forceTopLevel ? tabFromUrl(targetUrl) : null;
            if (targetTab) {
                var targetFrame = ensureFrameLoaded(targetTab);
                if (targetFrame) {
                    var search = new URLSearchParams(targetUrl.search);
                    search.delete('app');
                    search.delete('tab');
                    search.set('embedded', '1');
                    var targetPath = TAB_ROUTES[targetTab] || (targetUrl.pathname.split('/').pop() || 'index.html');
                    var nextSrc = targetPath + (search.toString() ? '?' + search.toString() : '') + (targetUrl.hash || '');
                    if (targetFrame.getAttribute('src') !== nextSrc) {
                        targetFrame.setAttribute('src', nextSrc);
                    }
                }
                switchTab(targetTab, true);
                return;
            }
            var relativeUrl = targetUrl.pathname.split('/').pop() + targetUrl.search + targetUrl.hash;
            if (data.replace) window.location.replace(relativeUrl);
            else window.location.href = relativeUrl;
        } catch (_) {}
    }

    function refreshFramesForData() {
        document.querySelectorAll('[data-tab-view]').forEach(function (frame) {
            try {
                if (frame.contentWindow) {
                    dispatchFrameEvent(frame, 'NUTRIPLAN_APP_DATA_READY', {
                        keys: Object.keys(state.raw)
                    });
                    frame.contentWindow.NutriPlanAppData = window.NutriPlanAppData;
                    frame.contentWindow.postMessage({
                        type: 'NUTRIPLAN_APP_DATA_READY',
                        keys: Object.keys(state.raw)
                    }, window.location.origin);
                }
            } catch (_) {}
        });
    }

    function mountFrames(initialTab) {
        ensureFrameLoaded(initialTab);
        scheduleDeferredFramePreload(initialTab);
    }

    function triggerTabHaptic() {
        try {
            var cap = window.Capacitor;
            if (!cap) return;
            if (!cap.Plugins.Haptics && typeof cap.registerPlugin === 'function') {
                cap.registerPlugin('Haptics', {});
            }
            if (cap.Plugins.Haptics) {
                cap.Plugins.Haptics.impact({ style: 'Light' });
            }
        } catch (_) {}
    }

    // Slide the bottom-nav highlight under the active button.
    function syncNavPill(animate) {
        var pill = document.querySelector('.spa-nav-pill');
        var button = document.querySelector('.spa-bottom-nav [data-tab-target].active');
        if (!pill || !button || !button.offsetWidth) return;
        var width = Math.min(button.offsetWidth - 12, 76);
        if (!animate) pill.style.transition = 'none';
        pill.style.setProperty('--pill-w', width + 'px');
        pill.style.setProperty('--pill-x', (button.offsetLeft + (button.offsetWidth - width) / 2) + 'px');
        pill.classList.add('is-ready');
        if (!animate) {
            void pill.offsetWidth;
            pill.style.transition = '';
        }
    }

    function tabIndex(tab) {
        var buttons = Array.prototype.slice.call(document.querySelectorAll('.spa-bottom-nav [data-tab-target]'));
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].getAttribute('data-tab-target') === tab) return i;
        }
        return -1;
    }

    /**
     * Отваря секция в профила (изследвания, устройства, документи) — за бутоните
     * „Направи анализа по-точен“ в здравния анализ. Секцията се показва, щом
     * профилът зареди данните си (до ~6 с).
     */
    function openProfileSection(id) {
        if (!/^(labsSection|devicesSection|docsSection)$/.test(String(id || ''))) return;
        var frame = ensureFrameLoaded('profile');
        var tries = 0;
        (function attempt() {
            try {
                var w = frame && frame.contentWindow;
                var section = w && w.document && w.document.getElementById(id);
                if (w && typeof w.openCardModule === 'function' && section && !section.hidden) {
                    w.openCardModule(id);
                    // Картонът над секцията се дорисува след зареждане — превъртането се повтаря, когато застане.
                    setTimeout(function () { try { section.scrollIntoView({ block: 'start' }); } catch (_) {} }, 900);
                    return;
                }
            } catch (_) {}
            if (++tries < 30) setTimeout(attempt, 200);
        })();
    }

    function switchTab(tab, updateUrl) {
        tab = normalizeTab(tab);
        var previousTab = state.activeTab;
        var previousFrame = previousTab ? document.querySelector('[data-tab-view="' + previousTab + '"]') : null;
        var activeFrame = ensureFrameLoaded(tab);
        var stack = document.querySelector('.spa-tab-stack');
        if (stack) {
            // Direction of the entrance follows the nav order; first paint and re-taps stay still.
            stack.setAttribute('data-dir', !previousTab || previousTab === tab
                ? 'none'
                : (tabIndex(tab) < tabIndex(previousTab) ? 'back' : 'forward'));
        }

        if (previousTab && previousTab !== tab) {
            // Всеки таб помни докъде е стигнат — връщането не започва отгоре.
            try {
                if (previousFrame && previousFrame.contentWindow) state.scroll[previousTab] = previousFrame.contentWindow.scrollY || 0;
            } catch (_) {}
            triggerTabHaptic();
            if (previousFrame) {
                dispatchFrameEvent(previousFrame, 'NUTRIPLAN_TAB_DEACTIVATED', {
                    tab: previousTab,
                    nextTab: tab
                });
            }
        }

        state.activeTab = tab;

        document.querySelectorAll('[data-tab-view]').forEach(function (frame) {
            var isActive = frame.getAttribute('data-tab-view') === tab;
            frame.classList.toggle('is-active', isActive);
            frame.setAttribute('aria-hidden', String(!isActive));
            if (isActive && shouldReplayTabAnimations(tab)) replayTabAnimations(frame);
        });
        var savedScroll = state.scroll[tab];
        if (activeFrame && savedScroll && previousTab !== tab) {
            requestAnimationFrame(function () {
                try {
                    var w = activeFrame.contentWindow;
                    if (w && (w.scrollY || 0) < 4) w.scrollTo(0, savedScroll);
                } catch (_) {}
            });
        }

        document.querySelectorAll('[data-tab-target]').forEach(function (button) {
            var isActive = button.getAttribute('data-tab-target') === tab;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-current', isActive ? 'page' : 'false');
        });
        syncNavPill(!!previousTab);

        if (activeFrame) {
            dispatchFrameEvent(activeFrame, 'NUTRIPLAN_TAB_ACTIVATED', {
                tab: tab,
                previousTab: previousTab
            });
        }

        if (updateUrl) {
            var nextUrl = 'index.html?app=1&tab=' + encodeURIComponent(tab);
            history.replaceState({ tab: tab }, '', nextUrl);
        }
    }

    function shouldOpenShell() {
        if (!params.has('app')) return false;
        var uid = getStoredValue('userId') || '';
        if (!uid.startsWith('fb_')) return false;
        if (getStoredValue('planSource') === 'questionnaire2') {
            if (getStoredValue('pendingClientId') && !getStoredValue('dietPlan')) {
                window.location.replace('plan-pending.html');
                return false;
            }
            try { localStorage.removeItem('planSource'); } catch (_) {}
        }
        return !!getStoredValue('dietPlan');
    }

    function endBoot() {
        document.documentElement.classList.remove('app-booting');
        if (pendingBars) {
            var bars = pendingBars;
            pendingBars = null;
            setSystemNavColor(bars.color);
        }
    }

    async function initShell() {
        var shell = document.getElementById('spaShell');
        if (!shell || state.initialized) return;
        if (window.NutriPlanDiagnostics) {
            window.NutriPlanDiagnostics.ensureSession('shell');
            window.NutriPlanDiagnostics.info('shell', 'init-start', params.get('tab') || 'plan');
        }

        await ensureNativeStorageReady();
        await cacheJsonAtStartup();
        if (params.has('app') && window._indexAuthUser) {
            try { await window._indexAuthUser; } catch (_) {}
        }
        if (!shouldOpenShell()) {
            endBoot();
            if (window.NutriPlanDiagnostics) {
                window.NutriPlanDiagnostics.info('shell', 'init-skip', 'No local plan available');
            }
            return;
        }

        if (await runOpenAppCatchUpFlow()) { endBoot(); return; }

        state.initialized = true;
        document.body.classList.add('spa-mode');
        shell.hidden = false;
        applyTheme(getPreferredTheme());
        window.addEventListener('message', handleShellMessage);
        window.addEventListener('storage', function (event) {
            if (event.key === 'theme' && event.newValue) {
                applyTheme(event.newValue);
            }
        });

        document.querySelectorAll('[data-tab-view]').forEach(function (frame) {
            frame.addEventListener('load', function () {
                patchFrame(frame);
                refreshFramesForData();
                if (window.NutriPlanDiagnostics) {
                    window.NutriPlanDiagnostics.ok('shell', 'frame-load', frame.getAttribute('data-tab-view') || 'unknown');
                }
                if (frame.getAttribute('data-tab-view') === state.activeTab) {
                    if (shouldReplayTabAnimations(state.activeTab)) replayTabAnimations(frame);
                    dispatchFrameEvent(frame, 'NUTRIPLAN_TAB_ACTIVATED', {
                        tab: state.activeTab,
                        previousTab: ''
                    });
                }
            });
            if (frame.contentDocument && frame.contentDocument.readyState !== 'loading') {
                patchFrame(frame);
            }
        });

        var initialTab = params.get('tab') || 'plan';
        mountFrames(initialTab);
        refreshFramesForData();
        if (window.NutriPlanDiagnostics) {
            window.NutriPlanDiagnostics.ok('shell', 'init-ready', initialTab);
        }

        document.querySelectorAll('[data-tab-target]').forEach(function (button) {
            button.addEventListener('click', function () {
                switchTab(button.getAttribute('data-tab-target'), true);
            });
        });

        switchTab(initialTab, true);
        if (initialTab === 'profile' && params.get('open')) openProfileSection(params.get('open'));
        // Стартовият екран се маха, щом активният таб е зареден (или до секунда и половина).
        var bootFrame = document.querySelector('[data-tab-view="' + state.activeTab + '"]');
        var bootTimer = setTimeout(endBoot, 1500);
        if (bootFrame) bootFrame.addEventListener('load', function () { clearTimeout(bootTimer); setTimeout(endBoot, 120); }, { once: true });
        window.addEventListener('resize', function () { syncNavPill(false); });
        initApkGameNotifier();
        runPlanUpdateCatchUp();
        scheduleShellChatPreload();
    }

    /** Android „Назад“ в обвивката: чат → прозорец в таба → към плана. */
    function handleShellBack() {
        if (!state.initialized) return false;
        if (window.NutriPlanHealthOffer && window.NutriPlanHealthOffer.isOpen()) {
            window.NutriPlanHealthOffer.close();
            return true;
        }
        if (shellChatFrame && shellChatFrame.style.display !== 'none') {
            try {
                var chatWin = shellChatFrame.contentWindow;
                if (chatWin && typeof chatWin.NutriPlanHandleBack === 'function' && chatWin.NutriPlanHandleBack({ keepChat: true })) return true;
            } catch (_) {}
            closeShellChat();
            return true;
        }
        var frame = state.activeTab ? document.querySelector('[data-tab-view="' + state.activeTab + '"]') : null;
        try {
            var win = frame && frame.contentWindow;
            if (win && typeof win.NutriPlanHandleBack === 'function' && win.NutriPlanHandleBack()) return true;
        } catch (_) {}
        if (state.activeTab && state.activeTab !== 'plan') {
            switchTab('plan', true);
            return true;
        }
        return false;
    }
    window.NutriPlanShellBack = handleShellBack;

    window.NutriPlanSPA = {
        switchTab: function (tab) { switchTab(tab, true); },
        get activeTab() { return state.activeTab; },
        get data() { return window.NutriPlanAppData || null; }
    };

    bindNativeNotificationBridge();
    bindSwNotificationBridge();
    bindCatchUpOnResume();
    initApkGameNotifier();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initShell, { once: true });
    } else {
        initShell();
    }
})();
