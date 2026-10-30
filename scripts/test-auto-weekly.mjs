/**
 * Без да чакаме прегледа: безопасността влиза веднага, пропуснатият преглед се
 * прави автоматично 3 дни след срока — само при нови данни и не повече от два
 * поредни пъти без отговор. Чистите правила + истинският worker.js с подменени
 * KV и опашка (cron и качване на изследване).
 */
import {
  autoWeeklyAction,
  needsSafetyRebuild,
  WEEKLY_OVERDUE_GRACE_MS,
} from '../nutrition-engine/monitoring.js';
import { recalcLevel } from '../enrichment.js';
import { enrichUserDataEngineContext } from '../questionnaire-engine-map.js';
import { buildNutritionPlan } from '../nutrition-engine/index.js';

let pass = 0;
let fail = 0;
const ok = (cond, name) => {
  if (cond) pass++;
  else { fail++; console.log('✗', name); }
};

const DAY = 86400000;
const now = Date.parse('2026-10-25T12:00:00Z');
const base = { hasPlan: true, pending: false, lastReviewMs: now - 12 * DAY, activeMs: now - DAY, autoStreak: 0, dueMs: now - 5 * DAY, now };

// ─── Правилата ───
ok(autoWeeklyAction(base) === 'run', 'просрочен с 5 дни, нови данни — автоматичен преглед');
ok(autoWeeklyAction({ ...base, dueMs: now - 2 * DAY }) === 'wait', 'просрочен с 2 дни — чака клиента');
ok(autoWeeklyAction({ ...base, dueMs: now - WEEKLY_OVERDUE_GRACE_MS }) === 'run', 'точно 3 дни — автоматичен');
ok(autoWeeklyAction({ ...base, activeMs: now - 13 * DAY }) === 'quiet', 'без нови данни след прегледа — нищо (без разход)');
ok(autoWeeklyAction({ ...base, activeMs: now - 40 * DAY, lastReviewMs: now - 50 * DAY }) === 'dormant', 'месец без данни — спящ профил, спира');
ok(autoWeeklyAction({ ...base, autoStreak: 2 }) === 'streak', 'два поредни автоматични без отговор — спира');
ok(autoWeeklyAction({ ...base, pending: true }) === 'pending', 'новата седмица вече чака — нищо');
ok(autoWeeklyAction({ ...base, hasPlan: false }) === 'no-plan', 'без план — нищо');

ok(needsSafetyRebuild({ reasons: [] }, true), 'нови граници от изследвания — веднага');
ok(needsSafetyRebuild({ reasons: ['здравословно състояние'] }, false), 'ново здравословно състояние — веднага');
ok(needsSafetyRebuild({ reasons: ['лекарства (взаимодействия с храни и добавки)'] }, false), 'лекарства с конфликт — веднага');
ok(!needsSafetyRebuild({ reasons: ['ниво на активност', 'сън'] }, false), 'активност и сън — на прегледа');
// Причините идват от recalcLevel — същите думи, иначе правилото не би се хванало никога.
const lvl = recalcLevel({ gender: 'Жена', goal: 'Отслабване' }, { gender: 'Жена', goal: 'Отслабване', medicalConditions: ['Диабет тип 2'] });
ok(needsSafetyRebuild(lvl, false), 'recalcLevel дава думата, по която се хваща правилото');

