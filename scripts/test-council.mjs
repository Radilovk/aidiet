/**
 * Съвет (nutrition-engine/council.js): алгоритъмът предлага, AI преглежда,
 * алгоритъмът проверява — вето за твърдите граници, възражение извън меките,
 * един кръг отговор, несъгласието се записва.
 */
import { compileProfile } from '../profile-code.js';
import {
  deliberate,
  normalizeGoalOpinion,
  reviewGoalOpinion,
  normalizeWeeklyOpinion,
  reviewWeeklyOpinion,
  weeklyLimits,
  GOAL_SOFT_PCT,
} from '../nutrition-engine/council.js';

let pass = 0;
let fail = 0;
const ok = (cond, name) => {
  if (cond) pass++;
  else { fail++; console.log('✗', name); }
};

const woman = { gender: 'Жена', age: 40, height: 165 };
const model = (d) => compileProfile(d).goalModel;
const op = (o) => normalizeGoalOpinion({ stance: 'adjust', ...o });

// ─── Целта ───
const age29 = model({ ...woman, goal: ['Антиейджинг'], weight: 79 }); // ИТМ 29 → сваляне −10%
ok(age29.algorithm.direction === 'lose' && age29.algorithm.intakePct === -10, 'изходно: антиейджинг при ИТМ 29 — −10%');

ok(reviewGoalOpinion(age29, null).verdict === 'agree', 'без AI — решението на алгоритъма');
ok(reviewGoalOpinion(age29, op({ stance: 'agree' })).verdict === 'agree', 'съгласие');

const soft = reviewGoalOpinion(age29, op({ direction: 'recomp', intakePct: -5, argument: 'тежък стрес и лош сън' }));
ok(soft.verdict === 'accept' && soft.direction === 'recomp' && soft.intakePct === -5, 'в меките граници AI печели');

const far = reviewGoalOpinion(age29, op({ direction: 'lose', intakePct: -22 }), 1);
ok(far.verdict === 'rebut' && far.intakePct === -10 && far.objections.length, 'извън меките — възражение, остава предложението');
const insist = reviewGoalOpinion(age29, op({ direction: 'lose', intakePct: -22 }), 2);
ok(insist.verdict === 'dissent' && insist.intakePct === -10 - GOAL_SOFT_PCT, 'настояване — до меката граница, несъгласие');

const jump = reviewGoalOpinion(age29, op({ direction: 'gain', intakePct: -4 }), 1);
ok(jump.verdict === 'rebut' || jump.direction !== 'gain', 'скок сваляне → покачване не минава без обсъждане');

const pregnant = model({ ...woman, weight: 80, clinicalProtocol: 'postpartum_lactation', postpartumStatus: 'Бременна' });
const veto = reviewGoalOpinion(pregnant, op({ direction: 'lose', intakePct: -5, argument: 'наднормено тегло' }));
ok(veto.verdict !== 'rebut' && veto.intakePct >= 0 && veto.direction !== 'lose' && veto.vetoes.length, 'бременност: вето, без обсъждане');

const obese = model({ ...woman, goal: ['Подобряване на здравето'], weight: 95 });
const noSurplus = reviewGoalOpinion(obese, op({ direction: 'gain', intakePct: 5 }), 2);
ok(noSurplus.intakePct <= 0 && noSurplus.direction !== 'gain', 'затлъстяване: без излишък дори при настояване');

ok(normalizeGoalOpinion({ direction: 'fly', intakePct: 'x', extraGoals: ['LOSS', 'HACK'], lead: ['waist', 'rm -rf'] }).extraGoals.join() === 'LOSS', 'само позволени кодове от AI');

