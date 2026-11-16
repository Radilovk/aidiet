/**
 * Снимки в лендингите: една или няколко снимки в едно място, с ефект на смяна и нагласен кадър.
 *
 *   <figure class="lp-hero-photo" data-slot="hero" data-fx="kenburns" data-every="6" data-ratio="4/3" data-width="100">
 *     <img src="…" data-x="50" data-y="30" data-z="1.15" alt="…">
 *     <img src="…" loading="lazy" alt="…">
 *   </figure>
 *
 * data-x / data-y — коя точка от снимката е в центъра на кадъра (0–100), data-z — приближение (1–4).
 * data-fx: fade | kenburns | slide | wipe | iris | blur. data-every — секунди между смените.
 * data-ratio — рамка (16/9, 4/3, 1/1, 3/4…); data-width — ширина в % от мястото.
 * Празно място (без снимки) не се показва. Нагласяването става в редактора (wording-editor.js).
 */
(function () {
    'use strict';
    if (window.MediaSlot) return;

    var FX = ['fade', 'kenburns', 'slide', 'wipe', 'iris', 'blur'];
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var st = document.createElement('style');
    st.textContent = [
        // :where — нулева тежест, за да не бие собствените стилове на страницата (напр. фон с position:absolute)
        ':where([data-slot]){position:relative;overflow:hidden;isolation:isolate}',
        '[data-slot]:not(:has(img)):not(.ms-editing){display:none !important}',
        '[data-slot]>img{display:block;width:100%;height:100%;object-fit:cover;',
        '  object-position:var(--x,50%) var(--y,50%);transform-origin:var(--x,50%) var(--y,50%);scale:var(--z,1)}',
        '[data-slot].ms-multi>img{position:absolute;inset:0;opacity:0;z-index:0;transition:opacity 1.2s ease}',
        '[data-slot].ms-multi>img.ms-on{opacity:1;z-index:2}',
        '[data-slot].ms-multi>img.ms-off{opacity:1;z-index:1}',
        // бавно приближаване (Ken Burns)
        '[data-fx=kenburns].ms-multi>img.ms-on,[data-fx=kenburns].ms-multi>img.ms-off{animation:ms-kb var(--ms-dur,7s) linear forwards}',
        '@keyframes ms-kb{from{scale:var(--z,1)}to{scale:calc(var(--z,1) * 1.12)}}',
        // плъзгане
        '[data-fx=slide].ms-multi>img{opacity:1;transition:translate .9s cubic-bezier(.65,0,.35,1);translate:100% 0}',
        '[data-fx=slide].ms-multi>img.ms-on{translate:0 0}[data-fx=slide].ms-multi>img.ms-off{translate:-100% 0}',
        // брандова завеса: снимката се открива зад цветна линия
        '[data-fx=wipe].ms-multi>img{opacity:1;transition:clip-path 1.1s cubic-bezier(.65,0,.35,1);clip-path:inset(0 100% 0 0)}',
        '[data-fx=wipe].ms-multi>img.ms-on,[data-fx=wipe].ms-multi>img.ms-off{clip-path:inset(0 0 0 0)}',
        '[data-fx=wipe]>.ms-line{position:absolute;top:0;bottom:0;left:0;width:5px;z-index:3;pointer-events:none;opacity:0;',
        '  background:linear-gradient(180deg,#00E0DC,#A0F500);box-shadow:0 0 18px 4px rgba(0,224,220,.55)}',
        '[data-fx=wipe]>.ms-line.go{animation:ms-line 1.1s cubic-bezier(.65,0,.35,1)}',
        '@keyframes ms-line{0%{opacity:1;left:0}90%{opacity:1}100%{opacity:0;left:100%}}',
        // ирис: снимката се отваря от центъра като зеница
        '[data-fx=iris].ms-multi>img{opacity:1;transition:clip-path 1.2s cubic-bezier(.65,0,.35,1);clip-path:circle(0% at 50% 50%)}',
        '[data-fx=iris].ms-multi>img.ms-on,[data-fx=iris].ms-multi>img.ms-off{clip-path:circle(75% at 50% 50%)}',
        // размиване
        '[data-fx=blur].ms-multi>img{transition:opacity 1.2s ease,filter 1.2s ease;filter:blur(18px)}',
        '[data-fx=blur].ms-multi>img.ms-on,[data-fx=blur].ms-multi>img.ms-off{filter:none}',
        // скритите снимки се връщат на изходна позиция без анимация (иначе прелитат през кадъра)
        '[data-fx=slide].ms-multi>img:not(.ms-on):not(.ms-off),[data-fx=wipe].ms-multi>img:not(.ms-on):not(.ms-off),[data-fx=iris].ms-multi>img:not(.ms-on):not(.ms-off){transition:none}',
        // точки
        '[data-slot]>.ms-dots{position:absolute;left:0;right:0;bottom:10px;z-index:4;display:flex;justify-content:center;gap:7px;pointer-events:none}',
        '[data-slot]>.ms-dots i{width:7px;height:7px;border-radius:9px;background:rgba(255,255,255,.55);box-shadow:0 1px 4px rgba(0,0,0,.3);transition:width .4s,background .4s;pointer-events:auto;cursor:pointer}',
        '[data-slot]>.ms-dots i.on{width:20px;background:linear-gradient(90deg,#00E0DC,#A0F500)}',
        // място за банер в страници без снимка (EmoEat, IrisMap)
        '.ms-hero{display:block;margin:0 auto 22px;border-radius:24px;aspect-ratio:16/9;max-width:520px;width:100%;',
        '  box-shadow:0 18px 50px -24px rgba(3,40,48,.45);border:1px solid rgba(255,255,255,.12)}',
        '@media (prefers-reduced-motion: reduce){[data-slot].ms-multi>img{animation:none !important;transition:opacity .6s ease !important;clip-path:none !important;translate:none !important;filter:none !important}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);

    function num(v, d, lo, hi) { v = parseFloat(v); if (isNaN(v)) v = d; return Math.min(hi, Math.max(lo, v)); }

    // Кадърът на една снимка: точка в центъра + приближение.
    function frame(img) {
        var x = num(img.getAttribute('data-x'), 50, 0, 100), y = num(img.getAttribute('data-y'), 50, 0, 100), z = num(img.getAttribute('data-z'), 1, 1, 4);
        img.style.setProperty('--x', x + '%'); img.style.setProperty('--y', y + '%'); img.style.setProperty('--z', z);
    }

    function imgs(slot) { return Array.prototype.filter.call(slot.children, function (n) { return n.tagName === 'IMG'; }); }

    function setup(slot) {
        var s = slot.__ms || (slot.__ms = { i: 0, t: 0, paused: false, seen: true });
        var list = imgs(slot);
        list.forEach(frame);
        var r = slot.getAttribute('data-ratio'); slot.style.aspectRatio = r ? r.replace(':', '/') : '';
        var w = slot.getAttribute('data-width'); slot.style.width = w ? num(w, 100, 20, 100) + '%' : '';
        if (w) { slot.style.marginLeft = slot.style.marginRight = 'auto'; }
        var fx = slot.getAttribute('data-fx'); if (FX.indexOf(fx) < 0) slot.setAttribute('data-fx', fx = 'fade');
        var every = num(slot.getAttribute('data-every'), 6, 2, 30);
        slot.style.setProperty('--ms-dur', (every + 1.5) + 's');
        var multi = list.length > 1;
        slot.classList.toggle('ms-multi', multi);
        // много снимки — мястото не може да вземе височина от снимката, затова пазим пропорцията ѝ
        if (multi && getComputedStyle(slot).aspectRatio === 'auto' && getComputedStyle(slot).position !== 'absolute') {
            var f = list[0]; slot.style.aspectRatio = (f.naturalWidth && f.naturalHeight) ? f.naturalWidth + '/' + f.naturalHeight : '16/9';
        }
        var dots = slot.querySelector(':scope > .ms-dots'), line = slot.querySelector(':scope > .ms-line');
        if (dots) dots.remove(); if (line) line.remove();
        clearTimeout(s.t);
        list.forEach(function (im) { im.classList.remove('ms-on', 'ms-off'); });
        if (!multi) return;
        if (s.i >= list.length) s.i = 0;
        list.forEach(function (im, k) { if (k) { im.loading = 'lazy'; } });
        dots = document.createElement('div'); dots.className = 'ms-dots'; dots.setAttribute('aria-hidden', 'true');
        list.forEach(function (_, k) { var d = document.createElement('i'); d.addEventListener('click', function (e) { e.stopPropagation(); show(slot, k); }); dots.appendChild(d); });
        slot.appendChild(dots);
        if (fx === 'wipe') { line = document.createElement('span'); line.className = 'ms-line'; slot.appendChild(line); }
        show(slot, s.i, true);
    }

    function show(slot, k, first) {
        var s = slot.__ms, list = imgs(slot); if (!s || !list.length) return;
        k = (k + list.length) % list.length;
        var prev = first ? null : list.filter(function (im) { return im.classList.contains('ms-on'); })[0];
        list.forEach(function (im) { im.classList.remove('ms-off'); if (im !== list[k]) im.classList.remove('ms-on'); });
        if (prev && prev !== list[k]) prev.classList.add('ms-off');
        // рестарт на анимацията (Ken Burns), за да тръгва отначало всеки път
        var cur = list[k]; cur.classList.remove('ms-on'); void cur.offsetWidth; cur.classList.add('ms-on');
        if (!first && slot.getAttribute('data-fx') === 'wipe') {
            var line = slot.querySelector(':scope > .ms-line'); if (line) { line.classList.remove('go'); void line.offsetWidth; line.classList.add('go'); }
        }
        s.i = k;
        var dots = slot.querySelectorAll(':scope > .ms-dots i');
        Array.prototype.forEach.call(dots, function (d, j) { d.classList.toggle('on', j === k); });
        // старата снимка остава отдолу, докато новата се покаже напълно
        if (prev && prev !== cur) setTimeout(function () { if (s.i === k) prev.classList.remove('ms-off'); }, 1300);
        schedule(slot);
    }

    function schedule(slot) {
        var s = slot.__ms; clearTimeout(s.t);
        if (s.paused || !s.seen || document.hidden || imgs(slot).length < 2) return;
        s.t = setTimeout(function () { show(slot, s.i + 1); }, num(slot.getAttribute('data-every'), 6, 2, 30) * 1000);
    }

    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
        es.forEach(function (e) { var s = e.target.__ms; if (!s) return; s.seen = e.isIntersecting; schedule(e.target); });
    }) : null;
    document.addEventListener('visibilitychange', function () { document.querySelectorAll('[data-slot]').forEach(function (sl) { if (sl.__ms) schedule(sl); }); });

    function init(root) {
        (root || document).querySelectorAll('[data-slot]').forEach(function (slot) {
            var fresh = !slot.__ms;
            setup(slot);
            if (fresh && io) io.observe(slot);
        });
    }

    window.MediaSlot = {
        init: init,
        refresh: function (slot) { setup(slot); },
        show: show,
        frame: frame,
        pause: function (slot, on) { if (!slot.__ms) setup(slot); slot.__ms.paused = !!on; schedule(slot); },
        index: function (slot) { return slot.__ms ? slot.__ms.i : 0; },
        images: imgs,
        FX: FX
    };
    if (reduce) { /* ефектите се свеждат до плавна смяна чрез CSS */ }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
    else init();
})();
