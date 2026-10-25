/**
 * Health Connect (Android) → обогатяване на профила.
 *
 * Health Connect е общият вход на Android: в него пишат Samsung Health,
 * Fitbit, Garmin Connect, Zepp/Amazfit, Mi Fitness, Withings, Oura, Polar,
 * везни (Renpho, Eufy, Xiaomi) и приложения за хранене (MyFitnessPal, Yazio).
 * Оттук се четат само видовете, които планът използва, обобщават се по дни
 * и се изпращат като факти (POST /api/enrichment, източник „health_connect“).
 * Анализът (тенденции, възстановяване, състав на тялото) е на сървъра.
 *
 * - работи само в APK с плъгина @capgo/capacitor-health; другаде е неактивен;
 * - изпраща само със съгласие „device“;
 * - крачките и приема — само за завършени дни (днешният е непълен);
 * - автоматично синхронизиране най-много веднъж на 6 часа, от обвивката.
 */
(function (global) {
    'use strict';
    if (global.NutriPlanHealth) return;

    var STATE_KEY = 'np_health_state';
    var READ_TYPES = ['steps', 'weight', 'sleep', 'dietaryEnergyConsumed', 'bodyFat', 'restingHeartRate',
        'heartRateVariability', 'calories', 'workouts', 'dietaryWater', 'bloodPressure', 'bloodGlucose'];
    var DEVICE_KINDS = ['steps', 'weight', 'sleep', 'intake', 'body_fat', 'muscle_mass', 'visceral_fat', 'body_water',
        'resting_hr', 'hrv', 'active_kcal', 'workout', 'water', 'bp', 'glucose'];
    var MORNING_HOURS = [4, 10];
    var DAYS = 14;
    var AUTO_EVERY_MS = 6 * 3600 * 1000;
    // Ден с под 500 kcal записан прием е непълно водене, не реален прием.
    var MIN_INTAKE_DAY = 500;

    function bridge() {
        try {
            // В рамка — мостът на горния прозорец: отговорите от Android стигат само до него.
            if (global.top && global.top !== global && global.top.Capacitor) return global.top.Capacitor;
            if (global.Capacitor) return global.Capacitor;
        } catch (_) {}
        return null;
    }

    function plugin() {
        var cap = bridge();
        if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
        if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'android') return null;
        return (cap.Plugins && cap.Plugins.Health) || null;
    }

    /** Нативният помощник в APK (NutriSystemUiPlugin.java): инсталирани приложения, отваряне. */
    function nativeUi() {
        var cap = bridge();
        if (!plugin() || !cap) return null;
        var ui = cap.Plugins && cap.Plugins.NutriSystemUi;
        if (!ui && typeof cap.registerPlugin === 'function') {
            try { ui = cap.registerPlugin('NutriSystemUi'); } catch (_) {}
        }
        return ui || null;
    }

    function readState() {
        try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}; } catch (_) { return {}; }
    }

    function writeState(patch) {
        var s = Object.assign(readState(), patch);
        try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {}
        return s;
    }

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    /** Локалната дата на устройството — денят, в който клиентът е живял записа. */
    function localDay(iso) {
        var d = new Date(iso);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function factAt(day) { return day + 'T12:00:00.000Z'; }

    function startOfToday() {
        var d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    async function isAvailable() {
        var H = plugin();
        if (!H) return { available: false, reason: 'not_native' };
        try { return await H.isAvailable(); } catch (e) { return { available: false, reason: e.message }; }
    }

    async function daySums(H, dataType, from, to) {
        var res = await H.queryAggregated({ dataType: dataType, startDate: from.toISOString(), endDate: to.toISOString(), bucket: 'day', aggregation: 'sum' });
        return (res && res.samples || []).map(function (s) { return { day: localDay(s.startDate), value: Number(s.value) }; });
    }

    /** Сън по деня на събуждане; при фази — без будуване и „в леглото“. */
    function sleepByDay(samples) {
        var byDay = {};
        (samples || []).forEach(function (s) {
            var minutes = Number(s.value) || 0;
            if (s.hasStageData && Array.isArray(s.stages)) {
                minutes = s.stages.reduce(function (sum, st) {
                    return st.stage === 'awake' || st.stage === 'inBed' ? sum : sum + (Number(st.durationMinutes) || 0);
                }, 0);
            }
            if (minutes <= 0) return;
            var day = localDay(s.endDate);
            byDay[day] = (byDay[day] || 0) + minutes;
        });
        return Object.keys(byDay).map(function (day) { return { day: day, value: Math.round(byDay[day] / 6) / 10 }; });
    }

    var WEARABLE = { watch: 1, fitnessBand: 1, ring: 1, chestStrap: 1, scale: 1 };

    /**
     * Пробите от избрания източник (пакета на приложението); ако той няма такъв вид —
     * от гривна/часовник, иначе всички. Така крачките от телефона и от гривната не се събират.
     */
    function fromSource(list, pkg) {
        if (!list || !list.length) return list || [];
        if (pkg) {
            var mine = list.filter(function (s) { return s.sourceId === pkg; });
            if (mine.length) return mine;
        }
        var worn = list.filter(function (s) { return WEARABLE[s.deviceType]; });
        if (worn.length) {
            // Един носим източник — този с най-много записи.
            var count = {};
            worn.forEach(function (s) { count[s.sourceId] = (count[s.sourceId] || 0) + 1; });
            var best = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
            return worn.filter(function (s) { return s.sourceId === best; });
        }
        return list;
    }

    /** Сбор по ден от пробите (крачки, калории) — само от един източник. */
    function sumSamplesByDay(list) {
        var byDay = {};
        list.forEach(function (s) { var d = localDay(s.startDate); byDay[d] = (byDay[d] || 0) + (Number(s.value) || 0); });
        return Object.keys(byDay).map(function (d) { return { day: d, value: byDay[d] }; });
    }

    async function collectFacts(granted) {
        var H = plugin();
        var pkg = readState().source || null;
        var today = startOfToday();
        var from = new Date(today.getTime() - DAYS * 86400000);
        var now = new Date();
        var facts = [];
        var has = function (t) { return !granted || granted.indexOf(t) !== -1; };
        var push = function (kind, list) {
            list.forEach(function (x) { facts.push({ kind: kind, value: x.value, at: factAt(x.day), source: 'health_connect' }); });
        };
        var errors = [];
        var run = async function (type, fn) {
            if (!has(type)) return;
            try { await fn(); } catch (e) { errors.push(type + ': ' + (e && e.message)); }
        };
        await run('steps', async function () {
            // С избран източник — пробите му; иначе сборът на Health Connect (той сам
            // подрежда източниците по приоритета, зададен в Health Connect).
            var list = pkg ? (await H.readSamples({ dataType: 'steps', startDate: from.toISOString(), endDate: today.toISOString(), limit: 5000 }) || {}).samples || [] : [];
            var mine = list.filter(function (s) { return s.sourceId === pkg; });
            var days = mine.length ? sumSamplesByDay(mine) : await daySums(H, 'steps', from, today);
            push('steps', days.filter(function (x) { return x.value > 0; }).map(function (x) { return { day: x.day, value: Math.round(x.value) }; }));
        });
        await run('dietaryEnergyConsumed', async function () {
            push('intake', (await daySums(H, 'dietaryEnergyConsumed', from, today)).filter(function (x) { return x.value >= MIN_INTAKE_DAY; }));
        });
        await run('weight', async function () {
            var res = await H.readSamples({ dataType: 'weight', startDate: from.toISOString(), endDate: now.toISOString(), limit: 200 });
            push('weight', fromSource(res && res.samples || [], pkg).map(function (s) { return { day: localDay(s.startDate), value: Number(s.value) }; }));
        });
        // Пробите за деня: средно за пулса и HRV, последното за мазнините,
        // средно за кръвното, сутрешният минимум и дневният максимум за захарта.
        var samples = async function (type) {
            var res = await H.readSamples({ dataType: type, startDate: from.toISOString(), endDate: now.toISOString(), limit: 1000 });
            return fromSource((res && res.samples) || [], pkg);
        };
        var byDay = function (list, pick) {
            var days = {};
            list.forEach(function (s) { var d = localDay(s.startDate); (days[d] = days[d] || []).push(s); });
            return Object.keys(days).map(function (d) { return Object.assign({ day: d }, pick(days[d])); }).filter(function (x) { return x.value != null; });
        };
        var avg = function (xs) { return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : null; };
        var round1 = function (v) { return Math.round(v * 10) / 10; };
        await run('restingHeartRate', async function () {
            push('resting_hr', byDay(await samples('restingHeartRate'), function (l) { return { value: Math.round(avg(l.map(function (s) { return Number(s.value); }))) }; }));
        });
        await run('heartRateVariability', async function () {
            push('hrv', byDay(await samples('heartRateVariability'), function (l) { return { value: Math.round(avg(l.map(function (s) { return Number(s.value); }))) }; }));
        });
        await run('bodyFat', async function () {
            push('body_fat', byDay(await samples('bodyFat'), function (l) { return { value: round1(Number(l[l.length - 1].value)) }; }));
        });
        await run('calories', async function () {
            push('active_kcal', (await daySums(H, 'calories', from, today)).filter(function (x) { return x.value > 0; }).map(function (x) { return { day: x.day, value: Math.round(x.value) }; }));
        });
        await run('dietaryWater', async function () {
            push('water', (await daySums(H, 'dietaryWater', from, today)).filter(function (x) { return x.value > 0.2; }).map(function (x) { return { day: x.day, value: round1(x.value) }; }));
        });
        await run('bloodPressure', async function () {
            byDay((await samples('bloodPressure')).filter(function (s) { return s.systolic && s.diastolic; }), function (l) {
                return { value: Math.round(avg(l.map(function (s) { return Number(s.systolic); }))), value2: Math.round(avg(l.map(function (s) { return Number(s.diastolic); }))) };
            }).forEach(function (x) { facts.push({ kind: 'bp', value: x.value, value2: x.value2, at: factAt(x.day), source: 'health_connect' }); });
        });
        await run('bloodGlucose', async function () {
            byDay(await samples('bloodGlucose'), function (l) {
                var morning = l.filter(function (s) { var h = new Date(s.startDate).getHours(); return h >= MORNING_HOURS[0] && h < MORNING_HOURS[1]; });
                return {
                    value: Math.max.apply(null, l.map(function (s) { return Number(s.value); })),
                    morning: morning.length ? Math.min.apply(null, morning.map(function (s) { return Number(s.value); })) : null
                };
            }).forEach(function (x) {
                facts.push({ kind: 'glucose', key: 'peak', value: x.value, unit: 'mg/dL', at: factAt(x.day), source: 'health_connect' });
                if (x.morning != null) facts.push({ kind: 'glucose', key: 'morning', value: x.morning, unit: 'mg/dL', at: factAt(x.day), source: 'health_connect' });
            });
        });
        await run('workouts', async function () {
            var res = await H.queryWorkouts({ startDate: from.toISOString(), endDate: now.toISOString(), limit: 200 });
            var days = {};
            fromSource((res && res.workouts) || [], pkg).forEach(function (w) {
                var minutes = (Number(w.duration) || 0) / 60;
                if (minutes < 10) return;
                var d = localDay(w.startDate);
                days[d] = days[d] || { minutes: 0, count: 0 };
                days[d].minutes += minutes;
                days[d].count += 1;
            });
            Object.keys(days).forEach(function (d) {
                facts.push({ kind: 'workout', value: Math.round(days[d].minutes), count: days[d].count, at: factAt(d), source: 'health_connect' });
            });
        });
        await run('sleep', async function () {
            // Нощта срещу първия ден започва предишната вечер.
            var res = await H.readSamples({ dataType: 'sleep', startDate: new Date(from.getTime() - 86400000).toISOString(), endDate: now.toISOString(), limit: 200 });
            push('sleep', sleepByDay(fromSource(res && res.samples || [], pkg)).filter(function (x) { return x.day >= localDay(from.toISOString()); }));
        });
        return { facts: facts, errors: errors };
    }

    /** Иска достъп само за четирите вида; съгласието се записва преди това. */
    async function connect() {
        var H = plugin();
        if (!H) throw new Error('Health Connect е достъпен само в приложението за Android.');
        var avail = await isAvailable();
        if (!avail.available) throw new Error('Health Connect не е инсталиран или не е обновен на това устройство.');
        var E = global.NutriPlanEnrichment;
        E.setConsent('device', true);
        var status = await H.requestAuthorization({ read: READ_TYPES });
        var granted = (status && status.readAuthorized) || [];
        if (!granted.length) {
            E.setConsent('device', false);
            throw new Error('Не е разрешен достъп до нито един вид данни.');
        }
        writeState({ connected: true, granted: granted, connectedAt: new Date().toISOString() });
        return sync({ force: true });
    }

    /**
     * @param {{ force?: boolean }} [opts]
     * @returns {Promise<{ sent: number, level?: number, message?: string, skipped?: string }>}
     */
    async function sync(opts) {
        var st = readState();
        var E = global.NutriPlanEnrichment;
        if (!st.connected || !E || !E.hasConsent('device') || !E.hasPlanProfile()) return { sent: 0, skipped: 'not_connected' };
        if (!plugin()) return { sent: 0, skipped: 'not_native' };
        if (!(opts && opts.force) && st.lastSync && Date.now() - Date.parse(st.lastSync) < AUTO_EVERY_MS) return { sent: 0, skipped: 'recent' };
        var out = await collectFacts(st.granted);
        // Без тренировки въпрос за активност няма — нивото на деня идва от крачките.
        try {
            var stepsByDay = {};
            out.facts.forEach(function (f) { if (f.kind === 'steps') stepsByDay[String(f.at).slice(0, 10)] = f.value; });
            if (global.NutriPlanActivity) global.NutriPlanActivity.fillFromSteps(stepsByDay);
        } catch (_) {}
        // Какво точно е дошло: вид → брой дни (за ясен статус в профила и анализа).
        var summary = {};
        out.facts.forEach(function (f) {
            var d = String(f.at).slice(0, 10);
            (summary[f.kind] = summary[f.kind] || {})[d] = true;
        });
        Object.keys(summary).forEach(function (k) { summary[k] = Object.keys(summary[k]).length; });
        if (!out.facts.length) {
            writeState({ lastSync: new Date().toISOString(), lastCount: 0, lastSummary: {}, lastErrors: out.errors });
            return { sent: 0, message: 'Няма нови данни в Health Connect за последните две седмици.' };
        }
        // Същите данни като при последното изпращане — без заявка към сървъра.
        var sig = String(out.facts.length) + ':' + JSON.stringify(out.facts).length + ':' + JSON.stringify(out.facts.slice(-5));
        if (!(opts && opts.force) && st.lastSig === sig) {
            writeState({ lastSync: new Date().toISOString(), lastSummary: summary });
            return { sent: 0, skipped: 'unchanged' };
        }
        var res = await E.submit({ facts: out.facts }, 'device');
        writeState({ lastSync: new Date().toISOString(), lastCount: out.facts.length, lastSummary: summary, lastSig: sig, lastErrors: out.errors });
        return { sent: out.facts.length, level: res.level, message: E.describeChange(res), derived: res.derived };
    }

    /** Спира синхронизирането и изтрива изпратените данни от устройства. */
    async function disconnect() {
        var E = global.NutriPlanEnrichment;
        writeState({ connected: false, granted: [], lastSync: null });
        if (E) {
            E.setConsent('device', false);
            await E.remove(DEVICE_KINDS);
        }
    }

    /**
     * Кои здравни приложения има на телефона и дали Health Connect е готов.
     * @returns {Promise<{ apps: object[], viaHc: object[], other: object[], manufacturer: string, sdk: number,
     *   hcAvailable: boolean, hcInstallable: boolean }>}
     */
    async function detect() {
        var A = global.NutriPlanHealthApps;
        var ui = nativeUi();
        var out = { apps: [], viaHc: [], other: [], manufacturer: '', sdk: 0, hcAvailable: false, hcInstallable: false };
        if (!A || !ui || typeof ui.installedApps !== 'function') return out;
        var res = null;
        try {
            res = await ui.installedApps({ packages: A.APPS.map(function (a) { return a.pkg; }).concat(A.HEALTH_CONNECT_PKG) });
        } catch (_) { return out; }
        var installed = (res && res.installed) || [];
        out.apps = A.APPS.filter(function (a) { return installed.indexOf(a.pkg) !== -1; });
        var has = function (id) { return out.apps.some(function (a) { return a.id === id; }); };
        // Приложение с мост (Huawei → Health Sync): с инсталиран мост данните му идват през Health Connect.
        var bridged = out.apps.filter(function (a) { return !a.hc && a.bridge && has(a.bridge); });
        out.viaHc = out.apps.filter(function (a) { return a.hc && !(a.id === 'healthsync' && bridged.length); })
            .concat(bridged.map(function (a) {
                var b = A.byId(a.bridge);
                return { id: a.id, name: a.name + ' (през ' + b.name + ')', pkg: b.pkg, hc: true, hcSetup: b.hcSetup, setupApp: b.name };
            }));
        out.other = out.apps.filter(function (a) { return !a.hc && bridged.indexOf(a) === -1; });
        out.manufacturer = String((res && res.manufacturer) || '');
        out.sdk = Number(res && res.sdk) || 0;
        out.hcAvailable = !!(await isAvailable()).available;
        // До Android 14 Health Connect е отделно приложение от Google Play.
        out.hcInstallable = !out.hcAvailable && out.sdk >= 26 && out.sdk < 34;
        writeState({ detected: { at: new Date().toISOString(), apps: out.apps.map(function (a) { return a.id; }), manufacturer: out.manufacturer } });
        return out;
    }

    /** Кои приложения реално са записали данни в Health Connect (последните 7 дни). */
    async function dataSources() {
        var H = plugin();
        if (!H || !readState().connected) return [];
        var from = new Date(Date.now() - 7 * 86400000).toISOString();
        var count = {};
        var names = {};
        for (var i = 0; i < 2; i++) {
            try {
                var res = await H.readSamples({ dataType: ['steps', 'sleep'][i], startDate: from, endDate: new Date().toISOString(), limit: 2000 });
                ((res && res.samples) || []).forEach(function (s) {
                    if (!s.sourceId) return;
                    count[s.sourceId] = (count[s.sourceId] || 0) + 1;
                    names[s.sourceId] = s.sourceName || s.sourceId;
                });
            } catch (_) {}
        }
        var A = global.NutriPlanHealthApps;
        return Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).map(function (pkgId) {
            var app = A && A.byPkg(pkgId);
            return { pkg: pkgId, name: app ? app.name : names[pkgId], records: count[pkgId] };
        });
    }

    /** Избраното приложение (пакет) — данните идват от него; null = автоматично. */
    function setSource(pkg) {
        writeState({ source: pkg || null, lastSig: null });
    }

    async function openApp(pkg) {
        var ui = nativeUi();
        if (ui && typeof ui.openApp === 'function') await ui.openApp({ package: pkg });
    }

    async function openStore(pkg) {
        var ui = nativeUi();
        if (ui && typeof ui.openStore === 'function') await ui.openStore({ package: pkg });
    }

    async function installHealthConnect() {
        var ui = nativeUi();
        var A = global.NutriPlanHealthApps;
        if (ui && A && typeof ui.openStore === 'function') await ui.openStore({ package: A.HEALTH_CONNECT_PKG });
    }

    async function openSettings() {
        var H = plugin();
        if (H && typeof H.openHealthConnectSettings === 'function') await H.openHealthConnectSettings();
    }

    var KIND_LABELS = { steps: 'крачки', sleep: 'сън', weight: 'тегло', body_fat: 'мазнини', resting_hr: 'пулс в покой', hrv: 'вариабилност на пулса',
        active_kcal: 'активни калории', workout: 'тренировки', water: 'вода', bp: 'кръвно', glucose: 'захар', intake: 'приети калории' };

    /** „крачки (2 дни), сън (5 нощи)“ — какво е дошло при последното обновяване. */
    function describeLast() {
        var sum = readState().lastSummary || {};
        return Object.keys(sum).map(function (k) {
            var n = sum[k];
            return (KIND_LABELS[k] || k) + ' (' + n + ' ' + (k === 'sleep' ? (n === 1 ? 'нощ' : 'нощи') : (n === 1 ? 'ден' : 'дни')) + ')';
        }).join(', ');
    }

    global.NutriPlanHealth = {
        describeLast: describeLast,
        supported: function () { return !!plugin(); },
        isAvailable: isAvailable,
        state: readState,
        connect: connect,
        sync: sync,
        disconnect: disconnect,
        openSettings: openSettings,
        detect: detect,
        openApp: openApp,
        installHealthConnect: installHealthConnect,
        openStore: openStore,
        dataSources: dataSources,
        setSource: setSource,
        // За тестове: превръщането на пробите в дни.
        _sleepByDay: sleepByDay
    };

    // Обвивката (горният прозорец) синхронизира тихо при отваряне и при връщане
    // в приложението (sync сам пази интервала от 6 часа).
    try {
        if (global.top === global) {
            if (readState().connected) setTimeout(function () { sync().catch(function () {}); }, 4000);
            global.document.addEventListener('visibilitychange', function () {
                if (global.document.visibilityState === 'visible' && readState().connected) sync().catch(function () {});
            });
        }
    } catch (_) {}
}(window));
