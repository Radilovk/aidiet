/** Strip markdown artifacts AI sometimes leaks into plain-text strategy fields. */
export function sanitizePlainTextField(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeStrategyFields(strategy) {
  if (!strategy || typeof strategy !== 'object') return strategy;
  for (const key of [
    'welcomeMessage', 'planJustification', 'longTermStrategy',
    'mealCountJustification', 'afterDinnerMealJustification',
    'modifierReasoning', 'hydrationStrategy',
  ]) {
    if (typeof strategy[key] === 'string') {
      strategy[key] = sanitizePlainTextField(strategy[key]);
    }
  }
  return strategy;
}
