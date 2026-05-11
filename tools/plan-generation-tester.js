#!/usr/bin/env node
/**
 * plan-generation-tester.js — Тестер за генериране на диетичен план (близо до реални условия)
 *
 * Зарежда реалните промпт шаблони от KV/prompts/, попълва ги с разнообразни потребителски профили,
 * изпраща ги към Gemini API, валидира отговорите и генерира HTML доклад.
 *
 * Използване:
 *   node tools/plan-generation-tester.js [опции]
 *
 * Опции:
 *   --step <1|2|3|4|all>            Коя стъпка да се тества (по подразбиране: all)
 *   --scenario <name|all>           Кой сценарий да се тества (по подразбиране: default)
 *   --list-scenarios                Изброява всички сценарии и изход
 *   --model <model-name>            Gemini модел (по подразбиране: gemini-2.5-flash)
 *   --user <файл.json>             JSON файл с потребителски данни (заменя сценария)
 *   --no-chain                      Не предава изхода на предишна стъпка към следваща
 *   --verbose                       Показва пълния промпт преди изпращане
 *   --dry-run                       Изгражда промптовете без да ги изпраща
 *   --html                          Генерира HTML доклад в tools/test-results/
 *   --no-validate                   Пропуска валидирането на отговорите
 *
 * Изисква:
 *   GEMINI_API_KEY=<ключ>
 *
 * Примери:
 *   GEMINI_API_KEY=xxx node tools/plan-generation-tester.js --scenario all --html
 *   GEMINI_API_KEY=xxx node tools/plan-generation-tester.js --scenario insulin_resistance --step all --verbose
 *   node tools/plan-generation-tester.js --list-scenarios
 *   node tools/plan-generation-tester.js --scenario obese_woman --dry-run --verbose
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Директории
// ─────────────────────────────────────────────────────────────────────────────
const ROOT_DIR    = path.resolve(__dirname, '..');
const PROMPTS_DIR = path.join(ROOT_DIR, 'KV', 'prompts');
const RESULTS_DIR = path.join(__dirname, 'test-results');

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// Константи (идентични с worker.js)
// ─────────────────────────────────────────────────────────────────────────────
const MIN_RECOMMENDED_CALORIES_FEMALE    = 1200;
const MIN_RECOMMENDED_CALORIES_MALE      = 1500;
const MIN_FAT_GRAMS_PER_KG               = 0.7;
const WATER_PER_KG_MULTIPLIER            = 0.035;
const BASE_WATER_NEED_LITERS             = 0.5;
const TEMPERAMENT_CONFIDENCE_THRESHOLD   = 80;
const HEALTH_STATUS_UNDERESTIMATE_PERCENT = 10;
const DAILY_CALORIE_TOLERANCE            = 50;
const MAX_LATE_SNACK_CALORIES            = 200;

const DAY_NUMBER_TO_KEY = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_NAMES_BG = {
  monday: 'Понеделник', tuesday: 'Вторник', wednesday: 'Сряда',
  thursday: 'Четвъртък', friday: 'Петък', saturday: 'Събота', sunday: 'Неделя'
};

// ─────────────────────────────────────────────────────────────────────────────
// Клинични протоколи (копирани от worker.js за вярност)
// ─────────────────────────────────────────────────────────────────────────────
const CLINICAL_PROTOCOLS = {
  insulin_resistance: {
    id: 'insulin_resistance',
    name: 'Инсулинова резистентност и Превенция на Диабет Т2',
    dietaryGuidelines: 'Нисък ГИ (<55); фибри 25–34g/ден; „Метод на чинията" (50% ненишестени зеленчуци, 25% чист протеин, 25% сложни въглехидрати).',
    restrictions: ['Рафинирани въглехидрати','Захар','Бял хляб','Бял ориз','Сладки напитки'],
    emphasis: ['Ненишестени зеленчуци','Бобови','Пълнозърнести','Чист протеин','Храни с нисък гликемичен индекс'],
    supplements: [
      { name: 'Мио-инозитол/D-хиро-инозитол (40:1)', dosage: '2000–4000mg', timing: 'сутрин' },
      { name: 'Берберин', dosage: '3 x 500mg', timing: 'преди хранене' },
      { name: 'Алфа-липоева киселина (ALA)', dosage: '600mg', timing: 'на гладно' },
      { name: 'Хром пиколинат', dosage: '200–1000mcg', timing: 'с хранене' }
    ],
    macroModifiers: { carbReduction: 10, proteinIncrease: 5, fatIncrease: 5 },
    dietTypeHint: 'Нисковъглехидратна / Нисък ГИ'
  },
  autoimmune_aip: {
    id: 'autoimmune_aip',
    name: 'Автоимунни заболявания и Чревна бариера (AIP)',
    dietaryGuidelines: 'Елиминация на зърнени, бобови, млечни, яйца, ядки, семена и нощни зеленчуци. Фокус върху костни бульони, омега-3 храни и ферментирали зеленчуци.',
    restrictions: ['Зърнени храни','Бобови','Млечни продукти','Яйца','Ядки','Семена','Нощни зеленчуци (домати, пиперки, патладжани, картофи)','Глутен'],
    emphasis: ['Костни бульони','Омега-3 риби (сьомга, скумрия)','Ферментирали зеленчуци','Зеленолистни зеленчуци','Органични меса'],
    supplements: [
      { name: 'L-Глутамин', dosage: '5–10g', timing: 'на гладно' },
      { name: 'Цинк карнозин', dosage: '2 x 75mg', timing: 'с хранене' },
      { name: 'Витамин D3 + K2', dosage: '5000IU / 100mcg', timing: 'с мазна храна' },
      { name: 'Колострум или Бутират', dosage: '500–1000mg', timing: 'на гладно' }
    ],
    macroModifiers: { carbReduction: 5, proteinIncrease: 5, fatIncrease: 0 },
    dietTypeHint: 'Автоимунен Палео Протокол (AIP)'
  },
  gi_issues: {
    id: 'gi_issues',
    name: 'Стомашно-чревни проблеми (Запек и Подуване)',
    dietaryGuidelines: 'Стратегия SMART; разтворими фибри (псилиум, овес); 2 кивита/ден; горчиви храни (артишок, рукола); магнезиева вода (0.5–1L).',
    restrictions: ['Газирани напитки','Дъвки без захар (сорбитол)','Прекомерни FODMAP храни','Пържени храни'],
    emphasis: ['Разтворими фибри (псилиум, овес)','Киви (2 бр./ден)','Горчиви храни (артишок, рукола)','Магнезиева вода','Ферментирали храни'],
    supplements: [
      { name: 'Магнезиев цитрат', dosage: '400–600mg', timing: 'вечер' },
      { name: 'Прокинетици (Джинджифил/Артишок)', dosage: '1–2 капсули', timing: 'на гладно' },
      { name: 'Псилиум хуск', dosage: '5–10g', timing: 'с много вода' }
    ],
    macroModifiers: { carbReduction: 0, proteinIncrease: 0, fatIncrease: 0 },
    dietTypeHint: 'Щадящ стомах / Нисък FODMAP'
  },
  menopause_sarcopenia: {
    id: 'menopause_sarcopenia',
    name: 'Менопауза и Саркопения',
    dietaryGuidelines: 'Протеин 1.0–1.2g/kg (равномерно разпределен); фитоестрогени (соя, ленено семе); калций и Вит. D от храна. Ограничаване на захар и алкохол.',
    restrictions: ['Захар','Алкохол','Високо преработени храни','Прекомерен кофеин'],
    emphasis: ['Високо протеинови храни','Фитоестрогени (соя, ленено семе)','Калций-богати храни','Витамин D от храна','Костни бульони'],
    supplements: [
      { name: 'Креатин монохидрат', dosage: '3–5g', timing: 'след тренировка или с хранене' },
      { name: 'Магнезиев бисглицинат', dosage: '300–400mg', timing: 'вечер' },
      { name: 'Омега-3 (високо EPA)', dosage: '2000mg', timing: 'с хранене' },
      { name: 'Витамин D3', dosage: '2000–4000IU', timing: 'с мазна храна' },
      { name: 'Колаген тип II', dosage: '40mg (нативен)', timing: 'на гладно' }
    ],
    macroModifiers: { carbReduction: 5, proteinIncrease: 10, fatIncrease: 0 },
    dietTypeHint: 'Високопротеинова / Средиземноморска'
  },
  postpartum_lactation: {
    id: 'postpartum_lactation',
    name: 'Възстановяване след бременност и Лактация',
    dietaryGuidelines: 'Допълнителни 330–400 kcal/ден; холин, йод, желязо. Отслабване до 0.5kg/седмица.',
    restrictions: ['Алкохол','Прекомерен кофеин (макс. 200mg/ден)','Сурови морски продукти','Високо живачни риби'],
    emphasis: ['Холин-богати храни (яйца, черен дроб)','Йод (морски продукти)','Желязо (месо, спанак)','Калций','Омега-3 (DHA)'],
    supplements: [
      { name: 'Холин (Alpha-GPC)', dosage: 'до 550mg общо', timing: 'с хранене' },
      { name: 'Железен бисглицинат', dosage: '18–25mg (при дефицит)', timing: 'на гладно с Вит.C' },
      { name: 'DHA (Омега-3)', dosage: 'мин. 1000mg', timing: 'с хранене' },
      { name: 'Калиев йодид (Йод)', dosage: '150–290mcg', timing: 'с хранене' }
    ],
    macroModifiers: { carbReduction: 0, proteinIncrease: 5, fatIncrease: 5 },
    dietTypeHint: 'Балансирана / Нутриент-плътна'
  },
  chronic_stress: {
    id: 'chronic_stress',
    name: 'Хроничен стрес (Кортизолова регулация)',
    dietaryGuidelines: 'Противовъзпалителна диета; балансирани хранения (протеин + мазнини + фибри); избягване на кофеин на гладно.',
    restrictions: ['Кофеин на гладно','Рафинирани въглехидрати','Захар','Алкохол','Енергийни напитки'],
    emphasis: ['Противовъзпалителни храни','Омега-3 мастни киселини','Магнезий-богати храни','Адаптогени','Сложни въглехидрати'],
    supplements: [
      { name: 'Ашваганда (KSM-66)', dosage: '300–600mg', timing: 'сутрин и/или вечер' },
      { name: 'Магнезиев L-треонат', dosage: '150–200mg елементен Mg', timing: 'вечер' },
      { name: 'L-Теанин', dosage: '200mg', timing: 'при стрес или вечер' },
      { name: 'Фосфатидилсерин (PS)', dosage: '100–300mg', timing: 'вечер' }
    ],
    macroModifiers: { carbReduction: 0, proteinIncrease: 5, fatIncrease: 5 },
    dietTypeHint: 'Противовъзпалителна / Балансирана'
  },
  visceral_fat: {
    id: 'visceral_fat',
    name: 'Висцерални мазнини (Коремно отслабване)',
    dietaryGuidelines: 'Полифеноли за „потъмняване" на мазнините (зелен чай, куркума, къпини); зехтин екстра върджин (EVOO) като основна мазнина.',
    restrictions: ['Транс мазнини','Рафинирани въглехидрати','Захар','Алкохол (особено бира)','Преработени храни'],
    emphasis: ['Зелен чай','Куркума','Къпини и горски плодове','Зехтин екстра върджин','Високо фиброви храни','Омега-3 риби'],
    supplements: [
      { name: 'EGCG (Зелен чай екстракт)', dosage: '400–500mg', timing: 'сутрин с хранене' },
      { name: 'Куркумин (+пиперин)', dosage: '500–1000mg', timing: 'с хранене' },
      { name: 'Транс-ресвератрол', dosage: '500mg', timing: 'сутрин' },
      { name: 'CLA (Конюгирана линолова киселина)', dosage: '3000–4000mg', timing: 'с хранене' }
    ],
    macroModifiers: { carbReduction: 10, proteinIncrease: 5, fatIncrease: 5 },
    dietTypeHint: 'Противовъзпалителна / Средиземноморска'
  }
};

function getClinicalProtocol(protocolId) {
  if (!protocolId) return null;
  return CLINICAL_PROTOCOLS[protocolId] || null;
}

function buildClinicalProtocolPromptSection(protocol) {
  if (!protocol) return '';
  return `
═══ 🏥 КЛИНИЧЕН ПРОТОКОЛ: ${protocol.name} ═══
⚠️ КРИТИЧНО: Следващите насоки са ЗАДЪЛЖИТЕЛНИ и имат ПРИОРИТЕТ над общите препоръки.

📋 ХРАНИТЕЛНИ НАСОКИ (ЗАДЪЛЖИТЕЛНИ):
${protocol.dietaryGuidelines}

✅ АКЦЕНТ ВЪРХУ:
${protocol.emphasis.map(e => `  - ${e}`).join('\n')}

❌ ОГРАНИЧАВАНЕ/ИЗБЯГВАНЕ:
${protocol.restrictions.map(r => `  - ${r}`).join('\n')}

💊 ПРОТОКОЛНА СУПЛЕМЕНТАЦИЯ:
${protocol.supplements.map(s => `  - ${s.name}: ${s.dosage} | Кога: ${s.timing}`).join('\n')}

🍽️ ПРЕПОРЪЧАН ТИП ДИЕТА: ${protocol.dietTypeHint}
═══════════════════════════════════════════════════════════════
`;
}

function buildClinicalProtocolSupplementSection(protocol) {
  if (!protocol) return '';
  return `
═══ 💊 ЗАДЪЛЖИТЕЛНИ СУПЛЕМЕНТИ ОТ КЛИНИЧЕН ПРОТОКОЛ ═══
Следните добавки са ЗАДЪЛЖИТЕЛНИ за "${protocol.name}". Включи ги в "supplements" масива.

${protocol.supplements.map(s => `ЗАДЪЛЖИТЕЛНА: ${s.name} — Дозировка: ${s.dosage} | Кога: ${s.timing}`).join('\n')}
═══════════════════════════════════════════════════════════════
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Тестови сценарии (реалистични български потребителски профили)
// ─────────────────────────────────────────────────────────────────────────────
const SCENARIOS = {

  // 1. Жена с наднормено тегло, инсулинова резистентност, 2 деца
  obese_woman: {
    label: 'Жена с наднормено тегло и IR',
    description: 'Жена 34 г, 84 кг, 163 см, IR, 2 деца, работи от вкъщи. Типичен случай.',
    data: {
      name: 'Мария',
      age: '34', gender: 'Жена', weight: '84', height: '163',
      goal: 'Отслабване', lossKg: '12',
      dailyActivityLevel: 'Ниско', sportActivity: '1–2 дни в седмицата',
      sleepHours: '6', sleepInterrupt: 'Често', chronotype: 'Вечерен тип',
      stressLevel: 'Високо', waterIntake: '1',
      medicalConditions: ['Инсулинова резистентност'],
      medications: 'Не', medicationsDetails: '',
      eatingHabits: ['Не закусвам', 'Ям предимно вечер', 'Ям бързо'],
      foodCravings: ['Сладко', 'Тестени'],
      foodTriggers: ['Стрес', 'Скука', 'Умора'],
      compensationMethods: ['Гладуване', 'Пропускам хранения'],
      overeatingFrequency: 'Често',
      drinksSweet: 'Ежедневно', drinksAlcohol: 'Рядко',
      dietHistory: 'Да', dietType: 'Ниско въглехидратна',
      dietResult: 'Загубих 6 кг, после ги върнах всичките',
      dietPreference: ['Средиземноморска'],
      dietDislike: 'Карфиол, черен дроб',
      dietLove: 'Пиле, риба, кисело мляко, зеленчуци',
      weightChange: 'Увеличение', weightChangeDetails: '+8 кг за 2 години',
      socialComparison: 'Много', additionalNotes: 'Работя от вкъщи, 2 малки деца, нямам почти никакво лично време. Много ми е трудно да готвя отделно за себе си.',
      clinicalProtocol: 'insulin_resistance',
      bloodSugarLevels: '6.1 mmol/L на гладно', insulinResistanceSymptoms: 'Умора след хранене, наддаване на корем',
      familyDiabetes: 'Да, майка ми има диабет тип 2'
    }
  },

  // 2. Активен мъж, цел мускулна маса
  muscle_gain_man: {
    label: 'Активен мъж, мускулна маса',
    description: 'Мъж 27 г, 78 кг, 182 см, тренира 5–7 дни. Цел: мускулна маса.',
    data: {
      name: 'Георги',
      age: '27', gender: 'Мъж', weight: '78', height: '182',
      goal: 'Мускулна маса', lossKg: '',
      dailyActivityLevel: 'Високо', sportActivity: '5–7 дни в седмицата',
      sleepHours: '7.5', sleepInterrupt: 'Не', chronotype: 'Сутрешен тип',
      stressLevel: 'Ниско', waterIntake: '3',
      medicalConditions: ['Нямам'],
      medications: 'Не', medicationsDetails: '',
      eatingHabits: ['Закусвам', 'Ям на редовни часове'],
      foodCravings: ['Солено'], foodTriggers: [],
      compensationMethods: ['Не'], overeatingFrequency: 'Рядко',
      drinksSweet: 'Рядко', drinksAlcohol: 'Рядко (1-2 пъти месечно)',
      dietHistory: 'Да', dietType: 'Високопротеинова',
      dietResult: 'Добри резултати, продължавам да оптимизирам',
      dietPreference: ['Високопротеинова'],
      dietDislike: 'Карфиол, брюкселско зеле',
      dietLove: 'Пилешки гърди, яйца, ориз, овесени ядки, банани',
      weightChange: 'Не', weightChangeDetails: '',
      socialComparison: 'Рядко', additionalNotes: 'Тренирам предимно вечер (18-20ч). Искам план с 5-6 хранения и предтренировъчно и посттренировъчно хранене.',
      clinicalProtocol: null
    }
  },

  // 3. Жена в менопауза, заседнал начин на живот
  menopause_woman: {
    label: 'Жена в менопауза, заседнал живот',
    description: 'Жена 54 г, 76 кг, 160 см, менопауза, офис работа. Цел: здраве и тегло.',
    data: {
      name: 'Елена',
      age: '54', gender: 'Жена', weight: '76', height: '160',
      goal: 'Отслабване', lossKg: '8',
      dailyActivityLevel: 'Ниско', sportActivity: '0 дни в седмицата',
      sleepHours: '5.5', sleepInterrupt: 'Много честo', chronotype: 'Среден тип',
      stressLevel: 'Много', waterIntake: '1.2',
      medicalConditions: ['Хипертония'],
      medications: 'Да', medicationsDetails: 'Лизиноприл 10 мг',
      eatingHabits: ['Закусвам', 'Ям когато имам стрес', 'Хапвам сладко между храненията'],
      foodCravings: ['Сладко', 'Солено'],
      foodTriggers: ['Стрес', 'Самота'],
      compensationMethods: ['Не'],
      overeatingFrequency: 'Понякога',
      drinksSweet: 'Рядко', drinksAlcohol: 'Рядко',
      dietHistory: 'Да', dietType: 'Различни диети',
      dietResult: 'Краткотрайни резултати, после всичко се връща',
      dietPreference: ['Средиземноморска'],
      dietDislike: 'Черен дроб, тиква',
      dietLove: 'Риба, зеленчуци, извара, кисело мляко',
      weightChange: 'Увеличение', weightChangeDetails: '+5 кг от началото на менопаузата',
      socialComparison: 'Понякога', additionalNotes: 'Имам горещи вълни. Спя много лошо. Не мога да тренирам поради болки в коленете.',
      clinicalProtocol: 'menopause_sarcopenia',
      menopauseStatus: 'Постменопауза (2 г)', menopauseSymptoms: 'Горещи вълни, нарушен сън, умора',
      strengthTraining: 'Не, поради болки в колената'
    }
  },

  // 4. Студент с нередовно хранене и стрес
  stressed_student: {
    label: 'Студент с хроничен стрес',
    description: 'Мъж 21 г, 68 кг, 178 см, студент, много стрес, нередовно хранене.',
    data: {
      name: 'Александър',
      age: '21', gender: 'Мъж', weight: '68', height: '178',
      goal: 'Поддържане на тегло', lossKg: '',
      dailyActivityLevel: 'Ниско', sportActivity: '0 дни в седмицата',
      sleepHours: '5', sleepInterrupt: 'Много честo', chronotype: 'Вечерен тип',
      stressLevel: 'Много', waterIntake: '1',
      medicalConditions: ['Нямам'],
      medications: 'Не', medicationsDetails: '',
      eatingHabits: ['Не закусвам', 'Ям предимно вечер', 'Ям много бързо'],
      foodCravings: ['Сладко', 'Тестени', 'Солено'],
      foodTriggers: ['Стрес', 'Скука'],
      compensationMethods: ['Не'],
      overeatingFrequency: 'Часто',
      drinksSweet: 'Ежедневно', drinksAlcohol: 'Понякога (уикенд)',
      dietHistory: 'Не', dietType: '', dietResult: '',
      dietPreference: ['Балансирана'],
      dietDislike: 'Риба, морски дарове',
      dietLove: 'Пица, паста, пиле, яйца',
      weightChange: 'Намаление', weightChangeDetails: '-3 кг за последните 6 месеца (стрес)',
      socialComparison: 'Много', additionalNotes: 'Учa в университет, имам изпити. Много рядко готвя — купувам храна от магазина или ям в стола. Трябва ми прост и евтин план.',
      clinicalProtocol: 'chronic_stress',
      stressSources: 'Изпити, работа на непълно работно време',
      stressSymptoms: 'Нарушен сън, главоболие, загуба на апетит',
      relaxationPractices: 'Никакви'
    }
  },

  // 5. Жена след раждане, кърми
  postpartum_nursing: {
    label: 'Жена след раждане, кърми',
    description: 'Жена 29 г, 70 кг, 166 см, 4 месеца след раждане, кърми.',
    data: {
      name: 'Ивана',
      age: '29', gender: 'Жена', weight: '70', height: '166',
      goal: 'Отслабване', lossKg: '6',
      dailyActivityLevel: 'Ниско', sportActivity: '1–2 дни в седмицата',
      sleepHours: '5', sleepInterrupt: 'Много честo', chronotype: 'Среден тип',
      stressLevel: 'Средно', waterIntake: '2',
      medicalConditions: ['Нямам'],
      medications: 'Не', medicationsDetails: '',
      eatingHabits: ['Закусвам', 'Ям бързо', 'Ям когато бебето спи'],
      foodCravings: ['Сладко'],
      foodTriggers: ['Умора', 'Липса на сън'],
      compensationMethods: ['Не'],
      overeatingFrequency: 'Рядко',
      drinksSweet: 'Рядко', drinksAlcohol: 'Не',
      dietHistory: 'Не', dietType: '', dietResult: '',
      dietPreference: ['Балансирана'],
      dietDislike: 'Карфиол, броколи (газовете)',
      dietLove: 'Пиле, яйца, овесени ядки, плодове',
      weightChange: 'Увеличение', weightChangeDetails: '+4 кг остатъчно тегло след бременността',
      socialComparison: 'Понякога', additionalNotes: 'Кърмя — много е важно да имам достатъчно хранителни вещества. Искам да отслабна но БАВНО и безопасно.',
      clinicalProtocol: 'postpartum_lactation',
      postpartumStatus: '4 месеца след раждане', breastfeedingFrequency: '8-10 пъти на 24 часа',
      postpartumGoal: 'Отслабване при запазване на млякото'
    }
  },

  // 6. Мъж с наднормено тегло и висцерални мазнини
  visceral_fat_man: {
    label: 'Мъж с висцерални мазнини',
    description: 'Мъж 45 г, 102 кг, 177 см, офис работа, коремен тип. Цел: отслабване.',
    data: {
      name: 'Николай',
      age: '45', gender: 'Мъж', weight: '102', height: '177',
      goal: 'Отслабване', lossKg: '20',
      dailyActivityLevel: 'Ниско', sportActivity: '0 дни в седмицата',
      sleepHours: '6', sleepInterrupt: 'Понякога', chronotype: 'Среден тип',
      stressLevel: 'Високо', waterIntake: '1.5',
      medicalConditions: ['Хипертония', 'Висок холестерол'],
      medications: 'Да', medicationsDetails: 'Розувастатин 10 мг, Периндоприл 5 мг',
      eatingHabits: ['Не закусвам', 'Ям голям обяд', 'Ям вечер след 20:00'],
      foodCravings: ['Солено', 'Месо'],
      foodTriggers: ['Стрес', 'Работни срещи'],
      compensationMethods: ['Не'],
      overeatingFrequency: 'Понякога',
      drinksSweet: 'Рядко', drinksAlcohol: 'Редовно (бира)',
      dietHistory: 'Не', dietType: '', dietResult: '',
      dietPreference: ['Средиземноморска'],
      dietDislike: 'Соя, тофу',
      dietLove: 'Месо, картофи, хляб, баница',
      weightChange: 'Увеличение', weightChangeDetails: '+15 кг за последните 5 години',
      socialComparison: 'Рядко', additionalNotes: 'Пия минимум 3-4 кафета на ден. Имам много бизнес вечери. Лекарят ми каза да отслабна заради налягането.',
      clinicalProtocol: 'visceral_fat',
      waistCircumference: '108 см', fatDistribution: 'Основно корем',
      metabolicSyndrome: 'Хипертония, висок холестерол'
    }
  },

  // 7. Жена с AIP диета (автоимунно заболяване)
  autoimmune_woman: {
    label: 'Жена с автоимунно заболяване (AIP)',
    description: 'Жена 38 г, 62 кг, 167 см, Хашимото, много ограничения.',
    data: {
      name: 'Теодора',
      age: '38', gender: 'Жена', weight: '62', height: '167',
      goal: 'Подобряване на здравето', lossKg: '',
      dailyActivityLevel: 'Ниско', sportActivity: '1–2 дни в седмицата',
      sleepHours: '7', sleepInterrupt: 'Понякога', chronotype: 'Среден тип',
      stressLevel: 'Средно', waterIntake: '2',
      medicalConditions: ['Автоимунно (Хашимото)'],
      medications: 'Да', medicationsDetails: 'Левотироксин 75 мкг',
      eatingHabits: ['Закусвам', 'Ям на редовни часове'],
      foodCravings: ['Сладко'],
      foodTriggers: ['Стрес'],
      compensationMethods: ['Не'],
      overeatingFrequency: 'Рядко',
      drinksSweet: 'Рядко', drinksAlcohol: 'Рядко',
      dietHistory: 'Да', dietType: 'AIP диета',
      dietResult: 'Намаляване на симптомите при стриктно спазване',
      dietPreference: ['AIP / Палео'],
      dietDislike: 'Зърнени, бобови, млечни, яйца, ядки, домати, пиперки',
      dietLove: 'Органично месо, дива риба, зелен зеленчуци, костни бульони',
      weightChange: 'Не', weightChangeDetails: '',
      socialComparison: 'Рядко', additionalNotes: 'Следвам стриктен AIP протокол вече 6 месеца. Искам разнообразие в менюто — много ми е трудно да намирам ядлива храна в рестораните.',
      clinicalProtocol: 'autoimmune_aip',
      autoimmuneDiagnosis: 'Хашимото тиреоидит',
      autoimmuneFlares: '1-2 пъти годишно',
      foodSensitivities: 'Да — всичко изброено в AIP',
      triggerFoods: 'Глутен, млечни, яйца, соя'
    }
  },

  // 8. Възрастна жена, цел поддържане/здраве
  elderly_woman: {
    label: 'Възрастна жена, здраве',
    description: 'Жена 67 г, 65 кг, 158 см, пенсионерка, хронични заболявания.',
    data: {
      name: 'Стоянка',
      age: '67', gender: 'Жена', weight: '65', height: '158',
      goal: 'Подобряване на здравето', lossKg: '',
      dailyActivityLevel: 'Ниско', sportActivity: '1–2 дни в седмицата',
      sleepHours: '6.5', sleepInterrupt: 'Понякога', chronotype: 'Сутрешен тип',
      stressLevel: 'Ниско', waterIntake: '1.5',
      medicalConditions: ['Хипертония', 'Диабет тип 2', 'Остеопороза'],
      medications: 'Да', medicationsDetails: 'Метформин 1000 мг, Периндоприл 10 мг, Калций + Вит. D',
      eatingHabits: ['Закусвам', 'Ям на редовни часове'],
      foodCravings: ['Сладко'],
      foodTriggers: [],
      compensationMethods: ['Не'],
      overeatingFrequency: 'Рядко',
      drinksSweet: 'Рядко', drinksAlcohol: 'Не',
      dietHistory: 'Да', dietType: 'Диабетна диета',
      dietResult: 'Помага за кръвната захар',
      dietPreference: ['Балансирана'],
      dietDislike: 'Мазно месо, пуйка',
      dietLove: 'Зеленчуки, супи, риба, кисело мляко',
      weightChange: 'Не', weightChangeDetails: '',
      socialComparison: 'Не', additionalNotes: 'Живея сама. Не мога да стоя дълго прав — готвя трудно. Трябва ми план с прости рецепти и достъпни продукти.',
      clinicalProtocol: null
    }
  },

  // 9. Жена с нормално тегло, цел форма и тонус
  toning_woman: {
    label: 'Жена — тонус и форма',
    description: 'Жена 31 г, 58 кг, 168 см, нормално тегло, иска тонус.',
    data: {
      name: 'Калина',
      age: '31', gender: 'Жена', weight: '58', height: '168',
      goal: 'Мускулна маса', lossKg: '',
      dailyActivityLevel: 'Средно', sportActivity: '2–4 дни в седмицата',
      sleepHours: '7.5', sleepInterrupt: 'Рядко', chronotype: 'Сутрешен тип',
      stressLevel: 'Средно', waterIntake: '2',
      medicalConditions: ['Нямам'],
      medications: 'Не', medicationsDetails: '',
      eatingHabits: ['Закусвам', 'Ям на редовни часове'],
      foodCravings: ['Сладко'],
      foodTriggers: ['Стрес'],
      compensationMethods: ['Спорт'],
      overeatingFrequency: 'Рядко',
      drinksSweet: 'Рядко', drinksAlcohol: 'Понякога (уикенд)',
      dietHistory: 'Не', dietType: '', dietResult: '',
      dietPreference: ['Средиземноморска', 'Високопротеинова'],
      dietDislike: 'Черен дроб, морски дарове',
      dietLove: 'Пиле, яйца, гръцко кисело мляко, ядки, зеленчуци, кафе',
      weightChange: 'Не', weightChangeDetails: '',
      socialComparison: 'Понякога', additionalNotes: 'Правя Pilates и леки тежести. Искам да изградя мускул без да напълнея. Имам нужда от десерти в плана, иначе се чупя.',
      clinicalProtocol: null
    }
  },

  // 10. Жена с GI проблеми (запек, подуване)
  gi_problems_woman: {
    label: 'Жена с ГИ проблеми (запек)',
    description: 'Жена 42 г, 67 кг, 162 см, хроничен запек и подуване.',
    data: {
      name: 'Весела',
      age: '42', gender: 'Жена', weight: '67', height: '162',
      goal: 'Подобряване на здравето', lossKg: '',
      dailyActivityLevel: 'Средно', sportActivity: '1–2 дни в седмицата',
      sleepHours: '7', sleepInterrupt: 'Рядко', chronotype: 'Среден тип',
      stressLevel: 'Средно', waterIntake: '1.5',
      medicalConditions: ['Храносмилателни проблеми (Запек, Подуване)'],
      medications: 'Не', medicationsDetails: '',
      eatingHabits: ['Закусвам', 'Ям бързо'],
      foodCravings: ['Сладко'],
      foodTriggers: ['Стрес'],
      compensationMethods: ['Не'],
      overeatingFrequency: 'Рядко',
      drinksSweet: 'Рядко', drinksAlcohol: 'Рядко',
      dietHistory: 'Не', dietType: '', dietResult: '',
      dietPreference: ['Балансирана'],
      dietDislike: 'Боб, леща (подуват ме)',
      dietLove: 'Зеленчуци, риба, кисело мляко, кефир',
      weightChange: 'Не', weightChangeDetails: '',
      socialComparison: 'Не', additionalNotes: 'Страдам от запек от години — изхождам 2-3 пъти седмично. Пия малко вода. Много се подувам след хранене.',
      clinicalProtocol: 'gi_issues',
      giSymptoms: 'Запек, подуване, газове',
      bowelFrequency: '2-3 пъти седмично',
      giTriggers: 'Бобови, газирани напитки, бързо хранене'
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Изчислителни функции (идентични с worker.js)
// ─────────────────────────────────────────────────────────────────────────────

function calculateBMR(data) {
  const weight = parseFloat(data.weight);
  const height = parseFloat(data.height);
  const age    = parseFloat(data.age);
  let bmr = 10 * weight + 6.25 * height - 5 * age;
  if (data.gender === 'Мъж') bmr += 5;
  else bmr -= 161;
  return Math.round(bmr);
}

function calculateUnifiedActivityScore(data) {
  const dailyActivityMap = { 'Ниско': 1, 'Средно': 2, 'Високо': 3 };
  const dailyScore = dailyActivityMap[data.dailyActivityLevel] || 2;
  let sportDays = 0;
  if (data.sportActivity) {
    const s = data.sportActivity;
    if (s.includes('0 дни'))    sportDays = 0;
    else if (s.includes('1–2')) sportDays = 1.5;
    else if (s.includes('2–4')) sportDays = 3;
    else if (s.includes('5–7')) sportDays = 6;
  }
  const combinedScore = Math.min(10, Math.max(1, dailyScore + sportDays));
  return {
    dailyScore, sportDays,
    combinedScore: Math.round(combinedScore * 10) / 10,
    activityLevel: combinedScore <= 3 ? 'Ниска' : combinedScore <= 6 ? 'Средна' : combinedScore <= 8 ? 'Висока' : 'Много висока'
  };
}

function calculateTDEE(bmr, activityScore) {
  const scoreMultipliers = { 1:1.2, 2:1.3, 3:1.375, 4:1.45, 5:1.525, 6:1.6, 7:1.675, 8:1.75, 9:1.85, 10:1.95 };
  const score = Math.min(10, Math.max(1, Math.round(activityScore)));
  return Math.round(bmr * (scoreMultipliers[score] || 1.4));
}

function calculateMacronutrientRatios(data, activityScore, tdee) {
  const weight = parseFloat(data.weight) || 70;
  const goal   = data.goal || '';
  let proteinPerKg = data.gender === 'Мъж'
    ? (activityScore >= 7 ? 2.0 : activityScore >= 5 ? 1.6 : 1.2)
    : (activityScore >= 7 ? 1.8 : activityScore >= 5 ? 1.4 : 1.0);
  if (goal.includes('Мускулна маса'))  proteinPerKg *= 1.2;
  else if (goal.includes('Отслабване')) proteinPerKg *= 1.1;
  const estimatedCalories = tdee || (data.gender === 'Мъж' ? weight * 30 : weight * 28);
  let proteinPercent = Math.round((weight * proteinPerKg * 4 / estimatedCalories) * 100);
  const remaining = 100 - proteinPercent;
  let carbsPercent = activityScore >= 7 ? Math.round(remaining * 0.6) : activityScore >= 4 ? Math.round(remaining * 0.5) : Math.round(remaining * 0.4);
  let fatsPercent  = remaining - carbsPercent;
  const total = proteinPercent + carbsPercent + fatsPercent;
  if (total !== 100) fatsPercent += (100 - total);
  return { protein: proteinPercent, carbs: carbsPercent, fats: fatsPercent, proteinGramsPerKg: Math.round(proteinPerKg * 10) / 10 };
}

function calculateSafeDeficit(tdee, goal) {
  if (!goal || !goal.includes('Отслабване')) return { targetCalories: tdee, deficitPercent: 0, maxDeficitCalories: tdee };
  const standardDeficit = 0.18;
  return {
    targetCalories: Math.round(tdee * (1 - standardDeficit)),
    deficitPercent: standardDeficit * 100,
    maxDeficitCalories: Math.round(tdee * 0.75),
    note: 'AI може да коригира при специални стратегии'
  };
}

function buildCombinedAdditionalNotes(data) {
  const sections = [];
  if (data.additionalNotes) sections.push(data.additionalNotes);
  return sections.join('\n\n');
}

function buildCompactAnalysis(analysis) {
  return {
    bmi:          analysis.bmi || null,
    realBMR:      analysis.correctedMetabolism?.realBMR || null,
    realTDEE:     analysis.correctedMetabolism?.realTDEE || null,
    psychoProfile: analysis.psychoProfile || null,
    temperament:  analysis.psychoProfile?.temperament || '',
    macroGrams:   analysis.macroGrams || null,
    macroRatios:  analysis.macroRatios || null,
    add1: ''
  };
}

function buildCompactAnalysisForStep3(analysis) {
  return {
    bmr:            analysis.bmr || null,
    Final_Calories: analysis.Final_Calories || analysis.recommendedCalories || null,
    macroRatios:    analysis.macroRatios || null,
    macroGrams:     analysis.macroGrams || null
  };
}

function estimateTokenCount(text) {
  if (!text) return 0;
  const cyrillicChars = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const cyrillicRatio = cyrillicChars / text.length;
  const charsPerToken = 4 - cyrillicRatio;
  return Math.ceil(text.length / charsPerToken);
}

function replacePromptVariables(template, variables) {
  return template.replace(/\{([\w.]+)\}/g, (match, key) => {
    const keys = key.split('.');
    let value = variables;
    for (const k of keys) {
      if (value == null || typeof value !== 'object' || !(k in value)) return match;
      value = value[k];
    }
    if (value == null) return '';
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  });
}

function enforceJSONOnlyPrompt(prompt) {
  return `CRITICAL INSTRUCTION: You MUST respond with ONLY a valid JSON object. 
Do not include any explanatory text, markdown formatting, or anything outside the JSON structure.
Your response must start with { or [ and end with } or ].
NO text before the JSON. NO text after the JSON. ONLY JSON.

` + prompt;
}

function parseAIResponse(text) {
  if (!text) return { error: 'Празен отговор' };
  let cleaned = text.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.search(/[\[{]/);
  if (start > 0) cleaned = cleaned.slice(start);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    return { error: `JSON parse error: ${e.message}`, raw: cleaned.slice(0, 500) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Изграждане на промптове
// ─────────────────────────────────────────────────────────────────────────────

function loadPrompt(name) {
  const filePath = path.join(PROMPTS_DIR, `${name}.txt`);
  if (!fs.existsSync(filePath)) throw new Error(`Промптът не е намерен: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function buildAnalysisPrompt(data) {
  const activityData = calculateUnifiedActivityScore(data);
  const bmr          = calculateBMR(data);
  const tdee         = calculateTDEE(bmr, activityData.combinedScore);
  const deficitData  = calculateSafeDeficit(tdee, data.goal);
  const macros       = calculateMacronutrientRatios(data, activityData.combinedScore, tdee);
  const waterMin     = (parseFloat(data.weight) * WATER_PER_KG_MULTIPLIER + BASE_WATER_NEED_LITERS).toFixed(2);
  const waterMax     = (parseFloat(data.weight) * WATER_PER_KG_MULTIPLIER + BASE_WATER_NEED_LITERS + 0.3).toFixed(2);
  const combinedNotes = buildCombinedAdditionalNotes(data);
  const additionalNotesSection = combinedNotes
    ? `═══ 🔥 ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ (КРИТИЧЕН ПРИОРИТЕТ) 🔥 ═══\n${combinedNotes}\n═══════════════════════════════════════════════════════════════`
    : '';

  const protocol = getClinicalProtocol(data.clinicalProtocol);

  const template = loadPrompt('admin_analysis_prompt');
  const prompt = replacePromptVariables(template, {
    userData: JSON.stringify(data, null, 2),
    backendCalculations: JSON.stringify({ activityScore: activityData, bmr, tdee, safeDeficit_reference: deficitData, baselineMacros: macros }, null, 2),
    bmr, tdee,
    activityScore: JSON.stringify(activityData),
    safeDeficit: JSON.stringify(deficitData),
    baselineMacros: JSON.stringify(macros),
    combinedScore: activityData.combinedScore,
    activityLevel: activityData.activityLevel,
    waterMin, waterMax,
    name: data.name, age: data.age, gender: data.gender, weight: data.weight, height: data.height,
    goal: data.goal, lossKg: data.lossKg || '',
    sleepHours: data.sleepHours, sleepInterrupt: data.sleepInterrupt || '',
    chronotype: data.chronotype, sportActivity: data.sportActivity,
    dailyActivityLevel: data.dailyActivityLevel, stressLevel: data.stressLevel,
    waterIntake: data.waterIntake || 'неизвестен',
    medicalConditions: JSON.stringify(data.medicalConditions || []),
    medicalConditions_other: data.medicalConditions_other || '',
    medicalConditions_allergy_details: data['medicalConditions_Алергии'] || '',
    medicalConditions_autoimmune_details: data['medicalConditions_Автоимунно'] || '',
    medicalConditions_cardiovascular_details: data['medicalConditions_Сърдечно-съдови_детайл'] || '',
    medicalConditions_endocrine_details: data['medicalConditions_Ендокринни_детайл'] || '',
    medicalConditions_digestive_details: data['medicalConditions_Храносмилателни_детайл'] || '',
    medicalConditions_metabolic_details: data['medicalConditions_Метаболитни_детайл'] || '',
    medicalConditions_musculoskeletal_details: data['medicalConditions_Мускулно-скелетни_детайл'] || '',
    medications: data.medications, medicationsDetails: data.medicationsDetails || '',
    medicationsText: data.medications === 'Да' ? (data.medicationsDetails || 'Да') : 'Не приема',
    eatingHabits: JSON.stringify(data.eatingHabits || []),
    foodCravings: JSON.stringify(data.foodCravings || []),
    foodCravings_other: data.foodCravings_other || '',
    foodTriggers: JSON.stringify(data.foodTriggers || []),
    foodTriggers_other: data.foodTriggers_other || '',
    compensationMethods: JSON.stringify(data.compensationMethods || []),
    compensationMethods_other: data.compensationMethods_other || '',
    socialComparison: data.socialComparison || '',
    dietHistory: data.dietHistory || '', dietPreference_other: data.dietPreference_other || '',
    goal_other: data.goal_other || '',
    additionalNotes: combinedNotes,
    protocolSpecificAnswers: '',
    additionalNotesSection,
    TEMPERAMENT_CONFIDENCE_THRESHOLD,
    HEALTH_STATUS_UNDERESTIMATE_PERCENT,
    MIN_RECOMMENDED_CALORIES: data.gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE,
    MIN_FAT_GRAMS: Math.round((parseFloat(data.weight) || 70) * MIN_FAT_GRAMS_PER_KG),
    clinicalProtocolSection: protocol ? buildClinicalProtocolPromptSection(protocol) : '',
    clinicalProtocolName: protocol ? protocol.name : ''
  });
  return enforceJSONOnlyPrompt(prompt);
}

function buildStrategyPrompt(data, analysis) {
  const analysisCompact = buildCompactAnalysis(analysis);
  const combinedNotes   = buildCombinedAdditionalNotes(data);
  const additionalNotesSection = combinedNotes
    ? `═══ ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ОТ ПОТРЕБИТЕЛЯ (КРИТИЧЕН ПРИОРИТЕТ) ═══\n${combinedNotes}\n═══════════════════════════════════════════════════════════════`
    : '';
  const protocol = getClinicalProtocol(data.clinicalProtocol);

  const template = loadPrompt('admin_strategy_prompt');
  const prompt = replacePromptVariables(template, {
    userData: JSON.stringify(data, null, 2),
    analysisData: JSON.stringify(analysisCompact, null, 2),
    name: data.name, age: data.age, goal: data.goal,
    bmi: analysisCompact.bmi,
    realBMR: analysisCompact.realBMR,
    realTDEE: analysisCompact.realTDEE,
    macroProteinG: analysisCompact.macroGrams?.protein ?? '',
    macroCarbsG:   analysisCompact.macroGrams?.carbs   ?? '',
    macroFatsG:    analysisCompact.macroGrams?.fats    ?? '',
    macroProteinPct: analysisCompact.macroRatios?.protein ?? '',
    macroCarbsPct:   analysisCompact.macroRatios?.carbs   ?? '',
    macroFatsPct:    analysisCompact.macroRatios?.fats    ?? '',
    psychoProfile: JSON.stringify(analysisCompact.psychoProfile),
    temperament: analysisCompact.temperament,
    temperamentProbability: analysisCompact.psychoProfile?.probability || 0,
    add1: analysisCompact.add1 || '',
    dietPreference: JSON.stringify(data.dietPreference || []),
    dietPreference_other: data.dietPreference_other || '',
    dietDislike: data.dietDislike || '', dietLove: data.dietLove || '',
    goal_other: data.goal_other || '',
    medicalConditions: JSON.stringify(data.medicalConditions || []),
    medicalConditions_other: data.medicalConditions_other || '',
    medicalConditions_allergy_details: data['medicalConditions_Алергии'] || '',
    medicalConditions_autoimmune_details: data['medicalConditions_Автоимунно'] || '',
    medicalConditions_cardiovascular_details: data['medicalConditions_Сърдечно-съдови_детайл'] || '',
    medicalConditions_endocrine_details: data['medicalConditions_Ендокринни_детайл'] || '',
    medicalConditions_digestive_details: data['medicalConditions_Храносмилателни_детайл'] || '',
    medicalConditions_metabolic_details: data['medicalConditions_Метаболитни_детайл'] || '',
    medicalConditions_musculoskeletal_details: data['medicalConditions_Мускулно-скелетни_детайл'] || '',
    additionalNotes: combinedNotes, protocolSpecificAnswers: '',
    additionalNotesSection,
    eatingHabits: JSON.stringify(data.eatingHabits || []),
    chronotype: data.chronotype || 'Среден тип',
    overeatingFrequency: data.overeatingFrequency || '',
    foodCravings: JSON.stringify(data.foodCravings || []),
    foodCravings_other: data.foodCravings_other || '',
    foodTriggers: JSON.stringify(data.foodTriggers || []),
    foodTriggers_other: data.foodTriggers_other || '',
    compensationMethods: JSON.stringify(data.compensationMethods || []),
    compensationMethods_other: data.compensationMethods_other || '',
    drinksSweet: data.drinksSweet || '', drinksAlcohol: data.drinksAlcohol || '',
    dietHistory: data.dietHistory || '', dietHistoryType: data.dietType || '',
    dietHistoryResult: data.dietResult || '',
    medications: data.medications || 'Не', medicationsDetails: data.medicationsDetails || '',
    medicationsText: data.medications === 'Да' ? (data.medicationsDetails || 'Да') : 'Не приема',
    weightChange: data.weightChange || '', weightChangeDetails: data.weightChangeDetails || '',
    medicalConditionsText: (data.medicalConditions || []).join(', ') || 'Няма',
    allGoals: Array.isArray(data.goal) ? data.goal.join(', ') : (data.goal || ''),
    stressLevel: data.stressLevel || '', sleepHours: data.sleepHours || '',
    TEMPERAMENT_CONFIDENCE_THRESHOLD,
    clinicalProtocolSection: protocol ? buildClinicalProtocolPromptSection(protocol) : '',
    clinicalProtocolName: protocol ? protocol.name : ''
  });
  return enforceJSONOnlyPrompt(prompt);
}

function buildMealPlanPrompt(data, analysis, strategy, startDay = 1, endDay = 7) {
  const analysisCompact = buildCompactAnalysisForStep3(analysis);
  const bmr = analysis.bmr || calculateBMR(data);
  let recommendedCalories = analysis.Final_Calories || analysis.recommendedCalories;
  if (!recommendedCalories) {
    const ad  = calculateUnifiedActivityScore(data);
    const tdee = calculateTDEE(bmr, ad.combinedScore);
    recommendedCalories = data.goal?.includes('Отслабване') ? Math.round(tdee * 0.85) : tdee;
  }
  const calorieFloor = data.gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE;
  if (recommendedCalories < calorieFloor) recommendedCalories = calorieFloor;

  const dietaryModifier = strategy.dietaryModifier || 'Балансирано';
  const freeDayNumber   = strategy.freeDayNumber || null;

  const strategyCompact = {
    dietType: strategy.dietType || 'Балансирана',
    weeklyMealPattern: strategy.weeklyMealPattern || 'Традиционна',
    mealTiming: strategy.mealTiming?.pattern || '3 хранения дневно',
    keyPrinciples: (strategy.keyPrinciples || []).slice(0, 3).join('; '),
    foodsToInclude: (strategy.preferredFoodCategories || []).slice(0, 5).join(', '),
    foodsToAvoid: (strategy.avoidFoodCategories || []).slice(0, 5).join(', '),
    calorieDistribution: strategy.calorieDistribution || '',
    macroDistribution: strategy.macroDistribution || ''
  };

  const weeklySchemeByDayText = (() => {
    const lines = [];
    for (let d = startDay; d <= endDay; d++) {
      const key = DAY_NUMBER_TO_KEY[d - 1];
      const dayTarget = strategy.weeklyScheme && strategy.weeklyScheme[key];
      const kcal = dayTarget?.calories || recommendedCalories;
      const macroStr = (dayTarget?.protein && dayTarget?.carbs && dayTarget?.fats)
        ? ` | Б:${dayTarget.protein}г В:${dayTarget.carbs}г М:${dayTarget.fats}г` : '';
      const freeDayNote = (freeDayNumber !== null && d === freeDayNumber) ? ' ← ДЕН С СВОБОДНО ХРАНЕНЕ' : '';
      lines.push(`   Ден ${d} (${DAY_NAMES_BG[key] || key}): ~${kcal} kcal${macroStr} (±${DAILY_CALORIE_TOLERANCE} kcal OK)${freeDayNote}`);
      if (dayTarget?.mealBreakdown && Array.isArray(dayTarget.mealBreakdown)) {
        dayTarget.mealBreakdown.forEach(m => {
          if (m.type === 'Свободно хранене') {
            lines.push(`     → ${m.type}: без фиксирана калорийна цел`);
          } else {
            lines.push(`     → ${m.type}: ~${m.calories} kcal | Б:${m.protein}г В:${m.carbs}г М:${m.fats}г`);
          }
        });
      }
    }
    return lines.join('\n');
  })();

  const hasSweetsCraving = (data.foodCravings || []).some(c => typeof c === 'string' && c.includes('Сладко'));
  const freeMealInstruction = freeDayNumber !== null
    ? `\nСВОБОДЕН ДЕН (Ден ${freeDayNumber}): Добави "Свободно хранене" вместо Хранене 2.`
    : '\nНяма свободен ден тази седмица.';
  const sweetsCravingRule = hasSweetsCraving && strategy?.includeDessert !== false
    ? '\nНУЖДА ОТ СЛАДКО: Добави десерт ("dessert": true) към Хранене 2 в един ден от седмицата.'
    : '';

  const mealNameFormatInstructions = `ФОРМАТ НА ИМЕ: "name" трябва да е конкретно ястие на български (напр. "Пилешко с броколи и ориз").`;
  const combinedNotes = buildCombinedAdditionalNotes(data);

  const protocol = getClinicalProtocol(data.clinicalProtocol);

  const template = loadPrompt('admin_meal_plan_prompt');
  const prompt = replacePromptVariables(template, {
    startDay, endDay,
    'userData.name': data.name,
    'userData.goal': data.goal,
    'userData.stressLevel': data.stressLevel || '',
    'userData.sleepHours': data.sleepHours || '',
    'userData.chronotype': data.chronotype || '',
    'userData.eatingHabits': JSON.stringify(data.eatingHabits || []),
    bmr, recommendedCalories,
    dietaryModifier,
    modificationsSection: '',
    previousDaysContext: '',
    'analysisCompact.macroRatios': JSON.stringify(analysisCompact.macroRatios || {}),
    'analysisCompact.macroGrams': JSON.stringify(analysisCompact.macroGrams || {}),
    'strategyCompact.dietType': strategyCompact.dietType,
    'strategyCompact.mealTiming': strategyCompact.mealTiming,
    'strategyCompact.keyPrinciples': strategyCompact.keyPrinciples,
    'strategyCompact.foodsToInclude': strategyCompact.foodsToInclude,
    'strategyCompact.foodsToAvoid': strategyCompact.foodsToAvoid,
    'strategyCompact.calorieDistribution': strategyCompact.calorieDistribution,
    'strategyCompact.macroDistribution': strategyCompact.macroDistribution,
    dietLove: data.dietLove || 'няма',
    dietDislike: data.dietDislike || 'няма',
    weeklySchemeByDayText,
    additionalNotes: combinedNotes || 'Няма',
    clinicalProtocolSection: protocol ? buildClinicalProtocolPromptSection(protocol) : '',
    dynamicMainlistSection: '',
    dynamicWhitelistSection: '',
    dynamicBlacklistSection: '',
    DAILY_CALORIE_TOLERANCE,
    MAX_LATE_SNACK_CALORIES,
    'strategyData.mealCountJustification': strategy.mealCountJustification || '3-4 хранения дневно',
    sweetsCravingRule,
    freeMealInstruction,
    MEAL_NAME_FORMAT_INSTRUCTIONS: mealNameFormatInstructions
  });
  return enforceJSONOnlyPrompt(prompt);
}

function buildSummaryPrompt(data, analysis, strategy, mealPlan) {
  const template = loadPrompt('admin_summary_prompt');

  const bmr = analysis.bmr || calculateBMR(data);
  const recommendedCalories = analysis.Final_Calories || analysis.recommendedCalories || 1600;

  let avgCalories = recommendedCalories, avgProtein = 0, avgCarbs = 0, avgFats = 0;
  if (mealPlan) {
    const days = [];
    for (let d = 1; d <= 7; d++) {
      const key = `day${d}`;
      if (mealPlan[key]?.dailyTotals) days.push(mealPlan[key].dailyTotals);
    }
    if (days.length > 0) {
      avgCalories = Math.round(days.reduce((s, d) => s + (d.calories || 0), 0) / days.length);
      avgProtein  = Math.round(days.reduce((s, d) => s + (d.protein || 0),  0) / days.length);
      avgCarbs    = Math.round(days.reduce((s, d) => s + (d.carbs || 0),    0) / days.length);
      avgFats     = Math.round(days.reduce((s, d) => s + (d.fats || 0),     0) / days.length);
    }
  }

  const temperament = analysis.psychoProfile?.temperament || '';
  const temperamentProbability = analysis.psychoProfile?.probability || 0;
  const psychologicalProfile = analysis.psychologicalProfile || '';
  const dietType = strategy.dietType || 'Балансирана';
  const keyProblems = JSON.stringify((analysis.keyProblems || []).map(p => p.title || p));
  const hydrationStrategy = strategy.hydrationStrategy || '2 л вода дневно';
  const combinedNotes = buildCombinedAdditionalNotes(data);
  const additionalNotesSection = combinedNotes
    ? `═══ ДОПЪЛНИТЕЛНА ИНФОРМАЦИЯ ═══\n${combinedNotes}\n═══════════════════════════════════════════`
    : '';

  const protocol = getClinicalProtocol(data.clinicalProtocol);

  const prompt = replacePromptVariables(template, {
    name: data.name, goal: data.goal, bmr, recommendedCalories, avgCalories,
    avgProtein, avgCarbs, avgFats,
    temperament, temperamentProbability, psychologicalProfile, dietType,
    keyProblems, medications: data.medications || 'Не',
    additionalNotesSection,
    clinicalProtocolSection: protocol ? buildClinicalProtocolPromptSection(protocol) : '',
    clinicalProtocolSupplementSection: protocol ? buildClinicalProtocolSupplementSection(protocol) : '',
    dynamicWhitelistSection: '', dynamicBlacklistSection: '',
    hydrationStrategy
  });
  return enforceJSONOnlyPrompt(prompt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Валидиране на отговорите
// ─────────────────────────────────────────────────────────────────────────────

function validateAnalysis(parsed, userData) {
  const issues = [];
  if (!parsed || parsed.error) { issues.push('❌ JSON грешка или празен отговор'); return issues; }
  if (!parsed.bmi)            issues.push('⚠️  Липсва bmi');
  if (!parsed.bmr)            issues.push('⚠️  Липсва bmr');
  if (!parsed.Final_Calories) issues.push('⚠️  Липсва Final_Calories');
  if (!parsed.macroGrams)     issues.push('⚠️  Липсва macroGrams');
  if (!parsed.psychoProfile)  issues.push('⚠️  Липсва psychoProfile');
  if (!parsed.keyProblems || !parsed.keyProblems.length) issues.push('⚠️  Липсват keyProblems');
  if (parsed.Final_Calories) {
    const minCal = userData.gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE;
    if (parsed.Final_Calories < minCal) issues.push(`❌ Final_Calories ${parsed.Final_Calories} под минимума ${minCal}`);
    if (parsed.Final_Calories > 5000)   issues.push(`⚠️  Final_Calories ${parsed.Final_Calories} изглежда прекалено висок`);
  }
  if (parsed.macroRatios) {
    const sum = (parsed.macroRatios.protein || 0) + (parsed.macroRatios.carbs || 0) + (parsed.macroRatios.fats || 0);
    if (Math.abs(sum - 100) > 3) issues.push(`❌ Макроси сума ${sum}% (трябва да е 100%)`);
  }
  return issues;
}

function validateStrategy(parsed) {
  const issues = [];
  if (!parsed || parsed.error) { issues.push('❌ JSON грешка или празен отговор'); return issues; }
  if (!parsed.dietType)        issues.push('⚠️  Липсва dietType');
  if (!parsed.weeklyScheme)    issues.push('⚠️  Липсва weeklyScheme');
  if (!parsed.dietaryModifier) issues.push('⚠️  Липсва dietaryModifier');
  if (parsed.weeklyScheme) {
    const days = Object.keys(parsed.weeklyScheme);
    if (days.length < 7) issues.push(`⚠️  weeklyScheme има само ${days.length} дни (очаква се 7)`);
    days.forEach(day => {
      const d = parsed.weeklyScheme[day];
      if (!d.calories) issues.push(`⚠️  Липсват калории за ${day}`);
      if (!d.meals)    issues.push(`⚠️  Липсват meals за ${day}`);
    });
  }
  return issues;
}

function validateMealPlan(parsed, userData) {
  const issues = [];
  if (!parsed || parsed.error) { issues.push('❌ JSON грешка или празен отговор'); return issues; }
  const minCal = userData.gender === 'Мъж' ? MIN_RECOMMENDED_CALORIES_MALE : MIN_RECOMMENDED_CALORIES_FEMALE;
  let missingDays = [];
  for (let d = 1; d <= 7; d++) {
    const key = `day${d}`;
    if (!parsed[key]) { missingDays.push(d); continue; }
    const day = parsed[key];
    if (!day.meals || !day.meals.length) {
      issues.push(`⚠️  Ден ${d}: няма хранения`);
    }
    if (!day.dailyTotals) {
      issues.push(`⚠️  Ден ${d}: липсват dailyTotals`);
    } else {
      const cal = day.dailyTotals.calories || 0;
      if (cal < minCal)   issues.push(`❌ Ден ${d}: ${cal} kcal под минимума ${minCal}`);
      if (cal > 5000)     issues.push(`⚠️  Ден ${d}: ${cal} kcal изглежда прекалено висок`);
      const macroSum = (day.dailyTotals.protein || 0)*4 + (day.dailyTotals.carbs || 0)*4 + (day.dailyTotals.fats || 0)*9;
      if (macroSum > 0 && Math.abs(macroSum - cal) > cal * 0.15) {
        issues.push(`⚠️  Ден ${d}: макроси дават ${Math.round(macroSum)} kcal, dailyTotals казва ${cal}`);
      }
    }
    // Check for forbidden foods (AIP)
    if (userData.clinicalProtocol === 'autoimmune_aip') {
      const mealText = JSON.stringify(day.meals).toLowerCase();
      ['яйца', 'ядки', 'боб', 'леща', 'домат', 'пипер', 'картоф', 'ориз', 'хляб', 'мляко', 'сирене'].forEach(f => {
        if (mealText.includes(f)) issues.push(`⚠️  Ден ${d}: открит AIP-забранен продукт: ${f}`);
      });
    }
  }
  if (missingDays.length) issues.push(`❌ Липсват дни: ${missingDays.join(', ')}`);
  return issues;
}

function validateSummary(parsed) {
  const issues = [];
  if (!parsed || parsed.error) { issues.push('❌ JSON грешка или празен отговор'); return issues; }
  if (!parsed.recommendations || !parsed.recommendations.length) issues.push('⚠️  Липсват recommendations');
  if (!parsed.forbidden       || !parsed.forbidden.length)       issues.push('⚠️  Липсват forbidden');
  if (!parsed.supplements     || !parsed.supplements.length)     issues.push('⚠️  Липсват supplements');
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Извикване на Gemini API
// ─────────────────────────────────────────────────────────────────────────────

async function callGemini(apiKey, prompt, modelName = 'gemini-2.5-flash', maxTokens = 8192) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API грешка ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = await response.json();

  if (data.candidates?.[0]) {
    const candidate = data.candidates[0];
    if (candidate.finishReason && candidate.finishReason !== 'STOP') {
      if (candidate.finishReason === 'MAX_TOKENS' && candidate.content?.parts?.[0]) {
        console.warn(`  ⚠️  MAX_TOKENS — частичен отговор`);
        return candidate.content.parts[0].text;
      }
      throw new Error(`Gemini спря: ${candidate.finishReason}`);
    }
    if (!candidate.content?.parts?.[0]) throw new Error('Gemini върна празен отговор');
    return candidate.content.parts[0].text;
  }

  throw new Error('Невалиден формат на отговор от Gemini');
}

// ─────────────────────────────────────────────────────────────────────────────
// Форматиране на изхода в конзолата
// ─────────────────────────────────────────────────────────────────────────────

function printValidation(issues) {
  if (!issues.length) {
    console.log('  ✅ Валидирането премина успешно — без проблеми');
  } else {
    console.log(`  🔍 Валидиране: ${issues.length} проблем(а):`);
    issues.forEach(i => console.log(`     ${i}`));
  }
}

function formatAnalysisSummary(parsed) {
  if (parsed.error) return `  ❌ Грешка: ${parsed.error}`;
  const lines = [
    `  BMI: ${parsed.bmi} (${parsed.bmiCategory || '—'})`,
    `  BMR: ${parsed.bmr || '—'} kcal | TDEE: ${parsed.tdee || '—'} kcal | Финални: ${parsed.Final_Calories || '—'} kcal`,
    `  Макроси: Б${parsed.macroGrams?.protein || '?'}г / В${parsed.macroGrams?.carbs || '?'}г / М${parsed.macroGrams?.fats || '?'}г`,
    `  Темперамент: ${parsed.psychoProfile?.temperament || '—'} (${parsed.psychoProfile?.probability || 0}%)`,
    `  Здравен статус: ${parsed.currentHealthStatus?.score || '—'}/100`,
    `  Ключови проблеми: ${(parsed.keyProblems || []).map(p => p.title || p).slice(0, 3).join(', ') || '—'}`
  ];
  return lines.join('\n');
}

function formatStrategySummary(parsed) {
  if (parsed.error) return `  ❌ Грешка: ${parsed.error}`;
  const scheme = parsed.weeklyScheme || {};
  const lines = [
    `  Тип диета: ${parsed.dietType || '—'}`,
    `  Модификатор: ${parsed.dietaryModifier || '—'}`,
    `  Свободен ден: ${parsed.freeDayNumber != null ? `Ден ${parsed.freeDayNumber}` : 'Не'}`,
    `  Десерт: ${parsed.includeDessert ? 'Да' : 'Не'}`,
    `  Седмична схема:`
  ];
  Object.entries(scheme).forEach(([day, v]) => {
    lines.push(`    ${DAY_NAMES_BG[day] || day}: ${v?.calories || '?'} kcal / ${v?.meals || '?'} хранения`);
  });
  return lines.join('\n');
}

function formatMealPlanSummary(parsed) {
  if (parsed.error) return `  ❌ Грешка: ${parsed.error}`;
  const lines = [];
  for (let d = 1; d <= 7; d++) {
    const key = `day${d}`;
    const dayData = parsed[key];
    if (!dayData) { lines.push(`  Ден ${d}: ⚠️  ЛИПСВА`); continue; }
    const totals = dayData.dailyTotals || {};
    lines.push(`  Ден ${d} — ${totals.calories || '?'} kcal | Б:${totals.protein || '?'}г В:${totals.carbs || '?'}г М:${totals.fats || '?'}г`);
    (dayData.meals || []).forEach((m, i) => {
      const cal = m.totalCalories || m.calories || '?';
      const name = m.name || m.type || `Хранене ${i+1}`;
      lines.push(`    ${i+1}. ${name} — ${cal} kcal`);
      if (m.items && Array.isArray(m.items)) {
        m.items.slice(0, 3).forEach(item => {
          lines.push(`       • ${item.name || item} ${item.amount ? '— ' + item.amount : ''}`);
        });
        if (m.items.length > 3) lines.push(`       … и още ${m.items.length - 3} продукта`);
      }
    });
  }
  return lines.join('\n');
}

function formatSummarySummary(parsed) {
  if (parsed.error) return `  ❌ Грешка: ${parsed.error}`;
  const lines = [
    `  Препоръки: ${(parsed.recommendations || []).slice(0, 4).join(' | ') || '—'}`,
    `  Забранени: ${(parsed.forbidden || []).slice(0, 4).join(' | ') || '—'}`,
    `  Добавки: ${(parsed.supplements || []).slice(0, 4).map(s => (typeof s === 'string' ? s : s.name || s.supplement || JSON.stringify(s))).join(' | ') || '—'}`
  ];
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML доклад
// ─────────────────────────────────────────────────────────────────────────────

function generateHTML(scenarioKey, scenarioLabel, steps, validationResults) {
  const stepNames = { 1: 'Анализ', 2: 'Стратегия', 3: 'Менюплан', 4: 'Обобщение' };
  const ts = new Date().toISOString();

  let body = `<h1>🧪 Тест: ${escapeHTML(scenarioLabel)}</h1><p class="ts">${ts}</p>`;

  Object.entries(steps).forEach(([stepNum, result]) => {
    const stepName = stepNames[stepNum] || `Стъпка ${stepNum}`;
    const issues   = validationResults[stepNum] || [];
    const statusIcon = issues.some(i => i.startsWith('❌')) ? '❌' : issues.length ? '⚠️' : '✅';

    body += `<section class="step">
<h2>${statusIcon} Стъпка ${stepNum}: ${escapeHTML(stepName)}</h2>`;

    if (issues.length) {
      body += `<div class="issues"><h3>Проблеми при валидиране (${issues.length})</h3><ul>`;
      issues.forEach(i => { body += `<li>${escapeHTML(i)}</li>`; });
      body += `</ul></div>`;
    } else {
      body += `<p class="ok">✅ Без проблеми при валидиране</p>`;
    }

    if (result?.parsed && !result.parsed.error) {
      body += `<details><summary>JSON отговор (разгъни)</summary><pre>${escapeHTML(JSON.stringify(result.parsed, null, 2))}</pre></details>`;
    } else if (result?.parsed?.error) {
      body += `<p class="err">JSON грешка: ${escapeHTML(result.parsed.error)}</p>`;
      if (result.parsed.raw) body += `<pre class="raw">${escapeHTML(result.parsed.raw)}</pre>`;
    }
    body += `</section>`;
  });

  return `<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="UTF-8">
<title>Тест: ${escapeHTML(scenarioLabel)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:20px;background:#f5f5f5;color:#222}
h1{color:#1a5276}h2{color:#2c3e50;border-bottom:2px solid #aed6f1;padding-bottom:5px}
.step{background:#fff;border-radius:8px;padding:20px;margin:20px 0;box-shadow:0 2px 6px rgba(0,0,0,.1)}
.issues{background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:12px;margin:10px 0}
.issues h3{margin:0 0 8px;color:#856404}.issues ul{margin:4px 0;padding-left:20px}
.ok{color:#155724;background:#d4edda;border-radius:4px;padding:8px;display:inline-block}
.err{color:#721c24;background:#f8d7da;border-radius:4px;padding:8px}
.ts{color:#888;font-size:.9em}
pre{background:#1e1e1e;color:#d4d4d4;padding:16px;border-radius:6px;overflow:auto;max-height:600px;font-size:.8em}
.raw{background:#2d0000;color:#ffaaaa}
details summary{cursor:pointer;color:#2471a3;font-weight:bold;padding:8px 0}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Запис на резултати
// ─────────────────────────────────────────────────────────────────────────────

function saveResult(stepName, timestamp, scenarioKey, prompt, rawResponse, parsedResponse, modelConfig) {
  const fileName = path.join(RESULTS_DIR, `${timestamp}_${scenarioKey}_${stepName}.json`);
  fs.writeFileSync(fileName, JSON.stringify({
    step: stepName, scenarioKey, timestamp: new Date().toISOString(),
    modelConfig: modelConfig || null,
    promptTokens: estimateTokenCount(prompt),
    responseTokens: estimateTokenCount(rawResponse),
    prompt, rawResponse, parsedResponse
  }, null, 2), 'utf8');
  return fileName;
}

// ─────────────────────────────────────────────────────────────────────────────
// Главна логика
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args   = process.argv.slice(2);
  const result = {
    step: 'all', scenario: 'obese_woman', model: 'gemini-2.5-flash',
    userFile: null, chain: true, verbose: false, dryRun: false,
    html: false, validate: true, listScenarios: false, allScenarios: false
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--step'    && args[i+1]) { result.step = args[++i]; }
    if (args[i] === '--scenario' && args[i+1]) {
      const val = args[++i];
      if (val === 'all') { result.allScenarios = true; result.scenario = 'all'; }
      else result.scenario = val;
    }
    if (args[i] === '--list-scenarios')        { result.listScenarios = true; }
    if (args[i] === '--model'   && args[i+1]) { result.model = args[++i]; }
    if (args[i] === '--user'    && args[i+1]) { result.userFile = args[++i]; }
    if (args[i] === '--no-chain')              { result.chain = false; }
    if (args[i] === '--verbose')               { result.verbose = true; }
    if (args[i] === '--dry-run')               { result.dryRun = true; }
    if (args[i] === '--html')                  { result.html = true; }
    if (args[i] === '--no-validate')           { result.validate = false; }
  }
  return result;
}

async function runStep(stepNum, opts, userData, prevResults, timestamp, scenarioKey, apiKey) {
  const stepNames = { 1: 'step1_analysis', 2: 'step2_strategy', 3: 'step3_meal_plan', 4: 'step4_summary' };
  const stepName  = stepNames[stepNum];

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  СТЪПКА ${stepNum}: ${stepName.toUpperCase()}`);
  console.log(`${'─'.repeat(60)}`);

  let prompt;
  try {
    if (stepNum === 1) {
      prompt = buildAnalysisPrompt(userData);
    } else if (stepNum === 2) {
      const analysis = opts.chain && prevResults[1]?.parsed || {};
      prompt = buildStrategyPrompt(userData, analysis);
    } else if (stepNum === 3) {
      const analysis = opts.chain && prevResults[1]?.parsed || {};
      const strategy = opts.chain && prevResults[2]?.parsed || {};
      prompt = buildMealPlanPrompt(userData, analysis, strategy);
    } else if (stepNum === 4) {
      const analysis = opts.chain && prevResults[1]?.parsed || {};
      const strategy = opts.chain && prevResults[2]?.parsed || {};
      const mealPlan = opts.chain && prevResults[3]?.parsed || null;
      prompt = buildSummaryPrompt(userData, analysis, strategy, mealPlan);
    }
  } catch (err) {
    console.error(`  ❌ Грешка при изграждане на промпт: ${err.message}`);
    return null;
  }

  const tokens = estimateTokenCount(prompt);
  console.log(`  📝 Промпт: ~${tokens} токена`);

  if (opts.verbose) {
    console.log('\n  ── ПРОМПТ (начало, 2000 символа) ──');
    console.log(prompt.slice(0, 2000));
    if (prompt.length > 2000) console.log(`  ... (${prompt.length - 2000} символа още) ...`);
    console.log('  ── КРАЙ ──\n');
  }

  if (opts.dryRun) {
    console.log('  ⏭️  Dry-run — пропускам изпращането');
    return null;
  }

  console.log(`  🚀 Изпращам към Gemini (${opts.model})…`);
  const startTime = Date.now();

  const modelConfig = {
    model: opts.model,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: 0 }
  };

  let rawResponse, parsed;
  try {
    rawResponse = await callGemini(apiKey, prompt, opts.model, 8192);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ✅ Получен за ${elapsed}с (~${estimateTokenCount(rawResponse)} токена)`);
  } catch (err) {
    console.error(`  ❌ API грешка: ${err.message}`);
    return null;
  }

  parsed = parseAIResponse(rawResponse);

  // Display
  if      (stepNum === 1) console.log(formatAnalysisSummary(parsed));
  else if (stepNum === 2) console.log(formatStrategySummary(parsed));
  else if (stepNum === 3) console.log(formatMealPlanSummary(parsed));
  else if (stepNum === 4) console.log(formatSummarySummary(parsed));

  // Validate
  let issues = [];
  if (opts.validate) {
    if      (stepNum === 1) issues = validateAnalysis(parsed, userData);
    else if (stepNum === 2) issues = validateStrategy(parsed);
    else if (stepNum === 3) issues = validateMealPlan(parsed, userData);
    else if (stepNum === 4) issues = validateSummary(parsed);
    printValidation(issues);
  }

  const savedFile = saveResult(stepName, timestamp, scenarioKey, prompt, rawResponse, parsed, modelConfig);
  console.log(`  💾 Запазено: ${path.relative(ROOT_DIR, savedFile)}`);

  return { raw: rawResponse, parsed, issues };
}

async function runScenario(scenarioKey, scenarioData, opts, timestamp, apiKey) {
  const label = scenarioData.label || scenarioKey;
  const userData = scenarioData.data;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  СЦЕНАРИЙ: ${label}`);
  console.log(`  ${scenarioData.description || ''}`);
  if (userData.clinicalProtocol) {
    const proto = getClinicalProtocol(userData.clinicalProtocol);
    console.log(`  Клиничен протокол: ${proto ? proto.name : userData.clinicalProtocol}`);
  }
  console.log(`  Профил: ${userData.name}, ${userData.age} г., ${userData.gender}, ${userData.weight} кг, цел: ${userData.goal}`);
  console.log(`${'═'.repeat(70)}`);

  const stepsToRun = opts.step === 'all' ? [1,2,3,4] : opts.step.split(',').map(Number).filter(n => n >= 1 && n <= 4);
  const prevResults = {};
  const allStepResults = {};
  const allValidation  = {};
  const stepStart = Date.now();

  for (const stepNum of stepsToRun) {
    const result = await runStep(stepNum, opts, userData, prevResults, timestamp, scenarioKey, apiKey);
    if (result) {
      prevResults[stepNum]      = result;
      allStepResults[stepNum]   = result;
      allValidation[stepNum]    = result.issues || [];
    }
  }

  const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
  const totalIssues = Object.values(allValidation).flat();
  const hasErrors   = totalIssues.some(i => i.startsWith('❌'));
  const hasWarnings = totalIssues.some(i => i.startsWith('⚠️'));
  const statusIcon  = hasErrors ? '❌' : hasWarnings ? '⚠️' : '✅';

  console.log(`\n  ${statusIcon} Сценарий завършен за ${elapsed}с — ${totalIssues.length} проблем(а)`);

  if (opts.html && !opts.dryRun) {
    const htmlContent = generateHTML(scenarioKey, label, allStepResults, allValidation);
    const htmlFile = path.join(RESULTS_DIR, `${timestamp}_${scenarioKey}_report.html`);
    fs.writeFileSync(htmlFile, htmlContent, 'utf8');
    console.log(`  🌐 HTML доклад: ${path.relative(ROOT_DIR, htmlFile)}`);
  }

  // Save assembled plan (all steps + userData in one file)
  if (!opts.dryRun && Object.keys(allStepResults).length > 0) {
    const assembledFile = path.join(RESULTS_DIR, `${timestamp}_${scenarioKey}_assembled_plan.json`);
    fs.writeFileSync(assembledFile, JSON.stringify({
      scenarioKey, label, timestamp: new Date().toISOString(),
      elapsed: parseFloat(elapsed),
      userData,
      steps: {
        step1_analysis:  allStepResults[1]?.parsed  || null,
        step2_strategy:  allStepResults[2]?.parsed  || null,
        step3_meal_plan: allStepResults[3]?.parsed  || null,
        step4_summary:   allStepResults[4]?.parsed  || null
      },
      validation: Object.fromEntries(
        Object.entries(allValidation).map(([k, v]) => [k, v])
      ),
      totalIssues: Object.values(allValidation).flat().length
    }, null, 2), 'utf8');
    console.log(`  📦 Сглобен план: ${path.relative(ROOT_DIR, assembledFile)}`);
  }

  return { scenarioKey, label, elapsed, issues: totalIssues, steps: allStepResults };
}

async function main() {
  const opts = parseArgs();

  if (opts.listScenarios) {
    console.log('\n📋 Налични сценарии:\n');
    Object.entries(SCENARIOS).forEach(([key, s]) => {
      const proto = s.data.clinicalProtocol ? ` [протокол: ${s.data.clinicalProtocol}]` : '';
      console.log(`  ${key.padEnd(25)} — ${s.label}${proto}`);
      console.log(`    ${s.description}`);
    });
    console.log('\nИзползване: --scenario <key>  или  --scenario all\n');
    process.exit(0);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !opts.dryRun) {
    console.error('❌ Липсва GEMINI_API_KEY. Задайте: export GEMINI_API_KEY=вашия_ключ');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  console.log(`\n🧪 Старт: ${timestamp}`);
  console.log(`   Модел: ${opts.model} | Стъпки: ${opts.step} | HTML: ${opts.html}`);
  console.log(`📁 Резултати: ${path.relative(ROOT_DIR, RESULTS_DIR)}/`);

  // Determine scenarios to run
  let scenariosToRun = [];
  if (opts.userFile) {
    let userData;
    try {
      userData = JSON.parse(fs.readFileSync(opts.userFile, 'utf8'));
    } catch (err) {
      console.error(`❌ Грешка при четене на ${opts.userFile}: ${err.message}`);
      process.exit(1);
    }
    scenariosToRun = [{ key: 'custom', data: { label: 'Потребителски файл', description: opts.userFile, data: userData } }];
    console.log(`👤 Зареден потребителски профил от: ${opts.userFile}`);
  } else if (opts.allScenarios) {
    scenariosToRun = Object.entries(SCENARIOS).map(([key, s]) => ({ key, data: s }));
    console.log(`\n▶️  Ще се изпълнят всички ${scenariosToRun.length} сценария`);
  } else {
    const s = SCENARIOS[opts.scenario];
    if (!s) {
      console.error(`❌ Непознат сценарий: "${opts.scenario}". Използвайте --list-scenarios за списък.`);
      process.exit(1);
    }
    scenariosToRun = [{ key: opts.scenario, data: s }];
  }

  const totalStart = Date.now();
  const summaryRows = [];

  // Save run config so future readers know the exact settings used
  if (!opts.dryRun) {
    const runConfig = {
      timestamp,
      model: opts.model,
      steps: opts.step,
      chain: opts.chain,
      validate: opts.validate,
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 }
      },
      scenarios: scenariosToRun.map(s => s.key)
    };
    const configFile = path.join(RESULTS_DIR, `${timestamp}_run_config.json`);
    fs.writeFileSync(configFile, JSON.stringify(runConfig, null, 2), 'utf8');
    console.log(`📋 Конфигурация: ${path.relative(ROOT_DIR, configFile)}`);
  }

  for (const { key, data } of scenariosToRun) {
    const result = await runScenario(key, data, opts, timestamp, apiKey);
    summaryRows.push(result);
  }

  // Print final summary table
  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  📊 ОБОБЩЕНА ТАБЛИЦА (${totalElapsed}с общо)`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`  ${'Сценарий'.padEnd(28)} ${'Времe'.padStart(6)}  ${'❌'.padStart(3)} ${'⚠️'.padStart(3)}  Статус`);
  console.log(`  ${'─'.repeat(60)}`);
  summaryRows.forEach(row => {
    const errors   = (row.issues || []).filter(i => i.startsWith('❌')).length;
    const warnings = (row.issues || []).filter(i => i.startsWith('⚠️')).length;
    const icon     = errors ? '❌' : warnings ? '⚠️' : '✅';
    console.log(`  ${row.label.padEnd(28)} ${(row.elapsed+'с').padStart(6)}  ${String(errors).padStart(3)} ${String(warnings).padStart(3)}  ${icon}`);
  });
  console.log(`${'═'.repeat(70)}\n`);

  if (!opts.dryRun) {
    console.log(`📂 Файлове в: ${path.relative(ROOT_DIR, RESULTS_DIR)}/`);
    const files = fs.readdirSync(RESULTS_DIR).filter(f => f.startsWith(timestamp));
    files.forEach(f => console.log(`   • ${f}`));
  }
}

main().catch(err => {
  console.error('\n❌ Неочаквана грешка:', err.message);
  process.exit(1);
});
