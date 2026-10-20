#!/usr/bin/env node
/**
 * Добавка → продукт от BIOCODE (supplement-products.js): вещество и форма,
 * без комбинации, напитки и противопоказани при лекарства. Без мрежа —
 * кандидатите са във формата на /portfolio/catalog.
 */
import { pickProducts, slotFor, queryFor, productUrl } from '../supplement-products.js';
import { interactionsFor } from '../drug-interactions.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${msg}`); }
}

let n = 0;
const item = (name, extra = {}) => ({ group_id: String(++n), name, brand: 'Brand', available: true, margin_eligible: true, min_client_price: 9.5, image: 'https://img.example/x.jpg', packs: ['60 капсули'], rec: 10, ...extra });
const names = (list) => list.map(p => p.name);

const d3 = [item('Vitamin D3 1000 + K2 75 mcg'), item('Vitamin D-3 / 1000 IU'), item('Multivitamin Daily'), item('Vitamin D3 4000', { available: false })];
ok(names(pickProducts({ name: 'Витамин D3' }, d3)).join() === 'Vitamin D-3 / 1000 IU', `D3 без K2, мултивитамини и неналични (${names(pickProducts({ name: 'Витамин D3' }, d3))})`);
const d3k2 = [item('Vitamin D3 1000 IU + K2 50 mcg'), item('Vitamin D-3 1000 IU & МK-7 45 mcg'), item('Vitamin D3 2000')];
ok(pickProducts({ name: 'Витамин D3 + K2' }, d3k2)[0].name.includes('K2'), 'D3 + K2 → комбинацията');
const warf = interactionsFor({ medicationsDetails: 'Синтром' });
ok(pickProducts({ name: 'Витамин D3 + K2' }, d3k2, { interactions: warf }).every(p => !/k2|mk-?7|мk-?7/i.test(p.name)), 'варфарин → без K2 и MK-7');

const mg = [item('Alkaline System | with Sodium & Magnesium'), item('Magnesium Bisglycinate 125 mg'), item('Magnesium Citrate 200mg'), item('Ca/Zn/MG | Calcium Magnesium Zinc')];
ok(pickProducts({ name: 'Магнезиев цитрат' }, mg)[0].name === 'Magnesium Citrate 200mg', 'магнезиев цитрат → цитрат първо');
ok(pickProducts({ name: 'Магнезиев бисглицинат' }, mg)[0].name === 'Magnesium Bisglycinate 125 mg', 'бисглицинат → бисглицинат първо');
ok(!names(pickProducts({ name: 'Магнезий' }, mg)).some(x => /Alkaline|Calcium/.test(x)), 'без алкални смеси и калций/цинк');
ok(queryFor('Магнезиев L-треонат') === 'magnesium threonate' && queryFor('Колаген тип II') === 'collagen type ii', 'заявка по форма');

const om = [item('Omega 3 Ultra'), item('Omega-3 Vegan | 250 mg DHA'), item('Omega 3-6-9')];
ok(names(pickProducts({ name: 'Омега-3 от водорасли (DHA/EPA)' }, om)).join() === 'Omega-3 Vegan | 250 mg DHA', 'от водорасли → само веган');
ok(names(pickProducts({ name: 'Омега-3' }, om, { vegan: true })).join() === 'Omega-3 Vegan | 250 mg DHA', 'веган клиент → само веган омега');
ok(!names(pickProducts({ name: 'Омега-3' }, om)).includes('Omega 3-6-9'), 'без 3-6-9');

const col = [item('Sparkling Protein Water | 10g Hydrolysed Collagen Peptides'), item('Collagen Peptides'), item('Joint Support | Collagen with Glucosamine')];
ok(names(pickProducts({ name: 'Колагенови пептиди (тип I и III)' }, col)).join() === 'Collagen Peptides', 'без напитки и смеси с глюкозамин');
ok(pickProducts({ name: 'NAC (N-Ацетил Цистеин)' }, [item('Echinacea 250mg.')]).length === 0, 'NAC ≠ Echinacea (без сигурно съвпадение — без продукт)');
ok(slotFor('Спермидин') === null && pickProducts({ name: 'Спермидин' }, [item('Spermidine')]).length === 0, 'непознато вещество → без продукт');

const p = pickProducts({ name: 'Берберин' }, [item('Berberine 500 mg', { image: 'http://insecure/x.jpg' })], { from: 'airis' })[0];
ok(p.url.startsWith('https://biocode-bg.com/portfolio-product.html?group_id=') && /utm_source=airis/.test(p.url) && p.image === '', 'линк с произход; само https снимки');
ok(productUrl('42') === 'https://biocode-bg.com/portfolio-product.html?group_id=42&utm_source=nutriplan&utm_medium=supplements&utm_campaign=plan', 'формат на линка');
ok(pickProducts({ name: 'Берберин' }, [item('Berberine', { margin_eligible: false })]).length === 0, 'продукт извън каталога за клиенти → не се показва');

console.log(`\n=== supplement products: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
