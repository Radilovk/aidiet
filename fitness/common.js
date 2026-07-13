/**
 * FitPlan AI — споделена логика за всички страници.
 */

export const PLAN_STORAGE_KEY = 'fitplan.plan';

export function getCachedPlan() {
  try {
    const raw = localStorage.getItem(PLAN_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.plan?.days?.length) return null;
    return data;
  } catch {
    return null;
  }
}

export function hasCachedPlan() {
  return Boolean(getCachedPlan());
}

export function formatPlanDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

/** Показва всички елементи с data-my-program и пренарежда hero CTA при кеширан план. */
export function applyCachedPlanCta() {
  if (!hasCachedPlan()) return;

  document.querySelectorAll('[data-my-program]').forEach((el) => {
    el.classList.remove('hidden');
  });

  const heroCreate = document.getElementById('heroCreatePlan');
  if (heroCreate) {
    heroCreate.classList.remove('btn-hero');
    heroCreate.classList.add('btn-secondary');
    heroCreate.textContent = 'Създай нов план';
    heroCreate.setAttribute('href', 'app.html?new=1');
  }

  const finalCreate = document.getElementById('finalCreatePlan');
  if (finalCreate) {
    finalCreate.textContent = 'Създай нов план';
    finalCreate.setAttribute('href', 'app.html?new=1');
  }

  const navCreate = document.getElementById('navCreatePlan');
  if (navCreate) navCreate.textContent = 'Нов план';

  const footCreate = document.getElementById('footCreatePlan');
  if (footCreate) footCreate.textContent = 'Нов план';
}

/**
 * Премахва ВСИЧКИ /fitness/ записи от всички SW кешове.
 * Старият NutriPlan SW (stale-while-revalidate) отровяше landing.css при refresh.
 */
export async function purgePoisonedFitnessCaches() {
  if (!('caches' in window)) return;
  try {
    const names = await caches.keys();
    await Promise.all(names.map(async (name) => {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      await Promise.all(keys.map((req) => {
        if (req.url.includes('/fitness/')) return cache.delete(req);
      }));
    }));
  } catch { /* ignore */ }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });

  const scope = new URL('./', import.meta.url).pathname;
  navigator.serviceWorker
    .register(new URL('./fitplan-sw.js', import.meta.url), { scope })
    .catch(() => {});
}
