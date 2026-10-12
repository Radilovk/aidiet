/**
 * Учене от изборите на клиента: когато смени хранене с алтернатива, избраното
 * ястие получава плюс, а смененото — минус. При следващото седмично меню
 * двигателят добавя това към оценката на ястието. Решава само между ястия,
 * които вече минават всички правила (диета, алергии, клинични, съчетания) —
 * предпочитанието никога не вкарва забранено ястие и не маха задължително.
 *
 * Паметта е в самия план (plan.dishPreference): пътува с плана, който и
 * без това се записва — без отделни записи и без нови ключове.
 */

/** Колко от миналото предпочитание остава всяка седмица. */
const DECAY = 0.7;
/** Таван на предпочитанието — колкото „закуска от планираната категория“. */
const LIMIT = 3;
/** Най-много толкова ястия се помнят. */
const MAX_DISHES = 60;

/**
 * Смените в плана: хранения, при които клиентът е избрал алтернатива.
 * @param {Record<string, { meals?: any[] }>} weekPlan
 * @returns {Array<{ from: string, to: string }>}
 */
export function mealSwapsOf(weekPlan) {
  const out = [];
  for (const day of Object.values(weekPlan || {})) {
    for (const m of day?.meals || []) {
      const from = typeof m?._originalDishId === 'string' ? m._originalDishId : '';
      const to = typeof m?.dishId === 'string' ? m.dishId : '';
      if (from && to && from !== to) out.push({ from, to });
    }
  }
  return out;
}

/**
 * Новото предпочитание: старото избледнява, смените от седмицата се добавят.
 * @param {Record<string, number>|null|undefined} previous
 * @param {Array<{ from: string, to: string }>} swaps
 * @param {(id: string) => boolean} [isDish]  само познати ястия
 * @param {number} [decay]  колко от старото остава (1 — при промяна от чата в същата седмица)
 * @returns {Record<string, number>}
 */
export function learnDishPreference(previous, swaps, isDish = () => true, decay = DECAY) {
  /** @type {Record<string, number>} */
  const pref = {};
  for (const [id, v] of Object.entries(previous && typeof previous === 'object' ? previous : {})) {
    const n = Number(v);
    if (isDish(id) && Number.isFinite(n)) pref[id] = n * decay;
  }
  for (const { from, to } of swaps || []) {
    if (isDish(to)) pref[to] = (pref[to] || 0) + 1;
    if (isDish(from)) pref[from] = (pref[from] || 0) - 1;
  }
  const kept = Object.entries(pref)
    .map(([id, v]) => [id, Math.round(Math.max(-LIMIT, Math.min(LIMIT, v)) * 100) / 100])
    .filter(([, v]) => Math.abs(Number(v)) >= 0.2)
    .sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])))
    .slice(0, MAX_DISHES);
  return Object.fromEntries(kept);
}