// ─── Истинският worker: cron и качване на изследване ───
function memoryKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (!v) return null;
      return type === 'json' ? JSON.parse(v.value) : v.value;
    },
    async getWithMetadata(key) { const v = store.get(key); return { value: v?.value ?? null, metadata: v?.metadata ?? null }; },
    async put(key, value, opts = {}) { store.set(key, { value: String(value), metadata: opts.metadata || null }); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...store.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, v]) => ({ name, metadata: v.metadata }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

const worker = (await import('../worker.js')).default;
const sent = [];
const kv = memoryKV();
const env = { page_content: kv, PLAN_QUEUE: { send: async (m) => { sent.push(m); } } };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const put = (k, v, metadata) => kv.put(k, JSON.stringify(v), { metadata });
const iso = (ms) => new Date(ms).toISOString();
const realNow = Date.now();

await put('user_profile:u_run', { userId: 'u_run', plan: { weekPlan: { day1: {} } }, planUpdatedAt: iso(realNow - 12 * DAY), userData: {} });
await put('game_state:u_run', { gameData: { [iso(realNow - DAY).slice(0, 10)]: { meals: {} }, '2020-01-01': { meals: {} } }, updatedAt: iso(realNow - DAY) });
await kv.put('weekly_due:u_run', '1', { metadata: { due: realNow - 5 * DAY } });

await put('user_profile:u_quiet', { userId: 'u_quiet', plan: { weekPlan: { day1: {} } }, planUpdatedAt: iso(realNow - 12 * DAY), userData: {} });
await put('game_state:u_quiet', { gameData: {}, updatedAt: iso(realNow - 13 * DAY) });
await kv.put('weekly_due:u_quiet', '1', { metadata: { due: realNow - 5 * DAY } });

await put('user_profile:u_wait', { userId: 'u_wait', plan: { weekPlan: { day1: {} } }, planUpdatedAt: iso(realNow - 8 * DAY), userData: {} });
await kv.put('weekly_due:u_wait', '1', { metadata: { due: realNow - DAY } });

const quiet = (fn) => async (...a) => { const l = console.log; const w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(...a); } finally { console.log = l; console.warn = w; } };
await quiet(async () => { await worker.scheduled({}, env, ctx); await Promise.allSettled(waits); })();

const weekly = sent.filter(m => m.type === 'weekly_adapt');
ok(weekly.length === 1 && weekly[0].payload.userId === 'u_run' && weekly[0].payload.auto === true, 'cron: само просроченият с нови данни отива в опашката, като автоматичен');
ok(weekly[0] && !('2020-01-01' in weekly[0].payload.gameData), 'cron: в опашката — само последните 3 седмици отметки');
ok((kv.store.get('weekly_due:u_run')?.metadata?.due || 0) > realNow, 'cron: срокът е преместен — не се пуска втори път');
ok((kv.store.get('weekly_due:u_quiet')?.metadata?.due || 0) > realNow, 'cron: без нови данни — само нов срок, без AI');
ok((kv.store.get('weekly_due:u_wait')?.metadata?.due || 0) < realNow, 'cron: просрочен с 1 ден — не се пипа');

sent.length = 0;
await put('user_profile:u_lab', { userId: 'u_lab', plan: { weekPlan: { day1: {} } }, planUpdatedAt: iso(realNow - 3 * DAY), userData: { gender: 'Жена', age: 50, height: 165, weight: 70, goal: 'Отслабване' } });
const labReq = new Request('https://x/api/enrichment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: 'u_lab', facts: [{ kind: 'biomarker', key: 'egfr', value: 40, unit: 'mL/min', at: iso(realNow), source: 'lab' }] }),
});
const labRes = await quiet(() => worker.fetch(labReq, env, ctx))();
const labJson = await labRes.json();
ok(labJson.urgent === true, 'изследване с ниска бъбречна функция — граница за безопасност');
ok(sent.some(m => m.type === 'safety_rebuild' && m.payload.userId === 'u_lab') && labJson.appliesAt === 'now', 'безопасността — веднага в опашката, не на прегледа');

sent.length = 0;
const stepsReq = new Request('https://x/api/enrichment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: 'u_lab', facts: [{ kind: 'steps', key: 'steps', value: 9000, unit: '', at: iso(realNow - DAY), source: 'phone' }] }),
});
await quiet(() => worker.fetch(stepsReq, env, ctx))();
ok(!sent.some(m => m.type === 'safety_rebuild'), 'крачки — без ново сглобяване (влизат на прегледа)');

