/**
 * Съвет: алгоритъмът и AI обсъждат ключовите решения.
 *
 * Алгоритъмът е детерминистичен и проверим, но вижда само това, което е
 * кодирано. AI чете целия човек — свободен текст, документи, бележки,
 * противоречия между източниците — но може да сгреши в числата и в
 * безопасността. Затова ролите са разделени така:
 *
 *   1. ПРЕДЛОЖЕНИЕ — алгоритъмът изчислява решението и мотивите си.
 *   2. ПРЕГЛЕД — AI вижда предложението и контекста; съгласява се, коригира
 *      или възразява, с аргумент.
 *   3. ПРОВЕРКА — алгоритъмът проверява корекцията:
 *        - ТВЪРДИ граници (клинична рамка, безопасност) → вето. Не се обсъжда;
 *          корекцията се свежда до границата.
 *        - МЕКИ граници (колко далеч от предложението) → в тях AI печели:
 *          той вижда повече. Извън тях → възражение.
 *   4. ВЪЗРАЖЕНИЕ И ОТГОВОР — един кръг: алгоритъмът казва какво не приема
 *      и защо; AI или отстъпва, или настоява с по-силен аргумент.
 *   5. РЕШЕНИЕ — при отстъпване: приетото. При настояване: крайната мека
 *      граница в посоката на AI, а несъгласието се записва за специалиста.
 *
 * Точките на обсъждане: посоката и силата на целта (при план и при
 * преглед) и седмичната корекция. Без AI (изключен, грешка, празен отговор)
 * остава решението на алгоритъма — обсъждането никога не спира плана.
 */

import GoalModel from '../goal-model.js';
import { PLAN_MODIFICATION_CODES } from './index.js';

/** Колко процентни пункта AI може да мести приема без възражение. */
export const GOAL_SOFT_PCT = 7;
/** Колко kcal AI може да мести седмичната корекция без възражение. */
export const WEEKLY_SOFT_KCAL = 100;
const WEEKLY_STEP = 150;
const WEEKLY_TOTAL_SHIFT = 400;

/** Съседни посоки — между тях AI сменя без възражение (скокът сваляне↔покачване не е такъв). */
const NEIGHBORS = {
  lose: ['recomp', 'maintain'],
  recomp: ['lose', 'maintain', 'gain'],
  maintain: ['recomp', 'gain', 'lose'],
  gain: ['recomp', 'maintain'],
};
const DIRECTIONS = Object.keys(NEIGHBORS);
const STANCES = ['agree', 'adjust', 'object'];

const text = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const intOr = (v, d = null) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : d;
};
const pick = (list, allowed, max = 6) => [...new Set((Array.isArray(list) ? list : []).map(x => String(x).trim()).filter(x => allowed.includes(x)))].slice(0, max);

/* ─── Целта ─────────────────────────────────────────────────────────────── */

/** Отговорът на AI за целта → само позволени стойности. */
export function normalizeGoalOpinion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const stance = STANCES.includes(raw.stance) ? raw.stance : 'adjust';
  return {
    stance,
    direction: DIRECTIONS.includes(raw.direction) ? raw.direction : null,
    intakePct: intOr(raw.intakePct),
    extraGoals: pick(raw.extraGoals, Object.keys(GoalModel.GOAL_NAMES)),
    lead: pick(raw.lead, GoalModel.LEAD_METRICS, 5),
    argument: text(raw.argument),
    concerns: (Array.isArray(raw.concerns) ? raw.concerns : []).map(c => text(c, 200)).filter(Boolean).slice(0, 3),
  };
}

/**
 * Проверката на алгоритъма върху мнението на AI за целта.
 * @param {ReturnType<typeof GoalModel.resolve>} model  моделът БЕЗ решение на съвета
 * @param {ReturnType<typeof normalizeGoalOpinion>|null} opinion
 * @param {1|2} round
 * @returns {{ verdict: 'agree'|'accept'|'veto'|'rebut'|'dissent', direction: string, intakePct: number, vetoes: string[], objections: string[] }}
 */
