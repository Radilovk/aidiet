#!/usr/bin/env node
/**
 * Седмичното преизчисляване на енергията (worker.entry.js → recalibrateWeeklyEnergy):
 * голямо намаление на две седмици, отлагане при натоварено тяло, натрупаните корекции се пазят.
 * Функцията е вътрешна за worker-а — изпълнява се изолирано, с подменени зависимости.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.entry.js'), 'utf8');
const start = src.indexOf('const RECAL_MAX_CUT');
const end = src.indexOf('async function runWeeklyAdaptation');
if (start < 0 || end < start) throw new Error('recalibrateWeeklyEnergy не е намерена');

let INTAKE = 0;
let DIRECTION = 'lose';
const stubs = {
  parseFinalCalories: (v) => Math.round(Number(v)) || 0,
  compileProfile: () => ({ direction: DIRECTION, goalModel: { directionLabel: 'нова фаза' } }),
  refreshAnalysisEnergyFromProfile: () => ({ intake: INTAKE, tdee: INTAKE + 400, activityData: {} }),
  enforceCalorieGuardrails: (a) => { if (a.Final_Calories < 1300) a.Final_Calories = 1300; },
};
const recalibrate = new Function(...Object.keys(stubs), `${src.slice(start, end)}\nreturn recalibrateWeeklyEnergy;`)(...Object.values(stubs));

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`✗ ${msg}`); } };

/** Поредица от прегледи: всеки следващ тръгва от записания анализ. */
function reviews(final, base, intake, answers = [], n = 3) {
  INTAKE = intake;
  DIRECTION = 'lose';
  let analysis = { Final_Calories: final, _baseCalories: base, _goalDirection: 'lose', tdee: intake + 400 };
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = recalibrate({}, {}, { analysis }, { pendingLevel: 2 }, answers);
    out.push(r);
    if (!r || r.deferred) break;
    analysis = r.analysis;
  }
  return out;
}

// −433 kcal (спрени тренировки): 250, после остатъкът.
{
  const [w1, w2, w3] = reviews(2430, 2430, 1997);
  ok(w1.staged && w1.after === 2180 && w1.target === 1997, `първа стъпка 2430 → 2180 (${w1.after})`);
  ok(w2 && !w2.staged && w2.after === 1997, `втора стъпка → 1997 (${w2?.after})`);
  ok(w3 === null, 'трети преглед — без промяна');
  ok(!('_recalStaged' in w2.analysis), 'белегът за стъпка се маха след втората');
}
// −1052 kcal: точно две стъпки (половината), не пет по 250.
{
  const [w1, w2, w3] = reviews(3288, 3288, 2236);
  ok(w1.staged && w1.after === 2762, `половината първата седмица (${w1.after})`);
  ok(w2.after === 2236 && w3 === null, `целта на втората (${w2.after})`);
}
// Натрупана корекция от прегледите (−100) се пази през двете стъпки.
{
  const [w1, w2] = reviews(2330, 2430, 1997);
  ok(w1.target === 1897 && w2.after === 1897, `целта е новият разход с корекцията (${w1.target} / ${w2.after})`);
  ok(w2.analysis.Final_Calories - w2.analysis._baseCalories === -100, 'корекцията остава −100');
}
// Малко намаление и увеличение — наведнъж.
ok(reviews(1615, 1615, 1500)[0].after === 1500 && !reviews(1615, 1615, 1500)[0].staged, '−115 kcal — наведнъж');
ok(reviews(1615, 1615, 1886)[0].after === 1886, '+271 kcal — наведнъж');
// Натоварено тяло (пулс/HRV) — намалението се отлага; увеличението не.
ok(reviews(2430, 2430, 1997, [{ questionId: 'recoveryLow', value: 'true' }])[0].deferred, 'ниско възстановяване → намалението се отлага');
ok(reviews(1615, 1615, 1886, [{ questionId: 'leanLoss', value: 'true' }])[0].after === 1886, 'загуба на мускули → увеличението минава');
// Нова фаза на целта — без стъпки.
{
  INTAKE = 1997;
  DIRECTION = 'recomp';
  const r = recalibrate({}, {}, { analysis: { Final_Calories: 2430, _baseCalories: 2430, _goalDirection: 'lose' } }, { pendingLevel: 0 }, []);
  ok(r && !r.staged && r.after === 1997, `нова фаза → наведнъж (${r?.after})`);
}

console.log(`\n=== weekly recal: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
