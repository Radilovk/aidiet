// Shared hamburger navigation — used by emoeat, longevity, protocol-landing
function toggleNavMenu() {
    const btn = document.getElementById('hamburgerBtn');
    const menu = document.getElementById('navMenu');
    const overlay = document.getElementById('navMenuOverlay');
    const isOpen = menu.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
    overlay.classList.toggle('open', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
}

function closeNavMenu() {
    const btn = document.getElementById('hamburgerBtn');
    const menu = document.getElementById('navMenu');
    const overlay = document.getElementById('navMenuOverlay');
    if (!btn || !menu || !overlay) return;
    menu.classList.remove('open');
    btn.classList.remove('open');
    overlay.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
}

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeNavMenu(); });

(function() {
    const link = document.getElementById('navMyPlanLink');
    if (link && localStorage.getItem('dietPlan') && localStorage.getItem('userId')) {
        link.style.display = 'flex';
    }
})();
