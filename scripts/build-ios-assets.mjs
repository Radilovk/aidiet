#!/usr/bin/env node
/**
 * iOS иконата и стартовият екран на Nutriin (ios-res/), от същите SVG като останалите икони (scripts/build-brand.mjs):
 *   ios-res/AppIcon-1024.png  — brand/nutriin-icon-ios.svg, 1024×1024, БЕЗ прозрачност (App Store отказва икона с алфа канал)
 *   ios-res/splash-2732.png   — знакът върху цвета на сплаша (#032E36, като Android и уеб стартовия екран)
 * Пуска се ръчно след промяна на знака: node scripts/build-ios-assets.mjs (нужни са Playwright и python3 с Pillow).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = (rel) => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(ROOT, rel)).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(html, w, h, dest) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0">${html}</body></html>`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: dest, clip: { x: 0, y: 0, width: w, height: h } });
}
const icon = path.join(ROOT, 'ios-res/AppIcon-1024.png');
const splash = path.join(ROOT, 'ios-res/splash-2732.png');
await render(`<div style="width:1024px;height:1024px;background:#fff"><img style="display:block;width:1024px;height:1024px" src="${svg('brand/nutriin-icon-ios.svg')}"></div>`, 1024, 1024, icon);
await render(`<div style="width:2732px;height:2732px;background:#032E36;display:flex;align-items:center;justify-content:center"><img style="width:560px;height:560px" src="${svg('brand/nutriin-mark-big.svg')}"></div>`, 2732, 2732, splash);
await browser.close();
// без алфа канал (RGB)
execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nfor p in sys.argv[1:]: Image.open(p).convert("RGB").save(p, optimize=True)', icon, splash]);
console.log('ios-res/AppIcon-1024.png, ios-res/splash-2732.png');
