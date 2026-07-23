/**
 * KA-TRAINER — декларативна дефиниция на клиентския въпросник.
 *
 * Типове стъпки:
 *   fields — списък от полета (choice / chips / number / text / textarea)
 *   multi  — чекбокси; опция може да има inline вход и/или exclusive флаг
 *   single — радио бутони; опция може да има inline входове
 *   scale  — плъзгач 1-10
 *   text   — свободен текст
 *
 * Условност:
 *   showIfGender — стъпката се показва само при избран пол (напр. 'Жена')
 *   field.showIf — { key, equals } спрямо стойност в същата стъпка
 *   field.showIfIn — { key, values[] } показва при някоя от стойностите
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
    subtitle: 'Общи медицински състояния, които влияят на безопасността на тренировката.',
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
      { value: 'Друго', input: { key: 'healthOther', placeholder: 'опиши' } },
    ],
  },
  {
    id: 'womenContext',
    num: 3,
    showIfGender: 'Жена',
    title: 'Женско здраве и тренировки',
    subtitle: 'Отделен въпрос само за жени. Ако нищо не се отнася за теб — избери първата опция.',
    type: 'single',
    options: [
      { value: 'Няма специфични състояния' },
      { value: 'Бременна', input: { key: 'pregnancyTrimester', placeholder: 'кой триместър (1, 2 или 3)' } },
      { value: 'Кърмя в момента', input: { key: 'breastfeedingMonths', placeholder: 'от колко месеца', type: 'number' } },
      { value: 'Скоро след раждане (до 6 месеца)', input: { key: 'postpartumMonths', placeholder: 'преди колко месеца', type: 'number' } },
      { value: 'Менопауза / перименопауза' },
      { value: 'Други хормонални особености', input: { key: 'womenOther', placeholder: 'напр. нередовен цикъл, аменорея…' } },
    ],
  },
  {
    id: 'womenImplants',
    num: 4,
    showIfGender: 'Жена',
    title: 'Гръдни импланти',
    subtitle: 'Влияе на избора и интензитета на упражненията за гърди. Отговори честно — за комфорт и безопасност.',
    type: 'single',
    options: [
      { value: 'Нямам гръдни импланти' },
      {
        value: 'Да — под гърдната жлеза (subglandular)',
        input: { key: 'implantMonths', placeholder: 'месеци от операцията (по избор)', type: 'number' },
      },
      {
        value: 'Да — под гръдния мускул (submuscular)',
        input: { key: 'implantMonths', placeholder: 'месеци от операцията (по избор)', type: 'number' },
      },
      {
        value: 'Да — не знам / не съм сигурна',
        input: { key: 'implantMonths', placeholder: 'месеци от операцията (по избор)', type: 'number' },
      },
    ],
  },
  {
    id: 'limitations',
    num: 5,
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
    num: 6,
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
    num: 7,
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
    num: 8,
    title: 'Ниво на стрес',
    subtitle: '1 = напълно спокойно ежедневие, 10 = постоянно високо напрежение.',
    type: 'scale',
    min: 1,
    max: 10,
  },
  {
    id: 'dailyActivity',
    num: 9,
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
    num: 10,
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
    num: 11,
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
    num: 12,
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
    num: 13,
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
      {
        key: 'zones',
        label: 'Приоритетни зони',
        type: 'text',
        placeholder: 'по ред на важност, напр. бедра, корем, дупе',
        showIfIn: { key: 'main', values: ['Отслабване', 'Покачване на мускулна маса', 'Рекомпозиция', 'Друго'] },
      },
      { key: 'timeframe', label: 'Времева рамка', type: 'choice', options: ['Без краен срок', 'Конкретна дата'], required: true },
      { key: 'deadline', label: 'Дата / събитие', type: 'text', placeholder: 'напр. 1 септември, сватба през май…', showIf: { key: 'timeframe', equals: 'Конкретна дата' } },
    ],
  },
  {
    id: 'equipment',
    num: 14,
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
    num: 15,
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
    num: 16,
    title: 'Допълнителна информация',
    subtitle: 'Всичко, което смяташ за релевантно и не беше покрито по-горе. (по избор)',
    type: 'text',
    optional: true,
    placeholder: 'напр. работя на смени, имам домашен любимец за разходки, мразя пътека…',
  },
];

const GOALS_WITH_ZONES = new Set(['Отслабване', 'Покачване на мускулна маса', 'Рекомпозиция', 'Друго']);

/** Видимо ли е поле в fields стъпка (showIf / showIfIn). */
export function fieldVisible(field, stepValue = {}) {
  if (field?.showIfIn) {
    return (field.showIfIn.values || []).includes(stepValue?.[field.showIfIn.key]);
  }
  if (field?.showIf) {
    return stepValue?.[field.showIf.key] === field.showIf.equals;
  }
  return true;
}

