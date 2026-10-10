#!/usr/bin/env node
/**
 * Клиент и сървър смятат статистиката по едни и същи формули:
 * game-scoring.js (телефонът) срещу analytics-compression.js (сървърът).
 * Пуска се със софийска часова зона, както е при клиентите.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import { buildAnalyticsSummary } from '../analytics-compression.js';

process.env.TZ = 'Europe/Sofia';
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(new URL('../game-scoring.js', import.meta.url), 'utf8'), sandbox);
const GS = sandbox.window.GameScoring;

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('✗', msg); } };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SLOTS = ['Хранене 1', 'Хранене 2', 'Хранене 3', 'Хранене 4', 'Хранене 5'];
function randomData(seed) {
  const r = rng(seed);
  const data = {};
  for (let i = 0; i < 7; i++) {
    if (r() < 0.2) continue;
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = GS.dateKey(d);
    const meals = {};
    const mealCalories = {};
    SLOTS.forEach((s) => { meals[s] = r() < 0.7; mealCalories[s] = 300 + Math.round(r() * 300); });
    const rec = { meals, mealCalories, plannedCalories: 1800 + Math.round(r() * 600), mealSlots: SLOTS, extraMeals: [] };
    if (r() < 0.6) rec.morningCheck = { sleptWell: r() < 0.6 };
    if (r() < 0.6) rec.eveningCheck = { activityLevel: 1 + Math.floor(r() * 3), emotionalBalance: 1 + Math.floor(r() * 3), waterIntake: r() < 0.5 };
    if (r() < 0.3) rec.extraMeals.push({ calories: Math.round(r() * 400), isJunk: r() < 0.5 });
    if (r() < 0.15) rec.freeMeal = { mealKey: 'Хранене 2', calories: 900 };
    data[key] = rec;
  }
  return data;
}

for (let seed = 1; seed <= 300; seed++) {
  const data = randomData(seed);
  const client = GS.weekSummary(data);
  const server = buildAnalyticsSummary(data, {});
  if (server.status === 'empty') { ok(client.daysRecorded === 0, `#${seed} празна седмица`); continue; }
  const same = (k, a, b) => ok(JSON.stringify(a) === JSON.stringify(b), `#${seed} ${k}: телефон ${JSON.stringify(a)} ≠ сървър ${JSON.stringify(b)}`);
  same('дни', client.daysRecorded, server.daysRecorded);
  same('средна оценка', client.avgScore, server.avgScore);
  same('ангажираност', client.engagementPct, server.adherence);
  same('спазени хранения', client.mealAdherence, server.mealAdherence);
  same('калории', client.calAdherence, server.calAdherence);
  same('нетен баланс', client.netCalBalance, server.netCalBalance);
  same('вредни', client.junk7, server.junk7);
  same('тренд', client.trend, server.trend);
  same('серия', client.streak, server.streak);
  same('индекс на здравето', client.healthIndex, server.healthIndex);
  same('измерения', client.dimensions, server.dimensions);
}

console.log(`\n=== analytics parity: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
