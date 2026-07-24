#!/usr/bin/env node
/**
 * Симулация: какво ТОЧНО получава AI при генериране на план.
 * Отразява executePlanGeneration() — system + user + exercise_catalog.
 *
 * node fitness/scripts/simulate-plan-generation.mjs
 * node fitness/scripts/simulate-plan-generation.mjs --out /tmp/ai-prompt-log.txt
 * node fitness/scripts/simulate-plan-generation.mjs --live   # + GEMINI_API_KEY
 */
import { writeFileSync } from 'node:fs';
import { buildProfileSummary } from '../profile-summary.js';
import {
  preparePlanGeneration,
  resolveGuidelineLayers,
  buildTagsFromAnswers,
  buildTrainerSystemAddon,
  auditPlan,
} from '../plan-generation.js';
import { buildPlanSystemInstruction, PLAN_RESPONSE_SCHEMA } from '../plan-prompts.js';
import {
  allowedEquipmentSet,
  buildCompactIndex,
  loadBundledMetadata,
  parseAiJson,
  normalizePlan,
} from '../worker.js';
import { fetchExerciseDataset } from '../exercise-translate-batch.js';
import { buildExerciseCatalogSnippet } from '../exercise-metadata.js';

const ADMIN_WOMAN_SCHEME = `3 тренировки седмично без събота и неделя. уреди: горен скрипец vertical pulley, машина за бедра аддуктор, абдуктор, лост 10 кг, гирички 2 до 10 кг, хоризонтален скрипец за гръб, степ блокче.
придържаш се към упражнения за средно начинаещи. по прости и ефективни. без странични рамена.`;

const SAMPLE_ADMIN_CONFIG = {
  foundation: 'Контрол на движението, дишане, прогресия. При жена — приоритет glutes/бедра, не мъжки bench split.',
  chunks: [
    { tags: ['gender:жена'], text: 'АДМИН: жена — приоритет дупе (обем+форма), бедра по-малък обем, горна част само постура.' },
    { tags: ['goal:рекомпозиция'], text: 'АДМИН: рекомпозиция — сила + умерено кардио, не bro-split.' },
    { tags: ['all'], text: 'АДМИН АРХ: винаги 8 мин загрявка + мобилност гръбна.' },
    { tags: [], text: 'АДМИН ПРАЗЕН ТАГ: универсално правило за всички клиенти.' },
  ],
  updatedAt: new Date().toISOString(),
};

const clientAnswers = {
  gender: 'Жена',
  age: 45,
  heightCm: 172,
  weightKg: 51,
  health: [],
  healthFemale: [],
  limitations: ['гърди не — импланти'],
  breastImplants: { implants: 'Да — под гръдната жлеза (subglandular)', implantMonths: 6 },
  experience: 'Среден (2–5 години)',
  goal: { main: 'Рекомпозиция', other: '', zones: 'бедра, дупе', timeframe: 'Без краен срок' },
  equipment: ['Дъмбели', 'Кабели/скрипец', 'Машини'],
  equipmentOther: '',
  preferences: { types: ['Силов тренинг'], avoid: 'странични рамена', freq: '3–4', duration: '45–60 мин', timeOfDay: 'Вечер' },
  sleep: 'Добро, събуждам се отпочинал/а',
  stress: 4,
  dailyActivity: { selected: 'Заседнала работа, минимално движение' },
  sportActivity: { status: 'Не тренирам в момента' },
  nutrition: { type: 'Без специфичен', mealsPerDay: 3 },
  extraInfo: 'приоритет дупе и бедра, изправяне на гърба',
};

/** Груба оценка: BG+EN mix ≈ 3.8 chars/token */
function estTokens(text) {
  return Math.ceil(String(text || '').length / 3.8);
}

