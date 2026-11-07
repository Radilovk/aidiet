/**
 * Партньорски код (B2B): студио, диетолог или треньор води клиента с линк или QR
 * `?ref=<код>`. Пази се първият код за 90 дни на устройството; въпросникът го праща
 * към сървъра заедно с отговорите, а админ панелът показва и филтрира по него.
 *
 *   <script src="./partner-ref.js"></script>
 *   NutriPlanPartnerRef.get()  // '' или кода
 */
(function (global) {
    'use strict';
    var KEY = 'np_ref';
    var TTL_MS = 90 * 24 * 60 * 60 * 1000;

    function clean(value) {
        var code = String(value || '').trim().toLowerCase();
        return /^[a-z0-9][a-z0-9-]{1,31}$/.test(code) ? code : '';
    }

    function read() {
        try {
            var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (!saved || !clean(saved.code)) return null;
            if (Date.now() - Number(saved.at || 0) > TTL_MS) {
                localStorage.removeItem(KEY);
                return null;
            }
            return saved;
        } catch (_) {
            return null;
        }
    }

    // Първият код печели: партньорът, който е довел клиента, не се сменя от по-късен линк.
    try {
        var fromUrl = clean(new URLSearchParams(global.location.search).get('ref'));
        if (fromUrl && !read()) {
            localStorage.setItem(KEY, JSON.stringify({ code: fromUrl, at: Date.now() }));
        }
    } catch (_) { /* без localStorage — без атрибуция */ }

    global.NutriPlanPartnerRef = {
        get: function () {
            var saved = read();
            return saved ? saved.code : '';
        },
        clean: clean
    };
})(window);
