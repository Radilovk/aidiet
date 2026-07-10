/**
 * Builds portfolio HTML from live PEP bootstrap and publishes to worker KV.
 * Run: node scripts/sync-pep-portfolio.mjs [multiplier]
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
    buildPepPortfolioHtml,
    fetchBootstrapProducts,
    fetchPublishedMultiplier,
    publishPortfolioHtml,
    PORTFOLIO_TEMPLATE_VERSION
} from './lib/build-pep-portfolio-html.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const cliMultiplier = process.argv[2] ? Number(process.argv[2]) : null;
const products = await fetchBootstrapProducts();
const multiplier = cliMultiplier && cliMultiplier > 0
    ? cliMultiplier
    : await fetchPublishedMultiplier();

const html = buildPepPortfolioHtml(products, multiplier);
const hasTemplate = html.includes(`portfolio-template:${PORTFOLIO_TEMPLATE_VERSION}`);
const hasCharts = html.includes('efficacy-block');

if (!hasTemplate || !hasCharts) {
    throw new Error('Generated HTML is missing template markers or efficacy charts');
}

writeFileSync(join(root, 'pep-portfolio-static.html'), html);

const result = await publishPortfolioHtml(html, multiplier);
console.log(`Published portfolio v${PORTFOLIO_TEMPLATE_VERSION} (×${multiplier}, ${Math.round(html.length / 1024)} KB)`);
console.log(`Products: ${products.length} · publishedAt: ${result.publishedAt}`);
