/**
 * KA-TRAINER — декларативна дефиниция на клиентския въпросник (14 въпроса).
 *
 * Типове стъпки:
 *   fields — списък от полета (choice / chips / number / text / textarea)
 *   multi  — чекбокси; опция може да има inline вход и/или exclusive флаг
 *   single — радио бутони; опция може да има inline входове
 *   scale  — плъзгач 1-10
 *   text   — свободен текст
 *
 * Условност:
 *   option.femaleOnly  — показва се само при Пол = Жена (въпрос 1)
 *   field.showIf       — { key, equals } спрямо стойност в същата стъпка
 *
 * buildAnswers(state) превежда суровото състояние на визарда към формата,
 * който бекендът (worker.js → buildProfileSummary) очаква.
 */

export const QUESTIONS = [
  {
    id: 'basics',
    num: 1,
    title: 'Основни данни',
    subtitle: 'За да калибрираме натоварването спрямо теб.',
    type: 'fields',
    fields: [
      { key: 'gender', label: 'Пол', type: 'choice', options: ['Мъж', 'Жена'], required: true },
      { key: 'age', label: 'Възраст', type: 'number', min: 14, max: 90, suffix: 'год.', required: true },
      { key: 'heightCm', label: 'Ръст', type: 'number', min: 120, max: 230, suffix: 'см', required: true },
      { key: 'weightKg', label: 'Тегло', type: 'number', min: 35, max: 250, suffix: 'кг', required: true },
    ],
  },
  {
    id: 'health',
    num: 2,
    title: 'Здравословен статус',
    subtitle: 'Избери всичко, което се отнася за теб. Това пряко влияе на безопасността на плана.',
    type: 'multi',
    options: [
      { value: 'Няма установени заболявания', exclusive: true },
      { value: 'Диабет / преддиабет' },
      { value: 'Хипертония' },
      { value: 'Сърдечно-съдово заболяване (лично)' },
      { value: 'Бъбречно заболяване' },
      { value: 'Чернодробно заболяване' },
      { value: 'Заболяване на щитовидната жлеза' },
      { value: 'Автоимунно заболяване' },
      { value: 'Приемам медикаменти редовно', input: { key: 'healthMeds', placeholder: 'какви медикаменти' } },
      { value: 'Бременна', femaleOnly: true, input: { key: 'pregnancyTrimester', placeholder: 'кой триместър' } },
      { value: 'Следродилен период', femaleOnly: true, input: { key: 'postpartumMonths', placeholder: 'преди колко месеца', type: 'number' } },
      { value: 'Нередовен цикъл', femaleOnly: true },
      { value: 'Аменорея', femaleOnly: true },
      { value: 'Менопауза', femaleOnly: true },
      { value: 'Хормонална контрацепция', femaleOnly: true },
      { value: 'Друго', input: { key: 'healthOther', placeholder: 'опиши' } },
    ],
  },
  {
    id: 'limitations',
    num: 3,
    title: 'Опорно-двигателни ограничения и болка при движение',
    subtitle: 'Всичко посочено тук директно изключва натоварващите го движения от плана.',
    type: 'multi',
    options: [
      { value: 'Нямам ограничения', exclusive: true },
      { value: 'Диагностициран проблем', input: { key: 'limitDiagnosed', placeholder: 'коя става / зона' } },
      { value: 'Болка при конкретно движение без официална диагноза', input: { key: 'limitPainMove', placeholder: 'кое движение' } },
      { value: 'Прекаран хирургичен опорно-двигателен проблем', input: { key: 'limitSurgery', placeholder: 'къде, кога' } },
      { value: 'Друго', input: { key: 'limitOther', placeholder: 'опиши' } },
    ],
  },
  {
    id: 'weightChange',
    num: 4,
    title: 'Рязка промяна в теглото през последните 6 месеца',
    type: 'single',
    options: [
      { value: 'Не, теглото ми е стабилно' },
      {
        value: 'Да, качих килограми',
        inputs: [
          { key: 'gainKg', placeholder: 'колко кг', type: 'number' },
          { key: 'gainReason', placeholder: 'причина' },
        ],
      },
      {
        value: 'Да, свалих килограми',
        inputs: [
          { key: 'lossKg', placeholder: 'колко кг', type: 'number' },
          { key: 'lossReason', placeholder: 'причина' },
        ],
      },
    ],
  },
  {
    id: 'sleep',
    num: 5,
    title: 'Качество на съня',
    type: 'single',
    options: [
      { value: 'Добро, събуждам се отпочинал/а' },
      { value: 'Средно, понякога прекъснат сън' },
      { value: 'Лошо, трудно заспиване или чести събуждания' },
      { value: 'Диагностицирано нарушение на съня (напр. сънна апнея)' },
    ],
  },
  {
    id: 'stress',
    num: 6,
    title: 'Ниво на стрес',
    subtitle: '1 = напълно спокойно ежедневие, 10 = постоянно високо напрежение.',
    type: 'scale',
    min: 1,
    max: 10,
  },
  {
    id: 'dailyActivity',
    num: 7,
    title: 'Активност през деня (извън тренировки)',
    type: 'single',
    options: [
      { value: 'Заседнала работа, минимално движение' },
      { value: 'Заседнала работа, но целенасочено движение' },
      { value: 'Работа на крака / умерено физическа' },
      { value: 'Тежък физически труд' },
    ],
  },
  {
    id: 'sportActivity',
    num: 8,
    title: 'Спортна активност',
    subtitle: 'В контекста на дневната ти активност — тренираш ли в момента?',
    type: 'single',
    options: [
      { value: 'Не тренирам в момента' },
      { value: 'Тренирам нередовно' },
      { value: 'Тренирам системно', input: { key: 'sportCurrent', placeholder: 'какъв вид тренировки' } },
    ],
  },
  {
    id: 'experience',
    num: 9,
    title: 'Тренировъчен опит',
    type: 'single',
    options: [
      { value: 'Никакъв / начинаещ (0–6 месеца системно)' },
      { value: 'Начинаещ–среден (6 месеца – 2 години)' },
      { value: 'Среден (2–5 години)' },
      { value: 'Напреднал (5+ години системно)' },
    ],
  },
  {
    id: 'nutrition',
    num: 10,
    title: 'Настоящ хранителен режим',
    type: 'fields',
    fields: [
      {
        key: 'type',
        label: 'Тип режим',
        type: 'choice',
        options: ['Без специфичен', 'Балансиран, неструктуриран', 'Структуриран с преброяване', 'Специфична диета'],
        required: true,
      },
      { key: 'custom', label: 'Каква диета', type: 'text', placeholder: 'напр. кето, веган…', showIf: { key: 'type', equals: 'Специфична диета' } },
      { key: 'mealsPerDay', label: 'Брой хранения на ден', type: 'number', min: 1, max: 8, required: true },
    ],
  },
  {
    id: 'goal',
    num: 11,
    title: 'Цел и срок',
    type: 'fields',
    fields: [
      {
        key: 'main',
        label: 'Основна цел',
        type: 'choice',
        options: ['Отслабване', 'Покачване на мускулна маса', 'Рекомпозиция', 'Силови показатели', 'Издръжливост', 'Обща кондиция', 'Рехабилитация след травма', 'Друго'],
        required: true,
      },
      { key: 'other', label: 'Опиши целта', type: 'text', showIf: { key: 'main', equals: 'Друго' } },
      { key: 'timeframe', label: 'Времева рамка', type: 'choice', options: ['Без краен срок', 'Конкретна дата'], required: true },
      { key: 'deadline', label: 'Дата / събитие', type: 'text', placeholder: 'напр. 1 септември, сватба през май…', showIf: { key: 'timeframe', equals: 'Конкретна дата' } },
    ],
  },
  {
    id: 'equipment',
    num: 12,
    title: 'Оборудване',
    subtitle: 'Планът ще включва само упражнения с наличното ти оборудване.',
    type: 'multi',
    options: [
      { value: 'Пълно оборудване на зала' },
      { value: 'Собствено тегло' },
      { value: 'Дъмбели' },
      { value: 'Щанга и дискове' },
      { value: 'Гира' },
      { value: 'Ластици' },
      { value: 'Стабилизираща топка' },
      { value: 'TRX / окачени ремъци' },
      { value: 'Друго', input: { key: 'equipmentOther', placeholder: 'опиши' } },
    ],
  },
  {
    id: 'preferences',
    num: 13,
    title: 'Тип тренировки, предпочитания и логистика',
    type: 'fields',
    fields: [
      {
        key: 'types',
        label: 'Предпочитан тип',
        type: 'chips',
        options: ['Силов тренинг', 'Кардио', 'HIIT', 'Функционален', 'Йога / мобилност', 'Отворен съм към препоръка'],
        required: true,
      },
      { key: 'avoid', label: 'Движения, които не желаеш да включваме', type: 'text', placeholder: 'напр. бърпи, скачане, клек с щанга…' },
      { key: 'freq', label: 'Брой тренировки седмично', type: 'choice', options: ['1–2', '3–4', '5–6', 'Ежедневно'], required: true },
      { key: 'duration', label: 'Продължителност на тренировка', type: 'choice', options: ['До 30 мин', '30–45 мин', '45–60 мин', 'Над 60 мин'], required: true },
      { key: 'timeOfDay', label: 'Предпочитано време на деня', type: 'choice', options: ['Сутрин', 'Обед', 'Следобед', 'Вечер', 'Варира'], required: true },
    ],
  },
  {
    id: 'extraInfo',
    num: 14,
    title: 'Допълнителна информация',
    subtitle: 'Всичко, което смяташ за релевантно и не беше покрито по-горе. (по избор)',
    type: 'text',
    optional: true,
    placeholder: 'напр. работя на смени, имам домашен любимец за разходки, мразя пътека…',
  },
];

