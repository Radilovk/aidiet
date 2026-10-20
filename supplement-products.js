/**
 * Добавка от плана → налични продукти от каталога на BIOCODE (biocode-bg.com).
 *
 * Каталогът се търси с текст, а текстовото търсене само по себе си подвежда:
 * „витамин D3“ дава първо D3 + K2 (опасно при варфарин), „магнезий“ — алкална
 * смес с натрий. Затова изборът е по правила: заявка за каталога, думи,
 * които ТРЯБВА да са в името, предпочитани форми и изключени комбинации.
 * Добавка, за която няма сигурно съвпадение, остава без продукт — по-добре
 * никакъв линк, отколкото грешен.
 *
 * Отгоре върви таблицата за лекарства (drug-interactions.js): продукт, чието
 * име съдържа противопоказано вещество (K2 при варфарин и т.н.), отпада.
 */

import { applySupplementInteractions } from './drug-interactions.js';

export const BIOCODE_SITE = 'https://biocode-bg.com';
export const BIOCODE_CATALOG = 'https://port.radilov-k.workers.dev/portfolio/catalog';

/**
 * @typedef {{ key: string, match: RegExp, q: string, must: RegExp, prefer?: RegExp, avoid?: RegExp, vegan?: RegExp,
 *   forms?: Array<[RegExp, string, RegExp]> }} Slot
 * `forms` — конкретна форма в името на добавката → по-точна заявка и предпочитание
 * (магнезиев цитрат → цитрат, колаген тип II → тип II).
 */

// Напитки и барове с добавено вещество не са добавка.
const NOT_SUPPLEMENT = /water|ready-to-drink|\bcan\b|\bbars?\b|drink|напитка|протеинов бар/i;
const COMBO = /\+|&|\/|\bwith\b|\bс\b|complex|комплекс|formula|формула|multi|мулти/i;

/** @type {Slot[]} — редът има значение: по-конкретното първо (D3 + K2 преди D3). */
export const SUPPLEMENT_SLOTS = [
  { key: 'd3k2', match: /d3\s*\+\s*k2|d3.*k2/i, q: 'vitamin d3 k2', must: /d-?3/i, prefer: /k2|k-2|mk-?7|мк-?7/i },
  { key: 'vitamin_d', match: /витамин\s*d|vitamin\s*d|\bd3\b/i, q: 'vitamin d3', must: /d-?3|vitamin d\b/i, avoid: /k2|k-2|multi|мулти|calcium|калций|complex/i },
  { key: 'b12', match: /b12|b-12/i, q: 'b12', must: /b-?12/i, avoid: /complex|комплекс|multi/i },
  { key: 'vitamin_c', match: /витамин\s*c|vitamin\s*c/i, q: 'vitamin c', must: /vitamin c|витамин c|c-?1000|c-?500|ascorb/i, avoid: /multi|мулти|complex|collagen|колаген/i },
  {
    key: 'magnesium', match: /магнези|magnes/i, q: 'magnesium', must: /magnes|магнез|magtein/i,
    prefer: /glycinat|bisglycin|бисглицин|citrat|цитрат|chelat|threonat|треонат/i,
    avoid: /alkaline|calcium|zinc|zma|\bca\b|sodium|натрий|калций/i,
    forms: [
      [/треонат|threonat/i, 'magnesium threonate', /threonat|magtein/i],
      [/цитрат|citrat/i, 'magnesium citrate', /citrat/i],
      [/бисглицин|глицинат|glycinat/i, 'magnesium bisglycinate', /glycinat/i],
    ],
  },
  { key: 'omega3', match: /омега|omega/i, q: 'omega 3', must: /omega|омега|fish oil|рибено|krill/i, prefer: /epa|high|ultra|triple|концентр/i, vegan: /alga|водорасл|vegan|веган/i, avoid: /3-6-9|3 6 9/i },
  { key: 'iron', match: /желез|iron\b/i, q: 'iron', must: /iron|желязо/i, prefer: /bisglycin|бисглицин|chelat/i, avoid: /multi|мулти/i },
  { key: 'zinc', match: /цинк|zinc/i, q: 'zinc', must: /zinc|цинк/i, avoid: /magnes|магнез|calcium|zma|multi/i },
  { key: 'chromium', match: /хром|chromium/i, q: 'chromium', must: /chrom|хром/i },
  { key: 'iodine', match: /йод|iodine|iodide/i, q: 'iodine', must: /iod|йод|kelp|келп/i },
  { key: 'creatine', match: /креатин|creatine/i, q: 'creatine monohydrate', must: /creatin|креатин/i, prefer: /monohydrat|монохидрат|creapure/i, avoid: /hcl|kre-alkalyn|matrix|stack/i },
  {
    key: 'collagen', match: /колаген|collagen/i, q: 'collagen', must: /collagen|колаген/i,
    prefer: /peptid|пептид|hydrolyz|хидролиз/i, avoid: /glucosamin|chondroitin|msm/i,
    forms: [
      [/тип\s*ii\b|type\s*ii\b|тип\s*2|uc-?ii/i, 'collagen type ii', /type ii|uc-?ii|type 2/i],
      [/пептид|peptid|тип\s*i\s*и\s*iii/i, 'collagen peptides', /peptid|hydrolyz|i & iii|i and iii/i],
    ],
  },
  { key: 'psyllium', match: /псилиум|psyllium/i, q: 'psyllium', must: /psyllium|псилиум/i },
  { key: 'berberine', match: /берберин|berberin/i, q: 'berberine', must: /berberin|берберин/i },
  { key: 'inositol', match: /инозитол|inositol/i, q: 'inositol', must: /inositol|инозитол/i },
  { key: 'ashwagandha', match: /ашваганда|ashwagandha/i, q: 'ashwagandha', must: /ashwagandha|ашваганда/i, prefer: /ksm/i },
  { key: 'ala', match: /липоева|lipoic|\bala\b/i, q: 'alpha lipoic acid', must: /lipoic|липоева|\bala\b/i },
  { key: 'curcumin', match: /куркум|curcum|turmeric/i, q: 'curcumin', must: /curcum|turmeric|куркум/i, prefer: /piperin|bioperine|пиперин/i },
  { key: 'nac', match: /\bnac\b|ацетил\s*цистеин|acetyl\s*cystein/i, q: 'nac', must: /\bnac\b|cystein|цистеин/i },
  { key: 'glutamine', match: /глутамин|glutamin/i, q: 'glutamine', must: /glutamin|глутамин/i },
  { key: 'theanine', match: /теанин|theanin/i, q: 'theanine', must: /theanin|теанин/i },
  { key: 'tyrosine', match: /тирозин|tyrosin/i, q: 'tyrosine', must: /tyrosin|тирозин/i },
  { key: 'glutathione', match: /глутатион|glutathion/i, q: 'glutathione', must: /glutathion|глутатион/i },
  { key: 'silymarin', match: /силимарин|бял трън|milk thistle|silymarin/i, q: 'milk thistle', must: /milk thistle|silymarin|бял трън|силимарин/i },
  { key: 'resveratrol', match: /ресвератрол|resveratrol/i, q: 'resveratrol', must: /resveratrol|ресвератрол/i },
  { key: 'probiotic', match: /пробиот|probiotic/i, q: 'probiotic', must: /probiotic|пробиот|lactobac|acidophil/i },
  { key: 'choline', match: /холин|choline|alpha-?gpc/i, q: 'choline', must: /gpc|cholin|холин/i, prefer: /gpc|bitartrat|pure/i, avoid: /inositol|инозитол|b-complex|комплекс/i },
  { key: 'phosphatidylserine', match: /фосфатидилсерин|phosphatidylserin/i, q: 'phosphatidylserine', must: /phosphatidyl|фосфатидил/i },
  { key: 'colostrum', match: /колострум|colostrum/i, q: 'colostrum', must: /colostrum|колострум/i },
  { key: 'calcium', match: /калций|calcium/i, q: 'calcium', must: /calcium|калций/i, avoid: /magnes|zinc|магнез|цинк/i },
  { key: 'potassium', match: /калий\b|potassium/i, q: 'potassium', must: /potassium|калий/i },
];

