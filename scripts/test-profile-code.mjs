#!/usr/bin/env node
/** Код на профила — компилиране от реални отговори, кодиране и декодиране. */
import {
  compileProfile,
  encodeProfileCode,
  decodeProfileCode,
  libraryDietProfileOf,
  dietLabelOf,
  catalogDietFlagsOf,
  readDietLabels,
} from '../profile-code.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}`); }
}

// Отговорите са точно както ги праща questionnaire2.html.
const base = {
  name: 'Мария', gender: 'Жена', age: '35', height: '165', weight: '70',
  goal: 'Отслабване', lossKg: '6',
  sleepHours: '5–6', stressLevel: 'Високо', chronotype: 'Сутрешен',
  dailyActivityLevel: 'Средно', sportActivity: 'Средна (2–4 дни седмично)',
  drinksSweet: 'Рядко', drinksAlcohol: 'Рядко', overeatingFrequency: 'Понякога',
  foodCravings: ['Сладко'], foodTriggers: ['Нито едно'],
  eatingHabits: ['Не закусвам'], compensationMethods: ['Не'],
  dietPreference: ['Средиземноморска'], dietDislike: 'Няма', dietLove: 'Плодове',
  medicalConditions: ['Нямам'],
};

const p = compileProfile(base);
ok(p.sex === 'F' && p.age === 35 && p.heightCm === 165 && p.weightKg === 70, 'био данни');
ok(p.goal === 'LOSS' && p.targetWeightKg === 64 && p.pace === 2, 'цел отслабване, темпо 2 (6/70 кг)');
ok(p.sleepHours === 5.5, '„5–6“ часа сън → 5.5, не NaN');
ok(p.stress === 3, 'стрес Високо → 3');
ok(p.activity.daily === 2 && p.activity.sportBand === 2, 'активност A2S2');
ok(p.diet.style === 'mediterranean' && p.diet.pattern === 'omnivore', 'средиземноморска');
ok(p.skipsBreakfast && !p.slots.includes('Хранене 1') && p.slots.length === 4, 'без закуска → 4 слота');
ok(p.behaviors.includes('NBF') && p.behaviors.includes('SWT') && !p.behaviors.includes('EMO'), 'поведение NBF+SWT, без EMO');
ok(p.unmapped.length === 0, `няма непознати отговори (${p.unmapped.join(', ')})`);

// Грешките на стария парсър.
const lowCarb = compileProfile({ ...base, dietPreference: ['Нисковъглехидратна'] });
ok(lowCarb.diet.style === 'low_carb', 'Нисковъглехидратна → low_carb, не кето');
ok(libraryDietProfileOf(lowCarb) === 'low_carb', 'библиотека: low_carb');

const dislikeKeto = compileProfile({ ...base, dietDislike: 'не обичам кетогенни неща, риба' });
ok(dislikeKeto.diet.style === 'mediterranean', '„кето“ в нелюбими храни не прави диетата кето');
ok(dislikeKeto.exclusions.includes('FSH'), '„риба“ в нелюбими → изключване FSH');

const veganGf = compileProfile({ ...base, dietPreference: ['Веган', 'Без глутен'] });
ok(veganGf.diet.pattern === 'vegan' && veganGf.exclusions.includes('GLU'), 'веган + без глутен — и двете остават');
ok(dietLabelOf(veganGf) === 'Веган · Без глутен', `етикет: ${dietLabelOf(veganGf)}`);
const flags = catalogDietFlagsOf(veganGf);
ok(flags.vegan && flags.glutenFree && !flags.keto, 'флагове за каталога');
const back = readDietLabels([dietLabelOf(veganGf)]);
ok(back.patterns.includes('vegan') && back.exclusions.includes('GLU') && !back.unmapped.length, 'етикетът се чете обратно еднозначно');

const veganKeto = compileProfile({ ...base, dietPreference: ['Веган', 'Кето'] });
ok(veganKeto.diet.style === 'keto' && veganKeto.diet.pattern === 'vegan', 'веган кето = стил кето + модел веган');

// Клинични отговори, както ги мапва HEALTH_CONDITIONS_MAP.
const hashimoto = compileProfile({ ...base, medicalConditions: ['Хашимото'] });
ok(hashimoto.clinical.includes('HYPO'), 'Хашимото → HYPO');

const digestive = compileProfile({
  ...base,
  dietPreference: ['Нямам предпочитания'],
  medicalConditions: ['IBS', 'IBD', 'Рефлукс'],
  'medicalConditions_Храносмилателни_детайл': 'Гастроезофагеален рефлукс',
});
ok(digestive.clinical.includes('GERD') && !digestive.clinical.includes('GI') && !digestive.clinical.includes('IBS'),
  'групата храносмилателни + детайл рефлукс → само GERD');
