#!/usr/bin/env node
/**
 * Пратки от модулите (handoff.js, enrichment-iris.js): бял списък на полетата,
 * факти, попълване на въпросника и пътя до профила. Без мрежа.
 */
import { normalizeHandoff, handoffToFacts, airisPrefill, handoffPreview } from '../handoff.js';
import { irisText } from '../enrichment-iris.js';
import { normalizeFact, applyEnrichment, recalcLevel } from '../enrichment.js';
import { compileProfile } from '../profile-code.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const NOW = new Date('2026-10-20T10:00:00Z');

const airis = {
  source: 'airis', v: 1, completedAt: '2026-10-19T18:00:00Z',
  questionnaire: {
    name: 'Мария', age: 38, gender: 'female', weight: 72, height: 165, goals: ['Отслабване', 'Подобряване на съня'],
    activityLevel: 'light', stressLevel: 'very-high', sleepHours: 6.5, hydration: 5, dietaryProfile: ['Средиземноморска', 'Безглутенова'],
    dietaryHabits: ['Прескачане на закуска', 'Сладки храни', 'Алкохол'], foodIntolerances: 'лактоза', allergies: '', medications: 'Еутирокс 50',
    complaints: 'подуване след хранене', email: 'secret@example.com', uploadedDocuments: [{ dataUrl: 'data:...' }],
  },
  analysis: {
    constitution: 'лимфатична', summary: 'Фокус върху храносмилането.',
    systems: [{ key: 'digestive', label: 'Храносмилане', score: 62, priority: true }, { key: 'nervous', label: 'Нервна система', score: 70, priority: false }],
    drivers: [{ system: 'digestive', strength: 'high', observation: 'Подуване', action: 'По-малки порции вечер', source: 'both' }],
    eatMore: ['ферментирали храни'], eatLess: ['пържено'], supplements: [{ name: 'Магнезий', dosage: '200 mg' }],
    recommendedTests: ['TSH'], notices: [{ level: 'caution', title: 'Щитовидна жлеза', body: 'Съгласувайте добавките с лекар.' }],
    eyeReferral: 'soon', leftIrisImage: 'data:image/png;base64,AAAA', findings: [{ secret: 1 }],
  },
  hacker: '<script>',
};

// ── Бял списък ───────────────────────────────────────────────────────────
const h = normalizeHandoff(airis, NOW);
ok(h && h.source === 'airis' && h.at === '2026-10-19T18:00:00.000Z', 'AIRIS пратка се приема');
ok(!('email' in h.questionnaire) && !('uploadedDocuments' in h.questionnaire), 'имейл и документи не влизат');
ok(!('leftIrisImage' in h.analysis) && !('findings' in h.analysis) && !('hacker' in h), 'снимки, сурови находки и непознати полета отпадат');
ok(normalizeHandoff({ source: 'airis', analysis: {} }) === null, 'празен анализ — отказ');
ok(normalizeHandoff({ source: 'nutriplan', profile: {} }) === null && normalizeHandoff(null) === null, 'непознат модул — отказ');
ok(normalizeHandoff({ ...airis, questionnaire: { ...airis.questionnaire, age: 400, weight: 'x' } }).questionnaire.age === null, 'невъзможни стойности отпадат');

const emo = normalizeHandoff({ source: 'emoeat', profile: { intensity: 'Силно', archetype: { name: 'Утехата', description: 'топлина' }, drivers: ['Нужда от близост'], behaviors: [{ name: 'Трудно спиране', level: 'Осезаемо' }], patterns: [], reliability: { level: 'висока' }, answers: { q1: 'secret' } } }, NOW);
ok(emo && emo.profile.archetype.name === 'Утехата' && !('answers' in emo.profile), 'EmoEat: само обобщението, без отговорите');

// ── Факти и профил ───────────────────────────────────────────────────────
const facts = handoffToFacts(h).map(normalizeFact).filter(Boolean);
ok(facts.length === 1 && facts[0].kind === 'iris' && facts[0].source === 'airis', 'AIRIS → един факт „iris“');
const base = () => enrichUserDataEngineContext(JSON.parse(JSON.stringify(PROFILES.find(p => p.id === 'female_moderate'))));
const before = applyEnrichment(base(), { facts: [] }, NOW);
const withIris = applyEnrichment(base(), { facts }, NOW);
const p0 = compileProfile(before);
const p1 = compileProfile(withIris);
ok(JSON.stringify(p0.clinical) === JSON.stringify(p1.clinical) && JSON.stringify(p0.exclusions) === JSON.stringify(p1.exclusions), 'ириса не добавя клинични кодове и изключения');
ok(recalcLevel(before, withIris).level === 0, 'ирисов анализ → ниво 0 (контекст, без промяна на менюто)');
ok(p1.aiNotes.some(n => /Щитовидна/.test(n)) && p1.aiNotes.some(n => /очен лекар/.test(n)), 'бележките за безопасност и очният лекар стигат до специалиста');
const t = irisText(withIris._enrichment.iris);
ok(/фокус: Храносмилане/.test(t) && /По-малки порции вечер/.test(t) && /TSH/.test(t), `текст за картона и чата (${t.slice(0, 80)}…)`);
const emoFacts = handoffToFacts(emo).map(normalizeFact).filter(Boolean);
ok(compileProfile(applyEnrichment(base(), { facts: emoFacts }, NOW)).behaviors.includes('EMO'), 'EmoEat пратка → поведенчески кодове в плана');

// ── Попълване на въпросника ──────────────────────────────────────────────
const pre = airisPrefill(h.questionnaire);
ok(pre.gender === 'Жена' && pre.age === '38' && pre.weight === '72', 'пол, възраст, тегло');
ok(pre.goal.join() === 'Отслабване', 'цели — само с еднозначно съответствие');
ok(pre.sportActivity === 'Ниска (1–2 дни седмично)' && pre.stressLevel === 'Високо' && pre.sleepHours === '6–7' && pre.waterIntake === '1–1.5 л', 'активност, стрес, сън, вода');
ok(pre.dietPreference.join() === 'Средиземноморска' && /лактоза/.test(pre.dietDislike) && /глутен/.test(pre.dietDislike), 'диета и непоносимости');
ok(pre.eatingHabits.includes('Не закусвам') && pre.foodCravings.includes('Сладко') && pre.drinksAlcohol === 'Често', 'навици');
ok(pre.medications === 'Да' && pre.medicationsDetails === 'Еутирокс 50' && /подуване/.test(pre.additionalNotes), 'лекарства и оплаквания');
ok(handoffPreview(h).lines.some(l => /Фокус: Храносмилане/.test(l)) && handoffPreview(emo).lines.some(l => /Утехата/.test(l)), 'преглед преди съгласие');

console.log(`\n=== handoff: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
