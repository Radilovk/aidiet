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
  'lunge': 'Напад',
  'walking lunge': 'Напади в ход',
  'dumbbell lunge': 'Напад с дъмбели',
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
  'forward lunge': 'Напад напред',
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
  if (/\blunge\b/.test(c)) return /\bwalking\b/.test(c) ? 'Напади в ход' : 'Напад';
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

// ---------------------------------------------------------------------------
// Съставно BG име за запис от каталога: база + уред + позиция + хват + вариант.
// localizeExerciseDisplayName дава само базата („Сгъване за бицепс“) и слива десетки
// различни упражнения в едно име; тук разликите се пазят.
// ---------------------------------------------------------------------------

/** Ред = ред в името. [EN регулярен израз, BG модификатор, група] — от група се взима първото съвпадение. */
/** @type {[RegExp, string, string][]} */
const NAME_MODIFIERS = [
  [/\btrap bar\b/, 'с трап лост', 'eq'], [/\bez (?:bar|barbell)\b/, 'с EZ лост', 'eq'], [/\bsmith\b/, 'на Смит машина', 'eq'],
  [/\bbarbell\b/, 'с щанга', 'eq'], [/\bdumbbells?\b/, 'с дъмбели', 'eq'], [/\bkettlebells?\b/, 'с пудовка', 'eq'],
  [/\bcable\b/, 'на скрипец', 'eq'], [/\b(?:resistance )?band\b/, 'с ластик', 'eq'], [/\bsled\b/, 'на преса', 'eq'],
  [/\blever\b|\bmachine\b/, 'на машина', 'eq'], [/\bweighted\b/, 'с тежест', 'eq'], [/\bmedicine ball\b/, 'с медицинска топка', 'eq2'],
  [/\b(?:stability|exercise|swiss) ball\b/, 'на фитбол', 'eq2'], [/\bbosu\b/, 'на BOSU', 'eq2'], [/\bsuspended\b|\btrx\b/, 'на TRX', 'eq2'],
  [/\b(?:wheel )?roller\b/, 'с ролер', 'eq2'], [/\bassisted\b/, 'с асистенция', 'eq3'], [/\brope\b/, 'с въже', 'eq3'],
  [/\bv bar\b/, 'с V-дръжка', 'eq3'], [/\btowel\b/, 'с кърпа', 'eq3'],
  [/\bside lying\b/, 'легнал на една страна', 'pos'], [/\bseated\b|\bsitted\b|\bsitting\b/, 'седнал', 'pos'],
  [/\bstanding\b/, 'прав', 'pos'], [/\bkneeling\b|\bon knees\b/, 'на колене', 'pos'], [/\bprone\b/, 'легнал по корем', 'pos'],
  [/\bsupine\b|\blying\b/, 'легнал', 'pos'], [/\bbent over\b/, 'в наклон', 'pos'],
  [/\bincline\b/, 'на наклонена пейка', 'bench'], [/\bdecline\b/, 'на обратен наклон', 'bench'],
  [/\bon (?:a )?bench\b|\bbench supported\b/, 'на пейка', 'bench'], [/\bfloor\b/, 'на пода', 'bench'], [/\bwall\b/, 'на стена', 'bench'],
  [/\bclose grip\b|\bnarrow\b/, 'тесен хват', 'grip'], [/\bwide(?: grip)?\b/, 'широк хват', 'grip'],
  [/\breverse grip\b|\bunderhand\b|\bsupinated\b/, 'обратен хват', 'grip'], [/\bneutral\b|\bparallel grip\b|\bhammer grip\b|\bpalms? in\b/, 'неутрален хват', 'grip'],
  [/\bmixed grip\b/, 'смесен хват', 'grip'], [/\boverhand\b|\bpronated\b/, 'прав хват', 'grip'],
  [/\b(?:one|single) (?:arm|hand)\b/, 'с една ръка', 'side'], [/\b(?:one|single) leg(?:ged)?\b/, 'на един крак', 'side'],
  [/\balternat\w*\b/, 'редуващо', 'side'], [/\btwo arm\b|\bdouble\b/, 'с две ръце', 'side'],
  [/\bsumo\b/, 'сумо', 'x1'], [/\bbehind (?:the )?(?:neck|head)\b/, 'зад врата', 'x2'], [/\boverhead\b|\babove head\b/, 'над глава', 'x3'],
  [/\btwist\w*\b|\brotation\w*\b/, 'с ротация', 'x4'], [/\bjump\w*\b/, 'със скок', 'x5'], [/\bpause\b/, 'с пауза', 'x6'],
  [/\bstraight arms?\b/, 'с прави ръце', 'x7'], [/\bstiff leg\b|\bstraight legs?\b/, 'с изпънати крака', 'x8'], [/\bbent knees?\b/, 'със свити колене', 'x8'],
  [/\bdeficit\b/, 'от дефицит', 'x9'], [/\bhigh\b/, 'висок', 'x10'], [/\blow\b/, 'нисък', 'x10'], [/\bfront\b/, 'преден', 'x11'],
  [/\brear\b|\bback\b/, 'заден', 'x11'], [/\blateral\b|\bside\b/, 'страничен', 'x11'], [/\bcross\w*\b/, 'кръстосано', 'x12'],
  [/\bpartial\b|\bhalf\b|\bquarter\b|3 4/, 'частична амплитуда', 'x13'], [/\bfull range\b|\bfull\b/, 'пълна амплитуда', 'x13'],
  [/\bexplosive\b|\bspeed\b|\bpower\b/, 'взривно', 'x14'], [/\bisometric\b|\bhold\b/, 'задържане', 'x15'],
  [/\bhanging\b/, 'висящ', 'x17'], [/\boblique\b/, 'косо', 'x18'], [/\bdeep\b/, 'дълбоко', 'x19'], [/\bdrop\b/, 'с падане', 'x19'],
  [/\binner\b/, 'вътрешна част', 'x20'], [/\bouter\b/, 'външна част', 'x20'], [/\bstraight bar\b/, 'на прав лост', 'x21'],
  [/\bplyo\w*\b/, 'плиометрично', 'x5'], [/\bstork\b|\bbalance\b/, 'на един крак за баланс', 'x22'],
  [/\bspider\b/, 'паяк', 'x16'], [/\bpreacher\b|\bscott\b/, 'на Скот пейка', 'x16'], [/\bconcentration\b/, 'концентрирано', 'x16'],
  [/\bzercher\b/, 'Зерчер', 'x16'], [/\bpendlay\b/, 'Пендлей', 'x16'], [/\barnold\b/, 'Арнолд', 'x16'], [/\bgoblet\b/, 'гоблет', 'x16'],
  [/\bbulgarian\b/, 'български', 'x16'], [/\bwalking\b/, 'в ход', 'x16'], [/\bcurtsey\b|\bcurtsy\b/, 'реверанс', 'x16'],
  [/\bdiamond\b/, 'диамант', 'x16'], [/\barcher\b/, 'стрелец', 'x16'], [/\bclap\w*\b/, 'с пляскане', 'x16'], [/\bpike\b/, 'пайк', 'x16'],
  [/\bhack\b/, 'хакен', 'x16'], [/\bdrag\b/, 'дърпане по тялото', 'x16'], [/\bupright\b/, 'изправено', 'x16'], [/\bguillotine\b/, 'гилотина', 'x16'],
];

