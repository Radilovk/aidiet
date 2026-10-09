/**
 * Анализ на клиента без AI — от кода на профила и енергийния договор.
 *
 * Всичко, което страницата „Анализ“ показва и от което планът зависи, се
 * извежда по правила: проблемите, здравната оценка, прогнозите, водата и
 * нуждите. AI може по желание да преразкаже текстовете по-живо, но анализът е
 * пълен и валиден и без него — грешка в AI вече не спира плана.
 */

import { compileProfile } from './profile-code.js';
import { referenceWeightKg, proteinPerKg } from './macro-targets.js';

const SEVERITY_BANDS = [
  ['Critical', 80],
  ['Risky', 60],
  ['Borderline', 45],
];

function severityFor(value) {
  for (const [label, min] of SEVERITY_BANDS) if (value >= min) return label;
  return 'Normal';
}

function problem(category, severityValue, title, description, impact, improvement) {
  const sv = Math.max(45, Math.min(95, Math.round(severityValue)));
  return { title, description, severity: severityFor(sv), severityValue: sv, category, impact, _improvement: improvement };
}

export function bmiOf(profile) {
  const w = Number(profile.weightKg) || 0;
  const h = Number(profile.heightCm) || 0;
  if (!w || !h) return null;
  return Math.round((w / ((h / 100) ** 2)) * 10) / 10;
}

export function bmiCategory(bmi) {
  if (bmi == null) return '';
  if (bmi < 18.5) return 'Поднормено тегло';
  if (bmi < 25) return 'Нормално тегло';
  if (bmi < 30) return 'Наднормено тегло';
  if (bmi < 35) return 'Затлъстяване I степен';
  if (bmi < 40) return 'Затлъстяване II степен';
  return 'Затлъстяване III степен';
}

/** Дневна нужда от вода — 33 мл/кг, +0,5 л при редовен спорт. */
export function waterNeedLiters(profile) {
  const w = Number(profile.weightKg) || 70;
  const base = w * 0.033 + ((profile.activity?.sportBand || 0) >= 2 ? 0.5 : 0);
  return Math.round(Math.min(4, Math.max(1.5, base)) * 10) / 10;
}

const has = (list, code) => Array.isArray(list) && list.includes(code);

/**
 * Каталог на проблемите — всяко правило чете кодове, не текст.
 * Тежестта следва скалата на анализа: Borderline 45–59, Risky 60–79, Critical 80–95.
 */
