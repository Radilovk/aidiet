/**
 * Редакция на текста на място (лендингите на Eatologix, EmoEat, IrisMap).
 *
 * Включва се тайно: адрес с ?edit, 5 бързи докосвания върху футъра или Ctrl+Shift+E.
 * Пита веднъж за админ паролата (ADMIN_SECRET на сървъра) и я пази на това устройство.
 * Всеки текст става редактируем с докосване; връзките и бутоните не се отварят, докато режимът е включен.
 * Снимките: докосни снимка → „Качи снимка“ (от телефона/компютъра), „Линк“ или „Махни“; виждаш я веднага на място.
 * „Запази“ (или затваряне на страницата) праща промените към POST /api/admin/wording —
 * Claude ги чете оттам, прилага ги в кода и превежда новия текст на всички езици.
 * Редакциите се правят на български (изходният език); на чужд език страницата се връща на български.
 */
(function () {
    'use strict';
    if (window.__wordingEditor) return;
    window.__wordingEditor = true;

    var API = 'https://aidiet.radilov-k.workers.dev';
    var KEY = 'wordingSecret', FLAG = 'wordingEdit';
    var TEXT_SEL = 'h1,h2,h3,h4,h5,h6,p,li,summary,button,a,label,span,em,strong,b,i,small,blockquote,figcaption,td,th,dt,dd,div';
    var CYR = /[Ѐ-ӿ]/;
    var active = false, edits = [], originals = new WeakMap(), bar, note = '';
    var imgs = [], sel = null, picker; // смяна на снимки

    function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private */ } }
    function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function ss(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* private */ } }
    function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
    function req(method, path, body, keepalive) {
        return fetch(API + path, {
            method: method, keepalive: !!keepalive,
            headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': read(KEY) || '' },
            body: body ? JSON.stringify(body) : undefined
        });
    }

    // ── Включване ──────────────────────────────────────────────────────────
    function wanted() {
        try { if (new URLSearchParams(location.search).has('edit') || location.hash === '#edit') return true; } catch (e) { /* old */ }
        try { return sessionStorage.getItem(FLAG) === '1'; } catch (e) { return false; }
    }
    var taps = [];
    document.addEventListener('click', function (e) {
        if (active) return;
        if (!e.target.closest || !e.target.closest('footer, .foot, [data-wording-trigger]')) return;
        var now = Date.now(); taps = taps.filter(function (t) { return now - t < 2500; }); taps.push(now);
        if (taps.length >= 5) { taps = []; start(); }
    }, true);
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); active ? stop() : start(); }
    });

    function start() {
        var secret = read(KEY);
        if (!secret) {
            secret = window.prompt('Редакция на текста — админ парола:');
            if (!secret) return;
            store(KEY, secret);
        }
        req('POST', '/api/admin/verify', {}).then(function (r) {
            if (r.status === 401 || r.status === 403) { store(KEY, null); alert('Грешна парола.'); return; }
            ss(FLAG, '1');
            var i18n = window.EatologixI18n;
            if (i18n && i18n.lang && i18n.lang !== 'bg') { i18n.setLang('bg'); return; } // редакциите — на български
            enable();
        }).catch(function () { alert('Няма връзка със сървъра.'); });
    }

    // ── Режим на редакция ─────────────────────────────────────────────────
    function css() {
        var st = document.createElement('style');
        st.textContent =
            'body.wed [data-wed-ok]{outline:1px dashed rgba(8,181,185,.55);outline-offset:2px;cursor:text}' +
            'body.wed [contenteditable=true]{outline:2px solid #08B5B9;background:rgba(8,181,185,.08)}' +
            'body.wed [data-wed-changed]{outline:2px solid #10CC50 !important}' +
            'body.wed img{outline:2px dashed rgba(160,245,0,.8);outline-offset:-2px;cursor:pointer;pointer-events:auto !important}' +
            'body.wed img[data-wed-sel]{outline:4px solid #A0F500 !important}' +
            'body.wed img[data-wed-changed]{outline:4px solid #10CC50 !important}' +
            '#wedBar{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;gap:8px;align-items:center;flex-wrap:wrap;' +
            'background:#04181C;color:#E4FBF8;border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:10px 12px;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
            '#wedBar b{color:#A0F500}#wedBar .sp{flex:1}#wedBar button{all:unset;cursor:pointer;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.1)}' +
            '#wedBar button.pri{background:linear-gradient(135deg,#00E0DC,#A0F500);color:#04181C}#wedBar .msg{width:100%;font-weight:500;opacity:.8;font-size:12.5px}';
        document.head.appendChild(st);
    }
    function mark(root) {
        (root || document.body).querySelectorAll(TEXT_SEL).forEach(function (el) {
            if (el.closest('#wedBar, script, style, svg, [data-wording-skip]')) return;
            // само елементи със собствен текст (не обвивки)
            var own = false;
            for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && CYR.test(n.nodeValue)) { own = true; break; }
            if (own) el.setAttribute('data-wed-ok', '');
        });
    }
    function where(el) {
        var parts = [], e = el;
        for (var i = 0; e && e !== document.body && i < 4; i++, e = e.parentElement) {
            parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList && e.classList[0] ? '.' + e.classList[0] : ''));
        }
        var sec = el.closest('section, header, footer'); var h = sec && sec.querySelector('h1,h2,h3');
        return parts.join(' > ') + (h && h !== el ? ' | раздел: ' + norm(h.textContent).slice(0, 60) : '');
    }
    function onClick(e) {
        if (e.target.closest('#wedBar')) return;
        var im = imageAt(e);
        if (im) { e.preventDefault(); e.stopPropagation(); pick(im); return; }
        var el = e.target.closest('[data-wed-ok]');
        if (!el) { if (e.target.closest('a,button')) { e.preventDefault(); e.stopPropagation(); } return; }
        e.preventDefault(); e.stopPropagation();
        if (el.isContentEditable) return;
        if (!originals.has(el)) originals.set(el, el.innerText);
        el.setAttribute('contenteditable', 'true');
        el.focus();
    }
    function onBlur(e) {
        var el = e.target;
        if (!el || !el.getAttribute || el.getAttribute('contenteditable') !== 'true') return;
        el.removeAttribute('contenteditable');
        var old = originals.get(el), now = el.innerText;
        if (old == null) return;
        var rec = edits.filter(function (x) { return x.el === el; })[0];
        if (norm(old) === norm(now)) { edits = edits.filter(function (x) { return x.el !== el; }); el.removeAttribute('data-wed-changed'); }
        else if (rec) rec.new = now;
        else { edits.push({ el: el, old: old, new: now, where: where(el) }); el.setAttribute('data-wed-changed', ''); }
        render();
    }
    // ── Снимки ────────────────────────────────────────────────────────────
    // Снимката може да е под друг слой (напр. фон зад текста) — търсим я по точката на докосване.
    function imageAt(e) {
        var t = e.target.closest && e.target.closest('img');
        if (t && !t.closest('#wedBar, [data-wording-skip]')) return t;
        if (e.target.closest && e.target.closest('[data-wed-ok], a, button')) return null;
        var stack = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [];
        for (var i = 0; i < stack.length; i++) if (stack[i].tagName === 'IMG' && !stack[i].closest('#wedBar, [data-wording-skip]')) return stack[i];
        return null;
    }
    function pick(im) {
        if (sel) sel.removeAttribute('data-wed-sel');
        sel = im; im.setAttribute('data-wed-sel', '');
        if (!originals.has(im)) originals.set(im, { src: im.getAttribute('src') || '', srcset: im.getAttribute('srcset'), alt: im.getAttribute('alt') || '' });
        render();
    }
    function imgRec(im) {
        var r = imgs.filter(function (x) { return x.el === im; })[0];
        if (!r) { var o = originals.get(im); r = { el: im, where: where(im), oldSrc: o.src, alt: o.alt }; imgs.push(r); }
        delete r.data; delete r.url; delete r.remove;
        return r;
    }
    function show(im, src) {
        im.removeAttribute('srcset');
        var pic = im.parentElement && im.parentElement.tagName === 'PICTURE' ? im.parentElement : null;
        if (pic) pic.querySelectorAll('source').forEach(function (s) { s.remove(); });
        im.style.opacity = ''; im.src = src; im.setAttribute('data-wed-changed', '');
    }
    // Голямата снимка се смалява на устройството (до 2000px, WebP/JPEG) — бърз запис, същото качество на сайта.
    function shrink(file) {
        return new Promise(function (ok, bad) {
            var fr = new FileReader();
            fr.onerror = bad;
            fr.onload = function () {
                var img = new Image();
                img.onerror = function () { bad(new Error('Файлът не е снимка.')); };
                img.onload = function () {
                    var k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
                    var c = document.createElement('canvas');
                    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    var d = c.toDataURL('image/webp', 0.88);
                    if (d.indexOf('data:image/webp') !== 0) d = c.toDataURL('image/jpeg', 0.88);
                    ok({ data: d, w: c.width, h: c.height });
                };
                img.src = fr.result;
            };
            fr.readAsDataURL(file);
        });
    }
    function upload() {
        if (!sel) return;
        if (!picker) {
            picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/*'; picker.style.display = 'none';
            document.body.appendChild(picker);
            picker.addEventListener('change', function () {
                var f = picker.files && picker.files[0], im = sel; picker.value = '';
                if (!f || !im) return;
                render('Обработвам снимката…');
                shrink(f).then(function (x) {
                    var r = imgRec(im); r.data = x.data; r.w = x.w; r.h = x.h; r.name = f.name;
                    show(im, x.data); render('Снимката е сменена (виждаш я на място). Натисни „Запази“.');
                }).catch(function (err) { render('Не става: ' + (err && err.message || 'грешка')); });
            });
        }
        picker.click();
    }
    function link() {
        if (!sel) return;
        var u = prompt('Линк към снимката (https://…):', '');
        if (!u) return;
        if (!/^https?:\/\//i.test(u.trim())) { render('Линкът трябва да започва с https://'); return; }
        var r = imgRec(sel); r.url = u.trim(); show(sel, r.url);
        render('Снимката е сменена. Натисни „Запази“.');
    }
    function removeImg() {
        if (!sel) return;
        var r = imgRec(sel); r.remove = true; sel.style.opacity = '.2'; sel.setAttribute('data-wed-changed', '');
        render('Снимката ще бъде махната. Натисни „Запази“.');
    }
    function undoImg() {
        if (!sel) return;
        var o = originals.get(sel);
        imgs = imgs.filter(function (x) { return x.el !== sel; });
        sel.src = o.src; if (o.srcset) sel.setAttribute('srcset', o.srcset);
        sel.style.opacity = ''; sel.removeAttribute('data-wed-changed');
        render('Върнах старата снимка.');
    }
    function render(msg) {
        if (!bar) return;
        var n = edits.length + imgs.length;
        var imgBtns = sel ? '<span class="msg" style="opacity:1">🖼 Избрана снимка:</span>' +
            '<button data-a="up" class="pri">Качи снимка</button><button data-a="link">Линк</button>' +
            '<button data-a="rm">Махни</button>' + (imgs.some(function (x) { return x.el === sel; }) ? '<button data-a="undo">Върни старата</button>' : '') +
            '<button data-a="unsel">✕</button>' : '';
        bar.innerHTML = '<span>✏️ Редакция · <b>' + n + '</b> промени</span><span class="sp"></span>' +
            '<button data-a="note">Бележка</button><button data-a="save" class="pri">Запази</button><button data-a="exit">Изход</button>' +
            imgBtns +
            '<span class="msg">' + (msg || (sel ? 'Качи своя снимка или дай линк — виждаш я веднага на място.' :
                'Докосни текст, за да го промениш, или снимка, за да я смениш. Промените отиват при Claude — той ги превежда на всички езици.')) + '</span>';
    }
    function enable() {
        active = true; css(); document.body.classList.add('wed'); mark();
        bar = document.createElement('div'); bar.id = 'wedBar'; document.body.appendChild(bar); render();
        bar.addEventListener('click', function (e) {
            var a = e.target.getAttribute && e.target.getAttribute('data-a');
            if (a === 'note') { var t = prompt('Бележка към Claude (какво искаш да се промени, на кои места):', note); if (t != null) { note = t; render(note ? 'Бележката е добавена.' : ''); } }
            if (a === 'save') save(false);
            if (a === 'exit') stop();
            if (a === 'up') upload();
            if (a === 'link') link();
            if (a === 'rm') removeImg();
            if (a === 'undo') undoImg();
            if (a === 'unsel') { if (sel) sel.removeAttribute('data-wed-sel'); sel = null; render(); }
        });
        document.addEventListener('click', onClick, true);
        document.addEventListener('focusout', onBlur, true);
        new MutationObserver(function (m) { m.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1) mark(n); }); }); })
            .observe(document.body, { childList: true, subtree: true });
        window.addEventListener('pagehide', function () { if (edits.length || note || imgs.length) save(true); });
    }
    function save(onExit) {
        var ae = document.activeElement; if (ae && ae.isContentEditable) ae.blur();
        if (!edits.length && !note && !imgs.length) { render('Няма промени за запис.'); return Promise.resolve(); }
        var body = { site: location.hostname, page: location.pathname, url: location.href.split('#')[0], lang: 'bg', note: note,
            edits: edits.map(function (x) { return { old: x.old, new: x.new, where: x.where }; }),
            images: imgs.map(function (x) { return { where: x.where, oldSrc: x.oldSrc, alt: x.alt, data: x.data, url: x.url, remove: !!x.remove, w: x.w, h: x.h, name: x.name }; }) };
        // keepalive има таван ~64KB — със снимки записът при затваряне не става, затова питаме преди изход.
        if (onExit && imgs.some(function (x) { return x.data; })) return Promise.resolve();
        if (imgs.length) render('Записвам…');
        return req('POST', '/api/admin/wording', body, onExit).then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
            .then(function (x) {
                if (!x.r.ok) { render('Не е записано: ' + (x.d && x.d.error || x.r.status)); return; }
                edits.forEach(function (e) { e.el.removeAttribute('data-wed-changed'); });
                imgs.forEach(function (e) { e.el.removeAttribute('data-wed-changed'); originals.delete(e.el); });
                edits = []; imgs = []; note = '';
                render('Записано ✓ — кажи на Claude „приложи редакциите“.');
            }).catch(function () { if (!onExit) render('Няма връзка — опитай пак.'); });
    }
    function stop() {
        var go = function () { ss(FLAG, null); location.href = location.href.replace(/([?&])edit(=[^&#]*)?&?/, '$1').replace(/[?&]$/, '').replace('#edit', ''); };
        if (edits.length || note || imgs.length) { if (confirm('Да запазя промените преди изход?')) save(false).then(go); else go(); } else go();
    }

    if (wanted()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 300); });
        else setTimeout(start, 300);
    }
})();
