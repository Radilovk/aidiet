/**
 * Награди за постоянство — сървърна част (портфейл, кодове, покани, сравнение с другите).
 * Правилата са в rewards-engine.js (същото ядро смята и телефонът); тук е само това, което
 * трябва да е на едно място: точките, кодовете за отстъпка и поканите.
 *
 * KV:
 *   rewards:<userId>     { days: { ден: точки }, bonus, spent, issued: { 'tier:start': true },
 *                          codes: [код…], invite, invited: [userId…], inviteBonus, updatedAt }
 *   reward_code:<КОД>    (напр. УПОРИТОСТ-417) { userId, kind: plan|supplement|partner, pct, until, source, region?, usedAt?, usedBy? }
 *   invite:<КОД>         userId — кодът за покана на клиента
 *   invite_used:<userId> кодът, с който е купил първия си план (поканата важи веднъж)
 *   rstat:<userId>       '' с metadata { c: постоянство за 30 дни, s: поредица } — за сравнението
 *   rewards_hist         { n, c: [брой по 0…100], at } — разпределението, наново на 12 часа
 *
 * Точките са за дни (gameData, сливан на сървъра — sync-analytics); всеки ден пази най-високото
 * си число, затова изтритите след 120 дни записи не взимат спечеленото.
 * Добавките се доставят само в България: кодовете за тях не се дават при друга държава.
 */
import Rewards from './rewards-engine.js';
import { calcDayScore, dateKey } from './analytics-compression.js';

const DAY_MS = 86400000;
const CODE_DAYS = 60;            // срок на кода за отстъпка
const MIN_COHORT = 200;          // под толкова активни сравнението с другите не се показва
const HIST_TTL_MS = 12 * 3600000;
export const INVITE_PCT = 15;    // отстъпка за поканения (първи план)
export const INVITER_PCT = 20;   // код за поканилия, щом поканеният купи
export const INVITE_POINTS = 300;

// Кодовете са думи, които се помнят и казват нещо: „УПОРИТОСТ-417“, „ПЛОД-НА-ТРУДА-205“, покана „ЕЛА-С-МЕН-318“.
// Думите са по повода (нивото, точките, поканата); числото ги прави лични. Въвежда се с малки или главни букви,
// с интервали или тирета (normCode).
export const CODE_WORDS = {
  'tier:start': ['РЕШИМОСТ', 'ПЪРВА-КРАЧКА', 'ДАДЕНА-ДУМА', 'СМЕЛО-НАЧАЛО'],
  'tier:steady': ['УПОРИТОСТ', 'ДЕН-СЛЕД-ДЕН', 'СИЛНА-ВОЛЯ', 'НЕ-СЕ-ОТКАЗВАМ'],
  'tier:habit': ['ПОСТОЯНСТВО', 'МОЯТ-РИТЪМ', 'НОВ-НАВИК', 'ВЕРЕН-КУРС'],
  'tier:lifestyle': ['ВЪТРЕШНА-СИЛА', 'ОТВЪТРЕ', 'ЖЕЛЯЗНА-ВОЛЯ', 'ЛИЧИ-НАВЪН'],
  offer: ['ПЛОД-НА-ТРУДА', 'ЗАСЛУЖЕНО', 'СПЕЧЕЛЕНО', 'ЧЕСТНА-НАГРАДА'],
  invite: ['БЛАГОДАРЯ', 'ДОБЪР-ПРИЯТЕЛ', 'ЗАЕДНО-СМЕ'],
  invitation: ['ЕЛА-С-МЕН', 'ОБЩА-ЦЕЛ', 'ДВАМА-СМЕ', 'ЗАЕДНО'],
};
const okUser = (id) => /^fb_[A-Za-z0-9_-]{6,128}$/.test(String(id || ''));
const CODE_RE = /^[А-Я]{2,}(?:-[А-Я]{1,})*-\d{3,4}$/;
/** Каквото е въведено → кода: главни букви, тирета вместо интервали. */
export const normCode = (c) => String(c || '').trim().toLocaleUpperCase('bg').replace(/[\s_–—]+/g, '-').replace(/-+/g, '-').slice(0, 40);
export const okRewardCode = (c) => CODE_RE.test(String(c || ''));
export const okInvite = okRewardCode;

function pickFrom(list) {
  const b = new Uint32Array(2); crypto.getRandomValues(b);
  return list[b[0] % list.length];
}
function digits(n) {
  const b = new Uint32Array(1); crypto.getRandomValues(b);
  const lo = 10 ** (n - 1);
  return String(lo + (b[0] % (9 * lo)));
}
/** Свободен код от думите на повода: 3 цифри, при теснота — 4. */
async function freeCode(env, prefix, words) {
  for (let i = 0; i < 12; i++) {
    const code = `${pickFrom(words)}-${digits(i < 8 ? 3 : 4)}`;
    if (!(await env.page_content.get(`${prefix}${code}`))) return code;
  }
  throw new Error('no free code');
}

