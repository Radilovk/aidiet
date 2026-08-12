#!/usr/bin/env node
/**
 * Generate full nutrition library: foods, ready-meals, templates, protocol-rules.
 * Sources: FOOD_CATALOG + FOOD_NUTRITION + BG expansion catalog.
 *
 * npm run generate:nutrition-library
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOD_CATALOG } from '../food-catalog-data.js';
import { FOOD_NUTRITION_PER_100G, FOOD_ALIASES } from '../food-nutrition-data.js';
import { normalizeFoodKey } from '../food-utils.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'nutrition-library', 'data');
mkdirSync(dataDir, { recursive: true });

const CATALOG_GROUP_TO_LIBRARY = {
  protein: 'meat',
  dairy: 'dairy',
  vegetable: 'vegetables',
  carb: 'whole_grains',
  fat: 'fats',
  fruit: 'fruits',
  legume: 'legumes',
  condiment: 'condiments',
  beverage: 'beverages',
  ready_meal: null,
};

const DEFAULT_PORTION_G = {
  meat: 120, fish: 120, seafood: 120, eggs: 100, dairy: 150, plant_protein: 120,
  vegetables: 150, fruits: 120, whole_grains: 80, refined_grains: 80, legumes: 150,
  fats: 15, nuts_seeds: 25, condiments: 30, beverages: 250, herbs_spices: 5, sweets: 30,
};

/** Extra BG / universal products not fully covered in FOOD_CATALOG */
const EXPANSION = [
  // meat & fish
  ['food_lamb', 'Агнешко', 'meat', 'агнешко', ['protein'], ['all'], ['vegan', 'vegetarian']],
  ['food_rabbit', 'Заек', 'meat', 'кайма', ['protein'], ['all'], ['vegan', 'vegetarian']],
  ['food_veal', 'Телешко (нежно)', 'meat', 'говеждо постно', ['protein', 'lean'], ['all'], ['vegan', 'vegetarian']],
  ['food_pork_neck', 'Свинска плешка', 'meat', 'свинско постно', ['protein'], ['all'], ['vegan', 'vegetarian']],
  ['food_trout', 'Пъстърва', 'fish', 'риба', ['protein', 'omega3'], ['all'], ['vegan', 'vegetarian']],
  ['food_sardines', 'Сардини', 'fish', 'скумрия', ['protein', 'omega3'], ['all'], ['vegan', 'vegetarian']],
  ['food_hake', 'Хек', 'fish', 'треска', ['protein', 'lean'], ['all'], ['vegan', 'vegetarian']],
  ['food_sea_bass', 'Лаврак', 'fish', 'риба', ['protein'], ['mediterranean'], ['vegan', 'vegetarian']],
  ['food_mussels', 'Миди', 'seafood', 'скариди', ['protein'], ['mediterranean'], ['vegan', 'vegetarian']],
  ['food_calamari', 'Кalmari', 'seafood', 'скариди', ['protein'], ['mediterranean'], ['vegan', 'vegetarian']],
  ['food_turkey_minced', 'Пуешка кайма', 'meat', 'пуешко филе', ['protein', 'lean'], ['all'], ['vegan', 'vegetarian']],
  ['food_chicken_liver', 'Пилешки дреболии', 'meat', 'пилешко месо', ['protein', 'iron'], ['all'], ['vegan', 'vegetarian']],
  // dairy
  ['food_mozzarella', 'Моцарела', 'dairy', 'сирене', ['protein', 'fat'], ['all'], ['vegan']],
  ['food_feta', 'Фета', 'dairy', 'сирене', ['protein', 'fat'], ['mediterranean'], ['vegan']],
  ['food_parmesan', 'Пармезан', 'dairy', 'кашкавал', ['protein', 'fat'], ['all'], ['vegan']],
  ['food_butter_milk', 'Масло (краве)', 'dairy', 'масло', ['fat'], ['all'], ['vegan']],
  ['food_lactose_free_milk', 'Мляко без лактоза', 'dairy', 'мляко', ['protein'], ['all'], ['vegan']],
  ['food_probiotic_yogurt', 'Пробиотично кисело мляко', 'dairy', 'кисело мляко', ['protein', 'probiotic'], ['all'], ['vegan']],
  // plant protein
  ['food_seitan', 'Сейтан', 'plant_protein', 'тофу', ['protein'], ['vegan', 'vegetarian'], []],
  ['food_pea_protein', 'Граохов протеин', 'plant_protein', 'протеин растителен', ['protein'], ['vegan'], []],
  ['food_edamame', 'Едамаме', 'plant_protein', 'едамаме', ['protein'], ['all'], ['keto']],
  // grains
  ['food_couscous', 'Кус-кус', 'whole_grains', 'булгур', ['carb'], ['mediterranean'], ['keto', 'gluten_free']],
  ['food_polenta', 'Царевичен грис', 'whole_grains', 'царевица', ['carb'], ['all'], ['keto']],
  ['food_rice_cakes', 'Оризови крекери', 'refined_grains', 'крекери', ['carb'], ['all'], ['keto']],
  ['food_crispbread', 'Сухари', 'refined_grains', 'хляб', ['carb', 'fiber'], ['all'], ['keto']],
  ['food_sourdough', 'Кисело тесто хляб', 'whole_grains', 'хляб пълнозърнест', ['carb', 'fiber'], ['all'], ['keto']],
  // legumes
  ['food_red_lentils', 'Червена леща', 'legumes', 'леща', ['protein', 'carb', 'fiber'], ['all'], ['keto']],
  ['food_green_lentils', 'Зелена леща', 'legumes', 'леща', ['protein', 'carb', 'fiber'], ['all'], ['keto']],
  ['food_soy_beans', 'Соеви зърна', 'legumes', 'тофу', ['protein'], ['all'], ['keto']],
  ['food_kidney_beans', 'Червен боб', 'legumes', 'боб', ['protein', 'carb'], ['all'], ['keto']],
  ['food_mung_beans', 'Мунг боб', 'legumes', 'боб', ['protein', 'carb'], ['all'], ['keto']],
  // vegetables (extended)
  ['food_kale', 'Кейл', 'vegetables', 'спанак', ['fiber', 'low_carb'], ['all'], []],
  ['food_beetroot', 'Цвекло', 'vegetables', 'морков', ['fiber', 'carb'], ['all'], ['keto']],
  ['food_radish', 'Репички', 'vegetables', 'морков', ['low_carb'], ['all'], []],
  ['food_turnip', 'Ряпа', 'vegetables', 'морков', ['low_carb'], ['all'], []],
  ['food_okra', 'Бамя', 'vegetables', 'зелен фасул', ['fiber'], ['all'], []],
  ['food_artichoke', 'Артишок', 'vegetables', 'карфиол', ['fiber'], ['mediterranean'], []],
  ['food_fennel', 'Резене', 'vegetables', 'целина', ['fiber', 'fodmap_low'], ['mediterranean'], []],
  ['food_sauerkraut', 'Кисело зеле', 'vegetables', 'зеле', ['fiber', 'probiotic'], ['all'], []],
  ['food_pickles', 'Кисели краставички', 'vegetables', 'краставица', ['low_carb'], ['all'], []],
  ['food_sweet_pepper', 'Червена чушка', 'vegetables', 'чушка', ['fiber'], ['all'], []],
  ['food_mixed_salad', 'Салатен микс', 'vegetables', 'салата', ['fiber', 'low_carb'], ['all'], []],
  ['food_iceberg', 'Айсберг', 'vegetables', 'маруля', ['low_carb'], ['all'], []],
  ['food_romaine', 'Рomaine салата', 'vegetables', 'маруля', ['fiber'], ['all'], []],
  ['food_watercress', 'Хрян (лиsta)', 'vegetables', 'рукола', ['low_carb'], ['all'], []],
  ['food_brussels', 'Brussels sprouts', 'vegetables', 'броколи', ['fiber'], ['all'], []],
  ['food_snow_peas', 'Грах (млад)', 'vegetables', 'грах', ['fiber'], ['all'], []],
  // fruits extended
  ['food_cherries', 'Череши', 'fruits', 'грозде', ['carb', 'antioxidant'], ['all'], ['keto']],
  ['food_plum', 'Слива', 'fruits', 'праскова', ['carb', 'fiber'], ['all'], ['keto']],
  ['food_apricot', 'Кайсия', 'fruits', 'праскова', ['carb'], ['all'], ['keto']],
  ['food_fig', 'Смокиня', 'fruits', 'грозде', ['carb', 'fiber'], ['mediterranean'], ['keto']],
  ['food_dates', 'Финики', 'fruits', 'мед', ['carb'], ['all'], ['keto']],
  ['food_dried_apricot', 'Сушени кайсии', 'fruits', 'праскова', ['carb', 'fiber'], ['all'], ['keto']],
  // nuts & fats
  ['food_pistachio', 'Шамфъстък', 'nuts_seeds', 'шамфъстък', ['fat', 'protein'], ['all'], []],
  ['food_pecans', 'Пекan', 'nuts_seeds', 'орехи', ['fat'], ['all'], []],
  ['food_macadamia', 'Макadamia', 'nuts_seeds', 'кашу', ['fat'], ['all'], []],
  ['food_brazil_nuts', 'Бrazilski oрех', 'nuts_seeds', 'орехи', ['fat'], ['all'], []],
  ['food_hazelnut_butter', 'Лешниково масло', 'nuts_seeds', 'бадемово масло', ['fat'], ['all'], []],
  ['food_ghee', 'Гhee', 'fats', 'масло', ['fat'], ['all'], ['vegan']],
  ['food_flax_oil', 'Ленено масло', 'fats', 'ленено семе', ['fat', 'omega3'], ['all'], []],
  // condiments & BG
  ['food_ajvar', 'Лютеница', 'condiments', 'доматено пюре', ['carb'], ['all'], ['keto']],
  ['food_tomato_sauce', 'Доматен сос', 'condiments', 'доматено пюре', ['carb'], ['all'], []],
  ['food_pesto', 'Песто', 'condiments', 'зехтин', ['fat'], ['mediterranean'], []],
  ['food_salsa', 'Сalsa', 'condiments', 'домат', ['low_carb'], ['all'], []],
  ['food_capers', 'Каперси', 'condiments', 'маслини', ['low_carb'], ['mediterranean'], []],
  ['food_paprika', 'Червен пипер (на прах)', 'herbs_spices', 'подправка', ['antioxidant'], ['all'], []],
  ['food_cumin', 'Ким', 'herbs_spices', 'подправка', [], ['all'], []],
  ['food_dill', 'Копър', 'herbs_spices', 'подправка', [], ['all'], []],
  ['food_parsley', 'Магданoz', 'herbs_spices', 'подправка', [], ['all'], []],
  ['food_mint', 'Мenta', 'herbs_spices', 'подправка', [], ['all'], []],
  // beverages
  ['food_herbal_tea', 'Билков чай', 'beverages', 'чай', ['hydration'], ['all'], []],
  ['food_sparkling_water', 'Мineralna voda', 'beverages', 'вода', ['hydration'], ['all'], []],
  ['food_kefir_drink', 'Кефир (напитка)', 'beverages', 'кефир', ['protein'], ['all'], ['vegan']],
  // sweets (limited)
  ['food_dark_chocolate', 'Тъмен шоколад', 'sweets', 'шоколад', ['carb'], ['all'], ['keto']],
  ['food_stevia', 'Стevia', 'sweets', 'стevia', [], ['all'], []],
  // fodmap tagged
  ['food_zucchini_fodmap', 'Тikvichka (FODMAP low)', 'vegetables', 'тikvichka', ['fodmap_low'], ['low_fodmap'], []],
  ['food_carrot_fodmap', 'Morkov (FODMAP low)', 'vegetables', 'морков', ['fodmap_low'], ['low_fodmap'], []],
  ['food_rice_fodmap', 'Oriz (FODMAP low)', 'whole_grains', 'ориз', ['fodmap_low'], ['low_fodmap'], ['keto']],
];

