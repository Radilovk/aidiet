/**
 * Уточняващите въпроси в чата.
 *
 * Отворените въпроси за разминаване (cross-check.js) не се задават наслуки:
 * въпросът стига до асистента само когато е свързан с това, за което
 * клиентът пише в момента (ключови думи по темата), или когато асистентът го
 * е задал в предишния си отговор и клиентът отговаря.
 *
 * Асистентът маркира: [ASK:<id>] — задава въпроса; [RESOLVE:<id>=<стойност>]
 * — клиентът вече е отговорил ясно. Маркерите се махат от текста; приема се
 * само id на подаден въпрос и стойност от неговите опции. Записът минава през
 * /api/enrichment/resolve, който проверява въпроса още веднъж.
 */

const TOPIC_WORDS = {
  // \b в JS е само за латиница — за кирилицата границите са изрични.
  'iris:digestive': /подув|газ(ове|ов)?(?![а-я])|тежест|киселин|запек|диари|стомах|корем|храносмил|черв|изхожд/i,
  'iris:metabolic': /кръвна захар|захарта ми|инсулин|вълчи глад|силен глад|сънлив|холестерол|триглицерид|не отслабвам|не свалям|плато/i,
  'iris:nervous': /стрес|напрежени|тревож|умор|изтощ|нерви|безсъни|не спя|сънят ми/i,
  meds: /лекарств|хапче|таблетк|медикамент/i,
  weight: /тегло|теглото|килограм|(?<![а-я])кг(?![а-я])|везна|претегл/i,
  steps_source: /крач|крачкомер|гривн|часовник|смарт ?часовник|фитнес тракер/i,
  emoeat_vs_q: /емоци|преяжд|от скука|когато съм напрегнат|не мога да спра|нощем ям|ям вечер|посягам/i,
};

const PATTERN_WORDS = /веган|вегетариан|месо|растителн/i;
const ALLERGY_WORDS = /алерги|непоносим/i;
const ALLERGY_RELATED = { лактоза: /мляко|млечн|сирене|кисело мляко/i, глутен: /глутен|хляб|пшениц|тестен/i };

const stem = (s) => String(s || '').toLowerCase().replace(/[^a-zа-я0-9]/gi, '').slice(0, 5);

function matches(q, text) {
  // „weight:80“, „meds:no“ — въпросът е вързан за стойността в NutriPlan; темата е частта преди „:“.
  const topic = TOPIC_WORDS[q.id] ? q.id : q.id.split(':')[0];
  if (topic === 'weight' || topic === 'meds' || TOPIC_WORDS[q.id]) {
    if (TOPIC_WORDS[topic].test(text)) return true;
    if (topic === 'meds') {
      const name = stem((q.text.match(/„([^“]+)“/) || [])[1]);
      return name.length >= 4 && text.toLowerCase().includes(name);
    }
    return false;
  }
  if (q.id.startsWith('pattern:')) return PATTERN_WORDS.test(text);
  if (q.id.startsWith('allergy:')) {
    const term = q.id.slice('allergy:'.length).replace(/_/g, ' ');
    const s = stem(term);
    return ALLERGY_WORDS.test(text) || (s.length >= 4 && text.toLowerCase().includes(s)) || !!ALLERGY_RELATED[term]?.test(text);
  }
  return false;
}

/** Валидни въпроси от клиента (същата форма като от сървъра). */
export function sanitizeQuestions(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 6).filter(q =>
    q && typeof q.id === 'string' && /^[a-z_]+(:[\p{L}\p{N}_]+)?$/u.test(q.id)
    && typeof q.text === 'string' && Array.isArray(q.options) && q.options.length >= 2
    && q.options.every(o => o && typeof o.value === 'string' && typeof o.label === 'string'),
  ).map(q => ({
    id: q.id, source: String(q.source || ''), topic: String(q.topic || '').slice(0, 60), text: q.text.slice(0, 400),
    options: q.options.slice(0, 4).map(o => ({ value: o.value.slice(0, 20), label: o.label.slice(0, 60) })),
  }));
}

/**
 * Въпросът, свързан с текущото съобщение (най-много един — един въпрос на ход).
 * @param {object[]} questions
 * @param {string} message
 * @param {string} [askedId] въпросът, зададен в предишния отговор
 */
export function relevantQuestion(questions, message, askedId = '') {
  const text = String(message || '');
  return questions.find(q => q.id === askedId) || questions.find(q => matches(q, text)) || null;
}

/** Блокът за промпта на асистента. */
export function clarifyPromptBlock(q, { asked = false } = {}) {
  const opts = q.options.map(o => `${o.value} = „${o.label}“`).join('; ');
  return `

[УТОЧНЯВАЩ ВЪПРОС — разминаване между източниците]
Тема: ${q.topic}. ${q.text}
Позволени отговори: ${opts}
${asked ? 'Този въпрос вече е в предишния ти отговор.\n' : ''}- Ако последното съобщение на клиента ЯСНО отговаря на въпроса, отговорете нормално и добавете в самия край маркер [RESOLVE:${q.id}=<стойност>] с една от позволените стойности. Не питайте отново.
- Ако не отговаря ясно, но темата е свързана, задайте въпроса естествено, с ваши думи, в края на отговора и добавете маркер [ASK:${q.id}].
- Не измисляйте отговор вместо клиента. При съмнение — питайте. Маркерите не се виждат от клиента.`;
}

/**
 * Маха маркерите и връща какво е маркирал асистентът — само ако е валидно.
 * @returns {{ text: string, resolved: { id: string, value: string, label: string } | null, asked: string | null }}
 */
export function extractClarify(text, q) {
  let out = String(text || '');
  let resolved = null;
  let asked = null;
  const re = /\[(RESOLVE|ASK):([^\]=]+)(?:=([^\]]+))?\]/g;
  let m;
  while ((m = re.exec(out))) {
    const [, kind, id, value] = m;
    if (!q || id.trim() !== q.id) continue;
    if (kind === 'RESOLVE') {
      const opt = q.options.find(o => o.value === String(value || '').trim());
      if (opt) resolved = { id: q.id, value: opt.value, label: opt.label };
    } else {
      asked = q.id;
    }
  }
  out = out.replace(/\s*\[(RESOLVE|ASK):[^\]]*\]/g, '').trim();
  if (resolved) asked = null;
  return { text: out, resolved, asked };
}
