/**
 * Нивата на NutriPlan: цени, какво включва всяко, кои функции отключва и колко
 * пъти на месец. Един източник за страницата с цените (pricing.html),
 * заключването в приложението (access.js) и проверката на сървъра (access-control.js).
 *
 * Правило: безплатното ниво не харчи пари. Всичко, което вика AI или изисква
 * проверка от екипа, е платено и с месечен таван, сметнат по цената на заявката:
 *   въпрос към асистента ~$0,010 · снимка на чиния ~$0,012 · снимка на меню ~$0,013
 *   документ/изследване ~$0,04 · нов план ~$0,10 · седмично обновяване ~$0,06
 *   (оценки при Gemini Flash $1,50/$7,50 и Flash-Lite $0,30/$2,50 за 1M токена).
 * Таваните държат най-лошия случай под нетния приход и при годишно плащане.
 *
 * Цените са за България (с ДДС), в евро. Смяна на цена, функция или таван — само тук.
 * checkoutUrl е празен, докато не е свързан Stripe: бутоните казват „Скоро“.
 */
(function (global) {
    'use strict';

    var TIERS = ['start', 'core', 'plus'];

    // Най-ниското ниво, което отключва функцията.
    var FEATURE_MIN_TIER = {
        full_week: 'core',   // цялото седмично меню (в Start — първият ден, без AI)
        ai_plan: 'core',     // AI текстовете и прегледът на менюто в нов план
        replan: 'core',      // нов план след промяна в профила
        chat: 'core',        // асистентът
        photo: 'core',       // снимка на чинията
        menu_photo: 'core',  // снимка на меню в ресторант
        docs: 'core',        // изследвания, документи, екранни снимки от устройства
        weekly: 'core',      // седмичното обновяване на менюто
        plan_book: 'core',   // книгата на плана (PDF)
        emoeat_ai: 'core'    // личният текст в теста за емоционално хранене
    };

    // Месечни тавани (календарен месец). Липсва ли — без таван в нивото.
    var QUOTAS = {
        core: { chat: 50, photo: 20, menu_photo: 5, docs: 2, replan: 1 },
        plus: { chat: 200, photo: 90, menu_photo: 30, docs: 10, replan: 3 }
    };

    var FEATURE_LABEL = {
        full_week: 'Цялото седмично меню',
        ai_plan: 'Пълният план',
        replan: 'Нов план след промяна',
        chat: 'Асистентът',
        photo: 'Снимка на чинията',
        menu_photo: 'Снимка на менюто',
        docs: 'Изследвания и документи',
        weekly: 'Седмичното обновяване',
        plan_book: 'Книгата на плана',
        emoeat_ai: 'Личният анализ'
    };

    // Как се брои за таван — „50 въпроса“, „20 снимки“.
    var QUOTA_UNIT = {
        chat: ['въпрос', 'въпроса'],
        photo: ['снимка', 'снимки'],
        menu_photo: ['снимка', 'снимки'],
        docs: ['документ', 'документа'],
        replan: ['нов план', 'нови плана']
    };

    var PLANS = [
        {
            id: 'start',
            name: 'Start',
            tagline: 'Виж какво ще получиш',
            prices: { month: 0 },
            features: [
                'Въпросник и дневни цели: калории, белтък, вода',
                'Един примерен ден от менюто',
                'Тест за емоционално хранене с резултат',
                'Крачкомер в приложението'
            ]
        },
        {
            id: 'core',
            name: 'Core',
            tagline: 'Целият план, всяка седмица',
            prices: { month: 8.99, year: 39.99 },
            trialDays: 7,          // само за годишния
            highlight: true,
            features: [
                'Седмично меню в грамове, проверено от екипа',
                'Обновяване на менюто всяка седмица',
                'Смяна на ястие с едно докосване',
                'Асистент — 50 въпроса на месец',
                'Снимка на чинията — 20 на месец',
                'Снимка на меню в ресторант — 5 на месец',
                'Изследвания и документи — 2 на месец',
                'Нов план след промяна в профила — 1 на месец',
                'Health Connect и книга на плана (PDF)',
                'Личен анализ в теста за емоционално хранене'
            ]
        },
        {
            id: 'plus',
            name: 'Plus',
            tagline: 'За всеки ден и всяко хранене',
            prices: { month: 14.99, year: 79.99 },
            features: [
                'Всичко от Core',
                'Асистент — 200 въпроса на месец',
                'Снимка на чинията — 90 на месец',
                'Снимка на меню в ресторант — 30 на месец',
                'Изследвания и документи — 10 на месец',
                'Нов план след промяна — 3 на месец'
            ]
        }
    ];

    function plural(n, unit) {
        return n === 1 ? unit[0] : unit[1];
    }

    var api = {
        currency: 'EUR',
        checkoutUrl: '',
        TIERS: TIERS,
        FEATURE_MIN_TIER: FEATURE_MIN_TIER,
        FEATURE_LABEL: FEATURE_LABEL,
        QUOTAS: QUOTAS,
        PLANS: PLANS,
        tierRank: function (tier) { return TIERS.indexOf(tier); },
        isTier: function (tier) { return TIERS.indexOf(tier) !== -1; },
        /** Дали нивото отключва функцията. Непозната функция е отворена. */
        allows: function (tier, feature) {
            var need = FEATURE_MIN_TIER[feature];
            if (!need) return true;
            return TIERS.indexOf(tier) >= TIERS.indexOf(need);
        },
        /** Месечният таван на функцията в нивото или null (без таван). */
        quota: function (tier, feature) {
            var q = QUOTAS[tier];
            return q && typeof q[feature] === 'number' ? q[feature] : null;
        },
        /** „50 въпроса“ */
        quotaText: function (n, feature) {
            var unit = QUOTA_UNIT[feature];
            return unit ? n + ' ' + plural(n, unit) : String(n);
        },
        /** Следващото ниво с по-висок таван за функцията (или null). */
        upgradeFor: function (tier, feature) {
            var cur = api.quota(tier, feature);
            for (var i = TIERS.indexOf(tier) + 1; i < TIERS.length; i++) {
                var q = api.quota(TIERS[i], feature);
                if (q === null || cur === null || q > cur) return TIERS[i];
            }
            return null;
        },
        plan: function (id) {
            for (var i = 0; i < PLANS.length; i++) if (PLANS[i].id === id) return PLANS[i];
            return null;
        },
        formatPrice: function (value) {
            if (!value) return '0 €';
            var fixed = Math.round(value) === value ? String(value) : value.toFixed(2).replace('.', ',');
            return fixed + ' €';
        }
    };

    global.NutriPlanPricing = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