function resolveNutritionKey(key) {
  const n = normalizeFoodKey(key);
  if (FOOD_NUTRITION_PER_100G[n]) return n;
  if (FOOD_ALIASES[n]) return FOOD_ALIASES[n];
  for (const [alias, canonical] of Object.entries(FOOD_ALIASES)) {
    if (n.includes(alias) || alias.includes(n)) return canonical;
  }
  return n;
}

function macrosFrom100g(nutritionKey, portionG) {
  const key = resolveNutritionKey(nutritionKey);
  const arr = FOOD_NUTRITION_PER_100G[key] || FOOD_NUTRITION_PER_100G[nutritionKey];
  if (!arr) return null;
  const scale = portionG / 100;
  return {
    kcal: Math.round(arr[0] * scale),
    protein_g: Math.round(arr[1] * scale * 10) / 10,
    carbs_g: Math.round(arr[2] * scale * 10) / 10,
    fat_g: Math.round(arr[3] * scale * 10) / 10,
    fiber_g: Math.round((arr[2] * 0.1 || 0) * scale * 10) / 10,
    sodium_mg: 0,
  };
}

function inferExcludedIn(groupId, vegan, tags = []) {
  const ex = [];
  if (['meat', 'fish', 'seafood', 'eggs'].includes(groupId)) {
    ex.push('vegan', 'vegetarian');
  }
  if (groupId === 'dairy') ex.push('vegan');
  if (groupId === 'plant_protein') ex.push('keto');
  if (['whole_grains', 'refined_grains', 'fruits', 'legumes', 'sweets'].includes(groupId)) {
    ex.push('keto');
  }
  if (tags.includes('fodmap_high')) ex.push('low_fodmap');
  return [...new Set(ex)];
}