// Клиент отпреди: срокът се засява при първата синхронизация от приложението.
await put('user_profile:u_old', { userId: 'u_old', plan: { weekPlan: { day1: {} } }, planUpdatedAt: iso(realNow - 20 * DAY), userData: {} });
const syncReq = new Request('https://x/api/user/sync-analytics', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: 'u_old', gameData: { [iso(realNow - DAY).slice(0, 10)]: { meals: { 'Хранене 1': true }, mealSlots: ['Хранене 1'] } } }),
});
await quiet(() => worker.fetch(syncReq, env, ctx))();
ok(kv.store.get('weekly_due:u_old')?.metadata?.due === Date.parse(iso(realNow - 20 * DAY)) + 7 * DAY, 'стар клиент: срокът е засят от датата на плана');

// Ръчният преглед: планът (~200 KB) не се побира в съобщение на опашката (до 128 KB).
// Преди — send гърмеше, сървърът връщаше 500 и клиентът виждаше „Не успяхме“.
const QUEUE_MAX_BYTES = 128 * 1024;
const strictQueue = [];
const strictEnv = { page_content: kv, PLAN_QUEUE: { send: async (m) => {
  if (Buffer.byteLength(JSON.stringify(m)) > QUEUE_MAX_BYTES) throw new Error('Queue message too large');
  strictQueue.push(m);
} } };
const qData = { gender: 'Жена', age: '35', height: '165', weight: '78', goal: 'Отслабване', lossKg: '8', sleepHours: '7–8', stressLevel: 'Умерено', sportActivity: 'Умерена', eatingHabits: ['Храня се редовно'], foodCravings: [], medicalConditions: ['Нямам'], medications: 'Не', dietPreference: [] };
enrichUserDataEngineContext(qData);
const bigPlan = { weekPlan: buildNutritionPlan(qData, { kcal: 1700, seed: 'weekly' }).weekPlan };
ok(Buffer.byteLength(JSON.stringify(bigPlan)) > QUEUE_MAX_BYTES, 'реален план — по-голям от съобщение в опашката');
const adaptGame = {};
for (let i = 1; i <= 6; i++) adaptGame[iso(realNow - i * DAY).slice(0, 10)] = { meals: { 'Хранене 1': true } };
const adaptReq = new Request('https://x/api/weekly/adapt-plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: 'u_adapt', gameData: adaptGame, gameWeeklyAI: { cycleNumber: 1 }, plan: bigPlan, userData: qData,
    questions: [{ id: 'energy' }], answers: [{ questionId: 'energy', value: 'Добра' }] }),
});
const adaptRes = await quiet(() => worker.fetch(adaptReq, strictEnv, ctx))();
const adaptJson = await adaptRes.json();
ok(adaptRes.status === 200 && adaptJson.submitted === true, `ръчен преглед с реален план — приет (${adaptRes.status} ${adaptJson.error || ''})`);
const adaptMsg = strictQueue.find(m => m.type === 'weekly_adapt');
const stored = adaptMsg?.payloadKey && JSON.parse(kv.store.get(adaptMsg.payloadKey)?.value || 'null');
ok(stored?.plan?.weekPlan && stored.answers?.length === 1, 'товарът с плана чака в KV, в опашката е само ключът');

// Изтекъл товар: задачата се маркира неуспешна, съобщението не се върти в опашката.
let acked = false;
await quiet(() => worker.queue({ messages: [{ body: { jobId: 'gone', type: 'weekly_adapt', payloadKey: 'weekly_payload:gone' }, ack: () => { acked = true; }, retry: () => {} }] }, strictEnv))();
ok(acked && JSON.parse(kv.store.get('plan_job:gone')?.value || '{}').status === 'failed', 'липсващ товар — неуспех, без безкрайни повторения');

console.log(`\n=== auto weekly: ${pass} pass, ${fail} fail ===`);
if (fail) process.exit(1);
