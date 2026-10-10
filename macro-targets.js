/**
 * Дневни макро цели, изведени от кода на профила и диетата.
 *
 * Досега процентите се смятаха спрямо TDEE и после се прилагаха върху приема
 * с дефицит: протеинът на клиент на отслабване падаше под 1 г/кг, а
 * балансираната диета на човек без спорт излизаше с 49% мазнини. Ястията на
 * реалната диета не могат да изпълнят такава цел, затова дните излизаха с
 * 30–40% разминаване по макросите.
 *
 * Тук редът е: протеин в г/кг (котва), после стилът на диетата определя
 * въглехидратите или мазнините, останалото — третия макрос. Целта по
 * конструкция е такава, каквато ястията на тази диета могат да дадат.
 */

/** г/кг протеин по цел — върху референтното тегло. */
const PROTEIN_PER_KG_BY_GOAL = {
  LOSS: 1.6,
  VISC: 1.6,
  TONE: 1.6,
  CELL: 1.6,
  GAIN: 1.8,
};
const DEFAULT_PROTEIN_PER_KG = 1.3;
const MAX_PROTEIN_PER_KG = 2.2;

/** Дял на мазнините от калориите по стил (когато стилът не фиксира въглехидратите). */
const FAT_SHARE_BY_STYLE = {
  balanced: 0.30,
  mediterranean: 0.35,
  high_protein: 0.27,
  dash: 0.27,
  low_fodmap: 0.30,
  paleo: 0.35,
  anti_inflammatory: 0.33,
};

/** Нисковъглехидратна: ≤25% от калориите и ≤130 г/ден (клиничната граница). */
export const LOW_CARB_SHARE = 0.25;
export const LOW_CARB_MAX_G = 130;
/** Кето: ≤30 г/ден и ≤8% от калориите. */
export const KETO_MAX_CARB_G = 30;
export const KETO_CARB_SHARE = 0.08;

export const MIN_FAT_G_PER_KG = 0.7;

/**
 * Изместване на макросите от клиничните протоколи, в процентни пункта от
 * калориите: въглехидратите намаляват, протеинът расте, а мазнините поемат
 * разликата. Не се прилага при кето и нисковъглехидратна — там стилът вече
 * е намалил въглехидратите и намалението би се удвоило.
 */
export const PROTOCOL_MACRO_SHIFT = {
  insulin_resistance: { carbs: -10, protein: 5 },
  autoimmune_aip: { carbs: -5, protein: 5 },
  menopause_sarcopenia: { carbs: -5, protein: 10 },
  cellulite_reduction: { carbs: -10, protein: 10 },
  chronic_stress: { carbs: 0, protein: 5 },
  postpartum_lactation: { carbs: 0, protein: 5 },
  visceral_fat: { carbs: -10, protein: 5 },
  post_smoking: { carbs: -5, protein: 5 },
  longevity: { carbs: -10, protein: 0 },
  detox: { carbs: 0, protein: 5 },
};
/** Въглехидратите не падат под този дял заради протокол. */
const PROTOCOL_MIN_CARB_SHARE = 0.15;

/**
 * Теглото, върху което се смята протеинът. При наднормено тегло протеинът на
 * килограм реално тегло е прекален — ползва се коригирано тегло.
 */
export function referenceWeightKg(profile) {
  const w = Number(profile.weightKg) || 70;
  const h = Number(profile.heightCm) || 0;
  if (!h) return w;
  const m = h / 100;
  const bmi = w / (m * m);
  if (bmi <= 27) return w;
  const ideal = 23 * m * m;
  return Math.round((ideal + 0.25 * (w - ideal)) * 10) / 10;
}

