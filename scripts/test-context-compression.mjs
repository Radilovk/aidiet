import fs from 'fs';
import {
  serializeUserProfile,
  serializeBackendCalculations,
  serializeAnalysisForStep,
  serializeStrategyForMealPlan,
  serializeWeeklySchemeTargets,
  serializePreviousDays,
  serializeWeekPlanSummary,
  estimateTokenCount,
} from '../context-compression.js';

const example = JSON.parse(fs.readFileSync('./clients/EXAMPLE_client_data.json', 'utf8')).answers;

const combinedNotes = example.additionalNotes || '';
const profileFull = serializeUserProfile(example, 'full', {
  hasNotesSection: !!combinedNotes,
  hasClinicalSection: false,
});
const profileJson = JSON.stringify(example, null, 2);

const backend = serializeBackendCalculations({
  activityScore: { combinedScore: 5.2, activityLevel: 'Средна' },
  bmr: 1850,
  tdee: 2400,
  safeDeficit_reference: { targetCalories: 1968, deficitPercent: 18, maxDeficitCalories: 1800 },
  baselineMacros: { protein: 30, carbs: 45, fats: 25, proteinGramsPerKg: 1.6 },
});
const backendJson = JSON.stringify({
  activityScore: { combinedScore: 5.2, activityLevel: 'Средна' },
  bmr: 1850, tdee: 2400,
  safeDeficit_reference: { targetCalories: 1968, deficitPercent: 18, maxDeficitCalories: 1800 },
  baselineMacros: { protein: 30, carbs: 45, fats: 25, proteinGramsPerKg: 1.6 },
}, null, 2);

const analysis = {
  bmi: 26.2,
  bmr: 1850,
  Final_Calories: 1800,
  macroRatios: { protein: 30, carbs: 40, fats: 30 },
  macroGrams: { protein: 135, carbs: 180, fats: 60 },
  correctedMetabolism: { realBMR: 1850, realTDEE: 1800 },
  psychoProfile: { temperament: 'Холерик', probability: 85 },
  psychologicalProfile: 'Активен тип с tendency към стресово хранене.',
  keyProblems: [{ title: 'Недостатъчен сън', severity: 'Risky' }],
  nutritionalNeeds: ['Магнезий', 'Омега-3'],
};

const strategy = {
  dietType: 'Средиземноморска',
  dietaryModifier: 'Балансирано',
  weeklyMealPattern: 'Традиционна',
  mealTiming: { pattern: '4 хранения' },
  keyPrinciples: ['Баланс', 'Разнообразие', 'Хидратация'],
  preferredFoodCategories: ['Риба', 'Зеленчуци'],
  avoidFoodCategories: ['Преработено'],
  calorieDistribution: 'Равномерно',
  macroDistribution: '30/40/30',
  freeDayNumber: 6,
  weeklyScheme: {
    monday: {
      calories: 1800, protein: 120, carbs: 180, fats: 60,
      mealBreakdown: [
        { type: 'Хранене 1', calories: 350, protein: 25, carbs: 40, fats: 12 },
        { type: 'Хранене 2', calories: 550, protein: 40, carbs: 55, fats: 18 },
        { type: 'Хранене 4', calories: 450, protein: 35, carbs: 45, fats: 15 },
      ],
    },
  },
};

const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const weeklyOld = (() => {
  const lines = [];
  for (let d = 1; d <= 2; d++) {
    const key = dayKeys[d - 1];
    const dayTarget = strategy.weeklyScheme[key] || strategy.weeklyScheme.monday;
    lines.push(`   Ден ${d} (ден): ~1800 kcal | Б:120г В:180г М:60г (±50 kcal OK)`);
    dayTarget.mealBreakdown.forEach(m => {
      lines.push(`     → ${m.type}: ~${m.calories} kcal | Б:${m.protein}г В:${m.carbs}г М:${m.fats}г`);
    });
  }
  return lines.join('\n');
})();

const weeklyNew = serializeWeeklySchemeTargets(strategy, 1, 2, 1800, dayKeys, 50);

const cases = [
  ['Step1 profile JSON (pretty)', profileJson],
  ['Step1 profile NPCF', profileFull],
  ['Step1 backend JSON (pretty)', backendJson],
  ['Step1 backend NPCF', backend],
  ['Step2 analysis JSON', JSON.stringify(analysis, null, 2)],
  ['Step2 analysis NPCF', serializeAnalysisForStep(analysis, 2)],
  ['Step3 analysis NPCF', serializeAnalysisForStep(analysis, 3)],
  ['Step3 strategy NPCF', serializeStrategyForMealPlan(strategy)],
  ['Step3 weekly targets OLD', weeklyOld],
  ['Step3 weekly targets NPCF', weeklyNew],
  ['Step3 previous days NPCF', serializePreviousDays([
    { day: 1, meals: [{ name: 'Овесена каша' }, { name: 'Пилешко с броколи' }] },
    { day: 2, meals: [{ name: 'Омлет' }, { name: 'Риба със салата' }] },
  ])],
];

console.log('Compression benchmark (estimateTokenCount):\n');
console.log('Case'.padEnd(32), 'Chars'.padStart(6), 'Tokens'.padStart(7), 'Ratio'.padStart(7));
console.log('-'.repeat(56));

const pairs = [
  ['Step1 profile', profileJson, profileFull],
  ['Step1 backend', backendJson, backend],
  ['Step2 analysis', JSON.stringify(analysis, null, 2), serializeAnalysisForStep(analysis, 2)],
  ['Step3 weekly', weeklyOld, weeklyNew],
];

for (const [name, text] of cases) {
  console.log(name.padEnd(32), String(text.length).padStart(6), String(estimateTokenCount(text)).padStart(7), ''.padStart(7));
}

console.log('\nPairwise savings:');
for (const [label, oldT, newT] of pairs) {
  const o = estimateTokenCount(oldT);
  const n = estimateTokenCount(newT);
  console.log(`  ${label}: ${o} → ${n} tokens (${(o / n).toFixed(2)}x)`);
}