/** Специфични бази с предимство пред речника (там биха се сляли с по-общо движение). */
/** @type {[RegExp, string][]} */
const PRIORITY_BASES = [
  [/\bstretch\w*\b/, 'Разтягане'], [/\bcossack\b/, 'Казашки клек'],
  [/^quads$/, 'Клек със собствено тегло'], [/\bhalf knee bends\b/, 'Полуклек'], [/\bjack jump\b/, 'Джъмпинг джак'],
  [/\bwrist curl\b|\bwrist roll\w*\b/, 'Сгъване на китки'], [/\breverse curl\b/, 'Обратно сгъване за предмишници'],
  [/\bfinger curls?\b/, 'Сгъване на пръстите'], [/\bhandstand push/, 'Лицева опора в стойка на ръце'], [/\bhandstand\b/, 'Стойка на ръце'],
  [/\bmuscle ?up\b/, 'Мускул ъп'], [/\bdips?\b/, 'Кофички'], [/\bchin\b(?! up)|\bchin ups?\b/, 'Набиране с обратен хват'],
  [/\bcurl\b.*\b(squat|lunge)\b|\b(squat|lunge)\b.*\bcurl\b/, 'Комбинация клек/напад + сгъване'],
  [/\bcalf\b/, 'Повдигане на прасци'], [/\bplanche\b/, 'Планш'], [/\blever\b.*\b(front|back)\b|\b(front|back) lever\b/, 'Лост (гимнастика)'],
  [/\bsissy squat\b/, 'Сиси клек'], [/\bpistol\b/, 'Пистолет клек'], [/\bhack squat\b/, 'Хакен клек'],
  [/\bface pull\b/, 'Дърпане към лицето'], [/\bupright row\b/, 'Вертикално гребане'], [/\bleg press\b/, 'Преса за крака'],
  [/\bglute ham\b|\bnordic\b|\binverse leg curl\b/, 'Нордическо сгъване'], [/\bfarmers? walk\b/, 'Фермерска разходка'],
  [/\bmonster walk\b/, 'Странично ходене с ластик'], [/\bstepmill\b/, 'Стълбищен тренажор'], [/\bstationary bike\b/, 'Велоергометър'],
  [/\belliptical\b|\bcross trainer\b/, 'Елипсовиден тренажор'], [/\btreadmill\b/, 'Бягаща пътека'],
];

