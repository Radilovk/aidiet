import { registerServiceWorker, applyCachedPlanCta } from './common.js';

registerServiceWorker();
applyCachedPlanCta();

const header = document.getElementById('siteHeader');
if (header) {
  addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 12), { passive: true });
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((n) => io.observe(n));
