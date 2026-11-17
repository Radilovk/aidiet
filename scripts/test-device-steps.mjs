#!/usr/bin/env node
/**
 * Крачките от устройства (health-sync.js) по сценарии: гривна с офлайн синхронизация, само телефон,
 * няколко източника, смяна на часа, различни часови зони (в т.ч. с половин час). Без мрежа.
 * Инвариант: общият брой се запазва, нищо не се стоварва в един ден, днешният ден не излиза.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ZONES = ['Europe/Sofia', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland', 'UTC'];
const self = fileURLToPath(import.meta.url);

if (!process.env.STEPS_TZ_CHILD) {
  let bad = 0;
  for (const tz of ZONES) {
    const r = spawnSync(process.execPath, [self], { env: { ...process.env, TZ: tz, STEPS_TZ_CHILD: '1' }, encoding: 'utf8' });
    process.stdout.write(r.stdout);
    if (r.status !== 0) { bad++; process.stderr.write(r.stderr); }
  }
  process.exit(bad ? 1 : 0);
}

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✗ [${process.env.TZ}] ${m}`); } };

const store = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.document = { addEventListener() {}, visibilityState: 'hidden' };

const DAY = 86400000, HOUR = 3600000;
const pad = n => String(n).padStart(2, '0');
const key = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const midnight = (back) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime(); };

/** Сървърът на Health Connect: брои от минутна истина по часови кофи (като aggregateGroupByDuration). */
function makeHealth({ minutes, records }) {
  return {
    queryAggregated: async ({ startDate, endDate }) => {
      const s = Date.parse(startDate), e = Date.parse(endDate), out = [];
      for (let t = s; t < e; t += HOUR) {
        let v = 0;
        for (const [m, n] of minutes) if (m >= t && m < Math.min(t + HOUR, e)) v += n;
        if (v > 0) out.push({ startDate: new Date(t).toISOString(), endDate: new Date(t + HOUR).toISOString(), value: v });
      }
      return { samples: out };
    },
    readSamples: async ({ dataType, startDate, endDate }) => ({
      samples: dataType === 'steps' ? records.filter(r => Date.parse(r.startDate) >= Date.parse(startDate) && Date.parse(r.startDate) < Date.parse(endDate)) : []
    })
  };
}
function load(health, state) {
  for (const k of Object.keys(store)) delete store[k];
  if (state) store.np_health_state = JSON.stringify(state);
  globalThis.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { Health: health } };
  delete globalThis.NutriPlanHealth;
  delete require.cache[require.resolve('../health-sync.js')];
  require('../health-sync.js');
  return globalThis.NutriPlanHealth;
}
const stepsByDay = async (H) => {
  const out = await H._collectFacts(null);
  const m = {};
  out.facts.filter(f => f.kind === 'steps').forEach(f => { m[String(f.at).slice(0, 10)] = f.value; });
  return { m, errors: out.errors.filter(e => /^steps/.test(e)) };
};

// ── 1. Само телефон (Samsung/Pixel/Xiaomi/Huawei без гривна): равномерно през 7 дни ──
{
  const minutes = [];
  const truth = {};
  for (let b = 1; b <= 7; b++) for (let h = 8; h < 22; h++) {
    const t = midnight(b) + h * HOUR + 10 * 60000; // ходене през деня
    const n = 300 + b * 20; minutes.push([t, n]); truth[key(t)] = (truth[key(t)] || 0) + n;
  }
  const H = load(makeHealth({ minutes, records: [] }), { connected: true });
  const { m, errors } = await stepsByDay(H);
  ok(errors.length === 0, 'без грешки');
  for (const k of Object.keys(truth)) ok(m[k] === truth[k], `телефон: ${k} = ${truth[k]}, получено ${m[k]}`);
  ok(Object.keys(m).length === 7, 'точно 7 дни');
  ok(!m[key(Date.now())], 'днешният ден не се изпраща (непълен)');
}

