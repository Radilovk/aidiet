/**
 * Добавки по профила — правила в код, не в AI.
 *
 * Всяка добавка носи конкретна причина от данните на клиента (изследване,
 * протокол, състояние, цел и тренировки, сън и стрес, модел на хранене,
 * лекарство, сезон). Без причина добавка няма. Редът е по сила на
 * основанието: изследване → протокол → лекарство → състояние → модел на
 * хранене → начин на живот → сезон; влизат първите 5 различни вещества.
 *
 * Дозите са обичайните поддържащи за възрастни; лечебните дози се определят
 * от лекар по изследване. Противопоказаните от лекарствата отпадат после,
 * в plan-summary.js (drug-interactions.js).
 */

import { interactionsFor } from './drug-interactions.js';

const MAX_SUPPLEMENTS = 5;

/** Едно вещество веднъж: „витамин d3“ ≠ „витамин b12“, „омега-3“ = „омега-3 (epa/dha)“. */
export function supplementKey(name) {
  return String(name).toLowerCase().replace(/[()+,/]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
}

const OMEGA3 = { name: 'Омега-3 (EPA/DHA)', dosage: '1000–2000 mg EPA+DHA', timing: 'с хранене' };
const OMEGA3_ALGAE = { name: 'Омега-3 от водорасли (DHA/EPA)', dosage: '250–500 mg', timing: 'с хранене' };
const MAGNESIUM = { name: 'Магнезий бисглицинат', dosage: '200–400 mg', timing: 'вечер' };
const D3 = { name: 'Витамин D3', dosage: '1000–2000 IU', timing: 'с мазна храна' };
const B12 = { name: 'Витамин B12', dosage: '250–500 mcg', timing: 'сутрин' };

/**
 * Правилата по профила (без изследванията и протокола — те идват отвън).
 * @param {ReturnType<typeof import('./profile-code.js').compileProfile>} profile
 * @param {Record<string, any>} userData
 * @param {Date} now
 * @returns {{ name: string, dosage: string, timing: string, reason: string }[]}
 */
function profileRules(profile, userData, now) {
  const out = [];
  const add = (s, reason) => out.push({ ...s, reason });
  const c = new Set(profile.clinical || []);
  const pattern = profile.diet?.pattern;
  const style = profile.diet?.style;
  const ex = new Set(profile.exclusions || []);
  const age = profile.age || 0;
  const vegan = pattern === 'vegan';
  const omega = vegan ? OMEGA3_ALGAE : OMEGA3;

  // Лекарства: известно изчерпване от дългосрочния прием.
  if (interactionsFor(userData || {}).ids.includes('metformin')) {
    add({ ...B12, dosage: '500 mcg' }, 'метформин намалява усвояването на B12 при дългосрочен прием');
  }

  // Състояния.
  if (c.has('PCOS')) add({ name: 'Мио-инозитол', dosage: '2000–4000 mg', timing: 'сутрин' }, 'поликистозни яйчници: подкрепя инсулиновата чувствителност и цикъла');
  if (c.has('IR') || c.has('T2D') || c.has('METS')) add({ ...MAGNESIUM, name: 'Магнезий (цитрат/бисглицинат)' }, 'инсулинова резистентност: магнезият участва в усвояването на глюкозата, дефицитът му е чест');
  if (c.has('DYSL') || c.has('CVD')) add(omega, 'повишени триглицериди/сърдечно-съдов риск: EPA/DHA понижават триглицеридите');
  if (c.has('HTN')) add({ ...MAGNESIUM, name: 'Магнезий (цитрат/бисглицинат)' }, 'високо кръвно: магнезият подкрепя съдовия тонус');
  if (c.has('NAFLD')) add(omega, 'мастен черен дроб: омега-3 намалява чернодробните мазнини');
  if (c.has('JOINT') || c.has('INFL') || c.has('AI') || c.has('SKIN')) add(omega, 'възпаление/стави/кожа: омега-3 има противовъзпалително действие');
  if (c.has('OSTEO') || c.has('MENO')) add({ name: 'Витамин D3 + K2', dosage: '1000–2000 IU / 75–100 mcg', timing: 'с мазна храна' }, c.has('OSTEO') ? 'костна плътност: D3 за усвояване на калция, K2 за отлагането му в костите' : 'менопауза: по-бърза загуба на костна маса');
  if ((c.has('OSTEO') || c.has('MENO')) && ex.has('LAC')) add({ name: 'Калций цитрат', dosage: '500 mg', timing: 'вечер, отделно от желязо' }, 'без млечни храни приемът на калций от менюто е нисък');
  if (c.has('IBS')) add({ name: 'Псилиум (ленена/живовлекова фибра)', dosage: '5–10 g', timing: 'с голяма чаша вода, постепенно' }, 'раздразнено черво: разтворимата фибра регулира изхождането');
  else if (c.has('GI') || c.has('GAST')) add({ name: 'Пробиотик (Lactobacillus/Bifidobacterium)', dosage: '10 млрд. CFU', timing: 'с храна' }, 'храносмилателни оплаквания: подкрепа на чревната флора');
  if (c.has('ANEM')) add({ name: 'Желязо бисглицинат', dosage: '25 mg', timing: 'през ден, с витамин C, далеч от кафе, чай и калций — след изследване на феритин' }, 'анемия по въпросника: желязото се приема при потвърден дефицит');
  if (c.has('COG')) add(omega, 'памет и концентрация: DHA е градивен материал за мозъка');

  // Сън, стрес, психика.
  const poorSleep = c.has('SLP') || profile.sleepInterrupted || (profile.sleepHours && profile.sleepHours < 6);
  if (c.has('ANX') || c.has('DEP') || profile.stress === 3 || poorSleep) {
    add(MAGNESIUM, [poorSleep ? 'лош или кратък сън' : '', profile.stress === 3 || c.has('ANX') ? 'висок стрес/тревожност' : '', c.has('DEP') ? 'понижено настроение' : '']
      .filter(Boolean).join(', ') + ': магнезият бисглицинат успокоява нервната система и подобрява съня');
  }
  if (c.has('DEP')) add(omega, 'понижено настроение: EPA подкрепя настроението');

  // Модел на хранене.
  if (vegan || pattern === 'vegetarian') add(B12, `${vegan ? 'веганско' : 'вегетарианско'} хранене: B12 се набавя почти само от животински храни`);
  if (vegan) add(OMEGA3_ALGAE, 'веганско хранене: без риба няма готови EPA/DHA');
  else if (ex.has('FSH')) add(OMEGA3, 'без риба в менюто: EPA/DHA не се набавят от храната');
  if (style === 'keto') add({ name: 'Магнезий + електролити', dosage: '200–400 mg магнезий', timing: 'вечер' }, 'кетогенно хранене: повишена загуба на магнезий, натрий и калий');

  // Цел и тренировки.
  const sportDays = profile.activity?.sportDays || 0;
  if (['GAIN', 'TONE'].includes(profile.goal) && sportDays >= 2) {
    add({ name: 'Креатин монохидрат', dosage: '3–5 g', timing: 'всеки ден, по всяко време' }, `цел „${profile.goal === 'GAIN' ? 'мускулна маса' : 'стягане'}“ с ${sportDays} тренировки седмично: креатинът е с най-добре доказан ефект върху силата и мускулите`);
  }

  // Възраст.
  if (age >= 60) add(B12, 'над 60 г.: усвояването на B12 от храната намалява');
  if (age >= 55) add(D3, 'над 55 г.: кожата синтезира по-малко витамин D');

  // Сезон: само ако няма нищо друго — D3 октомври–март.
  const month = (now || new Date()).getMonth();
  if (!out.length && (month >= 9 || month <= 2)) add({ ...D3, timing: 'с мазна храна, октомври–март' }, 'октомври–март слънцето не стига за витамин D; изследване уточнява дозата');
  return out;
}

/**
 * @param {ReturnType<typeof import('./profile-code.js').compileProfile>} profile
 * @param {Record<string, any>} userData
 * @param {{ labs?: object[], protocol?: object[], protocolName?: string, now?: Date }} [sources]
 */
export function supplementsFor(profile, userData = {}, { labs = [], protocol = [], protocolName = '', now = null } = {}) {
  const out = [];
  const keys = new Set();
  const add = (s) => {
    if (!s?.name) return;
    const key = supplementKey(s.name);
    if ([...keys].some(k => k.startsWith(key) || key.startsWith(k))) return;
    keys.add(key);
    out.push({ name: s.name, dosage: s.dosage || '', timing: s.timing || '', reason: s.reason || '' });
  };
  for (const s of labs || []) add(s);
  for (const s of protocol || []) add({ ...s, reason: s.reason || (protocolName ? `протокол „${protocolName}“` : 'клиничен протокол') });
  for (const s of profileRules(profile, userData, now || new Date())) add(s);
  return out.slice(0, MAX_SUPPLEMENTS);
}
