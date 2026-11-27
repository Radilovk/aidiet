/**
 * Обновяване на страниците в приложението за iPhone отвътре (без ново ревю в App Store за промени по страниците —
 * Apple го позволява за HTML/JS, които не сменят предназначението на приложението; IOS_APP_STORE_PLAN.md).
 *
 * GET /api/app/web-bundle?platform=ios&app=<маркетингова версия, напр. 1.0.0>
 *   → { version, url, sha256, minAppVersion } — най-новият пакет, съвместим с тази версия на приложението
 *   → {} — няма (или обновяванията са спрени: KV app_web_bundle_paused = "1")
 *
 * Пакетите са предварителни издания в GitHub с таг ios-web-<version> (.github/workflows/publish-ios-web.yml):
 * zip със страниците (scripts/capacitor-shell.sh) и тяло JSON { version, sha256, minAppVersion }.
 * version = времето на комита (секунди) — расте с всеки комит; приложението го сравнява с web-bundle.json в пакета си.
 * Отговорът от GitHub се пази 5 минути (Cache API) — приложенията не стигат до ограничението на GitHub.
 */

const RELEASES_URL = 'https://api.github.com/repos/Radilovk/aidiet/releases?per_page=30';
const TAG_PREFIX = 'ios-web-';
const CACHE_SEC = 300;

/** „1.2.0“ ≥ „1.1.9“ — по числа, липсващите части са 0. */
export function versionAtLeast(have, need) {
  const a = String(have || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(need || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

/** Изданията от GitHub → пакетите (най-новият пръв). */
export function bundlesFromReleases(releases) {
  const out = [];
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || !String(r.tag_name || '').startsWith(TAG_PREFIX)) continue;
    let meta = null;
    try { meta = JSON.parse(String(r.body || '').trim()); } catch (_) { continue; }
    const asset = (r.assets || []).find((a) => /\.zip$/.test(a.name || ''));
    const version = String(meta && meta.version || '');
    if (!asset || !/^\d+$/.test(version) || !/^[0-9a-f]{64}$/.test(String(meta.sha256 || ''))) continue;
    out.push({ version, url: asset.browser_download_url, sha256: meta.sha256, minAppVersion: String(meta.minAppVersion || '1.0.0') });
  }
  return out.sort((x, y) => Number(y.version) - Number(x.version));
}

export async function handleWebBundle(request, env, { respond }) {
  const url = new URL(request.url);
  if (url.searchParams.get('platform') !== 'ios') return respond({});
  if (env.page_content && (await env.page_content.get('app_web_bundle_paused')) === '1') return respond({});
  const app = url.searchParams.get('app') || '0';

  let releases = null;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(RELEASES_URL);
  try {
    const hit = cache && (await cache.match(key));
    if (hit) releases = await hit.json();
  } catch (_) { /* без кеш */ }
  if (!releases) {
    const r = await fetch(RELEASES_URL, { headers: { 'User-Agent': 'nutriin-worker', Accept: 'application/vnd.github+json' } });
    if (!r.ok) return respond({});
    releases = await r.json();
    try {
      if (cache) await cache.put(key, new Response(JSON.stringify(releases), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SEC}` } }));
    } catch (_) { /* без кеш */ }
  }
  const best = bundlesFromReleases(releases).find((b) => versionAtLeast(app, b.minAppVersion));
  return respond(best || {});
}