export function proteinPerKg(profile) {
  let perKg = PROTEIN_PER_KG_BY_GOAL[profile.goal] ?? DEFAULT_PROTEIN_PER_KG;
  const band = profile.activity?.sportBand || 0;
  if (band >= 3) perKg += 0.3;
  else if (band >= 2) perKg += 0.2;
  const clinical = profile.clinical || [];
  if ((profile.age || 0) >= 60 || clinical.includes('MENO') || clinical.includes('OSTEO')) {
    perKg = Math.max(perKg, 1.4);
  }
  if (profile.protocol === 'menopause_sarcopenia') perKg += 0.2;
  if (profile.protocol === 'postpartum_lactation' || profile.goal === 'PP') perKg = Math.max(perKg, 1.5);
  if (profile.diet?.style === 'high_protein') perKg = Math.max(perKg, 2.0);
  return Math.min(MAX_PROTEIN_PER_KG, Math.round(perKg * 10) / 10);
}

/**
 * @param {ReturnType<import('./profile-code.js').compileProfile>} profile
 * @param {number} kcal дневен прием
 * @returns {{ protein: number, carbs: number, fats: number, ratios: { protein: number, carbs: number, fats: number }, proteinPerKg: number }}
 */
export function macroTargetsFor(profile, kcal) {
  const energy = Math.round(Number(kcal) || 0);
  const perKg = proteinPerKg(profile);
  if (energy <= 0) {
    return { protein: 0, carbs: 0, fats: 0, ratios: { protein: 0, carbs: 0, fats: 0 }, proteinPerKg: perKg };
  }
  const refKg = referenceWeightKg(profile);
  const style = profile.diet?.style || 'balanced';
  const maxProteinShare = style === 'high_protein' ? 0.40 : 0.35;

  let protein = Math.round(Math.min(refKg * perKg, energy * maxProteinShare / 4));
  // Минимумът мазнини е за хормонална функция — по реалното тегло, не по коригираното.
  const minFat = Math.round((Number(profile.weightKg) || refKg) * MIN_FAT_G_PER_KG);
  let carbs;
  let fats;

  if (style === 'keto' || style === 'low_carb') {
    carbs = style === 'keto'
      ? Math.min(KETO_MAX_CARB_G, Math.floor(energy * KETO_CARB_SHARE / 4))
      : Math.min(LOW_CARB_MAX_G, Math.round(energy * LOW_CARB_SHARE / 4));
    fats = Math.max(minFat, Math.round((energy - protein * 4 - carbs * 4) / 9));
  } else {
    fats = Math.max(minFat, Math.round(energy * (FAT_SHARE_BY_STYLE[style] ?? 0.30) / 9));
    carbs = Math.max(0, Math.round((energy - protein * 4 - fats * 9) / 4));
  }
  const shift = PROTOCOL_MACRO_SHIFT[profile.protocol];
  if (shift && style !== 'keto' && style !== 'low_carb') {
    const carbCut = Math.min(-(shift.carbs || 0), Math.max(0, carbs * 400 / energy - PROTOCOL_MIN_CARB_SHARE * 100));
    const proteinAdd = Math.min(shift.protein || 0, Math.max(0, maxProteinShare * 100 - protein * 400 / energy));
    carbs = Math.round(carbs - carbCut * energy / 400);
    protein = Math.round(protein + proteinAdd * energy / 400);
    fats = Math.max(minFat, Math.round(fats + (carbCut - proteinAdd) * energy / 900));
  }

  // Калориите на макросите трябва да са дневните калории — излишъкът или
  // недостигът отива в макроса, който стилът оставя свободен.
  const drift = energy - (protein * 4 + carbs * 4 + fats * 9);
  if (style === 'keto' || style === 'low_carb') fats = Math.max(minFat, fats + Math.round(drift / 9));
  else carbs = Math.max(0, carbs + Math.round(drift / 4));

  const pPct = Math.round(protein * 400 / energy);
  const fPct = Math.round(fats * 900 / energy);
  return {
    protein,
    carbs,
    fats,
    ratios: { protein: pPct, carbs: 100 - pPct - fPct, fats: fPct },
    proteinPerKg: perKg,
  };
}
