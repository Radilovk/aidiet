/**
 * Други документи → профил: епикриза, медицинско писмо, рецепта, резултат от
 * образно изследване, бележка от лекар, собствени бележки на клиента.
 *
 * AI преценява документа (POST /api/enrichment/assess-document) и предлага
 * какво от него засяга плана — само в затворен речник: клинични кодове,
 * изключени храни, бележки за специалиста. Нищо не влиза без потвърждение на
 * клиента; потвърденото се записва като факт „document“ и тук се превежда в
 * същите подсказки, както изследванията и EmoEat.
 */

import { CLINICAL, EXCLUSIONS } from './profile-code.js';

/** Колко засяга плана: само контекст → меню → стратегия и калории. */
export const DOCUMENT_IMPACT = ['none', 'context', 'menu', 'strategy'];

const DOC_TYPES = ['epicrisis', 'doctor_note', 'prescription', 'imaging', 'lab', 'allergy', 'own_note', 'other'];
const DOC_TYPE_LABELS = {
  epicrisis: 'епикриза',
  doctor_note: 'медицинско писмо',
  prescription: 'рецепта',
  imaging: 'образно изследване',
  lab: 'лабораторно изследване',
  allergy: 'алергологичен тест',
  own_note: 'бележка на клиента',
  other: 'документ',
};

const strs = (a, n, len) => (Array.isArray(a) ? a.map(x => String(x ?? '').trim().slice(0, len)).filter(Boolean).slice(0, n) : []);

/**
 * Свежда оценката (от AI или от клиента) до позволеното. Непознатите кодове отпадат.
 * @param {any} v
 */
export function normalizeDocumentValue(v) {
  if (!v || typeof v !== 'object') return null;
  const value = {
    title: String(v.title || '').trim().slice(0, 80),
    docType: DOC_TYPES.includes(v.docType) ? v.docType : 'other',
    summary: String(v.summary || '').trim().slice(0, 600),
    findings: strs(v.findings, 8, 200),
    clinical: strs(v.clinical, 6, 8).filter(c => CLINICAL.includes(c)),
    exclusions: strs(v.exclusions, 6, 8).filter(c => EXCLUSIONS.includes(c)),
    medications: strs(v.medications, 8, 80),
    cautions: strs(v.cautions, 5, 200),
    impact: DOCUMENT_IMPACT.includes(v.impact) ? v.impact : 'context',
  };
  if (!value.summary && !value.findings.length) return null;
  return value;
}

/** @param {any[]} facts */
export function deriveDocuments(facts) {
  const docs = (facts || [])
    .filter(f => f.kind === 'document' && f.status !== 'pending' && f.value)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 20);
  if (!docs.length) return null;
  const hints = { behaviors: [], approach: [], clinical: [], cautions: [], exclusions: [] };
  const list = [];
  for (const f of docs) {
    const v = f.value;
    hints.clinical.push(...(v.clinical || []));
    hints.exclusions.push(...(v.exclusions || []));
    hints.cautions.push(...(v.cautions || []).map(c => `Документ (${DOC_TYPE_LABELS[v.docType] || 'документ'}): ${c}`));
    list.push({
      id: f.key, at: f.at, title: v.title || DOC_TYPE_LABELS[v.docType] || 'Документ', docType: v.docType,
      summary: v.summary, findings: v.findings || [], clinical: v.clinical || [], exclusions: v.exclusions || [],
      medications: v.medications || [], impact: v.impact,
    });
  }
  for (const k of Object.keys(hints)) hints[k] = [...new Set(hints[k])];
  return { list, hints, reasons: [`документи: ${docs.length}`] };
}

/** Кратък текст за картона на специалиста и чата. */
export function documentsText(list) {
  if (!list?.length) return '';
  return 'документи: ' + list.slice(0, 6).map(d => {
    const parts = [d.title, String(d.at || '').slice(0, 10), d.summary, d.medications.length ? `лекарства: ${d.medications.join(', ')}` : ''].filter(Boolean);
    return parts.join(' — ');
  }).join('; ').slice(0, 1200);
}
