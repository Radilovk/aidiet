/**
 * Generates pep-portfolio-static.html from DEFAULT_PRODUCTS seed data.
 * For live catalog sync use: node scripts/sync-pep-portfolio.mjs
 */
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildPepPortfolioHtml } from './lib/build-pep-portfolio-html.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const pepHtml = readFileSync(join(root, 'pep.html'), 'utf8');
const productsBlock = pepHtml.match(/const DEFAULT_PRODUCTS = (\[[\s\S]*?\]);/);
if (!productsBlock) {
    throw new Error('DEFAULT_PRODUCTS not found in pep.html');
}

const products = new Function(`return ${productsBlock[1]}`)();
const multiplier = Number(process.argv[2] || '2.5');
const catalogHtml = buildPepPortfolioHtml(products, multiplier);

writeFileSync(join(root, 'pep-portfolio-static.html'), catalogHtml);
console.log(`Generated pep-portfolio-static.html (×${multiplier}, ${Math.round(catalogHtml.length / 1024)} KB)`);
