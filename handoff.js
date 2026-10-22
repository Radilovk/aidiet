/**
 * Предаване на данни от модулите към NutriPlan (handoff).
 *
 * NutriPlan е главният профил. Модулите (EmoEat, AIRIS — ирисов анализ)
 * водят към него и му предават обобщение на своя резултат; обратно към тях
 * не тръгват никакви данни. Пратката се пази на сървъра под еднократен,
 * неотгатваем ключ и до 30 дни; NutriPlan я прибира в профила само със
 * съгласие на клиента и я изтрива.
 *
 * Тук са правилата: какво се приема от всеки модул (бял списък с граници),
 * как става на факти за обогатяването и как попълва въпросника.
 */

export const HANDOFF_TTL_SEC = 30 * 24 * 60 * 60;
export const HANDOFF_MAX_BYTES = 48 * 1024;

const str = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().replace(/\s+/g, ' ').slice(0, max) : '');
const list = (v, max = 12, len = 160) => (Array.isArray(v) ? v.map(x => str(x, len)).filter(Boolean).slice(0, max) : []);
const numIn = (v, lo, hi) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const isoOr = (v, fallback) => (Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : fallback);

function normalizeEmoeat(p) {
  if (!p || typeof p !== 'object') return null;
  const level = (v) => (['Слабо', 'Осезаемо', 'Силно'].includes(v) ? v : null);
  const profile = {
    intensity: level(p.intensity),
    archetype: p.archetype && typeof p.archetype === 'object' ? { name: str(p.archetype.name, 60), description: str(p.archetype.description, 300) } : null,
    secondArchetype: str(p.secondArchetype, 60) || null,
    drivers: list(p.drivers, 3, 60),
    behaviors: (Array.isArray(p.behaviors) ? p.behaviors : []).slice(0, 8)
      .map(b => ({ name: str(b?.name, 60), level: level(b?.level) || 'Слабо' })).filter(b => b.name),
    patterns: list(p.patterns, 4, 80),
    bodySignals: str(p.bodySignals, 300),
    realNeed: str(p.realNeed, 200),
    reliability: p.reliability && typeof p.reliability === 'object' ? { level: str(p.reliability.level, 20) } : null,
  };
  return profile.intensity || profile.archetype ? profile : null;
}

const AIRIS_GENDER = { male: 'Мъж', female: 'Жена' };
// Състоянията от въпросника на AIRIS → еднозначните отговори в NutriPlan (останалите — в бележките).
const AIRIS_HEALTH = {
  'Диабет 2 тип': 'Диабет / Инсулинова резистентност', 'Инсулинова резистентност': 'Диабет / Инсулинова резистентност',
  'Хипертония': 'Сърдечно-съдови заболявания', 'Автоимунен тиреоидит': 'Щитовидна жлеза (Хашимото и др.)', 'Менопауза': 'Менопауза',
};
const HYPERTENSION_OPTION = 'Хипертония (високо кръвно налягане)';

