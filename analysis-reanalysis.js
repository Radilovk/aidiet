/**
 * Реанализ: анализът на клиента, пресметнат наново с всички данни извън
 * въпросника — изследвания, устройства, EmoEat, AIRIS, документи.
 *
 * Същите правила като първоначалния анализ (analysis-deterministic.js) върху
 * обогатения профил, плюс находки, които въпросникът няма как да даде:
 * показатели извън нормата без клиничен код (витамин D, B12, TSH, бъбреци),
 * сигнали от устройствата (възстановяване, загуба на мускули) и ирисови
 * системи, потвърдени от независим източник (cross-check.js). Непотвърдените
 * ирисови находки са хипотези — показват се, но не влизат в оценката.
 *
 * Резултатът казва и какво се е променило спрямо анализа само по въпросника:
 * оценката, измеренията, новите и отпадналите проблеми, заменените отговори.
 */

import { compileProfile } from './profile-code.js';
import { analyzeProfile, analysisProblem } from './analysis-deterministic.js';
import { labRange } from './enrichment-labs.js';
import { IRIS_SYSTEMS } from './cross-check.js';

export const SOURCE_LABELS = {
  questionnaire: 'Въпросник',
  labs: 'Изследвания',
  device: 'Устройство',
  emoeat: 'EmoEat',
  iris: 'AIRIS',
  documents: 'Документ',
};

/** Измеренията на профила — по категорията на проблемите. */
export const DIMENSIONS = [
  { key: 'Medical', label: 'Тяло и обмяна' },
  { key: 'Nutrition', label: 'Хранене' },
  { key: 'Sleep', label: 'Сън и възстановяване' },
  { key: 'Stress', label: 'Стрес и емоции' },
  { key: 'Activity', label: 'Движение' },
  { key: 'Hydration', label: 'Хидратация' },
];

/** Ирисовите системи → категорията в анализа. */
const IRIS_CATEGORY = {
  digestive: 'Medical', metabolic: 'Medical', circulatory: 'Medical', endocrine: 'Medical',
  detox: 'Medical', immune: 'Medical', nervous: 'Stress',
};

const fmt = v => String(Math.round(Number(v) * 10) / 10).replace('.', ',');

/** Показатели извън нормата без клиничен код — иначе вече са проблем по кода. */
const LAB_PROBLEMS = {
  vitd: (l) => analysisProblem('Medical', l.value < 30 ? 64 : 52, 'Нисък витамин D',
    `По изследване ${fmt(l.value)} ${l.unit} — под оптималните 50.`,
    'Умора, по-слаб имунитет и по-бавно възстановяване на мускулите.',
    'Повече енергия и по-здрави кости', 'LAB_VITD'),
  b12: (l) => analysisProblem('Medical', 62, 'Нисък витамин B12',
    `По изследване ${fmt(l.value)} ${l.unit} — под нормата.`,
    'Умора, изтръпване и спад на концентрацията.',
    'Повече енергия и ясна мисъл', 'LAB_B12'),
  tsh: (l) => analysisProblem('Medical', 62, l.status === 'high' ? 'TSH над нормата' : 'TSH под нормата',
    `По изследване ${fmt(l.value)} ${l.unit} — щитовидната жлеза се оценява от лекар.`,
    'Обмяната може да е по-бавна или по-бърза от очакваното.',
    'Ясна картина на обмяната след преглед', 'LAB_TSH'),
  egfr: (l) => analysisProblem('Medical', l.value < 30 ? 86 : 72, 'Намалена бъбречна функция',
    `eGFR ${fmt(l.value)} — белтъкът в плана е ограничен; режимът се съгласува с лекар.`,
    'Натоварване на бъбреците при много белтък и сол.',
    'Щадящ бъбреците режим', 'LAB_EGFR'),
  potassium: (l) => analysisProblem('Medical', 74, 'Висок калий',
    `По изследване ${fmt(l.value)} ${l.unit} — промените в храненето се съгласуват с лекар.`,
    'Риск за сърдечния ритъм.',
    'Безопасни стойности на калия', 'LAB_K'),
  hdl: (l) => analysisProblem('Medical', 54, 'Нисък HDL („добър“) холестерол',
    `По изследване ${fmt(l.value)} ${l.unit} — под защитната граница.`,
    'По-слаба защита на съдовете.',
    'По-добър липиден профил', 'LAB_HDL'),
};

