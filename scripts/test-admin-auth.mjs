#!/usr/bin/env node
/**
 * Контрактни тестове за централния admin guard.
 *
 * Пази три инварианта:
 *   1. /api/admin/* без валидна тайна → 401 (deny by default)
 *   2. Липсващ ADMIN_SECRET → 503, НЕ отворен достъп (fail-closed)
 *   3. Клиентските маршрути под /api/admin/* остават достъпни
 *
 * Тестът работи срещу бандъла (worker.js), защото точно той се деплойва.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`❌ ${name}: ${e.message || e}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const bundle = readFileSync(join(root, 'worker.js'), 'utf8');

// esbuild нормализира кавичките, затова шаблоните са неутрални спрямо ' и ".
check('bundle съдържа централния guard', () => {
  assert(
    /startsWith\(["']\/api\/admin\/["']\)\s*&&\s*!isClientReachableAdminRoute/.test(bundle),
    'централната проверка за /api/admin/ липсва в worker.js',
  );
});

check('нито един checkAdminSecret не е fail-open', () => {
  // Покрива и основния worker, и вградения fitness worker.
  const failOpen = bundle.match(/env\.ADMIN_SECRET;\s*\n\s*if \(!secret\) return true;/g);
  assert(
    !failOpen,
    `${failOpen?.length ?? 0} fail-open проверки на ADMIN_SECRET още са в бандъла`,
  );
  assert(
    /if \(!secret\) return false;/.test(bundle),
    'checkAdminSecret трябва да връща false при липсваща тайна',
  );
});

check('fitness worker е fail-closed и самостоятелно', () => {
  const src = readFileSync(join(root, 'fitness/worker.js'), 'utf8');
  // Махаме коментарите — иначе документацията на самия фикс дава фалшив хит.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fn = code.match(/function checkAdminSecret\(request, env\) \{[\s\S]*?\n\}/);
  assert(fn, 'checkAdminSecret липсва във fitness/worker.js');
  assert(
    /if \(!secret\) return false;/.test(fn[0]),
    'fitness/worker.js е fail-open (деплойва се отделно, не го покрива централният guard!)',
  );
});

check('липсващ ADMIN_SECRET дава 503, не достъп', () => {
  // esbuild escape-ва кирилицата в \u, затова проверяваме структурата:
  // requireAdminAuth трябва да връща 503 преди каквато и да е диспечеризация.
  const fn = bundle.match(/function requireAdminAuth\(request, env\) \{[\s\S]*?\n\}/);
  assert(fn, 'requireAdminAuth липсва в бандъла');
  assert(/!env\.ADMIN_SECRET/.test(fn[0]), 'requireAdminAuth не проверява за липсваща тайна');
  assert(/503/.test(fn[0]), 'requireAdminAuth не връща 503 при липсваща тайна');
  assert(/401/.test(fn[0]), 'requireAdminAuth не връща 401 при грешна тайна');
});

check('клиентските admin маршрути са явно изброени', () => {
  for (const route of [
    '/api/admin/update-client-plan',
    '/api/admin/get-blacklist',
    '/api/admin/get-all-protocol-images',
  ]) {
    assert(bundle.includes(route), `${route} липсва от allowlist-а`);
  }
});

check('няма hardcoded админ парола в клиентския код', () => {
  const files = [
    'admin.html',
    'food-catalog.html',
    'fitness/exercise-catalog.html',
    'fitness/exercise-catalog-swipe.html',
  ];
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    assert(!src.includes('nutriplan2024'), `${f} все още съдържа вградена парола`);
  }
});

check('admin.html не пази "влязъл" флаг вместо тайна', () => {
  const src = readFileSync(join(root, 'admin.html'), 'utf8');
  assert(
    !/localStorage\.setItem\('adminLoggedIn'/.test(src),
    'admin.html все още маркира вход само с localStorage флаг',
  );
});

if (failures.length) {
  console.error(`\n❌ ${failures.length} провалени проверки: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n✅ Admin auth контракт: всички проверки минаха');
