(function (global) {
    'use strict';

    var LOG_KEY = 'nutriplanDiagnosticsLog';
    var SESSION_KEY = 'nutriplanDiagnosticsSession';
    var MAX_ENTRIES = 180;

    function readJson(key, fallbackValue) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallbackValue;
        } catch (_) {
            return fallbackValue;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (_) {
            return false;
        }
    }

    function isNativePlatform() {
        try {
            return !!(global.Capacitor &&
                typeof global.Capacitor.isNativePlatform === 'function' &&
                global.Capacitor.isNativePlatform());
        } catch (_) {
            return false;
        }
    }

    function getPlatformLabel() {
        return isNativePlatform() ? 'APK' : 'Web';
    }

    function getPageName() {
        try {
            return location.pathname.split('/').pop() || 'index.html';
        } catch (_) {
            return 'unknown';
        }
    }

    function clip(value, maxLength) {
        var text = value == null ? '' : String(value);
        return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
    }

    function getSession() {
        return readJson(SESSION_KEY, null);
    }

    function saveSession(session) {
        writeJson(SESSION_KEY, session);
        return session;
    }

    function beginSession(label) {
        var session = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            label: clip(label || getPageName(), 80),
            startedAt: new Date().toISOString(),
            platform: getPlatformLabel()
        };
        writeJson(LOG_KEY, []);
        saveSession(session);
        return log('session', 'begin', 'success', session.label);
    }

    function ensureSession(label) {
        var existing = getSession();
        if (existing && existing.id) return existing;
        beginSession(label || getPageName());
        return getSession();
    }

    function getEntries() {
        return readJson(LOG_KEY, []);
    }

    function saveEntries(entries) {
        writeJson(LOG_KEY, entries.slice(-MAX_ENTRIES));
    }

    function log(moduleName, operation, status, details) {
        var session = ensureSession(getPageName());
        var normalizedStatus = (status === 'error' || status === 'fail' || status === false) ? 'error'
            : (status === 'info' ? 'info' : 'success');
        var entries = getEntries();
        entries.push({
            timestamp: new Date().toISOString(),
            module: clip(moduleName || 'app', 40),
            operation: clip(operation || 'event', 60),
            status: normalizedStatus,
            details: clip(details || '', 180),
            platform: getPlatformLabel(),
            page: getPageName(),
            sessionId: session && session.id ? session.id : ''
        });
        saveEntries(entries);
        return entries[entries.length - 1];
    }

    function formatTimestamp(value) {
        try {
            return new Date(value).toLocaleTimeString('bg-BG', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (_) {
            return value || '';
        }
    }

    function formatForChat(limit) {
        var session = ensureSession(getPageName());
        var entries = getEntries().slice(-Math.max(1, limit || 60));
        if (!entries.length) {
            return 'Няма записани диагностични събития за текущото зареждане.';
        }
        var lines = [
            'Диагностичен лог',
            'Сесия: ' + (session && session.label ? session.label : 'текуща'),
            'Среда: ' + getPlatformLabel(),
            'Записи: ' + entries.length,
            ''
        ];
        entries.forEach(function (entry) {
            var icon = entry.status === 'error' ? '✗' : (entry.status === 'info' ? '•' : '✓');
            var line = formatTimestamp(entry.timestamp) + ' | ' + icon + ' ' + entry.module + ' / ' + entry.operation;
            if (entry.details) line += ' — ' + entry.details;
            lines.push(line);
        });
        return lines.join('\n');
    }

    if (!global.__NutriPlanDiagnosticsErrorsAttached) {
        global.__NutriPlanDiagnosticsErrorsAttached = true;
        global.addEventListener('error', function (event) {
            log('runtime', 'window-error', 'error', event && event.message ? event.message : 'Unknown error');
        });
        global.addEventListener('unhandledrejection', function (event) {
            var reason = event && event.reason;
            log('runtime', 'unhandled-rejection', 'error', reason && reason.message ? reason.message : reason);
        });
    }

    global.NutriPlanDiagnostics = {
        beginSession: beginSession,
        ensureSession: ensureSession,
        log: log,
        ok: function (moduleName, operation, details) { return log(moduleName, operation, 'success', details); },
        info: function (moduleName, operation, details) { return log(moduleName, operation, 'info', details); },
        fail: function (moduleName, operation, details) { return log(moduleName, operation, 'error', details); },
        getEntries: getEntries,
        getSession: getSession,
        formatForChat: formatForChat,
        clear: function () { return writeJson(LOG_KEY, []); }
    };

    global.NutriPlanDiagnostics.ensureSession(getPageName());
}(window));
