/**
 * Есенцията от данните на устройства: от дневните факти (часовник, гривна,
 * везна, апарат за кръвно, глюкомер, приложения за хранене) към тенденции и
 * сигнали, които планът може да използва.
 *
 * Детерминистично и обяснимо: всяко правило има минимум данни и праг, а
 * сигналът носи текст за клиента и код за алгоритъма. Без достатъчно данни
 * няма сигнал — липсата на данни не е находка.
 *
 * Сигналите не са диагноза. Кръвното и глюкозата включват предпазните
 * хранителни правила (като изследванията) и бележка за специалиста.
 */

import { isCleanClientText } from './nutrition-engine/text-guard.js';

const DAY_MS = 86400000;

/**
 * Какво AI обобщението може да предложи на алгоритъма: само промени в менюто.
 * Калориите, диагнозите и лекарствата остават в детерминистичните правила.
 */
export const DIGEST_APPROACH = {
  increase_protein: 'повече белтък',
  more_volume: 'повече обем от зеленчуци при същите калории',
  simplify_meals: 'по-прости ястия',
  more_variety: 'повече разнообразие',
  smaller_portions: 'по-малки порции в повече хранения',
  gentle_digestion: 'щадящо храносмилането',
};

/** Нужно ли е ново обобщение: има данни и старото е от преди 6+ дни или липсва. */
export function digestDue(essence, digest, now = new Date()) {
  if (!essence || !Object.keys(essence.metrics || {}).length) return false;
  if (!digest?.at) return true;
  return now.getTime() - Date.parse(digest.at) >= 6 * DAY_MS;
}

/**
 * Отговорът на AI → обобщение: до 4 изречения за клиента, бележка за
 * специалиста и чата, кодове само от DIGEST_APPROACH. Текст с медицински
 * съвет или на латиница отпада (text-guard).
 */
export function normalizeDigest(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object') return null;
  const clean = (s, max) => {
    const t = String(s || '').trim().replace(/\s+/g, ' ').slice(0, max);
    return t && isCleanClientText(t) ? t : '';
  };
  const insights = (Array.isArray(raw.insights) ? raw.insights : []).map(s => clean(s, 220)).filter(Boolean).slice(0, 4);
  const coachNote = clean(raw.coachNote, 500);
  const approach = [...new Set((Array.isArray(raw.approach) ? raw.approach : []).map(String).filter(c => DIGEST_APPROACH[c]))].slice(0, 2);
  if (!insights.length && !coachNote) return null;
  return { insights, coachNote, approach, at: now.toISOString() };
}

/**
 * Кой източник печели за един и същи ден: измереното автоматично (Health Connect
 * или профил в облака — device-links.js) > снимка > файл > ръчно.
 */
const SOURCE_RANK = { health_connect: 4, fitbit: 4, oura: 4, withings: 4, strava: 4, huawei: 4, device_photo: 3, file: 2, manual: 1 };
/** Източниците, които мерят непрекъснато — от тях се брои откога има следене. */
const TRACKED_SOURCES = new Set(['health_connect', 'fitbit', 'oura', 'withings', 'strava', 'huawei']);

function dayOf(at) {
  return new Date(Date.parse(at)).toISOString().slice(0, 10);
}

/**
 * Дневна поредица за вид (и ключ): ден → стойност от най-сигурния източник.
 * @returns {{ day: string, t: number, value: number, value2?: number, count?: number }[]} от най-стария
 */
