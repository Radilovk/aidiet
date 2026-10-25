/**
 * APK: предложение да се свържат здравните данни от телефона.
 *
 * Обвивката (index.html?app=1) проверява кои здравни приложения има на
 * телефона (health-apps.js) и, ако има поне едно, веднъж показва лист:
 * „На телефона има Samsung Health и Garmin Connect — свържи ги“. Едно
 * докосване отваря разрешенията на Health Connect (системният прозорец не
 * може да се прескочи — той е съгласието). Без Health Connect на Android
 * 9–13 бутонът води към Google Play. Ако приложението още не споделя с
 * Health Connect (Samsung Health, Garmin), следва една стъпка с бутон към него.
 *
 * Без нито едно здравно приложение — вграденият крачкомер на телефона.
 *
 * Показва се най-много 2 пъти, през 14 дни; „Не сега“ отлага.
 */
(function (global) {
    'use strict';
    var doc = global.document;
    var STATE_KEY = 'np_health_offer';
    var SNOOZE_MS = 14 * 86400000;
    var MAX_SHOWN = 2;
    var DELAY_MS = 5000;

    function readState() {
        try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}; } catch (_) { return {}; }
    }
    function writeState(patch) {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(Object.assign(readState(), patch))); } catch (_) {}
    }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function names(list) {
        var n = list.map(function (a) { return a.name; });
        return n.length > 1 ? n.slice(0, -1).join(', ') + ' и ' + n[n.length - 1] : (n[0] || '');
    }

    function due() {
        var H = global.NutriPlanHealth;
        var E = global.NutriPlanEnrichment;
        if (!H || !E || !H.supported() || !E.hasPlanProfile() || H.state().connected) return false;
        if (!new URLSearchParams(global.location.search).has('app')) return false;
        try { if (localStorage.getItem('planJobId')) return false; } catch (_) {}
        var st = readState();
        if ((st.shown || 0) >= MAX_SHOWN) return false;
        return !st.lastAt || Date.now() - Date.parse(st.lastAt) > SNOOZE_MS;
    }

    /** Отворен ли е друг прозорец (меню, вход, модал) — тогава не се натрапваме. */
    function busy() {
        var list = doc.querySelectorAll('.modal-overlay.active, .onboarding-overlay.active, [role="dialog"][aria-modal="true"]:not([hidden]), [role="alertdialog"]:not([hidden])');
        return Array.prototype.some.call(list, function (el) {
            if (el.closest('.hof-overlay')) return false;
            var cs = global.getComputedStyle(el);
            var r = el.getBoundingClientRect();
            return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.1 && r.width > 0 && r.height > 0
                && r.bottom > 0 && r.right > 0 && r.top < global.innerHeight && r.left < global.innerWidth;
        });
    }

    var CSS = '' +
        '.hof-overlay{position:fixed;inset:0;z-index:var(--ds-z-modal,1000);background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .2s ease}' +
        '.hof-overlay.is-open{opacity:1}' +
        '.hof-card{width:100%;max-width:520px;background:var(--bg-color,var(--ds-bg-primary,#fff));color:var(--ds-text-primary,#042F2E);border-radius:24px 24px 0 0;padding:12px 20px calc(20px + env(safe-area-inset-bottom,0px));box-shadow:var(--ds-shadow-xl);transform:translateY(24px);transition:transform .28s var(--ds-ease-standard,ease)}' +
        '.hof-overlay.is-open .hof-card{transform:none}' +
        '.hof-handle{width:40px;height:4px;border-radius:2px;background:var(--ds-border-primary,rgba(0,0,0,.15));margin:0 auto 16px}' +
        '.hof-icon{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:var(--ds-fill-grad);color:var(--ds-on-fill,#fff);font-size:1.4rem;margin-bottom:12px}' +
        '.hof-title{font-size:1.25rem;font-weight:800;margin:0 0 6px;line-height:1.3}' +
        '.hof-text{margin:0 0 12px;color:var(--ds-text-secondary);line-height:1.5;font-size:.975rem}' +
        '.hof-apps{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:0;list-style:none}' +
        '.hof-apps li{padding:6px 12px;border-radius:999px;font-size:.875rem;font-weight:600;background:var(--ds-success-bg,rgba(15,118,110,.1));color:var(--ds-success-text,#0F766E)}' +
        '.hof-note{margin:0 0 16px;font-size:.8125rem;color:var(--ds-text-soft)}' +
        '.hof-status{min-height:1.2em;margin:0 0 10px;font-size:.9rem;font-weight:600}' +
        '.hof-status[data-tone="error"]{color:var(--ds-error-text)}.hof-status[data-tone="ok"]{color:var(--ds-success-text)}' +
        '.hof-actions{display:grid;gap:8px}' +
        '.hof-btn{min-height:52px;border-radius:14px;border:none;font-size:1rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}' +
        '.hof-btn:active{transform:scale(var(--ds-press-scale,.98))}' +
        '.hof-primary{background:var(--ds-fill-grad);color:var(--ds-on-fill,#fff)}' +
        '.hof-ghost{background:none;color:var(--ds-text-secondary)}' +
        '.hof-choices{margin-bottom:8px}.hof-choice{background:rgba(13,148,136,.08);color:var(--ds-text-primary,#042F2E);border:1px solid rgba(13,148,136,.25);justify-content:flex-start;padding:0 16px}' +
        '.hof-btn[disabled]{opacity:.6}';

    var overlay = null;

    function close() {
        if (!overlay) return;
        var el = overlay;
        overlay = null;
        el.classList.remove('is-open');
        setTimeout(function () { el.remove(); }, 220);
    }

    function render(view) {
        var card = overlay.querySelector('.hof-card');
        card.innerHTML = '<div class="hof-handle" aria-hidden="true"></div>' +
            '<div class="hof-icon" aria-hidden="true"><i class="fas ' + (view.icon || 'fa-heart-pulse') + '"></i></div>' +
            '<h2 class="hof-title" id="hofTitle">' + esc(view.title) + '</h2>' +
            '<p class="hof-text">' + esc(view.text) + '</p>' +
            (view.apps && view.apps.length ? '<ul class="hof-apps">' + view.apps.map(function (a) { return '<li>' + esc(a.name) + '</li>'; }).join('') + '</ul>' : '') +
            (view.note ? '<p class="hof-note">' + esc(view.note) + '</p>' : '') +
            '<p class="hof-status" role="status" aria-live="polite"></p>' +
            (view.choices ? '<div class="hof-actions hof-choices">' + view.choices.map(function (c, i) {
                return '<button type="button" class="hof-btn hof-choice" data-choice="' + i + '">' + esc(c.label) + '</button>';
            }).join('') + '</div>' : '') +
            '<div class="hof-actions">' +
            (view.primary ? '<button type="button" class="hof-btn hof-primary" data-act="primary">' + (view.primaryIcon ? '<i class="fas ' + view.primaryIcon + '"></i>' : '') + esc(view.primary) + '</button>' : '') +
            '<button type="button" class="hof-btn hof-ghost" data-act="secondary">' + esc(view.secondary || 'Не сега') + '</button>' +
            '</div>';
        card.querySelectorAll('[data-choice]').forEach(function (b) {
            b.onclick = function () { view.choices[Number(b.dataset.choice)].pick(); };
        });
        var p = card.querySelector('[data-act="primary"]');
        if (p) p.onclick = function () { view.onPrimary(p, card.querySelector('.hof-status')); };
        card.querySelector('[data-act="secondary"]').onclick = view.onSecondary || snooze;
        (p || card.querySelector('[data-choice]') || card.querySelector('[data-act="secondary"]')).focus({ preventScroll: true });
    }

    function snooze() {
        close();
    }

    function setStatus(el, text, tone) {
        el.textContent = text || '';
        el.dataset.tone = tone || '';
    }

    function goToDevices() {
        close();
        try { sessionStorage.setItem('np_open_devices', '1'); } catch (_) {}
        try { global.postMessage({ type: 'NUTRIPLAN_SWITCH_TAB', tab: 'profile' }, global.location.origin); } catch (_) {}
    }

    /** След свързването: приложение, което още не споделя с Health Connect. */
    async function setupStep(d, res) {
        var needs = d.viaHc.filter(function (a) { return a.hcSetup; });
        // Избраното приложение трябва само да е записало данни — чуждите (напр. крачки от телефона) не броят.
        var mineArrived = res.sent > 0;
        if (needs.length === 1 && d.viaHc.length === 1) {
            try {
                var src = await global.NutriPlanHealth.dataSources();
                mineArrived = src.some(function (x) { return x.pkg === needs[0].pkg; });
            } catch (_) {}
        }
        if (mineArrived || !needs.length) {
            render({
                icon: 'fa-check', title: 'Свързано',
                text: res.sent > 0 ? 'Данните за последните 14 дни са в профила. Оттук нататък се обновяват сами.' : 'Health Connect е свързан. Щом приложенията запишат данни, те влизат в плана сами.',
                secondary: 'Готово', onSecondary: close
            });
            return;
        }
        var app = needs[0];
        render({
            icon: 'fa-list-check', title: 'Още една стъпка',
            text: app.name + ' още не споделя данни. В ' + (app.setupApp || app.name) + ': ' + app.hcSetup,
            note: 'После се върнете тук — данните се изтеглят сами.',
            primary: 'Отвори ' + (app.setupApp || app.name), primaryIcon: 'fa-arrow-up-right-from-square',
            onPrimary: function () {
                global.NutriPlanHealth.openApp(app.pkg).catch(function () {});
                var onBack = function () {
                    if (doc.visibilityState !== 'visible') return;
                    doc.removeEventListener('visibilitychange', onBack);
                    global.NutriPlanHealth.sync({ force: true }).then(function (r) { setupStep({ viaHc: [] }, r); }).catch(function () {});
                };
                doc.addEventListener('visibilitychange', onBack);
            },
            secondary: 'По-късно', onSecondary: close
        });
    }

    function connectView(d) {
        var H = global.NutriPlanHealth;
        var installFirst = !d.hcAvailable && d.hcInstallable;
        return {
            title: 'Свържи здравните данни',
            text: 'Открихме ' + names(d.viaHc) + '. Едно докосване — и планът следи реалните ти крачки, сън и тегло.',
            apps: d.viaHc,
            note: installFirst
                ? 'Първо: Health Connect на Google (безплатен посредник между приложенията).'
                : 'Само четене · изключваш по всяко време',
            primary: installFirst ? 'Инсталирай Health Connect' : 'Свържи',
            primaryIcon: installFirst ? 'fa-download' : 'fa-link',
            onPrimary: async function (btn, status) {
                if (installFirst) {
                    H.installHealthConnect().catch(function () {});
                    var onBack = async function () {
                        if (doc.visibilityState !== 'visible') return;
                        doc.removeEventListener('visibilitychange', onBack);
                        var again = await H.detect();
                        if (overlay) render(connectView(again));
                    };
                    doc.addEventListener('visibilitychange', onBack);
                    return;
                }
                btn.disabled = true;
                setStatus(status, 'Свързване…');
                try {
                    var res = await H.connect();
                    writeState({ connectedAt: new Date().toISOString() });
                    setupStep(d, res);
                } catch (e) {
                    btn.disabled = false;
                    setStatus(status, e.message || 'Свързването не успя.', 'error');
                }
            }
        };
    }

    /** Облачните връзки, включени на сървъра (device-links.js) — веднъж на отваряне. */
    var _cloud = null;
    async function cloudProviders() {
        if (_cloud) return _cloud;
        var E = global.NutriPlanEnrichment;
        try {
            var c = JSON.parse(global.localStorage.getItem('np_links_cache') || 'null');
            if (c && Date.now() - c.at < 24 * 3600 * 1000) return (_cloud = c.providers || []);
        } catch (_) {}
        try {
            _cloud = ((await E.linkProviders()).providers) || [];
            global.localStorage.setItem('np_links_cache', JSON.stringify({ at: Date.now(), providers: _cloud }));
        } catch (_) { _cloud = _cloud || []; }
        return _cloud;
    }

    /** Свързване на профил в облака с едно докосване: вход при доставчика, после данните идват сами. */
    function cloudView(app, provider) {
        var E = global.NutriPlanEnrichment;
        return {
            title: 'Свържи ' + provider.name,
            text: 'Открихме ' + app.name + '. Влез веднъж с акаунта си — крачките, сънят, пулсът и теглото идват сами.',
            apps: [app],
            note: 'Само четене · изключваш по всяко време',
            primary: 'Свържи', primaryIcon: 'fa-link',
            onPrimary: async function (btn, status) {
                btn.disabled = true;
                setStatus(status, 'Отваряме входа…');
                try {
                    E.setConsent('device', true);
                    var isApp = !!(global.NutriPlanPlatform && global.NutriPlanPlatform.isAPK());
                    var back = new URL('index.html?app=1&tab=plan', global.location.href).toString();
                    var res = await E.startLink(provider.id, isApp ? null : back);
                    global.sessionStorage.setItem('np_link_pending', provider.id);
                    // При връщане от браузъра — проверка и потвърждение тук.
                    var onBack = async function () {
                        if (doc.visibilityState !== 'visible') return;
                        doc.removeEventListener('visibilitychange', onBack);
                        _cloud = null;
                        try { global.localStorage.removeItem('np_links_cache'); } catch (_) {}
                        var list = await cloudProviders();
                        var linked = list.some(function (x) { return x.id === provider.id && x.linked; });
                        if (overlay) render(linked
                            ? { icon: 'fa-check', title: 'Свързано', text: 'Данните от ' + provider.name + ' вече влизат в плана и се обновяват сами.', secondary: 'Готово', onSecondary: close }
                            : cloudView(app, provider));
                    };
                    doc.addEventListener('visibilitychange', onBack);
                    global.location.href = res.url;
                } catch (e) {
                    btn.disabled = false;
                    setStatus(status, e.message || 'Свързването не успя.', 'error');
                }
            }
        };
    }

    /** Huawei/Honor: не дават данни на Health Connect — облакът на Huawei с едно докосване. */
    async function huaweiView(d) {
        var list = await cloudProviders();
        var hw = list.filter(function (x) { return x.id === 'huawei' && !x.linked; })[0];
        var app = d.other.filter(function (a) { return a.bridge; })[0];
        if (hw && app) return cloudView(app, hw);
        if (list.some(function (x) { return x.id === 'huawei' && x.linked; })) return null;
        // Облакът още не е включен — не натоварваме с мостове; снимка/файл остават в профила.
        return null;
    }

    /** Повече от едно приложение за тракер — клиентът избира своето (веднъж). */
    async function chooserView(d) {
        var H = global.NutriPlanHealth;
        var list = await cloudProviders();
        var hwCloud = list.filter(function (x) { return x.id === 'huawei' && !x.linked; })[0];
        var apps = d.viaHc.filter(function (a) { return a.id !== 'healthsync'; });
        var choices = apps.map(function (a) {
            return { label: a.name, pick: function () { H.setSource(a.pkg); render(connectView(Object.assign({}, d, { viaHc: [a] }))); } };
        });
        d.other.filter(function (a) { return a.bridge; }).forEach(function (a) {
            if (hwCloud) choices.push({ label: a.name, pick: function () { render(cloudView(a, hwCloud)); } });
        });
        if (choices.length < 2) return null;
        return {
            icon: 'fa-heart-pulse', title: 'Кое е твоето приложение?',
            text: 'На телефона има няколко приложения за гривна или часовник. Данните ще идват от това, което ползваш.',
            choices: choices
        };
    }

    /** Без гривна и здравно приложение: вграденият брояч на телефона (activity-tracker.js). */
    async function pedometerView() {
        var A = global.NutriPlanActivity;
        if (!A || !A.pedometer.supported() || A.state().enabled) return null;
        var st = await A.pedometer.status();
        if (!st.available) return null;
        return {
            icon: 'fa-shoe-prints', title: 'Крачкомер в телефона',
            text: 'Няма гривна или часовник — телефонът може да брои крачките. Пресмятаме ги по ръста и теглото ти — вечер не питаме за движението.',
            note: 'Само брояч на крачки · изключваш по всяко време от Профил → Устройства',
            primary: 'Включи', primaryIcon: 'fa-shoe-prints',
            onPrimary: async function (btn, status) {
                btn.disabled = true;
                setStatus(status, 'Включване…');
                try {
                    await A.pedometer.enable();
                    writeState({ pedometerAt: new Date().toISOString() });
                    render({ icon: 'fa-check', title: 'Включено', text: 'Крачките се броят от днес. Активността за деня се смята сама.', secondary: 'Готово', onSecondary: close });
                } catch (e) {
                    btn.disabled = false;
                    setStatus(status, e.message || 'Не успяхме да включим крачкомера.', 'error');
                }
            }
        };
    }

    async function offer() {
        if (!due() || busy() || overlay) return;
        var d = await global.NutriPlanHealth.detect();
        // Гривна на Huawei/Honor без мост е основният тракер — първо мостът.
        var hcReady = d.hcAvailable || d.hcInstallable;
        var view = hcReady ? await chooserView(d) : null;
        if (!view && d.other.length) view = await huaweiView(d);
        if (!view && d.viaHc.length && hcReady) {
            if (d.viaHc.length === 1) global.NutriPlanHealth.setSource(d.viaHc[0].pkg);
            view = connectView(d);
        }
        if (!view && !d.apps.length) view = await pedometerView();
        if (!view || busy() || !due()) return;
        var st = readState();
        writeState({ shown: (st.shown || 0) + 1, lastAt: new Date().toISOString() });
        if (!doc.getElementById('hofStyle')) {
            var style = doc.createElement('style');
            style.id = 'hofStyle';
            style.textContent = CSS;
            doc.head.appendChild(style);
        }
        overlay = doc.createElement('div');
        overlay.className = 'hof-overlay';
        overlay.innerHTML = '<div class="hof-card" role="dialog" aria-modal="true" aria-labelledby="hofTitle"></div>';
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        doc.addEventListener('keydown', function onKey(e) {
            if (e.key === 'Escape' && overlay) { close(); doc.removeEventListener('keydown', onKey); }
        });
        doc.body.appendChild(overlay);
        render(view);
        requestAnimationFrame(function () { if (overlay) overlay.classList.add('is-open'); });
    }

    global.NutriPlanHealthOffer = { offer: offer, close: close, isOpen: function () { return !!overlay; } };

    // Само обвивката на приложението (горният прозорец), след като се е успокоила.
    try {
        if (global.top === global) {
            var start = function () { setTimeout(function () { offer().catch(function () {}); }, DELAY_MS); };
            if (doc.readyState === 'complete') start();
            else global.addEventListener('load', start, { once: true });
        }
    } catch (_) {}
}(window));
