/**
 * EFP v3 — детерминистичен класификатор на упражнения (без AI, без случайност).
 *
 * Вход: суров запис от exercises-dataset (name, equipment, target, body_part).
 * Изход: pattern → category → diff/gf/gm/flags. Всяко решение има причина (reasons),
 * за да може в админ каталога да се види ЗАЩО упражнението е класифицирано така.
 *
 * Ред на решенията (всяко следващо ползва предходните):
 *   1. pattern   — двигателен модел (squat, hinge, push_h, pull_v, core, stretch…)
 *   2. category  — strength | core | cardio | plyometric | mobility
 *   3. mechanic  — compound | isolation | none (mobility)
 *   4. load      — machine | cable | free | barbell | bodyweight | apparatus
 *   5. diff      — max(база по load×mechanic, умения/нестабилност/плиометрия); стречинг → 1
 *   6. gf/gm     — таблица по pattern/target (не по пол на упражнението)
 *   7. flags     — извеждат се от горните, никога ръчно противоречиви
 */
import { normalizeText } from './normalize.js';
import { inferRequiredGear, isTrueBodyweightExercise, resolveEffectiveEquipNorm } from './exercise-tags.js';
import { isGenderSpecificExerciseName, isGenderDuplicateExerciseName } from './exercise-name-bg.js';

export const CLASSIFIER_VERSION = 3;

export const PATTERNS = [
  'stretch', 'cardio', 'plyo', 'olympic', 'carry',
  'squat', 'lunge', 'hinge', 'glute', 'adductor', 'abductor', 'knee_ext', 'knee_flex', 'calf',
  'push_h', 'push_v', 'dip', 'fly', 'pull_v', 'pull_h', 'pullover', 'shrug',
  'lat_raise', 'front_raise', 'rear_delt', 'rotator',
  'biceps', 'triceps', 'forearm', 'neck',
  'core_flex', 'core_rot', 'core_static', 'core_hip', 'back_ext',
];

/** Етикети за админ UI. */
export const PATTERN_LABELS_BG = {
  stretch: 'Разтягане / мобилност',
  cardio: 'Кардио',
  plyo: 'Плиометрия / скокове',
  olympic: 'Олимпийски / мощност',
  carry: 'Носене',
  squat: 'Клек / преса',
  lunge: 'Напад / един крак',
  hinge: 'Тазово сгъване (hinge)',
  glute: 'Седалище (мост/тръст/отвеждане назад)',
  adductor: 'Привеждачи',
  abductor: 'Отвеждачи',
  knee_ext: 'Разгъване на коляно',
  knee_flex: 'Сгъване на коляно',
  calf: 'Прасци',
  push_h: 'Хоризонтално бутане',
  push_v: 'Вертикално бутане',
  dip: 'Кофички',
  fly: 'Разтваряне (fly)',
  pull_v: 'Вертикално дърпане',
  pull_h: 'Хоризонтално дърпане (гребане)',
  pullover: 'Пуловър',
  shrug: 'Трапец (свиване)',
  lat_raise: 'Странично вдигане',
  front_raise: 'Предно вдигане',
  rear_delt: 'Заден делт',
  rotator: 'Ротаторен маншон',
  biceps: 'Бицепс',
  triceps: 'Трицепс',
  forearm: 'Предмишница',
  neck: 'Врат',
  core_flex: 'Корем — сгъване',
  core_rot: 'Корем — ротация',
  core_static: 'Корем — статика / анти-движение',
  core_hip: 'Корем — повдигане на крака',
  back_ext: 'Гръбна екстензия',
};

export const CATEGORY_LABELS_BG = {
  strength: 'Сила',
  core: 'Корем / стабилност',
  cardio: 'Кардио',
  plyometric: 'Плиометрия',
  mobility: 'Мобилност',
};

const COMPOUND_PATTERNS = new Set([
  'olympic', 'carry', 'squat', 'lunge', 'hinge', 'push_h', 'push_v', 'dip', 'pull_v', 'pull_h', 'cardio', 'plyo',
]);

// --- Лексикон (върху normalizeText: малки букви, тиретата са интервали) -------

