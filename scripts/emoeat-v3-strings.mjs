// Всички текстове на EmoEat v3, които се показват на човека: въпросите във всички варианти
// (неутралните форми — те се превеждат), чертите, архетипите, кръговете, бележките и
// статичните текстове от emoeat.html. Изход: JSON списък; с --missing <речник> — само липсващите.
//   node scripts/emoeat-v3-strings.mjs [--missing i18n/en/emoeat.json]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const V3 = require('../emoeat-v3.js');

const out = new Set();
const add = (s) => { if (s && /[Ѐ-ӿ]/.test(s)) out.add(String(s).replace(/\s+/g, ' ').trim()); };

// Въпросите — всички контексти, с неутрален текст (както ги вижда човек на друг език).
const set = (m, id, key) => { m[id] = { optionKey: key, optionKeys: [key] }; };
for (const sex of ['F', 'M', 'X']) for (const age of 'ABCDEFGH') for (const occ of 'ABCDEFG') for (const home of 'ABCDEF') {
  const m = {}; set(m, 201, sex); set(m, 202, age); set(m, 203, occ); set(m, 204, home);
  const ctx = V3.contextFrom(m, {});
  for (const q of V3.buildFlow(Object.assign({}, ctx, { neutral: true }))) {
    add(q.category); add(q.text); add(q.hint); q.options.forEach(o => add(o.text));
  }
}
for (const t of Object.values(V3.TRAITS)) { add(t.name); add(t.portrait); add(t.bridge); }
for (const a of V3.ARCHETYPES.concat([V3.CALM])) {
  add(a.name); add(a.description); add(a.plan.focus);
  a.plan.actions.forEach(x => { add(x.title); add(x.when); add(x.how); });
  a.plan.sos.forEach(add);
  a.plan.swaps.forEach(s => { add(s.when); s.try.forEach(add); });
}
V3.PATTERNS.forEach(p => { add(p.title); add(p.description); });
Object.values(V3.NOTES).forEach(add);

// Динамичните текстове от emoeat.html (низове в JS шаблоните на резултата и навигацията).
const html = fs.readFileSync(new URL('../emoeat.html', import.meta.url), 'utf8');
const script = html.slice(html.indexOf('// ТЕСТЪТ — EmoEat v3'));
for (const m of script.matchAll(/(['`])((?:(?!\1)[^\\\n$]|\\.)*?[Ѐ-ӿ](?:(?!\1)[^\\\n$]|\\.)*?)\1/g)) {
  if (/^[a-z_]+$/.test(m[2])) continue;
  add(m[2]);
}
// Текстът между таговете в шаблоните (без ${…}).
for (const m of script.matchAll(/>([^<>${}`]*[Ѐ-ӿ][^<>${}`]*)</g)) add(m[1]);
// Надеждността в emoeat-v3.js.
const src = fs.readFileSync(new URL('../emoeat-v3.js', import.meta.url), 'utf8');
for (const m of src.matchAll(/note = '([^']+)'/g)) add(m[1]);
// Статичният HTML.
const statics = JSON.parse(execFileSync('python3', [new URL('./i18n-extract.py', import.meta.url).pathname, new URL('../emoeat.html', import.meta.url).pathname], { encoding: 'utf8' }));
statics.forEach(add);

let list = [...out].filter(s => !/^(Силно|Осезаемо|Слабо|висока|средна|ниска)$/.test(s) || true);
const i = process.argv.indexOf('--missing');
if (i >= 0) {
  const have = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8')).strings || {};
  const pats = (JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8')).patterns || []).map(([re]) => new RegExp(re));
  list = list.filter(s => !(s in have) && !pats.some(re => re.test(s)));
}
console.log(JSON.stringify(list, null, 0));
