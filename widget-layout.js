/**
 * Подреждане на картите в таб — като менюто с бързи настройки на телефона:
 * „Подреди“ отваря списък с всички карти на таба; горе са показаните (влачи ≡ за реда,
 * „−“ скрива), долу — скритите („+“ връща). Изборът се пази на устройството (np_widgets_<таб>).
 *
 *   NutriPlanWidgets.mount({
 *     page: 'progress',                       // ключ за паметта
 *     container: el,                          // родителят на картите
 *     widgets: [{ id, title, icon, el }],     // в подредбата по подразбиране
 *     hidden: ['goal'],                       // скрити по подразбиране (по профила)
 *     version: 2                              // нова подредба по подразбиране → заменя запазената веднъж
 *   });
 *
 * Картата сама решава дали има какво да покаже (el.hidden); тук само се подреждат и
 * изключват (клас .wl-off). Нова карта в следваща версия идва на мястото си по подразбиране.
 */
(function (global) {
    'use strict';
    var doc = global.document;

    function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } }
    function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function haptic() { try { if (global.NutriPlanHaptic) global.NutriPlanHaptic('Light'); } catch (_) {} }

    /** Запазеното + новите карти на мястото им по подразбиране. */
    function stateOf(cfg) {
        var ids = cfg.widgets.map(function (w) { return w.id; });
        var saved = read('np_widgets_' + cfg.page);
        // Нова подредба по подразбиране (cfg.version) замества запазената веднъж — при голяма пренаредба на таба.
        if (!saved || !Array.isArray(saved.order) || (cfg.version || 1) !== (saved.v || 1)) return { order: ids.slice(), hidden: (cfg.hidden || []).slice() };
        var order = saved.order.filter(function (id) { return ids.indexOf(id) >= 0; });
        ids.forEach(function (id, i) {
            if (order.indexOf(id) >= 0) return;
            var prev = ids.slice(0, i).reverse().filter(function (p) { return order.indexOf(p) >= 0; })[0];
            order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
        });
        var hidden = (saved.hidden || []).filter(function (id) { return ids.indexOf(id) >= 0; });
        // нова карта (непозната досега) е скрита само ако профилът я скрива по подразбиране
        ids.forEach(function (id) { if ((saved.known || []).indexOf(id) < 0 && (cfg.hidden || []).indexOf(id) >= 0 && hidden.indexOf(id) < 0) hidden.push(id); });
        return { order: order, hidden: hidden };
    }

    function apply(cfg, st) {
        var byId = {};
        cfg.widgets.forEach(function (w) { byId[w.id] = w; });
        var anchor = cfg.button || null;
        st.order.forEach(function (id) {
            var w = byId[id];
            if (!w || !w.el) return;
            cfg.container.insertBefore(w.el, anchor);
            w.el.classList.toggle('wl-off', st.hidden.indexOf(id) >= 0);
        });
    }

    function save(cfg, st) {
        write('np_widgets_' + cfg.page, { v: cfg.version || 1, order: st.order, hidden: st.hidden, known: cfg.widgets.map(function (w) { return w.id; }) });
    }

    // ── Листът „Подреди“ ─────────────────────────────────────────────────────
    function openSheet(cfg) {
        if (doc.querySelector('.wl-sheet')) return;
        var st = stateOf(cfg);
        var byId = {};
        cfg.widgets.forEach(function (w) { byId[w.id] = w; });
        var ov = doc.createElement('div');
        ov.className = 'wl-sheet';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-label', 'Подреди картите');
        ov.innerHTML = '<div class="wl-panel"><div class="wl-grip" aria-hidden="true"></div>' +
            '<div class="wl-head"><h3>Подреди картите</h3><button type="button" class="wl-done">Готово</button></div>' +
            '<p class="wl-sub">Влачи дръжката вдясно, за да смениш реда. Скритите не изчезват — връщаш ги с „+“.</p>' +
            '<div class="wl-group-title">На екрана</div><ul class="wl-list" data-list="on"></ul>' +
            '<div class="wl-group-title">Скрити</div><ul class="wl-list" data-list="off"></ul>' +
            '<button type="button" class="wl-reset">Подредба по подразбиране</button></div>';
        doc.body.appendChild(ov);
        var onList = ov.querySelector('[data-list="on"]'), offList = ov.querySelector('[data-list="off"]');

        function row(id, on) {
            var w = byId[id];
            return '<li class="wl-row" data-id="' + esc(id) + '">' +
                (on ? '<button type="button" class="wl-btn wl-minus" aria-label="Скрий „' + esc(w.title) + '“"><i class="fas fa-minus"></i></button>'
                    : '<button type="button" class="wl-btn wl-plus" aria-label="Покажи „' + esc(w.title) + '“"><i class="fas fa-plus"></i></button>') +
                '<span class="wl-name"><i class="fas ' + esc(w.icon || 'fa-square') + '" aria-hidden="true"></i>' + esc(w.title) + '</span>' +
                (on ? '<span class="wl-handle" aria-hidden="true"><i class="fas fa-grip-lines"></i></span>' +
                      '<span class="wl-sr"><button type="button" class="wl-up" aria-label="По-нагоре">↑</button><button type="button" class="wl-down" aria-label="По-надолу">↓</button></span>' : '') +
                '</li>';
        }
        function draw() {
            var on = st.order.filter(function (id) { return st.hidden.indexOf(id) < 0; });
            var off = st.order.filter(function (id) { return st.hidden.indexOf(id) >= 0; });
            onList.innerHTML = on.map(function (id) { return row(id, true); }).join('') || '<li class="wl-empty">Нищо не е показано.</li>';
            offList.innerHTML = off.map(function (id) { return row(id, false); }).join('') || '<li class="wl-empty">Няма скрити карти.</li>';
        }
        function commit() { save(cfg, st); apply(cfg, st); }
        draw();

        ov.addEventListener('click', function (e) {
            if (e.target === ov || e.target.closest('.wl-done')) { close(); return; }
            var li = e.target.closest('.wl-row');
            var id = li && li.getAttribute('data-id');
            if (e.target.closest('.wl-minus')) { st.hidden.push(id); }
            else if (e.target.closest('.wl-plus')) {
                st.hidden = st.hidden.filter(function (x) { return x !== id; });
                // върнатата карта отива най-долу при показаните
                st.order = st.order.filter(function (x) { return x !== id; });
                var lastOn = st.order.filter(function (x) { return st.hidden.indexOf(x) < 0; }).pop();
                st.order.splice(lastOn ? st.order.indexOf(lastOn) + 1 : 0, 0, id);
            }
            else if (e.target.closest('.wl-up') || e.target.closest('.wl-down')) { move(id, e.target.closest('.wl-up') ? -1 : 1); }
            else if (e.target.closest('.wl-reset')) { st = { order: cfg.widgets.map(function (w) { return w.id; }), hidden: (cfg.hidden || []).slice() }; }
            else return;
            haptic(); commit(); draw();
        });
        /** Премества сред показаните с една позиция. */
        function move(id, dir) {
            var on = st.order.filter(function (x) { return st.hidden.indexOf(x) < 0; });
            var i = on.indexOf(id), j = i + dir;
            if (i < 0 || j < 0 || j >= on.length) return;
            var a = st.order.indexOf(on[i]), b = st.order.indexOf(on[j]);
            st.order[a] = on[j]; st.order[b] = on[i];
        }

        // Влачене за дръжката (мишка и пръст).
        var drag = null;
        onList.addEventListener('pointerdown', function (e) {
            var h = e.target.closest('.wl-handle');
            if (!h) return;
            var li = h.closest('.wl-row');
            e.preventDefault();
            var r = li.getBoundingClientRect();
            drag = { li: li, id: li.getAttribute('data-id'), startY: e.clientY, h: r.height + 8, moved: 0 };
            li.classList.add('is-drag');
            try { h.setPointerCapture(e.pointerId); } catch (_) {}
            haptic();
        });
        onList.addEventListener('pointermove', function (e) {
            if (!drag) return;
            var dy = e.clientY - drag.startY;
            drag.li.style.transform = 'translateY(' + dy + 'px)';
            var steps = Math.round(dy / drag.h);
            if (steps !== drag.moved) {
                var d = steps > drag.moved ? 1 : -1;
                var before = st.order.join();
                move(drag.id, d);
                if (st.order.join() !== before) {
                    drag.moved = steps;
                    // редът „скача“ на новото място; отместването тече от него
                    var lis = Array.prototype.slice.call(onList.querySelectorAll('.wl-row'));
                    var idx = lis.indexOf(drag.li);
                    var other = lis[idx + d];
                    if (other) onList.insertBefore(drag.li, d > 0 ? other.nextSibling : other);
                    drag.startY += d * drag.h;
                    drag.moved = 0;
                    drag.li.style.transform = 'translateY(' + (e.clientY - drag.startY) + 'px)';
                    haptic();
                }
            }
        });
        function endDrag() {
            if (!drag) return;
            drag.li.classList.remove('is-drag');
            drag.li.style.transform = '';
            drag = null;
            commit(); draw();
        }
        onList.addEventListener('pointerup', endDrag);
        onList.addEventListener('pointercancel', endDrag);

        function close() { ov.classList.remove('is-in'); setTimeout(function () { ov.remove(); }, 250); }
        requestAnimationFrame(function () { ov.classList.add('is-in'); });
        setTimeout(function () { var b = ov.querySelector('.wl-done'); if (b) b.focus(); }, 300);
    }

    function mount(cfg) {
        if (!cfg || !cfg.container || !cfg.widgets) return;
        cfg.widgets = cfg.widgets.filter(function (w) { return w.el; });
        if (!cfg.button) {
            var b = doc.createElement('button');
            b.type = 'button';
            b.className = 'wl-open';
            b.innerHTML = '<i class="fas fa-sliders" aria-hidden="true"></i> Подреди картите';
            b.addEventListener('click', function () { openSheet(cfg); });
            cfg.container.appendChild(b);
            cfg.button = b;
        }
        apply(cfg, stateOf(cfg));
        return { open: function () { openSheet(cfg); } };
    }

    global.NutriPlanWidgets = { mount: mount };
}(window));
