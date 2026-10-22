/**
 * Обогатяване на профила с данни извън въпросника: устройства (тегло, крачки,
 * сън, приет калории), EmoEat, изследвания, AIRIS, други документи. Общ модул за сървъра, клиента и
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
import { computeEssence, dailySeries } from './health-essence.js';
import { deriveIris } from './enrichment-iris.js';
import { deriveSiteQuiz } from './enrichment-site.js';
import { crossCheck, resolutionsOf } from './cross-check.js';
import { deriveDocuments, normalizeDocumentValue } from './enrichment-documents.js';

export const ENRICHMENT_VERSION = 1;

/**
 * Видовете измервания в канонична единица и допустимите граници: всичко
 * извън тях е грешка на източника, не факт. Един факт = един ден (средно
 * или сума за деня), освен ако ключът не казва друго.
 */
export const DEVICE_KINDS = {
  weight: { unit: 'kg', range: [30, 300], label: 'Тегло' },
  body_fat: { unit: '%', range: [3, 70], label: 'Телесни мазнини' },
  muscle_mass: { unit: 'kg', range: [10, 120], label: 'Мускулна маса' },
  visceral_fat: { unit: '', range: [1, 59], label: 'Висцерални мазнини' },
  body_water: { unit: '%', range: [20, 80], label: 'Вода в тялото' },
  steps: { unit: '', range: [0, 60000], label: 'Крачки' },
  active_kcal: { unit: 'kcal', range: [0, 6000], label: 'Активни калории' },
  workout: { unit: 'мин', range: [1, 900], label: 'Тренировки' },
  sleep: { unit: 'ч', range: [0, 16], label: 'Сън' },
  resting_hr: { unit: 'уд/мин', range: [30, 120], label: 'Пулс в покой' },
  hrv: { unit: 'ms', range: [5, 300], label: 'Вариабилност на пулса (HRV)' },
  intake: { unit: 'kcal', range: [0, 8000], label: 'Приети калории' },
  water: { unit: 'л', range: [0, 10], label: 'Вода' },
  bp: { unit: 'mmHg', range: [60, 260], range2: [30, 160], label: 'Кръвно налягане' },
  glucose: { unit: 'mmol/L', range: [1.5, 35], keys: ['morning', 'peak', 'any'], label: 'Кръвна захар' },
};

/** Честите алтернативни единици → каноничната. */
const UNIT_CONVERT = {
  weight: { lb: v => v * 0.4536, lbs: v => v * 0.4536 },
  muscle_mass: { lb: v => v * 0.4536, lbs: v => v * 0.4536 },
  glucose: { 'mg/dl': v => v / 18 },
  water: { ml: v => v / 1000, мл: v => v / 1000 },
  sleep: { min: v => v / 60, мин: v => v / 60 },
};