const R = {
  stretch: /\b(stretch|stretching|mobility|yoga|pose|foam roll|roller|self massage|circles?|swings? stretch|cat cow|child s? pose|cobra|sphinx|neck side|rotation of shoulders|arm circles|ankle circles|hip circles|wrist circles|knee circles|wall slide|dislocat|thread the needle|world s greatest|world greatest|inchworm|upward facing dog|downward dog|one arm against wall|hug keens|hug knees|knees to chest|pelvic tilt)\b/,
  rollerEq: /^roller$/,
  cardioMachine: /\b(elliptical|stationary bike|stepmill|skierg|ergometer|treadmill|bike)\b/,
  cardio: /\b(high knees?|lateral shuffle|sprawl|squat thrust|seal jack|fast feet|plank jack|battling ropes?|battle ropes?|boxing|run|running|rowing|swimming|hiking|elliptical|treadmill|stair climber|assault bike|skierg|cycling|walking|jog|jogging|sprint|marching in place|high knee|butt kick|jumping jacks?|jack jump|star jump|astride jumps?|scissor jumps?|jump rope|skipping|mountain climber|burpee|shadow box|punch|walking high|wheel run|cycle cross|bear crawl|crab walk|frog jump|stair)\b/,
  plyo: /\b(jump|jumps|jumping|hop|hops|hopping|bound|bounding|clap|clapping|plyo|plyometric|depth|drop push|explosive|tuck jump|box jump|skater|split jump|lunge jump|power skip|throw|slam|toss)\b/,
  highImpactPlyo: /\b(depth jump|drop jump|drop push|clap|clapping|tuck jump|box jump|burpee|one leg hop|single leg hop|split jump|lunge with jump|jump lunge|plyo push|explosive push|broad jump|180)\b/,
  olympic: /\b(clean|snatch|jerk|push press|thruster|high pull|muscle snatch|hang|tire flip)\b/,
  carry: /\b(farmer|farmers|carry|suitcase walk|waiter walk|overhead walk|sled push|sled pull|prowler)\b/,
  squat: /\b(squat|squats|leg press|leg wide press|hack|pistol|sit to stand|wall sit|sissy)\b/,
  lunge: /\b(lunge|lunges|split squats?|step up|step ups|stepup|bulgarian|single leg squat|one leg squat|skater squat|curtsey|curtsy|lateral step)\b/,
  hinge: /\b(deadlift|dead lift|rdl|romanian|good morning|swing|pull through|rack pull|stiff leg|straight leg deadlift|jefferson curl)\b/,
  glute: /\b(glute|gluteus|hip thrust|hip bridge|bridge|donkey kick|kickback|fire hydrant|clamshell|clam|frog pump|hip extension|reverse hyper|quadruped|kick back)\b/,
  adductor: /\b(adduction|adductor|inner thigh|copenhagen|hip adduct)\b/,
  abductor: /\b(abduction|abductor|side lying leg raise|lateral leg raise|outer thigh|hip abduct|lateral band walk|monster walk|side walk|lying side leg lift)\b/,
  kneeExt: /\b(leg extension|knee extension|quad extension)\b/,
  kneeFlex: /\b(leg curl|lying curl|hamstring curl|nordic|glute ham|inverse leg curl|knee flexion|femoral)\b/,
  calf: /\b(calf|calves|heel raise|toe raise|donkey calf|tibialis|ankle)\b/,
  pushH: /\b(bench press|chest press|floor press|push up|push ups|pushup|pushups|press up|incline press|decline press|close grip press|svend|guillotine|board press|pin press|pin presses|squeeze press|hex press|spoto)\b/,
  pushV: /\b(overhead press|shoulder press|military press|arnold press|push press|pike push|handstand|landmine press|z press|bradford|behind neck press|behind head military|seated press|standing press|palms? in press|alternate press|side press|scott press|w press|seesaw press|anti gravity press|viking press)\b/,
  dip: /\b(dip|dips)\b/,
  fly: /\b(fly|flye|flyes|flies|crossovers?|cross over|pec deck|butterfly|chest squeeze)\b/,
  pullV: /\b(pull up|pull ups|pullup|pullups|chin up|chin ups|chinup|chin|pulldown|pull down|pulldowns|muscle up|lat pull|rope climb|kipping)\b/,
  pullH: /\b(row|rows|rowing|inverted|face pull|high row|low row|seal row|meadows|kroc|pendlay|yates|t bar)\b/,
  pullover: /\b(pullover|pull over|straight arm pulldown|straight arm pull down|straight arm lat)\b/,
  shrug: /\b(shrug|shrugs)\b/,
  latRaise: /\b(lateral raise|side raise|lateral delt|y raise|lu raise|upright row|lateral lift)\b/,
  frontRaise: /\b(front raise|front delt raise|front lift|front plate raise|forward raise|front shoulder raise)\b/,
  rearDelt: /\b(rear delt|rear deltoid|deltoid rear|rear fly|revers fly|reverse fly|reverse flye|bent over lateral|rear lateral|band pull apart|pull apart|t raise|w raise)\b/,
  rotator: /\b(external (?:shoulder )?rotation|internal (?:shoulder )?rotation|rotator|cuban)\b/,
  biceps: /\b(curl|curls|biceps|bicep)\b/,
  triceps: /\b(triceps|tricep|skull ?crusher|skullcrusher|french press|pushdown|push down|kickback|jm press|tate press|extension)\b/,
  forearm: /\b(wrist|forearm|grip|reverse curl|finger|pinch|hand gripper|wrist roller)\b/,
  neck: /\b(neck|levator)\b/,
  coreRot: /\b(air bike|twist|twists|twisting|russian|woodchop|wood chop|rotation|rotational|oblique|obliques|windshield|wiper|side bend|side crunch|bicycle|cross body|cross crunch|elbow to knee|heel touch|side to side|landmine rotation|pallof)\b/,
  coreStatic: /\b(plank|planks|hollow|dead bug|bird dog|l sit|lsit|side bridge|wheel rollerout|rollerout|body saw|hold|ab wheel|rollout|roll out|stir the pot|body saw|superman|shoulder tap|planche|maltese|front lever|back lever|dragon flag|human flag|bear hold)\b/,
  coreHip: /\b(leg raise|leg raises|knee raise|knee raises|leg lift|flutter|scissor|toes to bar|toe to bar|v up|v ups|jackknife|jack knife|pike|hip raise|reverse crunch|leg hip raise|knee tuck|tuck crunch|lying leg|hanging)\b/,
  coreFlex: /\b(crunch|crunches|sit up|sit ups|situp|situps|toe touch|toes touch|ab roller|abs|v sit|jack knife sit)\b/,
  backExt: /\b(back extension|hyperextension|hyper extension|superman(?! push)|good morning|reverse hyper|back raise|prone leg raise|prone lower body|exercise ball hug|pelvic tilt)\b/,

  // Модификатори на трудност
  gymnastics: /\b(stalder|planche|muscle up|kipping|skin the cat|iron cross(?! stretch)|flag|rope climb|l pull up|turkish get up|l sit|lsit|handstand|dragon flag|front lever|back lever|human flag|victorian|maltese|impossible dips?|korean dips?|ring)\b/,
  oneArmBw: /\b(one arm|single arm|one hand|archer|typewriter|pseudo planche|tiger bend|superman push|spiderman push|aztec)\b/,
  unilateral: /\b(single leg|one leg|single arm|one arm|alternat\w*|unilateral|pistol|bulgarian|split squat|lunge|step up|curtsey|curtsy|skater|kickstand|b stance|staggered)\b/,
  unstable: /\b(bosu|stability ball|exercise ball|swiss ball|on ball|balance|wobble|suspended|trx|ring|rings|kneeling on ball|standing on ball)\b/,
  pistol: /\b(pistol|shrimp squat|dragon squat|sissy squat|natural leg curl|nordic|one leg squat|single leg squat)\b/,
  zercher: /\b(zercher|overhead squat|snatch grip|jefferson|anderson|pause|deficit)\b/,
  weightedBw: /\b(weighted)\b/,
  easyVariant: /\b(assisted|kneeling push|knee push|wall push|incline push|on knees|modified|chair squat|box squat|sit to stand|band assisted)\b/,
  hardBw: /\b(decline push|diamond|close grip push|wide push|spiderman|pike push|deep|hindu|t push|staggered push|reverse grip push)\b/,
};

