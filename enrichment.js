/**
 * Обогатяване на профила с данни извън въпросника: устройства (тегло, крачки,
 * сън, приет калории), EmoEat, изследвания. Общ модул за сървъра, клиента и
 * тестовете.
 *
 * Всеки източник дава факти: { kind, key, value, unit, at, source, confidence,
 * status }. Фактите се сливат (измереното и по-новото печелят), превеждат се в
 * същите полета и кодове, по които двигателят съставя плана, и по разликата в
 * компилирания профил се определя нивото на преизчисляване:
 *   0 — глас (психология, навици, ситуации)
 *   1 — меню
 *   2 — стратегия и калории
 *   3 — анализ от нулата
 * Въпросникът остава непокътнат — замените пазят оригиналните отговори.
 */

import { compileProfile } from './profile-code.js';
import { deriveEmoEat } from './enrichment-emoeat.js';
import { deriveLabs } from './enrichment-labs.js';

export const ENRICHMENT_VERSION = 1;

/** Допустими граници: всичко извън тях е грешка на източника, не факт. */
const RANGES = {
  weight: [30, 300],
  steps: [0, 60000],
  sleep: [0, 16],
  intake: [0, 8000],
};

const DAY_MS = 86400000;
const MAX_FACTS = 600;
const MAX_AGE_DAYS = 400;

function dayOf(at) {
  const t = Date.parse(at);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/**
 * @param {any} raw
 * @returns {{ kind: string, key: string, value: any, unit: string, at: string, source: string, confidence: number, status: string } | null}
 */
export function normalizeFact(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind || '').trim();
  const at = dayOf(raw.at || raw.date) ? new Date(Date.parse(raw.at || raw.date)).toISOString() : null;
  if (!kind || !at) return null;
  const source = String(raw.source || 'manual').slice(0, 40);
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 1)));
  const status = ['confirmed', 'pending', 'inferred'].includes(raw.status) ? raw.status : 'confirmed';
  if (RANGES[kind]) {
    const v = Number(String(raw.value).replace(',', '.'));
    const [lo, hi] = RANGES[kind];
    if (!Number.isFinite(v) || v < lo || v > hi) return null;
    return { kind, key: kind, value: Math.round(v * 100) / 100, unit: String(raw.unit || ''), at, source, confidence, status };
  }
  if (kind === 'emoeat') {
    if (!raw.value || typeof raw.value !== 'object') return null;
    return { kind, key: 'profile', value: raw.value, unit: '', at, source: 'emoeat', confidence, status };
  }
  if (kind === 'biomarker') {
    const key = String(raw.key || '').trim();
    const v = Number(String(raw.value).replace(',', '.'));
    if (!key || !Number.isFinite(v)) return null;
    const ref = {};
    if (Number.isFinite(Number(raw.refLow))) ref.refLow = Number(raw.refLow);
    if (Number.isFinite(Number(raw.refHigh))) ref.refHigh = Number(raw.refHigh);
    return { kind, key, value: v, unit: String(raw.unit || ''), at, source, confidence, status, ...ref };
  }
  return null;
}

/**
 * Сливане: един факт на вид/ключ/ден/източник — по-новият запис печели.
 * Стари (над 400 дни) отпадат, общият брой е ограничен.
 */
export function mergeFacts(existing = [], incoming = [], now = new Date()) {
  const byKey = new Map();
  const put = (f) => {
    if (!f) return;
    const k = `${f.kind}|${f.key}|${dayOf(f.at)}|${f.source}`;
    byKey.set(k, f);
  };
  for (const f of existing) put(normalizeFact(f));
  for (const f of incoming) put(normalizeFact(f));
  const cutoff = now.getTime() - MAX_AGE_DAYS * DAY_MS;
  return [...byKey.values()]
    .filter(f => Date.parse(f.at) >= cutoff)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_FACTS);
}

function recent(facts, kind, days, now) {
  const from = now.getTime() - days * DAY_MS;
  return facts.filter(f => f.kind === kind && Date.parse(f.at) >= from && f.status !== 'pending');
}

/** Средно по дни (няколко записа за един ден → средното им). */
function dailyMean(list) {
  const byDay = new Map();
  for (const f of list) {
    const d = dayOf(f.at);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(Number(f.value));
  }
  const days = [...byDay.values()].map(v => v.reduce((s, x) => s + x, 0) / v.length);
  return { days: days.length, mean: days.length ? days.reduce((s, x) => s + x, 0) / days.length : null };
}

/** Крачки → нивото на активност от въпросника (Tudor-Locke: <5000 заседнал, 10 000+ активен). */
function activityLabelOf(steps) {
  if (steps < 5000) return 'Ниско';
  if (steps < 10000) return 'Средно';
  return 'Високо';
}

/**
 * Извежда от фактите какво се променя в профила.
 * @param {{ facts?: any[] }} store
 * @param {Date} [now]
 * @param {'M'|'F'|'X'} [sex]
 */