export function dailySeries(facts, kind, key = null) {
  const byDay = new Map();
  for (const f of facts || []) {
    if (f.kind !== kind || f.status === 'pending') continue;
    if (key && f.key !== key) continue;
    const day = dayOf(f.at);
    const rank = SOURCE_RANK[f.source] || 1;
    const prev = byDay.get(day);
    if (!prev || rank > prev.rank || (rank === prev.rank && Date.parse(f.at) > prev.t)) {
      byDay.set(day, { day, t: Date.parse(day + 'T12:00:00Z'), value: Number(f.value), value2: f.value2, count: f.count, rank });
    }
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

function between(series, now, fromDays, toDays) {
  const hi = now.getTime() - fromDays * DAY_MS;
  const lo = now.getTime() - toDays * DAY_MS;
  return series.filter(p => p.t <= hi && p.t > lo);
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const fmt = (v, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');

/** Наклон на линейната регресия (единици на седмица). */
function slopePerWeek(points) {
  if (points.length < 2) return null;
  const xs = points.map(p => p.t / (7 * DAY_MS));
  const ys = points.map(p => p.value);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? num / den : null;
}

/** Средното на първите и последните n точки — устойчиво на шума на везната. */
function edgeChange(points, n = 3) {
  if (points.length < 2) return null;
  const k = Math.min(n, Math.floor(points.length / 2)) || 1;
  const first = points.slice(0, k);
  const last = points.slice(-k);
  return {
    from: mean(first.map(p => p.value)),
    to: mean(last.map(p => p.value)),
    days: Math.round((mean(last.map(p => p.t)) - mean(first.map(p => p.t))) / DAY_MS),
  };
}

function sportLabelOf(perWeek) {
  if (perWeek < 0.5) return 'Никаква (0 дни седмично)';
  if (perWeek < 2.5) return 'Ниска (1–2 дни седмично)';
  if (perWeek < 4.5) return 'Средна (2–4 дни седмично)';
  return 'Висока (5–7 дни седмично)';
}

/**
 * @param {any[]} facts
 * @param {Date} [now]
 * @param {{ waterNeedL?: number }} [ctx]
 */
export function computeEssence(facts, now = new Date(), ctx = {}) {
  const metrics = {};
  /** @type {{ code: string, level: 'info'|'warn', text: string }[]} */
  const signals = [];
  const hints = { behaviors: [], approach: [], clinical: [], cautions: [] };
  const overrides = {};
  const checkin = {};
  const reasons = [];
  const sources = [...new Set((facts || []).filter(f => SOURCE_RANK[f.source]).map(f => f.source))];

  // ── Тегло: тенденция, не отделно претегляне ──────────────────────────
  const weight = between(dailySeries(facts, 'weight'), now, 0, 21);
  const w14 = between(weight, now, 0, 14);
  if (w14.length >= 5 && w14[w14.length - 1].t - w14[0].t >= 6 * DAY_MS) {
    const slope = slopePerWeek(w14);
    metrics.weight = { last: r1(w14[w14.length - 1].value), avg7: r1(mean(between(weight, now, 0, 7).map(p => p.value)) ?? w14[w14.length - 1].value), trendKgWeek: Math.round(slope * 100) / 100, days: w14.length };
    checkin.weightTrendKgWeek = metrics.weight.trendKgWeek;
    signals.push({ code: 'weight_trend', level: 'info', text: `Тегло: ${fmt(metrics.weight.avg7)} кг средно за седмицата, тенденция ${slope > 0 ? '+' : ''}${fmt(slope, 2)} кг седмично (${w14.length} претегляния).` });
  }

  // ── Състав на тялото: какво се губи — мазнини или мускули ────────────
  const bf = dailySeries(facts, 'body_fat');
  const comp = [];
  const wByDay = new Map(dailySeries(facts, 'weight').map(p => [p.day, p.value]));
  for (const p of between(bf, now, 0, 42)) {
    const w = wByDay.get(p.day);
    if (w) comp.push({ t: p.t, value: w * (1 - p.value / 100), fat: w * p.value / 100, weight: w });
  }
  const muscle = between(dailySeries(facts, 'muscle_mass'), now, 0, 42);
  const lean = muscle.length >= 4 ? muscle : comp;
  if (comp.length) metrics.bodyFat = { last: r1(bf[bf.length - 1]?.value), leanKg: r1(comp[comp.length - 1].value) };
  if (lean.length >= 4) {
    const ch = edgeChange(lean);
    const wPoints = lean === comp ? comp.map(c => ({ t: c.t, value: c.weight })) : between(dailySeries(facts, 'weight'), now, 0, 42);
    const wch = edgeChange(wPoints);
    if (ch && wch && ch.days >= 14) {
      const dLean = ch.to - ch.from;
      const dW = wch.to - wch.from;
      metrics.composition = { days: ch.days, weightChangeKg: r1(dW), leanChangeKg: r1(dLean) };
      if (dW <= -1 && dLean < 0 && -dLean >= -dW * 0.5) {
        signals.push({ code: 'lean_loss', level: 'warn', text: `По везната около ${Math.round(dLean / dW * 100)}% от загубените ${fmt(-dW)} кг за ${ch.days} дни е мускулна маса — белтъкът се увеличава и дефицитът не се задълбочава.` });
        hints.approach.push('increase_protein');
        checkin.leanLoss = true;
        reasons.push('загуба на мускулна маса по везната');
      }
    }
  }
  const visceral = dailySeries(facts, 'visceral_fat');
  if (visceral.length) metrics.visceralFat = visceral[visceral.length - 1].value;

  // ── Активност ─────────────────────────────────────────────────────────
  const steps = dailySeries(facts, 'steps');
  const s7 = between(steps, now, 0, 7);
  if (s7.length >= 4) {
    metrics.steps = { avg7: Math.round(mean(s7.map(p => p.value)) / 100) * 100, days: s7.length };
    const prev = between(steps, now, 7, 35);
    if (prev.length >= 10) {
      const p = mean(prev.map(x => x.value));
      metrics.steps.prevAvg = Math.round(p / 100) * 100;
      if (p > 0 && metrics.steps.avg7 < p * 0.7) {
        signals.push({ code: 'activity_drop', level: 'info', text: `Крачките са спаднали до ~${metrics.steps.avg7} дневно (от ~${metrics.steps.prevAvg}).` });
      }
    }
  }
  const workouts = between(dailySeries(facts, 'workout'), now, 0, 14);
  const trackedSince = Math.min(...(facts || []).filter(f => TRACKED_SOURCES.has(f.source)).map(f => Date.parse(f.at)), Infinity);
  if (workouts.length && now.getTime() - trackedSince >= 12 * DAY_MS) {
    const sessions = workouts.reduce((s, p) => s + (p.count || 1), 0);
    const perWeek = sessions / 2;
    metrics.workouts = { perWeek: r1(perWeek), minutesWeek: Math.round(workouts.reduce((s, p) => s + p.value, 0) / 2) };
    overrides.sportActivity = sportLabelOf(perWeek);
    reasons.push(`тренировки по устройство: ~${fmt(perWeek)} седмично`);
  }
  const active = between(dailySeries(facts, 'active_kcal'), now, 0, 7);
  if (active.length >= 4) metrics.activeKcal = Math.round(mean(active.map(p => p.value)));

  // ── Възстановяване: пулс в покой и HRV спрямо собствената база ───────
  const rhr = dailySeries(facts, 'resting_hr');
  const hrv = dailySeries(facts, 'hrv');
  const rRecent = between(rhr, now, 0, 7);
  const rBase = between(rhr, now, 7, 35);
  const hRecent = between(hrv, now, 0, 7);
  const hBase = between(hrv, now, 7, 35);
  let rhrUp = null;
  let hrvDown = null;
  if (rRecent.length >= 4 && rBase.length >= 10) {
    const a = mean(rRecent.map(p => p.value));
    const b = mean(rBase.map(p => p.value));
    metrics.restingHr = { avg7: Math.round(a), base: Math.round(b) };
    rhrUp = a - b;
  }
  if (hRecent.length >= 4 && hBase.length >= 10) {
    const a = mean(hRecent.map(p => p.value));
    const b = mean(hBase.map(p => p.value));
    metrics.hrv = { avg7: Math.round(a), base: Math.round(b) };
    hrvDown = b > 0 ? (b - a) / b : null;
  }
  const recoveryLow = (rhrUp != null && hrvDown != null && rhrUp >= 5 && hrvDown >= 0.15)
    || (rhrUp != null && hrvDown == null && rhrUp >= 7)
    || (hrvDown != null && rhrUp == null && hrvDown >= 0.25);
  if (recoveryLow) {
    checkin.recoveryLow = true;
    signals.push({ code: 'recovery_low', level: 'warn', text: `Тялото е под натоварване: ${rhrUp != null ? `пулсът в покой е +${Math.round(rhrUp)} уд/мин` : ''}${rhrUp != null && hrvDown != null ? ', ' : ''}${hrvDown != null ? `HRV е −${Math.round(hrvDown * 100)}%` : ''} спрямо обичайното — тази седмица без по-голям дефицит; сън и възстановяване на първо място.` });
    reasons.push('ниско възстановяване по пулса');
  }

  // ── Сън ────────────────────────────────────────────────────────────────
  const sleep = between(dailySeries(facts, 'sleep'), now, 0, 7);
  if (sleep.length >= 5) {
    metrics.sleep = { avg7: r1(mean(sleep.map(p => p.value))), nights: sleep.length };
    if (metrics.sleep.avg7 < 6.5) {
      signals.push({ code: 'sleep_short', level: 'warn', text: `Сън: ~${fmt(metrics.sleep.avg7)} ч средно — под 7 ч гладът и желанието за сладко се засилват.` });
    }
  }

  // ── Хранене и вода от приложения ─────────────────────────────────────
  const intake = between(dailySeries(facts, 'intake'), now, 0, 7);
  if (intake.length >= 4) metrics.intake = { avg7: Math.round(mean(intake.map(p => p.value))), days: intake.length };
  const water = between(dailySeries(facts, 'water'), now, 0, 7);
  if (water.length >= 4) {
    metrics.water = { avg7: r1(mean(water.map(p => p.value))) };
    if (ctx.waterNeedL && metrics.water.avg7 < ctx.waterNeedL * 0.6) {
      signals.push({ code: 'hydration_low', level: 'info', text: `Вода: ~${fmt(metrics.water.avg7)} л дневно при нужда ~${fmt(ctx.waterNeedL)} л.` });
    }
  }

  // ── Кръвно налягане (домашно измерване) ──────────────────────────────
  const bp = between(dailySeries(facts, 'bp'), now, 0, 28);
  if (bp.length >= 3) {
    const sys = mean(bp.map(p => p.value));
    const dia = mean(bp.filter(p => p.value2).map(p => p.value2)) || 0;
    metrics.bp = { sys: Math.round(sys), dia: Math.round(dia), days: bp.length };
    // Домашен праг за повишено: 135/85 (ESC/ESH).
    if (bp.length >= 3 && (sys >= 135 || dia >= 85)) {
      hints.clinical.push('HTN');
      signals.push({ code: 'bp_high', level: 'warn', text: `Кръвно: ~${Math.round(sys)}/${Math.round(dia)} средно от ${bp.length} дни — по-малко сол и повече зеленчуци; за оценка — личен лекар.` });
      hints.cautions.push(sys >= 160 || dia >= 100
        ? `Домашно кръвно ~${Math.round(sys)}/${Math.round(dia)} — да се види от лекар без отлагане.`
        : `Домашно кръвно над 135/85 (~${Math.round(sys)}/${Math.round(dia)}) — за проследяване от лекар.`);
      reasons.push('повишено домашно кръвно');
    }
  }

  // ── Кръвна захар (глюкомер / сензор) ─────────────────────────────────
  const morning = between(dailySeries(facts, 'glucose', 'morning'), now, 0, 28);
  if (morning.length >= 5) {
    const m = mean(morning.map(p => p.value));
    metrics.glucose = { morning: r1(m), days: morning.length };
    if (m >= 5.6) {
      hints.clinical.push('IR');
      signals.push({ code: 'glucose_high', level: 'warn', text: `Кръвна захар сутрин: ~${fmt(m)} mmol/L средно — правилата при инсулинова резистентност са включени.` });
      if (m >= 7.0) hints.cautions.push(`Кръвна захар на гладно ~${fmt(m)} mmol/L по глюкомер — за потвърждение от лекар.`);
      reasons.push('повишена кръвна захар сутрин');
    }
  }
  const peaks = between(dailySeries(facts, 'glucose', 'peak'), now, 0, 14);
  if (peaks.length >= 7) {
    const high = peaks.filter(p => p.value >= 7.8).length / peaks.length;
    metrics.glucose = { ...(metrics.glucose || {}), peakHighShare: Math.round(high * 100) };
    if (high >= 0.3) {
      signals.push({ code: 'glucose_spikes', level: 'info', text: `След хранене захарта минава 7,8 mmol/L в ${Math.round(high * 100)}% от дните — въглехидратите вървят с белтък и зеленчуци, не сами.` });
    }
  }

  for (const k of Object.keys(hints)) hints[k] = [...new Set(hints[k])];
  return { v: 1, at: now.toISOString(), sources, metrics, signals, hints, overrides, checkin, reasons };
}

/** Кратък текстов блок за картона и чата (без суровите факти). */
export function essenceText(essence, digest = null) {
  if (!essence) return '';
  const m = essence.metrics || {};
  const rows = [];
  if (m.weight) rows.push(`тегло ${fmt(m.weight.avg7)} кг, ${m.weight.trendKgWeek > 0 ? '+' : ''}${fmt(m.weight.trendKgWeek, 2)} кг/седм.`);
  if (m.bodyFat) rows.push(`мазнини ${fmt(m.bodyFat.last)}%, чиста маса ${fmt(m.bodyFat.leanKg)} кг`);
  if (m.steps) rows.push(`крачки ~${m.steps.avg7}/ден`);
  if (m.workouts) rows.push(`тренировки ${fmt(m.workouts.perWeek)}/седм. (${m.workouts.minutesWeek} мин)`);
  if (m.sleep) rows.push(`сън ${fmt(m.sleep.avg7)} ч`);
  if (m.restingHr) rows.push(`пулс в покой ${m.restingHr.avg7} (база ${m.restingHr.base})`);
  if (m.hrv) rows.push(`HRV ${m.hrv.avg7} ms (база ${m.hrv.base})`);
  if (m.intake) rows.push(`прием по тракер ~${m.intake.avg7} kcal`);
  if (m.water) rows.push(`вода ${fmt(m.water.avg7)} л`);
  if (m.bp) rows.push(`кръвно ~${m.bp.sys}/${m.bp.dia}`);
  if (m.glucose?.morning) rows.push(`захар сутрин ${fmt(m.glucose.morning)} mmol/L`);
  const lines = [];
  if (rows.length) lines.push(`данни: ${rows.join('; ')}`);
  const warn = (essence.signals || []).filter(s => s.level === 'warn').map(s => s.text);
  if (warn.length) lines.push(`сигнали: ${warn.join(' ')}`);
  if (digest?.coachNote) lines.push(`обобщение: ${digest.coachNote}`);
  return lines.join(' | ').slice(0, 1600);
}
