/**
 * Eatologix — резервният превод на интерфейса (POST /api/i18n/translate).
 *
 * Страниците са на български. Ръчният речник (i18n/<език>/*.json) превежда интерфейса;
 * каквото остане на кирилица (динамичен текст, планът, имената на храните, по-стари отговори
 * на AI) i18n.js праща тук. Преводът е с евтиния модел и се пази в KV завинаги, общ за всички:
 * всеки низ се превежда веднъж.
 *
 * Тяло: { lang: 'en'|'de'|'es', strings: ['…', …] } → { ok, translations: { '<bg>': '<превод>' } }
 */
export const I18N_LANGS = { en: 'English', de: 'German', es: 'Spanish' };
const MAX_STRINGS = 60;
const MAX_LEN = 700;
const CYR = /[Ѐ-ӿ]/;
const KV_PREFIX = 'i18n:v1:';

export function languageName(code) {
  return I18N_LANGS[String(code || '').toLowerCase()] || null;
}

/** Указание към AI: на кой език да пише всичко, което вижда клиентът (null за български). */
export function languageDirective(lang) {
  const name = languageName(lang);
  if (!name) return '';
  return `\n\nLANGUAGE: Write every text the client will read (names of meals and dishes, explanations, advice, chat replies) in ${name}. ` +
    `Keep JSON keys, field names, codes and numbers exactly as specified above. The product name is Eatologix.`;
}

async function keyOf(lang, text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${KV_PREFIX}${lang}:${hex}`;
}

function cleanList(raw) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    if (typeof s !== 'string') continue;
    const t = s.replace(/\s+/g, ' ').trim();
    if (!t || t.length > MAX_LEN || !CYR.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_STRINGS) break;
  }
  return out;
}

function buildPrompt(name, list) {
  return `You translate the interface and content of Eatologix, a nutrition app, from Bulgarian into ${name}.
Rules:
- Natural, short, friendly ${name}, addressing the reader informally (as the Bulgarian does with "ти").
- Keep numbers, units (g, kcal, ml, kg), emoji, punctuation at the edges, and anything inside {curly braces} unchanged.
- Food and dish names: the usual ${name} name; a Bulgarian dish with no equivalent keeps its name in Latin letters with a short gloss only if needed.
- "Eatologix" stays as is. Do not add quotes, notes or explanations.
Return ONLY a JSON array of strings with exactly ${list.length} items, in the same order.

${JSON.stringify(list)}`;
}

/**
 * deps: { callGemini(env, prompt, model, maxTokens, jsonMode), model, rateLimit(): Response|null, cors }
 */
export async function handleI18nTranslate(request, env, deps) {
  const headers = { ...(deps.cors || {}), 'Content-Type': 'application/json' };
  const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers });
  let body;
  try { body = await request.json(); } catch { return reply({ ok: false, error: 'bad_json' }, 400); }
  const lang = String(body?.lang || '').toLowerCase();
  const name = languageName(lang);
  if (!name) return reply({ ok: false, error: 'lang' }, 400);
  const list = cleanList(body?.strings);
  if (!list.length) return reply({ ok: true, translations: {} });

  const translations = {};
  const keys = await Promise.all(list.map((t) => keyOf(lang, t)));
  const kv = env.page_content;
  const cached = kv ? await Promise.all(keys.map((k) => kv.get(k).catch(() => null))) : list.map(() => null);
  const missing = [];
  list.forEach((t, i) => { if (cached[i] != null) translations[t] = cached[i]; else missing.push(i); });

  if (missing.length) {
    const limited = deps.rateLimit ? await deps.rateLimit() : null;
    if (limited) return reply({ ok: true, partial: true, translations });
    const todo = missing.map((i) => list[i]);
    try {
      const raw = await deps.callGemini(env, buildPrompt(name, todo), deps.model, 8192, true);
      const text = typeof raw === 'string' ? raw : (raw?.text || raw?.content || '');
      const arr = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, ''));
      if (Array.isArray(arr) && arr.length === todo.length) {
        const puts = [];
        todo.forEach((src, j) => {
          const tr = typeof arr[j] === 'string' ? arr[j].trim() : '';
          if (!tr || CYR.test(tr)) return; // непреведено — не се пази, ще се опита пак
          translations[src] = tr;
          if (kv) puts.push(kv.put(keys[missing[j]], tr).catch(() => {}));
        });
        await Promise.all(puts);
      }
    } catch (e) {
      console.warn('[i18n] translate failed:', e?.message || e);
      return reply({ ok: true, partial: true, translations });
    }
  }
  return reply({ ok: true, translations });
}
