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

// ── Критичните състояния: питаме „наблюдаваш ли се от лекар“, спираме само при „не“ ──
{
  const { criticalGate, detectCritical } = await import('../questionnaire-validation.mjs');
  const base = { name: 'А', age: 40, weight: 80, height: 175 };
  assert.equal(criticalGate({ ...base, medicalConditions: ['Хипертония (високо кръвно налягане)'] }).questions.length, 0, 'хипертонията не е спиращо състояние');
  const g = criticalGate({ ...base, medicalConditions: ['Сърдечна недостатъчност'] });
  assert.equal(g.questions.length, 1); assert.equal(g.stop, null);
  assert.ok(criticalGate({ ...base, medicalConditions: ['Сърдечна недостатъчност'], criticalFollowUp: { heart_failure: 'none' } }).stop);
  const ok = criticalGate({ ...base, medicalConditions: ['Сърдечна недостатъчност'], criticalFollowUp: { heart_failure: 'treated' } });
  assert.equal(ok.stop, null); assert.equal(ok.questions.length, 0); assert.equal(ok.notes.length, 1);
  assert.deepEqual(detectCritical({ ...base, medicalConditions: ['Диабет / Инсулинова резистентност'] }), [], 'инсулинова резистентност не е критична');
  assert.equal(detectCritical({ ...base, compensationMethods: ['Повръщане'] })[0].key, 'eating_disorder');
  console.log('✓ критични състояния: въпрос, спиране само без лекар');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
