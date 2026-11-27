/**
 * Преглед на всеки нов план от Claude преди одобрение (Anthropic API, secret ANTHROPIC_API_KEY).
 *
 * Поток: планът постъпва за одобрение (записът на клиента с planStatus "pending") → в опашката
 * (PLAN_QUEUE, до 15 мин за работа) влиза задача "plan_review" → runPlanReview праща въпросника
 * и плана на Claude Opus 5.5 с указанията по-долу → присъда, забележки и промени с причина.
 * Промените (JSON Patch само в /plan) се прилагат върху копие, сумите се пресмятат наново
 * (reconcilePlanStructure) и прегледът се пази в KV plan_review:<clientId> заедно с „преди“ и
 * „след“ на всяка промяна. Админът вижда прегледа в хъба за одобрение и решава: „Приложи
 * корекциите“ (планът остава pending; старият се пази в прегледа) → „Активирай“.
 *
 * Токени отиват само при нов вариант на план (отбелязване plan_review_fired:<id>). Без задачи по
 * разписание: прегледът тръгва при постъпване на плана; ако задачата не е минала (грешка, 3+ часа),
 * тръгва пак, когато админът отвори плана (handleReviewGet). Без ANTHROPIC_API_KEY не тръгва нищо.
 *
 * Маршрути (под /api/admin/* — централният guard, X-Admin-Secret):
 *   GET  /api/admin/plan-review?clientId=      → прегледът
 *   POST /api/admin/plan-review/apply          { clientId } → коригираният план става текущ (pending)
 */
import Anthropic from '@anthropic-ai/sdk';
import { applyJsonPatches, buildPatchDocument, mergePatchDocument } from './json-patch.js';
import './meal-swaps.js';   // NutriMealSwaps.swapIn — същата размяна като в приложението

/** Модел: прегледът е клинична проверка (алергени, лекарства, заболявания) — най-точният Opus. */
export const REVIEW_MODEL = 'claude-opus-5-5';
/**
 * Нивото на мислене по риска на профила: заболявания, лекарства, бременност/кърмене, дете или
 * възрастен над 70 → high; иначе medium (стандартното за Opus 5.5) — там прегледът е преценка за
 * изпълнимост, а числата и правилата вече са проверени от двигателя.
 */
const EFFORT_RISK = 'high';
const EFFORT_BASE = 'medium';
const MEDICAL_CONDITIONS = new Set(['Диабет / Инсулинова резистентност', 'Автоимунни заболявания', 'Щитовидна жлеза (Хашимото и др.)',
  'Храносмилателни проблеми', 'Сърдечно-съдови заболявания', 'Ендокринни заболявания', 'Метаболитни нарушения',
  'Алергии и хранителна непоносимост', 'Анемия', 'Менопауза', 'След бременност', 'Друго']);
const MAX_FINDINGS = 8;
const MAX_TOKENS = 32000;
/** $ за 1M токена (вход, изход, четене от кеша, запис в кеша) — за дневния таван на AI разхода. */
const PRICE = { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 };

const REFIRE_MS = 3 * 3600 * 1000;     // неразгледан 3 часа след пускането → нов опит
/** Чакащите преглед: { clientId: planUpdatedAt } — резервата чете само него (1 четене, когато е празен). */
const PENDING_KEY = 'plan_review_pending';
const SEVERITIES = new Set(['critical', 'major', 'minor']);
const reviewKey = (id) => `plan_review:${id}`;
const firedKey = (id) => `plan_review_fired:${id}`;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

