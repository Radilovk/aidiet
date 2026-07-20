#!/usr/bin/env node
/**
 * Симулация: какво точно отива към AI при клиентска програма.
 * node fitness/scripts/simulate-plan-generation.mjs [--live]
 */
import { buildProfileSummary } from '../profile-summary.js';
import {
  preparePlanGeneration,
  resolveGuidelineLayers,
  buildTagsFromAnswers,
  buildTrainerSystemAddon,
  auditPlanGenderFit,
} from '../plan-generation.js';
import { allowedEquipmentSet } from '../worker.js';

const ADMIN_WOMAN_SCHEME = `3 тренировки седмично без събота и неделя. уреди: горен скрипец vertical pulley, машина за бедра аддуктор, абдуктор, лост 10 кг, гирички 2 до 10 кг, хоризонтален скрипец за гръб, степ блокче.
придържаш се към упражнения за средно начинаещи. по прости и ефективни. без странични рамена.`;

const SAMPLE_ADMIN_CONFIG = {
  foundation: 'Контрол на движението, дишане, прогресия. При жена — приоритет glutes/бедра, не мъжки bench split.',
  chunks: [
    { tags: ['gender:жена'], text: 'АДМИН: жена — минимум 40% обем долна част, hip thrust/RDL/абдуктор.' },
    { tags: ['goal:рекомпозиция'], text: 'АДМИН: рекомпозиция — сила + умерено кардио, не bro-split.' },
    { tags: ['all'], text: 'АДМИН АРХ: винаги 8 мин загрявка + мобилност гръбна.' },
    { tags: [], text: 'АДМИН ПРАЗЕН ТАГ: универсално правило за всички клиенти.' },
  ],
  updatedAt: new Date().toISOString(),
};

const clientAnswers = {
  gender: 'Жена',
  age: 45,
  heightCm: 172,
  weightKg: 51,
  health: [],
  healthFemale: [],
  limitations: ['гърди не — импланти'],
  breastImplants: { implants: 'Да — под гръдната жлеза (subglandular)', implantMonths: 6 },
  experience: 'Среден (2–5 години)',
  goal: { main: 'Рекомпозиция', other: '', deadline: '' },
  equipment: ['Дъмбели', 'Кабели/скрипец', 'Машини'],
  equipmentOther: '',
  preferences: { types: ['Силов тренинг'], avoid: 'странични рамена', freq: '3', duration: '45–60 мин', timeOfDay: 'Вечер' },
  sleep: 'Добро',
  stress: 4,
  extraInfo: 'приоритет дупе и бедра, изправяне на гърба',
};

function section(title, text) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
  console.log(text);
}

const live = process.argv.includes('--live');
const prod = process.argv.includes('--prod');

let adminConfig = SAMPLE_ADMIN_CONFIG;
if (prod) {
  const res = await fetch('https://aidiet.radilov-k.workers.dev/api/admin/fitplan/guidelines');
  const data = await res.json();
  adminConfig = data.config;
  section('PRODUCTION KV', `foundation: ${adminConfig.foundation?.slice(0, 120)}...\nchunks: ${adminConfig.chunks?.length}`);
}

const tags = buildTagsFromAnswers(clientAnswers);
const layers = resolveGuidelineLayers(tags, adminConfig);
const trainerAddon = buildTrainerSystemAddon(adminConfig, tags);
const { userPrompt, clientTags, allowedEquipment } = preparePlanGeneration(
  {
    clientAnswers,
    exampleScheme: ADMIN_WOMAN_SCHEME,
    clientName: 'Тест клиентка',
  },
  adminConfig,
  { buildProfileSummary, allowedEquipmentSet },
);

section('TAGS', [...tags].sort().join(', '));
section('LAYERS — individual', layers.individual.map((t, i) => `${i + 1}. ${t.slice(0, 200)}${t.length > 200 ? '…' : ''}`).join('\n\n') || '(празно)');
section('LAYERS — architecture', layers.architecture.map((t, i) => `${i + 1}. ${t}`).join('\n\n') || '(празно)');
section('SYSTEM ADDON (trainer rules → Gemini systemInstruction)', trainerAddon || '(празно)');
section('USER PROMPT (пълен)', userPrompt);
section('STATS', [
  `userPrompt chars: ${userPrompt.length}`,
  `system addon chars: ${trainerAddon.length}`,
  `individual items: ${layers.individual.length}`,
  `architecture items: ${layers.architecture.length}`,
  `admin chunks in layers: ${layers.individual.filter((t) => t.includes('В1') || t.includes('ПОЛ') || t.includes('АДМИН')).length}`,
  `Пол: ЖЕНА block: ${userPrompt.includes('Пол: ЖЕНА') ? 'ДА' : 'НЕ'}`,
].join('\n'));

if (!live) {
  console.log('\n(Dry run. --prod = production KV. --live + GEMINI_API_KEY = реален AI отговор.)');
  process.exit(0);
}

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY липсва');
  process.exit(1);
}

const PLAN_SYSTEM_PROMPT = `Ти си елитен български треньор. Ако има БАЗОВИ ПРИНЦИПИ и НАСОКИ — абсолютен приоритет.`;
const system = trainerAddon ? `${PLAN_SYSTEM_PROMPT}\n\n${trainerAddon}` : PLAN_SYSTEM_PROMPT;

const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
const body = {
  systemInstruction: { parts: [{ text: system }] },
  contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
  generationConfig: {
    temperature: 0.4,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: 0 },
  },
};

console.log('\nИзвиквам Gemini...');
const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const data = await res.json();
const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
section('AI RAW RESPONSE (first 3000 chars)', text.slice(0, 3000));

try {
  const plan = JSON.parse(text);
  const exercises = [];
  for (const day of plan.days || []) {
    for (const ex of day.exercises || []) {
      exercises.push(`${day.day}: ${ex.canonicalName || ex.displayName}`);
    }
  }
  section('AI EXERCISES', exercises.join('\n') || '(няма)');
  const audit = auditPlanGenderFit(plan, clientTags);
  section('AUDIT', [
    `gender fit: ${audit.ok ? 'OK' : 'FAIL'}`,
    ...audit.issues,
    `bench/press: ${exercises.filter((e) => /bench|press|chest/i.test(e)).length}`,
  ].join('\n'));
} catch (e) {
  console.error('JSON parse failed:', e.message);
}