function has(re, s) {
  return re.test(s);
}

function equipKind(eq) {
  if (!eq || eq === 'body weight') return 'bodyweight';
  if (eq === 'cable') return 'cable';
  if (/machine|lever|smith|sled|ergometer|skierg|stepmill|elliptical|stationary bike/.test(eq)) return 'machine';
  if (eq === 'assisted') return 'machine';
  if (/barbell|trap bar/.test(eq)) return 'barbell';
  if (/band/.test(eq)) return 'band';
  if (/stability ball|bosu ball/.test(eq)) return 'ball';
  if (/roller/.test(eq)) return 'roller';
  if (eq === 'rope') return 'rope';
  return 'free'; // dumbbell, kettlebell, weighted, medicine ball, hammer, tire
}

function targetOf(raw) {
  return normalizeText(raw?.target || '');
}

function bodyOf(raw) {
  return normalizeText(raw?.body_part || raw?.bodyPart || raw?.category || '');
}

/**
 * Двигателен модел. Ред: изрични категории → многоставни → изолиращи → по target.
 * @returns {{ pattern: string, reason: string }}
 */
export function detectPattern(raw) {
  const n = normalizeText(raw?.name || '');
  const eq = normalizeText(raw?.equipment || '');
  const t = targetOf(raw);
  const b = bodyOf(raw);

  // equipment=assisted без машина в името = партньорско разтягане (assisted lying/prone …)
  if (eq === 'assisted' && /\b(lying|prone|seated|side lying)\b/.test(n) && !/\b(raise|curl|crunch|sit up|pull|dip|row)\b/.test(n)) {
    return { pattern: 'stretch', reason: 'equipment:assisted partner stretch' };
  }
  if (raw?.isStretch === true) return { pattern: 'stretch', reason: 'dataset:isStretch' };
  if (has(R.stretch, n) || R.rollerEq.test(eq)) {
    // „circles“ с тежест (напр. kettlebell circles) не е стречинг
    if (!(/\bcircles?\b/.test(n) && /kettlebell|dumbbell|barbell|weighted|medicine/.test(eq))) {
      return { pattern: 'stretch', reason: 'name:stretch/mobility' };
    }
  }
  if (has(R.cardioMachine, eq) || has(R.cardioMachine, n) && b === 'cardio') return { pattern: 'cardio', reason: 'equipment:cardio_machine' };
  if (has(R.carry, n)) return { pattern: 'carry', reason: 'name:carry' };

  const olympic = has(R.olympic, n) && /barbell|kettlebell|dumbbell|trap bar|tire/.test(eq)
    && !/\bhanging|clean grip\b/.test(n) && !has(R.biceps, n) && !has(R.shrug, n);
  if (olympic) return { pattern: 'olympic', reason: 'name:clean/snatch/jerk/thruster' };

  // Плиометрия преди клек/напад: jump squat е плиометрия, не клек
  const throwOnly = /\b(throw|toss|slam)\b/.test(n) && !/\b(jump|hop|bound|clap)\b/.test(n);
  if (has(R.plyo, n) && !/\bjump rope\b/.test(n) && (!throwOnly || /medicine ball/.test(eq))) return { pattern: 'plyo', reason: 'name:jump/hop/clap/throw' };
  if (/^quads$|\bknee bends\b/.test(n)) return { pattern: 'squat', reason: 'name:bodyweight squat (dataset label)' };
  if (has(R.lunge, n) && !/\b(burpee|mountain climber)\b/.test(n)) return { pattern: 'lunge', reason: 'name:lunge/split squat/step up' };
  if (/\bglute bridge\b/.test(n) && !/\bmountain climber\b/.test(n)) return { pattern: 'glute', reason: 'name:glute bridge' };
  if (/\bmedicine ball\b/.test(eq) && /\b(push|release|pass)\b/.test(n)) return { pattern: 'plyo', reason: 'name:medicine ball power' };
  if (/\b(high knees?|lateral shuffle|sprawl|squat thrust|seal jack|fast feet|plank jack)\b/.test(n)) return { pattern: 'cardio', reason: 'name:conditioning drill' };
  if (has(R.cardio, n) || b === 'cardio') return { pattern: 'cardio', reason: b === 'cardio' ? 'body_part:cardio' : 'name:cardio' };

  if (has(R.adductor, n)) return { pattern: 'adductor', reason: 'name:adduction' };
  if (has(R.abductor, n)) return { pattern: 'abductor', reason: 'name:abduction' };
  if (has(R.kneeExt, n)) return { pattern: 'knee_ext', reason: 'name:leg extension' };
  if (has(R.kneeFlex, n)) return { pattern: 'knee_flex', reason: 'name:leg curl/nordic' };
  if (has(R.calf, n) || t === 'calves') return { pattern: 'calf', reason: 'name/target:calf' };

  if (has(R.lunge, n)) return { pattern: 'lunge', reason: 'name:lunge/split squat/step up' };
  if (has(R.squat, n) && !/\bsquat thrust/.test(n)) return { pattern: 'squat', reason: 'name:squat/leg press' };
  if (has(R.backExt, n) && !/\bgood morning\b/.test(n)) return { pattern: 'back_ext', reason: 'name:back extension' };
  if (has(R.hinge, n)) return { pattern: 'hinge', reason: 'name:deadlift/RDL/swing' };
  if (has(R.glute, n) && !/\bside bridge\b/.test(n) && (t === 'glutes' || t === 'hamstrings' || /bridge|thrust|kickback|donkey|hydrant|clam/.test(n))) {
    if (/\bkickback|kick back\b/.test(n) && t === 'triceps') return { pattern: 'triceps', reason: 'name:triceps kickback' };
    return { pattern: 'glute', reason: 'name:bridge/hip thrust/kickback' };
  }

  if (/\bside bridge\b/.test(n) && !has(R.abductor, n)) return { pattern: 'core_static', reason: 'name:side bridge' };
  if (/\bcurl up\b/.test(n)) return { pattern: 'core_flex', reason: 'name:curl-up' };
  if (/\bback curl\b/.test(n)) return { pattern: 'back_ext', reason: 'name:back curl' };
  if (/\bcurl\b/.test(n) && !/\b(leg|hamstring|wrist|finger|jefferson)\b/.test(n)) return { pattern: 'biceps', reason: 'name:curl' };
  if (has(R.coreFlex, n) && !/\b(squat|lunge|row|press up)\b/.test(n)) {
    return { pattern: has(R.coreRot, n) ? 'core_rot' : 'core_flex', reason: 'name:crunch/sit-up' };
  }
  if (/\bplank\b/.test(n) && !/\b(row|fly)\b/.test(n)) return { pattern: 'core_static', reason: 'name:plank' };
  if (has(R.pullover, n)) return { pattern: 'pullover', reason: 'name:pullover/straight arm' };
  if (has(R.pullV, n) && /\b(pulldown|pull down|chin|pull up|pull ups)\b/.test(n)) return { pattern: 'pull_v', reason: 'name:pull-up/chin-up/pulldown' };
  if (/\brow\b/.test(n) && !/\b(upright row|rear delt row)\b/.test(n)) return { pattern: 'pull_h', reason: 'name:row' };
  if (has(R.shrug, n)) return { pattern: 'shrug', reason: 'name:shrug' };
  if (has(R.pullover, n)) return { pattern: 'pullover', reason: 'name:pullover' };
  if (has(R.rearDelt, n)) return { pattern: 'rear_delt', reason: 'name:rear delt/reverse fly' };
  if (has(R.rotator, n)) return { pattern: 'rotator', reason: 'name:external/internal rotation' };
  if (has(R.latRaise, n)) return { pattern: 'lat_raise', reason: 'name:lateral raise/upright row' };
  if (has(R.frontRaise, n)) return { pattern: 'front_raise', reason: 'name:front raise' };
  if (has(R.fly, n)) return { pattern: 'fly', reason: 'name:fly/crossover' };
  if (t === 'delts' && /\b(raise|around world|iron cross|round arm)\b/.test(n)) {
    return /\b(front|forward)\b/.test(n) ? { pattern: 'front_raise', reason: 'name:front raise' } : { pattern: 'lat_raise', reason: 'name:raise (delts)' };
  }

  if (has(R.dip, n) && !/\bhip dip|dip hip|hip drop\b/.test(n)) {
    if (t === 'triceps' && /\b(bench|floor|chair|between)\b/.test(n)) return { pattern: 'dip', reason: 'name:bench dip' };
    return { pattern: 'dip', reason: 'name:dip' };
  }
  if (has(R.pullV, n) && !/\bchin tuck\b/.test(n)) return { pattern: 'pull_v', reason: 'name:pull-up/chin-up/pulldown' };
  if (/\bpushdown|push down\b/.test(n) && t === 'lats') return { pattern: 'pullover', reason: 'name:straight arm pushdown' };
  if (has(R.pushV, n) && (/handstand/.test(n) || (!has(R.triceps, n) && t !== 'triceps' && t !== 'pectorals'))) return { pattern: 'push_v', reason: 'name:overhead/shoulder press' };
  if (has(R.pushH, n)) return { pattern: 'push_h', reason: 'name:bench press/push-up' };
  if (/\bpress\b/.test(n) && ['pectorals', 'triceps', 'serratus anterior'].includes(t) && !/\b(extension|french|tate|elbow press|jm press|skull)\b/.test(n)) {
    return { pattern: 'push_h', reason: 'name:press (chest/triceps target)' };
  }
  if (has(R.pullH, n) && !/\bupright row\b/.test(n)) return { pattern: 'pull_h', reason: 'name:row' };

  // Изолиращи ръце (след многоставните, за да не хване „curl“ в leg curl)
  if (t === 'forearms' || /\b(wrist|finger|forearm|gripper|hand squeeze|pronation|supination)\b/.test(n)) return { pattern: 'forearm', reason: 'name/target:forearm' };
  if (t === 'biceps' || (has(R.biceps, n) && t !== 'hamstrings')) return { pattern: 'biceps', reason: 'name/target:biceps' };
  if (t === 'triceps' || has(R.triceps, n) && !/\b(back|hip|leg|knee)\b/.test(n)) return { pattern: 'triceps', reason: 'name/target:triceps' };
  if (has(R.neck, n) || t === 'levator scapulae') return { pattern: 'neck', reason: 'name/target:neck' };

  // Корем — ред: статика → крака → ротация → сгъване
  if (b === 'waist' || t === 'abs' || has(R.coreStatic, n) || has(R.coreFlex, n) || has(R.coreHip, n) || has(R.coreRot, n)) {
    if (has(R.coreStatic, n)) return { pattern: 'core_static', reason: 'name:plank/hollow/rollout' };
    if (has(R.coreHip, n)) return { pattern: 'core_hip', reason: 'name:leg/knee raise' };
    if (has(R.coreRot, n)) return { pattern: 'core_rot', reason: 'name:twist/oblique' };
    if (has(R.coreFlex, n) || b === 'waist' || t === 'abs') return { pattern: 'core_flex', reason: 'name/target:crunch/abs' };
  }

  // Резервни правила по target (dataset полета)
  const byTarget = {
    glutes: 'glute', quads: 'squat', hamstrings: 'hinge', abductors: 'abductor', adductors: 'adductor',
    pectorals: 'push_h', delts: 'push_v', lats: 'pull_v', 'upper back': 'pull_h', traps: 'shrug',
    spine: 'back_ext', 'serratus anterior': 'push_h', abs: 'core_flex', calves: 'calf',
    'cardiovascular system': 'cardio',
  };
  if (byTarget[t]) return { pattern: byTarget[t], reason: `target:${t}` };
  return { pattern: 'core_static', reason: 'fallback' };
}

