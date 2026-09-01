/**
 * ЯСТИЯ — единственият списък, от който планът избира хранения.
 * =====================================================================
 *
 * ТОЗИ ФАЙЛ Е ЗА РЪЧНО РЕДАКТИРАНЕ. Добавяй, махай и променяй свободно.
 *
 * Съдържание: САМО универсално познати ястия и комбинации — такива, които
 * клиентът веднага разпознава като нормално хранене. Без локална екзотика,
 * без англицизми.
 *
 * Формат на един ред:
 *   dish(id, 'Име на ястието', [ ['продукт', грамове], ... ], [времена], опции)
 *
 *   id        — уникален, стабилен; не го променяй, след като ястието е в план
 *   Име       — както го вижда клиентът
 *   продукти  — 2 до 4 продукта с грамажи за ЕДНА нормална порция.
 *               Пиши колкото реално се слага: марулята в сандвич е 20 г, не 150.
 *               Имената трябва да съществуват в каталога (food-catalog-data.js)
 *               и се изписват в множествено число, както се четат в ястие
 *               („Домати“, „Зеленчуци“, „Чушки“).
 *               Планът мащабира порцията спрямо индивидуалните калории на
 *               клиента и пази пропорцията ти. Затова списъкът е универсален:
 *               едно ястие обслужва и 1500, и 2700 kcal — различава се само
 *               порцията. Всеки продукт спира на реалистичния си таван, така
 *               че голямото хранене расте през хляба и месото, не през листата.
 *   времена   — 'breakfast' | 'main' | 'snack' | 'late_snack' (може няколко)
 *   опции     — { vegan, vegetarian, universality, tags }
 *               universality 1–5: 5 = всеки го знае; под 3 не се предлага.
 *               tags — low_carb, gluten_free, liquid_breakfast, sweet_slot… (по избор)
 *
 * Грамажите вървят по мрежа: под 50 г на стъпки от 5 г, от 50 г нагоре на 50 г.
 * Пиши реалната порция — файлът сам я подравнява към мрежата, затова 130 г
 * пилешко се четат като 150, а 70 г хляб като 50. Така ястието тръгва вярно
 * още при мащаб 1; иначе всяко мащабиране го изкривяваше.
 *
 * Админ панелът добавя и изключва ястия през KV, без промяна тук —
 * виж admin-food-catalog.js. Списъкът тук е базата.
 */

import { snapGrams } from './gram-rounding.js';
import { inferDishTags } from './dish-tags.js';

/**
 * @param {string} id
 * @param {string} name
 * @param {Array<[string, number]>} products [име, грамове за една порция]
 * @param {Array<'breakfast'|'main'|'snack'|'late_snack'>} timing
 * @param {{ vegan?: boolean, vegetarian?: boolean, universality?: 1|2|3|4|5, tags?: string[] }} [opts]
 */
function dish(id, name, products, timing, opts = {}) {
  // Грамажите на плана вървят по мрежата 5/50, затова и еталонът стои на нея:
  // 120 г риба тон се сервират като 100 и ястието тръгваше изкривено още при
  // мащаб 1. Ти пишеш реалната порция — подравняването е работа на файла.
  const snapped = products.map(([product, grams]) => ({ name: product, grams: snapGrams(grams) }));
  const totalGrams = snapped.reduce((sum, p) => sum + p.grams, 0) || 1;
  return {
    id,
    name,
    products: snapped.map(p => ({
      name: p.name,
      grams: p.grams,
      // Делът се извежда от грамажите — един източник на истина за формата.
      share: p.grams / totalGrams,
    })),
    referenceGrams: totalGrams,
    timing,
    vegan: !!opts.vegan,
    vegetarian: opts.vegetarian !== undefined ? !!opts.vegetarian : !!opts.vegan,
    universality: opts.universality ?? 4,
    tags: Array.isArray(opts.tags) ? [...opts.tags] : [],
  };
}

