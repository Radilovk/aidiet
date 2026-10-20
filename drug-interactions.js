/**
 * Лекарства ↔ храни и добавки. Една таблица за всички слоеве: менюто
 * (блокирани храни), насоките (строго избягвани, позволени „рядко“),
 * добавките (махане и отделяне във времето), профила (стил, гладуване)
 * и бележките за специалиста.
 *
 * Включени са само взаимодействия с ясна клинична значимост и с действие,
 * което хранителният план може да изпълни. Лекарството се разпознава по
 * свободния текст от въпросника (търговско или международно име).
 * Таблицата не замества лекаря — тя пази плана да не влиза в конфликт с
 * лечението.
 */

const LEVOTHYROXINE = ['левотироксин', 'тироксин', 'еутирокс', 'euthyrox', 'letrox', 'летрокс', 'l-thyrox', 'levothyrox'];
const METFORMIN = ['метформин', 'metformin', 'глюкофаж', 'glucophage', 'сиофор', 'siofor'];

const MINERALS = /калций|calcium|желязо|iron|магнези|magnes|цинк|zinc|мултивитамин|multivit/i;
const ST_JOHNS = /жълт кантарион|st\.?\s*john|hypericum/i;
// \b в JS е само за латиница — границата след кирилица се пази с отрицателен поглед напред.
// K2 се продава и като MK-7 / MK-4 / менахинон, K1 — като филохинон.
const VITAMIN_K = /витамин\s*[kк](?![а-яa-z])|vitamin\s*k(?![a-z])|(^|[^а-яa-z0-9])[kк][12](?![0-9])|(^|[^а-яa-z0-9])[mм][kк]\s*-?\s*[47](?![0-9])|menaquinon|менахинон|phylloquinon|филохинон/i;
const VITAMIN_E = /витамин\s*[eе](?![а-яa-z])|vitamin\s*e(?![a-z])/i;

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   drugs: string[],
 *   blockFoods?: string[],
 *   denyTreats?: RegExp,
 *   drop?: RegExp[],
 *   timing?: { match: RegExp, note: string }[],
 *   forbidStyles?: string[],
 *   noFasting?: boolean,
 *   caution: string,
 * }} InteractionRule
 */