function categoryOf(pattern) {
  if (pattern === 'stretch') return 'mobility';
  if (pattern === 'cardio') return 'cardio';
  if (pattern === 'plyo') return 'plyometric';
  if (/^core_/.test(pattern) || pattern === 'back_ext') return 'core';
  return 'strength';
}

function mechanicOf(pattern, n) {
  if (pattern === 'stretch') return 'none';
  if (/\b(dead hang|active hang|scapular)\b/.test(n)) return 'isolation';
  if (COMPOUND_PATTERNS.has(pattern)) return 'compound';
  if (pattern === 'glute' && /\b(thrust|bridge)\b/.test(n)) return 'compound';
  if (pattern === 'core_static' && /\b(plank|bear|rollout|roll out|ab wheel|body saw)\b/.test(n)) return 'compound';
  if (pattern === 'core_hip' && /\bhanging|toes to bar|toe to bar\b/.test(n)) return 'compound';
  return 'isolation';
}

/**
 * Трудност 1–3 с причини. База = стабилност на натоварването × сложност на модела;
 * модификаторите само вдигат (max), освен стречинг, който е винаги 1 без high-skill.
 */
function computeDiff({ n, pattern, category, mechanic, load, gear }) {
  const reasons = [];
  let diff = 1;
  const bump = (level, why) => {
    if (level > diff) diff = level;
    if (level >= 2) reasons.push(`d${level}:${why}`);
  };

  // База по натоварване
  if (load === 'barbell' && mechanic === 'compound') bump(2, 'свободна щанга, многоставно');
  if (load === 'free' && mechanic === 'compound' && ['squat', 'hinge', 'lunge', 'push_v'].includes(pattern)) bump(2, 'свободна тежест, многоставно с аксиално натоварване');
  if (load === 'ball' && mechanic === 'compound') bump(2, 'нестабилна опора (топка)');
  if (pattern === 'carry') bump(1, 'носене');

  // Модели с вградена сложност
  if (pattern === 'olympic') bump(/\b(thruster|push press|high pull)\b/.test(n) && !/\bsnatch|clean|jerk\b/.test(n) ? 2 : 3, 'олимпийско/мощностно');
  if (pattern === 'hinge' && load === 'barbell') bump(2, 'щанга hinge');
  if (pattern === 'hinge' && /\b(single leg|one leg)\b/.test(n)) bump(3, 'hinge на един крак');
  if (pattern === 'hinge' && /\bswing\b/.test(n)) bump(2, 'балистичен swing');
  if (pattern === 'pull_v' && load === 'bodyweight' && !/\b(assisted|band|negative|inverted|bench|australian)\b/.test(n)) bump(2, 'набиране със собствено тегло');
  if (pattern === 'pull_v' && (load === 'bodyweight' || load === 'free') && /\b(one arm|one hand|archer|typewriter|l sit|l pull|muscle up|weighted|kipping|side to side|commando|explosive)\b/.test(n)) bump(3, 'напреднало набиране');
  if (pattern === 'dip' && gear.some((g) => ['parallel_bars', 'pull_bar', 'rings'].includes(g))) bump(2, 'кофички на уред');
  if (pattern === 'dip' && /\b(one arm|impossible|korean|ring|russian)\b/.test(n)) bump(3, 'напреднали кофички');
  if (pattern === 'dip' && /\bweighted\b/.test(n)) bump(gear.includes('bench') ? 2 : 3, 'кофички с тежест');
  if (pattern === 'push_h' && load === 'bodyweight') {
    if (has(R.hardBw, n)) bump(2, 'усложнена лицева опора');
    if (has(R.oneArmBw, n)) bump(3, 'едноръчна/асиметрична лицева опора');
  }
  if (pattern === 'push_v' && load === 'bodyweight') bump(/handstand/.test(n) ? 3 : 2, 'вертикално бутане със собствено тегло');
  if ((pattern === 'squat' || pattern === 'lunge') && has(R.pistol, n)) bump(3, 'pistol/shrimp/sissy/nordic');
  if ((pattern === 'squat' || pattern === 'hinge') && has(R.zercher, n)) bump(3, 'zercher/overhead/deficit/пауза');
  if (pattern === 'knee_flex' && /\b(nordic|natural|glute ham|inverse leg curl)\b/.test(n)) bump(/\bassisted\b/.test(n) ? 2 : 3, 'nordic/inverse leg curl');
  if (pattern === 'lunge' && (load === 'barbell' || load === 'free') && /\b(walking|reverse|lateral|curtsey|curtsy|bulgarian|deficit)\b/.test(n)) bump(2, 'динамичен напад с тежест');
  if (pattern === 'core_hip' && /\bhanging|toes to bar|toe to bar|captain\b/.test(n)) bump(2, 'висене на лост');
  if (pattern === 'core_hip' && /\b(v up|v ups|jackknife|jack knife)\b/.test(n)) bump(2, 'v-up/jackknife');
  if (pattern === 'core_hip' && /\b(toes to bar|toe to bar|windshield|hanging straight leg hip raise)\b/.test(n)) bump(3, 'трудно повдигане на крака');
  if (pattern === 'core_static' && /\b(standing ab wheel|standing rollout|standing ab rollerout|standing wheel rollerout|dragon flag|front lever|back lever|human flag|l sit|lsit)\b/.test(n)) bump(3, 'статика с висок лост');
  if (pattern === 'core_static' && /\b(ab wheel|rollout|roll out|rollerout|body saw)\b/.test(n)) bump(2, 'rollout');
  if (pattern === 'core_rot' && /\bwindshield|wiper\b/.test(n)) bump(3, 'windshield wipers');
  if (pattern === 'back_ext' && /\breverse hyper|glute ham\b/.test(n)) bump(2, 'reverse hyper');

  // Уреди и умения
  if (has(R.gymnastics, n) && !(load !== 'bodyweight' && /iron cross/.test(n))) bump(3, 'гимнастика/халки');
  if (gear.includes('rings')) bump(3, 'халки');
  if (gear.includes('suspension')) bump(2, 'TRX/окачване');
  if (gear.includes('parallel_bars')) bump(2, 'успоредка');
  if (gear.includes('pull_bar') && pattern !== 'stretch' && !/\bassisted\b/.test(n)) bump(2, 'изисква лост');
  if (has(R.unstable, n) && mechanic === 'compound' && pattern !== 'stretch') bump(2, 'нестабилна опора');
  if (/\bbosu\b/.test(n)) bump(mechanic === 'compound' ? 3 : 2, 'bosu');
  if (load === 'barbell' && /\b(one leg|single leg squat|single leg deadlift)\b/.test(n) && mechanic === 'compound') bump(3, 'щанга на един крак');
  if (/\b(renegade|windmill|bent press)\b/.test(n)) bump(/\b(advanced windmill|bent press)\b/.test(n) ? 3 : 2, 'стабилност + натоварване');

  // Плиометрия
  if (category === 'plyometric') {
    const throwOnly = /\b(throw|toss|slam)\b/.test(n) && !/\b(jump|hop|bound|clap)\b/.test(n);
    bump(!throwOnly && (has(R.highImpactPlyo, n) || load === 'barbell' || load === 'free') ? 3 : 2, throwOnly ? 'хвърляне/мощност' : 'скок/приземяване');
  }
  if (category === 'cardio' && /\bburpee|mountain climber|bear crawl|frog jump\b/.test(n)) bump(2, 'интензивно кардио');
  if (category === 'cardio' && /\bburpee\b/.test(n) && load !== 'bodyweight') bump(3, 'burpee с тежест');

  // Машини/кабели: стабилизирано движение — не над 2 без изрично умение
  if ((load === 'machine' || load === 'cable') && diff === 3 && !has(R.gymnastics, n) && pattern !== 'olympic') {
    diff = 2;
    reasons.push('cap2:машина/кабел');
  }
  // Лесни варианти (асистирани, на колене, наклон към стена) — сваля до 1, ако няма high-skill
  if (has(R.easyVariant, n) && diff === 2 && (load === 'bodyweight' || load === 'machine') && !has(R.gymnastics, n)
    && !gear.some((g) => ['rings', 'suspension'].includes(g)) && category !== 'plyometric') {
    diff = 1;
    reasons.push('d1:облекчен вариант');
  }
  // Стречинг/мобилност
  if (category === 'mobility' && !has(R.gymnastics, n)) {
    diff = 1;
    reasons.length = 0;
    reasons.push('d1:мобилност');
  }
  if (!reasons.length) reasons.push('d1:стабилно/просто движение');
  return { diff, reasons };
}

