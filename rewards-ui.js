/**
 * Награди за постоянство — телефонът: картата „Пътят към успеха“ в Напредък, тържеството при етап,
 * малките поздрави и картата за споделяне. Правилата — rewards-engine.js; портфейлът и кодовете —
 * сървърът (rewards.js, /api/user/rewards).
 *
 *   <link rel="stylesheet" href="./rewards-ui.css">
 *   <script src="./rewards-engine.js"></script> <script src="./rewards-ui.js"></script>
 *   NutriPlanRewards.mount(el)    // картата (game-analytics.html)
 *   NutriPlanRewards.checkSoon()  // след отметка (plan.html): нов етап → тържество
 *
 * Поздравите са редки, за да значат нещо: най-много едно тържество на отваряне, малките —
 * до 3 на седмица. Сравнение с другите — само когато е вярно и в полза на човека (над средното),
 * и не при профилите без оценки (persona.noScores).
 */
(function (global) {
    'use strict';
    var doc = global.document;
    var WORKER = 'https://aidiet.radilov-k.workers.dev';
    var SHOP = 'https://biocode-bg.com/portfolio.html';
    var SITE = 'https://nutriin.app';
    var SEEN_KEY = 'np_rewards_seen';
    var TOAST_KEY = 'np_rewards_toasts';
    var SRV_KEY = 'np_rewards_srv';
    var REC_KEY = 'np_rewards_records';
    var SRV_TTL = 30 * 60 * 1000;   // портфейлът се мени рядко; новото ниво и действията го обновяват веднага
    var CONTENT_TTL = 6 * 3600 * 1000;
    var DAY = 86400000;
    var RE = global.RewardsEngine;
    var CONTENT_KEY = 'np_rewards_content';
    var OPENS_KEY = 'np_opens';
    var CHALLENGE_KEY = 'np_challenge';
    var WEEK_KEY = 'np_rewards_week';

    // Текстовете, думите на кодовете и снимките от админ панела (/api/rewards/content): веднага от
    // паметта на устройството, после се обновяват (до 10 мин.) — стойностите по подразбиране са в ядрото.
    function applyCached() { var c = read(CONTENT_KEY, null); if (RE) RE.applyContent(c && c.content); return c; }
    var contentLoad = null;
    function loadContent() {
        var c = applyCached();
        if (c && Date.now() - c.at < CONTENT_TTL) return Promise.resolve();
        if (contentLoad) return contentLoad;
        contentLoad = fetch(WORKER + '/api/rewards/content').then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.success) { write(CONTENT_KEY, { at: Date.now(), content: d.content || {} }); applyCached(); }
        }).catch(function () {}).then(function () { contentLoad = null; });
        return contentLoad;
    }
    applyCached();

    function read(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? def : v; } catch (_) { return def; } }
    function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function plural(n, one, many) { return n === 1 ? one : many; }
    function isApp() { try { return !!(global.NutriPlanPlatform && NutriPlanPlatform.isAPK && NutriPlanPlatform.isAPK()); } catch (_) { return false; } }
    function reducedMotion() { try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } }
    function persona() { return read('np_persona', {}) || {}; }
    function userId() { try { return localStorage.getItem('userId') || ''; } catch (_) { return ''; } }
    function base(path) { return /^https?:/.test(location.protocol) && /nutriin\.app|eatologix\.com|biocode\.website|localhost|127\.0\.0\.1/.test(location.host) ? path : SITE + '/' + path; }

    // ── Влизанията и събитията ──────────────────────────────────────────────
    /**
     * Отваряне на приложението (np_opens): ново, ако е минал повече от половин час от предишното.
     * Пазят се дните (60) и часовете (24 брояча) — за часа на напомнянията, „добре дошъл обратно“,
     * персоната (persona.js) и отчета; на сървъра отива само това резюме.
     */
    function trackOpen() {
        var o = read(OPENS_KEY, null) || { days: {}, hours: new Array(24).fill(0) };
        var now = Date.now();
        if (o.last && now - o.last < 30 * 60 * 1000) return o;
        var d = new Date(now);
        var key = global.GameScoring ? GameScoring.dateKey(d) : d.toISOString().slice(0, 10);
        o.days = o.days || {};
        o.days[key] = (o.days[key] || 0) + 1;
        if (!Array.isArray(o.hours) || o.hours.length !== 24) o.hours = new Array(24).fill(0);
        o.hours[d.getHours()]++;
        o.prev = o.last || null;
        o.last = now;
        var cut = new Date(now - 60 * DAY);
        var cutKey = global.GameScoring ? GameScoring.dateKey(cut) : cut.toISOString().slice(0, 10);
        Object.keys(o.days).forEach(function (k) { if (k < cutKey) delete o.days[k]; });
        // Връщане след 3+ дни, при вече започнат път — топло посрещане, без укор (веднъж за връщането).
        if (o.prev && now - o.prev >= 3 * DAY) { try { sessionStorage.setItem('np_comeback', '1'); } catch (_) {} }
        write(OPENS_KEY, o);
        return o;
    }

    function event(type) {
        try {
            fetch(WORKER + '/api/rewards/event', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type }) }).catch(function () {});
        } catch (_) {}
    }

    /** Приетото предизвикателство за месеца (на устройството; сървърът — за точките). */
    function localChallenge() { return read(CHALLENGE_KEY, null); }

    // ── Състоянието ─────────────────────────────────────────────────────────
    function localStatus() {
        if (!RE || !global.GameScoring) return null;
        var plan = read('dietPlan', {}) || {};
        var ud = read('userData', {}) || {};
        return RE.compute({
            gameData: read('gameData', {}) || {},
            calcDayScore: global.GameScoring.calcDayScore,
            todayKey: global.GameScoring.dateKey(new Date()),
            weightLog: read('np_weight_log', []),
            startKg: parseFloat(String(ud.weight || '').replace(',', '.')) || null,
            goalDirection: (plan.analysis || {})._goalDirection || '',
            challenge: localChallenge()
        });
    }

    async function idToken(uid) {
        try {
            if (global.NutriPlanPlanSync && typeof NutriPlanPlanSync.getFirebaseIdToken === 'function') return await NutriPlanPlanSync.getFirebaseIdToken(uid);
            var appMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
            var authMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
            var app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp({
                apiKey: 'AIzaSyAZvIAAzP-6CBzQlQvoJTy-Iq24fBAPrJY', authDomain: 'nutriplan-c460a.firebaseapp.com',
                projectId: 'nutriplan-c460a', appId: '1:556207268794:web:4fa968491413abd4873383'
            });
            var auth = authMod.getAuth(app);
            if (typeof auth.authStateReady === 'function') await auth.authStateReady();
            return auth.currentUser && 'fb_' + auth.currentUser.uid === uid ? await auth.currentUser.getIdToken() : null;
        } catch (_) { return null; }
    }

    async function post(path, body) {
        var uid = userId();
        if (uid.indexOf('fb_') !== 0) return null;
        var token = await idToken(uid);
        var r = await fetch(WORKER + path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ userId: uid, idToken: token || undefined }, body || {}))
        });
        return r.json().catch(function () { return null; });
    }

    /** Портфейлът от сървъра (кеш 10 мин.). null без акаунт или без връзка. */
    async function server(force) {
        var c = read(SRV_KEY, null);
        // Ново ниво на устройството, което сървърът още не е видял → кодът му е при сървъра, без кеш.
        var st = localStatus();
        var behind = st && st.tier && c && c.data && c.data.status && c.data.status.tier !== st.tier.id;
        if (!force && !behind && c && c.uid === userId() && Date.now() - c.at < SRV_TTL) return c.data;
        try {
            var today = global.GameScoring ? GameScoring.dateKey(new Date()) : undefined;
            var body = { todayKey: today };
            // Влизанията — веднъж на ден (за резюмето на отчета); дните — само при ново ниво, невидяно от сървъра.
            var wk = read(WEEK_KEY, {}) || {};
            if (wk.opensSent !== today) body.opens = read(OPENS_KEY, null) || undefined;
            if (behind) body.gameData = read('gameData', {});
            var d = await post('/api/user/rewards', body);
            if (d && d.success) {
                if (body.opens) { wk = read(WEEK_KEY, {}) || {}; wk.opensSent = today; write(WEEK_KEY, wk); }
                // Текстовете от админ панела идват с отговора — без отделна заявка.
                if (d.content) { write(CONTENT_KEY, { at: Date.now(), content: d.content }); applyCached(); delete d.content; }
                write(SRV_KEY, { at: Date.now(), uid: userId(), data: d });
                // Приетото предизвикателство идва и от другото устройство.
                if (d.challenge && (!localChallenge() || localChallenge().month !== d.challenge.month)) write(CHALLENGE_KEY, { month: d.challenge.month, id: d.challenge.id, joined: d.challenge.joined });
                return d;
            }
        } catch (_) {}
        return c && c.uid === userId() ? c.data : null;
    }

    // ── Текстовете на етапите ───────────────────────────────────────────────
    function giftText(r, srv) {
        if (r.kind === 'supplement') return (srv && srv.supplements === false) ? '' : '−' + r.pct + '% за добавки';
        if (r.kind === 'plan') return isApp() ? '−' + r.pct + '% за план (в сайта)' : '−' + r.pct + '% за план';
        return '−' + r.pct + '%';
    }

    /** За реда на нивото: „−5% добавки“, „−10% план“. */
    function giftShort(r, srv) {
        if (r.kind === 'supplement') return (srv && srv.supplements === false) ? '' : '−' + r.pct + '% добавки';
        if (r.kind === 'plan') return '−' + r.pct + '% план';
        return '−' + r.pct + '%';
    }

    function comparison(srv) {
        if (!srv || srv.percentile == null || srv.percentile < 50 || persona().noScores) return '';
        return RE.text('comparison', { p: srv.percentile });
    }

    /**
     * Етап → { big, kicker, num, unit, title, shareTitle, text, fact, gift, image }.
     * Думите са за качеството, което човекът е показал (упоритост, постоянство, воля),
     * не за „постигнато ниво“: наградата е признанието, отстъпката идва след него.
     */
    function momentOf(m, st, srv) {
        if (m.kind === 'tier') {
            var t = RE.tierById(m.tier);
            var gifts = t.rewards.map(function (r) { return giftText(r, srv); }).filter(Boolean);
            return {
                big: true, kicker: RE.text('newLevel'), num: String(t.days), unit: 'дни ' + t.title.toLowerCase(),
                title: t.moment, shareTitle: t.share, text: t.text,
                fact: comparison(srv) || (t.id === 'habit' ? RE.FACTS.habit : RE.FACTS.consistency),
                gift: gifts.length ? gifts.join(' · ') + ' ' + RE.text('giftReady') : '',
                image: t.image
            };
        }
        if (m.kind === 'habit' || m.kind === 'streak') {
            var s = RE.streakOf(m.days) || {};
            return {
                big: m.big, kicker: m.kind === 'habit' ? 'Нов навик' : 'Поредица', num: String(m.days), unit: 'дни поред',
                title: s.moment || m.days + ' дни поред', shareTitle: s.share, text: s.text || '',
                fact: m.kind === 'habit' ? RE.FACTS.habit : comparison(srv),
                image: m.kind === 'habit' ? 'habit' : 'streak'
            };
        }
        if (m.kind === 'weight') {
            var lose = m.dir === 'lose';
            return {
                big: m.big, kicker: 'Към целта', num: (lose ? '−' : '+') + m.pct + '%', unit: lose ? 'от теглото' : 'към целта',
                title: RE.text(lose ? 'weightLose' : 'weightGain', { pct: m.pct }),
                shareTitle: RE.text(lose ? 'weightShareLose' : 'weightShareGain', { pct: m.pct }),
                text: RE.text('weightText'),
                fact: lose && m.pct >= 7 ? RE.FACTS.weight7 : lose && m.pct >= 5 ? RE.FACTS.weight5 : '',
                image: 'weight'
            };
        }
        if (m.kind === 'challenge') {
            var cdef = RE.CHALLENGES.filter(function (c) { return c.id === m.challenge; })[0] || {};
            return {
                big: true, kicker: RE.text('challengeTitle'), num: String(RE.CHALLENGE_TARGET), unit: 'дни · ' + (cdef.title || ''),
                title: RE.text('challengeDone'), shareTitle: cdef.title, text: RE.text('challengeDoneText', { bonus: m.bonus || RE.CHALLENGE_BONUS }),
                image: 'share', source: 'share_challenge'
            };
        }
        if (m.kind === 'shield') return { big: false, icon: 'fa-shield-alt', title: RE.text('shield') };
        return null;
    }

    /** Снимката на темата (data/reward-images.json → brand/rewards/<тема>.webp). */
    function photo(theme) { return RE.imageFor(theme); }

    // ── Тържеството ─────────────────────────────────────────────────────────
    function haptic(strong) {
        try {
            var h = global.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Haptics;
            if (h && h.notification) { h.notification({ type: 'SUCCESS' }); return; }
            if (navigator.vibrate) navigator.vibrate(strong ? [30, 60, 30, 60, 80] : 25);
        } catch (_) {}
    }

    function confetti(canvas) {
        if (reducedMotion()) return;
        var ctx = canvas.getContext('2d');
        var dpr = Math.min(2, global.devicePixelRatio || 1);
        var W = canvas.width = canvas.offsetWidth * dpr, H = canvas.height = canvas.offsetHeight * dpr;
        var colors = ['#A0F500', '#10CC50', '#08D29A', '#00E0DC', '#ffffff'];
        var parts = [];
        for (var i = 0; i < 140; i++) parts.push({
            x: W / 2 + (Math.random() - .5) * W * .2, y: H * .42,
            vx: (Math.random() - .5) * 16 * dpr, vy: (-Math.random() * 15 - 6) * dpr,
            r: (3 + Math.random() * 4) * dpr, c: colors[i % colors.length], a: Math.random() * 6, s: Math.random() < .5
        });
        var t0 = performance.now();
        (function frame(t) {
            var el = (t - t0) / 1000;
            ctx.clearRect(0, 0, W, H);
            parts.forEach(function (p) {
                p.vy += .42 * dpr; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += .15;
                ctx.globalAlpha = Math.max(0, 1 - el / 3.2);
                ctx.fillStyle = p.c;
                ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
                if (p.s) ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 1.3, 0, 6.3); ctx.fill(); }
                ctx.restore();
            });
            if (el < 3.2 && canvas.isConnected) requestAnimationFrame(frame);
        })(t0);
    }

    function celebrate(mo, opts) {
        if (doc.querySelector('.rw-moment')) return;
        var o = opts || {};
        var el = doc.createElement('div');
        el.className = 'rw-moment';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-label', mo.title);
        el.innerHTML = '<canvas class="rw-confetti"></canvas>' +
            '<div class="rw-moment-card' + (mo.image ? ' has-photo' : '') + '">' +
            (mo.image ? '<div class="rw-moment-photo"><img src="' + photo(mo.image) + '" alt="" onerror="this.closest(\'.rw-moment-card\').classList.remove(\'has-photo\');this.parentNode.remove()"></div>' : '') +
            '<div class="rw-moment-mark"><img src="./brand/nutriin-mark-dark.svg" alt=""></div>' +
            // тялото се превърта, когато не се събира; знакът и бутоните остават видими
            '<div class="rw-moment-body">' +
            (mo.kicker ? '<div class="rw-moment-kicker">' + esc(mo.kicker) + '</div>' : '') +
            (mo.num ? '<div class="rw-moment-big">' + esc(mo.num) + '</div><p>' + esc(mo.unit || '') + '</p>' : '') +
            '<h3>' + esc(mo.title) + '</h3>' +
            (mo.text ? '<p>' + esc(mo.text) + '</p>' : '') +
            (mo.gift ? '<div class="rw-moment-gift"><i class="fas fa-gift"></i>' + esc(mo.gift) + '</div>' : '') +
            (mo.fact ? '<p class="rw-moment-fact">' + esc(mo.fact) + '</p>' : '') +
            '</div>' +
            '<div class="rw-moment-actions"><button type="button" class="rw-close">Продължи</button>' +
            '<button type="button" class="rw-share"><i class="fas fa-share-nodes"></i> Сподели</button></div>' +
            '</div>';
        doc.body.appendChild(el);
        function close() { el.classList.remove('is-in'); setTimeout(function () { el.remove(); }, 350); }
        el.querySelector('.rw-close').addEventListener('click', close);
        el.addEventListener('click', function (e) { if (e.target === el) close(); });
        el.querySelector('.rw-share').addEventListener('click', function () { share(mo, o.invite); });
        requestAnimationFrame(function () { el.classList.add('is-in'); confetti(el.querySelector('canvas')); });
        haptic(true);
        setTimeout(function () { var b = el.querySelector('.rw-close'); if (b) b.focus(); }, 400);
    }

    function toast(text, icon) {
        var el = doc.createElement('div');
        el.className = 'rw-toast';
        el.setAttribute('role', 'status');
        el.innerHTML = '<i class="fas ' + (icon || 'fa-star') + '"></i><span>' + esc(text) + '</span>';
        doc.body.appendChild(el);
        requestAnimationFrame(function () { el.classList.add('is-in'); });
        haptic(false);
        setTimeout(function () { el.classList.remove('is-in'); setTimeout(function () { el.remove(); }, 500); }, 4200);
    }

    function toastAllowed() {
        var list = (read(TOAST_KEY, []) || []).filter(function (t) { return Date.now() - t < 7 * DAY; });
        return list.length < 3;
    }
    function toastUsed() {
        var list = (read(TOAST_KEY, []) || []).filter(function (t) { return Date.now() - t < 7 * DAY; });
        list.push(Date.now());
        write(TOAST_KEY, list);
    }

    // ── Картата за споделяне (1080×1350) ────────────────────────────────────
    function loadImg(src) {
        // снимките от админ панела са от сървъра — без crossOrigin платното се „замърсява“ и не става на картинка
        return new Promise(function (res) { var i = new Image(); if (/^https:/.test(src)) i.crossOrigin = 'anonymous'; i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; });
    }

    async function card(mo, invite) {
        var W = 1080, H = 1350;
        var c = doc.createElement('canvas'); c.width = W; c.height = H;
        var x = c.getContext('2d');
        var font = (getComputedStyle(doc.body).fontFamily || 'system-ui, sans-serif');
        var bg = x.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#0A6B66'); bg.addColorStop(.55, '#06302E'); bg.addColorStop(1, '#041A19');
        x.fillStyle = bg; x.fillRect(0, 0, W, H);
        [[880, 180, 520, 'rgba(160,245,0,.20)'], [120, 1080, 600, 'rgba(0,224,220,.16)'], [540, 640, 700, 'rgba(16,204,80,.10)']].forEach(function (a) {
            var g = x.createRadialGradient(a[0], a[1], 0, a[0], a[1], a[2]);
            g.addColorStop(0, a[3]); g.addColorStop(1, 'rgba(0,0,0,0)');
            x.fillStyle = g; x.fillRect(0, 0, W, H);
        });
        var pic = mo.image ? await loadImg(photo(mo.image)) : null;
        if (pic) {
            // снимката горе, плавно в тъмното отдолу — текстът стои върху спокоен фон
            x.drawImage(pic, 0, 0, W, H);
            var fade = x.createLinearGradient(0, 0, 0, H);
            fade.addColorStop(0, 'rgba(4,26,25,.55)'); fade.addColorStop(.22, 'rgba(4,26,25,.05)');
            fade.addColorStop(.42, 'rgba(4,26,25,.35)'); fade.addColorStop(.62, 'rgba(4,26,25,.9)'); fade.addColorStop(1, 'rgba(4,26,25,.97)');
            x.fillStyle = fade; x.fillRect(0, 0, W, H);
        } else {
            var mark = await loadImg('./brand/nutriin-mark-dark.svg');
            if (mark) { x.globalAlpha = .1; x.drawImage(mark, 560, 300, 600, 600); x.globalAlpha = 1; }
        }
        var logo = await loadImg('./brand/nutriin-horizontal-dark.svg');
        if (logo) { var lw = 300, lh = lw * (logo.height / logo.width || .3); x.drawImage(logo, 90, 96, lw, lh); }
        x.textAlign = 'left';
        x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = pic ? 18 : 0;
        // Със снимка текстът слиза в долната, тъмна част.
        var big = String(mo.num || '').length > 3 ? 210 : 260;
        var y0 = pic ? 640 : 420;
        x.fillStyle = '#A0F500';
        x.font = '700 34px ' + font;
        x.fillText(String(mo.kicker || 'Постоянство').toUpperCase(), 90, y0);
        x.fillStyle = '#fff';
        x.font = '800 ' + (pic ? big - 30 : big + 40) + 'px ' + font;
        var ny = y0 + (pic ? big - 20 : big + 20);
        x.fillText(mo.num || '★', 80, ny);
        var numW = x.measureText(mo.num || '★').width;
        x.font = '500 46px ' + font;
        x.fillStyle = 'rgba(255,255,255,.88)';
        if (pic) x.fillText(mo.unit || '', 110 + numW, ny);   // „30 дни упоритост“ на един ред
        else x.fillText(mo.unit || '', 90, ny + 90);
        x.fillStyle = '#fff';
        x.font = '800 60px ' + font;
        wrap(x, mo.shareTitle || mo.title, 90, pic ? ny + 110 : ny + 200, W - 180, 72, 2);
        x.shadowBlur = 0;
        x.font = '700 34px ' + font;
        x.fillStyle = '#A0F500';
        x.fillText(invite ? RE.text('shareInvite', { code: invite }) : RE.text('shareTagline'), 90, 1210);
        x.font = '500 32px ' + font;
        x.fillStyle = 'rgba(255,255,255,.7)';
        x.fillText('nutriin.app', 90, 1265);
        return new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/png'); });
    }

    function wrap(x, text, left, top, maxW, lh, maxLines) {
        var words = String(text || '').split(' '), line = '', y = top, lines = 0;
        for (var i = 0; i < words.length; i++) {
            var test = line ? line + ' ' + words[i] : words[i];
            if (x.measureText(test).width > maxW && line) {
                x.fillText(line, left, y); y += lh; line = words[i];
                if (++lines >= maxLines - 1) { line = words.slice(i).join(' '); break; }
            } else line = test;
        }
        x.fillText(line, left, y);
    }

    async function share(mo, invite, source) {
        event(source || mo.source || 'share_moment');
        var srvInv = (((read(SRV_KEY, {}) || {}).data || {}).invite || {}).code;
        var code = invite || srvInv || '';
        var link = SITE + '/' + (code ? '?invite=' + code : '');
        var text = (mo.shareTitle || mo.title) + (mo.num ? ' (' + mo.num + ' ' + (mo.unit || '') + ')' : '') + ' — с Nutriin. ' +
            (code ? 'С моя код ' + code + ' получаваш −15% за първия план: ' : '') + link;
        var blob = await card(mo, code).catch(function () { return null; });
        try {
            var Share = global.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Share;
            var FS = global.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Filesystem;
            if (isApp() && Share) {
                var files;
                if (blob && FS) {
                    var data = await new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.readAsDataURL(blob); });
                    var saved = await FS.writeFile({ path: 'nutriin-success.png', data: data, directory: 'CACHE' });
                    files = [saved.uri];
                }
                await Share.share({ title: 'Nutriin', text: text, url: link, files: files });
                return;
            }
            if (blob && navigator.canShare) {
                var file = new File([blob], 'nutriin-success.png', { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: text }); return; }
            }
            if (navigator.share) { await navigator.share({ title: 'Nutriin', text: text, url: link }); return; }
        } catch (e) { if (e && e.name === 'AbortError') return; }
        // Без споделяне в браузъра: картата се сваля, текстът — в клипборда.
        if (blob) {
            var a = doc.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'nutriin-success.png';
            doc.body.appendChild(a); a.click(); a.remove();
        }
        try { await navigator.clipboard.writeText(text); toast('Картата е свалена, а текстът — копиран. Сподели го където искаш.', 'fa-share-nodes'); } catch (_) {}
    }

    // ── Моментите ───────────────────────────────────────────────────────────
    /** Новите етапи → едно тържество и до 2 малки поздрава. Първото пускане помни старите без шум. */
    function moments(st, srv) {
        if (!st) return;
        var seen = read(SEEN_KEY, null);
        var first = !seen;
        seen = seen || {};
        var yesterday = global.GameScoring ? GameScoring.dateKey(new Date(Date.now() - DAY)) : '';
        var fresh = st.milestones.filter(function (m) { return !seen[m.id]; });
        fresh.forEach(function (m) { seen[m.id] = Date.now(); });
        if (first) fresh = fresh.filter(function (m) { return m.key >= yesterday; });
        // Личен рекорд по крачки — нов максимум над досегашния.
        var rec = read(REC_KEY, {}) || {};
        var smalls = [];
        if (st.records.maxSteps && rec.maxSteps && st.records.maxSteps.steps > rec.maxSteps) {
            smalls.push({ text: 'Нов личен рекорд: ' + num(st.records.maxSteps.steps) + ' крачки за ден!', icon: 'fa-shoe-prints' });
        }
        if (st.records.maxSteps) rec.maxSteps = st.records.maxSteps.steps;
        // Сравнението — веднъж седмично, само над средното.
        var cmp = comparison(srv);
        if (cmp && srv.percentile >= 60 && Date.now() - (rec.cmpAt || 0) > 7 * DAY) { smalls.push({ text: 'Браво! ' + cmp, icon: 'fa-trophy' }); rec.cmpAt = Date.now(); }
        write(REC_KEY, rec);
        write(SEEN_KEY, seen);

        // Връщане след пауза — първо топлото посрещане (не се брои в седмичния таван на поздравите).
        var back = false;
        try { back = sessionStorage.getItem('np_comeback') === '1'; if (back) sessionStorage.removeItem('np_comeback'); } catch (_) {}
        if (back && st.daysTracked >= 3) { setTimeout(function () { toast(RE.text('comeback'), 'fa-seedling'); }, 900); event('comeback'); }

        var big = null;
        fresh.forEach(function (m) {
            var mo = momentOf(m, st, srv);
            if (!mo) return;
            if (mo.big && (!big || m.kind === 'tier')) big = mo;
            else if (!mo.big) smalls.push({ text: mo.title + (mo.text ? ' ' + mo.text : ''), icon: mo.icon || 'fa-star' });
        });
        if (big) celebrate(big, { invite: srv && srv.invite && srv.invite.code });
        var delay = big ? 0 : 600;
        smalls.slice(0, 2).forEach(function (s, i) {
            if (big || !toastAllowed()) return;
            setTimeout(function () { toast(s.text, s.icon); }, delay + (back ? 5000 : 0) + i * 5000);
            toastUsed();
        });
    }

    var _soon = null;
    function checkSoon() {
        clearTimeout(_soon);
        _soon = setTimeout(function () {
            loadContent().then(function () {
                var st = localStatus();
                moments(st, (read(SRV_KEY, {}) || {}).data || null);
                try { scheduleReminders(st); } catch (_) {}
            });
        }, 1500);
    }

    // ── Картата „Постоянство“ ───────────────────────────────────────────────
    function codeRow(c) {
        var label = c.kind === 'supplement' ? 'Добавки −' + c.pct + '%' : c.kind === 'plan' ? 'План −' + c.pct + '%' : 'Партньор −' + c.pct + '%';
        var until = 'до ' + new Date(c.until).toLocaleDateString('bg-BG');
        var action = '';
        if (c.kind === 'supplement') action = '<a class="rw-btn" href="' + SHOP + '" target="_blank" rel="noopener">Магазин</a>';
        else if (c.kind === 'plan' && !isApp()) action = '<a class="rw-btn" href="' + base('pricing.html') + '?reward=' + esc(c.code) + '">Използвай</a>';
        return '<div class="rw-code"><div class="rw-code-main"><b>' + esc(label) + '</b><code>' + esc(c.code) + '</code><span>' + until +
            (c.kind === 'plan' && isApp() ? ' · в сайта' : '') + '</span></div>' +
            '<button type="button" class="rw-btn" data-copy="' + esc(c.code) + '" aria-label="Копирай кода"><i class="far fa-copy"></i></button>' + action + '</div>';
    }

    // ── Седмицата (неделя вечер – вторник) ──────────────────────────────────
    function weekVisible(st) {
        var w = st && st.week;
        if (!w || !w.tracked) return false;
        var d = new Date(), dow = d.getDay();
        if (!((dow === 0 && d.getHours() >= 17) || dow === 1 || dow === 2)) return false;
        return (read(WEEK_KEY, {}) || {}).dismissed !== w.endKey;
    }
    function dayName(key) {
        try { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('bg-BG', { weekday: 'long' }); } catch (_) { return key; }
    }
    function shortDate(key) { var p = key.split('-'); return +p[2] + '.' + p[1]; }
    function weekMoment(st) {
        var w = st.week;
        return {
            kicker: RE.text('weekTitle'), num: w.good + '/7', unit: 'добри дни',
            title: RE.text('weekGood', { good: w.good }),
            shareTitle: w.delta > 0 ? RE.text('weekUp', { d: w.delta }) : RE.text('weekGood', { good: w.good }),
            image: 'streak', source: 'share_week'
        };
    }
    function weekCard(st) {
        if (!weekVisible(st)) return '';
        var w = st.week;
        var trend = w.delta == null ? '' : w.delta >= 3 ? RE.text('weekUp', { d: w.delta }) : w.delta <= -3 ? RE.text('weekDown') : RE.text('weekSame');
        var wk = read(WEEK_KEY, {}) || {};
        if (wk.viewed !== w.endKey) { wk.viewed = w.endKey; write(WEEK_KEY, wk); event('week_view'); }
        return '<div class="rw-card rw-week"><h4>' + esc(RE.text('weekTitle')) + '<small>' + shortDate(w.startKey) + '–' + shortDate(w.endKey) + '</small></h4>' +
            '<div class="rw-week-big"><b>' + w.good + '</b><span>' + esc(RE.text('weekGood', { good: w.good }).replace(/^\d+\s*/, '')) + '</span></div>' +
            (trend ? '<p>' + esc(trend) + '</p>' : '') +
            '<div class="rw-week-actions"><button type="button" class="rw-btn" data-week-hide="1">Видях</button>' +
            '<button type="button" class="rw-btn rw-btn--main" data-week-share="1"><i class="fas fa-share-nodes"></i> Сподели</button></div></div>';
    }

    // ── Предизвикателството на месеца ───────────────────────────────────────
    function challengeCard(st, srv) {
        var c = st && st.challenge;
        if (!c) return '';
        var head = '<h4>' + esc(RE.text('challengeTitle')) + '</h4>';
        if (c.done) {
            return '<div class="rw-card rw-challenge is-done">' + head + '<b class="rw-ch-title">' + esc(c.title) + ' ✓</b><p>' + esc(RE.text('challengeDoneText', { bonus: c.bonus })) + '</p></div>';
        }
        if (c.joined) {
            var dots = '';
            for (var i = 0; i < c.target; i++) dots += '<i class="' + (i < c.count ? 'on' : '') + '"></i>';
            var need = c.target - c.count;
            return '<div class="rw-card rw-challenge">' + head + '<b class="rw-ch-title">' + esc(c.title) + '</b>' +
                '<div class="rw-ch-dots" aria-label="' + c.count + ' от ' + c.target + '">' + dots + '</div>' +
                '<p>' + esc(c.behind ? RE.text('challengeBehind', { n: need, left: c.daysLeft }) : c.count + ' от ' + c.target + ' · ' + c.text) + '</p></div>';
        }
        if (!c.canJoin) return '';
        return '<div class="rw-card rw-challenge">' + head + '<b class="rw-ch-title">' + esc(c.title) + '</b><p>' + esc(c.text) + ' +' + c.bonus + ' точки.</p>' +
            '<button type="button" class="rw-btn rw-btn--main rw-btn--wide" data-challenge-join="1">' + esc(RE.text('challengeJoin')) + '</button></div>';
    }

    async function joinChallenge(st) {
        var c = st.challenge;
        var today = GameScoring.dateKey(new Date());
        if (userId().indexOf('fb_') === 0) {
            var d = await post('/api/user/rewards/challenge', { todayKey: today }).catch(function () { return null; });
            if (!d || !d.success) { toast((d && d.message) || 'Не стана. Опитай пак.', 'fa-circle-exclamation'); return false; }
            write(CHALLENGE_KEY, { month: d.challenge.month, id: d.challenge.id, joined: d.challenge.joined });
        } else {
            write(CHALLENGE_KEY, { month: c.month, id: c.id, joined: today });
        }
        toast(RE.text('challengeJoined'), 'fa-flag-checkered');
        return true;
    }

    // ── Напомнянията (local-scheduler.js, без сървър) ───────────────────────
    /**
     * Неделя вечер — „Твоята седмица“, в обичайния вечерен час на човека (по влизанията; иначе 19:30).
     * Предизвикателство: при изоставане — напомняне на другия ден в обичайния час (най-много веднъж
     * седмично); без прието — на 1-во число „Нов месец — ново начало“. Само при отметки последната седмица.
     */
    function scheduleReminders(st) {
        var gn = global.GameNotifier;
        if (!gn || typeof gn.addPlanReminder !== 'function' || !st || !st.firstKey) return;
        var recent = Object.keys(read('gameData', {}) || {}).some(function (k) { return Date.now() - Date.parse(k) < 8 * DAY; });
        if (!recent) return;
        var os = RE.openStats(read(OPENS_KEY, null), GameScoring.dateKey(new Date()));
        var eveH = os.eveningHour != null ? os.eveningHour : 19;
        var dayH = os.usualHour != null ? Math.min(21, Math.max(9, os.usualHour)) : 18;
        var planned = read('np_plan_reminders', []) || [];
        function has(key, ts) { return planned.some(function (r) { return r.key === key && r.ts === ts; }); }
        function add(key, ts, title, body) {
            if (ts <= Date.now() || has(key, ts)) return;
            gn.addPlanReminder({ key: key, ts: ts, title: title, body: body, url: '/game-analytics.html' }).catch(function () {});
        }
        var sun = new Date(); sun.setHours(eveH, 30, 0, 0);
        sun.setDate(sun.getDate() + ((7 - sun.getDay()) % 7));
        if (sun.getTime() <= Date.now()) sun.setDate(sun.getDate() + 7);
        add('rewards_week', sun.getTime(), RE.text('weekNotifyTitle'), RE.text('weekNotifyBody'));
        var c = st.challenge;
        if (c && c.joined && c.behind && !c.done && c.daysLeft >= 3) {
            var last = (read(WEEK_KEY, {}) || {}).chNudge || 0;
            if (Date.now() - last > 7 * DAY) {
                var t = new Date(); t.setDate(t.getDate() + 1); t.setHours(dayH, 0, 0, 0);
                add('rewards_challenge', t.getTime(), RE.text('challengeTitle'), RE.text('challengeNotifyBody', { n: c.target - c.count, title: c.title }));
                var wk = read(WEEK_KEY, {}) || {}; wk.chNudge = Date.now(); write(WEEK_KEY, wk);
            }
        } else if (c) {
            var first = new Date(); first.setMonth(first.getMonth() + 1, 1); first.setHours(dayH, 0, 0, 0);
            var nextMonth = first.getFullYear() + '-' + String(first.getMonth() + 1).padStart(2, '0');
            add('rewards_challenge', first.getTime(), RE.text('newMonthNotifyTitle'), RE.text('newMonthNotifyBody', { title: RE.challengeFor(nextMonth, c.id === 'steps' || st.records.stepDays > 0).title }));
        }
    }

    function render(el, st, srv) {
        if (!st || !st.firstKey) {
            el.innerHTML = '<div class="rw-card"><p>' + esc(RE.text('empty')) + '</p></div>';
            return;
        }
        var tierTitle = st.tier ? st.tier.title : RE.text('firstLevel');
        var nx = st.next;
        var barPct = nx ? nx.progress : 100;
        // Под лентата — само следващата стъпка: колко дни остават или какъв ритъм иска нивото.
        var hint;
        if (!nx) hint = RE.text('top');
        else if (nx.avg != null && nx.avg < nx.minEng) hint = RE.text('behind', { title: nx.title, min: nx.minEng, avg: nx.avg });
        else { var left = Math.max(1, nx.days - nx.daysHave); hint = RE.text('towards', { n: left, daysWord: plural(left, 'ден', 'дни'), title: nx.title }); }
        var pts = srv ? srv.wallet.balance : st.points.earned;

        // Хиро: поредицата и нивото → лентата → следващата стъпка. Нищо друго.
        var heroPic = st.tier ? st.tier.image : 'persist';
        var html = '<div class="rw-hero" style="--rw-photo:url(' + photo(heroPic) + ')">' +
            '<div class="rw-hero-top"><div class="rw-streak"><b>' + st.streak + '</b><span>' + plural(st.streak, 'ден', 'дни') + ' поред</span></div>' +
            '<div class="rw-tier"><small>' + esc(RE.text('levelLabel')) + '</small><strong>' + esc(tierTitle) + '</strong></div></div>' +
            '<div class="rw-bar"><i data-w="' + barPct + '"></i></div>' +
            '<div class="rw-hero-foot"><span>' + esc(hint) + '</span>' +
            (st.shields.held ? '<span class="rw-pts" title="Жокер: пази поредицата в слаб или пропуснат ден"><i class="fas fa-shield-alt"></i>' + st.shields.held + '</span>' : '') +
            '<span class="rw-pts" title="Точки"><i class="fas fa-star"></i>' + num(pts) + '</span></div>' +
            '</div>';
        if (st.warning) html += '<div class="rw-warn"><i class="fas fa-circle-exclamation"></i> ' + esc(RE.text('warn', { title: st.tier.title, titleLower: st.tier.title.toLowerCase(), n: st.warning.daysLeft, daysWord: plural(st.warning.daysLeft, 'ден', 'дни') })) + '</div>';

        html += weekCard(st) + challengeCard(st, srv);

        html += '<button type="button" class="rw-toggle" aria-expanded="false" aria-controls="rwDetails"><span>Нива и награди</span><i class="fas fa-chevron-down"></i></button><div id="rwDetails" hidden>';

        // Нивата: име → дни и праг → наградата. Един ред описание.
        var cur = st.tier ? st.tier.index : -1;
        html += '<div class="rw-card"><h4>' + esc(RE.text('pathTitle')) + '</h4>' + RE.TIERS.map(function (t, i) {
            var state = i <= cur ? 'is-done' : i === cur + 1 ? 'is-next' : '';
            var gifts = t.rewards.map(function (r) { return giftShort(r, srv); }).filter(Boolean);
            return '<div class="rw-step ' + state + '"><i class="fas ' + (i <= cur ? 'fa-check' : i === cur + 1 ? 'fa-arrow-up' : 'fa-lock') + '"></i>' +
                '<div><b>' + esc(t.title) + '</b><span>' + t.days + ' дни · над ' + t.minEng + '%</span></div>' +
                (gifts.length ? '<em>' + gifts.map(esc).join('<br>') + '</em>' : '') + '</div>';
        }).join('') + '</div>';

        // Отстъпките — само ако има; без акаунт — една подсказка.
        var codes = (srv && srv.codes || []).filter(function (c) { return !c.used; });
        if (codes.length) html += '<div class="rw-card"><h4>' + esc(RE.text('codesTitle')) + '</h4>' + codes.map(codeRow).join('') + '</div>';
        else if (!srv) html += '<div class="rw-card"><p>Влез в акаунта си, за да събираш точки и отстъпки.</p></div>';

        // Точки → отстъпка
        var offers = srv && srv.offers ? srv.offers.filter(function (o) { return !(o.kind === 'plan' && isApp()); }) : [];
        if (offers.length) {
            html += '<div class="rw-card"><h4>' + esc(RE.text('pointsTitle')) + '<small><i class="fas fa-star"></i> ' + num(srv.wallet.balance) + '</small></h4>' +
                offers.map(function (o) {
                    return '<div class="rw-code"><div class="rw-code-main"><b>' + esc(o.title) + '</b><span>' + num(o.cost) + ' точки</span></div>' +
                        '<button type="button" class="rw-btn rw-btn--main" data-redeem="' + esc(o.id) + '"' + (srv.wallet.balance < o.cost ? ' disabled' : '') + '>Вземи</button></div>';
                }).join('') + '</div>';
        }

        // Покана
        if (srv && srv.invite && srv.invite.code) {
            html += '<div class="rw-card"><h4>' + esc(RE.text('inviteTitle')) + (srv.invite.count ? '<small>' + srv.invite.count + ' ' + plural(srv.invite.count, 'приятел', 'приятели') + '</small>' : '') + '</h4>' +
                // В приложението без цени и проценти за плана (правилата на магазините)
                '<p>' + esc(isApp() ? RE.text('inviteTextApp') : RE.text('inviteText', { pct: srv.invite.pct, reward: srv.invite.reward })) + '</p>' +
                '<div class="rw-code rw-invite"><div class="rw-code-main"><code>' + esc(srv.invite.code) + '</code></div>' +
                '<button type="button" class="rw-btn" data-copy="' + esc(SITE + '/?invite=' + srv.invite.code) + '" aria-label="Копирай връзката"><i class="fas fa-link"></i></button>' +
                '<button type="button" class="rw-btn rw-btn--main" data-invite="1"><i class="fas fa-share-nodes"></i> Покани</button></div></div>';
        }

        var r = st.records;
        html += '<div class="rw-card"><h4>Лични рекорди</h4><div class="rw-records">' +
            '<div class="rw-record"><b>' + r.bestStreak + '</b><span>дни поред</span></div>' +
            '<div class="rw-record"><b>' + (r.bestWeek ? r.bestWeek.avg + '%' : '—') + '</b><span>най-добра седмица</span></div>' +
            '<div class="rw-record"><b>' + (r.maxSteps ? num(r.maxSteps.steps) : '—') + '</b><span>крачки за ден</span></div>' +
            '</div><button type="button" class="rw-btn rw-btn--wide" data-share="1"><i class="fas fa-share-nodes"></i> Сподели</button></div>';

        html += '</div>';
        el.innerHTML = html;
        requestAnimationFrame(function () { var b = el.querySelector('.rw-bar i'); if (b) b.style.width = b.getAttribute('data-w') + '%'; });

        var tg = el.querySelector('.rw-toggle');
        tg.addEventListener('click', function () {
            var open = tg.getAttribute('aria-expanded') !== 'true';
            tg.setAttribute('aria-expanded', String(open));
            el.querySelector('#rwDetails').hidden = !open;
        });
        el.querySelectorAll('[data-copy]').forEach(function (b) {
            b.addEventListener('click', function () {
                var v = b.getAttribute('data-copy');
                (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { toast('Копирано: ' + v, 'fa-copy'); }).catch(function () {});
            });
        });
        el.querySelectorAll('[data-redeem]').forEach(function (b) {
            b.addEventListener('click', async function () {
                b.disabled = true;
                var d = await post('/api/user/rewards/redeem', { offer: b.getAttribute('data-redeem'), todayKey: GameScoring.dateKey(new Date()) }).catch(function () { return null; });
                if (d && d.success) {
                    celebrate({ big: true, kicker: 'Плод на труда', title: RE.text('redeemTitle'), num: '−' + d.code.pct + '%', unit: d.code.kind === 'plan' ? 'за план' : 'за добавки', text: 'Кодът ти: ' + d.code.code + '. Пази се в „Твоите отстъпки“.', image: 'share' });
                    mount(el, true);
                } else { b.disabled = false; toast((d && d.message) || 'Не стана. Опитай пак.', 'fa-circle-exclamation'); }
            });
        });
        var wh = el.querySelector('[data-week-hide]');
        if (wh) wh.addEventListener('click', function () { var wk = read(WEEK_KEY, {}) || {}; wk.dismissed = st.week.endKey; write(WEEK_KEY, wk); render(el, st, srv); });
        var ws = el.querySelector('[data-week-share]');
        if (ws) ws.addEventListener('click', function () { share(weekMoment(st), srv && srv.invite && srv.invite.code, 'share_week'); });
        var cj = el.querySelector('[data-challenge-join]');
        if (cj) cj.addEventListener('click', async function () {
            cj.disabled = true;
            if (await joinChallenge(st)) mount(el, true); else cj.disabled = false;
        });
        var inv = el.querySelector('[data-invite]');
        if (inv) inv.addEventListener('click', function () {
            share({ kicker: 'Покана', title: 'Ела с мен в Nutriin', shareTitle: RE.text('inviteShare'), num: '−' + srv.invite.pct + '%', unit: 'за първия план', image: 'invite' }, srv.invite.code, 'share_invite');
        });
        el.querySelector('[data-share]').addEventListener('click', function () {
            var mo = st.tier
                ? { kicker: st.tier.title, num: String(st.streak), unit: 'дни поред', title: st.tier.share, image: st.tier.image }
                : { kicker: 'Постоянство', num: String(st.streak), unit: 'дни поред', title: 'Ден след ден.', image: 'share' };
            share(mo, srv && srv.invite && srv.invite.code, 'share_section');
        });
    }

    async function mount(el, force) {
        if (!el || !RE) return;
        await loadContent();
        var st = localStatus();
        var cached = (read(SRV_KEY, {}) || {}).data || null;
        render(el, st, cached);
        var srv = await server(!!force);
        if (srv) render(el, st, srv);
        if (!force) moments(st, srv);
        try { scheduleReminders(st); } catch (_) {}
    }

    // Отваряне: при зареждане и при връщане към приложението (на телефона страницата остава жива).
    trackOpen();
    // Напомнянията се подреждат и без отметка днес — веднъж на ден, щом local-scheduler.js е на страницата.
    setTimeout(function () {
        var wk = read(WEEK_KEY, {}) || {};
        var today = global.GameScoring ? GameScoring.dateKey(new Date()) : '';
        if (!global.GameNotifier || !RE || !today || wk.sched === today) return;
        loadContent().then(function () {
            try { scheduleReminders(localStatus()); } catch (_) {}
            wk = read(WEEK_KEY, {}) || {}; wk.sched = today; write(WEEK_KEY, wk);
        });
    }, 4000);
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'visible') trackOpen(); });

    global.NutriPlanRewards = {
        status: localStatus, server: server, mount: mount, checkSoon: checkSoon,
        celebrate: celebrate, toast: toast, share: share, shareCard: card, moments: moments,
        event: event, openStats: function () { return RE.openStats(read(OPENS_KEY, null)); }
    };
}(window));
