#!/usr/bin/env node
/**
 * Профили в облака (device-links.js): вход, токени и превръщането на
 * отговорите на Fitbit, Oura, Withings и Strava във факти. Мрежата е подменена.
 */
import { PROVIDERS, enabledProviders, authorizeUrl, exchangeCode, pullFacts } from '../device-links.js';
import { normalizeFact } from '../enrichment.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const NOW = new Date('2026-10-20T10:00:00Z');
const ENV = {
  FITBIT_CLIENT_ID: 'fb', FITBIT_CLIENT_SECRET: 'fbs',
  OURA_CLIENT_ID: 'ou', OURA_CLIENT_SECRET: 'ous',
  WITHINGS_CLIENT_ID: 'wi', WITHINGS_CLIENT_SECRET: 'wis',
  STRAVA_CLIENT_ID: 'st', STRAVA_CLIENT_SECRET: 'sts',
  HUAWEI_CLIENT_ID: 'hw', HUAWEI_CLIENT_SECRET: 'hws',
};
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

/** fetch по таблица: първият шаблон, който се съдържа в адреса. */
function mockFetch(routes, log = []) {
  return async (url, init = {}) => {
    log.push({ url, init });
    for (const [part, res] of routes) if (url.includes(part)) return typeof res === 'function' ? res(url, init) : res;
    return json({}, 404);
  };
}
const valid = list => list.map(normalizeFact).filter(Boolean);
const kinds = list => [...new Set(list.map(f => f.kind))].sort().join(',');

// ── Включени доставчици ──────────────────────────────────────────────────
ok(enabledProviders({}).length === 0, 'без ключове — нито един доставчик');
ok(enabledProviders({ OURA_CLIENT_ID: 'x' }).length === 0, 'само ID без SECRET — не е включен');
ok(enabledProviders(ENV).join() === 'fitbit,oura,withings,huawei,strava', 'всички с ключове');

// ── Вход: адрес, PKCE за Fitbit ─────────────────────────────────────────
{
  const a = await authorizeUrl(ENV, 'fitbit', { redirectUri: 'https://w.dev/api/links/callback/fitbit', state: 'S1' });
  const u = new URL(a.url);
  ok(u.host === 'www.fitbit.com' && u.searchParams.get('client_id') === 'fb' && u.searchParams.get('state') === 'S1', 'Fitbit: адрес за вход');
  ok(a.verifier && u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('code_challenge').length >= 43, 'Fitbit: PKCE');
  const o = await authorizeUrl(ENV, 'oura', { redirectUri: 'r', state: 'S2' });
  ok(!o.verifier && !new URL(o.url).searchParams.has('code_challenge'), 'Oura: без PKCE');
  let threw = false;
  try { await authorizeUrl({}, 'fitbit', { redirectUri: 'r', state: 's' }); } catch (_) { threw = true; }
  ok(threw, 'без ключове — вход не се отваря');
}

// ── Токени: Basic за Fitbit, тайна в тялото за другите, Withings в body ──
{
  const log = [];
  const t = await exchangeCode(mockFetch([['fitbit.com/oauth2/token', json({ access_token: 'A', refresh_token: 'R', expires_in: 28800 })]], log), ENV, 'fitbit', { code: 'C', redirectUri: 'r', verifier: 'V' });
  const req = log[0];
  ok(t.access === 'A' && t.refresh === 'R' && t.expiresAt > Date.now(), 'Fitbit: токен');
  ok(req.init.headers.Authorization === `Basic ${btoa('fb:fbs')}` && !req.init.body.includes('client_secret') && req.init.body.includes('code_verifier=V'), 'Fitbit: Basic + verifier, без тайна в тялото');

  const log2 = [];
  const w = await exchangeCode(mockFetch([['wbsapi.withings.net/v2/oauth2', json({ status: 0, body: { access_token: 'WA', refresh_token: 'WR', expires_in: 10800 } })]], log2), ENV, 'withings', { code: 'C', redirectUri: 'r' });
  ok(w.access === 'WA' && log2[0].init.body.includes('action=requesttoken') && log2[0].init.body.includes('client_secret=wis'), 'Withings: action и тайна в тялото');

  let threw = false;
  try { await exchangeCode(mockFetch([['withings', json({ status: 503 })]]), ENV, 'withings', { code: 'C', redirectUri: 'r' }); } catch (_) { threw = true; }
  ok(threw, 'Withings: статус ≠ 0 → грешка');

  const s = await exchangeCode(mockFetch([['strava.com/oauth/token', json({ access_token: 'SA', refresh_token: 'SR', expires_at: 1900000000 })]]), ENV, 'strava', { code: 'C', redirectUri: 'r' });
  ok(s.expiresAt === 1900000000 * 1000, 'Strava: expires_at в секунди');
}