/** gf/gm — подходящост за женски/мъжки ПЛАН (0–100). Детерминистична таблица. */
const FIT_TABLE = {
  stretch: [85, 75], cardio: [80, 75], plyo: [70, 75], olympic: [55, 85], carry: [60, 85],
  squat: [85, 85], lunge: [90, 80], hinge: [85, 85], glute: [95, 60], adductor: [85, 55], abductor: [90, 55],
  knee_ext: [75, 75], knee_flex: [80, 75], calf: [70, 70],
  push_h: [60, 90], push_v: [65, 85], dip: [55, 85], fly: [55, 80],
  pull_v: [65, 90], pull_h: [75, 85], pullover: [60, 80], shrug: [45, 80],
  lat_raise: [75, 80], front_raise: [65, 75], rear_delt: [75, 80], rotator: [70, 70],
  biceps: [60, 85], triceps: [70, 80], forearm: [40, 75], neck: [35, 60],
  core_flex: [85, 70], core_rot: [85, 70], core_static: [85, 75], core_hip: [85, 70], back_ext: [80, 75],
};

function computeFit({ n, pattern, load }) {
  let [gf, gm] = FIT_TABLE[pattern] || [70, 70];
  // Тежка щанга за горна част — по-нисък gf; ластик/СТ за горна част — по-висок gf
  if (load === 'barbell' && ['push_h', 'push_v', 'biceps', 'triceps', 'dip'].includes(pattern)) gf -= 5;
  if ((load === 'band' || load === 'bodyweight' && pattern === 'triceps') && ['push_h', 'biceps', 'triceps', 'fly', 'pull_h'].includes(pattern)) gf += 5;
  if (pattern === 'push_h' && load === 'bodyweight' && /\b(knee|kneeling|wall|incline)\b/.test(n)) gf += 15;
  if (pattern === 'glute' && load === 'barbell') gm += 15;
  if (/\bclose grip|reverse grip\b/.test(n) && pattern === 'push_h') gf -= 5;
  return { gf: Math.max(0, Math.min(100, gf)), gm: Math.max(0, Math.min(100, gm)) };
}

