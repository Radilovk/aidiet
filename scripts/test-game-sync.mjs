#!/usr/bin/env node
/**
 * Отметките по дни между устройствата (game-data-merge.js + /api/user/sync-analytics):
 * уебът и приложението виждат едни и същи дни; по-бедното устройство не
 * презаписва по-богатото.
 */
import { mergeDay, mergeGameData } from '../game-data-merge.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

const NOW = new Date('2026-10-22T10:00:00Z');
const day = (meals, extra = {}) => ({ meals, mealCalories: {}, extraMeals: [], morningCheck: null, eveningCheck: null, ...extra });

// Изядено на едното устройство е изядено.
let m = mergeDay(day({ a: true, b: false }), day({ a: false, b: true }));
ok(m.meals.a === true && m.meals.b === true, 'хранене: ИЛИ между устройствата');

// Сутрешен отговор: истинският пред празния, по-новият пред по-стария.
m = mergeDay(day({}, { morningCheck: { sleptWell: false, ts: '2026-10-21T07:00:00Z' } }), day({}, { morningCheck: { sleptWell: true, ts: '2026-10-21T08:00:00Z' } }));
ok(m.morningCheck.sleptWell === true, 'сутрешен: по-новият');
m = mergeDay(day({}, { morningCheck: { sleptWell: true, ts: '2026-10-21T07:00:00Z' } }), day({}, { morningCheck: null }));
ok(m.morningCheck.sleptWell === true, 'сутрешен: истинският пред празния');

// Вечерен — поле по поле.
m = mergeDay(day({}, { eveningCheck: { activityLevel: 2, emotionalBalance: null, waterIntake: null, ts: '2026-10-21T20:00:00Z' } }),
  day({}, { eveningCheck: { activityLevel: null, emotionalBalance: 3, waterIntake: true, ts: '2026-10-21T20:05:00Z' } }));
ok(m.eveningCheck.activityLevel === 2 && m.eveningCheck.emotionalBalance === 3 && m.eveningCheck.waterIntake === true, 'вечерен: полетата от двете');

// Допълнителните хранения — обединени без дубли.
const e1 = { name: 'бисквити', calories: 200, ts: '2026-10-21T21:00:00Z' };
m = mergeDay(day({}, { extraMeals: [e1] }), day({}, { extraMeals: [e1, { name: 'ябълка', calories: 80, ts: '2026-10-21T16:00:00Z' }] }));
ok(m.extraMeals.length === 2, 'допълнителни: обединени, без дубли');

// Пропуснато, но после изядено на другото устройство — не е пропуснато.
m = mergeDay(day({ a: false }, { mealSkipped: { a: true } }), day({ a: true }));
ok(m.meals.a === true && !m.mealSkipped, 'изядено отменя „пропуснах“');

// Структурата на деня — от записа с повече отговори.
m = mergeDay(day({ a: true, b: true }, { mealSlots: ['a', 'b'], plannedCalories: 1800 }), day({ a: false }, { mealSlots: ['a'], plannedCalories: 1500 }));
ok(m.plannedCalories === 1800 && m.mealSlots.length === 2, 'структурата — от по-пълния запис');

// Цели набори: уеб 4 дни, приложение 1 ден → 4 дни, нищо загубено.
const web = { '2026-10-18': day({ a: true }), '2026-10-19': day({ a: true }), '2026-10-20': day({ a: true }), '2026-10-21': day({ a: true, b: false }) };
const app = { '2026-10-21': day({ a: false, b: true }) };
const both = mergeGameData(web, app, NOW);
ok(Object.keys(both).length === 4 && both['2026-10-21'].meals.a && both['2026-10-21'].meals.b, 'уеб + приложение — всички дни, денят слят');
ok(Object.keys(mergeGameData({ '2025-01-01': day({ a: true }), bad: {} }, {}, NOW)).length === 0, 'стари дни и грешни ключове отпадат');

// Сървърът: две синхронизации от различни устройства.
const store = new Map();
const kv = { async get(k, t) { const v = store.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { store.set(k, typeof v === 'string' ? v : JSON.stringify(v)); }, async delete(k) { store.delete(k); }, async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } };
const worker = (await import('../worker.entry.js')).default;
const env = { page_content: kv };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const post = async body => (await worker.fetch(new Request('https://x/api/user/sync-analytics', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.9.' + Math.floor(Math.random() * 200) }, body: JSON.stringify(body) }), env, ctx)).json();
const today = new Date().toISOString().slice(0, 10);
const recent = (k) => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
const webData = { [recent(3)]: day({ a: true }), [recent(2)]: day({ a: true }), [recent(1)]: day({ a: true }) };
let r = await post({ userId: 'u_sync', gameData: webData, gameWeeklyAI: { cycle: 2 } });
ok(Object.keys(r.gameData).length === 3, 'сървър: уебът качва 3 дни');
r = await post({ userId: 'u_sync', gameData: {}, gameWeeklyAI: {} });
ok(Object.keys(r.gameData).length === 3 && r.gameWeeklyAI.cycle === 2, 'сървър: празно приложение получава 3-те дни и седмичния цикъл');
r = await post({ userId: 'u_sync', gameData: { [today]: day({ b: true }) } });
ok(Object.keys(r.gameData).length === 4, 'сървър: денят от приложението се добавя, уеб дните остават');
const writes = store.get('game_state:u_sync');
await post({ userId: 'u_sync', gameData: {} });
ok(store.get('game_state:u_sync') === writes, 'сървър: без промяна — без запис');

console.log(`\n=== game sync: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
