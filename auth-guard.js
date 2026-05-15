/**
 * auth-guard.js
 * Protects every page that includes this module.
 * Unauthenticated visitors are redirected to index.html?login=1&next=<page>.
 *
 * Uses a named Firebase app instance ('auth-guard') so it does not conflict
 * with the default app initialised in profile.html.
 */

import { initializeApp }          from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
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

export const guardAuth = getAuth(initializeApp(_cfg, 'auth-guard'));

/* ── Loading overlay (shown while auth state is being resolved) ──────────── */
(function () {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg     = isDark ? '#0A1A1A' : '#F0FDFA';

    const ov = document.createElement('div');
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

    onAuthStateChanged(guardAuth, (user) => {
        if (user) {
            /* Authenticated — reveal the page */
            ov.style.opacity = '0';
            setTimeout(() => ov.remove(), 300);
        } else {
            /* Not authenticated — send to login */
            const next = encodeURIComponent(location.pathname + location.search);
            window.location.replace('index.html?login=1&next=' + next);
        }
    });
}());
