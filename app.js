(function () {
    'use strict';

    var params = new URLSearchParams(window.location.search);
    if (params.has('embedded')) {
        document.documentElement.setAttribute('data-embedded-tab', '1');
        window.parent && window.parent.postMessage({ type: 'NUTRIPLAN_TAB_READY' }, window.location.origin);
        return;
    }

    var TAB_ROUTES = {
        home: 'index.html',
        plan: 'plan.html',
        guidelines: 'guidelines.html',
        profile: 'profile.html',
        analytics: 'game-analytics.html'
    };
    var FRAME_SOURCES = {
        home: 'index.html?stay=1&embedded=1',
        plan: 'plan.html?embedded=1',
        guidelines: 'guidelines.html?embedded=1',
        profile: 'profile.html?embedded=1',
        analytics: 'game-analytics.html?embedded=1'
    };
    var JSON_KEYS = [
        'dietPlan',
        'userData',
        'planHistory',
        'questionnaireAnswers',
        'planJustification',
        'longTermStrategy',
        'modifierReasoning',
        'hydrationStrategy',
        'mealCountJustification',
        'gameData',
        'gameNotifierConfig'
    ];
    var state = {
        initialized: false,
        activeTab: 'plan',
        raw: Object.create(null),
        parsed: Object.create(null)
    };

    function getPreferences() {
        return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences
            ? window.Capacitor.Plugins.Preferences
            : null;
    }

    function safeParse(value) {
        if (!value || typeof value !== 'string') return null;
        try {
            return JSON.parse(value);
        } catch (_) {
            return null;
        }
    }

    async function readPreference(preferences, key) {
        if (!preferences || !preferences.get) return null;
        try {
            var result = await preferences.get({ key: key });
            return result && typeof result.value === 'string' ? result.value : null;
        } catch (_) {
            return null;
        }
    }

    async function writePreference(preferences, key, value) {
        if (!preferences || !preferences.set || typeof value !== 'string') return;
        try {
            await preferences.set({ key: key, value: value });
        } catch (_) {
            /* localStorage remains the source of truth if native preferences fail */
        }
    }

    async function cacheJsonAtStartup() {
        var preferences = getPreferences();
        var writes = [];

        for (var i = 0; i < JSON_KEYS.length; i++) {
            var key = JSON_KEYS[i];
            var localValue = localStorage.getItem(key);
            var value = localValue || await readPreference(preferences, key);

            if (value) {
                state.raw[key] = value;
                state.parsed[key] = safeParse(value);
                if (!localValue) localStorage.setItem(key, value);
                if (localValue) writes.push(writePreference(preferences, key, localValue));
            }
        }

        await Promise.all(writes);
        window.NutriPlanAppData = {
            raw: state.raw,
            parsed: state.parsed,
            get: function (key) { return state.parsed[key] || null; },
            getRaw: function (key) { return state.raw[key] || null; }
        };
    }

    function normalizeTab(tab) {
        return TAB_ROUTES[tab] ? tab : 'plan';
    }

    function tabFromUrl(url) {
        var path = url.pathname.split('/').pop() || 'index.html';
        for (var tab in TAB_ROUTES) {
            if (TAB_ROUTES[tab] === path) return tab;
        }
        return null;
    }

    function replayBodyFade(frameWindow, frameDocument) {
        if (!frameDocument || !frameDocument.body) return;
        frameDocument.body.style.transition = 'none';
        frameDocument.body.style.opacity = '0';
        frameWindow.requestAnimationFrame(function () {
            frameWindow.requestAnimationFrame(function () {
                frameDocument.body.style.transition = 'opacity 120ms ease-out';
                frameDocument.body.style.opacity = '1';
            });
        });
    }

    function replayRevealSections(frameWindow, frameDocument) {
        var sections = frameDocument.querySelectorAll('.reveal');
        if (!sections.length) return;
        sections.forEach(function (section) {
            section.classList.remove('active');
        });
        frameWindow.requestAnimationFrame(function () {
            var viewportHeight = frameWindow.innerHeight || frameDocument.documentElement.clientHeight || 0;
            sections.forEach(function (section) {
                var rect = section.getBoundingClientRect();
                if (rect.top < viewportHeight - 150) {
                    section.classList.add('active');
                }
            });
        });
    }

    function replayGaAnimations(frameWindow, frameDocument) {
        var animatedCards = Array.prototype.slice.call(frameDocument.querySelectorAll('.ga-card-enter'));
        if (animatedCards.length) {
            animatedCards.forEach(function (el, index) {
                if (frameWindow.getComputedStyle(el).display === 'none') return;
                el.style.animation = 'none';
                void el.offsetWidth;
                el.style.animation = '';
                el.style.animationDelay = (index * 0.07) + 's';
            });
        }

        var ringOffsets = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-ring-offset]'));
        var ringTargets = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-ring-target]'));
        var barWidths = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-bar]'));
        var barHeights = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-bar-h]'));
        var bidirHeights = Array.prototype.slice.call(frameDocument.querySelectorAll('[data-ga-bidir-h]'));
        if (!ringOffsets.length && !ringTargets.length && !barWidths.length && !barHeights.length && !bidirHeights.length) return;

        ringOffsets.forEach(function (el) {
            var startOffset = el.getAttribute('stroke-dasharray');
            if (startOffset) el.style.strokeDashoffset = startOffset;
        });
        ringTargets.forEach(function (el) {
            var target = parseInt(el.getAttribute('data-ga-ring-target'), 10);
            el.textContent = isNaN(target) ? '?' : '0%';
        });
        barWidths.forEach(function (el) {
            el.style.width = '0%';
        });
        barHeights.forEach(function (el) {
            el.style.height = '0px';
        });
        bidirHeights.forEach(function (el) {
            el.style.height = '0px';
        });

        var GA_RING_START = 120;
        var GA_RING_STAGGER = 130;
        var GA_RING_COUNTER = 900;
        var GA_BAR_START = 350;
        var GA_BAR_STAGGER = 60;
        var GA_CHART_START = 400;
        var GA_CHART_STAGGER = 25;

        frameWindow.requestAnimationFrame(function () {
            frameWindow.requestAnimationFrame(function () {
                ringOffsets.forEach(function (el, i) {
                    frameWindow.setTimeout(function () {
                        el.style.strokeDashoffset = el.getAttribute('data-ga-ring-offset');
                    }, GA_RING_START + i * GA_RING_STAGGER);
                });

                ringTargets.forEach(function (el, i) {
                    var target = parseInt(el.getAttribute('data-ga-ring-target'), 10);
                    if (isNaN(target)) return;
                    var start = GA_RING_START + i * GA_RING_STAGGER;
                    var startTime = null;
                    function step(ts) {
                        if (!startTime) startTime = ts;
                        var progress = Math.min((ts - startTime) / GA_RING_COUNTER, 1);
                        var ease = 1 - Math.pow(1 - progress, 3);
                        el.textContent = Math.round(target * ease) + '%';
                        if (progress < 1) frameWindow.requestAnimationFrame(step);
                    }
                    frameWindow.setTimeout(function () {
                        frameWindow.requestAnimationFrame(step);
                    }, start);
                });

                barWidths.forEach(function (el, i) {
                    frameWindow.setTimeout(function () {
                        el.style.width = el.getAttribute('data-ga-bar') + '%';
                    }, GA_BAR_START + i * GA_BAR_STAGGER);
                });
                barHeights.forEach(function (el, i) {
                    frameWindow.setTimeout(function () {
                        el.style.height = el.getAttribute('data-ga-bar-h');
                    }, GA_CHART_START + i * GA_CHART_STAGGER);
                });
                bidirHeights.forEach(function (el, i) {
                    frameWindow.setTimeout(function () {
                        el.style.height = el.getAttribute('data-ga-bidir-h');
                    }, GA_CHART_START + i * GA_CHART_STAGGER);
                });
            });
        });
    }

    function replayTabAnimations(frame) {
        var frameWindow = frame && frame.contentWindow;
        var frameDocument = frame && frame.contentDocument;
        if (!frameWindow || !frameDocument) return;

        replayBodyFade(frameWindow, frameDocument);
        replayRevealSections(frameWindow, frameDocument);
        replayGaAnimations(frameWindow, frameDocument);

        if (typeof frameWindow.dispatchEvent === 'function' && typeof frameWindow.CustomEvent === 'function') {
            frameWindow.dispatchEvent(new frameWindow.CustomEvent('NUTRIPLAN_TAB_ACTIVATED', {
                detail: {
                    tab: frame.getAttribute('data-tab-view') || ''
                }
            }));
        }
    }

    function patchFrame(frame) {
        var frameWindow = frame.contentWindow;
        var frameDocument = frame.contentDocument;
        if (!frameWindow || !frameDocument) return;

        var style = frameDocument.getElementById('spaEmbeddedPatch');
        if (!style) {
            style = frameDocument.createElement('style');
            style.id = 'spaEmbeddedPatch';
            style.textContent = 'body{opacity:1!important}.bottom-nav{display:none!important}';
            frameDocument.head.appendChild(style);
        }

        frameWindow.NutriPlanAppData = window.NutriPlanAppData;
        frameDocument.addEventListener('click', function (event) {
            var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (!link) return;
            var targetUrl;
            try {
                targetUrl = new URL(link.getAttribute('href'), window.location.origin);
            } catch (_) {
                return;
            }
            if (targetUrl.origin !== window.location.origin) return;
            var targetTab = tabFromUrl(targetUrl);
            if (!targetTab) return;
            event.preventDefault();
            switchTab(targetTab, true);
        }, true);
    }

    function refreshFramesForData() {
        document.querySelectorAll('[data-tab-view]').forEach(function (frame) {
            try {
                if (frame.contentWindow) {
                    frame.contentWindow.NutriPlanAppData = window.NutriPlanAppData;
                    frame.contentWindow.postMessage({
                        type: 'NUTRIPLAN_APP_DATA_READY',
                        keys: Object.keys(state.raw)
                    }, window.location.origin);
                }
            } catch (_) {}
        });
    }

    function mountFrames() {
        document.querySelectorAll('[data-tab-view]').forEach(function (frame) {
            var tab = frame.getAttribute('data-tab-view');
            if (!frame.getAttribute('src')) {
                frame.setAttribute('src', FRAME_SOURCES[tab] || FRAME_SOURCES.plan);
            }
        });
    }

    function switchTab(tab, updateUrl) {
        tab = normalizeTab(tab);
        state.activeTab = tab;

        document.querySelectorAll('[data-tab-view]').forEach(function (frame) {
            var isActive = frame.getAttribute('data-tab-view') === tab;
            frame.classList.toggle('is-active', isActive);
            frame.setAttribute('aria-hidden', String(!isActive));
            if (isActive) replayTabAnimations(frame);
        });

        document.querySelectorAll('[data-tab-target]').forEach(function (button) {
            var isActive = button.getAttribute('data-tab-target') === tab;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-current', isActive ? 'page' : 'false');
        });

        if (updateUrl) {
            var nextUrl = 'index.html?app=1&tab=' + encodeURIComponent(tab);
            history.replaceState({ tab: tab }, '', nextUrl);
        }
    }

    function shouldOpenShell() {
        if (!params.has('app')) return false;
        if (localStorage.getItem('planSource') === 'questionnaire2' || localStorage.getItem('pendingClientId')) {
            window.location.replace('plan-pending.html');
            return false;
        }
        return !!localStorage.getItem('dietPlan');
    }

    async function initShell() {
        var shell = document.getElementById('spaShell');
        if (!shell || state.initialized || !shouldOpenShell()) return;

        state.initialized = true;
        document.body.classList.add('spa-mode');
        shell.hidden = false;

        document.querySelectorAll('[data-tab-view]').forEach(function (frame) {
            frame.addEventListener('load', function () {
                patchFrame(frame);
                refreshFramesForData();
            });
            if (frame.contentDocument && frame.contentDocument.readyState !== 'loading') {
                patchFrame(frame);
            }
        });

        await cacheJsonAtStartup();
        mountFrames();
        refreshFramesForData();

        document.querySelectorAll('[data-tab-target]').forEach(function (button) {
            button.addEventListener('click', function () {
                switchTab(button.getAttribute('data-tab-target'), true);
            });
        });

        switchTab(params.get('tab') || 'plan', true);
    }

    window.NutriPlanSPA = {
        switchTab: function (tab) { switchTab(tab, true); },
        get activeTab() { return state.activeTab; },
        get data() { return window.NutriPlanAppData || null; }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initShell, { once: true });
    } else {
        initShell();
    }
})();
