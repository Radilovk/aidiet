/**
 * ЯСТИЯ — единственият списък, от който планът избира основни хранения.
 * =====================================================================
 *
 * ТОЗИ ФАЙЛ Е ЗА РЪЧНО РЕДАКТИРАНЕ. Добавяй, махай и променяй свободно.
 *
 * Правило за съдържанието: САМО универсално познати ястия и комбинации —
 * такива, които клиентът веднага разпознава като нормално хранене. Без
 * локална екзотика (леща с ориз, темпе, скир, „боул“), без англицизми.
 *
 * Формат на един ред:
 *   dish(id, 'Име на ястието', [ ['продукт', дял], ... ], [времена], опции)
 *
 *   id        — уникален, стабилен; не го променяй след като ястието е в план
 *   Име       — както го вижда клиентът
 *   продукти  — 2 до 4 продукта + дял от теглото (сумата ≈ 1).
 *               Имената трябва да съществуват в каталога (food-catalog-data.js).
 *               Грамажите се изчисляват от бекенда спрямо целта на храненето —
 *               делът задава само пропорцията между продуктите.
 *   времена   — 'breakfast' | 'main' | 'snack' | 'late_snack' (може няколко)
 *   опции     — { vegan, vegetarian, universality }
 *               universality 1–5: 5 = всеки го знае, 3 = по-рядко; под 3 не се
 *               предлага по подразбиране.
 *
 * Админ панелът може да добавя и изключва ястия през KV, без промяна тук —
 * виж admin-food-catalog.js. Списъкът тук е базата.
 */

/**
 * @param {string} id
 * @param {string} name
 * @param {Array<[string, number]>} products
 * @param {Array<'breakfast'|'main'|'snack'|'late_snack'>} timing
 * @param {{ vegan?: boolean, vegetarian?: boolean, universality?: 1|2|3|4|5 }} [opts]
 */
function dish(id, name, products, timing, opts = {}) {
  return {
    id,
    name,
    products: products.map(([product, share]) => ({ name: product, share })),
    timing,
    vegan: !!opts.vegan,
    vegetarian: opts.vegetarian !== undefined ? !!opts.vegetarian : !!opts.vegan,
    universality: opts.universality ?? 4,
  };
}

