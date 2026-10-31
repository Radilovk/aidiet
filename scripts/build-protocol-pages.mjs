#!/usr/bin/env node
/**
 * Генерира публичните страници на клиничните протоколи от protocol-states.js:
 *   - protocol-<slug>.html — по една за всяко състояние, водят към
 *     questionnaire2.html?protocol=<id>;
 *   - protocol-landing.html — всички протоколи (картите от лендинга);
 *   - sitemap.xml — публичните страници.
 * Вмъква и общия футър на сайта между маркерите site-footer:start/end в
 * статичните публични страници (SITE_FOOTER_PAGES). Всичко е статично —
 * бързо, индексируемо и без заявки към бекенда.
 *
 *   npm run build:protocol-pages          — записва страниците
 *   npm run build:protocol-pages -- --check — грешка, ако някоя не е актуална
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_STATES, STATE_ICONS, statePageUrl } from '../protocol-states.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://biocode.website';
const CSS_V = '20261031a';

/** Статични страници с общия футър (вмъква се между маркерите). */
const SITE_FOOTER_PAGES = ['index.html', 'features.html', 'help.html', 'delete-account.html', 'privacy-policy.html', 'terms.html'];

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svg = (paths, size = 20, sw = 2) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const I = {
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    minus: '<path d="M6 12h12"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    leafMark: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
};

/** Иконите на магазините (запълнени, 24×24). */
const STORE = {
    play: '<path fill="currentColor" d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z"/>',
    apple: '<path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/>',
};
const storeSvg = (path) => `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;

/**
 * Общият футър — карта на сайта, магазини и правни връзки.
 * В приложението от магазина (Capacitor) .sf-web се скрива: без сваляне и чужди магазини.
 */
function siteFooter() {
    return `<!-- site-footer:start — генерира се от scripts/build-protocol-pages.mjs, не редактирай тук -->
    <footer class="sf" role="contentinfo">
        <script>try{if(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform())document.documentElement.classList.add('is-native')}catch(e){}</script>
        <div class="sf-wrap">
            <div class="sf-top">
                <div class="sf-brand">
                    <a class="sf-logo" href="index.html?stay=1"><span class="sf-mark">${svg(I.leafMark, 18, 2.2)}</span>NutriPlan</a>
                    <p class="sf-tag">Хранене по твоя мярка.</p>
                    <p class="sf-about">Седмично меню с точни грамажи — по тялото, здравето и вкусовете ти. Коригира се всяка седмица според резултата.</p>
                    <div class="sf-stores sf-web" aria-label="Мобилни магазини">
                        <span class="sf-store">${storeSvg(STORE.play)}<span><small>Скоро в</small><b>Google Play</b></span></span>
                        <span class="sf-store">${storeSvg(STORE.apple)}<span><small>Скоро в</small><b>App Store</b></span></span>
                    </div>
                </div>
                <nav class="sf-cols" aria-label="Карта на сайта">
                    <div>
                        <h2 class="sf-h">Продукт</h2>
                        <ul>
                            <li><a href="index.html?stay=1#how-it-works">Как работи</a></li>
                            <li><a href="features.html">Възможности</a></li>
                            <li><a href="questionnaire2.html">Създай план</a></li>
                            <li class="sf-web"><a href="index.html?stay=1#android-install">Приложението</a></li>
                        </ul>
                    </div>
                    <div>
                        <h2 class="sf-h">Програми</h2>
                        <ul>
                            <li><a href="protocol-landing.html">Клинични протоколи</a></li>
                            <li><a href="emoeat.html">Емоционално хранене</a></li>
                            <li><a href="longevity.html">Дълголетие <small>с профил</small></a></li>
                        </ul>
                    </div>
                    <div>
                        <h2 class="sf-h">Помощ</h2>
                        <ul>
                            <li><a href="help.html">Въпроси и отговори</a></li>
                            <li><a href="index.html?stay=1#contact">Контакт</a></li>
                            <li><a href="delete-account.html">Изтриване на профил</a></li>
                        </ul>
                    </div>
                    <div>
                        <h2 class="sf-h">Правни</h2>
                        <ul>
                            <li><a href="privacy-policy.html">Поверителност</a></li>
                            <li><a href="terms.html">Условия за ползване</a></li>
                            <li><a href="help.html#health">Здраве и безопасност</a></li>
                        </ul>
                    </div>
                </nav>
            </div>
            <div class="sf-bottom">
                <p>© 2026 NutriPlan · biocode.website</p>
                <p>Хранителни насоки, не медицинска услуга. При заболяване — с лекар.</p>
            </div>
        </div>
    </footer>
    <!-- site-footer:end -->`;
}

const topbar = () => `<header class="topbar">
        <div class="wrap">
            <a class="brand" href="index.html?stay=1" aria-label="NutriPlan — начало">
                <span class="brand-mark">${svg(I.leafMark, 18, 2.2)}</span>NutriPlan
            </a>
            <button class="icon-btn" id="theme-toggle" type="button" aria-label="Смени светла / тъмна тема">
                <span class="i-moon">${svg(I.moon, 18)}</span><span class="i-sun">${svg(I.sun, 18)}</span>
            </button>
        </div>
    </header>`;

const themeInit = `<script>(function(){var t;try{t=localStorage.getItem('theme')}catch(e){}t=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);if(t==='dark')document.querySelector('meta[name="theme-color"]').setAttribute('content','#071312');})();</script>`;

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:ital,wght@1,600&display=swap">
    <link rel="stylesheet" href="protocol-page.css?v=${CSS_V}">
    <link rel="stylesheet" href="site-footer.css?v=${CSS_V}">`;