export function deriveEnrichment(store, now = new Date(), sex = 'X') {
  const facts = Array.isArray(store?.facts) ? store.facts : [];
  const overrides = {};
  const reasons = [];
  /** @type {{ behaviors: string[], approach: string[], clinical: string[], cautions: string[] }} */
  const hints = { behaviors: [], approach: [], clinical: [], cautions: [] };
  const checkin = {};

  const steps = dailyMean(recent(facts, 'steps', 14, now));
  if (steps.days >= 7 && steps.mean != null) {
    overrides.dailyActivityLevel = activityLabelOf(steps.mean);
    reasons.push(`активност по крачкомер: ~${Math.round(steps.mean / 100) * 100} крачки дневно`);
  }
  const sleep = dailyMean(recent(facts, 'sleep', 14, now));
  if (sleep.days >= 5 && sleep.mean != null) {
    overrides.sleepHours = String(Math.round(sleep.mean * 10) / 10);
    reasons.push(`сън по устройство: ~${String(Math.round(sleep.mean * 10) / 10).replace('.', ',')} ч`);
  }
  // Теглото влиза в седмичното претегляне (средно от последните 3 дни), не в профила.
  const weights = recent(facts, 'weight', 3, now);
  if (weights.length) {
    const w = weights.reduce((s, f) => s + Number(f.value), 0) / weights.length;
    checkin.weightKg = Math.round(w * 10) / 10;
  }
  const intake = dailyMean(recent(facts, 'intake', 7, now));
  if (intake.days >= 4 && intake.mean != null) checkin.intakeKcal = Math.round(intake.mean);

  const emo = deriveEmoEat(facts);
  const labs = deriveLabs(facts, now, sex);
  for (const part of [emo, labs]) {
    if (!part) continue;
    for (const k of ['behaviors', 'approach', 'clinical', 'cautions']) hints[k].push(...(part.hints?.[k] || []));
    reasons.push(...(part.reasons || []));
  }
  for (const k of Object.keys(hints)) hints[k] = [...new Set(hints[k])];

  return {
    v: ENRICHMENT_VERSION,
    overrides,
    hints,
    checkin,
    voice: emo?.voice || null,
    labs: labs?.findings || [],
    safety: labs?.safety || {},
    supplements: labs?.supplements || [],
    reasons,
  };
}

/**
 * Прилага обогатяването върху данните за генериране. Оригиналните отговори
 * остават в _enrichment.original, за да се вижда какво е заменено.
 * @param {Record<string, any>} userData
 * @param {{ facts?: any[] } | null | undefined} store
 */
export function applyEnrichment(userData, store, now = new Date()) {
  if (!userData || !store?.facts?.length) return userData;
  const sex = userData.gender === 'Мъж' ? 'M' : userData.gender === 'Жена' ? 'F' : 'X';
  const derived = deriveEnrichment(store, now, sex);
  const original = {};
  for (const [field, value] of Object.entries(derived.overrides)) {
    original[field] = userData[field] ?? null;
    userData[field] = value;
  }
  userData._enrichment = { ...derived, original };
  return userData;
}

const sameSet = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x));

/**
 * Нивото на преизчисляване по разликата между двата профила.
 * @returns {{ level: 0|1|2|3, reasons: string[] }}
 */
export function recalcLevel(prevData, nextData) {
  const a = compileProfile(prevData || {});
  const b = compileProfile(nextData || {});
  const reasons = [];
  let level = 0;
  const bump = (l, why) => { if (l > level) level = l; reasons.push(why); };
  if (a.goal !== b.goal) bump(3, 'нова цел');
  if (a.protocol !== b.protocol) bump(3, 'клиничен протокол');
  if (!sameSet(a.clinical, b.clinical)) bump(3, 'здравословно състояние');
  if (a.diet.pattern !== b.diet.pattern) bump(3, 'модел на хранене');
  if (a.activity.daily !== b.activity.daily) bump(2, 'ниво на активност');
  if ((a.sleepHours || 0) !== (b.sleepHours || 0) && Math.abs((a.sleepHours || 7) - (b.sleepHours || 7)) >= 1) bump(2, 'сън');
  if (a.stress !== b.stress) bump(2, 'стрес');
  if (a.weightKg && b.weightKg && Math.abs(a.weightKg - b.weightKg) / a.weightKg >= 0.02) bump(2, 'тегло');
  if (!sameSet(a.exclusions, b.exclusions)) bump(1, 'изключени храни');
  if (a.diet.style !== b.diet.style) bump(1, 'начин на хранене');
  if (!sameSet(a.behaviors, b.behaviors)) bump(0, 'хранителни навици');
  const aNext = nextData?._enrichment;
  const aPrev = prevData?._enrichment;
  if (JSON.stringify(aNext?.voice || null) !== JSON.stringify(aPrev?.voice || null)) bump(0, 'емоционален профил');
  if (JSON.stringify(aNext?.safety || {}) !== JSON.stringify(aPrev?.safety || {})) bump(2, 'граници за безопасност от изследвания');
  return { level: /** @type {0|1|2|3} */ (level), reasons: [...new Set(reasons)] };
}

/** Неотложно: промени за безопасност действат веднага, не чакат седмичния преглед. */
export function isUrgent(derived) {
  return !!(derived?.safety && Object.keys(derived.safety).length);
}
