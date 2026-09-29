#!/usr/bin/env node
/**
 * acuity/advanced-css-addon.css → acuity/advanced-css-full.min.css (what goes into Acuity → Advanced CSS).
 *
 * The Acuity account is shared with the other studio (xbody.as.me) and Advanced CSS applies to the whole
 * account. So every add-on rule is prefixed with :root:has(<XBODY Burgas marker>) — it acts only on a page that
 * shows the Burgas calendar's description (acuity/description.html, the images from this repo). Anywhere else
 * (the other studio, the client's account, "My appointments") the add-on does nothing.
 * The studio's own rules (first rule line of the current file) stay exactly as the studio had them.
 *
 * node scripts/build-acuity-css.mjs          → writes the file
 * node scripts/build-acuity-css.mjs --check  → fails if the file is not up to date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const addonFile = join(root, 'acuity/advanced-css-addon.css');
const outFile = join(root, 'acuity/advanced-css-full.min.css');

export const MARKER = 'img[src*="gh/Radilovk/aidiet"]';
const SCOPE = `:root:has(${MARKER})`;
// the menu after a chosen time only (the time's button is open); never the menu of a logged-in client
const MENU_SCOPE = `${SCOPE}:has(.time-selection[aria-expanded="true"])`;

/** Splits on top-level commas (not inside (), [] or strings). */
function splitTop(text) {
  const out = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of text) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function scopeSelector(sel) {
  const s = sel.replace(/\s+/g, ' ').trim();
  const scope = /div\[role="menu"\]|role="menuitem"/.test(s) ? MENU_SCOPE : SCOPE;
  if (/^:root\b/.test(s)) return scope + s.slice(5);
  if (/^html\b/.test(s)) return 'html' + scope.slice(5) + s.slice(4);   // html is :root
  return `${scope} ${s}`;
}

/** Minimal CSS reader: rules, @media (recursive), @keyframes (kept as is). */
function transform(css, depth = 0) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    let d = 1, j = open + 1, quote = '';
    for (; j < css.length && d; j++) {
      const ch = css[j];
      if (quote) { if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') d++;
      else if (ch === '}') d--;
    }
    const body = css.slice(open + 1, j - 1);
    if (head.startsWith('@keyframes')) {
      out += `${head}{${minifyBody(body, true)}}`;
    } else if (head.startsWith('@')) {
      out += `${head.replace(/\s+/g, ' ')}{${transform(body, depth + 1)}}`;
    } else {
      out += `${splitTop(head).map(scopeSelector).join(',')}{${minifyBody(body)}}`;
    }
    i = j;
  }
  return out;
}

function minifyBody(body, nested = false) {
  if (nested) return body.replace(/\s+/g, ' ').replace(/\s*([{}])\s*/g, '$1').trim();
  return body.split(';').map((d) => d.replace(/\s+/g, ' ').trim()).filter(Boolean).join(';');
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const current = readFileSync(outFile, 'utf8').split('\n');
const studio = current[1];   // line 2: the studio's own rules (unchanged)
if (!studio || !studio.startsWith('.css-11m2l4i')) throw new Error('studio rules not found on line 2 of ' + outFile);

const addon = transform(stripComments(readFileSync(addonFile, 'utf8')));
if (addon.includes('>')) throw new Error('the add-on contains ">" — Acuity\'s editor breaks it');

const result = [
  '/* XBODY Advanced CSS: правилата на студиото (без вече неработещите) + XEMS-ADDON v15 — само за XBODY Бургас: всяко правило на добавката е под :root:has(белег от описанието на календара на Бургас), другото студио и профилът на клиента не се пипат. Без знака за "по-голямо" — Acuity го поврежда */',
  studio,
  '/* XEMS-ADDON v15 (изолиран) */',
  addon,
  '',
].join('\n');

if (process.argv.includes('--check')) {
  if (readFileSync(outFile, 'utf8') !== result) { console.error('acuity/advanced-css-full.min.css is stale: node scripts/build-acuity-css.mjs'); process.exit(1); }
  console.log('acuity CSS up to date');
} else {
  writeFileSync(outFile, result);
  console.log(`acuity/advanced-css-full.min.css: ${result.length} chars`);
}
