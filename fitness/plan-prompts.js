/**
 * KA-TRAINER — system/user prompt части и JSON schema за Gemini.
 * System = персона + hard rules + trainer RAG (делта).
 * User = scheme / constraints / program_spec / profile / exercise_catalog.
 */

/** Ядро — само product-specific правила; без учебник по тренировки. */
export const PLAN_SYSTEM_CORE = `Български S&C треньор → седмичен план (7 дни) JSON.

ПРИОРИТЕТ: <scheme> > <constraints> > <program_spec> > <profile> > <trainer_rules> > <exercise_catalog>

БЕЗ <scheme>:
- split, volume/wk, reps/rest/RPE, dayFocus, session — САМО от <program_spec>
- canonicalName САМО от <exercise_catalog>; equipmentHint от <equipment>; d≤maxDiff от spec

HARD-VETO: <constraints>; болка/забрана → 0 натоварване на зоната

ИМЕНА: displayName BG | canonicalName/equipmentHint/bodyPart EN
Bench Press → „Избутване от лежанка“ (НЕ „лег преса“). Leg Press → „Преса за крака“. Утежни/олекоти.

ФОРМАТ: ≤5 exercises/ден; warmup/cooldown по 3 стъпки; notes≤80; guidelines по 1 изречение.`;

export const PLAN_SYSTEM_ASSEMBLY = `Сглобяваш готова програма в JSON. НЕ променяш <scheme>.

ЗАДАЧА: за всяко упражнение от scheme — canonicalName (EN) за lookup; displayName (BG); equipmentHint/bodyPart (EN).
Запази дни, упражнения, серии, повторения, почивки ТОЧНО. Без добавяне, премахване или пренареждане.

ИМЕНУВАНЕ: Bench Press → „Избутване от лежанка“. Leg Press → „Преса за крака“.
JSON: 7 дни; кратки warmup/cooldown; guidelines по 1 изречение.`;

export const STRICT_ASSEMBLY_RETRY_HINT = `

ПОВТОР: <scheme> буквално → JSON. Без промени в структурата.`;

export const GENDER_FIT_RETRY_HINT = `

КОРЕКЦИЯ: жена — повече glute, по-малко bench/press/curl. JSON само.`;

export const CONSTRAINT_RETRY_HINT = `

КОРЕКЦИЯ: спази <constraints> hard-veto — премахни забранените движения (импланти/гърди, avoid). JSON само.`;

export const EQUIPMENT_RETRY_HINT = `

КОРЕКЦИЯ: equipmentHint само от <equipment>; canonicalName от <exercise_catalog> с позволено оборудване. JSON само.`;

export const SESSION_STRUCTURE_RETRY_HINT = `

КОРЕКЦИЯ: session от program_spec; warmup+cooldown по 3 стъпки. JSON само.`;

export const DIFF_RETRY_HINT = `

КОРЕКЦИЯ: само упражнения с d≤maxDiff от program_spec; canonicalName от каталога. JSON само.`;

export const COMPACT_PLAN_RETRY_HINT = `

КОМПАКТНО: макс. 4 упражнения/ден; notes≤60 знака. Само валиден JSON.`;

const EXERCISE_SCHEMA = {
  type: 'object',
  required: ['displayName', 'canonicalName', 'equipmentHint', 'bodyPart', 'sets', 'reps', 'restSeconds'],
  properties: {
    displayName: { type: 'string', description: 'Bulgarian exercise name for the client' },
    canonicalName: { type: 'string', description: 'Standard English name for media lookup' },
    equipmentHint: { type: 'string' },
    bodyPart: { type: 'string' },
    sets: { type: 'integer' },
    reps: { type: 'string' },
    restSeconds: { type: 'integer' },
    tempo: { type: 'string' },
    rpe: { type: 'string' },
    notes: { type: 'string' },
  },
};

/** Gemini responseSchema — constrained JSON при thinkingBudget=0. */
export const PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['title', 'summary', 'weeklySplit', 'safetyNotes', 'days', 'guidelines'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    weeklySplit: { type: 'string' },
    safetyNotes: { type: 'array', items: { type: 'string' } },
    days: {
      type: 'array',
      items: {
        type: 'object',
        required: ['day', 'focus', 'type', 'durationMin', 'warmup', 'exercises', 'cooldown'],
        properties: {
          day: { type: 'string' },
          focus: { type: 'string' },
          type: {
            type: 'string',
            enum: ['strength', 'cardio', 'hiit', 'mobility', 'rest', 'active-recovery'],
          },
          durationMin: { type: 'integer' },
          warmup: { type: 'array', items: { type: 'string' } },
          exercises: { type: 'array', items: EXERCISE_SCHEMA },
          cooldown: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    guidelines: {
      type: 'object',
      required: ['progression', 'recovery', 'nutrition', 'adaptation'],
      properties: {
        progression: { type: 'string' },
        recovery: { type: 'string' },
        nutrition: { type: 'string' },
        adaptation: { type: 'string' },
      },
    },
  },
};

export function buildPlanSystemInstruction(trainerAddon = '') {
  const addon = String(trainerAddon || '').trim();
  return addon ? `${PLAN_SYSTEM_CORE}\n\n${addon}` : PLAN_SYSTEM_CORE;
}
