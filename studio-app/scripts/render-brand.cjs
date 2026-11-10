#!/usr/bin/env node
/**
 * Every icon and splash of the app from one vector (brand/xbody-logo.svg), so nothing is ever upscaled from a small raster.
 *   node studio-app/scripts/render-brand.cjs        (needs Playwright + Chromium; run from anywhere)
 * Writes: assets/splash.png, assets/splash-dark.png (2732², the logo in the middle at the same size as before),
 *         assets/icon-only.png (1024², white, no transparency — Apple), assets/icon-foreground.png (1024², transparent,
 *         the logo in Android's safe zone), android-extra/splash_logo.png (576² = 144 dp at xxxhdpi, so no phone scales it up).
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'brand/xbody-logo.svg'), 'utf8').replace(/<!--[\s\S]*?-->\s*/, '');
const jobs = [
  // file, canvas, logo size, background (null = transparent)
  ['assets/splash.png', 2732, 518, '#ffffff'],
  ['assets/splash-dark.png', 2732, 518, '#121014'],
  ['assets/icon-only.png', 1024, 876, '#ffffff'],
  ['assets/icon-foreground.png', 1024, 653, null],
  ['android-extra/splash_logo.png', 576, 576, null],
];

(async () => {
  const browser = await chromium.launch();
  for (const [file, canvas, logo, bg] of jobs) {
    const page = await browser.newPage({ viewport: { width: canvas, height: canvas }, deviceScaleFactor: 1 });
    const off = (canvas - logo) / 2;
    await page.setContent(`<html><body style="margin:0;background:${bg || 'transparent'}">
      <div style="position:absolute;left:${off}px;top:${off}px;width:${logo}px;height:${logo}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`);
    await page.screenshot({ path: path.join(root, file), omitBackground: !bg });
    await page.close();
    console.log(file, `${canvas}px, logo ${logo}px`);
  }
  await browser.close();
})();