/** Сигнали от устройствата, които правилата по въпросника не виждат. */
const DEVICE_PROBLEMS = {
  recovery_low: (s) => analysisProblem('Sleep', 60, 'Недостатъчно възстановяване', s.text,
    'По-голям дефицит в този период забавя резултата и вдига апетита.',
    'Стабилен пулс и по-добро възстановяване', 'DEV_RECOVERY'),
  lean_loss: (s) => analysisProblem('Nutrition', 64, 'Загуба на мускулна маса', s.text,
    'По-бавна обмяна и ефект „йо-йо“.',
    'Отслабване от мазнини, не от мускули', 'DEV_LEAN'),
};

/** Кой източник е добавил кода (клинично състояние или навик). */
function sourceOfCode(code, codeSources, baseProfile) {
  if (!code) return null;
  if (baseProfile.clinical.includes(code) || baseProfile.behaviors.includes(code)) return 'questionnaire';
  for (const src of ['labs', 'documents', 'device', 'emoeat']) {
    if ((codeSources?.[src] || []).includes(code)) return src;
  }
  return null;
}

function dimensionScores(problems) {
  const out = {};
  for (const d of DIMENSIONS) {
    const load = problems.filter(p => p.category === d.key && !p.preventive).reduce((s, p) => s + Math.max(0, p.severityValue - 35) * 0.8, 0);
    out[d.key] = Math.max(15, Math.min(100, Math.round(100 - load)));
  }
  return out;
}

/**
 * @param {Record<string, any>} baseData — отговорите от въпросника (нормализирани), без обогатяване
 * @param {Record<string, any>} enrichedData — след applyEnrichment (с _enrichment)
 * @param {{ bmr?: number, tdee?: number, Final_Calories?: number, macroGrams?: object, macroRatios?: object }} [energy]
 * @param {'M'|'F'|'X'} [sex]
 */