function normalizeAiris(p) {
  if (!p || typeof p !== 'object') return null;
  const q = p.questionnaire && typeof p.questionnaire === 'object' ? p.questionnaire : {};
  const a = p.analysis && typeof p.analysis === 'object' ? p.analysis : {};
  const questionnaire = {
    name: str(q.name, 60),
    age: numIn(q.age, 10, 110),
    gender: AIRIS_GENDER[q.gender] ? q.gender : null,
    weight: numIn(q.weight, 30, 300),
    height: numIn(q.height, 120, 230),
    goals: list(q.goals, 8, 60),
    activityLevel: ['sedentary', 'light', 'moderate', 'active', 'very-active'].includes(q.activityLevel) ? q.activityLevel : null,
    stressLevel: ['low', 'moderate', 'high', 'very-high'].includes(q.stressLevel) ? q.stressLevel : null,
    sleepHours: numIn(q.sleepHours, 2, 14),
    sleepQuality: ['poor', 'fair', 'good', 'excellent'].includes(q.sleepQuality) ? q.sleepQuality : null,
    hydration: numIn(q.hydration, 0, 20),
    dietaryProfile: list(q.dietaryProfile, 8, 60),
    dietaryHabits: list(q.dietaryHabits, 8, 60),
    foodIntolerances: str(q.foodIntolerances, 300),
    allergies: str(q.allergies, 300),
    medications: str(q.medications, 400),
    medicalConditions: str(q.medicalConditions, 400),
    complaints: str(q.complaints, 600),
    healthStatus: list(q.healthStatus, 10, 60),
  };
  const analysis = {
    constitution: str(a.constitution, 200),
    summary: str(a.summary, 700),
    systems: (Array.isArray(a.systems) ? a.systems : []).slice(0, 10).map(s => ({
      key: str(s?.key, 30), label: str(s?.label, 60), score: numIn(s?.score, 0, 100), priority: !!s?.priority,
    })).filter(s => s.key),
    drivers: (Array.isArray(a.drivers) ? a.drivers : []).slice(0, 10).map(d => ({
      system: str(d?.system, 30), strength: ['high', 'medium', 'low'].includes(d?.strength) ? d.strength : 'low',
      observation: str(d?.observation, 240), action: str(d?.action, 240), source: ['questionnaire', 'iris', 'both'].includes(d?.source) ? d.source : 'iris',
    })).filter(d => d.action || d.observation),
    eatMore: list(a.eatMore, 15, 80),
    eatLess: list(a.eatLess, 15, 80),
    supplements: (Array.isArray(a.supplements) ? a.supplements : []).slice(0, 8).map(s => ({ name: str(s?.name, 80), dosage: str(s?.dosage, 60) })).filter(s => s.name),
    recommendedTests: list(a.recommendedTests, 10, 120),
    notices: (Array.isArray(a.notices) ? a.notices : []).slice(0, 6).map(n => ({ level: n?.level === 'critical' ? 'critical' : 'caution', title: str(n?.title, 100), body: str(n?.body, 300) })).filter(n => n.title),
    eyeReferral: ['none', 'routine', 'soon', 'urgent'].includes(a.eyeReferral) ? a.eyeReferral : 'none',
  };
  if (!analysis.systems.length && !analysis.drivers.length && !analysis.summary) return null;
  return { questionnaire, analysis };
}

// Тестовете на сайтовете (daotslabna.com, life-protocols.com) — отговорите и препоръчаният протокол.
export const SITE_SOURCES = { daotslabna: 'daotslabna.com', lifeprotocols: 'life-protocols.com' };
const pick = (v, allowed) => (allowed.includes(v) ? v : null);
const pickList = (v, allowed) => (Array.isArray(v) ? [...new Set(v.filter(x => allowed.includes(x)))].slice(0, 12) : []);
const SITE_CONDITIONS = ['hypertension', 'diabetes', 'thyroid', 'autoimmune', 'kidney', 'liver', 'cardiovascular', 'pregnancy', 'breastfeeding', 'none', 'other'];
const SITE_MEDS = ['anticoagulants', 'statins', 'ssri', 'hormone_therapy', 'thyroid_meds', 'none', 'other'];
const SITE_ALLERGIES = ['shellfish', 'soy', 'gluten', 'lactose', 'nuts', 'none', 'other'];
const SITE_SYMPTOMS = ['fatigue', 'cravings', 'poor_sleep', 'joint_pain', 'concentration', 'cramps', 'hair_nails', 'none', 'other'];