const LINK = { access: 'A', refresh: 'R', expiresAt: NOW.getTime() + 3600000 };

// ── Fitbit: всички видове, единици, празни дни ──────────────────────────
{
  const day = (d, v) => ({ dateTime: d, value: String(v) });
  const fetchFn = mockFetch([
    ['activities/steps', json({ 'activities-steps': [day('2026-10-18', 8200), day('2026-10-19', 0)] })],
    ['activities/activityCalories', json({ 'activities-activityCalories': [day('2026-10-18', 410)] })],
    ['activities/heart', json({ 'activities-heart': [{ dateTime: '2026-10-18', value: { restingHeartRate: 61 } }, { dateTime: '2026-10-19', value: {} }] })],
    ['/hrv/', json({ hrv: [{ dateTime: '2026-10-18', value: { dailyRmssd: 38.4 } }] })],
    ['/sleep/', json({ sleep: [{ dateOfSleep: '2026-10-18', minutesAsleep: 400 }, { dateOfSleep: '2026-10-18', minutesAsleep: 35 }] })],
    ['body/log/weight', json({ weight: [{ date: '2026-10-18', weight: 81.3, fat: 24.25 }] })],
    ['caloriesIn', json({ 'foods-log-caloriesIn': [day('2026-10-18', 1950), day('2026-10-19', 120)] })],
    ['foods/log/water', json({ 'foods-log-water': [day('2026-10-18', 1800)] })],
  ]);
  const { facts } = await pullFacts(fetchFn, ENV, 'fitbit', LINK, NOW);
  const f = valid(facts);
  ok(f.length === facts.length, `Fitbit: всички факти минават проверката (${f.length}/${facts.length})`);
  ok(kinds(f) === 'active_kcal,body_fat,hrv,intake,resting_hr,sleep,steps,water,weight', `Fitbit: видове (${kinds(f)})`);
  ok(f.filter(x => x.kind === 'steps').length === 1, 'Fitbit: ден с 0 крачки отпада');
  ok(f.find(x => x.kind === 'sleep').value === 7.3, 'Fitbit: сънят — сбор от сесиите на деня, в часове');
  ok(f.find(x => x.kind === 'water').value === 1.8, 'Fitbit: вода ml → l');
  ok(f.filter(x => x.kind === 'intake').length === 1, 'Fitbit: непълен дневник (<500 kcal) отпада');
  ok(f.every(x => x.source === 'fitbit'), 'Fitbit: източник');
}

// ── Fitbit: един вид пада — останалите идват ────────────────────────────
{
  const fetchFn = mockFetch([
    ['activities/steps', json({ 'activities-steps': [{ dateTime: '2026-10-18', value: '5000' }] })],
    ['/hrv/', json({}, 403)],
  ]);
  const { facts } = await pullFacts(fetchFn, ENV, 'fitbit', LINK, NOW);
  ok(facts.length === 1 && facts[0].kind === 'steps', 'Fitbit: отказан обхват не спира другите');
}

