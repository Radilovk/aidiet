/**
 * Админ панел → „Награди“: думите и снимките на наградите за постоянство (rewards-engine.js).
 *
 * Всяко поле показва стойността по подразбиране като подсказка; празно поле = по подразбиране.
 * Записът е в KV rewards_content (POST /api/admin/rewards/content) и влиза в приложението до 10 минути
 * (без нова версия). Снимките се смаляват тук до 1080×1350 (4:5, центрирано) и се качват по тема
 * (POST /api/admin/rewards/image). Заявките към /api/admin/* носят паролата (глобалният интерсептор).
 */
(function () {
    'use strict';
    var WORKER = 'https://aidiet.radilov-k.workers.dev';
    var RE = window.RewardsEngine;
    var content = {};
    var defaults = null;

    var THEME_LABEL = {
        resolve: 'Решимост (ниво 1)', persist: 'Упоритост (ниво 2)', consistency: 'Постоянство (ниво 3)', inner: 'Вътрешна сила (ниво 4)',
        habit: 'Нов навик (66 дни)', streak: 'Поредица (7, 21, 100 дни)', weight: 'Етап на теглото', invite: 'Покана за приятел', share: 'Споделяне и награда срещу точки'
    };
    var TEXT_LABEL = {
        section: 'Заглавие на картата', empty: 'Преди първия отметнат ден', levelLabel: 'Над нивото', firstLevel: 'Преди първото ниво',
        towards: 'Лента към следващото ниво ({title} {have} {days} {avg} {min})', top: 'Лента на най-високото ниво',
        onTrack: 'В ритъм ({n} {daysWord} {title} {titleLower})', rewardLine: 'Наградата ({gifts})', behind: 'Под прага ({title} {min} {avg})',
        atTop: 'На най-високото ниво', warn: 'Предупреждение ({titleLower} {n} {daysWord})', comparison: 'Сравнение с другите ({p})',
        newLevel: 'Надпис над числото при ново ниво', giftReady: 'След наградата в поздрава', shield: 'Спечелен жокер',
        weightLose: 'Етап при сваляне ({pct})', weightGain: 'Етап при качване ({pct})', weightText: 'Текст при етап на теглото',
        weightShareLose: 'Споделяне — сваляне', weightShareGain: 'Споделяне — качване',
        codesTitle: 'Заглавие: отстъпките', codesEmpty: 'Още без отстъпки', pointsTitle: 'Заглавие: точките', pointsText: 'Обяснение на точките',
        pathTitle: 'Заглавие: нивата', pathNote: 'Бележка под нивата', inviteTitle: 'Заглавие: покана', inviteText: 'Текст на поканата ({pct} {reward})',
        inviteShare: 'Покана — на картата за споделяне', redeemTitle: 'Поздрав при отстъпка срещу точки',
        shareTagline: 'Долу на картата за споделяне', shareInvite: 'Кодът на картата за споделяне ({code})'
    };

    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function el(id) { return document.getElementById(id); }
    function ok(m) { if (typeof window.showSuccess === 'function') window.showSuccess(m); }
    function fail(m) { if (typeof window.showError === 'function') window.showError(m); else alert(m); }
    function get(o, path) { return path.reduce(function (x, k) { return x && x[k]; }, o); }

    function snapshotDefaults() {
        RE.applyContent(null);
        defaults = {
            tiers: RE.TIERS.map(function (t) { return { id: t.id, days: t.days, minEng: t.minEng, rewards: t.rewards, title: t.title, moment: t.moment, text: t.text, share: t.share, word: t.word, image: t.image }; }),
            streaks: RE.STREAKS.map(function (s) { return { days: s.days, moment: s.moment, text: s.text, share: s.share }; }),
            texts: Object.assign({}, RE.TEXTS),
            words: { offer: RE.OFFERS[0].word, thanks: RE.WORDS.thanks }
        };
    }

    function field(path, label, def, long) {
        var v = get(content, path) || '';
        var id = 'rw_' + path.join('_');
        var input = long
            ? '<textarea id="' + id + '" data-path="' + esc(path.join('.')) + '" rows="2" placeholder="' + esc(def) + '" style="width:100%;min-height:64px;height:auto;font-family:inherit">' + esc(v) + '</textarea>'
            : '<input id="' + id + '" data-path="' + esc(path.join('.')) + '" type="text" placeholder="' + esc(def) + '" value="' + esc(v) + '" style="width:100%">';
        return '<div class="form-group"><label for="' + id + '">' + esc(label) + '</label>' + input + '</div>';
    }

    function imageBox(theme) {
        var src = (content.images && content.images[theme]) || ('./brand/rewards/' + theme + '.webp');
        var custom = !!(content.images && content.images[theme]);
        return '<div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:12px">' +
            '<img src="' + esc(src) + '" alt="" style="width:96px;height:120px;object-fit:cover;border-radius:12px;background:#eee;flex:none">' +
            '<div style="flex:1"><div style="font-weight:600;margin-bottom:6px">Снимка: ' + esc(THEME_LABEL[theme]) + (custom ? ' · твоя' : ' · по подразбиране') + '</div>' +
            '<input type="file" accept="image/png,image/jpeg,image/webp" data-theme="' + theme + '" style="max-width:100%">' +
            (custom ? '<button type="button" class="btn" data-reset-image="' + theme + '" style="margin-top:8px">Върни по подразбиране</button>' : '') +
            '<div style="font-size:12px;color:#666;margin-top:6px">Изрязва се 4:5 от центъра (1080×1350). Сменя се веднага, без нова версия.</div></div></div>';
    }

    function render() {
        var box = el('rewardsAdmin');
        if (!box) return;
        var d = defaults;
        var h = '';
        d.tiers.forEach(function (t) {
            h += '<div class="card"><h3 style="margin-top:0">Ниво: ' + esc(get(content, ['tiers', t.id, 'title']) || t.title) +
                ' <small style="font-weight:400;color:#666">— ' + t.days + ' дни, средно над ' + t.minEng + '%</small></h3>' +
                imageBox(t.image) +
                field(['tiers', t.id, 'title'], 'Име на нивото', t.title) +
                field(['tiers', t.id, 'moment'], 'Поздрав (голям надпис)', t.moment) +
                field(['tiers', t.id, 'text'], 'Текст под поздрава', t.text, true) +
                field(['tiers', t.id, 'share'], 'За споделяне (първо лице)', t.share) +
                field(['tiers', t.id, 'word'], 'Дума за кода (латиница, до 5 букви) → ' + t.rewards.map(function (r) { return RE.codeFor(get(content, ['tiers', t.id, 'word']) || t.word, r.pct) + (r.kind === 'plan' ? ' за план' : ' за добавки'); }).join(', '), t.word) +
                '</div>';
        });
        h += '<div class="card"><h3 style="margin-top:0">Поредици</h3>' + imageBox('streak') + imageBox('habit');
        d.streaks.forEach(function (s) {
            h += '<h4>' + s.days + ' дни поред</h4>' +
                field(['streaks', String(s.days), 'moment'], 'Поздрав', s.moment) +
                field(['streaks', String(s.days), 'text'], 'Текст', s.text, true) +
                field(['streaks', String(s.days), 'share'], 'За споделяне', s.share);
        });
        h += '</div>';
        h += '<div class="card"><h3 style="margin-top:0">Други снимки</h3>' + imageBox('weight') + imageBox('invite') + imageBox('share') + '</div>';
        h += '<div class="card"><h3 style="margin-top:0">Думи на другите кодове</h3>' +
            field(['words', 'offer'], 'Отстъпка срещу точки → ' + RE.codeFor(get(content, ['words', 'offer']) || d.words.offer, 10), d.words.offer) +
            field(['words', 'thanks'], 'Благодарност за покана → ' + RE.codeFor(get(content, ['words', 'thanks']) || d.words.thanks, 20), d.words.thanks) +
            '<div style="font-size:12px;color:#666">Кодът е еднакъв за всички, но важи само за спечелилия го. Нова дума важи за новите награди; дадените пазят своята.</div></div>';
        h += '<div class="card"><h3 style="margin-top:0">Текстове на картата и поздравите</h3>' +
            '<div style="font-size:12px;color:#666;margin-bottom:12px">{думите в скоби} се заменят с числата и имената — остави ги в текста.</div>';
        Object.keys(d.texts).forEach(function (k) { h += field(['texts', k], TEXT_LABEL[k] || k, d.texts[k], d.texts[k].length > 70); });
        h += '</div>';
        box.innerHTML = h;
        box.querySelectorAll('input[type=file][data-theme]').forEach(function (inp) {
            inp.addEventListener('change', function () { if (inp.files[0]) upload(inp.getAttribute('data-theme'), inp.files[0]); });
        });
        box.querySelectorAll('[data-reset-image]').forEach(function (b) {
            b.addEventListener('click', function () { sendImage(b.getAttribute('data-reset-image'), ''); });
        });
    }

    function collect() {
        var out = { tiers: {}, streaks: {}, texts: {}, words: {} };
        el('rewardsAdmin').querySelectorAll('[data-path]').forEach(function (f) {
            var v = f.value.trim();
            if (!v) return;
            var p = f.getAttribute('data-path').split('.');
            var o = out;
            for (var i = 0; i < p.length - 1; i++) o = o[p[i]] = o[p[i]] || {};
            o[p[p.length - 1]] = v;
        });
        return out;
    }

    async function load() {
        if (!RE) { el('rewardsAdmin').innerHTML = '<p>rewards-engine.js не е зареден.</p>'; return; }
        if (!defaults) snapshotDefaults();
        try {
            var r = await fetch(WORKER + '/api/rewards/content?t=' + Date.now());
            content = (await r.json()).content || {};
        } catch (e) { fail('Не се зареди съдържанието на наградите.'); content = {}; }
        render();
    }

    async function save() {
        var btn = el('rewardsSave');
        btn.disabled = true;
        try {
            var r = await fetch(WORKER + '/api/admin/rewards/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: collect() }) });
            var d = await r.json().catch(function () { return {}; });
            if (r.ok && d.success) { ok('Записано. В приложението — до 10 минути.'); await load(); }
            else fail('Не е записано: ' + (d.error || r.status));
        } catch (e) { fail('Не е записано: ' + e.message); }
        btn.disabled = false;
    }

    function shrink(file) {
        return new Promise(function (res, rej) {
            var img = new Image();
            img.onload = function () {
                var W = 1080, H = 1350, k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
                var w = img.naturalWidth * k, h = img.naturalHeight * k;
                var c = document.createElement('canvas'); c.width = W; c.height = H;
                c.getContext('2d').drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
                var d = c.toDataURL('image/webp', 0.8);
                res(d.indexOf('data:image/webp') === 0 ? d : c.toDataURL('image/jpeg', 0.82));
                URL.revokeObjectURL(img.src);
            };
            img.onerror = function () { rej(new Error('Файлът не е снимка.')); };
            img.src = URL.createObjectURL(file);
        });
    }

    async function sendImage(theme, data) {
        try {
            var r = await fetch(WORKER + '/api/admin/rewards/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: theme, data: data }) });
            var d = await r.json().catch(function () { return {}; });
            if (r.ok && d.success) { ok(data ? 'Снимката е сменена.' : 'Върната е снимката по подразбиране.'); await load(); }
            else fail('Снимката не е записана: ' + (d.error || r.status));
        } catch (e) { fail('Снимката не е записана: ' + e.message); }
    }

    async function upload(theme, file) {
        try { await sendImage(theme, await shrink(file)); } catch (e) { fail(e.message); }
    }

    window.NutriinRewardsAdmin = { load: load, save: save };
}());
