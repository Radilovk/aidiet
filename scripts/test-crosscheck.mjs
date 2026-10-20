#!/usr/bin/env node
/**
 * Сверка AIRIS / EmoEat / NutriPlan (cross-check.js): потвърдените находки
 * влизат в менюто, медицинските правила ги спират, разминаванията стават
 * въпроси, а отговорите — замени. Без мрежа.
 */
import { normalizeHandoff, handoffToFacts } from '../handoff.js';
import { normalizeFact, applyEnrichment, recalcLevel } from '../enrichment.js';
import { compileProfile } from '../profile-code.js';
import { interactionsFor } from '../drug-interactions.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const NOW = new Date('2026-10-20T10:00:00Z');
const base = (extra = {}) => enrichUserDataEngineContext({ ...JSON.parse(JSON.stringify(PROFILES.find(p => p.id === 'female_moderate'))), ...extra });
const irisFacts = (systems, q = {}) => handoffToFacts(normalizeHandoff({
  source: 'airis', completedAt: '2026-10-19T10:00:00Z',
  questionnaire: { weight: 70, ...q },
  analysis: { systems: systems.map(k => ({ key: k, label: k, score: 55, priority: true })), drivers: [{ system: systems[0], action: 'x', observation: 'y' }] },
})).map(normalizeFact);
const answer = (key, value) => normalizeFact({ kind: 'resolution', key, value, at: '2026-10-20T09:00:00Z' });
const run = (data, facts) => applyEnrichment(data, { facts }, NOW);
const hyp = (d, k) => d._enrichment.crossCheck.hypotheses.find(h => h.system === k);
const question = (d, id) => d._enrichment.crossCheck.questions.find(q => q.id === id);

// ── Потвърждение от два източника ────────────────────────────────────────
let d = run(base({ medicalConditions: ['Храносмилателни проблеми'] }), irisFacts(['digestive']));
ok(hyp(d, 'digestive').status === 'confirmed' && hyp(d, 'digestive').applied, 'ирис + храносмилателен проблем във въпросника → потвърдено и приложено');
ok(d._enrichment.hints.approach.includes('gentle_digestion'), 'щадящото меню влиза в плана');
const plain = run(base({ medicalConditions: ['Храносмилателни проблеми'] }), []);
ok(recalcLevel(plain, d).level >= 1, 'потвърдената находка вдига нивото до меню');
d = run(base({ medicalConditions: ['Нямам'], additionalNotes: 'често имам подуване след вечеря' }), irisFacts(['digestive']));
ok(hyp(d, 'digestive').status === 'confirmed' && hyp(d, 'digestive').evidence.includes('оплаквания във въпросника'), 'потвърждение и от свободния текст');

// ── Медицинско правило спира действието ──────────────────────────────────
d = run(base({ medicalConditions: ['Диабет / Инсулинова резистентност'], medicalConditions_other: 'рефлукс' }), irisFacts(['metabolic']));
ok(hyp(d, 'metabolic').status === 'confirmed' && !hyp(d, 'metabolic').applied && !d._enrichment.hints.approach.includes('more_volume'), 'рефлукс само като текст → „повече обем“ е спрян');
ok(d._enrichment.hints.cautions.some(c => /медицинско правило/.test(c)), 'бележка за специалиста: потвърдено, но спряно');
d = run(base({ medicalConditions: ['Диабет / Инсулинова резистентност', 'IBS', 'IBD', 'Рефлукс'] }), irisFacts(['metabolic']));
ok(!hyp(d, 'metabolic').applied, 'отметнат „Рефлукс“ (код GI) → спрян');
d = run(base({ medicalConditions: ['Диабет / Инсулинова резистентност'], _aiHints: { clinical: ['GERD'] } }), irisFacts(['metabolic']));
ok(!hyp(d, 'metabolic').applied && hyp(d, 'metabolic').blockedBy.includes('GERD'), 'код GERD → спрян');
d = run(base({ medicalConditions: ['Диабет / Инсулинова резистентност'] }), irisFacts(['metabolic']));
ok(hyp(d, 'metabolic').applied && d._enrichment.hints.approach.includes('more_volume'), 'без рефлукс → „повече обем“ се прилага');