function detectProblems(profile) {
  const out = [];
  const b = profile.behaviors || [];
  const c = profile.clinical || [];
  const bmi = bmiOf(profile);

  if (bmi != null) {
    if (bmi >= 35) {
      out.push(problem('Medical', 84, `Затлъстяване (ИТМ ${bmi})`,
        'Телесната маса е значително над здравословния диапазон и натоварва ставите, сърцето и обмяната на веществата.',
        'Повишен риск от инсулинова резистентност, хипертония и възпаление.',
        'По-ниско кръвно налягане и по-стабилна кръвна захар с всеки свален килограм'));
    } else if (bmi >= 30) {
      out.push(problem('Medical', 72, `Затлъстяване I степен (ИТМ ${bmi})`,
        'Теглото е над здравословния диапазон, а мастната тъкан активно влияе на хормоните и апетита.',
        'По-висок риск от метаболитен синдром и умора при натоварване.',
        'Подобрена инсулинова чувствителност и повече енергия'));
    } else if (bmi >= 25 && ['LOSS', 'VISC', 'TONE'].includes(profile.goal)) {
      out.push(problem('Nutrition', 52, `Наднормено тегло (ИТМ ${bmi})`,
        'Теглото е леко над здравословния диапазон — добрата новина е, че умерен дефицит дава видим резултат.',
        'Натрупване на висцерални мазнини при запазване на навиците.',
        'Стегнато тяло и по-ниска талия'));
    } else if (bmi < 18.5) {
      out.push(problem('Medical', 66, `Поднормено тегло (ИТМ ${bmi})`,
        'Телесната маса е под здравословния диапазон — запасите от енергия и мускули са малки.',
        'Риск от хормонални нарушения, отслабен имунитет и загуба на костна плътност.',
        'Възстановени запаси и по-силен имунитет'));
    }
  }

  const sleep = Number(profile.sleepHours);
  if (sleep > 0 && sleep < 7) {
    const sv = (sleep < 5 ? 82 : sleep < 6 ? 68 : 50) + (profile.sleepInterrupted ? 6 : 0);
    out.push(problem('Sleep', sv, 'Недостатъчен сън',
      `Средно около ${sleep} часа сън${profile.sleepInterrupted ? ' с прекъсвания' : ''} — под 7-те часа, нужни за възстановяване.`,
      'Повишен грелин и кортизол: повече апетит за сладко и по-трудно отслабване.',
      'По-малко желание за сладко и по-добро възстановяване'));
  } else if (profile.sleepInterrupted) {
    out.push(problem('Sleep', 50, 'Прекъсван сън',
      'Сънят е с достатъчна продължителност, но прекъсванията намаляват дълбоките фази.',
      'По-слабо възстановяване и повече умора през деня.',
      'По-дълбок сън и повече енергия сутрин'));
  }

  if (profile.stress === 3) {
    const emotional = has(b, 'EMO');
    out.push(problem('Stress', emotional ? 72 : 64, emotional ? 'Стрес и емоционално хранене' : 'Високо ниво на стрес',
      emotional
        ? 'Стресът е тригер за хранене — храната се използва за успокояване, не само от глад.'
        : 'Хроничният стрес поддържа висок кортизол през деня.',
      'Задържане на мазнини в коремната област и прекъсване на дефицита.',
      'Спокойни хранения без хранене „по навик“'));
  } else if (has(b, 'EMO')) {
    out.push(problem('Stress', 56, 'Емоционално хранене',
      'Ситуации като скука, напрежение или тъга отключват желание за храна.',
      'Непланирани калории, които изместват дефицита.',
      'Хранене по глад, не по настроение'));
  }

  if (has(b, 'CMP')) {
    out.push(problem('Stress', 82, 'Компенсиране чрез гладуване или хапчета',
      'След преяждане следва гладуване или хапчета — цикъл, който поддържа преяждането.',
      'Риск от нарушено хранително поведение и загуба на мускулна маса.',
      'Спокоен, предвидим режим без цикли глад–преяждане'));
  }
  if (has(b, 'OVR')) {
    out.push(problem('Nutrition', 66, 'Често преяждане',
      'Количествата често надхвърлят планираното.',
      'Калорийният дефицит се губи в рамките на 1–2 хранения.',
      'Ясни порции и по-голяма ситост с по-малко калории'));
  }

  const need = waterNeedLiters(profile);
  if (profile.waterL != null && profile.waterL < need - 0.4) {
    const gap = Math.round((need - profile.waterL) * 10) / 10;
    out.push(problem('Hydration', profile.waterL < 1 ? 66 : 52, 'Недостатъчен прием на вода',
      `Около ${profile.waterL} л дневно при нужда от ${need} л — недостиг ${gap} л.`,
      'Жаждата се бърка с глад, а метаболизмът на мазнините се забавя.',
      'По-малко фалшив глад и по-добра енергия'));
  }

  if (has(b, 'SDR')) {
    out.push(problem('Nutrition', 64, 'Сладки напитки',
      'Соковете и газираните напитки носят калории, които не засищат.',
      'Скокове на кръвната захар и скрити калории.',
      'Стабилна кръвна захар без скрити калории'));
  }
  if (has(b, 'ALC')) {
    out.push(problem('Nutrition', 62, 'Чест алкохол',
      'Алкохолът е концентрирана енергия и спира изгарянето на мазнини, докато се метаболизира.',
      'По-бавно отслабване и по-лош сън.',
      'По-качествен сън и по-бързо отслабване'));
  }
  if (has(b, 'SWT') || has(b, 'SWS')) {
    out.push(problem('Nutrition', has(c, 'IR') || has(c, 'T2D') ? 68 : 55, 'Силно желание за сладко',
      'Сладкото присъства като навик между храненията.',
      'Колебания в кръвната захар, които поддържат глада.',
      'По-рядко желание за сладко'));
  }
  if (has(b, 'FASTF') || has(b, 'SALT') || has(b, 'DOUGH')) {
    out.push(problem('Nutrition', 52, 'Преработени храни',
      'Тестени, солени и бързи храни се търсят често.',
      'Много калории и сол при малко фибри и протеин.',
      'Повече ситост от истинска храна'));
  }

  const band = profile.activity?.sportBand || 0;
  if (band === 0) {
    out.push(problem('Activity', profile.activity?.daily === 1 ? 64 : 52, 'Ниска физическа активност',
      'Липсва редовно натоварване — мускулите не получават сигнал да се запазят.',
      'При дефицит се губи и мускулна маса, а обмяната се забавя.',
      'Запазена мускулна маса и по-бърза обмяна'));
  }

  if (has(b, 'NBF') && has(b, 'EVE')) {
    out.push(problem('Nutrition', 54, 'Хранене предимно вечер',
      'Денят започва без храна, а основното количество е вечер.',
      'Силен глад вечер и по-лош сън.',
      'Равномерна енергия през деня'));
  } else if (has(b, 'IRR') || has(b, 'RUSH') || has(b, 'TV')) {
    out.push(problem('Nutrition', 48, 'Хаотичен хранителен ритъм',
      'Храненията са на крак, пред екран или на периоди.',
      'Сигналите за ситост закъсняват и се изяжда повече.',
      'Осъзнато хранене и навреме усетена ситост'));
  }

  const medical = [
    ['IR', 74, 'Инсулинова резистентност', 'Клетките реагират по-слабо на инсулин и захарта остава по-дълго в кръвта.', 'Склонност към натрупване на мазнини и глад след въглехидрати.', 'По-стабилна кръвна захар'],
    ['T2D', 78, 'Диабет тип 2', 'Кръвната захар изисква внимателен контрол на въглехидратите във всяко хранене.', 'Риск от усложнения при колебания на захарта.', 'По-добър гликемичен контрол'],
    ['METS', 74, 'Метаболитен синдром', 'Комбинация от коремни мазнини, кръвно, захар и липиди.', 'Повишен сърдечно-съдов риск.', 'По-добри стойности на кръвно, захар и липиди'],
    ['NAFLD', 70, 'Мастен черен дроб', 'Натрупване на мазнини в черния дроб, свързано с храненето.', 'Възпаление и влошена обмяна.', 'Разтоварен черен дроб'],
    ['HTN', 68, 'Високо кръвно налягане', 'Изисква контрол на солта и повече калий от зеленчуци.', 'Натоварване на сърцето и съдовете.', 'По-ниско кръвно налягане'],
    ['DYSL', 64, 'Повишени липиди', 'Холестеролът или триглицеридите са над нормата.', 'Сърдечно-съдов риск.', 'По-добър липиден профил'],
    ['PCOS', 66, 'СПКЯ', 'Хормонален дисбаланс, свързан с инсулина.', 'По-трудно отслабване и нередовен цикъл.', 'По-добър хормонален баланс'],
    ['HYPO', 62, 'Намалена функция на щитовидната жлеза', 'Обмяната е по-бавна — дефицитът е по-умерен, а белтъкът по-висок.', 'По-бавно отслабване и умора.', 'Повече енергия при стабилна обмяна'],
    ['IBD', 70, 'Възпалително чревно заболяване', 'Храносмилането изисква щадящи, лесно смилаеми храни.', 'Риск от недостиг на нутриенти.', 'По-спокойно храносмилане'],
    ['IBS', 60, 'Раздразнено черво', 'Някои ферментиращи храни предизвикват подуване и дискомфорт.', 'Избягване на храни и непълноценно хранене.', 'По-малко подуване'],
    ['GI', 56, 'Храносмилателен дискомфорт', 'Храносмилането реагира на определени храни.', 'Дискомфорт след хранене.', 'По-леко храносмилане'],
    ['GERD', 56, 'Рефлукс', 'Обилни и късни хранения засилват киселините.', 'Дискомфорт и нарушен сън.', 'По-малко киселини'],
    ['ANEM', 62, 'Анемия', 'Нужно е повече желязо и витамин C за усвояването му.', 'Умора и задух при натоварване.', 'Повече енергия'],
    ['GOUT', 60, 'Подагра', 'Пурините от червено месо и алкохол трябва да са ограничени.', 'Пристъпи и болки в ставите.', 'По-малко пристъпи'],
    ['OSTEO', 58, 'Намалена костна плътност', 'Нужни са калций, витамин D и достатъчно белтък.', 'Риск от фрактури.', 'По-здрави кости'],
    ['DEP', 56, 'Понижено настроение', 'Настроението влияе на апетита и мотивацията.', 'Трудно придържане към плана.', 'По-стабилно настроение'],
    ['ANX', 54, 'Тревожност', 'Тревожността често отключва хранене за успокояване.', 'Непланирани хранения.', 'По-голямо спокойствие около храната'],
    ['INFL', 56, 'Хронично възпаление', 'Нужни са омега-3, зеленчуци и по-малко преработени храни.', 'Умора и бавно възстановяване.', 'По-ниско възпаление'],
  ];
  for (const [code, sv, title, desc, impact, improvement] of medical) {
    if (has(c, code)) out.push(problem('Medical', sv, title, desc, impact, improvement));
  }

  return out.sort((a, b2) => b2.severityValue - a.severityValue);
}

