/**
 * Тестове за локалната логика на KA-TRAINER (без мрежа, без AI):
 *   node --test test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeText,
  tokenize,
  tokenOverlapScore,
  buildCompactIndex,
  matchExercise,
  findAlternatives,
  allowedEquipmentSet,
  selectGuidelines,
  selectGuidelinesFromBrief,
  capGuidelineTexts,
  buildPlanUserPrompt,
  buildAdminPlanUserPrompt,
  buildBriefIdentityBlock,
  buildProfileSummary,
  buildCoachContext,
  parseAiJson,
  normalizePlan,
  enrichPlanWithExercises,
} from '../worker.js';

import { QUESTIONS, visibleOptions, validateQuestion, buildAnswers } from '../questions.js';
import { localizeExerciseDisplayName, sanitizeBgText } from '../exercise-labels-bg.js';

// ----------------------------------------------------------------------------
// Fixtures: миниатюрна извадка със схемата на hasaneyldrm/exercises-dataset
// ----------------------------------------------------------------------------

const RAW_DATASET = [
  { id: '0001', name: 'Barbell Bench Press', equipment: 'barbell', target: 'pectorals', body_part: 'chest', secondary_muscles: ['triceps', 'shoulders'], image: 'images/0001.jpg', gif_url: 'gifs/0001.gif', instructions: { en: 'Lie on bench...', bg: 'Легни на лежанката...' } },
  { id: '0002', name: 'Dumbbell Bench Press', equipment: 'dumbbell', target: 'pectorals', body_part: 'chest', secondary_muscles: ['triceps'], image: 'images/0002.jpg', gif_url: 'gifs/0002.gif', instructions: { en: 'Hold dumbbells...' } },
  { id: '0003', name: 'Dumbbell Incline Bench Press', equipment: 'dumbbell', target: 'pectorals', body_part: 'chest', secondary_muscles: [], image: 'images/0003.jpg', gif_url: 'gifs/0003.gif', instructions: {} },
  { id: '0004', name: 'Push-up', equipment: 'body weight', target: 'pectorals', body_part: 'chest', secondary_muscles: [], image: 'images/0004.jpg', gif_url: 'gifs/0004.gif', instructions: {} },
  { id: '0005', name: 'Barbell Deadlift', equipment: 'barbell', target: 'glutes', body_part: 'upper legs', secondary_muscles: ['hamstrings'], image: 'images/0005.jpg', gif_url: 'gifs/0005.gif', instructions: {} },
  { id: '0006', name: 'Lat Pulldown', equipment: 'cable', target: 'lats', body_part: 'back', secondary_muscles: ['biceps'], image: 'images/0006.jpg', gif_url: 'gifs/0006.gif', instructions: {} },
  { id: '0007', name: 'Band Chest Press', equipment: 'band', target: 'pectorals', body_part: 'chest', secondary_muscles: [], image: 'images/0007.jpg', gif_url: 'gifs/0007.gif', instructions: {} },
  { id: '0008', name: 'Cable Fly', equipment: 'cable', target: 'pectorals', body_part: 'chest', secondary_muscles: [], image: 'images/0008.jpg', gif_url: 'gifs/0008.gif', instructions: {} },
];

const INDEX = buildCompactIndex(RAW_DATASET);

// ----------------------------------------------------------------------------
// Нормализация и token score
// ----------------------------------------------------------------------------

test('normalizeText: долен регистър, без пунктуация и диакритика', () => {
  assert.equal(normalizeText('Barbell Bench-Press!'), 'barbell bench press');
  assert.equal(normalizeText('  Décliné  Press '), 'decline press');
  assert.equal(normalizeText('Лег преса с щанга'), 'лег преса с щанга');
});

test('tokenize: разбива на думи', () => {
  assert.deepEqual(tokenize('Barbell Bench Press'), ['barbell', 'bench', 'press']);
  assert.deepEqual(tokenize(''), []);
});

test('tokenOverlapScore: формулата от спецификацията', () => {
  // 3 общи думи / max(3, 3) = 1.0
  assert.equal(tokenOverlapScore(tokenize('Barbell Bench Press'), tokenize('Barbell Bench Press')), 1);
  // 2 общи / max(2, 3) = 0.667
  const partial = tokenOverlapScore(tokenize('Bench Press'), tokenize('Barbell Bench Press'));
  assert.ok(Math.abs(partial - 2 / 3) < 1e-9);
  assert.equal(tokenOverlapScore([], tokenize('x')), 0);
});

// ----------------------------------------------------------------------------
// Matching (примерите от Част 2 на спецификацията)
// ----------------------------------------------------------------------------

test('matchExercise: точни съвпадения score 1.0', () => {
  for (const [canonical, hint, expected] of [
    ['Barbell Bench Press', 'barbell', 'Barbell Bench Press'],
    ['Dumbbell Incline Bench Press', '', 'Dumbbell Incline Bench Press'],
    ['Barbell Deadlift', '', 'Barbell Deadlift'],
    ['Lat Pulldown', 'cable', 'Lat Pulldown'],
  ]) {
    const result = matchExercise(INDEX, { canonicalName: canonical, equipmentHint: hint, bodyPart: '' });
    assert.equal(result.entry.name, expected);
    assert.equal(result.usedFallback, false);
    assert.ok(result.score >= 1, `score за ${canonical} е ${result.score}`);
  }
});

test('matchExercise: equipmentHint разграничава близки имена', () => {
  // "Bench Press" пасва еднакво на barbell и dumbbell вариантите — hint-ът решава
  const withDumbbell = matchExercise(INDEX, { canonicalName: 'Bench Press', equipmentHint: 'dumbbell', bodyPart: 'chest' });
  assert.equal(withDumbbell.entry.name, 'Dumbbell Bench Press');
  const withBarbell = matchExercise(INDEX, { canonicalName: 'Bench Press', equipmentHint: 'barbell', bodyPart: 'chest' });
  assert.equal(withBarbell.entry.name, 'Barbell Bench Press');
});

test('matchExercise: под прага → fallback по категория, не празно поле', () => {
  const result = matchExercise(INDEX, { canonicalName: 'Totally Unknown Movement Pattern', equipmentHint: '', bodyPart: 'chest' });
  assert.ok(result, 'очаква се fallback резултат');
  assert.equal(result.usedFallback, true);
  assert.equal(result.entry.bodyNorm, 'chest');
});

test('matchExercise: празен индекс → null', () => {
  assert.equal(matchExercise([], { canonicalName: 'x' }), null);
  assert.equal(matchExercise(null, { canonicalName: 'x' }), null);
});

// ----------------------------------------------------------------------------
// Алтернативи
// ----------------------------------------------------------------------------

test('findAlternatives: същата цел, само позволено оборудване, без самото упражнение', () => {
  const bench = INDEX.find((e) => e.name === 'Barbell Bench Press');
  const allowed = new Set(['body weight', 'dumbbell']);
  const alts = findAlternatives(INDEX, bench, { allowedEquipment: allowed, limit: 3 });

  assert.ok(alts.length >= 2 && alts.length <= 3);
  for (const alt of alts) {
    assert.notEqual(alt.id, bench.id);
    assert.ok(allowed.has(alt.equipNorm), `непозволено оборудване: ${alt.equipment}`);
    assert.equal(alt.targetNorm, 'pectorals');
  }
});

test('findAlternatives: без филтър (пълна зала) връща до limit', () => {
  const bench = INDEX.find((e) => e.name === 'Barbell Bench Press');
  const alts = findAlternatives(INDEX, bench, { allowedEquipment: null, limit: 3 });
  assert.equal(alts.length, 3);
});

// ----------------------------------------------------------------------------
// Оборудване BG → EN
// ----------------------------------------------------------------------------

test('allowedEquipmentSet: mapping от въпросника', () => {
  const set = allowedEquipmentSet(['Дъмбели', 'Ластици']);
  assert.ok(set.has('dumbbell'));
  assert.ok(set.has('band'));
  assert.ok(set.has('resistance band'));
  assert.ok(set.has('body weight'), 'собственото тегло е винаги налично');
  assert.ok(!set.has('barbell'));
});

test('allowedEquipmentSet: пълна зала → null (без филтър)', () => {
  assert.equal(allowedEquipmentSet(['Пълно оборудване на зала']), null);
  assert.equal(allowedEquipmentSet(['Дъмбели', 'Пълно оборудване на зала']), null);
});

// ----------------------------------------------------------------------------
// Mini-RAG насоки
// ----------------------------------------------------------------------------

test('selectGuidelines: извлича само релевантните порции', () => {
  const guidelines = selectGuidelines({
    goal: { main: 'Покачване на мускулна маса' },
    experience: 'Среден (2–5 години)',
    health: ['Хипертония'],
    healthFemale: [],
    equipment: ['Пълно оборудване на зала'],
    preferences: { timeOfDay: 'Вечер' },
    age: 34,
    sleep: 'Добро, събуждам се отпочинал/а',
    stress: 4,
  });
  const joined = guidelines.join('\n');
  assert.ok(joined.includes('Хипертрофия'), 'очаква се насока за хипертрофия');
  assert.ok(joined.includes('сърдечно-съдов риск'), 'очаква се насока за хипертония');
  assert.ok(joined.includes('Среден опит'), 'очаква се насока за средно ниво');
  assert.ok(!joined.includes('бременност'), 'не трябва да включва нерелевантни насоки');
  assert.ok(!joined.includes('Сутрешни'), 'тренира вечер — без сутрешна насока');
});

test('selectGuidelines: бременност и начинаещ', () => {
  const guidelines = selectGuidelines({
    goal: { main: 'Обща кондиция' },
    experience: 'Никакъв / начинаещ (0–6 месеца системно)',
    health: [],
    healthFemale: ['Бременна — триместър: втори'],
    equipment: ['Собствено тегло'],
    age: 29,
  });
  const joined = guidelines.join('\n');
  assert.ok(joined.includes('бременност'));
  assert.ok(joined.includes('Начинаещи'));
  assert.ok(joined.includes('Ограничено оборудване'));
});

test('selectGuidelines: слива админ chunks и ограничава обема', () => {
  const guidelines = selectGuidelines(
    { goal: { main: 'Отслабване' }, experience: 'Начинаещ', health: [], healthFemale: [], equipment: ['Дъмбели'], age: 25 },
    {
      chunks: [
        { tags: ['goal:отслабване'], text: 'АДМИН: персонален акцент върху NEAT и ходене.' },
        { tags: ['level:начинаещ'], text: 'АДМИН: първо овладяване на шаблон движения.' },
      ],
    },
  );
  const joined = guidelines.join('\n');
  assert.ok(joined.includes('АДМИН: персонален акцент'));
  assert.ok(joined.includes('АДМИН: първо овладяване'));
  assert.ok(!joined.includes('комбинирай съпротивителен тренинг'), 'админ chunk замества hardcoded за goal:отслабване');
  assert.ok(joined.length <= 2400);
  assert.ok(guidelines.length <= 8);
});

test('selectGuidelinesFromBrief: извлича релевантни насоки по таг (без несъвпадащи chunks)', () => {
  const guidelines = selectGuidelinesFromBrief(
    {
      clientProfile: 'Жена, 34 г., цел отслабване, начинаеща, хипертония, лош сън.',
      exampleScheme: 'Схема C + LISS, 3 тренировки седмично.',
    },
    {
      foundation: 'Базов принцип тест.',
      chunks: [
        { tags: ['goal:отслабване'], text: 'АДМИН отслабване: схема C + LISS.' },
        { tags: ['health:хипертония'], text: 'АДМИН ВАЖНО: без Валсалва.' },
        { tags: ['goal:силови показатели'], text: 'АДМИН сила: не се ползва при този клиент.' },
        { tags: ['gender:жена'], text: 'АДМИН жена: акцент glutes и крака.' },
      ],
    },
  );
  const joined = guidelines.join('\n');
  assert.ok(joined.includes('АДМИН отслабване'));
  assert.ok(joined.includes('АДМИН ВАЖНО'));
  assert.ok(joined.includes('АДМИН жена'));
  assert.ok(joined.includes('Жена: програмирай за женска физиология'), 'hardcoded gender:жена chunk');
  assert.ok(!joined.includes('АДМИН сила'), 'несъвпадащ chunk по goal:силови не влиза');
  assert.ok(!joined.includes('комбинирай съпротивителен тренинг'));
});

test('selectGuidelinesFromBrief: универсални admin chunks (без таг) винаги влизат', () => {
  const guidelines = selectGuidelinesFromBrief(
    { clientProfile: 'Жена, 28 г., отслабване.', exampleScheme: '' },
    {
      chunks: [
        { tags: [], text: 'УНИВЕРСАЛНО: винаги загрявка 8 мин.' },
        { tags: ['goal:силови показатели'], text: 'Само за сила — не за този клиент.' },
      ],
    },
  );
  const joined = guidelines.join('\n');
  assert.ok(joined.includes('УНИВЕРСАЛНО'));
  assert.ok(!joined.includes('Само за сила'));
});

test('buildBriefIdentityBlock: жена → изричен полов блок', () => {
  const block = buildBriefIdentityBlock({
    clientProfile: 'Жена, 32 г., цел релеф, 3 тренировки.',
    exampleScheme: 'Пон: glutes, Сря: гръб',
  });
  assert.ok(block.includes('Пол: ЖЕНА'));
  assert.ok(block.includes('gender:жена'));
  assert.ok(block.includes('провери'));
});

test('buildAdminPlanUserPrompt: женски профил + идентичност най-отгоре', () => {
  const prompt = buildAdminPlanUserPrompt({
    clientProfile: 'Жена, 28 г., цел: релеф',
    exampleScheme: 'Пон: glutes — hip thrust 4x12\nБез бърпита',
  }, ['Насока за жена'], 'Принцип А');
  assert.ok(prompt.indexOf('Пол: ЖЕНА') < prompt.indexOf('ПРОФИЛ И ДАННИ'));
  assert.ok(prompt.includes('Жена, 28 г.'));
  assert.ok(prompt.includes('hip thrust'));
  assert.ok(prompt.includes('Насока за жена'));
  assert.ok(prompt.includes('НИТО ЕДНО изречение'));
});

test('capGuidelineTexts: спазва лимити', () => {
  const capped = capGuidelineTexts(['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(3000)], 2, 150);
  assert.equal(capped.length, 2);
  assert.ok(capped.join('').length <= 150);
});

test('buildPlanUserPrompt: foundation не влиза в system prompt структурата', () => {
  const prompt = buildPlanUserPrompt('Профил', ['Насока 1'], 'Принцип А');
  assert.ok(prompt.includes('БАЗОВИ ПРИНЦИПИ'));
  assert.ok(prompt.includes('Принцип А'));
  assert.ok(prompt.includes('Насока 1'));
});

test('selectGuidelines: пол жена → gender chunk', () => {
  const guidelines = selectGuidelines(
    { gender: 'Жена', goal: { main: 'Отслабване' }, experience: 'Начинаещ', health: [], healthFemale: [], equipment: ['Дъмбели'], age: 30 },
    null,
  );
  const joined = guidelines.join('\n');
  assert.ok(joined.includes('Жена: програмирай за женска физиология'));
});

test('buildAdminPlanUserPrompt: включва профил, схема и указания от треньора', () => {
  const prompt = buildAdminPlanUserPrompt({
    clientProfile: 'Жена, 28 г., цел: релеф',
    exampleScheme: 'Пон: гръб — лат пулдаун 4x10\nБез бърпита',
  }, [], 'Принцип А');
  assert.ok(prompt.includes('РЕЖИМ: Треньорът'));
  assert.ok(prompt.includes('Жена, 28 г.'));
  assert.ok(prompt.includes('лат пулдаун'));
  assert.ok(prompt.includes('Без бърпита'));
  assert.ok(prompt.includes('Принцип А'));
});

// ----------------------------------------------------------------------------
// Профил и контекст за треньора
// ----------------------------------------------------------------------------

const SAMPLE_ANSWERS = {
  gender: 'Мъж', age: 34, heightCm: 178, weightKg: 82,
  health: ['Хипертония'], healthFemale: [], healthMeds: '', healthOther: '',
  limitations: ['Болка при конкретно движение без официална диагноза: преса над глава'],
  weightChange: { type: 'gain', amountKg: 5, reason: 'спрях спорта' },
  sleep: 'Средно, понякога прекъснат сън', stress: 6,
  dailyActivity: 'Заседнала работа, минимално движение',
  sportActivity: { status: 'Тренирам нередовно', current: '' },
  experience: 'Среден (2–5 години)',
  nutrition: { type: 'Балансиран, неструктуриран', custom: '', mealsPerDay: 3 },
  goal: { main: 'Покачване на мускулна маса', other: '', deadline: '' },
  equipment: ['Дъмбели', 'Ластици'], equipmentOther: '',
  preferences: { types: ['Силов тренинг'], avoid: 'бърпита', freq: '3–4', duration: '45–60 мин', timeOfDay: 'Вечер' },
  extraInfo: '',
};

test('buildProfileSummary: компактен, съдържа критичните полета', () => {
  const summary = buildProfileSummary(SAMPLE_ANSWERS);
  assert.ok(summary.includes('Мъж, 34'));
  assert.ok(summary.includes('Хипертония'));
  assert.ok(summary.includes('преса над глава'));
  assert.ok(summary.includes('НЕ ЖЕЛАЕ движения: бърпита'));
  assert.ok(summary.includes('качил(а) 5 кг'));
  assert.ok(summary.length < 1200, `профилът е твърде дълъг: ${summary.length}`);
});

test('buildCoachContext: включва профил и дни, спазва тавана', () => {
  const plan = normalizePlan({
    title: 'Тест план', weeklySplit: 'Upper/Lower',
    days: [
      { day: 'Понеделник', focus: 'Горна част', type: 'strength', exercises: [{ displayName: 'Лег преса', canonicalName: 'Bench Press', sets: 3, reps: '10', restSeconds: 60 }] },
      { day: 'Вторник', focus: 'Почивка', type: 'rest', exercises: [] },
    ],
  });
  const ctx = buildCoachContext(buildProfileSummary(SAMPLE_ANSWERS), plan);
  assert.ok(ctx.includes('Тест план'));
  assert.ok(ctx.includes('Пон'));
  assert.ok(ctx.length <= 3200);
});

// ----------------------------------------------------------------------------
// AI JSON parsing и нормализация на плана
// ----------------------------------------------------------------------------

test('parseAiJson: чист JSON, markdown огради и шум около скобите', () => {
  assert.deepEqual(parseAiJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseAiJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseAiJson('Ето плана: {"a":{"b":2}} Готово.'), { a: { b: 2 } });
  assert.throws(() => parseAiJson('не е json'));
  assert.throws(() => parseAiJson('{"days":[{"day":"Пн"'), /отрязан/i);
});

test('normalizePlan: допълва до 7 дни и ограничава стойностите', () => {
  const plan = normalizePlan({
    title: 'X',
    days: [
      { day: 'Понеделник', type: 'strength', exercises: [{ displayName: 'А', canonicalName: 'A', sets: 99, reps: '10', restSeconds: 9999 }] },
    ],
  });
  assert.equal(plan.days.length, 7);
  assert.equal(plan.days[1].type, 'rest');
  assert.equal(plan.days[0].exercises[0].sets, 10, 'sets се ограничава до 10');
  assert.equal(plan.days[0].exercises[0].restSeconds, 300, 'почивката се ограничава до 300 сек');
});

test('normalizePlan: невалиден вход хвърля грешка', () => {
  assert.throws(() => normalizePlan(null));
  assert.throws(() => normalizePlan({ days: [] }));
});

// ----------------------------------------------------------------------------
// Обогатяване с matching + алтернативи
// ----------------------------------------------------------------------------

test('enrichPlanWithExercises: закача match, медия и алтернативи', () => {
  const plan = normalizePlan({
    title: 'X',
    days: [{
      day: 'Понеделник', type: 'strength',
      exercises: [{ displayName: 'Избутване от лежанка', canonicalName: 'Bench Press', equipmentHint: 'barbell', bodyPart: 'chest', sets: 4, reps: '8-10', restSeconds: 90 }],
    }],
  });
  enrichPlanWithExercises(plan, INDEX, { allowedEquipment: null, env: {} });
  const ex = plan.days[0].exercises[0];
  assert.equal(ex.match.name, 'Barbell Bench Press');
  assert.ok(ex.match.gifUrl.startsWith('https://'), 'медията е абсолютен URL');
  assert.ok(ex.alternatives.length >= 1);
  assert.ok(ex.alternatives.every((a) => a.id !== ex.match.id));
  assert.equal(ex.displayName, 'Избутване с щанга от лежанка');
});

test('enrichPlanWithExercises: displayName от превод в индекса', () => {
  const index = buildCompactIndex(RAW_DATASET, {
    '0002': { nameBg: 'Избутване с дъмбели от лежанка', instructionsBg: 'BG инструкции.' },
  });
  const plan = normalizePlan({
    title: 'X',
    days: [{
      day: 'Понеделник', type: 'strength',
      exercises: [{ displayName: 'AI име', canonicalName: 'Dumbbell Bench Press', equipmentHint: 'dumbbell', bodyPart: 'chest', sets: 3, reps: '10', restSeconds: 60 }],
    }],
  });
  enrichPlanWithExercises(plan, index, { env: {} });
  assert.equal(plan.days[0].exercises[0].displayName, 'Избутване с дъмбели от лежанка');
  assert.equal(plan.days[0].exercises[0].match.instructionsLang, 'bg');
});

test('enrichPlanWithExercises: без индекс планът остава непроменен и валиден', () => {
  const plan = normalizePlan({ title: 'X', days: [{ day: 'Пн', type: 'strength', exercises: [{ displayName: 'А', canonicalName: 'A', sets: 3, reps: '10', restSeconds: 60 }] }] });
  const result = enrichPlanWithExercises(plan, null, {});
  assert.equal(result.days[0].exercises[0].match, undefined);
});

// ----------------------------------------------------------------------------
// Въпросник (questions.js)
// ----------------------------------------------------------------------------

test('QUESTIONS: точно 14 стъпки по спецификацията', () => {
  assert.equal(QUESTIONS.length, 14);
  assert.deepEqual(QUESTIONS.map((q) => q.num), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});

test('visibleOptions: женският блок е условен', () => {
  const health = QUESTIONS.find((q) => q.id === 'health');
  const male = visibleOptions(health, { basics: { gender: 'Мъж' } });
  const female = visibleOptions(health, { basics: { gender: 'Жена' } });
  assert.ok(!male.some((o) => o.value === 'Бременна'));
  assert.ok(female.some((o) => o.value === 'Бременна'));
  assert.ok(female.some((o) => o.value === 'Менопауза'));
});

test('validateQuestion: изисква попълване', () => {
  const basics = QUESTIONS[0];
  assert.ok(validateQuestion(basics, {}), 'празни основни данни → грешка');
  assert.equal(validateQuestion(basics, { basics: { gender: 'Мъж', age: 34, heightCm: 178, weightKg: 82 } }), null);
  assert.ok(validateQuestion(basics, { basics: { gender: 'Мъж', age: 5, heightCm: 178, weightKg: 82 } }), 'възраст под минимума → грешка');

  const equipment = QUESTIONS.find((q) => q.id === 'equipment');
  assert.ok(validateQuestion(equipment, { equipment: { selected: [] } }));
  assert.equal(validateQuestion(equipment, { equipment: { selected: ['Дъмбели'] } }), null);
});

test('buildAnswers: превежда състоянието на визарда към формата за бекенда', () => {
  const state = {
    basics: { gender: 'Жена', age: '29', heightCm: '165', weightKg: '60' },
    health: { selected: ['Бременна', 'Приемам медикаменти редовно'], inputs: { pregnancyTrimester: 'втори', healthMeds: 'витамини' } },
    limitations: { selected: ['Диагностициран проблем'], inputs: { limitDiagnosed: 'ляво коляно' } },
    weightChange: { selected: 'Да, качих килограми', inputs: { gainKg: '4', gainReason: 'бременност' } },
    sleep: { selected: 'Средно, понякога прекъснат сън' },
    stress: 7,
    dailyActivity: { selected: 'Заседнала работа, минимално движение' },
    sportActivity: { selected: 'Тренирам системно', inputs: { sportCurrent: 'йога' } },
    experience: { selected: 'Начинаещ–среден (6 месеца – 2 години)' },
    nutrition: { type: 'Специфична диета', custom: 'вегетарианска', mealsPerDay: '4' },
    goal: { main: 'Обща кондиция', timeframe: 'Без краен срок' },
    equipment: { selected: ['Собствено тегло', 'Ластици'], inputs: {} },
    preferences: { types: ['Йога / мобилност'], avoid: 'скачане', freq: '3–4', duration: '30–45 мин', timeOfDay: 'Сутрин' },
    extraInfo: 'работя на смени',
  };
  const answers = buildAnswers(state);

  assert.equal(answers.gender, 'Жена');
  assert.equal(answers.age, 29);
  assert.deepEqual(answers.healthFemale, ['Бременна — триместър: втори']);
  assert.equal(answers.healthMeds, 'витамини');
  assert.deepEqual(answers.limitations, ['Диагностициран проблем: ляво коляно']);
  assert.deepEqual(answers.weightChange, { type: 'gain', amountKg: 4, reason: 'бременност' });
  assert.equal(answers.sportActivity.current, 'йога');
  assert.equal(answers.nutrition.custom, 'вегетарианска');
  assert.equal(answers.goal.deadline, '', 'без краен срок → празен deadline');
  assert.deepEqual(answers.equipment, ['Собствено тегло', 'Ластици']);
  assert.equal(answers.preferences.avoid, 'скачане');
  assert.equal(answers.extraInfo, 'работя на смени');
});

// ----------------------------------------------------------------------------
// Българска терминология
// ----------------------------------------------------------------------------

test('localizeExerciseDisplayName: bench press не става „лег преса“', () => {
  assert.equal(
    localizeExerciseDisplayName('Dumbbell Bench Press', 'Лег преса с дъмбели от пода', 'dumbbell'),
    'Избутване с дъмбели от лежанка',
  );
  assert.equal(
    localizeExerciseDisplayName('Barbell Bench Press', 'Лег преса с щанга', 'barbell'),
    'Избутване с щанга от лежанка',
  );
  assert.equal(localizeExerciseDisplayName('Leg Press', 'Избутване от лежанка'), 'Преса за крака');
});

test('sanitizeBgText: утежни вместо затежни', () => {
  assert.equal(sanitizeBgText('олекоти или затежни деня'), 'олекоти или утежни деня');
  assert.equal(sanitizeBgText('Кога да затежниш'), 'Кога да утежниш');
});
