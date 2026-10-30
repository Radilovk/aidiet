/**
 * Сверка между модулите и NutriPlan.
 *
 * 1. Потвърждение. Ирисова находка (приоритетна система в AIRIS), която се
 *    подкрепя от независим източник в NutriPlan — въпросник, изследвания,
 *    устройства, EmoEat или изричен отговор на клиента — се приема за
 *    вероятна и влиза в адаптацията на плана с безопасна промяна в менюто.
 *    Промяната не се прилага, ако противоречи на медицинско правило
 *    (напр. повече обем при рефлукс). Калории, диагнози и лекарства не се
 *    извеждат от ириса.
 * 2. Разминаване. Когато два източника си противоречат (ирисът сочи
 *    храносмилането, а въпросникът казва „нямам оплаквания“; AIRIS има
 *    алергия, която NutriPlan не знае), се задава въпрос. Отговорът е факт
 *    („resolution“) и решава спора — до отговора нищо от спорното не се
 *    прилага.
 */

import { compileProfile, normLabel } from './profile-code.js';

/**
 * Системите на AIRIS → доказателства в NutriPlan и действие в менюто.
 * `codes` — клинични кодове; `text` — оплаквания в свободния текст;
 * `signals` — сигнали от устройствата; `action` — код за менюто (или null);
 * `guard` — клинични кодове, при които действието е противопоказано.
 */
export const IRIS_SYSTEMS = {
  digestive: {
    label: 'Храносмилане',
    codes: ['GI', 'IBS', 'IBD', 'GERD', 'SIBO', 'GAST', 'CEL'],
    text: /подув|газ(ове|ов)|тежест|киселин|запек|диари|рефлукс|колит|гастрит|храносмил/i,
    action: 'gentle_digestion',
    actionLabel: 'щадящо храносмилането меню',
    ask: 'AIRIS отбелязва храносмилането като приоритет, а във въпросника няма оплаквания. Имаш ли подуване, тежест, киселини или нередовно изхождане?',
  },
  metabolic: {
    label: 'Обмяна (захар и мазнини)',
    codes: ['IR', 'T2D', 'METS', 'DYSL', 'NAFLD'],
    text: /кръвна захар|инсулин|холестерол|триглицерид|коремн/i,
    signals: ['glucose_high', 'glucose_spikes'],
    action: 'more_volume',
    actionLabel: 'повече зеленчуци и фибри при същите калории',
    // Голям обем на хранене влошава рефлукса и гастрита — по код или по думите на клиента
    // (въпросникът събира „Рефлукс“ в общия код GI, затова и текстът).
    guard: ['GERD', 'GAST'],
    guardText: /рефлукс|киселин|гастрит|херни/i,
    ask: 'AIRIS отбелязва обмяната като приоритет, а във въпросника няма оплаквания. Имаш ли рязък глад или сънливост след хранене, или повишена захар или холестерол при изследване?',
  },
  nervous: {
    label: 'Нервна система (стрес и сън)',
    codes: ['DEP', 'ANX', 'SLP'],
    text: /стрес|тревожн|безсъни|напрежение|умора/i,
    signals: ['recovery_low', 'sleep_short'],
    behaviors: ['EMO'],
    action: null,
    ask: 'AIRIS отбелязва нервната система като приоритет, а във въпросника стресът е нисък. Чувстваш ли напрежение или изтощение през повечето дни?',
  },
  circulatory: { label: 'Кръвообращение', codes: ['HTN', 'CVD', 'DYSL'], signals: ['bp_high'], text: /кръвно|сърдеч/i, action: null },
  endocrine: { label: 'Ендокринна система', codes: ['HYPO', 'HYPER', 'ENDO', 'PCOS', 'HORM', 'ADR', 'MENO'], text: /щитовид|хормон|цикъл/i, action: null },
  detox: { label: 'Черен дроб и жлъчка', codes: ['NAFLD'], text: /черен дроб|жлъч/i, action: null },
  immune: { label: 'Имунитет и възпаление', codes: ['INFL', 'AI', 'ALG', 'SKIN'], text: /алерги|възпал|кож/i, action: null },
};

