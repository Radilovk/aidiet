/**
 * Партньорски код (B2B): студио, диетолог или треньор води клиента с линк или QR
 * `?ref=<код>`. Пази се първият код за 90 дни на устройството; въпросникът го праща
 * към сървъра заедно с отговорите, а админ панелът показва и филтрира по него.
 *
 *   <script src="./partner-ref.js"></script>
 *   NutriPlanPartnerRef.get()     // '' или кода
 *   NutriPlanPartnerRef.invite()  // '' или кода за покана от приятел (?invite=)
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

    // Ваучер от IrisMap (?voucher=…): платеното за анализа се приспада от първия план (pricing.html).
    try {
        var voucher = new URLSearchParams(global.location.search).get('voucher');
        if (/^[a-z0-9]{10,32}$/.test(String(voucher || ''))) localStorage.setItem('np_iris_voucher', voucher);
    } catch (_) { /* частен режим */ }

    // Покана от приятел (?invite=…): −15% за първия план (rewards.js); пази се 60 дни.
    try {
        // Личният код за покана: дума и число на латиница (DUO482); „duo 482“ също става.
        var invite = String(new URLSearchParams(global.location.search).get('invite') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (/^[A-Z]{2,5}\d{3,4}$/.test(invite)) localStorage.setItem('np_invite', JSON.stringify({ code: invite, at: Date.now() }));
    } catch (_) { /* частен режим */ }

    global.NutriPlanPartnerRef = {
        invite: function () {
            try {
                var v = JSON.parse(localStorage.getItem('np_invite') || 'null');
                return v && Date.now() - Number(v.at || 0) < 60 * 24 * 60 * 60 * 1000 ? v.code : '';
            } catch (_) { return ''; }
        },
        get: function () {
            var saved = read();
            return saved ? saved.code : '';
        },
        clean: clean
    };
})(window);
