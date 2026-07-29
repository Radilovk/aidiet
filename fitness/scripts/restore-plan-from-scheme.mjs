#!/usr/bin/env node
/**
 * Възстановява план от exampleScheme (Сплит А / Сплит Б) + запазва текстовете.
 * node fitness/scripts/restore-plan-from-scheme.mjs --id fcp_1784769057913_mxsq0jj --apply
 */
import { fetchExerciseDataset } from '../exercise-translate-batch.js';
import { buildCompactIndex, matchExercise, loadBundledMetadata, normalizePlan, enrichPlanWithExercises } from '../worker.js';

const API = process.env.FITPLAN_API || 'https://aidiet.radilov-k.workers.dev';

const SPLIT_A = [
  'dumbbell goblet squat',
  'dumbbell seated shoulder press',
  'forward lunge',
  'dumbbell seated alternate front raise',
  'lever seated hip adduction',
  'kneeling push-up',
  'band one arm twisting chest press',
  'crunch (hands overhead)',
];

const SPLIT_B = [
  'barbell sumo deadlift',
  'band close-grip pulldown',
  'dumbbell rear lunge',
  'dumbbell seated triceps extension',
  'curtsey squat',
  'dumbbell hammer curl',
  'band one arm standing low row',
  'dumbbell side bend',
];

const WARMUP = [
  'Леко кардио (ходене на място) - 2 мин',
  'Динамично разтягане: Basic toe touch - 10 повторения',
  'Динамично разтягане: Elbow-to-knee (леко усукване) - 10 повторения на страна',
];

const COOLDOWN = [
  'Разтягане на квадрицепса от лег (lying side quads stretch) - 30 сек на крак',
  'Разтягане на гърди (chest and front of shoulder stretch) - 30 сек',
  'Разтягане на глутеус (seated glute stretch) - 30 сек на страна',
];

function exSlot(canonicalName, entry, slotIndex) {
  const isCompound = slotIndex < 3;
  const isUnilateral = /lunge|curtsey|squat.*one|one arm|alternate/i.test(canonicalName) && slotIndex < 5;
  const resolved = entry?.name || canonicalName;
  return {
    canonicalName: resolved,
    equipmentHint: entry?.equipment || '',
    bodyPart: entry?.bodyPart || entry?.target || '',
    sets: 3,
    reps: isUnilateral ? '8-10 на крак' : (isCompound ? '10-12' : '12-15'),
    restSeconds: isCompound ? 75 : 60,
    tempo: isCompound ? '2-0-1-0' : '',
    rpe: isCompound ? '6-7' : '',
    notes: '',
  };
}

function buildStrengthDay({ day, focus, names, index }) {
  const exercises = names.map((name, i) => {
    const result = matchExercise(index, { canonicalName: name });
    if (!result?.entry) console.warn('⚠ Не е намерено:', name);
    return exSlot(name, result?.entry, i);
  });
  return {
    day,
    focus,
    type: 'strength',
    durationMin: 45,
    warmup: [...WARMUP],
    cooldown: [...COOLDOWN],
    exercises,
  };
}

function restDay(day) {
  return {
    day,
    focus: 'Почивка и възстановяване',
    type: 'rest',
    durationMin: null,
    warmup: [],
    cooldown: [],
    exercises: [],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const programId = args[args.indexOf('--id') + 1] || 'fcp_1784769057913_mxsq0jj';
  const apply = args.includes('--apply');

  const [planRes, progRes] = await Promise.all([
    fetch(`${API}/api/admin/fitplan/client-programs/${programId}/plan`),
    fetch(`${API}/api/admin/fitplan/client-programs`),
  ]);
  const planData = await planRes.json();
  const progData = await progRes.json();
  if (!planData.success) throw new Error(planData.message || 'plan fetch failed');

  const current = planData.plan;
  const raw = await fetchExerciseDataset();
  const bundled = await loadBundledMetadata();
  const index = buildCompactIndex(raw, bundled.translations || {}, bundled.metadata || {});

  const restored = normalizePlan({
    title: current.title,
    summary: current.summary,
    weeklySplit: 'Full-body × 2 (Понеделник, Четвъртък). Останалите дни — почивка и възстановяване.',
    safetyNotes: current.safetyNotes,
    guidelines: current.guidelines,
    days: [
      buildStrengthDay({
        day: 'Понеделник',
        focus: 'Сплит А — предна верига, глутеус и горна част (силова)',
        names: SPLIT_A,
        index,
      }),
      restDay('Вторник'),
      restDay('Сряда'),
      buildStrengthDay({
        day: 'Четвъртък',
        focus: 'Сплит Б — задна верига, глутеус и дърпане (силова)',
        names: SPLIT_B,
        index,
      }),
      restDay('Петък'),
      restDay('Събота'),
      restDay('Неделя'),
    ],
  });

  enrichPlanWithExercises(restored, index, { env: {} });

  // За POST: само полета за съхранение — без match/alternatives (сървърът ги генерира)
  const forSave = JSON.parse(JSON.stringify(restored));
  for (const day of forSave.days) {
    for (const ex of day.exercises || []) {
      delete ex.match;
      delete ex.alternatives;
      delete ex.matchScore;
      delete ex.matchFallback;
    }
  }

  console.log('Четвъртък след възстановяване:');
  for (const ex of restored.days[3].exercises) {
    console.log(`  ${ex.displayName || ex.canonicalName} → ${ex.canonicalName}`);
  }

  if (!apply) {
    console.log('\nDry-run. Добави --apply за запис в production.');
    return;
  }

  const postRes = await fetch(`${API}/api/admin/fitplan/client-programs/${programId}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: forSave }),
  });
  const postData = await postRes.json();
  if (!postRes.ok || !postData.success) throw new Error(postData.message || `HTTP ${postRes.status}`);
  console.log('\n✓ Планът е записан успешно.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
