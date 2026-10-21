/**
 * Профили в облака (Fitbit, Oura, Withings, Strava) → обогатяване на профила.
 *
 * Health Connect (health-sync.js) чете от телефона с Android. Тук е другият
 * път: клиентът свързва профила си в приложението на устройството (OAuth),
 * сървърът пази токена и тегли данните за последните дни. Работи и в
 * браузъра, и на iPhone, и в APK — без Health Connect.
 *
 * Всеки доставчик дава факти от същите видове като Health Connect
 * (enrichment.js → DEVICE_KINDS): крачки, сън, тегло, мазнини, мускули,
 * пулс в покой, HRV, активни калории, тренировки, кръвно, приет калории,
 * вода. Доставчик е включен само ако в средата има CLIENT_ID и SECRET
 * (напр. FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET).
 *
 * Без мрежов код на ниво модул: заявките минават през подадения fetch.
 */

export const LINK_DAYS = 14;

const DAY_MS = 86400000;

/** @param {Date} d */
const ymd = d => d.toISOString().slice(0, 10);
const atOf = day => `${day}T12:00:00.000Z`;
const round1 = v => Math.round(v * 10) / 10;

function form(body) {
  return new URLSearchParams(Object.entries(body).filter(([, v]) => v != null && v !== '')).toString();
}

