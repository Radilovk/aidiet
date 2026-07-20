/**
 * Gemini responseSchema definitions for plan-generation steps (1–4).
 * Keeps JSON structure reliable in non-thinking mode without verbose prompt schemas.
 */

const CANONICAL_MEAL_TYPES = [
  'Хранене 1',
  'Хранене 2',
  'Хранене 3',
  'Хранене 4',
  'Хранене 5',
  'Свободно хранене',
];

const KEY_PROBLEM_SEVERITIES = ['Borderline', 'Risky', 'Critical'];
const KEY_PROBLEM_CATEGORIES = ['Sleep', 'Nutrition', 'Hydration', 'Stress', 'Activity', 'Medical'];

const MEAL_PLAN_MEAL_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: CANONICAL_MEAL_TYPES },
    name: { type: 'string' },
    description: { type: 'string' },
    dessert: { type: 'boolean' },
  },
  required: ['type', 'name', 'description'],
};

const MEAL_BREAKDOWN_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fats: { type: 'number' },
  },
  required: ['type', 'calories', 'protein', 'carbs', 'fats'],
};

const WEEKLY_DAY_SCHEMA = {
  type: 'object',
  properties: {
    meals: { type: 'number' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fats: { type: 'number' },
    description: { type: 'string' },
    mealBreakdown: {
      type: 'array',
      items: MEAL_BREAKDOWN_ITEM_SCHEMA,
    },
  },
  required: ['meals', 'calories', 'protein', 'carbs', 'fats', 'mealBreakdown'],
};

const WEEKLY_SCHEME_SCHEMA = {
  type: 'object',
  properties: {
    monday: WEEKLY_DAY_SCHEMA,
    tuesday: WEEKLY_DAY_SCHEMA,
    wednesday: WEEKLY_DAY_SCHEMA,
    thursday: WEEKLY_DAY_SCHEMA,
    friday: WEEKLY_DAY_SCHEMA,
    saturday: WEEKLY_DAY_SCHEMA,
    sunday: WEEKLY_DAY_SCHEMA,
  },
  required: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
};

export const PLAN_SYSTEM_INSTRUCTIONS = {
  step1: 'Клиничен диетолог, ендокринолог и психолог. Отговаряй САМО с валиден JSON. bmr и tdee са от бекенда — не ги преизчислявай.',
  step2: 'Експертен диетолог. Отговаряй САМО с валиден JSON. Калориите от анализа са финални — не ги преизчислявай.',
  step3: 'Диетолог за български хранителен план. Отговаряй САМО с валиден JSON. Продукти САМО от каталога; имената точно както в каталога.',
  step4: 'Клиничен диетолог и психолог. Отговаряй САМО с валиден JSON.',
};

export const ANALYSIS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    bmi: { type: 'number' },
    bmiCategory: { type: 'string' },
    bmr: { type: 'number' },
    tdee: { type: 'number' },
    Final_Calories: { type: 'number' },
    macroRatios: {
      type: 'object',
      properties: {
        protein: { type: 'number' },
        carbs: { type: 'number' },
        fats: { type: 'number' },
      },
      required: ['protein', 'carbs', 'fats'],
    },
    macroGrams: {
      type: 'object',
      properties: {
        protein: { type: 'number' },
        carbs: { type: 'number' },
        fats: { type: 'number' },
      },
      required: ['protein', 'carbs', 'fats'],
    },
    activityLevel: { type: 'string' },
    physiologicalPhase: { type: 'string' },
    waterDeficit: {
      type: 'object',
      properties: {
        dailyNeed: { type: 'string' },
        currentIntake: { type: 'string' },
        deficit: { type: 'string' },
        impactOnLipolysis: { type: 'string' },
      },
      required: ['dailyNeed', 'currentIntake', 'deficit', 'impactOnLipolysis'],
    },
    negativeHealthFactors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          factor: { type: 'string' },
          severity: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['factor', 'severity', 'description'],
      },
    },
    hinderingFactors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          factor: { type: 'string' },
          severity: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['factor', 'severity', 'description'],
      },
    },
    cumulativeRiskScore: { type: 'string' },
    psychoProfile: {
      type: 'object',
      properties: {
        temperament: { type: 'string' },
        probability: { type: 'number' },
        reasoning: { type: 'string' },
      },
      required: ['temperament', 'probability', 'reasoning'],
    },
    metabolicReactivity: {
      type: 'object',
      properties: {
        speed: { type: 'string' },
        adaptability: { type: 'string' },
      },
      required: ['speed', 'adaptability'],
    },
    correctedMetabolism: {
      type: 'object',
      properties: {
        realBMR: { type: 'number' },
        realTDEE: { type: 'number' },
        clinicalAdjustmentPercent: { type: 'number' },
        metabolicAdjustmentPercent: { type: 'number' },
        goalAdjustmentPercent: { type: 'number' },
        correction: { type: 'string' },
        correctionPercent: { type: 'string' },
      },
      required: [
        'realBMR', 'realTDEE',
        'clinicalAdjustmentPercent', 'metabolicAdjustmentPercent', 'goalAdjustmentPercent',
        'correction', 'correctionPercent',
      ],
    },
    metabolicProfile: { type: 'string' },
    healthRisks: { type: 'array', items: { type: 'string' } },
    nutritionalNeeds: { type: 'array', items: { type: 'string' } },
    psychologicalProfile: { type: 'string' },
    successChance: { type: 'number' },
    currentHealthStatus: {
      type: 'object',
      properties: {
        score: { type: 'number' },
        description: { type: 'string' },
        keyIssues: { type: 'array', items: { type: 'string' } },
      },
      required: ['score', 'description', 'keyIssues'],
    },
    forecastPessimistic: {
      type: 'object',
      properties: {
        timeframe: { type: 'string' },
        weight: { type: 'string' },
        health: { type: 'string' },
        risks: { type: 'array', items: { type: 'string' } },
      },
      required: ['timeframe', 'weight', 'health', 'risks'],
    },
    forecastOptimistic: {
      type: 'object',
      properties: {
        timeframe: { type: 'string' },
        weight: { type: 'string' },
        health: { type: 'string' },
        improvements: { type: 'array', items: { type: 'string' } },
      },
      required: ['timeframe', 'weight', 'health', 'improvements'],
    },
    keyProblems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          severity: { type: 'string', enum: KEY_PROBLEM_SEVERITIES },
          severityValue: { type: 'number' },
          category: { type: 'string', enum: KEY_PROBLEM_CATEGORIES },
          impact: { type: 'string' },
        },
        required: ['title', 'description', 'severity', 'severityValue', 'category', 'impact'],
      },
    },
  },
  required: [
    'bmi', 'bmiCategory', 'bmr', 'tdee', 'Final_Calories',
    'macroRatios', 'macroGrams',
    'correctedMetabolism', 'psychologicalProfile', 'keyProblems',
  ],
};

