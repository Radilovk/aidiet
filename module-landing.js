/* Лендинг страниците на модулите: тема, лента, поява, плаващият бутон под палеца,
 * utm от входящия адрес към бутоните за старт ([data-cta]). */
(function () {
    var root = document.documentElement;
    root.classList.remove('no-js');

    function setTheme(t) {
        root.setAttribute('data-theme', t);
        var c = t === 'dark' ? '#0B1213' : '#F2F7F7';
        document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.removeAttribute('media'); m.setAttribute('content', c); });
    }
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('click', function () {
            var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem('theme', next); } catch (e) { /* без запис */ }
            setTheme(next);
        });
    }

    var incoming = new URLSearchParams(location.search);
    document.querySelectorAll('a[data-cta]').forEach(function (a) {
        try {
            var url = new URL(a.getAttribute('href'), location.href);
            incoming.forEach(function (v, k) { if (/^utm_/.test(k)) url.searchParams.set(k, v); });
            a.href = /^https?:/.test(a.getAttribute('href')) ? url.href : url.pathname.replace(/^\//, '') + url.search;
        } catch (e) { /* остава оригиналният адрес */ }
    });

    var bar = document.querySelector('.ml-top');
    var onScroll = function () { if (bar) bar.classList.toggle('is-scrolled', window.scrollY > 4); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    var items = document.querySelectorAll('.rise, .profile');
    if (!('IntersectionObserver' in window)) {
        items.forEach(function (el) { el.classList.add('in'); });
    } else {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
        }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
        items.forEach(function (el) { io.observe(el); });
    }

    // Бутонът за старт остава под палеца, щом този в героя излезе от екрана.
    var dock = document.getElementById('dock');
    var heroBtn = document.querySelector('.ml-hero .ml-btn--main');
    var final = document.querySelector('.final');
    if (dock && heroBtn && 'IntersectionObserver' in window) {
        var heroOut = false, finalIn = false;
        var sync = function () { dock.classList.toggle('show', heroOut && !finalIn); };
        new IntersectionObserver(function (en) { heroOut = !en[0].isIntersecting && en[0].boundingClientRect.top < 0; sync(); }).observe(heroBtn);
        if (final) new IntersectionObserver(function (en) { finalIn = en[0].isIntersecting; sync(); }, { threshold: 0.2 }).observe(final);
    }
})();
