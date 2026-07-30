/**
 * Българска терминология за упражнения и корекция на чести AI преводи.
 * canonicalName (EN) → естествен български фитнес жаргон.
 */
import { EQUIP_NORM_LABELS, equipmentGroupLabelForNorm } from './equipment-groups.js';
import { exerciseNameLookupKey, neutralExerciseName } from './exercise-name-bg.js';

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Глобални корекции в AI/интерфейс текстове (без \\b — кирилицата не е word-boundary в JS) */
const BG_TEXT_FIXES = /** @type {[RegExp, string][]} */ ([
  [/затежняване/gi, 'утежняване'],
  [/затежняваш/gi, 'утежняваш'],
  [/затежнява/gi, 'утежнява'],
  [/затежниш/gi, 'утежниш'],
  [/затежни/gi, 'утежни'],
  [/сплит/gi, 'разпределение'],
  [/\bsplit\b/gi, 'разпределение'],
  [/бърпита/gi, 'бърпи'],
  [/бърпитата/gi, 'бърпи'],
  [/кранчове/gi, 'коремни преси'],
  [/\bclass crunches\b/gi, 'класически коремни преси'],
]);

const EQUIP_BG = {
  ...EQUIP_NORM_LABELS,
};

const TARGET_BG = {
  pectorals: 'гърди',
  lats: 'широк гръбен',
  traps: 'трапец',
  delts: 'рамене',
  shoulders: 'рамене',
  biceps: 'бицепс',
  triceps: 'трицепс',
  forearms: 'предмишници',
  abdominals: 'корем',
  abs: 'корем',
  glutes: 'седалищни',
  quads: 'предно бедро',
  hamstrings: 'задно бедро',
  calves: 'прасци',
  adductors: 'привеждащи',
  abductors: 'отвеждащи',
  'upper back': 'горен гръб',
  'lower back': 'долен гръб',
  chest: 'гърди',
  back: 'гръб',
  cardio: 'кардио',
  spine: 'гръбнак',
  neck: 'врат',
  'cardiovascular system': 'кардио',
  'levator scapulae': 'повдигач на лопатката',
  'serratus anterior': 'преден трицепс (serratus)',
};

function equipPhrase(hint) {
  const key = norm(hint);
  const label = EQUIP_BG[key];
  if (label) return `с ${label}`;
  return key ? `(${hint})` : '';
}

/** Кратък BG етикет за оборудване (lightbox/meta). */
export function localizeEquipment(equipment) {
  const key = norm(equipment);
  return EQUIP_BG[key] || equipmentGroupLabelForNorm(key) || equipment || '';
}

/** Кратък BG етикет за целева мускулна група. */
export function localizeTarget(target) {
  const key = norm(target);
  return TARGET_BG[key] || target || '';
}

