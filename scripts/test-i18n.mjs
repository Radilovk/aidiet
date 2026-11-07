// Речниците i18n/*.json: валиден JSON, едни и същи ключове във всички езици, без празни преводи.
import fs from 'node:fs';
const dir = new URL('../i18n/', import.meta.url);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let fail = 0;
const load = f => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
const ref = load(files[0]);
for (const f of files) {
  const d = load(f);
  for (const part of ['strings', 'keys']) {
    const a = Object.keys(ref[part]).sort().join('\n'), b = Object.keys(d[part]).sort().join('\n');
    if (a !== b) { console.error(`✗ ${f}: ключовете в "${part}" се различават от ${files[0]}`); fail++; }
    for (const [k, v] of Object.entries(d[part])) if (!String(v).trim()) { console.error(`✗ ${f}: празен превод за „${k}“`); fail++; }
  }
  for (const [re] of d.patterns || []) { try { new RegExp(re); } catch (e) { console.error(`✗ ${f}: невалиден pattern ${re}`); fail++; } }
}
const js = fs.readFileSync(new URL('../i18n.js', import.meta.url), 'utf8');
const supported = JSON.parse(js.match(/var SUPPORTED = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
for (const l of supported) if (l !== 'bg' && !files.includes(`${l}.json`)) { console.error(`✗ липсва i18n/${l}.json`); fail++; }
if (fail) process.exit(1);
console.log(`✓ i18n: ${files.length} речника, ${Object.keys(ref.strings).length} текста, ключовете съвпадат`);
