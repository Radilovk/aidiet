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
  resolveGuidelineLayers,
  capGuidelineTexts,
  buildAdminPlanUserPrompt,
  buildBriefIdentityBlock,
  buildProfileSummary,
  buildCoachContext,
  parseAiJson,
  normalizePlan,
  enrichPlanWithExercises,
  parseAdminBriefConstraints,
  allowedEquipmentFromBrief,
  extractTagsFromText,
  buildTagsFromAnswers,
  preparePlanGeneration,
  auditPlanGenderFit,
  buildTrainerSystemAddon,
  parseChunkTags,
  shouldIncludeAdminChunk,
  constraintsFromAnswers,
} from '../worker.js';

import { mergeAllowedEquipment } from '../plan-generation.js';
import { filterExercises, passesEquipment, SWAP_EQUIPMENT } from '../exercise-metadata.js';

import { QUESTIONS, activeQuestions, validateQuestion, buildAnswers, fieldVisible } from '../questions.js';
import { localizeExerciseDisplayName, sanitizeBgText } from '../exercise-labels-bg.js';
import { buildProgramSpec } from '../program-spec.js';

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

test('allowedEquipmentSet: Друго/свободен текст → EN hint токени', () => {
  const set = allowedEquipmentSet(['Дъмбели', 'горен скрипец vertical pulley, машина аддуктор, ластици']);
  assert.ok(set.has('dumbbell'));
  assert.ok(set.has('cable'));
  assert.ok(set.has('leverage machine'));
  assert.ok(set.has('band'));
});

test('buildAdminPlanUserPrompt: <equipment> таг при списък', () => {
  const prompt = buildAdminPlanUserPrompt({
    clientProfile: 'Жена, 30 г.',
    constraints: { equipmentList: ['Дъмбели', 'горен скрипец', 'машина аддуктор'], exclusions: [], priorities: [], schedule: [] },
  });
  assert.ok(prompt.includes('<equipment>'));
  assert.ok(prompt.includes('горен скрипец'));
});

// ----------------------------------------------------------------------------
// Mini-RAG насоки
// ----------------------------------------------------------------------------

