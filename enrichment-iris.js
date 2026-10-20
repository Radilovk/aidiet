/**
 * AIRIS (ирисов анализ) → профил.
 *
 * Ирисовият анализ не е валидиран диагностичен метод, затова находките му не
 * стават клинични кодове и не менят калориите или менюто сами. Влизат като
 * контекст: фокус на системите, хранителните насоки на AIRIS и препоръчаните
 * изследвания — за специалиста, чат асистента и гласа на плана.
 *
 * Изключение са бележките за безопасност, които AIRIS извежда от въпросника
 * си (бременност, бъбреци, автоимунно) и насочването към очен лекар: те стават
 * бележки за специалиста, защото се отнасят до човека, не до ириса.
 */

const REFERRAL_TEXT = {
  urgent: 'AIRIS: по снимката на окото — към очен лекар без отлагане.',
  soon: 'AIRIS: по снимката на окото — преглед при очен лекар в близките седмици.',
};

/** @param {any[]} facts */
export function deriveIris(facts) {
  const fact = (facts || [])
    .filter(f => f.kind === 'iris' && f.status !== 'pending' && f.value?.analysis)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!fact) return null;
  const a = fact.value.analysis;
  const focus = (a.systems || []).filter(s => s.priority).map(s => s.label || s.key).slice(0, 3);
  const cautions = [
    ...(a.notices || []).map(n => `AIRIS: ${n.title}${n.body ? ` — ${n.body}` : ''}`),
    REFERRAL_TEXT[a.eyeReferral] || '',
  ].filter(Boolean);
  return {
    summary: {
      at: fact.at,
      constitution: a.constitution || '',
      focus,
      drivers: (a.drivers || []).slice(0, 5).map(d => d.action || d.observation),
      eatMore: (a.eatMore || []).slice(0, 8),
      eatLess: (a.eatLess || []).slice(0, 8),
      recommendedTests: (a.recommendedTests || []).slice(0, 6),
      complaints: fact.value.complaints || '',
    },
    hints: { behaviors: [], approach: [], clinical: [], cautions },
    reasons: ['ирисов анализ (AIRIS)'],
    // За сверката с NutriPlan (cross-check.js) — не излиза към клиента.
    raw: { systems: a.systems || [], questionnaire: fact.value.questionnaire || null },
  };
}

/** Кратък текст за картона и чата. */
export function irisText(s) {
  if (!s) return '';
  const parts = [
    `ирисов анализ ${String(s.at || '').slice(0, 10)}`,
    s.constitution ? `конституция: ${s.constitution}` : '',
    s.focus.length ? `фокус: ${s.focus.join(', ')}` : '',
    s.drivers.length ? `насоки: ${s.drivers.join('; ')}` : '',
    s.eatMore.length ? `повече: ${s.eatMore.join(', ')}` : '',
    s.eatLess.length ? `по-малко: ${s.eatLess.join(', ')}` : '',
    s.recommendedTests.length ? `изследвания: ${s.recommendedTests.join(', ')}` : '',
    s.complaints ? `оплаквания: ${s.complaints}` : '',
  ].filter(Boolean);
  return parts.join('; ').slice(0, 900);
}