export function reanalyze(baseData, enrichedData, energy = {}, sex = 'X') {
  const d = enrichedData?._enrichment || {};
  const baseProfile = compileProfile(baseData || {});
  const profile = compileProfile(enrichedData || {});
  const baseline = analyzeProfile(baseProfile, energy);

  // ── Находки извън правилата по въпросника ────────────────────────────
  const extra = [];
  const labCodes = new Set(d.codeSources?.labs || []);
  for (const l of d.labs || []) {
    if (l.status === 'normal' || !LAB_PROBLEMS[l.key]) continue;
    if (l.key === 'hdl' && labCodes.has('DYSL')) continue;
    extra.push({ ...LAB_PROBLEMS[l.key](l), sources: ['labs'] });
  }
  for (const s of d.essence?.signals || []) {
    if (DEVICE_PROBLEMS[s.code]) extra.push({ ...DEVICE_PROBLEMS[s.code](s), sources: ['device'] });
  }

  // ── AIRIS: потвърдената система засилва свързаните проблеми ──────────
  const hypotheses = d.crossCheck?.hypotheses || [];
  const confirmed = hypotheses.filter(h => h.status === 'confirmed');
  const irisBoost = new Map();
  for (const h of confirmed) {
    const def = IRIS_SYSTEMS[h.system] || {};
    irisBoost.set(h.system, { codes: def.codes || [], category: IRIS_CATEGORY[h.system] || 'Medical', label: h.label, evidence: h.evidence });
  }

  const current = analyzeProfile(profile, energy, extra);
  const baseTitles = new Set(baseline.keyProblems.map(p => p.title));
  const baseByTitle = new Map(baseline.keyProblems.map(p => [p.title, p]));
  const usedIris = new Set();
  let problems = current.keyProblems.map((p) => {
    const sources = new Set(p.sources || []);
    if (baseTitles.has(p.title)) sources.add('questionnaire');
    const src = sourceOfCode(p.code, d.codeSources, baseProfile);
    if (src) sources.add(src);
    // Сънят и активността идват от устройството, ако то е заменило отговора.
    if (p.category === 'Sleep' && d.overrides?.sleepHours) sources.add('device');
    if (p.category === 'Activity' && d.overrides?.dailyActivityLevel) sources.add('device');
    if (p.category === 'Stress' && d.voice) sources.add('emoeat');
    if (!sources.size) sources.add('questionnaire');
    const out = { ...p, sources: [...sources] };
    for (const [system, b] of irisBoost) {
      if (b.codes.includes(p.code)) {
        out.sources.push('iris');
        out.severityValue = Math.min(95, p.severityValue + 4);
        out.irisNote = `AIRIS: ${b.label} — приоритет, потвърден от ${b.evidence.join(', ')}`;
        usedIris.add(system);
      }
    }
    const before = baseByTitle.get(p.title);
    out.change = !before ? 'new' : before.severityValue !== out.severityValue ? (out.severityValue > before.severityValue ? 'worse' : 'better') : 'same';
    return out;
  });
  // Потвърдена ирисова система без свързан проблем — отделна гранична точка.
  for (const [system, b] of irisBoost) {
    if (usedIris.has(system)) continue;
    problems.push({
      ...analysisProblem(b.category, 50, `${b.label}: приоритет по ирисов анализ`,
        `Потвърдено от ${b.evidence.join(', ')}. Планът го отчита в менюто и съветите.`,
        'Без внимание оплакванията в тази система се задържат.', '', `IRIS_${system.toUpperCase()}`),
      sources: ['iris'], change: 'new',
    });
  }
  problems = problems.map(({ _improvement, ...p }) => p).sort((a, b) => b.severityValue - a.severityValue);

  // Оценката: от правилата, после потвърдените ирисови находки (по 1,3 точки за всяка).
  const irisPenalty = Math.round([...irisBoost.keys()].length * 1.3);
  const score = Math.max(25, Math.min(92, current.currentHealthStatus.score - irisPenalty));
  const resolved = baseline.keyProblems.filter(p => !p.preventive && !problems.some(x => x.title === p.title)).map(p => p.title);

  // ── Заменени отговори (устройства, изследвания, документи) ───────────
  const replaced = Object.entries(d.overrides || {}).map(([field, value]) => ({
    field, from: d.original?.[field] ?? null, to: value,
  }));

  const dims = dimensionScores(problems);
  const baseDims = dimensionScores(baseline.keyProblems);
  return {
    analysis: {
      ...current,
      keyProblems: problems.slice(0, 8),
      currentHealthStatus: { ...current.currentHealthStatus, score, keyIssues: problems.slice(0, 4).map(p => p.title) },
      _reanalysis: true,
    },
    baseline: { score: baseline.currentHealthStatus.score, problems: baseline.keyProblems.map(p => p.title) },
    dimensions: DIMENSIONS.map(x => ({ key: x.key, label: x.label, score: dims[x.key], baseline: baseDims[x.key] })),
    resolved,
    replaced,
    // Отворените въпроси, които анализът показва с бутони (останалите са за чата).
    questions: (d.crossCheck?.questions || []).filter(q => q.id === 'steps_source'),
    labs: (d.labs || []).map(l => ({ ...l, range: labRange(l.key, sex) })),
    iris: d.iris ? { ...d.iris, hypotheses } : (hypotheses.length ? { hypotheses } : null),
    emoeat: d.voice ? { archetype: d.voice.archetype || '', intensity: d.voice.intensity || '', drivers: d.voice.drivers || [], realNeed: d.voice.realNeed || '', at: d.voice.at || null } : null,
    devices: d.essence?.metrics && Object.keys(d.essence.metrics).length ? { metrics: d.essence.metrics, sources: d.essence.sources || [], at: d.essence.at || null } : null,
    documents: (d.documents || []).map(x => ({ title: x.title, at: x.at, impact: x.impact, summary: x.summary })),
  };
}