test('selectGuidelines: извлича само релевантните порции (individual слой)', () => {
  const { individual } = selectGuidelines({
    gender: 'Мъж',
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
  const joined = individual.join('\n');
  assert.ok(joined.includes('Хипертрофия'), 'очаква се насока за хипертрофия');
  assert.ok(joined.includes('сърдечно-съдов риск'), 'очаква се насока за хипертония');
  assert.ok(!joined.includes('бременност'), 'не трябва да включва нерелевантни насоки');
  assert.ok(!joined.includes('Сутрешни'), 'тренира вечер — без сутрешна насока');
});

test('selectGuidelines: бременност и начинаещ', () => {
  const { individual } = selectGuidelines({
    gender: 'Жена',
    goal: { main: 'Обща кондиция' },
    experience: 'Никакъв / начинаещ (0–6 месеца системно)',
    health: [],
    healthFemale: ['Бременна — триместър: втори'],
    equipment: ['Собствено тегло'],
    age: 29,
  });
  const joined = individual.join('\n');
  assert.ok(joined.includes('бременност'));
  assert.ok(joined.includes('Начинаещи'));
  assert.ok(joined.includes('Ограничено оборудване'));
});

test('selectGuidelines: слива админ chunks и ограничава обема', () => {
  const { individual } = selectGuidelines(
    { gender: 'Мъж', goal: { main: 'Отслабване' }, experience: 'Начинаещ', health: [], healthFemale: [], equipment: ['Дъмбели'], age: 25 },
    {
      chunks: [
        { tags: ['goal:отслабване'], text: 'АДМИН: персонален акцент върху NEAT и ходене.' },
        { tags: ['level:начинаещ'], text: 'АДМИН: първо овладяване на шаблон движения.' },
      ],
    },
  );
  const joined = individual.join('\n');
  assert.ok(joined.includes('АДМИН: персонален акцент'));
  assert.ok(joined.includes('АДМИН: първо овладяване'));
  assert.ok(!joined.includes('комбинирай съпротивителен тренинг'), 'админ chunk замества hardcoded за goal:отслабване');
  assert.ok(joined.length <= 3600);
  assert.ok(individual.length <= 12);
});

test('resolveGuidelineLayers: архитектурни chunks са отделен слой', () => {
  const layers = resolveGuidelineLayers(new Set(['goal:отслабване']), {
    chunks: [
      { tags: ['all'], text: 'АРХ: винаги загрявка.' },
      { tags: ['goal:отслабване'], text: 'ИНД: схема C + LISS.' },
    ],
  });
  assert.ok(layers.architecture.includes('АРХ: винаги загрявка.'));
  assert.ok(layers.individual.includes('ИНД: схема C + LISS.'));
  assert.ok(!layers.individual.includes('АРХ:'));
});

test('selectGuidelinesFromBrief: извлича релевантни насоки по таг (без несъвпадащи chunks)', () => {
  const { individual } = selectGuidelinesFromBrief(
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
  const joined = individual.join('\n');
  assert.ok(joined.includes('АДМИН отслабване'));
  assert.ok(joined.includes('АДМИН ВАЖНО'));
  assert.ok(joined.includes('АДМИН жена'));
  assert.ok(!joined.includes('АДМИН сила'), 'несъвпадащ chunk по goal:силови не влиза');
  assert.ok(!joined.includes('комбинирай съпротивителен тренинг'));
});

test('selectGuidelinesFromBrief: универсални admin chunks → architecture слой', () => {
  const layers = selectGuidelinesFromBrief(
    { clientProfile: 'Жена, 28 г., отслабване.', exampleScheme: '' },
    {
      chunks: [
        { tags: [], text: 'УНИВЕРСАЛНО: винаги загрявка 8 мин.' },
        { tags: ['goal:силови показатели'], text: 'Само за сила — не за този клиент.' },
      ],
    },
  );
  assert.ok(layers.architecture.some((t) => t.includes('УНИВЕРСАЛНО')));
  assert.ok(!layers.individual.some((t) => t.includes('Само за сила')));
});

test('buildBriefIdentityBlock: тагове в XML формат', () => {
  const block = buildBriefIdentityBlock({
    clientProfile: 'Жена, 32 г., цел релеф, 3 тренировки.',
    exampleScheme: 'Пон: glutes, Сря: гръб',
  });
  assert.ok(block.includes('<tags>'));
  assert.ok(block.includes('gender:жена'));
});

test('buildAdminPlanUserPrompt: context-only — профил, схема, constraints', () => {
  const prompt = buildAdminPlanUserPrompt({
    clientProfile: 'Жена, 28 г., цел: релеф',
    exampleScheme: 'Пон: гръб — лат пулдаун 4x10\nБез бърпита',
    tags: new Set(['gender:жена', 'goal:отслабване']),
    constraints: {
      exclusions: ['Не желае движения: бърпи'],
      equipmentList: [],
      priorities: [],
      schedule: [],
    },
  });
  assert.ok(prompt.includes('<profile>'));
  assert.ok(prompt.includes('<scheme>'));
  assert.ok(prompt.includes('<constraints>'));
  assert.ok(prompt.includes('Жена, 28 г.'));
  assert.ok(prompt.includes('лат пулдаун'));
  assert.ok(prompt.includes('бърпи'));
  assert.ok(prompt.indexOf('<scheme>') < prompt.indexOf('<profile>'), 'scheme преди profile');
  assert.ok(prompt.includes('Следвай <scheme>'));
  assert.ok(!prompt.includes('БАЗОВИ ПРИНЦИПИ'), 'foundation не е в user prompt');
  assert.ok(!prompt.includes('ИНДИВИДУАЛНИ НАСОКИ'), 'RAG не е в user prompt');
});

test('capGuidelineTexts: спазва лимити', () => {
  const capped = capGuidelineTexts(['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(3000)], 2, 150);
  assert.equal(capped.length, 2);
  assert.ok(capped.join('').length <= 150);
});

test('buildTrainerSystemAddon: RAG насоки в system с XML тагове', () => {
  const layers = resolveGuidelineLayers(new Set(['gender:жена', 'goal:отслабване']), {
    foundation: 'Принцип А',
    chunks: [{ tags: ['пол (в1)'], text: 'ПОЛ — жени: glutes приоритет' }],
  });
  const addon = buildTrainerSystemAddon({ foundation: 'Принцип А', chunks: [] }, new Set(['gender:жена']), layers);
  assert.ok(addon.includes('<trainer_rules>'));
  assert.ok(addon.includes('<foundation>'));
  assert.ok(addon.includes('Принцип А'));
  assert.ok(addon.includes('<individual_guidelines>'));
  assert.ok(addon.includes('глут') || addon.includes('ПОЛ') || addon.includes('Жена'));
});

test('buildTrainerSystemAddon: schemeMode маркира scheme приоритет + admin RAG', () => {
  const layers = resolveGuidelineLayers(
    new Set(['gender:жена']),
    { chunks: [{ tags: ['gender:жена'], text: 'Админ: дупе приоритет' }] },
    { schemeMode: true },
  );
  const addon = buildTrainerSystemAddon({ foundation: 'Принцип А', chunks: [] }, new Set(['gender:жена']), layers, { schemeMode: true });
  assert.ok(addon.includes('абсолютна'));
  assert.ok(addon.includes('<individual_guidelines>'));
  assert.ok(addon.includes('дупе'));
});

const ADMIN_WOMAN_PROFILE = `Жена. 172 ръст, 51 кг, 45 годишна, без здравословни проблеми. тренира редовно. търси оформяне и стягане. акцент обем на дупе и изправяне на гърба заради лека кифоза. приоритет са бедра и дупе!
гърди не защото има импланти`;

const ADMIN_WOMAN_SCHEME = `3 тренировки седмично без събота и неделя. уреди: горен скрипец vertical pulley, машина за бедра аддуктор, абдуктор, лост 10 кг, гирички 2 до 10 кг, хоризонтален скрипец за гръб, степ блокче.
придържаш се към упражнения за средно начинаещи. по прости и ефективни. без странични рамена.`;

test('admin бриф: 45 г. не активира level:напреднал', () => {
  const tags = extractTagsFromText(ADMIN_WOMAN_PROFILE, ADMIN_WOMAN_SCHEME);
  assert.ok(tags.has('gender:жена'));
  assert.ok(tags.has('goal:рекомпозиция'));
  assert.ok(tags.has('level:среден'), 'средно начинаещи → level:среден');
  assert.ok(!tags.has('level:напреднал'), '45 годишна не трябва да е напреднал');
  assert.ok(!tags.has('age:50+'));
});

test('parseAdminBriefConstraints: извлича оборудване, забрани и приоритети', () => {
  const c = parseAdminBriefConstraints(ADMIN_WOMAN_PROFILE, ADMIN_WOMAN_SCHEME);
  assert.ok(c.equipmentList.some((e) => e.includes('скрипец')));
  assert.ok(c.exclusions.some((e) => e.includes('гърди не')));
  assert.ok(c.exclusions.some((e) => e.includes('странични рамена')));
  assert.ok(c.priorities.some((p) => p.includes('дупе') || p.includes('бедра')));
  assert.ok(c.schedule.some((s) => s.includes('3 тренировки')));
  assert.ok(!c.exclusions.some((e) => e.includes('здравословни проблеми')));
});

test('allowedEquipmentFromBrief: мапва админ уреди към EN hints', () => {
  const set = allowedEquipmentFromBrief(ADMIN_WOMAN_PROFILE, ADMIN_WOMAN_SCHEME);
  assert.ok(set);
  assert.ok(set.has('cable'));
  assert.ok(set.has('dumbbell'));
  assert.ok(set.has('leverage machine'));
  assert.ok(!set.has('kettlebell'));
});

test('mergeAllowedEquipment: уреди от схема над „пълна зала“', () => {
  const fromBrief = allowedEquipmentFromBrief('', ADMIN_WOMAN_SCHEME);
  const fromAnswers = allowedEquipmentSet(['Пълно оборудване на зала']);
  assert.equal(fromAnswers, null);
  const merged = mergeAllowedEquipment(fromBrief, fromAnswers);
  assert.ok(merged);
  assert.ok(merged.has('cable'));
  assert.ok(merged.has('dumbbell'));
});

test('passesEquipment: филтърът не пропуска всичко', () => {
  const bench = INDEX.find((e) => e.name === 'Barbell Bench Press');
  const allowed = new Set(['body weight', 'dumbbell', 'cable']);
  assert.equal(passesEquipment(bench, allowed), false);
  const dumb = INDEX.find((e) => e.name === 'Dumbbell Bench Press');
  assert.equal(passesEquipment(dumb, allowed), true);
});

test('filterExercises: само позволено оборудване в каталога', () => {
  const allowed = new Set(['body weight', 'dumbbell']);
  const filtered = filterExercises(INDEX, null, allowed);
  assert.ok(filtered.every((e) => passesEquipment(e, allowed)));
  assert.ok(!filtered.some((e) => e.equipNorm === 'barbell'));
});

test('buildAdminPlanUserPrompt: hard-veto блок за женски админ бриф', () => {
  const prompt = buildAdminPlanUserPrompt({
    clientProfile: ADMIN_WOMAN_PROFILE,
    exampleScheme: ADMIN_WOMAN_SCHEME,
  });
  assert.ok(prompt.includes('<constraints>'));
  assert.ok(prompt.includes('гърди не'));
  assert.ok(prompt.includes('странични рамена'));
  assert.ok(prompt.includes('<profile>'));
  assert.ok(prompt.indexOf('<constraints>') < prompt.indexOf('<profile>'));
});

test('preparePlanGeneration: user=context, system=RAG', () => {
  const { userPrompt, clientTags, guidelineLayers } = preparePlanGeneration(
    { answers: { gender: 'Жена', age: 32, goal: { main: 'Отслабване' }, experience: 'Начинаещ', health: [], healthFemale: [], equipment: ['Дъмбели'], preferences: { freq: '3–4', duration: '30–45 мин' } } },
    { foundation: 'Принцип тест', chunks: [{ tags: ['gender:жена'], text: 'Админ жена насока' }] },
    { buildProfileSummary, allowedEquipmentSet },
  );
  assert.ok(userPrompt.includes('<program_spec>'));
  assert.ok(userPrompt.includes('sessions: 3'));
  assert.ok(!userPrompt.includes('Принцип тест'));
  assert.ok(!userPrompt.includes('Админ жена насока'));
  assert.ok(clientTags.has('gender:жена'));
  const addon = buildTrainerSystemAddon(
    { foundation: 'Принцип тест', chunks: [{ tags: ['gender:жена'], text: 'Админ жена насока' }] },
    clientTags,
    guidelineLayers,
  );
  assert.ok(addon.includes('Принцип тест'));
  assert.ok(addon.includes('Админ жена насока'));
});

test('buildProfileSummary: цел Друго показва custom текста', () => {
  const summary = buildProfileSummary({
    gender: 'Жена', age: 30, heightCm: 165, weightKg: 60,
    goal: { main: 'Друго', other: 'оформяне и стягане на дупе', deadline: '' },
    health: [], healthFemale: [], limitations: [], equipment: [], preferences: {},
  });
  assert.ok(summary.includes('оформяне и стягане на дупе'));
});

test('buildTagsFromAnswers: цел Друго извлича тагове от свободен текст', () => {
  const tags = buildTagsFromAnswers({
    gender: 'Жена',
    goal: { main: 'Друго', other: 'релеф и оформяне на дупе' },
    experience: 'Среден (2–5 години)',
    health: [], healthFemale: [], equipment: ['Дъмбели'], age: 34,
    preferences: {},
  });
  assert.ok(tags.has('gender:жена'));
  assert.ok(tags.has('goal:рекомпозиция'));
});

test('resolveGuidelineLayers: админ chunks не се режат от hardcoded fallback', () => {
  const layers = resolveGuidelineLayers(new Set(['goal:отслабване', 'gender:жена', 'level:начинаещ']), {
    chunks: Array.from({ length: 10 }, (_, i) => ({
      tags: [`goal:отслабване`],
      text: `АДМИН ${i + 1}: персонална насока ${i + 1}.`,
    })),
  });
  assert.equal(layers.individual.filter((t) => t.startsWith('АДМИН')).length, 10);
});

test('auditPlanGenderFit: жена с мъжки bench-dominant план → проблем', () => {
  const plan = normalizePlan({
    title: 'X',
    days: [{
      day: 'Понеделник', type: 'strength',
      exercises: [
        { canonicalName: 'Barbell Bench Press', sets: 4, reps: '8', restSeconds: 90 },
        { canonicalName: 'Incline Bench Press', sets: 4, reps: '8', restSeconds: 90 },
        { canonicalName: 'Dumbbell Bench Press', sets: 3, reps: '10', restSeconds: 60 },
        { canonicalName: 'Barbell Curl', sets: 3, reps: '12', restSeconds: 60 },
      ],
    }],
  });
  const audit = auditPlanGenderFit(plan, new Set(['gender:жена']));
  assert.equal(audit.ok, false);
  assert.ok(audit.issues.length > 0);
});

test('questionnaire admin tags влизат в prompt (локален fixture)', () => {
  const config = {
    foundation: 'За жени избягваш упражнения за гърди, странично рамо, прасец!',
    chunks: [
      { tags: ['пол (в1', 'в12.other', 'в15)'], text: 'ПОЛ — Жени: глутеус, бедра, постура. Гърди max 1 упражнение.' },
      { tags: ['оборудване (в13)'], text: 'ОБОРУДВАНЕ — само маркирания инвентар.' },
    ],
  };
  const tags = buildTagsFromAnswers({
    gender: 'Жена', goal: { main: 'Рекомпозиция' }, experience: 'Среден (2–5 години)',
    health: [], healthFemale: [], equipment: ['Дъмбели'], age: 45, preferences: {},
  });
  const layers = resolveGuidelineLayers(tags, config);
  const joined = layers.individual.join('\n');
  assert.ok(joined.includes('ПОЛ'), 'пол chunk');
  assert.ok(joined.includes('глутеус') || joined.includes('глут'), 'женски акцент');
  assert.ok(joined.includes('ОБОРУДВАНЕ') || joined.includes('В13'), 'equipment chunk');
  const addon = buildTrainerSystemAddon(config, tags, layers);
  assert.ok(addon.includes('<trainer_rules>'));
  assert.ok(addon.includes('ПОЛ'), 'пол в system prompt');
});

test('parseChunkTags: не чупи запетая в (в1, в12)', () => {
  const tags = parseChunkTags('пол (в1, в12.other, в15)');
  assert.deepEqual(tags, ['пол (в1, в12.other, в15)']);
  const repaired = parseChunkTags(['пол (в1', 'в12.other', 'в15)']);
  assert.deepEqual(repaired, ['пол (в1, в12.other, в15)']);
});

test('shouldIncludeAdminChunk: questionnaire категория — пол филтър', () => {
  const chunk = { tags: ['пол (в1', 'в12.other', 'в15)'], text: 'Жени: glutes' };
  assert.equal(shouldIncludeAdminChunk(chunk, new Set(['gender:жена'])), true);
  assert.equal(shouldIncludeAdminChunk(chunk, new Set(['gender:мъж'])), false, 'женски chunk не за мъж');
  const neutral = { tags: ['оборудване (в13)'], text: 'ОБОРУДВАНЕ: само маркирания инвентар.' };
  assert.equal(shouldIncludeAdminChunk(neutral, new Set()), true);
  assert.equal(shouldIncludeAdminChunk({ tags: ['gender:мъж'], text: 'x' }, new Set(['gender:жена'])), false);
  assert.equal(shouldIncludeAdminChunk({ tags: ['gender:жена'], text: 'x' }, new Set(['gender:жена'])), true);
});

test('resolveGuidelineLayers: schemeMode — admin chunks да, hardcoded не', () => {
  const layers = resolveGuidelineLayers(
    new Set(['gender:жена', 'goal:отслабване']),
    { chunks: [{ tags: ['gender:жена'], text: 'АДМИН жена: glutes приоритет' }] },
    { schemeMode: true },
  );
  assert.ok(layers.individual.some((t) => t.includes('АДМИН')));
  assert.ok(!layers.individual.some((t) => /приоритет №1 дупе/i.test(t)));
});

test('preparePlanGeneration: hasScheme при exampleScheme + admin RAG', () => {
  const { hasScheme, userPrompt, guidelineLayers } = preparePlanGeneration(
    {
      clientAnswers: {
        gender: 'Жена', age: 30, goal: { main: 'Рекомпозиция' }, experience: 'Среден (2–5 години)',
        health: [], healthFemale: [], equipment: ['Дъмбели'], preferences: {},
      },
      exampleScheme: ADMIN_WOMAN_SCHEME,
    },
    { foundation: 'Принцип тест', chunks: [{ tags: ['gender:жена'], text: 'Админ жена насока' }] },
    { buildProfileSummary, allowedEquipmentSet },
  );
  assert.equal(hasScheme, true);
  assert.ok(userPrompt.indexOf('<scheme>') < userPrompt.indexOf('<profile>'));
  assert.ok(guidelineLayers.individual.some((t) => t.includes('Админ жена')));
});

test('preparePlanGeneration: strictAssembly — само scheme, без profile/RAG', () => {
  const { strictAssembly, userPrompt, guidelineLayers } = preparePlanGeneration(
    {
      strictScheme: true,
      exampleScheme: 'Пон: Barbell Hip Thrust 4x10, 60с\nВто: почивка',
      clientName: 'Тест',
    },
    { foundation: 'Принцип', chunks: [{ tags: ['gender:жена'], text: 'Жена: дупе' }] },
    { buildProfileSummary, allowedEquipmentSet },
  );
  assert.equal(strictAssembly, true);
  assert.ok(userPrompt.includes('ASSEMBLY:'));
  assert.ok(!userPrompt.includes('<profile>'));
  assert.equal(guidelineLayers.individual.length, 0);
  assert.equal(guidelineLayers.architecture.length, 0);
});

test('buildTrainerSystemAddon: strictAssembly → празен', () => {
  const addon = buildTrainerSystemAddon(
    { foundation: 'Принцип' },
    new Set(['gender:жена']),
    { individual: ['x'], architecture: ['y'] },
    { strictAssembly: true },
  );
  assert.equal(addon, '');
});

test('auditPlanGenderFit: жена с glutes/крака → OK', () => {
  const plan = normalizePlan({
    title: 'X',
    days: [{
      day: 'Понеделник', type: 'strength',
      exercises: [
        { canonicalName: 'Barbell Hip Thrust', sets: 4, reps: '10', restSeconds: 90 },
        { canonicalName: 'Romanian Deadlift', sets: 3, reps: '10', restSeconds: 90 },
        { canonicalName: 'Bulgarian Split Squat', sets: 3, reps: '12', restSeconds: 60 },
        { canonicalName: 'Cable Kickback', sets: 3, reps: '15', restSeconds: 45 },
      ],
    }],
  });
  const audit = auditPlanGenderFit(plan, new Set(['gender:жена']));
  assert.equal(audit.ok, true);
});

test('auditPlanGenderFit: жена с клек-доминантен план без дупе → проблем', () => {
  const plan = normalizePlan({
    title: 'X',
    days: [{
      day: 'Понеделник', type: 'strength',
      exercises: [
        { canonicalName: 'Barbell Back Squat', sets: 4, reps: '8', restSeconds: 120 },
        { canonicalName: 'Leg Press', sets: 4, reps: '12', restSeconds: 90 },
        { canonicalName: 'Walking Lunge', sets: 3, reps: '12', restSeconds: 60 },
        { canonicalName: 'Goblet Squat', sets: 3, reps: '12', restSeconds: 60 },
      ],
    }],
  });
  const audit = auditPlanGenderFit(plan, new Set(['gender:жена']));
  assert.equal(audit.ok, false);
  assert.ok(audit.issues.some((i) => /дупе/i.test(i)));
});

test('constraintsFromAnswers: само hard-veto, без дублиране на program_spec', () => {
  const c = constraintsFromAnswers({
    gender: 'Жена',
    goal: { main: 'Отслабване', zones: 'бедра, корем' },
    preferences: { freq: '3–4', duration: '45–60 мин', avoid: 'клек' },
    extraInfo: 'работя на смени',
    equipment: [], limitations: [], health: [], healthFemale: [],
  });
  assert.equal(c.priorities.length, 0);
  assert.equal(c.schedule.length, 0);
  assert.ok(c.exclusions.some((e) => e.includes('клек')));
});

test('buildProgramSpec: зони и женски обем (вместо constraints priorities)', () => {
  const spec = buildProgramSpec({
    gender: 'Жена',
    goal: { main: 'Отслабване', zones: 'бедра, корем' },
    experience: 'Начинаещ',
    preferences: { freq: '3–4', duration: '45–60 мин' },
  });
  assert.ok(spec.zonesText.includes('бедра'));
  assert.ok(spec.volume.glutes >= spec.volume.chest);
});

test('buildAnswers: zones при релевантна цел', () => {
  const answers = buildAnswers({
    basics: { gender: 'Жена', age: 30, heightCm: 165, weightKg: 60 },
    goal: { main: 'Отслабване', zones: 'бедра, корем', timeframe: 'Без краен срок' },
  });
  assert.equal(answers.goal.zones, 'бедра, корем');
});

test('buildAnswers: zones се изчистват при нерелевантна цел', () => {
  const answers = buildAnswers({
    basics: { gender: 'Мъж', age: 30, heightCm: 180, weightKg: 80 },
    goal: { main: 'Издръжливост', zones: 'бедра', timeframe: 'Без краен срок' },
  });
  assert.equal(answers.goal.zones, '');
});

test('fieldVisible: zones само при релевантни цели', () => {
  const zonesField = QUESTIONS.find((q) => q.id === 'goal').fields.find((f) => f.key === 'zones');
  assert.equal(fieldVisible(zonesField, { main: 'Отслабване' }), true);
  assert.equal(fieldVisible(zonesField, { main: 'Издръжливост' }), false);
});

test('buildAdminPlanUserPrompt: зони в program_spec', () => {
  const spec = buildProgramSpec({
    gender: 'Жена',
    goal: { main: 'Отслабване', zones: 'бедра, корем' },
    experience: 'Начинаещ',
    preferences: { freq: '3–4', duration: '30–45 мин' },
  });
  const prompt = buildAdminPlanUserPrompt({
    clientProfile: 'Жена, 30 г., цел отслабване',
    programSpec: spec,
    constraints: constraintsFromAnswers({
      gender: 'Жена',
      goal: { main: 'Отслабване', zones: 'бедра, корем' },
      equipment: ['Дъмбели'],
      limitations: [],
      health: [],
      healthFemale: [],
    }),
    tags: new Set(['gender:жена', 'goal:отслабване']),
  });
  assert.ok(prompt.includes('<program_spec>'));
  assert.ok(prompt.includes('zones↓: бедра, корем'));
  assert.ok(!prompt.includes('ПРИОРИТЕТ:'));
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
  assert.ok(ex.alternatives.every((a) => SWAP_EQUIPMENT.has(normalizeText(a.equipment))), 'swap само СТ/дъмбели/гири');
  assert.equal(ex.displayName, 'Избутване с щанга от лежанка');
});

test('enrichPlanWithExercises: barbell → dumbbell при ограничено оборудване', () => {
  const plan = normalizePlan({
    title: 'X',
    days: [{
      day: 'Понеделник', type: 'strength',
      exercises: [{ displayName: 'Bench', canonicalName: 'Barbell Bench Press', equipmentHint: 'barbell', bodyPart: 'chest', sets: 3, reps: '10', restSeconds: 60 }],
    }],
  });
  const allowed = new Set(['body weight', 'dumbbell']);
  enrichPlanWithExercises(plan, INDEX, { allowedEquipment: allowed, env: {} });
  const ex = plan.days[0].exercises[0];
  assert.equal(normalizeText(ex.match.equipment), 'dumbbell');
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

test('QUESTIONS: женските стъпки са отделни (womenContext + womenImplants)', () => {
  assert.equal(QUESTIONS.length, 16);
  const female = activeQuestions({ basics: { gender: 'Жена' } });
  const male = activeQuestions({ basics: { gender: 'Мъж' } });
  assert.equal(male.length, 14);
  assert.equal(female.length, 16);
  assert.ok(female.some((q) => q.id === 'womenContext'));
  assert.ok(female.some((q) => q.id === 'womenImplants'));
  assert.ok(!male.some((q) => q.id === 'womenContext'));
  assert.ok(!male.some((q) => q.id === 'womenImplants'));
  const health = QUESTIONS.find((q) => q.id === 'health');
  assert.ok(!health.options.some((o) => o.value === 'Бременна'), 'бременност не е в общото здраве');
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
    health: { selected: ['Приемам медикаменти редовно'], inputs: { healthMeds: 'витамини' } },
    womenContext: { selected: 'Бременна', inputs: { pregnancyTrimester: 'втори' } },
    womenImplants: { selected: 'Да — под гръдния мускул (submuscular)', inputs: { implantMonths: '8' } },
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
  assert.deepEqual(answers.breastImplants, {
    implants: 'Да — под гръдния мускул (submuscular)',
    implantMonths: 8,
  });
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

test('buildAnswers + constraints: гръдни импланти → hard-veto за гърди', async () => {
  const { constraintsFromAnswers } = await import('../plan-generation.js');
  const state = {
    basics: { gender: 'Жена', age: '32', heightCm: '168', weightKg: '58' },
    health: { selected: ['Няма установени заболявания'], inputs: {} },
    womenContext: { selected: 'Няма специфични състояния', inputs: {} },
    womenImplants: { selected: 'Да — под гърдната жлеза (subglandular)', inputs: { implantMonths: '3' } },
    limitations: { selected: ['Нямам ограничения'], inputs: {} },
    weightChange: { selected: 'Не, теглото ми е стабилно' },
    sleep: { selected: 'Добро, събуждам се отпочинал/а' },
    stress: 4,
    dailyActivity: { selected: 'Заседнала работа, минимално движение' },
    sportActivity: { selected: 'Не тренирам в момента' },
    experience: { selected: 'Начинаещ–среден (6 месеца – 2 години)' },
    nutrition: { type: 'Без специфичен', mealsPerDay: '3' },
    goal: { main: 'Отслабване', timeframe: 'Без краен срок' },
    equipment: { selected: ['Дъмбели'], inputs: {} },
    preferences: { types: ['Силов тренинг'], freq: '3–4', duration: '45–60 мин', timeOfDay: 'Вечер' },
    extraInfo: '',
  };
  const answers = buildAnswers(state);
  const summary = buildProfileSummary(answers);
  const constraints = constraintsFromAnswers(answers);

  assert.ok(summary.includes('Гръдни импланти'));
  assert.ok(summary.includes('subglandular'));
  assert.ok(constraints.exclusions.some((e) => /имплант/i.test(e) && /лежанк/i.test(e)));
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