function catalogEntryToFood(entry) {
  if (entry.group === 'ready_meal') return null;
  let groupId = CATALOG_GROUP_TO_LIBRARY[entry.group];
  if (!groupId) return null;
  if (entry.nutritionKey.includes('риба') || entry.nutritionKey.includes('сьомга') || entry.nutritionKey.includes('тон')) {
    groupId = entry.name.includes('скарид') ? 'seafood' : 'fish';
  }
  if (entry.nutritionKey.includes('тофу') || entry.nutritionKey.includes('темпе') || entry.nutritionKey.includes('протеин растителен')) {
    groupId = 'plant_protein';
  }
  if (['бадеми', 'орехи', 'кашу', 'ядки', 'шамфъстък', 'семена', 'ленено', 'тикови'].some(t => entry.nutritionKey.includes(t))) {
    groupId = 'nuts_seeds';
  }
  const portionG = DEFAULT_PORTION_G[groupId] || 100;
  const macros = macrosFrom100g(entry.nutritionKey, portionG);
  if (!macros) return null;
  const tags = [];
  if (entry.vegan) tags.push('vegan');
  if (entry.slots?.includes('PRO')) tags.push('protein');
  if (entry.slots?.includes('ENG')) tags.push('carb');
  if (entry.slots?.includes('FAT')) tags.push('fat');
  if (entry.slots?.includes('VOL')) tags.push('fiber');
  return {
    id: entry.id.replace(/^(pro_|dairy_|veg_|eng_|leg_|fat_|fruit_|cond_)/, 'food_'),
    name_bg: entry.name,
    group_id: groupId,
    portion_g: portionG,
    ...macros,
    tags,
    allowed_in: ['all', 'balanced', 'mediterranean'],
    excluded_in: inferExcludedIn(groupId, entry.vegan, tags),
    nutrition_key: entry.nutritionKey,
    catalog_id: entry.id,
  };
}

function expansionToFood(row) {
  const [id, name_bg, group_id, nutritionKey, tags, allowed_in, excluded_in] = row;
  const portionG = DEFAULT_PORTION_G[group_id] || 100;
  const macros = macrosFrom100g(nutritionKey, portionG);
  if (!macros) return null;
  return {
    id, name_bg, group_id, portion_g: portionG, ...macros,
    tags: tags || [],
    allowed_in: allowed_in || ['all'],
    excluded_in: excluded_in || inferExcludedIn(group_id, false, tags),
    nutrition_key: resolveNutritionKey(nutritionKey),
  };
}

function nutritionOnlyFoods() {
  const out = [];
  for (const [key, arr] of Object.entries(FOOD_NUTRITION_PER_100G)) {
    if (key.length < 3) continue;
    const id = `food_nut_${normalizeFoodKey(key).replace(/\s+/g, '_').slice(0, 40)}`;
    const group_id = inferGroupFromKey(key, arr);
    const portionG = DEFAULT_PORTION_G[group_id] || 100;
    const macros = macrosFrom100g(key, portionG);
    if (!macros) continue;
    out.push({
      id,
      name_bg: key.charAt(0).toUpperCase() + key.slice(1),
      group_id,
      portion_g: portionG,
      ...macros,
      tags: [],
      allowed_in: ['all'],
      excluded_in: inferExcludedIn(group_id, false, []),
      nutrition_key: key,
    });
  }
  return out;
}