function page(s) {
    const url = `${SITE}/${statePageUrl(s)}`;
    const cta = `questionnaire2.html?protocol=${encodeURIComponent(s.id)}`;
    const title = `${s.shortName} — хранителен протокол | NutriPlan`;
    const ctaLabel = 'Създай моя план по протокола';
    const others = PROTOCOL_STATES.filter((o) => o.id !== s.id);
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description: s.shortDescription,
        url,
        inLanguage: 'bg-BG',
        isPartOf: { '@type': 'WebSite', name: 'NutriPlan', url: `${SITE}/` },
        about: { '@type': 'MedicalCondition', name: s.name },
    };
    return `<!DOCTYPE html>
<!-- Генерирано от scripts/build-protocol-pages.mjs — редактирай protocol-states.js и пусни npm run build:protocol-pages -->
<html lang="bg" class="no-js has-dock" style="--acc:${s.accent}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(s.shortDescription)} Персонален хранителен план в NutriPlan.">
    <link rel="canonical" href="${url}">
    <meta name="theme-color" content="#F4FBFA">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="bg_BG">
    <meta property="og:site_name" content="NutriPlan">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(s.shortDescription)}">
    <meta property="og:url" content="${url}">
    <link rel="icon" type="image/png" sizes="192x192" href="icon-192x192.png">
    ${themeInit}
    ${fonts}
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
    ${topbar()}

    <main class="wrap">
        <section class="hero" aria-labelledby="state-title">
            <div class="orb" aria-hidden="true"><div class="orb-core">${svg(STATE_ICONS[s.icon], 40, 1.8)}</div></div>
            <span class="chip">${esc(s.category)}</span>
            <h1 id="state-title">${esc(s.name)}</h1>
            <p class="lead">${esc(s.shortDescription)}</p>
            <a class="cta" href="${cta}" data-cta data-cta-anchor>${ctaLabel}${svg(I.arrow)}</a>
            <ul class="meta">
                <li>${svg(I.clock, 16)}Около 5 минути</li>
                <li>${svg(I.calendar, 16)}Седмично меню</li>
                <li>${svg(I.sliders, 16)}По твоите данни</li>
            </ul>
        </section>

        <section class="section reveal" aria-labelledby="h-for">
            <h2 id="h-for"><span class="kicker">За кого е</span>Подходящ ли е за теб</h2>
            <div class="card for-whom">
                <span class="ic">${svg(I.user, 22)}</span>
                <p>${esc(s.forWhom)}</p>
            </div>
        </section>

        <section class="section reveal" aria-labelledby="h-what">
            <h2 id="h-what"><span class="kicker">Протоколът</span>Какво получаваш</h2>
            <div class="card">
                <p>${esc(s.description)}</p>
                <p>${esc(s.benefits)}</p>
            </div>
        </section>

        <section class="section reveal" aria-labelledby="h-food">
            <h2 id="h-food"><span class="kicker">В чинията</span>На какво стъпва менюто</h2>
            <div class="duo">
                <div class="card">
                    <h3>Акцент</h3>
                    <ul class="list yes">${s.emphasis.map((t) => `<li><span class="mark">${svg(I.check, 14, 2.6)}</span>${esc(t)}</li>`).join('')}</ul>
                </div>
                <div class="card">
                    <h3>Ограничава</h3>
                    <ul class="list no">${s.restrictions.map((t) => `<li><span class="mark">${svg(I.minus, 14, 2.6)}</span>${esc(t)}</li>`).join('')}</ul>
                </div>
            </div>
        </section>

        <section class="section reveal" aria-labelledby="h-how">
            <h2 id="h-how"><span class="kicker">Всеки ден</span>Как работи планът</h2>
            <ul class="card list hacks">${s.hacks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </section>

        <section class="section reveal" aria-labelledby="h-steps">
            <h2 id="h-steps"><span class="kicker">Три стъпки</span>Как стигаш до плана</h2>
            <ol class="steps">
                <li><div><strong>Кратък въпросник</strong><span>Протоколът вече е избран — питаме само за теб: тяло, режим, вкус и здраве.</span></div></li>
                <li><div><strong>Анализ</strong><span>NutriPlan съчетава протокола с твоите данни и смята калориите и състава на всяко хранене. Специалист преглежда резултата.</span></div></li>
                <li><div><strong>Твоят план</strong><span>Седмично меню, замени за всяко ястие и асистент, който отговаря на въпроси за храната.</span></div></li>
            </ol>
        </section>

        <section class="final reveal" aria-labelledby="h-final">
            <h2 id="h-final">Започни с протокола „${esc(s.shortName)}“</h2>
            <p>Планът се изгражда около протокола и се променя заедно с теб.</p>
            <a class="cta" href="${cta}" data-cta data-cta-anchor>${ctaLabel}${svg(I.arrow)}</a>
        </section>

        <p class="note">Протоколът е хранителен подход и не замества лечение или консултация с лекар. При заболяване, бременност или прием на лекарства обсъди промените с лекуващия си лекар.</p>

        <nav class="others" aria-labelledby="h-others">
            <div class="others-head">
                <h2 id="h-others">Други състояния</h2>
                <a class="others-all" href="protocol-landing.html">${svg(I.grid, 16)}Всички протоколи</a>
            </div>
            <div class="chips">${others.map((o) => `<a href="${statePageUrl(o)}" style="--dot:${o.accent}"><span></span>${esc(o.shortName)}</a>`).join('')}</div>
        </nav>
    </main>

    ${siteFooter()}

    <div class="dock" aria-hidden="false">
        <a class="cta" href="${cta}" data-cta>${ctaLabel}${svg(I.arrow)}</a>
    </div>

    <script src="protocol-page.js?v=${CSS_V}" defer></script>
</body>
</html>
`;
}

