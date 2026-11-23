/**
 * Награди за постоянство — сървърна част (портфейл, кодове, покани, сравнение с другите).
 * Правилата са в rewards-engine.js (същото ядро смята и телефонът); тук е само това, което
 * трябва да е на едно място: точките, кодовете за отстъпка и поканите.
 *
 * KV:
 *   rewards:<userId>     { days: { ден: точки }, bonus, spent, issued: { 'tier:start:supplement': време },
 *                          grants: [{ code, kind, pct, until, source, left, used: [...] }],
 *                          invite, invited: [userId…], inviteBonus, updatedAt }
 *   invite:<КОД>         userId — личният код за покана (DUO482)
 *   invite_used:<userId> кодът, с който е купил първия си план (поканата важи веднъж)
 *   rstat:<userId>       '' с metadata { c: постоянство 30 дни (през 5%), sb: поредица (група 0–4), t: ниво,
 *                        d: дни история (до 7), o: дни с отваряне от 14 (група 0–3), h: обичаен час,
 *                        a: последен ден (дни от 1970, обновява се през 3 дни), ch: предизвикателство 0/1/2 }
 *                        — за сравнението и отчета (KV list чете metadata без отделни заявки)
 *   rev:<ден>:<0-3>      { събитие: брой } — броячи за отчета (countEvent), без лични данни
 *   rewards:<userId>     … + challenges: { 'YYYY-MM': { id, joined, done } }, challengeBonus
 *                        (days — само банкираните дни, по-стари от 100; по-новите се смятат от game_state)
 *   rewards_hist         { n, c: [брой по 0…100], at } — разпределението, наново на 12 часа
 *   rewards_content      текстове, думи на кодовете и снимки от админ панела (applyContent в rewards-engine.js)
 *   rewards_img:<тема>   качена снимка (data URL) → GET /api/rewards/image/<тема>
 *
 * Кодовете са кратки, на латиница: дума + процент (BOLD5, GRIT10, FLOW15, CORE20, WIN10, ALLY20). Еднакви
 * са за всички, но всеки код е „право“ в записа на спечелилия го: при плащане се търси при купуващия
 * (влязъл в акаунта си), а магазинът го проверява заедно с имейла на клиента (email_index).
 *
 * Точките са за дни (gameData, сливан на сървъра — sync-analytics) и се смятат наново при всяка
 * заявка; дните се „банкират“ в записа едва преди да изтекат (120 дни), затова обичайната заявка
 * не пише нищо в KV, а изтритите стари записи не взимат спечеленото.
 * Добавките се доставят само в България: кодовете за тях не се дават при друга държава.
 */
import Rewards from './rewards-engine.js';
import { calcDayScore, dateKey } from './analytics-compression.js';
import { mergeGameData } from './game-data-merge.js';

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
/**
 * Спечеленото = банкираните дни (record.days) + живите дни, които сървърът още пази в game_state (120 дни)
 * и смята наново при всяка заявка + бонусите. Така обичайната заявка не пише нищо: дните се банкират
 * рядко — само когато наближават изтриването (по-стари от BANK_AGE дни).
 */
const BANK_AGE = 100;
function earnedOf(r, liveDays) {
  const banked = r?.days || {};
  let sum = Object.values(banked).reduce((s, p) => s + (Number(p) || 0), 0);
  // за всеки ден — по-голямото от банкираното и живото (по-стари записи пазят и скорошни дни)
  for (const [k, p] of Object.entries(liveDays || {})) sum += Math.max(0, (Number(p) || 0) - (Number(banked[k]) || 0));
  return sum + (Number(r?.bonus) || 0) + (Number(r?.inviteBonus) || 0) + (Number(r?.challengeBonus) || 0);
}
/** Дните по-стари от BANK_AGE, още небанкирани → в записа (връща true, ако има нещо за запис). */
function bankOldDays(record, liveDays, todayKey) {
  const cut = new Date(Date.parse(todayKey + 'T00:00:00Z') - BANK_AGE * DAY_MS).toISOString().slice(0, 10);
  let changed = false;
  for (const [k, p] of Object.entries(liveDays || {})) {
    if (k < cut && !(record.days[k] >= p)) { record.days[k] = p; changed = true; }
  }
  return changed;
}

