/**
 * Микронутриентите на седмичното меню — само измерване, не цел на подбора.
 *
 * Менюто се сглобява по калории и макроси, както досега; тук се смята какво е
 * излязло (грамове × стойност на 100 г от USDA) и се сравнява с нуждата по
 * пол и възраст (NASEM DRI; омега-3 — EFSA). Разминаването става съвет —
 * храна-източник, позволена от диетата, или добавка — а не промяна на менюто.
 *
 * Шест показателя, за които храната е решаващият източник и дефицитите са
 * чести: желязо, калций, магнезий, калий, B12, омега-3 (EPA+DHA).
 * Усвояването: желязото от растения се усвоява по-слабо — при вегетарианци и
 * веган нуждата е ×1,8 (NASEM). Солта от готвенето не е в данните, затова
 * натрият не се оценява.
 */

const NUTRIENTS = ['fe', 'ca', 'mg', 'k', 'b12', 'o3'];
const LABEL = { fe: 'Желязо', ca: 'Калций', mg: 'Магнезий', k: 'Калий', b12: 'Витамин B12', o3: 'Омега-3 (EPA+DHA)' };
const UNIT = { fe: 'мг', ca: 'мг', mg: 'мг', k: 'мг', b12: 'µг', o3: 'мг' };

/**
 * Дневната нужда по пол, възраст, модел на хранене — и бременност/кърмене
 * (NASEM DRI: бременност желязо 27 мг, магнезий 350–360, калий 2900, B12 2,6;
 * кърмене желязо 9 мг — без менструация, калий 2800, B12 2,8; EFSA: +100–200 мг
 * DHA при двете → омега-3 450 мг).
 * @param {{ pregnant?: boolean, lactating?: boolean }} [ctx]
 */
export function microNeeds(profile, ctx = {}) {
  const age = Number(profile.age) || 40;
  const female = profile.sex === 'F';
  const plant = profile.diet?.pattern === 'vegetarian' || profile.diet?.pattern === 'vegan';
  const plantFe = plant ? 1.8 : 1;
  if (female && ctx.pregnant) {
    return { fe: 27 * plantFe, ca: 1000, mg: age < 31 ? 350 : 360, k: 2900, b12: 2.6, o3: 450 };
  }
  if (female && ctx.lactating) {
    return { fe: 9 * plantFe, ca: 1000, mg: age < 31 ? 310 : 320, k: 2800, b12: 2.8, o3: 450 };
  }
  const fe = (female && age < 51 ? 18 : 8) * plantFe;
  return {
    fe,
    ca: (female && age >= 51) || age >= 71 ? 1200 : 1000,
    mg: female ? (age < 31 ? 310 : 320) : (age < 31 ? 400 : 420),
    k: female ? 2600 : 3400,
    b12: 2.4,
    o3: 250,
  };
}

/** Храни-източници за съвета, по изключенията и модела на хранене. */
function sourcesFor(code, profile) {
  const ex = new Set(profile.exclusions || []);
  const pattern = profile.diet?.pattern || 'omnivore';
  const meat = pattern === 'omnivore';
  const fish = (pattern === 'omnivore' || pattern === 'pescatarian') && !ex.has('FSH');
  const dairy = pattern !== 'vegan' && !ex.has('LAC');
  // Кето и нисковъглехидратна: без бобови, картофи, зърнени и сладки плодове.
  const carbs = !['keto', 'low_carb'].includes(profile.diet?.style);
  const grains = carbs && !ex.has('GLU') && profile.diet?.style !== 'paleo';
  const legumes = carbs && profile.diet?.style !== 'paleo';
  const list = {
    fe: [meat && 'червено месо 2 пъти седмично', legumes && 'леща, нахут, боб', 'тиквени семки', 'спанак', 'чушка или цитрус към храненето (витамин C усилва усвояването)'],
    ca: [dairy && 'кисело мляко, сирене', !ex.has('SOY') && profile.diet?.style !== 'paleo' && 'тофу', 'тахан', 'листни зеленчуци', fish && 'сардини с костите'],
    mg: ['тиквени и слънчогледови семки', !ex.has('NUT') && 'бадеми, кашу', legumes && 'бобови', grains && 'пълнозърнести', 'спанак'],
    k: [legumes && 'бобови', carbs && 'картофи и сладки картофи', 'спанак', 'авокадо', carbs && 'банан', 'гъби'],
    b12: [meat && 'месо', fish && 'риба', dairy && 'кисело мляко, сирене', pattern !== 'vegan' && !ex.has('EGG') && 'яйца'],
    o3: [fish && 'сьомга, скумрия, сардини'],
  }[code].filter(Boolean);
  return list;
}