export const MEAL_DISHES = [
  // ── Закуски ──────────────────────────────────────────────────────────
  dish('meal_omelet', 'Омлет', [['яйца', 0.6], ['зеленчук', 0.3], ['зехтин', 0.1]],
    ['breakfast', 'main'], { vegetarian: true, universality: 5 }),
  dish('meal_omelet_veg', 'Омлет със спанак и домати', [['яйца', 0.5], ['спанак', 0.3], ['домат', 0.2]],
    ['breakfast', 'main'], { vegetarian: true }),
  dish('meal_boiled_egg', 'Варени яйца с хляб и домат', [['яйца', 0.5], ['пълнозърнест хляб', 0.3], ['домат', 0.2]],
    ['breakfast'], { vegetarian: true, universality: 5 }),
  dish('meal_egg_bread_cheese', 'Яйца с хляб и сирене', [['яйца', 0.4], ['пълнозърнест хляб', 0.35], ['сирене', 0.25]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_avocado_egg', 'Яйца с авокадо и хляб', [['яйца', 0.45], ['авокадо', 0.3], ['пълнозърнест хляб', 0.25]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_avocado_toast', 'Авокадо върху препечен хляб', [['авокадо', 0.4], ['пълнозърнест хляб', 0.4], ['домат', 0.2]],
    ['breakfast'], { vegan: true }),
  dish('meal_oatmeal', 'Овесена каша с мляко', [['овесени ядки', 0.4], ['мляко', 0.45], ['бадеми', 0.15]],
    ['breakfast'], { vegetarian: true, universality: 5 }),
  dish('meal_porridge_berries', 'Овесена каша с плодове', [['овесени ядки', 0.4], ['малини', 0.25], ['кисело мляко', 0.35]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_oat_plant_milk', 'Овесена каша с растително мляко', [['овесени ядки', 0.35], ['растително мляко', 0.45], ['боровинки', 0.2]],
    ['breakfast'], { vegan: true }),
  dish('meal_yogurt_oats', 'Кисело мляко с овесени ядки', [['кисело мляко', 0.6], ['овесени ядки', 0.4]],
    ['breakfast', 'snack'], { vegetarian: true, universality: 5 }),
  dish('meal_yogurt_oats_banana', 'Кисело мляко с овес и банан', [['кисело мляко', 0.5], ['овесени ядки', 0.3], ['банан', 0.2]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_yogurt_oats_nuts', 'Кисело мляко с овес и орехи', [['кисело мляко', 0.5], ['овесени ядки', 0.35], ['орехи', 0.15]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_cottage_bowl', 'Извара с домати и орехи', [['извара', 0.6], ['домат', 0.25], ['орехи', 0.15]],
    ['breakfast', 'snack'], { vegetarian: true }),
  dish('meal_cottage_honey', 'Извара с мед и орехи', [['извара', 0.6], ['мед', 0.1], ['орехи', 0.3]],
    ['breakfast', 'snack'], { vegetarian: true }),
  dish('meal_cheese_sandwich', 'Сандвич със сирене и домат', [['пълнозърнест хляб', 0.45], ['сирене', 0.35], ['домат', 0.2]],
    ['breakfast', 'snack'], { vegetarian: true, universality: 5 }),
  dish('meal_tofu_scramble', 'Тофу със зеленчуци', [['тофу', 0.5], ['чушка', 0.35], ['зехтин', 0.15]],
    ['breakfast', 'main'], { vegan: true, universality: 3 }),

  // ── Пиле и пуешко ────────────────────────────────────────────────────
  dish('meal_rice_chicken', 'Пиле с ориз и зеленчуци', [['ориз', 0.35], ['пилешко месо', 0.45], ['зеленчук', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_rice_broccoli', 'Пилешки гърди с ориз и броколи', [['пилешки гърди', 0.45], ['ориз', 0.35], ['броколи', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_grilled_chicken', 'Пиле на скара със зеленчуци', [['пилешко месо', 0.5], ['зеленчук', 0.35], ['зехтин', 0.15]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_potato', 'Пиле с картофи', [['пилешко месо', 0.45], ['картофи', 0.4], ['зелен фасул', 0.15]],
    ['main'], { universality: 5 }),
  dish('meal_pasta_chicken', 'Паста с пиле и домати', [['паста', 0.4], ['пилешко месо', 0.4], ['домат', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_salad', 'Пилешка салата', [['пилешко месо', 0.45], ['зеленчук', 0.35], ['зехтин', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_sandwich', 'Сандвич с пиле', [['пилешко месо', 0.35], ['пълнозърнест хляб', 0.45], ['маруля', 0.2]],
    ['breakfast', 'main', 'snack'], { universality: 5 }),
  dish('meal_chicken_soup', 'Пилешка супа', [['пилешко месо', 0.35], ['зеленчук', 0.45], ['ориз', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_bulgur', 'Пиле с булгур и зеленчуци', [['пилешко месо', 0.4], ['булгур', 0.4], ['чушка', 0.2]],
    ['main'], { universality: 3 }),
  dish('meal_chicken_spinach', 'Пиле със спанак и картофи', [['пилешко месо', 0.45], ['спанак', 0.3], ['картофи', 0.25]],
    ['main']),
  dish('meal_turkey_rice', 'Пуешко с ориз', [['пуешко филе', 0.45], ['ориз', 0.35], ['тиквичка', 0.2]],
    ['main']),
  dish('meal_turkey_potato', 'Пуешко с картофи', [['пуешко филе', 0.4], ['картофи', 0.4], ['зелен фасул', 0.2]],
    ['main']),

  // ── Червено месо ─────────────────────────────────────────────────────
  dish('meal_beef_potato', 'Говеждо с картофи', [['говеждо', 0.4], ['картофи', 0.4], ['морков', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_beef_broccoli', 'Говеждо с броколи', [['говеждо', 0.45], ['броколи', 0.35], ['зехтин', 0.2]],
    ['main']),
  dish('meal_beef_mushrooms', 'Говеждо с гъби', [['говеждо', 0.45], ['гъби', 0.35], ['зехтин', 0.2]],
    ['main']),
  dish('meal_pork_potato', 'Свинско с картофи', [['свинско', 0.4], ['картофи', 0.4], ['зеле', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_pork_beans', 'Свинско с боб', [['свинско', 0.4], ['бял боб', 0.45], ['лук', 0.15]],
    ['main'], { universality: 3 }),

  // ── Риба ─────────────────────────────────────────────────────────────
  dish('meal_baked_fish', 'Риба на фурна с картофи', [['риба', 0.45], ['картофи', 0.35], ['зеленчук', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_grilled_fish_veg', 'Риба на скара със зеленчуци', [['риба', 0.5], ['броколи', 0.3], ['зехтин', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_fish_rice', 'Риба с ориз', [['риба', 0.45], ['ориз', 0.35], ['зеленчук', 0.2]],
    ['main'], { universality: 5 }),
  dish('meal_salmon_potato', 'Сьомга с картофи', [['сьомга', 0.45], ['картофи', 0.35], ['спанак', 0.2]],
    ['main']),
  dish('meal_salmon_salad', 'Сьомга със салата', [['сьомга', 0.45], ['маруля', 0.3], ['пълнозърнест хляб', 0.25]],
    ['main']),
  dish('meal_tuna_salad', 'Салата с риба тон', [['риба тон', 0.4], ['маруля', 0.35], ['зехтин', 0.25]],
    ['main', 'snack'], { universality: 5 }),
  dish('meal_mackerel_potato', 'Скумрия с картофи', [['скумрия', 0.4], ['картофи', 0.4], ['спанак', 0.2]],
    ['main'], { universality: 3 }),
  dish('meal_shrimp_pasta', 'Паста със скариди', [['скариди', 0.4], ['паста', 0.4], ['доматено пюре', 0.2]],
    ['main'], { universality: 3 }),

  // ── Вегетариански и веган ────────────────────────────────────────────
  dish('meal_lentil_stew', 'Яхния от леща', [['леща', 0.55], ['зеленчук', 0.3], ['зехтин', 0.15]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_bean_stew', 'Боб яхния', [['боб', 0.55], ['зеленчук', 0.3], ['зехтин', 0.15]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_bean_salad', 'Салата с боб', [['бял боб', 0.5], ['маруля', 0.3], ['зехтин', 0.2]],
    ['main'], { vegan: true }),
  dish('meal_chickpea_salad', 'Салата с нахут', [['нахут', 0.5], ['маруля', 0.3], ['зехтин', 0.2]],
    ['main', 'snack'], { vegan: true }),
  dish('meal_hummus_bread', 'Хумус с хляб и краставица', [['хумус', 0.4], ['пълнозърнест хляб', 0.4], ['краставица', 0.2]],
    ['main', 'snack'], { vegan: true, universality: 3 }),
  dish('meal_veg_soup', 'Зеленчукова супа', [['зеленчук', 0.6], ['картофи', 0.3], ['зехтин', 0.1]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_green_salad', 'Зелена салата', [['зеленчук', 0.55], ['краставица', 0.25], ['зехтин', 0.2]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_egg_potato', 'Яйца с картофи и чушки', [['яйца', 0.35], ['картофи', 0.45], ['чушка', 0.2]],
    ['breakfast', 'main'], { vegetarian: true }),
  dish('meal_cottage_veg', 'Извара със зеленчуци', [['извара', 0.5], ['краставица', 0.3], ['домат', 0.2]],
    ['main', 'snack'], { vegetarian: true }),
  dish('meal_tofu_rice', 'Тофу с ориз и броколи', [['тофу', 0.45], ['ориз', 0.35], ['броколи', 0.2]],
    ['main'], { vegan: true, universality: 3 }),
  dish('meal_stuffed_peppers', 'Пълнени чушки с ориз', [['чушка', 0.45], ['ориз', 0.35], ['зехтин', 0.2]],
    ['main'], { vegan: true, universality: 3 }),
  dish('meal_spinach_rice', 'Спанак с ориз', [['спанак', 0.45], ['ориз', 0.4], ['зехтин', 0.15]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_potato_stew', 'Картофена яхния', [['картофи', 0.55], ['морков', 0.3], ['зехтин', 0.15]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_green_bean_stew', 'Яхния от зелен фасул', [['зелен фасул', 0.55], ['домат', 0.3], ['зехтин', 0.15]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_zucchini_tomato', 'Тиквички с домати', [['тиквичка', 0.5], ['домат', 0.35], ['зехтин', 0.15]],
    ['main'], { vegan: true }),
  dish('meal_roasted_veg_bread', 'Печени зеленчуци с хляб', [['зеленчук', 0.5], ['пълнозърнест хляб', 0.35], ['зехтин', 0.15]],
    ['main'], { vegan: true }),
  dish('meal_lentil_soup', 'Супа от леща', [['леща', 0.5], ['морков', 0.35], ['зехтин', 0.15]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_mushrooms_potato', 'Гъби с картофи', [['гъби', 0.45], ['картофи', 0.4], ['зехтин', 0.15]],
    ['main'], { vegan: true }),

  // ── Кето / нисковъглехидратни ────────────────────────────────────────
  dish('meal_egg_avocado_spinach', 'Яйца с авокадо и спанак', [['яйца', 0.45], ['авокадо', 0.3], ['спанак', 0.25]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_keto_eggs_zucchini', 'Яйца с тиквички', [['яйца', 0.5], ['тиквичка', 0.35], ['зехтин', 0.15]],
    ['breakfast', 'main'], { vegetarian: true, universality: 3 }),
  dish('meal_salmon_avocado', 'Сьомга с авокадо', [['сьомга', 0.5], ['авокадо', 0.25], ['маруля', 0.25]],
    ['main'], { universality: 3 }),
  dish('meal_chicken_cheese_salad', 'Пилешка салата със сирене', [['пилешко месо', 0.45], ['сирене', 0.2], ['маруля', 0.35]],
    ['main'], { universality: 3 }),
  dish('meal_cottage_nuts_veg', 'Извара с орехи и краставица', [['извара', 0.55], ['орехи', 0.15], ['краставица', 0.3]],
    ['breakfast', 'snack'], { vegetarian: true, universality: 3 }),
  dish('meal_eggplant_turkey', 'Пуешко с патладжан', [['пуешко филе', 0.45], ['патладжан', 0.35], ['зехтин', 0.2]],
    ['main'], { universality: 3 }),

  // ── Междинни хранения (Хранене 3) ────────────────────────────────────
  dish('snack_yogurt_almonds', 'Кисело мляко с бадеми', [['кисело мляко', 0.75], ['бадеми', 0.25]],
    ['snack'], { vegetarian: true, universality: 5 }),
  dish('snack_apple_almonds', 'Ябълка с бадеми', [['ябълка', 0.75], ['бадеми', 0.25]],
    ['snack'], { vegan: true, universality: 5 }),
  dish('snack_banana_walnuts', 'Банан с орехи', [['банан', 0.75], ['орехи', 0.25]],
    ['snack'], { vegan: true, universality: 5 }),
  dish('snack_cottage_walnuts', 'Извара с орехи', [['извара', 0.75], ['орехи', 0.25]],
    ['snack'], { vegetarian: true }),
  dish('snack_orange_cashew', 'Портокал с кашу', [['портокал', 0.75], ['кашу', 0.25]],
    ['snack'], { vegan: true }),
  dish('snack_hummus_carrot', 'Хумус с моркови', [['хумус', 0.6], ['морков', 0.4]],
    ['snack'], { vegan: true, universality: 3 }),
  dish('snack_fruit_yogurt', 'Плод с кисело мляко', [['кисело мляко', 0.7], ['ябълка', 0.3]],
    ['snack'], { vegetarian: true, universality: 5 }),
  dish('snack_avocado_walnuts', 'Авокадо с орехи', [['авокадо', 0.6], ['орехи', 0.4]],
    ['snack'], { vegan: true, universality: 3 }),

  // ── Късна закуска (Хранене 5) — само протеин и мазнини ───────────────
  dish('late_yogurt_walnuts', 'Кисело мляко с орехи', [['кисело мляко', 0.75], ['орехи', 0.25]],
    ['late_snack'], { vegetarian: true, universality: 5 }),
  dish('late_cottage_almonds', 'Извара с бадеми', [['извара', 0.75], ['бадеми', 0.25]],
    ['late_snack'], { vegetarian: true, universality: 5 }),
  dish('late_nuts_mix', 'Бадеми и орехи', [['бадеми', 0.5], ['орехи', 0.5]],
    ['late_snack'], { vegan: true, universality: 5 }),
  dish('late_cashew_almonds', 'Кашу с бадеми', [['кашу', 0.5], ['бадеми', 0.5]],
    ['late_snack'], { vegan: true }),
  dish('late_seeds_hazelnuts', 'Тиквени семки с лешници', [['тиквени семки', 0.5], ['лешници', 0.5]],
    ['late_snack'], { vegan: true, universality: 3 }),
  dish('late_nuts_berries', 'Ядки с боровинки', [['бадеми', 0.4], ['боровинки', 0.6]],
    ['snack', 'late_snack'], { vegan: true }),
];

/** Ястия по id — за бърза проверка. */
export const MEAL_DISHES_BY_ID = new Map(MEAL_DISHES.map(d => [d.id, d]));

/** Кои слотове приема едно ястие, изведено от timing. */
export const DISH_TIMINGS = ['breakfast', 'main', 'snack', 'late_snack'];

/**
 * Ястие → каталожен запис (group ready_meal).
 * Слотовете се извеждат от продуктите, за да не се поддържат на две места.
 * @param {{ id: string, name: string, products: Array<{name: string, share: number}>,
 *   timing: string[], vegan: boolean, vegetarian: boolean, universality: number }} d
 * @param {(name: string) => string|null} groupOfProduct
 */
export function dishToCatalogEntry(d, groupOfProduct) {
  const groups = d.products.map(p => groupOfProduct(p.name));
  const slots = new Set();
  if (groups.some(g => ['protein', 'dairy', 'legume'].includes(g))) slots.add('PRO');
  if (groups.some(g => ['carb', 'legume', 'fruit'].includes(g))) slots.add('ENG');
  if (groups.some(g => g === 'vegetable')) slots.add('VOL');
  if (groups.some(g => g === 'fat')) slots.add('FAT');
  if (!slots.size) slots.add('PRO');

  return {
    id: d.id,
    name: d.name,
    nutritionKey: d.id,
    group: 'ready_meal',
    slots: [...slots],
    timing: [...d.timing],
    universality: d.universality,
    vegan: d.vegan,
    vegetarian: d.vegetarian,
    genericOf: null,
    aliases: [],
    scalingMode: null,
    fixedNutrition: null,
    source: 'meal_dishes',
  };
}

/**
 * Ястие → декомпозиция за solver-а.
 * @param {{ products: Array<{name: string, share: number}> }} d
 */
export function dishToParts(d) {
  return d.products.map(p => ({ name: p.name, share: p.share }));
}
