/**
 * Модел на целта: накъде и колко да се движи тялото — по целта И по профила.
 *
 * Етикетът на целта не носи посока сам по себе си. „Антиейджинг“ при ИТМ 31
 * е сваляне на мазнини, при ИТМ 21 — пазене на мускулите; „Мускулна маса“ при
 * наднормено тегло е смяна на състава (мазнини надолу, мускули нагоре), а при
 * слаб човек — покачване. Затова посоката се извежда от:
 *   - всички цели (отметки, свободен текст, цел от клиничната карта);
 *   - състава на тялото: ИТМ, обиколка на талията, % мазнини (ако има везна);
 *   - възраст, пол, тренировки;
 *   - клиничната рамка, която е над целта: бременност, кърмене, поднормено
 *     тегло, затлъстяване, метаболитни състояния.
 *
 * Резултатът е общ за калориите, менюто, седмичния преглед и екрана.
 * Моделът е без памет: пресмята се с текущите измервания, затова когато
 * клиентът стигне края на една фаза, следващото пресмятане вече дава
 * следващата фаза — пътната карта се движи сама.
 *
 * Прагове: ИТМ (WHO), талия (IDF/WHO Европа: 94/80 повишен, 102/88 висок риск),
 * мазнини (ACE: мъже 25%+, жени 32%+ — затлъстяване), над 65 г. оптималният
 * ИТМ е по-висок (Winter 2014), дефицит до 25%.
 */