function normalizeSiteQuiz(raw) {
  const a = raw.answers && typeof raw.answers === 'object' ? raw.answers : {};
  const answers = {
    name: str(a.name, 60),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(a.email, 120)) ? str(a.email, 120).toLowerCase() : '',
    sex: pick(a.sex, ['female', 'male']),
    age_band: pick(a.age_band, ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']),
    height_cm: numIn(a.height_cm, 100, 250),
    weight_kg: numIn(a.weight_kg, 30, 300),
    activity: pick(a.activity, ['regular', 'moderate', 'rare']),
    diet: pick(a.diet, ['omnivore', 'vegetarian', 'vegan', 'keto', 'other']),
    diet_other: str(a.diet_other, 120),
    conditions: pickList(a.conditions, SITE_CONDITIONS),
    conditions_other: str(a.conditions_other, 200),
    medications: pickList(a.medications, SITE_MEDS),
    medications_other: str(a.medications_other, 200),
    allergies: pickList(a.allergies, SITE_ALLERGIES),
    allergies_other: str(a.allergies_other, 200),
    symptoms: pickList(a.symptoms, SITE_SYMPTOMS),
    symptoms_other: str(a.symptoms_other, 200),
    priority: pick(a.priority, ['otshalvane', 'longevity', 'energy', 'skin', 'sleep', 'cognition', 'joints']),
    weight_goal: pick(a.weight_goal, ['1-5', '5-10', '10-20', '20+']),
    stimulant_tolerance: pick(a.stimulant_tolerance, ['ok', 'sensitive', 'avoid']),
  };
  const p = raw.protocol && typeof raw.protocol === 'object' ? raw.protocol : {};
  const protocol = {
    tier: str(p.tier, 60),
    products: (Array.isArray(p.products) ? p.products : []).slice(0, 10)
      .map(x => ({ name: str(x?.name, 100), dose: str(x?.dose, 80), timing: str(x?.timing, 60) })).filter(x => x.name),
  };
  if (!answers.sex && !answers.weight_kg) return null;
  return { answers, protocol };
}

/**
 * Пратката от модул → нормализирана (само позволените полета) или null.
 * @param {any} raw
 * @param {Date} [now]
 */
export function normalizeHandoff(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object') return null;
  const at = isoOr(raw.completedAt, now.toISOString());
  if (raw.source === 'emoeat') {
    const profile = normalizeEmoeat(raw.profile);
    return profile ? { v: 1, source: 'emoeat', at, profile } : null;
  }
  if (raw.source === 'airis') {
    const body = normalizeAiris(raw);
    return body ? { v: 1, source: 'airis', at, ...body } : null;
  }
  if (SITE_SOURCES[raw.source]) {
    const body = normalizeSiteQuiz(raw);
    return body ? { v: 1, source: raw.source, at, ...body } : null;
  }
  return null;
}

/** Нормализираната пратка → факти за /api/enrichment. */
export function handoffToFacts(h) {
  if (!h) return [];
  if (h.source === 'emoeat') return [{ kind: 'emoeat', value: h.profile, at: h.at, source: 'emoeat', status: 'confirmed' }];
  if (h.source === 'airis') {
    const q = h.questionnaire || {};
    return [{
      kind: 'iris',
      value: {
        analysis: h.analysis,
        complaints: q.complaints || '',
        // За сверката с NutriPlan: само полетата, при които разминаване има значение.
        questionnaire: { weight: q.weight, foodIntolerances: q.foodIntolerances, allergies: q.allergies, medications: q.medications, dietaryProfile: q.dietaryProfile || [] },
      },
      at: h.at, source: 'airis', status: 'confirmed',
    }];
  }
  // Тест от сайт: теглото е измерване; останалото — контекст и бележки за безопасност
  // (нужно, когато профилът вече съществува и въпросникът не се отваря).
  if (SITE_SOURCES[h.source]) {
    const facts = [];
    if (h.answers?.weight_kg) facts.push({ kind: 'weight', value: h.answers.weight_kg, unit: 'kg', at: h.at, source: h.source, status: 'confirmed' });
    const { lines, cautions } = siteQuizSummary(h);
    if (lines.length || cautions.length) {
      facts.push({ kind: 'site_quiz', value: { site: SITE_SOURCES[h.source], lines, cautions }, at: h.at, source: h.source, status: 'confirmed' });
    }
    return facts;
  }
  return [];
}