// ── 2. Гривна: синхронизация след нощта — запис през полунощ и запис през няколко дни ──
{
  const pkg = 'com.mi.health';
  const D3 = midnight(3), D2 = midnight(2), D1 = midnight(1);
  const records = [
    { sourceId: pkg, startDate: new Date(D3 + 18 * HOUR).toISOString(), endDate: new Date(D2 + 12 * HOUR).toISOString(), value: 1800 }, // 18 ч → 12 ч
    { sourceId: pkg, startDate: new Date(D2 + 12 * HOUR).toISOString(), endDate: new Date(D2 + 18 * HOUR).toISOString(), value: 2000 },
    { sourceId: pkg, startDate: new Date(D1 + 9 * HOUR).toISOString(), endDate: new Date(D1 + 10 * HOUR).toISOString(), value: 4000 }
  ];
  const H = load(makeHealth({ minutes: [], records }), { connected: true, source: pkg });
  const { m } = await stepsByDay(H);
  const sum = Object.values(m).reduce((a, b) => a + b, 0);
  ok(sum === 7800 || Math.abs(sum - 7800) <= 3, `гривна: общият брой се пази (${sum})`);
  ok(Math.abs((m[key(D3)] || 0) - 600) <= 2, `гривна: 6 от 18 часа в първия ден → ~600, получено ${m[key(D3)]}`);
  ok(Math.abs((m[key(D2)] || 0) - 3200) <= 2, `гривна: втори ден 1200 + 2000 = 3200, получено ${m[key(D2)]}`);
  ok(m[key(D1)] === 4000, 'гривна: ден 1 = 4000');
  ok(Math.max(...Object.values(m)) < 7800, 'нищо не е стоварено в един ден');
}

// ── 3. Гривна, но с пропуснат ден (не е носена) → денят идва от сбора на телефона ──
{
  const pkg = 'com.fitbit.FitbitMobile';
  const D2 = midnight(2), D1 = midnight(1);
  const minutes = [[D2 + 13 * HOUR + 60000, 5000]];
  const records = [{ sourceId: pkg, startDate: new Date(D1 + 8 * HOUR).toISOString(), endDate: new Date(D1 + 9 * HOUR).toISOString(), value: 6000 }];
  const H = load(makeHealth({ minutes, records }), { connected: true, source: pkg });
  const { m } = await stepsByDay(H);
  ok(m[key(D1)] === 6000, 'гривна: денят с носена гривна е от нея');
  ok(m[key(D2)] === 5000, 'гривна: денят без гривна е от сбора на телефона');
}

// ── 4. Ръчно отговорен ден не взема крачки от устройство ──
{
  const D1 = midnight(1);
  const H = load(makeHealth({ minutes: [[D1 + 10 * HOUR, 9000]], records: [] }), { connected: true });
  globalThis.NutriPlanActivity = { answeredDays: () => ({ [key(D1)]: true }) };
  const { m } = await stepsByDay(H);
  ok(!m[key(D1)], 'отговорен ден: без крачки от устройство');
  delete globalThis.NutriPlanActivity;
}

// ── 5. Без никакви данни → без факти и без грешка ──
{
  const H = load(makeHealth({ minutes: [], records: [] }), { connected: true });
  const { m, errors } = await stepsByDay(H);
  ok(Object.keys(m).length === 0 && errors.length === 0, 'празно: без факти, без грешки');
}

// ── 6. Часовите кофи не се чупят при смяна на часа: крачки около полунощ ──
{
  const D = midnight(5);
  const minutes = [[D + 5 * 60000, 111], [D - 5 * 60000, 222], [D + DAY - 5 * 60000, 333]]; // 00:05, 23:55 предния, 23:55 същия
  const H = load(makeHealth({ minutes, records: [] }), { connected: true });
  const { m } = await stepsByDay(H);
  ok(m[key(D)] === 111 + 333, `полунощ: ${key(D)} = 444, получено ${m[key(D)]}`);
  ok(m[key(D - DAY)] === 222, `полунощ: предният ден = 222, получено ${m[key(D - DAY)]}`);
}

console.log(`  ${process.env.TZ}: ${pass} ok, ${fail} грешки`);
process.exit(fail ? 1 : 0);