/**
 * Превантивни точки — когато реалните проблеми са под три. Ниска тежест:
 * не са проблем днес, а мястото, където планът най-лесно би се разпаднал.
 */
function preventiveProblems(profile) {
  const out = [];
  if (['LOSS', 'VISC', 'TONE', 'CELL'].includes(profile.goal)) {
    out.push(problem('Nutrition', 48, 'Запазване на мускулите при дефицит',
      'При калориен дефицит тялото губи и мускули, ако белтъкът и натоварването са недостатъчни.',
      'По-бавна обмяна и ефект „йо-йо“ след диетата.',
      'Отслабване от мазнини, не от мускули'));
  }
  if (profile.diet?.pattern === 'vegan' || profile.diet?.pattern === 'vegetarian') {
    out.push(problem('Nutrition', 50, 'Риск от недостиг на B12 и желязо',
      'Растителното хранене изисква внимание към витамин B12, желязото и омега-3.',
      'Умора и анемия при дълъг недостиг.',
      'Пълноценно растително хранене'));
  }
  if (profile.diet?.style === 'keto' || profile.diet?.style === 'low_carb') {
    out.push(problem('Nutrition', 48, 'Фибри и електролити при малко въглехидрати',
      'При ограничени въглехидрати фибрите, магнезият и натрият лесно падат.',
      'Запек, умора и главоболие в първите седмици.',
      'Леко адаптиране към диетата'));
  }
  out.push(problem('Nutrition', 46, 'Разнообразие на храненето',
    'Устойчивият резултат зависи от разнообразни зеленчуци, протеини и източници на фибри.',
    'Монотонно хранене води до отказ от плана.',
    'Хранене, което се спазва дълго'));
  out.push(problem('Activity', 45, 'Ежедневно движение',
    'Освен тренировките, дневните стъпки определят голяма част от разхода на енергия.',
    'По-нисък разход при отслабване.',
    'По-висок дневен разход на енергия'));
  return out;
}

