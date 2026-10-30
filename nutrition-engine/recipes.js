/**
 * Рецептите на ястията: стъпки с места {PRO}, {VEG}, {FAT2}… за избраните
 * продукти. Текстът е написан и прегледан предварително (AI + човек), а тук
 * само се попълва — без AI при генериране на плана. Количествата остават
 * в състава; рецептата не съдържа грамове.
 */

import recipesJson from '../data/engine/recipes.json' with { type: 'json' };
import { textIssues } from './text-guard.js';

/** @typedef {{ time: number, steps: string[], tip?: string }} Recipe */

/** @type {Record<string, Recipe>} */
export const RECIPES = /** @type {any} */ (recipesJson).recipes || {};

/** Основните овкусители — могат да се споменат, без да са в ястието. */
export const BASIC_SEASONINGS = [
  'сол', 'черен пипер', 'пипер', 'подправк', 'билк', 'вода', 'чесън', 'лук', 'лимон', 'оцет', 'канела', 'ванилия',
  'ядки', 'семена', 'копър', 'магданоз', 'риган', 'мащерка', 'босилек', 'чубрица', 'кимион', 'червен пипер', 'джоджен', 'дафинов', 'куркума', 'розмарин',
];

/** Числа са позволени само за време и температура. */
const NUMBER_RE = /\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+)?\s*(°\s*C|°|градуса|минут\p{L}*|мин\.?|час\p{L}*|секунд\p{L}*|дни|ден|дена|седмиц\p{L}*)?/giu;

/** Името на всяка част: PRO, PRO2…, по реда в ястието. */
export function partRefs(dish) {
  const seen = {};
  return dish.parts.map(p => {
    seen[p.group] = (seen[p.group] || 0) + 1;
    return seen[p.group] === 1 ? p.group : `${p.group}${seen[p.group]}`;
  });
}

function joinList(labels) {
  if (labels.length <= 1) return labels[0] || '';
  return `${labels.slice(0, -1).join(', ')} и ${labels[labels.length - 1]}`;
}

/** Продукти, които се пекат; зърнените само се варят („изпечи киноа“ няма). */
const BAKES = /картоф|батат|тикв|сладк/;

/**
 * Общи думи в съвета, които зависят от незадължителна част (ядки, семена).
 * @type {Array<[RegExp, string[]]>}
 */
const GENERIC_WORDS = [
  [/бадем|орех|лешни|кашу|шамфъст|фъстъ|ядк/, ['ядк']],
  [/семе|семк|чиа|лен/, ['семен', 'семк', 'чия', 'чиа']],
  [/авокадо/, ['авокадо']],
  [/маслин/, ['маслин']],
];

/** Думите, по които личи, че съветът говори за тази (липсваща) храна. */
function stemsOf(labels) {
  const out = new Set();
  for (const l of labels) {
    const low = String(l).toLowerCase();
    if (low.length >= 4) out.add(low.slice(0, Math.max(4, low.length - 2)));
    for (const [re, words] of GENERIC_WORDS) if (re.test(low)) words.forEach(w => out.add(w));
  }
  return [...out];
}

