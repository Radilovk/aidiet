/**
 * Изследвания → профил. Прагове в код, не в AI: всеки показател се превежда
 * в каноничната си единица и се сравнява с общоприетите граници за възрастни.
 *
 * Резултатът не е диагноза. Показател извън нормата включва хранителните
 * правила на съответното състояние като предпазна мярка и бележка за
 * специалиста; диагноза поставя лекар. Влизат само потвърдени стойности
 * (status ≠ pending) от последните 12 месеца — последната за всеки показател.
 */

const DAY_MS = 86400000;

/** Канонична единица и преобразуване от честите алтернативни. */
const MARKERS = {
  glucose: { label: 'Глюкоза на гладно', unit: 'mmol/L', alt: { 'mg/dl': v => v / 18 } },
  hba1c: { label: 'HbA1c', unit: '%', alt: { 'mmol/mol': v => v / 10.929 + 2.15 } },
  ldl: { label: 'LDL холестерол', unit: 'mmol/L', alt: { 'mg/dl': v => v / 38.67 } },
  hdl: { label: 'HDL холестерол', unit: 'mmol/L', alt: { 'mg/dl': v => v / 38.67 } },
  tchol: { label: 'Общ холестерол', unit: 'mmol/L', alt: { 'mg/dl': v => v / 38.67 } },
  tg: { label: 'Триглицериди', unit: 'mmol/L', alt: { 'mg/dl': v => v / 88.57 } },
  uric: { label: 'Пикочна киселина', unit: 'µmol/L', alt: { 'mg/dl': v => v * 59.48 } },
  ferritin: { label: 'Феритин', unit: 'µg/L', alt: { 'ng/ml': v => v } },
  hgb: { label: 'Хемоглобин', unit: 'g/L', alt: { 'g/dl': v => v * 10 } },
  vitd: { label: 'Витамин D (25-OH)', unit: 'nmol/L', alt: { 'ng/ml': v => v * 2.496 } },
  b12: { label: 'Витамин B12', unit: 'pmol/L', alt: { 'pg/ml': v => v * 0.7378 } },
  alt: { label: 'ALT (АЛАТ)', unit: 'U/L', alt: {} },
  ggt: { label: 'GGT', unit: 'U/L', alt: {} },
  tsh: { label: 'TSH', unit: 'mIU/L', alt: { 'µiu/ml': v => v, 'uiu/ml': v => v } },
  egfr: { label: 'eGFR', unit: 'mL/min/1.73m²', alt: {} },
  potassium: { label: 'Калий', unit: 'mmol/L', alt: { 'meq/l': v => v } },
};

export const LAB_MARKERS = Object.fromEntries(Object.entries(MARKERS).map(([k, v]) => [k, { label: v.label, unit: v.unit }]));

/**
 * Границите, по които RULES решава „в норма“ — за графиката на страницата
 * „Анализ“ (стойността върху нормалния диапазон). null = без граница от тази страна.
 * @param {string} key
 * @param {'M'|'F'|'X'} [sex]
 * @returns {[number|null, number|null] | null}
 */
export function labRange(key, sex = 'X') {
  const f = sex === 'F';
  const ranges = {
    glucose: [null, 5.6], hba1c: [null, 5.7], ldl: [null, 3.4], tchol: [null, 5.2], tg: [null, 1.7],
    hdl: [f ? 1.3 : 1.0, null], uric: [null, f ? 360 : 420], ferritin: [30, null], hgb: [f ? 120 : 130, null],
    vitd: [50, null], b12: [150, null], alt: [null, 40], ggt: [null, 60], tsh: [0.4, 4.5], egfr: [60, null], potassium: [null, 5.5],
  };
  return ranges[key] || null;
}

function canonical(key, value, unit) {
  const m = MARKERS[key];
  if (!m) return null;
  const u = String(unit || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!u || u === m.unit.toLowerCase().replace(/\s+/g, '')) return value;
  const conv = m.alt[u];
  return conv ? conv(value) : value;
}

/**
 * @param {number} v — в каноничната единица
 * @param {'M'|'F'|'X'} sex
 * @returns {null | { status: 'high'|'low', clinical?: string[], caution?: string, supplement?: object, safety?: object, urgent?: boolean }}
 */
