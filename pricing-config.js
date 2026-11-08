/**
 * Нивата на NutriPlan: цени, какво включва всяко и кои функции отключва.
 * Един източник за страницата с цените (pricing.html), заключването в
 * приложението (access.js) и проверката на сървъра (access-control.js).
 *
 * Цените са за България и Източна Европа (ниво 3 от пазарния план), в евро.
 * Смяна на цена или на това какво влиза в ниво става само тук.
 *
 * checkoutUrl е празен, докато не е свързан Stripe: тогава бутоните казват
 * „Скоро“. Когато има адрес на плащането, бутонът води към него с ?tier=…&period=….
 */
(function (global) {
    'use strict';

    var TIERS = ['start', 'core', 'personal', 'signature'];

    // Най-ниското ниво, което отключва функцията.
    var FEATURE_MIN_TIER = {
        full_week: 'core',   // цялото седмично меню (в Start — само първият ден)
        chat: 'core',        // асистентът
        photo: 'core',       // снимка на чинията и на менюто в ресторант
        weekly: 'core',      // седмичният преглед и корекцията
        plan_book: 'core',   // книгата на плана (PDF)
        specialist: 'personal'
    };

    var FEATURE_LABEL = {
        full_week: 'Цялото седмично меню',
        chat: 'Асистентът',
        photo: 'Снимка на чинията и на менюто',
        weekly: 'Седмичният преглед',
        plan_book: 'Книгата на плана',
        specialist: 'Личният специалист'
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
                'Тест за емоционално хранене'
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
                'Седмично меню в грамове',
                'Корекция на менюто всяка седмица',
                'Смяна на ястие с едно докосване',
                'Снимка на чинията и избор от менюто в ресторант',
                'Асистент, който познава плана ти',
                'Крачкомер и Health Connect',
                'Книга на плана (PDF)',
                'Проверка от специалист при старта'
            ]
        },
        {
            id: 'personal',
            name: 'Personal',
            tagline: 'Твоят специалист',
            prices: { month: 45, program: 125 },
            programWeeks: 12,
            features: [
                'Всичко от Core',
                'Начален разговор със специалист — 30 мин.',
                'Преглед на плана на всеки 2 седмици',
                'Писмени отговори до 48 часа',
                'Специалистът разглежда стойностите от изследванията ти',
                'Добавки, подбрани от специалиста',
                'Отчет на всеки 4 седмици'
            ]
        },
        {
            id: 'signature',
            name: 'Signature',
            tagline: 'Екип до теб, ограничени места',
            prices: { month: 199 },
            limited: true,
            features: [
                'Всичко от Personal',
                'Екип: специалист и треньор',
                'Преглед всяка седмица',
                'Видеоразговор 30 мин. всеки месец',
                'Отговори до 24 часа'
            ]
        }
    ];

    var api = {
        currency: 'EUR',
        checkoutUrl: '',
        TIERS: TIERS,
        FEATURE_MIN_TIER: FEATURE_MIN_TIER,
        FEATURE_LABEL: FEATURE_LABEL,
        PLANS: PLANS,
        tierRank: function (tier) { return TIERS.indexOf(tier); },
        isTier: function (tier) { return TIERS.indexOf(tier) !== -1; },
        /** Дали нивото отключва функцията. Непозната функция е отворена. */
        allows: function (tier, feature) {
            var need = FEATURE_MIN_TIER[feature];
            if (!need) return true;
            return TIERS.indexOf(tier) >= TIERS.indexOf(need);
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
