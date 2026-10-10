/**
 * Защо храненето е полезно — от реалните му съставки, не от модел.
 * Две кратки изречения по приоритет: белтък, омега-3, бобови, пълнозърнести,
 * зеленчуци, калций.
 */

import { food } from './knowledge.js';

function present(built) {
  const out = [];
  for (const p of built.parts) {
    p.foods.forEach((id, i) => {
      if (p.grams[i] > 0) out.push({ id, grams: p.grams[i], f: food(id) });
    });
  }
  return out;
}

const join = labels => (labels.length > 1 ? `${labels.slice(0, -1).join(', ')} и ${labels[labels.length - 1]}` : labels[0]);

/** @param {{ parts: Array<{ foods: string[], grams: number[] }>, totals: { protein: number } }} built */
export function mealBenefits(built) {
  const items = present(built);
  const facts = [];
  const protein = Math.round(built.totals.protein);
  if (protein >= 25) facts.push(`${protein} г белтък — дълга ситост и запазване на мускулите.`);
  const oily = items.filter(x => x.f.flags.has('oily_fish')).map(x => x.f.label);
  if (oily.length) facts.push(`Омега-3 мастни киселини от ${join(oily)}.`);
  const legumes = items.filter(x => x.f.group === 'LEG' || x.f.id === 'leg_peas').map(x => x.f.label);
  if (legumes.length) facts.push(`Растителен белтък и фибри от ${join(legumes)} — бавно покачване на кръвната захар.`);
  const whole = items.filter(x => x.f.group === 'STA' && x.f.flags.has('whole_grain')).map(x => x.f.label);
  if (whole.length) facts.push(`Бавни въглехидрати и фибри от ${join(whole)}.`);
  const veg = items.filter(x => x.f.group === 'VEG').reduce((a, x) => a + x.grams, 0);
  if (veg >= 200) facts.push(`${veg} г зеленчуци — обем, фибри и витамини при малко калории.`);
  const calcium = items.filter(x => x.f.kind === 'dairy' || x.f.group === 'MLK').map(x => x.f.label);
  if (calcium.length) facts.push(`Калций от ${join([...new Set(calcium)])}.`);
  const unsat = items.filter(x => x.f.flags.has('nut') || x.f.flags.has('seed') || x.f.id === 'fat_avocado' || x.f.id === 'fat_olives').map(x => x.f.label);
  if (unsat.length) facts.push(`Ненаситени мазнини от ${join([...new Set(unsat)])}.`);
  return facts.slice(0, 2).join(' ');
}
