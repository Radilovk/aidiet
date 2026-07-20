import fs from 'fs';
import {
  buildChatContextSections,
  detectChatSections,
  buildChatRequestContext,
  computeContextFingerprint,
  assembleContextPrompt,
} from '../chat-context-bundle.js';
import { estimateTokenCount } from '../context-compression.js';

const exampleClient = JSON.parse(fs.readFileSync('./clients/EXAMPLE_client_data.json', 'utf8'));
const userData = exampleClient.answers;
const userPlan = exampleClient.plan || {
  summary: { bmr: 1800, dailyCalories: 1650, macros: { protein: 120, carbs: 165, fats: 55 } },
  weekPlan: {
    monday: {
      meals: [{
        type: 'Хранене 1',
        name: 'Овесена каша с ягоди',
        calories: 350,
        weight: '280г',
        macros: { protein: 12, carbs: 52, fats: 8 },
        description: '• Овесени ядки 80g\n• Мляко 200ml\n• Ягоди 50g',
      }],
    },
  },
  recommendations: ['Пийте достатъчно вода', 'Яжте бавно'],
  forbidden: ['Захар', 'Преработено'],
  strategy: { dietType: 'Балансирана', keyPrinciples: ['Баланс'] },
};

const sections = buildChatContextSections(userData, userPlan);
const fp = computeContextFingerprint(sections);

const gramsQuery = buildChatRequestContext(userData, userPlan, 'Колко грама пилешко имам в обяд?', 'consultation');
const generalQuery = buildChatRequestContext(userData, userPlan, 'Здравей, как си?', 'consultation');

const legacyJson = JSON.stringify({
  userData: {
    name: userData.name, age: userData.age, weight: userData.weight,
    goal: userData.goal, medicalConditions: userData.medicalConditions,
  },
  userPlan: {
    summary: userPlan.summary,
    weekPlan: { monday: { meals: [{ type: 'Хранене 1', name: 'Овесена каша', calories: 350 }] } },
    recommendations: userPlan.recommendations,
    forbidden: userPlan.forbidden,
  },
});

console.log('SCC v1 chat context tests\n');
console.log('Sections built:', Object.keys(sections).join(', '));
console.log('Fingerprint:', fp);
console.log('plan_meals includes grams:', sections.plan_meals.includes('80g') || sections.plan_meals.includes('280'));
console.log('\nGrams question sections:', gramsQuery.selectedIds.join(', '));
console.log('Grams question tokens:', gramsQuery.tokenEstimate, '(full index:', gramsQuery.fullTokenEstimate, ')');
console.log('General question tokens:', generalQuery.tokenEstimate);
console.log('Legacy compact JSON tokens:', estimateTokenCount(legacyJson));
console.log('\nplan_meals excerpt:\n', sections.plan_meals.split('\n').slice(0, 3).join('\n'));

if (!sections.plan_meals.includes('chat')) {
  console.error('FAIL: plan_meals missing client format');
  process.exit(1);
}
if (!gramsQuery.selectedIds.includes('plan_meals')) {
  console.error('FAIL: grams query should include plan_meals');
  process.exit(1);
}
if (gramsQuery.tokenEstimate >= gramsQuery.fullTokenEstimate) {
  console.error('FAIL: selected context should be smaller than full index');
  process.exit(1);
}

console.log('\n✅ All chat context bundle checks passed');
