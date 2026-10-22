#!/usr/bin/env node
/**
 * Генерира публичните лендинг страници protocol-<slug>.html — по една за всяко
 * готово състояние от protocol-states.js. Страниците са статични (бързи и
 * индексируеми) и водят към questionnaire2.html?protocol=<id>.
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
const CSS_V = '20261022a';

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
};

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
<html lang="bg" class="no-js" style="--acc:${s.accent}">
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
    <script>(function(){var t;try{t=localStorage.getItem('theme')}catch(e){}t=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);if(t==='dark')document.querySelector('meta[name="theme-color"]').setAttribute('content','#071312');})();</script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
    <link rel="stylesheet" href="protocol-page.css?v=${CSS_V}">
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
    <header class="topbar">
        <div class="wrap">
            <a class="brand" href="index.html" aria-label="NutriPlan — начало">
                <span class="brand-mark">${svg(I.leafMark, 18, 2.2)}</span>NutriPlan
            </a>
            <button class="icon-btn" id="theme-toggle" type="button" aria-label="Смени светла / тъмна тема">
                <span class="i-moon">${svg(I.moon, 18)}</span><span class="i-sun">${svg(I.sun, 18)}</span>
            </button>
        </div>
    </header>

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
                <li>${svg(I.sliders, 16)}По вашите данни</li>
            </ul>
        </section>

        <section class="section reveal" aria-labelledby="h-for">
            <h2 id="h-for"><span class="kicker">За кого е</span>Подходящ ли е за вас</h2>
            <div class="card for-whom">
                <span class="ic">${svg(I.user, 22)}</span>
                <p>${esc(s.forWhom)}</p>
            </div>
        </section>

        <section class="section reveal" aria-labelledby="h-what">
            <h2 id="h-what"><span class="kicker">Протоколът</span>Какво получавате</h2>
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
            <h2 id="h-steps"><span class="kicker">Три стъпки</span>Как стигате до плана</h2>
            <ol class="steps">
                <li><div><strong>Кратък въпросник</strong><span>Протоколът вече е избран — питаме само за вас: тяло, режим, вкус и здраве.</span></div></li>
                <li><div><strong>Анализ</strong><span>NutriPlan съчетава протокола с вашите данни и съставя калориите и състава на всяко хранене.</span></div></li>
                <li><div><strong>Вашият план</strong><span>Седмично меню, замени за всяко ястие и асистент, който отговаря на въпроси за храната.</span></div></li>
            </ol>
        </section>

        <section class="final reveal" aria-labelledby="h-final">
            <h2 id="h-final">Започнете с протокола „${esc(s.shortName)}“</h2>
            <p>Планът се изгражда около протокола и се променя заедно с вас.</p>
            <a class="cta" href="${cta}" data-cta data-cta-anchor>${ctaLabel}${svg(I.arrow)}</a>
        </section>

        <p class="note">Протоколът е хранителен подход и не замества лечение или консултация с лекар. При заболяване, бременност или прием на лекарства обсъдете промените с лекуващия лекар.</p>

        <nav class="others" aria-labelledby="h-others">
            <h2 id="h-others">Други състояния</h2>
            <div class="chips">${others.map((o) => `<a href="${statePageUrl(o)}" style="--dot:${o.accent}"><span></span>${esc(o.shortName)}</a>`).join('')}</div>
        </nav>

        <footer class="footer">
            NutriPlan · <a href="privacy-policy.html">Поверителност</a> · <a href="terms.html">Условия</a>
        </footer>
    </main>

    <div class="dock" aria-hidden="false">
        <a class="cta" href="${cta}" data-cta>${ctaLabel}${svg(I.arrow)}</a>
    </div>

    <script src="protocol-page.js?v=${CSS_V}" defer></script>
</body>
</html>
`;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const s of PROTOCOL_STATES) {
    if (!STATE_ICONS[s.icon]) throw new Error(`Липсва икона „${s.icon}“ за ${s.id}`);
    const file = join(ROOT, statePageUrl(s));
    const html = page(s);
    if (check) {
        if (!existsSync(file) || readFileSync(file, 'utf8') !== html) {
            stale++;
            console.error(`✗ ${statePageUrl(s)} не е актуална`);
        }
    } else {
        writeFileSync(file, html);
    }
}
if (check && stale) process.exit(1);
console.log(check ? `✓ ${PROTOCOL_STATES.length} страници са актуални` : `✓ ${PROTOCOL_STATES.length} страници записани`);