export function reviewGoalOpinion(model, opinion, round = 1) {
  const algo = model.algorithm;
  const out = (verdict, direction, intakePct, vetoes = [], objections = []) => ({ verdict, direction, intakePct, vetoes, objections });
  if (!opinion) return out('agree', algo.direction, algo.intakePct);
  let dir = opinion.direction || algo.direction;
  let pct = opinion.intakePct ?? algo.intakePct;
  if (opinion.stance === 'agree' || (dir === algo.direction && pct === algo.intakePct)) return out('agree', algo.direction, algo.intakePct);

  // Твърдите граници — вето, без обсъждане.
  const lim = model.limits;
  const vetoes = [];
  if (pct < lim.minPct || pct > lim.maxPct) {
    vetoes.push(`Приемът ${pct}% е извън безопасните граници (${lim.minPct}…${lim.maxPct}%)${lim.reasons.length ? `: ${lim.reasons.join('; ')}` : ''}.`);
    pct = Math.max(lim.minPct, Math.min(lim.maxPct, pct));
  }
  if (!lim.allowed.includes(dir)) {
    vetoes.push(`Посоката „${GoalModel.DIRECTION_LABEL[dir]}“ е забранена: ${lim.reasons.join('; ') || 'клинична рамка'}.`);
    dir = algo.direction;
  }
  dir = GoalModel.consistentDirection(dir, pct, algo.direction);

  // Меките граници — колко далеч от предложението.
  const objections = [];
  const diff = pct - algo.intakePct;
  if (Math.abs(diff) > GOAL_SOFT_PCT) {
    objections.push(`Промяна с ${Math.abs(diff)} пункта спрямо ${algo.intakePct}% (без възражение — до ${GOAL_SOFT_PCT}). Какво в профила оправдава толкова голяма разлика?`);
  }
  if (dir !== algo.direction && !NEIGHBORS[algo.direction].includes(dir)) {
    objections.push(`Скок от „${GoalModel.DIRECTION_LABEL[algo.direction]}“ към „${GoalModel.DIRECTION_LABEL[dir]}“ без междинна фаза.`);
  }
  if (!objections.length) return out(vetoes.length ? 'veto' : 'accept', dir, pct, vetoes);
  if (round === 1) return out('rebut', algo.direction, algo.intakePct, vetoes, objections);

  // Настоява и след възражението: до меката граница в неговата посока; несъгласието се записва.
  const edge = algo.intakePct + Math.sign(diff) * Math.min(Math.abs(diff), GOAL_SOFT_PCT);
  const edgePct = Math.max(lim.minPct, Math.min(lim.maxPct, edge));
  const nearDir = NEIGHBORS[algo.direction].includes(dir) || dir === algo.direction ? dir : algo.direction;
  return out('dissent', GoalModel.consistentDirection(nearDir, edgePct, algo.direction), edgePct, vetoes, objections);
}

/* ─── Седмичната корекция ───────────────────────────────────────────────── */

const MODIFICATION_CODES = Object.keys(PLAN_MODIFICATION_CODES);

export function normalizeWeeklyOpinion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    stance: STANCES.includes(raw.stance) ? raw.stance : 'adjust',
    calorieAdjust: intOr(raw.calorieAdjust),
    addModifications: pick(raw.addModifications, MODIFICATION_CODES),
    removeModifications: pick(raw.removeModifications, MODIFICATION_CODES),
    argument: text(raw.argument),
    concerns: (Array.isArray(raw.concerns) ? raw.concerns : []).map(c => text(c, 200)).filter(Boolean).slice(0, 3),
  };
}

/**
 * Твърдите граници на седмичната корекция — същите като в monitoring.js плюс
 * сигналите за безопасност, които алгоритъмът вече е спазил.
 * @param {{ kcal: number, tdee: number, floorKcal: number, baseKcal?: number, direction?: string,
 *   checkin?: { recoveryLow?: boolean, leanLoss?: boolean, workouts?: number|null } }} ctx
 */
export function weeklyLimits(ctx) {
  const kcal = Number(ctx.kcal) || 0;
  const base = Number(ctx.baseKcal) || kcal;
  let min = -WEEKLY_STEP;
  let max = WEEKLY_STEP;
  const reasons = [];
  min = Math.max(min, Math.max(Number(ctx.floorKcal) || 0, base - WEEKLY_TOTAL_SHIFT) - kcal);
  max = Math.min(max, base + WEEKLY_TOTAL_SHIFT - kcal);
  if (ctx.direction === 'lose' && ctx.tdee > 0) max = Math.min(max, ctx.tdee - kcal);
  if (ctx.checkin?.recoveryLow || ctx.checkin?.leanLoss) { min = Math.max(min, 0); reasons.push('сигнали за натоварване/загуба на мускули — без намаление'); }
  if ((ctx.direction === 'gain' || ctx.direction === 'recomp') && ctx.checkin?.workouts === 0) { max = Math.min(max, 0); reasons.push('без силови тренировки — без увеличение'); }
  if (min > max) min = max = 0;
  return { min: Math.round(min), max: Math.round(max), reasons };
}

/**
 * @param {{ calorieAdjust: number, modifications: string[], adherence?: number|null }} decision  решението на алгоритъма
 * @param {ReturnType<typeof normalizeWeeklyOpinion>|null} opinion
 * @param {Parameters<typeof weeklyLimits>[0]} ctx
 * @param {1|2} round
 */