function inferGroupFromKey(key, arr) {
  const k = key.toLowerCase();
  if (/пиле|говеж|свин|кайма|пуеш|агнеш|яйц|риба|сьомга|тон|треска|скумр|тилап|скарид|тофу|темпе|протеин/.test(k)) {
    if (/риба|сьомга|тон|треска|скумр|тилап/.test(k)) return 'fish';
    if (/скарид/.test(k)) return 'seafood';
    if (/тофu|темпе|протеин растителен/.test(k)) return 'plant_protein';
    if (/яйц/.test(k)) return 'eggs';
    return 'meat';
  }
  if (/мляко|кисело|извара|скир|сирене|кашкавал|кефир|ricotta/.test(k)) return 'dairy';
  if (/орiz|хляб|пasta|овес|кinoа|булгур|елда|просо|тортила|царевица|каша|крекер/.test(k)) {
    return /бял|крекер/.test(k) ? 'refined_grains' : 'whole_grains';
  }
  if (/леща|нахут|бob|грах/.test(k)) return 'legumes';
  if (/бадем|орех|кашу|ядки|фъстък|семе|шамфъстък|масло|зехтин|авокадо|маслин/.test(k)) {
    return /масло|зехтин|авокадо/.test(k) ? 'fats' : 'nuts_seeds';
  }
  if (/ябълка|банан|портокал|ягоди|borov|малини|гrozde|праскова|круша|киви|ананас|плод|диня|лимон/.test(k)) return 'fruits';
  if (/вода|чай|кафе/.test(k)) return 'beverages';
  if (/мед|шоколад|stevia/.test(k)) return 'sweets';
  if (/сос|хумус|горчица|oцет|пюре|канела|куркума/.test(k)) return 'condiments';
  const [, p, c, f] = arr;
  if (p >= 8 && c < 5) return 'meat';
  if (c >= 15 && p < 5) return 'whole_grains';
  if (f >= 10) return 'fats';
  return 'vegetables';
}

function dedupeFoods(items) {
  const byKey = new Map();
  for (const item of items) {
    if (!item?.name_bg) continue;
    const key = normalizeFoodKey(item.name_bg);
    const nutKey = normalizeFoodKey(item.nutrition_key || item.name_bg);
    const existing = byKey.get(key);
    if (!existing || (item.catalog_id && !existing.catalog_id)) {
      byKey.set(key, item);
    }
    if (nutKey !== key && !byKey.has(nutKey)) byKey.set(nutKey, item);
  }
  return [...new Set(byKey.values())];
}

function bulkFoods(entries) {
  return entries.map(([id, name_bg, group_id, nutritionKey, portionG]) => {
    const portion = portionG || DEFAULT_PORTION_G[group_id] || 100;
    const macros = macrosFrom100g(nutritionKey, portion);
    if (!macros) return null;
    return {
      id, name_bg, group_id, portion_g: portion, ...macros,
      tags: [], allowed_in: ['all'], excluded_in: inferExcludedIn(group_id, false, []),
      nutrition_key: resolveNutritionKey(nutritionKey),
    };
  }).filter(Boolean);
}

/** Regional / variant products for profile diversity */
const BULK = bulkFoods([
  ['food_chicken_wings', 'Пилешки крилца', 'meat', 'пилешко бутче', 120],
  ['food_chicken_drumstick', 'Пилешко бедро', 'meat', 'пилешко бутче', 130],
  ['food_beef_steak', 'Телешки стек', 'meat', 'говеждо постно', 150],
  ['food_pork_chop', 'Свинска котlet', 'meat', 'свинско постно', 120],
  ['food_salmon_smoked', 'Пушена сьомга', 'fish', 'сьомга', 80],
  ['food_tuna_fresh', 'Риба тон (свежа)', 'fish', 'риба тон', 120],
  ['food_carp', 'Шаран', 'fish', 'риба', 150],
  ['food_eggs_boiled', 'Варено яйце', 'eggs', 'варено яйце', 60],
  ['food_eggs_scrambled', 'Бъркани яйца', 'eggs', 'омлет', 120],
  ['food_milk_skim', 'Мляко (обезмаслено)', 'dairy', 'мляко', 200],
  ['food_yogurt_drink', 'Аиран', 'dairy', 'кисело мляко', 250],
  ['food_cheese_goat', 'Козе сирене', 'dairy', 'сирене', 40],
  ['food_rice_basmati', 'Ориз басмати', 'whole_grains', 'ориз', 80],
  ['food_rice_jasmine', 'Ориз жасмин', 'whole_grains', 'ориз', 80],
  ['food_pasta_whole', 'Пълнозърнеста паста', 'whole_grains', 'паста', 80],
  ['food_bread_rye', 'Ръжен хляб', 'whole_grains', 'ръжен хляб', 40],
  ['food_oats_overnight', 'Овес (накиснат)', 'whole_grains', 'овесени ядки', 50],
  ['food_lentil_soup_base', 'Леща (супа)', 'legumes', 'леща', 200],
  ['food_chickpea_hummus', 'Нахут (за хумус)', 'legumes', 'нахут', 100],
  ['food_bean_soup', 'Боб (супа)', 'legumes', 'боб', 200],
  ['food_spinach_fresh', 'Спанак (свеж)', 'vegetables', 'спанак', 100],
  ['food_tomato_cherry', 'Чери домати', 'vegetables', 'чери домати', 100],
  ['food_cucumber_mini', 'Кornishon', 'vegetables', 'краставица', 80],
  ['food_pepper_green', 'Зелена чушка', 'vegetables', 'чушка', 120],
  ['food_onion_red', 'Червен лук', 'vegetables', 'лук', 50],
  ['food_garlic_roasted', 'Печен чесън', 'vegetables', 'чесън', 20],
  ['food_mushroom_portobello', 'Портobello', 'vegetables', 'гъби', 100],
  ['food_sweet_potato_baked', 'Печен batat', 'vegetables', 'батат', 150],
  ['food_corn_cob', 'Царевица (кочan)', 'whole_grains', 'царевица', 150],
  ['food_apple_green', 'Зелена ябълка', 'fruits', 'ябълка', 150],
  ['food_banana_ripe', 'Банан (узрял)', 'fruits', 'банан', 120],
  ['food_orange_juice', 'Портокал (сок)', 'fruits', 'портокал', 200],
  ['food_berries_mix', 'Мix плodове', 'fruits', 'borovinki', 100],
  ['food_almonds_raw', 'Сурови бадеми', 'nuts_seeds', 'бадеми', 25],
  ['food_walnuts_raw', 'Сурови oрехи', 'nuts_seeds', 'орехи', 25],
  ['food_peanut_raw', 'Фъстъци (сурови)', 'nuts_seeds', 'фъстъци', 25],
  ['food_olive_oil_extra', 'Зехтин extra virgin', 'fats', 'зехтин', 10],
  ['food_coconut_flakes', 'Кокосovi people', 'fats', 'кокосово масло', 15],
  ['food_honey_raw', 'Мед (нерафиниран)', 'sweets', 'мед', 15],
  ['food_protein_bar', 'Протеин bar', 'plant_protein', 'протеин суроватка', 60],
  ['food_smoothie_base', 'Smoothie base', 'fruits', 'плод', 250],
  ['food_soup_veg', 'Зеленчукова супа', 'vegetables', 'супа', 300],
  ['food_soup_chicken', 'Пилешka supa', 'meat', 'пилешka supa', 300],
  ['food_salad_shopska', 'Shopska salata', 'vegetables', 'салata зелена', 200],
  ['food_tarator', 'Тarator', 'dairy', 'кисело мляко', 250],
  ['food_banitsa', 'Banitsa (порция)', 'refined_grains', 'хляб', 120],
  ['food_kebab_chicken', 'Пилешki kebab', 'meat', 'пилешko месо', 150],
  ['food_grill_veg', 'Grill зеленчуци', 'vegetables', 'зеленчук', 200],
]);

