/**
 * auth-guard.js
 * Protects every page that includes this module.
 * Unauthenticated visitors are redirected to index.html?login=1&next=<page>.
 *
 * Always uses the DEFAULT Firebase app instance so that the auth state written
 * during sign-in (also on the default instance) is visible here.
 */

import { initializeApp, getApps, getApp }
                                   from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged }
                                   from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const _cfg = {
    apiKey:            'AIzaSyAZvIAAzP-6CBzQlQvoJTy-Iq24fBAPrJY',
    authDomain:        'nutriplan-c460a.firebaseapp.com',
    projectId:         'nutriplan-c460a',
    storageBucket:     'nutriplan-c460a.firebasestorage.app',
    messagingSenderId: '556207268794',
    appId:             '1:556207268794:web:4fa968491413abd4873383'
};

/* Reuse the default app if already initialised by the host page's module script;
 * otherwise create it as the default app.  This is critical: using a named app
 * ('auth-guard') would create a separate IndexedDB auth-state bucket that is
 * never written to during sign-in, causing every auth-protected page to redirect
 * back to the login screen in an infinite loop. */
const _app = getApps().length ? getApp() : initializeApp(_cfg);
export const guardAuth = getAuth(_app);

let _guardReadyResolve;
let _guardReadyResolved = false;
window.NutriPlanAuthGuardReady = window.NutriPlanAuthGuardReady || new Promise(resolve => {
    _guardReadyResolve = resolve;
});

function _resolveGuardReady(user) {
    if (_guardReadyResolved) return;
    _guardReadyResolved = true;
    if (_guardReadyResolve) _guardReadyResolve(user || null);
}

/* ── Loading overlay (shown while auth state is being resolved) ──────────── */
(function () {
    /* If the user is already known to be logged in (userId stored by the sign-in
     * flow), skip the visual overlay entirely so tab switches feel instant.
     * onAuthStateChanged still runs in the background: if Firebase disagrees
     * (e.g. session revoked) the user is redirected to login. */
    const cachedUserId = localStorage.getItem('userId') || '';
    const likelyAuthed = cachedUserId.startsWith('fb_');

    /* When the user appears to be authenticated, immediately unblock pages that
     * await NutriPlanAuthGuardReady so body opacity is restored without waiting
     * for Firebase (which can take 2–10 s on APK cold start).
     * onAuthStateChanged still runs in the background; if the token is no longer
     * valid it will redirect to login. */
    if (likelyAuthed) {
        _resolveGuardReady(null);
    }

    let ov = null;
    if (!likelyAuthed) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const bg     = isDark ? '#0A1A1A' : '#F0FDFA';

        ov = document.createElement('div');
        ov.id    = 'auth-guard-overlay';
        ov.innerHTML =
            '<style>' +
            '@keyframes _ag_spin{to{transform:rotate(360deg)}}' +
            '#auth-guard-overlay{position:fixed;inset:0;background:' + bg + ';' +
            'display:flex;align-items:center;justify-content:center;z-index:99999;' +
            'transition:opacity .25s}' +
            '#auth-guard-overlay .ag-sp{width:40px;height:40px;border:3px solid #0D9488;' +
            'border-top-color:transparent;border-radius:50%;animation:_ag_spin .8s linear infinite}' +
            '</style>' +
            '<div class="ag-sp"></div>';

        document.documentElement.appendChild(ov);
    }

    onAuthStateChanged(guardAuth, async (user) => {
        if (user) {
            if (window.NutriPlanSession && typeof window.NutriPlanSession.ensureAuthenticatedUser === 'function') {
                await window.NutriPlanSession.ensureAuthenticatedUser(user);
            }
            if (window.NutriPlanDiagnostics) {
                window.NutriPlanDiagnostics.ok('auth-guard', 'authenticated', location.pathname.split('/').pop() || 'unknown');
            }
            /* Authenticated — reveal the page (overlay may not exist) */
            if (ov) {
                ov.style.opacity = '0';
                setTimeout(() => ov.remove(), 300);
            }
            _resolveGuardReady(user);
        } else {
            if (window.NutriPlanDiagnostics) {
                window.NutriPlanDiagnostics.fail('auth-guard', 'redirect-login', location.pathname.split('/').pop() || 'unknown');
            }
            /* Not authenticated — send to login */
            _resolveGuardReady(null);
            const next = encodeURIComponent(location.pathname + location.search);
            window.location.replace('index.html?login=1&next=' + next);
        }
    });
}());