async function getJson(fetchFn, url, token, init = {}) {
  const res = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (res.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
  if (!res.ok) throw new Error(`${url.split('?')[0]}: ${res.status}`);
  return res.json();
}

/** Сума по ден от списък { day, value }. */
function sumByDay(list) {
  const out = new Map();
  for (const x of list) if (x.day && Number.isFinite(x.value)) out.set(x.day, (out.get(x.day) || 0) + x.value);
  return [...out].map(([day, value]) => ({ day, value }));
}

function facts(kind, list, source, map = v => v) {
  return list.filter(x => x.day && Number.isFinite(x.value) && x.value > 0)
    .map(x => ({ kind, value: map(x.value), at: atOf(x.day), source, ...(x.extra || {}) }));
}

/** Тренировки: минути и брой по ден. */
function workoutsByDay(list, source) {
  const byDay = new Map();
  for (const w of list) {
    if (!w.day || !(w.minutes > 0)) continue;
    const d = byDay.get(w.day) || { minutes: 0, count: 0 };
    d.minutes += w.minutes;
    d.count += 1;
    byDay.set(w.day, d);
  }
  return [...byDay].map(([day, d]) => ({ kind: 'workout', value: Math.round(d.minutes), count: d.count, at: atOf(day), source }));
}

/* ─── Доставчиците ────────────────────────────────────────────────────── */

export const PROVIDERS = {
  fitbit: {
    name: 'Fitbit',
    console: 'https://dev.fitbit.com/apps/new',
    env: 'FITBIT',
    pkce: true,
    authorizeUrl: 'https://www.fitbit.com/oauth2/authorize',
    tokenUrl: 'https://api.fitbit.com/oauth2/token',
    scope: 'activity heartrate sleep weight nutrition',
    basicAuth: true,
    async fetchFacts(fetchFn, token, from, to) {
      const A = 'https://api.fitbit.com';
      const range = `${ymd(from)}/${ymd(to)}`;
      const series = async (path, key) => ((await getJson(fetchFn, `${A}${path}/date/${range}.json`, token))[key] || [])
        .map(x => ({ day: x.dateTime, value: Number(x.value) }));
      const out = [];
      const safe = async fn => { try { await fn(); } catch (e) { if (e.status === 401) throw e; } };
      await safe(async () => out.push(...facts('steps', await series('/1/user/-/activities/steps', 'activities-steps'), 'fitbit')));
      await safe(async () => out.push(...facts('active_kcal', await series('/1/user/-/activities/activityCalories', 'activities-activityCalories'), 'fitbit', Math.round)));
      await safe(async () => {
        const r = await getJson(fetchFn, `${A}/1/user/-/activities/heart/date/${range}.json`, token);
        out.push(...facts('resting_hr', (r['activities-heart'] || []).map(x => ({ day: x.dateTime, value: Number(x.value?.restingHeartRate) })), 'fitbit', Math.round));
      });
      await safe(async () => {
        const r = await getJson(fetchFn, `${A}/1/user/-/hrv/date/${range}.json`, token);
        out.push(...facts('hrv', (r.hrv || []).map(x => ({ day: x.dateTime, value: Number(x.value?.dailyRmssd) })), 'fitbit', Math.round));
      });
      await safe(async () => {
        const r = await getJson(fetchFn, `${A}/1.2/user/-/sleep/date/${range}.json`, token);
        out.push(...facts('sleep', sumByDay((r.sleep || []).map(s => ({ day: s.dateOfSleep, value: Number(s.minutesAsleep) / 60 }))), 'fitbit', round1));
      });
      // Без заглавие Accept-Language Fitbit връща метрични единици (кг, мл).
      await safe(async () => {
        const r = await getJson(fetchFn, `${A}/1/user/-/body/log/weight/date/${range}.json`, token);
        for (const w of r.weight || []) {
          if (Number(w.weight) > 0) out.push({ kind: 'weight', value: Number(w.weight), at: atOf(w.date), source: 'fitbit' });
          if (Number(w.fat) > 0) out.push({ kind: 'body_fat', value: round1(Number(w.fat)), at: atOf(w.date), source: 'fitbit' });
        }
      });
      await safe(async () => out.push(...facts('intake', (await series('/1/user/-/foods/log/caloriesIn', 'foods-log-caloriesIn')).filter(x => x.value >= 500), 'fitbit', Math.round)));
      await safe(async () => out.push(...facts('water', await series('/1/user/-/foods/log/water', 'foods-log-water'), 'fitbit', v => round1(v / 1000))));
      return out;
    },
  },

  oura: {
    name: 'Oura',
    console: 'https://cloud.ouraring.com/oauth/applications',
    env: 'OURA',
    authorizeUrl: 'https://cloud.ouraring.com/oauth/authorize',
    tokenUrl: 'https://api.ouraring.com/oauth/token',
    scope: 'daily heartrate personal workout session',
    async fetchFacts(fetchFn, token, from, to) {
      const A = 'https://api.ouraring.com/v2/usercollection';
      const q = `start_date=${ymd(from)}&end_date=${ymd(to)}`;
      const out = [];
      const safe = async fn => { try { await fn(); } catch (e) { if (e.status === 401) throw e; } };
      await safe(async () => {
        const r = await getJson(fetchFn, `${A}/daily_activity?${q}`, token);
        out.push(...facts('steps', (r.data || []).map(d => ({ day: d.day, value: Number(d.steps) })), 'oura'));
        out.push(...facts('active_kcal', (r.data || []).map(d => ({ day: d.day, value: Number(d.active_calories) })), 'oura', Math.round));
      });
      await safe(async () => {
        const r = await getJson(fetchFn, `${A}/sleep?${q}`, token);
        // Основният сън на нощта; пулсът в покой при Oura е най-ниският през съня.
        const nights = (r.data || []).filter(s => s.type === 'long_sleep' || !s.type);
        out.push(...facts('sleep', sumByDay(nights.map(s => ({ day: s.day, value: Number(s.total_sleep_duration) / 3600 }))), 'oura', round1));
        out.push(...facts('hrv', nights.map(s => ({ day: s.day, value: Number(s.average_hrv) })), 'oura', Math.round));
        out.push(...facts('resting_hr', nights.map(s => ({ day: s.day, value: Number(s.lowest_heart_rate) })), 'oura', Math.round));
      });
      await safe(async () => {
        const r = await getJson(fetchFn, `${A}/workout?${q}`, token);
        out.push(...workoutsByDay((r.data || []).map(w => ({ day: w.day, minutes: (Date.parse(w.end_datetime) - Date.parse(w.start_datetime)) / 60000 })), 'oura'));
      });
      return out;
    },
  },

  withings: {
    name: 'Withings',
    console: 'https://developer.withings.com/dashboard/',
    env: 'WITHINGS',
    authorizeUrl: 'https://account.withings.com/oauth2_user/authorize2',
    tokenUrl: 'https://wbsapi.withings.net/v2/oauth2',
    scope: 'user.metrics,user.activity',
    tokenExtra: { action: 'requesttoken' },
    // Withings връща токена в body и статус 0 вместо HTTP код.
    unwrapToken: j => (j && j.status === 0 ? j.body : null),
    async fetchFacts(fetchFn, token, from, to) {
      const out = [];
      const post = async (url, body) => {
        const j = await getJson(fetchFn, url, token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) });
        if (j.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
        if (j.status !== 0) throw new Error(`withings status ${j.status}`);
        return j.body || {};
      };
      const safe = async fn => { try { await fn(); } catch (e) { if (e.status === 401) throw e; } };
      await safe(async () => {
        const b = await post('https://wbsapi.withings.net/measure', {
          action: 'getmeas', meastypes: '1,6,76,77,9,10', category: 1,
          startdate: Math.floor(from.getTime() / 1000), enddate: Math.floor(to.getTime() / 1000),
        });
        for (const g of b.measuregrps || []) {
          const day = ymd(new Date(g.date * 1000));
          const m = {};
          for (const x of g.measures || []) m[x.type] = x.value * 10 ** x.unit;
          if (m[1] > 0) out.push({ kind: 'weight', value: round1(m[1]), at: atOf(day), source: 'withings' });
          if (m[6] > 0) out.push({ kind: 'body_fat', value: round1(m[6]), at: atOf(day), source: 'withings' });
          if (m[76] > 0) out.push({ kind: 'muscle_mass', value: round1(m[76]), at: atOf(day), source: 'withings' });
          if (m[77] > 0 && m[1] > 0) out.push({ kind: 'body_water', value: round1(m[77] / m[1] * 100), at: atOf(day), source: 'withings' });
          if (m[10] > 0 && m[9] > 0) out.push({ kind: 'bp', value: Math.round(m[10]), value2: Math.round(m[9]), at: atOf(day), source: 'withings' });
        }
      });
      await safe(async () => {
        const b = await post('https://wbsapi.withings.net/v2/measure', { action: 'getactivity', startdateymd: ymd(from), enddateymd: ymd(to), data_fields: 'steps,calories' });
        out.push(...facts('steps', (b.activities || []).map(a => ({ day: a.date, value: Number(a.steps) })), 'withings'));
        out.push(...facts('active_kcal', (b.activities || []).map(a => ({ day: a.date, value: Number(a.calories) })), 'withings', Math.round));
      });
      await safe(async () => {
        const b = await post('https://wbsapi.withings.net/v2/sleep', { action: 'getsummary', startdateymd: ymd(from), enddateymd: ymd(to), data_fields: 'total_sleep_time' });
        out.push(...facts('sleep', sumByDay((b.series || []).map(s => ({ day: s.date, value: Number(s.data?.total_sleep_time) / 3600 }))), 'withings', round1));
      });
      return out;
    },
  },

  strava: {
    name: 'Strava',
    console: 'https://www.strava.com/settings/api',
    env: 'STRAVA',
    authorizeUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
    scope: 'activity:read_all',
    authorizeExtra: { approval_prompt: 'auto' },
    async fetchFacts(fetchFn, token, from) {
      const list = await getJson(fetchFn, `https://www.strava.com/api/v3/athlete/activities?after=${Math.floor(from.getTime() / 1000)}&per_page=100`, token);
      return workoutsByDay((Array.isArray(list) ? list : []).map(a => ({ day: String(a.start_date_local || '').slice(0, 10), minutes: Number(a.moving_time) / 60 })), 'strava');
    },
  },
};

