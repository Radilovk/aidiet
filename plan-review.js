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
 * Токени отиват само при нов вариант на план (отбелязване plan_review_fired:<id>). Таймерът на
 * worker-а (на 15 мин, без AI) е резервата: неразгледан план, за който задачата не е пусната
 * или не е минала за 3 часа, влиза наново в опашката. Без ANTHROPIC_API_KEY не тръгва нищо.
 *
 * Маршрути (под /api/admin/* — централният guard, X-Admin-Secret):
 *   GET  /api/admin/plan-review?clientId=      → прегледът
 *   POST /api/admin/plan-review/apply          { clientId } → коригираният план става текущ (pending)
 */
import Anthropic from '@anthropic-ai/sdk';
import { applyJsonPatches, buildPatchDocument, mergePatchDocument } from './json-patch.js';

/** Модел: прегледът е клинична проверка (алергени, лекарства, заболявания) — най-точният Opus. */
export const REVIEW_MODEL = 'claude-opus-5-5';
const REVIEW_EFFORT = 'high';
const MAX_TOKENS = 32000;
/** $ за 1M токена (вход, изход, четене от кеша, запис в кеша) — за дневния таван на AI разхода. */
const PRICE = { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 };

const CRON_SCAN = 60;                  // таймерът гледа само последните клиенти (новите планове са там)
const REFIRE_MS = 3 * 3600 * 1000;     // неразгледан 3 часа след пускането → нов опит
export const REVIEW_CRON = '*/15 * * * *';
const SEVERITIES = new Set(['critical', 'major', 'minor']);
const reviewKey = (id) => `plan_review:${id}`;
const firedKey = (id) => `plan_review_fired:${id}`;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

export const GUIDE = `Преглеждаш хранителен план на Eatologix, преди да стигне до клиента. Екипът го одобрява след теб.
Пишеш на екипа, на български: кратко, конкретно, с място (ден, хранене). Не пишеш на клиента.

Получаваш answers (въпросникът: цел, възраст, пол, тегло, ръст, активност, заболявания, лекарства, алергии,
непоносимости, какво не яде, хранителен режим, брой хранения, бюджет, изследвания) и plan (analysis — дневни цели;
strategy; weekPlan — дни → meals с ястия, грамове, калории и макроси; summary; добавки и препоръки, ако има).

Проверявай целия план, всеки ден и всяко хранене:
1. Безопасност (critical): алергени и непоносимости във всяко ястие; храни и добавки, противопоказни при заболяванията
   и лекарствата (грейпфрут и статини, витамин K и варфарин, йод при Хашимото без указание, много калий при бъбречно
   заболяване, захари при диабет, сол при хипертония, сурови и рискови храни при бременност); дози на добавките над
   горния безопасен праг; твърде нисък прием на енергия (под 1200 kcal за жени, под 1500 за мъже) без причина.
2. Спазване на клиента (major): храни, които е казал, че не яде; режимът му (вегетарианец, без глутен…); броят
   хранения и часовете; пропуснатата закуска, ако е отбелязана.
3. Числа (major): дневните калории и макроси спрямо целите в analysis (отклонение над 10% е грешка); сумата на деня
   спрямо сбора на храненията; реалистични грамове (не 7 г ориз, не 600 г пилешко на хранене).
4. Смисъл (major или minor): ястие, което не е за това хранене; едно ястие повече от 3 пъти седмично; разнообразие
   на белтъчини и зеленчуци; храни, трудни за намиране там, където е клиентът; бюджетът.
5. Текстове (minor): противоречия между анализа, препоръките и менюто; грешни имена; обещания за лечение.

Промени (changes) предлагаш само когато са нужни и си сигурен в тях — всяка с причина за екипа (reason).
Формат JSON Patch: op е replace, add или remove; path е само под /plan (напр. /plan/weekPlan/day3/meals/1);
value_json е новата стойност като JSON текст ("" при remove). Сменяй цяло хранене с ястие в същата структура като
другите хранения — копирай полетата им. Сумите на деня и summary сървърът пресмята сам — не ги пипай. Не пипай
answers и не пренаписвай целия план (най-много 25 промени). Ако проблемът е в целите (analysis) или в цялата
стратегия, не го поправяй: присъда "stop" и обяснение.

Присъда (verdict): "ok" — може да се одобри; "fix" — с промените е наред; "stop" — нужен е човек.
summary: 2–4 изречения за екипа. findings: всяка забележка с severity, where, issue и fix.`;

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
          op: { type: 'string', enum: ['replace', 'add', 'remove'] },
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

/** Чакащите одобрение планове без преглед за текущия им вариант. */
async function unreviewed(env, scan, max) {
  const ids = JSON.parse((await env.page_content.get('clients_list')) || '[]').slice(0, scan);
  const items = [];
  for (const id of ids) {
    if (items.length >= max) break;
    const c = JSON.parse((await env.page_content.get(`client:${id}`)) || 'null');
    if (!isPending(c)) continue;
    const r = JSON.parse((await env.page_content.get(reviewKey(id))) || 'null');
    if (r && r.planUpdatedAt === (c.planUpdatedAt || null)) continue;   // този вариант вече е прегледан
    items.push({ clientId: id, planUpdatedAt: c.planUpdatedAt || null });
  }
  return items;
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
  await enqueue(env, item, now);
  return 'queued';
}

/**
 * Таймерът (резервата): неразгледан план без пусната задача (грешка, сменен ключ) или с пусната
 * преди 3 часа без резултат → в опашката. → 'off' | 'none' | 'same' | 'queued:<n>'
 */
export async function maybeFireReview(env, { now = Date.now() } = {}) {
  if (!env.ANTHROPIC_API_KEY || !env.page_content || !env.PLAN_QUEUE) return 'off';
  const items = await unreviewed(env, CRON_SCAN, 20);
  if (!items.length) return 'none';
  let n = 0;
  for (const i of items) {
    if (await alreadyFired(env, i, now)) continue;
    await enqueue(env, i, now);
    n++;
  }
  return n ? `queued:${n}` : 'same';
}

/** Входът за Claude: въпросникът и планът (без служебните полета). */
function reviewInput(c) {
  const { _meta, aiVoice, ...plan } = c.plan || {};
  return JSON.stringify({ answers: c.answers || {}, plan });
}

/** Промените от модела → JSON Patch (value_json → value). */
function toPatches(changes) {
  return (Array.isArray(changes) ? changes : []).map((ch) => {
    const p = { op: ch.op, path: String(ch.path || '') };
    if (ch.op !== 'remove') p.value = JSON.parse(ch.value_json);
    return p;
  });
}

/** Прилага промените върху копие; връща коригирания план и „преди/след“ за всяка промяна. */
async function applyChanges(c, changes, reconcile) {
  const patches = toPatches(changes);
  if (patches.some((p) => !p.path.startsWith('/plan/'))) throw new Error('промените са само под /plan/…');
  const before = buildPatchDocument(c);
  const copy = JSON.parse(JSON.stringify(c));
  const { document } = applyJsonPatches(before, patches);
  mergePatchDocument(copy, document);
  if (reconcile && copy.plan?.weekPlan) await reconcile(copy.plan, copy.answers);
  const diff = changes.map((ch, i) => ({
    op: ch.op, path: patches[i].path, reason: clip(ch.reason, 800),
    before: valueAt(before, patches[i].path) ?? null,
    after: ch.op === 'remove' ? null : patches[i].value,
  }));
  return { correctedPlan: copy.plan, patches, changes: diff };
}

function costOf(usage) {
  const u = usage || {};
  return ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out
    + (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;
}

/** Едно извикване на Claude; → { message, result|null } */
async function askClaude(client, messages) {
  const message = await client.beta.messages.stream({
    model: REVIEW_MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: { effort: REVIEW_EFFORT, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
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
  if (!isPending(c)) return 'skip';
  if ((c.planUpdatedAt || null) !== (planUpdatedAt || null)) return 'stale';   // новият вариант има своя задача
  const old = JSON.parse((await env.page_content.get(reviewKey(clientId))) || 'null');
  if (old && old.planUpdatedAt === (c.planUpdatedAt || null)) return 'reviewed';

  const api = client || new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages = [{ role: 'user', content: reviewInput(c) }];
  let usd = 0;
  let { message, result } = await askClaude(api, messages);
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
      ({ message, result } = await askClaude(api, messages));
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
  const findings = (declined ? [] : result.findings || []).slice(0, 60).map((f) => ({
    severity: SEVERITIES.has(f?.severity) ? f.severity : 'minor',
    where: clip(f?.where, 120), issue: clip(f?.issue, 800), fix: clip(f?.fix, 800),
  })).filter((f) => f.issue);
  let verdict = declined ? 'stop' : (['ok', 'fix', 'stop'].includes(result.verdict) ? result.verdict : 'stop');
  if (verdict === 'fix' && !applied) verdict = 'stop';
  const summary = declined
    ? (message.stop_reason === 'refusal' ? 'Прегледът не можа да се направи (моделът отказа). Нужна е ръчна проверка.' : 'Прегледът прекъсна (твърде дълъг отговор). Нужна е ръчна проверка.')
    : clip(result.summary, 2000) + (applyError ? ` Предложените промени не се приложиха (${clip(applyError, 200)}) — описани са в забележките.` : '');

  const review = {
    clientId, planUpdatedAt: c.planUpdatedAt || null, reviewedAt: now, reviewer: 'claude', model: message.model || REVIEW_MODEL,
    verdict, summary, findings,
    changes: applied?.changes || null, patches: applied?.patches || null, correctedPlan: applied?.correctedPlan || null,
    costUsd: Math.round(usd * 10000) / 10000, applied: false,
  };
  await env.page_content.put(reviewKey(clientId), JSON.stringify(review), { expirationTtl: 120 * 86400 });
  if (notify) await notify(c, review);   // писмото до админа: новият план с прегледа
  return verdict;
}

/** GET /api/admin/plan-review?clientId= */
export async function handleReviewGet(url, env, { respond }) {
  const id = url.searchParams.get('clientId') || '';
  const r = JSON.parse((await env.page_content.get(reviewKey(id))) || 'null');
  return respond({ review: r });
}

/** POST /api/admin/plan-review/apply { clientId } — коригираният план става текущ; остава за одобрение. */
export async function handleReviewApply(request, env, { respond, now = Date.now() }) {
  const { clientId } = await request.json().catch(() => ({}));
  const r = JSON.parse((await env.page_content.get(reviewKey(clientId))) || 'null');
  if (!r?.correctedPlan) return respond({ error: 'no_correction', message: 'Няма корекции за прилагане' }, 400);
  const c = JSON.parse((await env.page_content.get(`client:${clientId}`)) || 'null');
  if (!isPending(c)) return respond({ error: 'not_pending', message: 'Планът вече не чака одобрение' }, 409);
  if ((c.planUpdatedAt || null) !== r.planUpdatedAt) {
    return respond({ error: 'stale', message: 'Планът е сменен след прегледа — корекциите не важат за него' }, 409);
  }
  const originalPlan = c.plan;
  c.plan = r.correctedPlan;
  c.planUpdatedAt = new Date(now).toISOString();
  await env.page_content.put(`client:${clientId}`, JSON.stringify(c));
  // Прегледът важи за новия вариант (иначе би тръгнал пак); старият план остава в прегледа.
  await env.page_content.put(reviewKey(clientId), JSON.stringify({ ...r, applied: true, appliedAt: now, planUpdatedAt: c.planUpdatedAt, originalPlan }), { expirationTtl: 120 * 86400 });
  return respond({ success: true, planUpdatedAt: c.planUpdatedAt });
}
