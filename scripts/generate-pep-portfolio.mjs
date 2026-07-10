/**
 * Generates pep-portfolio-static.html as standalone fallback catalog.
 * pep-portfolio.html loads the published API version when available.
 * Run: node scripts/generate-pep-portfolio.mjs [multiplier]
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const lines = readFileSync(join(root, 'pep.html'), 'utf8').split('\n');

const slice = (from, to) => lines.slice(from, to + 1).join('\n');

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

const multiplier = Number(process.argv[2] || '2.5');
const safeMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 2.5;

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
return buildCatalogDocument(${safeMultiplier});
`;

const catalogHtml = new Function(sandbox)();
const outputPath = join(root, 'pep-portfolio-static.html');

writeFileSync(outputPath, catalogHtml);
console.log(`Generated pep-portfolio-static.html (×${safeMultiplier}, ${Math.round(catalogHtml.length / 1024)} KB)`);