export function reviewWeeklyOpinion(decision, opinion, ctx, round = 1) {
  const algo = Number(decision.calorieAdjust) || 0;
  const mods = decision.modifications || [];
  const out = (verdict, calorieAdjust, modifications, vetoes = [], objections = []) => ({ verdict, calorieAdjust, modifications, vetoes, objections });
  if (!opinion) return out('agree', algo, mods);
  const removing = opinion.removeModifications.filter(m => mods.includes(m));
  const adding = opinion.addModifications.filter(m => !mods.includes(m));
  let delta = opinion.calorieAdjust ?? algo;
  if (opinion.stance === 'agree' || (delta === algo && !removing.length && !adding.length)) return out('agree', algo, mods);

  const lim = weeklyLimits(ctx);
  const vetoes = [];
  if (delta < lim.min || delta > lim.max) {
    vetoes.push(`Корекция ${delta} kcal е извън границите (${lim.min}…${lim.max})${lim.reasons.length ? `: ${lim.reasons.join('; ')}` : ''}.`);
    delta = Math.max(lim.min, Math.min(lim.max, delta));
  }
  const objections = [];
  if (Math.abs(delta - algo) > WEEKLY_SOFT_KCAL) objections.push(`Разлика ${Math.abs(delta - algo)} kcal от предложените ${algo} (без възражение — до ${WEEKLY_SOFT_KCAL}).`);
  if (algo !== 0 && delta !== 0 && Math.sign(delta) !== Math.sign(algo)) objections.push(`Обратна посока на корекцията: алгоритъмът предлага ${algo > 0 ? 'увеличение' : 'намаление'}.`);
  if (delta < 0 && decision.adherence != null && decision.adherence < 60) objections.push(`Спазване ${decision.adherence}% — по-малко калории при неспазен план не проверяват нищо.`);
  if (removing.length) objections.push(`Махане на промени, изведени от отговорите: ${removing.join(', ')}.`);

  const merged = (keepRemoved) => [...new Set([...mods.filter(m => keepRemoved || !removing.includes(m)), ...adding])];
  if (!objections.length) return out(vetoes.length ? 'veto' : 'accept', delta, merged(false), vetoes);
  if (round === 1) return out('rebut', algo, mods, vetoes, objections);

  // Настояване: до меката граница; промените на алгоритъма остават, новите се добавят.
  let edge = algo + Math.sign(delta - algo) * Math.min(Math.abs(delta - algo), WEEKLY_SOFT_KCAL);
  if (algo !== 0 && Math.sign(edge) !== Math.sign(algo) && edge !== 0) edge = 0;
  edge = Math.max(lim.min, Math.min(lim.max, edge));
  return out('dissent', Math.round(edge), merged(true), vetoes, objections);
}

/* ─── Протоколът ────────────────────────────────────────────────────────── */

const VERDICT_TEXT = {
  agree: 'Съгласие с предложението на алгоритъма.',
  accept: 'Корекцията на AI е приета.',
  veto: 'Корекцията е приета, но сведена до безопасните граници.',
  rebut: 'Алгоритъмът възразява.',
  dissent: 'AI настоява — приета е до допустимата граница; несъгласието е отбелязано за специалиста.',
};

/**
 * Обсъждането: мнение → проверка → (възражение → отговор → проверка).
 * @param {{ ask: () => Promise<any>, rebut: (opinion: any, objections: string[]) => Promise<any>,
 *   review: (opinion: any, round: 1|2) => any }} io
 * @returns {Promise<{ result: any, opinion: any, transcript: Array<{ round: number, from: 'ai'|'algorithm', text: string }>, rounds: number }>}
 */
export async function deliberate(io) {
  const transcript = [];
  const say = (round, from, t) => { if (t) transcript.push({ round, from, text: text(t, 600) }); };
  let opinion = null;
  try { opinion = await io.ask(); } catch (_) { opinion = null; }
  if (!opinion) return { result: io.review(null, 1), opinion: null, transcript, rounds: 0 };
  say(1, 'ai', `${opinion.stance}: ${opinion.argument || '—'}`);
  let result = io.review(opinion, 1);
  say(1, 'algorithm', [VERDICT_TEXT[result.verdict], ...result.vetoes, ...result.objections].join(' '));
  if (result.verdict !== 'rebut') return { result, opinion, transcript, rounds: 1 };

  let answer = null;
  try { answer = await io.rebut(opinion, [...result.vetoes, ...result.objections]); } catch (_) { answer = null; }
  if (!answer) {
    // Без отговор на възражението — остава предложението на алгоритъма.
    say(2, 'algorithm', 'Няма отговор на възражението — остава предложението на алгоритъма.');
    return { result: { ...io.review(null, 1), verdict: 'agree' }, opinion, transcript, rounds: 2 };
  }
  say(2, 'ai', `${answer.stance}: ${answer.argument || '—'}`);
  result = io.review(answer, 2);
  say(2, 'algorithm', [VERDICT_TEXT[result.verdict], ...result.vetoes].join(' '));
  return { result, opinion: answer, transcript, rounds: 2 };
}

/** Кратко изречение за мотивите (към решението и картона на специалиста). */
export function councilSummary(result, opinion) {
  if (!opinion || result.verdict === 'agree') return '';
  const why = opinion.argument ? ` ${opinion.argument}` : '';
  if (result.verdict === 'dissent') return `Преглед на специалист: AI настоява за повече промяна, приета е частично.${why}`;
  return `Корекция след преглед:${why}`;
}