/** Точни съвпадения по нормализирано EN име */
const EXACT_BG = {
  'barbell bench press': 'Избутване с щанга от лежанка',
  'dumbbell bench press': 'Избутване с дъмбели от лежанка',
  'bench press': 'Избутване от лежанка',
  'incline barbell bench press': 'Наклонено избутване с щанга',
  'incline dumbbell bench press': 'Наклонено избутване с дъмбели',
  'decline barbell bench press': 'Обратно наклонено избутване с щанга',
  'smith machine bench press': 'Избутване на Смит машина',
  'floor press': 'Избутване от пода',
  'dumbbell floor press': 'Избутване с дъмбели от пода',
  'leg press': 'Преса за крака',
  'sled 45 leg press': 'Преса за крака под 45°',
  'barbell full squat': 'Клек с щанга',
  'barbell squat': 'Клек с щанга',
  'goblet squat': 'Клек с пудовка',
  'barbell deadlift': 'Мъртва тяга с щанга',
  'romanian deadlift': 'Румънска мъртва тяга',
  'dumbbell romanian deadlift': 'Румънска мъртва тяга с дъмбели',
  'barbell romanian deadlift': 'Румънска мъртва тяга с щанга',
  'lat pulldown': 'Дърпане отгоре надолу',
  'cable lat pulldown': 'Дърпане отгоре надолу на кабел',
  'pull up': 'Набирания',
  'chin up': 'Набирания с обратен хват',
  'barbell row': 'Гребане с щанга',
  'dumbbell row': 'Гребане с дъмбел',
  'cable row': 'Гребане на кабел',
  'seated cable row': 'Гребане на кабел седнал',
  'barbell overhead press': 'Раменно избутване с щанга',
  'dumbbell shoulder press': 'Раменно избутване с дъмбели',
  'military press': 'Военна преса',
  'lateral raise': 'Странично повдигане',
  'dumbbell lateral raise': 'Странично повдигане с дъмбели',
  'front raise': 'Предно повдигане',
  'face pull': 'Дърпане към лицето',
  'triceps pushdown': 'Избутване за трицепс на кабел',
  'barbell curl': 'Сгъване за бицепс с щанга',
  'dumbbell curl': 'Сгъване за бицепс с дъмбели',
  'hammer curl': 'Чук сгъване',
  'skull crusher': 'Френска преса за трицепс',
  'hip thrust': 'Хип тръст',
  'barbell hip thrust': 'Хип тръст с щанга',
  'plank': 'Планк',
  'calf raise': 'Повдигане на прасци',
  'standing calf raise': 'Повдигане на прасци прав',
  'leg curl': 'Сгъване за задно бедро',
  'lying leg curl': 'Сгъване за задно бедро лежайки',
  'leg extension': 'Разгъване за предно бедро',
  'lunge': 'Изпад',
  'walking lunge': 'Изпади в ход',
  'dumbbell lunge': 'Изпад с дъмбели',
  'dip': 'Кофички',
  'chest dip': 'Кофички за гърди',
  'triceps dip': 'Кофички за трицепс',
  'push-up': 'Лицева опора',
  'push up': 'Лицева опора',
  'push-up (wall)': 'Лицева опора на стена',
  'push-up (wall) v. 2': 'Лицева опора на стена',
  'kneeling push-up': 'Лицева опора на колене',
  'incline push-up': 'Наклонена лицева опора',
  'decline push-up': 'Лицева опора с повдигнати крака',
  'diamond push-up': 'Лицева опора с ромб',
  'chest tap push-up': 'Лицева опора с потупване на гърди',
  'clock push-up': 'Лицева опора „стрелник“',
  'glute bridge': 'Мостик за седалищни',
  'glute bridge march': 'Мостик за седалищни с марш',
  'glute bridge two legs on bench': 'Мостик за седалищни с крака на пейка',
  'hamstring stretch': 'Разтягане на задно бедро',
  'seated calf stretch': 'Разтягане на прасец седнал',
  'forward lunge': 'Изпад напред',
  'bodyweight squat': 'Клек със собствено тегло',
  'chair squat': 'Клек на стол',
  'iron cross stretch': 'Разтягане „железен кръст“',
  'butterfly yoga pose': 'Поза пеперуда',
  'child pose': 'Детска поза',
  'cat cow': 'Поза котка-крава',
  'dead bug': 'Мъртва буболечка',
  'bird dog': 'Поза куче-птица',
  'fire hydrant': 'Пожарен хидрант',
  'clamshell': 'Черупка',
};