/** protocol-landing.html — всички състояния като карти; всяка води към своята страница. */
function hubPage() {
    const url = `${SITE}/protocol-landing.html`;
    const n = PROTOCOL_STATES.length;
    const title = 'Клинични протоколи — хранене по състоянието ти | NutriPlan';
    const description = `${n} хранителни протокола — кръвна захар, автоимунни състояния, храносмилане, менопауза, кърмене и още. Седмично меню по протокола и по твоите данни.`;
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title,
        description,
        url,
        inLanguage: 'bg-BG',
        isPartOf: { '@type': 'WebSite', name: 'NutriPlan', url: `${SITE}/` },
        hasPart: PROTOCOL_STATES.map((s) => ({ '@type': 'WebPage', name: s.shortName, url: `${SITE}/${statePageUrl(s)}` })),
    };
    const cards = PROTOCOL_STATES.map((s) => `
                <a class="pcard reveal" href="${statePageUrl(s)}" style="--acc:${s.accent}">
                    <span class="pcard-ic">${svg(STATE_ICONS[s.icon], 22, 1.9)}</span>
                    <span class="pcard-cat">${esc(s.category)}</span>
                    <h3>${esc(s.shortName)}</h3>
                    <p>${esc(s.shortDescription)}</p>
                    <span class="pcard-go">Виж протокола${svg(I.arrow, 16)}</span>
                </a>`).join('') + `
                <a class="pcard pcard--standard reveal" href="questionnaire2.html" data-standard-plan>
                    <span class="pcard-ic">${svg(I.sliders, 22, 1.9)}</span>
                    <span class="pcard-cat">Без протокол</span>
                    <h3>Нямаш конкретно състояние?</h3>
                    <p>Стандартният план — изцяло по твоите цели и данни.</p>
                    <span class="pcard-go">Към стандартния план${svg(I.arrow, 16)}</span>
                </a>`;
    return `<!DOCTYPE html>
<!-- Генерирано от scripts/build-protocol-pages.mjs — редактирай protocol-states.js и пусни npm run build:protocol-pages -->
<html lang="bg" class="no-js page-hub">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${url}">
    <meta name="theme-color" content="#F4FBFA">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="bg_BG">
    <meta property="og:site_name" content="NutriPlan">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${url}">
    <link rel="icon" type="image/png" sizes="192x192" href="icon-192x192.png">
    <link rel="manifest" href="manifest.json">
    ${themeInit}
    ${fonts}
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
    ${topbar()}

    <main class="wrap wrap--wide">
        <section class="hero hub-hero" aria-labelledby="hub-title">
            <span class="chip">Клинични протоколи</span>
            <h1 id="hub-title">Хранене, съобразено със <em>състоянието ти</em></h1>
            <p class="lead">Протоколът определя какво влиза в чинията и какво се ограничава. Менюто и грамажите се смятат по твоите данни — и се коригират всяка седмица.</p>
            <ul class="meta">
                <li>${svg(I.list, 16)}${n} протокола</li>
                <li>${svg(I.clock, 16)}Около 5 минути</li>
                <li>${svg(I.calendar, 16)}Седмично меню</li>
            </ul>
        </section>

        <section class="section" aria-labelledby="h-pick">
            <h2 id="h-pick"><span class="kicker">${n} протокола</span>Избери състояние</h2>
            <div class="pgrid">${cards}
            </div>
        </section>

        <section class="section reveal" aria-labelledby="h-steps">
            <h2 id="h-steps"><span class="kicker">Три стъпки</span>Как стигаш до плана</h2>
            <ol class="steps steps--row">
                <li><div><strong>Избираш протокол</strong><span>Отваряш състоянието и виждаш на какво стъпва менюто.</span></div></li>
                <li><div><strong>Кратък въпросник</strong><span>Тяло, режим, вкус и здраве. Специалист преглежда резултата.</span></div></li>
                <li><div><strong>Твоят план</strong><span>Седмично меню с грамажи, замени и асистент. Коригира се всяка седмица.</span></div></li>
            </ol>
        </section>

        <p class="note">Протоколите са хранителен подход и не заместват лечение или консултация с лекар. При заболяване, бременност или прием на лекарства обсъди промените с лекуващия си лекар.</p>
    </main>

    ${siteFooter()}

    <script src="protocol-page.js?v=${CSS_V}" defer></script>
</body>
</html>
`;
}