function buildSampleOutputPlan(sessions = 3, exercisesPerDay = 4) {
  const days = ['Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота', 'Неделя'];
  const trainingIdx = [0, 2, 4];
  const exTemplate = {
    displayName: 'Клек с дъмбели',
    canonicalName: 'Dumbbell Goblet Squat',
    equipmentHint: 'dumbbell',
    bodyPart: 'upper legs',
    sets: 3,
    reps: '10-12',
    restSeconds: 75,
    tempo: '2-0-2',
    rpe: '7',
    notes: 'Контролирано движение, без болка в коленете.',
  };
  return {
    title: 'Седмична програма — рекомпозиция',
    summary: 'Три силови сесии с фокус дупе/бедра и постура на гърба. Умерен обем, прогресия по RPE.',
    weeklySplit: 'lower/glute + upper/posture + full',
    safetyNotes: ['Без натоварване на гърди поради импланти', 'Прекъсни при болка'],
    days: days.map((day, i) => {
      const isTrain = trainingIdx.includes(i);
      return {
        day,
        focus: isTrain ? (i === 0 ? 'Дупе и бедра' : i === 2 ? 'Гръб и постура' : 'Пълно тяло') : 'Почивка',
        type: isTrain ? 'strength' : 'rest',
        durationMin: isTrain ? 50 : 0,
        warmup: isTrain ? ['5 мин леко кардио', 'Кръгови движения рамене/таз', 'Активация на glute medius'] : [],
        exercises: isTrain ? Array.from({ length: exercisesPerDay }, (_, j) => ({
          ...exTemplate,
          displayName: `${exTemplate.displayName} ${j + 1}`,
          canonicalName: `${exTemplate.canonicalName} ${j + 1}`,
        })) : [],
        cooldown: isTrain ? ['Стречинг бедра', 'Стречинг гръб', 'Дишане и релаксация'] : [],
      };
    }),
    guidelines: {
      progression: 'Добави 1 повторение или 2.5 кг когато RPE е под целта 2 сесии подред.',
      recovery: '48–72ч между тежки сесии за долна част.',
      nutrition: 'Достатъчен протеин; умерен дефицит при рекомпозиция.',
      adaptation: 'След 4 седмици преглед на обема и прогресия.',
    },
  };
}

const outPath = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : null;
const live = process.argv.includes('--live');
const prod = process.argv.includes('--prod');

const lines = [];
const log = (title, text = '') => {
  const block = `\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}\n${text}`;
  lines.push(block);
  console.log(block);
};

let adminConfig = SAMPLE_ADMIN_CONFIG;
if (prod) {
  const res = await fetch('https://aidiet.radilov-k.workers.dev/api/admin/fitplan/guidelines');
  const data = await res.json();
  adminConfig = data.config;
}

const prep = preparePlanGeneration(
  { clientAnswers, exampleScheme: ADMIN_WOMAN_SCHEME, clientName: 'Тест клиентка' },
  adminConfig,
  { buildProfileSummary, allowedEquipmentSet },
);

const tags = buildTagsFromAnswers(clientAnswers);
const layers = resolveGuidelineLayers(tags, adminConfig);
const trainerAddon = buildTrainerSystemAddon(adminConfig, tags, layers);
const systemPrompt = buildPlanSystemInstruction(trainerAddon);

let catalogBlock = '';
let indexSize = 0;
try {
  const raw = await fetchExerciseDataset();
  const metadata = await loadBundledMetadata();
  const index = buildCompactIndex(raw, {}, metadata);
  indexSize = index.length;
  catalogBlock = buildExerciseCatalogSnippet(index, prep.exerciseProfile, prep.allowedEquipment, {
    modalities: prep.programSpec?.weekModalities || null,
  });
} catch (e) {
  catalogBlock = `[CATALOG FETCH FAILED: ${e.message}]`;
}

const userPrompt = prep.userPrompt;
const baseUser = catalogBlock ? `${userPrompt}\n\n${catalogBlock}` : userPrompt;

const samplePlan = buildSampleOutputPlan(3, 4);
const sampleOutputJson = JSON.stringify(samplePlan, null, 2);
const compactOutputJson = JSON.stringify(samplePlan);

const systemTok = estTokens(systemPrompt);
const userTok = estTokens(userPrompt);
const catalogTok = estTokens(catalogBlock);
const totalInputTok = systemTok + userTok + catalogTok;
const outputTokPretty = estTokens(sampleOutputJson);
const outputTokCompact = estTokens(compactOutputJson);

