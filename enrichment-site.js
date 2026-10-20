/**
 * Тестът за протокол от daotslabna.com / life-protocols.com → профил.
 *
 * При нов клиент отговорите попълват въпросника. При вече съществуващ профил
 * въпросникът не се отваря — тогава отговорите влизат тук: като контекст за
 * специалиста и чат асистента, а лекарствата, бременността и бъбреците /
 * черният дроб — като бележки за безопасност. Менюто и калориите не се
 * менят от тях (те идват от профила на NutriPlan).
 */

/** @param {any[]} facts */
export function deriveSiteQuiz(facts) {
  const fact = (facts || [])
    .filter(f => f.kind === 'site_quiz' && f.status !== 'pending' && f.value)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!fact) return null;
  const v = fact.value;
  return {
    summary: { at: fact.at, site: v.site || '', lines: v.lines || [] },
    hints: { behaviors: [], approach: [], clinical: [], cautions: (v.cautions || []).map(c => `${v.site}: ${c}`) },
    reasons: [`тест от ${v.site}`],
  };
}

/** Кратък текст за картона и чата. */
export function siteQuizText(s) {
  if (!s || !s.lines.length) return '';
  return `тест от ${s.site} ${String(s.at || '').slice(0, 10)}: ${s.lines.join('; ')}`.slice(0, 700);
}