const SLEEP_BUCKET = (h) => (h < 5 ? 'Под 5' : h < 6 ? '5–6' : h < 7 ? '6–7' : h < 8 ? '7–8' : 'Над 8');
const WATER_BUCKET = (l) => (l < 1 ? 'под 1 л' : l < 1.5 ? '1–1.5 л' : l < 2 ? '1.5–2 л' : 'над 2 л');
const SPORT = {
  sedentary: 'Никаква (0 дни седмично)', light: 'Ниска (1–2 дни седмично)', moderate: 'Средна (2–4 дни седмично)',
  active: 'Висока (5–7 дни седмично)', 'very-active': 'Висока (5–7 дни седмично)',
};
const STRESS = { low: 'Ниско', moderate: 'Средно', high: 'Високо', 'very-high': 'Високо' };
const GOALS = { 'Отслабване': 'Отслабване', 'Подобряване на здравето': 'Подобряване на здравето' };
const DIET = { 'Вегетариански': 'Вегетарианска', 'Веган': 'Веган', 'Интермитентен фастинг': 'Фастинг', 'Кето': 'Кето', 'Средиземноморска': 'Средиземноморска' };
const HABIT_TO = {
  'Прескачане на закуска': ['eatingHabits', 'Не закусвам'],
  'Късно хранене': ['eatingHabits', 'Храня се предимно вечер'],
  'Сладки храни': ['foodCravings', 'Сладко'],
  'Бърза храна': ['foodCravings', 'Бургери / дюнери'],
};

/**
 * Отговорите от въпросника на AIRIS → предварително попълнени отговори във
 * въпросника на NutriPlan. Само полета с еднозначно съответствие; клиентът
 * ги вижда и може да ги смени.
 * @returns {Record<string, any>}
 */
export function airisPrefill(q) {
  if (!q) return {};
  const out = {};
  if (q.name) out.name = q.name;
  if (AIRIS_GENDER[q.gender]) out.gender = AIRIS_GENDER[q.gender];
  if (q.age) out.age = String(Math.round(q.age));
  if (q.height) out.height = String(Math.round(q.height));
  if (q.weight) out.weight = String(q.weight);
  const goals = (q.goals || []).map(g => GOALS[g]).filter(Boolean);
  if (goals.length) out.goal = [...new Set(goals)];
  if (SPORT[q.activityLevel]) out.sportActivity = SPORT[q.activityLevel];
  if (STRESS[q.stressLevel]) out.stressLevel = STRESS[q.stressLevel];
  if (q.sleepHours) out.sleepHours = SLEEP_BUCKET(q.sleepHours);
  if (q.hydration != null) out.waterIntake = WATER_BUCKET(q.hydration * 0.25);
  const diet = (q.dietaryProfile || []).map(d => DIET[d]).filter(Boolean);
  if (diet.length) out.dietPreference = [...new Set(diet)];
  // AIRIS понякога праща едно и също в двете полета — без повторения.
  const dislikes = [...new Set([q.foodIntolerances, q.allergies, (q.dietaryProfile || []).includes('Безглутенова') ? 'глутен' : ''].filter(Boolean))];
  if (dislikes.length) out.dietDislike = dislikes.join(', ');
  const health = [...new Set((q.healthStatus || []).map(x => AIRIS_HEALTH[x]).filter(Boolean))];
  if (health.length) out.healthConditions = health;
  if ((q.healthStatus || []).includes('Хипертония')) out['healthConditions_Сърдечно-съдови заболявания'] = HYPERTENSION_OPTION;
  for (const h of q.dietaryHabits || []) {
    const m = HABIT_TO[h];
    if (m) out[m[0]] = [...new Set([...(out[m[0]] || []), m[1]])];
  }
  if ((q.dietaryHabits || []).includes('Алкохол')) out.drinksAlcohol = 'Често';
  if (q.medications) {
    out.medications = 'Да';
    out.medicationsDetails = q.medications;
  }
  const extraHealth = (q.healthStatus || []).filter(x => !AIRIS_HEALTH[x]);
  const notes = [...new Set([q.complaints, q.medicalConditions].filter(Boolean)), extraHealth.length ? `състояния: ${extraHealth.join(', ')}` : ''].filter(Boolean).join('. ');
  if (notes) out.additionalNotes = `От ирисовия анализ (AIRIS): ${notes}`.slice(0, 800);
  return out;
}