// ── Build foods ──
const fromCatalog = FOOD_CATALOG.map(catalogEntryToFood).filter(Boolean);
const fromExpansion = EXPANSION.map(expansionToFood).filter(Boolean);
const fromNutrition = nutritionOnlyFoods();
let foods = dedupeFoods([...fromCatalog, ...fromExpansion, ...fromNutrition, ...BULK]);
foods = foods.filter(f => !/експандирана/i.test(f.name_bg));
foods.sort((a, b) => a.group_id.localeCompare(b.group_id) || a.name_bg.localeCompare(b.name_bg, 'bg'));

const foodById = new Map(foods.map(f => [f.id, f]));
const foodByName = new Map(foods.map(f => [normalizeFoodKey(f.name_bg), f]));

function findFood(...candidates) {
  for (const c of candidates) {
    const f = foodById.get(c) || foodByName.get(normalizeFoodKey(c));
    if (f) return f;
  }
  for (const c of candidates) {
    const n = normalizeFoodKey(c);
    for (const f of foods) {
      if (normalizeFoodKey(f.name_bg).includes(n) || normalizeFoodKey(f.nutrition_key || '').includes(n)) return f;
    }
  }
  return null;
}

function buildMeal(id, name_bg, meal_type, diet_profiles, ingredientSpecs) {
  const ingredients = [];
  let kcal = 0; let protein_g = 0; let carbs_g = 0; let fat_g = 0;
  for (const spec of ingredientSpecs) {
    const food = findFood(spec.id, spec.name);
    if (!food) continue;
    const grams = spec.grams || food.portion_g;
    const scale = grams / food.portion_g;
    ingredients.push({ food_id: food.id, grams });
    kcal += Math.round(food.kcal * scale);
    protein_g += food.protein_g * scale;
    carbs_g += food.carbs_g * scale;
    fat_g += food.fat_g * scale;
  }
  if (!ingredients.length) return null;
  return {
    id, name_bg, meal_type, diet_profiles, ingredients,
    kcal: Math.round(kcal),
    protein_g: Math.round(protein_g * 10) / 10,
    carbs_g: Math.round(carbs_g * 10) / 10,
    fat_g: Math.round(fat_g * 10) / 10,
  };
}

