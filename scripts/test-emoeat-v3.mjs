// EmoEat v3: банката, вариантите, начисляването, архетипите и обобщението за плана.
//   node scripts/test-emoeat-v3.mjs [--dist]   (--dist печата разпределенията за калибриране)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V3 = require('../emoeat-v3.js');
const { deriveEmoEat } = await import('../enrichment-emoeat.js');

let fail = 0;
const ok = (cond, msg) => { if (!cond) { console.error('✗ ' + msg); fail++; } };
const SHOW = process.argv.includes('--dist');

// Всички комбинации на контекста, които сменят сцени.
const SEXES = ['F', 'M', 'X'];
const AGES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];            // u13 … 65+
const OCCS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const HOMES = ['A', 'B', 'C', 'D', 'E', 'F'];
const set = (meta, id, key) => { meta[id] = { optionKey: key, optionKeys: [key], loads: {}, extra: '' }; };
function ctxMetas() {
  const out = [];
  for (const s of SEXES) for (const a of AGES) for (const o of OCCS) for (const h of HOMES) {
    const m = {}; set(m, 201, s); set(m, 202, a); set(m, 203, o); set(m, 204, h); set(m, 205, 'K0'); out.push(m);
  }
  return out;
}

// 1. Текстовете: без думи за храна, тяло, тегло, вина; без наклонени черти (родът е от началото).
const FORBIDDEN = /(^|[^а-я])(хран|ям(?![а-я])|яде|яж|глад|тегл|килогр|диет|калори|вина|виновн|преяжд|контрол|срив|проблем|емоци|признай)/i;
const ALLOWED_ONCE = /нещо сладко|нещо вкусно/;     // скритите изключения във въпросите за детството
const seen = new Set();
for (const meta of ctxMetas()) {
  const ctx = V3.contextFrom(meta, {});
  for (const q of V3.buildFlow(ctx)) {
    if (q.health) continue;
    const texts = [q.text, q.hint || '', ...q.options.map(o => o.text)];
    for (const t of texts) {
      if (seen.has(t)) continue; seen.add(t);
      const clean = t.replace(ALLOWED_ONCE, '');
      ok(!FORBIDDEN.test(clean), `забранена дума във въпрос ${q.id}: „${t}“`);
      ok(!/[а-я]\/[а-я]/i.test(t), `наклонена черта във въпрос ${q.id}: „${t}“`);
      ok(!/ — .* — /.test(t), `двойно тире във въпрос ${q.id}: „${t}“`);
    }
  }
}

// 2. Вариантите на една сцена пазят ключовете и тежестите.
const sig = q => JSON.stringify(q.options.map(o => [o.key, o.loads]));
const byId = new Map();
for (const meta of ctxMetas()) {
  for (const q of V3.buildFlow(V3.contextFrom(meta, {}))) {
    if (q.intake || q.health) continue;
    const s = sig(q);
    if (!byId.has(q.id)) byId.set(q.id, s);
    else ok(byId.get(q.id) === s, `въпрос ${q.id}: вариантите имат различни ключове или тежести`);
  }
}
ok(byId.size >= 13, `банката е твърде малка: ${byId.size}`);
// Дължината: над ~18 екрана част от хората спират (EMOEAT_V3_CALIBRATION.md, „Дължина“).
for (const meta of ctxMetas()) {
  const n = V3.buildFlow(V3.contextFrom(meta, {})).length;
  ok(n <= 17, `потокът е ${n} екрана — по-дълъг от 17`);
}

// 3. Основните черти (най-силните предиктори) — поне два въпроса; останалите — поне един.
const CORE = ['URG', 'CLR', 'AVO', 'CRIT', 'DIC', 'RUM'];
for (const meta of ctxMetas().filter((_, i) => i % 7 === 0)) {
  const flow = V3.buildFlow(V3.contextFrom(meta, {}));
  for (const t of V3.TRAIT_IDS) {
    const n = flow.filter(q => !q.intake && !q.health && q.options.some(o => (o.loads || {})[t])).length;
    ok(n >= (CORE.includes(t) ? 2 : 1), `черта ${t} има само ${n} въпроса`);
  }
  ok(new Set(flow.map(q => q.id)).size === flow.length, 'повтарящи се id в потока');
  ok(flow.every(q => Number.isInteger(q.id) && q.id < 1000), 'id трябва да е число до 999 (сървърът приема само такива ключове)');
}

// 4. Симулация: случайни отговори → разпределение на нивата и архетипите.
function rng(seed) { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
const rand = rng(7);
function simulate(n, bias) {
  const levels = {}, archs = {};
  for (let i = 0; i < n; i++) {
    const meta = {}; set(meta, 201, SEXES[i % 3]); set(meta, 202, AGES[2 + (i % 6)]); set(meta, 203, OCCS[i % 7]);
    const flow = V3.buildFlow(V3.contextFrom(meta, {}));
    for (const q of flow) {
      if (q.intake || q.health || q.realNeed) continue;
      // bias < 1: по-често спокойният отговор (реалните хора не отговарят равномерно)
      const calm = q.options.filter(o => !Object.keys(o.loads || {}).length);
      const pickCalm = calm.length && rand() > bias;
      const pool = pickCalm ? calm : q.options;
      const o = pool[Math.floor(rand() * pool.length)];
      set(meta, q.id, o.key);
    }
    const a = V3.analyze(meta, {});
    levels[a.riskLevel] = (levels[a.riskLevel] || 0) + 1;
    const name = a.archetype ? a.archetype.name : V3.CALM.name;
    archs[name] = (archs[name] || 0) + 1;
  }
  const pct = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v / n * 100)]));
  return { levels: pct(levels), archs: pct(archs) };
}
const uniform = simulate(6000, 1);
const realistic = simulate(6000, 0.55);
if (SHOW) console.log('равномерно:', uniform, '\nс превес на спокойните:', realistic);
// Случайни отговори не бива да дават почти само „силно“, нито почти само „слабо“.
ok((uniform.levels['Силно'] || 0) < 60 && (uniform.levels['Слабо'] || 0) < 60, `равномерните отговори са изкривени: ${JSON.stringify(uniform.levels)}`);
ok((realistic.levels['Слабо'] || 0) > (realistic.levels['Силно'] || 0), `при превес на спокойните отговори „силно“ е повече от „слабо“: ${JSON.stringify(realistic.levels)}`);
// Никой архетип не доминира по конструкция и всеки се среща.
for (const a of V3.ARCHETYPES) {
  const v = uniform.archs[a.name] || 0;
  ok(v >= 2 && v <= 35, `архетипът „${a.name}“ е в ${v}% от равномерните профили (очаквано 2–35%)`);
}

