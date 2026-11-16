/**
 * Редакция на текста на място (лендингите на Eatologix, EmoEat, IrisMap).
 *
 * Включва се тайно: адрес с ?edit, 5 бързи докосвания върху футъра или Ctrl+Shift+E.
 * Пита веднъж за админ паролата (ADMIN_SECRET на сървъра) и я пази на това устройство.
 * Всеки текст става редактируем с докосване; връзките и бутоните не се отварят, докато режимът е включен.
 * Снимките (места data-slot, media-slot.js): докосни → добави няколко (сменят се с ефект), смени, махни, нагласи кадъра с пръсти.
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
    var slots = [], sel = null, picker; // снимките (места data-slot)

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
            'body.wed [data-slot]{outline:2px dashed rgba(160,245,0,.85);outline-offset:-2px;cursor:pointer;pointer-events:auto !important}' +
            'body.wed [data-slot][data-wed-changed]{outline:3px solid #10CC50 !important}' +
            'body.wed [data-slot][data-wed-sel]{outline:4px solid #A0F500 !important}' +
            'body.wed .wed-framing{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}' +
            'body.wed .wed-framing img{pointer-events:none}' +
            'body.wed [data-slot]:not(:has(img))::before{content:"＋ Снимки за банера — докосни";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
            'font:700 15px/1.3 system-ui,sans-serif;color:#08B5B9;background:repeating-linear-gradient(45deg,rgba(8,181,185,.1) 0 12px,rgba(8,181,185,.03) 12px 24px)}' +
            '#wedBar{max-height:55vh;overflow:auto;position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;gap:8px;align-items:center;flex-wrap:wrap;' +
            'background:#04181C;color:#E4FBF8;border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:10px 12px;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
            '#wedBar b{color:#A0F500}#wedBar .sp{flex:1}#wedBar button{all:unset;cursor:pointer;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.1)}' +
            '#wedBar button.pri{background:linear-gradient(135deg,#00E0DC,#A0F500);color:#04181C}#wedBar .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%}#wedBar.mini .row{display:none}#wedBar.mini .row.keep{display:flex}#wedBar .row+.row{padding-top:6px;border-top:1px solid rgba(255,255,255,.08)}' +
            '#wedBar select{font:600 13px system-ui,sans-serif;background:#0B2A30;color:#E4FBF8;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:7px 8px}' +
            '#wedBar label{display:inline-flex;align-items:center;gap:6px;font-size:13px}#wedBar input[type=range]{width:120px;accent-color:#A0F500}' +
            '#wedBar .msg{width:100%;font-weight:500;opacity:.8;font-size:12.5px}';
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
        var sl = slotAt(e);
        if (sl) { e.preventDefault(); e.stopPropagation(); if (sl !== sel) pick(sl); else if (!fr && MS()) { MS().pause(sl, true); render(); } return; }
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
    // ── Снимки (места data-slot, виж media-slot.js) ─────────────────────────
    // Място = една или няколко снимки с ефект на смяна. Докосване → избор; „Нагласи“ → местене с пръст,
    // два пръста (или колелцето) → приближаване. Всичко се вижда веднага на място.
    var MS = function () { return window.MediaSlot; };
    function slotAt(e) {
        var t = e.target.closest && e.target.closest('[data-slot]');
        if (t && !t.closest('#wedBar')) return t;
        if (e.target.closest && e.target.closest('[data-wed-ok], a, button')) return null;
        // мястото може да е под друг слой (фон зад текста) — търсим по точката на докосване
        var stack = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [];
        for (var i = 0; i < stack.length; i++) if (stack[i].hasAttribute && stack[i].hasAttribute('data-slot')) return stack[i];
        return null;
    }
    function slotRec(slot) {
        var r = slots.filter(function (x) { return x.slot === slot; })[0];
        if (!r) {
            r = { slot: slot, id: slot.getAttribute('data-slot'), where: where(slot), changed: false,
                html: slot.innerHTML, attrs: ['data-fx', 'data-every', 'data-ratio', 'data-width'].map(function (a) { return [a, slot.getAttribute(a)]; }) };
            slots.push(r);
        }
        return r;
    }
    function changed(slot) { slotRec(slot).changed = true; slot.setAttribute('data-wed-changed', ''); }
    function list(slot) { return MS() ? MS().images(slot) : Array.prototype.filter.call(slot.children, function (n) { return n.tagName === 'IMG'; }); }
    function cur() { if (!sel) return null; var l = list(sel); return l[MS() ? MS().index(sel) : 0] || l[0] || null; }
    function refresh(k) {
        if (!sel || !MS()) return;
        MS().refresh(sel);
        var n = list(sel).length;
        if (n) MS().show(sel, Math.min(k == null ? MS().index(sel) : k, n - 1), true);
        MS().pause(sel, true);
    }
    function pick(slot) {
        if (sel === slot) return;
        unpick();
        sel = slot; slot.setAttribute('data-wed-sel', ''); slotRec(slot);
        if (MS()) MS().pause(slot, true);
        render();
    }
    function unpick() {
        if (!sel) return;
        framing(false);
        sel.removeAttribute('data-wed-sel');
        if (MS()) MS().pause(sel, false);
        sel = null;
    }
    // Голямата снимка се смалява на устройството (до 2000px, WebP/JPEG) — бърз запис, същото качество на сайта.
    function shrink(file) {
        return new Promise(function (ok, bad) {
            var rd = new FileReader();
            rd.onerror = bad;
            rd.onload = function () {
                var img = new Image();
                img.onerror = function () { bad(new Error('Файлът не е снимка.')); };
                img.onload = function () {
                    var k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
                    var c = document.createElement('canvas');
                    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    var d = c.toDataURL('image/webp', 0.88);
                    if (d.indexOf('data:image/webp') !== 0) d = c.toDataURL('image/jpeg', 0.88);
                    ok(d);
                };
                img.src = rd.result;
            };
            rd.readAsDataURL(file);
        });
    }
    function newImg(src, name) {
        var im = document.createElement('img');
        im.src = src; im.alt = ''; im.decoding = 'async';
        im.setAttribute('data-x', '50'); im.setAttribute('data-y', '50'); im.setAttribute('data-z', '1');
        if (name) im.setAttribute('data-name', name);
        return im;
    }
    function filesIn(replace) {
        if (!sel) return;
        if (!picker) {
            picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/*'; picker.style.display = 'none';
            document.body.appendChild(picker);
            picker.addEventListener('change', function () {
                var files = Array.prototype.slice.call(picker.files || []), slot = sel, rep = picker.__replace; picker.value = '';
                if (!files.length || !slot) return;
                render('Обработвам ' + (files.length > 1 ? files.length + ' снимки' : 'снимката') + '…');
                Promise.all(files.map(shrink)).then(function (datas) {
                    var old = rep ? cur() : null, l = list(slot), at = old ? l.indexOf(old) : l.length;
                    var ref = old ? old.nextSibling : (l.length ? l[l.length - 1].nextSibling : slot.firstChild);
                    datas.forEach(function (d, i) {
                        var im = newImg(d, files[i].name);
                        if (old && i === 0) {
                            ['data-x', 'data-y', 'data-z'].forEach(function (a) { if (old.hasAttribute(a)) im.setAttribute(a, old.getAttribute(a)); });
                            im.alt = old.alt || ''; slot.replaceChild(im, old); ref = im.nextSibling;
                        } else slot.insertBefore(im, ref);
                    });
                    changed(slot); refresh(at);
                    render(datas.length > 1 ? 'Добавени ' + datas.length + ' снимки — сменят се с ефекта отдолу.' : 'Готово — виждаш я на място. „Нагласи“ за кадъра.');
                }).catch(function (err) { render('Не става: ' + (err && err.message || 'грешка')); });
            });
        }
        picker.multiple = !replace; picker.__replace = !!replace;
        picker.click();
    }
    function link() {
        if (!sel) return;
        var u = prompt('Линк към снимката (https://…):', '');
        if (!u) return;
        if (!/^https?:\/\//i.test(u.trim())) { render('Линкът трябва да започва с https://'); return; }
        sel.appendChild(newImg(u.trim())); changed(sel); refresh(list(sel).length - 1);
        render('Добавена. Натисни „Запази“, когато си готов.');
    }
    function removeCur() {
        var im = cur(); if (!im) return;
        var k = list(sel).indexOf(im); im.remove(); changed(sel); refresh(Math.max(0, k - 1));
        render(list(sel).length ? 'Махнах снимката.' : 'Мястото е празно — на сайта няма да се вижда.');
    }
    function makeFirst() {
        var im = cur(); if (!im) return;
        var l = list(sel); if (l[0] === im) return;
        sel.insertBefore(im, l[0]); changed(sel); refresh(0); render('Тази снимка е първа.');
    }
    function revert() {
        if (!sel) return;
        var r = slotRec(sel); framing(false);
        sel.innerHTML = r.html;
        r.attrs.forEach(function (a) { if (a[1] == null) sel.removeAttribute(a[0]); else sel.setAttribute(a[0], a[1]); });
        r.changed = false; sel.removeAttribute('data-wed-changed'); refresh(0);
        render('Върнах както беше.');
    }
    function setAttr(name, v) {
        if (!sel) return;
        if (v === '' || v == null) sel.removeAttribute(name); else sel.setAttribute(name, v);
        changed(sel); refresh();
    }

    // Нагласяне: един пръст — местене, два пръста — приближаване (на компютър: влачене и колелцето).
    var fr = null; // { pts: Map, start }
    function framing(on) {
        if (!sel) return;
        if (!on && !fr) return;
        if (on) {
            fr = { pts: {}, n: 0 };
            sel.classList.add('wed-framing'); if (bar) bar.classList.add('mini');
            sel.scrollIntoView({ block: 'center', behavior: 'smooth' });
            sel.addEventListener('pointerdown', fDown); sel.addEventListener('wheel', fWheel, { passive: false });
            window.addEventListener('pointermove', fMove); window.addEventListener('pointerup', fUp); window.addEventListener('pointercancel', fUp);
        } else {
            sel.classList.remove('wed-framing'); if (bar) bar.classList.remove('mini');
            sel.removeEventListener('pointerdown', fDown); sel.removeEventListener('wheel', fWheel);
            window.removeEventListener('pointermove', fMove); window.removeEventListener('pointerup', fUp); window.removeEventListener('pointercancel', fUp);
            fr = null;
        }
        render();
    }
    function getF(im) {
        return { x: parseFloat(im.getAttribute('data-x')) || 50, y: parseFloat(im.getAttribute('data-y')) || 50,
            z: parseFloat(im.getAttribute('data-z')) || 1 };
    }
    function setF(im, f) {
        f.x = Math.min(100, Math.max(0, f.x)); f.y = Math.min(100, Math.max(0, f.y)); f.z = Math.min(4, Math.max(1, f.z));
        im.setAttribute('data-x', f.x.toFixed(1)); im.setAttribute('data-y', f.y.toFixed(1)); im.setAttribute('data-z', f.z.toFixed(2));
        if (MS()) MS().frame(im);
        changed(sel);
    }
    function fDown(e) {
        if (!fr) return;
        e.preventDefault(); e.stopPropagation();
        try { sel.setPointerCapture(e.pointerId); } catch (x) { /* стар браузър */ }
        fr.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        fr.base = null;
    }
    function fMove(e) {
        if (!fr || !fr.pts[e.pointerId]) return;
        e.preventDefault();
        var im = cur(); if (!im) return;
        var p = fr.pts[e.pointerId], ids = Object.keys(fr.pts), rect = sel.getBoundingClientRect(), f = getF(im);
        if (ids.length >= 2) {
            var a = fr.pts[ids[0]], b = fr.pts[ids[1]];
            var d0 = Math.hypot(a.x - b.x, a.y - b.y);
            p.x = e.clientX; p.y = e.clientY;
            var d1 = Math.hypot(a.x - b.x, a.y - b.y);
            if (d0 > 0) { f.z *= d1 / d0; setF(im, f); }
            return;
        }
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        // плъзгаш снимката с пръста: надясно → показва се лявата ѝ част
        f.x -= dx / rect.width * 100 / f.z * 1.6;
        f.y -= dy / rect.height * 100 / f.z * 1.6;
        setF(im, f);
    }
    function fUp(e) { if (fr && fr.pts[e.pointerId]) { delete fr.pts[e.pointerId]; render(); } }
    function fWheel(e) {
        var im = cur(); if (!im) return;
        e.preventDefault();
        var f = getF(im); f.z *= e.deltaY < 0 ? 1.06 : 1 / 1.06; setF(im, f);
    }

    var FXN = { fade: 'Плавно', kenburns: 'Бавно приближаване', slide: 'Плъзгане', wipe: 'Цветна завеса', iris: 'Ирис (от центъра)', blur: 'Размиване' };
    var RATIOS = [['', 'Рамка: както е'], ['16/9', '16:9 широка'], ['4/3', '4:3'], ['1/1', '1:1 квадрат'], ['4/5', '4:5'], ['3/4', '3:4 висока'], ['9/16', '9:16 цял екран']];
    function opts(arr, v) {
        return arr.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(v || '') ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
    }
    function slotBar() {
        if (!sel) return '';
        var l = list(sel), n = l.length, k = n ? (MS() ? MS().index(sel) : 0) : -1;
        var fx = sel.getAttribute('data-fx') || 'fade', every = sel.getAttribute('data-every') || '6';
        var w = sel.getAttribute('data-width') || '100', im = cur(), z = im ? getF(im).z : 1;
        return '<div class="row keep"><span>🖼 ' + (n ? 'Снимка ' + (k + 1) + ' от ' + n : 'Празно място') + '</span>' +
            (n > 1 ? '<button data-a="prev">‹</button><button data-a="next">›</button>' : '') +
            '<span class="sp"></span><button data-a="mini">' + (bar.classList.contains('mini') ? '▴ Още' : '▾ Скрий') + '</button><button data-a="unsel">✕</button></div>' +
            '<div class="row"><button data-a="add" class="pri">＋ Добави снимки</button>' +
            (n ? '<button data-a="rep">Смени тази</button><button data-a="rm">Махни тази</button>' : '') +
            (n > 1 && k > 0 ? '<button data-a="first">Направи първа</button>' : '') + '<button data-a="link">Линк</button></div>' +
            (n ? '<div class="row keep"><button data-a="frame" class="' + (fr ? 'pri' : '') + '">' + (fr ? '✓ Готово с кадъра' : '✋ Нагласи кадъра') + '</button>' +
                '<label>Приближение <input type="range" data-i="zoom" min="1" max="4" step="0.05" value="' + z + '"></label></div>' : '') +
            '<div class="row"><select data-i="ratio">' + opts(RATIOS, sel.getAttribute('data-ratio')) + '</select>' +
            '<label>Размер <input type="range" data-i="width" min="40" max="100" step="5" value="' + w + '"> <b>' + w + '%</b></label></div>' +
            (n > 1 ? '<div class="row"><select data-i="fx">' + opts(Object.keys(FXN).map(function (key) { return [key, 'Ефект: ' + FXN[key]]; }), fx) + '</select>' +
                '<select data-i="every">' + opts([['3', 'през 3 с'], ['4', 'през 4 с'], ['6', 'през 6 с'], ['8', 'през 8 с'], ['12', 'през 12 с']], every) + '</select>' +
                '<button data-a="play">▶ Пусни</button></div>' : '') +
            (slotRec(sel).changed ? '<div class="row"><button data-a="revert">Върни както беше</button></div>' : '');
    }
    function render(msg) {
        if (!bar) return;
        var n = edits.length + slots.filter(function (x) { return x.changed; }).length;
        bar.innerHTML = '<div class="row keep"><span>✏️ Редакция · <b>' + n + '</b> промени</span><span class="sp"></span>' +
            '<button data-a="note">Бележка</button><button data-a="save" class="pri">Запази</button><button data-a="exit">Изход</button></div>' +
            slotBar() +
            '<span class="msg">' + (msg || (fr ? 'Плъзни снимката с пръст; с два пръста (или колелцето) — приближи/отдалечи.' : sel ? 'Добави няколко снимки — сменят се с ефект. „Нагласи кадъра“ — местене и приближаване.' :
                'Докосни текст, за да го промениш, или снимка, за да я смениш. Промените отиват при Claude — той ги превежда на всички езици.')) + '</span>';
    }
    function onInput(e) {
        var i = e.target.getAttribute && e.target.getAttribute('data-i'); if (!i || !sel) return;
        var v = e.target.value;
        if (i === 'zoom') { var im = cur(); if (im) { var f = getF(im); f.z = parseFloat(v); setF(im, f); } return; }
        if (i === 'width') { setAttr('data-width', v === '100' ? '' : v); var b = e.target.parentNode.querySelector('b'); if (b) b.textContent = v + '%'; return; }
        if (i === 'ratio') setAttr('data-ratio', v);
        if (i === 'fx') setAttr('data-fx', v);
        if (i === 'every') setAttr('data-every', v);
        render();
    }
    function play() {
        if (!sel || !MS()) return;
        var s = sel; MS().pause(s, false); MS().show(s, MS().index(s) + 1);
        render('Пуснато — виж ефекта. Докосни снимката, за да спре.');
        setTimeout(function () { if (sel === s) MS().pause(s, true); }, 15000);
    }
    function enable() {
        active = true; css(); document.body.classList.add('wed'); mark();
        // празните места (EmoEat, IrisMap) се показват само в редакция
        document.querySelectorAll('[data-slot]').forEach(function (s) { s.classList.add('ms-editing'); s.removeAttribute('hidden'); });
        bar = document.createElement('div'); bar.id = 'wedBar'; document.body.appendChild(bar); render();
        bar.addEventListener('click', function (e) {
            var a = e.target.getAttribute && e.target.getAttribute('data-a');
            if (a === 'note') { var t = prompt('Бележка към Claude (какво искаш да се промени, на кои места):', note); if (t != null) { note = t; render(note ? 'Бележката е добавена.' : ''); } }
            if (a === 'save') save(false);
            if (a === 'exit') stop();
            if (a === 'add') filesIn(false);
            if (a === 'rep') filesIn(true);
            if (a === 'link') link();
            if (a === 'rm') removeCur();
            if (a === 'first') makeFirst();
            if (a === 'revert') revert();
            if (a === 'frame') framing(!fr);
            if (a === 'play') play();
            if (a === 'prev' || a === 'next') { framing(false); MS().show(sel, MS().index(sel) + (a === 'next' ? 1 : -1), true); MS().pause(sel, true); render(); }
            if (a === 'unsel') { unpick(); bar.classList.remove('mini'); render(); }
            if (a === 'mini') { bar.classList.toggle('mini'); render(); }
        });
        bar.addEventListener('input', onInput);
        bar.addEventListener('change', onInput);
        document.addEventListener('click', onClick, true);
        document.addEventListener('focusout', onBlur, true);
        new MutationObserver(function (m) { m.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1 && !n.closest('[data-slot]')) mark(n); }); }); })
            .observe(document.body, { childList: true, subtree: true });
        window.addEventListener('pagehide', function () { if (edits.length || note) save(true); });
    }
    function slotData() {
        return slots.filter(function (x) { return x.changed; }).map(function (r) {
            var s = r.slot;
            return { slot: r.id, where: r.where, fx: s.getAttribute('data-fx') || '', every: s.getAttribute('data-every') || '',
                ratio: s.getAttribute('data-ratio') || '', width: s.getAttribute('data-width') || '',
                items: list(s).map(function (im) {
                    var src = im.getAttribute('src') || '', f = getF(im);
                    var it = { x: f.x, y: f.y, z: f.z, alt: im.getAttribute('alt') || '', name: im.getAttribute('data-name') || '' };
                    if (src.indexOf('data:') === 0) it.data = src; else it.src = src;
                    return it;
                }) };
        });
    }
    function save(onExit) {
        var ae = document.activeElement; if (ae && ae.isContentEditable) ae.blur();
        var sd = slotData();
        if (!edits.length && !note && !sd.length) { render('Няма промени за запис.'); return Promise.resolve(); }
        var body = { site: location.hostname, page: location.pathname, url: location.href.split('#')[0], lang: 'bg', note: note,
            edits: edits.map(function (x) { return { old: x.old, new: x.new, where: x.where }; }), slots: sd };
        // keepalive има таван ~64KB — при затваряне се пращат само текстовете; снимките — с „Запази“ / „Изход“.
        if (onExit) { if (!edits.length && !note) return Promise.resolve(); delete body.slots; }
        if (sd.length && !onExit) render('Записвам…');
        return req('POST', '/api/admin/wording', body, onExit).then(function (r) { return r.json().then(function (d) { return { r: r, d: d }; }); })
            .then(function (x) {
                if (!x.r.ok) { render('Не е записано: ' + (x.d && x.d.error || x.r.status)); return; }
                edits.forEach(function (e) { e.el.removeAttribute('data-wed-changed'); });
                edits = []; note = '';
                if (!onExit) { slots.forEach(function (r) { r.slot.removeAttribute('data-wed-changed'); }); slots = []; if (sel) slotRec(sel); }
                render('Записано ✓ — кажи на Claude „приложи редакциите“.');
            }).catch(function () { if (!onExit) render('Няма връзка — опитай пак.'); });
    }
    function stop() {
        var go = function () { ss(FLAG, null); location.href = location.href.replace(/([?&])edit(=[^&#]*)?&?/, '$1').replace(/[?&]$/, '').replace('#edit', ''); };
        if (edits.length || note || slots.some(function (x) { return x.changed; })) { if (confirm('Да запазя промените преди изход?')) save(false).then(go); else go(); } else go();
    }

    if (wanted()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 300); });
        else setTimeout(start, 300);
    }
})();