const getJSON = async (env, k) => { try { return JSON.parse((await env.page_content.get(k)) || 'null'); } catch (_) { return null; } };
const putJSON = (env, k, v, ttlSec) => env.page_content.put(k, JSON.stringify(v), ttlSec ? { expirationTtl: ttlSec } : undefined);

function countryOf(request) {
  const c = request?.cf?.country || request?.headers?.get?.('CF-IPCountry') || '';
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : '';
}
/** Добавки — само в България; непозната държава не спира (магазинът проверява адреса). */
const supplementsAllowed = (country) => !country || country === 'BG';

/** Нов код за отстъпка → записът му. */
async function issueCode(env, userId, /** @type {{ kind: string, pct: number, source: string, partner?: string, now?: number }} */ { kind, pct, source, partner = '', now = Date.now() }) {
  const words = CODE_WORDS[source] || (source === 'invite' ? CODE_WORDS.invite : CODE_WORDS.offer);
  const code = await freeCode(env, 'reward_code:', words);
  const rec = { userId, kind, pct, source, until: now + CODE_DAYS * DAY_MS, createdAt: now, ...(kind === 'supplement' ? { region: 'BG' } : {}), ...(partner ? { partner } : {}) };
  await putJSON(env, `reward_code:${code}`, rec, (CODE_DAYS + 60) * 86400);
  return { code, ...rec };
}

export async function readRewardCode(env, code, now = Date.now()) {
  if (!okRewardCode(code)) return null;
  const r = await getJSON(env, `reward_code:${code}`);
  return r && !r.usedAt && r.until > now ? r : null;
}

async function ensureInvite(env, userId, record) {
  if (okInvite(record.invite)) return record.invite;
  const c = await freeCode(env, 'invite:', CODE_WORDS.invitation);
  await env.page_content.put(`invite:${c}`, userId);
  record.invite = c;
  return c;
}

/** Разпределението на постоянството при активните (KV list с metadata — без четене на всеки запис). */
async function cohort(env, now) {
  const cached = await getJSON(env, 'rewards_hist');
  if (cached && now - cached.at < HIST_TTL_MS) return cached;
  if (typeof env.page_content.list !== 'function') return null;
  const c = new Array(101).fill(0);
  let n = 0, cursor;
  for (let page = 0; page < 30; page++) {
    const res = await env.page_content.list({ prefix: 'rstat:', cursor });
    for (const k of res.keys || []) {
      const v = Math.max(0, Math.min(100, Math.round(Number(k.metadata?.c) || 0)));
      c[v]++; n++;
    }
    if (res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }
  const hist = { n, c, at: now };
  await putJSON(env, 'rewards_hist', hist, 2 * 86400);
  return hist;
}

/** Делът на другите с по-ниско постоянство (0–99) или null при малко хора. */
export function percentileOf(hist, value) {
  if (!hist || hist.n < MIN_COHORT || value == null) return null;
  let below = 0;
  for (let i = 0; i < Math.min(101, Math.round(value)); i++) below += hist.c[i] || 0;
  return Math.min(99, Math.floor(below / Math.max(1, hist.n - 1) * 100));
}

function publicCode(code, r) {
  return { code, kind: r.kind, pct: r.pct, until: r.until, source: r.source, used: !!r.usedAt, ...(r.partner ? { partner: r.partner } : {}) };
}

function clientTodayKey(raw, now) {
  const server = dateKey(new Date(now));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw || ''))) return server;
  return Math.abs(Date.parse(raw) - Date.parse(server)) <= DAY_MS ? raw : server;
}

/**
 * Състоянието и портфейлът: смята наново от сливаните дни, дава кодовете за новите стъпала.
 * POST /api/user/rewards { userId, idToken, todayKey? }
 */
