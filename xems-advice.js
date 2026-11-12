/* XEMS advice after a training — ONE source for every place that shows it:
 *   biocode.website/studio.html (XB-Studio app, live page — no store review), xbody.html (XBody PWA),
 *   and the tablet's report (ems branding/report/session-report.html — a copy between the XEMS-ADVICE markers,
 *   refreshed with `python3 scripts/sync-xems-advice.py` in the ems repo; its test fails when the copy differs).
 * Plain words, one line why, nothing that is not true for the program. No Hz, no Latin, no promises.
 * Per tip: e = emoji (report), i = studio.html icon, fa = Font Awesome (xbody.html), bg / en = [what, why].
 * Per program (the automatic program's id from the tablet): t = today, b = until the next one, gap = days of rest
 * [min, max], wk = trainings a week for the goal (default 2), course = a course's length, warn = its own safety line. */
(function (root) {
  'use strict';
  var TIP = {
    water: { e: '💧', i: 'drop', fa: 'fa-droplet', bg: ['Половин литър вода в следващия час', 'Мускулите работиха много — водата им помага да се изчистят и възстановят.'], en: ['Half a litre of water in the next hour', 'The muscles worked hard — water helps them clear and recover.'] },
    waterP: { e: '💧', i: 'drop', fa: 'fa-droplet', bg: ['Половин литър вода в следващия час', 'Водата помага на тялото да отведе течността, която процедурата раздвижи.'], en: ['Half a litre of water in the next hour', 'Water helps the body carry away the fluid the treatment moved.'] },
    protein: { e: '🍳', i: 'egg', fa: 'fa-egg', bg: ['Белтък до 2 часа след тренировката', 'Яйца, извара, риба, месо или боб — от това мускулът се възстановява.'], en: ['Protein within 2 hours after training', 'Eggs, cottage cheese, fish, meat or beans — what the muscle rebuilds from.'] },
    easy: { e: '🚶', i: 'user', fa: 'fa-person-walking', bg: ['Днес само разходка или разтягане', 'Мускулите вече са натоварени — днес им трябва раздвижване, не още товар.'], en: ['Today only a walk or stretching', 'The muscles are loaded already — today they need movement, not more load.'] },
    walkP: { e: '🚶', i: 'user', fa: 'fa-person-walking', bg: ['10–15 минути ходене след процедурата', 'Ходенето продължава работата на мускулите и кръвообращението.'], en: ['10–15 minutes of walking after the treatment', 'Walking carries on the work of the muscles and the circulation.'] },
    salt: { e: '🧂', i: 'check', fa: 'fa-check', bg: ['По-малко сол днес', 'Солта задържа вода в тъканите — обратното на това, което правим.'], en: ['Less salt today', 'Salt holds water in the tissues — the opposite of what we do.'] },
    water2: { e: '🥤', i: 'drop', fa: 'fa-droplet', bg: ['1,5–2 л вода през деня', 'Течността се оттича по-лесно, когато тялото не пести вода.'], en: ['1.5–2 l of water a day', 'Fluid drains more easily when the body is not saving water.'] },
    sleep: { e: '🌙', i: 'clock', fa: 'fa-moon', bg: ['Сън 7–8 часа', 'Мускулът се възстановява и укрепва насън.'], en: ['Sleep 7–8 hours', 'The muscle recovers and grows stronger in sleep.'] },
    proteinAll: { e: '🥚', i: 'egg', fa: 'fa-egg', bg: ['Белтък на всяко хранене', 'Без достатъчно белтък тренировката не може да изгради мускул.'], en: ['Protein at every meal', 'Without enough protein the training cannot build muscle.'] },
    sore: { e: '💪', i: 'check', fa: 'fa-check', bg: ['Лека мускулна треска 1–2 дни е нормална', 'Знак е, че мускулите са работили; минава от само себе си.'], en: ['Mild soreness for 1–2 days is normal', 'It shows the muscles worked; it passes by itself.'] },
    deficit: { e: '🍽', i: 'fire', fa: 'fa-utensils', bg: ['Малък дефицит в храната — без гладуване', 'Гладуването топи мускулите; малкият дефицит топи мазнините.'], en: ['A small food deficit — no starving', 'Starving melts muscle; a small deficit melts fat.'] },
    steps: { e: '👟', i: 'user', fa: 'fa-shoe-prints', bg: ['8 000–10 000 крачки на ден', 'Ежедневното движение изгаря повече от една тренировка седмично.'], en: ['8,000–10,000 steps a day', 'Daily movement burns more than one session a week.'] },
    sugar: { e: '🍬', i: 'check', fa: 'fa-check', bg: ['По-малко захар, сладки напитки и алкохол', 'Те се трупат най-лесно като мазнина и пречат на възстановяването.'], en: ['Less sugar, sweet drinks and alcohol', 'They turn into fat most easily and slow the recovery.'] },
    sitBreak: { e: '⏰', i: 'clock', fa: 'fa-clock', bg: ['Раздвижване на всеки час седене', 'Дългото седене стяга гърба и забавя кръвообращението.'], en: ['Move every hour of sitting', 'Long sitting stiffens the back and slows the circulation.'] },
    walkDay: { e: '🌳', i: 'user', fa: 'fa-person-walking', bg: ['20–30 минути ходене всеки ден', 'Ежедневното движение пази ефекта на тренировката до следващата.'], en: ['20–30 minutes of walking every day', 'Daily movement keeps the training\'s effect until the next one.'] },
    food: { e: '🥗', i: 'check', fa: 'fa-carrot', bg: ['Повече зеленчуци, риба и ядки — по-малко захар', 'Така храната не подклажда възпалението, което тренировката успокоява.'], en: ['More vegetables, fish and nuts — less sugar', 'This way food does not feed the inflammation the training calms.'] },
    noLift: { e: '🎒', i: 'check', fa: 'fa-check', bg: ['Без вдигане на тежко днес', 'Мускулите около гръбнака са уморени и днес пазят по-слабо.'], en: ['No heavy lifting today', 'The muscles around the spine are tired and protect less today.'] },
    pelvic: { e: '🌸', i: 'check', fa: 'fa-check', bg: ['Тазово дъно: 10 стягания, 3 пъти на ден', 'Кратките упражнения у дома засилват ефекта от процедурата.'], en: ['Pelvic floor: 10 lifts, 3 times a day', 'Short exercises at home add to the treatment\'s effect.'] },
    chair: { e: '🪑', i: 'user', fa: 'fa-chair', bg: ['Ставане от стола 10 пъти, няколко пъти на ден', 'Това е най-полезното упражнение за сила в ежедневието.'], en: ['Stand up from a chair 10 times, a few times a day', 'This is the most useful exercise for everyday strength.'] },
    dinner: { e: '🌙', i: 'fire', fa: 'fa-utensils', bg: ['Лека вечеря', 'Тренировката изгаря — голямото хранене след нея връща всичко.'], en: ['A light dinner', 'The training burns — a big meal after it gives it all back.'] },
    rest: { e: '🛋', i: 'clock', fa: 'fa-bed', bg: ['Днес без тежка тренировка', 'Процедурата е за възстановяване — тежкото натоварване ще я обезсмисли.'], en: ['No hard training today', 'The treatment is for recovery — hard training would undo it.'] },
    cream: { e: '🧴', i: 'drop', fa: 'fa-droplet', bg: ['Хидратиращ крем и слънцезащита', 'Грижата за кожата пази ефекта по-дълго.'], en: ['Moisturiser and sunscreen', 'Skin care keeps the effect longer.'] },
    meal: { e: '⏱', i: 'clock', fa: 'fa-clock', bg: ['Следващия път — 30–60 минути след хранене', 'Тогава захарта в кръвта е най-висока и процедурата я сваля най-много.'], en: ['Next time — 30–60 minutes after a meal', 'Then the blood sugar is highest and the treatment lowers it most.'] }
  };
  var PROG = {
    general: { f: 'tone' }, glutes: { f: 'tone' }, core: { f: 'tone' }, upper: { f: 'tone' },
    mass: { f: 'tone', b: ['proteinAll', 'sleep', 'sore'] },
    power: { f: 'tone', gap: [4, 7], wk: 1 },
    cardio: { f: 'slim', t: ['water', 'protein', 'dinner'] },
    back_active: { f: 'health', t: ['water', 'noLift', 'easy'], b: ['sitBreak', 'walkDay', 'sleep'] },
    senior: { f: 'health', b: ['chair', 'walkDay', 'proteinAll'], wk: 1 },
    antiage: { f: 'health', b: ['walkDay', 'sleep', 'food'], course: 16, name: 'Антиейджинг' },
    cellulite: { f: 'passive', t: ['waterP', 'salt', 'walkP'], b: ['water2', 'steps', 'sugar'], gap: [2, 3], course: 12, name: 'Антицелулит' },
    drain: { f: 'passive', t: ['waterP', 'salt', 'walkP'], b: ['water2', 'walkDay', 'sitBreak'], gap: [2, 3], course: 10, name: 'Дренаж' },
    passive_metabolic: { f: 'passive', b: ['deficit', 'steps', 'sugar'], gap: [2, 3], course: 12, name: 'Пасивен метаболизъм' },
    postpartum: { f: 'passive', t: ['waterP', 'walkP', 'noLift'], b: ['pelvic', 'sleep', 'walkDay'], gap: [3, 4], course: 12, name: 'След раждане' },
    back_pain: { f: 'passive', t: ['waterP', 'noLift', 'walkP'], b: ['sitBreak', 'walkDay', 'sleep'], gap: [3, 4], course: 10, name: 'Гръб', warn: 'back' },
    recovery: { f: 'passive', t: ['waterP', 'rest', 'walkP'], b: ['sleep', 'proteinAll', 'walkDay'], gap: [1, 2], wk: 1 },
    antiage_passive: { f: 'passive', t: ['waterP', 'walkP', 'food'], b: ['walkDay', 'sleep', 'meal'], gap: [2, 3], course: 12, name: 'Антиейджинг' },
    face: { f: 'passive', t: ['waterP', 'cream', 'sleep'], b: ['water2', 'sleep', 'cream'], gap: [2, 3], course: 12, name: 'Лице' }
  };
  var FAM = {
    tone: { t: ['water', 'protein', 'easy'], b: ['sleep', 'proteinAll', 'sore'], gap: [3, 4], active: true },
    slim: { t: ['water', 'protein', 'easy'], b: ['deficit', 'steps', 'sugar'], gap: [3, 4], active: true },
    health: { t: ['water', 'easy', 'protein'], b: ['sitBreak', 'walkDay', 'sleep'], gap: [3, 4], active: true },
    passive: { t: ['waterP', 'walkP', 'rest'], b: ['sleep', 'water2', 'walkDay'], gap: [2, 3], active: false }
  };
  /* the client's goal (profile / tablet) → the family when the program is not known */
  var GOALFAM = { tone: 'tone', fat: 'slim', cellulite: 'passive', drain: 'passive', massage: 'passive' };
  /* trainings recorded before the tablet sent the program's id (XEMS < 1.1.516): by the program's name */
  var BYNAME = {
    'Общо стягане и оформяне': 'general', 'Седалище и бедра': 'glutes', 'Мускулна маса': 'mass', 'Гърди, рамене и ръце': 'upper',
    'Талия и корем': 'core', 'Сила и бързина': 'power', 'Кардио-метаболитна': 'cardio', 'Здрав гръб и стойка': 'back_active',
    'Здрави мускули 50+': 'senior', 'Антиейджинг': 'antiage', 'Антицелулит': 'cellulite', 'Следродилно възстановяване': 'postpartum',
    'Дренаж': 'drain', 'Пасивен метаболизъм': 'passive_metabolic', 'Болки в гърба и кръста': 'back_pain',
    'Регенерация и релакс': 'recovery', 'Антиейджинг · процедура': 'antiage_passive'
  };
  /* one line for a notification 45 min after a booked hour, by the family / program */
  var NOTE = {
    active: 'Белтък до 2 часа след тренировката — яйца, извара, риба или боб.',
    drain: '1,5–2 л вода днес и по-малко сол — така ефектът продължава.',
    rest: 'Днес без тежка тренировка — процедурата е за възстановяване.',
    passive: 'Половин литър вода и 10–15 минути ходене — процедурата продължава да действа.'
  };

  /* the program's id of a session ({pid, p: program name}); every face program is "face" */
  function pidOf(x) {
    var id = (x && (x.pid || x.programId)) || (x && BYNAME[x.p || x.program]) || (x && /^Лице/.test(x.p || x.program || '') ? 'face' : '');
    return id && id.indexOf('face') === 0 ? 'face' : id || '';
  }
  /* everything about the advice for one session: pid, modes (bitmask, 8 = massage), the client's goal */
  function forSession(pid, modes, goal) {
    var P = PROG[pid] || null;
    var massageOnly = (modes & 8) && !(modes & 7);
    var fam = FAM[P ? P.f : massageOnly ? 'passive' : GOALFAM[goal] || 'tone'];
    return {
      id: pid, P: P, active: fam.active, today: (P && P.t) || fam.t, between: (P && P.b) || fam.b,
      gap: (P && P.gap) || fam.gap, wk: (P && P.wk) || (goal === 'massage' ? 1 : 2), warn: P && P.warn,
      note: fam.active ? NOTE.active : pid === 'drain' || pid === 'cellulite' ? NOTE.drain : pid === 'recovery' ? NOTE.rest : NOTE.passive
    };
  }
  root.XemsAdvice = { TIP: TIP, PROG: PROG, FAM: FAM, GOALFAM: GOALFAM, BYNAME: BYNAME, NOTE: NOTE, pidOf: pidOf, forSession: forSession };
})(typeof window !== 'undefined' ? window : globalThis);
