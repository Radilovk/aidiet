import fs from 'fs';
import {
  buildChatContext,
  buildChatContextSections,
  selectChatSections,
} from '../client-card.js';
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
  recommendations: ['Пийте достатъчно вода'],
  forbidden: ['Захар'],
};

const sections = buildChatContextSections(userData, userPlan);
const gramsCtx = buildChatContext(userData, userPlan, 'Колко грама имам в закуската?', 'consultation');

console.log('Chat context (client-card reuse)\n');
console.log('meals has grams:', sections.meals.includes('80g') || sections.meals.includes('280'));
console.log('default includes meals:', selectChatSections('Здравей', 'consultation').includes('meals'));
console.log('grams tokens:', gramsCtx.tokenEstimate);

if (!sections.meals.includes('chat')) {
  console.error('FAIL: missing client week plan format');
  process.exit(1);
}
if (!selectChatSections('Здравей', 'consultation').includes('meals')) {
  console.error('FAIL: meals should be in default consultation context');
  process.exit(1);
}

console.log('\n✅ Chat context checks passed');
