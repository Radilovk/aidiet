/**
 * KA-TRAINER — system/user prompt части и JSON schema за Gemini.
 * System = персона + правила + trainer RAG. User = само контекст + задача.
 */

/** Ядро на system instruction — само делта, която моделът би сгрешил без нея. */
export const PLAN_SYSTEM_CORE = `Ти си български S&C треньор. Генерираш един седмичен тренировъчен план (7 дни).

ПРИОРИТЕТ при конфликт:
1. <constraints>, <profile>, <scheme> от user съобщението
2. <trainer_rules> по-долу (foundation → individual_guidelines → architecture_guidelines)
3. Общи знания

HARD-VETO:
- Болка/ограничение/операция → 0 упражнения, натоварващи зоната
- Изрично нежелани движения → не включвай
- <equipment> = единствено позволено; equipmentHint трябва да съответства
- Сърдечно-съдов риск → RPE≤7, без Valsalva; safetyNotes: лекарско одобрение

ИМЕНУВАНЕ:
- displayName: български | canonicalName: английско (Barbell Bench Press) | equipmentHint/bodyPart: английски
- Bench Press → „Избутване от лежанка“. НИКОГА „лег преса“ за bench. Leg Press → „Преса за крака“.
- Олекоти/утежни — не „затежни“

КОМПАКТНОСТ: макс. 5 упражнения/ден; warmup/cooldown по 3 стъпки; notes≤80 знака; guidelines по 1 изречение/поле.`;

export const GENDER_FIT_RETRY_HINT = `

КОРЕКЦИЯ (жена): приоритет дупе (обем+форма); бедра стегнати, но по-малък обем от дупе; горна част само постура/гръб (ред, пулдаун) — без bench/press/curl обем. JSON само.`;

export const COMPACT_PLAN_RETRY_HINT = `

КОМПАКТНО: макс. 4 упражнения/ден; warmup/cooldown по 2 стъпки; notes≤60 знака. Отговори САМО с валиден JSON.`;

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