/**
 * Пълна класификация на един запис от dataset-а.
 * @param {object} raw — { id, name, equipment, target, body_part }
 */
export function classifyExercise(raw) {
  const n = normalizeText(raw?.name || '');
  const eq = normalizeText(raw?.equipment || '');
  const { pattern, reason: patternReason } = detectPattern(raw);
  const category = categoryOf(pattern);
  const mechanic = mechanicOf(pattern, n);
  const gear = inferRequiredGear(raw?.name || '', raw?.equipment || '');
  const trueBodyweight = isTrueBodyweightExercise(raw?.name || '', raw?.equipment || '');
  const effectiveEquipNorm = resolveEffectiveEquipNorm(raw?.name || '', raw?.equipment || '');
  let load = equipKind(eq);
  if (load === 'bodyweight' && !trueBodyweight) load = 'apparatus';
  if (load === 'apparatus' && gear.includes('bench') && !gear.some((g) => !['floor', 'mat', 'wall', 'step', 'bench', 'chair'].includes(g))) load = 'bodyweight';

  const { diff, reasons } = computeDiff({ n, pattern, category, mechanic, load: load === 'apparatus' ? 'bodyweight' : load, gear });
  const { gf, gm } = computeFit({ n, pattern, load });

  const plyometric = category === 'plyometric' || /\bburpee\b/.test(n);
  const gymnastics = has(R.gymnastics, n) || gear.includes('rings');
  const unilateral = has(R.unilateral, n);
  const balance = has(R.unstable, n);

  const flags = new Set();
  if (mechanic === 'compound') flags.add('compound');
  if (mechanic === 'isolation') flags.add('isolation');
  if (category === 'mobility') { flags.add('stretch'); flags.add('mobility'); }
  if (category === 'cardio' || plyometric) flags.add('cardio');
  if (plyometric) flags.add('plyometric');
  if (unilateral) flags.add('unilateral');
  if (balance) flags.add('balance');
  if (pattern === 'olympic') flags.add('olympic');
  if (gymnastics) flags.add('gymnastics');
  if (['push_h', 'push_v', 'dip'].includes(pattern)) flags.add('press');
  if (pattern === 'glute' || normalizeText(raw?.target) === 'glutes' || pattern === 'abductor') flags.add('glute');

  if (eq === 'body weight' || trueBodyweight) flags.add('bodyweight');
  if (trueBodyweight) flags.add('true_bodyweight');
  if (eq === 'body weight' && !trueBodyweight) flags.add('mislabeled_bw');
  if (/barbell|trap bar/.test(eq)) flags.add('barbell');
  if (eq === 'dumbbell') flags.add('dumbbell');
  if (eq === 'kettlebell') flags.add('kettlebell');
  if (eq === 'cable') flags.add('cable');
  if (/band/.test(eq)) flags.add('band');
  if (eq === 'weighted') flags.add('weighted');
  if (load === 'machine') flags.add('machine');
  if (gear.includes('pull_bar')) flags.add('pull_bar');
  if (gear.includes('parallel_bars')) flags.add('parallel_bars');
  if (gear.includes('rings')) flags.add('rings');
  if (gear.includes('suspension')) flags.add('suspension');
  if (flags.has('mislabeled_bw')) flags.add(`needs_${effectiveEquipNorm.replace(/\s+/g, '_')}`);

  const highRisk = plyometric || gymnastics || pattern === 'olympic';
  if (diff === 1 && !highRisk && !gear.some((g) => ['pull_bar', 'parallel_bars', 'rings', 'suspension'].includes(g))) flags.add('beginner_safe');
  if (trueBodyweight && diff <= 2 && !gymnastics && !(plyometric && diff === 3)) flags.add('home_friendly');
  if (diff === 3) flags.add('advanced');

  const genderVariant = isGenderSpecificExerciseName(raw?.name);
  const genderDuplicate = isGenderDuplicateExerciseName(raw?.name);
  if (genderVariant) flags.add('gender_variant');
  if (genderDuplicate) { flags.add('duplicate'); flags.add('excluded'); }

  return {
    diff,
    gf,
    gm,
    flags: [...flags],
    gear,
    effectiveEquipNorm,
    excluded: genderDuplicate,
    pattern,
    category,
    mechanic,
    load,
    reasons: [`pattern:${patternReason}`, ...reasons],
    ruleClassified: true,
    efpVersion: CLASSIFIER_VERSION,
  };
}

/** Проверка за вътрешни противоречия — ползва се в тестове и audit скрипта. */
export function findFlagContradictions(meta = {}) {
  const f = new Set(meta.flags || []);
  const out = [];
  if (f.has('compound') && f.has('isolation')) out.push('compound+isolation');
  if (f.has('beginner_safe') && meta.diff !== 1) out.push('beginner_safe при diff≠1');
  if (f.has('advanced') && meta.diff !== 3) out.push('advanced при diff≠3');
  if (f.has('home_friendly') && !f.has('true_bodyweight')) out.push('home_friendly без true_bodyweight');
  if (f.has('true_bodyweight') && (f.has('pull_bar') || f.has('rings') || f.has('suspension') || f.has('parallel_bars'))) out.push('true_bodyweight с уред');
  if (f.has('plyometric') && f.has('beginner_safe')) out.push('plyometric+beginner_safe');
  return out;
}
