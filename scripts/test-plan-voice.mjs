#!/usr/bin/env node
/**
 * Гласът на плана: проверката на AI отговора, прилагането към реален план от
 * двигателя и еднаквостта на промпта в KV/prompts и в кода.
 */
import { readFileSync } from 'node:fs';
import { HARD_PROFILES } from './plan-adequacy/fixtures/hard-profiles.mjs';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { buildNutritionPlan } from '../nutrition-engine/index.js';
import { buildEngineStrategy } from '../nutrition-engine/strategy.js';
import { compileProfile } from '../profile-code.js';
import { planVoiceVars, normalizePlanVoice, applyPlanVoice, planDishIds, personAnswers, voiceRepairPrompt, mergeVoiceRepair } from '../nutrition-engine/ai-voice.js';
import { DEFAULT_PLAN_VOICE_PROMPT } from '../nutrition-engine/plan-voice-prompt.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log(`✗ ${msg}`); }
}

// 1. Промптът в кода е същият като в KV/prompts.
const kvPrompt = readFileSync(new URL('../KV/prompts/admin_plan_voice_prompt.txt', import.meta.url), 'utf8');
ok(kvPrompt === DEFAULT_PLAN_VOICE_PROMPT, 'plan-voice-prompt.js се разминава с KV/prompts/admin_plan_voice_prompt.txt');

// 2. Реален план и входът на промпта.
const prof = structuredClone(HARD_PROFILES[0]);
prof.foodTriggers = ['Напрежение', 'Скука'];
prof.socialComparison = 'Често';
enrichUserDataEngineContext(prof);
const engine = buildNutritionPlan(prof, { kcal: 2000, seed: 'voice' });
const strategy = buildEngineStrategy(engine, prof, { kcal: 2000, freeDayNumber: engine.freeDayNumber });
const plan = { weekPlan: engine.weekPlan, strategy, psychology: [...strategy.psychologicalSupport] };
const vars = planVoiceVars(compileProfile(prof), prof, plan);
const filled = Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), DEFAULT_PLAN_VOICE_PROMPT);
ok(!/\{(name|profileSummary|answers|freeText|planFacts|avoid|menu)\}/.test(filled), 'всички променливи на промпта са попълнени');
ok(personAnswers(prof).includes('Ситуации, които предизвикват желание за храна: Напрежение, Скука'), 'тригерите стигат до промпта с въпроса');
const ids = [...planDishIds(engine.weekPlan)];
ok(ids.length >= 5 && ids.every(id => vars.menu.includes(id)), 'менюто носи dishId на всички ястия');

// 3. Проверката на отговора.
const dish = ids[0];
const raw = {
  portrait: { summary: 'Зает човек, който се храни набързо.', triggers: ['напрежение → сладко'], personality: 'вероятно структуриран' },
  tone: { address: 'Вие', style: 'кратко и по същество' },
  welcome: 'Здравейте. Прочетохме отговорите Ви внимателно.',
  specialistNote: 'Първите две седмици гледайте вечерите.',
  psychology: ['Насока едно.', 'Насока две.', 'Яжте 150 г пиле.', 'Насока три.', 'Изпийте 2 грама магнезий.'],
  habits: ['Навик едно.', 'Навик две.', 'Навик три.'],
  mealNotes: [{ dishId: dish, note: 'Сгответе двойно — утре е обяд за работа.' }, { dishId: 'няма_такова', note: 'изпада' }],
};
const voice = normalizePlanVoice(raw, { dishIds: new Set(ids), blockedTerms: ['Без гъби'] });
ok(voice && voice.tone.address === 'ти', 'обръщението е винаги „ти“ — и когато AI върне „Вие“');
ok(voice.psychology.length === 3 && !voice.psychology.some(s => /\d/.test(s)), 'насоки с грамове или дози се отхвърлят');
ok(Object.keys(voice.mealNotes).length === 1 && voice.mealNotes[dish], 'бележка само за ястие от менюто');
ok(normalizePlanVoice({ welcome: 'Обичате ли гъби?' }, { dishIds: [], blockedTerms: ['гъби'] }) === null, 'текст със забранена храна не минава');
ok(normalizePlanVoice({ psychology: ['a', 'b'] }, { dishIds: [] }) === null, 'под 3 насоки без писмо — няма глас');
ok(normalizePlanVoice({ welcome: 'Здравейте <script>' }, { dishIds: [] }) === null, 'HTML в текста се отхвърля');

// 4. Прилагането.
applyPlanVoice(plan, voice);
ok(plan.strategy.welcomeMessage === raw.welcome && plan.strategy.addressForm === 'ти', 'писмото и обръщението влизат в стратегията');
ok(plan.psychology.length === 3 && plan.personalHabits.length === 3, 'насоките и навиците влизат в плана');
ok(Object.values(engine.weekPlan).flatMap(d => d.meals).some(m => m.personalNote), 'бележката стига до храненето');
const kcalBefore = JSON.stringify(Object.values(engine.weekPlan).flatMap(d => d.meals.map(m => [m.calories, m.description])));
applyPlanVoice(plan, voice);
ok(kcalBefore === JSON.stringify(Object.values(engine.weekPlan).flatMap(d => d.meals.map(m => [m.calories, m.description]))), 'гласът не пипа калории и състав');

// Поправка: отхвърленото се връща с причината; поправеното минава същата проверка.
{
  const ctx = { dishIds: ['d1'], blockedTerms: ['Без гъби'] };
  const rejected = [];
  const first = normalizePlanVoice({
    welcome: 'Като езиков модел ще ви кажа: яжте 200 г пиле.',
    psychology: ['Хранете се бавно и без екран.', 'Пийте вода преди хранене.', 'Спете поне седем часа.'],
    habits: ['Подгответе обяда вечерта.', 'Носете вода със себе си.', 'Яжте гъби всеки ден.', 'Пазарувайте със списък.'],
    mealNotes: [{ dishId: 'd1', note: 'Това ястие ще излекува диабета ви.' }],
  }, ctx, rejected);
  ok(first && !first.welcome && first.habits.length === 3, 'поправка: лошите текстове са отхвърлени, добрите остават');
  const fields = rejected.map(r => r.field);
  ok(fields.includes('welcome') && fields.includes('habits') && fields.includes('mealNotes:d1'), `поправка: причините са събрани (${fields.join(', ')})`);
  ok(rejected.every(r => r.reason && r.reason.length > 3), 'поправка: всяка причина е обяснена');
  const prompt = voiceRepairPrompt(rejected, { address: 'Вие' });
  ok(prompt.includes('Причина:') && prompt.includes('"items"'), 'поправка: промптът носи причините и формата');
  const merged = mergeVoiceRepair(first, { items: [
    { field: 'welcome', text: 'Здравейте! Планът е подреден около вашия ритъм — започнете спокойно.' },
    { field: 'habits', text: 'Яжте гъби на обяд.' },
    { field: 'mealNotes:d1', text: 'Ястието е леко и засища за дълго.' },
    { field: 'mealNotes:чуждо', text: 'Бележка към ястие извън менюто.' },
  ] }, ctx);
  ok(merged.welcome.startsWith('Здравейте'), 'поправка: поправеното писмо влиза');
  ok(!merged.habits.some(h => /гъби/.test(h)), 'поправка: поправеният текст пак минава проверката (гъби остават забранени)');
  ok(merged.mealNotes.d1 && !merged.mealNotes['чуждо'], 'поправка: бележка само към ястие от менюто');
  ok(mergeVoiceRepair(first, null, ctx) === first, 'поправка: празен отговор не променя нищо');
}

console.log(`\n=== plan voice: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