// 5. Еталонни профили → очакван резултат.
function answerFor(target) {
  const meta = {}; set(meta, 201, 'F'); set(meta, 202, 'D'); set(meta, 203, 'A'); set(meta, 204, 'B'); set(meta, 205, 'K0');
  const flow = V3.buildFlow(V3.contextFrom(meta, {}));
  for (const q of flow) {
    if (q.intake || q.health || q.realNeed) continue;
    // най-силният отговор за целевите черти, иначе спокойният
    let best = null, bestV = 0;
    for (const o of q.options) { const v = target.reduce((s, t) => s + ((o.loads || {})[t] || 0), 0); if (v > bestV) { bestV = v; best = o; } }
    const calm = q.options.find(o => !Object.keys(o.loads || {}).length) || q.options[0];
    set(meta, q.id, (best || calm).key);
  }
  return meta;
}
const cases = [
  [['URG', 'REW'], 'Импулсът'], [['LONE', 'ATT', 'SOOTHE'], 'Утехата'], [['AVO', 'RUM'], 'Паузата'],
  [['CRIT'], 'Строгият глас'], [['BOR', 'LOAD', 'REW'], 'Искрата'], [['DIC', 'URG'], 'Махалото'], [['RIG', 'CRIT'], 'Редът']
];
for (const [traits, expected] of cases) {
  const a = V3.analyze(answerFor(traits), {});
  ok(a.archetype && a.archetype.name === expected, `профил ${traits.join('+')}: очакван „${expected}“, получен „${a.archetype ? a.archetype.name : V3.CALM.name}“ (склонност ${a.risk})`);
}
const calmMeta = answerFor([]);
const calm = V3.analyze(calmMeta, {});
ok(!calm.archetype && calm.riskLevel === 'Слабо', `спокойни отговори → „Спокоен апетит“, получено ${calm.archetype && calm.archetype.name} / ${calm.riskLevel}`);

// 6. Контекстът: ADHD сваля тежестта на бързата реакция; минали трудности → без архетип; тийнейджър → без здраве.
const imp = answerFor(['URG', 'REW']);
const r0 = V3.analyze(imp, {}).risk;
imp[301] = { optionKey: 'H', optionKeys: ['H'], loads: {}, extra: '' };
const r1 = V3.analyze(imp, {}).risk;
ok(r1 < r0, `ADHD трябва да сваля склонността при бърза реакция (${r0} → ${r1})`);
const ed = answerFor(['CRIT', 'DIC']);
ed[301] = { optionKey: 'J', optionKeys: ['J'], loads: {}, extra: '' };
const edA = V3.analyze(ed, {});
ok(edA.safety.level === 'specialist' && !edA.archetype, 'минали трудности с храненето → специалист, без архетип');
const teen = answerFor(['CRIT', 'DIC', 'AVO']); set(teen, 202, 'B');
const teenA = V3.analyze(teen, {});
ok(teenA.ctx.teen && !teenA.flow.some(q => q.health), 'тийнейджър: без здравен въпрос');
ok(teenA.safety.level === 'teen', `тийнейджър с рисково съчетание → блокът с линията за деца (получено ${teenA.safety.level})`);
ok(!V3.payload(teenA, { withHealth: true }).health, 'тийнейджър: здравето не излиза в обобщението');

// 7. Обобщението пази формата на v2 и минава през enrichment-emoeat.js.
const pl = V3.payload(V3.analyze(answerFor(['DIC', 'RIG', 'URG']), {}), {});
ok(pl.archetype && typeof pl.archetype.name === 'string' && Array.isArray(pl.drivers) && Array.isArray(pl.behaviors), 'формата на обобщението');
ok(!('health' in pl), 'без withHealth здравето не излиза');
const d = deriveEmoEat([{ kind: 'emoeat', value: pl, at: new Date().toISOString() }]);
ok(d && d.voice && d.voice.archetype === pl.archetype.name, 'enrichment-emoeat чете обобщението на v3');
ok(d.hints.cautions.some(c => /ограничаващ/.test(c)), 'ограничаващият модел стига до бележките за плана');

// 8. Родът в българския текст.
ok(V3.genderize('Яж седнал/а, гладен/на ли съм, спокоен/на', 'f') === 'Яж седнала, гладна ли съм, спокойна', 'род: жена');
ok(V3.genderize('Яж седнал/а, гладен/на ли съм', 'm') === 'Яж седнал, гладен ли съм', 'род: мъж');
ok(V3.genderize('седнал/а', 'x') === 'седнал/а', 'род: неутрално');

if (fail) { console.error(`\n${fail} проблема`); process.exit(1); }
console.log(`✓ EmoEat v3: ${byId.size} въпроса, ${V3.TRAIT_IDS.length} черти, ${V3.ARCHETYPES.length} архетипа; разпределението и еталонните профили са наред`);
