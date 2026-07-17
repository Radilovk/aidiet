/**
 * Canonical food catalog — single source for AI meal selection.
 *
 * Fields:
 *  id, name (exact AI label), nutritionKey → food-nutrition-data.js
 *  group, slots [PRO|ENG|VOL|FAT], timing [breakfast|snack|main|late_snack]
 *  universality 1–5 (5 = generic/universal, prefer in prompts)
 *  vegan, vegetarian, genericOf (parent id for specific variants)
 *  aliases (optional lookup)
 */

/** @typedef {'protein'|'dairy'|'vegetable'|'carb'|'fat'|'fruit'|'legume'|'condiment'|'beverage'|'ready_meal'} FoodGroup */
/** @typedef {'PRO'|'ENG'|'VOL'|'FAT'} AdleSlot */
/** @typedef {'breakfast'|'snack'|'main'|'late_snack'} MealTiming */

/**
 * @param {string} id
 * @param {string} name
 * @param {string} nutritionKey
 * @param {FoodGroup} group
 * @param {AdleSlot[]} slots
 * @param {MealTiming[]} timing
 * @param {1|2|3|4|5} universality
 * @param {{ vegan?: boolean, vegetarian?: boolean, meat?: boolean, genericOf?: string, aliases?: string[] }} [opts]
 */
function item(id, name, nutritionKey, group, slots, timing, universality, opts = {}) {
  const defaultVeg = ['vegetable', 'carb', 'fat', 'fruit', 'legume', 'condiment', 'beverage'].includes(group)
    || (group === 'dairy')
    || (group === 'ready_meal' && !opts.meat);
  return {
    id,
    name,
    nutritionKey,
    group,
    slots,
    timing,
    universality,
    vegan: !!opts.vegan,
    vegetarian: opts.vegetarian !== undefined ? !!opts.vegetarian : defaultVeg,
    genericOf: opts.genericOf || null,
    aliases: opts.aliases || [],
  };
}

