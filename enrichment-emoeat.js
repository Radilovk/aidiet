/**
 * EmoEat → профил. Резултатът от теста (смятан на устройството) се превежда в
 * поведенческите кодове на двигателя и в портрет за гласа на плана.
 *
 * Правила:
 * - при ниска надеждност (много неутрални отговори) или слаб интензитет —
 *   само глас, без кодове: несигурен сигнал не сменя структурата на плана;
 * - кодовете идват от двигателите и поведенията, изразени поне „осезаемо“;
 * - ограничаващите модели (строги правила, махало) не носят код, а бележка
 *   за специалиста: при тях вредят строгите забрани и големият дефицит.
 */

const DRIVER_CODES = {
  'Нужда от близост': ['EMO', 'EVE'],
  'Натрупано напрежение': ['EMO'],
  'Бягство от задачи и мисли': ['EMO'],
  'Нужда да изключиш': ['EMO'],
  'Умора и еднообразие': ['SWS'],
};

const BEHAVIOR_CODES = {
  'Трудно спиране': ['OVR'],
  'Строг вътрешен глас': ['CMP'],
};

const PATTERN_CODES = {
  'Правила → срив → нови правила': ['OVR', 'CMP'],
  'Строг глас → скришом → още по-строг глас': ['CMP'],   // v2
  'Строг глас → утеха → още по-строг глас': ['CMP'],     // v3
  'Чувствата се усещат като глад': ['EMO'],
  'Импулсът изпреварва': ['EMO', 'OVR'],                 // v3
};

// v3: здравните отговори (само ако човекът ги е включил в плана) → бележки за специалиста.
const HEALTH_NOTES = {
  diabetes: 'EmoEat: диабет/инсулинова резистентност — спадът на захарта може да изглежда като емоционален импулс; редовни хранения, без дълги паузи.',
  pregnancy: 'EmoEat: бременност или кърмене — без дефицит и без ограничаване.',
  meds: 'EmoEat: лекарства, които влияят на апетита — част от апетита е от тях; без вина в тона.',
  adhd: 'EmoEat: ADHD — импулсивността е част от вниманието; структура и неща под ръка, не воля.',
  anxiety_tx: 'EmoEat: лечение за тревожност/депресия — съветите допълват лечението, не го заместват.',
  thyroid: 'EmoEat: щитовидна жлеза — умората и апетитът може да са хормонални.',
  pcos: 'EmoEat: поликистозни яйчници — апетитът и умората може да са хормонални.',
  menopause: 'EmoEat: менопауза — сънят и апетитът може да са хормонални.',
};

const APPROACH_BY_DRIVER = {
  'Умора и еднообразие': ['more_variety'],
};

const RESTRICTIVE = /Строги правила|Правила → срив/;

/** @param {any[]} facts */
export function deriveEmoEat(facts) {
  const fact = (facts || []).find(f => f.kind === 'emoeat' && f.status !== 'pending');
  const p = fact?.value;
  if (!p || typeof p !== 'object') return null;

  const voice = {
    archetype: p.archetype?.name || null,
    archetypeDescription: p.archetype?.description || null,
    secondArchetype: p.secondArchetype || null,
    intensity: p.intensity || null,
    drivers: Array.isArray(p.drivers) ? p.drivers.slice(0, 3) : [],
    patterns: Array.isArray(p.patterns) ? p.patterns.slice(0, 4) : [],
    bodySignals: p.bodySignals || '',
    realNeed: String(p.realNeed || '').slice(0, 200),
    at: fact.at,
  };
  const reasons = [`емоционален профил (EmoEat${voice.archetype ? `: ${voice.archetype}` : ''})`];

  // v3: портретът и контекстът за гласа на плана.
  if (p.v === 3) {
    voice.portrait = Array.isArray(p.portrait) ? p.portrait.slice(0, 3) : [];
    voice.context = p.context && typeof p.context === 'object' ? p.context : null;
    // Изразените черти (id → ниво) — за тона, известията и текстовете (persona.js, ai-voice.js).
    voice.traits = {};
    for (const t of Array.isArray(p.traits) ? p.traits : []) {
      if (t && /^[A-Z]{3,6}$/.test(t.id || '') && (t.level === 'Силно' || t.level === 'Осезаемо')) voice.traits[t.id] = t.level;
    }
  }

  const reliable = p.reliability?.level !== 'ниска';
  voice.reliable = reliable;
  const felt = p.intensity === 'Осезаемо' || p.intensity === 'Силно';
  /** @type {{ behaviors: string[], approach: string[], clinical: string[], cautions: string[] }} */
  const hints = { behaviors: [], approach: [], clinical: [], cautions: [] };
  const health = Array.isArray(p.health) ? p.health : [];
  for (const h of health) if (HEALTH_NOTES[h]) hints.cautions.push(HEALTH_NOTES[h]);
  if (health.includes('past_ed') || p.safety === 'specialist') {
    hints.clinical.push('EmoEat: ' + (health.includes('past_ed') ? 'минали трудности с храненето' : 'силна строгост към себе си + „всичко или нищо“') + ' — препоръчан разговор със специалист.');
    hints.cautions.push('EmoEat: без строги забрани, без голям дефицит и без оценки на храненията.');
  }
  // Непълнолетен: само глас, без кодове за поведение и без дефицит.
  if (p.context?.teen) {
    hints.cautions.push('EmoEat: непълнолетен — без дефицит и без съвети за отслабване.');
    return { voice, hints, reasons };
  }
  if (!reliable || !felt) return { voice, hints, reasons };

  for (const d of voice.drivers) {
    hints.behaviors.push(...(DRIVER_CODES[d] || []));
    hints.approach.push(...(APPROACH_BY_DRIVER[d] || []));
  }
  for (const b of Array.isArray(p.behaviors) ? p.behaviors : []) {
    if (b?.level === 'Слабо') continue;
    hints.behaviors.push(...(BEHAVIOR_CODES[b?.name] || []));
  }
  for (const t of voice.patterns) hints.behaviors.push(...(PATTERN_CODES[t] || []));

  const restrictive = (p.behaviors || []).some(b => RESTRICTIVE.test(b?.name || '') && b.level !== 'Слабо')
    || voice.patterns.some(t => RESTRICTIVE.test(t));
  if (restrictive) {
    hints.cautions.push('EmoEat: ограничаващ модел — без строги забрани и без голям дефицит; свободното хранене да остане.');
  }
  hints.behaviors = [...new Set(hints.behaviors)];
  hints.approach = [...new Set(hints.approach)];
  return { voice, hints, reasons };
}
