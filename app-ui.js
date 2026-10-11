/*
 * Общото поведение на табовете в приложението: вибрации при допир, плаващите
 * бутони се прибират при скрол, долните листове се затварят с дърпане, модалът
 * на храненето излиза от натиснатата карта, „дърпане за обновяване“ в плана.
 * Не знае нищо за данните — само за жестовете и обратната връзка.
 */
(function () {
  'use strict';
  if (window.__nutriplanAppUi) return;
  window.__nutriplanAppUi = true;

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isPlanPage = /plan\.html$/.test(location.pathname);
  var embedded = root.getAttribute('data-embedded-tab') === '1' && window.parent && window.parent !== window;

  /* ─── Вибрации ─────────────────────────────────────────────────────── */
  function capacitor() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins) return window.Capacitor;
      if (embedded && window.parent.Capacitor && window.parent.Capacitor.Plugins) return window.parent.Capacitor;
    } catch (_) {}
    return null;
  }
  var lastHaptic = 0;
  function haptic(style) {
    var now = Date.now();
    if (now - lastHaptic < 40) return;
    lastHaptic = now;
    var cap = capacitor();
    try {
      var h = cap && cap.Plugins.Haptics;
      if (h && h.impact) { h.impact({ style: style || 'Light' }); return; }
    } catch (_) {}
    try { if (navigator.vibrate) navigator.vibrate(style === 'Medium' ? 14 : 8); } catch (_) {}
  }
  window.NutriPlanHaptic = haptic;

  var TAP_TARGETS = '.acc-header, .btn, .btn-primary, .btn-secondary, .fab-chat, .fab-food, .modal-close, ' +
    '.meal-card--clickable, [role="button"], button';
  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var check = t.closest('.meal-check-btn');
    if (check) {
      // Резултатът на отметката се вижда след обработката на страницата.
      setTimeout(function () {
        if (!check.classList.contains('done')) return;
        haptic('Medium');
        var card = check.closest('.meal-card');
        if (card && !reduceMotion) {
          card.classList.remove('ui-just-done');
          void card.offsetWidth;
          card.classList.add('ui-just-done');
        }
      }, 0);
      return;
    }
    if (t.closest(TAP_TARGETS)) haptic('Light');
  }, true);

  /* ─── Плаващите бутони се прибират при скрол надолу ───────────────── */
  var lastY = window.scrollY || 0;
  var ticking = false;
  function onScroll() {
    var y = window.scrollY || 0;
    var dy = y - lastY;
    if (Math.abs(dy) > 6) {
      var nearEnd = window.innerHeight + y >= doc.documentElement.scrollHeight - 24;
      // Докато асистентът задава въпрос, аватарът остава видим до балона.
      var bubbleOpen = !!doc.querySelector('.game-bubble:not(.game-bubble--exit)');
      root.classList.toggle('ui-fabs-away', dy > 0 && y > 140 && !nearEnd && !bubbleOpen);
      lastY = y;
    }
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });

  /* ─── Долният лист се затваря с дърпане ───────────────────────────── */
  function closeSheet(overlay) {
    var btn = overlay.querySelector('.modal-close');
    if (btn) btn.click();
    else overlay.classList.remove('active');
  }

  function bindSheet(overlay) {
    var card = overlay.querySelector('.modal-card');
    if (!card || !card.querySelector('.modal-drag-handle') || card.__uiSheet) return;
    card.__uiSheet = true;
    var startY = 0, startX = 0, dy = 0, t0 = 0, active = false, decided = false;
    card.addEventListener('touchstart', function (e) {
      if (!overlay.classList.contains('active') || e.touches.length !== 1) return;
      var fromHandle = e.target.closest('.modal-drag-handle');
      if (!fromHandle && card.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      dy = 0; t0 = Date.now(); active = true; decided = !!fromHandle;
    }, { passive: true });
    card.addEventListener('touchmove', function (e) {
      if (!active) return;
      var y = e.touches[0].clientY - startY;
      var x = e.touches[0].clientX - startX;
      if (!decided) {
        if (Math.abs(y) < 8 && Math.abs(x) < 8) return;
        decided = true;
        // Само дърпане надолу от върха; иначе е скрол на съдържанието.
        if (y <= 0 || Math.abs(x) > Math.abs(y) || card.scrollTop > 0) { active = false; return; }
      }
      dy = Math.max(0, y);
      card.classList.add('ui-dragging');
      card.style.transform = 'translateY(' + dy + 'px)';
      overlay.style.backgroundColor = 'rgba(0,0,0,' + Math.max(0, 0.35 - dy / 900) + ')';
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    card.addEventListener('touchend', function () {
      if (!active) return;
      active = false;
      card.classList.remove('ui-dragging');
      var velocity = dy / Math.max(1, Date.now() - t0);
      overlay.classList.add('ui-drag-release');
      overlay.style.backgroundColor = '';
      if (dy > 110 || velocity > 0.6) {
        haptic('Light');
        card.style.transform = '';
        closeSheet(overlay);
      } else {
        card.style.transform = '';
      }
      setTimeout(function () { overlay.classList.remove('ui-drag-release'); }, 400);
    });
  }

  /* ─── Модалът на храненето излиза от натиснатата карта ────────────── */
  var lastCardRect = null;
  doc.addEventListener('click', function (e) {
    var card = e.target && e.target.closest && e.target.closest('.meal-card--clickable');
    if (!card || e.target.closest('.meal-check-btn, .meal-describe-btn')) { lastCardRect = null; return; }
    lastCardRect = card.getBoundingClientRect();
  }, true);

  function animateFromCard(overlay) {
    var card = overlay.querySelector('.modal-card');
    var rect = lastCardRect;
    lastCardRect = null;
    if (!card || !rect || reduceMotion) return;
    var sheetTop = window.innerHeight - Math.min(card.offsetHeight || window.innerHeight * 0.7, window.innerHeight * 0.92);
    var fromY = Math.round(rect.top - sheetTop);
    card.style.transition = 'none';
    card.style.transform = 'translateY(' + fromY + 'px) scale(0.94)';
    card.style.opacity = '0.4';
    void card.offsetWidth;
    card.style.transition = 'transform 0.5s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease';
    card.style.transform = '';
    card.style.opacity = '';
    setTimeout(function () { card.style.transition = ''; }, 520);
  }

  function watchOverlays() {
    var overlays = doc.querySelectorAll('.modal-overlay');
    overlays.forEach(function (overlay) {
      bindSheet(overlay);
      if (overlay.__uiWatched) return;
      overlay.__uiWatched = true;
      var wasActive = overlay.classList.contains('active');
      new MutationObserver(function () {
        var isActive = overlay.classList.contains('active');
        if (isActive === wasActive) return;
        wasActive = isActive;
        notifyShell(isActive ? 'open' : 'close');
        if (isActive) animateFromCard(overlay);
      }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    });
  }

  /* Отворен лист → обвивката затъмнява системната навигационна лента. */
  function notifyShell(state) {
    if (!embedded) return;
    try { window.parent.postMessage({ type: 'NUTRIPLAN_SHEET_STATE', state: state }, location.origin); } catch (_) {}
  }

  /* ─── Дърпане за обновяване (план) ─────────────────────────────────── */
  function toast(text) {
    var el = doc.createElement('div');
    el.className = 'ui-toast';
    el.textContent = text;
    doc.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-shown'); });
    setTimeout(function () {
      el.classList.remove('is-shown');
      setTimeout(function () { el.remove(); }, 400);
    }, 2200);
  }
  window.NutriPlanToast = toast;

  function bindPullToRefresh() {
    var ind = doc.createElement('div');
    ind.className = 'ui-ptr';
    ind.setAttribute('aria-hidden', 'true');
    ind.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/></svg>';
    doc.body.appendChild(ind);
    var startY = 0, startX = 0, pull = 0, tracking = false, loading = false;
    var THRESHOLD = 72;

    function anyModalOpen() { return !!doc.querySelector('.modal-overlay.active'); }
    function setPull(p) {
      var d = Math.min(p, 110);
      ind.style.transition = 'none';
      ind.style.opacity = String(Math.min(1, d / THRESHOLD));
      ind.style.transform = 'translateY(' + (d * 0.7 - 30) + 'px) rotate(' + (d * 3) + 'deg)';
    }
    function reset() {
      ind.style.transition = 'transform 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease';
      ind.style.transform = 'translateY(-48px)';
      ind.style.opacity = '0';
      ind.classList.remove('is-loading');
    }

    doc.addEventListener('touchstart', function (e) {
      if (loading || window.scrollY > 0 || e.touches.length !== 1 || anyModalOpen()) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pull = 0;
      tracking = true;
    }, { passive: true });
    doc.addEventListener('touchmove', function (e) {
      if (!tracking) return;
      var dy = e.touches[0].clientY - startY;
      var dx = e.touches[0].clientX - startX;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) { if (pull === 0) tracking = false; return; }
      var crossed = pull < THRESHOLD && dy * 0.6 >= THRESHOLD;
      pull = dy * 0.6;
      if (crossed) haptic('Light');
      setPull(pull);
    }, { passive: true });
    doc.addEventListener('touchend', function () {
      if (!tracking) return;
      tracking = false;
      if (pull < THRESHOLD) { reset(); return; }
      loading = true;
      ind.style.transition = 'transform 0.3s cubic-bezier(0.16,1,0.3,1)';
      ind.style.transform = 'translateY(' + (18 + (parseInt(getComputedStyle(root).getPropertyValue('--safe-area-inset-top'), 10) || 0)) + 'px)';
      ind.style.opacity = '1';
      ind.classList.add('is-loading');
      var done = false;
      var finish = function (status) {
        if (done) return;
        done = true;
        loading = false;
        reset();
        if (status === 'updated') toast('Има нова версия на плана');
        else if (status === 'error') toast('Няма връзка — опитай пак');
        else toast('Планът е актуален');
      };
      window.addEventListener('NUTRIPLAN_PULL_REFRESH_DONE', function onDone(ev) {
        window.removeEventListener('NUTRIPLAN_PULL_REFRESH_DONE', onDone);
        finish(ev && ev.detail && ev.detail.status);
      });
      setTimeout(function () { finish('error'); }, 9000);
      if (embedded) {
        try { window.parent.postMessage({ type: 'NUTRIPLAN_PULL_REFRESH' }, location.origin); } catch (_) { finish('error'); }
      } else {
        location.reload();
      }
    });
  }

  function init() {
    watchOverlays();
    // Модалите, добавени по-късно (динамични листове), също получават жестовете.
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].addedNodes && list[i].addedNodes.length) { watchOverlays(); break; }
      }
    }).observe(doc.body, { childList: true });
    if (isPlanPage) bindPullToRefresh();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