/** Слотът на добавката или null, ако няма сигурно съответствие. */
export function slotFor(name) {
  const n = String(name || '');
  return SUPPLEMENT_SLOTS.find(s => s.match.test(n)) || null;
}

/** Формата от името на добавката (ако слотът има форми). */
function formFor(slot, name) {
  return (slot?.forms || []).find(([re]) => re.test(String(name || ''))) || null;
}

/** Заявката към каталога за тази добавка. */
export function queryFor(name) {
  const slot = slotFor(name);
  if (!slot) return null;
  return formFor(slot, name)?.[1] || slot.q;
}

/** Линк към продукта с обозначение откъде идва посетителят. */
export function productUrl(groupId, from = 'nutriplan') {
  const p = new URLSearchParams({ group_id: String(groupId), utm_source: from, utm_medium: 'supplements', utm_campaign: 'plan' });
  return `${BIOCODE_SITE}/portfolio-product.html?${p}`;
}

/**
 * Кандидатите от каталога → до `limit` продукта за добавката.
 * @param {object} supplement — { name, dosage }
 * @param {object[]} items — от /portfolio/catalog
 * @param {{ vegan?: boolean, interactions?: object, from?: string, limit?: number }} ctx
 */
export function pickProducts(supplement, items, ctx = {}) {
  const slot = slotFor(supplement?.name);
  if (!slot) return [];
  const wantsVegan = !!(ctx.vegan || /водорасл|alga|vegan|веган/i.test(supplement.name));
  const form = formFor(slot, supplement.name);
  const scored = [];
  for (const it of items || []) {
    const name = String(it?.name || '');
    if (!it?.group_id || !name || it.available === false || it.margin_eligible === false) continue;
    if (!slot.must.test(name) || NOT_SUPPLEMENT.test(name)) continue;
    if (slot.avoid && slot.avoid.test(name)) continue;
    if (wantsVegan && slot.vegan && !slot.vegan.test(`${name} ${it.search_text || ''}`)) continue;
    // Името на продукта през таблицата за лекарства: K2 при варфарин и т.н.
    if (ctx.interactions && applySupplementInteractions([{ name }], ctx.interactions).dropped.length) continue;
    let score = 0;
    if (form && form[2].test(name)) score += 5;
    if (slot.prefer && slot.prefer.test(name)) score += 3;
    if (!COMBO.test(name) || slot.key === 'd3k2') score += 2;
    if (it.has_promo) score += 0.5;
    score += Math.min(1, (Number(it.rec) || 0) / 300);
    scored.push({ it, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.it.min_client_price || 0) - (b.it.min_client_price || 0));
  return scored.slice(0, ctx.limit || 2).map(({ it }) => ({
    group_id: String(it.group_id),
    name: it.name,
    brand: it.brand || '',
    image: typeof it.image === 'string' && /^https:\/\//.test(it.image) ? it.image : '',
    price: Number(it.min_client_price || it.min_price) || null,
    promo: !!it.has_promo,
    packs: Array.isArray(it.packs) ? it.packs.slice(0, 2) : [],
    url: productUrl(it.group_id, ctx.from),
  }));
}