/** Основи, когато речникът върне общото „Упражнение“ (EN ключова дума → BG). */
/** @type {[RegExp, string][]} */
const NAME_BASES = [
  [/\bstretch\b/, 'Разтягане'], [/\bcrunch\w*\b/, 'Коремна преса'], [/\bsit up\b/, 'Коремно повдигане'], [/\bv up\b/, 'V-повдигане'],
  [/\bleg raise\b|\bleg lift\b|\bknee raise\b|\bhip raise\b/, 'Повдигане на крака'], [/\brussian twist\b/, 'Руско завъртане'],
  [/\bside bend\b/, 'Странично навеждане'], [/\bplank\b/, 'Планк'], [/\bbridge\b/, 'Мост'], [/\bhip thrust\b/, 'Хип тръст'],
  [/\bkickback\b|\bkick back\b/, 'Разгъване назад'], [/\bextension\b/, 'Разгъване'], [/\bpushdown\b|\bpush down\b/, 'Разгъване надолу'],
  [/\bfly\b|\bflye\w*\b|\bcrossover\w*\b/, 'Разтваряне'], [/\bpullover\b|\bpull over\b/, 'Пуловър'], [/\bshrug\w*\b/, 'Свиване на рамене'],
  [/\braise\b/, 'Повдигане'], [/\bpress\b/, 'Избутване'], [/\bpulldown\b|\bpull down\b/, 'Дърпане отгоре'], [/\bpull\w*\b/, 'Дърпане'],
  [/\bcurl\b/, 'Сгъване'], [/\bstep ?up\b/, 'Качване на степ'], [/\bswing\b/, 'Суинг'], [/\bclean\b/, 'Обръщане'], [/\bsnatch\b/, 'Изхвърляне'],
  [/\bthruster\b/, 'Тръстер'], [/\bjerk\b/, 'Изтласкване'], [/\bgood morning\b/, 'Добро утро'], [/\bhyperextension\b/, 'Хиперекстензия'],
  [/\bburpee\b/, 'Бърпи'], [/\bclimber\b/, 'Планинар'], [/\bjack\w*\b/, 'Джъмпинг джак'], [/\bjump\w*\b|\bhop\w*\b/, 'Скок'],
  [/\brun\b|\bjog\b|\bsprint\b/, 'Бягане'], [/\bwalk\w*\b|\bmarch\w*\b/, 'Ходене'], [/\bbike\b|\bcycle\b/, 'Колоездене'],
  [/\brow\w*\b/, 'Гребане'], [/\btwist\w*\b|\brotation\b/, 'Завъртане на торса'], [/\bcircles?\b/, 'Кръгови движения'],
  [/\bcrawl\b/, 'Пълзене'], [/\brollout\b|\brollerout\b/, 'Разгъване с ролер'], [/\bdead bug\b/, 'Мъртва буболечка'],
];

/**
 * Съставно BG име: „<база> — <модификатори>“. Детерминистично: едно и също EN име → едно и също BG.
 * @param {string} name EN име от dataset-а
 * @param {string} [equipment]
 * @param {string} [target]
 */
