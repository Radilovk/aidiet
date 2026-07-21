const ENERGY = [
  'ориз', 'картоф', 'паста', 'овес', 'булгур', 'хляб', 'киноа',
  'rice', 'potato', 'pasta', 'bread', 'oats', 'bulgur', 'quinoa',
];
const LEGUMES = ['боб', 'леща', 'нахут', 'грах', 'beans', 'lentils', 'chickpeas', 'peas'];
const HARD_BANS = ['мед', 'захар', 'сироп', 'конфитюр', 'кетчуп', 'майонеза'];

const WEIRD_PAIRS = [
  [/риба|fish|тон|сьомга|скумри/, /банан|портокал|ягод/],
  [/скир|кисело мляко|кефир/, /риба|fish|тон/],
  [/пилешк|говежд|свинск/, /йогурт.*риба|риба.*йогурт/],
];

function countHits(text, terms) {
  return terms.filter(t => text.includes(t));
}

export function validateMealCombinations(meal) {
  const issues = [];
  if (meal.type === 'Свободно хранене' || meal.type === 'Напитка') return issues;

  const text = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();

  const energyHits = countHits(text, ENERGY);
  if (energyHits.length > 1) {
    issues.push(`"${meal.name}": множество въглехидратни източници (${energyHits.join(', ')})`);
  }

  const hasLegumes = LEGUMES.some(l => text.includes(l));
  const hasEnergy = ENERGY.some(e => text.includes(e));
  if (hasLegumes && hasEnergy) {
    issues.push(`"${meal.name}": бобови + енергиен източник (ориз/картофи/паста)`);
  }

  if (/грах|peas/.test(text) && /риба|fish|тон|сьомга|скумри|треска/.test(text)) {
    issues.push(`"${meal.name}": забранена комбинация грах + риба`);
  }

  const hasSalad = /\b(салата|салатка)\b/.test(text);
  const hasFresh = /\b(пресн|нарязан)\b/.test(text) && /\b(домат|краставиц|чушк)\b/.test(text);
  if (hasSalad && hasFresh) {
    issues.push(`"${meal.name}": салата И пресни зеленчуци едновременно`);
  }

  for (const ban of HARD_BANS) {
    if (new RegExp(`\\b${ban}\\b`).test(text) && !/медицин|междин/.test(text)) {
      issues.push(`"${meal.name}": съдържа забранен ${ban}`);
    }
  }

  for (const [a, b] of WEIRD_PAIRS) {
    if (a.test(text) && b.test(text)) {
      issues.push(`"${meal.name}": нелогична/несъвместима комбинация продукти`);
    }
  }

  return issues;
}

export function validateWeekPlanCombinations(weekPlan) {
  const issues = [];
  for (let d = 1; d <= 7; d++) {
    const day = weekPlan[`day${d}`];
    if (!day?.meals) continue;
    for (const meal of day.meals) {
      issues.push(...validateMealCombinations(meal));
    }
  }
  return issues;
}