// ── Изтекъл токен → подновяване; 401 → подновяване и повторение ─────────
{
  const log = [];
  let calls = 0;
  const fetchFn = mockFetch([
    ['oauth2/token', json({ access_token: 'NEW', refresh_token: 'R2', expires_in: 28800 })],
    ['activities/steps', (url, init) => (++calls, init.headers.Authorization === 'Bearer NEW'
      ? json({ 'activities-steps': [{ dateTime: '2026-10-18', value: '7000' }] }) : json({}, 401))],
  ], log);
  const expired = await pullFacts(fetchFn, ENV, 'fitbit', { ...LINK, expiresAt: NOW.getTime() - 1 }, NOW);
  ok(expired.link.access === 'NEW' && expired.link.refresh === 'R2' && expired.facts.length === 1, 'изтекъл токен — подновен преди заявките');

  const rejected = await pullFacts(fetchFn, ENV, 'fitbit', { ...LINK, access: 'OLD' }, NOW);
  ok(rejected.link.access === 'NEW' && rejected.facts.length === 1, '401 — подновяване и повторение');

  let threw = false;
  try { await pullFacts(fetchFn, ENV, 'fitbit', { access: 'OLD', refresh: null, expiresAt: 0 }, NOW); } catch (_) { threw = true; }
  ok(threw, 'без refresh токен — грешка (свържете отново)');
}

// ── Oura ────────────────────────────────────────────────────────────────
{
  const fetchFn = mockFetch([
    ['daily_activity', json({ data: [{ day: '2026-10-18', steps: 9100, active_calories: 520 }] })],
    ['/sleep?', json({ data: [
      { day: '2026-10-18', type: 'long_sleep', total_sleep_duration: 26100, average_hrv: 44, lowest_heart_rate: 52 },
      { day: '2026-10-18', type: 'late_nap', total_sleep_duration: 1800, average_hrv: 30, lowest_heart_rate: 60 },
    ] })],
    ['/workout?', json({ data: [
      { day: '2026-10-18', start_datetime: '2026-10-18T07:00:00+03:00', end_datetime: '2026-10-18T07:45:00+03:00' },
      { day: '2026-10-18', start_datetime: '2026-10-18T18:00:00+03:00', end_datetime: '2026-10-18T18:30:00+03:00' },
    ] })],
  ]);
  const f = valid((await pullFacts(fetchFn, ENV, 'oura', LINK, NOW)).facts);
  ok(kinds(f) === 'active_kcal,hrv,resting_hr,sleep,steps,workout', `Oura: видове (${kinds(f)})`);
  ok(f.find(x => x.kind === 'sleep').value === 7.3 && f.find(x => x.kind === 'resting_hr').value === 52, 'Oura: само нощният сън');
  const w = f.find(x => x.kind === 'workout');
  ok(w.value === 75 && w.count === 2, 'Oura: тренировки — минути и брой за деня');
}

// ── Withings ────────────────────────────────────────────────────────────
{
  const t = Date.parse('2026-10-18T06:30:00Z') / 1000;
  const fetchFn = mockFetch([
    ['withings.net/measure', json({ status: 0, body: { measuregrps: [
      { date: t, measures: [{ type: 1, value: 81250, unit: -3 }, { type: 6, value: 245, unit: -1 }, { type: 76, value: 5880, unit: -2 }, { type: 77, value: 4450, unit: -2 }] },
      { date: t, measures: [{ type: 10, value: 128, unit: 0 }, { type: 9, value: 82, unit: 0 }] },
    ] } })],
    ['v2/measure', json({ status: 0, body: { activities: [{ date: '2026-10-18', steps: 6400, calories: 300 }] } })],
    ['v2/sleep', json({ status: 0, body: { series: [{ date: '2026-10-18', data: { total_sleep_time: 25200 } }] } })],
  ]);
  const f = valid((await pullFacts(fetchFn, ENV, 'withings', LINK, NOW)).facts);
  ok(kinds(f) === 'active_kcal,body_fat,body_water,bp,muscle_mass,sleep,steps,weight', `Withings: видове (${kinds(f)})`);
  ok(f.find(x => x.kind === 'weight').value === 81.3 && f.find(x => x.kind === 'body_fat').value === 24.5, 'Withings: стойност × 10^unit');
  const bp = f.find(x => x.kind === 'bp');
  ok(bp.value === 128 && bp.value2 === 82, 'Withings: кръвно горно/долно');
  ok(f.find(x => x.kind === 'body_water').value === 54.8, 'Withings: вода в тялото kg → %');
}

