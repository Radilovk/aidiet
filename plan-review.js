/**
 * Преглед на новите планове от Claude (сесия по график, на час — с абонамента, без API ключ).
 *
 * Поток: планът е „pending“ (чака одобрение в админа) → сесията взима опашката, чете клиента
 * (въпросник + план) през /api/admin/get-client-data, преглежда по GUIDE и праща присъда, забележки
 * и корекции (JSON Patch само в /plan). Сървърът прилага корекциите върху копие, пресмята наново
 * сумите (reconcilePlanStructure) и пази прегледа в KV plan_review:<clientId>. Админът вижда
 * прегледа в хъба за одобрение и решава: „Приложи корекциите“ (планът остава pending) → „Активирай“.
 *
 * Всички маршрути са под /api/admin/* — пазени от централния guard (X-Admin-Secret).
 *   GET  /api/admin/plan-review/queue          → { items: [{ clientId, name, planUpdatedAt }], guide }
 *   POST /api/admin/plan-review/submit         { clientId, planUpdatedAt, verdict, summary, findings, patches? }
 *   GET  /api/admin/plan-review?clientId=      → прегледът
 *   POST /api/admin/plan-review/apply          { clientId } → коригираният план става текущ (pending)
 */
import { applyJsonPatches, buildPatchDocument, mergePatchDocument } from './json-patch.js';

const QUEUE_MAX = 5;
const VERDICTS = new Set(['ok', 'fix', 'stop']);
const SEVERITIES = new Set(['critical', 'major', 'minor']);
const reviewKey = (id) => `plan_review:${id}`;
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

export const GUIDE = `Ти преглеждаш хранителен план на Eatologix ПРЕДИ да стигне до клиента. Екипът го одобрява след теб.
Работиш на български. Не пишеш на клиента — пишеш на екипа: кратко, конкретно, с място (ден, хранене).

ВХОД: client.answers (въпросникът: цел, възраст, пол, тегло, ръст, активност, заболявания, лекарства,
алергии, непоносимости, какво не яде, хранителен режим, брой хранения, бюджет, изследвания) и client.plan
(analysis — дневни цели; strategy; weekPlan — дни → meals с ястия, грамове, калории и макроси; summary;
supplements/recommendations, ако има).

ПРОВЕРИ ОБСТОЙНО (всичко, не само първото, което хване окото):
1. Безопасност (critical): алергени и непоносимости във всяко ястие; храни/добавки, противопоказни при
   заболяванията и лекарствата (напр. грейпфрут + статини, витамин K + варфарин, йод + хашимото без указание,
   високо калий при бъбречно заболяване, захари при диабет, сол при хипертония, сурови/рискови храни при бременност);
   дози на добавките над безопасния горен праг; прекалено нисък прием на енергия (< 1200 жени / < 1500 мъже без причина).
2. Спазване на клиента (major): храни, които е казал, че не яде; хранителният му режим (вегетарианец, без глутен…);
   броят хранения и часовете; гладуване/закуска, ако е отбелязано.
3. Числа (major): дневните калории и белтък/въглехидрати/мазнини спрямо целите в analysis (отклонение > 10% е грешка);
   сумата на деня спрямо сбора на храненията; реалистични грамове (не 7 г ориз, не 600 г пилешко на хранене).
4. Смисъл (major/minor): ястие, което не е за това хранене; повторения (едно и също ястие > 3 пъти седмично);
   разнообразие на белтъчини и зеленчуци; храни, трудни за намиране в България; бюджет.
5. Текстове (minor): противоречия между анализа/препоръките и менюто; грешки в имената; обещания за лечение.

КОРЕКЦИИ: само ако са нужни и си сигурен. Формат JSON Patch (op: replace | add | remove; path само под /plan;
до 25 операции). Сменяй цяло хранене (replace /plan/weekPlan/<ден>/meals/<индекс>) с ястие в СЪЩАТА структура като
останалите хранения — копирай формата на полетата. Сумите на деня и summary сървърът пресмята сам — не ги пипай.
Не сменяй answers. Не пренаписвай целия план. Ако проблемът е в целите (analysis) или в цялата стратегия —
не го поправяй ти: verdict "stop" и обясни.

ИЗХОД (POST /api/admin/plan-review/submit, JSON):
{ "clientId": "...", "planUpdatedAt": "<както в опашката>",
  "verdict": "ok" | "fix" | "stop",       // ok — може да се одобри; fix — с корекциите е ок; stop — нужен човек
  "summary": "2–4 изречения за екипа",
  "findings": [ { "severity": "critical|major|minor", "where": "ден 3, обяд", "issue": "...", "fix": "..." } ],
  "patches": [ ... ] }                     // само при verdict "fix"
Ако сървърът върне грешка за корекциите — поправи пътищата и прати пак (до 2 опита); иначе прати без patches
и с verdict "stop", като опишеш корекцията с думи.`;

