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
        return dropCache(keepEssence(await post('/api/enrichment', payload)));
    }

    /** Есенцията за чата пътува с отговорите на сървъра и се пази локално. */
    function keepEssence(data) {
        var text = data && data.derived && data.derived.essenceText;
        try {
            if (text) localStorage.setItem('np_health_essence', text);
            else if (data && data.derived) localStorage.removeItem('np_health_essence');
            // Отворените въпроси — за чата (асистентът пита само свързаните с темата).
            if (data && data.derived) localStorage.setItem('np_open_questions', JSON.stringify(data.derived.questions || []));
            // Анализът наново с всички данни — страницата „Анализ“ и профилът го показват веднага.
            if (data && data.reanalysis) localStorage.setItem('np_reanalysis', JSON.stringify(Object.assign({ at: new Date().toISOString() }, data.reanalysis)));
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

    var REANALYSIS_FIELDS = ['keyProblems', 'currentHealthStatus', 'forecastPessimistic', 'forecastOptimistic',
        'nutritionalNeeds', 'healthRisks', 'successChance', 'waterDeficit', 'bmi', 'bmiCategory', 'physiologicalPhase'];

    /** Има ли в реанализа данни извън въпросника — само тогава той сменя анализа от плана. */
    function hasReanalysisData(re) {
        return !!(re && re.analysis && ((re.labs || []).length || re.devices || re.emoeat || re.iris
            || (re.documents || []).length || (re.replaced || []).length));
    }

    /** Анализът от плана с проблемите, оценката и прогнозите от реанализа (енергията остава от плана). */
    function withReanalysis(base, re) {
        if (!base || !hasReanalysisData(re)) return base;
        var a = Object.assign({}, base);
        REANALYSIS_FIELDS.forEach(function (k) { if (re.analysis[k] != null) a[k] = re.analysis[k]; });
        return a;
    }

    // Общ кеш на отговора на /get за всички табове: най-много една заявка на 3 часа.
    // Всяка промяна (изпращане, отговор, изтриване) го изчиства.
    var CACHE_KEY = 'np_enrichment_cache';
    var CACHE_MS = 3 * 3600 * 1000;
    function dropCache(data) { try { localStorage.removeItem(CACHE_KEY); } catch (_) {} return data; }
    function getFresh() {
        return post('/api/enrichment/get', {}).then(keepEssence).then(function (data) {
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (_) {}
            return data;
        });
    }
    function getCached(maxAgeMs) {
        try {
            var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
            if (c && c.data && Date.now() - c.at < (maxAgeMs || CACHE_MS)) return Promise.resolve(c.data);
        } catch (_) {}
        return getFresh();
    }

    global.NutriPlanEnrichment = {
        hasPlanProfile: function () { return !!userId(); },
        hasConsent: hasConsent,
        setConsent: setConsent,
        submit: submit,
        get: getFresh,
        /** От кеша, ако е по-нов от 3 часа — за отваряне на табове. */
        getCached: getCached,
        dropCache: dropCache,
        /** Последният реанализ, запазен локално (или null). */
        hasReanalysisData: hasReanalysisData,
        withReanalysis: withReanalysis,
        cachedReanalysis: function () { try { return JSON.parse(localStorage.getItem('np_reanalysis') || 'null'); } catch (_) { return null; } },
        extractLabs: function (imageData, mimeType) { return post('/api/enrichment/extract-labs', { imageData: imageData, mimeType: mimeType }); },
        /** Отговор на въпрос за разминаване между източниците — самият отговор е съгласието. */
        resolve: function (questionId, answer) { return post('/api/enrichment/resolve', { questionId: questionId, answer: answer }).then(keepEssence).then(dropCache); },
        extractDevice: function (imageData, mimeType) { return post('/api/enrichment/extract-device', { imageData: imageData, mimeType: mimeType }); },
        assessDocument: function (doc) { return post('/api/enrichment/assess-document', doc || {}); },
        removeDocument: function (id) { return post('/api/enrichment/delete', { documentIds: [id] }).then(function (r) { return getFresh().then(function (g) { return Object.assign({}, r, { derived: g.derived }); }); }); },
        remove: function (kinds) {
            // След изтриване есенцията се презарежда — остава само от данните, които още са в профила.
            return post('/api/enrichment/delete', { kinds: kinds || null }).then(function (r) {
                try { localStorage.removeItem('np_health_essence'); } catch (_) {}
                return getFresh().catch(function () {}).then(function () { return r; });
            });
        },
        describeChange: describeChange,
        /** Профили в облака (Fitbit, Oura, Withings, Strava): кои са включени и свързани. */
        linkProviders: function () { return post('/api/links/providers', {}); },
        /** Адресът за вход при доставчика; returnTo — къде да се върне браузърът (само в уеб). */
        startLink: function (provider, returnTo) { return post('/api/links/start', { provider: provider, returnTo: returnTo || null }); },
        syncLinks: function (force) { return post('/api/links/sync', { force: !!force }).then(keepEssence).then(function (r) { if (r && r.derived) dropCache(); return r; }); },
        disconnectLink: function (provider) { return post('/api/links/disconnect', { provider: provider }); }
    };
}(window));
