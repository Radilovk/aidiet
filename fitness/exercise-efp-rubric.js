/**
 * EFP Rubric v2 — формални критерии за индивидуална AI класификация.
 * Всяко упражнение се оценява по 5 измерения; diff/gf/gm се извеждат от тях.
 */
export const EFP_VERSION = 2;

export const EFP_FLAGS = [
  'compound', 'isolation', 'barbell', 'machine', 'bodyweight', 'true_bodyweight',
  'mislabeled_bw', 'cardio', 'glute', 'press', 'olympic', 'gymnastics', 'suspension',
  'rings', 'pull_bar', 'parallel_bars', 'beginner_safe', 'home_friendly', 'advanced',
  'plyometric', 'unilateral', 'balance', 'excluded', 'gender_variant',
];

export const CLASSIFY_RUBRIC = `
Ти си сертифициран S&C треньор. Класифицираш ВСЕКО упражнение индивидуално по пълните му данни.
НЕ използвай шаблони по equipment — оцени реалното изпълнение от името и инструкциите.

## diff (1–3) — обща трудност за план
Изведи от трите измерения по-долу. Правило:
- diff=1: motor≤1 И coordination≤1 И plyometric=false И няма висока техническа/стабилностна изискване
- diff=2: средна двигателна култура, умерена координация, или умерен load skill
- diff=3: motor≥3 ИЛИ coordination≥3 ИЛИ plyometric=true с висок импакт ИЛИ Olympic/гимнастика/единична екстремна стабилност

Примери diff=3: muscle-up, pistol squat, snatch, ring dips, plyo push-up, depth jump, handstand, dragon flag, kipping pull-up, archer push-up, single-leg RDL с тежест.
Примери diff=1: machine press, cable curl, wall push-up, stretch, assisted pull-up, seated row, leg extension, band pull-apart.
НЕ маркирай barbell curl като diff=3. НЕ маркирай leg press като diff=3.

## motor (1–3) — сила/контрол/стабилност
1=машина/пътека, 2=свободни тежести/стандартно СТ, 3=Olympic/гимнастика/единична крайност

## coordination (1–3) — двигателна култура
1=изолирано просто движение, 2=многоставно compound, 3=ритъм/баланс/ротация/фази/асиметрия

## plyometric (true/false)
true ако има мощно отскачане, drop, clap, depth jump, explosive push, jump squat, burpee jump phase.

## gf / gm (0–100) — подходящост за ЖЕНСКИ / МЪЖКИ план (НЕ „женско/женско упражнение“)
- gf↑: glute/hip/abduct, core toning, pilates/yoga, lower-body shaping
- gm↑: heavy press, pull-up, row, squat/deadlift strength, arm mass
- Повечето compound са 55–80 и за двата пола; крайности само при ясен акцент

## flags (от реалния уред и движение)
true_bodyweight: САМО под/мат/стена/степ/пейка/стол — НЕ лост, халки, TRX.
home_friendly: true_bodyweight + без high-skill/plyo/gymnastics.
gender_variant: ако името съдържа (male)/(female) → excluded в flags.

Връщай САМО JSON.`;

export const CLASSIFY_RESPONSE_SCHEMA = `{
  "classifications": [{
    "id": "0001",
    "diff": 1,
    "gf": 78,
    "gm": 72,
    "motor": 1,
    "coordination": 1,
    "plyometric": false,
    "flags": ["bodyweight", "true_bodyweight", "beginner_safe", "home_friendly", "isolation"]
  }]
}`;

export function isCuratedEfpRecord(record) {
  return Boolean(
    record?.diff
    && record?.aiClassified === true
    && (record?.efpVersion ?? 0) >= EFP_VERSION
    && !record?.heuristicOnly,
  );
}

export function clampDiff(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 2;
  return Math.max(1, Math.min(3, Math.round(v)));
}

export function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 70;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Извежда diff от измеренията — проверка на AI отговора. */
export function deriveDiffFromDimensions({ motor, coordination, plyometric, diff }) {
  const m = clampDiff(motor);
  const c = clampDiff(coordination);
  const p = Boolean(plyometric);
  let derived = 1;
  if (m >= 3 || c >= 3 || p) derived = 3;
  else if (m >= 2 || c >= 2) derived = 2;
  const ai = clampDiff(diff);
  return Math.max(derived, ai);
}

export function sanitizeFlags(flags = []) {
  const allowed = new Set(EFP_FLAGS);
  const out = [];
  for (const f of flags) {
    const s = String(f || '').trim();
    if (!s) continue;
    if (allowed.has(s) || s.startsWith('needs_')) out.push(s);
  }
  return [...new Set(out)].slice(0, 12);
}
