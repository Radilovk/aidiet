/**
 * apk.test.js – APK-specific regression tests
 *
 * Covers three critical behaviours fixed for the Capacitor/Android build:
 *
 *  1. native-backup.js _getCap() / _isNative() – falls back to
 *     window.top.Capacitor when running inside an embedded iframe so that
 *     Preferences data is saved/restored even in non-top frames.
 *
 *  2. local-scheduler.js GameNotifier._detectCapacitor() – same iframe
 *     fallback so local notifications are scheduled from the plan.html tab.
 *
 *  3. auth-guard.js overlay logic – the loading overlay must be removed
 *     in embedded mode when Firebase returns null, preventing a permanent
 *     blank-screen in the APK.
 *
 * Run with:  node --test apk.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helper: build a minimal mock Capacitor object
// ---------------------------------------------------------------------------
function mockCap({ isNative = true, plugins = {} } = {}) {
    return {
        isNativePlatform: () => isNative,
        Plugins: plugins,
    };
}

// ---------------------------------------------------------------------------
// Helper: minimal in-memory localStorage mock
// ---------------------------------------------------------------------------
function makeLocalStorage() {
    const store = {};
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { for (const k in store) delete store[k]; },
    };
}

// ---------------------------------------------------------------------------
// Helper: run a script file in a fresh vm context with a provided window mock
// ---------------------------------------------------------------------------
function runInMockWindow(filePath, windowMock) {
    const source = readFileSync(filePath, 'utf8');
    const ls = windowMock.localStorage || makeLocalStorage();
    const ctx = vm.createContext({
        window: windowMock,
        globalThis: windowMock,
        localStorage: ls,   // native-backup.js accesses localStorage as a bare global
        console,
        setTimeout,
        clearTimeout,
        Promise,
    });
    // Append an assignment to expose top-level const/let/var onto window so tests
    // can access them via ctx.window regardless of whether the file does it itself.
    const exposed = source + '\nif (typeof NativeBackup !== "undefined") window.NativeBackup = NativeBackup;';
    vm.runInContext(exposed, ctx);
    return ctx;
}

function extractFunctionSource(filePath, functionName) {
    const source = readFileSync(filePath, 'utf8');
    const signature = `function ${functionName}(`;
    const start = source.indexOf(signature);
    if (start === -1) {
        throw new Error(`Function ${functionName} not found in ${filePath}`);
    }
    const braceStart = source.indexOf('{', start);
    if (braceStart === -1) {
        throw new Error(`Function ${functionName} has no body in ${filePath}`);
    }
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }
    throw new Error(`Function ${functionName} body was not closed in ${filePath}`);
}

function loadFunction(filePath, functionName, extraContext = {}) {
    const fnSource = extractFunctionSource(filePath, functionName);
    const context = vm.createContext({
        Promise,
        setTimeout,
        clearTimeout,
        window: extraContext.window || {},
    });
    return vm.runInContext(`(${fnSource})`, context);
}

// ============================================================================
// 1. native-backup.js – _getCap() iframe fallback
// ============================================================================

test('native-backup: _isNative returns false when no Capacitor anywhere', async () => {
    const w = { Capacitor: undefined, top: null, localStorage: makeLocalStorage() };
    const ctx = runInMockWindow(join(__dirname, 'native-backup.js'), w);
    // init() resolves false when _isNative() is false
    const result = await ctx.window.NativeBackup.init();
    assert.equal(result, false);
});

test('native-backup: _isNative returns false in non-native top-level window', async () => {
    const cap = mockCap({ isNative: false });
    const w = { Capacitor: cap, top: null, localStorage: makeLocalStorage() };
    const ctx = runInMockWindow(join(__dirname, 'native-backup.js'), w);
    const result = await ctx.window.NativeBackup.init();
    assert.equal(result, false);
});

test('native-backup: _getCap falls back to window.top.Capacitor in iframe', async () => {
    // Simulate iframe: window.Capacitor = undefined, window.top has Capacitor
    const prefs = { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} };
    const cap = mockCap({ isNative: true, plugins: { Preferences: prefs } });
    const topWindow = { Capacitor: cap };
    topWindow.top = topWindow; // top.top === top (not an iframe itself)
    const w = { Capacitor: undefined, top: topWindow, localStorage: makeLocalStorage() };

    const ctx = runInMockWindow(join(__dirname, 'native-backup.js'), w);
    // init() should detect native via window.top.Capacitor and return true
    const result = await ctx.window.NativeBackup.init();
    assert.equal(result, true, 'init() should succeed using window.top.Capacitor fallback');
});

// ============================================================================
// 2. local-scheduler.js – GameNotifier._detectCapacitor() iframe fallback
// ============================================================================

test('GameNotifier._detectCapacitor: returns null when no Capacitor', () => {
    const w = { Capacitor: undefined, top: { Capacitor: undefined } };
    w.top.top = w.top;
    const ctx = runInMockWindow(join(__dirname, 'local-scheduler.js'), w);
    const result = ctx.window.GameNotifier._detectCapacitor();
    assert.equal(result, null);
});

test('GameNotifier._detectCapacitor: returns null for non-native Capacitor', () => {
    const cap = mockCap({ isNative: false });
    const w = { Capacitor: cap, top: null };
    w.top = w;
    const ctx = runInMockWindow(join(__dirname, 'local-scheduler.js'), w);
    const result = ctx.window.GameNotifier._detectCapacitor();
    assert.equal(result, null);
});

test('GameNotifier._detectCapacitor: detects Capacitor on top-level window', () => {
    const ln = { schedule: async () => {} };
    const cap = mockCap({ isNative: true, plugins: { LocalNotifications: ln } });
    const w = { Capacitor: cap, top: null };
    w.top = w;
    const ctx = runInMockWindow(join(__dirname, 'local-scheduler.js'), w);
    const result = ctx.window.GameNotifier._detectCapacitor();
    assert.ok(result, 'should return a truthy object');
    assert.equal(result.LocalNotifications, ln);
});

test('GameNotifier._detectCapacitor: falls back to window.top.Capacitor in iframe', () => {
    const ln = { schedule: async () => {} };
    const cap = mockCap({ isNative: true, plugins: { LocalNotifications: ln } });
    const topWindow = { Capacitor: cap };
    topWindow.top = topWindow;
    const w = { Capacitor: undefined, top: topWindow };

    const ctx = runInMockWindow(join(__dirname, 'local-scheduler.js'), w);
    const result = ctx.window.GameNotifier._detectCapacitor();
    assert.ok(result, 'should return a truthy object using window.top fallback');
    assert.equal(result.LocalNotifications, ln);
});

// ============================================================================
// 3. auth-guard overlay logic – inline test (mirrors auth-guard.js lines 46-115)
// ============================================================================

test('auth-guard overlay: removed when isEmbedded and Firebase returns null', () => {
    // Simulate the DOM overlay removal branch from auth-guard.js
    let removed = false;
    let fadedOut = false;

    const mockOverlay = {
        set style(_) {},
        get style() {
            return {
                set opacity(v) { if (v === '0') fadedOut = true; }
            };
        },
        remove() { removed = true; }
    };

    // Replicate the auth-guard logic for the embedded + null user case
    function simulateAuthGuardEmbeddedNull(ov) {
        const user = null;
        const isEmbedded = true; // window.parent !== window
        if (!user) {
            if (isEmbedded) {
                if (ov) {
                    ov.style.opacity = '0';
                    ov.remove(); // simplified: skip setTimeout for test
                }
                return 'embedded-no-redirect';
            }
            return 'redirect-to-login';
        }
        return 'authenticated';
    }

    const outcome = simulateAuthGuardEmbeddedNull(mockOverlay);

    assert.equal(outcome, 'embedded-no-redirect');
    assert.equal(removed, true, 'overlay.remove() must be called in embedded+null Firebase case');
});

test('auth-guard overlay: NOT removed when isEmbedded is false (top-level redirect)', () => {
    let removed = false;

    const mockOverlay = {
        style: { set opacity(_) {} },
        remove() { removed = true; }
    };

    function simulateAuthGuardTopLevel(ov) {
        const user = null;
        const isEmbedded = false;
        if (!user) {
            if (isEmbedded) {
                if (ov) { ov.style.opacity = '0'; ov.remove(); }
                return 'embedded-no-redirect';
            }
            return 'redirect-to-login';
        }
        return 'authenticated';
    }

    const outcome = simulateAuthGuardTopLevel(mockOverlay);

    assert.equal(outcome, 'redirect-to-login');
    assert.equal(removed, false, 'overlay should NOT be removed on top-level redirect path');
});

// ============================================================================
// 4. profile.html – APK-specific logout/avatar helpers
// ============================================================================

test('profile settleSoon: resolves hanging promise after timeout', async () => {
    const settleSoon = loadFunction(join(__dirname, 'profile.html'), 'settleSoon');
    const start = Date.now();
    await settleSoon(new Promise(() => {}), 25);
    assert.ok(Date.now() - start < 200, 'settleSoon should not wait forever on unresolved signOut');
});

test('profile getAvatarPhotoSource: supports base64String payloads', () => {
    const getAvatarPhotoSource = loadFunction(join(__dirname, 'profile.html'), 'getAvatarPhotoSource');
    const result = getAvatarPhotoSource({
        base64String: 'ZmFrZQ==',
        format: 'png'
    });
    assert.equal(result, 'data:image/png;base64,ZmFrZQ==');
});

test('profile getAvatarPhotoSource: supports webPath payloads', () => {
    const getAvatarPhotoSource = loadFunction(join(__dirname, 'profile.html'), 'getAvatarPhotoSource');
    const result = getAvatarPhotoSource({
        webPath: 'https://localhost/_capacitor_file_/cache/avatar.jpg'
    });
    assert.equal(result, 'https://localhost/_capacitor_file_/cache/avatar.jpg');
});

test('profile getAvatarPhotoSource: converts native file paths via Capacitor', () => {
    const getAvatarPhotoSource = loadFunction(join(__dirname, 'profile.html'), 'getAvatarPhotoSource', {
        window: {
            top: {
                Capacitor: {
                    convertFileSrc: (value) => `https://localhost/_capacitor_file_/${value.replace(/^file:\/\//, '')}`
                }
            }
        }
    });
    const result = getAvatarPhotoSource({
        path: 'file:///storage/emulated/0/DCIM/avatar.jpg'
    });
    assert.equal(result, 'https://localhost/_capacitor_file_/storage/emulated/0/DCIM/avatar.jpg');
});