/** Попълва местата в стъпка. Няколко продукта до „и“ → със запетаи, без „… и … и …“. */
function fillStep(step, labelsByRef) {
  const tokens = step.split(/(\{[A-Z]+\d?\})/);
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(/^\{([A-Z]+\d?)\}$/);
    if (!m) { out += tokens[i]; continue; }
    const labels = [...new Set(labelsByRef[m[1]] || [])];
    if (!labels.length) return null;
    const next = tokens[i + 1] || '';
    if (labels.length > 1 && /\sи\s$/.test(out)) {
      // „Нарежи {PRO} и {VEG}“ → „пилешко филе, чушки и тиквички“
      out = out.replace(/\sи\s$/, ', ') + joinList(labels);
    } else if (labels.length > 1 && /^\s+и\s/.test(next)) {
      // „Нарежи {VEG} и лука“ → „чушки, домати, краставици и лука“
      out += labels.join(', ');
    } else {
      out += joinList(labels);
    }
  }
  // Зърнените се варят — „свари или изпечи киноа“ → „свари киноа“.
  const bakes = BAKES.test(out.toLowerCase());
  return out.replace(/(свари|Свари) или изпечи/g, (all, verb) => (bakes ? all : verb))
    // Маслото не се „поднася“ — слага се върху горещото ястие.
    .replace(/^(?:Поднеси|Сервирай|Поръси|Добави)(?: с| със)? масло(?: при сервиране)?\.$/, 'Сложи малко масло върху горещото ястие.')
    // Пред с и з българският иска „със“.
    .replace(/(^|\s)с\s(?=[сзСЗ])/g, '$1със ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Рецептата за сглобено хранене.
 * @param {string} dishId
 * @param {Record<string, string[]>} labelsByRef  етикетите на продуктите по част (само частите в храненето)
 * @param {string[]} [flavour]  подправките на ястието
 * @param {string[]} [absentLabels]  продуктите на незадължителните части, които ги няма — съвет за тях отпада
 * @returns {Recipe|null}
 */
export function renderRecipe(dishId, labelsByRef, flavour = [], absentLabels = []) {
  const recipe = RECIPES[dishId];
  if (!recipe) return null;
  const steps = [];
  for (const step of recipe.steps) {
    const text = fillStep(step, labelsByRef);
    // Незадължителна част, която липсва — стъпката ѝ отпада цялата.
    if (text) steps.push(text);
  }
  if (!steps.length) return null;
  const known = steps.join(' ').toLowerCase();
  const extra = flavour.filter(f => !known.includes(String(f).toLowerCase().slice(0, 4)));
  if (extra.length) steps.push(`Овкуси ${/^[сз]/i.test(extra[0]) ? 'със' : 'с'} ${joinList(extra)}.`);
  let tip = recipe.tip ? fillStep(recipe.tip, labelsByRef) : null;
  if (tip) {
    const low = tip.toLowerCase();
    const present = Object.values(labelsByRef).flat().join(' ').toLowerCase();
    if (stemsOf(absentLabels).some(st => low.includes(st) && !present.includes(st))) tip = null;
  }
  return { time: recipe.time, steps, ...(tip ? { tip } : {}) };
}

/**
 * Проблемите в рецепта спрямо ястието — за тестовете и за генератора.
 * @param {any} dish   ястието от knowledge (parts с options от id-та)
 * @param {any} recipe
 * @param {{ labelOf: (id: string) => string, allLabels: string[] }} foods
 * @returns {string[]}
 */
export function recipeIssues(dish, recipe, foods) {
  const out = [];
  if (!recipe || typeof recipe !== 'object') return ['няма рецепта'];
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  if (steps.length < 2 || steps.length > 6) out.push(`стъпки: ${steps.length} (трябва 2–6)`);
  if (!Number.isInteger(recipe.time) || recipe.time < 1 || recipe.time > 240) out.push(`време: ${recipe.time}`);
  if (recipe.tip != null && (typeof recipe.tip !== 'string' || recipe.tip.length > 180)) out.push('съветът е твърде дълъг');

  const refs = partRefs(dish);
  const optional = new Set(refs.filter((_, i) => !(dish.parts[i].range?.[0] > 0) || dish.parts[i].onlyStyles || dish.parts[i].onlyPatterns));
  const own = new Set();
  dish.parts.forEach(p => p.options.flat().forEach(id => own.add(foods.labelOf(id).toLowerCase())));
  (dish.fixed || []).forEach(([id]) => own.add(foods.labelOf(id).toLowerCase()));

  const all = [...steps, recipe.tip || ''];
  // Стъпките, които остават, когато всички незадължителни части липсват.
  const core = steps.filter(s => ![...s.matchAll(/\{([A-Z]+\d?)\}/g)].some(m => optional.has(m[1])));
  if (steps.length && core.length < 1) out.push('без незадължителните части не остава нито една стъпка');

  all.forEach((s, i) => {
    const where = i < steps.length ? `стъпка ${i + 1}` : 'съвет';
    if (typeof s !== 'string') { out.push(`${where}: не е текст`); return; }
    if (s.length > 240) out.push(`${where}: твърде дълга`);
    for (const m of s.matchAll(/\{([^}]*)\}/g)) if (!refs.includes(m[1])) out.push(`${where}: непознато място {${m[1]}}`);
    // Числа — само за време и температура.
    for (const m of s.replace(/\{[^}]*\}/g, ' ').matchAll(NUMBER_RE)) if (!m[1]) out.push(`${where}: число без мерна единица за време/температура „${m[0].trim()}“`);
    const bad = textIssues(s.replace(/\{[A-Z]+\d?\}/g, 'продукта'));
    if (bad.length) out.push(`${where}: ${bad.join(', ')}`);
    // Продукти, които ги няма в ястието.
    // Собствените продукти се махат първо — „овесени ядки“ не е „ядки“, „паста от леща“ не е „леща“.
    let low = s.replace(/\{[^}]*\}/g, ' ').toLowerCase();
    for (const l of [...own].sort((a, b) => b.length - a.length)) low = low.split(l).join(' ');
    for (const label of foods.allLabels) {
      const l = label.toLowerCase();
      if (l.length < 4 || own.has(l) || BASIC_SEASONINGS.some(b => l.startsWith(b))) continue;
      if (new RegExp(`(?<![а-я])${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![а-я])`).test(low)) out.push(`${where}: продукт извън ястието „${label}“`);
    }
  });
  return [...new Set(out)];
}