ok(digestive.diet.style === 'balanced', 'рефлукс не налага Low-FODMAP');

const ibs = compileProfile({
  ...base, dietPreference: [], medicalConditions: ['IBS', 'IBD', 'Рефлукс'],
  'medicalConditions_Храносмилателни_детайл': 'Синдром на раздразненото черво',
});
ok(ibs.diet.style === 'low_fodmap', 'IBS без избран стил → Low-FODMAP');

const celiac = compileProfile({
  ...base, medicalConditions: ['Автоимунно'],
  'medicalConditions_Автоимунно': ['Целиакия (глутенова ентеропатия)'],
});
ok(celiac.clinical.includes('CEL') && celiac.exclusions.includes('GLU'), 'целиакия → CEL + без глутен');

const ir = compileProfile({ ...base, dietPreference: ['Балансирана'], medicalConditions: ['Инсулинова резистентност', 'Диабет'] });
ok(ir.diet.style === 'low_carb', 'инсулинова резистентност без избран стил → low_carb, не кето');

const htnPref = compileProfile({
  ...base, medicalConditions: ['Сърдечно-съдови'],
  'medicalConditions_Сърдечно-съдови_детайл': 'Хипертония (високо кръвно налягане)',
});
ok(htnPref.clinical.includes('HTN') && htnPref.diet.style === 'mediterranean', 'хипертония + избрана средиземноморска → изборът остава');

const allergy = compileProfile({
  ...base, medicalConditions: ['Алергии'],
  'medicalConditions_Алергии': 'непоносимост към лактоза, алергия към ядки',
  dietDislike: 'прясно мляко',
});
ok(allergy.exclusions.includes('LAC') && allergy.exclusions.includes('NUT'), 'алергии → LAC + NUT');
const milkOnly = compileProfile({ ...base, dietDislike: 'прясно мляко' });
ok(!milkOnly.exclusions.includes('LAC'), '„прясно мляко“ не прави клиента без млечни');

const override = compileProfile(base, { dietaryModifier: 'Кетогенна диета' });
ok(override.diet.style === 'keto', 'етикетът на стратегията/админа има предимство');

const unknown = compileProfile({ ...base, dietPreference: ['Друго'], dietPreference_other: 'Карнивор' });
ok(unknown.unmapped.includes('Карнивор') && unknown.diet.style === 'balanced',
  'непознат етикет не се отгатва, а се записва');

// Код: кодиране и обратно.
const energy = { kcal: 1640, protein: 118, carbs: 142, fats: 62 };
const code = encodeProfileCode(veganGf, energy);
console.log(`  код: ${code}`);
ok(code.startsWith('NP1.F35.165.70>64.LOSS2.A2S2.K1640P118C142F62.M4:2345.D:BAL/VGN.X:GLU+LAC+EGG'), 'формат на кода');
ok(code.length < 120, `кодът е кратък (${code.length} знака)`);
const decoded = decodeProfileCode(code);
ok(decoded.energy.kcal === 1640 && decoded.energy.fats === 62, 'енергията се декодира');
for (const key of ['sex', 'age', 'heightCm', 'goal', 'pace', 'mealsPerDay', 'skipsBreakfast', 'protocol']) {
  ok(decoded.profile[key] === veganGf[key], `декодиране: ${key}`);
}
ok(JSON.stringify(decoded.profile.diet) === JSON.stringify(veganGf.diet), 'декодиране: диета');
ok(JSON.stringify(decoded.profile.exclusions) === JSON.stringify(veganGf.exclusions), 'декодиране: изключвания');
ok(JSON.stringify(decoded.profile.behaviors) === JSON.stringify(veganGf.behaviors), 'декодиране: поведение');
ok(JSON.stringify(decoded.profile.slots) === JSON.stringify(veganGf.slots), 'декодиране: слотове');

const withProtocol = compileProfile({ ...base, clinicalProtocol: 'insulin_resistance', dietPreference: [] });
ok(withProtocol.diet.style === 'low_carb', 'протокол инсулинова резистентност → low_carb');
ok(decodeProfileCode(encodeProfileCode(withProtocol)).profile.protocol === 'insulin_resistance', 'протоколът се декодира');

ok(JSON.stringify(compileProfile(base)) === JSON.stringify(compileProfile(base)), 'детерминистичност');

console.log(`\n=== profile code: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