const exerciseCount = samplePlan.days.reduce((n, d) => n + (d.exercises?.length || 0), 0);
const trainingDays = samplePlan.days.filter((d) => d.type !== 'rest').length;

log('SCENARIO', [
  'Админ клиентска програма — жена 45г., рекомпозиция, импланти, ограничено оборудване',
  '3–4 силови сесии, admin brief + program_spec + пълен exercise catalog',
].join('\n'));

log('TAGS', [...tags].sort().join(', '));
log('PROGRAM_SPEC', prep.programSpec ? [
  `split: ${prep.programSpec.split}`,
  `sessions: ${prep.programSpec.sessions}`,
  `maxDiff: d≤${prep.programSpec.maxDiff}`,
  `modality: ${prep.programSpec.modality}`,
  `orderHint: ${prep.programSpec.orderHint}`,
  `approach: ${prep.programSpec.approachRationale?.slice(0, 200)}…`,
].join('\n') : '(няма)');

log('INPUT SIZE (chars / est. tokens)', [
  `system prompt:     ${systemPrompt.length.toLocaleString()} chars  ~${systemTok.toLocaleString()} tok`,
  `user prompt:       ${userPrompt.length.toLocaleString()} chars  ~${userTok.toLocaleString()} tok`,
  `exercise catalog:  ${catalogBlock.length.toLocaleString()} chars  ~${catalogTok.toLocaleString()} tok`,
  `TOTAL input:       ${(systemPrompt.length + baseUser.length).toLocaleString()} chars  ~${totalInputTok.toLocaleString()} tok`,
  `exercise index:    ${indexSize.toLocaleString()} entries → catalog caps ~120`,
  `guidelines:        individual=${layers.individual.length}, architecture=${layers.architecture.length}`,
].join('\n'));

log('EXPECTED OUTPUT (estimate)', [
  `training days: ${trainingDays}, exercises: ${exerciseCount}`,
  `sample JSON (pretty): ${sampleOutputJson.length.toLocaleString()} chars  ~${outputTokPretty.toLocaleString()} tok`,
  `sample JSON (compact): ${compactOutputJson.length.toLocaleString()} chars  ~${outputTokCompact.toLocaleString()} tok`,
  `maxOutputTokens config: 8192`,
  `headroom vs estimate: ${8192 - outputTokCompact} tokens (${Math.round((outputTokCompact / 8192) * 100)}% of cap)`,
  '',
  'WORST-CASE output (schema max ≤5 ex/day):',
  ...[ [3, 4], [4, 5], [5, 5], [6, 5] ].map(([s, e]) => {
    const slots = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 5], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] }[s];
    const exObj = {
      displayName: 'Клек с дъмбели в гоблет хват',
      canonicalName: 'Dumbbell Goblet Squat',
      equipmentHint: 'dumbbell',
      bodyPart: 'upper legs',
      sets: 3, reps: '10-12', restSeconds: 75, tempo: '2-0-2', rpe: '7',
      notes: 'Контролирано движение, без болка в коленете. Фокус върху glute.',
    };
    const days = ['Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота', 'Неделя'];
    const plan = {
      title: 'x', summary: 'x'.repeat(200), weeklySplit: 'x', safetyNotes: ['a', 'b', 'c'],
      days: days.map((day, i) => {
        const train = slots.includes(i);
        return {
          day, focus: train ? 'Сила' : 'Почивка', type: train ? 'strength' : 'rest', durationMin: train ? 60 : 0,
          warmup: train ? ['w1', 'w2', 'w3'] : [], exercises: train ? Array(e).fill(exObj) : [], cooldown: train ? ['c1', 'c2', 'c3'] : [],
        };
      }),
      guidelines: { progression: 'p'.repeat(120), recovery: 'r'.repeat(120), nutrition: 'n'.repeat(120), adaptation: 'a'.repeat(120) },
    };
    const tok = estTokens(JSON.stringify(plan));
    return `  ${s} sess × ${e} ex → ~${tok} tok (${Math.round(tok / 8192 * 100)}% cap)`;
  }),
].join('\n'));

