// Речниците i18n/<език>/<страница>.json: валиден JSON, еднакви ключове във всички езици,
// без празни преводи, без кирилица в превода; всеки език от i18n.js има папка.
import fs from 'node:fs';
const dir = new URL('../i18n/', import.meta.url);
const js = fs.readFileSync(new URL('../i18n.js', import.meta.url), 'utf8');
const supported = JSON.parse(js.match(/var SUPPORTED = (\[[^\]]*\])/)[1].replace(/'/g, '"')).filter(l => l !== 'bg');
let fail = 0, count = 0;
const err = (m) => { console.error('✗ ' + m); fail++; };
const load = (l, f) => JSON.parse(fs.readFileSync(new URL(`${l}/${f}`, dir), 'utf8'));
for (const l of supported) if (!fs.existsSync(new URL(`${l}/`, dir))) err(`липсва i18n/${l}/`);
const ref = supported[0];
const files = fs.readdirSync(new URL(`${ref}/`, dir)).filter(f => f.endsWith('.json'));
for (const f of files) {
  const base = load(ref, f);
  for (const l of supported) {
    let d; try { d = load(l, f); } catch (e) { err(`i18n/${l}/${f}: ${e.message}`); continue; }
    for (const part of ['strings', 'keys']) {
      const a = Object.keys(base[part] || {}).sort().join('\n'), b = Object.keys(d[part] || {}).sort().join('\n');
      if (a !== b) err(`i18n/${l}/${f}: ключовете в "${part}" се различават от ${ref}`);
      for (const [k, v] of Object.entries(d[part] || {})) {
        if (!String(v).trim()) err(`i18n/${l}/${f}: празен превод за „${k}“`);
        else if (/[Ѐ-ӿ]/.test(v)) err(`i18n/${l}/${f}: кирилица в превода на „${k}“`);
      }
    }
    for (const [re] of d.patterns || []) { try { new RegExp(re); } catch (e) { err(`i18n/${l}/${f}: невалиден pattern ${re}`); } }
    count += Object.keys(d.strings || {}).length;
  }
}
// Страниците с речник трябва да са в PAGE_DICTS, иначе i18n.js не ги зарежда.
const pageDicts = JSON.parse(js.match(/var PAGE_DICTS = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
for (const f of files) { const n = f.replace(/\.json$/, ''); if (n !== 'common' && !pageDicts.includes(n)) err(`i18n/*/${f}: страницата липсва в PAGE_DICTS`); }
if (fail) process.exit(1);
console.log(`✓ i18n: ${supported.length} езика × ${files.length} речника, ${count} превода, ключовете съвпадат`);