function healthScore(problems, profile) {
  let score = 92;
  for (const p of problems) score -= Math.max(0, p.severityValue - 40) * 0.32;
  if ((profile.age || 0) >= 60) score -= 3;
  return Math.max(25, Math.min(92, Math.round(score)));
}

function healthDescription(score, problems, profile) {
  const top = problems.slice(0, 2).map(p => p.title.toLowerCase());
  const strengths = [];
  if ((profile.activity?.sportBand || 0) >= 2) strengths.push('редовно движение');
  if (Number(profile.sleepHours) >= 7) strengths.push('достатъчен сън');
  if (profile.waterL != null && profile.waterL >= 2) strengths.push('добра хидратация');
  const level = score >= 75 ? 'добро' : score >= 55 ? 'средно' : 'с нужда от внимание';
  const parts = [`Общото състояние е ${level}.`];
  if (top.length) parts.push(`Най-голямо влияние имат ${top.join(' и ')}.`);
  if (strengths.length) parts.push(`Силни страни: ${strengths.join(', ')}.`);
  return parts.join(' ');
}

/** Реалистично темпо (кг/седмица) според темпото в кода. */
function weeklyLossKg(profile) {
  return [0, 0.4, 0.55, 0.7][profile.pace || 0] || 0.5;
}

function forecasts(profile, problems) {
  const w = Number(profile.weightKg) || 0;
  const target = Number(profile.targetWeightKg) || w;
  const losing = ['LOSS', 'VISC'].includes(profile.goal) && target < w;
  const gaining = profile.goal === 'GAIN';
  const risks = problems.map(p => p.impact).filter(Boolean);
  const improvements = problems.map(p => p._improvement).filter(Boolean);
  while (risks.length < 3) risks.push(['Постепенно покачване на теглото', 'Спад на енергията', 'По-бавна обмяна с възрастта'][risks.length]);
  while (improvements.length < 3) improvements.push(['Повече енергия през деня', 'По-добро храносмилане', 'Устойчиви хранителни навици'][improvements.length]);

  let weight = 'Стабилно тегло с по-добра композиция';
  if (losing) {
    const weeks = Math.ceil((w - target) / weeklyLossKg(profile));
    weight = `−${Math.round((w - target) * 10) / 10} кг (до ~${target} кг) за около ${weeks} седмици`;
  } else if (gaining) {
    weight = '+2–4 кг чиста маса за 12 месеца';
  }
  return {
    forecastPessimistic: {
      timeframe: '12 месеца',
      weight: losing || gaining ? `${w ? `~${Math.round(w + 3)} кг` : '+2–4 кг'} при запазване на навиците` : 'Бавно покачване на теглото',
      health: 'Без промяна в навиците рисковите фактори се задълбочават.',
      risks: risks.slice(0, 5),
    },
    forecastOptimistic: {
      timeframe: '12 месеца',
      weight,
      health: 'При придържане към плана обмяната, сънят и енергията се подобряват.',
      improvements: improvements.slice(0, 5),
    },
  };
}

