/**
 * KA-TRAINER — system/user prompt части и JSON schema за Gemini.
 * System = персона + hard rules + trainer RAG (делта).
 * User = scheme / constraints / program_spec / profile / exercise_catalog.
 */

/** Ядро — само това, което моделът би сгрешил без изрично указание. */
export const PLAN_SYSTEM_CORE = `Ти си български S&C треньор. Генерираш седмичен тренировъчен план (7 дни) в JSON.

ПРИОРИТЕТ при конфликт:
1. <scheme> — абсолютен (дни, упражнения, обем, структура)
2. <constraints> — hard-veto (забрани, оборудване, график)
3. <program_spec> — сплит, седмичен обем, reps/rest/RPE, ред
4. <profile> — здраве и ограничения (контекст)
5. <trainer_rules> — делта от треньора; не противоречи на 1–3
6. <exercise_catalog> — canonicalName САМО от списъка (ако е подаден)

ГЕНЕРАЦИЯ (когато няма <scheme>):
- Не измисляй сплит, седмичен обем или rep range — вземи от <program_spec>
- Разпредели volume/wk по тренировъчните дни според split
- canonicalName само от <exercise_catalog>; equipmentHint съответства на <equipment>
- Ред в деня: compound→isolation; zones↓ (от spec) първи

HARD-VETO:
- Болка/ограничение/операция → 0 натоварване на зоната
- Изрично нежелани движения → не включвай
- <equipment> = единствено позволено
- Сърдечно-съдов риск → спази rpe от spec; safetyNotes: лекарско одобрение

ИМЕНУВАНЕ:
- displayName: български | canonicalName: EN | equipmentHint/bodyPart: EN
- Bench Press → „Избутване от лежанка“. НИКОГА „лег преса“ за bench. Leg Press → „Преса за крака“.
- Олекоти/утежни — не „затежни“

ФОРМАТ: макс. 5 упражнения/ден; warmup/cooldown по 3 стъпки; notes≤80 знака; guidelines по 1 изречение.`;

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
