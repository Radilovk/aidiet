/**
 * Достъп по ниво (Start / Core / Plus) и месечни тавани — сървърна част.
 *
 * - Нивото е на акаунта (fb_…), записано в KV `access:<userId>` като
 *   { tier, until, source, note, updatedAt }. Пише го админът сега, а по-късно
 *   и плащането (Stripe) — със същата функция writeAccess.
 * - Стената е изключена, докато админът не я включи (`admin_paywall_enabled`).
 *   Изключена стена = всичко е отворено за всички, както досега.
 * - Включена стена: платените функции искат акаунт с валиден Firebase токен
 *   и ниво, което ги отключва (pricing-config.js). Иначе — 402 { error: 'locked' }.
 * - Тавани: брои се в KV `usage:<userId>:<ГГГГ-ММ>` само след успешен отговор.
 *   Изчерпан таван — 402 { reason: 'quota', used, limit }.
 */
import Pricing from './pricing-config.js';

export const PAYWALL_KEY = 'admin_paywall_enabled';
export const accessKey = (userId) => `access:${userId}`;

export async function paywallEnabled(env) {
  try {
    return (await env.page_content?.get(PAYWALL_KEY)) === 'true';
  } catch (_) {
    return false;
  }
}

/** Записът е годен до `until` (ms); след това акаунтът пада до Start. */
export function normalizeAccess(record, now = Date.now()) {
  const tier = Pricing.isTier(record?.tier) ? record.tier : 'start';
  const until = Number(record?.until) || null;
  if (tier !== 'start' && until && until < now) {
    return { tier: 'start', until, expired: true, source: record?.source || '' };
  }
  return { tier, until, expired: false, source: record?.source || '' };
}

export async function readAccess(env, userId) {
  if (!userId || !env.page_content) return null;
  try {
    const raw = await env.page_content.get(accessKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function featureMap(tier, paywall) {
  const out = {};
  for (const feature of Object.keys(Pricing.FEATURE_MIN_TIER)) {
    out[feature] = !paywall || Pricing.allows(tier, feature);
  }
  return out;
}

export const monthOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);
export const usageKey = (userId, month) => `usage:${userId}:${month}`;
const USAGE_TTL_SEC = 40 * 24 * 60 * 60;

export async function readUsage(env, userId, now = Date.now()) {
  if (!userId || !env.page_content) return {};
  try {
    const raw = await env.page_content.get(usageKey(userId, monthOf(now)));
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

export async function addUsage(env, userId, feature, now = Date.now()) {
  if (!userId || !env.page_content) return;
  const usage = await readUsage(env, userId, now);
  usage[feature] = (Number(usage[feature]) || 0) + 1;
  await env.page_content.put(usageKey(userId, monthOf(now)), JSON.stringify(usage), { expirationTtl: USAGE_TTL_SEC });
}

/** Тавани и изразходвано за месеца: { chat: { used, limit } } — само за функции с таван. */
export function quotaMap(tier, usage) {
  const out = {};
  for (const feature of Object.keys(Pricing.FEATURE_MIN_TIER)) {
    const limit = Pricing.quota(tier, feature);
    if (limit !== null) out[feature] = { used: Number(usage?.[feature]) || 0, limit };
  }
  return out;
}

export async function resolveAccess(env, userId, now = Date.now()) {
  const paywall = await paywallEnabled(env);
  const access = normalizeAccess(await readAccess(env, userId), now);
  const quotas = paywall && userId ? quotaMap(access.tier, await readUsage(env, userId, now)) : {};
  return { paywall, tier: access.tier, until: access.until, expired: access.expired, features: featureMap(access.tier, paywall), quotas };
}

/** Записва нивото на акаунт. Start без срок изтрива записа. */
export async function writeAccess(env, userId, { tier, until = null, source = 'admin', note = '' } = {}, now = Date.now()) {
  if (!env.page_content) throw new Error('KV not configured');
  if (!/^fb_[A-Za-z0-9_-]{6,128}$/.test(String(userId || ''))) throw new Error('Нивото се дава само на акаунт (fb_…)');
  if (!Pricing.isTier(tier)) throw new Error('Непознато ниво');
  const untilMs = until ? Number(new Date(until)) : null;
  if (until && !Number.isFinite(untilMs)) throw new Error('Невалидна дата');
  if (tier === 'start' && !untilMs) {
    await env.page_content.delete(accessKey(userId));
    return null;
  }
  const record = { tier, until: untilMs, source: String(source).slice(0, 40), note: String(note || '').slice(0, 200), updatedAt: now };
  await env.page_content.put(accessKey(userId), JSON.stringify(record));
  return record;
}

/**
 * Проверка на платена функция преди обработчика. Тялото се чете от копие.
 *   checkOwner(userId, idToken, env, request) → Response | null
 * Връща { deny: Response|null, commit() } — commit брои използването след успех.
 * fields — имената на полетата с акаунта и токена в тялото (по подразбиране userId/idToken).
 */
export async function gateFeature(request, env, feature, opts) {
  const { checkOwner, respond, fields = {}, now = Date.now() } = opts;
  const pass = { deny: null, commit: async () => {} };
  if (!(await paywallEnabled(env))) return pass;
  const body = opts.body || await request.clone().json().catch(() => ({}));
  const userId = String(body?.[fields.userId || 'userId'] || '');
  const label = Pricing.FEATURE_LABEL[feature] || 'Тази функция';
  const deny = (data) => ({ deny: respond({ error: 'locked', feature, need: Pricing.FEATURE_MIN_TIER[feature] || 'core', ...data }, 402), commit: pass.commit });
  if (!userId.startsWith('fb_')) return deny({ reason: 'account', tier: 'start', message: `${label} е част от абонамента.` });
  const ownerErr = await checkOwner(userId, body?.[fields.idToken || 'idToken'], env, request);
  if (ownerErr) return { deny: ownerErr, commit: pass.commit };
  const { tier } = normalizeAccess(await readAccess(env, userId), now);
  if (!Pricing.allows(tier, feature)) return deny({ reason: 'tier', tier, message: `${label} е част от абонамента.` });
  const limit = Pricing.quota(tier, feature);
  if (limit === null) return pass;
  const used = Number((await readUsage(env, userId, now))[feature]) || 0;
  if (used >= limit) {
    return deny({
      reason: 'quota', tier, used, limit, upgrade: Pricing.upgradeFor(tier, feature),
      message: `Лимитът от ${Pricing.quotaText(limit, feature)} за месеца е изчерпан. Нови — от 1-во число.`
    });
  }
  return { deny: null, commit: () => addUsage(env, userId, feature, now) };
}

/**
 * Може ли новият план да ползва AI (текстове, преглед на менюто, преглед на целта).
 * Изключена стена — да. Включена — само платен акаунт с валиден токен; иначе
 * планът се смята само от алгоритъма (без разход).
 */
export async function planUsesAI(env, userId, idToken, verifyToken, now = Date.now()) {
  if (!(await paywallEnabled(env))) return true;
  if (!String(userId || '').startsWith('fb_') || !idToken) return false;
  try {
    const user = await verifyToken(idToken, env);
    if (`fb_${user.uid}` !== userId) return false;
  } catch (_) {
    return false;
  }
  const { tier } = normalizeAccess(await readAccess(env, userId), now);
  return Pricing.allows(tier, 'ai_plan');
}