// ── Strava ──────────────────────────────────────────────────────────────
{
  const log = [];
  const fetchFn = mockFetch([['athlete/activities', json([
    { start_date_local: '2026-10-17T07:00:00Z', moving_time: 2400 },
    { start_date_local: '2026-10-17T18:00:00Z', moving_time: 1800 },
    { start_date_local: '2026-10-18T07:00:00Z', moving_time: 0 },
  ])]], log);
  const f = valid((await pullFacts(fetchFn, ENV, 'strava', LINK, NOW)).facts);
  ok(f.length === 1 && f[0].value === 70 && f[0].count === 2, 'Strava: тренировки по ден, без празни');
  ok(/after=\d+/.test(log[0].url), 'Strava: от началото на прозореца');
}

// ── Huawei: групи/набори/точки, времена в ns и ms, сън от health record ─
{
  const ns = d => String(Date.parse(d) * 1e6);
  const pt = (d, fields) => ({ startTime: ns(d), endTime: ns(d), value: Object.entries(fields).map(([fieldName, v]) => (Number.isInteger(v) ? { fieldName, integerValue: v } : { fieldName, floatValue: v })) });
  const log = [];
  const fetchFn = mockFetch([
    ['dailyPolymerize', (url, init) => JSON.parse(init.body).dataTypes[0].includes('steps')
      ? json({ group: [{ startTime: Date.parse('2026-10-18'), sampleSet: [{ samplePoints: [pt('2026-10-18T10:00:00Z', { steps: 9400 })] }] }] })
      : json({ group: [{ sampleSet: [{ samplePoints: [pt('2026-10-18T10:00:00Z', { calories: 512.4 })] }] }] })],
    ['sampleSet:polymerize', (url, init) => {
      const t = JSON.parse(init.body).polymerizeWith[0].dataTypeName;
      if (t.includes('body_weight')) return json({ sampleSet: [{ samplePoints: [pt('2026-10-18T07:00:00Z', { body_weight: 81.26, height: 180 })] }] });
      if (t.includes('blood_pressure')) return json({ sampleSet: [{ samplePoints: [pt('2026-10-18T08:00:00Z', { systolic_pressure: 126, diastolic_pressure: 81 })] }] });
      if (t.includes('resting')) return json({ sampleSet: [{ samplePoints: [pt('2026-10-18T06:00:00Z', { resting_heart_rate: 58 })] }] });
      return json({});
    }],
    ['healthRecords', json({ healthRecords: [{ endTime: ns('2026-10-18T05:30:00Z'), value: [{ fieldName: 'all_sleep_time', integerValue: 432 }] }] })],
  ], log);
  const f = valid((await pullFacts(fetchFn, ENV, 'huawei', LINK, NOW)).facts);
  ok(kinds(f) === 'active_kcal,bp,resting_hr,sleep,steps,weight', `Huawei: видове (${kinds(f)})`);
  ok(f.find(x => x.kind === 'steps').value === 9400 && f.find(x => x.kind === 'weight').value === 81.3, 'Huawei: стойности по име на полето, не по ред');
  ok(f.find(x => x.kind === 'sleep').value === 7.2 && f.find(x => x.kind === 'sleep').at.startsWith('2026-10-18'), 'Huawei: сън от health record, ns → ден');
  ok(log.some(l => l.url.includes('dailyPolymerize') && JSON.parse(l.init.body).startDay === '20261006'), 'Huawei: дни като yyyyMMdd');
  const a = await authorizeUrl(ENV, 'huawei', { redirectUri: 'r', state: 's' });
  ok(/access_type=offline/.test(a.url) && /healthkit%2Fstep\.read/.test(a.url), 'Huawei: офлайн достъп и обхват за крачки');
}

ok(Object.values(PROVIDERS).every(p => p.name && p.env && p.authorizeUrl && p.tokenUrl && typeof p.fetchFacts === 'function'), 'всеки доставчик е пълен');

console.log(`device-links: ${pass} ✓, ${fail} ✗`);
if (fail) process.exit(1);
