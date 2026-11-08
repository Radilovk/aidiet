/**
 * Достъп по ниво (Start / Core / Personal / Signature) — сървърна част.
 *
 * - Нивото е на акаунта (fb_…), записано в KV `access:<userId>` като
 *   { tier, until, source, note, updatedAt }. Пише го админът сега, а по-късно
 *   и плащането (Stripe) — със същата функция writeAccess.
 * - Стената е изключена, докато админът не я включи (`admin_paywall_enabled`).
 *   Изключена стена = всичко е отворено за всички, както досега.
 * - Включена стена: платените функции искат акаунт с валиден Firebase токен
 *   и ниво, което ги отключва (pricing-config.js). Иначе — 402 { error: 'locked' }.
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

export async function resolveAccess(env, userId, now = Date.now()) {
  const paywall = await paywallEnabled(env);
  const access = normalizeAccess(await readAccess(env, userId), now);
  return { paywall, tier: access.tier, until: access.until, expired: access.expired, features: featureMap(access.tier, paywall) };
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
 * Проверка на платена функция преди обработчика. Връща Response за отказ
 * или null, когато заявката може да продължи. Тялото се чете от копие.
 *   checkOwner(userId, idToken, env, request) → Response | null
 */
export async function gateFeature(request, env, feature, { checkOwner, respond }) {
  if (!(await paywallEnabled(env))) return null;
  const body = await request.clone().json().catch(() => ({}));
  const userId = String(body?.userId || '');
  const locked = (reason, tier = 'start') => respond({
    error: 'locked', reason, feature, tier,
    need: Pricing.FEATURE_MIN_TIER[feature] || 'core',
    message: `${Pricing.FEATURE_LABEL[feature] || 'Тази функция'} е част от абонамента.`
  }, 402);
  if (!userId.startsWith('fb_')) return locked('account');
  const ownerErr = await checkOwner(userId, body?.idToken, env, request);
  if (ownerErr) return ownerErr;
  const access = normalizeAccess(await readAccess(env, userId));
  return Pricing.allows(access.tier, feature) ? null : locked('tier', access.tier);
}