// ── Събитията за отчета ─────────────────────────────────────────────────────
// Брояч по дни, без лични данни: rev:<ден>:<0-3> { събитие: брой }. Разделен на 4 ключа (KV приема
// около 1 запис в секунда на ключ); при сблъсък броят е приблизителен — за отчет е достатъчно.
const EVENT_SHARDS = 4;
export const CLIENT_EVENTS = ['share_moment', 'share_section', 'share_invite', 'share_week', 'share_challenge', 'invite_visit', 'week_view', 'comeback'];
const EVENT_RE = /^[a-z][a-z0-9_]{2,40}$/;

export async function countEvent(env, name, n = 1, now = Date.now()) {
  if (!EVENT_RE.test(name) || !env?.page_content) return;
  try {
    const key = `rev:${new Date(now).toISOString().slice(0, 10)}:${Math.floor(Math.random() * EVENT_SHARDS)}`;
    const cur = (await getJSON(env, key)) || {};
    cur[name] = (Number(cur[name]) || 0) + n;
    await putJSON(env, key, cur, 400 * 86400);
  } catch (_) { /* отчетът не пречи на заявката */ }
}

/** POST /api/rewards/event { type } — събитие от телефона (споделяне, посещение от покана…). */
export async function handleRewardsEvent(request, env, { respond, now = Date.now() }) {
  const b = await request.json().catch(() => ({}));
  if (!CLIENT_EVENTS.includes(b.type)) return respond({ error: 'type' }, 400);
  await countEvent(env, b.type, 1, now);
  return respond({ success: true });
}

/**
 * GET /api/admin/rewards/report?days=30 — събитията по дни и картината на хората
 * (от metadata на rstat:*: ниво, поредица, постоянство, влизания, предизвикателство).
 */
