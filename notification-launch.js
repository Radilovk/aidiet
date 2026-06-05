/**
 * Early native notification router for index.html.
 * Hides the app shell before first paint and redirects to quick-answer.html
 * so notification taps never flash the full NutriPlan UI.
 */
(function () {
    'use strict';

    var cap = window.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

    var path = location.pathname || '/';
    var isIndexEntry = path.endsWith('/') || path.endsWith('/index.html') || path.indexOf('index.html') !== -1;
    if (!isIndexEntry) return;

    window.__nutriplanNotificationLaunch = true;

    var revealTimer = null;
    var listenerBound = false;

    document.documentElement.style.visibility = 'hidden';
    document.documentElement.style.background = '#0A1A1A';

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function todayKey() {
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function normalizeRecordKey(value) {
        return (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) ? value : todayKey();
    }

    function buildQuickAnswerUrl(type, recordKey, actionId) {
        var qaType = type === 'evening_check' ? 'evening_water' : type;
        var url = 'quick-answer.html?type=' + encodeURIComponent(qaType) +
            '&date=' + encodeURIComponent(normalizeRecordKey(recordKey));
        if (actionId) url += '&auto=' + encodeURIComponent(actionId);
        return url;
    }

    function isGameNotificationType(type) {
        return type === 'morning_check' || type === 'evening_check' ||
            type === 'evening_activity' || type === 'evening_balance' || type === 'evening_water';
    }

    function runDeferredPlanRedirect() {
        var params = new URLSearchParams(location.search);
        if (params.has('stay') || params.has('login') || params.has('app')) return;

        var planJobId = localStorage.getItem('planJobId');
        if (planJobId) {
            var src = localStorage.getItem('planJobSource');
            location.replace(src === 'questionnaire' ? 'questionnaire.html' : 'questionnaire2.html');
            return;
        }

        if (!localStorage.getItem('dietPlan')) return;

        var planTarget;
        if (localStorage.getItem('planSource') === 'questionnaire2' || localStorage.getItem('pendingClientId')) {
            planTarget = 'plan-pending.html';
        } else {
            planTarget = 'index.html?app=1&tab=plan';
        }
        location.replace(planTarget);
    }

    function revealApp() {
        if (revealTimer) clearTimeout(revealTimer);
        revealTimer = null;
        document.documentElement.style.visibility = '';
        runDeferredPlanRedirect();
    }

    function redirectToQuickAnswer(type, recordKey, actionId) {
        if (revealTimer) clearTimeout(revealTimer);
        revealTimer = null;
        document.documentElement.style.visibility = '';
        location.replace(buildQuickAnswerUrl(type, recordKey, actionId));
    }

    function extractActionId(actionEvent) {
        var id = actionEvent && (actionEvent.actionId || actionEvent.action);
        if (typeof id !== 'string') return '';
        id = id.trim();
        if (!id || id === 'tap' || id === 'MESSAGE' || id === 'CLOSE') return '';
        return id;
    }

    function handleNotificationAction(event) {
        var notification = event && event.notification ? event.notification : {};
        var extra = notification.extra || {};
        var type = extra.type || '';
        var recordKey = extra.recordKey || todayKey();
        var actionId = extractActionId(event);

        if (isGameNotificationType(type)) {
            redirectToQuickAnswer(type, recordKey, actionId);
            return;
        }

        if (extra.url && String(extra.url).indexOf('quick-answer') !== -1) {
            if (revealTimer) clearTimeout(revealTimer);
            revealTimer = null;
            location.replace(String(extra.url).replace(/^\//, ''));
            return;
        }

        revealApp();
    }

    function scheduleRevealFallback() {
        if (revealTimer) clearTimeout(revealTimer);
        // Wait for Capacitor to deliver cold-start notification action before showing shell.
        revealTimer = setTimeout(revealApp, 900);
    }

    function bindListeners(attempt) {
        if (listenerBound) return;
        attempt = attempt || 0;

        var plugins = cap.Plugins || {};
        var ln = plugins.LocalNotifications;
        if (!ln && typeof cap.registerPlugin === 'function') {
            try { ln = cap.registerPlugin('LocalNotifications'); } catch (_) {}
        }
        if (!ln || typeof ln.addListener !== 'function') {
            if (attempt < 40) {
                setTimeout(function () { bindListeners(attempt + 1); }, 50);
                return;
            }
            revealApp();
            return;
        }

        ln.addListener('localNotificationActionPerformed', function (event) {
            handleNotificationAction(event);
        });
        listenerBound = true;
        scheduleRevealFallback();
    }

    bindListeners(0);
})();
