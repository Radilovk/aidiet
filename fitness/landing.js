import { registerServiceWorker, applyCachedPlanCta } from './common.js';

registerServiceWorker();
applyCachedPlanCta();

const header = document.getElementById('siteHeader');
if (header) {
  addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 12), { passive: true });
}

// Scroll reveal — БЕЗ "pop" при зареждане: елементите, които вече са във
// viewport-а, стават видими мигновено (без transition); анимират се само
// тези, които се появяват при скрол.
const reveals = [...document.querySelectorAll('.reveal')];
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }
}, { threshold: 0.12 });

for (const n of reveals) {
  if (n.getBoundingClientRect().top < innerHeight * 0.95) {
    n.classList.add('in', 'instant');
  } else {
    io.observe(n);
  }
}
// след първите два кадъра връщаме нормалните transitions
requestAnimationFrame(() => requestAnimationFrame(() => {
  for (const n of reveals) n.classList.remove('instant');
}));
