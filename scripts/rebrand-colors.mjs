#!/usr/bin/env node
/**
 * Тюркоазената гама (Tailwind teal) → гамата на логото EATOLOGIX (циан-тюркоаз, тъмен край #034E5C).
 * Само файловете на приложението (не xbody/studio/fitness/emoeat). Може да се пуска многократно.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const HEX = {
  F0FDFA: 'EEFDFC', CCFBF1: 'CDF9F6', '99F6E4': '9BF2EE', '5EEAD4': '5FE6E3', '2DD4BF': '19D6D2',
  '14B8A6': '04B7BD', '0D9488': '03939C', '0F766E': '05737D', '115E59': '075C66', '134E4A': '034E5C', '042F2E': '032E36'
};
const RGB = [
  [[45, 212, 191], [25, 214, 210]], [[20, 184, 166], [4, 183, 189]], [[13, 148, 136], [3, 147, 156]],
  [[15, 118, 110], [5, 115, 125]], [[94, 234, 212], [95, 230, 227]], [[17, 94, 89], [7, 92, 102]], [[4, 47, 46], [3, 46, 54]]
];
const OTHER = /^(worker\.js|fitness\/|studio|xbody|xb-|acuity\/|emoeat|kids|pep|reta|aix|lqto|vaprosnik|dopamine|health\.html|scripts\/|data\/|KV\/|viber|workflows\/|migrations\/|samples\/|clients\/|docs\/|nutrition-library\/|android-res\/|\.github\/|brand\/|NUTRIPLAN_FULL)/;
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n')
  .filter(f => /\.(html|css|js|json)$/.test(f) && !OTHER.test(f));
const hexRe = new RegExp('#(' + Object.keys(HEX).join('|') + ')\\b', 'gi');
let total = 0, nfiles = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8'); let n = 0;
  let t = s.replace(hexRe, (m, h) => { n++; const v = HEX[h.toUpperCase()]; return '#' + (h === h.toLowerCase() ? v.toLowerCase() : v); });
  for (const [[r, g, b], [R, G, B]] of RGB) {
    t = t.replace(new RegExp(`(rgba?\\(\\s*)${r}(\\s*,\\s*)${g}(\\s*,\\s*)${b}(?=\\s*[,)])`, 'g'), (m, a, c1, c2) => { n++; return `${a}${R}${c1}${G}${c2}${B}`; });
  }
  if (t !== s) { fs.writeFileSync(f, t); total += n; nfiles++; }
}
console.log(`colors: ${total} замени в ${nfiles} файла`);