export async function handleRewards(request, env, { respond, checkOwner, now = Date.now() }) {
  const b = await request.json().catch(() => ({}));
  if (!okUser(b.userId)) return respond({ error: 'account' }, 400);
  const authError = await checkOwner(b.userId, b.idToken, env, request);
  if (authError) return authError;
  const userId = b.userId;
  const state = (await getJSON(env, `game_state:${userId}`)) || {};
  const status = Rewards.compute({ gameData: state.gameData || {}, calcDayScore, todayKey: clientTodayKey(b.todayKey, now) });
  const record = (await getJSON(env, `rewards:${userId}`)) || { days: {}, bonus: 0, spent: 0, issued: {}, codes: [], invited: [], inviteBonus: 0 };
  const before = JSON.stringify(record);
  record.days = record.days || {};
  for (const [k, p] of Object.entries(status.points.days)) if (!(record.days[k] >= p)) record.days[k] = p;
  record.bonus = Math.max(Number(record.bonus) || 0, status.points.bonus);
  record.issued = record.issued || {};
  record.codes = Array.isArray(record.codes) ? record.codes : [];

  // Кодовете за стъпалата — веднъж за стъпало.
  const country = countryOf(request);
  const fresh = [];
  for (const m of status.milestones) {
    if (m.kind !== 'tier' || record.issued[m.id]) continue;
    record.issued[m.id] = now;
    for (const r of Rewards.tierById(m.tier).rewards) {
      if (r.kind === 'supplement' && !supplementsAllowed(country)) continue;
      const c = await issueCode(env, userId, { kind: r.kind, pct: r.pct, source: m.id, now });
      record.codes.push(c.code);
      fresh.push(publicCode(c.code, c));
    }
  }
  await ensureInvite(env, userId, record);

  const earned = Object.values(record.days).reduce((s, p) => s + (Number(p) || 0), 0) + record.bonus + (Number(record.inviteBonus) || 0);
  if (JSON.stringify(record) !== before) {
    record.updatedAt = new Date(now).toISOString();
    await putJSON(env, `rewards:${userId}`, record);
  }

  // Сравнението: собственото постоянство в metadata (пише се само при промяна), после делът под него.
  const c30 = status.consistency.d30;
  if (status.daysTracked >= 7 && c30 != null) {
    const prev = typeof env.page_content.getWithMetadata === 'function'
      ? await env.page_content.getWithMetadata(`rstat:${userId}`).catch(() => null) : null;
    if (!prev || prev.metadata?.c !== c30 || prev.metadata?.s !== status.streak) {
      await env.page_content.put(`rstat:${userId}`, '', { expirationTtl: 40 * 86400, metadata: { c: c30, s: status.streak } });
    }
  }
  const hist = status.daysTracked >= 7 ? await cohort(env, now).catch(() => null) : null;

  const codes = [];
  for (const code of record.codes.slice(-20)) {
    const r = await getJSON(env, `reward_code:${code}`);
    if (r && r.until > now) codes.push(publicCode(code, r));
  }
  return respond({
    success: true,
    wallet: { earned, spent: Number(record.spent) || 0, balance: earned - (Number(record.spent) || 0) },
    codes, fresh,
    invite: { code: record.invite || '', count: (record.invited || []).length, pct: INVITE_PCT, reward: INVITER_PCT },
    percentile: percentileOf(hist, c30),
    cohort: hist && hist.n >= MIN_COHORT ? hist.n : null,
    supplements: supplementsAllowed(country),
    offers: Rewards.OFFERS.filter((o) => o.kind !== 'supplement' || supplementsAllowed(country)),
    status: { streak: status.streak, tier: status.tier?.id || null, consistency: status.consistency },
  });
}

/** Точки → код. POST /api/user/rewards/redeem { userId, idToken, offer } */
export async function handleRewardsRedeem(request, env, { respond, checkOwner, now = Date.now() }) {
  const b = await request.json().catch(() => ({}));
  if (!okUser(b.userId)) return respond({ error: 'account' }, 400);
  const authError = await checkOwner(b.userId, b.idToken, env, request);
  if (authError) return authError;
  const offer = Rewards.offerById(String(b.offer || ''));
  if (!offer) return respond({ error: 'bad_request' }, 400);
  if (offer.kind === 'supplement' && !supplementsAllowed(countryOf(request))) return respond({ error: 'region', message: 'Добавките се доставят само в България.' }, 400);
  const record = await getJSON(env, `rewards:${b.userId}`);
  if (!record) return respond({ error: 'points', message: 'Още нямаш точки.' }, 400);
  const earned = Object.values(record.days || {}).reduce((s, p) => s + (Number(p) || 0), 0) + (Number(record.bonus) || 0) + (Number(record.inviteBonus) || 0);
  const balance = earned - (Number(record.spent) || 0);
  if (balance < offer.cost) return respond({ error: 'points', message: `Нужни са ${offer.cost} точки, имаш ${balance}.`, balance }, 400);
  const c = await issueCode(env, b.userId, { kind: offer.kind, pct: offer.pct, source: `offer:${offer.id}`, partner: offer.partner, now });
  record.spent = (Number(record.spent) || 0) + offer.cost;
  record.codes = [...(record.codes || []), c.code];
  record.updatedAt = new Date(now).toISOString();
  await putJSON(env, `rewards:${b.userId}`, record);
  return respond({ success: true, code: publicCode(c.code, c), balance: balance - offer.cost });
}

