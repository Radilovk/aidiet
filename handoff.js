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
  const dislikes = [q.foodIntolerances, q.allergies, (q.dietaryProfile || []).includes('Безглутенова') ? 'глутен' : ''].filter(Boolean);
  if (dislikes.length) out.dietDislike = dislikes.join(', ');
  for (const h of q.dietaryHabits || []) {
    const m = HABIT_TO[h];
    if (m) out[m[0]] = [...new Set([...(out[m[0]] || []), m[1]])];
  }
  if ((q.dietaryHabits || []).includes('Алкохол')) out.drinksAlcohol = 'Често';
  if (q.medications) {
    out.medications = 'Да';
    out.medicationsDetails = q.medications;
  }
  const notes = [q.complaints, q.medicalConditions].filter(Boolean).join('. ');
  if (notes) out.additionalNotes = `От ирисовия анализ (AIRIS): ${notes}`.slice(0, 800);
  return out;
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