function advice(code, profile) {
  const pattern = profile.diet?.pattern;
  if (code === 'b12' && pattern === 'vegan') return 'При веган хранене B12 идва само от добавка или обогатени храни — препоръчва се добавка.';
  if (code === 'o3' && !sourcesFor('o3', profile).length) return 'Без риба EPA и DHA идват от добавка с водораслово масло; ленът и чията дават ALA, който тялото превръща в малка степен.';
  const src = sourcesFor(code, profile);
  return src.length ? `Източници: ${src.join(', ')}.` : '';
}

const fmt = (v) => String(v).replace('.', ',');

/**
 * @param {Array<{ meals: Array<{ foods: Array<{ id: string, grams: number }> }> }>} days
 * @param {(id: string) => any} microPer100
 * @param {object} profile
 * @param {{ pregnant?: boolean, lactating?: boolean, restrictK?: boolean }} [ctx]
 *   restrictK — бъбречна граница или висок калий в изследване: калият не се съветва нагоре
 * @returns {{ items: Array<{ code: string, label: string, value: number, target: number, pct: number, status: 'ok'|'borderline'|'low', text: string, advice: string }>, coverage: number }}
 */
export function microReport(days, microPer100, profile, ctx = {}) {
  const total = Object.fromEntries(NUTRIENTS.map(k => [k, 0]));
  let grams = 0;
  let known = 0;
  for (const day of days) {
    for (const meal of day.meals || []) {
      for (const { id, grams: g } of meal.foods || []) {
        grams += g;
        const m = microPer100(id);
        if (!m) continue;
        known += g;
        for (const k of NUTRIENTS) total[k] += (Number(m[k]) || 0) * g / 100;
      }
    }
  }
  const n = days.length || 1;
  const needs = microNeeds(profile, ctx);
  const items = NUTRIENTS.map((code) => {
    const value = total[code] / n;
    const target = needs[code];
    const pct = Math.round(value / target * 100);
    // При бъбречна граница или висок калий нуждата не е цел — калият не се съветва нагоре.
    if (code === 'k' && ctx.restrictK) {
      const shownK = Math.round(value);
      return {
        code, label: LABEL[code], value: shownK, target: null, pct: null, status: 'limited',
        text: `${LABEL[code]}: ~${fmt(shownK)} ${UNIT[code]} дневно.`,
        advice: 'Калият не се увеличава — по изследването (бъбречна функция или калий) количеството се определя от лекар.',
      };
    }
    const status = pct >= 90 ? 'ok' : pct >= 67 ? 'borderline' : 'low';
    const shown = code === 'b12' || code === 'fe' ? Math.round(value * 10) / 10 : Math.round(value);
    const shownTarget = code === 'fe' ? Math.round(target * 10) / 10 : target;
    return {
      code,
      label: LABEL[code],
      value: shown,
      target: shownTarget,
      pct,
      status,
      text: `${LABEL[code]}: ~${fmt(shown)} ${UNIT[code]} дневно (${pct}% от нуждата ${fmt(shownTarget)} ${UNIT[code]}).`,
      advice: status === 'ok' ? '' : advice(code, profile),
    };
  });
  return { items, coverage: grams ? Math.round(known / grams * 100) : 0 };
}
