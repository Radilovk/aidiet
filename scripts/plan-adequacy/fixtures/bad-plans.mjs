/** Bad meal/week fixtures — offline tests must catch these */

export const BAD_MEALS = {
  wrongMacroArithmetic: {
    type: 'Хранене 2',
    name: 'Грешни макроси',
    description: '• Пилешки гърди 150g\n• Ориз 150g\n• Домат 100g',
    calories: 650,
    macros: { protein: 45, carbs: 70, fats: 5 },
  },
  absurdGrams: {
    type: 'Хранене 2',
    name: 'Абсурдни грамажи',
    description: '• Пилешки гърди 5g\n• Ориз 900g',
    calories: 400,
    macros: { protein: 30, carbs: 50, fats: 10 },
  },
  unknownProduct: {
    type: 'Хранене 2',
    name: 'Несъществуващ продукт',
    description: '• Драконово месо 200g\n• Ориз 150g',
    calories: 500,
    macros: { protein: 35, carbs: 55, fats: 12 },
  },
  exoticFoods: {
    type: 'Хранене 4',
    name: 'Рядки продукти',
    description: '• Лаврак 200g\n• Манго 150g\n• Киноа 120g',
    calories: 550,
    macros: { protein: 40, carbs: 50, fats: 18 },
  },
  multiCarbs: {
    type: 'Хранене 2',
    name: 'Тройни въглехидрати',
    description: '• Пилешки гърди 150g\n• Ориз 150g\n• Картофи 200g\n• Хляб 80g',
    calories: 700,
    macros: { protein: 45, carbs: 80, fats: 15 },
  },
  peasAndFish: {
    type: 'Хранене 4',
    name: 'Грах с риба',
    description: '• Риба 200g\n• Грах 100g\n• Зехтир 10g',
    calories: 480,
    macros: { protein: 38, carbs: 25, fats: 20 },
  },
  weirdCombo: {
    type: 'Хранене 1',
    name: 'Риба с банан',
    description: '• Сьомга 150g\n• Банан 120g\n• Кисело мляко 100g',
    calories: 420,
    macros: { protein: 30, carbs: 35, fats: 15 },
  },
};

export const BAD_WEEK_SNIPPETS = {
  badCalorieTarget: {
    day1: {
      meals: [
        {
          type: 'Хранене 2',
          name: 'Обяд',
          description: '• Пилешки гърди 150g\n• Ориз 150g',
          calories: 200,
          macros: { protein: 40, carbs: 10, fats: 5 },
        },
      ],
    },
  },
};

/** Typical meals for nutrition pipeline smoke test */
export const TYPICAL_MEALS = [
  {
    meal: { type: 'Хранене 1', description: '• Овесени ядки 60g\n• Кисело мляко 200g\n• Банан 100g' },
    target: { calories: 450, protein: 25, carbs: 60, fats: 12 },
  },
  {
    meal: { type: 'Хранене 2', description: '• Пилешки гърди 150g\n• Ориз 150g\n• Домат 100g\n• Зехтин 10g' },
    target: { calories: 650, protein: 45, carbs: 70, fats: 18 },
  },
  {
    meal: { type: 'Хранене 3', description: '• Ябълка 150g\n• Бадеми 20g' },
    target: { calories: 250, protein: 8, carbs: 30, fats: 10 },
  },
];