/** GET /api/rewards/code?code= → { valid, kind, pct, until } — за страницата с цените. */
export async function handleRewardCodeStatus(url, env, { respond, now = Date.now() }) {
  const code = normCode(url.searchParams.get('code'));
  const r = await readRewardCode(env, code, now);
  return respond(r ? { valid: true, kind: r.kind, pct: r.pct, until: r.until } : { valid: false });
}

/** GET /api/rewards/invite?code= → { valid, pct } */
export async function handleInviteStatus(url, env, { respond }) {
  const code = normCode(url.searchParams.get('code'));
  const owner = okInvite(code) ? await env.page_content.get(`invite:${code}`) : null;
  return respond(owner ? { valid: true, pct: INVITE_PCT } : { valid: false });
}

/**
 * Проверка от партньор (магазина за добавки, по-късно ресторанти и вериги):
 * POST /api/rewards/partner/verify { code, redeem?, order? } с X-Partner-Key = REWARDS_PARTNER_KEY.
 * → { valid, kind, pct, until } ; при redeem — кодът се маркира като използван.
 */
export async function handlePartnerVerify(request, env, { respond, now = Date.now() }) {
  const key = request.headers.get('X-Partner-Key') || '';
  if (!env.REWARDS_PARTNER_KEY || key !== env.REWARDS_PARTNER_KEY) return respond({ error: 'unauthorized' }, 401);
  const b = await request.json().catch(() => ({}));
  const code = normCode(b.code);
  const r = await readRewardCode(env, code, now);
  if (!r || r.kind === 'plan') return respond({ valid: false });
  if (b.redeem) await putJSON(env, `reward_code:${code}`, { ...r, usedAt: now, usedBy: 'partner', order: String(b.order || '').slice(0, 64) }, 60 * 86400);
  return respond({ valid: true, kind: r.kind, pct: r.pct, until: r.until, region: r.region || null, redeemed: !!b.redeem });
}

/**
 * Отстъпката за план при покупка: собствен код за план или покана (само за първия план).
 * Взима се по-голямата — не се натрупват. → { pct, reward?, invite?, label } или null.
 */
export async function planDiscount(env, userId, /** @type {{ reward?: string, invite?: string }} */ { reward = '', invite = '' } = {}, now = Date.now()) {
  let best = null;
  const rc = normCode(reward);
  const r = await readRewardCode(env, rc, now);
  if (r && r.kind === 'plan' && r.userId === userId) best = { pct: r.pct, reward: rc, label: `−${r.pct}% награда за постоянство` };
  const inv = normCode(invite);
  if (okInvite(inv) && (!best || best.pct < INVITE_PCT)) {
    const owner = await env.page_content.get(`invite:${inv}`);
    const usedBefore = await env.page_content.get(`invite_used:${userId}`);
    if (owner && owner !== userId && !usedBefore) best = { pct: INVITE_PCT, invite: inv, label: `−${INVITE_PCT}% с покана от приятел` };
  }
  return best;
}

/** След платен план: кодът — използван; поканата — веднъж, поканилият получава код и точки. */
export async function applyPlanDiscount(env, userId, meta, now = Date.now()) {
  if (okRewardCode(meta.reward)) {
    const r = await getJSON(env, `reward_code:${meta.reward}`);
    if (r && !r.usedAt) await putJSON(env, `reward_code:${meta.reward}`, { ...r, usedAt: now, usedBy: userId }, 60 * 86400);
  }
  if (okInvite(meta.invite)) {
    if (await env.page_content.get(`invite_used:${userId}`)) return;
    const owner = await env.page_content.get(`invite:${meta.invite}`);
    await env.page_content.put(`invite_used:${userId}`, meta.invite);
    if (!owner || owner === userId) return;
    const rec = (await getJSON(env, `rewards:${owner}`)) || { days: {}, bonus: 0, spent: 0, issued: {}, codes: [], invited: [], inviteBonus: 0, invite: meta.invite };
    if ((rec.invited || []).includes(userId)) return;
    const c = await issueCode(env, owner, { kind: 'plan', pct: INVITER_PCT, source: 'invite', now });
    rec.invited = [...(rec.invited || []), userId].slice(-200);
    rec.inviteBonus = (Number(rec.inviteBonus) || 0) + INVITE_POINTS;
    rec.codes = [...(rec.codes || []), c.code];
    rec.updatedAt = new Date(now).toISOString();
    await putJSON(env, `rewards:${owner}`, rec);
  }
}
