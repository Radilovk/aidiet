/**
 * Generates pep-portfolio.html static fallback from pep.html catalog logic.
 * Run: node scripts/generate-pep-portfolio.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const lines = readFileSync(join(root, 'pep.html'), 'utf8').split('\n');

const slice = (from, to) => lines.slice(from, to + 1).join('\n');

// Line numbers are 1-based in editor, 0-based in slice
const defaultProducts = slice(
    lines.findIndex((l) => l.includes('const DEFAULT_PRODUCTS')),
    lines.findIndex((l, i) => i > 1040 && l.trim() === '];')
);

const catalogLibrary = slice(
    lines.findIndex((l) => l.includes('const CATALOG_NAME_ALIASES')),
    lines.findIndex((l) => l.includes('const STORAGE_PRODUCTS')) - 1
);

const exportStyles = slice(
    lines.findIndex((l) => l.includes('const CATALOG_EXPORT_STYLES')),
    lines.findIndex((l) => l.includes('function getCatalogProductKey')) - 1
);

const catalogFns = slice(
    lines.findIndex((l) => l.includes('function getCatalogProductKey')),
    lines.findIndex((l) => l.includes('function openPortfolioModal')) - 1
);

const sandbox = `
${defaultProducts}
function formatMoney(value) { return \`\${Number(value || 0).toFixed(2)} €\`; }
function safeNumber(value) { const num = Number(value); return Number.isFinite(num) ? num : 0; }
function escapeHtml(value) {
    return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function getSortedProducts() {
    return DEFAULT_PRODUCTS.map((p, i) => ({ id: i+1, baseName: p.baseName, dosage: p.dosage, purchasePrice: p.purchasePrice }));
}
${catalogLibrary}
${exportStyles}
${catalogFns}
return buildCatalogDocument(2.5);
`;

const catalogHtml = new Function(sandbox)();

const loaderHtml = `<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="description" content="Портфолио Пептиди — професионален каталог с научно обосновани пептидни терапии.">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#F7F9FC">
<meta property="og:type" content="website">
<meta property="og:url" content="https://biocode.website/pep-portfolio.html">
<meta property="og:title" content="Портфолио Пептиди">
<meta property="og:description" content="Професионален каталог на пептидни терапии с клинично обоснована информация.">
<meta property="og:locale" content="bg_BG">
<link rel="canonical" href="https://biocode.website/pep-portfolio.html">
<link rel="icon" type="image/png" sizes="192x192" href="./icon-192x192.png">
<title>Портфолио Пептиди</title>
<style>
#portfolio-loader {
    position: fixed; inset: 0; z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    background: #F0FDFA; transition: opacity 0.4s ease;
}
#portfolio-loader.hidden { opacity: 0; pointer-events: none; }
.loader-inner { text-align: center; }
.loader-dna {
    width: 48px; height: 48px; margin: 0 auto 16px;
    border: 3px solid #CCFBF1; border-top-color: #0D9488;
    border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loader-text { color: #64748B; font-family: Inter, sans-serif; font-size: 0.9rem; }
</style>
</head>
<body>
<div id="portfolio-loader">
    <div class="loader-inner">
        <div class="loader-dna"></div>
        <div class="loader-text">Зареждане на портфолио…</div>
    </div>
</div>
<script>
(function() {
    var API = 'https://aidiet.radilov-k.workers.dev/api/pep/portfolio';
    var FALLBACK = ${JSON.stringify(catalogHtml)};

    function hideLoader() {
        var el = document.getElementById('portfolio-loader');
        if (el) { el.classList.add('hidden'); setTimeout(function() { el.remove(); }, 500); }
    }

    function renderHtml(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        document.title = doc.title || document.title;
        doc.querySelectorAll('link[rel="preconnect"], link[href*="fonts"]').forEach(function(l) {
            if (!document.querySelector('link[href="' + l.getAttribute('href') + '"]'))
                document.head.appendChild(l.cloneNode(true));
        });
        doc.querySelectorAll('style').forEach(function(s) {
            document.head.appendChild(s.cloneNode(true));
        });
        document.body.innerHTML = doc.body.innerHTML;
        hideLoader();
    }

    fetch(API)
        .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function(data) { renderHtml(data.html); })
        .catch(function() { renderHtml(FALLBACK); });
})();
<\/script>
</body>
</html>`;

writeFileSync(join(root, 'pep-portfolio.html'), loaderHtml);
console.log('Generated pep-portfolio.html (' + Math.round(loaderHtml.length / 1024) + ' KB)');
