#!/usr/bin/env node
/** Questionnaire → engine mapping — blocked terms, diet hints, audit packet. */
import {
  extractQuestionnaireBlockedTerms,
  buildQuestionnaireDietHints,
  enrichUserDataEngineContext,
  buildFinalAuditPacket,
} from '../questionnaire-engine-map.js';
import { resolveLibraryDietProfile } from '../protocol-engine.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

const user = enrichUserDataEngineContext({
  dietDislike: 'млечни, сирене',
  'medicalConditions_Алергии': 'фъстък, ядки',
  foodTriggers: 'пържено',
  giTriggers: 'лук, чесън',
  clinicalProtocol: 'gi_issues',
  'medicalConditions_Храносмилателни_детайл': 'IBS, подуване след FODMAP храни',
  medicalConditions: ['Храносмилателни'],
  _dq_text_map: { dq_allergy_foods: 'Храни, които избягвате поради алергия' },
  dq_allergy_foods: 'соya, глuten',
});

const blocked = extractQuestionnaireBlockedTerms(user);
ok(blocked.some(t => /фъстък/i.test(t)), 'allergy term extracted');
ok(blocked.some(t => /лук/i.test(t)), 'gi trigger extracted');
ok(blocked.some(t => /soya|соya/i.test(t)), 'dynamic dq food field extracted');
ok(blocked.some(t => /млеч/i.test(t)), 'dietDislike extracted');

const hints = buildQuestionnaireDietHints(user);
ok(/fodmap|ibs/i.test(hints), 'GI condition → fodmap hint');

const profile = resolveLibraryDietProfile({
  dietPreference: ['Балансирано'],
  questionnaireHints: user._engineDietHints,
});
ok(profile === 'low_fodmap', `balanced + GI hints → low_fodmap (${profile})`);

ok(Array.isArray(user._engineBlockedTerms) && user._engineBlockedTerms.length >= 4, 'engine context cached');

const plan = {
  analysis: { Final_Calories: 2000, macroGrams: { protein: 140, carbs: 200, fats: 65 }, _deterministicEnergy: true, keyProblems: [{ title: 'Hydration' }] },
  strategy: {
    libraryDietProfile: 'low_fodmap',
    dietaryModifier: 'Low-FODMAP',
    freeDayNumber: 7,
    includeDessert: false,
    weeklyScheme: {
      monday: { mealBreakdown: [{ type: 'Хранене 1', calories: 400 }, { type: 'Хранене 2', calories: 600 }] },
    },
  },
  weekPlan: {
    day1: { meals: [{ type: 'Хранене 1', name: 'Яйца', calories: 400 }] },
  },
  generationWarnings: ['test warning'],
};

const packet = buildFinalAuditPacket({ plan, userData: user, codeValidation: { warnings: ['code warn'] } });
ok(packet.includes('step1:'), 'audit has step1');
ok(packet.includes('step2:'), 'audit has step2');
ok(packet.includes('step3 skeleton'), 'audit has step3');
ok(packet.includes('blocked='), 'audit has blocked terms');

console.log('');
if (fail) {
  console.error(`FAILED: ${fail}`);
  process.exit(1);
}
console.log(`PASSED: ${pass}`);