const SITE_LABELS = {
  conditions: {
    hypertension: 'хипертония', diabetes: 'диабет / инсулинова резистентност', thyroid: 'щитовидна жлеза', autoimmune: 'автоимунно заболяване',
    kidney: 'бъбречно заболяване', liver: 'чернодробно заболяване', cardiovascular: 'сърдечно-съдово заболяване', pregnancy: 'бременност', breastfeeding: 'кърмене',
  },
  medications: { anticoagulants: 'антикоагуланти', statins: 'статини', ssri: 'SSRI / SNRI', hormone_therapy: 'хормонална терапия / контрацепция', thyroid_meds: 'медикаменти за щитовидна жлеза' },
  allergies: { shellfish: 'морски дарове', soy: 'соя', gluten: 'глутен', lactose: 'лактоза', nuts: 'ядки' },
  symptoms: {
    fatigue: 'постоянна умора', cravings: 'силен апетит / желание за сладко', poor_sleep: 'лош сън', joint_pain: 'болка в ставите', concentration: 'затруднена концентрация',
    cramps: 'мускулни крампи', hair_nails: 'косопад / чупливи нокти',
  },
};
// Само еднозначните съответствия с въпросника на NutriPlan.
const SITE_HEALTH = {
  diabetes: 'Диабет / Инсулинова резистентност', thyroid: 'Щитовидна жлеза (Хашимото и др.)', autoimmune: 'Автоимунни заболявания',
  hypertension: 'Сърдечно-съдови заболявания', cardiovascular: 'Сърдечно-съдови заболявания',
};
const SITE_SPORT = { moderate: 'Ниска (1–2 дни седмично)', rare: 'Никаква (0 дни седмично)' };
const SITE_DIET = { vegetarian: 'Вегетарианска', vegan: 'Веган', keto: 'Кето' };
const SITE_GOAL = {
  otshalvane: 'Отслабване', longevity: 'Антиейджинг', energy: 'Подобряване на здравето', skin: 'Подобряване на здравето',
  sleep: 'Подобряване на здравето', cognition: 'Подобряване на здравето', joints: 'Подобряване на здравето',
};
const labelsOf = (vals, map) => (vals || []).map(v => map[v]).filter(Boolean);
// Антиейджинг тестът (life-protocols.com) и приоритетът „дълголетие“ водят към готовия
// клиничен протокол „longevity“ — същият като входната карта в protocol-landing.html.
const SITE_LONGEVITY_FOCUS = {
  longevity: 'Всички', energy: 'Енергия и виталност', skin: 'Външен вид и кожа', sleep: 'Енергия и виталност',
  cognition: 'Когнитивно здраве', joints: 'Физическа сила и мобилност',
};
const usesLongevityProtocol = (h) => h?.answers?.priority === 'longevity'
  || (h?.source === 'lifeprotocols' && h?.answers?.priority !== 'otshalvane');

/**
 * Отговорите от теста на сайта → предварително попълнен въпросник на NutriPlan.
 * Възрастта е в диапазон — не се попълва (въпросникът я пита точно).
 * @returns {Record<string, any>}
 */
