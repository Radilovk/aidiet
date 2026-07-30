import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapAnswersToDslInput,
  resolveSplit,
  allocateWeekDays,
  sessionExerciseBudget,
  buildDslSpec,
  formatDslSpecBlock,
  auditPlanDsl,
  classifyMovementPatterns,
} from '../training-dsl.js';
import { buildAdminPlanUserPrompt } from '../plan-generation.js';

const SAMPLE_ANSWERS = {
  gender: 'Жена',
  experience: 'Никакъв / начинаещ (0–6 месеца системно)',
  goal: { main: 'Рекомпозиция', zones: 'дупе, бедра' },
  preferences: { freq: '3–4', duration: '45–60 мин', types: ['Силов тренинг'] },
  equipment: ['Дъмбели', 'Ластици'],
  limitations: ['Нямам ограничения'],
};

describe('mapAnswersToDslInput', () => {
  it('мапва анкета към DSL input', () => {
    const input = mapAnswersToDslInput(SAMPLE_ANSWERS);
    assert.equal(input.goal, 'shape');
    assert.equal(input.freq, 3);
    assert.equal(input.session_min, 60);
    assert.equal(input.env, 'dumbbells');
    assert.equal(input.priority, 'glute');
  });
});

describe('resolveSplit', () => {
  it('freq≤3 → FULLBODY', () => {
    const s = resolveSplit({ freq: 3 });
    assert.equal(s.template, 'FULLBODY');
    assert.ok(s.variants.includes('A'));
  });

  it('freq=4 + glute priority → AP', () => {
    const s = resolveSplit({ freq: 4, priority: 'glute' });
    assert.equal(s.template, 'AP');
  });
});

describe('allocateWeekDays', () => {
  it('разпределя S/C2/M по цел shape', () => {
    const input = mapAnswersToDslInput(SAMPLE_ANSWERS);
    const split = resolveSplit(input);
    const { week, counts } = allocateWeekDays(input, split);
    assert.equal(counts.S, 3);
    assert.equal(week.filter((d) => d.dslType === 'S').length, 3);
    assert.ok(week.some((d) => d.dslType === 'M'));
    assert.equal(week.length, 7);
  });
});

describe('sessionExerciseBudget', () => {
  it('45 мин → 4 compound', () => {
    const b = sessionExerciseBudget(45);
    assert.equal(b.compound, 4);
    assert.equal(b.isolation, 1);
  });
});

describe('buildDslSpec + formatDslSpecBlock', () => {
  it('генерира компактен prompt блок', () => {
    const spec = buildDslSpec(SAMPLE_ANSWERS);
    const block = formatDslSpecBlock(spec);
    assert.ok(block.includes('<dsl_spec>') === false);
    assert.ok(block.includes('DSL v4'));
    assert.ok(block.includes('week plan:'));
    assert.ok(block.includes('squat ⊥ hinge'));
  });
});

describe('auditPlanDsl', () => {
  it('хваща squat+hinge в една сесия', () => {
    const dslSpec = buildDslSpec(SAMPLE_ANSWERS);
    const plan = {
      days: [
        {
          day: 'Понеделник',
          type: 'strength',
          exercises: [
            { canonicalName: 'barbell squat', sets: 3 },
            { canonicalName: 'romanian deadlift', sets: 3 },
          ],
        },
      ],
    };
    const issues = auditPlanDsl(plan, dslSpec);
    assert.ok(issues.some((i) => /squat.*hinge/i.test(i)));
  });

  it('преминава валиден strength ден', () => {
    const dslSpec = buildDslSpec(SAMPLE_ANSWERS);
    const plan = {
      days: dslSpec.week.map((d) => ({
        day: d.day,
        type: d.appType,
        exercises: d.appType === 'strength'
          ? [
            { canonicalName: 'dumbbell bench press', sets: 3 },
            { canonicalName: 'dumbbell row', sets: 3 },
            { canonicalName: '3/4 sit-up', sets: 3 },
          ]
          : [],
      })),
    };
    const issues = auditPlanDsl(plan, dslSpec);
    assert.ok(!issues.some((i) => /squat.*hinge/i.test(i)));
  });
});

describe('classifyMovementPatterns', () => {
  it('разпознава squat и hinge', () => {
    assert.ok(classifyMovementPatterns('barbell squat').has('squat'));
    assert.ok(classifyMovementPatterns('romanian deadlift').has('hinge'));
    assert.ok(!classifyMovementPatterns('dumbbell curl').has('squat'));
  });
});

describe('prompt integration', () => {
  it('buildAdminPlanUserPrompt включва dsl_spec', () => {
    const dslSpec = buildDslSpec(SAMPLE_ANSWERS);
    const prompt = buildAdminPlanUserPrompt({
      clientProfile: 'Клиент',
      tags: new Set(),
      dslSpec,
    });
    assert.ok(prompt.includes('<dsl_spec>'));
    assert.ok(prompt.includes('week plan:'));
  });
});