export const GUIDE = `Преглеждаш хранителен план на Nutriin, преди да стигне до клиента. При "ok" или "fix" планът стига до
клиента веднага (без рисков профил), без друг преглед — затова при всяко съмнение за безопасност: "stop".
Пишеш на екипа, на български: кратко, конкретно, с място (ден, хранене). Не пишеш на клиента.

Главното правило: планът трябва да бъде СПАЗЕН от този човек. План, точен на 80%, но лесен и гъвкав, дава повече
от перфектен по учебник, който човекът изоставя след седмица. Не гониш съвършенство — търсиш само това, което
застрашава здравето или реалното спазване.

Получаваш answers (въпросникът на клиента) и plan. Калориите, макросите, порциите, сумите и клиничните правила
са сметнати и проверени от алгоритъма — не ги преизчисляваш и не ги коментираш, освен при явна опасност.
В weekPlan всяко хранене има: name, description (продуктите с грамовете), recipe, prepTime (минути), calories,
macros и alternatives — равностойните ястия, с които може да се смени (dishId и name). Клиентът сам може да
сменя ястие с алтернатива в приложението — това е гъвкавостта на плана.

Проверявай по ред на важност:
1. Безопасност (critical): алергени и непоносимости в продуктите или рецептата; храни и добавки, противопоказни
   при заболяванията и лекарствата (грейпфрут и статини, витамин K и варфарин, йод при Хашимото без указание,
   много калий при бъбречно заболяване, сол при хипертония, сурови и рискови храни при бременност); дози на
   добавките над горния безопасен праг; храна, която клиентът изрично е казал, че не яде.
2. Изпълнимост за ТОЗИ човек (major) — прочети го целия, не само медицинската част:
   - психология: колко често преяжда (overeatingFrequency), за какво има глад (foodCravings), кое го отключва
     (foodTriggers), компенсации (compensationMethods), сравняване с другите (socialComparison), стрес
     (stressLevel, stressSources). Пример: при силен глад за сладко — планирано сладко вместо пълна забрана; при
     емоционално хранене — редовни хранения без дълги паузи; при компенсации — без усещане за наказание;
   - история: предишни диети и резултатът им (dietHistory, dietType, dietResult) — да не повтаря това, което вече
     не е проработило (прекалено строго, твърде много нови храни);
   - какво обича и без какво не може (dietLove) — да го има в разумна форма; какво не обича (dietDislike);
   - ритъм: сън и хронотип (sleepHours, chronotype), тренировки (sportTypes, sportSessionMinutes), брой хранения
     и пропусната закуска — храненията да пасват на деня му;
   - практичност: време за готвене в делник, твърде много различни продукти за седмицата, трудни за намиране
     или скъпи продукти спрямо бюджета. Повтарящи се основи и готвене за два дни НЕ са грешка, ако улесняват;
   - собствените му думи: additionalNotes и всеки свободен текст.
3. Явни грешки (minor): ястие, което не е за това хранене; несъвместима комбинация; противоречие между текстовете
   и менюто; обещание за лечение.
4. Насоките за движение (plan.personalActivity, до 2 изречения към клиента): да са безопасни при неговите
   заболявания, бременност и възраст и да не предполагат нищо, което го няма в отговорите (куче, кола, транспорт,
   деца, офис, фитнес). Ако не са — op "replace" на /plan/personalActivity с по-добра формулировка: универсален
   навик (ходене след хранене, стълби, ставане от стола, разходка сутрин, упражнения за сила), кратко, на „ти“,
   без термини.

Не пиши забележки за разнообразие, „по-добър“ избор по учебник или дребни числа, ако планът е безопасен и
изпълним. Най-много ${MAX_FINDINGS} забележки, от тях най-много 3 minor. Чист план → verdict "ok" и празни findings —
това е нормален и добър резултат.

Промени (changes) — само когато са нужни и си сигурен, всяка с причина за екипа (reason):
- Хранене се сменя САМО с op "swap": path е храненето (напр. /plan/weekPlan/day3/meals/1), value_json е dishId
  на една от неговите alternatives (като JSON текст, напр. "\\"d_chicken_rice\\""). Друго ястие не измисляш.
- Текст извън weekPlan (strategy, препоръки) — op "replace" с JSON Patch път под /plan и value_json новата
  стойност като JSON текст. Не пипай answers, analysis, сумите и summary.
- Ако никоя алтернатива не решава проблем с безопасността, или проблемът е в целите (analysis) или в цялата
  стратегия — не го поправяй: присъда "stop" и обяснение.

Присъда (verdict): "ok" — може да се одобри; "fix" — с промените е наред; "stop" — нужен е човек.
summary: 2–4 изречения за екипа — първо дали човекът ще може да го спазва и защо. findings: всяка забележка
с severity, where, issue и fix.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'findings', 'changes'],
  properties: {
    verdict: { type: 'string', enum: ['ok', 'fix', 'stop'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'where', 'issue', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          where: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'path', 'value_json', 'reason'],
        properties: {
          op: { type: 'string', enum: ['swap', 'replace', 'add', 'remove'] },
          path: { type: 'string' },
          value_json: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

function isPending(c) {
  return c && c.plan && c.planStatus === 'pending';
}

/** Стойността на JSON Pointer в документа (undefined, ако я няма). */
function valueAt(doc, path) {
  let cur = doc;
  for (const raw of String(path).slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

async function pendingMap(env) {
  try { return JSON.parse((await env.page_content.get(PENDING_KEY)) || '{}') || {}; } catch { return {}; }
}
async function markPending(env, clientId, planUpdatedAt) {
  const m = await pendingMap(env);
  if (m[clientId] === (planUpdatedAt || null)) return;
  m[clientId] = planUpdatedAt || null;
  await env.page_content.put(PENDING_KEY, JSON.stringify(m));
}
/** Махане от чакащите — само ако там е същият вариант (по-новият има свой запис). */
async function clearPending(env, clientId, planUpdatedAt) {
  const m = await pendingMap(env);
  if (!(clientId in m) || (planUpdatedAt !== undefined && m[clientId] !== (planUpdatedAt || null))) return;
  delete m[clientId];
  await env.page_content.put(PENDING_KEY, JSON.stringify(m));
}

/** Пусната ли е вече задачата за този вариант на плана (и не е изтекъл срокът за нов опит). */
async function alreadyFired(env, item, now) {
  const m = JSON.parse((await env.page_content.get(firedKey(item.clientId))) || 'null');
  return Boolean(m && m.planUpdatedAt === item.planUpdatedAt && now - m.at < REFIRE_MS);
}

async function enqueue(env, item, now) {
  await env.PLAN_QUEUE.send({ type: 'plan_review', jobId: `review_${item.clientId}`, clientId: item.clientId, planUpdatedAt: item.planUpdatedAt }, { contentType: 'json' });
  await env.page_content.put(firedKey(item.clientId), JSON.stringify({ planUpdatedAt: item.planUpdatedAt, at: now }), { expirationTtl: 30 * 86400 });
}

/**
 * Планът постъпи за одобрение (записът на клиента) → задачата за преглед влиза в опашката веднага.
 * → 'off' | 'skip' | 'reviewed' | 'same' | 'queued'
 */
export async function reviewOnPending(env, clientId, c, { now = Date.now() } = {}) {
  if (!env?.ANTHROPIC_API_KEY || !env.page_content || !env.PLAN_QUEUE) return 'off';
  if (!clientId || !isPending(c)) return 'skip';
  const item = { clientId, planUpdatedAt: c.planUpdatedAt || null };
  if (await alreadyFired(env, item, now)) return 'same';
  const r = JSON.parse((await env.page_content.get(reviewKey(clientId))) || 'null');
  if (r && r.planUpdatedAt === item.planUpdatedAt) return 'reviewed';
  await markPending(env, clientId, item.planUpdatedAt);
  await enqueue(env, item, now);
  return 'queued';
}

/**
 * Резервата (веднъж дневно): прегледът тръгва от събитието (reviewOnPending); тук само чакащите, за които
 * задачата не е минала (грешка, сменен ключ) или е пусната преди 3 часа без резултат.
 * Чете само списъка на чакащите — без обхождане на клиентите. → 'off' | 'none' | 'same' | 'queued:<n>'
 */
export async function maybeFireReview(env, { now = Date.now() } = {}) {
  if (!env.ANTHROPIC_API_KEY || !env.page_content || !env.PLAN_QUEUE) return 'off';
  const pending = await pendingMap(env);
  const ids = Object.keys(pending);
  if (!ids.length) return 'none';
  let n = 0;
  for (const id of ids.slice(0, 20)) {
    const c = JSON.parse((await env.page_content.get(`client:${id}`)) || 'null');
    const at = c?.planUpdatedAt || null;
    const r = isPending(c) ? JSON.parse((await env.page_content.get(reviewKey(id))) || 'null') : null;
    if (!isPending(c) || (r && r.planUpdatedAt === at)) { await clearPending(env, id); continue; }
    const item = { clientId: id, planUpdatedAt: at };
    if (pending[id] !== at) await markPending(env, id, at);
    if (await alreadyFired(env, item, now)) continue;
    await enqueue(env, item, now);
    n++;
  }
  return n ? `queued:${n}` : (Object.keys(await pendingMap(env)).length ? 'same' : 'none');
}

/** Лични данни, които прегледът не ползва — не излизат към API. */
const PRIVATE_ANSWERS = new Set(['name', 'email', 'phone', 'password', 'photo', 'photos']);
/** Полета на храненето, които прегледът вижда; рецептата по стъпки, ползите и т.н. отпадат. */
const MEAL_FIELDS = ['type', 'name', 'dishId', 'description', 'recipe', 'prepTime', 'weight', 'calories', 'macros', 'dessert'];

function compactMeal(m) {
  if (!m || typeof m !== 'object') return m;
  const out = {};
  for (const k of MEAL_FIELDS) if (m[k] != null && m[k] !== '') out[k] = m[k];
  if (Array.isArray(m.alternatives) && m.alternatives.length) {
    out.alternatives = m.alternatives.filter(Boolean).map((a) => ({ dishId: a.dishId, name: a.name }));
  }
  return out;
}

/**
 * Входът за Claude: въпросникът (без лични данни и празни отговори) и планът, в който храненията са
 * сгъстени — продуктите, рецептата и само имената на алтернативите (пълните им копия са ~2/3 от плана).
 */
export function reviewInput(c) {
  const { _meta, aiVoice, ...plan } = c.plan || {};
  const answers = {};
  for (const [k, v] of Object.entries(c.answers || {})) {
    if (PRIVATE_ANSWERS.has(k) || v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    answers[k] = v;
  }
  if (plan.weekPlan && typeof plan.weekPlan === 'object') {
    const wp = {};
    for (const [day, d] of Object.entries(plan.weekPlan)) {
      wp[day] = d && Array.isArray(d.meals) ? { ...d, meals: d.meals.map(compactMeal) } : d;
    }
    plan.weekPlan = wp;
  }
  return JSON.stringify({ answers, plan });
}

/** Рисков профил → по-високо ниво на мислене. */
export function isRiskyProfile(answers) {
  const a = answers || {};
  const conditions = Array.isArray(a.healthConditions) ? a.healthConditions : [a.healthConditions].filter(Boolean);
  const age = Number(a.age);
  return conditions.some((x) => MEDICAL_CONDITIONS.has(x))
    || a.medications === 'Да'
    || Boolean(a.postpartumStatus && a.postpartumStatus !== 'Не кърмя, но наскоро родих (до 1 година)')
    || (age > 0 && (age < 18 || age >= 70));
}

/** Рисков профил (заболявания, лекарства, бременност/кърмене, под 18 или от 70 г.) — high; иначе medium.
 *  Същият профил не се активира сам: планът чака нутриционист (autoActivation в worker.entry.js). */
export function reviewEffort(answers) {
  return isRiskyProfile(answers) ? EFFORT_RISK : EFFORT_BASE;
}

const MEAL_PATH = /^\/plan\/weekPlan\/(day\d+)\/meals\/(\d+)$/;

/** Промените от модела → JSON Patch (value_json → value). Размените са отделно — прилагат се като в приложението. */
function toPatches(changes) {
  return (Array.isArray(changes) ? changes : []).filter((ch) => ch.op !== 'swap').map((ch) => {
    const p = { op: ch.op, path: String(ch.path || '') };
    if (ch.op !== 'remove') p.value = JSON.parse(ch.value_json);
    return p;
  });
}

/** Сменя храненето с алтернативата му върху копието; → { path, before, after } или грешка. */
function applySwap(copy, ch) {
  const path = String(ch.path || '');
  const m = path.match(MEAL_PATH);
  if (!m) throw new Error(`swap е само за хранене (/plan/weekPlan/dayN/meals/i), не ${path}`);
  let dishId;
  try { dishId = JSON.parse(ch.value_json); } catch { dishId = ch.value_json; }
  const [, day, idx] = m;
  const before = copy.plan?.weekPlan?.[day]?.meals?.[Number(idx)];
  if (!before) throw new Error(`няма хранене ${path}`);
  if (!globalThis.NutriMealSwaps.swapIn(copy.plan, day, Number(idx), String(dishId))) {
    throw new Error(`${dishId} не е сред алтернативите на ${path}`);
  }
  return { path, before: JSON.parse(JSON.stringify(before)), after: copy.plan.weekPlan[day].meals[Number(idx)] };
}

/** Прилага промените върху копие; връща коригирания план и „преди/след“ за всяка промяна. */
async function applyChanges(c, changes, reconcile) {
  const list = Array.isArray(changes) ? changes : [];
  const patches = toPatches(list);
  if (patches.some((p) => !p.path.startsWith('/plan/'))) throw new Error('промените са само под /plan/…');
  if (patches.some((p) => p.path.startsWith('/plan/weekPlan/'))) throw new Error('храненията се сменят само с op "swap" към алтернатива');
  const before = buildPatchDocument(c);
  const copy = JSON.parse(JSON.stringify(c));
  const swaps = list.filter((ch) => ch.op === 'swap').map((ch) => ({ ch, ...applySwap(copy, ch) }));
  if (patches.length) {
    const { document } = applyJsonPatches(buildPatchDocument(copy), patches);
    mergePatchDocument(copy, document);
  }
  if (reconcile && copy.plan?.weekPlan) await reconcile(copy.plan, copy.answers);
  const diff = [
    ...swaps.map(({ ch, path, before: b, after }) => ({ op: 'swap', path, reason: clip(ch.reason, 800), before: b, after })),
    ...list.filter((ch) => ch.op !== 'swap').map((ch, i) => ({
      op: ch.op, path: patches[i].path, reason: clip(ch.reason, 800),
      before: valueAt(before, patches[i].path) ?? null,
      after: ch.op === 'remove' ? null : patches[i].value,
    })),
  ];
  const allPatches = [...swaps.map((x) => ({ op: 'replace', path: x.path, value: x.after })), ...patches];
  return { correctedPlan: copy.plan, patches: allPatches, changes: diff };
}

function costOf(usage) {
  const u = usage || {};
  return ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out
    + (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;
}

/** Едно извикване на Claude; → { message, result|null } */
async function askClaude(client, messages, effort) {
  const message = await client.beta.messages.stream({
    model: REVIEW_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    // При отказ по правилата за безопасност същата заявка минава на резервен модел.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: GUIDE, cache_control: { type: 'ephemeral' } }],
    messages,
  }).finalMessage();
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') return { message, result: null };
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { message, result: JSON.parse(text) };
}

/**
 * Задачата от опашката: прегледът на един план. Записва plan_review:<clientId>.
 * → 'skip' | 'stale' | 'reviewed' | verdict
 * @param {any} env
 * @param {{ clientId: string, planUpdatedAt: string|null }} job
 * @param {{ reconcile?: (plan: any, answers: any) => Promise<any>, addSpend?: (usd: number) => Promise<any>, notify?: (client: any, review: any) => Promise<any>, client?: any, now?: number }} [deps]
 *   client — само за тестовете (иначе Anthropic с ANTHROPIC_API_KEY)
 */
export async function runPlanReview(env, { clientId, planUpdatedAt }, { reconcile, addSpend, notify, client, now = Date.now() } = {}) {
  const c = JSON.parse((await env.page_content.get(`client:${clientId}`)) || 'null');
  if (!isPending(c)) { await clearPending(env, clientId); return 'skip'; }
  if ((c.planUpdatedAt || null) !== (planUpdatedAt || null)) return 'stale';   // новият вариант има своя задача
  const old = JSON.parse((await env.page_content.get(reviewKey(clientId))) || 'null');
  if (old && old.planUpdatedAt === (c.planUpdatedAt || null)) { await clearPending(env, clientId, c.planUpdatedAt); return 'reviewed'; }

  const api = client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages = [{ role: 'user', content: reviewInput(c) }];
  const effort = reviewEffort(c.answers);
  let usd = 0;
  let { message, result } = await askClaude(api, messages, effort);
  usd += costOf(message.usage);

  let applied = null;
  let applyError = '';
  if (result && result.changes?.length) {
    try {
      applied = await applyChanges(c, result.changes, reconcile);
    } catch (e) {
      // Един опит за поправка: моделът вижда грешката и праща промените наново.
      messages.push({ role: 'assistant', content: message.content },
        { role: 'user', content: `Промените не се приложиха: ${e.message}. Поправи пътищата и стойностите и върни целия отговор наново.` });
      ({ message, result } = await askClaude(api, messages, effort));
      usd += costOf(message.usage);
      try {
        if (result && result.changes?.length) applied = await applyChanges(c, result.changes, reconcile);
      } catch (e2) {
        applyError = e2.message;
      }
    }
  }
  if (addSpend) await addSpend(usd);

  const declined = !result;
  const findings = (declined ? [] : result.findings || []).slice(0, MAX_FINDINGS).map((f) => ({
    severity: SEVERITIES.has(f?.severity) ? f.severity : 'minor',
    where: clip(f?.where, 120), issue: clip(f?.issue, 800), fix: clip(f?.fix, 800),
  })).filter((f) => f.issue);
  let verdict = declined ? 'stop' : (['ok', 'fix', 'stop'].includes(result.verdict) ? result.verdict : 'stop');
  if (verdict === 'fix' && !applied) verdict = 'stop';
  const summary = declined
    ? (message.stop_reason === 'refusal' ? 'Прегледът не можа да се направи (моделът отказа). Нужна е ръчна проверка.' : 'Прегледът прекъсна (твърде дълъг отговор). Нужна е ръчна проверка.')
    : clip(result.summary, 2000) + (applyError ? ` Предложените промени не се приложиха (${clip(applyError, 200)}) — описани са в забележките.` : '');

  const review = {
    clientId, planUpdatedAt: c.planUpdatedAt || null, reviewedAt: now, reviewer: 'claude', model: message.model || REVIEW_MODEL, effort,
    verdict, summary, findings,
    changes: applied?.changes || null, patches: applied?.patches || null, correctedPlan: applied?.correctedPlan || null,
    costUsd: Math.round(usd * 10000) / 10000, applied: false,
  };
  await env.page_content.put(reviewKey(clientId), JSON.stringify(review), { expirationTtl: 120 * 86400 });
  await clearPending(env, clientId, c.planUpdatedAt);
  if (notify) await notify(c, review);   // писмото до админа: новият план с прегледа
  return verdict;
}

/** GET /api/admin/plan-review?clientId= */
export async function handleReviewGet(url, env, { respond, now = Date.now() }) {
  const id = url.searchParams.get('clientId') || '';
  const r = JSON.parse((await env.page_content.get(reviewKey(id))) || 'null');
  // Резервата без задача по разписание: админът отваря плана, а преглед за този вариант няма
  // (задачата не е тръгнала или е паднала преди 3+ часа) → пуска се отново, сега.
  let queued = '';
  const c = JSON.parse((await env.page_content.get(`client:${id}`)) || 'null');
  if (id && isPending(c) && (!r || r.planUpdatedAt !== (c.planUpdatedAt || null))) {
    queued = await reviewOnPending(env, id, c, { now }).catch(() => '');
  }
  return respond({ review: r, ...(queued ? { queued } : {}) });
}

/**
 * Коригираният план от прегледа става текущ (остава pending — активира се отделно).
 * → { ok: true, planUpdatedAt } | { ok: false, error, message, status }
 */
export async function applyReviewCorrection(env, clientId, { now = Date.now() } = {}) {
  const r = JSON.parse((await env.page_content.get(reviewKey(clientId))) || 'null');
  if (!r?.correctedPlan) return { ok: false, status: 400, error: 'no_correction', message: 'Няма корекции за прилагане' };
  const c = JSON.parse((await env.page_content.get(`client:${clientId}`)) || 'null');
  if (!isPending(c)) return { ok: false, status: 409, error: 'not_pending', message: 'Планът вече не чака одобрение' };
  if ((c.planUpdatedAt || null) !== r.planUpdatedAt) {
    return { ok: false, status: 409, error: 'stale', message: 'Планът е сменен след прегледа — корекциите не важат за него' };
  }
  const originalPlan = c.plan;
  c.plan = r.correctedPlan;
  c.planUpdatedAt = new Date(now).toISOString();
  await env.page_content.put(`client:${clientId}`, JSON.stringify(c));
  // Прегледът важи за новия вариант (иначе би тръгнал пак); старият план остава в прегледа.
  await env.page_content.put(reviewKey(clientId), JSON.stringify({ ...r, applied: true, appliedAt: now, planUpdatedAt: c.planUpdatedAt, originalPlan }), { expirationTtl: 120 * 86400 });
  return { ok: true, planUpdatedAt: c.planUpdatedAt };
}

/** Отбелязва в прегледа, че планът е активиран без човек (вижда се в хъба за одобрение). */
export async function markAutoActivated(env, clientId, { now = Date.now() } = {}) {
  const r = JSON.parse((await env.page_content.get(reviewKey(clientId))) || 'null');
  if (r) await env.page_content.put(reviewKey(clientId), JSON.stringify({ ...r, autoActivatedAt: now }), { expirationTtl: 120 * 86400 });
}

/** POST /api/admin/plan-review/apply { clientId } — коригираният план става текущ; остава за одобрение. */
export async function handleReviewApply(request, env, { respond, now = Date.now() }) {
  const { clientId } = await request.json().catch(() => ({}));
  const res = await applyReviewCorrection(env, clientId, { now });
  if (!res.ok) return respond({ error: res.error, message: res.message }, res.status);
  return respond({ success: true, planUpdatedAt: res.planUpdatedAt });
}