function fromPatterns(c) {
  if (!c) return '';

  if (/\bleg press\b/.test(c)) {
    if (/\bsled\b/.test(c) || /\b45\b/.test(c)) return 'Преса за крака под 45°';
    return 'Преса за крака';
  }

  if (/\bbench press\b/.test(c) || (/\bpress\b/.test(c) && /\bchest\b/.test(c))) {
    if (/\bfloor\b/.test(c)) {
      if (/\bdumbbell\b/.test(c)) return 'Избутване с дъмбели от пода';
      return 'Избутване от пода';
    }
    if (/\bincline\b/.test(c)) {
      if (/\bdumbbell\b/.test(c)) return 'Наклонено избутване с дъмбели';
      return 'Наклонено избутване с щанга';
    }
    if (/\bdecline\b/.test(c)) return 'Обратно наклонено избутване с щанга';
    if (/\bsmith\b/.test(c)) return 'Избутване на Смит машина';
    if (/\bdumbbell\b/.test(c)) return 'Избутване с дъмбели от лежанка';
    if (/\bbarbell\b/.test(c)) return 'Избутване с щанга от лежанка';
    return 'Избутване от лежанка';
  }

  if (/\boverhead press\b/.test(c) || /\bmilitary press\b/.test(c) || (/\bpress\b/.test(c) && /\bshoulder\b/.test(c))) {
    if (/\bdumbbell\b/.test(c)) return 'Раменно избутване с дъмбели';
    if (/\bbarbell\b/.test(c)) return 'Раменно избутване с щанга';
    return 'Раменно избутване';
  }

  if (/\bromanian deadlift\b/.test(c) || /\brdl\b/.test(c)) {
    if (/\bdumbbell\b/.test(c)) return 'Румънска мъртва тяга с дъмбели';
    return 'Румънска мъртва тяга';
  }
  if (/\bdeadlift\b/.test(c)) {
    if (/\bstiff\b/.test(c)) return 'Мъртва тяга с изпънати крака';
    if (/\bsumo\b/.test(c)) return 'Сумо мъртва тяга';
    if (/\bdumbbell\b/.test(c)) return 'Мъртва тяга с дъмбели';
    return 'Мъртва тяга';
  }

  if (/\bsquat\b/.test(c)) {
    if (/\bgoblet\b/.test(c)) return 'Клек с пудовка';
    if (/\bfront\b/.test(c)) return 'Преден клек';
    if (/\bbarbell\b/.test(c)) return 'Клек с щанга';
    if (/\bdumbbell\b/.test(c)) return 'Клек с дъмбели';
    return 'Клек';
  }

  if (/\blat pulldown\b/.test(c) || (/\bpulldown\b/.test(c) && /\blat\b/.test(c))) return 'Дърпане отгоре надолу';
  if (/\bpull up\b/.test(c) || /\bpullup\b/.test(c)) return 'Набирания';
  if (/\bchin up\b/.test(c) || /\bchinup\b/.test(c)) return 'Набирания с обратен хват';
  if (/\brow\b/.test(c)) {
    if (/\bcable\b/.test(c)) return 'Гребане на кабел';
    if (/\bdumbbell\b/.test(c)) return 'Гребане с дъмбел';
    if (/\bbarbell\b/.test(c)) return 'Гребане с щанга';
    return 'Гребане';
  }
  if (/\blateral raise\b/.test(c)) return 'Странично повдигане';
  if (/\bfront raise\b/.test(c)) return 'Предно повдигане';
  if (/\bface pull\b/.test(c)) return 'Дърпане към лицето';
  if (/\bleg curl\b/.test(c)) return 'Сгъване за задно бедро';
  if (/\bleg extension\b/.test(c)) return 'Разгъване за предно бедро';
  if (/\bcurl\b/.test(c)) {
    if (/\bhammer\b/.test(c)) return 'Чук сгъване';
    if (/\bdumbbell\b/.test(c)) return 'Сгъване за бицепс с дъмбели';
    return 'Сгъване за бицепс';
  }
  if (/\bpushdown\b/.test(c) || (/\bextension\b/.test(c) && /\btriceps\b/.test(c))) return 'Избутване за трицепс на кабел';
  if (/\bhip thrust\b/.test(c)) return 'Хип тръст';
  if (/\blunge\b/.test(c)) return /\bwalking\b/.test(c) ? 'Изпади в ход' : 'Изпад';
  if (/\bdip\b/.test(c)) return 'Кофички';
  if (/\bplank\b/.test(c)) return 'Планк';
  if (/\bcalf raise\b/.test(c)) return 'Повдигане на прасци';
  if (/\bfly\b/.test(c)) return /\bcable\b/.test(c) ? 'Разтваряне на кабел' : 'Разтваряне';
  if (/\bcrunch\b/.test(c)) return 'Коремни преси';
  if (/\bshrug\b/.test(c)) return 'Повдигане на рамене';

  if (/\bpush[- ]?up\b/.test(c)) {
    if (/\bwall\b/.test(c)) return 'Лицева опора на стена';
    if (/\bkneeling\b/.test(c)) return 'Лицева опора на колене';
    if (/\bincline\b/.test(c)) return 'Наклонена лицева опора';
    if (/\bdecline\b/.test(c)) return 'Лицева опора с повдигнати крака';
    if (/\bdiamond\b/.test(c)) return 'Лицева опора с ромб';
    if (/\bchest tap\b/.test(c)) return 'Лицева опора с потупване на гърди';
    if (/\bclock\b/.test(c)) return 'Лицева опора „стрелник“';
    if (/\breverse grip\b/.test(c)) return 'Лицева опора с обратен хват';
    if (/\bon box\b/.test(c)) return 'Наклонена лицева опора на степ';
    return 'Лицева опора';
  }

  if (/\bsit[- ]?up\b/.test(c)) return /\bhalf\b/.test(c) ? 'Коремни преси наполовина' : 'Коремни преси';
  if (/\bglute bridge\b/.test(c)) {
    if (/\bon bench\b/.test(c) || /\btwo legs on bench\b/.test(c)) return 'Мостик за седалищни с крака на пейка';
    if (/\bmarch\b/.test(c)) return 'Мостик за седалищни с марш';
    return 'Мостик за седалищни';
  }
  if (/\bstretch\b/.test(c)) {
    if (/\bhamstring\b/.test(c)) return 'Разтягане на задно бедро';
    if (/\bcalf\b/.test(c)) return 'Разтягане на прасец';
    if (/\bchest\b/.test(c) || /\bpec\b/.test(c)) return 'Разтягане на гърди';
    if (/\blat\b/.test(c)) return 'Разтягане на гръб';
    if (/\bhip\b/.test(c)) return 'Разтягане на хълбок';
    if (/\bglute\b/.test(c)) return 'Разтягане на седалищни';
    if (/\bshoulder\b/.test(c)) return 'Разтягане на рамене';
    if (/\bquad\b/.test(c)) return 'Разтягане на предно бедро';
    return 'Разтягане';
  }
  if (/\bsquat\b/.test(c) && !/\bstretch\b/.test(c)) {
    if (/\bchair\b/.test(c)) return 'Клек на стол';
    if (/\bwall\b/.test(c)) return 'Клек на стена';
    if (/\bjump\b/.test(c) || /\bsemi\b/.test(c)) return 'Клек със скок';
    return 'Клек';
  }
  if (/\bwall sit\b/.test(c)) return 'Седене на стена';
  if (/\btoe touch\b/.test(c)) return 'Докосване на пръсти';
  if (/\bhip adduction\b/.test(c)) return 'Привеждане на хълбок';
  if (/\bhip abduction\b/.test(c)) return 'Отвеждане на хълбок';
  if (/\btwist\b/.test(c)) return 'Завъртане на тялото';
  if (/\bjack\b/.test(c) && /\bjump\b/.test(c)) return 'Скок „джак“';
  if (/\bmountain climber\b/.test(c)) return 'Катерене на планина';
  if (/\bdead bug\b/.test(c)) return 'Мъртва буболечка';
  if (/\bbird dog\b/.test(c)) return 'Поза куче-птица';
  if (/\bfire hydrant\b/.test(c)) return 'Пожарен хидрант';
  if (/\bclamshell\b/.test(c)) return 'Черупка';
  if (/\bbutterfly\b/.test(c)) return 'Поза пеперуда';
  if (/\bchild pose\b/.test(c)) return 'Детска поза';
  if (/\bcat cow\b/.test(c)) return 'Поза котка-крава';
  if (/\bcobra\b/.test(c)) return 'Поза кобра';
  if (/\bsphinx\b/.test(c)) return 'Поза сфинкс';

  return '';
}

