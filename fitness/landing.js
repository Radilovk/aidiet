import { applyCachedPlanCta, registerServiceWorker } from './common.js';

applyCachedPlanCta();
registerServiceWorker();

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
scrollTo(0, 0);

const header = document.getElementById('siteHeader');
if (header) {
  addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 12), { passive: true });
}

const reveals = [...document.querySelectorAll('.reveal')];
if (reveals.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  for (const n of reveals) {
    if (n.getBoundingClientRect().top < innerHeight) n.classList.add('in');
    else io.observe(n);
  }
} else {
  for (const n of reveals) n.classList.add('in');
}