const YES = ['often', 'sometimes'];
const SYMPTOM_OPTIONS = [
  { value: 'often', label: 'Да, често' },
  { value: 'sometimes', label: 'Понякога' },
  { value: 'no', label: 'Не' },
];

const asList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;|\n]/)).map(s => String(s).trim()).filter(Boolean);
const said = (data, field, values) => asList(data?.[field]).some(x => values.includes(x));
const termKey = (t) => normLabel(t).replace(/[^a-zа-я0-9]+/gi, '_').slice(0, 40);

/**
 * Последният отговор на всеки въпрос.
 * @returns {Record<string, string>}
 */
export function resolutionsOf(facts) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of [...(facts || [])].filter(x => x.kind === 'resolution').sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    out[f.key] = f.value;
  }
  return out;
}

/**
 * @param {Record<string, any>} data — отговорите от въпросника (преди замените от обогатяването)
 * @param {{ hints?: any, essence?: any, iris?: any, irisRaw?: any, voice?: any, activity?: any }} derived
 * @param {Record<string, string>} resolutions
 */
export function crossCheck(data, derived, resolutions = {}) {
  const hypotheses = [];
  const questions = [];
  const overrides = {};
  const approach = [];
  const cautions = [];
  const { _enrichment, ...plain } = data || {};
  const profile = compileProfile(plain);
  const clinical = new Set([...(profile.clinical || []), ...(derived?.hints?.clinical || [])]);
  const behaviors = new Set([...(profile.behaviors || []), ...(derived?.hints?.behaviors || [])]);
  const signals = new Set((derived?.essence?.signals || []).map(s => s.code));
  const freeText = [data?.additionalNotes, data?.medicalConditions_other, data?.healthConditions_other, data?.dietDislike].filter(Boolean).join(' ');
  const noConditions = said(data, 'medicalConditions', ['Нямам', 'Няма']) || said(data, 'healthConditions', ['Нямам', 'Няма']);
  // Всичко, което клиентът е отметнал или написал за здравето си — за медицинските забрани.
  const conditionsText = [
    freeText,
    ...asList(data?.medicalConditions), ...asList(data?.healthConditions),
    ...Object.keys(data || {}).filter(k => /^medicalConditions_/.test(k)).flatMap(k => asList(data[k])),
  ].join(' ');

  // ── 1. Ирисови находки срещу данните на NutriPlan ─────────────────────
  const iris = derived?.irisRaw;
  for (const s of (iris?.systems || []).filter(x => x.priority)) {
    const def = IRIS_SYSTEMS[s.key];
    if (!def) continue;
    const evidence = [];
    for (const c of def.codes || []) if (clinical.has(c)) evidence.push(`състояние ${c}`);
    if (def.text && def.text.test(freeText)) evidence.push('оплаквания във въпросника');
    for (const sig of def.signals || []) if (signals.has(sig)) evidence.push(`устройство: ${sig}`);
    for (const b of def.behaviors || []) if (behaviors.has(b)) evidence.push('EmoEat / навици');
    if (s.key === 'nervous' && data?.stressLevel === 'Високо') evidence.push('висок стрес');
    const qid = `iris:${s.key}`;
    const answer = resolutions[qid];
    if (YES.includes(answer)) evidence.push('потвърдено от клиента');

    const denied = s.key === 'nervous' ? data?.stressLevel === 'Ниско' && !evidence.length : noConditions && !evidence.length;
    let status = evidence.length ? 'confirmed' : 'unconfirmed';
    if (answer === 'no') status = 'rejected';
    else if (!evidence.length && denied && def.ask) {
      status = 'disputed';
      questions.push({ id: qid, source: 'airis', topic: def.label, text: def.ask, options: SYMPTOM_OPTIONS });
    }
    const blockedBy = (def.guard || []).filter(c => clinical.has(c));
    if (def.guardText && def.guardText.test(conditionsText)) blockedBy.push('оплакване от рефлукс/гастрит');
    const applied = status === 'confirmed' && !!def.action && !blockedBy.length;
    if (applied) approach.push(def.action);
    hypotheses.push({
      system: s.key, label: def.label, status, evidence: [...new Set(evidence)],
      action: def.action ? def.actionLabel : null, applied,
      blockedBy: status === 'confirmed' && blockedBy.length ? blockedBy : [],
    });
  }

  // ── 2. Отговорите в AIRIS срещу отговорите в NutriPlan ────────────────
  const q = derived?.irisRaw?.questionnaire;
  if (q) {
    const known = normLabel([data?.dietDislike, data?.['medicalConditions_Алергии'], data?.foodSensitivities].flat().filter(Boolean).join(' '));
    for (const term of asList([q.foodIntolerances, q.allergies].filter(Boolean).join(','))) {
      const t = term.slice(0, 40);
      if (normLabel(t).length < 3 || known.includes(normLabel(t))) continue;
      const id = `allergy:${termKey(t)}`;
      const answer = resolutions[id];
      if (answer === 'yes') overrides.dietDislike = [overrides.dietDislike || data?.dietDislike, t].filter(Boolean).join(', ');
      else if (!answer) {
        questions.push({ id, source: 'airis', topic: 'Непоносимост', text: `В AIRIS е посочена непоносимост или алергия към „${t}“, а в NutriPlan я няма. Да я изключим ли от плана?`, options: [{ value: 'yes', label: 'Да, изключи я' }, { value: 'no', label: 'Не е актуално' }] });
      }
    }
    if (q.medications && data?.medications !== 'Да') {
      // Отговорът важи само докато в NutriPlan е същото („Не“ или празно) — ако клиентът
      // после смени профила си, въпросът се задава наново, вместо старият отговор да надделее.
      const medsId = `meds:${data?.medications === 'Не' ? 'no' : 'empty'}`;
      const answer = resolutions[medsId];
      if (answer === 'yes') {
        overrides.medications = 'Да';
        overrides.medicationsDetails = [data?.medicationsDetails, q.medications].filter(Boolean).join('; ');
      } else if (!answer) {
        questions.push({ id: medsId, source: 'airis', topic: 'Лекарства', text: `В AIRIS са посочени „${q.medications.slice(0, 120)}“, а в NutriPlan — че не приемаш лекарства. Приемаш ли ги в момента?`, options: [{ value: 'yes', label: 'Да, приемам ги' }, { value: 'no', label: 'Не, вече не' }] });
      }
    }
    const npDiet = asList(data?.dietPreference);
    for (const [airisLabel, npLabel] of [['Веган', 'Веган'], ['Вегетариански', 'Вегетарианска']]) {
      if (!(q.dietaryProfile || []).includes(airisLabel) || npDiet.includes(npLabel)) continue;
      const id = `pattern:${npLabel}`;
      const answer = resolutions[id];
      if (answer === 'yes') overrides.dietPreference = [...new Set([...npDiet, npLabel])];
      else if (!answer) {
        questions.push({ id, source: 'airis', topic: 'Режим на хранене', text: `В AIRIS е посочен ${npLabel.toLowerCase()} режим, а в NutriPlan — не. Да го приложим ли в плана?`, options: [{ value: 'yes', label: 'Да' }, { value: 'no', label: 'Не' }] });
      }
      break;
    }
    const npKg = Number(String(data?.weight || '').replace(',', '.'));
    if (q.weight && npKg && Math.abs(q.weight - npKg) >= 4) {
      // Вързано за теглото в NutriPlan: ново тегло там → нов въпрос, не старият отговор.
      const weightId = `weight:${Math.round(npKg)}`;
      const answer = resolutions[weightId];
      if (answer === 'airis') overrides.weight = String(q.weight);
      else if (!answer) {
        questions.push({ id: weightId, source: 'airis', topic: 'Тегло', text: `Теглото в AIRIS (${q.weight} кг) и в NutriPlan (${npKg} кг) се различава. Кое е актуалното?`, options: [{ value: 'airis', label: `${q.weight} кг` }, { value: 'nutriplan', label: `${npKg} кг` }] });
      }
    }
  }

  // ── 3. EmoEat срещу въпросника ───────────────────────────────────────
  const v = derived?.voice;
  const strong = v && v.reliable !== false && (v.intensity === 'Силно' || v.intensity === 'Осезаемо');
  const rarely = ['Рядко', 'Никога'].includes(data?.overeatingFrequency) && (!asList(data?.foodTriggers).length || said(data, 'foodTriggers', ['Нито едно']));
  if (strong && rarely && !resolutions.emoeat_vs_q) {
    questions.push({ id: 'emoeat_vs_q', source: 'emoeat', topic: 'Емоционално хранене', text: 'EmoEat показва, че храната често идва в отговор на емоции, а във въпросника е отбелязано, че рядко ядеш повече от планираното. Кое е по-близо до теб?', options: [{ value: 'often', label: 'Често ям при напрежение, умора или скука' }, { value: 'rare', label: 'Рядко — не се разпознавам' }] });
  }

  // ── 4. Крачките: телефонът срещу гривната/часовника ─────────────────
  // Постоянно разминаване в едни и същи дни — клиентът казва кое носи по-постоянно.
  // До отговора се ползва устройството (enrichment.js → stepsActivity).
  const act = derived?.activity;
  if (act?.disputed && !resolutions.steps_source) {
    const more = act.ratio > 1 ? 'гривната/часовникът' : 'телефонът';
    questions.push({ id: 'steps_source', source: 'device', topic: 'Крачки', text: `Телефонът и гривната/часовникът отчитат различни крачки в едни и същи дни — ${more} показва около ${Math.round(((act.ratio > 1 ? act.ratio : 1 / act.ratio) - 1) * 100)}% повече. Кое носите по-постоянно през деня?`, options: [{ value: 'device', label: 'Гривната/часовника' }, { value: 'phone', label: 'Телефона (в джоба)' }] });
  }

  const confirmed = hypotheses.filter(h => h.status === 'confirmed');
  if (confirmed.some(h => h.blockedBy.length)) {
    cautions.push(`Потвърдено от AIRIS и NutriPlan, но не е приложено заради медицинско правило: ${confirmed.filter(h => h.blockedBy.length).map(h => `${h.label} (${h.blockedBy.join(', ')})`).join('; ')}.`);
  }
  return { hypotheses, questions: questions.slice(0, 6), overrides, approach: [...new Set(approach)], cautions };
}

/** Кратък текст за картона и чата. */
export function crossCheckText(cc) {
  if (!cc) return '';
  const parts = [];
  const by = (st) => cc.hypotheses.filter(h => h.status === st);
  if (by('confirmed').length) parts.push(`потвърдено от AIRIS и NutriPlan: ${by('confirmed').map(h => `${h.label} (${h.evidence.join(', ')})${h.applied ? ` → ${h.action}` : ''}`).join('; ')}`);
  if (by('rejected').length) parts.push(`отхвърлено от клиента: ${by('rejected').map(h => h.label).join(', ')}`);
  if (by('unconfirmed').length) parts.push(`само по ириса (без потвърждение): ${by('unconfirmed').map(h => h.label).join(', ')}`);
  if (cc.questions.length) parts.push(`неуточнени разминавания (може да попиташ клиента): ${cc.questions.map(q => q.topic).join(', ')}`);
  return parts.join(' | ');
}