/** Коригира типични грешни AI български имена според canonical EN */
function fixBadAiName(ai, canonical) {
  let t = String(ai || '').trim();
  if (!t) return t;

  const c = norm(canonical);
  const looksLikeLegPress = /\bлег\s*преса\b/i.test(t) || /\bпреса\s*за\s*крака\b/i.test(t);
  const isBenchFamily = /\bbench press\b/.test(c) && !/\bleg press\b/.test(c);
  const isLegPress = /\bleg press\b/.test(c);

  if (isBenchFamily && looksLikeLegPress) {
    return fromPatterns(c) || 'Избутване от лежанка';
  }
  if (isBenchFamily && /\bот пода\b/i.test(t) && !/\bfloor\b/.test(c)) {
    return fromPatterns(c) || 'Избутване от лежанка';
  }
  if (isLegPress && !looksLikeLegPress && /\bизбутване\b/i.test(t)) {
    return 'Преса за крака';
  }

  return t;
}

export function sanitizeBgText(text) {
  let t = String(text ?? '');
  for (const [re, rep] of BG_TEXT_FIXES) t = t.replace(re, rep);
  return t;
}

/**
 * Връща естествено българско име за упражнение.
 * @param {string} canonicalName - EN каталожно име
 * @param {string} [aiDisplayName] - какво е върнал AI (fallback)
 * @param {string} [equipmentHint]
 */
