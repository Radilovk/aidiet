/**
 * EmoEat v3 — непряк тест за емоционалното хранене.
 *
 * Тестът не пита за храна. Пита как минават обикновените дни, а склонността храната да поема
 * чувствата се извежда от черти с доказана връзка с емоционалното хранене. Основата и
 * източниците са в EMOEAT_PSYCH_REVIEW.md, въпросите — в EMOEAT_V3_QUESTIONS.md, нагласянето
 * по човека — в EMOEAT_V3_CALIBRATION.md.
 *
 * Правила на банката:
 *  - всеки вариант на сцена пази ключовете и тежестите на отговорите — сменя се само повърхността;
 *  - в текстовете няма думи за храна, тяло, тегло и вина (проверява го scripts/test-emoeat-v3.mjs);
 *  - id-тата са числа (сървърът приема само такива ключове в answers).
 *
 * Работи в браузъра (window.EmoEatV3) и в Node (module.exports) за тестовете.
 */
(function (root) {
    'use strict';

    var SCHEMA = '3';

    // ── Чертите ───────────────────────────────────────────────────────────────
    // w — тежест в общата склонност (по размера на ефекта в изследванията);
    // portrait — как се описва на човека; bridge — мостът към храната (предположение, не присъда).
    var TRAITS = {
        URG: { name: 'Бързата реакция', icon: 'fa-bolt', w: 3,
            portrait: 'Когато нещо те разклати, искаш да направиш нещо веднага. Най-трудно ти е просто да изчакаш.',
            bridge: 'При такъв портрет храната често е най-близкото действие. Бърза е и винаги е под ръка.' },
        CLR: { name: 'Чувството без име', icon: 'fa-cloud', w: 2,
            portrait: 'Често усещаш, че ти е тежко, но не можеш да кажеш какво точно е.',
            bridge: 'Когато чувството няма име, лесно се усеща като глад.' },
        AVO: { name: 'Избутването', icon: 'fa-door-closed', w: 2,
            portrait: 'Неприятната мисъл предпочиташ да я избуташ с нещо друго, вместо да я погледнеш.',
            bridge: 'Храната е едно от най-лесните неща, с които една мисъл се избутва поне за малко.' },
        RUM: { name: 'Мислите, които се въртят', icon: 'fa-rotate', w: 1,
            portrait: 'Мислите се връщат и се въртят, особено вечер.',
            bridge: 'Когато главата не спира, ръката търси нещо, което да я прекъсне.' },
        DIC: { name: 'Всичко или нищо', icon: 'fa-toggle-on', w: 2,
            portrait: 'Когато се обърка нещо малко, лесно ти се струва, че всичко е отишло.',
            bridge: 'Така става и с храната: едно отклонение лесно се превръща в „денят е развален“.' },
        RIG: { name: 'Нуждата от ред', icon: 'fa-ruler-combined', w: 1.5,
            portrait: 'Спокойно ти е, когато нещата са по план, и те изнервя, когато не са.',
            bridge: 'Правилата около храната дават същото спокойствие, докато не се скъсат.' },
        CRIT: { name: 'Строгият глас', icon: 'fa-comment-dots', w: 2,
            portrait: 'Към себе си говориш по-строго, отколкото към другите.',
            bridge: 'След такъв вътрешен глас храната лесно става и утеха, и нов повод за упрек.' },
        ATT: { name: 'Тревогата за близките', icon: 'fa-heart-crack', w: 1,
            portrait: 'Когато някой важен за теб замълчи, започваш да се питаш какво не е наред.',
            bridge: 'В часовете, в които хората ги няма, храната дава топлина.' },
        LONE: { name: 'Празната вечер', icon: 'fa-moon', w: 1.5,
            portrait: 'Тихите вечери лесно стават празни.',
            bridge: 'Вечер храната е най-близката компания.' },
        BOR: { name: 'Нуждата от искра', icon: 'fa-fire', w: 1,
            portrait: 'Еднообразието те изморява повече от работата.',
            bridge: 'В скучен следобед храната е най-бързата искра.' },
        REW: { name: 'Бързата награда', icon: 'fa-gift', w: 1.5,
            portrait: 'Хубавото го искаш сега, не после.',
            bridge: 'Храната е наградата, която винаги е наблизо.' },
        BODY: { name: 'Тихите сигнали', icon: 'fa-wave-square', w: 1.5,
            portrait: 'Умората и напрежението ги усещаш късно, когато вече са големи.',
            bridge: 'Когато сигналите идват късно, и гладът, и ситостта се усещат късно.' },
        SOOTHE: { name: 'Утехата отвън', icon: 'fa-hand-holding-heart', w: 1.5,
            portrait: 'В детството утехата често е идвала отвън, с нещо, което да те разсее.',
            bridge: 'Утехата отвън се научава рано, а храната е най-лесната утеха отвън. Затова действа бързо. И затова може да се научи и друго.' },
        LOAD: { name: 'Изтощението', icon: 'fa-battery-quarter', w: 1.5,
            portrait: 'Дните ти са дълги, а почивката и сънят не стигат.',
            bridge: 'Изтощеното тяло иска бърза енергия, най-често сладко.' }
    };
    var TRAIT_IDS = Object.keys(TRAITS);

    var LOW = 35;    // от тук нататък чертата е „осезаема“
    var HIGH = 60;   // „силна“
    // Прагове за общата склонност — калибрирани в scripts/test-emoeat-v3.mjs.
    var RISK_LOW = 35;
    var RISK_HIGH = 48;
    var SHRINK = 0.5;

    // ── Помощни ──────────────────────────────────────────────────────────────
    // ctx.neutral — текстът е за превод: неутралната форма, но полът остава за въпросите и тълкуването.
    function g(ctx, m, f, n) {
        if (ctx && ctx.neutral) return n != null ? n : m;
        var s = ctx && ctx.sex;
        if (s === 'f') return f;
        if (s === 'm') return m;
        return n != null ? n : m;
    }
    function isTeen(ctx) { return !!(ctx && ctx.teen); }
    function O(key, text, loads, extra) {
        var o = { key: key, text: text, loads: loads || {} };
        if (extra) for (var k in extra) o[k] = extra[k];
        return o;
    }
    var WORK = { office: 1, remote: 1, shifts: 1 };

    // ── Начални въпроси (не се броят в чертите) ──────────────────────────────
    var AGE_BANDS = ['u13', '14-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
    var AGE_LABELS = { 'u13': 'До 13', '14-17': '14–17', '18-24': '18–24', '25-34': '25–34', '35-44': '35–44', '45-54': '45–54', '55-64': '55–64', '65+': '65+' };
    var COUNTRIES = [
        ['BG', 'България', 'balkan'], ['RO', 'Румъния', 'balkan'], ['GR', 'Гърция, Сърбия, Северна Македония', 'balkan'],
        ['RU', 'Русия, Украйна, Беларус, Молдова', 'postsoviet'], ['DE', 'Германия, Австрия, Швейцария', 'germanic'],
        ['ES', 'Испания', 'iberian'], ['PT', 'Португалия', 'iberian'], ['IT', 'Италия', 'mediterranean'],
        ['FR', 'Франция, Белгия', 'western'], ['PL', 'Полша, Чехия, Словакия', 'central'], ['TR', 'Турция', 'turkish'],
        ['GB', 'Великобритания, Ирландия', 'anglo'], ['US', 'САЩ, Канада, Австралия', 'anglo'],
        ['LA', 'Латинска Америка', 'latam'], ['BR', 'Бразилия', 'latam'], ['XX', 'Друга държава', 'other']
    ];
    // Часова зона → група държави (за „живее в чужбина“ и подредбата на списъка). Без въпрос.
    var TZ_COUNTRY = {
        'Europe/Sofia': 'BG', 'Europe/Bucharest': 'RO', 'Europe/Athens': 'GR', 'Europe/Belgrade': 'GR', 'Europe/Skopje': 'GR',
        'Europe/Moscow': 'RU', 'Europe/Kiev': 'RU', 'Europe/Kyiv': 'RU', 'Europe/Minsk': 'RU', 'Europe/Chisinau': 'RU',
        'Europe/Berlin': 'DE', 'Europe/Vienna': 'DE', 'Europe/Zurich': 'DE', 'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES',
        'Europe/Lisbon': 'PT', 'Europe/Rome': 'IT', 'Europe/Paris': 'FR', 'Europe/Brussels': 'FR', 'Europe/Warsaw': 'PL',
        'Europe/Prague': 'PL', 'Europe/Bratislava': 'PL', 'Europe/Istanbul': 'TR', 'Europe/London': 'GB', 'Europe/Dublin': 'GB',
        'America/Sao_Paulo': 'BR'
    };
    function guessNowCountry(tz) {
        if (!tz) return null;
        if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
        if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Toronto|Vancouver|Edmonton|Halifax)/.test(tz) || /^Australia\//.test(tz)) return 'US';
        if (/^America\//.test(tz)) return 'LA';
        return null;
    }

    // Полът и възрастта се избират с бутони на началния екран (не са отделни въпроси); от тях
    // зависят родът и сцените. Заетостта е един въпрос накрая — само за бележките и съветите.
    // Държавата се взима от часовата зона, без въпрос. Всеки екран отпред струва отказали се.
    function welcomeQuestions() {
        return [
            { id: 201, intake: 'sex', text: 'Ти си…',
              options: [O('F', 'Жена'), O('M', 'Мъж'), O('X', 'Друго')] },
            { id: 202, intake: 'age', text: 'Години',
              options: AGE_BANDS.map(function (b, i) { return O(String.fromCharCode(65 + i), AGE_LABELS[b], null, { value: b }); }) }
        ];
    }
    function occupationQuestion(ctx) {
        if (isTeen(ctx)) return [];
        return [{ id: 203, intake: 'occ', category: 'Последно', icon: 'fa-briefcase', text: 'С какво минават повечето ти дни?',
            options: [O('A', 'Работа на място', null, { value: 'office' }), O('B', 'Работа от вкъщи', null, { value: 'remote' }),
                O('C', 'Работа на смени', null, { value: 'shifts' }), O('D', 'Учене', null, { value: 'study' }),
                O('E', 'Вкъщи с децата', null, { value: 'home_kids' }), O('F', 'Пенсия', null, { value: 'retired' }),
                O('G', 'Търся работа', null, { value: 'seeking' })] }];
    }

    // ── Банката с въпроси ────────────────────────────────────────────────────
    // Всеки въпрос: id, trait (за проверката), category, icon, text(ctx), options(ctx), skip(ctx).
    var C_SHAKE = ['Когато нещо те разклати', 'fa-bolt'];
    var C_MIND = ['Мислите', 'fa-brain'];
    var C_PLAN = ['Когато не стане по план', 'fa-route'];
    var C_VOICE = ['Гласът отвътре', 'fa-comment-dots'];
    var C_PEOPLE = ['Хората около теб', 'fa-user-group'];
    var C_SPARK = ['Скука и награди', 'fa-gift'];
    var C_SIGNAL = ['Сигналите', 'fa-wave-square'];
    var C_ROOTS = ['Откъде идва', 'fa-seedling'];
    var C_RHYTHM = ['Ритъмът сега', 'fa-clock'];

    var BANK = [
        { id: 1, cat: C_SHAKE, text: function () { return 'Пишат ти нещо неприятно точно преди да заспиш.'; },
          options: function () { return [
              O('A', 'Отговарям веднага, иначе няма да мигна', { URG: 1 }),
              O('B', 'Оставям го за сутринта, на свежа глава'),
              O('C', 'Не отговарям, но после дълго го въртя в главата', { RUM: 1 }),
              O('D', 'Ставам и почвам да правя нещо друго, каквото и да е', { URG: 0.6, AVO: 0.6 })]; } },
        { id: 3, cat: C_SHAKE, text: function () { return 'Някой близък те пита: „Какво ти е, бе?“ Най-често…'; },
          options: function () { return [
              O('A', 'Знам точно какво ми е, ама не ми се обяснява', { AVO: 0.4 }),
              O('B', 'Казвам му го направо'),
              O('C', 'Не знам. Просто ми е някак', { CLR: 1 }),
              O('D', 'Казвам „нищо“ и сменям темата', { AVO: 0.8, CLR: 0.3 })]; } },
        { id: 12, cat: C_PEOPLE, text: function (ctx) {
              return isTeen(ctx)
                  ? 'Пишеш на приятел. Минават часове без отговор, а го виждаш онлайн.'
                  : 'Пишеш на човек, който ти е важен. Минават няколко часа без отговор.'; },
          options: function () { return [
              O('A', 'Не се замислям, ще пише'),
              O('B', 'Почвам да поглеждам телефона', { ATT: 0.7 }),
              O('C', 'Почвам да се чудя какво не е наред', { ATT: 1 }),
              O('D', 'И аз после не бързам да отговарям', {}, { avoidant: true })]; } },
        { id: 14, cat: C_SPARK, text: function () { return 'Чакаш на опашка поне половин час, а телефонът ти е без батерия.'; },
          options: function () { return [
              O('A', 'Гледам хората, мисля си мои неща'),
              O('B', 'Голямо мъчение', { BOR: 1 }),
              O('C', 'Заговарям някого'),
              O('D', 'Ядосвам се, че си губя времето', { URG: 0.4, BOR: 0.4 })]; } },
        { id: 7, cat: C_PLAN, text: function (ctx) {
              if (isTeen(ctx)) return 'Решаваш всяка вечер да учиш по половин час повече. На третия ден не се получава.';
              if (ctx.occ === 'home_kids' || ctx.home === 'single_parent') return 'Решаваш всяка сутрин да имаш половин час само за себе си, преди всички да станат. На третия ден не се получава.';
              if (ctx.age === '55-64' || ctx.age === '65+') return 'Решаваш всяка сутрин да излизаш на разходка. На третия ден не се получава.';
              return 'Почваш да ставаш по-рано, за да тичаш. На третия ден не се получава.'; },
          options: function () { return [
              O('A', 'Утре пак'),
              O('B', 'Явно не е за мен. Спирам', { DIC: 1 }),
              O('C', 'Ядосвам се и на другия ден наваксвам двойно', { DIC: 0.7, CRIT: 0.6, RIG: 0.3 }),
              O('D', 'Сменям часа или плана, както ми е по-удобно')]; } },
        { id: 5, cat: C_MIND, text: function () { return 'Неделя вечер се сещаш за нещо неприятно, което те чака в понеделник.'; },
          options: function () { return [
              O('A', 'Помислям малко и си правя план'),
              O('B', 'Пускам си нещо, само и само да не мисля', { AVO: 1 }),
              O('C', 'Не мога да се откъсна от него цяла вечер', { RUM: 1 }),
              O('D', 'Не ми прави особено впечатление')]; } },
        { id: 31, cat: C_VOICE, text: function () { return 'Нещо дребно не ти се е получило. Как си говориш наум?'; },
          options: function () { return [
              O('A', 'Като на приятел: случва се'),
              O('B', 'По-строго, отколкото на приятел', { CRIT: 1 }),
              O('C', 'Все едно целият ден е провален', { DIC: 1, CRIT: 0.3 }),
              O('D', 'Не мога да се успокоя, докато не го оправя', { RIG: 1, CRIT: 0.3 })]; } },
        { id: 16, cat: C_SPARK, text: function (ctx) {
              return isTeen(ctx)
                  ? 'В магазина виждаш нещо готино, а парите ти са събрани за друго.'
                  : 'В магазин виждаш нещо хубаво, което не ти трябва, но е намалено.'; },
          options: function () { return [
              O('A', 'Подминавам'),
              O('B', 'Взимам го, после ще му намеря място', { REW: 1 }),
              O('C', 'Подминавам, но на излизане се връщам', { REW: 0.6 }),
              O('D', 'Снимам го. Ако след седмица още го искам, ще дойда')]; } },
        { id: 2, cat: C_SHAKE, text: function () { return 'Кое ти е по-близо, когато ти е криво?'; },
          hint: 'И двете са нормални. Избери по-близкото.',
          options: function () { return [
              O('A', 'Трябва да направя нещо, само да не стоя така', { URG: 1 }),
              O('B', 'Изчаквам малко и после виждам какво да правя')]; } },
        { id: 13, cat: C_PEOPLE, text: function (ctx) {
              if (isTeen(ctx)) return 'Вечер е. У вас всеки е зает със свое, а приятелите не пишат.';
              if (ctx.home === 'alone') return 'Петък вечер е и нямаш планове с никого.';
              if (ctx.home && ctx.home !== 'roommates') return 'Вечер е. Вкъщи всеки е зает със свое.';
              return 'Вечер е и вкъщи няма никой друг.'; },
          options: function (ctx) { return [
              O('A', ctx.home === 'alone' && !isTeen(ctx) ? 'Почивам си, така ми харесва' : 'Почивам си, рядко ми се случва'),
              O('B', 'Хубаво е, но към десет става едно празно', { LONE: 1 }),
              O('C', 'Пускам нещо, да се чува', { LONE: 0.6, AVO: 0.4 }),
              O('D', 'Пиша на някого или звъня', { LONE: 0.3 })]; } },
        { id: 4, cat: C_MIND, text: function () { return 'Денят е бил тежък. Вечерта можеш ли да кажеш какво точно го е направило такъв?'; },
          options: function () { return [
              O('A', 'Обикновено да, още докато се случва'),
              O('B', 'Да, но по-късно, като се поуспокоя', { CLR: 0.3 }),
              O('C', 'Често не. Тежко е и толкова', { CLR: 1 })]; } },
        { id: 20, cat: C_SIGNAL, text: function () { return 'Кога ти става ясно, че умората те е стигнала?'; },
          options: function () { return [
              O('A', 'Още в началото, по дребни неща'),
              O('B', 'Когато вече не мога да мисля', { BODY: 0.7 }),
              O('C', 'Чак на другия ден', { BODY: 1 }),
              O('D', 'Като ми кажат, че изглеждам изморено', { BODY: 1 })]; } },
        { id: 22, cat: C_ROOTS, text: function (ctx) {
              return isTeen(ctx) ? 'Когато ти е тъжно, у вас най-често…' : 'Когато в детството ти е било тъжно, у вас най-често…'; },
          options: function (ctx) { var t = isTeen(ctx); return [
              O('A', t ? 'Някой те прегръща и пита какво има' : 'Някой те прегръщаше и питаше какво има'),
              O('B', t ? 'Разсейват те: с телевизор, нещо сладко, нова игра' : 'Разсейваха те: с телевизор, нещо сладко, нова играчка', { SOOTHE: 1 }),
              O('C', t ? 'Казват ти, че няма за какво да се тревожиш' : 'Казваха ти, че няма за какво да плачеш', { CLR: 0.5, CRIT: 0.5 }),
              O('D', t ? 'Оставят те да ти мине само' : 'Оставяха те да ти мине само', { AVO: 0.4 })]; } },
        { id: 25, cat: C_RHYTHM, text: function () { return 'Колко спиш в обикновена делнична нощ?'; },
          options: function () { return [
              O('A', 'По-малко от 6 часа', { LOAD: 1 }),
              O('B', 'Около 6–7 часа', { LOAD: 0.4 }),
              O('C', '7–8 часа'),
              O('D', 'Повече')]; } },
        { id: 28, realNeed: true, cat: ['Накрая', 'fa-star'],
          text: function () { return 'Ако можеш да имаш едно от тези още тази седмица, кое ще ти помогне най-много?'; },
          options: function () { return [
              O('A', 'Да се наспя и никой да не ме търси', null, { need: 'LOAD' }),
              O('B', 'Някой да ме изслуша, без да ме съветва', null, { need: 'LONE' }),
              O('C', 'Да ми паднат няколко неща от главата', null, { need: 'AVO' }),
              O('D', 'Някой да ми каже, че се справям добре', null, { need: 'CRIT' }),
              O('E', 'Друго… ще го напиша', null, { revealsText: true, skipScoring: true })]; } }
    ];

    // Огледални двойки за последователност. dir: 'any' — различни краища; 'ab' — само a=0 и b=1.
    var MIRRORS = [
        { a: 1, b: 2, trait: 'URG', dir: 'any' }
    ];

    // ── Здравето — един въпрос накрая, само 18+ ──────────────────────────────
    function healthQuestions(ctx) {
        if (isTeen(ctx)) return [];
        var f = ctx.sex === 'f', fertile = f && ['18-24', '25-34', '35-44', '45-54'].indexOf(ctx.age) >= 0;
        var opts = [
            O('N', 'Нищо от тези', null, { exclusive: true, value: 'none' }),
            O('U', 'Предпочитам да не казвам', null, { exclusive: true, value: 'undisclosed' }),
            O('A', 'Диабет или инсулинова резистентност', null, { value: 'diabetes' }),
            O('B', 'Щитовидна жлеза', null, { value: 'thyroid' })
        ];
        if (f) opts.push(O('C', 'Поликистозни яйчници', null, { value: 'pcos' }));
        if (fertile) opts.push(O('D', 'Бременност или кърмене', null, { value: 'pregnancy' }));
        if (fertile) opts.push(O('K', 'Дни от месеца, в които всичко ми идва в повече', null, { value: 'cycle' }));
        if (f && ['35-44', '45-54', '55-64', '65+'].indexOf(ctx.age) >= 0) opts.push(O('E', 'Менопауза', null, { value: 'menopause' }));
        opts.push(
            O('F', 'Лекарства, които влияят на апетита', null, { value: 'meds' }),
            O('G', 'Лечение за тревожност или депресия', null, { value: 'anxiety_tx' }),
            O('H', 'ADHD', null, { value: 'adhd' }),
            O('I', 'Работа или сън, които често се объркват', null, { value: 'sleep' }),
            O('J', 'В миналото трудности с храненето, за които е търсена помощ', null, { value: 'past_ed' })
        );
        return [{ id: 301, health: true, type: 'multi', category: 'Последно', icon: 'fa-shield-heart',
            text: 'За да са съветите точни: има ли нещо от тези при теб?',
            hint: 'По избор. Отговорът остава на това устройство и не отива при AI модела.',
            options: opts }];
    }

    // ── Потокът ──────────────────────────────────────────────────────────────
    function materialize(item, ctx) {
        var q = {
            id: item.id,
            category: item.cat[0],
            icon: item.cat[1],
            text: item.text(ctx),
            options: item.options(ctx)
        };
        if (item.hint) q.hint = item.hint;
        if (item.realNeed) q.realNeed = true;
        return q;
    }

    /** Потокът: сцените (варианти по пол и възраст) → сън → истинската нужда → заетост → здраве. */
    function buildFlow(ctx) {
        ctx = ctx || {};
        var out = [];
        BANK.forEach(function (item) { if (!item.skip || !item.skip(ctx)) out.push(materialize(item, ctx)); });
        return out.concat(occupationQuestion(ctx), healthQuestions(ctx));
    }

    function pick(meta, id) {
        var m = meta && meta[id];
        if (!m) return [];
        if (Array.isArray(m.optionKeys)) return m.optionKeys;
        return m.optionKey ? [m.optionKey] : [];
    }

    /** Контекстът от началните отговори (+ часовата зона за „живее сега“). */
    function contextFrom(meta, env) {
        var ctx = { nowCountry: guessNowCountry(env && env.tz) };
        var sex = pick(meta, 201)[0];
        ctx.sex = sex === 'F' ? 'f' : sex === 'M' ? 'm' : sex === 'X' ? 'x' : null;
        var ageKey = pick(meta, 202)[0];
        if (ageKey) ctx.age = AGE_BANDS[ageKey.charCodeAt(0) - 65] || null;
        ctx.teen = ctx.age === 'u13' || ctx.age === '14-17';
        if (ctx.teen) ctx.occ = 'school';
        else {
            var oq = occupationQuestion(ctx)[0], ok = pick(meta, 203)[0];
            var oo = oq && oq.options.filter(function (x) { return x.key === ok; })[0];
            ctx.occ = oo ? oo.value : null;
        }
        ctx.home = null;
        ctx.origin = ctx.nowCountry || null;
        var cc = COUNTRIES.filter(function (c) { return c[0] === ctx.origin; })[0];
        ctx.culture = cc ? cc[2] : null;
        ctx.abroad = false;
        var hq = healthQuestions(ctx)[0];
        var hk = pick(meta, 301);
        ctx.health = hq ? hq.options.filter(function (o) { return hk.indexOf(o.key) >= 0; }).map(function (o) { return o.value; }) : [];
        ctx.cycle = ctx.health.indexOf('cycle') >= 0;
        return ctx;
    }
    function has(ctx, h) { return !!(ctx && ctx.health && ctx.health.indexOf(h) >= 0); }

    // ── Начисляване ──────────────────────────────────────────────────────────
    function ceiling(q) {
        var out = {};
        q.options.forEach(function (o) { Object.keys(o.loads || {}).forEach(function (t) { out[t] = Math.max(out[t] || 0, o.loads[t]); }); });
        return out;
    }
    function chosenLoads(q, meta) {
        var keys = pick(meta, q.id);
        var o = q.options.filter(function (x) { return keys.indexOf(x.key) >= 0; })[0];
        return o ? (o.loads || {}) : null;
    }

    function traitScores(flow, meta) {
        var acc = {};
        flow.forEach(function (q) {
            if (q.intake || q.health || q.realNeed) return;
            var got = chosenLoads(q, meta);
            if (!got) return;
            var max = ceiling(q);
            Object.keys(max).forEach(function (t) {
                if (!acc[t]) acc[t] = { got: 0, max: 0 };
                acc[t].got += got[t] || 0;
                acc[t].max += max[t];
            });
        });
        var s = {};
        // Свиване към нулата (+SHRINK в знаменателя): черта, мерена с един въпрос, не може да стигне
        // 100 от един отговор. Колкото повече въпроси я потвърждават, толкова по-близо до 100.
        TRAIT_IDS.forEach(function (t) { s[t] = acc[t] && acc[t].max ? Math.round(acc[t].got / (acc[t].max + SHRINK) * 100) : 0; });
        return s;
    }

    /** Тежестите в общата склонност след контекста: каквото е физиология или обстоятелство, тежи по-малко. */
    function weights(ctx) {
        var w = {};
        TRAIT_IDS.forEach(function (t) { w[t] = TRAITS[t].w; });
        if (has(ctx, 'adhd')) { w.URG *= 0.5; w.BOR *= 0.5; }
        if (ctx.occ === 'shifts' || has(ctx, 'sleep')) { w.LOAD *= 0.6; w.BODY *= 0.6; }
        if (ctx.occ === 'home_kids' || ctx.home === 'single_parent') w.LOAD *= 0.6;
        if (has(ctx, 'anxiety_tx')) { w.RUM *= 0.7; w.LONE *= 0.8; }
        if (has(ctx, 'thyroid') || has(ctx, 'menopause') || has(ctx, 'pcos')) w.LOAD *= 0.7;
        return w;
    }

    // Склонността се води от най-силните черти: една ясно изразена черта (например строгият глас)
    // сама по себе си е осезаем риск, а средното от 14 черти би я разредило. Тежестта на чертата
    // (и нагласянето ѝ по контекста) влиза като множител √(w/3).
    function riskScore(s, ctx) {
        var w = weights(ctx), sum = 0, wsum = 0;
        TRAIT_IDS.forEach(function (t) { sum += s[t] * w[t]; wsum += w[t]; });
        var mean = wsum ? sum / wsum : 0;
        var eff = TRAIT_IDS.map(function (t) { return s[t] * Math.sqrt(w[t] / 3); }).sort(function (a, b) { return b - a; });
        return Math.round(0.45 * eff[0] + 0.3 * (eff[1] + eff[2]) / 2 + 0.25 * mean);
    }

    function levelOf(v, lo, hi) { return v >= hi ? 'Силно' : v >= lo ? 'Осезаемо' : 'Слабо'; }

    // ── Архетипи ─────────────────────────────────────────────────────────────
    // Имената са общи с persona.js и enrichment-emoeat.js — не ги сменяй без тях.
    var ARCHETYPES = [
        { name: 'Утехата', accent: '#E2557A', icon: 'fa-heart',
          description: 'Храната дава топлина и компания, когато денят утихне и липсва човек до теб.',
          profile: { LONE: 0.9, ATT: 0.6, SOOTHE: 0.4 },
          plan: {
              focus: 'Вечерта да има друг източник на топлина, освен храната.',
              actions: [
                  { title: 'Вечерно обаждане', when: 'Между 19 и 21 ч.', how: 'Кратко обаждане или съобщение до близък човек, преди да отвориш хладилника.' },
                  { title: 'Топло, но не храна', when: 'Когато вечерта утихне', how: 'Душ, одеяло, топъл чай. Тялото търси топлина, не непременно храна.' },
                  { title: 'Назови го', when: 'Преди вечерното хапване', how: 'Кажи си наум „самотно ми е“ или „гладен/на съм“. Едното се храни, другото не.' }
              ],
              sos: ['Изчакай 10 минути — импулсът спада сам', 'Напиши на някого две изречения как си', 'Ако още искаш — яж седнал/а, от чиния, без екран'],
              swaps: [
                  { when: 'Когато ти липсва някой', try: ['гласово съобщение', 'разходка с подкаст', 'топъл душ'] },
                  { when: 'Когато вечерта е празна', try: ['нещо с ръцете', 'книга в леглото', 'лягане по-рано'] }
              ] } },
        { name: 'Паузата', accent: '#7C6CF0', icon: 'fa-pause',
          description: 'Храната е бутон за пауза. Тежестта заглушава мисли, които иначе не спират.',
          profile: { AVO: 0.9, RUM: 0.6, CLR: 0.5, LOAD: 0.4 },
          plan: {
              focus: 'Друг бутон за пауза, който действа бързо.',
              actions: [
                  { title: '5-4-3-2-1', when: 'Когато мислите се завъртят', how: 'Назови 5 неща, които виждаш, 4, които чуваш, 3, които усещаш. Минута и си обратно тук.' },
                  { title: 'Изписване', when: 'Вечер, 5 минути', how: 'Изпиши всичко, което се върти в главата, без да поправяш. После затвори тетрадката.' },
                  { title: '10 минути бързо ходене', when: 'След напрегнат момент', how: 'Сваля напрежението почти колкото храната, без тежестта после.' }
              ],
              sos: ['Издишай бавно 6 пъти — по-дълго от вдишването', 'Смени стаята или излез навън', 'Студена вода по лицето и китките'],
              swaps: [
                  { when: 'Когато искаш да изключиш', try: ['душ', 'музика със слушалки', 'кратка разходка'] },
                  { when: 'Когато мислите не спират', try: ['изписване', 'разговор', 'задача с ръцете'] }
              ] } },
        { name: 'Махалото', accent: '#F97316', icon: 'fa-arrows-left-right',
          description: 'Строги правила, после срив, после още по-строги правила. Махало, което се люлее само.',
          profile: { DIC: 0.9, URG: 0.6, RIG: 0.4, REW: 0.3 },
          plan: {
              focus: 'Да спре люлеенето — без нови забрани.',
              actions: [
                  { title: 'Без „нулеви“ дни', when: 'След всяко преяждане', how: 'Нищо не се отменя с гладуване. Утрото започва с нормална закуска.' },
                  { title: 'Пауза по средата', when: 'По средата на храненето', how: 'Остави вилицата за минута и провери: още ли съм гладен/на?' },
                  { title: 'В чиния, не от пакета', when: 'Когато ти се яде сладко', how: 'Сложи порция в чиния и седни. От пакета и на крак се спира трудно.' }
              ],
              sos: ['Пусни таймер за 10 минути', 'Сложи порция в чиния, пакета — обратно', 'Яж бавно, седнал/а, без екран'],
              swaps: [
                  { when: 'Когато правилото натежи', try: ['разхлаби едно правило', 'любима храна в нормална порция', 'разговор вместо забрана'] },
                  { when: 'Когато започнеш и не спираш', try: ['вода между хапките', 'излез от кухнята', 'измий зъбите си'] }
              ] } },
        { name: 'Редът', accent: '#0D9488', icon: 'fa-ruler-combined',
          description: 'Правилата около храната дават усещане за ред и натежават, когато денят излезе от контрол.',
          profile: { RIG: 0.9, DIC: 0.5, CRIT: 0.4 },
          plan: {
              focus: 'По-малко забрани, повече редовност.',
              actions: [
                  { title: 'Три хранения по часовник', when: 'Всеки ден', how: 'Хранѝ се навреме, дори без силен глад. Гладът от лишение е най-силният.' },
                  { title: 'Една „забранена“ храна', when: 'Веднъж тази седмица', how: 'Изяж я спокойно, в нормална порция. Забраната я прави по-силна, не по-слаба.' },
                  { title: 'Правило 80/20', when: 'Когато се отклониш', how: 'Едно отклонение не разваля деня. Следващото хранене е обичайното, без компенсиране.' }
              ],
              sos: ['Не компенсирай — следващото хранене е обичайното', 'Запиши какво се случи точно преди импулса', 'Излез навън за 5 минути'],
              swaps: [
                  { when: 'Когато нещо излезе от контрол', try: ['подреди едно чекмедже', 'списък с 3 задачи', 'кратка разходка'] },
                  { when: 'Когато мислиш за храна', try: ['план за утре и край', 'смени стаята', 'обади се на някого'] }
              ] } },
        { name: 'Строгият глас', accent: '#8B5CF6', icon: 'fa-comment-dots',
          description: 'След храна идва присъда. Вътрешният глас е по-строг, отколкото би бил към друг човек.',
          profile: { CRIT: 0.95, DIC: 0.4, RUM: 0.4 },
          plan: {
              focus: 'Да си говориш като на приятел.',
              actions: [
                  { title: 'Като на приятел', when: 'След хранене, което не ти харесва', how: 'Какво би казал/а на приятел в същата ситуация? Кажи го на себе си.' },
                  { title: 'Без компенсиране', when: 'На следващия ден', how: 'Не гладувай и не наказвай себе си със спорт. Обичайният ден прекъсва кръга.' },
                  { title: 'Една честна дума', when: 'Веднъж тази седмица', how: 'Сподели с някого как се чувстваш около храната. Изговореното тежи по-малко.' }
              ],
              sos: ['Спри присъдата: „това е едно хранене, не съм аз“', 'Пийни вода и излез за 5 минути', 'Следващото хранене — обичайното, без наказание'],
              swaps: [
                  { when: 'Когато се самообвиняваш', try: ['думи като към приятел', 'запиши едно добро нещо от деня', 'разходка'] },
                  { when: 'Когато искаш да компенсираш', try: ['обичайна закуска', 'движение за удоволствие', 'разговор'] }
              ] } },
        { name: 'Искрата', accent: '#EAB308', icon: 'fa-fire',
          description: 'Храната е най-бързата искра в монотонен или изморителен ден.',
          profile: { BOR: 0.9, REW: 0.6, LOAD: 0.5 },
          plan: {
              focus: 'Повече искри през деня, повече сън през нощта.',
              actions: [
                  { title: 'Малка новост', when: 'Всеки следобед', how: '10 минути нещо ново — друг маршрут, песен, кратък разговор.' },
                  { title: 'Сън на първо място', when: 'Тази седмица', how: 'Лягай 30 минути по-рано. Изтощението се усеща като глад за сладко.' },
                  { title: 'Планирана закуска', when: 'Около 15–16 ч.', how: 'Закуска с белтък преди спада на енергията, не след него.' }
              ],
              sos: ['Питай се: гладен/на ли съм, или ми е скучно и уморено?', '3 минути движение — стълби или клякания', 'Ако е глад — яж нещо истинско, седнал/а'],
              swaps: [
                  { when: 'Когато е скучно', try: ['нов плейлист', 'обаждане', 'кратка разходка'] },
                  { when: 'Когато си изморен/а', try: ['10 минути със затворени очи', 'чаша вода', 'ранно лягане'] }
              ] } },
        { name: 'Импулсът', accent: '#E04F3A', icon: 'fa-bolt',
          description: 'Силното чувство иска действие веднага, а храната е най-близкото действие.',
          profile: { URG: 0.95, REW: 0.5, CLR: 0.4 },
          plan: {
              focus: 'Между чувството и действието — десет минути.',
              actions: [
                  { title: 'Десет минути', when: 'Когато нещо те разклати', how: 'Пусни таймер и прави нещо с ръцете, докато тече. Импулсът спада сам, ти само го изчакваш.' },
                  { title: 'Една дума', when: 'Преди да посегнеш', how: 'Кажи наум какво е: яд, тъга, страх или умора. Назованото чувство отслабва.' },
                  { title: 'Нещо под ръка', when: 'Тази седмица', how: 'Дръж до себе си нещо за ръцете: топка, химикал, чаша вода. Бързото действие да има друг изход.' }
              ],
              sos: ['Пусни таймер за 10 минути', 'Издишай бавно 6 пъти — по-дълго от вдишването', 'Ако още искаш — яж седнал/а, от чиния'],
              swaps: [
                  { when: 'Когато нещо те ядоса', try: ['бързо ходене', 'студена вода', 'стисни нещо'] },
                  { when: 'Когато искаш нещо веднага', try: ['чаша вода', 'десет клякания', 'съобщение до приятел'] }
              ] } }
    ];

    var CALM = { name: 'Спокоен апетит', accent: '#0D9488', icon: 'fa-leaf',
        description: 'Нищо в отговорите не тласка към храна в тежък ден. Посягаш към нея главно когато си гладен/на.',
        plan: {
            focus: 'Да запазиш това, което вече работи.',
            actions: [
                { title: 'Хранене по часовник', when: 'Всеки ден', how: 'Редовните хранения пазят от силния глад, в който всеки се храни импулсивно.' },
                { title: 'Проверка в напрегнат ден', when: 'Когато посегнеш без глад', how: 'Само забележи какво усещаш. Не е нужно да го променяш.' },
                { title: 'Сън и движение', when: 'Тази седмица', how: 'Те държат апетита стабилен повече от всяко правило.' }
            ],
            sos: ['Попитай се: гладен/на ли съм?', 'Ако не — изчакай 10 минути', 'Ако да — яж спокойно, седнал/а'],
            swaps: [{ when: 'Когато денят е тежък', try: ['разходка', 'разговор', 'ранно лягане'] }]
        } };

    function archetypesFor(s, risk) {
        var user = TRAIT_IDS.map(function (t) { return s[t] / 100; });
        var un = Math.sqrt(user.reduce(function (a, v) { return a + v * v; }, 0));
        if (!un) return [];
        var mag = Math.min(1, risk / RISK_HIGH);
        return ARCHETYPES.map(function (a) {
            var p = TRAIT_IDS.map(function (t) { return a.profile[t] || 0; });
            var pn = Math.sqrt(p.reduce(function (x, v) { return x + v * v; }, 0));
            var dot = user.reduce(function (x, v, i) { return x + v * p[i]; }, 0);
            return { name: a.name, description: a.description, confidence: Math.round(dot / (un * pn) * mag * 100) };
        }).sort(function (a, b) { return b.confidence - a.confidence; });
    }

    // ── Кръгове (имената са общи с enrichment-emoeat.js) ─────────────────────
    var PATTERNS = [
        { id: 'restriction_binge', title: 'Правила → срив → нови правила',
          test: function (s) { return s.DIC >= HIGH && (s.RIG >= 50 || s.URG >= 50); },
          description: 'Всяка забрана зарежда следващия срив, а той — следващата забрана. Кръгът се къса с по-малко забрани и редовно хранене, не с още дисциплина.' },
        { id: 'shame_cycle', title: 'Строг глас → утеха → още по-строг глас',
          test: function (s) { return s.CRIT >= HIGH && (s.DIC >= 50 || s.RUM >= 50); },
          description: 'Упрекът след храна тласка към нова утеха, а тя — към нов упрек. Кръгът отслабва, когато гласът стане по-мек.' },
        { id: 'interoceptive_blur', title: 'Чувствата се усещат като глад',
          test: function (s) { return s.CLR >= 55 && s.BODY >= 50; },
          description: 'Когато чувството няма име и сигналите идват късно, умората или тревогата лесно се усещат като глад. Помага кратко назоваване преди хранене.' },
        { id: 'dissociative', title: 'Храната като бутон за пауза',
          test: function (s) { return s.AVO >= HIGH && (s.RUM >= 50 || s.LOAD >= 50); },
          description: 'Храната наистина изключва за малко. Затова е трудно да се остави без друг бутон, който действа толкова бързо.' },
        { id: 'attachment_deficit', title: 'Храната на мястото на човек',
          test: function (s) { return Math.max(s.LONE, s.ATT) >= HIGH; },
          description: 'Вечерите са най-уязвими. Тогава липсата се усеща най-ясно, а храната е най-близо.' },
        { id: 'depletion', title: 'Изтощение → търсене на искра',
          test: function (s) { return Math.max(s.BOR, s.LOAD) >= 55; },
          description: 'При изчерпана енергия храната е най-бързият стимул. Помагат сънят и малките новости през деня, не контролът.' },
        { id: 'urgency', title: 'Импулсът изпреварва',
          test: function (s) { return s.URG >= HIGH; },
          description: 'Силното чувство иска действие веднага. Ако между чувството и действието има десет минути, повечето импулси минават сами.' }
    ];

    // ── Надеждност ───────────────────────────────────────────────────────────
    function reliabilityOf(flow, meta) {
        var scored = flow.filter(function (q) { return !q.intake && !q.health && !q.realNeed; });
        var answered = scored.filter(function (q) { return pick(meta, q.id).length; });
        var neutral = answered.filter(function (q) { var l = chosenLoads(q, meta); return l && !Object.keys(l).length; });
        var byId = {}; flow.forEach(function (q) { byId[q.id] = q; });
        var norm = function (id, t) {
            var q = byId[id]; if (!q) return null;
            var l = chosenLoads(q, meta); if (!l) return null;
            var c = ceiling(q)[t]; return c ? (l[t] || 0) / c : null;
        };
        var inconsistent = MIRRORS.filter(function (m) {
            var a = norm(m.a, m.trait), b = norm(m.b, m.trait);
            if (a == null || b == null) return false;
            return m.dir === 'ab' ? (a === 0 && b === 1) : Math.abs(a - b) >= 0.9;
        }).length;
        var coverage = scored.length ? Math.round(answered.length / scored.length * 100) : 0;
        var neutralShare = answered.length ? Math.round(neutral.length / answered.length * 100) : 0;
        var level = 'висока', note = '';
        if (coverage < 60) { level = 'ниска'; note = 'Отговорите са малко — приеми картината като ориентир.'; }
        else if (inconsistent >= 1 && neutralShare < 50) { level = 'средна'; note = 'Някои отговори си противоречат. Може денят днес да е бил различен — приеми картината като ориентир.'; }
        else if (neutralShare > 70) { level = 'средна'; note = 'Повечето отговори са спокойните. Или наистина нищо не тласка, или картината е по-мека от реалната.'; }
        return { answered: answered.length, total: scored.length, coverage: coverage, neutralShare: neutralShare, inconsistent: inconsistent, level: level, note: note };
    }

    // ── Безопасност и бележки по контекста ───────────────────────────────────
    function safetyOf(s, ctx) {
        // Праговете са под HIGH, защото след свиването черта с 2–3 въпроса рядко минава 70.
        var combo = s.CRIT >= 50 && s.DIC >= 55 && (s.AVO >= 50 || s.RIG >= 50);
        var pastEd = has(ctx, 'past_ed');
        if (isTeen(ctx) && combo) return { level: 'teen', reasons: ['combo'] };
        if (pastEd) return { level: 'specialist', reasons: ['past_ed'], hideArchetype: true };
        if (combo) return { level: 'specialist', reasons: ['combo'] };
        return { level: 'none', reasons: [] };
    }

    var NOTES = {
        adhd: 'Част от бързите реакции и нуждата от искра идва от това как работи вниманието ти. Затова съветите не разчитат на воля, а на неща под ръка.',
        diabetes: 'При диабет или инсулинова резистентност спадът на захарта се усеща като раздразнение и спешност. Първо провери захарта, после реши дали е глад.',
        meds: 'Някои лекарства засилват апетита. Ако забелязваш промяна, откакто ги пиеш, кажи на лекаря си. Не ги спирай без него.',
        anxiety_tx: 'Съветите тук допълват лечението ти, не го заместват. Ако нещо не пасва с него, питай специалиста си.',
        pregnancy: 'По време на бременност и кърмене гладът е нормален и нужен. Нищо тук не е за ограничаване.',
        hormones: 'Промените в хормоните влияят на съня, умората и апетита. Ако умората е силна, говори с лекар.',
        cycle: 'Ако има дни от месеца, в които всичко ти идва в повече, отбележи си ги. Тогава желанието за сладко при много жени е по-силно. Това е физиология, не слабост.',
        shifts: 'Смените и разбърканият сън объркват и сигналите за глад. Част от картината е от графика, не от теб.',
        kids: 'С малки деца почивката е рядкост. Съветите тук са по пет минути, не по час.',
        abroad: 'Животът в друга държава носи своя умора. Понякога вкусът на дома е и тъга по дома.',
        teen: 'На твоите години е нормално чувствата да идват силно и бързо. Тук няма нищо за диети. Съветите са за почивката, съня и за това какво да правиш, когато ти е тежко.'
    };
    function notesOf(ctx) {
        var n = [];
        if (isTeen(ctx)) n.push('teen');
        if (has(ctx, 'adhd')) n.push('adhd');
        if (has(ctx, 'diabetes')) n.push('diabetes');
        if (has(ctx, 'meds')) n.push('meds');
        if (has(ctx, 'anxiety_tx')) n.push('anxiety_tx');
        if (has(ctx, 'pregnancy')) n.push('pregnancy');
        if (has(ctx, 'thyroid') || has(ctx, 'menopause') || has(ctx, 'pcos')) n.push('hormones');
        if (ctx.cycle) n.push('cycle');
        if (ctx.occ === 'shifts' || has(ctx, 'sleep')) n.push('shifts');
        if (ctx.occ === 'home_kids' || ctx.home === 'single_parent' || ctx.home === 'partner_kids') n.push('kids');
        if (ctx.abroad) n.push('abroad');
        return n.map(function (id) { return { id: id, text: NOTES[id] }; });
    }

    // ── Анализът ─────────────────────────────────────────────────────────────
    function analyze(meta, env) {
        var ctx = contextFrom(meta, env);
        var flow = buildFlow(ctx);
        var s = traitScores(flow, meta);
        var risk = riskScore(s, ctx);
        var riskLevel = levelOf(risk, RISK_LOW, RISK_HIGH);
        var emotional = risk >= RISK_LOW;
        var arch = archetypesFor(s, risk);
        var safety = safetyOf(s, ctx);
        var traits = TRAIT_IDS.map(function (t) {
            return { id: t, name: TRAITS[t].name, icon: TRAITS[t].icon, portrait: TRAITS[t].portrait, bridge: TRAITS[t].bridge,
                     score: s[t], level: levelOf(s[t], LOW, HIGH) };
        }).sort(function (a, b) { return b.score - a.score; });
        var need = meta && meta[28];
        var needOpt = null;
        if (need) {
            var nq = flow.filter(function (q) { return q.id === 28; })[0];
            needOpt = nq && nq.options.filter(function (o) { return pick(meta, 28).indexOf(o.key) >= 0; })[0];
        }
        var top = emotional && arch[0] && arch[0].confidence > 0 && !safety.hideArchetype ? arch[0] : null;
        return {
            v: 3,
            ctx: ctx,
            flow: flow,
            scores: s,
            traits: traits,
            portrait: traits.filter(function (t) { return t.score >= LOW; }).slice(0, 3),
            risk: risk,
            riskLevel: riskLevel,
            emotional: emotional,
            archetypes: arch,
            archetype: top,
            secondArchetype: top && arch[1] && arch[1].confidence > 0 ? arch[1] : null,
            patterns: PATTERNS.filter(function (p) { return p.test(s); }).map(function (p) { return { id: p.id, title: p.title, description: p.description }; }),
            reliability: reliabilityOf(flow, meta),
            safety: safety,
            notes: notesOf(ctx),
            realNeed: need ? (String(need.extra || '').trim() || (needOpt && !needOpt.skipScoring ? needOpt.text : '')) : ''
        };
    }

    function archetypeByName(name) {
        return ARCHETYPES.filter(function (a) { return a.name === name; })[0] || null;
    }

    // ── Обобщението навън ────────────────────────────────────────────────────
    // Пази формата от v2 (archetype, intensity, drivers, behaviors, patterns, bodySignals) — от нея
    // четат enrichment-emoeat.js, persona.js, cross-check.js и сървърът. Новото е в v, portrait, traits, context.
    var LEGACY_DRIVERS = [
        ['Нужда от близост', ['LONE', 'ATT', 'SOOTHE']],
        ['Натрупано напрежение', ['URG']],
        ['Бягство от задачи и мисли', ['AVO', 'RUM']],
        ['Умора и еднообразие', ['BOR', 'LOAD', 'REW']]
    ];
    function payload(a, opts) {
        opts = opts || {};
        var s = a.scores;
        var drivers = LEGACY_DRIVERS.map(function (d) {
            return { name: d[0], score: Math.max.apply(null, d[1].map(function (t) { return s[t]; })) };
        }).filter(function (d) { return d.score >= LOW; }).sort(function (x, y) { return y.score - x.score; }).slice(0, 2).map(function (d) { return d.name; });
        var behaviors = [
            { name: 'Трудно спиране', score: Math.round((s.URG + s.REW) / 2) },
            { name: 'Строги правила', score: s.RIG },
            { name: 'Строг вътрешен глас', score: s.CRIT }
        ].filter(function (b) { return b.score >= LOW; }).map(function (b) { return { name: b.name, level: levelOf(b.score, LOW, HIGH) }; });
        var body = s.CLR >= 55 && s.BODY >= 50
            ? 'чувствата лесно се усещат като глад (трудно назоваване + късни сигнали на тялото)'
            : s.BODY >= LOW ? 'сигналите на тялото (умора, напрежение) се усещат късно' : '';
        var ctx = a.ctx;
        var out = {
            v: 3,
            intensity: a.riskLevel,
            archetype: a.archetype ? { name: a.archetype.name, description: a.archetype.description } : null,
            secondArchetype: a.secondArchetype ? a.secondArchetype.name : null,
            drivers: drivers,
            behaviors: behaviors,
            patterns: a.patterns.map(function (p) { return p.title; }),
            bodySignals: body,
            realNeed: a.realNeed,
            portrait: a.portrait.map(function (t) { return t.name; }),
            traits: a.traits.map(function (t) { return { id: t.id, name: t.name, level: t.level }; }),
            context: { sex: ctx.sex || null, age: ctx.age || null, teen: !!ctx.teen, occupation: ctx.occ || null, household: ctx.home || null,
                       culture: ctx.culture || null, abroad: !!ctx.abroad },
            safety: a.safety.level,
            reliability: { level: a.reliability.level, answered: a.reliability.answered, total: a.reliability.total, neutralShare: a.reliability.neutralShare }
        };
        // Здравето — само към плана и само със съгласие; към AI модела никога.
        if (opts.withHealth && !ctx.teen && ctx.health && ctx.health.length) out.health = ctx.health.slice();
        return out;
    }

    /** „седнал/а“ → по пола. Само за български; другите езици идват от речника с неутралните форми. */
    var IRREG_F = { 'спокоен': 'спокойна' };
    function genderize(text, sex) {
        if (!text || (sex !== 'f' && sex !== 'm')) return text;
        return String(text).replace(/([А-Яа-яЁё]+)\/(а|на|я)(?![А-Яа-я])/g, function (all, w, suf) {
            if (sex === 'm') return w;
            if (IRREG_F[w.toLowerCase()]) return IRREG_F[w.toLowerCase()];
            if (suf === 'на' && /ен$/.test(w)) return w.slice(0, -2) + 'на';
            return w + suf;
        });
    }

    var api = {
        SCHEMA: SCHEMA, TRAITS: TRAITS, TRAIT_IDS: TRAIT_IDS, ARCHETYPES: ARCHETYPES, CALM: CALM, PATTERNS: PATTERNS,
        LOW: LOW, HIGH: HIGH, RISK_LOW: RISK_LOW, RISK_HIGH: RISK_HIGH, BANK: BANK, NOTES: NOTES,
        buildFlow: buildFlow, welcomeQuestions: welcomeQuestions, contextFrom: contextFrom, analyze: analyze, payload: payload, archetypeByName: archetypeByName,
        genderize: genderize, guessNowCountry: guessNowCountry, traitScores: traitScores, riskScore: riskScore
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.EmoEatV3 = api;
})(typeof window !== 'undefined' ? window : this);
