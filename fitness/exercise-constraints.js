/**
 * Hard-veto върху каталога — същите constraints.exclusions като в промпта,
 * приложени детерминистично върху catalog entries (не post-hoc audit).
 */
import { normalizeText, tokenize } from './normalize.js';

const CHEST_IMPLANT_RE = /bench|fly|chest press|push-?up|pec deck|crossover|dip|пек.?дек|избутване от лежанка|лъжичк/i;
const LATERAL_RAISE_RE = /lateral raise|side raise|страничн/i;

/** @param {object} entry @param {string[]} exclusions */
export function passesConstraintExclusions(entry, exclusions = []) {
  if (!exclusions?.length || !entry) return true;
  const name = String(entry.name || entry.canonicalName || '');
  const nameNorm = normalizeText(name);
  const blob = exclusions.join(' ').toLowerCase();

  if (/имплант|гърди не|без натиск върху гърдите/i.test(blob) && CHEST_IMPLANT_RE.test(name)) {
    return false;
  }
  const avoidLateral = /страничн/i.test(blob) || exclusions.some((e) => /не желае.*страничн/i.test(e));
  if (avoidLateral && LATERAL_RAISE_RE.test(name)) {
    return false;
  }
  if (/бременност|кърмене/i.test(blob) && /\b(crunch|sit-?up|push-?up|bench|burpee|jump|plyo)\b/i.test(name)) {
    return false;
  }

  for (const line of exclusions) {
    const avoid = line.match(/не желае[^:]*:\s*(.+)/i);
    if (avoid) {
      const tokens = tokenize(avoid[1]).filter((t) => t.length > 3);
      if (tokens.some((t) => nameNorm.includes(t))) return false;
    }
    const limit = line.match(/ограничение:\s*(.+)/i);
    if (limit) {
      const zoneTokens = tokenize(limit[1]).filter((t) => t.length > 3);
      if (zoneTokens.length && zoneTokens.some((t) => nameNorm.includes(t))) return false;
    }
  }
  return true;
}