export function sitePrefill(h) {
  const a = h?.answers;
  if (!a) return {};
  const out = {};
  if (a.name) out.name = a.name;
  if (a.email) out.email = a.email;
  if (a.sex) out.gender = AIRIS_GENDER[a.sex];
  if (a.height_cm) out.height = String(Math.round(a.height_cm));
  if (a.weight_kg) out.weight = String(a.weight_kg);
  if (SITE_GOAL[a.priority]) out.goal = [SITE_GOAL[a.priority]];
  if (usesLongevityProtocol(h)) {
    out.clinicalProtocol = 'longevity';
    out.longevityGoals = [SITE_LONGEVITY_FOCUS[a.priority] || 'Всички'];
  }
  if (SITE_SPORT[a.activity]) out.sportActivity = SITE_SPORT[a.activity];
  if (SITE_DIET[a.diet]) out.dietPreference = [SITE_DIET[a.diet]];
  const health = [...new Set(labelsOf(a.conditions, SITE_HEALTH))];
  if (health.length) out.healthConditions = health;
  if (a.conditions.includes('hypertension')) out['healthConditions_Сърдечно-съдови заболявания'] = HYPERTENSION_OPTION;
  else if (a.conditions.length === 1 && a.conditions[0] === 'none') out.healthConditions = ['Нямам'];
  const dislikes = [...labelsOf(a.allergies, SITE_LABELS.allergies), a.allergies_other].filter(Boolean);
  if (dislikes.length) out.dietDislike = dislikes.join(', ');
  const meds = [...labelsOf(a.medications, SITE_LABELS.medications), a.medications_other].filter(Boolean);
  if (meds.length) {
    out.medications = 'Да';
    out.medicationsDetails = meds.join(', ');
  } else if (a.medications.length === 1 && a.medications[0] === 'none') {
    out.medications = 'Не';
  }
  const site = SITE_SOURCES[h.source];
  const notes = [];
  const other = [...labelsOf(a.conditions.filter(c => !SITE_HEALTH[c]), SITE_LABELS.conditions), a.conditions_other].filter(Boolean);
  if (other.length) notes.push(`Състояния: ${other.join(', ')}`);
  const symptoms = [...labelsOf(a.symptoms, SITE_LABELS.symptoms), a.symptoms_other].filter(Boolean);
  if (symptoms.length) notes.push(`Оплаквания: ${symptoms.join(', ')}`);
  if (SITE_LOSS[a.weight_goal]) notes.push(`Желано отслабване: ${SITE_LOSS[a.weight_goal]}`);
  if (a.stimulant_tolerance === 'sensitive' || a.stimulant_tolerance === 'avoid') notes.push('Чувствителност към стимуланти (кофеин)');
  if (a.diet === 'other' && a.diet_other) notes.push(`Режим: ${a.diet_other}`);
  const prods = h.protocol?.products || [];
  if (prods.length) notes.push(`Препоръчан протокол добавки${h.protocol.tier ? ` („${h.protocol.tier}“)` : ''}: ${prods.map(p => p.name).join(', ')}`);
  if (notes.length) out.additionalNotes = `От теста на ${site}: ${notes.join('. ')}`.slice(0, 800);
  return out;
}

const SITE_ACTIVITY = { regular: 'тренира 3+ пъти седмично', moderate: 'тренира 1–2 пъти седмично', rare: 'не тренира / рядко' };
const SITE_DIET_TEXT = { omnivore: 'всеядно', vegetarian: 'вегетарианско', vegan: 'веганско', keto: 'кето / нисковъглехидратно' };
const SITE_PRIORITY = {
  otshalvane: 'отслабване', longevity: 'дълголетие', energy: 'енергия', skin: 'кожа, коса, нокти', sleep: 'сън', cognition: 'фокус и памет', joints: 'стави',
};
const SITE_LOSS = { '1-5': 'до 5 кг', '5-10': '5–10 кг', '10-20': '10–20 кг', '20+': 'над 20 кг' };

