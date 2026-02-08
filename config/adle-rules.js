/**
 * ADLE v8 Universal Meal Constructor - Hard Rules and Constraints
 * Based on meallogic.txt - slot-based constructor with strict validation
 * 
 * This file contains all food validation rules, whitelists, and blacklists
 * used by the ADLE v8 meal validation system.
 */

// ADLE v8 Hard-banned foods
// This will be merged with dynamic blacklist from KV storage
const ADLE_V8_HARD_BANS = [
  'лук', 'onion', 'пуешко месо', 'turkey meat',
  'изкуствени подсладители', 'artificial sweeteners',
  'мед', 'захар', 'конфитюр', 'сиропи', 'honey', 'sugar', 'jam', 'syrups',
  'кетчуп', 'майонеза', 'BBQ сос', 'ketchup', 'mayonnaise', 'BBQ sauce',
  'гръцко кисело мляко', 'greek yogurt'
];

// Default whitelist - approved foods for admin panel
const DEFAULT_FOOD_WHITELIST = [
  'яйца', 'eggs',
  'пилешко', 'chicken',
  'говеждо', 'beef',
  'свинско', 'свинска', 'pork',
  'риба', 'fish', 'скумрия', 'тон', 'сьомга',
  'кисело мляко', 'yogurt',
  'извара', 'cottage cheese',
  'сирене', 'cheese',
  'боб', 'beans',
  'леща', 'lentils',
  'нахут', 'chickpeas',
  'грах', 'peas'
];

// Default blacklist - hard banned foods for admin panel
const DEFAULT_FOOD_BLACKLIST = [
  'лук', 'onion',
  'пуешко месо', 'turkey meat',
  'изкуствени подсладители', 'artificial sweeteners',
  'мед', 'захар', 'конфитюр', 'сиропи',
  'honey', 'sugar', 'jam', 'syrups',
  'кетчуп', 'майонеза', 'BBQ сос',
  'ketchup', 'mayonnaise', 'BBQ sauce',
  'гръцко кисело мляко', 'greek yogurt'
];

// Foods that should appear rarely (≤2 times/week)
const ADLE_V8_RARE_ITEMS = ['пуешка шунка', 'turkey ham', 'бекон', 'bacon'];

// ADLE v8 Hard Rules for meal construction
const ADLE_V8_HARD_RULES = {
  R1: 'Protein main = exactly 1. Secondary protein only if (breakfast AND eggs), 0-1.',
  R2: 'Vegetables = 1-2. Choose exactly ONE form: Salad OR Fresh side (not both). Potatoes ≠ vegetables.',
  R3: 'Energy = 0-1 (never 2).',
  R4: 'Dairy max = 1 per meal (yogurt OR cottage cheese OR cheese), including as sauce/dressing.',
  R5: 'Fat = 0-1. If nuts/seeds present → no olive oil/butter.',
  R6: 'Cheese rule: If cheese present → no olive oil/butter. Olives allowed with cheese.',
  R7: 'Bacon rule: If bacon present → Fat=0.',
  R8: 'Legumes-as-main (beans/lentils/chickpeas/peas stew): Energy=0 (no rice/potatoes/pasta/bulgur/oats). Bread may be optional: +1 slice wholegrain.',
  R9: 'Bread optional rule (outside Template C): Allowed only if Energy=0. Exception: with legumes-as-main (R8), bread may still be optional (1 slice). If any Energy item present → Bread=0.',
  R10: 'Peas as meat-side add-on: Peas are NOT energy, but they BLOCK the Energy slot → Energy=0. Bread may be optional (+1 slice) if carbs needed.',
  R11: 'Template C (sandwich): Only snack; legumes forbidden; no banned sauces/sweeteners.',
  R12: 'Outside-whitelist additions: Default=use whitelists only. Outside-whitelist ONLY if objectively required (MODE/medical/availability), mainstream/universal, available in Bulgaria. Add line: Reason: ...'
};

// ADLE v8 Special Rules
const ADLE_V8_SPECIAL_RULES = {
  PEAS_FISH_BAN: 'Peas + fish combination is strictly forbidden.',
  VEGETABLE_FORM_RULE: 'Choose exactly ONE vegetable form per meal: Salad (with dressing) OR Fresh side (sliced, no dressing). Never both.',
  DAIRY_INCLUDES_SAUCE: 'Dairy count includes yogurt/cheese used in sauces, dressings, or cooking.',
  OLIVES_NOT_FAT: 'Olives are salad add-on (NOT Fat slot). If olives present → do NOT add olive oil/butter.',
  CORN_NOT_ENERGY: 'Corn is NOT an energy source. Small corn only in salads as add-on.',
  TEMPLATE_C_RESTRICTION: 'Template C (sandwich) allowed ONLY for snacks, NOT for main meals.'
};

// ADLE v8 Whitelists - Allowed foods (from meallogic.txt)
const ADLE_V8_PROTEIN_WHITELIST = [
  'яйца', 'eggs', 'egg', 'яйце',
  'пилешко', 'chicken', 'пиле', 'пилешк',
  'говеждо', 'beef', 'говежд',
  'свинско', 'свинска', 'pork', 'свин',
  'риба', 'fish', 'скумрия', 'mackerel', 'тон', 'tuna', 'сьомга', 'salmon',
  'кисело мляко', 'yogurt', 'йогурт', 'кефир',
  'извара', 'cottage cheese', 'извар',
  'сирене', 'cheese', 'сирен',
  'боб', 'beans', 'бобови',
  'леща', 'lentils', 'лещ',
  'нахут', 'chickpeas', 'нахут',
  'грах', 'peas', 'гра'
];

// Proteins explicitly NOT on whitelist (should trigger warning)
// Using word stems to catch variations (e.g., заешко, заешки, заешка)
// SECURITY NOTE: These strings are static and pre-validated, not user input
const ADLE_V8_NON_WHITELIST_PROTEINS = [
  'заеш', 'rabbit', 'зайч',  // заешко, заешки, заешка
  'патиц', 'патешк', 'duck',  // патица, патешко, патешки
  'гъс', 'goose',  // гъска, гъсешко
  'агн', 'lamb',  // агне, агнешко, агнешки
  'дивеч', 'елен', 'deer', 'wild boar', 'глиган'
];

// Low glycemic index foods allowed in late-night snacks (GI < 55)
const LOW_GI_FOODS = [
  'кисело мляко', 'кефир', 'ядки', 'бадеми', 'орехи', 'кашу', 'лешници',
  'ябълка', 'круша', 'ягоди', 'боровинки', 'малини', 'черници',
  'авокадо', 'краставица', 'домат', 'зелени листни зеленчуци',
  'хумус', 'тахан', 'семена', 'чиа', 'ленено семе', 'тиквени семки'
];

// Export all constants
export {
  ADLE_V8_HARD_BANS,
  DEFAULT_FOOD_WHITELIST,
  DEFAULT_FOOD_BLACKLIST,
  ADLE_V8_RARE_ITEMS,
  ADLE_V8_HARD_RULES,
  ADLE_V8_SPECIAL_RULES,
  ADLE_V8_PROTEIN_WHITELIST,
  ADLE_V8_NON_WHITELIST_PROTEINS,
  LOW_GI_FOODS
};