/** @type {InteractionRule[]} */
export const INTERACTION_RULES = [
  {
    id: 'vka',
    label: 'варфарин / аценокумарол',
    drugs: ['варфарин', 'warfarin', 'аценокумарол', 'acenocoumarol', 'синтром', 'sintrom', 'синкумар', 'sincumar', 'мареван', 'marevan'],
    drop: [VITAMIN_K, /гинко|ginkgo/i, ST_JOHNS, /куркумин|curcumin|куркума.*(капсул|екстракт)/i, VITAMIN_E],
    caution: 'Варфарин/аценокумарол: витамин K от зеленчуците (спанак, броколи, зеле) — в едно и също количество всяка седмица, не изключени; без добавки с витамин K, витамин E, гинко, куркумин и жълт кантарион.',
  },
  {
    id: 'doac',
    label: 'нов антикоагулант',
    drugs: ['апиксабан', 'apixaban', 'еликуис', 'eliquis', 'ривароксабан', 'rivaroxaban', 'ксарелто', 'xarelto', 'дабигатран', 'dabigatran', 'прадакса', 'pradaxa', 'едоксабан', 'edoxaban', 'lixiana', 'ликсиана'],
    drop: [/гинко|ginkgo/i, ST_JOHNS, /куркумин|curcumin/i],
    caution: 'Антикоагулант: без гинко, куркумин и жълт кантарион (кървене или по-слаб ефект на лекарството).',
  },
  {
    id: 'levothyroxine',
    label: 'левотироксин',
    drugs: LEVOTHYROXINE,
    timing: [{ match: MINERALS, note: 'поне 4 часа след левотироксина' }],
    caution: 'Левотироксин: сутрин на гладно с вода, 30–60 минути преди закуска и кафе; калций, желязо, соя и млечни — поне 4 часа след него.',
  },
  {
    id: 'statin',
    label: 'статин',
    drugs: ['симвастатин', 'simvastatin', 'вазилип', 'vasilip', 'зокор', 'zocor', 'ловастатин', 'lovastatin', 'аторвастатин', 'atorvastatin', 'аторис', 'atoris', 'торвакард', 'torvacard', 'сортис', 'sortis', 'липитор', 'lipitor'],
    blockFoods: ['грейпфрут'],
    drop: [/червен ферментирал ориз|червен ориз|red yeast|монаколин|monacolin/i],
    caution: 'Статин: без грейпфрут и сок от грейпфрут (повишава нивото на лекарството); без добавки с червен ферментирал ориз.',
  },
  {
    id: 'ccb',
    label: 'блокер на калциевите канали',
    drugs: ['фелодипин', 'felodipin', 'плендил', 'plendil', 'нифедипин', 'nifedipin', 'нитрендипин', 'nitrendipin', 'лерканидипин', 'lercanidipin'],
    blockFoods: ['грейпфрут'],
    caution: 'Фелодипин/нифедипин: без грейпфрут (рязко спадане на кръвното налягане).',
  },
  {
    id: 'immuno',
    label: 'имуносупресор',
    drugs: ['такролимус', 'tacrolimus', 'циклоспорин', 'cyclosporin', 'ciclosporin', 'сиролимус', 'sirolimus', 'еверолимус', 'everolimus'],
    blockFoods: ['грейпфрут'],
    drop: [ST_JOHNS, /ехинацея|echinacea/i],
    caution: 'Имуносупресор: без грейпфрут и помело; без жълт кантарион и ехинацея; храната — прясно приготвена, без сурови яйца и непастьоризирани млечни.',
  },
  {
    id: 'maoi',
    label: 'МАО инхибитор',
    drugs: ['моклобемид', 'moclobemid', 'аурорикс', 'aurorix', 'фенелзин', 'phenelzin', 'транилципромин', 'tranylcypromin', 'селегилин', 'selegilin', 'разагилин', 'rasagilin', 'азилект', 'azilect', 'линезолид', 'linezolid'],
    blockFoods: ['кашкавал', 'пармезан', 'соев сос', 'темпе'],
    denyTreats: /колбас|алкохол/i,
    caution: 'МАО инхибитор: без отлежали сирена (кашкавал, пармезан), колбаси и сушени меса, соев сос, ферментирала соя, кисело зеле и наливна бира — тираминът вдига кръвното налягане.',
  },
  {
    id: 'quinolone_tetracycline',
    label: 'антибиотик (хинолон/тетрациклин)',
    drugs: ['ципрофлоксацин', 'ciprofloxacin', 'ципринол', 'ciprinol', 'левофлоксацин', 'levofloxacin', 'таваник', 'tavanic', 'моксифлоксацин', 'moxifloxacin', 'доксициклин', 'doxycyclin', 'тетрациклин', 'tetracyclin', 'миноциклин', 'minocyclin'],
    timing: [{ match: MINERALS, note: '2 часа преди или 4–6 часа след антибиотика' }],
    caution: 'Хинолон/тетрациклин: мляко, кисело мляко, сирене и минерални добавки — 2 часа преди или 4 часа след таблетката.',
  },
  {
    id: 'bisphosphonate',
    label: 'бифосфонат',
    drugs: ['алендронат', 'alendron', 'фосамакс', 'fosamax', 'ризедронат', 'risedron', 'ибандронат', 'ibandron', 'бонвива', 'bonviva'],
    timing: [{ match: MINERALS, note: 'не в деня/часа на бифосфоната — поне 1 час след него' }],
    caution: 'Бифосфонат: сутрин на гладно с чаша обикновена вода, 30–60 минути преди храна, кафе и добавки.',
  },
  {
    id: 'raas',
    label: 'ACE инхибитор / сартан / спиронолактон',
    drugs: ['еналаприл', 'enalapril', 'енап', 'enap', 'лизиноприл', 'lisinopril', 'рамиприл', 'ramipril', 'тритаце', 'tritace', 'периндоприл', 'perindopril', 'престариум', 'prestarium', 'каптоприл', 'captopril', 'лозартан', 'losartan', 'лориста', 'lorista', 'валсартан', 'valsartan', 'телмисартан', 'telmisartan', 'кандесартан', 'candesartan', 'ирбесартан', 'irbesartan', 'спиронолактон', 'spironolacton', 'верошпирон', 'veroshpiron', 'еплеренон', 'eplerenon'],
    drop: [/калий|potassium/i],
    caution: 'ACE инхибитор/сартан/спиронолактон: без добавки с калий и без сол-заместител с калиев хлорид; калият от храната не се ограничава без изследване.',
  },
  {
    id: 'lithium',
    label: 'литий',
    drugs: ['литий', 'lithium', 'литиев'],
    caution: 'Литий: едно и също количество сол и течности всеки ден — без рязко намаляване на солта и без обезводняване.',
  },
  {
    id: 'sglt2',
    label: 'SGLT2 инхибитор',
    drugs: ['емпаглифлозин', 'empagliflozin', 'джардианс', 'jardiance', 'дапаглифлозин', 'dapagliflozin', 'форксига', 'forxiga', 'канаглифлозин', 'canagliflozin', 'ертуглифлозин', 'ertugliflozin', 'синджарди', 'synjardy', 'ксигдуо', 'xigduo'],
    forbidStyles: ['keto'],
    caution: 'SGLT2 инхибитор: без кето хранене — риск от кетоацидоза при нормална кръвна захар.',
  },
  {
    id: 'hypoglycemic',
    label: 'инсулин / сулфанилурейно',
    drugs: ['инсулин', 'insulin', 'гликлазид', 'gliclazid', 'диабетон', 'diabeton', 'диапрел', 'diaprel', 'глимепирид', 'glimepirid', 'амарил', 'amaryl', 'глибенкламид', 'glibenclamid', 'новорапид', 'novorapid', 'лантус', 'lantus', 'тресиба', 'tresiba', 'хумалог', 'humalog'],
    noFasting: true,
    caution: 'Инсулин/сулфанилурейно: без гладуване и пропуснати хранения (хипогликемия); въглехидратите — разпределени през деня.',
  },
  {
    id: 'serotonergic',
    label: 'антидепресант',
    drugs: ['сертралин', 'sertralin', 'золофт', 'zoloft', 'асентра', 'asentra', 'есциталопрам', 'escitalopram', 'ципралекс', 'cipralex', 'флуоксетин', 'fluoxetin', 'пароксетин', 'paroxetin', 'циталопрам', 'citalopram', 'венлафаксин', 'venlafaxin', 'дулоксетин', 'duloxetin', 'тразодон', 'trazodon', 'тритико', 'trittico'],
    drop: [ST_JOHNS, /5-htp|триптофан|tryptophan/i],
    caution: 'Антидепресант: без жълт кантарион, 5-HTP и триптофан като добавки (серотонинов синдром).',
  },
  {
    id: 'metformin',
    label: 'метформин',
    drugs: METFORMIN,
    caution: 'Метформин: при дългосрочен прием витамин B12 се проверява веднъж годишно.',
  },
];

