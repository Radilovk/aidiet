/**
 * Теглото: запис сутрин, на гладно (localStorage np_weight_log) — попълва седмичния преглед и чата.
 * Полето е в „Напредък“ (game-analytics.html, #weightChip); на другите страници (plan.html) остава
 * само window.NPWeight. Без тегло нито едно правило за калориите не може да работи.
 */
(function() {
    var KEY = 'np_weight_log';
    var DAY = 86400000;
    function load() { try { var l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (_) { return []; } }
    function fmt(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }
    function startKg() { try { return parseFloat(String(JSON.parse(localStorage.getItem('userData') || '{}').weight || '').replace(',', '.')) || null; } catch (_) { return null; } }
    function render(editing) {
        var el = document.getElementById('weightChip');
        if (!el) return;
        // Само когато целта е в килограмите (сваляне или покачване) — при стягане,
        // здраве и поддържане теглото не е мярката и редът би бил излишен.
        var dir = '';
        try { dir = ((JSON.parse(localStorage.getItem('dietPlan') || '{}') || {}).analysis || {})._goalDirection || ''; } catch (_) {}
        if (dir !== 'lose' && dir !== 'gain') { el.hidden = true; return; }
        var log = load();
        var last = log[log.length - 1];
        var days = last ? Math.floor((Date.now() - last.at) / DAY) : null;
        var due = !last || days >= 7;
        el.hidden = false;
        el.classList.toggle('is-due', due);
        if (editing) {
            el.innerHTML = '<i class="fas fa-weight-scale" aria-hidden="true"></i><label class="wc-text" for="wcInput">Тегло сутрин, на гладно (кг)</label>' +
                '<input id="wcInput" type="text" inputmode="decimal" autocomplete="off" placeholder="' + (last ? fmt(last.kg) : 'напр. 82,4') + '">' +
                '<button type="button" class="meal-swap-btn" id="wcSave">Запиши</button>';
            var inp = document.getElementById('wcInput');
            var save = function() {
                var v = parseFloat(String(inp.value).replace(',', '.'));
                if (!(v >= 30 && v <= 300)) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
                var l = load().filter(function(x) { return Date.now() - x.at > 12 * 3600000; }); // едно число на ден
                l.push({ at: Date.now(), kg: Math.round(v * 10) / 10 });
                localStorage.setItem(KEY, JSON.stringify(l.slice(-60)));
                render(false);
            };
            document.getElementById('wcSave').addEventListener('click', save);
            inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') save(); });
            inp.focus();
            return;
        }
        var start = startKg();
        var delta = last && start ? Math.round((last.kg - start) * 10) / 10 : null;
        var main = last
            ? 'Тегло: <b>' + fmt(last.kg) + ' кг</b>' + (delta ? ' · ' + (delta > 0 ? '+' : '−') + fmt(Math.abs(delta)) + ' кг от началото' : '')
            : '<b>Запиши теглото си</b>';
        var sub = !last ? 'По него планът се настройва към резултата ти.'
            : due ? 'Последно преди ' + days + ' дни — време е за ново претегляне.'
            : days === 0 ? 'Записано днес.' : 'Записано преди ' + days + (days === 1 ? ' ден.' : ' дни.');
        el.innerHTML = '<i class="fas fa-weight-scale" aria-hidden="true"></i><span class="wc-text">' + main + '<small>' + sub + '</small></span>' +
            '<button type="button" class="meal-swap-btn" id="wcEdit">' + (last ? 'Ново' : 'Запиши') + '</button>';
        document.getElementById('wcEdit').addEventListener('click', function() { render(true); });
    }
    window.NPWeight = {
        /** Последното тегло, ако е от последните 3 дни (за седмичния преглед). */
        recent: function() { var l = load(); var x = l[l.length - 1]; return x && Date.now() - x.at <= 3 * DAY ? x.kg : null; },
        /** Последните записи за чата: [{ date, kg }]. */
        log: function() { return load().slice(-6).map(function(x) { return { date: new Date(x.at).toISOString().slice(0, 10), kg: x.kg }; }); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { render(false); });
    else render(false);
})();
