#!/usr/bin/env node
import { collectUserBlockedFoodTerms } from '../../../plan-pipeline-pure.js';
import { getCatalogCandidatesForChunk } from '../../../food-catalog.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

console.log('-- Blocked terms → catalog --');

{
  const terms = collectUserBlockedFoodTerms({
    dietDislike: 'ядки, бадеми',
    medicalConditions_Алергии: 'мляко',
    planModifications: ['exclude_food:ориз'],
    forbidden: ['захар'],
  });
  check('събира dislike', terms.some(t => t.toLowerCase().includes('ядки')));
  check('събира алергии', terms.some(t => t.toLowerCase().includes('мляко')));
  check('събира exclude_food', terms.some(t => t.toLowerCase().includes('ориз')));
  check('събира forbidden', terms.some(t => t.toLowerCase().includes('захар')));
}

{
  const terms = collectUserBlockedFoodTerms({
    dietDislike: 'бадеми, орехи, кашу, лешници, шамфъстък, ядки',
  });
  const bySlot = getCatalogCandidatesForChunk({
    strategy: {
      weeklyScheme: {
        monday: { mealBreakdown: [{ type: 'Хранене 2', calories: 600, protein: 40, carbs: 50, fats: 20 }] },
      },
    },
    startDay: 1,
    endDay: 1,
    dietaryModifier: 'Балансирано',
    blockedTerms: terms,
  });
  const all = [...bySlot.values()].flat().map(e => e.name.toLowerCase());
  const leakedNuts = all.filter(n => /бадем|орех|кашу|лешник|шамфъстък|ядки/.test(n));
  check('blocked ядки не изтичат в кандидати', leakedNuts.length === 0, leakedNuts.join(','));
  check('PRO слот не е празен', (bySlot.get('PRO') || []).length > 0);
}

const passed = results.filter(Boolean).length;
console.log(`\nblocked-terms: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
