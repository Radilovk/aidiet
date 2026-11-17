/**
 * Цените на Eatologix, IrisMap и EmoEat — един източник за страницата с цените (pricing.html),
 * заключването в приложението (access.js), проверката на сървъра (access-control.js) и
 * плащането през Stripe (billing.js). Политиката: docs/FINANCIAL_STRATEGY.md.
 *
 * Модел: БЕЗ абонаменти. Плаща се на ПЛАН (Eatologix — за 4 или 12 седмици, после продължение) и на
 * ДОКЛАД (IrisMap — протоколът за един анализ). EmoEat — еднократно за личния анализ.
 * Безплатното не харчи пари за AI. Всичко платено е с лимити за срока на плана и с дневен таван.
 *
 * Разход на заявка (оценки, Gemini Flash): въпрос ~$0,01–0,02 · снимка ~$0,01 · меню ~$0,01–0,02 ·
 * документ ~$0,02–0,04 · нов план ~$0,10–0,19 · седмична корекция ~$0,05–0,10.
 * Цените са в евро, с ДДС (България). Смяна на цена, функция или лимит — само тук.
 */
(function (global) {
    'use strict';

    // Нивото на акаунта: start (безплатно) или core (има платен план със срок).
    var TIERS = ['start', 'core'];

    // Какво отключва платеният план.
    var FEATURE_MIN_TIER = {
        full_week: 'core',   // цялото седмично меню (в Start — първият ден, без AI)
        ai_plan: 'core',     // AI текстовете и прегледът на менюто в нов план
        replan: 'core',      // нов план след промяна в профила
        chat: 'core',        // асистентът
        photo: 'core',       // снимка на чинията
        menu_photo: 'core',  // снимка на меню в ресторант
        docs: 'core',        // изследвания, документи, екранни снимки от устройства
        weekly: 'core',      // седмичната корекция на менюто
        plan_book: 'core',   // книгата на плана (PDF)
        emoeat_ai: 'core'    // личният анализ на EmoEat (иначе — еднократно 2,99 €)
    };

    // Лимити за 4 седмици план (12 седмици — ×3; продължение — ×1, добавя се към остатъка).
    var PLAN_QUOTA = { chat: 60, photo: 30, menu_photo: 6, docs: 2, replan: 1 };
    // Дневен таван — за равномерна употреба (и при платен план).
    var DAILY_CAP = { chat: 20, photo: 10, menu_photo: 4, docs: 3 };

    var FEATURE_LABEL = {
        full_week: 'Цялото седмично меню',
        ai_plan: 'Пълният план',
        replan: 'Нов план след промяна',
        chat: 'Асистентът',
        photo: 'Снимка на чинията',
        menu_photo: 'Снимка на менюто',
        docs: 'Изследвания и документи',
        weekly: 'Седмичната корекция',
        plan_book: 'Книгата на плана',
        emoeat_ai: 'Личният анализ'
    };

    var QUOTA_UNIT = {
        chat: ['въпрос', 'въпроса'],
        photo: ['снимка', 'снимки'],
        menu_photo: ['снимка', 'снимки'],
        docs: ['документ', 'документа'],
        replan: ['нов план', 'нови плана']
    };

    // Еднократни покупки. kind: plan (Eatologix), iris (IrisMap), emoeat (EmoEat).
    var PRODUCTS = {
        plan_4w: {
            kind: 'plan', name: 'План за 4 седмици', price: 14.99, days: 28, scale: 1, highlight: true,
            tagline: 'Целият план, проверен от екипа',
            features: [
                'Седмично меню в грамове, проверено от екипа',
                '4 седмични корекции според напредъка',
                'Смяна на ястие с едно докосване',
                'Асистент — 60 въпроса',
                'Снимка на чинията — 30 · снимка на меню — 6',
                'Изследвания и документи — 2',
                'Нов план при промяна в профила — 1',
                'Книга на плана (PDF) и личният анализ на EmoEat'
            ]
        },
        plan_12w: {
            kind: 'plan', name: 'План за 12 седмици', price: 34.99, days: 84, scale: 3,
            tagline: 'Три месеца — около 11,66 € на 4 седмици',
            features: [
                'Всичко от плана за 4 седмици — за 12 седмици',
                'Асистент — 180 въпроса',
                'Снимка на чинията — 90 · снимка на меню — 18',
                'Изследвания и документи — 6',
                'Нов план при промяна — 3'
            ]
        },
        plan_continue: {
            kind: 'plan', name: 'Продължение 4 седмици', price: 11.99, days: 28, scale: 1, requiresPlan: true,
            tagline: 'За който вече има план — без нов въпросник',
            features: ['Още 4 седмици с корекции', 'Лимитите се добавят към остатъка']
        },
        iris_protocol: {
            kind: 'iris', name: 'IrisMap — личен протокол', price: 9.99,
            description: 'Препоръките от ирисовия анализ: хранене, добавки и режим. Снимките и анализът са безплатни.'
        },
        iris_recheck: {
            kind: 'iris', name: 'IrisMap — контролно разчитане', price: 6.99,
            description: 'Протоколът за следващ анализ — за който вече е взел протокол.'
        },
        emoeat_analysis: {
            kind: 'emoeat', name: 'EmoEat — личен анализ', price: 2.99,
            description: 'Личният анализ и планът за седмицата. Включен в плана на Eatologix.'
        }
    };

    // За показване на страницата с цените: безплатното и плановете.
    var FREE = {
        id: 'start', name: 'Безплатно', tagline: 'Виж какво ще получиш',
        features: [
            'Въпросник и дневни цели: калории, белтък, вода',
            'Един примерен ден от менюто',
            'Тест за емоционално хранене с резултат',
            'Снимки и анализ на ирисите в IrisMap'
        ]
    };

    function plural(n, unit) {
        return n === 1 ? unit[0] : unit[1];
    }

    var api = {
        currency: 'EUR',
        TIERS: TIERS,
        FEATURE_MIN_TIER: FEATURE_MIN_TIER,
        FEATURE_LABEL: FEATURE_LABEL,
        PLAN_QUOTA: PLAN_QUOTA,
        DAILY_CAP: DAILY_CAP,
        PRODUCTS: PRODUCTS,
        FREE: FREE,
        tierRank: function (tier) { return TIERS.indexOf(tier); },
        isTier: function (tier) { return TIERS.indexOf(tier) !== -1; },
        /** Дали нивото отключва функцията. Непозната функция е отворена. */
        allows: function (tier, feature) {
            var need = FEATURE_MIN_TIER[feature];
            if (!need) return true;
            return TIERS.indexOf(tier) >= TIERS.indexOf(need);
        },
        /** Лимитът по подразбиране за 4 седмици (записът на плана носи точния). */
        quota: function (tier, feature) {
            return tier === 'core' && typeof PLAN_QUOTA[feature] === 'number' ? PLAN_QUOTA[feature] : null;
        },
        /** Лимитите на покупка: { chat: 60, … } × мащаба на продукта. */
        planQuota: function (productId) {
            var p = PRODUCTS[productId], out = {};
            if (!p || p.kind !== 'plan') return out;
            for (var k in PLAN_QUOTA) out[k] = PLAN_QUOTA[k] * (p.scale || 1);
            return out;
        },
        dailyCap: function (feature) {
            return typeof DAILY_CAP[feature] === 'number' ? DAILY_CAP[feature] : null;
        },
        product: function (id) { return PRODUCTS[id] || null; },
        quotaText: function (n, feature) {
            var unit = QUOTA_UNIT[feature];
            return unit ? n + ' ' + plural(n, unit) : String(n);
        },
        formatPrice: function (value) {
            if (!value) return '0 €';
            var fixed = Math.round(value) === value ? String(value) : value.toFixed(2).replace('.', ',');
            return fixed + ' €';
        }
    };

    /** @type {any} */ (global).NutriPlanPricing = api;
    /** @type {any} */ (global).EatologixPricing = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