const MEAL_PATTERNS = [
  // breakfast
  ['meal_oats_egg_berries', 'Овес с яйца и боровинки', 'breakfast', ['balanced', 'mediterranean'],
    [{ id: 'food_eng_oats', grams: 40 }, { name: 'яйца', grams: 100 }, { name: 'боровинки', grams: 80 }]],
  ['meal_yogurt_oats_banana', 'Кисело мляко с овес и банан', 'breakfast', ['balanced'],
    [{ name: 'кисело мляко', grams: 200 }, { name: 'овесени ядки', grams: 30 }, { name: 'банан', grams: 80 }]],
  ['meal_skry_fruit', 'Скир с плод', 'breakfast', ['balanced', 'high_protein'],
    [{ name: 'скир', grams: 200 }, { name: 'ябълка', grams: 120 }]],
  ['meal_omelet_veg', 'Омлет с зеленчуци', 'breakfast', ['balanced', 'keto', 'low_carb'],
    [{ name: 'яйца', grams: 150 }, { name: 'спанак', grams: 80 }, { name: 'домат', grams: 80 }]],
  ['meal_cottage_honey', 'Извара с мед и орехи', 'breakfast', ['balanced', 'high_protein'],
    [{ name: 'извара', grams: 150 }, { name: 'мед', grams: 15 }, { name: 'орехи', grams: 15 }]],
  ['meal_tofu_scramble', 'Тофу скрамбъл', 'breakfast', ['vegan', 'balanced'],
    [{ name: 'тофу', grams: 150 }, { name: 'чушка', grams: 100 }, { name: 'зехтин', grams: 10 }]],
  ['meal_porridge_berries', 'Овесена каша с плодове', 'breakfast', ['balanced', 'vegetarian'],
    [{ name: 'овесени ядки', grams: 50 }, { name: 'малини', grams: 80 }, { name: 'кисело мляко', grams: 100 }]],
  ['meal_bread_egg_avocado', 'Яйца с авокадо и хляб', 'breakfast', ['balanced', 'mediterranean'],
    [{ name: 'яйца', grams: 120 }, { name: 'авокадо', grams: 60 }, { name: 'хляб пълнозърнест', grams: 40 }]],
  // lunch
  ['meal_salmon_quinoa', 'Сьомга с киноа и тиквички', 'lunch', ['balanced', 'mediterranean'],
    [{ name: 'сьомга', grams: 140 }, { name: 'киноа', grams: 150 }, { name: 'тиквичка', grams: 150 }, { name: 'зехтин', grams: 10 }]],
  ['meal_chicken_rice_broccoli', 'Пиле с ориз и броколи', 'lunch', ['balanced'],
    [{ name: 'пилешки гърди', grams: 120 }, { name: 'ориз', grams: 150 }, { name: 'броколи', grams: 150 }]],
  ['meal_turkey_potato_salad', 'Пуешко с картофи и салата', 'lunch', ['balanced'],
    [{ name: 'пуешко филе', grams: 120 }, { name: 'картофи', grams: 200 }, { name: 'салата', grams: 100 }]],
  ['meal_beef_broccoli', 'Телешко с броколи', 'lunch', ['balanced', 'low_carb'],
    [{ name: 'говеждо', grams: 120 }, { name: 'броколи', grams: 200 }, { name: 'зехтин', grams: 10 }]],
  ['meal_vegan_bowl', 'Веган боул', 'lunch', ['vegan', 'balanced'],
    [{ name: 'тофу', grams: 150 }, { name: 'киноа', grams: 150 }, { name: 'спанак', grams: 100 }]],
  ['meal_lentil_rice', 'Леща с ориз', 'lunch', ['vegan', 'vegetarian', 'balanced'],
    [{ name: 'леща', grams: 150 }, { name: 'ориз', grams: 120 }, { name: 'морков', grams: 80 }]],
  ['meal_fish_potato_salad', 'Риба с картофи и салата', 'lunch', ['balanced', 'pescatarian'],
    [{ name: 'треска', grams: 150 }, { name: 'картофи', grams: 180 }, { name: 'салата', grams: 80 }]],
  ['meal_shrimp_pasta', 'Скариди с паста', 'lunch', ['mediterranean', 'pescatarian'],
    [{ name: 'скариди', grams: 120 }, { name: 'пasta', grams: 80 }, { name: 'доматено пюре', grams: 60 }]],
  ['meal_chicken_bulgur', 'Пиле с булгур и зеленчуци', 'lunch', ['balanced'],
    [{ name: 'пилешко месо', grams: 120 }, { name: 'булгур', grams: 80 }, { name: 'чушка', grams: 120 }]],
  ['meal_pork_beans', 'Свинско с боб', 'lunch', ['balanced'],
    [{ name: 'свинско', grams: 100 }, { name: 'бob', grams: 150 }, { name: 'лук', grams: 40 }]],
  ['meal_tuna_salad', 'Салата с риба тон', 'lunch', ['balanced', 'pescatarian', 'low_carb'],
    [{ name: 'риба тon', grams: 120 }, { name: 'салата', grams: 120 }, { name: 'зехтин', grams: 10 }]],
  ['meal_chickpea_bowl', 'Нахут боул', 'lunch', ['vegan', 'mediterranean'],
    [{ name: 'нахут', grams: 150 }, { name: 'морков', grams: 80 }, { name: 'зехтин', grams: 10 }]],
  // dinner
  ['meal_keto_eggs_zucchini', 'Яйца с тиквички', 'dinner', ['keto', 'low_carb'],
    [{ name: 'яйца', grams: 150 }, { name: 'тиквичка', grams: 200 }, { name: 'зехтин', grams: 10 }]],
  ['meal_grilled_fish_veg', 'Риба на скара с зеленчуци', 'dinner', ['mediterranean', 'pescatarian'],
    [{ name: 'риба', grams: 150 }, { name: 'броколи', grams: 150 }, { name: 'зехтин', grams: 10 }]],
  ['meal_chicken_salad_dinner', 'Пилешка салата', 'dinner', ['balanced', 'low_carb'],
    [{ name: 'пилешко месо', grams: 120 }, { name: 'салата', grams: 150 }, { name: 'домат', grams: 100 }]],
  ['meal_tempeh_stirfry', 'Темпе със зеленчуци', 'dinner', ['vegan'],
    [{ name: 'темпе', grams: 120 }, { name: 'морков', grams: 80 }, { name: 'броколи', grams: 100 }]],
  ['meal_mackerel_salad', 'Скумрия със салата', 'dinner', ['mediterranean', 'pescatarian'],
    [{ name: 'скумрия', grams: 120 }, { name: 'салата', grams: 120 }, { name: 'лимон', grams: 30 }]],
  ['meal_eggplant_turkey', 'Патладжан с пуешко', 'dinner', ['balanced'],
    [{ name: 'пуешко филе', grams: 120 }, { name: 'пatладжан', grams: 200 }, { name: 'зехтин', grams: 8 }]],
  ['meal_cottage_veg', 'Извара с зеленчуци', 'dinner', ['balanced', 'high_protein'],
    [{ name: 'извара', grams: 180 }, { name: 'краставица', grams: 150 }, { name: 'домат', grams: 100 }]],
  // snack / late
  ['meal_yogurt_apple', 'Кисело мляко с ябълка', 'snack', ['balanced'],
    [{ name: 'кисело мляко', grams: 200 }, { name: 'ябълка', grams: 150 }]],
  ['meal_nuts_berries', 'Ядки и боровинки', 'snack', ['balanced', 'keto'],
    [{ name: 'бадеми', grams: 25 }, { name: 'боровинки', grams: 80 }]],
  ['meal_hummus_veg', 'Хумус със зеленчуци', 'snack', ['vegan', 'mediterranean'],
    [{ name: 'хумус', grams: 60 }, { name: 'морков', grams: 80 }, { name: 'краставица', grams: 80 }]],
  ['meal_protein_shake', 'Протеин шейк', 'snack', ['high_protein'],
    [{ name: 'протеин суроватка', grams: 30 }, { name: 'банан', grams: 80 }]],
  ['meal_cheese_crackers', 'Сирене с крекери', 'snack', ['balanced'],
    [{ name: 'сирене', grams: 50 }, { name: 'крекери', grams: 30 }]],
  ['meal_fruit_yogurt', 'Плод с кисело мляко', 'snack', ['balanced'],
    [{ name: 'киви', grams: 100 }, { name: 'кисело мляко', grams: 150 }]],
  ['meal_late_skry', 'Скир късен snack', 'snack', ['balanced', 'high_protein'],
    [{ name: 'скир', grams: 150 }]],
  ['meal_late_nuts', 'Ядки (къс snack)', 'snack', ['keto', 'low_carb'],
    [{ name: 'кашу', grams: 25 }]],
];

