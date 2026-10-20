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
  'Строг глас → скришом → още по-строг глас': ['CMP'],
  'Чувствата се усещат като глад': ['EMO'],
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

  const reliable = p.reliability?.level !== 'ниска';
  voice.reliable = reliable;
  const felt = p.intensity === 'Осезаемо' || p.intensity === 'Силно';
  /** @type {{ behaviors: string[], approach: string[], clinical: string[], cautions: string[] }} */
  const hints = { behaviors: [], approach: [], clinical: [], cautions: [] };
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
