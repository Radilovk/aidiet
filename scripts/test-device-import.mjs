#!/usr/bin/env node
/**
 * Импорт от файл (device-import.js): разпознаване на колони и единици в
 * експорти на везни, часовници и апарати. Без мрежа.
 */
import { createRequire } from 'node:module';
import { normalizeFact } from '../enrichment.js';

const require = createRequire(import.meta.url);
const { parse, _dayOf } = require('../device-import.js');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const NOW = new Date('2026-10-20T10:00:00Z');
const valid = (r) => r.facts.map(normalizeFact).filter(Boolean);
const one = (r, kind) => valid(r).filter(f => f.kind === kind);

// Renpho / Xiaomi: паундове, проценти и колони, които не са тегло.
const renpho = `Time of Measurement,Weight(lb),BMI,Body Fat(%),Fat-free Body Weight(lb),Subcutaneous Fat(%),Visceral Fat,Body Water(%),Skeletal Muscle(%),Muscle Mass(lb),Bone Mass(lb),Protein(%),BMR(kcal),Metabolic Age
2026-10-18 07:12:00,176.4,25.1,28.4,126.3,24.0,9,52.1,45.2,119.6,6.6,17.1,1612,41
2026-10-19 07:05:00,175.9,25.0,28.2,126.2,23.9,9,52.3,45.3,119.5,6.6,17.2,1610,41`;
let r = parse(renpho, 'renpho.csv', NOW);
const kgs = one(r, 'weight').map(f => f.value).sort();
ok(kgs.length === 2 && Math.abs(kgs[0] - 79.79) < 0.05 && Math.abs(kgs[1] - 80.01) < 0.05, `тегло lb → kg (${kgs})`);
ok(one(r, 'body_fat').length === 2 && one(r, 'visceral_fat')[0].value === 9 && one(r, 'body_water').length === 2, 'мазнини, висцерални, вода в тялото');
ok(Math.abs(one(r, 'muscle_mass')[0].value - 54.2) < 0.2, `мускулна маса lb → kg, не процентът (${one(r, 'muscle_mass')[0]?.value})`);
ok(!r.facts.some(f => f.kind === 'weight' && f.value < 130), '„Fat-free Body Weight“ не е тегло');

// Апарат за кръвно (Omron), точка и запетая, ден първи.
r = parse('Дата;Систолно;Диастолно;Пулс\n18.10.2026;142;88;71\n18.10.2026;138;86;70\n19.10.2026;135;84;68', 'omron.csv', NOW);
const bp = one(r, 'bp');
ok(bp.length === 2 && bp[0].value2 > 0 && r.from === '2026-10-18', `кръвно: един запис на ден, средно (${JSON.stringify(bp.map(b => [b.value, b.value2]))})`);

// Български заглавия, десетична запетая, сън „7:30“.
r = parse('Дата,Тегло кг,Крачки,Сън\n2026-10-17,"80,4",9 512,7:30\n2026-10-18,"80,1",11203,6:45', 'bg.csv', NOW);
ok(one(r, 'weight')[0].value === 80.4 || one(r, 'weight').some(f => f.value === 80.4), 'десетична запетая');
ok(one(r, 'steps').some(f => f.value === 9512), 'крачки с интервал за хиляди');
ok(one(r, 'sleep').some(f => f.value === 7.5), 'сън 7:30 → 7,5 ч');

// Почасови крачки (интервали) — сбор за деня.
const hourly = ['Date,Steps', ...Array.from({ length: 10 }, (_, i) => `2026-10-18T${String(8 + i).padStart(2, '0')}:00:00,1000`)].join('\n');
ok(one(parse(hourly, 'steps.csv', NOW), 'steps')[0].value === 10000, 'почасови крачки → сбор');

// JSON и глюкоза в mg/dL.
r = parse(JSON.stringify([{ date: '2026-10-18', 'glucose (mg/dL)': 108 }, { date: '2026-10-19', 'glucose (mg/dL)': 99 }]), 'g.json', NOW);
ok(Math.abs(one(r, 'glucose')[0].value - 6) < 0.05 || one(r, 'glucose').some(f => Math.abs(f.value - 6) < 0.05), 'JSON, глюкоза mg/dL → mmol/L');

// Граници и грешки.
ok(parse('Weight,Steps\n80,5000', 'x.csv', NOW).error, 'без колона с дата — ясна грешка');
ok(parse('Date,Weight\n2020-01-01,80', 'old.csv', NOW).facts.length === 0, 'записи по-стари от 120 дни отпадат');
ok(_dayOf('04/05/2026') === '2026-05-04' && _dayOf('10/25/2026') === '2026-10-25', 'дати: ден/месец и месец/ден по контекст');

console.log(`\n=== device import: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
