/**
 * EATOLOGIX на собствен домейн (eatologix.com).
 *
 * GitHub Pages сервира репото само на biocode.website (там са и другите проекти), затова
 * собственият домейн минава през worker-а: страниците на приложението се взимат от сайта
 * (кеш на ръба 5 мин.), а /api/ остава за worker-а — същият сървър, същите данни.
 * Същият подход като xbody.online (studio-platform/index.js → handleLanding).
 *
 * Включване: в Cloudflare домейнът се добавя като Custom Domain на worker-а „aidiet“
 * (и www.; .github/workflows/domain-setup.yml), а в wrangler.toml → APP_HOSTS.
 * Домейните на модулите (emoeat.app) са в MODULE_HOSTS: своя начална страница, а страниците
 * на Eatologix се пренасочват към eatologix.com. (GitHub Pages дава само един домейн на репо —
 * biocode.website, затова собствените домейни минават оттук.)
 */
const ORIGIN = 'https://biocode.website';

// Страниците на другите проекти не се показват на домейна на приложението (админ панелът — admin.html — е позволен: линковете за одобрение на планове).
// (EmoEat — emoeat.html, emoeat-landing.html — е част от системата и минава.)
const OTHER_PROJECTS = /^\/(xbody|xb-studio|xems-|studio|acuity\/|fitness\/|kids|pep|reta|aix|lqto|vaprosnik|dopamine|health\.html|notifications-test|pwa-test|design_presentation|samples\/|clients\/|docs\/|KV\/|migrations\/|workflows\/|viber-sender\/|scripts\/|\.github\/|CNAME$)/i;
const list = (v) => String(v || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);

export function isAppHost(env, host) {
  const bare = String(host || '').toLowerCase().replace(/^www\./, '');
  return list(env.APP_HOSTS).includes(bare);
}

// Домейните на модулите (същият worker, същите страници от сайта): начална страница и кои
// страници остават на домейна; всичко друго (*.html) отива на основния домейн на Eatologix.
const MODULE_HOSTS = {
  'emoeat.app': {
    home: '/emoeat-landing.html',
    pages: /^\/(emoeat[^/]*\.html|privacy-policy\.html|terms\.html|help\.html|delete-account\.html)$/i
  }
};
const MAIN_HOST = 'eatologix.com';

/** null → не е домейнът на приложението (или е /api/) и заявката продължава към worker-а. */
export async function handleAppDomain(request, env) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (!isAppHost(env, host)) return null;
  const bare = host.replace(/^www\./, '');
  if (host !== bare) return Response.redirect(`https://${bare}${url.pathname}${url.search}`, 301);
  if (url.pathname.startsWith('/api/')) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const mod = MODULE_HOSTS[bare];
  if (OTHER_PROJECTS.test(url.pathname)) return Response.redirect(`https://${mod ? MAIN_HOST : bare}/`, 302);
  // Домейн на модул: страниците на Eatologix се отварят на основния домейн.
  if (mod && url.pathname !== '/' && /\.html$/i.test(url.pathname) && !mod.pages.test(url.pathname)) {
    return Response.redirect(`https://${MAIN_HOST}${url.pathname}${url.search}`, 302);
  }

  const path = url.pathname === '/' ? (mod ? mod.home : '/index.html') : url.pathname;
  const resp = await fetch(ORIGIN + path + url.search, {
    method: request.method,
    cf: { cacheTtl: 300, cacheEverything: true },
    redirect: 'manual'
  });
  // Пренасочване от сайта (напр. папка без наклонена черта) — към същия път на собствения домейн.
  if (resp.status >= 300 && resp.status < 400) {
    const loc = resp.headers.get('Location') || '/';
    const to = new URL(loc, ORIGIN + path);
    return Response.redirect(`https://${bare}${to.pathname}${to.search}`, resp.status === 301 ? 301 : 302);
  }
  const headers = new Headers({ 'X-Content-Type-Options': 'nosniff' });
  for (const h of ['Content-Type', 'Last-Modified', 'ETag']) {
    const v = resp.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Service worker-ът и manifest-ът — без кеш в браузъра, за да стигат обновленията веднага.
  headers.set('Cache-Control', /^\/(sw\.js|manifest\.json)$/.test(path) ? 'no-cache' : 'public, max-age=300');
  if (path === '/sw.js') headers.set('Service-Worker-Allowed', '/');
  return new Response(request.method === 'HEAD' ? null : resp.body, { status: resp.status, headers });
}
