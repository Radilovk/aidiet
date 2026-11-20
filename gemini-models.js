/**
 * Gemini модели — пренасочванията на Google и цените (общо за worker-ите и spend.js).
 *
 * Google не спира старите имена, а ги пренасочва към нов модел (с други правила за
 * мисленето: thinkingLevel вместо thinkingBudget). Старо име, записано в админа или в
 * променлива, се сменя тук с наследника му, за да вървят заявката, мисленето и цената
 * по реалния модел. Източник: aistudio.google.com/docs/deprecations (ноември 2026).
 */
export const GEMINI_REROUTES = {
  'gemini-2.5-flash': 'gemini-3.5-flash-lite', // пренасочен от 1.12.2026
  'gemini-2.5-pro': 'gemini-3.8-flash', // пренасочен от 1.12.2026
  'gemini-3.7-flash': 'gemini-3.8-flash', // пренасочен от 8.10.2026
  'gemini-3.5-flash': 'gemini-3.6-flash', // пренасочен от 8.10.2026
  // Спрени модели — без замяна заявката се отказва.
  'gemini-2.0-flash': 'gemini-3.5-flash-lite',
  'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite-preview': 'gemini-3.5-flash-lite',
  'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
};

/** Името, което реално да се извика (без „models/“, след пренасочванията). */
export function resolveGeminiModel(modelName) {
  const name = String(modelName || '').trim().replace(/^models\//, '');
  return GEMINI_REROUTES[name.toLowerCase()] || name;
}

// USD за 1M токена: [вход, изход (вкл. мислене), кеширан вход]. Платен план, Standard.
const JAN_2027 = Date.UTC(2027, 0, 1);
const FLASH_2026 = [0.75, 3.75, 0.075];
const FLASH_2027 = [1.5, 7.5, 0.15]; // 3.6/3.8 Flash поскъпват двойно от 1.1.2027
const PRICES = {
  'gemini-3.5-flash-lite': [0.3, 2.5, 0.03],
  'gemini-3.1-pro-preview': [2.5, 15, 0.25], // консервативно (по-високата от известните)
};
const DEFAULT_PRICE = [2, 10, 0.2];

/** Цена на модела към даден момент: [вход, изход, кеширан вход] за 1M токена. */
export function geminiPrice(modelName, now = Date.now()) {
  const model = resolveGeminiModel(modelName);
  if (model === 'gemini-3.6-flash' || model === 'gemini-3.8-flash') {
    return now >= JAN_2027 ? FLASH_2027 : FLASH_2026;
  }
  return PRICES[model] || DEFAULT_PRICE;
}

/**
 * „Без мислене“ за модела: Gemini 3+ приема само ниво (thinkingLevel: 'minimal' — може да
 * изхарчи малко токени за мислене, затова reserve се добавя към maxOutputTokens);
 * Gemini 2.5 Flash — бюджет 0.
 * @returns {{ thinkingConfig: object, reserve: number }}
 */
export function noThinking(modelName) {
  const model = resolveGeminiModel(modelName);
  if (/gemini-(?:[3-9]|\d{2,})(?:[.\-]|$)/i.test(model)) {
    return { thinkingConfig: { thinkingLevel: /pro/i.test(model) ? 'low' : 'minimal' }, reserve: 512 };
  }
  return { thinkingConfig: { thinkingBudget: 0 }, reserve: 0 };
}
