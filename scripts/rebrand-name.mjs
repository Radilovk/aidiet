#!/usr/bin/env node
/**
 * Сменя видимото име NutriPlan → Eatologix. Може да се пуска многократно.
 * НЕ пипа: идентификатори (window.NutriPlan*, NutriPlanX), com.biocode.nutriplan, имената на APK
 * файловете (NutriPlan-v*.apk, NutriPlan.apk — по тях старите версии намират обновления),
 * CI артефакта NutriPlan-APK, ключа за подписване и маркерите на patch-овете.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const NEW = 'Eatologix';
const SKIP = [
  /^docs\/archive\//, /^worker\.js$/, /NUTRIPLAN_FULL_TEXT_EXPORT/, /^android-res\/patch-/,
  /^\.github\/workflows\/(generate|studio-app-android)\.yml$/, /^workflows\/generator\.yml$/,
  /^app-update\.js$/, /^scripts\/rebrand-name\.mjs$/, /\.(png|jpg|jpeg|webp|ico|apk|zip|woff2?)$/i
];
const RE = /(?<![A-Za-z0-9_$])NutriPlan(?![A-Za-z0-9_]|-v\b|-v\$|-APK|\.apk)/g;
const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(f => f && !SKIP.some(r => r.test(f)));
let changed = 0, hits = 0;
for (const f of files) {
  let s; try { s = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (!s.includes('NutriPlan')) continue;
  const n = (s.match(RE) || []).length; if (!n) continue;
  fs.writeFileSync(f, s.replace(RE, NEW)); changed++; hits += n;
}
console.log(`rebrand: ${hits} замени в ${changed} файла`);