(function (global) {
    'use strict';

    /** Етикет → код. Подцелите от картата „след раждане“ също са тук. */
    var GOAL_LABELS = {
        'отслабване': 'LOSS', 'постепенно отслабване': 'LOSS', 'fat_loss': 'LOSS', 'loss': 'LOSS',
        'изчистване на коремните мазнини': 'VISC',
        'мускулна маса': 'GAIN', 'покачване на мускулна маса': 'GAIN', 'muscle_gain': 'GAIN',
        'стягане и оформяне на тялото': 'TONE',
        'подобряване на здравето': 'HLTH', 'възстановяване на енергията': 'HLTH', 'подобряване на настроението': 'HLTH',
        'антиейджинг': 'AGE',
        'детокс и прочистване': 'DTX',
        'антицелулитна програма': 'CELL',
        'възстановяване на тялото след бременност': 'PP', 'достатъчно мляко за бебето': 'PP',
        'поддържане': 'MAINT', 'поддържане на теглото': 'MAINT', 'maintenance': 'MAINT'
    };
    var ALL_OF_ABOVE = 'всички горепосочени';

    /** Свободен текст → цели (само добавя към отметките). */
    var TEXT_RULES = [
        [/отсла|свал|килогр|\bкг\b|тегло/, 'LOSS'],
        [/корем|талия|висцерал/, 'VISC'],
        [/мускул|сила|маса/, 'GAIN'],
        [/стяг|оформ|тонус|релеф/, 'TONE'],
        [/целулит|портокал/, 'CELL'],
        [/бръчк|кожа|стареен|младо|антиейдж|дълголет/, 'AGE'],
        [/детокс|прочист/, 'DTX'],
        [/енерги|умор|здрав|захар|кръвно|холестер|храносм|сън|настроен/, 'HLTH']
    ];

    /**
     * Каква цел носи клиничната карта. По-точно от goalMapping в работника:
     * целулитът и коремните мазнини не са „отслабване“ по дефиниция, а
     * саркопенията е мускулна маса — посоката решава профилът.
     */
    var PROTOCOL_GOALS = {
        insulin_resistance: 'Подобряване на здравето',
        autoimmune_aip: 'Подобряване на здравето',
        gi_issues: 'Подобряване на здравето',
        menopause_sarcopenia: 'Мускулна маса',
        cellulite_reduction: 'Антицелулитна програма',
        chronic_stress: 'Подобряване на здравето',
        postpartum_lactation: 'Възстановяване на тялото след бременност',
        visceral_fat: 'Изчистване на коремните мазнини',
        post_smoking: 'Подобряване на здравето',
        longevity: 'Антиейджинг',
        detox: 'Детокс и прочистване'
    };

    var GOAL_NAMES = {
        LOSS: 'отслабване', VISC: 'коремни мазнини', GAIN: 'мускулна маса', TONE: 'стягане',
        HLTH: 'здраве', AGE: 'антиейджинг', DTX: 'детокс', CELL: 'антицелулит',
        PP: 'възстановяване след бременност', MAINT: 'поддържане'
    };

    /** Метаболитни състояния, при които и умереното сваляне на мазнини е лечение. */
    var METABOLIC = ['IR', 'T2D', 'METS', 'NAFLD', 'HTN', 'DYSL', 'CVD', 'PCOS', 'GOUT'];

    var DIRECTION_LABEL = {
        lose: 'сваляне на мазнини', recomp: 'смяна на състава (мазнини надолу, мускули нагоре)',
        gain: 'покачване на мускулна маса', maintain: 'задържане'
    };

    function norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
    function list(v) {
        if (Array.isArray(v)) return v;
        if (v == null || v === '') return [];
        return String(v).split(/[+,;]/);
    }
    function num(v) {
        var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
        return isFinite(n) && n > 0 ? n : null;
    }
    function has(arr, code) { return (arr || []).indexOf(code) !== -1; }
    function r1(v) { return Math.round(v * 10) / 10; }

    /**
     * Всички цели на клиента, по реда на отметките, без повторения.
     * @returns {{ codes: string[], unmapped: string[], fromText: string[] }}
     */
    function readGoals(goal, goalOther) {
        var codes = [];
        var unmapped = [];
        var add = function (c) { if (c && codes.indexOf(c) === -1) codes.push(c); };
        list(goal).forEach(function (raw) {
            var label = norm(raw);
            if (!label || label === 'друго') return;
            if (label === ALL_OF_ABOVE) { add('PP'); add('LOSS'); add('HLTH'); return; }
            if (GOAL_LABELS[label]) add(GOAL_LABELS[label]);
            else unmapped.push(String(raw).trim());
        });
        var fromText = [];
        var text = norm([goalOther].concat(unmapped).join(' '));
        if (text) {
            TEXT_RULES.forEach(function (rule) {
                if (rule[0].test(text) && codes.indexOf(rule[1]) === -1 && fromText.indexOf(rule[1]) === -1) fromText.push(rule[1]);
            });
        }
        fromText.forEach(add);
        return { codes: codes, unmapped: unmapped, fromText: fromText };
    }

    /**
     * Колко излишни мазнини има — от най-точния наличен показател.
     * 0 няма, 1 леко, 2 умерено, 3 затлъстяване, 4 затлъстяване II+.
     */
    function bodyContext(f) {
        var bmi = f.weightKg && f.heightCm ? f.weightKg / Math.pow(f.heightCm / 100, 2) : null;
        var male = f.sex === 'M';
        var waist = num(f.waistCm);
        var bf = num(f.bodyFatPct);
        var older = (f.age || 0) >= 65;
        var byBmi = 0;
        if (bmi != null) {
            // Над 65 г. ИТМ 25–27 не е излишък — малко резерв пази от саркопения.
            var shift = older ? 2 : 0;
            if (bmi >= 35) byBmi = 4;
            else if (bmi >= 30) byBmi = 3;
            else if (bmi >= 27.5 + shift) byBmi = 2;
            else if (bmi >= 25 + shift) byBmi = 1;
        }
        var byWaist = waist == null ? null
            : waist >= (male ? 102 : 88) ? 2 : waist >= (male ? 94 : 80) ? 1 : 0;
        var byFat = bf == null ? null
            : bf >= (male ? 25 : 32) ? 2 : bf >= (male ? 20 : 28) ? 1 : 0;
        // ИТМ не различава мускули от мазнини: при измерени мазнини/талия те решават
        // в зоната 25–30 (мускулест човек с ИТМ 28 и 14% мазнини няма излишък).
        var excess = byBmi;
        if (byBmi <= 2 && (byFat != null || byWaist != null)) {
            excess = Math.max(byFat != null ? byFat : 0, byWaist != null ? byWaist : 0);
            // ИТМ 27,5–30 без измерени мазнини: нормална талия сама не отменя излишъка.
            if (byBmi === 2 && byFat == null) excess = Math.max(excess, 1);
        }
        return {
            bmi: bmi != null ? r1(bmi) : null,
            excess: excess,
            waistRisk: byWaist,
            fatRisk: byFat,
            under: bmi != null && bmi < 18.5,
            lean: bmi != null && bmi < 22 && (byFat == null || byFat === 0),
            older: older
        };
    }

    /** Дефицит (%) по излишъка: леко 10, умерено 15, затлъстяване 18, II+ 20. */
    var DEFICIT_BY_EXCESS = [0, -10, -15, -18, -20];

    /**
     * Посоката за една цел в контекста на тялото.
     * @returns {{ dir: string, pct: number, why: string, lead: string[] }}
     */
    function forGoal(code, b, f) {
        var metabolic = (f.clinical || []).some(function (c) { return METABOLIC.indexOf(c) !== -1; });
        var training = (f.sportDays || 0) >= 2;
        var lose = function (pct, why, lead) { return { dir: 'lose', pct: pct, why: why, lead: lead }; };
        var recomp = function (pct, why, lead) { return { dir: 'recomp', pct: pct, why: why, lead: lead }; };
        var keep = function (why, lead) { return { dir: 'maintain', pct: 0, why: why, lead: lead }; };
        var gain = function (pct, why, lead) { return { dir: 'gain', pct: pct, why: why, lead: lead }; };
        var ex = b.excess;

        // Без ръст/тегло/талия контекстът не може да се прецени — следва се заявеното.
        if (b.bmi == null && b.waistRisk == null && b.fatRisk == null) {
            switch (code) {
                case 'LOSS': return lose(-18, 'заявено отслабване (без данни за тялото)', ['weight', 'waist', 'composition']);
                case 'VISC': return lose(-15, 'коремни мазнини (без данни за тялото)', ['waist', 'weight', 'composition']);
                case 'CELL': return recomp(-5, 'антицелулит (без данни за тялото)', ['composition', 'waist', 'workouts']);
                case 'PP': return f.pregnant ? keep('бременност — без дефицит', ['weight', 'energy']) : lose(-10, 'постепенно възстановяване след бременност', ['weight', 'energy', 'sleep']);
                case 'GAIN': return gain(10, 'заявена мускулна маса (без данни за тялото)', ['weight', 'workouts', 'composition']);
                case 'TONE': return recomp(0, 'стягане (без данни за тялото)', ['composition', 'workouts', 'waist']);
                case 'AGE': return keep('антиейджинг (без данни за тялото)', ['composition', 'sleep', 'glucose']);
                default: return keep('', ['energy', 'sleep', 'digestion']);
            }
        }

        // Поднормено тегло: запасите се възстановяват при всяка цел освен изрично
        // отслабване/корем (там — без дефицит, без натиск към качване; виж LOSS/VISC).
        if (b.under && code !== 'LOSS' && code !== 'VISC' && !(code === 'PP' && f.pregnant)) {
            return gain(10, 'ИТМ под 18,5 — първо възстановяване на запасите', ['weight', 'energy', 'composition']);
        }

        switch (code) {
            case 'LOSS':
                if (b.under) return recomp(0, 'ИТМ под 18,5 — сваляне на тегло не е безопасно; целта е състав и сила', ['composition', 'workouts', 'weight']);
                if (ex >= 1) return lose(DEFICIT_BY_EXCESS[ex], 'излишък на мазнини — умерен дефицит', ['weight', 'waist', 'composition']);
                if (f.lossKg > 0 && f.weightKg && f.heightCm && (f.weightKg - f.lossKg) / Math.pow(f.heightCm / 100, 2) >= 20) {
                    return lose(-10, 'теглото е в норма, а желаното е малко по-ниско — лек дефицит', ['weight', 'waist', 'composition']);
                }
                return recomp(0, 'теглото е в норма — по-добрият резултат е стягане, не по-малко килограми', ['waist', 'composition', 'workouts']);
            case 'VISC':
                if (b.under) return recomp(0, 'ИТМ под 18,5 — без дефицит; движение и състав', ['waist', 'composition']);
                if (ex >= 1 || (b.waistRisk || 0) >= 1) {
                    var lvl = Math.max(ex, b.waistRisk || 0);
                    // Висока талия при нормален ИТМ: мазнините са вътрешни, но запасът е малък — мек дефицит.
                    var vpct = b.bmi != null && b.bmi < 25 ? -10 : DEFICIT_BY_EXCESS[Math.min(lvl, 4)];
                    return lose(vpct, 'коремните мазнини падат с общия дефицит', ['waist', 'weight', 'composition']);
                }
                if (b.waistRisk === 0) return recomp(0, 'талията е в норма — пазим я с движение и белтък', ['waist', 'composition']);
                return recomp(-5, 'без обиколка на талията — лек дефицит и движение; талията решава', ['waist', 'weight']);
            case 'CELL':
                if (ex >= 2) return lose(DEFICIT_BY_EXCESS[ex], 'по-малко мазнини — по-гладка кожа', ['weight', 'waist', 'composition']);
                if (ex === 1) return recomp(-5, 'целулитът е и състав, и задържане на вода — лек дефицит, сила и движение', ['composition', 'waist', 'workouts']);
                return recomp(0, 'целулитът при нормално тегло е съединителна тъкан и вода — без дефицит; сила, белтък, движение', ['composition', 'workouts', 'water']);
            case 'PP':
                if (f.pregnant) return keep('бременност — без дефицит', ['weight', 'energy']);
                if (f.lactating) return ex >= 1 ? lose(-10, 'кърмене — само мек дефицит, за да не пада млякото', ['weight', 'energy', 'sleep']) : keep('кърмене при нормално тегло — енергия за кърмата', ['energy', 'sleep', 'weight']);
                return ex >= 1 ? lose(Math.max(-15, DEFICIT_BY_EXCESS[ex]), 'постепенно връщане към теглото отпреди', ['weight', 'waist', 'energy']) : recomp(0, 'теглото е в норма — възстановяване на мускулния тонус', ['composition', 'energy']);
            case 'AGE':
                if (ex >= 3) return lose(-15, 'затлъстяването ускорява стареенето — свалянето на мазнини е първата стъпка', ['weight', 'waist', 'glucose', 'bp']);
                if (ex === 2) return lose(-10, 'умерен излишък — лек дефицит, без загуба на мускули', ['waist', 'composition', 'glucose']);
                if (ex === 1) return recomp(-5, 'малък излишък — състав, не килограми', ['composition', 'waist', 'sleep']);
                if (b.lean && (f.age || 0) >= 60) return gain(5, 'след 60 г. мускулите са резерв — малък излишък и белтък', ['composition', 'workouts', 'weight']);
                return keep('теглото е в норма — пазим мускулите, съня и захарта', ['composition', 'sleep', 'glucose']);
            case 'TONE':
                if (ex >= 2) return lose(-10, 'първо по-малко мазнини, после форма', ['waist', 'composition', 'workouts']);
                if (ex === 1) return recomp(-5, 'смяна на състава — лек дефицит и сила', ['composition', 'waist', 'workouts']);
                if (b.lean) return recomp(5, 'слабо тяло — малко повече енергия за мускулите', ['composition', 'workouts']);
                return recomp(0, 'смяна на състава при същите калории', ['composition', 'workouts', 'waist']);
            case 'GAIN':
                // Мускулната маса не е задължително повече килограми: при излишък мазнините
                // падат, а мускулите растат на същия или по-лек прием.
                if (ex >= 3) return recomp(-10, 'излишък на мазнини — мускулите растат и при дефицит, ако има сила и белтък', ['composition', 'workouts', 'waist']);
                if (ex === 2) return recomp(-5, 'смяна на състава — без покачване на теглото', ['composition', 'workouts', 'waist']);
                if (ex === 1) return recomp(0, 'смяна на състава при същите калории', ['composition', 'workouts', 'weight']);
                if (!training) return recomp(0, 'без силови тренировки излишъкът отива в мазнини — първо тренировките', ['workouts', 'composition']);
                if (b.under || b.lean) return gain(10, 'слабо тяло — излишък за растеж', ['weight', 'workouts', 'composition']);
                return gain(5, 'чисто покачване — малък излишък', ['composition', 'workouts', 'weight']);
            case 'HLTH':
            case 'DTX':
            case 'MAINT':
                if (b.under) return gain(10, 'ИТМ под 18,5 — възстановяване на запасите', ['weight', 'energy']);
                if (ex >= 3) return lose(DEFICIT_BY_EXCESS[ex], 'затлъстяването е здравен проблем — свалянето на мазнини е част от целта', ['weight', 'waist', 'glucose', 'bp']);
                if (ex === 2 && metabolic) return lose(-10, 'наднормено тегло с метаболитно състояние — 5–10% по-малко тегло подобрява захарта, кръвното и мазнините в кръвта', ['waist', 'weight', 'glucose', 'bp']);
                if (ex >= 1 && metabolic) return recomp(-5, 'метаболитно състояние — лек дефицит и движение', ['waist', 'glucose', 'bp']);
                if (ex === 2) return recomp(-5, 'умерен излишък — лек дефицит без бързане', ['waist', 'composition', 'energy']);
                return keep('теглото е в норма — фокус върху енергия, сън и храносмилане', ['energy', 'sleep', 'digestion']);
            default:
                return keep('', ['weight']);
        }
    }

    var DIR_RANK = { lose: 3, gain: 2, recomp: 1, maintain: 0 };
    var LEAD_ORDER_FALLBACK = ['weight', 'waist', 'composition', 'workouts', 'energy', 'sleep', 'glucose', 'bp', 'digestion', 'water'];

    /**
     * Целевото тегло за фазата „сваляне“: желаното от клиента, но не под ИТМ 20;
     * без желано — горната граница на нормата (27 след 65 г.).
     */
    function targetWeight(f, b) {
        if (!f.weightKg || !f.heightCm) return null;
        var m2 = Math.pow(f.heightCm / 100, 2);
        var floor = r1(20 * m2);
        if (f.lossKg > 0) return Math.max(floor, r1(f.weightKg - f.lossKg));
        var upper = r1((b.older ? 27 : 24.9) * m2);
        return upper < f.weightKg ? upper : null;
    }

    /** Пътната карта: текущата фаза и следващата, с какво се мери краят. */
    function roadmap(dir, codes, f, b) {
        var waistLimit = f.sex === 'M' ? 94 : 80;
        var after = has(codes, 'GAIN') ? 'gain' : (has(codes, 'TONE') || has(codes, 'CELL') || has(codes, 'AGE')) ? 'recomp' : 'maintain';
        var phases = [];
        if (dir === 'lose') {
            var tw = targetWeight(f, b);
            phases.push({ dir: 'lose', label: 'Сваляне на мазнини', until: tw ? { metric: 'weight', value: tw } : { metric: 'waist', value: waistLimit } });
            phases.push({ dir: after, label: after === 'gain' ? 'Мускулна маса' : after === 'recomp' ? 'Стягане и форма' : 'Задържане на резултата' });
        } else if (dir === 'recomp') {
            phases.push({ dir: 'recomp', label: 'Смяна на състава', until: b.excess >= 1 ? { metric: 'waist', value: waistLimit } : null });
            if (has(codes, 'GAIN') && !b.lean) phases.push({ dir: 'gain', label: 'Мускулна маса' });
            else phases.push({ dir: 'maintain', label: 'Задържане на резултата' });
        } else if (dir === 'gain') {
            var m2 = f.heightCm ? Math.pow(f.heightCm / 100, 2) : null;
            phases.push({ dir: 'gain', label: 'Покачване на мускулна маса', until: m2 ? { metric: 'weight', value: r1(24.9 * m2) } : null });
            phases.push({ dir: 'recomp', label: 'Стягане и форма' });
        } else {
            phases.push({ dir: 'maintain', label: 'Задържане и здраве' });
        }
        return phases;
    }

    /**
     * Твърдите граници — клиничната рамка. Те са над целта, над алгоритъма и над AI:
     * никое обсъждане не ги мести (вето).
     * @returns {{ minPct: number, maxPct: number, allowed: string[], reasons: string[] }}
     */
    function hardLimits(f, b) {
        var minPct = -25;
        var maxPct = 15;
        var allowed = ['lose', 'recomp', 'gain', 'maintain'];
        var reasons = [];
        if (f.pregnant) { minPct = 0; allowed = ['maintain', 'gain']; reasons.push('бременност — без дефицит'); }
        if (b.under) { minPct = Math.max(minPct, 0); allowed = allowed.filter(function (d) { return d !== 'lose'; }); reasons.push('ИТМ под 18,5 — без дефицит'); }
        if (f.lactating) { minPct = Math.max(minPct, -10); reasons.push('кърмене — най-много мек дефицит'); }
        if (has(f.behaviors, 'CMP')) { minPct = Math.max(minPct, -10); reasons.push('компенсаторно поведение (гладуване/хапчета) — без голям дефицит'); }
        if (b.excess >= 3) { maxPct = Math.min(maxPct, 0); allowed = allowed.filter(function (d) { return d !== 'gain'; }); reasons.push('затлъстяване — без калориен излишък'); }
        return { minPct: minPct, maxPct: maxPct, allowed: allowed, reasons: reasons };
    }

    /** Посоката трябва да отговаря на приема: дефицит не е „покачване“ и обратно. */
    function consistentDirection(dir, pct, fallback) {
        if (dir === 'lose' && pct >= 0) return pct > 0 ? 'gain' : 'maintain';
        if (dir === 'gain' && pct <= 0) return pct < 0 ? (fallback === 'lose' ? 'lose' : 'recomp') : 'maintain';
        if (dir === 'maintain' && pct <= -8) return 'lose';
        if (dir === 'maintain' && pct >= 5) return 'gain';
        return dir;
    }

    /** Подписът на предложението на алгоритъма — решението на съвета важи само за него. */
    function signatureOf(dir, pct, codes) {
        return dir + '|' + pct + '|' + codes.slice().sort().join(',');
    }

    /**
     * @param {{ goal?: any, goalOther?: string, sex?: 'M'|'F'|'X', age?: number|null, heightCm?: number|null,
     *   weightKg?: number|null, lossKg?: number|null, waistCm?: number|null, bodyFatPct?: number|null,
     *   clinical?: string[], protocol?: string|null, protocolGoal?: string|null, pregnant?: boolean, lactating?: boolean,
     *   sportDays?: number, behaviors?: string[], extraGoals?: string[],
     *   council?: { signature: string, direction: string, intakePct: number, lead?: string[], summary?: string, verdict?: string }|null }} f
     *   extraGoals — цели, които AI е прочел в свободния текст и документите (влизат като отметки);
     *   council — решението от обсъждането между алгоритъма и AI (council.js), валидно
     *   само докато предложението на алгоритъма е същото (подписът съвпада).
     */
    function resolve(f) {
        f = f || {};
        var read = readGoals(f.goal, f.goalOther);
        var codes = read.codes.slice();
        // Клиничната карта носи своя цел — тя е винаги сред целите.
        var protocolGoal = f.protocolGoal || (f.protocol && PROTOCOL_GOALS[f.protocol]) || null;
        if (protocolGoal) readGoals(protocolGoal).codes.forEach(function (c) { if (codes.indexOf(c) === -1) codes.push(c); });
        (f.extraGoals || []).forEach(function (c) { if (GOAL_NAMES[c] && codes.indexOf(c) === -1) codes.push(c); });
        if (codes.length > 1) codes = codes.filter(function (c) { return c !== 'MAINT'; });
        if (!codes.length) codes = ['MAINT'];
        var b = bodyContext(f);
        var per = codes.map(function (c) { var r = forGoal(c, b, f); r.code = c; return r; });

        // Съчетаване: посоките се пресмятат за всяка цел. При противоположни
        // (дефицит за едната, излишък за другата) — смяна на състава по средата.
        var neg = per.filter(function (r) { return r.pct < 0; });
        var pos = per.filter(function (r) { return r.pct > 0; });
        var minNeg = neg.length ? Math.min.apply(null, neg.map(function (r) { return r.pct; })) : 0;
        var maxPos = pos.length ? Math.max.apply(null, pos.map(function (r) { return r.pct; })) : 0;
        var pct = neg.length && pos.length ? Math.round((minNeg + maxPos) / 2) : (minNeg || maxPos);

        // Клиничната рамка е над целта.
        var limits = hardLimits(f, b);
        var frame = [];
        if (pct < limits.minPct || pct > limits.maxPct) frame = limits.reasons.slice();
        pct = Math.max(limits.minPct, Math.min(limits.maxPct, pct));

        // Целите са съгласни за посоката — тя е; иначе по съчетания прием.
        var anyRecomp = per.some(function (r) { return r.dir === 'recomp'; });
        var same = per.every(function (r) { return r.dir === per[0].dir; });
        var dir = same ? per[0].dir
            : pct <= -8 && !pos.length ? 'lose' : pct >= 5 && !neg.length ? 'gain'
            : (anyRecomp || (neg.length && pos.length)) ? 'recomp' : 'maintain';
        // Рамката може да е махнала дефицита/излишъка (бременност, поднормено тегло).
        if (dir === 'lose' && pct >= 0) dir = 'maintain';
        if (dir === 'gain' && pct <= 0) dir = 'maintain';
        if (limits.allowed.indexOf(dir) === -1) dir = limits.allowed.indexOf('recomp') !== -1 ? 'recomp' : 'maintain';
        var algorithm = { direction: dir, intakePct: pct, signature: signatureOf(dir, pct, codes) };

        // Решението на съвета (алгоритъм + AI): важи, докато предложението е същото.
        // Твърдите граници се проверяват наново — и прочетено от записа, решението не ги мести.
        var council = f.council && f.council.signature === algorithm.signature ? f.council : null;
        if (council) {
            pct = Math.max(limits.minPct, Math.min(limits.maxPct, Math.round(Number(council.intakePct) || 0)));
            var cdir = limits.allowed.indexOf(council.direction) !== -1 ? council.direction : dir;
            dir = consistentDirection(cdir, pct, dir);
        }

        // Основната цел — тази, чиято посока води; при равенство — по реда на отметките.
        var primary = per.slice().sort(function (a, c) {
            var am = a.dir === dir ? 1 : 0;
            var cm = c.dir === dir ? 1 : 0;
            if (am !== cm) return cm - am;
            return Math.abs(c.pct) - Math.abs(a.pct);
        })[0];

        // Водещите показатели: клиничните отпред, после на основната цел, после на останалите.
        var lead = [];
        var push = function (m) { if (m && lead.indexOf(m) === -1) lead.push(m); };
        if ((f.clinical || []).some(function (c) { return c === 'IR' || c === 'T2D'; })) push('glucose');
        if ((f.clinical || []).some(function (c) { return c === 'HTN' || c === 'CVD'; })) push('bp');
        if (council && council.lead) council.lead.filter(function (m) { return LEAD_ORDER_FALLBACK.indexOf(m) !== -1; }).forEach(push);
        primary.lead.forEach(push);
        per.forEach(function (r) { r.lead.forEach(push); });
        if (dir === 'recomp' || dir === 'gain') push('workouts');
        LEAD_ORDER_FALLBACK.forEach(function (m) { if (lead.length < 4) push(m); });

        var phases = roadmap(dir, codes, f, b);
        // Мотивите стигат до текстовете за клиента — обсъждането остава вътрешно (council.summary).
        var reasons = [primary.why].concat(per.filter(function (r) { return r !== primary && r.why && r.dir !== primary.dir; }).map(function (r) { return GOAL_NAMES[r.code] + ': ' + r.why; })).concat(frame).filter(Boolean);

        return {
            codes: codes,
            primary: primary.code,
            fromText: read.fromText,
            direction: dir,
            directionLabel: DIRECTION_LABEL[dir],
            intakePct: pct,
            body: b,
            lead: lead,
            phases: phases,
            reasons: reasons,
            perGoal: per.map(function (r) { return { code: r.code, dir: r.dir, pct: r.pct }; }),
            limits: limits,
            algorithm: algorithm,
            council: council ? { verdict: council.verdict || 'accepted', summary: council.summary || '' } : null
        };
    }

    var api = {
        resolve: resolve,
        readGoals: readGoals,
        bodyContext: bodyContext,
        hardLimits: hardLimits,
        consistentDirection: consistentDirection,
        LEAD_METRICS: LEAD_ORDER_FALLBACK,
        GOAL_NAMES: GOAL_NAMES,
        PROTOCOL_GOALS: PROTOCOL_GOALS,
        DIRECTION_LABEL: DIRECTION_LABEL
    };
    global.NutriPlanGoalModel = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
