#!/usr/bin/env node
/** Step 6 Final Director — parse + bounded apply (no AI). */
import {
  parseDirectorResponse,
  applyDirectorAdjustments,
  buildFinalDirectorPrompt,
  finalDirectorEnabled,
} from '../step6-final-director.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

ok(finalDirectorEnabled({}), 'director enabled by default');
ok(!finalDirectorEnabled({ FINAL_DIRECTOR: '0' }), 'opt-out FINAL_DIRECTOR=0');

const director = parseDirectorResponse({
  verdict: 'ADJUST',
  qualityScore: 88,
  headline: 'Планът е готов',
  clientMessage: 'Финален вариант за клиента.',
  recommendations: ['Риба', 'Зеленчуци'],
  forbidden: ['Пържено'],
  psychology: ['Пией вода', 'Спи достатъчно', 'Бъди последователен'],
  mealCopyPatches: [{ day: 1, mealIndex: 0, name: 'Ново име', benefits: 'Полза', recipe: 'Рецепта' }],
});

ok(director.verdict === 'ADJUST', 'parse verdict');
ok(director.recommendations.length === 2, 'parse recommendations');

const plan = {
  weekPlan: {
    day1: {
      meals: [{
        type: 'Хранене 1',
        name: 'Старо',
        description: '• Яйца\n• 100g',
        calories: 400,
        protein: 30,
      }],
    },
  },
  summary: {},
  generationWarnings: [],
};

applyDirectorAdjustments(plan, director);
ok(plan.directorHeadline === 'Планът е готов', 'headline applied');
ok(plan.recommendations[0] === 'Риба', 'recommendations applied');
ok(plan.weekPlan.day1.meals[0].name === 'Ново име', 'meal name patch');
ok(plan.weekPlan.day1.meals[0].description.includes('Яйца'), 'description untouched');
ok(plan.weekPlan.day1.meals[0].calories === 400, 'calories untouched');
ok(plan._finalDirector.verdict === 'ADJUST', 'meta flag');

const reject = parseDirectorResponse({ verdict: 'REJECT', qualityScore: 40, headline: 'X', clientMessage: 'Y', coherenceNotes: ['keto mismatch'] });
applyDirectorAdjustments(plan, reject);
ok(plan.generationWarnings.some(w => w.includes('Director REJECT')), 'REJECT adds warning');

ok(buildFinalDirectorPrompt('AUDIT').includes('AUDIT'), 'prompt substitution');

console.log('');
if (fail) {
  console.error(`FAILED: ${fail}`);
  process.exit(1);
}
console.log(`PASSED: ${pass}`);