function nutritionalNeeds(profile, macroGrams) {
  const needs = [];
  const protein = Math.round(Number(macroGrams?.protein) || referenceWeightKg(profile) * proteinPerKg(profile));
  needs.push(`Протеин ~${protein} г дневно, разпределен във всяко хранене`);
  needs.push('Фибри 25–35 г дневно от зеленчуци, бобови и пълнозърнести');
  const c = profile.clinical || [];
  const pattern = profile.diet?.pattern;
  if (pattern === 'vegan') needs.push('Витамин B12, желязо, цинк и омега-3 (ALA/водорасли)');
  else if (pattern === 'vegetarian') needs.push('Желязо и витамин B12');
  if (has(c, 'ANEM')) needs.push('Желязо заедно с витамин C за по-добро усвояване');
  if (has(c, 'OSTEO') || has(c, 'MENO') || (profile.age || 0) >= 55) needs.push('Калций и витамин D за костите');
  if (has(c, 'IR') || has(c, 'T2D') || has(c, 'PCOS') || has(c, 'METS')) needs.push('Магнезий и фибри за инсулиновата чувствителност');
  if (has(c, 'HTN')) needs.push('Калий от зеленчуци и под 5 г сол дневно');
  if (has(c, 'HYPO')) needs.push('Селен и цинк от риба, яйца и ядки');
  if (has(c, 'INFL') || has(c, 'AI') || has(c, 'DYSL')) needs.push('Омега-3 от мазна риба 2–3 пъти седмично');
  if (profile.protocol === 'postpartum_lactation' || profile.goal === 'PP') needs.push('Допълнителни ~400 kcal, желязо, йод и DHA при кърмене');
  return needs.slice(0, 6);
}

function healthRisks(problems) {
  return problems.filter(p => p.severity !== 'Borderline').map(p => p.impact).slice(0, 4);
}

function successChance(profile, problems) {
  let chance = 72;
  for (const p of problems) chance -= p.severity === 'Critical' ? 9 : p.severity === 'Risky' ? 5 : 2;
  if ((profile.activity?.sportBand || 0) >= 2) chance += 5;
  if ((profile.pace || 0) === 3) chance -= 5;
  return Math.max(15, Math.min(90, Math.round(chance)));
}

function physiologicalPhase(profile) {
  const age = profile.age || 0;
  if (profile.protocol === 'postpartum_lactation' || profile.goal === 'PP' || has(profile.clinical, 'PP')) return 'След раждане';
  if (profile.sex === 'F') {
    if (has(profile.clinical, 'MENO') || age >= 52) return 'Менопауза';
    if (age >= 42) return 'Перименопауза';
    return 'Репродуктивна възраст';
  }
  if (age >= 60) return 'Зряла възраст — фокус върху мускулната маса';
  return 'Активна зряла възраст';
}

