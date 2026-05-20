        // Shell navigation helper – when running inside app.html's iframe shell,
        // tab pages use postMessage to switch tabs; non-tab pages navigate window.top.
        (function() {
            var _TAB_MAP = { 'plan.html': 'plan', 'guidelines.html': 'guidelines', 'profile.html': 'profile' };
            window._shellNav = function(url, replace) {
                if (window.self !== window.top) {
                    var clean = (url || '').split('?')[0].replace(/^\.\//, '');
                    var tab = _TAB_MAP[clean];
                    if (tab) {
                        window.parent.postMessage({ type: 'SWITCH_TAB', tab: tab }, '*');
                        return;
                    }
                    if (replace) window.top.location.replace(url);
                    else window.top.location.href = url;
                } else {
                    if (replace) window.location.replace(url);
                    else window.location.href = url;
                }
            };
        })();

        // --- Theme Management ---
        function initializeTheme() {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme) {
                document.documentElement.setAttribute('data-theme', savedTheme);
            } else {
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
            }
            updateThemeIcon();
        }


        function setThemeColor(theme) {
            var c = theme === 'dark' ? '#0A1A1A' : '#F0FDFA';
            document.querySelectorAll('meta[name="theme-color"]').forEach(function(m) { m.setAttribute('content', c); });
                if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
                    var navBar = (window.Capacitor.Plugins || {}).NavigationBar;
                    if (navBar && navBar.setNavigationBarColor) {
                        navBar.setNavigationBarColor({ color: c });
                    }
                }
            }
        function toggleTheme() {
            const current = document.documentElement.getAttribute('data-theme');
            const newTheme = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeIcon();
            setThemeColor(newTheme);
        }

        function updateThemeIcon() {
            const icon = document.getElementById('themeIcon');
            if (!icon) return;
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        }

        function goBack() {
            if (document.referrer && document.referrer.includes(window.location.hostname)) {
                window.history.back();
            } else {
                _shellNav('plan.html');
            }
        }

        function toggleAccordion(header) {
            const item = header.parentElement;
            const content = item.querySelector('.acc-content');
            item.classList.toggle('open');
            content.style.maxHeight = item.classList.contains('open') ? (content.scrollHeight + 'px') : '0';
        }

        // --- Macros Visualization Loading ---
        function parseNumericValue(value) {
            const match = String(value).match(/(\d+(?:\.\d+)?)/);
            return match ? Math.round(parseFloat(match[1])) : 0;
        }

        const DEFAULT_MESSAGES = {
            psychology: 'Консултирайте се с диетолог за допълнителни съвети',
            supplements: 'Консултирайте се с лекар преди приемане на нови добавки',
            psychologyFallbackLabel: 'Съвет',
            supplementsFallbackLabel: 'Добавка'
        };

        const ICON_CLASSES = {
            psychology: 'fa-brain',
            supplements: 'fa-pills'
        };

        const MIN_ITEMS_COUNT = 3;

        function escapeHtml(value) {
            if (value === null || value === undefined) return '';
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function formatContentWithBulletPoints(text, icon = 'fa-check-circle') {
            if (!text || typeof text !== 'string') {
                return `<p style="color: var(--text-light); font-style: italic;">Няма налични данни</p>`;
            }

            const lines = text.split(/\r?\n/).filter(line => line.trim());
            if (lines.length === 0) {
                return `<p style="color: var(--text-light); font-style: italic;">Няма налични данни</p>`;
            }

            let formattedHTML = '<ul class="info-list">';
            lines.forEach(line => {
                const trimmedLine = line.trim().replace(/^[\u2022\-\*]\s*/, '').replace(/^\d+\.\s*/, '');
                if (trimmedLine) {
                    formattedHTML += `<li><i class="fas ${icon}" style="color: var(--primary-red);"></i>${escapeHtml(trimmedLine)}</li>`;
                }
            });
            formattedHTML += '</ul>';
            return formattedHTML;
        }

        function normalizeToThreeItems(data, defaultMessage) {
            if (typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    if (Array.isArray(parsed)) data = parsed;
                    else return null;
                } catch (e) {
                    console.debug('Could not parse guidelines content as JSON array:', e);
                    return null;
                }
            }

            if (!Array.isArray(data)) return null;
            const items = data.slice(0, MIN_ITEMS_COUNT);
            return items.length > 0 ? items : [defaultMessage];
        }

        function generateListItemText(content, contentType, index) {
            if (typeof content === 'string') {
                // Backward compatibility: plans generated before 2025-12-27 could use "!" prefix for bullet-like entries.
                const clean = content.replace(/^!\s*/, '').trim();
                return clean ? escapeHtml(clean) : '';
            }
            if (typeof content === 'object' && content !== null) {
                const fallbackPrefix = contentType === 'psychology'
                    ? DEFAULT_MESSAGES.psychologyFallbackLabel
                    : DEFAULT_MESSAGES.supplementsFallbackLabel;
                let details = content.title || content.name || `${fallbackPrefix} ${index + 1}`;
                if (content.description) details += ` - ${content.description}`;
                if (content.dosage) details += ` - Дозировка: ${content.dosage}`;
                if (content.intake) details += ` - Прием: ${content.intake}`;
                return escapeHtml(details);
            }
            return '';
        }

        function loadGuidelinesAccordion() {
            try {
                const planDataStr = localStorage.getItem('dietPlan');
                if (!planDataStr) return false;
                const dietPlan = JSON.parse(planDataStr);
                if (!dietPlan) return false;

                const recommendedFoodsList = document.getElementById('recommendedFoodsList');
                if (recommendedFoodsList && Array.isArray(dietPlan.recommendations) && dietPlan.recommendations.length > 0) {
                    recommendedFoodsList.innerHTML = dietPlan.recommendations.map(item => `<li>${escapeHtml(item)}</li>`).join('');
                }

                const forbiddenFoodsList = document.getElementById('forbiddenFoodsList');
                if (forbiddenFoodsList && Array.isArray(dietPlan.forbidden) && dietPlan.forbidden.length > 0) {
                    forbiddenFoodsList.innerHTML = dietPlan.forbidden.map(item => `<li>${escapeHtml(item)}</li>`).join('');
                }

                const psychologyContent = document.getElementById('psychologyContent');
                if (psychologyContent) {
                    if (dietPlan.psychology) {
                        const normalized = normalizeToThreeItems(dietPlan.psychology, DEFAULT_MESSAGES.psychology);
                        if (normalized) {
                            let html = '<ul class="info-list">';
                            normalized.forEach((tip, index) => {
                                const itemText = generateListItemText(tip, 'psychology', index);
                                if (itemText) {
                                    html += `<li><i class="fas fa-brain" style="color: var(--primary-red);"></i>${itemText}</li>`;
                                }
                            });
                            html += '</ul>';
                            psychologyContent.innerHTML = html;
                        } else if (typeof dietPlan.psychology === 'string') {
                            psychologyContent.innerHTML = formatContentWithBulletPoints(dietPlan.psychology, ICON_CLASSES.psychology);
                        } else {
                            psychologyContent.innerHTML = `<p style="color: var(--text-light); font-style: italic;">${DEFAULT_MESSAGES.psychology}</p>`;
                        }
                    } else {
                        psychologyContent.innerHTML = `<p style="color: var(--text-light); font-style: italic;">${DEFAULT_MESSAGES.psychology}</p>`;
                    }
                }

                const supplementsContent = document.getElementById('supplementsContent');
                if (supplementsContent) {
                    if (dietPlan.supplements) {
                        const normalized = normalizeToThreeItems(dietPlan.supplements, DEFAULT_MESSAGES.supplements);
                        if (normalized) {
                            let html = '<ul class="info-list">';
                            normalized.forEach((supplement, index) => {
                                const itemText = generateListItemText(supplement, 'supplements', index);
                                if (itemText) {
                                    html += `<li><i class="fas fa-pills" style="color: var(--primary-red);"></i>${itemText}</li>`;
                                }
                            });
                            html += '</ul>';
                            supplementsContent.innerHTML = html;
                        } else if (typeof dietPlan.supplements === 'string') {
                            supplementsContent.innerHTML = formatContentWithBulletPoints(dietPlan.supplements, ICON_CLASSES.supplements);
                        } else {
                            supplementsContent.innerHTML = `<p style="color: var(--text-light); font-style: italic;">${DEFAULT_MESSAGES.supplements}</p>`;
                        }
                    } else {
                        supplementsContent.innerHTML = `<p style="color: var(--text-light); font-style: italic;">${DEFAULT_MESSAGES.supplements}</p>`;
                    }
                }

                const hacksContent = document.getElementById('hacksContent');
                if (hacksContent) {
                    if (Array.isArray(dietPlan.hacks) && dietPlan.hacks.length > 0) {
                        let html = '<ul class="info-list">';
                        dietPlan.hacks.forEach(hack => {
                            const safeHack = escapeHtml(hack);
                            html += `<li><i class="fas fa-bolt" style="color: var(--primary-red);"></i>${safeHack}</li>`;
                        });
                        html += '</ul>';
                        hacksContent.innerHTML = html;
                    } else {
                        hacksContent.innerHTML = `<p style="color: var(--text-light); font-style: italic;">Практически съвети за постигане на целта...</p>`;
                    }
                }

                return true;
            } catch (error) {
                console.error('Error loading guidelines accordion:', error);
                return false;
            }
        }

        function loadMacrosVisualization() {
            try {
                const planDataStr = localStorage.getItem('dietPlan');
                if (!planDataStr) {
                    return false;
                }

                const dietPlan = JSON.parse(planDataStr);
                if (!dietPlan || !dietPlan.summary) {
                    return false;
                }

                const summary = dietPlan.summary;
                const container = document.getElementById('macrosVizContainer');

                let dailyCalories = summary.dailyCalories ? parseNumericValue(summary.dailyCalories) : 0;

                let protein = 0, carbs = 0, fats = 0;
                if (summary.macros) {
                    if (summary.macros.protein) protein = parseNumericValue(summary.macros.protein);
                    if (summary.macros.carbs) carbs = parseNumericValue(summary.macros.carbs);
                    if (summary.macros.fats) fats = parseNumericValue(summary.macros.fats);
                }

                if (protein === 0 && carbs === 0 && fats === 0 && dailyCalories > 0) {
                    protein = Math.round((dailyCalories * 0.25) / 4);
                    carbs = Math.round((dailyCalories * 0.50) / 4);
                    fats = Math.round((dailyCalories * 0.25) / 9);
                }

                if (dailyCalories === 0 && protein === 0) {
                    return false;
                }

                const totalMacroCalories = (protein * 4) + (carbs * 4) + (fats * 9);
                const proteinPercent = totalMacroCalories > 0 ? Math.round((protein * 4 / totalMacroCalories) * 100) : 0;
                const carbsPercent = totalMacroCalories > 0 ? Math.round((carbs * 4 / totalMacroCalories) * 100) : 0;
                const fatsPercent = totalMacroCalories > 0 ? Math.round((fats * 9 / totalMacroCalories) * 100) : 0;

                const elCalories = document.getElementById('targetCalories');
                const elProtein = document.getElementById('targetProtein');
                const elCarbs = document.getElementById('targetCarbs');
                const elFats = document.getElementById('targetFats');
                const elProteinPct = document.getElementById('proteinPercentage');
                const elCarbsPct = document.getElementById('carbsPercentage');
                const elFatsPct = document.getElementById('fatsPercentage');

                if (elCalories) elCalories.textContent = dailyCalories;
                if (elProtein) elProtein.textContent = protein;
                if (elCarbs) elCarbs.textContent = carbs;
                if (elFats) elFats.textContent = fats;
                if (elProteinPct) elProteinPct.textContent = proteinPercent + '%';
                if (elCarbsPct) elCarbsPct.textContent = carbsPercent + '%';
                if (elFatsPct) elFatsPct.textContent = fatsPercent + '%';

                if (container) {
                    container.style.display = 'block';
                }
                return true;
            } catch (error) {
                console.error('Error loading macros visualization:', error);
                return false;
            }
        }

        // --- Strategy Panel Loading ---
        function loadStrategyPanel() {
            try {
                const fields = [
                    { key: 'welcomeMessage', fallback: 'planJustification', sectionId: 'strategySection_welcome', textId: 'strategyText_welcome' },
                    { key: 'longTermStrategy', sectionId: 'strategySection_longTerm', textId: 'strategyText_longTerm' },
                    { key: 'mealCountJustification', sectionId: 'strategySection_mealCount', textId: 'strategyText_mealCount' },
                    { key: 'afterDinnerMealJustification', sectionId: 'strategySection_afterDinner', textId: 'strategyText_afterDinner' },
                    { key: 'modifierReasoning', sectionId: 'strategySection_modifier', textId: 'strategyText_modifier' },
                    { key: 'hydrationStrategy', sectionId: 'strategySection_hydration', textId: 'strategyText_hydration' }
                ];

                let previewText = '';
                let hasAnyContent = false;

                fields.forEach(function(field) {
                    let value = (localStorage.getItem(field.key) || '').trim();
                    if (!value && field.fallback) {
                        value = (localStorage.getItem(field.fallback) || '').trim();
                    }
                    const section = document.getElementById(field.sectionId);
                    const textEl = document.getElementById(field.textId);
                    if (value && section && textEl) {
                        textEl.textContent = value;
                        section.style.display = 'block';
                        hasAnyContent = true;
                        if (!previewText) previewText = value;
                    } else if (section) {
                        section.style.display = 'none';
                    }
                });

                const container = document.getElementById('strategyPanelContainer');
                const previewEl = document.getElementById('strategyPreviewText');
                if (hasAnyContent && container && previewEl) {
                    previewEl.textContent = previewText;
                    container.style.display = 'block';
                    return true;
                } else if (container) {
                    container.style.display = 'none';
                }
                return false;
            } catch (error) {
                console.error('Error loading strategy panel:', error);
                const container = document.getElementById('strategyPanelContainer');
                if (container) container.style.display = 'none';
                return false;
            }
        }

        function openStrategyModal() {
            const modal = document.getElementById('strategyModal');
            if (modal) {
                modal.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        }

        function closeStrategyModal() {
            const modal = document.getElementById('strategyModal');
            if (modal) {
                modal.classList.remove('active');
                document.body.style.overflow = '';
            }
        }

        function handleStrategyModalClick(event) {
            if (event.target === document.getElementById('strategyModal')) {
                closeStrategyModal();
            }
        }

        // --- Initialize ---
        (function instantInit() {
            function setupGuidelines() {
                initializeTheme();

                const hasAccordion = loadGuidelinesAccordion();
                const hasMacros = loadMacrosVisualization();
                const hasStrategy = loadStrategyPanel();

                // Show empty state if no data
                if (!hasAccordion && !hasMacros && !hasStrategy) {
                    const emptyState = document.getElementById('emptyState');
                    if (emptyState) {
                        emptyState.style.display = 'block';
                    }
                }

                // Reveal the page now that critical content is rendered from localStorage.
                requestAnimationFrame(function() {
                    document.body.style.transition = 'opacity 120ms ease-out';
                    document.body.style.opacity = '1';
                });
            }
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupGuidelines);
            } else {
                setupGuidelines();
            }
        })();

        // ── UI Zone Images ────────────────────────────────────────────────────────
        (function applyUIImages() {
            const WORKER = 'https://aidiet.radilov-k.workers.dev';
            getCachedUIImages(WORKER)
                .then(data => {
                    const img = (data.images || {})['guidelines_banner'];
                    if (!img) return;
                    const banner = document.getElementById('guidelinesBanner');
                    if (!banner) return;
                    banner.style.display = 'block';
                    banner.style.backgroundImage = `url(${img})`;
                    banner.style.backgroundSize = 'cover';
                    banner.style.backgroundPosition = 'center';
                    banner.style.backgroundRepeat = 'no-repeat';
                    // Content overlay with title
                    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                    banner.innerHTML = `
                        <div style="position:absolute;inset:0;background:${isDark ? 'rgba(10,26,26,0.55)' : 'rgba(240,253,250,0.55)'};border-radius:inherit;" aria-hidden="true" id="guidelinesBannerOverlay"></div>
                        <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;height:180px;text-align:center;padding:20px;">
                            <i class="fas fa-compass" style="font-size:2.5rem;color:var(--primary-red);margin-bottom:12px;"></i>
                            <h2 style="font-size:1.4rem;font-weight:800;color:var(--text-dark);margin:0;">Вашите Хранителни Насоки</h2>
                            <p style="color:var(--text-gray);margin-top:6px;font-size:0.9rem;">Препоръчителни и забранени храни, психология и съвети</p>
                        </div>`;
                    new MutationObserver(() => {
                        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
                        const overlay = document.getElementById('guidelinesBannerOverlay');
                        if (overlay) overlay.style.background = dark ? 'rgba(10,26,26,0.55)' : 'rgba(240,253,250,0.55)';
                    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
                })
                .catch(() => {});
        })();
        // ── End UI Zone Images ─────────────────────────────────────────────────────