export const LINK_SOURCES = Object.keys(PROVIDERS);

/** Включените доставчици (id) — тези с ключове в средата. */
export function enabledProviders(env = {}) {
  return Object.entries(PROVIDERS)
    .filter(([, p]) => env[`${p.env}_CLIENT_ID`] && env[`${p.env}_CLIENT_SECRET`])
    .map(([id]) => id);
}

function credentials(env, provider) {
  const p = PROVIDERS[provider];
  return p ? { id: env[`${p.env}_CLIENT_ID`], secret: env[`${p.env}_CLIENT_SECRET`] } : null;
}

/* ─── PKCE и състоянието на входа ─────────────────────────────────────── */

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(n = 24) {
  return base64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Адресът за вход при доставчика.
 * @returns {Promise<{ url: string, verifier: string|null }>}
 */
export async function authorizeUrl(env, provider, { redirectUri, state }) {
  const p = PROVIDERS[provider];
  const c = credentials(env, provider);
  if (!p || !c?.id) throw new Error('Непознат или неконфигуриран доставчик');
  const params = { response_type: 'code', client_id: c.id, redirect_uri: redirectUri, scope: p.scope, state, ...(p.authorizeExtra || {}) };
  let verifier = null;
  if (p.pkce) {
    verifier = randomToken(48);
    params.code_challenge = await pkceChallenge(verifier);
    params.code_challenge_method = 'S256';
  }
  return { url: `${p.authorizeUrl}?${form(params)}`, verifier };
}

/** Токенът от отговора на доставчика → { access, refresh, expiresAt }. */
function readToken(p, json) {
  const t = p.unwrapToken ? p.unwrapToken(json) : json;
  if (!t?.access_token) return null;
  const expiresAt = t.expires_at ? t.expires_at * 1000 : Date.now() + (Number(t.expires_in) || 3600) * 1000;
  return { access: t.access_token, refresh: t.refresh_token || null, expiresAt };
}

async function tokenRequest(fetchFn, env, provider, body) {
  const p = PROVIDERS[provider];
  const c = credentials(env, provider);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const payload = { ...(p.tokenExtra || {}), ...body, client_id: c.id };
  if (p.basicAuth) headers.Authorization = `Basic ${btoa(`${c.id}:${c.secret}`)}`;
  else payload.client_secret = c.secret;
  const res = await fetchFn(p.tokenUrl, { method: 'POST', headers, body: form(payload) });
  const json = await res.json().catch(() => null);
  const token = res.ok ? readToken(p, json) : null;
  if (!token) throw new Error(`${p.name}: токенът не беше получен (${res.status})`);
  return token;
}

export function exchangeCode(fetchFn, env, provider, { code, redirectUri, verifier }) {
  return tokenRequest(fetchFn, env, provider, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier || undefined });
}