/** Кои опции от стъпка са видими при текущото състояние (условен женски блок). */
export function visibleOptions(question, state) {
  const isFemale = state?.basics?.gender === 'Жена';
  return (question.options || []).filter((o) => !o.femaleOnly || isFemale);
}

/**
 * Валидация на една стъпка. Връща текст на грешка или null.
 * @param {object} question — елемент от QUESTIONS
 * @param {object} state — цялото състояние { [questionId]: value }
 */
export function validateQuestion(question, state) {
  const value = state[question.id];

  if (question.type === 'fields') {
    for (const f of question.fields) {
      if (f.showIf && value?.[f.showIf.key] !== f.showIf.equals) continue;
      const v = value?.[f.key];
      if (f.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length))) {
        return `Моля, попълни „${f.label}“.`;
      }
      if (f.type === 'number' && v !== undefined && v !== '' && v !== null) {
        const n = Number(v);
        if (Number.isNaN(n)) return `„${f.label}“ трябва да е число.`;
        if (f.min !== undefined && n < f.min) return `„${f.label}“ не може да е под ${f.min}.`;
        if (f.max !== undefined && n > f.max) return `„${f.label}“ не може да е над ${f.max}.`;
      }
    }
    return null;
  }

  if (question.type === 'multi') {
    if (!value?.selected?.length) return 'Избери поне една опция.';
    return null;
  }

  if (question.type === 'single') {
    if (!value?.selected) return 'Избери една от опциите.';
    return null;
  }

  if (question.type === 'scale') {
    if (value === undefined || value === null || value === '') return 'Премести плъзгача, за да отговориш.';
    return null;
  }

  if (question.type === 'text') {
    if (!question.optional && !String(value || '').trim()) return 'Моля, попълни полето.';
    return null;
  }

  return null;
}

