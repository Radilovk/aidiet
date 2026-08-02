#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  runDeterministicValidation,
  validateLiveField,
  calculateBmiFromMetrics,
} from '../questionnaire-validation.mjs';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const base = {
  name: 'Мария',
  gender: 'Жена',
  age: '35',
  height: '165',
  weight: '70',
  goal: 'Поддържане',
  email: 'a@b.com',
};

{
  const r = runDeterministicValidation(base);
  check('valid profile passes', r.isValid && r.issues.length === 0);
}

{
  const r = runDeterministicValidation({ ...base, height: '1.65' });
  check('height in meters flagged', r.issues.some(i => i.field === 'height'), r.issues[0]?.description);
}

{
  const r = runDeterministicValidation({ ...base, weight: '10' });
  check('low weight blocked', !r.isValid && r.issues.some(i => i.field === 'weight'));
}

{
  const r = runDeterministicValidation({
    ...base,
    weight: '50',
    height: '165',
    goal: 'Отслабване',
    lossKg: '40',
  });
  check('excessive lossKg blocked', r.issues.some(i => i.field === 'lossKg'));
}

{
  const r = runDeterministicValidation({
    ...base,
    weight: '48',
    height: '170',
    goal: 'Отслабване',
    lossKg: '3',
  });
  check('underweight + loss goal contradiction', r.hasContradiction && r.issues.some(i => i.field === 'goal'));
}

{
  const live = validateLiveField('height', '1.65', base);
  check('live height meters hint', !live.valid && live.message.includes('метри'));
}

{
  const bmi = calculateBmiFromMetrics(70, 165);
  check('bmi calc', bmi > 25 && bmi < 26, String(bmi.toFixed(1)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