export const STRATEGY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    dietaryModifier: { type: 'string' },
    modifierReasoning: { type: 'string' },
    welcomeMessage: { type: 'string' },
    planJustification: { type: 'string' },
    longTermStrategy: { type: 'string' },
    mealCountJustification: { type: 'string' },
    afterDinnerMealJustification: { type: 'string' },
    dietType: { type: 'string' },
    weeklyMealPattern: { type: 'string' },
    weeklyScheme: WEEKLY_SCHEME_SCHEMA,
    freeDayNumber: { type: 'number' },
    includeDessert: { type: 'boolean' },
    breakfastStrategy: { type: 'string' },
    calorieDistribution: { type: 'string' },
    macroDistribution: { type: 'string' },
    mealTiming: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        fastingWindows: { type: 'string' },
        flexibility: { type: 'string' },
        chronotypeGuidance: { type: 'string' },
      },
      required: ['pattern', 'fastingWindows', 'flexibility', 'chronotypeGuidance'],
    },
    keyPrinciples: { type: 'array', items: { type: 'string' } },
    preferredFoodCategories: { type: 'array', items: { type: 'string' } },
    avoidFoodCategories: { type: 'array', items: { type: 'string' } },
    hydrationStrategy: { type: 'string' },
    communicationStyle: {
      type: 'object',
      properties: {
        temperament: { type: 'string' },
        tone: { type: 'string' },
        approach: { type: 'string' },
        chatGuidelines: { type: 'string' },
      },
      required: ['temperament', 'tone', 'approach', 'chatGuidelines'],
    },
  },
  required: [
    'dietaryModifier', 'dietType', 'weeklyScheme',
    'welcomeMessage', 'planJustification', 'mealTiming',
  ],
};

export const SUMMARY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        bmr: { type: 'number' },
        dailyCalories: { type: 'number' },
        macros: {
          type: 'object',
          properties: {
            protein: { type: 'number' },
            carbs: { type: 'number' },
            fats: { type: 'number' },
          },
          required: ['protein', 'carbs', 'fats'],
        },
      },
      required: ['bmr', 'dailyCalories', 'macros'],
    },
    recommendations: { type: 'array', items: { type: 'string' } },
    forbidden: { type: 'array', items: { type: 'string' } },
    psychology: { type: 'array', items: { type: 'string' } },
    waterIntake: { type: 'string' },
    supplements: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'recommendations', 'forbidden', 'psychology', 'waterIntake', 'supplements'],
};

/**
 * @param {number} dayNum
 */
export function buildMealPlanDaySchema(dayNum) {
  const dayKey = `day${dayNum}`;
  return {
    type: 'object',
    properties: {
      [dayKey]: {
        type: 'object',
        properties: {
          meals: {
            type: 'array',
            items: MEAL_PLAN_MEAL_SCHEMA,
          },
        },
        required: ['meals'],
      },
    },
    required: [dayKey],
  };
}

/**
 * @param {string|null|undefined} stepName
 * @returns {object|null}
 */
export function getPlanStepResponseSchema(stepName) {
  if (!stepName) return null;
  if (stepName.startsWith('step1')) return ANALYSIS_RESPONSE_SCHEMA;
  if (stepName.startsWith('step2')) return STRATEGY_RESPONSE_SCHEMA;

  const chunkMatch = stepName.match(/^step3_meal_plan_chunk_(\d+)/);
  if (chunkMatch) {
    return buildMealPlanDaySchema(parseInt(chunkMatch[1], 10));
  }
  if (stepName.startsWith('step3') || stepName === 'fallback_plan') {
    return buildMealPlanDaySchema(1);
  }
  if (stepName.startsWith('step4') || stepName === 'fallback_summary') {
    return SUMMARY_RESPONSE_SCHEMA;
  }
  return null;
}

/**
 * @param {string|null} stepKey
 * @returns {string|null}
 */
export function getPlanSystemInstruction(stepKey) {
  if (!stepKey) return null;
  return PLAN_SYSTEM_INSTRUCTIONS[stepKey] || null;
}