/**
 * Превежда суровото състояние на визарда към формата на answers,
 * който POST /api/plan/generate очаква.
 */
export function buildAnswers(state) {
  const basics = state.basics || {};
  const health = state.health || { selected: [], inputs: {} };
  const limitations = state.limitations || { selected: [], inputs: {} };
  const wc = state.weightChange || {};
  const sport = state.sportActivity || {};
  const nutrition = state.nutrition || {};
  const goal = state.goal || {};
  const equipment = state.equipment || { selected: [], inputs: {} };
  const prefs = state.preferences || {};

  const femaleValues = new Set(['Бременна', 'Следродилен период', 'Нередовен цикъл', 'Аменорея', 'Менопауза', 'Хормонална контрацепция']);
  const healthGeneral = [];
  const healthFemale = [];
  for (const sel of health.selected || []) {
    let label = sel;
    if (sel === 'Бременна' && health.inputs?.pregnancyTrimester) label = `Бременна — триместър: ${health.inputs.pregnancyTrimester}`;
    if (sel === 'Следродилен период' && health.inputs?.postpartumMonths) label = `Следродилен период — ${health.inputs.postpartumMonths} месеца`;
    if (femaleValues.has(sel)) healthFemale.push(label);
    else if (sel !== 'Друго' && sel !== 'Приемам медикаменти редовно') healthGeneral.push(label);
    else if (sel === 'Приемам медикаменти редовно') healthGeneral.push(sel);
  }

  const limitationDetails = [];
  for (const sel of limitations.selected || []) {
    const inputMap = {
      'Диагностициран проблем': limitations.inputs?.limitDiagnosed,
      'Болка при конкретно движение без официална диагноза': limitations.inputs?.limitPainMove,
      'Прекаран хирургичен опорно-двигателен проблем': limitations.inputs?.limitSurgery,
      'Друго': limitations.inputs?.limitOther,
    };
    const detail = inputMap[sel];
    limitationDetails.push(detail ? `${sel}: ${detail}` : sel);
  }

  let weightChange = { type: 'stable' };
  if (wc.selected === 'Да, качих килограми') {
    weightChange = { type: 'gain', amountKg: Number(wc.inputs?.gainKg) || null, reason: wc.inputs?.gainReason || '' };
  } else if (wc.selected === 'Да, свалих килограми') {
    weightChange = { type: 'loss', amountKg: Number(wc.inputs?.lossKg) || null, reason: wc.inputs?.lossReason || '' };
  }

  return {
    gender: basics.gender || '',
    age: Number(basics.age) || null,
    heightCm: Number(basics.heightCm) || null,
    weightKg: Number(basics.weightKg) || null,
    health: healthGeneral,
    healthFemale,
    healthMeds: health.inputs?.healthMeds || '',
    healthOther: health.inputs?.healthOther || '',
    limitations: limitationDetails,
    weightChange,
    sleep: state.sleep?.selected || '',
    stress: Number(state.stress) || null,
    dailyActivity: state.dailyActivity?.selected || '',
    sportActivity: {
      status: sport.selected || '',
      current: sport.inputs?.sportCurrent || '',
    },
    experience: state.experience?.selected || '',
    nutrition: {
      type: nutrition.type || '',
      custom: nutrition.custom || '',
      mealsPerDay: Number(nutrition.mealsPerDay) || null,
    },
    goal: {
      main: goal.main || '',
      other: goal.other || '',
      deadline: goal.timeframe === 'Конкретна дата' ? (goal.deadline || '') : '',
    },
    equipment: (equipment.selected || []).filter((e) => e !== 'Друго'),
    equipmentOther: equipment.inputs?.equipmentOther || '',
    preferences: {
      types: prefs.types || [],
      avoid: prefs.avoid || '',
      freq: prefs.freq || '',
      duration: prefs.duration || '',
      timeOfDay: prefs.timeOfDay || '',
    },
    extraInfo: String(state.extraInfo || '').trim(),
  };
}
