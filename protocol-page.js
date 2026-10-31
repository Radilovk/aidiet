/* Публичните страници: тема, лента, поява, плаващ бутон, utm към въпросника и стандартен план. */
(function () {
    var root = document.documentElement;
    root.classList.remove('no-js');

    function setTheme(t) {
        root.setAttribute('data-theme', t);
        var c = t === 'dark' ? '#071312' : '#F4FBFA';
        document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', c); });
    }
    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('click', function () {
            var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem('theme', next); } catch (e) { /* без запис */ }
            setTheme(next);
        });
    }

    // utm от входящия линк (реклама, сайт) отива и към въпросника.
    var incoming = new URLSearchParams(location.search);
    document.querySelectorAll('a[data-cta]').forEach(function (a) {
        var url = new URL(a.getAttribute('href'), location.href);
        incoming.forEach(function (v, k) { if (/^utm_/.test(k)) url.searchParams.set(k, v); });
        a.href = url.pathname.replace(/^\//, '') + url.search;
    });

    // Стандартен план: изборът на протокол от предишно посещение не бива да остане във въпросника.
    document.querySelectorAll('a[data-standard-plan]').forEach(function (a) {
        a.addEventListener('click', function () {
            try {
                var answers = JSON.parse(localStorage.getItem('questionnaireAnswers') || '{}') || {};
                delete answers.clinicalProtocol;
                delete answers._protocolSelectedFromLanding;
                localStorage.setItem('questionnaireAnswers', JSON.stringify(answers));
            } catch (e) { /* без запис — въпросникът тръгва без протокол по адреса */ }
        });
    });

    var bar = document.querySelector('.topbar');
    var onScroll = function () { if (bar) bar.classList.toggle('is-scrolled', window.scrollY > 4); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-in'); });
        return;
    }
    var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
        });
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

    // Плаващият бутон се показва, когато нито главният, нито финалният бутон са на екрана.
    var dock = document.querySelector('.dock');
    var anchors = document.querySelectorAll('[data-cta-anchor]');
    if (dock && anchors.length) {
        var seen = new Set();
        var dockIo = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) { e.isIntersecting ? seen.add(e.target) : seen.delete(e.target); });
            var pastHero = anchors[0].getBoundingClientRect().bottom < 0;
            dock.classList.toggle('is-visible', seen.size === 0 && pastHero);
        });
        anchors.forEach(function (a) { dockIo.observe(a); });
    }
})();