function psychologicalProfile(profile) {
  const b = profile.behaviors || [];
  const lines = [];
  if (has(b, 'EMO')) lines.push('храната понякога регулира емоциите');
  if (has(b, 'OVR')) lines.push('количествата често излизат над планираното');
  if (has(b, 'SWT') || has(b, 'SWS')) lines.push('сладкото е навик между храненията');
  if (has(b, 'CMP')) lines.push('след преяждане следва компенсиране');
  if (has(b, 'IRR')) lines.push('режимът е на периоди');
  if (!lines.length) return 'Стабилни хранителни навици без изразени емоционални тригери — фокусът е върху структура и порции.';
  return `Профилът показва, че ${lines.join(', ')}. Планът залага на предвидими хранения, достатъчно протеин и ситост, за да намали тези тригери.`;
}

/**
 * @param {object} userData отговорите от въпросника
 * @param {{ bmr?: number, tdee?: number, Final_Calories?: number, macroGrams?: object, macroRatios?: object }} [energy]
 */
export function buildDeterministicAnalysis(userData = {}, energy = {}) {
  const profile = compileProfile(userData || {});
  const real = detectProblems(profile);
  const score = healthScore(real, profile);
  const all = real.length >= 3
    ? real
    : [...real, ...preventiveProblems(profile).filter(p => !real.some(r => r.title === p.title))].slice(0, 3);
  const keyProblems = all.slice(0, 6).map(({ _improvement, ...p }) => p);
  const bmi = bmiOf(profile);
  const need = waterNeedLiters(profile);
  const current = profile.waterL;

  return {
    bmi,
    bmiCategory: bmiCategory(bmi),
    bmr: energy.bmr,
    tdee: energy.tdee,
    Final_Calories: energy.Final_Calories,
    recommendedCalories: energy.Final_Calories,
    macroRatios: energy.macroRatios,
    macroGrams: energy.macroGrams,
    physiologicalPhase: physiologicalPhase(profile),
    waterDeficit: {
      dailyNeed: `${need} л`,
      currentIntake: current != null ? `${current} л` : 'не е посочен',
      deficit: current != null ? `${Math.max(0, Math.round((need - current) * 10) / 10)} л` : '—',
      impactOnLipolysis: current != null && current < need - 0.4
        ? 'Недостигът на вода забавя използването на мазнини и засилва фалшивия глад.'
        : 'Хидратацията е достатъчна за нормална обмяна.',
    },
    keyProblems,
    currentHealthStatus: {
      score,
      description: healthDescription(score, real, profile),
      keyIssues: keyProblems.slice(0, 4).map(p => p.title),
    },
    ...forecasts(profile, all),
    nutritionalNeeds: nutritionalNeeds(profile, energy.macroGrams),
    healthRisks: healthRisks(real),
    psychologicalProfile: psychologicalProfile(profile),
    successChance: successChance(profile, real),
    correctedMetabolism: {
      realBMR: energy.bmr,
      realTDEE: energy.tdee,
      clinicalAdjustmentPercent: 0,
      metabolicAdjustmentPercent: 0,
      goalAdjustmentPercent: 0,
    },
    _deterministicAnalysis: true,
  };
}

/** Текстовите полета, които AI може да преразкаже — нищо друго. */
const AI_TEXT_FIELDS = [
  'psychologicalProfile', 'psychoProfile', 'holisticSummary', 'metabolicProfile',
];

/**
 * Слива по желание AI текста върху детерминистичния анализ. Числата, проблемите,
 * оценката и прогнозите остават от правилата; AI добавя само описания.
 */
export function mergeAnalysisNarrative(base, ai) {
  if (!ai || typeof ai !== 'object' || ai.error) return base;
  for (const key of AI_TEXT_FIELDS) {
    if (ai[key] && (typeof ai[key] === 'string' ? ai[key].trim() : true)) base[key] = ai[key];
  }
  if (typeof ai.currentHealthStatus?.description === 'string' && ai.currentHealthStatus.description.trim()) {
    base.currentHealthStatus.description = ai.currentHealthStatus.description;
  }
  base._aiNarrative = true;
  return base;
}
