/**
 * Награди за постоянство — телефонът: картата „Постоянство“ в Напредък, тържеството при етап,
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
    var SRV_TTL = 10 * 60 * 1000;
    var DAY = 86400000;
    var RE = global.RewardsEngine;

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
            goalDirection: (plan.analysis || {})._goalDirection || ''
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
        if (!force && c && c.uid === userId() && Date.now() - c.at < SRV_TTL) return c.data;
        try {
            var d = await post('/api/user/rewards', { todayKey: global.GameScoring ? GameScoring.dateKey(new Date()) : undefined });
            if (d && d.success) { write(SRV_KEY, { at: Date.now(), uid: userId(), data: d }); return d; }
        } catch (_) {}
        return c && c.uid === userId() ? c.data : null;
    }

    // ── Текстовете на етапите ───────────────────────────────────────────────
    function giftText(r, srv) {
        if (r.kind === 'supplement') return (srv && srv.supplements === false) ? '' : '−' + r.pct + '% за добавки';
        if (r.kind === 'plan') return isApp() ? '−' + r.pct + '% за план (в сайта)' : '−' + r.pct + '% за план';
        return '−' + r.pct + '%';
    }

    function comparison(srv) {
        if (!srv || srv.percentile == null || srv.percentile < 50 || persona().noScores) return '';
        return 'Постоянството ти е по-високо от това на ' + srv.percentile + '% от хората в Nutriin.';
    }

    /** Етап → { big, kicker, num, unit, title, text, fact, gift } */
    function momentOf(m, st, srv) {
        if (m.kind === 'tier') {
            var t = RE.tierById(m.tier);
            var gifts = t.rewards.map(function (r) { return giftText(r, srv); }).filter(Boolean);
            return {
                big: true, kicker: 'Ново стъпало', num: String(t.days), unit: 'дни постоянство',
                title: 'Браво! Достигна „' + t.title + '“', shareTitle: 'Достигнах „' + t.title + '“ в Nutriin',
                text: t.days + ' дни със спазен план средно над ' + t.minEng + '%. ' + (comparison(srv) || 'Това е постоянство, което личи.'),
                fact: t.id === 'habit' ? RE.FACTS.habit : RE.FACTS.consistency,
                gift: gifts.length ? gifts.join(' · ') + ' — кодът е в Напредък' : ''
            };
        }
        if (m.kind === 'habit') return {
            big: true, kicker: 'Нов навик', num: '66', unit: 'дни поред',
            title: 'Честито — създаде нов навик!', shareTitle: 'Създадох нов навик с Nutriin', text: 'Това вече не е усилие, а част от деня ти.', fact: RE.FACTS.habit
        };
        if (m.kind === 'streak') return {
            big: m.big, kicker: 'Поредица', num: String(m.days), unit: 'дни поред',
            title: m.days + ' дни поред — браво!', shareTitle: m.days + ' дни поред с моя план в Nutriin',
            text: m.days >= 21 ? RE.FACTS.streak21 : 'Седмица без прекъсване. Продължавай в същия ритъм.',
            fact: m.days >= 21 ? comparison(srv) : ''
        };
        if (m.kind === 'weight') {
            var lose = m.dir === 'lose';
            return {
                big: m.big, kicker: 'Етап към целта', num: (lose ? '−' : '+') + m.pct + '%', unit: lose ? 'от теглото' : 'към целта',
                title: lose ? 'Честито — ' + m.pct + '% по-леко!' : 'Честито — ' + m.pct + '% напред към целта!',
                shareTitle: lose ? m.pct + '% по-леко — стъпка по стъпка, с Nutriin' : m.pct + '% напред към целта — с Nutriin',
                text: 'Постигнато с ежедневни решения, не с крайности.',
                fact: lose && m.pct >= 7 ? RE.FACTS.weight7 : lose && m.pct >= 5 ? RE.FACTS.weight5 : ''
            };
        }
        if (m.kind === 'shield') return { big: false, icon: 'fa-shield-halved', title: 'Спечели жокер — пази поредицата в ден без отметки.' };
        return null;
    }

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
            '<div class="rw-moment-card">' +
            '<div class="rw-moment-mark"><img src="./brand/nutriin-mark-dark.svg" alt=""></div>' +
            (mo.kicker ? '<div class="rw-moment-kicker">' + esc(mo.kicker) + '</div>' : '') +
            (mo.num ? '<div class="rw-moment-big">' + esc(mo.num) + '</div><p>' + esc(mo.unit || '') + '</p>' : '') +
            '<h3>' + esc(mo.title) + '</h3>' +
            (mo.text ? '<p>' + esc(mo.text) + '</p>' : '') +
            (mo.gift ? '<div class="rw-moment-gift"><i class="fas fa-gift"></i>' + esc(mo.gift) + '</div>' : '') +
            (mo.fact ? '<p class="rw-moment-fact">' + esc(mo.fact) + '</p>' : '') +
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
        return new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; });
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
        var mark = await loadImg('./brand/nutriin-mark-dark.svg');
        if (mark) { x.globalAlpha = .1; x.drawImage(mark, 560, 300, 600, 600); x.globalAlpha = 1; }
        var logo = await loadImg('./brand/nutriin-horizontal-dark.svg');
        if (logo) { var lw = 300, lh = lw * (logo.height / logo.width || .3); x.drawImage(logo, 90, 96, lw, lh); }
        x.textAlign = 'left';
        x.fillStyle = '#A0F500';
        x.font = '700 34px ' + font;
        x.fillText(String(mo.kicker || 'Постижение').toUpperCase(), 90, 420);
        x.fillStyle = '#fff';
        x.font = '800 ' + (String(mo.num || '').length > 3 ? 230 : 300) + 'px ' + font;
        x.fillText(mo.num || '★', 80, 700);
        x.font = '500 48px ' + font;
        x.fillStyle = 'rgba(255,255,255,.86)';
        x.fillText(mo.unit || '', 90, 790);
        x.fillStyle = '#fff';
        x.font = '800 60px ' + font;
        wrap(x, mo.shareTitle || mo.title, 90, 900, W - 180, 72, 2);
        x.font = '500 36px ' + font;
        x.fillStyle = 'rgba(255,255,255,.72)';
        x.fillText('Започва отвътре. Личи навън.', 90, 1150);
        x.fillStyle = '#A0F500';
        x.font = '700 34px ' + font;
        x.fillText(invite ? 'nutriin.app · код ' + invite + ' — −15% за първия план' : 'nutriin.app', 90, 1230);
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

    async function share(mo, invite) {
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
            setTimeout(function () { toast(s.text, s.icon); }, delay + i * 5000);
            toastUsed();
        });
    }

    var _soon = null;
    function checkSoon() {
        clearTimeout(_soon);
        _soon = setTimeout(function () { moments(localStatus(), (read(SRV_KEY, {}) || {}).data || null); }, 1500);
    }

    // ── Картата „Постоянство“ ───────────────────────────────────────────────
    function codeRow(c) {
        var label = c.kind === 'supplement' ? 'Добавки −' + c.pct + '%' : c.kind === 'plan' ? 'План −' + c.pct + '%' : 'Партньор −' + c.pct + '%';
        var until = 'до ' + new Date(c.until).toLocaleDateString('bg-BG');
        var action = '';
        if (c.kind === 'supplement') action = '<a class="rw-btn" href="' + SHOP + '" target="_blank" rel="noopener">Магазин</a>';
        else if (c.kind === 'plan' && !isApp()) action = '<a class="rw-btn" href="' + base('pricing.html') + '?reward=' + esc(c.code) + '">Използвай</a>';
        return '<div class="rw-code"><div class="rw-code-main"><b>' + esc(label) + '</b><code>' + esc(c.code) + '</code><span>' + until +
            (c.kind === 'supplement' ? ' · доставка в България' : c.kind === 'plan' && isApp() ? ' · в сайта nutriin.app' : '') + '</span></div>' +
            '<button type="button" class="rw-btn" data-copy="' + esc(c.code) + '" aria-label="Копирай кода"><i class="far fa-copy"></i></button>' + action + '</div>';
    }

    function render(el, st, srv) {
        if (!st || !st.firstKey) {
            el.innerHTML = '<div class="rw-card"><p>Отбелязвай храненията и вечерния въпрос — от първия ден започва поредицата ти, а с нея и наградите: стъпала, точки и отстъпки.</p></div>';
            return;
        }
        var tierTitle = st.tier ? st.tier.title : 'Първи стъпки';
        var nx = st.next;
        var barPct = nx ? nx.progress : 100;
        var barLabel = nx
            ? 'До „' + nx.title + '“: ' + nx.daysHave + ' от ' + nx.days + ' дни · средно ' + (nx.avg || 0) + '% (нужни ' + nx.minEng + '%)'
            : 'Най-високото стъпало — пазиш го с всеки ден.';
        var pts = srv ? srv.wallet.balance : st.points.earned;
        var shields = '';
        for (var i = 0; i < st.shields.max; i++) shields += '<i class="fas fa-shield-halved" style="' + (i < st.shields.held ? '' : 'opacity:.3') + '"></i>';

        var summary;
        if (nx && nx.avg != null && nx.avg >= nx.minEng) summary = 'Още ' + (nx.days - nx.daysHave) + ' ' + plural(nx.days - nx.daysHave, 'ден', 'дни') + ' в този ритъм и стигаш „' + nx.title + '“' + (nx.rewards.length ? ' — ' + nx.rewards.map(function (r) { return giftText(r, srv); }).filter(Boolean).join(' и ') : '') + '.';
        else if (nx && nx.avg != null) summary = 'За „' + nx.title + '“ средната ангажираност трябва да е ' + nx.minEng + '% — сега е ' + nx.avg + '%. Всеки отметнат ден я вдига.';
        else summary = 'Пазиш най-високото стъпало. Точките продължават да се трупат.';
        var cmp = comparison(srv);
        if (cmp) summary += ' ' + cmp;

        var html = '<div class="rw-hero">' +
            '<div class="rw-hero-top"><div class="rw-streak"><b>' + st.streak + '</b><span>' + plural(st.streak, 'ден', 'дни') + ' поред</span></div>' +
            '<div class="rw-tier"><small>Стъпало</small><strong>' + esc(tierTitle) + '</strong></div></div>' +
            '<div class="rw-bar"><i data-w="' + barPct + '"></i></div><div class="rw-bar-label">' + esc(barLabel) + '</div>' +
            '<div class="rw-chips"><span class="rw-chip" title="Жокери: пазят поредицата в ден без отметки">' + shields + ' ' + st.shields.held + ' ' + plural(st.shields.held, 'жокер', 'жокера') + '</span>' +
            '<span class="rw-chip"><i class="fas fa-star"></i>' + num(pts) + ' точки</span></div>' +
            '</div>' +
            '<p class="rw-summary">' + esc(summary) + '</p>';
        if (st.warning) html += '<div class="rw-warn"><i class="fas fa-circle-exclamation"></i> Пази стъпалото „' + esc(st.tier.title) + '“: още ' + st.warning.daysLeft + ' ' + plural(st.warning.daysLeft, 'ден', 'дни') + ' под прага и слиза с едно. Един добър ден връща отброяването.</div>';

        html += '<button type="button" class="rw-toggle" aria-expanded="false" aria-controls="rwDetails"><span>Награди, стъпала и покана</span><i class="fas fa-chevron-down"></i></button><div id="rwDetails" hidden>';

        // Кодовете
        var codes = (srv && srv.codes || []).filter(function (c) { return !c.used; });
        html += '<div class="rw-card"><h4><i class="fas fa-gift"></i>Твоите отстъпки</h4>' +
            (codes.length ? codes.map(codeRow).join('') : '<p>' + (srv ? 'Първата отстъпка идва със стъпалото „Начало“ — 14 дни средно над 60%.' : 'Влез в акаунта си, за да събираш точки и отстъпки.') + '</p>') + '</div>';

        // Точки → отстъпка
        if (srv && srv.offers && srv.offers.length) {
            html += '<div class="rw-card"><h4><i class="fas fa-star"></i>Точки за отстъпка</h4><p>10 точки за добър ден, +5 при над 80%, +5 при крачки на целта; бонуси за стъпалата и поредиците.</p>' +
                srv.offers.filter(function (o) { return !(o.kind === 'plan' && isApp()); }).map(function (o) {
                    return '<div class="rw-code"><div class="rw-code-main"><b>' + esc(o.title) + '</b><span>' + num(o.cost) + ' точки</span></div>' +
                        '<button type="button" class="rw-btn rw-btn--main" data-redeem="' + esc(o.id) + '"' + (srv.wallet.balance < o.cost ? ' disabled' : '') + '>Вземи</button></div>';
                }).join('') + '</div>';
        }

        // Стъпалата
        html += '<div class="rw-card"><h4><i class="fas fa-stairs"></i>Стъпала на постоянството</h4>' + RE.TIERS.map(function (t, i) {
            var done = st.tier && st.tier.index >= i;
            var isNext = !done && (st.tier ? st.tier.index + 1 : 0) === i;
            return '<div class="rw-step' + (done ? ' is-done' : isNext ? ' is-next' : '') + '"><i class="fas ' + (done ? 'fa-check' : isNext ? 'fa-arrow-up' : 'fa-lock') + '"></i><div><b>' + esc(t.title) + '</b>' +
                '<span>' + t.days + ' дни · средно над ' + t.minEng + '%</span><div>' + t.rewards.map(function (r) { var g = giftText(r, srv); return g ? '<span class="rw-gift">' + esc(g) + '</span>' : ''; }).join('') + '</div></div></div>';
        }).join('') + '<p style="margin-top:8px">Достигнатото стъпало се пази: слиза с едно само след 14 поредни дни под прага.</p></div>';

        // Покана
        if (srv && srv.invite && srv.invite.code) {
            html += '<div class="rw-card"><h4><i class="fas fa-user-plus"></i>Покани приятел</h4>' +
                '<p>' + (isApp() ? 'Сподели кода си: приятелят получава отстъпка за първия си план, а ти — отстъпка и ' + 300 + ' точки, щом започне.'
                    : 'Приятелят получава −' + srv.invite.pct + '% за първия си план, а ти — код −' + srv.invite.reward + '% и 300 точки, щом започне.') +
                (srv.invite.count ? ' Досега: ' + srv.invite.count + ' ' + plural(srv.invite.count, 'приятел', 'приятели') + '.' : '') + '</p>' +
                '<div class="rw-code" style="margin-top:10px"><div class="rw-code-main"><code style="font-size:20px">' + esc(srv.invite.code) + '</code></div>' +
                '<button type="button" class="rw-btn" data-copy="' + esc(SITE + '/?invite=' + srv.invite.code) + '" aria-label="Копирай връзката"><i class="fas fa-link"></i></button>' +
                '<button type="button" class="rw-btn rw-btn--main" data-invite="1"><i class="fas fa-share-nodes"></i> Покани</button></div></div>';
        }

        // Рекорди
        var r = st.records;
        html += '<div class="rw-card"><h4><i class="fas fa-medal"></i>Лични рекорди</h4><div class="rw-records">' +
            '<div class="rw-record"><b>' + r.bestStreak + '</b><span>дни поред</span></div>' +
            '<div class="rw-record"><b>' + (r.bestWeek ? r.bestWeek.avg + '%' : '—') + '</b><span>най-добра седмица</span></div>' +
            '<div class="rw-record"><b>' + (r.maxSteps ? num(r.maxSteps.steps) : '—') + '</b><span>крачки за ден</span></div>' +
            '</div><button type="button" class="rw-btn rw-btn--main rw-btn--wide" data-share="1"><i class="fas fa-share-nodes"></i> Сподели постижението</button></div>';

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
                var d = await post('/api/user/rewards/redeem', { offer: b.getAttribute('data-redeem') }).catch(function () { return null; });
                if (d && d.success) {
                    celebrate({ big: true, kicker: 'Награда', title: 'Готово — твоята отстъпка', num: '−' + d.code.pct + '%', unit: d.code.kind === 'plan' ? 'за план' : 'за добавки', text: 'Код: ' + d.code.code + '. Пази се в „Твоите отстъпки“.' });
                    mount(el, true);
                } else { b.disabled = false; toast((d && d.message) || 'Не стана. Опитай пак.', 'fa-circle-exclamation'); }
            });
        });
        var inv = el.querySelector('[data-invite]');
        if (inv) inv.addEventListener('click', function () {
            share({ kicker: 'Покана', title: 'Започни с мен в Nutriin', shareTitle: 'Започни с мен — храненето, видяно отвътре', num: '−' + srv.invite.pct + '%', unit: 'за първия план' }, srv.invite.code);
        });
        el.querySelector('[data-share]').addEventListener('click', function () {
            var mo = st.tier
                ? { kicker: 'Постоянство', num: String(st.streak), unit: 'дни поред', title: 'Стъпало „' + st.tier.title + '“', shareTitle: 'Стъпало „' + st.tier.title + '“ в Nutriin' }
                : { kicker: 'Постоянство', num: String(st.streak), unit: 'дни поред', title: st.streak + ' дни поред с моя план' };
            share(mo, srv && srv.invite && srv.invite.code);
        });
    }

    async function mount(el, force) {
        if (!el || !RE) return;
        var st = localStatus();
        var cached = (read(SRV_KEY, {}) || {}).data || null;
        render(el, st, cached);
        var srv = await server(!!force);
        if (srv) render(el, st, srv);
        if (!force) moments(st, srv);
    }

    global.NutriPlanRewards = {
        status: localStatus, server: server, mount: mount, checkSoon: checkSoon,
        celebrate: celebrate, toast: toast, share: share, shareCard: card, moments: moments
    };
}(window));