const RULES = {
  glucose: (v) => (v >= 7.0
    ? { status: 'high', clinical: ['IR'], caution: 'Глюкоза на гладно в диабетния диапазон — за потвърждение и проследяване от лекар.' }
    : v >= 5.6 ? { status: 'high', clinical: ['IR'] } : null),
  hba1c: (v) => (v >= 6.5
    ? { status: 'high', clinical: ['IR'], caution: 'HbA1c в диабетния диапазон — за потвърждение и проследяване от лекар.' }
    : v >= 5.7 ? { status: 'high', clinical: ['IR'] } : null),
  ldl: (v) => (v >= 3.4 ? { status: 'high', clinical: ['DYSL'] } : null),
  tchol: (v) => (v >= 5.2 ? { status: 'high', clinical: ['DYSL'] } : null),
  tg: (v) => (v >= 1.7 ? { status: 'high', clinical: ['DYSL'] } : null),
  hdl: (v, sex) => (v < (sex === 'F' ? 1.3 : 1.0) ? { status: 'low' } : null),
  uric: (v, sex) => (v > (sex === 'F' ? 360 : 420)
    ? { status: 'high', clinical: ['GOUT'], caution: 'Повишена пикочна киселина — ограничени пурини и алкохол; оценка от лекар при болки в ставите.' } : null),
  ferritin: (v) => (v < 30
    ? { status: 'low', clinical: ['ANEM'], supplement: { name: 'Желязо бисглицинат', dosage: '25–50 mg', timing: 'през ден, с витамин C, далеч от кафе, чай и калций — по изследване; контрол след 3 месеца' } }
    : null),
  hgb: (v, sex) => (v < (sex === 'F' ? 120 : 130)
    ? { status: 'low', clinical: ['ANEM'], caution: 'Нисък хемоглобин — причината се изяснява от лекар.' } : null),
  vitd: (v) => (v < 30
    ? { status: 'low', supplement: { name: 'Витамин D3', dosage: '2000 IU', timing: 'с мазна храна — при дефицит по изследване; контрол след 3 месеца' }, caution: 'Дефицит на витамин D — дозата се уточнява с лекар.' }
    : v < 50 ? { status: 'low', supplement: { name: 'Витамин D3', dosage: '1000–2000 IU', timing: 'с мазна храна — по изследване' } } : null),
  b12: (v) => (v < 150
    ? { status: 'low', supplement: { name: 'Витамин B12', dosage: '500–1000 mcg', timing: 'сутрин — по изследване' }, caution: 'Нисък B12 — причината се изяснява от лекар.' } : null),
  alt: (v) => (v > 40 ? { status: 'high', clinical: ['NAFLD'], caution: 'Повишени чернодробни ензими — оценка от лекар.' } : null),
  ggt: (v) => (v > 60 ? { status: 'high', clinical: ['NAFLD'] } : null),
  tsh: (v) => (v > 4.5 || v < 0.4
    ? { status: v > 4.5 ? 'high' : 'low', caution: 'TSH извън нормата — щитовидната жлеза се оценява от лекар; планът не се променя автоматично.' } : null),
  egfr: (v) => (v < 30
    ? { status: 'low', safety: { proteinCapPerKg: 0.6 }, urgent: true, caution: 'Силно намалена бъбречна функция — хранителният режим само по указание на нефролог.' }
    : v < 60 ? { status: 'low', safety: { proteinCapPerKg: 0.8 }, urgent: true, caution: 'Намалена бъбречна функция — белтъкът е ограничен; планът да се съгласува с лекар.' } : null),
  potassium: (v) => (v > 5.5
    ? { status: 'high', urgent: true, caution: 'Висок калий — съгласуване с лекар преди промени в храненето.' } : null),
};

/**
 * @param {any[]} facts
 * @param {Date} now
 * @param {'M'|'F'|'X'} [sex]
 */
export function deriveLabs(facts, now = new Date(), sex = 'X') {
  const from = now.getTime() - 365 * DAY_MS;
  const latest = new Map();
  for (const f of facts || []) {
    if (f.kind !== 'biomarker' || f.status === 'pending' || !MARKERS[f.key]) continue;
    if (Date.parse(f.at) < from) continue;
    const prev = latest.get(f.key);
    if (!prev || Date.parse(f.at) > Date.parse(prev.at)) latest.set(f.key, f);
  }
  if (!latest.size) return null;

  const findings = [];
  const hints = { behaviors: [], approach: [], clinical: [], cautions: [] };
  const supplements = [];
  let safety = {};
  const reasons = [];
  for (const [key, f] of latest) {
    const v = canonical(key, Number(f.value), f.unit);
    if (v == null || !Number.isFinite(v)) continue;
    const r = RULES[key]?.(v, sex) || null;
    findings.push({
      key, label: MARKERS[key].label, value: Math.round(v * 100) / 100, unit: MARKERS[key].unit,
      at: f.at, status: r ? r.status : 'normal',
    });
    if (!r) continue;
    hints.clinical.push(...(r.clinical || []));
    if (r.caution) hints.cautions.push(r.caution);
    if (r.supplement) supplements.push({ ...r.supplement, reason: `${MARKERS[key].label}: ${String(Math.round(v * 10) / 10).replace('.', ',')} ${MARKERS[key].unit}` });
    if (r.safety) {
      for (const [k, val] of Object.entries(r.safety)) {
        safety[k] = safety[k] != null ? Math.min(safety[k], val) : val;
      }
    }
    if (r.urgent) safety.urgent = true;
    reasons.push(`изследване: ${MARKERS[key].label} ${r.status === 'high' ? 'над' : 'под'} нормата`);
  }
  hints.clinical = [...new Set(hints.clinical)];
  return { findings, hints, supplements, safety, reasons };
}
