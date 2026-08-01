/** Synthetic plans for adequacy contract tests (offline, no AI). */

export const H5_SCHEME_CASES = [
  { cal: 162, ok: true, label: 'under-cap 162' },
  { cal: 191, ok: true, label: 'within tolerance 191' },
  { cal: 206, ok: true, label: 'within 10% 206' },
  { cal: 235, ok: false, label: 'over cap 235' },
];

export const SKIP_BREAKFAST_OK_PLAN = {
  weekPlan: {
    day1: { meals: [{ type: 'Хранене 2', name: 'Обяд', description: '• пилешки гърди 150g' }] },
  },
  strategy: { weeklyScheme: { monday: { mealBreakdown: [] } } },
};

export const SKIP_BREAKFAST_FAIL_PLAN = {
  weekPlan: {
    day2: { meals: [{ type: 'Хранене 1', name: 'Закуска', description: '• овесени ядки 60g' }] },
  },
  strategy: { weeklyScheme: {} },
};

export const SKIP_BREAKFAST_PLAN = {
  weekPlan: {
    day1: { meals: [{ type: 'Хранене 2', name: 'Обяд', description: '• пилешки гърди 150g' }] },
    day2: { meals: [{ type: 'Хранене 1', name: 'Закуска', description: '• овесени ядки 60g' }] },
  },
  strategy: { weeklyScheme: { monday: { mealBreakdown: [] } } },
};

export const DESSERT_RULE_PLAN = {
  weekPlan: {
    day1: {
      meals: [
        { type: 'Хранене 2', name: 'Обяд', description: '• пилешки гърди 150g', dessert: true },
      ],
    },
  },
  strategy: { includeDessert: true, weeklyScheme: {} },
};

export const READY_MEAL_PLAN = {
  weekPlan: {
    day1: {
      meals: [
        { type: 'Хранене 2', name: 'Готово', description: '• омлет със сирене 250g' },
      ],
    },
  },
  strategy: { weeklyScheme: {} },
};

export const VEGAN_ANALYSIS_RAW = {
  keyProblems: [
    { title: 'Потенциален дефицит на микронутриенти', severity: 'Risky', severityValue: 68, description: 'x', category: 'Health', impact: 'x' },
    { title: 'Риск от недостатъчен протеинов прием', severity: 'Borderline', severityValue: 52, description: 'x', category: 'Health', impact: 'x' },
  ],
  healthRisks: [
    'Потенциален дефицит на витамин B12, желязо, калций поради веганска диета.',
  ],
  nutritionalNeeds: [
    'Осигуряване на адекватен прием на витамин B12 чрез обогатени храни или добавки.',
  ],
  Final_Calories: 2547,
  macroRatios: { protein: 30, carbs: 45, fats: 25 },
  macroGrams: { protein: 191, carbs: 286, fats: 71 },
  currentHealthStatus: {
    score: 72,
    description: 'Добро общо състояние с фокус върху веган протеин и микронутриенти при висока активност.',
    keyIssues: ['Протеин', 'B12'],
  },
};
