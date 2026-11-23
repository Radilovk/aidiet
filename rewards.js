/**
 * Награди за постоянство — сървърна част (портфейл, кодове, покани, сравнение с другите).
 * Правилата са в rewards-engine.js (същото ядро смята и телефонът); тук е само това, което
 * трябва да е на едно място: точките, кодовете за отстъпка и поканите.
 *
 * KV:
 *   rewards:<userId>     { days: { ден: точки }, bonus, spent, issued: { 'tier:start': време },
 *                          grants: [{ code, kind, pct, until, source, left, used: [...] }],
 *                          invite, invited: [userId…], inviteBonus, updatedAt }
 *   invite:<КОД>         userId — личният код за покана (DUO482)
 *   invite_used:<userId> кодът, с който е купил първия си план (поканата важи веднъж)
 *   rstat:<userId>       '' с metadata { c: постоянство за 30 дни, s: поредица } — за сравнението
 *   rewards_hist         { n, c: [брой по 0…100], at } — разпределението, наново на 12 часа
 *   rewards_content      текстове, думи на кодовете и снимки от админ панела (applyContent в rewards-engine.js)
 *   rewards_img:<тема>   качена снимка (data URL) → GET /api/rewards/image/<тема>
 *
 * Кодовете са кратки, на латиница: дума + процент (BOLD5, GRIT10, FLOW15, CORE20, WIN10, ALLY20). Еднакви
 * са за всички, но всеки код е „право“ в записа на спечелилия го: при плащане се търси при купуващия
 * (влязъл в акаунта си), а магазинът го проверява заедно с имейла на клиента (email_index).
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

const okUser = (id) => /^fb_[A-Za-z0-9_-]{6,128}$/.test(String(id || ''));
export const normCode = Rewards.normCode;
export const okRewardCode = (c) => /^[A-Z]{2,5}\d{1,2}$/.test(String(c || ''));
export const okInvite = (c) => /^[A-Z]{2,5}\d{3,4}$/.test(String(c || ''));

function digits(n) {
  const b = new Uint32Array(1); crypto.getRandomValues(b);
  const lo = 10 ** (n - 1);
  return String(lo + (b[0] % (9 * lo)));
}

const getJSON = async (env, k) => { try { return JSON.parse((await env.page_content.get(k)) || 'null'); } catch (_) { return null; } };
const putJSON = (env, k, v, ttlSec) => env.page_content.put(k, JSON.stringify(v), ttlSec ? { expirationTtl: ttlSec } : undefined);

// Текстовете и думите от админ панела — в паметта за минута, за да не се чете KV при всяка заявка.
let contentCache = { at: 0, value: null };
export async function loadContent(env, now = Date.now()) {
  if (now - contentCache.at > 60000) contentCache = { at: now, value: await getJSON(env, 'rewards_content') };
  Rewards.applyContent(contentCache.value);
  return contentCache.value;
}
const emptyRecord = () => ({ days: {}, bonus: 0, spent: 0, issued: {}, grants: [], invited: [], inviteBonus: 0 });

function countryOf(request) {
  const c = request?.cf?.country || request?.headers?.get?.('CF-IPCountry') || '';
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : '';
}
/** Добавки — само в България; непозната държава не спира (магазинът проверява адреса). */
const supplementsAllowed = (country) => !country || country === 'BG';

/** Право на код в записа: нов или още едно използване на същия (срокът се подновява). */
function grant(record, { code, kind, pct, source, now = Date.now() }) {
  record.grants = Array.isArray(record.grants) ? record.grants : [];
  let g = record.grants.find((x) => x.code === code && x.kind === kind && x.until > now && x.left > 0);
  if (g) { g.left += 1; g.until = now + CODE_DAYS * DAY_MS; }
  else {
    g = { code, kind, pct, source, until: now + CODE_DAYS * DAY_MS, left: 1, used: [], ...(kind === 'supplement' ? { region: 'BG' } : {}) };
    record.grants.push(g);
  }
  record.grants = record.grants.filter((x) => x.until > now - 30 * DAY_MS).slice(-40);
  return g;
}

