/**
 * iPhone: входът (Firebase Auth) в WKWebView. Страниците са на адрес capacitor://localhost и getAuth() там може
 * да не отговори никога — зарежда скрита рамка от firebaseapp.com за вход с пренасочване, който Nutriin не ползва.
 * Документираното решение: initializeAuth с IndexedDB, ПРЕДИ първия getAuth() — после всички getAuth() на страницата
 * (index, plan, profile, plan-sync.js, auth-guard.js…) получават същия, вече готов вход.
 *
 * Само в пакета за iPhone: scripts/capacitor-shell.sh (IOS=1) го слага като първия модул на страниците с вход.
 * Сайтът и Android не го зареждат.
 */
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const cfg = {
    apiKey:            'AIzaSyAZvIAAzP-6CBzQlQvoJTy-Iq24fBAPrJY',
    authDomain:        'nutriplan-c460a.firebaseapp.com',
    projectId:         'nutriplan-c460a',
    storageBucket:     'nutriplan-c460a.firebasestorage.app',
    messagingSenderId: '556207268794',
    appId:             '1:556207268794:web:4fa968491413abd4873383'
};

try {
    // Табовете в обвивката са рамки — мостът на Capacitor е в горния прозорец.
    let cap = null;
    try { cap = (window.top !== window && window.top.Capacitor) || window.Capacitor || null; } catch (_) { cap = window.Capacitor || null; }
    if (cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'ios') {
        const app = getApps().length ? getApp() : initializeApp(cfg);
        const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
        // plan-sync.js (и чрез него enrichment-client.js, rewards-ui.js) ползва този вход с предимство
        if (!window.__npPlanAuth) window.__npPlanAuth = auth;
    }
} catch (_) { /* вече е стартиран (getAuth е минал пръв) — нищо */ }