export function composeExerciseNameBg(name, equipment = '', target = '') {
  const neutral = neutralExerciseName(name);
  const n = norm(neutral);
  if (CURATED_NAMES_BG[n]) return CURATED_NAMES_BG[n];
  const priority = PRIORITY_BASES.find(([re]) => re.test(n));
  let base = priority ? priority[1] : localizeExerciseDisplayName(name, '', equipment);
  if (!base || base === 'Упражнение') {
    const hit = NAME_BASES.find(([re]) => re.test(n));
    const tgt = target ? localizeTarget(target) : '';
    base = hit ? hit[1] : (tgt ? `Упражнение за ${tgt}` : 'Упражнение');
  }
  const baseLow = base.toLowerCase().replace(/кабел/g, 'кабел скрипец');
  const already = (bg) => {
    const stem = bg.toLowerCase().replace(/^(с|на|в|от|със) /, '').slice(0, 5);
    return baseLow.includes(stem);
  };
  const usedGroups = new Set();
  const mods = [];
  for (const [re, bg, group] of NAME_MODIFIERS) {
    if (usedGroups.has(group) || !re.test(n)) continue;
    usedGroups.add(group);
    if (!already(bg)) mods.push(bg);
  }
  const version = String(name).match(/\bv\.?\s*(\d+)\b/i);
  if (version) mods.push(`вариант ${version[1]}`);
  return mods.length ? `${base} — ${mods.join(', ')}` : base;
}

