#!/usr/bin/env node
import {
  rebalanceMealBreakdownSlots,
  normalizeAnalysisOutput,
  maxPlatedSlotKcal,
  severityLabelForValue,
  validateLightMealSlotContent,
} from '../plan-normalize.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

// Kamen-like: skip breakfast, high TDEE, bad AI distribution
{
  const day = {
    calories: 2774,
    mealBreakdown: [
      { type: 'Хранене 2', calories: 900, protein: 60, carbs: 80, fats: 30 },
      { type: 'Хранене 3', calories: 250, protein: 10, carbs: 20, fats: 10 },
      { type: 'Хранене 4', calories: 1424, protein: 90, carbs: 120, fats: 50 },
      { type: 'Хранене 5', calories: 200, protein: 15, carbs: 5, fats: 12 },
    ],
  };
  const maxK = maxPlatedSlotKcal(day.mealBreakdown, 2774);
  rebalanceMealBreakdownSlots(day, 2774);
  const sum = day.mealBreakdown.reduce((s, m) => s + m.calories, 0);
  const h4 = day.mealBreakdown.find(m => m.type === 'Хранене 4');
  const over = day.mealBreakdown.filter(m => m.type !== 'Свободно хранене' && m.type !== 'Хранене 5' && m.calories > maxK);
  check('Kamen-like: всички plated слотове ≤ dynamic max', over.length === 0, `max=${maxK}, H4=${h4?.calories}`);
  check('Kamen-like: дневната сума запазена', Math.abs(sum - 2774) <= 30, `sum=${sum}`);
}

// Free day oversized budget
{
  const day = {
    calories: 2774,
    mealBreakdown: [
      { type: 'Свободно хранене', calories: 1200, protein: 40, carbs: 100, fats: 50 },
      { type: 'Хранене 4', calories: 1374, protein: 80, carbs: 100, fats: 45 },
      { type: 'Хранене 5', calories: 200, protein: 15, carbs: 5, fats: 12 },
    ],
  };
  rebalanceMealBreakdownSlots(day, 2774);
  const free = day.mealBreakdown.find(m => m.type === 'Свободно хранене');
  const maxFree = Math.round(2774 * 0.45);
  check('Free meal: cap на ~45% от дневните', free.calories <= maxFree, `${free.calories} ≤ ${maxFree}`);
}

// Analysis: severity label drift
{
  const analysis = {
    keyProblems: [
      { title: 'Компенсаторно поведение', severity: 'Borderline', severityValue: 60 },
      { title: 'Стрес', severity: 'Risky', severityValue: 70 },
    ],
    currentHealthStatus: {},
  };
  normalizeAnalysisOutput(analysis);
  check('Analysis: severity label от value', analysis.keyProblems[0].severity === 'Risky');
  check('Analysis: health score попълнен', typeof analysis.currentHealthStatus.score === 'number');
}

check('severityLabelForValue(60)=Risky', severityLabelForValue(60) === 'Risky');

{
  const day = {
    calories: 2774,
    mealBreakdown: [
      { type: 'Свободно хранене', calories: 1200, protein: 40, carbs: 100, fats: 50 },
      { type: 'Хранене 3', calories: 250, protein: 10, carbs: 20, fats: 10 },
      { type: 'Хранене 4', calories: 1063, protein: 70, carbs: 80, fats: 40 },
      { type: 'Хранене 5', calories: 200, protein: 15, carbs: 5, fats: 12 },
    ],
  };
  rebalanceMealBreakdownSlots(day, 2774);
  const h4 = day.mealBreakdown.find(m => m.type === 'Хранене 4');
  check('free day: H4 capped ≤600', h4.calories <= 600, `${h4.calories} kcal`);
}

{
  const errs = validateLightMealSlotContent({ type: 'Хранене 3', name: 'Говеждо с броколи', description: '• говеждо 150g' }, 6);
  check('H3 rejects cooked meat', errs.length > 0);
}

const passed = results.filter(Boolean).length;
console.log(`\n=== ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 1);
