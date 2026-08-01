/** Synthetic plans for dietetic logic tests */

export const BAD_DIETETIC = {
  veganWithChicken: {
    profile: { id: 'vegan', dietPreference: ['Веган'] },
    weekPlan: {
      day1: {
        meals: [{
          type: 'Хранене 2',
          name: 'Пиле',
          description: '• пилешки гърди 150g\n• броколи 120g',
          calories: 400,
          macros: { protein: 40, carbs: 10, fats: 12 },
        }],
      },
    },
    strategy: { weeklyScheme: {} },
  },
  lactationAggressiveDeficit: {
    profile: { id: 'lactation', gender: 'Жена', clinicalProtocol: 'postpartum_lactation', weight: '74' },
    analysis: {
      Final_Calories: 1300,
      tdee: 2200,
      macroGrams: { protein: 90, carbs: 120, fats: 45 },
      macroRatios: { protein: 28, carbs: 37, fats: 35 },
    },
  },
  ketoHighCarbs: {
    profile: { id: 'keto', dietPreference: ['Кето'], weight: '70' },
    analysis: {
      Final_Calories: 1800,
      macroGrams: { protein: 100, carbs: 180, fats: 80 },
      macroRatios: { protein: 22, carbs: 40, fats: 38 },
    },
  },
  h3MainMeal: {
    profile: { id: 'generic' },
    weekPlan: {
      day1: {
        meals: [{
          type: 'Хранене 3',
          name: 'Говеждо с ориз',
          description: '• говеждо 150g\n• ориз 120g',
          calories: 450,
          macros: { protein: 35, carbs: 45, fats: 12 },
        }],
      },
    },
    strategy: { weeklyScheme: {} },
  },
  skipBreakfastViolation: {
    profile: { id: 'skip', eatingHabits: ['Не закусвам'] },
    weekPlan: {
      day1: {
        meals: [{
          type: 'Хранене 1',
          name: 'Закуска',
          description: '• овесени ядки 60g',
          calories: 300,
          macros: { protein: 12, carbs: 45, fats: 8 },
        }],
      },
    },
    strategy: { weeklyScheme: {} },
  },
};

export const GOOD_DIETETIC = {
  veganBalanced: {
    profile: { id: 'vegan', dietPreference: ['Веган'], goal: 'Мускулна маса', weight: '62', gender: 'Жена' },
    analysis: {
      Final_Calories: 2200,
      macroGrams: { protein: 95, carbs: 240, fats: 70 },
      macroRatios: { protein: 17, carbs: 44, fats: 29 },
    },
    weekPlan: {
      day1: {
        meals: [{
          type: 'Хранене 2',
          name: 'Тофу с броколи',
          description: '• тофу 180g\n• броколи 150g\n• зехтин 10g',
          calories: 520,
          macros: { protein: 35, carbs: 25, fats: 28 },
        }],
      },
    },
    strategy: { weeklyScheme: { monday: { calories: 2200, carbs: 240 } } },
  },
};
