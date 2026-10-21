/**
 * Отметките по дни (gameData) от няколко устройства — в едно.
 *
 * Уебът и приложението пишат всеки в своя localStorage; сървърът пази общото
 * копие и го слива ден по ден: изядено на едното устройство е изядено (ИЛИ),
 * отговорът на сутрешния/вечерния въпрос е по-новият непразен, допълнителните
 * хранения се обединяват. Структурата на деня (слотове, планирани калории)
 * идва от записа с повече отговори — заключените минали дни не се пренареждат.
 */

const KEEP_DAYS = 120;

function answers(rec) {
  if (!rec) return 0;
  const meals = Object.values(rec.meals || {}).filter(v => v === true).length;
  const ev = rec.eveningCheck || {};
  const evening = ['activityLevel', 'emotionalBalance', 'waterIntake'].filter(k => ev[k] != null).length;
  return meals + (rec.morningCheck && typeof rec.morningCheck.sleptWell === 'boolean' ? 1 : 0) + evening + (rec.extraMeals || []).length;
}

const tsOf = x => Date.parse(x?.ts || '') || 0;

/** Двата записа за един ден → един. */
export function mergeDay(a, b) {
  if (!a) return b;
  if (!b) return a;
  const [base, other] = answers(a) >= answers(b) ? [a, b] : [b, a];
  const out = { ...other, ...base };
  out.meals = { ...(other.meals || {}), ...(base.meals || {}) };
  for (const k of Object.keys(other.meals || {})) if (other.meals[k] === true) out.meals[k] = true;
  out.mealCalories = { ...(other.mealCalories || {}), ...(base.mealCalories || {}) };
  out.mealCheckedAt = { ...(other.mealCheckedAt || {}), ...(base.mealCheckedAt || {}) };
  out.mealSkipped = { ...(other.mealSkipped || {}), ...(base.mealSkipped || {}) };
  for (const k of Object.keys(out.mealSkipped)) if (out.meals[k] === true) delete out.mealSkipped[k];
  if (!Object.keys(out.mealSkipped).length) delete out.mealSkipped;
  // Сутрешният въпрос: истински отговор пред празен, по-новият пред по-стария.
  const ma = a.morningCheck, mb = b.morningCheck;
  const realM = m => m && typeof m.sleptWell === 'boolean';
  out.morningCheck = realM(ma) && realM(mb) ? (tsOf(ma) >= tsOf(mb) ? ma : mb) : (realM(ma) ? ma : realM(mb) ? mb : (ma || mb || null));
  // Вечерният — поле по поле.
  if (a.eveningCheck || b.eveningCheck) {
    const ea = a.eveningCheck || {}, eb = b.eveningCheck || {};
    const newer = tsOf(ea) >= tsOf(eb) ? ea : eb, older = newer === ea ? eb : ea;
    out.eveningCheck = { ...older, ...newer };
    for (const k of ['activityLevel', 'emotionalBalance', 'waterIntake']) {
      if (out.eveningCheck[k] == null && older[k] != null) out.eveningCheck[k] = older[k];
    }
  }
  const seen = new Set();
  out.extraMeals = [...(base.extraMeals || []), ...(other.extraMeals || [])].filter((e) => {
    const key = `${e?.ts || ''}|${e?.name || ''}|${e?.calories || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  delete out.dailyScore; // смята се наново на устройството
  return out;
}

/**
 * @param {Record<string, object>} a
 * @param {Record<string, object>} b
 * @param {Date} [now]
 */
export function mergeGameData(a, b, now = new Date()) {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const out = {};
  for (const key of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < cutoff) continue;
    const day = mergeDay(a?.[key], b?.[key]);
    if (day && typeof day === 'object') out[key] = day;
  }
  return out;
}