log('COMPLEXITY ASSESSMENT', [
  `INPUT cognitive load:`,
  `  • ${userTok + catalogTok} tok context to parse (profile + constraints + spec + ~120 exercises)`,
  `  • AI must: pick 12–20 exercises from catalog, assign sets/reps from spec,`,
  `    write 9 warmup + 9 cooldown steps, 4 guidelines, respect hard-veto`,
  `  • CODE already handles: split, volume/wk, dayFocus, reps/rest/RPE, audit, matching`,
  `OUTPUT complexity: structured JSON, 7 days, ${exerciseCount} exercises in sample`,
  `VERDICT (token budget):`,
  totalInputTok > 6000 ? '  ⚠ INPUT >6k tok — high context' : `  ✓ INPUT ~${totalInputTok} tok — умерен (далеч от лимита)`,
  outputTokCompact > 6500 ? '  ⚠ OUTPUT near 8192 cap — truncation risk' : '  ✓ OUTPUT има голям запас (max ~33% при 6×5 ex)',
  catalogTok > 2500 ? '  ⚠ Catalog is large' : `  ✓ Catalog ~${catalogTok} tok (cap 120 упражнения)`,
  `RECOMMENDATION: ${totalInputTok < 5000 && outputTokCompact < 4000 ? '1 заявка е достатъчна — не сме на ръба по обем' : 'обмисли 2 заявки'}`,
].join('\n'));

log('SYSTEM PROMPT (full)', systemPrompt);
log('USER PROMPT (without catalog)', userPrompt);
log('EXERCISE CATALOG (full)', catalogBlock || '(празен)');
log('FULL USER MESSAGE (= prompt + catalog)', baseUser);

if (outPath) {
  writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log(`\nWritten to ${outPath}`);
}

if (!live) {
  console.log('\nDry run complete. Add --live + GEMINI_API_KEY for real AI response.');
  process.exit(0);
}

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY липсва');
  process.exit(1);
}

const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
const body = {
  systemInstruction: { parts: [{ text: systemPrompt }] },
  contents: [{ role: 'user', parts: [{ text: baseUser }] }],
  generationConfig: {
    temperature: 0.4,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
    responseSchema: PLAN_RESPONSE_SCHEMA,
    thinkingConfig: { thinkingBudget: 0 },
  },
};

console.log('\nИзвиквам Gemini...');
const t0 = Date.now();
const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const data = await res.json();
const elapsed = Date.now() - t0;
const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
const usage = data.usageMetadata || {};

log('LIVE RESPONSE STATS', [
  `model: ${model}`,
  `elapsed: ${elapsed}ms`,
  `promptTokenCount: ${usage.promptTokenCount ?? '?'}`,
  `candidatesTokenCount: ${usage.candidatesTokenCount ?? '?'}`,
  `totalTokenCount: ${usage.totalTokenCount ?? '?'}`,
  `response chars: ${text.length.toLocaleString()}`,
  `est response tokens: ~${estTokens(text)}`,
  `truncated?: ${text.length > 0 && !text.trimEnd().endsWith('}') ? 'LIKELY YES' : 'no'}`,
].join('\n'));

if (data.error) {
  log('API ERROR', JSON.stringify(data.error, null, 2));
  process.exit(1);
}

try {
  const plan = normalizePlan(parseAiJson(text));
  const exercises = [];
  for (const day of plan.days || []) {
    for (const ex of day.exercises || []) {
      exercises.push(`${day.day} [${day.type}]: ${ex.canonicalName || ex.displayName}`);
    }
  }
  log('AI EXERCISES', exercises.join('\n') || '(няма)');
  const audit = auditPlan(plan, {
    clientTags: prep.clientTags,
    constraints: prep.constraints,
    allowedEquipment: prep.allowedEquipment,
    programSpec: prep.programSpec,
    exerciseProfile: prep.exerciseProfile,
  });
  log('AUDIT', audit.ok ? 'PASS' : `FAIL:\n${audit.issues.join('\n')}`);
  log('AI RAW JSON (first 4000 chars)', text.slice(0, 4000));
} catch (e) {
  log('PARSE ERROR', `${e.message}\n\nTail: ${text.slice(-500)}`);
}

if (outPath) writeFileSync(outPath, lines.join('\n'), 'utf8');
