#!/usr/bin/env node
/**
 * Пратки от модулите (handoff.js, enrichment-iris.js): бял списък на полетата,
 * факти, попълване на въпросника и пътя до профила. Без мрежа.
 */
import { normalizeHandoff, handoffToFacts, airisPrefill, handoffPreview, prefillFor } from '../handoff.js';
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

// ── Тестовете на сайтовете (daotslabna.com, life-protocols.com) ─────────
const site = normalizeHandoff({
  source: 'daotslabna', completedAt: '2026-10-20T08:00:00Z',
  answers: {
    name: 'Ива', email: 'Iva@Example.com', sex: 'female', age_band: '35-44', height_cm: 165, weight_kg: 82, activity: 'moderate', diet: 'vegan',
    conditions: ['thyroid', 'hypertension', 'kidney'], medications: ['thyroid_meds'], medications_other: 'Еутирокс 50',
    allergies: ['gluten', 'evil'], symptoms: ['fatigue', 'poor_sleep'], priority: 'otshalvane', weight_goal: '10-20', stimulant_tolerance: 'sensitive',
    budget_band: 'up30', hacker: '<script>',
  },
  protocol: { tier: 'Оптимален', products: [{ name: 'Berberine 500', dose: '1 капс.', timing: 'обед' }, { name: '' }] },
});
ok(site && site.source === 'daotslabna' && !('hacker' in site.answers) && !('budget_band' in site.answers), 'сайт: само позволените полета');
ok(site.answers.allergies.join() === 'gluten' && site.protocol.products.length === 1 && site.answers.email === 'iva@example.com', 'сайт: непознатите стойности отпадат');
const sp = prefillFor(site);
ok(sp.gender === 'Жена' && sp.height === '165' && sp.weight === '82' && !sp.age && sp.email === 'iva@example.com', 'сайт: пол, ръст, тегло; възрастта не се измисля');
ok(sp.goal.join() === 'Отслабване' && sp.sportActivity === 'Ниска (1–2 дни седмично)' && sp.dietPreference.join() === 'Веган', 'сайт: цел, активност, режим');
ok(sp.healthConditions.includes('Щитовидна жлеза (Хашимото и др.)') && sp.healthConditions.includes('Сърдечно-съдови заболявания'), 'сайт: състояния');
ok(sp.medications === 'Да' && /щитовидна/.test(sp.medicationsDetails) && /Еутирокс/.test(sp.medicationsDetails) && sp.dietDislike === 'глутен', 'сайт: лекарства, непоносимости');
ok(/daotslabna\.com/.test(sp.additionalNotes) && /бъбречно/.test(sp.additionalNotes) && /умора/.test(sp.additionalNotes) && /Berberine 500/.test(sp.additionalNotes) && /стимуланти/.test(sp.additionalNotes), 'сайт: бележки — състояния без съответствие, оплаквания, протокол');
const siteFacts = handoffToFacts(site).map(normalizeFact).filter(Boolean);
ok(siteFacts.length === 2 && siteFacts[0].kind === 'weight' && siteFacts[0].value === 82 && siteFacts[1].kind === 'site_quiz', 'сайт → тегло + отговорите като контекст');
const sq = siteFacts[1].value;
ok(sq.lines.some(l => /лекарства: .*Еутирокс/.test(l)) && sq.lines.some(l => /цел: отслабване \(10–20 кг\)/.test(l)) && sq.lines.some(l => /Berberine 500/.test(l)), 'сайт: редове за картона и чата (лекарства, цел с кг, протокол)');
ok(sq.cautions.some(c => /Еутирокс/.test(c)) && sq.cautions.includes('бъбречно заболяване'), 'сайт: лекарства и бъбреци — бележки за безопасност');
const withSite = applyEnrichment(base(), { facts: siteFacts }, NOW);
ok(withSite._enrichment.siteQuiz?.lines?.length > 0 && withSite._enrichment.hints.cautions.some(c => /daotslabna\.com: бъбречно/.test(c)), 'обогатяването носи теста от сайта и бележките');
ok(normalizeHandoff({ source: 'lifeprotocols', answers: {} }) === null && normalizeHandoff({ source: 'other', answers: { sex: 'male' } }) === null, 'празен тест или непознат сайт — отказ');
ok(handoffPreview(site).title === 'Тест от daotslabna.com', 'сайт: преглед');
ok(prefillFor(normalizeHandoff({ source: 'lifeprotocols', answers: { sex: 'male', priority: 'longevity', conditions: ['none'], medications: ['none'] } })).goal.join() === 'Антиейджинг', 'life: приоритет → цел');
const lifeSkin = prefillFor(normalizeHandoff({ source: 'lifeprotocols', answers: { sex: 'female', priority: 'skin', conditions: ['none'], medications: ['none'] } }));
ok(lifeSkin.clinicalProtocol === 'longevity' && lifeSkin.longevityGoals.join() === 'Външен вид и кожа', 'life: антиейджинг тестът води към протокола „longevity“');
ok(prefillFor(normalizeHandoff({ source: 'lifeprotocols', answers: { sex: 'male', priority: 'longevity', conditions: ['none'], medications: ['none'] } })).clinicalProtocol === 'longevity', 'life: дълголетие → протокол');
ok(!('clinicalProtocol' in sp), 'daotslabna: отслабване не избира клиничен протокол');

// ── поправки от одита ────────────────────────────────────────────────
ok(sp['healthConditions_Сърдечно-съдови заболявания'] === 'Хипертония (високо кръвно налягане)', 'сайт: хипертонията — конкретният под-отговор');
ok(/Желано отслабване: 10–20 кг/.test(sp.additionalNotes), 'сайт: желаните килограми в бележките');
const ah = normalizeHandoff({ source: 'airis', questionnaire: { healthStatus: ['Хипертония', 'Бременност', 'Диабет 2 тип'], allergies: 'лактоза', foodIntolerances: 'лактоза', complaints: 'умора', medicalConditions: 'умора' }, analysis: { summary: 'x' } });
const ap = airisPrefill(ah.questionnaire);
ok(ap.healthConditions.includes('Сърдечно-съдови заболявания') && ap.healthConditions.includes('Диабет / Инсулинова резистентност') && /Бременност/.test(ap.additionalNotes), 'AIRIS: състоянията стигат до въпросника и бележките');
ok(ap.dietDislike === 'лактоза' && !/умора\. умора/.test(ap.additionalNotes), 'AIRIS: без повторения');
console.log(`\n=== handoff: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
