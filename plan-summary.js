/**
 * Обобщение на плана без AI.
 *
 * AI обобщението (Стъпка 4) връщаше препоръки, забрани, психология и вода,
 * които детерминистичната стратегия веднага презаписваше — оставаха само
 * макросите и добавките. Макросите са средните от реалната седмица, а
 * добавките идват от клиничния протокол и кода на профила.
 */

import { compileProfile } from './profile-code.js';
import { waterNeedLiters } from './analysis-deterministic.js';

const STYLE_RECOMMENDATIONS = {
  balanced: ['Зеленчуци на всяко основно хранене', 'Постни меса и риба', 'Пълнозърнести храни', 'Кисело мляко и извара', 'Плодове като междинно хранене'],
  mediterranean: ['Зехтин като основна мазнина', 'Риба 2–3 пъти седмично', 'Бобови храни', 'Зеленчуци и салати', 'Ядки в малки порции'],
  keto: ['Яйца', 'Мазна риба', 'Авокадо и зехтин', 'Листни и некористени зеленчуци', 'Сирена в умерени количества'],
  low_carb: ['Протеин на всяко хранене', 'Некористени зеленчуци', 'Бобови в малки порции', 'Ядки и семена', 'Плодове с ниско съдържание на захар'],
  high_protein: ['Пилешко и пуешко месо', 'Риба', 'Извара и скир', 'Яйца', 'Бобови храни'],
  low_fodmap: ['Ориз и картофи', 'Моркови, тиквички, краставици', 'Яйца и риба', 'Безлактозни млечни', 'Ягоди и боровинки'],
  dash: ['Зеленчуци и плодове', 'Нискомаслени млечни', 'Пълнозърнести', 'Риба и птиче месо', 'Бобови и ядки без сол'],
  paleo: ['Месо и риба', 'Зеленчуци', 'Плодове', 'Ядки и семена', 'Сладки картофи'],
  anti_inflammatory: ['Мазна риба', 'Листни зеленчуци', 'Зехтин', 'Горски плодове', 'Куркума и джинджифил'],
};

const STYLE_FORBIDDEN = {
  balanced: ['Сладкиши и захар', 'Газирани напитки', 'Пържени храни', 'Преработени меса'],
  mediterranean: ['Преработени меса', 'Сладкиши', 'Рафинирани масла', 'Газирани напитки'],
  keto: ['Захар и мед', 'Хляб и тестени', 'Ориз и картофи', 'Сладки плодове', 'Газирани напитки'],
  low_carb: ['Захар и сладкиши', 'Бял хляб и тестени', 'Сокове и газирани напитки', 'Бял ориз в големи порции'],
  high_protein: ['Сладкиши', 'Газирани напитки', 'Пържени храни', 'Алкохол'],
  low_fodmap: ['Лук и чесън', 'Боб и леща в големи порции', 'Ябълки и круши', 'Прясно мляко', 'Пшеница'],
  dash: ['Солени храни и колбаси', 'Готови сосове', 'Чипс и солети', 'Алкохол'],
  paleo: ['Зърнени храни', 'Млечни продукти', 'Бобови', 'Захар', 'Преработени храни'],
  anti_inflammatory: ['Захар', 'Преработени меса', 'Пържени храни', 'Рафинирани масла', 'Алкохол'],
};

const BEHAVIOR_PSYCHOLOGY = {
  EMO: 'Преди хранене извън плана — 10 минути пауза и вода: гладът ли е, или емоцията?',
  OVR: 'Сервирайте порцията в чиния и прибирайте тенджерата — първата порция е цялата порция.',
  SWT: 'Сладкото е планирано в менюто — не е забранено, а е на определено място.',
  SWS: 'Сладкото между храненията заменете с плод или кисело мляко от плана.',
  CMP: 'След преяждане продължете със следващото хранене по план — без гладуване за компенсация.',
  TV: 'Хранете се без екран — ситостта се усеща след 15–20 минути.',
  RUSH: 'Седнете за храненето, дори да е за 10 минути.',
  IRR: 'Едни и същи часове за храненията стабилизират апетита в рамките на 1–2 седмици.',
  OUT: 'Когато ядете навън: протеин + зеленчуци, а сосът отделно.',
  EVE: 'Първото хранене до 2 часа след събуждане намалява глада вечер.',
};