/** Кои стъпки са активни при текущото състояние (условни стъпки по пол). */
export function activeQuestions(state) {
  const gender = state?.basics?.gender;
  return QUESTIONS.filter((q) => !q.showIfGender || q.showIfGender === gender);
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
      if (!fieldVisible(f, value)) continue;
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
  const women = state.womenContext || { selected: null, inputs: {} };
  const implants = state.womenImplants || { selected: null, inputs: {} };
  const limitations = state.limitations || { selected: [], inputs: {} };
  const wc = state.weightChange || {};
  const sport = state.sportActivity || {};
  const nutrition = state.nutrition || {};
  const goal = state.goal || {};
  const equipment = state.equipment || { selected: [], inputs: {} };
  const prefs = state.preferences || {};

  const healthGeneral = [];
  const healthFemale = [];

  for (const sel of health.selected || []) {
    if (sel === 'Друго') {
      const other = (health.inputs?.healthOther || '').trim();
      healthGeneral.push(other || 'Друго');
    } else if (sel === 'Приемам медикаменти редовно') {
      healthGeneral.push(sel);
    } else if (sel !== 'Друго') {
      healthGeneral.push(sel);
    }
  }
  if (health.inputs?.healthMeds) healthGeneral.push(`медикаменти: ${health.inputs.healthMeds}`);

  if (women.selected && women.selected !== 'Няма специфични състояния') {
    let label = women.selected;
    if (women.selected === 'Бременна' && women.inputs?.pregnancyTrimester) {
      label = `Бременна — триместър: ${women.inputs.pregnancyTrimester}`;
    } else if (women.selected === 'Кърмя в момента' && women.inputs?.breastfeedingMonths) {
      label = `Кърмене — ${women.inputs.breastfeedingMonths} месеца`;
    } else if (women.selected === 'Скоро след раждане (до 6 месеца)' && women.inputs?.postpartumMonths) {
      label = `Следродилен период — ${women.inputs.postpartumMonths} месеца`;
    } else if (women.selected === 'Други хормонални особености' && women.inputs?.womenOther) {
      label = `Хормонални особености: ${women.inputs.womenOther}`;
    }
    healthFemale.push(label);
  }

  let breastImplants = null;
  if (implants.selected && implants.selected !== 'Нямам гръдни импланти') {
    breastImplants = {
      implants: implants.selected,
      implantMonths: implants.inputs?.implantMonths ? Number(implants.inputs.implantMonths) : null,
    };
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
    breastImplants,
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
      zones: GOALS_WITH_ZONES.has(goal.main) ? (goal.zones || '').trim() : '',
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

/**
 * Обратно преобразуване на answers → сурово състояние на визарда.
 * Използва се при зареждане на стари консултации без запазен formState.
 * За пълна точност предпочитай директно запазения formState.
 */
export function answersToFormState(answers) {
  if (!answers || typeof answers !== 'object') return {};

  const healthQuestion = QUESTIONS.find((q) => q.id === 'health');
  const healthOptionValues = new Set((healthQuestion?.options || []).map((o) => o.value));
  const healthSelected = [];
  const healthInputs = {};

  for (const item of answers.health || []) {
    if (item === 'Приемам медикаменти редовно') {
      healthSelected.push(item);
    } else if (item.startsWith('медикаменти: ')) {
      healthSelected.push('Приемам медикаменти редовно');
      healthInputs.healthMeds = item.slice('медикаменти: '.length);
    } else if (healthOptionValues.has(item)) {
      healthSelected.push(item);
    } else {
      healthSelected.push('Друго');
      healthInputs.healthOther = item;
    }
  }
  if (answers.healthMeds && !healthInputs.healthMeds) {
    if (!healthSelected.includes('Приемам медикаменти редовно')) healthSelected.push('Приемам медикаменти редовно');
    healthInputs.healthMeds = answers.healthMeds;
  }
  if (answers.healthOther && !healthInputs.healthOther) {
    if (!healthSelected.includes('Друго')) healthSelected.push('Друго');
    healthInputs.healthOther = answers.healthOther;
  }

  let womenSelected = 'Няма специфични състояния';
  const womenInputs = {};
  for (const label of answers.healthFemale || []) {
    if (label.startsWith('Бременна')) {
      womenSelected = 'Бременна';
      const match = label.match(/триместър:\s*(.+)$/i);
      if (match) womenInputs.pregnancyTrimester = match[1].trim();
    } else if (label.startsWith('Кърмене')) {
      womenSelected = 'Кърмя в момента';
      const match = label.match(/(\d+)/);
      if (match) womenInputs.breastfeedingMonths = match[1];
    } else if (label.startsWith('Следродилен')) {
      womenSelected = 'Скоро след раждане (до 6 месеца)';
      const match = label.match(/(\d+)/);
      if (match) womenInputs.postpartumMonths = match[1];
    } else if (label.startsWith('Хормонални особености:')) {
      womenSelected = 'Други хормонални особености';
      womenInputs.womenOther = label.replace(/^Хормонални особености:\s*/, '');
    } else {
      womenSelected = label;
    }
  }

  const limitInputKeys = {
    'Диагностициран проблем': 'limitDiagnosed',
    'Болка при конкретно движение без официална диагноза': 'limitPainMove',
    'Прекаран хирургичен опорно-двигателен проблем': 'limitSurgery',
    'Друго': 'limitOther',
  };
  const limitSelected = [];
  const limitInputs = {};
  for (const item of answers.limitations || []) {
    const sep = item.indexOf(': ');
    if (sep > -1) {
      const key = item.slice(0, sep);
      const val = item.slice(sep + 2);
      limitSelected.push(key);
      const inputKey = limitInputKeys[key];
      if (inputKey) limitInputs[inputKey] = val;
    } else {
      limitSelected.push(item);
    }
  }

  const wc = answers.weightChange || { type: 'stable' };
  let weightChange;
  if (wc.type === 'gain') {
    weightChange = {
      selected: 'Да, качих килограми',
      inputs: {
        gainKg: wc.amountKg != null ? String(wc.amountKg) : '',
        gainReason: wc.reason || '',
      },
    };
  } else if (wc.type === 'loss') {
    weightChange = {
      selected: 'Да, свалих килограми',
      inputs: {
        lossKg: wc.amountKg != null ? String(wc.amountKg) : '',
        lossReason: wc.reason || '',
      },
    };
  } else {
    weightChange = { selected: 'Не, теглото ми е стабилно', inputs: {} };
  }

  const equipmentSelected = [...(answers.equipment || [])];
  const equipmentInputs = {};
  if (answers.equipmentOther) {
    equipmentSelected.push('Друго');
    equipmentInputs.equipmentOther = answers.equipmentOther;
  }

  const goal = answers.goal || {};
  const prefs = answers.preferences || {};

  return {
    basics: {
      gender: answers.gender || '',
      age: answers.age != null ? String(answers.age) : '',
      heightCm: answers.heightCm != null ? String(answers.heightCm) : '',
      weightKg: answers.weightKg != null ? String(answers.weightKg) : '',
    },
    health: { selected: healthSelected, inputs: healthInputs },
    womenContext: { selected: womenSelected, inputs: womenInputs },
    womenImplants: answers.breastImplants?.implants
      ? {
        selected: answers.breastImplants.implants,
        inputs: answers.breastImplants.implantMonths != null
          ? { implantMonths: String(answers.breastImplants.implantMonths) }
          : {},
      }
      : { selected: 'Нямам гръдни импланти', inputs: {} },
    limitations: { selected: limitSelected, inputs: limitInputs },
    weightChange,
    sleep: answers.sleep ? { selected: answers.sleep } : {},
    stress: answers.stress != null ? answers.stress : '',
    dailyActivity: answers.dailyActivity ? { selected: answers.dailyActivity } : {},
    sportActivity: {
      selected: answers.sportActivity?.status || '',
      inputs: answers.sportActivity?.current ? { sportCurrent: answers.sportActivity.current } : {},
    },
    experience: answers.experience ? { selected: answers.experience } : {},
    nutrition: {
      type: answers.nutrition?.type || '',
      custom: answers.nutrition?.custom || '',
      mealsPerDay: answers.nutrition?.mealsPerDay != null ? String(answers.nutrition.mealsPerDay) : '',
    },
    goal: {
      main: goal.main || '',
      other: goal.other || '',
      zones: goal.zones || '',
      timeframe: goal.deadline ? 'Конкретна дата' : 'Без краен срок',
      deadline: goal.deadline || '',
    },
    equipment: { selected: equipmentSelected, inputs: equipmentInputs },
    preferences: {
      types: prefs.types || [],
      avoid: prefs.avoid || '',
      freq: prefs.freq || '',
      duration: prefs.duration || '',
      timeOfDay: prefs.timeOfDay || '',
    },
    extraInfo: answers.extraInfo || '',
  };
}
