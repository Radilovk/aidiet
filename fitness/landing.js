import { registerServiceWorker, applyCachedPlanCta } from './common.js';

registerServiceWorker();
applyCachedPlanCta();

const header = document.getElementById('siteHeader');
if (header) {
  addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 12), { passive: true });
}

// Scroll reveal — съдържанието е видимо преди JS; анимира се само след js-ready.
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

requestAnimationFrame(() => {
  document.documentElement.classList.add('js-ready');
  requestAnimationFrame(() => {
    for (const n of reveals) n.classList.remove('instant');
  });
});