/** @type {ReturnType<typeof item>[]} */
export const FOOD_CATALOG = [
  // ── PRO — generic umbrellas (universality 5) ──
  item('pro_fish', 'Риба', 'риба', 'protein', ['PRO'], ['main', 'snack'], 5),
  item('pro_chicken', 'Пилешко месо', 'пилешко месо', 'protein', ['PRO'], ['breakfast', 'main', 'snack'], 5),
  item('pro_eggs', 'Яйца', 'яйца', 'protein', ['PRO'], ['breakfast', 'main', 'snack', 'late_snack'], 5, { vegetarian: true }),
  item('pro_beef', 'Говеждо месо', 'говеждо', 'protein', ['PRO'], ['main'], 5),
  item('pro_pork', 'Свинско месо', 'свинско', 'protein', ['PRO'], ['main'], 4),

  // ── PRO — common specific ──
  item('pro_chicken_breast', 'Пилешки гърди', 'пилешки гърди', 'protein', ['PRO'], ['breakfast', 'main', 'snack'], 4, { genericOf: 'pro_chicken' }),
  item('pro_chicken_thigh', 'Пилешко бутче', 'пилешко бутче', 'protein', ['PRO'], ['main'], 3, { genericOf: 'pro_chicken' }),
  item('pro_turkey', 'Пуешко филе', 'пуешко филе', 'protein', ['PRO'], ['main', 'snack'], 3),
  item('pro_beef_lean', 'Говеждо (постно)', 'говеждо постно', 'protein', ['PRO'], ['main'], 4, { genericOf: 'pro_beef' }),
  item('pro_pork_lean', 'Свинско (постно)', 'свинско постно', 'protein', ['PRO'], ['main'], 3, { genericOf: 'pro_pork' }),
  item('pro_ground_meat', 'Кайма', 'кайма', 'protein', ['PRO'], ['main'], 3),
  item('pro_salmon', 'Сьомга', 'сьомга', 'protein', ['PRO'], ['main'], 3, { genericOf: 'pro_fish' }),
  item('pro_tuna', 'Риба тон', 'риба тон', 'protein', ['PRO'], ['main', 'snack'], 4, { genericOf: 'pro_fish', aliases: ['риба тон консерва'] }),
  item('pro_cod', 'Треска', 'треска', 'protein', ['PRO'], ['main'], 3, { genericOf: 'pro_fish' }),
  item('pro_mackerel', 'Скумрия', 'скумрия', 'protein', ['PRO'], ['main'], 3, { genericOf: 'pro_fish' }),
  item('pro_tilapia', 'Тилапия', 'тилапия', 'protein', ['PRO'], ['main'], 3, { genericOf: 'pro_fish' }),
  item('pro_sea_bass', 'Лаврак', 'риба', 'protein', ['PRO'], ['main'], 2, { genericOf: 'pro_fish' }),
  item('pro_shrimp', 'Скариди', 'скариди', 'protein', ['PRO'], ['main'], 2, { genericOf: 'pro_fish' }),
  item('pro_egg_whites', 'Яйчни белтъци', 'яйчни белтъци', 'protein', ['PRO'], ['breakfast', 'snack', 'late_snack'], 3, { vegetarian: true, genericOf: 'pro_eggs' }),
  item('pro_tofu', 'Тофу', 'тофу', 'protein', ['PRO'], ['main', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('pro_tempeh', 'Темпе', 'темпе', 'protein', ['PRO'], ['main'], 2, { vegan: true, vegetarian: true }),
  item('pro_whey', 'Протеин (суроватка)', 'протеин суроватка', 'protein', ['PRO'], ['breakfast', 'snack', 'late_snack'], 3, { vegetarian: true }),
  item('pro_plant_protein', 'Протеин (растителен)', 'протеин растителен', 'protein', ['PRO'], ['breakfast', 'snack'], 3, { vegan: true, vegetarian: true }),

  // ── DAIRY ──
  item('dairy_yogurt', 'Кисело мляко', 'кисело мляко', 'dairy', ['PRO', 'FAT'], ['breakfast', 'snack', 'main', 'late_snack'], 5, { vegetarian: true }),
  item('dairy_yogurt_2', 'Кисело мляко (2%)', 'кисело мляко 2', 'dairy', ['PRO', 'FAT'], ['breakfast', 'snack', 'late_snack'], 4, { vegetarian: true, genericOf: 'dairy_yogurt' }),
  item('dairy_yogurt_0', 'Кисело мляко (0%)', 'кисело мляко 0', 'dairy', ['PRO'], ['breakfast', 'snack', 'late_snack'], 4, { vegetarian: true, genericOf: 'dairy_yogurt' }),
  item('dairy_greek', 'Гръцко кисело мляко', 'гръцко кисело мляко', 'dairy', ['PRO', 'FAT'], ['breakfast', 'snack'], 3, { vegetarian: true }),
  item('dairy_cottage', 'Извара', 'извара', 'dairy', ['PRO'], ['breakfast', 'snack', 'late_snack'], 4, { vegetarian: true, aliases: ['извара кварк'] }),
  item('dairy_cottage_low', 'Извара (нискомаслена)', 'извара нискомаслена', 'dairy', ['PRO'], ['breakfast', 'snack', 'late_snack'], 3, { vegetarian: true }),
  item('dairy_skyr', 'Скир', 'скир', 'dairy', ['PRO'], ['breakfast', 'snack', 'late_snack'], 4, { vegetarian: true }),
  item('dairy_cheese', 'Сирене', 'сирене', 'dairy', ['PRO', 'FAT'], ['main', 'snack'], 4, { vegetarian: true }),
  item('dairy_kashkaval', 'Кашкавал', 'кашкавал', 'dairy', ['PRO', 'FAT'], ['main', 'snack'], 3, { vegetarian: true }),
  item('dairy_ricotta', 'Рикота', 'рикота', 'dairy', ['PRO', 'FAT'], ['main', 'snack'], 3, { vegetarian: true }),
  item('dairy_milk', 'Мляко', 'мляко', 'dairy', ['PRO'], ['breakfast', 'snack'], 4, { vegetarian: true }),
  item('dairy_milk_2', 'Мляко (2%)', 'мляко 2', 'dairy', ['PRO'], ['breakfast', 'snack'], 4, { vegetarian: true, genericOf: 'dairy_milk' }),
  item('dairy_plant_milk', 'Растително мляко', 'растително мляко', 'dairy', ['ENG'], ['breakfast', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('dairy_kefir', 'Кефир', 'кефир', 'dairy', ['PRO'], ['breakfast', 'snack', 'late_snack'], 3, { vegetarian: true }),

  // ── VEG — generic + common ──
  item('veg_generic', 'Зеленчук', 'зеленчук', 'vegetable', ['VOL'], ['breakfast', 'main', 'snack'], 5, { vegan: true, vegetarian: true }),
  item('veg_tomato', 'Домат', 'домат', 'vegetable', ['VOL'], ['breakfast', 'main', 'snack'], 5, { vegan: true, vegetarian: true, aliases: ['домати'] }),
  item('veg_cucumber', 'Краставица', 'краставица', 'vegetable', ['VOL'], ['breakfast', 'main', 'snack'], 5, { vegan: true, vegetarian: true }),
  item('veg_pepper', 'Чушка', 'чушка', 'vegetable', ['VOL'], ['main', 'snack'], 5, { vegan: true, vegetarian: true }),
  item('veg_carrot', 'Морков', 'морков', 'vegetable', ['VOL'], ['main', 'snack'], 5, { vegan: true, vegetarian: true }),
  item('veg_broccoli', 'Броколи', 'броколи', 'vegetable', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('veg_spinach', 'Спанак', 'спанак', 'vegetable', ['VOL'], ['main', 'breakfast'], 4, { vegan: true, vegetarian: true }),
  item('veg_lettuce', 'Маруля', 'маруля', 'vegetable', ['VOL'], ['breakfast', 'main', 'snack'], 5, { vegan: true, vegetarian: true, aliases: ['салата'] }),
  item('veg_zucchini', 'Тиквичка', 'тиквичка', 'vegetable', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('veg_cauliflower', 'Карфиол', 'карфиол', 'vegetable', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('veg_cabbage', 'Зеле', 'зеле', 'vegetable', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('veg_green_beans', 'Зелен фасул', 'зелен фасул', 'vegetable', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('veg_mushrooms', 'Гъби', 'гъби', 'vegetable', ['VOL', 'PRO'], ['main', 'breakfast'], 4, { vegan: true, vegetarian: true }),
  item('veg_eggplant', 'Патладжан', 'патладжан', 'vegetable', ['VOL'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('veg_celery', 'Целина', 'целина', 'vegetable', ['VOL'], ['main', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('veg_onion', 'Лук', 'лук', 'vegetable', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('veg_garlic', 'Чесън', 'чесън', 'vegetable', ['VOL'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('veg_arugula', 'Рукола', 'рукола', 'vegetable', ['VOL'], ['main', 'snack'], 3, { vegan: true, vegetarian: true }),
  item('veg_asparagus', 'Аспержи', 'асперги', 'vegetable', ['VOL'], ['main'], 2, { vegan: true, vegetarian: true }),
  item('veg_pumpkin', 'Тиква', 'тиква', 'vegetable', ['VOL', 'ENG'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('veg_cherry_tomato', 'Чери домати', 'чери домати', 'vegetable', ['VOL'], ['main', 'snack'], 3, { vegan: true, vegetarian: true, genericOf: 'veg_tomato' }),
  item('veg_leek', 'Праз', 'праз', 'vegetable', ['VOL'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('veg_oyster_mushroom', 'Еринги', 'еринги', 'vegetable', ['VOL'], ['main'], 2, { vegan: true, vegetarian: true, genericOf: 'veg_mushrooms' }),

  // ── ENG — generic + common ──
  item('eng_rice', 'Ориз', 'ориз', 'carb', ['ENG'], ['main', 'snack'], 5, { vegan: true, vegetarian: true }),
  item('eng_rice_white', 'Ориз (бял)', 'ориз бял', 'carb', ['ENG'], ['main'], 4, { vegan: true, vegetarian: true, genericOf: 'eng_rice' }),
  item('eng_rice_brown', 'Ориз (кафяв)', 'ориз кафяв', 'carb', ['ENG'], ['main'], 3, { vegan: true, vegetarian: true, genericOf: 'eng_rice' }),
  item('eng_potato', 'Картофи', 'картофи', 'carb', ['ENG'], ['main'], 5, { vegan: true, vegetarian: true, aliases: ['картоф'] }),
  item('eng_bread', 'Хляб', 'хляб', 'carb', ['ENG'], ['breakfast', 'main', 'snack'], 5, { vegan: true, vegetarian: true }),
  item('eng_bread_whole', 'Пълнозърнест хляб', 'хляб пълнозърнест', 'carb', ['ENG'], ['breakfast', 'main'], 4, { vegan: true, vegetarian: true, genericOf: 'eng_bread' }),
  item('eng_rye_bread', 'Ръжен хляб', 'ръжен хляб', 'carb', ['ENG'], ['breakfast', 'main'], 4, { vegan: true, vegetarian: true }),
  item('eng_oats', 'Овесени ядки', 'овесени ядки', 'carb', ['ENG'], ['breakfast', 'snack'], 5, { vegan: true, vegetarian: true, aliases: ['овес'] }),
  item('eng_pasta', 'Паста', 'паста', 'carb', ['ENG'], ['main'], 4, { vegan: true, vegetarian: true, aliases: ['макарони'] }),
  item('eng_quinoa', 'Киноа', 'киноа', 'carb', ['ENG'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('eng_bulgur', 'Булгур', 'булгур', 'carb', ['ENG'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('eng_buckwheat', 'Елда', 'елда', 'carb', ['ENG'], ['main', 'breakfast'], 3, { vegan: true, vegetarian: true }),
  item('eng_millet', 'Просо', 'просо', 'carb', ['ENG'], ['main'], 2, { vegan: true, vegetarian: true }),
  item('eng_tortilla', 'Тортила', 'тортила', 'carb', ['ENG'], ['main', 'snack'], 3, { vegan: true, vegetarian: true }),
  item('eng_sweet_potato', 'Сладки картофи', 'сладки картофи', 'carb', ['ENG'], ['main'], 3, { vegan: true, vegetarian: true, aliases: ['батат'] }),
  item('eng_corn', 'Царевица', 'царевица', 'carb', ['ENG'], ['main', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('eng_porridge', 'Каша', 'каша', 'carb', ['ENG'], ['breakfast'], 4, { vegan: true, vegetarian: true }),

  // ── LEGUMES ──
  item('leg_lentils', 'Леща', 'леща', 'legume', ['PRO', 'ENG'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('leg_chickpeas', 'Нахут', 'нахут', 'legume', ['PRO', 'ENG'], ['main', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('leg_black_beans', 'Черен боб', 'черен боб', 'legume', ['PRO', 'ENG'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('leg_white_beans', 'Бял боб', 'бял боб', 'legume', ['PRO', 'ENG'], ['main'], 4, { vegan: true, vegetarian: true, aliases: ['боб'] }),
  item('leg_peas', 'Грах', 'грах', 'legume', ['PRO', 'ENG'], ['main'], 4, { vegan: true, vegetarian: true }),

  // ── FAT — generic + common ──
  item('fat_oil', 'Зехтин', 'зехтин', 'fat', ['FAT'], ['main', 'breakfast', 'snack'], 5, { vegan: true, vegetarian: true, aliases: ['олио'] }),
  item('fat_nuts', 'Ядки', 'ядки', 'fat', ['FAT', 'PRO'], ['snack', 'late_snack', 'breakfast'], 5, { vegan: true, vegetarian: true }),
  item('fat_avocado', 'Авокадо', 'авокадо', 'fat', ['FAT'], ['breakfast', 'main', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('fat_almonds', 'Бадеми', 'бадеми', 'fat', ['FAT', 'PRO'], ['snack', 'late_snack'], 4, { vegan: true, vegetarian: true, genericOf: 'fat_nuts' }),
  item('fat_walnuts', 'Орехи', 'орехи', 'fat', ['FAT', 'PRO'], ['snack', 'late_snack'], 4, { vegan: true, vegetarian: true, genericOf: 'fat_nuts' }),
  item('fat_cashew', 'Кашу', 'кашу', 'fat', ['FAT', 'PRO'], ['snack'], 3, { vegan: true, vegetarian: true, genericOf: 'fat_nuts' }),
  item('fat_hazelnuts', 'Лешници', 'лешници', 'fat', ['FAT'], ['snack'], 3, { vegan: true, vegetarian: true, genericOf: 'fat_nuts' }),
  item('fat_peanuts', 'Фъстъци', 'фъстъци', 'fat', ['FAT', 'PRO'], ['snack'], 4, { vegan: true, vegetarian: true }),
  item('fat_peanut_butter', 'Фъстъчено масло', 'фъстъчено масло', 'fat', ['FAT', 'PRO'], ['breakfast', 'snack'], 3, { vegan: true, vegetarian: true }),
  item('fat_almond_butter', 'Бадемово масло', 'бадемово масло', 'fat', ['FAT'], ['breakfast', 'snack'], 2, { vegan: true, vegetarian: true }),
  item('fat_tahini', 'Тахан', 'тахан', 'fat', ['FAT', 'PRO'], ['main', 'snack'], 3, { vegan: true, vegetarian: true }),
  item('fat_butter', 'Масло', 'масло', 'fat', ['FAT'], ['breakfast', 'main'], 4, { vegetarian: true }),
  item('fat_coconut_oil', 'Кокосово масло', 'кокосово масло', 'fat', ['FAT'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('fat_sunflower_oil', 'Слънчогледово масло', 'слънчогледово масло', 'fat', ['FAT'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('fat_chia', 'Семена чиа', 'семена чиа', 'fat', ['FAT'], ['breakfast', 'snack'], 3, { vegan: true, vegetarian: true }),
  item('fat_flax', 'Ленено семе', 'ленено семе', 'fat', ['FAT'], ['breakfast'], 3, { vegan: true, vegetarian: true }),
  item('fat_pumpkin_seeds', 'Тиквени семки', 'тиквени семки', 'fat', ['FAT', 'PRO'], ['snack', 'late_snack'], 3, { vegan: true, vegetarian: true }),
  item('fat_sunflower_seeds', 'Слънчогледови семки', 'слънчогледови семки', 'fat', ['FAT'], ['snack'], 3, { vegan: true, vegetarian: true }),
  item('fat_olives', 'Маслини', 'маслини', 'fat', ['FAT'], ['main', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('fat_peanuts_pistachio', 'Шамфъстък', 'шамфъстък', 'fat', ['FAT', 'PRO'], ['snack', 'late_snack'], 3, { vegan: true, vegetarian: true, genericOf: 'fat_nuts' }),

  // ── FRUIT — generic + common ──
  item('fruit_generic', 'Плод', 'плод', 'fruit', ['ENG'], ['breakfast', 'snack'], 5, { vegan: true, vegetarian: true, aliases: ['плодове'] }),
  item('fruit_apple', 'Ябълка', 'ябълка', 'fruit', ['ENG'], ['breakfast', 'snack'], 5, { vegan: true, vegetarian: true, genericOf: 'fruit_generic' }),
  item('fruit_banana', 'Банан', 'банан', 'fruit', ['ENG'], ['breakfast', 'snack'], 4, { vegan: true, vegetarian: true, genericOf: 'fruit_generic' }),
  item('fruit_orange', 'Портокал', 'портокал', 'fruit', ['ENG'], ['breakfast', 'snack'], 5, { vegan: true, vegetarian: true }),
  item('fruit_mandarin', 'Мандарина', 'мандарина', 'fruit', ['ENG'], ['snack'], 4, { vegan: true, vegetarian: true }),
  item('fruit_strawberry', 'Ягоди', 'ягоди', 'fruit', ['ENG'], ['breakfast', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('fruit_blueberry', 'Боровинки', 'боровинки', 'fruit', ['ENG'], ['breakfast', 'snack'], 3, { vegan: true, vegetarian: true }),
  item('fruit_raspberry', 'Малини', 'малини', 'fruit', ['ENG'], ['snack'], 3, { vegan: true, vegetarian: true }),
  item('fruit_grapes', 'Грозде', 'грозде', 'fruit', ['ENG'], ['snack'], 4, { vegan: true, vegetarian: true }),
  item('fruit_peach', 'Праскова', 'праскова', 'fruit', ['ENG'], ['snack'], 4, { vegan: true, vegetarian: true }),
  item('fruit_pear', 'Круша', 'круша', 'fruit', ['ENG'], ['snack'], 4, { vegan: true, vegetarian: true }),
  item('fruit_kiwi', 'Киви', 'киви', 'fruit', ['ENG'], ['breakfast', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('fruit_watermelon', 'Диня', 'диня', 'fruit', ['ENG'], ['snack'], 4, { vegan: true, vegetarian: true }),
  item('fruit_melon', 'Пъпеш', 'пъпеш', 'fruit', ['ENG'], ['snack'], 4, { vegan: true, vegetarian: true }),
  item('fruit_grapefruit', 'Грейпфрут', 'грейпфрут', 'fruit', ['ENG'], ['breakfast'], 3, { vegan: true, vegetarian: true }),
  item('fruit_lemon', 'Лимон', 'лимон', 'fruit', ['ENG'], ['main', 'snack'], 4, { vegan: true, vegetarian: true }),
  item('fruit_pineapple', 'Ананас', 'ананас', 'fruit', ['ENG'], ['snack'], 3, { vegan: true, vegetarian: true }),
  item('fruit_mango', 'Манго', 'манго', 'fruit', ['ENG'], ['snack'], 2, { vegan: true, vegetarian: true }),

  // ── CONDIMENTS (small portions, not macro drivers) ──
  item('cond_soy', 'Соев сос', 'соев сос', 'condiment', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('cond_hummus', 'Хумус', 'хумус', 'condiment', ['PRO', 'FAT'], ['snack', 'main'], 4, { vegan: true, vegetarian: true }),
  item('cond_mustard', 'Горчица', 'горчица', 'condiment', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('cond_lemon_juice', 'Лимонов сок', 'лимонов сок', 'condiment', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('cond_vinegar', 'Оцет', 'оцет', 'condiment', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('cond_tomato_paste', 'Доматено пюре', 'доматено пюре', 'condiment', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('cond_coconut_milk', 'Кокосово мляко', 'кокосово мляко', 'condiment', ['FAT'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('cond_cinnamon', 'Канела', 'канела', 'condiment', ['VOL'], ['breakfast'], 3, { vegan: true, vegetarian: true }),
  item('cond_turmeric', 'Куркума', 'куркума', 'condiment', ['VOL'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('cond_ginger', 'Джинджифил', 'джинджифил', 'condiment', ['VOL'], ['main'], 3, { vegan: true, vegetarian: true }),
  item('cond_honey', 'Мед', 'мед', 'condiment', ['ENG'], ['breakfast', 'snack'], 4, { vegetarian: true }),

  // ── READY MEALS (composite — use as single line or decompose) ──
  item('meal_omelet', 'Омлет', 'омлет', 'ready_meal', ['PRO', 'FAT'], ['breakfast', 'main'], 5, { vegetarian: true }),
  item('meal_boiled_egg', 'Варено яйце', 'варено яйце', 'ready_meal', ['PRO'], ['breakfast', 'snack', 'late_snack'], 5, { vegetarian: true }),
  item('meal_chicken_salad', 'Пилешка салата', 'пилешка салата', 'ready_meal', ['PRO', 'VOL'], ['main', 'snack'], 4),
  item('meal_green_salad', 'Зелена салата', 'салата зелена', 'ready_meal', ['VOL'], ['main', 'snack'], 5, { vegan: true, vegetarian: true }),
  item('meal_rice_chicken', 'Ориз с пиле', 'ориз с пиле', 'ready_meal', ['PRO', 'ENG'], ['main'], 5),
  item('meal_fish_potato', 'Риба с картофи', 'риба с картофи', 'ready_meal', ['PRO', 'ENG'], ['main'], 4),
  item('meal_oatmeal', 'Овесена каша', 'овесена каша', 'ready_meal', ['ENG'], ['breakfast'], 5, { vegetarian: true }),
  item('meal_yogurt_oats', 'Кисело мляко с овес', 'кисело мляко с овес', 'ready_meal', ['PRO', 'ENG'], ['breakfast', 'snack'], 5, { vegetarian: true }),
  item('meal_chicken_soup', 'Пилешка супа', 'пилешка супа', 'ready_meal', ['PRO', 'VOL'], ['main'], 4),
  item('meal_veg_soup', 'Зеленчукова супа', 'супа', 'ready_meal', ['VOL'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('meal_lentil_stew', 'Яхния от леща', 'яхния леща', 'ready_meal', ['PRO', 'ENG'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('meal_bean_stew', 'Боб яхния', 'боб яхния', 'ready_meal', ['PRO', 'ENG'], ['main'], 4, { vegan: true, vegetarian: true }),
  item('meal_chicken_sandwich', 'Сандвич с пиле', 'сандвич пиле', 'ready_meal', ['PRO', 'ENG'], ['breakfast', 'main', 'snack'], 4),
  item('meal_grilled_chicken', 'Пиле на скара', 'пиле на скара', 'ready_meal', ['PRO'], ['main'], 4, { genericOf: 'pro_chicken' }),
  item('meal_baked_fish', 'Риба на фурна', 'риба на фурна', 'ready_meal', ['PRO'], ['main'], 4, { genericOf: 'pro_fish' }),
  item('meal_cottage_bowl', 'Купа с извара', 'купа извара', 'ready_meal', ['PRO'], ['breakfast', 'snack'], 4, { vegetarian: true }),
  item('meal_skry_bowl', 'Купа със скир', 'купа скир', 'ready_meal', ['PRO'], ['breakfast', 'snack', 'late_snack'], 4, { vegetarian: true }),
];

/**
 * Catalog-level exclusions for clinical protocols with genuinely restrictive
 * whole-food eliminations. Most protocols (e.g. avoid alcohol/processed food/sugar)
 * need no entry here — the catalog is whole-foods-only already, so those
 * restrictions are automatically satisfied. Only list protocols where the AI
 * prompt's restriction text alone isn't a reliable enough safety guarantee
 * (e.g. AIP eliminates entire food groups the catalog would otherwise offer
 * as PRO/ENG/FAT sources — a silent AI slip here means feeding a forbidden
 * food to someone with an autoimmune condition, not just an inaccurate macro).
 * Keyed by clinicalProtocol id (matches CLINICAL_PROTOCOLS in worker.js).
 */
export const CLINICAL_PROTOCOL_EXCLUSIONS = {
  autoimmune_aip: {
    excludeGroups: ['dairy', 'legume'],
    excludeNutritionKeys: [
      // eggs
      'яйца', 'яйчни белтъци', 'варено яйце', 'омлет',
      // nightshades (protocol explicitly names these 4)
      'домат', 'чери домати', 'доматено пюре', 'чушка', 'патладжан', 'картофи',
      // nuts & seeds (all FAT/PRO items derived from nuts/seeds)
      'ядки', 'бадеми', 'орехи', 'кашу', 'лешници', 'фъстъци', 'фъстъчено масло',
      'бадемово масло', 'тахан', 'семена чиа', 'ленено семе', 'тиквени семки',
      'слънчогледови семки', 'шамфъстък', 'хумус',
      // grains (incl. gluten) — AIP eliminates ALL grains, not just gluten ones
      'хляб', 'хляб пълнозърнест', 'ръжен хляб', 'овесени ядки', 'овес', 'паста',
      'киноа', 'булгур', 'просо', 'елда', 'тортила', 'царевица',
      'ориз', 'ориз бял', 'ориз кафяв', 'каша',
      // soy (legume family, not covered by the 'legume' group tag)
      'тофу', 'темпе',
      // dairy-derived items catalogued under 'fat'/'protein', not 'dairy' — not covered by excludeGroups
      'масло', 'протеин суроватка',
      // ready meals (group 'ready_meal', so excludeGroups misses them) containing
      // dairy, grains, legumes or nightshades
      'овесена каша', 'кисело мляко с овес', 'купа извара', 'купа скир',
      'ориз с пиле', 'риба с картофи', 'сандвич пиле', 'яхния леща', 'боб яхния',
    ],
  },
};

/** Meal type → timing keys used for catalog filtering */
export const MEAL_TYPE_TIMING = {
  'Хранене 1': 'breakfast',
  'Хранене 2': 'main',
  'Хранене 3': 'snack',
  'Хранене 4': 'main',
  'Хранене 5': 'late_snack',
};

/** Default minimum universality in Step 3 prompts (1=allow all, 5=only generic) */
export const DEFAULT_MIN_UNIVERSALITY = 3;

/** Max items per ADLE slot in prompt */
export const CATALOG_PROMPT_LIMIT_PER_SLOT = 14;