const readyMeals = MEAL_PATTERNS.map(([id, name, type, diets, ings]) =>
  buildMeal(id, name, type, diets, ings),
).filter(Boolean);

const mealTemplates = [
  {
    id: 'tpl_breakfast', name_bg: 'Закуска', meal_type: 'breakfast', slot: 'Хранене 1',
    allowed_groups: ['eggs', 'dairy', 'fruits', 'whole_grains', 'nuts_seeds', 'plant_protein'],
    kcal_target: 350, protein_target_g: 20, carb_target_g: 35, fat_target_g: 15,
    components: { protein: 1, carb: { min: 0, max: 1 }, fruit: { min: 0, max: 1 }, fat: { min: 0, max: 1 } },
  },
  {
    id: 'tpl_lunch', name_bg: 'Обяд', meal_type: 'lunch', slot: 'Хранене 2',
    allowed_groups: ['fish', 'meat', 'seafood', 'eggs', 'vegetables', 'whole_grains', 'legumes', 'fats', 'plant_protein'],
    kcal_target: 550, protein_target_g: 35, carb_target_g: 45, fat_target_g: 20,
    components: { protein: 1, vegetables: 2, carb: { min: 0, max: 1 }, fat: 1 },
  },
  {
    id: 'tpl_snack', name_bg: 'Междинно', meal_type: 'snack', slot: 'Хранене 3',
    allowed_groups: ['fruits', 'dairy', 'nuts_seeds', 'vegetables', 'beverages'],
    kcal_target: 200, protein_target_g: 10, carb_target_g: 15, fat_target_g: 10,
    components: { protein: { min: 0, max: 1 }, fruit: { min: 0, max: 1 }, fat: { min: 0, max: 1 } },
  },
  {
    id: 'tpl_dinner', name_bg: 'Вечеря', meal_type: 'dinner', slot: 'Хранене 4',
    allowed_groups: ['fish', 'meat', 'seafood', 'eggs', 'vegetables', 'fats', 'plant_protein', 'legumes'],
    kcal_target: 450, protein_target_g: 35, carb_target_g: 20, fat_target_g: 25,
    components: { protein: 1, vegetables: 2, carb: { min: 0, max: 1 }, fat: 1 },
  },
  {
    id: 'tpl_late_snack', name_bg: 'Късен snack', meal_type: 'snack', slot: 'Хранене 5',
    allowed_groups: ['dairy', 'nuts_seeds', 'fruits', 'beverages'],
    kcal_target: 200, protein_target_g: 10, carb_target_g: 12, fat_target_g: 12,
    components: { protein: { min: 0, max: 1 }, fat: { min: 0, max: 1 } },
  },
];

