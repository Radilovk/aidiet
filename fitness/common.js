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

/** Премахва NutriPlan (root) SW — FitPlan не трябва да е под негов контрол. */
export async function releaseNutriPlanServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;

  const regs = await navigator.serviceWorker.getRegistrations();
  const foreign = regs.filter((r) => !r.scope.includes('/fitness/'));
  if (!foreign.length) return false;

  const hadController = Boolean(
    navigator.serviceWorker.controller
    && !navigator.serviceWorker.controller.scriptURL.includes('fitplan-sw'),
  );

  await Promise.all(foreign.map((r) => r.unregister()));

  const key = 'fitplan.release-sw';
  if (hadController && !sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1');
    location.reload();
    return true;
  }
  sessionStorage.removeItem(key);
  return false;
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
