import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');

export const PORTFOLIO_TEMPLATE_VERSION = 2;
export const PEP_API_BASE = 'https://aidiet.radilov-k.workers.dev/api/pep';

function readPepHtmlSlices() {
    const lines = readFileSync(join(root, 'pep.html'), 'utf8').split('\n');
    const slice = (from, to) => lines.slice(from, to + 1).join('\n');

    return {
        defaultProducts: slice(
            lines.findIndex((l) => l.includes('const DEFAULT_PRODUCTS')),
            lines.findIndex((l, i) => i > 1040 && l.trim() === '];')
        ),
        catalogLibrary: slice(
            lines.findIndex((l) => l.includes('const CATALOG_NAME_ALIASES')),
            lines.findIndex((l) => l.includes('const STORAGE_PRODUCTS')) - 1
        ),
        exportStyles: slice(
            lines.findIndex((l) => l.includes('const CATALOG_EXPORT_STYLES')),
            lines.findIndex((l) => l.includes('function getCatalogProductKey')) - 1
        ),
        catalogFns: slice(
            lines.findIndex((l) => l.includes('function getCatalogProductKey')),
            lines.findIndex((l) => l.includes('function openPortfolioModal')) - 1
        )
    };
}

export function buildPepPortfolioHtml(products, multiplier = 2.5) {
    const safeMultiplier = Number.isFinite(Number(multiplier)) && Number(multiplier) > 0
        ? Number(multiplier)
        : 2.5;
    const productSource = JSON.stringify(products);
    const slices = readPepHtmlSlices();

    const sandbox = `
${slices.defaultProducts}
const LIVE_PRODUCTS = ${productSource};
function formatMoney(value) { return \`\${Number(value || 0).toFixed(2)} €\`; }
function safeNumber(value) { const num = Number(value); return Number.isFinite(num) ? num : 0; }
function escapeHtml(value) {
    return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function getSortedProducts() {
    return LIVE_PRODUCTS.map((product, index) => ({
        id: Number(product.id) || index + 1,
        baseName: product.baseName,
        dosage: product.dosage,
        purchasePrice: Number(product.purchasePrice) || 0
    }));
}
${slices.catalogLibrary}
${slices.exportStyles}
${slices.catalogFns}
return buildCatalogDocument(${safeMultiplier});
`;

    return new Function(sandbox)();
}

export async function fetchBootstrapProducts() {
    const response = await fetch(`${PEP_API_BASE}/bootstrap`);
    if (!response.ok) {
        throw new Error(`Bootstrap failed (${response.status})`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload.products) || !payload.products.length) {
        throw new Error('Bootstrap returned no products');
    }
    return payload.products;
}

export async function fetchPublishedMultiplier() {
    try {
        const response = await fetch(`${PEP_API_BASE}/portfolio`);
        if (!response.ok) return 2.5;
        const payload = await response.json();
        const multiplier = Number(payload.multiplier);
        return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 2.5;
    } catch {
        return 2.5;
    }
}

export async function publishPortfolioHtml(html, multiplier) {
    const response = await fetch(`${PEP_API_BASE}/portfolio/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            html,
            multiplier,
            publishedAt: new Date().toISOString()
        })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Publish failed (${response.status})`);
    }
    return response.json();
}
