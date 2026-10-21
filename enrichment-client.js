/**
 * Клиент за обогатяването на профила (POST /api/enrichment, /api/enrichment/get).
 * Използва се от EmoEat, профила (изследвания) и приложението (устройства).
 * Изпраща само със съгласие — съгласието се пази по източник.
 */
(function (global) {
    'use strict';
    if (global.NutriPlanEnrichment) return;

    var WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
    var CONSENT_KEY = 'np_enrichment_consent';
    // Публичната конфигурация на уеб приложението — същата като в plan-sync.js.
    var FIREBASE_WEB_CONFIG = {
        apiKey: 'AIzaSyAZvIAAzP-6CBzQlQvoJTy-Iq24fBAPrJY',
        authDomain: 'nutriplan-c460a.firebaseapp.com',
        projectId: 'nutriplan-c460a',
        storageBucket: 'nutriplan-c460a.firebasestorage.app',
        messagingSenderId: '556207268794',
        appId: '1:556207268794:web:4fa968491413abd4873383'
    };

    function userId() {
        try { return localStorage.getItem('userId') || ''; } catch (_) { return ''; }
    }

    async function idToken(uid) {
        var sync = global.NutriPlanPlanSync;
        if (sync && typeof sync.getFirebaseIdToken === 'function') return sync.getFirebaseIdToken(uid);
        if (!uid || String(uid).indexOf('fb_') !== 0) return null;
        try {
            var appMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
            var authMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
            var app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_WEB_CONFIG);
            var auth = authMod.getAuth(app);
            if (typeof auth.authStateReady === 'function') await auth.authStateReady();
            var user = auth.currentUser;
            if (!user || 'fb_' + user.uid !== uid) return null;
            return await user.getIdToken();
        } catch (_) {
            return null;
        }
    }

    function consents() {
        try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || '{}') || {}; } catch (_) { return {}; }
    }

    /** @param {'emoeat'|'labs'|'device'} source @param {boolean} value */
    function setConsent(source, value) {
        var c = consents();
        c[source] = value ? new Date().toISOString() : null;
        try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch (_) {}
    }

    function hasConsent(source) {
        return !!consents()[source];
    }

    async function post(path, body) {
        var uid = userId();
        if (!uid) throw new Error('Няма профил с план');
        var token = await idToken(uid);
        var res = await fetch(WORKER_URL + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ userId: uid, idToken: token || undefined }, body || {}))
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
    }

    /**
     * @param {{ facts?: object[], emoeat?: object }} payload
     * @param {'emoeat'|'labs'|'device'} source
     */
    async function submit(payload, source) {
        if (!hasConsent(source)) throw new Error('Няма съгласие за този източник');
        return keepEssence(await post('/api/enrichment', payload));
    }

    /** Есенцията за чата пътува с отговорите на сървъра и се пази локално. */
    function keepEssence(data) {
        var text = data && data.derived && data.derived.essenceText;
        try {
            if (text) localStorage.setItem('np_health_essence', text);
            else if (data && data.derived) localStorage.removeItem('np_health_essence');
            // Отворените въпроси — за чата (асистентът пита само свързаните с темата).
            if (data && data.derived) localStorage.setItem('np_open_questions', JSON.stringify(data.derived.questions || []));
        } catch (_) {}
        return data;
    }

    /** Какво значи нивото за клиента — едно изречение. */
    function describeChange(res) {
        if (!res) return '';
        if (res.urgent) return 'Данните са изпратени на специалиста — той ще прегледа плана преди следващата стъпка.';
        if (res.level >= 2) return 'Планът ще бъде преизчислен с новите данни при следващия седмичен преглед.';
        if (res.level === 1) return 'Менюто ще се съобрази с новите данни при следващия седмичен преглед.';
        return 'Съветите и психологическите насоки ще отчитат новите данни от следващата седмица.';
    }

    global.NutriPlanEnrichment = {
        hasPlanProfile: function () { return !!userId(); },
        hasConsent: hasConsent,
        setConsent: setConsent,
        submit: submit,
        get: function () { return post('/api/enrichment/get', {}).then(keepEssence); },
        extractLabs: function (imageData, mimeType) { return post('/api/enrichment/extract-labs', { imageData: imageData, mimeType: mimeType }); },
        /** Отговор на въпрос за разминаване между източниците — самият отговор е съгласието. */
        resolve: function (questionId, answer) { return post('/api/enrichment/resolve', { questionId: questionId, answer: answer }).then(keepEssence); },
        extractDevice: function (imageData, mimeType) { return post('/api/enrichment/extract-device', { imageData: imageData, mimeType: mimeType }); },
        assessDocument: function (doc) { return post('/api/enrichment/assess-document', doc || {}); },
        removeDocument: function (id) { return post('/api/enrichment/delete', { documentIds: [id] }).then(function (r) { return post('/api/enrichment/get', {}).then(keepEssence).then(function (g) { return Object.assign({}, r, { derived: g.derived }); }); }); },
        remove: function (kinds) {
            // След изтриване есенцията се презарежда — остава само от данните, които още са в профила.
            return post('/api/enrichment/delete', { kinds: kinds || null }).then(function (r) {
                try { localStorage.removeItem('np_health_essence'); } catch (_) {}
                return post('/api/enrichment/get', {}).then(keepEssence).catch(function () {}).then(function () { return r; });
            });
        },
        describeChange: describeChange
    };
}(window));