export const MEAL_DISHES = [
  // ── Закуски ──────────────────────────────────────────────────────────
  dish('meal_omelet', 'Омлет със зеленчуци', [['яйца', 150], ['Зеленчуци', 80], ['зехтин', 10]],
    ['breakfast', 'main'], { vegetarian: true, universality: 5 }),
  dish('meal_omelet_veg', 'Омлет със спанак и домати', [['яйца', 150], ['спанак', 60], ['Домати', 60]],
    ['breakfast', 'main'], { vegetarian: true }),
  dish('meal_boiled_egg', 'Варени яйца с хляб и домати', [['яйца', 120], ['пълнозърнест хляб', 60], ['Домати', 60]],
    ['breakfast'], { vegetarian: true, universality: 5 }),
  dish('meal_egg_bread_cheese', 'Яйца с хляб и сирене', [['яйца', 120], ['пълнозърнест хляб', 60], ['сирене', 40]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_avocado_egg', 'Яйца с авокадо и хляб', [['яйца', 120], ['авокадо', 60], ['пълнозърнест хляб', 60]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_avocado_toast', 'Авокадо върху препечен хляб', [['пълнозърнест хляб', 70], ['авокадо', 70], ['Домати', 40]],
    ['breakfast'], { vegan: true }),
  dish('meal_oatmeal', 'Овесена каша с мляко', [['овесени ядки', 60], ['мляко', 200], ['бадеми', 15]],
    ['breakfast'], { vegetarian: true, universality: 5 }),
  dish('meal_porridge_berries', 'Овесена каша с плодове', [['овесени ядки', 60], ['малини', 60], ['кисело мляко', 150]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_oat_plant_milk', 'Овесена каша с растително мляко', [['овесени ядки', 60], ['растително мляко', 200], ['боровинки', 50]],
    ['breakfast'], { vegan: true }),
  dish('meal_yogurt_oats', 'Кисело мляко с овесени ядки', [['кисело мляко', 200], ['овесени ядки', 50]],
    ['breakfast', 'snack'], { vegetarian: true, universality: 5 }),
  dish('meal_yogurt_oats_banana', 'Кисело мляко с овес и банан', [['кисело мляко', 200], ['овесени ядки', 40], ['банан', 80]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_yogurt_oats_nuts', 'Кисело мляко с овес и орехи', [['кисело мляко', 200], ['овесени ядки', 40], ['орехи', 20]],
    ['breakfast'], { vegetarian: true }),
  dish('meal_cottage_bowl', 'Извара с домати и орехи', [['извара', 150], ['Домати', 80], ['орехи', 15]],
    ['breakfast', 'snack'], { vegetarian: true }),
  dish('meal_cottage_honey', 'Извара с мед и орехи', [['извара', 150], ['мед', 15], ['орехи', 20]],
    ['breakfast', 'snack'], { vegetarian: true }),
  dish('meal_cheese_sandwich', 'Сандвич със сирене и домати', [['пълнозърнест хляб', 80], ['сирене', 50], ['Домати', 40]],
    ['breakfast', 'snack'], { vegetarian: true, universality: 5 }),
  dish('meal_tofu_scramble', 'Тофу със зеленчуци', [['тофу', 150], ['Чушки', 80], ['зехтин', 10]],
    ['breakfast', 'main'], { vegan: true, universality: 3 }),
  dish('meal_eggs_bread_cheese_tomato', 'Яйца с хляб, сирене и домати', [['яйца', 150], ['пълнозърнест хляб', 80], ['сирене', 40], ['Домати', 60]],
    ['breakfast'], { vegetarian: true, universality: 5 }),
  dish('meal_eggs_potato_tomato', 'Яйца с картофи и домати', [['яйца', 150], ['картофи', 200], ['Домати', 80]],
    ['breakfast', 'main'], { vegetarian: true }),

  // ── Течна закуска ────────────────────────────────────────────────────
  dish('bf_liquid_yogurt_banana', 'Кисело мляко с банан', [['кисело мляко', 200], ['банан', 80]],
    ['breakfast'], { vegetarian: true, universality: 5, tags: ['liquid_breakfast'] }),
  dish('bf_liquid_skyr_berries', 'Скир с боровинки', [['скир', 180], ['боровинки', 60]],
    ['breakfast'], { vegetarian: true, universality: 4, tags: ['liquid_breakfast', 'sweet_slot'] }),
  dish('bf_liquid_kefir_nuts', 'Кефир с орехи', [['кефир', 200], ['орехи', 15]],
    ['breakfast'], { vegetarian: true, universality: 4, tags: ['liquid_breakfast'] }),
  dish('bf_liquid_yogurt_protein', 'Кисело мляко с протеин и малини', [['кисело мляко', 180], ['протеин суроватка', 25], ['малини', 40]],
    ['breakfast'], { vegetarian: true, universality: 3, tags: ['liquid_breakfast'] }),
  dish('bf_liquid_oats_banana', 'Овес с растително мляко и банан', [['овесени ядки', 50], ['растително мляко', 200], ['банан', 80]],
    ['breakfast'], { vegan: true, universality: 5, tags: ['liquid_breakfast'] }),
  dish('meal_cheese_omelet', 'Омлет със сирене и домати', [['яйца', 150], ['сирене', 50], ['Домати', 60]],
    ['breakfast', 'main'], { vegetarian: true, universality: 5 }),
  dish('meal_eggs_mushrooms', 'Яйца с гъби и зехтин', [['яйца', 150], ['гъби', 100], ['зехтин', 10]],
    ['breakfast', 'main'], { vegetarian: true, universality: 4 }),
  dish('meal_porridge_apple', 'Овесена каша с ябълка', [['овесени ядки', 60], ['мляко', 200], ['ябълка', 100]],
    ['breakfast'], { vegetarian: true, universality: 5 }),
  dish('meal_skryr_banana_oats', 'Скир с банан и овес', [['скир', 180], ['банан', 80], ['овесени ядки', 40]],
    ['breakfast'], { vegetarian: true, universality: 4 }),
  dish('meal_rye_cheese_cucumber', 'Ръжен хляб със сирене и краставици', [['ръжен хляб', 80], ['сирене', 50], ['Краставици', 80]],
    ['breakfast', 'snack'], { vegetarian: true, universality: 4 }),

  // ── Пиле и пуешко ────────────────────────────────────────────────────
  dish('meal_rice_chicken', 'Пиле с ориз и зеленчуци', [['пилешко месо', 130], ['ориз', 150], ['Зеленчуци', 100]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_rice_broccoli', 'Пилешки гърди с ориз и броколи', [['пилешки гърди', 130], ['ориз', 150], ['броколи', 100]],
    ['main'], { universality: 5 }),
  dish('meal_grilled_chicken', 'Пиле на скара със зеленчуци', [['пилешко месо', 150], ['Зеленчуци', 150], ['зехтин', 10]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_potato', 'Пиле с картофи', [['пилешко месо', 130], ['картофи', 200], ['зелен фасул', 80]],
    ['main'], { universality: 5 }),
  dish('meal_pasta_chicken', 'Паста с пиле и домати', [['паста', 150], ['пилешко месо', 120], ['Домати', 80]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_salad', 'Пилешка салата', [['пилешко месо', 130], ['Зеленчуци', 150], ['зехтин', 10]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_sandwich', 'Сандвич с пиле', [['пълнозърнест хляб', 80], ['пилешко месо', 70], ['маруля', 20]],
    ['breakfast', 'main', 'snack'], { universality: 5 }),
  dish('meal_chicken_soup', 'Пилешка супа', [['пилешко месо', 100], ['Зеленчуци', 150], ['ориз', 50]],
    ['main'], { universality: 5 }),
  dish('meal_chicken_bulgur', 'Пиле с булгур и зеленчуци', [['пилешко месо', 130], ['булгур', 150], ['Чушки', 80]],
    ['main'], { universality: 3 }),
  dish('meal_chicken_spinach', 'Пиле със спанак и картофи', [['пилешко месо', 130], ['спанак', 100], ['картофи', 150]],
    ['main']),
  dish('meal_turkey_rice', 'Пуешко с ориз', [['пуешко филе', 130], ['ориз', 150], ['Тиквички', 80]],
    ['main']),
  dish('meal_turkey_potato', 'Пуешко с картофи', [['пуешко филе', 130], ['картофи', 200], ['зелен фасул', 80]],
    ['main']),
  dish('meal_chicken_quinoa', 'Пиле с киноа и зеленчуци', [['пилешко месо', 130], ['киноа', 150], ['Зеленчуци', 100]],
    ['main'], { universality: 4 }),
  dish('meal_chicken_sweet_potato', 'Пиле със сладки картофи', [['пилешко месо', 130], ['сладки картофи', 200], ['броколи', 100]],
    ['main'], { universality: 4 }),
  dish('meal_chicken_thigh_potato', 'Пилешко бутче с картофи', [['пилешко бутче', 140], ['картофи', 200], ['Моркови', 80]],
    ['main'], { universality: 4 }),
  dish('meal_turkey_pasta', 'Пуешко с паста и домати', [['пуешко филе', 130], ['паста', 150], ['Домати', 80]],
    ['main'], { universality: 4 }),
  dish('meal_pork_rice_peppers', 'Свинско с ориз и чушки', [['свинско', 130], ['ориз', 150], ['Чушки', 100]],
    ['main'], { universality: 4 }),
  dish('meal_beef_rice_carrots', 'Говеждо с ориз и моркови', [['говеждо', 130], ['ориз', 150], ['Моркови', 80]],
    ['main'], { universality: 5 }),
  dish('meal_kebab_rice', 'Кайма с ориз и домати', [['кайма', 130], ['ориз', 150], ['Домати', 80]],
    ['main'], { universality: 4 }),
  dish('meal_pasta_beef', 'Паста с говеждо и зеленчуци', [['паста', 150], ['говеждо', 130], ['Домати', 80], ['Зеленчуци', 80]],
    ['main'], { universality: 5 }),
  dish('meal_salmon_rice', 'Сьомга с ориз и спанак', [['сьомга', 130], ['ориз', 150], ['спанак', 80]],
    ['main'], { universality: 4 }),
  dish('meal_lentil_chicken', 'Пиле с леща и моркови', [['пилешко месо', 130], ['леща', 150], ['Моркови', 80]],
    ['main'], { universality: 4 }),

  // ── Червено месо ─────────────────────────────────────────────────────
  dish('meal_beef_potato', 'Говеждо с картофи', [['говеждо', 130], ['картофи', 200], ['Моркови', 60]],
    ['main'], { universality: 5 }),
  dish('meal_beef_broccoli', 'Говеждо с броколи', [['говеждо', 130], ['броколи', 150], ['зехтин', 10]],
    ['main']),
  dish('meal_beef_mushrooms', 'Говеждо с гъби', [['говеждо', 130], ['гъби', 120], ['зехтин', 10]],
    ['main']),
  dish('meal_pork_potato', 'Свинско с картофи', [['свинско', 130], ['картофи', 200], ['зеле', 100]],
    ['main'], { universality: 5 }),
  dish('meal_pork_beans', 'Свинско с боб', [['свинско', 100], ['бял боб', 200], ['лук', 30]],
    ['main'], { universality: 3 }),
  dish('meal_moussaka_style', 'Кайма с картофи и патладжан', [['кайма', 130], ['картофи', 180], ['патладжан', 120]],
    ['main'], { universality: 4 }),

  // ── Риба ─────────────────────────────────────────────────────────────
  dish('meal_baked_fish', 'Риба на фурна с картофи', [['риба', 150], ['картофи', 200], ['Зеленчуци', 80]],
    ['main'], { universality: 5 }),
  dish('meal_grilled_fish_veg', 'Риба на скара със зеленчуци', [['риба', 150], ['броколи', 150], ['зехтин', 10]],
    ['main'], { universality: 5 }),
  dish('meal_fish_rice', 'Риба с ориз', [['риба', 150], ['ориз', 150], ['Зеленчуци', 80]],
    ['main'], { universality: 5 }),
  dish('meal_salmon_potato', 'Сьомга с картофи', [['сьомга', 130], ['картофи', 200], ['спанак', 80]],
    ['main']),
  dish('meal_salmon_salad', 'Сьомга със салата', [['сьомга', 130], ['маруля', 80], ['пълнозърнест хляб', 60]],
    ['main']),
  dish('meal_tuna_salad', 'Салата с риба тон', [['риба тон', 120], ['маруля', 100], ['зехтин', 10]],
    ['main', 'snack'], { universality: 5 }),
  dish('meal_mackerel_potato', 'Скумрия с картофи', [['скумрия', 120], ['картофи', 200], ['спанак', 80]],
    ['main'], { universality: 3 }),
  dish('meal_shrimp_pasta', 'Паста със скариди и домати', [['паста', 150], ['скариди', 120], ['Домати', 80]],
    ['main'], { universality: 3 }),
  dish('meal_cod_potato', 'Треска с картофи', [['треска', 150], ['картофи', 200], ['Зеленчуци', 80]],
    ['main'], { universality: 4 }),
  dish('meal_tilapia_rice', 'Тилапия с ориз', [['тилапия', 150], ['ориз', 150], ['Тиквички', 80]],
    ['main'], { universality: 4 }),
  dish('meal_tuna_pasta', 'Паста с риба тон', [['паста', 150], ['риба тон', 120], ['Домати', 80]],
    ['main'], { universality: 4 }),
  dish('meal_lavrak_potato', 'Лаврак с картофи и спанак', [['лаврак', 150], ['картофи', 200], ['спанак', 80]],
    ['main'], { universality: 3 }),

  // ── Вегетариански и веган ────────────────────────────────────────────
  dish('meal_lentil_stew', 'Яхния от леща', [['леща', 200], ['Зеленчуци', 100], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_bean_stew', 'Боб яхния', [['боб', 200], ['Зеленчуци', 100], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_bean_salad', 'Салата с боб', [['бял боб', 180], ['маруля', 80], ['зехтин', 10]],
    ['main'], { vegan: true }),
  dish('meal_chickpea_salad', 'Салата с нахут', [['нахут', 180], ['маруля', 80], ['зехтин', 10]],
    ['main', 'snack'], { vegan: true }),
  dish('meal_hummus_bread', 'Хумус с хляб и краставици', [['пълнозърнест хляб', 80], ['хумус', 60], ['Краставици', 60]],
    ['main', 'snack'], { vegan: true, universality: 3 }),
  dish('meal_veg_soup', 'Зеленчукова супа', [['Зеленчуци', 200], ['картофи', 120], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_green_salad', 'Зелена салата', [['Зеленчуци', 150], ['Краставици', 80], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_egg_potato', 'Яйца с картофи и чушки', [['яйца', 120], ['картофи', 180], ['Чушки', 60]],
    ['breakfast', 'main'], { vegetarian: true }),
  dish('meal_cottage_veg', 'Извара със зеленчуци', [['извара', 150], ['Краставици', 80], ['Домати', 80]],
    ['main', 'snack'], { vegetarian: true }),
  dish('meal_tofu_rice', 'Тофу с ориз и броколи', [['тофу', 150], ['ориз', 150], ['броколи', 80]],
    ['main'], { vegan: true, universality: 3 }),
  dish('meal_stuffed_peppers', 'Пълнени чушки с ориз', [['Чушки', 180], ['ориз', 120], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 3 }),
  dish('meal_spinach_rice', 'Спанак с ориз', [['спанак', 180], ['ориз', 120], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_potato_stew', 'Картофена яхния', [['картофи', 250], ['Моркови', 80], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_green_bean_stew', 'Яхния от зелен фасул', [['зелен фасул', 200], ['Домати', 100], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_zucchini_tomato', 'Тиквички с домати', [['Тиквички', 180], ['Домати', 100], ['зехтин', 10]],
    ['main'], { vegan: true }),
  dish('meal_roasted_veg_bread', 'Печени зеленчуци с хляб', [['Зеленчуци', 200], ['пълнозърнест хляб', 70], ['зехтин', 10]],
    ['main'], { vegan: true }),
  dish('meal_lentil_soup', 'Супа от леща', [['леща', 180], ['Моркови', 80], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_mushrooms_potato', 'Гъби с картофи', [['гъби', 150], ['картофи', 180], ['зехтин', 10]],
    ['main'], { vegan: true }),
  dish('meal_quinoa_veg_bowl', 'Киноа със зеленчуци', [['киноа', 150], ['Зеленчуци', 150], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 4 }),
  dish('meal_tempeh_rice_broccoli', 'Темпе с ориз и броколи', [['темпе', 150], ['ориз', 150], ['броколи', 100]],
    ['main'], { vegan: true, universality: 3 }),
  dish('meal_black_bean_stew', 'Яхния от черен боб', [['черен боб', 200], ['Домати', 100], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 4 }),
  dish('meal_sweet_potato_lentil', 'Сладки картофи с леща', [['сладки картофи', 200], ['леща', 150], ['Моркови', 80]],
    ['main'], { vegan: true, universality: 4 }),
  dish('meal_lentil_rice', 'Леща с ориз и моркови', [['леща', 150], ['ориз', 120], ['Моркови', 80]],
    ['main'], { vegan: true, universality: 5 }),
  dish('meal_chickpea_spinach', 'Нахут със спанак', [['нахут', 180], ['спанак', 120], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 4 }),
  dish('meal_bulgur_veg', 'Булгур със зеленчуци', [['булгур', 150], ['Зеленчуци', 150], ['зехтин', 10]],
    ['main'], { vegan: true, universality: 4 }),
  dish('meal_tofu_sweet_potato', 'Тофу със сладки картофи', [['тофу', 150], ['сладки картофи', 180], ['броколи', 80]],
    ['main'], { vegan: true, universality: 3 }),
  dish('meal_bean_potato', 'Боб с картофи и моркови', [['боб', 150], ['картофи', 180], ['Моркови', 80]],
    ['main'], { vegan: true, universality: 4 }),

  // ── Кето / нисковъглехидратни ────────────────────────────────────────
  dish('meal_egg_avocado_spinach', 'Яйца с авокадо и спанак', [['яйца', 150], ['авокадо', 70], ['спанак', 80]],
    ['breakfast'], { vegetarian: true, tags: ['low_carb'] }),
  dish('meal_keto_eggs_zucchini', 'Яйца с тиквички', [['яйца', 150], ['Тиквички', 120], ['зехтин', 10]],
    ['breakfast', 'main'], { vegetarian: true, universality: 3, tags: ['low_carb'] }),
  dish('meal_salmon_avocado', 'Сьомга с авокадо', [['сьомга', 130], ['авокадо', 60], ['маруля', 60]],
    ['main'], { universality: 3, tags: ['low_carb'] }),
  dish('meal_chicken_cheese_salad', 'Пилешка салата със сирене', [['пилешко месо', 120], ['сирене', 40], ['маруля', 100]],
    ['main'], { universality: 3, tags: ['low_carb'] }),
  dish('meal_cottage_nuts_veg', 'Извара с орехи и краставици', [['извара', 150], ['орехи', 20], ['Краставици', 80]],
    ['breakfast', 'snack'], { vegetarian: true, universality: 3, tags: ['low_carb'] }),
  dish('meal_eggplant_turkey', 'Пуешко с патладжан', [['пуешко филе', 130], ['патладжан', 150], ['зехтин', 10]],
    ['main'], { universality: 3, tags: ['low_carb'] }),

  // ── Инсулинова резистентност / контролирани въглехидрати ─────────────
  dish('ir_omelet_mushrooms', 'Омлет с гъби', [['яйца', 150], ['гъби', 100]],
    ['breakfast', 'main'], { vegetarian: true, tags: ['low_carb'] }),
  dish('ir_chicken_zucchini', 'Пиле с тиквички', [['пилешко месо', 130], ['Тиквички', 150]],
    ['main'], { universality: 4, tags: ['low_carb'] }),
  dish('ir_turkey_broccoli', 'Пуешко с броколи', [['пуешко филе', 130], ['броколи', 150]],
    ['main'], { universality: 4, tags: ['low_carb'] }),
  dish('ir_cottage_avocado', 'Извара с авокадо', [['извара', 150], ['авокадо', 60], ['Краставици', 60]],
    ['breakfast', 'snack'], { vegetarian: true, tags: ['low_carb'] }),
  dish('ir_tuna_cucumber', 'Риба тон с краставици', [['риба тон', 120], ['Краставици', 100]],
    ['main', 'snack'], { universality: 4, tags: ['low_carb'] }),
  dish('ir_eggs_spinach_cheese', 'Яйца със спанак и сирене', [['яйца', 150], ['спанак', 80], ['сирене', 40]],
    ['breakfast', 'main'], { vegetarian: true, tags: ['low_carb'] }),
  dish('ir_salmon_broccoli', 'Сьомга с броколи', [['сьомга', 130], ['броколи', 150], ['зехтин', 10]],
    ['main'], { universality: 4, tags: ['low_carb'] }),
  dish('ir_pork_zucchini', 'Свинско с тиквички', [['свинско', 130], ['Тиквички', 150]],
    ['main'], { universality: 4, tags: ['low_carb'] }),
  dish('ir_beef_green_beans', 'Говеждо със зелен фасул', [['говеждо', 130], ['зелен фасул', 150]],
    ['main'], { universality: 4, tags: ['low_carb'] }),
  dish('ir_eggs_asparagus', 'Яйца с аспержи', [['яйца', 150], ['Аспержи', 120]],
    ['breakfast', 'main'], { vegetarian: true, tags: ['low_carb'] }),
  dish('ir_chicken_cauliflower', 'Пиле с карфиол', [['пилешко месо', 130], ['карфиол', 150]],
    ['main'], { universality: 4, tags: ['low_carb'] }),
  dish('ir_turkey_mushrooms', 'Пуешко с гъби', [['пуешко филе', 130], ['гъби', 120]],
    ['main'], { universality: 4, tags: ['low_carb'] }),

  // ── Междинни хранения (Хранене 3) ────────────────────────────────────
  dish('snack_yogurt_almonds', 'Кисело мляко с бадеми', [['кисело мляко', 150], ['бадеми', 15]],
    ['snack'], { vegetarian: true, universality: 5 }),
  dish('snack_apple_almonds', 'Ябълка с бадеми', [['ябълка', 150], ['бадеми', 15]],
    ['snack'], { vegan: true, universality: 5 }),
  dish('snack_banana_walnuts', 'Банан с орехи', [['банан', 120], ['орехи', 15]],
    ['snack'], { vegan: true, universality: 5 }),
  dish('snack_cottage_walnuts', 'Извара с орехи', [['извара', 120], ['орехи', 15]],
    ['snack'], { vegetarian: true }),
  dish('snack_orange_cashew', 'Портокал с кашу', [['портокал', 150], ['кашу', 15]],
    ['snack'], { vegan: true }),
  dish('snack_hummus_carrot', 'Хумус с моркови', [['хумус', 60], ['Моркови', 100]],
    ['snack'], { vegan: true, universality: 3 }),
  dish('snack_fruit_yogurt', 'Плодове с кисело мляко', [['кисело мляко', 150], ['ябълка', 100]],
    ['snack'], { vegetarian: true, universality: 5, tags: ['sweet_slot'] }),
  dish('snack_avocado_walnuts', 'Авокадо с орехи', [['авокадо', 70], ['орехи', 15]],
    ['snack'], { vegan: true, universality: 3 }),
  dish('snack_pear_walnuts', 'Круша с орехи', [['круша', 150], ['орехи', 15]],
    ['snack'], { vegan: true, universality: 5 }),
  dish('snack_kiwi_cashew', 'Киви с кашу', [['киви', 120], ['кашу', 15]],
    ['snack'], { vegan: true, universality: 4 }),
  dish('snack_cottage_berries', 'Извара с ягоди', [['извара', 130], ['ягоди', 80]],
    ['snack'], { vegetarian: true, universality: 4 }),
  dish('snack_tomato_cheese', 'Домати със сирене', [['Домати', 120], ['сирене', 40]],
    ['snack'], { vegetarian: true, universality: 5 }),
  dish('snack_grape_almonds', 'Грозде с бадеми', [['грозде', 120], ['бадеми', 15]],
    ['snack'], { vegan: true, universality: 4 }),
  dish('snack_celery_hummus', 'Целина с хумус', [['целина', 100], ['хумус', 60]],
    ['snack'], { vegan: true, universality: 3 }),

  // ── Контролирано сладко ──────────────────────────────────────────────
  dish('sweet_yogurt_berries', 'Кисело мляко с боровинки', [['кисело мляко', 150], ['боровинки', 80]],
    ['snack'], { vegetarian: true, universality: 5, tags: ['sweet_slot'] }),
  dish('sweet_cottage_honey', 'Извара с мед', [['извара', 130], ['мед', 15]],
    ['snack'], { vegetarian: true, universality: 5, tags: ['sweet_slot'] }),
  dish('sweet_apple_yogurt', 'Ябълка с кисело мляко', [['ябълка', 120], ['кисело мляко', 150]],
    ['snack'], { vegetarian: true, universality: 5, tags: ['sweet_slot'] }),
  dish('sweet_kefir_berries', 'Кефир с малини', [['кефир', 180], ['малини', 60]],
    ['snack'], { vegetarian: true, universality: 4, tags: ['sweet_slot', 'liquid_breakfast'] }),

  // ── Късна закуска (Хранене 5) — само протеин и мазнини ───────────────
  dish('late_yogurt_walnuts', 'Кисело мляко с орехи', [['кисело мляко', 120], ['орехи', 10]],
    ['late_snack'], { vegetarian: true, universality: 5 }),
  dish('late_cottage_almonds', 'Извара с бадеми', [['извара', 100], ['бадеми', 10]],
    ['late_snack'], { vegetarian: true, universality: 5 }),
  dish('late_nuts_mix', 'Бадеми и орехи', [['бадеми', 15], ['орехи', 15]],
    ['late_snack'], { vegan: true, universality: 5 }),
  dish('late_cashew_almonds', 'Кашу с бадеми', [['кашу', 15], ['бадеми', 15]],
    ['late_snack'], { vegan: true }),
  dish('late_seeds_hazelnuts', 'Тиквени семки с лешници', [['тиквени семки', 15], ['лешници', 15]],
    ['late_snack'], { vegan: true, universality: 3 }),
  dish('late_nuts_berries', 'Ядки с боровинки', [['бадеми', 15], ['боровинки', 80]],
    ['snack', 'late_snack'], { vegan: true }),
  dish('late_skryr_almonds', 'Скир с бадеми', [['скир', 120], ['бадеми', 15]],
    ['late_snack'], { vegetarian: true, universality: 4 }),
  dish('late_cottage_walnuts', 'Извара с орехи', [['извара', 100], ['орехи', 15]],
    ['late_snack'], { vegetarian: true, universality: 5 }),
];

/** Ястия по id — за бърза проверка. */
export const MEAL_DISHES_BY_ID = new Map(MEAL_DISHES.map(d => [d.id, d]));

/** Кои слотове приема едно ястие, изведено от timing. */
export const DISH_TIMINGS = ['breakfast', 'main', 'snack', 'late_snack'];

/**
 * Ястие → каталожен запис (group ready_meal).
 * Слотовете се извеждат от продуктите, за да не се поддържат на две места.
 * @param {{ id: string, name: string, products: Array<{name: string, share: number, grams?: number}>,
 *   timing: string[], vegan: boolean, vegetarian: boolean, universality: number, tags?: string[] }} d
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
    tags: d.tags?.length ? [...d.tags] : [],
    dishTags: inferDishTags(d),
    genericOf: null,
    aliases: [],
    scalingMode: null,
    fixedNutrition: null,
    source: 'meal_dishes',
  };
}

/**
 * Ястие → декомпозиция за solver-а.
 * @param {{ products: Array<{name: string, share: number, grams: number}> }} d
 */
export function dishToParts(d) {
  return d.products.map(p => ({ name: p.name, share: p.share, grams: p.grams }));
}
