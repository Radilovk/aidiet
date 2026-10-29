/**
 * A studio's settings (studios.settings JSON): what its admin page sets. Unknown keys are dropped and every value is
 * brought into range, so the rest of the platform can trust them.
 */

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const DEFAULT_SETTINGS = {
  brand: { name: 'Студио', tagline: '', color: '#d32f2f', logo: 0 },   // logo: its version (0 = none)
  address: '',
  phone: '',
  mapUrl: '',
  texts: { hero: '', message: '', terms: '' },
  price: 0,
  currency: 'EUR',
  timezone: 'Europe/Sofia',
  slot: { minutes: 30, buffer: 0, step: 0 },   // step 0: minutes + buffer
  hours: { mon: [['08:00', '20:00']], tue: [['08:00', '20:00']], wed: [['08:00', '20:00']],
    thu: [['08:00', '20:00']], fri: [['08:00', '20:00']], sat: [], sun: [] },
  closed: [],                                   // 'YYYY-MM-DD' days off
  rules: { minNoticeMin: 120, daysAhead: 30, maxPerDay: 1, maxUpcoming: 8, freeCancelHours: 24, reminderHours: 4 },   // reminderHours: the phone's own reminder before the hour (0 = none)
  guarantee: 'card_or_code',                    // card | card_or_code | none (a card needs the studio's Stripe)
  google: { calendarId: '' },
  viber: false,                                 // Viber messages (only with a PC running viber-sender/); the app's own reminders need nothing
  listed: true,                                 // shown in the app's list of studios
  notice: { id: 0, text: '', until: 0 },        // a message from the studio to its clients (shown in the app; id changes = a new one)
};

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const int = (v, min, max, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const hm = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : '');

/** settings as stored → the full, checked settings (missing parts from the defaults) */
export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  const b = s.brand || {};
  const t = s.texts || {};
  const sl = s.slot || {};
  const r = s.rules || {};
  const hours = {};
  for (const day of DAYS) {
    const list = Array.isArray(s.hours && s.hours[day]) ? s.hours[day] : (s.hours ? [] : d.hours[day]);
    hours[day] = list.map((p) => [hm(p && p[0]), hm(p && p[1])]).filter((p) => p[0] && p[1] && p[0] < p[1]).slice(0, 4);
  }
  let tz = str(s.timezone, 64) || d.timezone;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (_) { tz = d.timezone; }
  return {
    brand: {
      name: str(b.name, 80) || d.brand.name,
      tagline: str(b.tagline, 160),
      color: /^#[0-9a-fA-F]{6}$/.test(String(b.color)) ? String(b.color) : d.brand.color,
      logo: int(b.logo, 0, 1e9, 0),
    },
    address: str(s.address, 200),
    phone: str(s.phone, 40),
    mapUrl: /^https:\/\//.test(String(s.mapUrl || '')) ? str(s.mapUrl, 500) : '',
    texts: { hero: str(t.hero, 600), message: str(t.message, 1200), terms: str(t.terms, 8000) },
    price: Math.max(0, Math.round(Number(s.price) * 100) / 100 || 0),
    currency: /^[A-Z]{3}$/.test(String(s.currency)) ? String(s.currency) : d.currency,
    timezone: tz,
    slot: {
      minutes: int(sl.minutes, 10, 240, d.slot.minutes),
      buffer: int(sl.buffer, 0, 120, 0),
      step: int(sl.step, 0, 240, 0),
    },
    hours,
    closed: (Array.isArray(s.closed) ? s.closed : []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x))).slice(0, 400),
    rules: {
      minNoticeMin: int(r.minNoticeMin, 0, 7 * 1440, d.rules.minNoticeMin),
      daysAhead: int(r.daysAhead, 1, 365, d.rules.daysAhead),
      maxPerDay: int(r.maxPerDay, 1, 20, d.rules.maxPerDay),
      maxUpcoming: int(r.maxUpcoming, 1, 100, d.rules.maxUpcoming),
      freeCancelHours: int(r.freeCancelHours, 0, 168, d.rules.freeCancelHours),
      reminderHours: int(r.reminderHours, 0, 48, d.rules.reminderHours),
    },
    guarantee: ['card', 'card_or_code', 'none'].includes(s.guarantee) ? s.guarantee : d.guarantee,
    google: { calendarId: str(s.google && s.google.calendarId, 200) },
    viber: s.viber === true,
    listed: s.listed !== false,
    notice: {
      id: int(s.notice && s.notice.id, 0, 4e9, 0),
      text: str(s.notice && s.notice.text, 300),
      until: int(s.notice && s.notice.until, 0, 4e12, 0),
    },
  };
}

/** what the client's app may see (no calendar id) */
export function publicSettings(st, version, hasStripe, now = Date.now()) {
  const { google, notice, ...rest } = st;
  const live = notice.text && (!notice.until || notice.until > now);   // an ended message is not sent
  return { ...rest, version, card: hasStripe && st.guarantee !== 'none', calendar: Boolean(google.calendarId), notice: live ? notice : null };
}