// ─── Решението на съвета в профила ───
const base = { ...woman, goal: ['Антиейджинг'], weight: 79 };
const sig = model(base).algorithm.signature;
const withCouncil = compileProfile({ ...base, _goalCouncil: { decision: { signature: sig, direction: 'recomp', intakePct: -5, lead: ['sleep'] } } });
ok(withCouncil.direction === 'recomp' && withCouncil.goalModel.intakePct === -5, 'решението на съвета се прилага');
ok(withCouncil.goalModel.lead[0] === 'sleep', 'показателите на AI — отпред');
const stale = compileProfile({ ...base, weight: 60, _goalCouncil: { decision: { signature: sig, direction: 'recomp', intakePct: -5 } } });
ok(stale.goalModel.intakePct === stale.goalModel.algorithm.intakePct, 'ново тегло → ново предложение → старото решение не важи');
const pSig = pregnant.algorithm.signature;
const tampered = compileProfile({ ...woman, weight: 80, clinicalProtocol: 'postpartum_lactation', postpartumStatus: 'Бременна', _goalCouncil: { decision: { signature: pSig, direction: 'lose', intakePct: -20 } } });
ok(tampered.goalModel.intakePct >= 0 && tampered.direction !== 'lose', 'записът не може да мине твърдите граници');
const extra = compileProfile({ ...woman, goal: ['Подобряване на здравето'], weight: 72, _goalCouncil: { extraGoals: ['TONE'] } });
ok(extra.goals.includes('TONE'), 'целите, прочетени от AI в текста, влизат като отметки');

// ─── Седмицата ───
const ctx = { kcal: 1800, tdee: 2200, floorKcal: 1400, baseKcal: 1900, direction: 'lose', checkin: {} };
const algo = { calorieAdjust: -100, modifications: ['more_volume'], adherence: 85 };
const wop = (o) => normalizeWeeklyOpinion({ stance: 'adjust', ...o });
ok(reviewWeeklyOpinion(algo, null, ctx).calorieAdjust === -100, 'без AI — корекцията на алгоритъма');
ok(reviewWeeklyOpinion(algo, wop({ calorieAdjust: 0, argument: 'болна, не е тренирала' }), ctx).verdict === 'accept', 'отмяна на намалението в меките граници — приета');
ok(reviewWeeklyOpinion(algo, wop({ calorieAdjust: 100 }), ctx, 1).verdict === 'rebut', 'обратна посока — възражение');
ok(reviewWeeklyOpinion(algo, wop({ calorieAdjust: 100 }), ctx, 2).calorieAdjust === 0, 'настояване за обратна посока — до нула, не отвъд');
ok(reviewWeeklyOpinion(algo, wop({ calorieAdjust: -400 }), ctx, 1).vetoes.length > 0, 'над седмичната стъпка — вето');
ok(reviewWeeklyOpinion(algo, wop({ calorieAdjust: -150 }), { ...ctx, checkin: { recoveryLow: true } }).calorieAdjust >= 0, 'ниско възстановяване — без намаление (вето)');
ok(weeklyLimits({ ...ctx, kcal: 1450 }).min >= -50, 'минимумът на приема ограничава намалението');
const removal = reviewWeeklyOpinion(algo, wop({ removeModifications: ['more_volume'] }), ctx, 1);
ok(removal.verdict === 'rebut', 'махане на промяна от отговорите — възражение');
const add = reviewWeeklyOpinion(algo, wop({ addModifications: ['gentle_digestion'] }), ctx);
ok(add.verdict === 'accept' && add.modifications.includes('gentle_digestion') && add.modifications.includes('more_volume'), 'добавяне на промяна — прието');
ok(reviewWeeklyOpinion({ ...algo, calorieAdjust: 0, adherence: 50 }, wop({ calorieAdjust: -100 }), ctx, 1).verdict === 'rebut', 'по-малко калории при неспазен план — възражение');

// ─── Протоколът ───
const review = (o, round) => reviewGoalOpinion(age29, o, round);
const conceded = await deliberate({
  ask: async () => op({ direction: 'lose', intakePct: -22, argument: 'А' }),
  rebut: async () => op({ direction: 'lose', intakePct: -15, argument: 'отстъпвам' }),
  review,
});
ok(conceded.rounds === 2 && conceded.result.verdict === 'accept' && conceded.result.intakePct === -15, 'възражение → отстъпване → прието');
ok(conceded.transcript.length === 4 && conceded.transcript.some(t => t.from === 'algorithm'), 'ходът на обсъждането е записан');
const silent = await deliberate({ ask: async () => op({ intakePct: -22 }), rebut: async () => null, review });
ok(silent.result.intakePct === -10, 'без отговор на възражението — предложението на алгоритъма');
const broken = await deliberate({ ask: async () => { throw new Error('AI down'); }, rebut: async () => null, review });
ok(broken.result.verdict === 'agree' && broken.rounds === 0, 'AI не отговаря — планът не спира');

console.log(`\n=== council: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