const GENERAL_PSYCHOLOGY = [
  'Следете тенденцията на теглото за седмица, не дневните колебания.',
  'Една пропусната порция не проваля плана — продължете със следващото хранене.',
  'Сънят и водата влияят на апетита толкова, колкото и храната.',
];

/** Средни дневни макроси от реално генерираната седмица (без свободните хранения). */
export function averageMacrosFromWeek(weekPlan = {}) {
  let p = 0;
  let c = 0;
  let f = 0;
  let days = 0;
  for (const day of Object.values(weekPlan || {})) {
    const meals = day?.meals || [];
    if (!meals.length || meals.some(m => m.type === 'Свободно хранене')) continue;
    for (const m of meals) {
      p += Number(m.macros?.protein) || 0;
      c += Number(m.macros?.carbs) || 0;
      f += Number(m.macros?.fats) || 0;
    }
    days++;
  }
  if (!days) return { protein: 0, carbs: 0, fats: 0 };
  return { protein: Math.round(p / days), carbs: Math.round(c / days), fats: Math.round(f / days) };
}

function supplementsFor(profile, protocolSupplements = []) {
  const out = [...(protocolSupplements || [])].slice(0, 4);
  const names = new Set(out.map(s => String(s.name || '').toLowerCase()));
  const add = (name, dosage, timing) => {
    if ([...names].some(n => n.includes(name.toLowerCase().split(' ')[0]))) return;
    names.add(name.toLowerCase());
    out.push({ name, dosage, timing });
  };
  const pattern = profile.diet?.pattern;
  const c = profile.clinical || [];
  if (pattern === 'vegan' || pattern === 'vegetarian') add('Витамин B12', '250–500 mcg', 'сутрин');
  if (pattern === 'vegan') add('Омега-3 от водорасли (DHA/EPA)', '250–500 mg', 'с хранене');
  if (c.includes('OSTEO') || c.includes('MENO') || (profile.age || 0) >= 55) add('Витамин D3', '1000–2000 IU', 'с мазна храна');
  if (profile.diet?.style === 'keto') add('Магнезий', '200–400 mg', 'вечер');
  if (!out.length) add('Витамин D3', '1000–2000 IU', 'с мазна храна — при малко слънце');
  return out.slice(0, 5);
}

/**
 * @param {{ userData?: object, strategy?: object, weekPlan?: object, bmr?: number, dailyCalories?: number, protocolSupplements?: object[] }} ctx
 */
export function buildPlanSummary({
  userData = {},
  strategy = {},
  weekPlan = {},
  bmr = 0,
  dailyCalories = 0,
  protocolSupplements = [],
} = {}) {
  const profile = compileProfile(userData || {}, { dietaryModifier: strategy?.dietaryModifier });
  const style = profile.diet.style;

  const recommendations = strategy?.foodsToInclude?.length
    ? [...strategy.foodsToInclude]
    : [...(STYLE_RECOMMENDATIONS[style] || STYLE_RECOMMENDATIONS.balanced)];
  const forbidden = [...new Set([
    ...(strategy?.foodsToAvoid || []),
    ...(STYLE_FORBIDDEN[style] || STYLE_FORBIDDEN.balanced),
  ])].slice(0, 10);

  const psychology = [
    ...(strategy?.psychologicalSupport || []),
    ...profile.behaviors.map(b => BEHAVIOR_PSYCHOLOGY[b]).filter(Boolean),
  ];
  for (const tip of GENERAL_PSYCHOLOGY) {
    if (psychology.length >= 3) break;
    psychology.push(tip);
  }

  return {
    summary: {
      bmr,
      dailyCalories,
      macros: averageMacrosFromWeek(weekPlan),
    },
    recommendations,
    forbidden,
    psychology: [...new Set(psychology)].slice(0, 6),
    waterIntake: `${waterNeedLiters(profile)} л вода дневно, разпределена през деня`,
    supplements: supplementsFor(profile, protocolSupplements),
  };
}
