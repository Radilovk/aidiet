/**
 * Пратки от модулите (EmoEat, AIRIS) в браузъра на NutriPlan.
 *
 * handoff.html приема линка, показва какво носи пратката и пита за съгласие.
 * С „да“ пратката се записва като чакаща (np_pending_handoff) и:
 *  - при съществуващ профил се прибира веднага (/api/handoff/claim);
 *  - при нов клиент попълва въпросника, пътува с генерирането на първия план
 *    и се прибира, щом има userId (тук, автоматично, на следващата страница).
 * Към модулите не се връща нищо.
 */
(function (global) {
    'use strict';
    if (global.NutriPlanHandoff) return;

    var WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
    var KEY = 'np_pending_handoff';

    // Пратката живее на сървъра 30 дни — по-стара чакаща пратка не се ползва (нито за попълване, нито за пропускане).
    var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

    function readPending() {
        var p = null;
        try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
        if (p && p.consentAt && Date.now() - Date.parse(p.consentAt) > MAX_AGE_MS) {
            clearPending();
            return null;
        }
        return p;
    }

    /** @param {{ token: string, source: string, prefill?: object }} p */
    function setPending(p) {
        try { localStorage.setItem(KEY, JSON.stringify(Object.assign({ consentAt: new Date().toISOString() }, p))); } catch (_) {}
    }

    function clearPending() {
        try { localStorage.removeItem(KEY); } catch (_) {}
    }

    async function api(path, body) {
        var res = await fetch(WORKER_URL + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) {
            var err = new Error(data.error || ('HTTP ' + res.status));
            err.status = res.status;
            throw err;
        }
        return data;
    }

    function peek(token) { return api('/api/handoff/peek', { token: token }); }

    async function idTokenFor(uid) {
        var sync = global.NutriPlanPlanSync;
        if (uid && uid.indexOf('fb_') === 0 && sync && typeof sync.getFirebaseIdToken === 'function') {
            try { return await sync.getFirebaseIdToken(uid); } catch (_) { return null; }
        }
        return null;
    }

    /** Прибира чакащата пратка в профила (ако има профил). */
    async function claimPending() {
        var p = readPending();
        var uid = '';
        try { uid = localStorage.getItem('userId') || ''; } catch (_) {}
        if (!p || !p.token || !uid) return null;
        try {
            var res = await api('/api/handoff/claim', { token: p.token, userId: uid, idToken: (await idTokenFor(uid)) || undefined });
            clearPending();
            var text = res.derived && res.derived.essenceText;
            try {
                if (text) localStorage.setItem('np_health_essence', text);
                else localStorage.removeItem('np_health_essence');
                localStorage.setItem('np_open_questions', JSON.stringify((res.derived && res.derived.questions) || []));
            } catch (_) {}
            return res;
        } catch (e) {
            // Изтекла или вече прибрана пратка — не се опитваме повече.
            if (e.status === 404 || e.status === 400) clearPending();
            return null;
        }
    }

    global.NutriPlanHandoff = {
        pending: readPending,
        setPending: setPending,
        clearPending: clearPending,
        peek: peek,
        claimPending: claimPending
    };

    // Щом има профил и чакаща пратка — прибира се тихо (съгласието е дадено в handoff.html).
    try {
        if (readPending() && localStorage.getItem('userId') && !/handoff\.html|questionnaire2\.html/.test(location.pathname)) {
            setTimeout(function () { claimPending(); }, 1500);
        }
    } catch (_) {}
}(window));
