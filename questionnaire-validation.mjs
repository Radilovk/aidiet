/**
 * Shared deterministic questionnaire validation (client + worker).
 * Catches unrealistic / contradictory data before AI plan generation.
 */

export const DEFAULT_DATA_VALIDATION_LIMITS = {
  minAge: 13,
  maxAge: 100,
  minWeightKg: 20,
  maxWeightKg: 300,
  minHeightCm: 100,
  maxHeightCm: 250,
  minBmi: 10,
  maxBmi: 80,
  maxWeightLossKg: 50,
  maxWeightLossPercent: 0.5,
};

export const DEFAULT_CONTRADICTION_RULES = {
  underweightLoss: { enabled: true, bmiThreshold: 18.5, canProceed: true },
  thyroidAggressiveDeficit: { enabled: true, tdeeFloor: 0.75, canProceed: true },
  anemiaPlanBased: { enabled: true, canProceed: true },
};

const OFFENSIVE_PATTERNS = [
  /(педал|курв|мръсн|идиот|глупа[кц]|дебил|тъп[аи])/i,
  /(viagra|casino|xxx|porn)/i,
  /^(test|тест|asdf|qwerty|12345|aaa|zzz)$/i,
];

/** @param {unknown} value */
export function parseNumber(value) {
  if (value == null || value === '') return NaN;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** @param {number} weightKg @param {number} heightCm */
export function calculateBmiFromMetrics(weightKg, heightCm) {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

/** @param {Record<string, unknown>} data */
export function calculateBmi(data) {
  return calculateBmiFromMetrics(parseNumber(data.weight), parseNumber(data.height));
}

/**
 * @param {Record<string, unknown>} [config]
 */
function resolveLimits(config) {
  /** @type {typeof DEFAULT_DATA_VALIDATION_LIMITS} */
  const dv = /** @type {any} */ (config?.dataValidation) || DEFAULT_DATA_VALIDATION_LIMITS;
  return {
    minAge: dv.minAge ?? DEFAULT_DATA_VALIDATION_LIMITS.minAge,
    maxAge: dv.maxAge ?? DEFAULT_DATA_VALIDATION_LIMITS.maxAge,
    minWeightKg: dv.minWeightKg ?? DEFAULT_DATA_VALIDATION_LIMITS.minWeightKg,
    maxWeightKg: dv.maxWeightKg ?? DEFAULT_DATA_VALIDATION_LIMITS.maxWeightKg,
    minHeightCm: dv.minHeightCm ?? DEFAULT_DATA_VALIDATION_LIMITS.minHeightCm,
    maxHeightCm: dv.maxHeightCm ?? DEFAULT_DATA_VALIDATION_LIMITS.maxHeightCm,
    minBmi: dv.minBmi ?? DEFAULT_DATA_VALIDATION_LIMITS.minBmi,
    maxBmi: dv.maxBmi ?? DEFAULT_DATA_VALIDATION_LIMITS.maxBmi,
    maxWeightLossKg: dv.maxWeightLossKg ?? DEFAULT_DATA_VALIDATION_LIMITS.maxWeightLossKg,
    maxWeightLossPercent: dv.maxWeightLossPercent ?? DEFAULT_DATA_VALIDATION_LIMITS.maxWeightLossPercent,
  };
}

/**
 * @typedef {{ category: string, description: string, severity: 'high' | 'medium', field?: string }} ValidationIssue
 */

/**
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} [config]
 * @returns {{ issues: ValidationIssue[], errorMessage: string }}
 */
export function validateDataAdequacyIssues(data, config) {
  const limits = resolveLimits(config);
  /** @type {ValidationIssue[]} */
  const issues = [];

  const weight = parseNumber(data.weight);
  const height = parseNumber(data.height);
  const age = parseInt(String(data.age ?? ''), 10);

  if (!Number.isFinite(weight) || weight < limits.minWeightKg || weight > limits.maxWeightKg) {
    issues.push({
      category: 'НЕВАЛИДНИ ДАННИ',
      description: `Теглото трябва да бъде между ${limits.minWeightKg} и ${limits.maxWeightKg} кг. Моля, въведете реалистична стойност.`,
      severity: 'high',
      field: 'weight',
    });
  }

  if (!Number.isFinite(height) || height < limits.minHeightCm || height > limits.maxHeightCm) {
    if (Number.isFinite(height) && height > 0 && height < 50) {
      issues.push({
        category: 'НЕЛОГИЧНА ИНФОРМАЦИЯ',
        description: `Ръстът изглежда в метри (${height}), а въпросникът очаква сантиметри. Напр. за 1.65 м въведете 165.`,
        severity: 'high',
        field: 'height',
      });
    } else {
      issues.push({
        category: 'НЕВАЛИДНИ ДАННИ',
        description: `Височината трябва да бъде между ${limits.minHeightCm} и ${limits.maxHeightCm} см. Моля, въведете реалистична стойност.`,
        severity: 'high',
        field: 'height',
      });
    }
  }

  if (!Number.isFinite(age) || age < limits.minAge || age > limits.maxAge) {
    issues.push({
      category: 'НЕВАЛИДНИ ДАННИ',
      description: `Възрастта трябва да бъде между ${limits.minAge} и ${limits.maxAge} години. Моля, въведете реалистична стойност.`,
      severity: 'high',
      field: 'age',
    });
  }

  if (Number.isFinite(age) && age < 13) {
    issues.push({
      category: 'НЕВАЛИДНИ ДАННИ',
      description: 'Услугата е достъпна само за лица на 13 или повече години.',
      severity: 'high',
      field: 'age',
    });
  }

  if (Number.isFinite(weight) && Number.isFinite(height)
    && weight >= limits.minWeightKg && weight <= limits.maxWeightKg
    && height >= limits.minHeightCm && height <= limits.maxHeightCm) {
    const bmi = calculateBmiFromMetrics(weight, height);
    if (bmi != null && bmi < limits.minBmi) {
      issues.push({
        category: 'НЕЛОГИЧНА ИНФОРМАЦИЯ',
        description: 'Въведените данни водят до медицински невъзможно ниско BMI. Моля, проверете теглото и височината.',
        severity: 'high',
        field: 'weight',
      });
    } else if (bmi != null && bmi > limits.maxBmi) {
      issues.push({
        category: 'НЕЛОГИЧНА ИНФОРМАЦИЯ',
        description: 'Въведените данни водят до медицински невъзможно високо BMI. Моля, проверете теглото и височината.',
        severity: 'high',
        field: 'weight',
      });
    }
  }

  const goalStr = normalizeGoal(data.goal);
  const lossKg = parseNumber(data.lossKg);
  if (goalStr.includes('отслабване') && Number.isFinite(lossKg) && Number.isFinite(weight)) {
    if (lossKg > weight * limits.maxWeightLossPercent) {
      issues.push({
        category: 'НЕРЕАЛИСТИЧНА ЦЕЛ',
        description: `Целевото отслабване е твърде голямо (повече от ${limits.maxWeightLossPercent * 100}% от телесното тегло). Моля, задайте по-реалистична цел.`,
        severity: 'high',
        field: 'lossKg',
      });
    }
    if (lossKg > limits.maxWeightLossKg) {
      issues.push({
        category: 'НЕРЕАЛИСТИЧНА ЦЕЛ',
        description: `Целевото отслабване не може да надвишава ${limits.maxWeightLossKg} кг в рамките на един план. Моля, задайте по-умерена начална цел.`,
        severity: 'high',
        field: 'lossKg',
      });
    }
    if (lossKg <= 0) {
      issues.push({
        category: 'НЕВАЛИДНИ ДАННИ',
        description: 'Желаното отслабване трябва да е положително число в килограми.',
        severity: 'high',
        field: 'lossKg',
      });
    }
  }

  const textFields = [
    { field: 'name', value: data.name },
    { field: 'dietDislike', value: data.dietDislike },
    { field: 'dietLove', value: data.dietLove },
    { field: 'additionalNotes', value: data.additionalNotes },
    { field: 'medicationsDetails', value: data.medicationsDetails },
    { field: 'weightChangeDetails', value: data.weightChangeDetails },
  ];

  for (const { field, value } of textFields) {
    if (value && typeof value === 'string') {
      for (const pattern of OFFENSIVE_PATTERNS) {
        if (pattern.test(value.trim())) {
          issues.push({
            category: 'НЕВАЛИДНИ ДАННИ',
            description: 'Въведената информация съдържа неподходящо съдържание. Моля, проверете всички полета и въведете коректна информация.',
            severity: 'high',
            field,
          });
          break;
        }
      }
      if (issues.some(i => i.field === field)) break;
    }
  }

  const errorMessage = issues.length
    ? 'Моля, проверете въведените данни:\n\n' + issues.map(i => i.description).join('\n\n')
    : '';

  return { issues, errorMessage };
}

/** @param {unknown} goal */
export function normalizeGoal(goal) {
  if (Array.isArray(goal)) return String(goal[0] || '').toLowerCase().trim();
  return String(goal || '').toLowerCase().trim();
}

/** @param {unknown} value */
function asStringArray(value) {
  if (Array.isArray(value)) return value.map(v => String(v));
  if (value == null || value === '') return [];
  return [String(value)];
}

/**
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} [config]
 */
export function detectGoalContradictionIssues(data, config) {
  const bmi = calculateBmi(data);
  const goalStr = normalizeGoal(data.goal);
  if (!bmi || !goalStr) {
    return { hasContradiction: false, canProceed: true, warningData: {}, issues: [] };
  }

  const rules = /** @type {any} */ (config?.contradictionRules) || DEFAULT_CONTRADICTION_RULES;
  const uwRule = rules.underweightLoss ?? DEFAULT_CONTRADICTION_RULES.underweightLoss;
  const anemiaRule = rules.anemiaPlanBased ?? DEFAULT_CONTRADICTION_RULES.anemiaPlanBased;

  /** @type {ValidationIssue[]} */
  const issues = [];
  let warningData = {};

  const bmiThreshold = uwRule.bmiThreshold ?? 18.5;
  if (uwRule.enabled !== false && bmi < bmiThreshold && goalStr.includes('отслабване')) {
    const canProceed = uwRule.canProceed !== false;
    warningData = {
      type: 'underweight_loss',
      canProceed,
      bmi: bmi.toFixed(1),
      currentCategory: bmi < 16 ? 'Значително поднормено тегло' : 'Поднормено тегло',
      goalCategory: Array.isArray(data.goal) ? data.goal[0] : data.goal,
      risks: [
        'Недохранване и дефицит на важни хранителни вещества',
        'Отслабване на имунната система',
        'Загуба на мускулна маса и костна плътност',
        'Хормонален дисбаланс',
        'Повишен риск от здравословни усложнения',
      ],
      recommendation: 'При вашето текущо тегло целта за отслабване е медицински неподходяща и опасна. Препоръчваме да консултирате лекар и да работите за постигане на здравословно тегло чрез балансирано хранене.',
    };
    issues.push({
      category: 'ОПАСНА ЦЕЛ',
      description: warningData.recommendation,
      severity: canProceed ? 'medium' : 'high',
      field: 'goal',
    });
    return { hasContradiction: true, canProceed, warningData, issues };
  }

  const medical = asStringArray(data.medicalConditions);
  if (anemiaRule.enabled !== false
    && medical.includes('Анемия')
    && asStringArray(data.dietPreference).some(p => p.includes('Вегетарианска') || p.includes('Веган'))) {
    const canProceed = anemiaRule.canProceed !== false;
    warningData = {
      type: 'anemia_plant_based',
      canProceed,
      bmi: bmi.toFixed(1),
      currentCategory: 'Анемия',
      goalCategory: Array.isArray(data.goal) ? data.goal[0] : data.goal,
      risks: [
        'Влошаване на анемията поради ниско усвояване на растително желязо',
        'Хронична умора и отслабване',
        'Имунна дисфункция',
      ],
      recommendation: 'При анемия и вегетарианска/веган диета е критично важно да се осигури достатъчно желязо чрез добавки и оптимизирано хранене. Задължителна е медицинска консултация и наблюдение на нивата на желязо.',
    };
    issues.push({
      category: 'РИСКОВА КОМБИНАЦИЯ',
      description: warningData.recommendation,
      severity: canProceed ? 'medium' : 'high',
      field: 'dietPreference',
    });
    return { hasContradiction: true, canProceed, warningData, issues };
  }

  return { hasContradiction: false, canProceed: true, warningData: {}, issues: [] };
}

/**
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} [config]
 */
export function runDeterministicValidation(data, config) {
  const adequacy = validateDataAdequacyIssues(data, config);
  const contradiction = detectGoalContradictionIssues(data, config);
  const issues = [...adequacy.issues, ...contradiction.issues];

  const hasHigh = issues.some(i => i.severity === 'high');
  const canProceed = !hasHigh && (contradiction.canProceed !== false);

  return {
    isValid: issues.length === 0,
    canProceed,
    issues,
    errorMessage: adequacy.errorMessage || (issues[0]?.description ?? ''),
    warningData: contradiction.warningData,
    hasContradiction: contradiction.hasContradiction,
  };
}

/**
 * Live field validation while filling the questionnaire.
 * @param {string} fieldId
 * @param {unknown} value
 * @param {Record<string, unknown>} answers
 * @param {Record<string, unknown>} [config]
 */
export function validateLiveField(fieldId, value, answers, config) {
  const draft = { ...answers, [fieldId]: value };
  const limits = resolveLimits(config);

  if (fieldId === 'age' || fieldId === 'weight' || fieldId === 'height' || fieldId === 'lossKg') {
    const num = parseNumber(value);
    if (value === '' || value == null) return { valid: false, message: '' };

    if (fieldId === 'age') {
      if (!Number.isInteger(num) || num < limits.minAge || num > limits.maxAge) {
        return { valid: false, message: `Възрастта трябва да е между ${limits.minAge} и ${limits.maxAge} години.` };
      }
    }
    if (fieldId === 'weight') {
      if (!Number.isFinite(num) || num < limits.minWeightKg || num > limits.maxWeightKg) {
        return { valid: false, message: `Теглото трябва да е между ${limits.minWeightKg} и ${limits.maxWeightKg} кг.` };
      }
    }
    if (fieldId === 'height') {
      if (Number.isFinite(num) && num > 0 && num < 50) {
        return { valid: false, message: 'Изглежда сте въвели метри — въведете сантиметри (напр. 165).' };
      }
      if (!Number.isFinite(num) || num < limits.minHeightCm || num > limits.maxHeightCm) {
        return { valid: false, message: `Ръстът трябва да е между ${limits.minHeightCm} и ${limits.maxHeightCm} см.` };
      }
    }
    if (fieldId === 'lossKg') {
      const weight = parseNumber(draft.weight);
      if (!Number.isFinite(num) || num <= 0) {
        return { valid: false, message: 'Въведете положително число килограми.' };
      }
      if (Number.isFinite(weight) && num > weight * limits.maxWeightLossPercent) {
        return { valid: false, message: `Целта надвишава ${limits.maxWeightLossPercent * 100}% от текущото тегло.` };
      }
      if (num > limits.maxWeightLossKg) {
        return { valid: false, message: `Максимум ${limits.maxWeightLossKg} кг за един план.` };
      }
    }

    if ((fieldId === 'weight' || fieldId === 'height') && Number.isFinite(parseNumber(draft.weight)) && Number.isFinite(parseNumber(draft.height))) {
      const bmi = calculateBmiFromMetrics(parseNumber(draft.weight), parseNumber(draft.height));
      if (bmi != null && (bmi < limits.minBmi || bmi > limits.maxBmi)) {
        return { valid: false, message: 'Комбинацията тегло/ръст дава нереалистично BMI — проверете стойностите.' };
      }
    }
  }

  return { valid: true, message: '' };
}

/** @param {ValidationIssue[]} issues */
export function firstIssueField(issues) {
  const priority = ['height', 'weight', 'age', 'lossKg', 'goal', 'dietPreference'];
  for (const field of priority) {
    if (issues.some(i => i.field === field)) return field;
  }
  return issues.find(i => i.field)?.field || null;
}