const DAY_MS = 86400000;
const MAX_FACTS = 1500;
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
  const spec = DEVICE_KINDS[kind];
  if (spec) {
    const unit = String(raw.unit || '').trim().toLowerCase();
    const conv = UNIT_CONVERT[kind]?.[unit];
    let v = Number(String(raw.value).replace(',', '.'));
    if (conv) v = conv(v);
    const [lo, hi] = spec.range;
    if (!Number.isFinite(v) || v < lo || v > hi) return null;
    const fact = { kind, key: kind, value: Math.round(v * 100) / 100, unit: spec.unit, at, source, confidence, status };
    if (spec.keys) fact.key = spec.keys.includes(raw.key) ? raw.key : 'any';
    if (spec.range2) {
      const v2 = Number(String(raw.value2).replace(',', '.'));
      if (!Number.isFinite(v2) || v2 < spec.range2[0] || v2 > spec.range2[1] || v2 >= v) return null;
      fact.value2 = Math.round(v2);
    }
    if (kind === 'workout' && Number(raw.count) > 0) fact.count = Math.min(10, Math.round(Number(raw.count)));
    return fact;
  }
  if (kind === 'emoeat') {
    if (!raw.value || typeof raw.value !== 'object') return null;
    return { kind, key: 'profile', value: raw.value, unit: '', at, source: 'emoeat', confidence, status };
  }
  if (kind === 'resolution') {
    const key = String(raw.key || '').trim().slice(0, 80);
    const value = String(raw.value ?? '').trim().slice(0, 40);
    if (!/^[a-z_]+(:[\p{L}\p{N}_]+)?$/u.test(key) || !value) return null;
    return { kind, key, value, unit: '', at, source: 'client', confidence: 1, status: 'confirmed' };
  }
  if (kind === 'site_quiz') {
    const v = raw.value;
    if (!v || typeof v !== 'object' || !v.site) return null;
    const strs = (a, n, len) => (Array.isArray(a) ? a.map(x => String(x || '').trim().slice(0, len)).filter(Boolean).slice(0, n) : []);
    const value = { site: String(v.site).slice(0, 40), lines: strs(v.lines, 12, 300), cautions: strs(v.cautions, 6, 200) };
    if (!value.lines.length && !value.cautions.length) return null;
    return { kind, key: 'answers', value, unit: '', at, source, confidence, status };
  }
  if (kind === 'iris') {
    if (!raw.value || typeof raw.value !== 'object' || !raw.value.analysis) return null;
    return { kind, key: 'report', value: raw.value, unit: '', at, source: 'airis', confidence, status };
  }
  if (kind === 'document') {
    const value = normalizeDocumentValue(raw.value);
    const key = String(raw.key || '').trim().slice(0, 40);
    if (!value || !/^[A-Za-z0-9_-]{6,40}$/.test(key)) return null;
    return { kind, key, value, unit: '', at, source: 'document', confidence: 1, status };
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

/**
 * Средно по дни, по една стойност на ден от най-сигурния източник (същото правило
 * като есенцията): телефон и гривна за един ден не се осредняват.
 */
function dailyMeanRanked(facts, kind, days, now) {
  const from = now.getTime() - days * DAY_MS;
  const vals = dailySeries(facts, kind).filter(p => p.t >= from).map(p => p.value);
  return { days: vals.length, mean: vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null };
}

/** Крачки → нивото на активност от въпросника (Tudor-Locke: <5000 заседнал, 10 000+ активен). */
function activityLabelOf(steps) {
  if (steps < 5000) return 'Ниско';
  if (steps < 10000) return 'Средно';
  return 'Високо';
}

/**
 * Извежда от фактите какво се променя в профила.
 * @param {{ facts?: any[], digest?: any }} store
 * @param {Date} [now]
 * @param {'M'|'F'|'X'} [sex]
 */
export function deriveEnrichment(store, now = new Date(), sex = 'X', ctx = {}) {
  const facts = Array.isArray(store?.facts) ? store.facts : [];
  const overrides = {};
  const reasons = [];
  /** @type {{ behaviors: string[], approach: string[], clinical: string[], cautions: string[], exclusions: string[] }} */
  const hints = { behaviors: [], approach: [], clinical: [], cautions: [], exclusions: [] };
  const checkin = {};

  const steps = dailyMeanRanked(facts, 'steps', 14, now);
  if (steps.days >= 7 && steps.mean != null) {
    overrides.dailyActivityLevel = activityLabelOf(steps.mean);
    reasons.push(`активност по крачкомер: ~${Math.round(steps.mean / 100) * 100} крачки дневно`);
  }
  const sleep = dailyMeanRanked(facts, 'sleep', 14, now);
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
  const intake = dailyMeanRanked(facts, 'intake', 7, now);
  if (intake.days >= 4 && intake.mean != null) checkin.intakeKcal = Math.round(intake.mean);

  const emo = deriveEmoEat(facts);
  const labs = deriveLabs(facts, now, sex);
  const essence = computeEssence(facts, now, ctx);
  Object.assign(overrides, essence.overrides);
  Object.assign(checkin, essence.checkin);
  // AI обобщението предлага само промени в менюто от речника (не калории и не диагнози).
  const digest = store?.digest && typeof store.digest === 'object' ? store.digest : null;
  const digestPart = digest ? { hints: { approach: digest.approach || [], behaviors: digest.behaviors || [] }, reasons: [] } : null;
  const iris = deriveIris(facts);
  const siteQuiz = deriveSiteQuiz(facts);
  const resolutions = resolutionsOf(facts);
  const documents = deriveDocuments(facts);
  // Клиентът не се разпознава в профила от EmoEat — остава само гласът, без кодове.
  const emoPart = emo && resolutions.emoeat_vs_q === 'rare' ? { ...emo, hints: null } : emo;
  for (const part of [emoPart, labs, essence, digestPart, iris, siteQuiz, documents]) {
    if (!part) continue;
    for (const k of ['behaviors', 'approach', 'clinical', 'cautions', 'exclusions']) hints[k].push(...(part.hints?.[k] || []));
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
    essence: { metrics: essence.metrics, signals: essence.signals, sources: essence.sources, at: essence.at },
    digest: digest ? { insights: digest.insights || [], coachNote: digest.coachNote || '', at: digest.at } : null,
    iris: iris?.summary || null,
    irisRaw: iris?.raw || null,
    siteQuiz: siteQuiz?.summary || null,
    documents: documents?.list || [],
    // Откъде идва всеки код — за реанализа (кой източник е добавил проблема).
    codeSources: {
      labs: [...(labs?.hints?.clinical || [])],
      documents: [...(documents?.hints?.clinical || []), ...(documents?.hints?.exclusions || [])],
      device: [...(essence.hints?.clinical || []), ...(essence.hints?.behaviors || [])],
      emoeat: [...(emoPart?.hints?.behaviors || []), ...(emoPart?.hints?.clinical || [])],
    },
    resolutions,
    reasons,
  };
}

/**
 * Прилага обогатяването върху данните за генериране. Оригиналните отговори
 * остават в _enrichment.original, за да се вижда какво е заменено.
 * @param {Record<string, any>} userData
 * @param {{ facts?: any[], digest?: any } | null | undefined} store
 */
export function applyEnrichment(userData, store, now = new Date()) {
  if (!userData || !store?.facts?.length) return userData;
  const sex = userData.gender === 'Мъж' ? 'M' : userData.gender === 'Жена' ? 'F' : 'X';
  const kg = Number(String(userData.weight || '').replace(',', '.'));
  const derived = deriveEnrichment(store, now, sex, kg > 30 ? { waterNeedL: Math.round(kg * 0.033 * 10) / 10 } : {});
  // Сверка с отговорите на клиента: потвърдените находки влизат в менюто,
  // разминаванията стават въпроси, а отговорите им — замени.
  const cc = crossCheck(userData, derived, derived.resolutions);
  Object.assign(derived.overrides, cc.overrides);
  derived.hints.approach = [...new Set([...derived.hints.approach, ...cc.approach])];
  derived.hints.cautions = [...new Set([...derived.hints.cautions, ...cc.cautions])];
  derived.crossCheck = { hypotheses: cc.hypotheses, questions: cc.questions };
  // Лекарствата от документите влизат в проверката за взаимодействия (храни, добавки, стил).
  const docMeds = [...new Set(derived.documents.flatMap(d => d.medications || []))];
  if (docMeds.length) {
    derived.overrides.medicationsDetails = [userData.medicationsDetails, ...docMeds].filter(Boolean).join(', ');
  }
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
  if (a.activity.sportBand !== b.activity.sportBand) bump(2, 'тренировки');
  if ((a.sleepHours || 0) !== (b.sleepHours || 0) && Math.abs((a.sleepHours || 7) - (b.sleepHours || 7)) >= 1) bump(2, 'сън');
  if (a.stress !== b.stress) bump(2, 'стрес');
  if (a.weightKg && b.weightKg && Math.abs(a.weightKg - b.weightKg) / a.weightKg >= 0.02) bump(2, 'тегло');
  if (!sameSet(a.exclusions, b.exclusions)) bump(1, 'изключени храни');
  if (a.diet.style !== b.diet.style) bump(1, 'начин на хранене');
  if (!sameSet(a.behaviors, b.behaviors)) bump(0, 'хранителни навици');
  if (!sameSet(prevData?._enrichment?.hints?.approach || [], nextData?._enrichment?.hints?.approach || [])) bump(1, 'промени в менюто');
  const aNext = nextData?._enrichment;
  const aPrev = prevData?._enrichment;
  if (JSON.stringify(aNext?.voice || null) !== JSON.stringify(aPrev?.voice || null)) bump(0, 'емоционален профил');
  if (JSON.stringify(aNext?.iris || null) !== JSON.stringify(aPrev?.iris || null)) bump(0, 'ирисов анализ');
  if (JSON.stringify(aNext?.siteQuiz || null) !== JSON.stringify(aPrev?.siteQuiz || null)) bump(0, 'тест за протокол от сайт');
  if (JSON.stringify(aNext?.documents || []) !== JSON.stringify(aPrev?.documents || [])) bump(0, 'документи');
  if (String(nextData?.medicationsDetails || '') !== String(prevData?.medicationsDetails || '')) bump(1, 'лекарства (взаимодействия с храни и добавки)');
  if (JSON.stringify(aNext?.safety || {}) !== JSON.stringify(aPrev?.safety || {})) bump(2, 'граници за безопасност от изследвания');
  return { level: /** @type {0|1|2|3} */ (level), reasons: [...new Set(reasons)] };
}

/** Неотложно: промени за безопасност действат веднага, не чакат седмичния преглед. */
export function isUrgent(derived) {
  return !!(derived?.safety && Object.keys(derived.safety).length);
}
