import test from 'node:test';
import assert from 'node:assert/strict';
import { activeQuestions } from '../questions.js';

test('activeQuestions винаги връща масив', () => {
  assert.ok(Array.isArray(activeQuestions({})));
  assert.ok(activeQuestions({}).length > 0);
  assert.ok(Array.isArray(activeQuestions({ basics: { gender: 'Жена' } })));
});

test('renderStep с празен списък не хвърля (qs защита)', async () => {
  const { createWizardController } = await import('../wizard-ui.js');
  const wizard = createWizardController({
    getEl: () => null,
    getQuestions: () => undefined,
    visibleOptions: () => [],
    validateQuestion: () => null,
    getState: () => ({}),
  });
  assert.doesNotThrow(() => wizard.renderStep());
});