// ── Разминаване → въпрос → отговор ───────────────────────────────────────
d = run(base({ medicalConditions: ['Нямам'] }), irisFacts(['digestive']));
ok(hyp(d, 'digestive').status === 'disputed' && question(d, 'iris:digestive') && !d._enrichment.hints.approach.includes('gentle_digestion'), 'ирис срещу „нямам оплаквания“ → въпрос, нищо не се прилага');
d = run(base({ medicalConditions: ['Нямам'] }), [...irisFacts(['digestive']), answer('iris:digestive', 'often')]);
ok(hyp(d, 'digestive').applied && !question(d, 'iris:digestive'), 'отговор „да, често“ → потвърдено и приложено');
d = run(base({ medicalConditions: ['Нямам'] }), [...irisFacts(['digestive']), answer('iris:digestive', 'no')]);
ok(hyp(d, 'digestive').status === 'rejected' && !question(d, 'iris:digestive') && !d._enrichment.hints.approach.includes('gentle_digestion'), 'отговор „не“ → отхвърлено, без повторен въпрос');
d = run(base({ stressLevel: 'Средно' }), irisFacts(['nervous']));
ok(hyp(d, 'nervous').status === 'unconfirmed' && !question(d, 'iris:nervous'), 'без противоречие и без доказателство → само контекст, без въпрос');

// ── AIRIS въпросник срещу NutriPlan въпросник ────────────────────────────
d = run(base({ dietDislike: '' }), irisFacts(['immune'], { foodIntolerances: 'лактоза' }));
ok(question(d, 'allergy:лактоза'), 'непоносимост само в AIRIS → въпрос');
d = run(base({ dietDislike: '' }), [...irisFacts(['immune'], { foodIntolerances: 'лактоза' }), answer('allergy:лактоза', 'yes')]);
ok(/лактоза/.test(d.dietDislike) && compileProfile(d).exclusions.includes('LAC') && d._enrichment.original.dietDislike === '', 'потвърдена → изключена от плана, оригиналът е пазен');
d = run(base({ medications: 'Не' }), [...irisFacts(['endocrine'], { medications: 'Еутирокс 50' }), answer('meds', 'yes')]);
ok(d.medications === 'Да' && interactionsFor(d).ids.includes('levothyroxine'), 'лекарство от AIRIS, потвърдено → таблицата за взаимодействия се прилага');
d = run(base({ weight: '82' }), irisFacts(['immune'], { weight: 74 }));
ok(question(d, 'weight')?.options.length === 2, 'тегло с разлика 8 кг → въпрос кое е актуалното');
d = run(base({ weight: '82' }), [...irisFacts(['immune'], { weight: 74 }), answer('weight', 'airis')]);
ok(d.weight === '74', 'избрано теглото от AIRIS');
d = run(base({ dietPreference: ['Балансирана'] }), [...irisFacts(['immune'], { dietaryProfile: ['Веган'] }), answer('pattern:Веган', 'yes')]);
ok(compileProfile(d).diet.pattern === 'vegan', 'веган режим от AIRIS, потвърден → прилага се');

// ── EmoEat срещу въпросника ──────────────────────────────────────────────
const emo = handoffToFacts(normalizeHandoff({ source: 'emoeat', profile: { intensity: 'Силно', archetype: { name: 'Утехата' }, drivers: ['Нужда от близост'], behaviors: [], reliability: { level: 'висока' } } })).map(normalizeFact);
const calm = { overeatingFrequency: 'Рядко', foodTriggers: ['Нито едно'] };
d = run(base(calm), emo);
ok(question(d, 'emoeat_vs_q'), 'силен EmoEat срещу „рядко преяждам“ → въпрос');
d = run(base(calm), [...emo, answer('emoeat_vs_q', 'rare')]);
ok(!compileProfile(d).behaviors.includes('EMO') && d._enrichment.voice, '„не се разпознавам“ → без кодове от EmoEat, гласът остава');
d = run(base(calm), [...emo, answer('emoeat_vs_q', 'often')]);
ok(compileProfile(d).behaviors.includes('EMO') && !question(d, 'emoeat_vs_q'), '„често“ → кодовете от EmoEat остават');

// ── Фактът „отговор“ ─────────────────────────────────────────────────────
ok(normalizeFact({ kind: 'resolution', key: 'x; drop', value: 'yes', at: NOW.toISOString() }) === null, 'невалиден ключ на отговор отпада');
ok(normalizeFact({ kind: 'resolution', key: 'allergy:лактоза', value: 'yes', at: NOW.toISOString() })?.source === 'client', 'отговорът е от клиента');

console.log(`\n=== cross-check: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