/** Отговорите от теста като редове за картона / чата и бележки за безопасност. */
export function siteQuizSummary(h) {
  const a = h?.answers;
  if (!a) return { lines: [], cautions: [] };
  const conditions = [...labelsOf(a.conditions, SITE_LABELS.conditions), a.conditions_other].filter(Boolean);
  const meds = [...labelsOf(a.medications, SITE_LABELS.medications), a.medications_other].filter(Boolean);
  const allergies = [...labelsOf(a.allergies, SITE_LABELS.allergies), a.allergies_other].filter(Boolean);
  const symptoms = [...labelsOf(a.symptoms, SITE_LABELS.symptoms), a.symptoms_other].filter(Boolean);
  const lines = [
    SITE_PRIORITY[a.priority] ? `цел: ${SITE_PRIORITY[a.priority]}${SITE_LOSS[a.weight_goal] ? ` (${SITE_LOSS[a.weight_goal]})` : ''}` : '',
    a.age_band ? `възраст ${a.age_band}` : '',
    SITE_ACTIVITY[a.activity] ? `активност: ${SITE_ACTIVITY[a.activity]}` : '',
    SITE_DIET_TEXT[a.diet] ? `режим: ${SITE_DIET_TEXT[a.diet]}` : (a.diet_other ? `режим: ${a.diet_other}` : ''),
    conditions.length ? `състояния: ${conditions.join(', ')}` : '',
    meds.length ? `лекарства: ${meds.join(', ')}` : '',
    allergies.length ? `алергии / непоносимости: ${allergies.join(', ')}` : '',
    symptoms.length ? `оплаквания: ${symptoms.join(', ')}` : '',
    a.stimulant_tolerance === 'sensitive' || a.stimulant_tolerance === 'avoid' ? 'чувствителност към стимуланти (кофеин)' : '',
    h.protocol?.products?.length ? `препоръчан протокол${h.protocol.tier ? ` „${h.protocol.tier}“` : ''}: ${h.protocol.products.map(p => p.name).join(', ')}` : '',
  ].filter(Boolean);
  const cautions = [
    meds.length ? `посочени лекарства — ${meds.join(', ')}` : '',
    (a.conditions || []).includes('pregnancy') ? 'бременност' : '',
    (a.conditions || []).includes('breastfeeding') ? 'кърмене' : '',
    (a.conditions || []).includes('kidney') ? 'бъбречно заболяване' : '',
    (a.conditions || []).includes('liver') ? 'чернодробно заболяване' : '',
  ].filter(Boolean);
  return { lines, cautions };
}

/** Попълване на въпросника според модула. */
export function prefillFor(h) {
  if (h?.source === 'airis') return airisPrefill(h.questionnaire);
  if (SITE_SOURCES[h?.source]) return sitePrefill(h);
  return {};
}

/** Кратко описание за екрана „Добави към профила“ — какво точно ще влезе. */
export function handoffPreview(h) {
  if (!h) return null;
  if (h.source === 'emoeat') {
    return {
      source: 'emoeat',
      title: 'Емоционален профил (EmoEat)',
      lines: [h.profile.archetype?.name ? `Архетип: ${h.profile.archetype.name}` : '', h.profile.intensity ? `Интензитет: ${h.profile.intensity}` : '', h.profile.drivers.length ? `Двигатели: ${h.profile.drivers.join(', ')}` : ''].filter(Boolean),
      at: h.at,
    };
  }
  if (SITE_SOURCES[h.source]) {
    const a = h.answers;
    return {
      source: h.source,
      title: `Тест от ${SITE_SOURCES[h.source]}`,
      lines: [
        a.weight_kg ? `Тегло: ${a.weight_kg} кг` : '',
        h.protocol?.products?.length ? `Препоръчан протокол: ${h.protocol.products.map(p => p.name).slice(0, 4).join(', ')}` : '',
        'Нов профил: отговорите попълват въпросника (можете да ги промените). Съществуващ профил: влизат в него — за специалиста и асистента.',
      ].filter(Boolean),
      at: h.at,
    };
  }
  const a = h.analysis;
  return {
    source: 'airis',
    title: 'Ирисов анализ (AIRIS)',
    lines: [
      a.constitution ? `Конституция: ${a.constitution}` : '',
      a.systems.filter(s => s.priority).length ? `Фокус: ${a.systems.filter(s => s.priority).map(s => s.label || s.key).join(', ')}` : '',
      a.drivers.length ? `Хранителни насоки: ${a.drivers.length}` : '',
      'Отговорите от въпросника попълват въпросника на NutriPlan — можете да ги промените.',
    ].filter(Boolean),
    at: h.at,
  };
}
