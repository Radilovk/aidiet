#!/usr/bin/env node
/**
 * Уточняващите въпроси в чата (chat-clarify.js): въпрос само по темата,
 * записва се само валиден отговор. Без мрежа и без AI.
 */
import { sanitizeQuestions, relevantQuestion, clarifyPromptBlock, extractClarify } from '../chat-clarify.js';
import { normalizeHandoff, handoffToFacts } from '../handoff.js';
import { normalizeFact, applyEnrichment } from '../enrichment.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { PROFILES } from './plan-adequacy/fixtures/profiles.mjs';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

// Истинските въпроси от сверката — същата форма, която стига до чата.
const facts = handoffToFacts(normalizeHandoff({
  source: 'airis',
  questionnaire: { weight: 70, foodIntolerances: 'лактоза', medications: 'Еутирокс 50' },
  analysis: { systems: [{ key: 'digestive', label: 'Храносмилане', priority: true }], drivers: [{ action: 'x' }] },
})).map(normalizeFact);
const data = applyEnrichment(enrichUserDataEngineContext({ ...JSON.parse(JSON.stringify(PROFILES.find(p => p.id === 'female_moderate'))), medicalConditions: ['Нямам'], medications: 'Не', dietDislike: '' }), { facts });
const questions = sanitizeQuestions(JSON.parse(JSON.stringify(data._enrichment.crossCheck.questions)));
const byId = (id) => questions.find(q => q.id === id);
ok(byId('iris:digestive') && byId('allergy:лактоза') && byId('meds:no'), `въпросите от сверката минават проверката (${questions.map(q => q.id)})`);

// ── Само по темата ───────────────────────────────────────────────────────
ok(relevantQuestion(questions, 'Вечер имам подуване и тежест')?.id === 'iris:digestive', 'подуване → въпросът за храносмилането');
ok(relevantQuestion(questions, 'Какво да хапна за закуска утре?') === null, 'закуска → без въпрос');
ok(relevantQuestion(questions, 'Може ли кисело мляко вечер?')?.id === 'allergy:лактоза', 'кисело мляко → въпросът за лактозата');
ok(relevantQuestion(questions, 'Пия еутирокс сутрин, кога да закуся?')?.id === 'meds:no', 'името на лекарството → въпросът за лекарствата');
ok(relevantQuestion(questions, 'Да, често', 'iris:digestive')?.id === 'iris:digestive', 'отговор на зададен въпрос — без ключови думи');
ok(relevantQuestion(questions, 'Да, често', 'unknown:x') === null, 'непознат зададен въпрос → без въпрос');

// ── Маркерите ────────────────────────────────────────────────────────────
const dq = byId('iris:digestive');
let x = extractClarify('Разбирам — тогава ще наблегнем на щадящи храни. [RESOLVE:iris:digestive=often]', dq);
ok(x.resolved?.value === 'often' && x.resolved.label === 'Да, често' && !/RESOLVE/.test(x.text), 'ясен отговор → записва се, маркерът изчезва');
x = extractClarify('Добре. [RESOLVE:iris:digestive=always]', dq);
ok(x.resolved === null, 'стойност извън опциите → не се записва');
x = extractClarify('Добре. [RESOLVE:meds=yes]', dq);
ok(x.resolved === null, 'друг въпрос от подадения → не се записва');
x = extractClarify('Имате ли често подуване след хранене? [ASK:iris:digestive]', dq);
ok(x.asked === 'iris:digestive' && x.text.endsWith('?'), 'асистентът пита → бутони, маркерът изчезва');
x = extractClarify('Отговор без маркери.', null);
ok(x.text === 'Отговор без маркери.' && !x.resolved && !x.asked, 'без въпрос → текстът е непокътнат');
x = extractClarify('Текст [ASK:iris:digestive]', null);
ok(x.text === 'Текст' && !x.asked, 'маркер без подаден въпрос се маха и не важи');

// ── Промпт и защита ──────────────────────────────────────────────────────
const block = clarifyPromptBlock(dq);
ok(block.includes('[RESOLVE:iris:digestive=') && block.includes('often = „Да, често“') && /Не измисляйте/.test(block), 'блокът за асистента: id, опции, забрана да отговаря вместо клиента');
ok(sanitizeQuestions([{ id: 'x; drop', text: 't', options: [{ value: 'a', label: 'b' }, { value: 'c', label: 'd' }] }]).length === 0, 'невалиден id отпада');
ok(sanitizeQuestions('нещо').length === 0 && sanitizeQuestions([{ id: 'meds', text: 't', options: [] }]).length === 0, 'празни/счупени въпроси отпадат');

const wq = [{ id: 'weight:80', text: 'Теглото…', options: [{ value: 'airis', label: '74 кг' }] }, { id: 'iris:digestive', text: 'Подуване?', options: [{ value: 'yes', label: 'Да' }] }];
ok(relevantQuestion(wq, 'Сега съм 80 кг')?.id === 'weight:80', '„кг“ на кирилица → въпросът за теглото');
ok(relevantQuestion(wq, 'имам газове след обяд')?.id === 'iris:digestive', '„газове“ → храносмилането');
console.log(`\n=== chat clarify: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
