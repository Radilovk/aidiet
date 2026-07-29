#!/usr/bin/env node
import {
  resolveFoodPickerMode,
  buildFoodPickerListPayload,
  validateFoodPickerSelection,
  buildFoodPickerRegenRequest,
  FOOD_PICKER_EXCLUSION_THRESHOLD,
  FOOD_PICKER_MIN_SELECTED,
} from '../../../plan-regen-contracts.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

console.log('-- Food-picker regeneration contracts --');

const catalog = Array.from({ length: 100 }, (_, i) => `Храна${i}`);

check('threshold = 0.6', FOOD_PICKER_EXCLUSION_THRESHOLD === 0.6);
check('min selected = 8', FOOD_PICKER_MIN_SELECTED === 8);

check('70/100 → exclusion', resolveFoodPickerMode(70, 100) === 'exclusion');
check('50/100 → inclusion', resolveFoodPickerMode(50, 100) === 'inclusion');
check('60/100 → exclusion (граница)', resolveFoodPickerMode(60, 100) === 'exclusion');

{
  const issues = validateFoodPickerSelection({ selectedCount: 3, categoryCount: 1 });
  check('малко продукти → validation fail', issues.length >= 1);
  const ok = validateFoodPickerSelection({ selectedCount: 20, categoryCount: 4 });
  check('достатъчен избор → ok', ok.length === 0);
}

{
  const selected = catalog.slice(0, 70);
  const payload = buildFoodPickerListPayload({ selected, catalogVisible: catalog });
  check('exclusion mode', payload.mode === 'exclusion');
  check('blacklist = unselected (30)', payload.blacklist.length === 30);
  check('mainlist празен в exclusion', payload.mainlist.length === 0);
  check('mainlistEnabled false', payload.mainlistEnabled === false);
}

{
  const selected = catalog.slice(0, 25);
  const payload = buildFoodPickerListPayload({ selected, catalogVisible: catalog });
  check('inclusion mode', payload.mode === 'inclusion');
  check('mainlist = selected', payload.mainlist.length === 25);
  check('blacklist празен в inclusion', payload.blacklist.length === 0);
  check('mainlistEnabled true', payload.mainlistEnabled === true);
}

{
  const selected = ['Пилешки гърди', 'Ориз', 'Бадеми'];
  const payload = buildFoodPickerListPayload({
    selected,
    catalogVisible: ['Пилешки гърди', 'Ориз', 'Бадеми', 'Ябълка'],
    blockedTerms: ['бадеми'],
  });
  check('blocked terms филтрират selected', !payload.mainlist.some(n => /бадем/i.test(n)));
}

{
  const req = buildFoodPickerRegenRequest({ name: 'Клиент', weight: 80, goal: 'Отслабване' });
  check('food-picker regen payload = userData', req.weight === 80 && !('_requireApproval' in req));
}

const passed = results.filter(Boolean).length;
console.log(`\nfood-picker: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