function isPending(c) {
  return c && c.plan && c.planStatus === 'pending';
}

/** GET /api/admin/plan-review/queue */
export async function handleReviewQueue(env, { respond }) {
  const ids = JSON.parse((await env.page_content.get('clients_list')) || '[]').slice(0, 500);
  const items = [];
  for (const id of ids) {
    if (items.length >= QUEUE_MAX) break;
    const c = JSON.parse((await env.page_content.get(`client:${id}`)) || 'null');
    if (!isPending(c)) continue;
    const r = JSON.parse((await env.page_content.get(reviewKey(id))) || 'null');
    if (r && r.planUpdatedAt === (c.planUpdatedAt || null)) continue;   // този вариант вече е прегледан
    items.push({ clientId: id, name: c.answers?.name || '', planUpdatedAt: c.planUpdatedAt || null });
  }
  return respond({ items, guide: GUIDE });
}

/** POST /api/admin/plan-review/submit */
export async function handleReviewSubmit(request, env, { respond, reconcile, notify, now = Date.now() }) {
  const b = await request.json().catch(() => null);
  if (!b || !b.clientId) return respond({ error: 'bad_request', message: 'Липсва clientId' }, 400);
  const c = JSON.parse((await env.page_content.get(`client:${b.clientId}`)) || 'null');
  if (!isPending(c)) return respond({ error: 'not_pending', message: 'Планът вече не чака одобрение' }, 409);
  if ((b.planUpdatedAt || null) !== (c.planUpdatedAt || null)) {
    return respond({ error: 'stale', message: 'Планът е сменен след взимането от опашката — вземи го наново', planUpdatedAt: c.planUpdatedAt || null }, 409);
  }
  const verdict = VERDICTS.has(b.verdict) ? b.verdict : null;
  if (!verdict) return respond({ error: 'bad_request', message: 'verdict: ok | fix | stop' }, 400);
  const findings = (Array.isArray(b.findings) ? b.findings : []).slice(0, 60).map((f) => ({
    severity: SEVERITIES.has(f?.severity) ? f.severity : 'minor',
    where: clip(f?.where, 120), issue: clip(f?.issue, 800), fix: clip(f?.fix, 800),
  })).filter((f) => f.issue);

  let correctedPlan = null;
  let patches = null;
  if (Array.isArray(b.patches) && b.patches.length) {
    if (b.patches.some((p) => !String(p?.path || '').startsWith('/plan/'))) {
      return respond({ error: 'bad_patch', message: 'Корекциите са само под /plan/…' }, 400);
    }
    try {
      const copy = JSON.parse(JSON.stringify(c));
      const { document } = applyJsonPatches(buildPatchDocument(copy), b.patches);
      mergePatchDocument(copy, document);
      if (reconcile && copy.plan?.weekPlan) await reconcile(copy.plan, copy.answers);
      correctedPlan = copy.plan;
      patches = b.patches;
    } catch (e) {
      return respond({ error: 'bad_patch', message: `Корекциите не се приложиха: ${e.message}` }, 400);
    }
  }

  const review = {
    clientId: b.clientId, planUpdatedAt: c.planUpdatedAt || null, reviewedAt: now, reviewer: 'claude',
    verdict, summary: clip(b.summary, 2000), findings, patches, correctedPlan, applied: false,
  };
  await env.page_content.put(reviewKey(b.clientId), JSON.stringify(review), { expirationTtl: 120 * 86400 });

  if (notify) {
    const icon = verdict === 'ok' ? '✅' : verdict === 'fix' ? '🛠' : '⛔';
    const crit = findings.filter((f) => f.severity === 'critical').length;
    notify(`${icon} Claude прегледа план\n\n👤 ${c.answers?.name || b.clientId}\n` +
      `Присъда: ${verdict === 'ok' ? 'готов за одобрение' : verdict === 'fix' ? 'с корекции' : 'нужен човек'}\n` +
      `Забележки: ${findings.length}${crit ? ` (критични: ${crit})` : ''}\n\n${review.summary.slice(0, 500)}`);
  }
  return respond({ success: true, verdict, findings: findings.length, corrected: Boolean(correctedPlan) });
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
  c.plan = r.correctedPlan;
  c.planUpdatedAt = new Date(now).toISOString();
  await env.page_content.put(`client:${clientId}`, JSON.stringify(c));
  // Прегледът важи за новия вариант (иначе опашката би го взела пак).
  await env.page_content.put(reviewKey(clientId), JSON.stringify({ ...r, applied: true, appliedAt: now, planUpdatedAt: c.planUpdatedAt }), { expirationTtl: 120 * 86400 });
  return respond({ success: true, planUpdatedAt: c.planUpdatedAt });
}
