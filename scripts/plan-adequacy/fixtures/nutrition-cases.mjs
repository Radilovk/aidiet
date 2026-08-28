/** Nutrition math test fixtures — calories, grams, macros consistency */

export const NUTRITION_MATH_MEALS = [
  {
    label: 'athlete lunch 900kcal',
    meal: {
      type: 'Хранене 2',
      description: '• Пилешки гърди 200g\n• Ориз 180g\n• Броколи 150g\n• Зехтин 15g',
    },
    target: { calories: 900, protein: 55, carbs: 80, fats: 25 },
    maxWeight: 800,
  },
  {
    label: 'H5 late snack 180kcal',
    meal: {
      type: 'Хранене 5',
      description: '• Скир 120g\n• Бадеми 15g',
    },
    target: { calories: 180, protein: 18, carbs: 8, fats: 8 },
    maxWeight: 200,
  },
  {
    label: 'H3 snack 220kcal',
    meal: {
      type: 'Хранене 3',
      description: '• Ябълка 150g\n• Бадеми 20g',
    },
    target: { calories: 220, protein: 6, carbs: 28, fats: 10 },
    maxWeight: 250,
  },
  {
    label: 'dessert lunch',
    meal: {
      type: 'Хранене 2',
      description: '• Пилешки гърди 140g\n• Салата 100g\n• Зехтин 8g',
      dessert: { weight: '30г', macros: { protein: 2, carbs: 14, fats: 12 } },
    },
    target: { calories: 650, protein: 42, carbs: 50, fats: 22 },
    maxWeight: 500,
  },
];

export const DAY_MACRO_TARGET = {
  dailyKcal: 2000,
  slots: [
    { type: 'Хранене 1', calories: 450, protein: 28, carbs: 45, fats: 14 },
    { type: 'Хранене 2', calories: 600, protein: 42, carbs: 55, fats: 18 },
    { type: 'Хранене 3', calories: 200, protein: 8, carbs: 22, fats: 8 },
    { type: 'Хранене 4', calories: 550, protein: 40, carbs: 40, fats: 16 },
  ],
};
