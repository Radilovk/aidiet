/**
 * Пощата на Nutriin (Resend) — настройва се без ръчна работа в Resend.
 *
 * Ключът за Resend е само в worker-а (RESEND_API_KEY), а за DNS — само в GitHub (CLOUDFLARE_API_TOKEN).
 * Мостът: workflow-ът „Domain setup“ записва еднократен код в KV (има ключа за Cloudflare — само той може)
 * и вика POST /api/system/email-domain с този код. Worker-ът регистрира домейна в Resend и връща DNS
 * записите; workflow-ът ги слага в Cloudflare и вика „verify“. Щом Resend потвърди домейна, писмата
 * сами минават на info@nutriin.app и връзките в тях — на nutriin.app (sendEmailViaSMTP).
 *
 * Преходът от eatologix.com: флагът в KV пази кой домейн е потвърден. Докато nutriin.app не е потвърден,
 * писмата продължават от вече потвърдения info@eatologix.com (с подател „Nutriin“; eatologix.com препраща
 * към nutriin.app). Без потвърден домейн — доказаното: info@biocode.online и връзки от biocode.website.
 */
export const EMAIL_DOMAIN = 'nutriin.app';
export const EMAIL_DOMAIN_PREV = 'eatologix.com';
export const EMAIL_FROM_OLD = 'Nutriin <info@biocode.online>';
export const EMAIL_FROM_NEW = `Nutriin <info@${EMAIL_DOMAIN}>`;
export const EMAIL_FROM_PREV = `Nutriin <info@${EMAIL_DOMAIN_PREV}>`;
const NONCE_KEY = 'bridge_nonce:email_domain';
const VERIFIED_KEY = 'email_domain_verified';
const RESEND = 'https://api.resend.com';

let cache = { at: 0, domain: '' };

/** Кой домейн е потвърден в Resend за изпращане ('' — никой); кеш 10 мин в инстанцията — 1 четене от KV. */
export async function emailDomainVerified(env, now = Date.now()) {
  if (now - cache.at < 600000) return cache.domain;
  let domain = '';
  try {
    const raw = await env.page_content.get(VERIFIED_KEY);
    if (raw) {
      let d = '';
      try { d = String(JSON.parse(raw).domain || ''); } catch (_) { d = EMAIL_DOMAIN_PREV; }
      if (d === EMAIL_DOMAIN || d === EMAIL_DOMAIN_PREV) domain = d;
    }
  } catch (_) {}
  cache = { at: now, domain };
  return domain;
}

/** Подателят и html-ът на писмото — според това кой домейн е потвърден за изпращане. */
export async function emailEnvelope(env, html) {
  const d = await emailDomainVerified(env);
  if (!d) return { from: EMAIL_FROM_OLD, html };
  return { from: d === EMAIL_DOMAIN ? EMAIL_FROM_NEW : EMAIL_FROM_PREV, html: String(html).split('https://biocode.website').join(`https://${d}`) };
}

async function resend(env, method, path, body) {
  const r = await fetch(RESEND + path, {
    method,
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${method} ${path}: ${r.status} ${data?.message || data?.name || ''}`.trim());
  return data;
}

async function findDomain(env) {
  const list = await resend(env, 'GET', '/domains');
  return (list?.data || []).find((d) => String(d.name).toLowerCase() === EMAIL_DOMAIN) || null;
}

/** POST /api/system/email-domain { action: 'setup' | 'verify' } + X-Bridge-Nonce. */
export async function handleEmailDomain(request, env, { respond, now = Date.now() }) {
  const nonce = request.headers.get('X-Bridge-Nonce') || '';
  const stored = env.page_content ? await env.page_content.get(NONCE_KEY) : null;
  if (!nonce || !stored || stored !== nonce) return respond({ error: 'forbidden' }, 403);
  if (!env.RESEND_API_KEY) return respond({ error: 'RESEND_API_KEY липсва във worker-а' }, 500);
  const { action } = await request.json().catch(() => ({}));
  try {
    let d = await findDomain(env);
    if (action === 'setup') {
      if (!d) d = await resend(env, 'POST', '/domains', { name: EMAIL_DOMAIN, region: 'eu-west-1' });
      const full = await resend(env, 'GET', `/domains/${d.id}`);
      return respond({ id: full.id, status: full.status, records: (full.records || []).map((x) => ({
        record: x.record, type: x.type, name: x.name, value: x.value, priority: x.priority ?? null, status: x.status,
      })) });
    }
    if (action === 'verify') {
      if (!d) return respond({ error: 'домейнът не е регистриран — първо setup' }, 400);
      if (d.status !== 'verified') await resend(env, 'POST', `/domains/${d.id}/verify`).catch(() => null);
      const full = await resend(env, 'GET', `/domains/${d.id}`);
      if (full.status === 'verified') {
        await env.page_content.put(VERIFIED_KEY, JSON.stringify({ domain: EMAIL_DOMAIN, at: new Date(now).toISOString() }));
        cache = { at: 0, domain: '' };
      }
      return respond({ status: full.status, records: (full.records || []).map((x) => ({ record: x.record, name: x.name, status: x.status })) });
    }
    return respond({ error: 'action: setup | verify' }, 400);
  } catch (e) {
    return respond({ error: e.message }, 502);
  }
}