export async function refreshToken(fetchFn, env, provider, link) {
  if (!link?.refresh) throw new Error('Няма токен за подновяване — свържете профила отново');
  const t = await tokenRequest(fetchFn, env, provider, { grant_type: 'refresh_token', refresh_token: link.refresh });
  return { ...link, ...t, refresh: t.refresh || link.refresh };
}

/**
 * Данните от доставчика за последните дни. Токенът се подновява, ако е изтекъл
 * или доставчикът го откаже. Връща и обновения запис на връзката.
 * @returns {Promise<{ facts: object[], link: object }>}
 */
export async function pullFacts(fetchFn, env, provider, link, now = new Date()) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('Непознат доставчик');
  let current = link;
  if (!current.access || (current.expiresAt && current.expiresAt - 60000 < now.getTime())) {
    current = await refreshToken(fetchFn, env, provider, current);
  }
  const to = new Date(now.getTime() - DAY_MS);
  const from = new Date(now.getTime() - LINK_DAYS * DAY_MS);
  let list;
  try {
    list = await p.fetchFacts(fetchFn, current.access, from, to);
  } catch (e) {
    if (e.status !== 401) throw e;
    current = await refreshToken(fetchFn, env, provider, current);
    list = await p.fetchFacts(fetchFn, current.access, from, to);
  }
  return { facts: list, link: current };
}