/** Валидният код на човека от този вид или null. */
export function findGrant(record, code, kind, now = Date.now()) {
  const c = normCode(code);
  return (record?.grants || []).find((x) => x.code === c && x.kind === kind && x.left > 0 && x.until > now) || null;
}

async function ensureInvite(env, userId, record) {
  if (okInvite(record.invite)) return record.invite;
  const words = Rewards.WORDS.invite;
  for (let i = 0; i < 16; i++) {
    const c = words[i % words.length] + digits(i < 10 ? 3 : 4);
    if (!(await env.page_content.get(`invite:${c}`))) {
      await env.page_content.put(`invite:${c}`, userId);
      record.invite = c;
      return c;
    }
  }
  return '';
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

function publicCode(g) {
  return { code: g.code, kind: g.kind, pct: g.pct, until: g.until, source: g.source, left: g.left, used: !(g.left > 0) };
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
  await loadContent(env, now);
  const state = (await getJSON(env, `game_state:${userId}`)) || {};
  const status = Rewards.compute({ gameData: state.gameData || {}, calcDayScore, todayKey: clientTodayKey(b.todayKey, now) });
  const record = (await getJSON(env, `rewards:${userId}`)) || emptyRecord();
  const before = JSON.stringify(record);
  record.days = record.days || {};
  for (const [k, p] of Object.entries(status.points.days)) if (!(record.days[k] >= p)) record.days[k] = p;
  record.bonus = Math.max(Number(record.bonus) || 0, status.points.bonus);
  record.issued = record.issued || {};

  // Кодовете за нивата — веднъж за ниво.
  const country = countryOf(request);
  const fresh = [];
  for (const m of status.milestones) {
    if (m.kind !== 'tier' || record.issued[m.id]) continue;
    record.issued[m.id] = now;
    const tier = Rewards.tierById(m.tier);
    for (const r of tier.rewards) {
      if (r.kind === 'supplement' && !supplementsAllowed(country)) continue;
      fresh.push(publicCode(grant(record, { code: Rewards.codeFor(tier.word, r.pct), kind: r.kind, pct: r.pct, source: m.id, now })));
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

  const codes = (record.grants || []).filter((g) => g.until > now && g.left > 0).map(publicCode);
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
  await loadContent(env, now);
  const offer = Rewards.offerById(String(b.offer || ''));
  if (!offer) return respond({ error: 'bad_request' }, 400);
  if (offer.kind === 'supplement' && !supplementsAllowed(countryOf(request))) return respond({ error: 'region', message: 'Добавките се доставят само в България.' }, 400);
  const record = await getJSON(env, `rewards:${b.userId}`);
  if (!record) return respond({ error: 'points', message: 'Още нямаш точки.' }, 400);
  const earned = Object.values(record.days || {}).reduce((s, p) => s + (Number(p) || 0), 0) + (Number(record.bonus) || 0) + (Number(record.inviteBonus) || 0);
  const balance = earned - (Number(record.spent) || 0);
  if (balance < offer.cost) return respond({ error: 'points', message: `Нужни са ${offer.cost} точки, имаш ${balance}.`, balance }, 400);
  const g = grant(record, { code: Rewards.codeFor(offer.word, offer.pct), kind: offer.kind, pct: offer.pct, source: `offer:${offer.id}`, now });
  record.spent = (Number(record.spent) || 0) + offer.cost;
  record.updatedAt = new Date(now).toISOString();
  await putJSON(env, `rewards:${b.userId}`, record);
  return respond({ success: true, code: publicCode(g), balance: balance - offer.cost });
}

/** GET /api/rewards/code?code=&userId= → { valid, kind, pct, until } — кодът за план на този акаунт (страницата с цените). */
export async function handleRewardCodeStatus(url, env, { respond, now = Date.now() }) {
  const userId = url.searchParams.get('userId') || '';
  const code = normCode(url.searchParams.get('code'));
  const record = okUser(userId) && okRewardCode(code) ? await getJSON(env, `rewards:${userId}`) : null;
  const g = findGrant(record, code, 'plan', now) || findGrant(record, code, 'supplement', now);
  return respond(g ? { valid: true, kind: g.kind, pct: g.pct, until: g.until } : { valid: false });
}

/** GET /api/rewards/invite?code= → { valid, pct } */
export async function handleInviteStatus(url, env, { respond }) {
  const code = normCode(url.searchParams.get('code'));
  const owner = okInvite(code) ? await env.page_content.get(`invite:${code}`) : null;
  return respond(owner ? { valid: true, pct: INVITE_PCT } : { valid: false });
}

/**
 * Проверка от партньор (магазина за добавки, по-късно ресторанти и вериги):
 * POST /api/rewards/partner/verify { code, email, redeem?, order? } с X-Partner-Key = REWARDS_PARTNER_KEY.
 * Кодът е еднакъв за всички (GRIT10) — важи само ако клиентът с този имейл го е спечелил.
 * → { valid, kind, pct, until, left } ; при redeem — едно използване по-малко.
 */
export async function handlePartnerVerify(request, env, { respond, now = Date.now() }) {
  const key = request.headers.get('X-Partner-Key') || '';
  if (!env.REWARDS_PARTNER_KEY || key !== env.REWARDS_PARTNER_KEY) return respond({ error: 'unauthorized' }, 401);
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase();
  const idx = email ? await getJSON(env, `email_index:${email}`) : null;
  const userId = idx?.userId;
  if (!okUser(userId)) return respond({ valid: false, reason: 'email' });
  const record = await getJSON(env, `rewards:${userId}`);
  const kind = b.kind === 'partner' ? 'partner' : 'supplement';
  const g = findGrant(record, b.code, kind, now);
  if (!g) return respond({ valid: false, reason: 'code' });
  if (b.redeem) {
    g.left -= 1;
    g.used = [...(g.used || []), { at: now, by: 'partner', order: String(b.order || '').slice(0, 64) }].slice(-10);
    await putJSON(env, `rewards:${userId}`, record);
  }
  return respond({ valid: true, kind: g.kind, pct: g.pct, until: g.until, left: g.left, region: g.region || null, redeemed: !!b.redeem });
}

/**
 * Отстъпката за план при покупка: собствен код за план или покана (само за първия план).
 * Взима се по-голямата — не се натрупват. → { pct, reward?, invite?, label } или null.
 */
export async function planDiscount(env, userId, /** @type {{ reward?: string, invite?: string }} */ { reward = '', invite = '' } = {}, now = Date.now()) {
  let best = null;
  const rc = normCode(reward);
  if (okRewardCode(rc)) {
    const g = findGrant(await getJSON(env, `rewards:${userId}`), rc, 'plan', now);
    if (g) best = { pct: g.pct, reward: rc, label: `−${g.pct}% награда за постоянство` };
  }
  const inv = normCode(invite);
  if (okInvite(inv) && (!best || best.pct < INVITE_PCT)) {
    const owner = await env.page_content.get(`invite:${inv}`);
    const usedBefore = await env.page_content.get(`invite_used:${userId}`);
    if (owner && owner !== userId && !usedBefore) best = { pct: INVITE_PCT, invite: inv, label: `−${INVITE_PCT}% с покана от приятел` };
  }
  return best;
}

/** След платен план: кодът — едно използване по-малко; поканата — веднъж, поканилият получава код и точки. */
export async function applyPlanDiscount(env, userId, meta, now = Date.now()) {
  if (okRewardCode(meta.reward)) {
    const record = await getJSON(env, `rewards:${userId}`);
    const g = findGrant(record, meta.reward, 'plan', now);
    if (g) { g.left -= 1; g.used = [...(g.used || []), { at: now, by: 'plan' }].slice(-10); await putJSON(env, `rewards:${userId}`, record); }
  }
  if (okInvite(meta.invite)) {
    if (await env.page_content.get(`invite_used:${userId}`)) return;
    const owner = await env.page_content.get(`invite:${meta.invite}`);
    await env.page_content.put(`invite_used:${userId}`, meta.invite);
    if (!owner || owner === userId) return;
    await loadContent(env, now);
    const rec = (await getJSON(env, `rewards:${owner}`)) || { ...emptyRecord(), invite: meta.invite };
    if ((rec.invited || []).includes(userId)) return;
    grant(rec, { code: Rewards.codeFor(Rewards.WORDS.thanks, INVITER_PCT), kind: 'plan', pct: INVITER_PCT, source: 'invite', now });
    rec.invited = [...(rec.invited || []), userId].slice(-200);
    rec.inviteBonus = (Number(rec.inviteBonus) || 0) + INVITE_POINTS;
    rec.updatedAt = new Date(now).toISOString();
    await putJSON(env, `rewards:${owner}`, rec);
  }
}

// ── Съдържанието от админ панела ─────────────────────────────────────────────

/** GET /api/rewards/content → промените (текстове, думи, снимки); телефонът ги слага върху стойностите по подразбиране. */
export async function handleRewardsContent(env, { respond }) {
  const c = (await getJSON(env, 'rewards_content')) || {};
  const r = respond({ success: true, content: c });
  try { r.headers.set('Cache-Control', 'public, max-age=300'); } catch (_) { /* неизменими заглавки */ }
  return r;
}

/** POST /api/admin/rewards/content { content } — записва промените (празно поле = по подразбиране). */
export async function handleAdminRewardsContent(request, env, { respond }) {
  const b = await request.json().catch(() => ({}));
  const c = b.content && typeof b.content === 'object' ? b.content : {};
  const prev = (await getJSON(env, 'rewards_content')) || {};
  const clean = { tiers: c.tiers || {}, streaks: c.streaks || {}, texts: c.texts || {}, words: c.words || {}, images: prev.images || {} };
  const size = JSON.stringify(clean).length;
  if (size > 60000) return respond({ error: 'too_big' }, 400);
  Rewards.applyContent(clean);   // проверка: хвърля ли нещо
  await putJSON(env, 'rewards_content', { ...clean, updatedAt: new Date().toISOString() });
  contentCache = { at: 0, value: null };
  return respond({ success: true });
}

/**
 * POST /api/admin/rewards/image { theme, data } — снимка за тема (data URL, смалена в админ панела);
 * data: '' — връща снимката по подразбиране (brand/rewards).
 */
export async function handleAdminRewardsImage(request, env, { respond, now = Date.now() }) {
  const b = await request.json().catch(() => ({}));
  const theme = String(b.theme || '');
  if (!Rewards.THEMES.includes(theme)) return respond({ error: 'theme' }, 400);
  const c = (await getJSON(env, 'rewards_content')) || {};
  c.images = c.images || {};
  if (!b.data) {
    await env.page_content.delete(`rewards_img:${theme}`);
    delete c.images[theme];
  } else {
    if (!/^data:image\/(webp|jpeg|png);base64,/.test(b.data) || b.data.length > 4e6) return respond({ error: 'image' }, 400);
    await env.page_content.put(`rewards_img:${theme}`, b.data);
    c.images[theme] = `${new URL(request.url).origin}/api/rewards/image/${theme}?v=${now}`;
  }
  await putJSON(env, 'rewards_content', { ...c, updatedAt: new Date(now).toISOString() });
  contentCache = { at: 0, value: null };
  return respond({ success: true, url: c.images[theme] || null });
}

/** GET /api/rewards/image/<тема> — качената снимка (адресът носи ?v=, затова се кешира дълго). */
export async function handleRewardsImage(theme, env) {
  const data = Rewards.THEMES.includes(theme) ? await env.page_content.get(`rewards_img:${theme}`) : null;
  if (!data) return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  const type = data.slice(5, data.indexOf(';'));
  const bin = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), (ch) => ch.charCodeAt(0));
  return new Response(bin, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
}