const protocolRules = {
  diet_profiles: {
    balanced: { prefer_groups: ['vegetables', 'fruits', 'whole_grains', 'fish', 'eggs', 'fats'], prefer_tags: ['fiber'] },
    mediterranean: { prefer_groups: ['vegetables', 'fruits', 'whole_grains', 'fish', 'fats', 'legumes'], prefer_tags: ['fiber', 'omega3', 'antioxidant'] },
    keto: { max_carbs_g_day: 30, exclude_groups: ['whole_grains', 'fruits', 'legumes', 'refined_grains', 'sweets'], prefer_groups: ['eggs', 'fish', 'meat', 'vegetables', 'fats', 'dairy'] },
    low_carb: { max_carbs_g_day: 80, exclude_groups: ['refined_grains', 'sweets'], prefer_groups: ['vegetables', 'fish', 'meat', 'eggs', 'fats'] },
    vegan: { exclude_groups: ['meat', 'fish', 'seafood', 'eggs', 'dairy'], prefer_groups: ['vegetables', 'legumes', 'plant_protein', 'whole_grains', 'nuts_seeds'] },
    vegetarian: { exclude_groups: ['meat', 'fish', 'seafood'], prefer_groups: ['eggs', 'dairy', 'legumes', 'vegetables', 'whole_grains'] },
    pescatarian: { exclude_groups: ['meat'], prefer_groups: ['fish', 'seafood', 'eggs', 'dairy', 'vegetables', 'whole_grains'] },
    high_protein: { min_protein_g_kg: 1.6, prefer_groups: ['meat', 'fish', 'eggs', 'dairy', 'plant_protein'], prefer_tags: ['protein'] },
    low_fodmap: { exclude_tags: ['fodmap_high'], prefer_groups: ['vegetables', 'fish', 'eggs', 'dairy', 'whole_grains'] },
    dash: { max_sodium_mg_day: 2300, prefer_groups: ['vegetables', 'fruits', 'whole_grains', 'legumes', 'dairy', 'fish'], limit_tags: ['high_sodium'] },
    paleo: { exclude_groups: ['whole_grains', 'refined_grains', 'legumes', 'dairy', 'sweets'], prefer_groups: ['meat', 'fish', 'eggs', 'vegetables', 'fruits', 'nuts_seeds'] },
    gluten_free: { exclude_tags: ['gluten'], prefer_groups: ['vegetables', 'fruits', 'rice', 'potatoes', 'meat', 'fish', 'dairy'] },
    dairy_free: { exclude_groups: ['dairy'], prefer_groups: ['meat', 'fish', 'legumes', 'plant_protein', 'vegetables'] },
    anti_inflammatory: { prefer_tags: ['omega3', 'antioxidant', 'fiber'], limit_tags: ['processed'], prefer_groups: ['fish', 'vegetables', 'fruits', 'nuts_seeds'] },
  },
  exchange_map: { carb_exchange_g: 15, protein_exchange_g: 7, fat_exchange_g: 5 },
  meal_distribution_templates: {
    '3_meals': [0.3, 0.4, 0.3],
    '4_meals': [0.25, 0.35, 0.15, 0.25],
    '5_meals': [0.2, 0.25, 0.2, 0.15, 0.2],
  },
  calculation: { kcal_formula: 'protein_g*4 + carbs_g*4 + fat_g*9' },
  priority: ['safety', 'allergies', 'medical', 'goal', 'energy', 'macros', 'base_diet', 'timing', 'behavior'],
};

const orchestrator = {
  pipeline: [
    'load_user', 'evaluate_safety', 'derive_targets', 'select_diet_profile',
    'filter_foods', 'score_foods', 'match_templates', 'build_meals',
    'compute_macros', 'validate_protocol', 'generate_menu', 'generate_shopping_list', 'export',
  ],
  rules: ['remove_disallowed', 'prefer_matching_groups', 'balance_macros', 'avoid_duplicates', 'respect_portion_caps'],
  output: ['macro_plan', 'daily_menu', 'weekly_menu', 'shopping_list', 'monitoring_plan'],
};

const hierarchy = {
  architecture: ['input', 'profile', 'safety', 'rules', 'library', 'templates', 'orchestrator', 'validation', 'output'],
  food_ontology: ['group', 'food', 'portion', 'equivalent', 'meal_template', 'ready_meal', 'menu'],
  layers: ['ingest', 'validate', 'filter', 'score', 'compose', 'calculate', 'validate_adequacy', 'export'],
};

const foodGroups = [
  { id: 'vegetables', name_bg: 'Зеленчуци' }, { id: 'fruits', name_bg: 'Плодове' },
  { id: 'whole_grains', name_bg: 'Пълнозърнести' }, { id: 'refined_grains', name_bg: 'Рафинирани зърнени' },
  { id: 'legumes', name_bg: 'Бобови' }, { id: 'fish', name_bg: 'Риба' }, { id: 'meat', name_bg: 'Месо' },
  { id: 'eggs', name_bg: 'Яйца' }, { id: 'dairy', name_bg: 'Млечни' }, { id: 'nuts_seeds', name_bg: 'Ядки и семена' },
  { id: 'fats', name_bg: 'Мазнини' }, { id: 'herbs_spices', name_bg: 'Билки и подправки' },
  { id: 'beverages', name_bg: 'Напитки' }, { id: 'sweets', name_bg: 'Сладки' },
  { id: 'plant_protein', name_bg: 'Растителни протеини' }, { id: 'seafood', name_bg: 'Морски дарове' },
  { id: 'condiments', name_bg: 'Сосове и добавки' },
];

// strip internal fields from foods export
const foodsExport = foods.map(({ nutrition_key, catalog_id, ...rest }) => rest);

writeFileSync(join(dataDir, 'foods.json'), `${JSON.stringify(foodsExport, null, 2)}\n`);
writeFileSync(join(dataDir, 'ready-meals.json'), `${JSON.stringify(readyMeals, null, 2)}\n`);
writeFileSync(join(dataDir, 'meal-templates.json'), `${JSON.stringify(mealTemplates, null, 2)}\n`);
writeFileSync(join(dataDir, 'protocol-rules.json'), `${JSON.stringify(protocolRules, null, 2)}\n`);
writeFileSync(join(dataDir, 'orchestrator.json'), `${JSON.stringify(orchestrator, null, 2)}\n`);
writeFileSync(join(dataDir, 'hierarchy.json'), `${JSON.stringify(hierarchy, null, 2)}\n`);
writeFileSync(join(dataDir, 'food-groups.json'), `${JSON.stringify(foodGroups, null, 2)}\n`);

const summary = {
  food_groups: foodGroups.length,
  foods: foodsExport.length,
  ready_meals: readyMeals.length,
  templates: mealTemplates.length,
  rulesets: Object.keys(protocolRules.diet_profiles).length,
  orchestrator_steps: orchestrator.pipeline.length,
};
writeFileSync(join(dataDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log('✅ Full nutrition library generated');
console.log(JSON.stringify(summary, null, 2));