/** sitemap.xml — само публичните страници (приложението е зад вход и не се индексира). */
function sitemap() {
    const pages = [
        ['', '1.0'],
        ['questionnaire2.html', '0.9'],
        ['features.html', '0.8'],
        ['protocol-landing.html', '0.8'],
        ...PROTOCOL_STATES.map((s) => [statePageUrl(s), '0.7']),
        ['emoeat.html', '0.6'],
        ['help.html', '0.5'],
        ['delete-account.html', '0.3'],
        ['privacy-policy.html', '0.3'],
        ['terms.html', '0.3'],
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Генерирано от scripts/build-protocol-pages.mjs -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(([path, priority]) => `  <url>
    <loc>${SITE}/${path}</loc>
    <priority>${priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

/** Вмъква общия футър между маркерите на статична страница. */
function stampFooter(html, file) {
    const re = /<!-- site-footer:start[\s\S]*?<!-- site-footer:end -->/;
    if (!re.test(html)) throw new Error(`${file}: липсват маркерите site-footer:start/end`);
    return html.replace(re, () => siteFooter());
}

const check = process.argv.includes('--check');
let stale = 0;
const outputs = PROTOCOL_STATES.map((s) => {
    if (!STATE_ICONS[s.icon]) throw new Error(`Липсва икона „${s.icon}“ за ${s.id}`);
    return [statePageUrl(s), page(s)];
});
outputs.push(['protocol-landing.html', hubPage()]);
outputs.push(['sitemap.xml', sitemap()]);
for (const file of SITE_FOOTER_PAGES) {
    const path = join(ROOT, file);
    if (!existsSync(path)) throw new Error(`Липсва ${file}`);
    outputs.push([file, stampFooter(readFileSync(path, 'utf8'), file)]);
}
for (const [name, html] of outputs) {
    const file = join(ROOT, name);
    if (check) {
        if (!existsSync(file) || readFileSync(file, 'utf8') !== html) {
            stale++;
            console.error(`✗ ${name} не е актуална`);
        }
    } else {
        writeFileSync(file, html);
    }
}
if (check && stale) process.exit(1);
console.log(check ? `✓ ${outputs.length} страници са актуални` : `✓ ${outputs.length} страници записани`);