export async function handleAdminRewardsReport(url, env, { respond, now = Date.now() }) {
  const n = Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 30));
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    const parts = await Promise.all([...Array(EVENT_SHARDS)].map((_, sh) => getJSON(env, `rev:${day}:${sh}`)));
    const counts = {};
    parts.forEach((p) => Object.entries(p || {}).forEach(([k, v]) => { counts[k] = (counts[k] || 0) + (Number(v) || 0); }));
    days.push({ day, counts });
  }
  const today = Math.floor(now / DAY_MS);
  const people = { users: 0, active7: 0, active30: 0, tiers: [0, 0, 0, 0, 0], streaks: { '0': 0, '1-6': 0, '7-20': 0, '21-65': 0, '66+': 0 },
    consistency: { '<40': 0, '40-59': 0, '60-79': 0, '80+': 0 }, hours: new Array(24).fill(0), opens: { '0': 0, '1-3': 0, '4-7': 0, '8-14': 0 }, challenge: { joined: 0, done: 0 } };
  let cursor;
  for (let page = 0; page < 30 && typeof env.page_content.list === 'function'; page++) {
    const res = await env.page_content.list({ prefix: 'rstat:', cursor });
    for (const k of res.keys || []) {
      const m = k.metadata || {};
      people.users++;
      if (m.a != null && today - m.a < 7) people.active7++;
      if (m.a != null && today - m.a < 30) people.active30++;
      people.tiers[(Number.isFinite(m.t) ? m.t : -1) + 1]++;
      const sbk = m.sb != null ? m.sb : (() => { const s = Number(m.s) || 0; return s === 0 ? 0 : s < 7 ? 1 : s < 21 ? 2 : s < 66 ? 3 : 4; })();
      people.streaks[['0', '1-6', '7-20', '21-65', '66+'][sbk] || '0']++;
      const c = Number(m.c) || 0;
      people.consistency[c < 40 ? '<40' : c < 60 ? '40-59' : c < 80 ? '60-79' : '80+']++;
      if (m.h >= 0 && m.h < 24) people.hours[m.h]++;
      people.opens[['0', '1-3', '4-7', '8-14'][Number(m.o) || 0] || '0']++;
      if (m.ch >= 1) people.challenge.joined++;
      if (m.ch === 2) people.challenge.done++;
    }
    if (res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }
  return respond({ success: true, days, people, tiers: Rewards.TIERS.map((t) => t.title) });
}


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
let histMem = null;   // в паметта на копието на worker-а — без четене от KV при всяка заявка
async function cohort(env, now) {
  if (histMem && now - histMem.at < HIST_TTL_MS) return histMem;
  const cached = await getJSON(env, 'rewards_hist');
  if (cached && now - cached.at < HIST_TTL_MS) return (histMem = cached);
  if (typeof env.page_content.list !== 'function') return null;
  const c = new Array(101).fill(0);
  let n = 0, cursor;
  for (let page = 0; page < 30; page++) {
    const res = await env.page_content.list({ prefix: 'rstat:', cursor });
    for (const k of res.keys || []) {
      if (k.metadata?.d != null && k.metadata.d < 7) continue;   // сравнение — само с поне седмица история
      const v = Math.max(0, Math.min(100, Math.round(Number(k.metadata?.c) || 0)));
      c[v]++; n++;
    }
    if (res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }
  const hist = { n, c, at: now };
  await putJSON(env, 'rewards_hist', hist, 2 * 86400);
  return (histMem = hist);
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

/** Правилото за движение от телефона: { reward: bool, maxPct: 100–300 | null } или null при нещо друго. */
function activityPolicyOf(a) {
  if (!a || typeof a !== 'object') return null;
  const max = a.maxPct == null ? null : Number(a.maxPct);
  if (max != null && !(max >= 100 && max <= 300)) return null;
  return { reward: a.reward !== false, maxPct: max };
}

/**
 * Състоянието и портфейлът: смята наново от сливаните дни, дава кодовете за новите стъпала.
 * POST /api/user/rewards { userId, idToken, todayKey?, gameData? }
 */
export async function handleRewards(request, env, { respond, checkOwner, now = Date.now() }) {
  const b = await request.json().catch(() => ({}));
  if (!okUser(b.userId)) return respond({ error: 'account' }, 400);
  const authError = await checkOwner(b.userId, b.idToken, env, request);
  if (authError) return authError;
  const userId = b.userId;
  await loadContent(env, now);
  const state = (await getJSON(env, `game_state:${userId}`)) || {};
  // Ново ниво на телефона, което общото копие още не е видяло (sync-analytics върви с отлагане):
  // телефонът праща дните си и те се сливат по същия начин (game-data-merge.js), за да дойде кодът веднага.
  if (b.gameData && typeof b.gameData === 'object' && !Array.isArray(b.gameData)) {
    const merged = mergeGameData(state.gameData || {}, b.gameData);
    if (JSON.stringify(merged) !== JSON.stringify(state.gameData || {})) {
      state.gameData = merged;
      await putJSON(env, `game_state:${userId}`, { ...state, gameData: merged, updatedAt: new Date(now).toISOString() }, 365 * 86400);
    }
  }
  const todayKey = clientTodayKey(b.todayKey, now);
  const record = (await getJSON(env, `rewards:${userId}`)) || emptyRecord();
  const before = JSON.stringify(record);
  const month = Rewards.monthOf(todayKey);
  record.challenges = record.challenges || {};
  // Движението спрямо целта (телефонът го смята от профила — goal-focus.js → activityPolicy) — пази се за другите заявки.
  const policy = activityPolicyOf(b.activity);
  if (policy) record.activity = policy;
  const status = Rewards.compute({ gameData: state.gameData || {}, calcDayScore, todayKey, challenge: record.challenges[month], activity: record.activity });
  record.days = record.days || {};
  bankOldDays(record, status.points.days, todayKey);
  record.bonus = Math.max(Number(record.bonus) || 0, status.points.bonus);
  record.issued = record.issued || {};
  const events = [];

  // Кодовете за нивата. Всяка награда на нивото се помни поотделно (tier:steady:supplement): код за
  // добавки, пропуснат заради заявка от чужбина, идва при следващото отваряне от България. Старите
  // записи (tier:steady) — всички награди на нивото са дадени.
  const country = countryOf(request);
  const fresh = [];
  for (const m of status.milestones) {
    if (m.kind !== 'tier' || record.issued[m.id]) continue;
    const tier = Rewards.tierById(m.tier);
    if (!Object.keys(record.issued).some((k) => k.startsWith(m.id + ':'))) events.push(`level_${m.tier}`);
    for (const r of tier.rewards) {
      const key = `${m.id}:${r.kind}`;
      if (record.issued[key]) continue;
      if (r.kind === 'supplement' && !supplementsAllowed(country)) continue;
      record.issued[key] = now;
      events.push(`code_${r.kind}`);
      fresh.push(publicCode(grant(record, { code: Rewards.codeFor(tier.word, r.pct), kind: r.kind, pct: r.pct, source: m.id, now })));
    }
  }
  // Изпълненото месечно предизвикателство — бонус веднъж.
  const ch = record.challenges[month];
  if (ch && status.challenge?.done && !ch.done) {
    ch.done = now;
    record.challengeBonus = (Number(record.challengeBonus) || 0) + Rewards.CHALLENGE_BONUS;
    events.push('challenge_done');
  }
  await ensureInvite(env, userId, record);

  const earned = earnedOf(record, status.points.days);
  if (JSON.stringify(record) !== before) {
    record.updatedAt = new Date(now).toISOString();
    await putJSON(env, `rewards:${userId}`, record);
  }
  await Promise.all(events.map((e) => countEvent(env, e, 1, now)));

  // Отчетът и сравнението: кратко резюме в metadata — без четене на записите. Стойностите са на
  // стъпки (постоянство през 5%, поредица и отваряне — на групи), а денят на активност се обновява
  // най-рано на 3 дни: резюмето се пише рядко, не при всяко отваряне. Влизанията (np_opens) идват от
  // телефона веднъж на ден и отиват само тук.
  const c30 = status.consistency.d30;
  const os = b.opens && typeof b.opens === 'object' ? Rewards.openStats(b.opens, todayKey) : null;
  const sb = (x) => (x === 0 ? 0 : x < 7 ? 1 : x < 21 ? 2 : x < 66 ? 3 : 4);
  const ob = (x) => (x === 0 ? 0 : x < 4 ? 1 : x < 8 ? 2 : 3);
  const today = Math.floor(now / DAY_MS);
  if (status.daysTracked >= 1) {
    const prev = typeof env.page_content.getWithMetadata === 'function'
      ? await env.page_content.getWithMetadata(`rstat:${userId}`).catch(() => null) : null;
    const pm = prev?.metadata || {};
    const meta = {
      c: Math.round((c30 ?? 0) / 5) * 5, sb: sb(status.streak), t: status.tier ? status.tier.index : -1, d: Math.min(status.daysTracked, 7),
      o: os ? ob(os.days14) : (pm.o ?? 0), h: os ? (os.usualHour ?? -1) : (pm.h ?? -1), ch: ch ? (ch.done ? 2 : 1) : 0, a: pm.a ?? today,
    };
    const changed = !prev || ['c', 'sb', 't', 'd', 'o', 'h', 'ch'].some((k) => pm[k] !== meta[k]);
    if (changed || today - (Number(pm.a) || 0) >= 3) {
      meta.a = today;
      await env.page_content.put(`rstat:${userId}`, '', { expirationTtl: 60 * 86400, metadata: meta });
    }
  }
  const hist = status.daysTracked >= 7 ? await cohort(env, now).catch(() => null) : null;

  const codes = (record.grants || []).filter((g) => g.until > now && g.left > 0).map(publicCode);
  return respond({
    success: true,
    wallet: { earned, spent: Number(record.spent) || 0, balance: earned - (Number(record.spent) || 0) },
    codes, fresh,
    invite: { code: record.invite || '', count: (record.invited || []).length, pct: INVITE_PCT, reward: INVITER_PCT },
    percentile: status.daysTracked >= 7 ? percentileOf(hist, c30) : null,
    cohort: hist && hist.n >= MIN_COHORT ? hist.n : null,
    supplements: supplementsAllowed(country),
    offers: Rewards.OFFERS.filter((o) => o.kind !== 'supplement' || supplementsAllowed(country)),
    challenge: ch ? { month, id: ch.id, joined: ch.joined, done: !!ch.done } : null,
    content: contentCache.value || {},
    status: { streak: status.streak, tier: status.tier?.id || null, consistency: status.consistency },
  });
}

/**
 * Приемане на месечното предизвикателство. POST /api/user/rewards/challenge { userId, idToken, todayKey }
 * Предизвикателството е това на месеца за човека (с крачки или без) — записва се кое е, за да не се смени.
 */
export async function handleRewardsChallenge(request, env, { respond, checkOwner, now = Date.now() }) {
  const b = await request.json().catch(() => ({}));
  if (!okUser(b.userId)) return respond({ error: 'account' }, 400);
  const authError = await checkOwner(b.userId, b.idToken, env, request);
  if (authError) return authError;
  await loadContent(env, now);
  const todayKey = clientTodayKey(b.todayKey, now);
  const state = (await getJSON(env, `game_state:${b.userId}`)) || {};
  const record = (await getJSON(env, `rewards:${b.userId}`)) || emptyRecord();
  const status = Rewards.compute({ gameData: state.gameData || {}, calcDayScore, todayKey, activity: record.activity });
  const c = status.challenge || Rewards.compute({ gameData: { [todayKey]: {} }, calcDayScore, todayKey }).challenge;
  if (!c || !c.canJoin) return respond({ error: 'late', message: Rewards.text('challengeLate', { target: Rewards.CHALLENGE_TARGET }) }, 400);
  record.challenges = record.challenges || {};
  if (!record.challenges[c.month]) {
    record.challenges[c.month] = { id: c.id, joined: todayKey };
    // само последните 12 месеца
    record.challenges = Object.fromEntries(Object.entries(record.challenges).sort().slice(-12));
    record.updatedAt = new Date(now).toISOString();
    await putJSON(env, `rewards:${b.userId}`, record);
    await countEvent(env, 'challenge_join', 1, now);
  }
  return respond({ success: true, challenge: { month: c.month, ...record.challenges[c.month] } });
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
  const record = (await getJSON(env, `rewards:${b.userId}`)) || emptyRecord();
  const state = (await getJSON(env, `game_state:${b.userId}`)) || {};
  const live = Rewards.compute({ gameData: state.gameData || {}, calcDayScore, todayKey: clientTodayKey(b.todayKey, now), activity: record.activity }).points.days;
  record.days = record.days || {};
  const balance = earnedOf(record, live) - (Number(record.spent) || 0);
  if (balance < offer.cost) return respond({ error: 'points', message: `Нужни са ${offer.cost} точки, имаш ${balance}.`, balance }, 400);
  const g = grant(record, { code: Rewards.codeFor(offer.word, offer.pct), kind: offer.kind, pct: offer.pct, source: `offer:${offer.id}`, now });
  record.spent = (Number(record.spent) || 0) + offer.cost;
  record.updatedAt = new Date(now).toISOString();
  await putJSON(env, `rewards:${b.userId}`, record);
  await countEvent(env, `redeem_${offer.id}`, 1, now);
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
    await countEvent(env, 'partner_redeem', 1, now);
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
    if (g) { g.left -= 1; g.used = [...(g.used || []), { at: now, by: 'plan' }].slice(-10); await putJSON(env, `rewards:${userId}`, record); await countEvent(env, 'plan_reward_used', 1, now); }
  }
  if (okInvite(meta.invite)) {
    if (await env.page_content.get(`invite_used:${userId}`)) return;
    const owner = await env.page_content.get(`invite:${meta.invite}`);
    await env.page_content.put(`invite_used:${userId}`, meta.invite);
    if (!owner || owner === userId) return;
    await countEvent(env, 'invite_buy', 1, now);
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
  const c = (await loadContent(env)) || {};   // кешът в паметта — без четене от KV при всяка заявка
  const r = respond({ success: true, content: c });
  try { r.headers.set('Cache-Control', 'public, max-age=300'); } catch (_) { /* неизменими заглавки */ }
  return r;
}

/** POST /api/admin/rewards/content { content } — записва промените (празно поле = по подразбиране). */
export async function handleAdminRewardsContent(request, env, { respond }) {
  const b = await request.json().catch(() => ({}));
  const c = b.content && typeof b.content === 'object' ? b.content : {};
  const prev = (await getJSON(env, 'rewards_content')) || {};
  const clean = { tiers: c.tiers || {}, streaks: c.streaks || {}, challenges: c.challenges || {}, texts: c.texts || {}, words: c.words || {}, images: prev.images || {} };
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

/** Ново запитване от въпросника с покана (save-client-data) → събитие за отчета, ако кодът е истински. */
export async function noteInviteSignup(env, code, now = Date.now()) {
  const c = normCode(code);
  if (!okInvite(c) || !(await env.page_content.get(`invite:${c}`))) return false;
  await countEvent(env, 'invite_signup', 1, now);
  return true;
}