/** Ръчни BG имена за базата workout-guide (там, където съставното име е неточно или се слива). */
export const CURATED_NAMES_BG = {
  'push up': 'Лицева опора', 'front raise': 'Предно повдигане', 'reverse pec deck': 'Обратен пек-дек (заден делт)',
  'face pull': 'Дърпане към лицето', 'romanian deadlift': 'Румънска мъртва тяга с щанга', 't bar row': 'Гребане на Т-лост',
  'chest supported row': 'Гребане с опора на гърдите', 'lat pulldown': 'Дърпане на скрипец отгоре', 'pull up': 'Набирания',
  squat: 'Клек с щанга', 'front squat': 'Преден клек с щанга', 'hip thrust': 'Хип тръст с щанга', 'glute bridge': 'Мост за седалище',
  dip: 'Кофички на успоредка', plank: 'Планк', 'hanging leg raise': 'Повдигане на крака от вис', running: 'Бягане',
  walking: 'Бързо ходене', cycling: 'Колоездене', rowing: 'Гребен ергометър', 'landmine press': 'Избутване с лендмайн',
  'chest dip': 'Кофички за гърди', 'push press': 'Тласкане с щанга (пуш прес)', 'plate front raise': 'Предно повдигане с диск',
  'inverted row': 'Обърнато гребане', 'meadows row': 'Гребане на Медоус', 'back extension': 'Гръбна екстензия',
  'goblet squat': 'Гоблет клек', 'smith machine squat': 'Клек на Смит машина', 'belt squat': 'Клек с колан',
  'split squat': 'Сплит клек', 'smith machine split squat': 'Сплит клек на Смит машина', 'heel elevated goblet squat': 'Гоблет клек с повдигнати пети',
  'front foot elevated split squat': 'Сплит клек с повдигнат преден крак', 'landmine squat': 'Клек с лендмайн',
  'landmine romanian deadlift': 'Румънска мъртва тяга с лендмайн', 'glute focused back extension': 'Гръбна екстензия с акцент седалище',
  'donkey calf raise': 'Магарешко повдигане на прасци', 'leg press calf raise': 'Повдигане на прасци на преса',
  'two dumbbell skullcrusher': 'Френско разгъване с два дъмбела', 'single dumbbell skullcrusher': 'Френско разгъване с един дъмбел',
  'bench dip': 'Кофички на пейка', 'tricep kickback': 'Разгъване назад за трицепс', 'farmer carry': 'Фермерска разходка',
  crunch: 'Коремна преса', 'reverse crunch': 'Обратна коремна преса', 'bicycle crunch': 'Колело (коремна преса)',
  'dead bug': 'Мъртва буболечка', 'pallof press': 'Палоф преса', 'hanging knee raise': 'Повдигане на колене от вис',
  swimming: 'Плуване', skierg: 'Ски ергометър', hiking: 'Туристически преход', 'battle ropes': 'Бойни въжета',
  'knee push up': 'Лицева опора от колене', 'pike push up': 'Пайк лицева опора', 'feet elevated pike push up': 'Пайк лицева опора с повдигнати крака',
  'typewriter push up': 'Лицева опора „пишеща машина“', 'hindu push up': 'Индийска лицева опора', 'scapular push up': 'Лопаткова лицева опора',
  'push up shoulder tap': 'Лицева опора с докосване на рамо', 'chair dip': 'Кофички на стол', 'doorway row': 'Гребане на рамка на врата',
  'prone y raise': 'Y-повдигане по корем', 'prone t raise': 'T-повдигане по корем', superman: 'Супермен', 'dead hang': 'Вис на лост',
  'active hang': 'Активен вис', 'scapular pull up': 'Лопаткови набирания', 'negative pull up': 'Негативни набирания',
  'commando pull up': 'Командос набирания', 'l sit pull up': 'Набирания в L-позиция', 'shrimp squat': 'Скарида клек',
  'skater squat': 'Кънкьорски клек', 'step down': 'Слизане от степ', 'calf raise': 'Повдигане на прасци',
  'frog pump': 'Жабешки мост', 'donkey kick': 'Магарешки ритник', 'fire hydrant': 'Пожарен кран', clamshell: 'Мида',
  'hip airplane': 'Самолет за таза', 'banded glute bridge': 'Мост за седалище с ластик', 'banded hip thrust': 'Хип тръст с ластик',
  'banded frog pump': 'Жабешки мост с ластик', 'banded clamshell': 'Мида с ластик', 'banded squat': 'Клек с ластик',
  'banded donkey kick': 'Магарешки ритник с ластик', 'banded fire hydrant': 'Пожарен кран с ластик', 'banded kickback': 'Ритник назад с ластик',
  'banded face pull': 'Дърпане към лицето с ластик', 'banded row': 'Гребане с ластик', 'banded lat pulldown': 'Дърпане отгоре с ластик',
  'banded pallof press': 'Палоф преса с ластик', 'banded woodchop': 'Дърводелец с ластик', 'banded dead bug': 'Мъртва буболечка с ластик',
  'hollow body hold': 'Холоу задържане', 'hollow rock': 'Холоу люлеене', 'flutter kick': 'Ножички', 'heel tap': 'Докосване на пети',
  'plank shoulder tap': 'Планк с докосване на рамо', 'plank jack': 'Планк джак', 'bear plank': 'Мечешки планк', 'crab walk': 'Раково ходене',
  inchworm: 'Гъсеница', 'l sit hold': 'L-задържане', 'copenhagen plank': 'Копенхагенски планк', 'dragon flag': 'Драконово знаме',
  'squat thrust': 'Клек с изпъване (скуат тръст)', sprawl: 'Спрол', 'cat cow stretch': 'Котка–крава', 'world s greatest stretch': 'Най-доброто разтягане',
  'leg swings': 'Махове с крак', 'doorway chest stretch': 'Разтягане на гърди на врата', 'child s pose': 'Поза на детето',
  'hamstring stretch': 'Разтягане на задно бедро', 'butterfly stretch': 'Пеперуда (разтягане)', 'side plank hip dip': 'Страничен планк с повдигане на таза',
  'assault bike': 'Въздушен велоергометър (assault bike)',
  'pec deck': 'Пек-дек (разтваряне на машина)', 'cable woodchop': 'Дърводелец на скрипец', 'cable pallof hold': 'Палоф задържане на скрипец',
  'superman hold': 'Супермен задържане', 'reverse snow angel': 'Обратен снежен ангел', 'seated knee tuck': 'Придърпване на колене седнал',
  'high knees': 'Високи колене', 'lateral shuffle': 'Странични стъпки', 'fast feet': 'Бързи крака', 'seated forward fold': 'Предно навеждане седнал',
  'towel row': 'Гребане с кърпа', 'bird dog': 'Куче-птица',
  'smith machine bulgarian split squat': 'Български клек на Смит машина', 'bulgarian split squat': 'Български клек',
};