export function localizeExerciseDisplayName(canonicalName, aiDisplayName = '', equipmentHint = '') {
  const neutral = neutralExerciseName(canonicalName);
  const c = exerciseNameLookupKey(canonicalName);
  if (EXACT_BG[c]) return EXACT_BG[c];

  const patterned = fromPatterns(c);
  if (patterned) return patterned;

  const fixedAi = fixBadAiName(aiDisplayName, neutral || canonicalName);
  if (fixedAi && fixedAi !== aiDisplayName) return sanitizeBgText(fixedAi);

  if (fixedAi && !/[a-z]{4,}/i.test(fixedAi)) return sanitizeBgText(fixedAi);

  const retryPattern = fromPatterns(exerciseNameLookupKey(fixedAi || neutral));
  if (retryPattern) return retryPattern;

  return sanitizeBgText(fixedAi || 'Упражнение');
}

export function sanitizePlanBulgarian(plan) {
  if (!plan || typeof plan !== 'object') return plan;

  plan.title = sanitizeBgText(plan.title);
  plan.summary = sanitizeBgText(plan.summary);
  plan.weeklySplit = sanitizeBgText(plan.weeklySplit);
  if (Array.isArray(plan.safetyNotes)) {
    plan.safetyNotes = plan.safetyNotes.map(sanitizeBgText);
  }
  if (plan.guidelines && typeof plan.guidelines === 'object') {
    for (const key of Object.keys(plan.guidelines)) {
      plan.guidelines[key] = sanitizeBgText(plan.guidelines[key]);
    }
  }
  for (const day of plan.days || []) {
    day.day = sanitizeBgText(day.day);
    day.focus = sanitizeBgText(day.focus);
    if (Array.isArray(day.warmup)) day.warmup = day.warmup.map(sanitizeBgText);
    if (Array.isArray(day.cooldown)) day.cooldown = day.cooldown.map(sanitizeBgText);
    for (const ex of day.exercises || []) {
      ex.displayName = localizeExerciseDisplayName(ex.canonicalName, ex.displayName, ex.equipmentHint);
      ex.notes = sanitizeBgText(ex.notes);
    }
  }
  return plan;
}
