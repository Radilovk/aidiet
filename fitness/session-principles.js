/**
 * Принципи за структура на тренировъчна сесия по вид активност и цел.
 *
 * dayFocus (от program_spec) = основен акцент на exercises блока за деня.
 * warmup/cooldown винаги могат да включват кардио, мобилност и стречинг —
 * нормална сесия е: загрявка → основна работа → финал.
 */
import { normalizeText } from './normalize.js';

/** Минути по фази според общата продължителност. */
export function sessionPhaseBudget(durationMin = 45) {
  const total = Math.max(20, durationMin);
  const warmup = Math.max(5, Math.round(total * 0.12));
  const cooldown = Math.max(5, Math.round(total * 0.12));
  const main = Math.max(10, total - warmup - cooldown);
  return { warmup, main, cooldown, total };
}

const UNIVERSAL = `СТРУКТУРА НА ВСЯКА СЕСИЯ (задължително):
1) warmup (3 кратки стъпки): леко кардио/пулс ↑ → динамична мобилност (стави в движение) → активация за мускулите на днешния фокус
2) exercises (основен блок): според dayFocus + volume/spec — тук е главната работа
3) cooldown (3 кратки стъпки): статичен стречинг на работените зони → леко кардио/ходене/възстановяване на пулс → дишане/релаксация

Смесването е нормално: силов ден има кардио в загрявка и стреч в края; mobility ден може леко кардио в загрявка. Забрана: тежки compound в ОСНОВНИЯ блок при dayFocus=mobility.`;

const FOCUS_RULES = {
  strength: `dayFocus=strength:
- warmup: 3–5 мин леко кардио + динамичен стреч + активация (glute bridge, band pull-apart, леки повторения)
- exercises: compound→isolation; volume по split/spec; RPE≤spec
- cooldown: статичен стреч на работените мускулни групи + 3–5 мин леко кардио`,

  cardio: `dayFocus=cardio:
- warmup: 5–8 мин постепенно zone 1→2; без скокове в началото
- exercises: основно zone 2 (разговорно темпо) или темпо интервали според целта; без тежки силови серии
- cooldown: 3–5 мин ходене/лесен вело/елиптика + стречинг крака/таз`,

  hiit: `dayFocus=hiit:
- warmup: 8–10 мин прогресивна интензивност до ~60% max
- exercises: интервали work:rest (начинаещ 1:2, напреднал 1:1); макс 20–25 мин работа; без тежка щанга
- cooldown: 5 мин лесен кардио + стречинг; не спирай рязко`,

  mobility: `dayFocus=mobility:
- warmup: дишане + леки движения/flow (без натоварване)
- exercises: йога пози, стречинг, мобилност по zones↓; hold 30–60s; без bench/squat/deadlift в основния блок
- cooldown: дълбок стреч + релаксация/дыхание`,

  'active-recovery': `dayFocus=active-recovery:
- warmup: лесно движение 5 мин
- exercises: ходене, лек вело, foam roll, мобилност — без натрупване на умора
- cooldown: стречинг + дишане`,
};

const GOAL_RULES = {
  отслабване: 'Цел отслабване: силовият блок запазва мускул; кардио в загрявка/cooldown или отделен cardio ден; дефицитът е от хранене — не тренирай до отказ.',
  хипертрофия: 'Цел хипертрофия: прогресия в основния блок (reps→тежест); всяка група ≥2×/седм; пълни почивки при тежки compound.',
  рекомпозиция: 'Цел рекомпозиция: силов обем по spec + умерено кардио в загрявка/cooldown или cardio ден; измерима силова прогресия.',
  сила: 'Цел сила: основни движения първи в exercises; техника преди тежест; пълни почивки при тежки серии.',
  издръжливост: 'Цел издръжливост: преобладава zone 2/интервали; силата е поддръжаща (2–3 упражнения), не основен обем.',
  обща: 'Цел обща кондиция: баланс сила + кардио + мобилност в седмицата; разнообразие в основния блок по dayFocus.',
  рехаб: 'Цел рехаб: само безболезнен ROM; контролирано темпо; без макс натоварване; планът не замества физиотерапевт.',
};

const LEVEL_RULES = {
  1: 'Ниво 1: техника и контрол; машини/СТ пред сложни свободни тежести; по-къси интервали при HIIT.',
  2: 'Ниво 2: стандартен обем и интензитет по spec.',
  3: 'Ниво 3: допустими интензификатори (drop set, rest-pause) макс 1–2 на сесия.',
};

/** Принципи за prompt от ProgramSpec. */
export function buildSessionPrinciples(spec = {}) {
  const budget = sessionPhaseBudget(spec.durationMin);
  const goalKey = normalizeText(spec.goalNorm || spec.goal || '');
  const goalRule = Object.entries(GOAL_RULES).find(([k]) => goalKey.includes(k))?.[1] || GOAL_RULES.обща;
  const levelRule = LEVEL_RULES[spec.level] || LEVEL_RULES[2];

  const focuses = [...new Set((spec.dayTypes || [])
    .map((d) => d.type)
    .filter((t) => t && t !== 'rest'))];

  const focusBlocks = focuses.length
    ? focuses.map((f) => FOCUS_RULES[f] || FOCUS_RULES.strength).join('\n\n')
    : (FOCUS_RULES[spec.modality] || FOCUS_RULES.strength);

  return {
    budget,
    universal: UNIVERSAL,
    focusBlocks,
    goalRule,
    levelRule,
  };
}

/** Компактен блок за user prompt (~20 реда). */
export function formatSessionPrinciplesBlock(spec) {
  if (!spec) return '';
  const p = buildSessionPrinciples(spec);
  const { warmup, main, cooldown } = p.budget;
  const lines = [
    p.universal,
    '',
    `Време (ориентир): warmup ~${warmup}мин | exercises ~${main}мин | cooldown ~${cooldown}мин`,
    '',
    p.focusBlocks,
    '',
    p.goalRule,
    p.levelRule,
  ];
  return lines.join('\n');
}