function medsText(userData) {
  const parts = [];
  const push = (v) => {
    if (v == null || v === '') return;
    if (Array.isArray(v)) v.forEach(push);
    else parts.push(String(v));
  };
  push(userData?.medications);
  push(userData?.medicationsDetails);
  return parts.join(' ').toLowerCase().replace(/ё/g, 'е')
    // Състоянието не е лекарството: „инсулинова резистентност“ не е инсулин.
    .replace(/инсулинов\S*\s+резист\S*|insulin\s+resist\S*/g, ' ');
}

/**
 * @param {Record<string, any>} userData
 */
export function interactionsFor(userData) {
  const text = medsText(userData);
  const rules = text ? INTERACTION_RULES.filter(r => r.drugs.some(d => text.includes(d))) : [];
  return {
    ids: rules.map(r => r.id),
    rules,
    blockFoods: [...new Set(rules.flatMap(r => r.blockFoods || []))],
    forbidStyles: [...new Set(rules.flatMap(r => r.forbidStyles || []))],
    noFasting: rules.some(r => r.noFasting),
    cautions: rules.map(r => r.caution),
  };
}

/**
 * Добавките през таблицата: противопоказаните отпадат, на останалите се
 * добавя кога да се вземат спрямо лекарството.
 * @param {{ name: string, dosage?: string, timing?: string, reason?: string }[]} supplements
 * @param {ReturnType<typeof interactionsFor>} ix
 * @returns {{ kept: object[], dropped: { name: string, because: string }[] }}
 */
export function applySupplementInteractions(supplements, ix) {
  const kept = [];
  const dropped = [];
  for (const s of supplements || []) {
    const name = `${s?.name || ''} ${s?.dosage || ''}`;
    const blocker = ix.rules.find(r => (r.drop || []).some(re => re.test(name)));
    if (blocker) {
      dropped.push({ name: s.name, because: blocker.label });
      continue;
    }
    const notes = ix.rules.flatMap(r => (r.timing || []).filter(t => t.match.test(name)).map(t => t.note))
      .filter(n => !String(s.timing || '').includes(n));
    kept.push(notes.length ? { ...s, timing: [s.timing, ...new Set(notes)].filter(Boolean).join('; ') } : s);
  }
  return { kept, dropped };
}

/**
 * Дали предложението („рядко позволено“) се отменя от лекарство.
 * @param {string} food
 * @param {ReturnType<typeof interactionsFor>} ix
 */
export function treatDeniedByMeds(food, ix) {
  return ix.rules.find(r => r.denyTreats && r.denyTreats.test(food)) || null;
}
