/**
 * Free hours of a studio, from its settings alone (pure: no I/O), in the studio's own time zone.
 *   slotsForMonth(settings, '2026-10', taken, now) → { '2026-10-20': ['08:00', '08:30', …], … }
 * taken: [{ start, end }] in ms — the studio's bookings and its Google Calendar's busy times. A booking keeps the
 * studio's buffer free before and after it.
 */
import { DAYS } from './settings.js';

const offsetFmt = new Map();
/** the zone's offset from UTC at that instant, in minutes (+180 for Sofia in summer) */
export function tzOffset(tz, ms) {
  let f = offsetFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    offsetFmt.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** 'YYYY-MM-DD' + 'HH:MM' on the studio's clock → ms */
export function zonedMs(ymd, time, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let ms = wall - tzOffset(tz, wall) * 60000;
  ms = wall - tzOffset(tz, ms) * 60000;   // again: the offset on the far side of a clock change
  return ms;
}

/** ms → { ymd, hm } on the studio's clock */
export function zonedParts(ms, tz) {
  const t = new Date(ms + tzOffset(tz, ms) * 60000).toISOString();
  return { ymd: t.slice(0, 10), hm: t.slice(11, 16) };
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHm = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** the hours a day's schedule offers ('HH:MM' starts), before anything is taken */
export function dayStarts(st, ymd) {
  if (st.closed.includes(ymd)) return [];
  const [y, m, d] = ymd.split('-').map(Number);
  const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const step = st.slot.step || st.slot.minutes + st.slot.buffer;
  const out = [];
  for (const [open, close] of st.hours[day] || []) {
    for (let t = toMin(open); t + st.slot.minutes <= toMin(close); t += step) out.push(toHm(t));
  }
  return out;
}

/** is [start, start + minutes) free of everything taken (with the buffer around it)? */
export function isFree(st, start, taken) {
  const end = start + st.slot.minutes * 60000;
  const pad = st.slot.buffer * 60000;
  return !taken.some((x) => x.start < end + pad && x.end + pad > start);
}

/** may a client book this start now (notice, how far ahead)? */
export function inWindow(st, start, now) {
  return start >= now + st.rules.minNoticeMin * 60000 && start <= now + st.rules.daysAhead * 864e5;
}

export function slotsForMonth(st, ym, taken, now = Date.now()) {
  const [y, m] = ym.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out = {};
  for (let d = 1; d <= daysIn; d++) {
    const ymd = `${ym}-${String(d).padStart(2, '0')}`;
    const free = dayStarts(st, ymd).filter((t) => {
      const start = zonedMs(ymd, t, st.timezone);
      return inWindow(st, start, now) && isFree(st, start, taken);
    });
    if (free.length) out[ymd] = free;
  }
  return out;
}

/** is this exact start one the studio offers (its schedule, on that day)? */
export function isOfferedStart(st, start) {
  const { ymd, hm } = zonedParts(start, st.timezone);
  return dayStarts(st, ymd).includes(hm) && zonedMs(ymd, hm, st.timezone) === start;
}
