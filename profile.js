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

        let userData = {};
        let originalData = {};
        let isEditing = false;

        // Fields that are stored as arrays (from checkbox questions in the questionnaire)
        const ARRAY_FIELDS = ['foodCravings', 'foodTriggers', 'eatingHabits', 'compensationMethods', 'dietPreference', 'medicalConditions'];

        // Collect form data from all [data-field] inputs, restoring array types where needed
        function collectFormData() {
            const inputs = document.querySelectorAll('[data-field]');
            const updatedData = { ...userData };
            inputs.forEach(input => {
                const field = input.getAttribute('data-field');
                const value = input.value.trim();
                if (input.getAttribute('data-is-array') === 'true') {
                    updatedData[field] = value ? value.split(',').map(s => s.trim()).filter(s => s) : [];
                } else {
                    updatedData[field] = value;
                }
            });
            return updatedData;
        }

        // --- Contact Form ---
        const WORKER_PROFILE = 'https://aidiet.radilov-k.workers.dev';

        function toggleProfileContact() {
            const wrapper = document.getElementById('profileContactWrapper');
            const chevron = document.getElementById('profileContactChevron');
            const header = wrapper.previousElementSibling;
            const isOpen = wrapper.classList.toggle('open');
            chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            if (header) header.setAttribute('aria-expanded', String(isOpen));
            if (isOpen) {
                // Small delay to let the CSS max-height transition begin before scrolling
                setTimeout(() => wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
            }
        }

        function togglePlanBackup() {
            const wrapper = document.getElementById('planBackupWrapper');
            const chevron = document.getElementById('planBackupChevron');
            const header = wrapper.previousElementSibling;
            const isOpen = wrapper.classList.toggle('open');
            chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            if (header) header.setAttribute('aria-expanded', String(isOpen));
            if (isOpen) {
                setTimeout(() => wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
            }
        }

        const _DRIVE_ERROR_MSGS = {
            no_data:       'Няма данни за запазване.',
            auth_failed:   'Google Sign-In неуспешен. Проверете акаунта в настройките.',
            upload_failed: 'Качването неуспешно. Опитайте отново.',
            no_backup:     'Не е намерено резервно копие в Google Drive.',
            invalid_data:  'Резервното копие е повредено или непълно.',
            not_native:    'Функцията работи само в инсталираното APK приложение.',
        };

        function _setDriveStatus(msg, isSuccess) {
            const el = document.getElementById('driveBackupStatus');
            el.style.display = 'block';
            el.style.background = isSuccess ? 'rgba(0,200,140,0.15)' : 'rgba(239,68,68,0.15)';
            el.style.color = isSuccess ? '#00c88c' : '#ef4444';
            el.textContent = (isSuccess ? '✓ ' : '✗ ') + msg;
        }

        function _setDriveWorking(msg) {
            const el = document.getElementById('driveBackupStatus');
            el.style.display = 'block';
            el.style.background = 'rgba(59,130,246,0.12)';
            el.style.color = '#3b82f6';
            el.textContent = '⏳ ' + msg;
        }

        async function driveSyncPlan() {
            if (typeof DriveBackup === 'undefined') {
                _setDriveStatus('Грешка при зареждане на услугата. Презаредете приложението.', false);
                return;
            }
            document.getElementById('driveSyncBtn').disabled = true;
            _setDriveWorking('Качване в Google Drive...');
            const result = await DriveBackup.syncPlan();
            document.getElementById('driveSyncBtn').disabled = false;
            if (result.success) {
                _setDriveStatus('Планът е запазен в Google Drive.', true);
            } else {
                _setDriveStatus(_DRIVE_ERROR_MSGS[result.error] || ('Грешка: ' + result.error), false);
            }
        }

        async function driveRestorePlan() {
            if (typeof DriveBackup === 'undefined') {
                _setDriveStatus('Грешка при зареждане на услугата. Презаредете приложението.', false);
                return;
            }
            document.getElementById('driveRestoreBtn').disabled = true;
            _setDriveWorking('Търсене на резервно копие в Google Drive...');
            const result = await DriveBackup.restorePlan();
            document.getElementById('driveRestoreBtn').disabled = false;
            if (result.success) {
                _setDriveStatus('Планът е възстановен от Google Drive! Отидете на Моят план.', true);
            } else {
                _setDriveStatus(_DRIVE_ERROR_MSGS[result.error] || ('Грешка: ' + result.error), false);
            }
        }

        function toggleGameAnalytics() {
            var section = document.getElementById('gameAnalyticsSection');
            var body    = document.getElementById('gameAnalyticsBody');
            var chevron = document.getElementById('gameAnalyticsChevron');
            var header  = section ? section.querySelector('.game-analytics-header') : null;
            if (!section || !body) return;
            var isOpen = body.style.display !== 'block';
            body.style.display = isOpen ? 'block' : 'none';
            section.classList.toggle('open', isOpen);
            if (chevron) chevron.className = 'fas game-analytics-chevron ' + (isOpen ? 'fa-chevron-up' : 'fa-chevron-down');
            if (header)  header.setAttribute('aria-expanded', String(isOpen));
        }

        function toggleAnalysisSection() {
            var container = document.getElementById('analysisSection');
            var wrap      = document.getElementById('analysisBodyWrap');
            var chevron   = document.getElementById('analysisChevron');
            var header    = container ? container.querySelector('.analysis-header-toggle') : null;
            if (!container || !wrap) return;
            var isOpen = wrap.style.display !== 'block';
            wrap.style.display = isOpen ? 'block' : 'none';
            container.classList.toggle('open', isOpen);
            if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            if (header)  header.setAttribute('aria-expanded', String(isOpen));
        }

        function toggleDetailedMetrics() {
            var details = document.getElementById('gameMetricsDetails');
            var chevron = document.getElementById('gameMetricsChevron');
            var toggle  = document.getElementById('gameMetricsToggle');
            if (!details) return;
            var isOpen = details.style.display !== 'block';
            details.style.display = isOpen ? 'block' : 'none';
            if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            if (toggle)  toggle.setAttribute('aria-expanded', String(isOpen));

            if (isOpen) {
                // Re-trigger entrance animations for cards inside the section.
                // Setting animation to 'none' and forcing a reflow (offsetWidth read)
                // causes the browser to reset the animation state before re-applying it.
                details.querySelectorAll('.ga-card-enter').forEach(function(el, i) {
                    el.style.animation = 'none';
                    void el.offsetWidth; // force reflow to reset animation state
                    el.style.animation = '';
                    el.style.animationDelay = (i * 0.07) + 's';
                });
                // Wait two animation frames before starting bar/chart transitions:
                // the first frame picks up the display:block change, the second
                // ensures the browser has committed the layout so transitions play.
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                        // Animate horizontal progress bars (width 0 → target %)
                        details.querySelectorAll('[data-ga-bar]').forEach(function(el, i) {
                            el.style.width = '0%';
                            setTimeout(function() {
                                el.style.width = el.getAttribute('data-ga-bar') + '%';
                            }, 60 + i * 60);
                        });
                        // Animate mini bar heights (height 0 → target px)
                        function animateBarHeight(selector, baseDelay) {
                            details.querySelectorAll(selector).forEach(function(el, i) {
                                el.style.height = '0px';
                                setTimeout(function() {
                                    el.style.height = el.getAttribute(selector.slice(1, -1));
                                }, baseDelay + i * 25);
                            });
                        }
                        animateBarHeight('[data-ga-bar-h]', 100);
                    });
                });
            }
        }

        function handleProfileContactKeydown(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleProfileContact();
            }
        }

        async function submitProfileContactForm(event) {
            event.preventDefault();
            const name = document.getElementById('profileContactName').value.trim();
            const email = document.getElementById('profileContactEmail').value.trim();
            const subject = document.getElementById('profileContactSubject').value.trim();
            const message = document.getElementById('profileContactMessage').value.trim();
            const status = document.getElementById('profileContactStatus');
            const btn = document.getElementById('profileContactBtn');

            if (!name || !message) {
                status.style.display = 'block';
                status.style.background = '#fee2e2';
                status.style.color = '#dc2626';
                status.textContent = 'Моля, попълнете Име и Съобщение.';
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Изпращане...';
            status.style.display = 'none';

            try {
                const response = await fetch(`${WORKER_PROFILE}/api/contact`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        email,
                        subject,
                        message,
                        userId: userData.userId || 'anonymous',
                        timestamp: new Date().toISOString(),
                        userAgent: navigator.userAgent
                    })
                });
                const result = await response.json();
                if (result.success) {
                    status.style.display = 'block';
                    status.style.background = '#d1fae5';
                    status.style.color = '#065f46';
                    status.textContent = '✅ Съобщението е изпратено успешно! Ще се свържем с вас скоро.';
                    document.getElementById('profileContactForm').reset();
                } else {
                    throw new Error(result.error || 'Грешка при изпращане');
                }
            } catch (error) {
                status.style.display = 'block';
                status.style.background = '#fee2e2';
                status.style.color = '#dc2626';
                status.textContent = '❌ Грешка: ' + error.message;
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-paper-plane"></i> Изпрати Съобщение';
            }
        }

        // Pre-fill contact name/email from user data
        function prefillContactForm() {
            const nameField = document.getElementById('profileContactName');
            const emailField = document.getElementById('profileContactEmail');
            if (nameField && userData.name) nameField.value = userData.name;
            if (emailField && userData.email) emailField.value = userData.email;
        }

        // --- Theme Management ---
        function initializeTheme() {
            const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            if (!localStorage.getItem('theme')) localStorage.setItem('theme', savedTheme);
            document.documentElement.setAttribute('data-theme', savedTheme);
            updateThemeIcon(savedTheme);
            setThemeColor(savedTheme);
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
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeIcon(newTheme);
            setThemeColor(newTheme);
        }

        function updateThemeIcon(theme) {
            const icon = document.getElementById('themeIcon');
            if (icon) {
                icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }

        // --- Navigation ---
        function goBack() {
            _shellNav('plan.html');
        }

        // --- Questionnaire Collapsible Toggle ---
        function toggleQuestionnaire() {
            const container = document.getElementById('questionnaireContainer');
            const header = container ? container.querySelector('.questionnaire-header') : null;
            if (container) {
                const isOpen = container.classList.toggle('open');
                // Update aria-expanded for accessibility
                if (header) {
                    header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                }
            }
        }

        // Keyboard handler for questionnaire toggle (Enter/Space)
        function handleQuestionnaireKeydown(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleQuestionnaire();
            }
        }

        function renderProfileAvatar(name, email, user) {
            const avatar = document.getElementById('profileAvatar');
            if (!avatar) return;

            let imageUrl = localStorage.getItem('profileAvatar') || '';
            if (!imageUrl && user && user.photoURL) {
                imageUrl = user.photoURL;
                localStorage.setItem('profilePhotoURL', imageUrl);
                localStorage.setItem('profilePhotoUid', user.uid);
            } else if (!imageUrl && user && localStorage.getItem('profilePhotoUid') === user.uid) {
                imageUrl = localStorage.getItem('profilePhotoURL') || '';
            }

            if (imageUrl) {
                avatar.style.backgroundImage = `url(${imageUrl})`;
                avatar.style.backgroundSize = 'cover';
                avatar.style.backgroundPosition = 'center';
                avatar.textContent = '';
                return;
            }

            avatar.style.backgroundImage = '';
            const source = (name || email || 'П').trim();
            avatar.textContent = source ? source.charAt(0).toUpperCase() : 'П';
        }

        // --- Data Loading ---
        function loadUserData() {
            try {
                const userDataStr = localStorage.getItem('userData');
                if (!userDataStr) {
                    // Before redirecting, attempt backend restore using np_uid cookie.
                    // This handles the iOS PWA isolated-storage scenario.
                    const cookieMatch = document.cookie.match(/(?:^|;\s*)np_uid=([^;]*)/);
                    const cookieUserId = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
                    if (cookieUserId) {
                        fetch(`https://aidiet.radilov-k.workers.dev/api/user/profile?userId=${encodeURIComponent(cookieUserId)}`)
                            .then(r => r.ok ? r.json() : null)
                            .then(data => {
                                if (data && data.found && data.userData) {
                                    localStorage.setItem('userData', JSON.stringify(data.userData));
                                    localStorage.setItem('userId', cookieUserId);
                                    if (data.plan) {
                                        localStorage.setItem('dietPlan', JSON.stringify(data.plan));
                                    }
                                    console.log('[PWA] Profile restored from backend in profile.html');
                                    loadUserData();
                                } else {
                                    showAlert('Няма налични данни. Моля, попълнете въпросника.', 'warning');
                                    setTimeout(() => { _shellNav('questionnaire.html'); }, 2000);
                                }
                            })
                            .catch(() => {
                                showAlert('Няма налични данни. Моля, попълнете въпросника.', 'warning');
                                setTimeout(() => { _shellNav('questionnaire.html'); }, 2000);
                            });
                        return;
                    }
                    showAlert('Няма налични данни. Моля, попълнете въпросника.', 'warning');
                    setTimeout(() => {
                        _shellNav('questionnaire.html');
                    }, 2000);
                    return;
                }

                userData = JSON.parse(userDataStr);
                originalData = JSON.parse(userDataStr); // Keep original for comparison
                
                // Update header
                const name = document.getElementById('profileName');
                const email = document.getElementById('profileEmail');
                
                if (userData.name) {
                    name.textContent = userData.name;
                }
                if (userData.email) {
                    email.textContent = userData.email;
                }
                renderProfileAvatar(userData.name, userData.email, null);

                // Populate all form fields
                populateFormFields();

                // Pre-fill contact form with user data
                prefillContactForm();

            } catch (error) {
                console.error('Error loading user data:', error);
                showAlert('Грешка при зареждане на данните.', 'warning');
            }
        }

        function populateFormFields() {
            // Get all form inputs
            const inputs = document.querySelectorAll('[data-field]');
            
            inputs.forEach(input => {
                const field = input.getAttribute('data-field');
                let value = userData[field];

                if (value !== undefined && value !== null) {
                    // Handle arrays (checkboxes) — convert to display string
                    if (Array.isArray(value) || ARRAY_FIELDS.includes(field)) {
                        input.setAttribute('data-is-array', 'true');
                        value = Array.isArray(value) ? value.join(', ') : value;
                    }
                    input.value = value;
                }
            });
        }

        // --- Editing Functions ---
        function enableEditing() {
            isEditing = true;

            // Open the questionnaire if it is collapsed and scroll to it
            const container = document.getElementById('questionnaireContainer');
            const header = container ? container.querySelector('.questionnaire-header') : null;
            if (container && !container.classList.contains('open')) {
                container.classList.add('open');
                if (header) header.setAttribute('aria-expanded', 'true');
            }
            if (container) {
                setTimeout(function() { container.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
            }

            // Enable all inputs
            const inputs = document.querySelectorAll('[data-field]');
            inputs.forEach(input => {
                input.disabled = false;
            });

            // Show/hide buttons
            document.getElementById('editBtn').classList.add('hidden');
            document.getElementById('cancelBtn').classList.remove('hidden');
            
            showAlert('Режим на редактиране е активиран. Променете желаните полета.', 'info');
        }

        function cancelEditing() {
            isEditing = false;

            // Disable all inputs
            const inputs = document.querySelectorAll('[data-field]');
            inputs.forEach(input => {
                input.disabled = true;
            });

            // Restore original values
            populateFormFields();

            // Show/hide buttons
            document.getElementById('editBtn').classList.remove('hidden');
            document.getElementById('saveBtn').classList.add('hidden');
            document.getElementById('saveAndRegenerateBtn').classList.add('hidden');
            document.getElementById('cancelBtn').classList.add('hidden');

            clearAlert();
        }

        function checkChanges() {
            if (!isEditing) return;

            const inputs = document.querySelectorAll('[data-field]');
            let hasDietRelatedChanges = false;
            let hasAnyChanges = false;

            inputs.forEach(input => {
                const field = input.getAttribute('data-field');
                const isDietRelated = input.getAttribute('data-diet-related') === 'true';
                const newValue = input.value.trim();
                // For array fields, compare using the same comma-separated format used for display
                let oldValue;
                if (Array.isArray(originalData[field])) {
                    oldValue = originalData[field].join(', ');
                } else {
                    oldValue = String(originalData[field] || '').trim();
                }

                if (newValue !== oldValue) {
                    hasAnyChanges = true;
                    if (isDietRelated) {
                        hasDietRelatedChanges = true;
                    }
                }
            });

            // Show appropriate button
            const saveBtn = document.getElementById('saveBtn');
            const saveAndRegenerateBtn = document.getElementById('saveAndRegenerateBtn');

            // Check if plan regeneration is enabled from admin settings
            let planRegenerationEnabled = true; // Default to enabled
            try {
                const globalSettings = localStorage.getItem('globalNotificationSettings');
                if (globalSettings) {
                    const settings = JSON.parse(globalSettings);
                    planRegenerationEnabled = settings.planRegeneration !== false;
                }
            } catch (e) {
                console.error('Error loading admin settings:', e);
            }

            if (hasAnyChanges) {
                if (hasDietRelatedChanges && planRegenerationEnabled) {
                    saveBtn.classList.add('hidden');
                    saveAndRegenerateBtn.classList.remove('hidden');
                } else {
                    saveBtn.classList.remove('hidden');
                    saveAndRegenerateBtn.classList.add('hidden');
                }
            } else {
                saveBtn.classList.add('hidden');
                saveAndRegenerateBtn.classList.add('hidden');
            }
        }

        // Listen for input changes
        document.addEventListener('input', function(e) {
            if (e.target.hasAttribute('data-field')) {
                checkChanges();
            }
        });

        async function saveChanges() {
            // Validate data before saving
            const validationResult = validateFormDataWithDetails();
            if (!validationResult.isValid) {
                showAlert(`⚠️ Моля, попълнете правилно полето: ${validationResult.fieldLabel}`, 'warning');
                return;
            }
            
            // Collect updated data
            const updatedData = collectFormData();

            try {
                // Save to localStorage
                localStorage.setItem('userData', JSON.stringify(updatedData));
                userData = updatedData;
                originalData = JSON.parse(JSON.stringify(updatedData));

                // Update UI
                if (updatedData.name) {
                    document.getElementById('profileName').textContent = updatedData.name;
                }
                if (updatedData.email) {
                    document.getElementById('profileEmail').textContent = updatedData.email;
                }
                renderProfileAvatar(updatedData.name, updatedData.email, null);

                showAlert('✓ Данните са запазени успешно!', 'info');
                cancelEditing();
            } catch (error) {
                console.error('Error saving data:', error);
                showAlert('⚠️ Грешка при запазване на данните. Моля, опитайте отново.', 'warning');
            }
        }

        async function saveAndRegeneratePlan() {
            // Validate data before saving
            const validationResult = validateFormDataWithDetails();
            if (!validationResult.isValid) {
                showAlert(`⚠️ Моля, попълнете правилно полето: ${validationResult.fieldLabel}`, 'warning');
                return;
            }

            // Demo mode check: limit plan regeneration to once
            const isDemoUnlocked = localStorage.getItem('chatDemoLimitUnlocked') === 'true';
            const demoRegenCount = parseInt(localStorage.getItem('demoProfileRegenCount') || '0', 10);
            if (!isDemoUnlocked && demoRegenCount >= 1) {
                showAlert('⚠️ Демо режим — лимит достигнат: В демо версията се позволява само едно регенериране на план след редакция на профила.', 'warning');
                return;
            }
            
            // Confirm before regenerating (important action)
            if (!confirm('Регенерирането на плана ще отнеме време. Сигурни ли сте, че искате да продължите?')) {
                return;
            }
            
            // First save the changes
            const updatedData = collectFormData();

            try {
                // Save to localStorage
                localStorage.setItem('userData', JSON.stringify(updatedData));
                userData = updatedData;

                // Show loading state
                const btn = document.getElementById('saveAndRegenerateBtn');
                btn.disabled = true;
                btn.innerHTML = '<div class="spinner"></div> Регенериране на план...';

                showAlert('Генерирам нов план на базата на актуализираните данни...', 'info');

                // Use async generation so the plan continues even if the page is backgrounded.
                const jobId = crypto.randomUUID();
                localStorage.setItem('planJobId', jobId);
                localStorage.setItem('planJobSource', 'questionnaire');
                localStorage.setItem('pendingPlanPayload', JSON.stringify(updatedData));

                const startController = new AbortController();
                const startTimeoutId = setTimeout(() => startController.abort(), 30000);
                let asyncResponse;
                try {
                    asyncResponse = await fetch('https://aidiet.radilov-k.workers.dev/api/generate-plan-async', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...updatedData, _jobId: jobId }),
                        signal: startController.signal
                    });
                } finally {
                    clearTimeout(startTimeoutId);
                }
                clearTimeout(startTimeoutId);

                if (!asyncResponse.ok) {
                    localStorage.removeItem('planJobId');
                    localStorage.removeItem('planJobSource');
                    localStorage.removeItem('pendingPlanPayload');
                    throw new Error(`Server returned ${asyncResponse.status}`);
                }

                const asyncResult = await asyncResponse.json();
                if (!asyncResult.success || !asyncResult.jobId) {
                    localStorage.removeItem('planJobId');
                    localStorage.removeItem('planJobSource');
                    localStorage.removeItem('pendingPlanPayload');
                    throw new Error(asyncResult.error || 'Неизвестна грешка при стартиране на генерирането');
                }

                // Poll for result with exponential backoff: 5s → 10s → 20s → 30s (capped)
                const MAX_POLLS = 72; // ~18 minutes at average backoff
                const POLL_BASE_DELAY = 5000;
                const POLL_MAX_DELAY = 30000;
                let polls = 0;
                const activeJobId = asyncResult.jobId;
                const nextPollDelay = () => Math.min(POLL_MAX_DELAY, POLL_BASE_DELAY * Math.pow(2, Math.min(polls - 1, 2)));

                const poll = async () => {
                    polls++;
                    if (polls > MAX_POLLS) {
                        localStorage.removeItem('planJobId');
                        localStorage.removeItem('planJobSource');
                        localStorage.removeItem('pendingPlanPayload');
                        throw new Error('Генерирането отне твърде дълго. Моля, опитайте отново.');
                    }
                    const statusResp = await fetch(
                        'https://aidiet.radilov-k.workers.dev/api/plan-job-status?jobId=' + encodeURIComponent(activeJobId)
                    );
                    if (!statusResp.ok) {
                        if (statusResp.status === 429 || statusResp.status >= 500) {
                            await new Promise(r => setTimeout(r, nextPollDelay()));
                            return poll();
                        }
                        throw new Error('Грешка при проверка на статуса (' + statusResp.status + ')');
                    }
                    const statusData = await statusResp.json();
                    if (statusData.status === 'completed') {
                        return statusData;
                    } else if (statusData.status === 'failed') {
                        throw new Error(statusData.error || 'Генерирането на плана не успя');
                    } else if (statusData.status === 'not_found') {
                        throw new Error('Сесията за генериране е изтекла. Моля, опитайте отново.');
                    } else {
                        await new Promise(r => setTimeout(r, nextPollDelay()));
                        return poll();
                    }
                };

                const result = await poll();

                if (!result.success || !result.plan) {
                    throw new Error(result.error || 'Невалиден отговор от сървъра');
                }

                localStorage.removeItem('planJobId');
                localStorage.removeItem('planJobSource');
                localStorage.removeItem('pendingPlanPayload');

                // Save new plan
                localStorage.setItem('dietPlan', JSON.stringify(result.plan));
                if (result.userId) {
                    localStorage.setItem('userId', result.userId);
                }

                // Reset justification flag so modal shows on first load of regenerated plan
                localStorage.removeItem('hasSeenPlanJustification');

                // Demo: increment regeneration counter
                const prevCount = parseInt(localStorage.getItem('demoProfileRegenCount') || '0', 10);
                localStorage.setItem('demoProfileRegenCount', String(prevCount + 1));

                showAlert('✓ Планът е регенериран успешно! Пренасочване...', 'info');
                
                setTimeout(() => {
                    _shellNav('plan.html');
                }, 2000);

            } catch (error) {
                console.error('Error regenerating plan:', error);
                const isNetworkError = error.name === 'AbortError' ||
                    (error.message || '').includes('Failed to fetch') ||
                    (error.message || '').includes('NetworkError') ||
                    (error.message || '').toLowerCase().includes('network');
                if (!isNetworkError) {
                    localStorage.removeItem('planJobId');
                    localStorage.removeItem('planJobSource');
                    localStorage.removeItem('pendingPlanPayload');
                }
                const btn = document.getElementById('saveAndRegenerateBtn');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-sync-alt"></i> Запази и регенерирай план';
                const errorMsg = isNetworkError
                    ? 'Връзката беше прекъсната, но заявката може да продължава на сървъра. Отворете страницата отново, за да се възстанови проверката.'
                    : (error.message || 'Неизвестна грешка');
                showAlert(`⚠️ Грешка при регенериране на плана: ${errorMsg}`, 'warning');
            }
        }

        // Validation function
        function validateFormData() {
            const result = validateFormDataWithDetails();
            return result.isValid;
        }

        // Enhanced validation function that returns details about validation failure
        function validateFormDataWithDetails() {
            const requiredFields = {
                'name': 'Име',
                'email': 'Имейл',
                'gender': 'Пол',
                'age': 'Възраст',
                'height': 'Ръст',
                'weight': 'Тегло',
                'goal': 'Цел'
            };
            const inputs = document.querySelectorAll('[data-field]');
            
            for (const input of inputs) {
                const field = input.getAttribute('data-field');
                if (field in requiredFields) {
                    const value = input.value.trim();
                    if (!value) {
                        console.error('Validation failed: Empty field -', field);
                        input.focus();
                        return { isValid: false, field: field, fieldLabel: requiredFields[field], reason: 'empty' };
                    }
                    
                    // Additional validation
                    if (field === 'email' && !isValidEmail(value)) {
                        console.error('Validation failed: Invalid email format');
                        input.focus();
                        return { isValid: false, field: field, fieldLabel: requiredFields[field], reason: 'invalid_email' };
                    }
                    if ((field === 'age' || field === 'height' || field === 'weight') && (isNaN(value) || value <= 0)) {
                        console.error('Validation failed: Invalid number for', field, '-', value);
                        input.focus();
                        return { isValid: false, field: field, fieldLabel: requiredFields[field], reason: 'invalid_number' };
                    }
                }
            }
            console.log('Validation passed for all required fields');
            return { isValid: true };
        }

        function isValidEmail(email) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        }

        // --- Alert Functions ---
        let _alertDismissTimer = null;
        function showAlert(message, type) {
            if (_alertDismissTimer) { clearTimeout(_alertDismissTimer); _alertDismissTimer = null; }
            const container = document.getElementById('alertContainer');
            container.innerHTML = `
                <div class="alert alert-${type}">
                    <i class="fas fa-${type === 'info' ? 'check-circle' : 'exclamation-triangle'}"></i>
                    <span>${message}</span>
                </div>
            `;
            // Auto-dismiss after 6 seconds
            _alertDismissTimer = setTimeout(function() { clearAlert(); }, 6000);
        }

        function clearAlert() {
            if (_alertDismissTimer) { clearTimeout(_alertDismissTimer); _alertDismissTimer = null; }
            document.getElementById('alertContainer').innerHTML = '';
        }

        // --- REQUIREMENT 1: Analysis Functions ---
        function loadAnalysis() {
            try {
                const planData = localStorage.getItem('dietPlan');
                if (!planData) {
                    return; // No plan available
                }
                
                const plan = JSON.parse(planData);
                if (!plan.analysis || !plan.analysis.keyProblems) {
                    return; // No analysis available
                }
                
                const analysis = plan.analysis;
                const analysisSection = document.getElementById('analysisSection');
                const analysisContent = document.getElementById('analysisContent');
                
                // Show analysis section
                analysisSection.style.display = 'block';
                
                // Build analysis summary (showing only problematic areas - REQUIREMENT 2)
                let html = '';
                
                // Only show if we have problems
                if (analysis.keyProblems && Array.isArray(analysis.keyProblems) && analysis.keyProblems.length > 0) {
                    html += '<div style="margin-bottom: 20px;">';
                    html += '<h4 style="color: var(--primary-red); margin-bottom: 10px;">Ключови области за внимание:</h4>';
                    html += '<ul style="list-style: none; padding: 0;">';
                    
                    analysis.keyProblems.forEach((problem, index) => {
                        // Skip "Normal" severity (REQUIREMENT 2)
                        if (problem.severity === 'Normal') {
                            return;
                        }
                        
                        let severityColor = '#0D9488'; // default teal
                        let severityIcon = 'fa-check-circle';
                        
                        if (problem.severity === 'Critical') {
                            severityColor = '#ef4444';
                            severityIcon = 'fa-exclamation-circle';
                        } else if (problem.severity === 'Risky') {
                            severityColor = '#f97316';
                            severityIcon = 'fa-exclamation-triangle';
                        } else if (problem.severity === 'Borderline') {
                            severityColor = '#fbbf24';
                            severityIcon = 'fa-info-circle';
                        }
                        
                        html += `
                            <li style="margin-bottom: 15px; padding: 12px; background: var(--soft-red); border-radius: 8px; border-left: 4px solid ${severityColor};">
                                <div style="display: flex; align-items: flex-start; gap: 10px;">
                                    <i class="fas ${severityIcon}" style="color: ${severityColor}; margin-top: 2px; font-size: 1.1rem;"></i>
                                    <div style="flex: 1;">
                                        <strong style="color: var(--text-dark);">${problem.title || 'Проблем'}</strong>
                                        <p style="margin: 5px 0 0 0; color: var(--text-light); font-size: 0.9rem;">${problem.description || ''}</p>
                                    </div>
                                </div>
                            </li>
                        `;
                    });
                    
                    html += '</ul>';
                    html += '</div>';
                } else {
                    html += '<p style="color: var(--text-light); font-style: italic;">Не са открити проблемни области</p>';
                }
                
                // Health status score - displayed as circular widget with silhouette
                // Unified calculation: same logic as analysis.html
                let profileHealthScoreForAnimation = null;
                let profileGaugeColor = '#0D9488';
                {
                    const MIN_HEALTH_SCORE = 15;
                    const MAX_HEALTH_SCORE = 100;
                    let healthScore = null;

                    // Primary: use AI-provided currentHealthStatus.score
                    if (analysis.currentHealthStatus && typeof analysis.currentHealthStatus.score === 'number') {
                        healthScore = Math.max(MIN_HEALTH_SCORE, Math.min(MAX_HEALTH_SCORE, Math.round(analysis.currentHealthStatus.score)));
                    } else {
                        // Fallback: calculate from problem severityValues (same as analysis.html)
                        const problems = (analysis.keyProblems || []).filter(p => p.severity !== 'Normal');
                        if (problems.length > 0) {
                            let totalSeverity = 0;
                            problems.forEach(problem => {
                                totalSeverity += (problem.severityValue || 50);
                            });
                            const avgSeverity = totalSeverity / problems.length;
                            const cappedSeverity = Math.min(avgSeverity, MAX_HEALTH_SCORE);
                            const rawHealthScore = MAX_HEALTH_SCORE - cappedSeverity;
                            healthScore = Math.max(MIN_HEALTH_SCORE, Math.min(MAX_HEALTH_SCORE, Math.round(rawHealthScore)));
                            // Strategic adjustment: 10% reduction (same as analysis.html)
                            const healthReduction = Math.floor(healthScore * 0.10);
                            healthScore = Math.max(MIN_HEALTH_SCORE, healthScore - healthReduction);
                        }
                    }

                    if (healthScore !== null) {
                        const criticalCount = (analysis.keyProblems || []).filter(p => p.severity === 'Critical').length;
                        const riskyCount = (analysis.keyProblems || []).filter(p => p.severity === 'Risky').length;
                        const borderlineCount = (analysis.keyProblems || []).filter(p => p.severity === 'Borderline').length;
                        const totalProblems = criticalCount + riskyCount + borderlineCount;

                        let gaugeColor = '#0D9488';
                        let healthLabel = 'Добро';

                        if (healthScore < 25) {
                            gaugeColor = '#ef4444';
                            healthLabel = 'Влошено';
                        } else if (healthScore < 50) {
                            gaugeColor = '#f97316';
                            healthLabel = 'Нуждае се от внимание';
                        } else if (healthScore < 75) {
                            gaugeColor = '#fbbf24';
                            healthLabel = 'Умерено';
                        } else {
                            gaugeColor = '#0D9488';
                            healthLabel = 'Добро';
                        }

                        profileHealthScoreForAnimation = healthScore;
                        profileGaugeColor = gaugeColor;

                        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                        const emptyColor = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';

                        html += `
                            <div style="padding: 24px 20px 20px; background: linear-gradient(145deg, var(--soft-red), rgba(13,148,136,0.03)); border-radius: 16px; text-align: center; border: 1px solid rgba(13,148,136,0.1);">
                                <div style="font-weight: 700; color: var(--text-dark); font-size: 0.95rem; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px;">
                                    <i class="fas fa-heartbeat" style="color: ${gaugeColor}; margin-right: 6px;"></i>
                                    Здравен статус
                                </div>

                                <!-- Circular Health Widget -->
                                <div class="health-viz-wrap">
                                    <svg class="health-ring-svg" viewBox="0 0 100 100" aria-hidden="true">
                                        <defs>
                                            <linearGradient id="profileHealthRingGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                                <stop id="profileHealthRingColor" offset="0%" stop-color="${gaugeColor}"/>
                                            </linearGradient>
                                        </defs>

                                        <circle id="profileHealthRing" cx="50" cy="50" r="44" fill="none"
                                                stroke="url(#profileHealthRingGrad)" stroke-width="5" stroke-linecap="round"
                                                stroke-dasharray="276.46" stroke-dashoffset="276.46"
                                                style="transition: stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1); filter: drop-shadow(0 0 7px ${gaugeColor}99);"/>
                                    </svg>
                                    <svg class="health-silhouette-svg" viewBox="0 0 512 512" aria-hidden="true">
                                        <defs>
                                            <linearGradient id="profileBodyGrad" x1="0" y1="512" x2="0" y2="0" gradientUnits="userSpaceOnUse">
                                                <stop offset="${healthScore}%" stop-color="${gaugeColor}"/>
                                                <stop offset="${healthScore}%" stop-color="${emptyColor}"/>
                                            </linearGradient>
                                        </defs>
                                        <g fill="url(#profileBodyGrad)">
                                            <circle cx="256" cy="56" r="40"/>
                                            <path d="M199.3,295.62h0l-30.4,172.2a24,24,0,0,0,19.5,27.8,23.76,23.76,0,0,0,27.6-19.5l21-119.9v.2s5.2-32.5,17.5-32.5h3.1c12.5,0,17.5,32.5,17.5,32.5v-.1l21,119.9a23.92,23.92,0,1,0,47.1-8.4l-30.4-172.2-4.9-29.7c-2.9-18.1-4.2-47.6.5-59.7,4-10.4,14.13-14.2,23.2-14.2H424a24,24,0,0,0,0-48H88a24,24,0,0,0,0,48h92.5c9.23,0,19.2,3.8,23.2,14.2,4.7,12.1,3.4,41.6.5,59.7Z"/>
                                        </g>
                                    </svg>
                                </div>

                                <!-- Score display -->
                                <div style="font-size: 2.4rem; font-weight: 900; color: ${gaugeColor}; line-height: 1; margin-bottom: 6px; letter-spacing: -2px;">${healthScore}%</div>
                                <div style="font-size: 0.82rem; font-weight: 700; color: ${gaugeColor}; text-transform: uppercase; letter-spacing: 1.5px;">${healthLabel}</div>

                                ${totalProblems > 0 ? `
                                <div style="display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(13,148,136,0.12);">
                                    ${criticalCount > 0 ? `<span class="health-badge critical"><i class="fas fa-exclamation-circle"></i> ${criticalCount} критични</span>` : ''}
                                    ${riskyCount > 0 ? `<span class="health-badge risky"><i class="fas fa-exclamation-triangle"></i> ${riskyCount} рискови</span>` : ''}
                                    ${borderlineCount > 0 ? `<span class="health-badge borderline"><i class="fas fa-info-circle"></i> ${borderlineCount} гранични</span>` : ''}
                                </div>
                                ` : ''}
                            </div>
                        `;
                    }
                }
                
                analysisContent.innerHTML = html;

                // Update analysis-header background to match health status color
                const analysisHeader = document.querySelector('.analysis-container .analysis-header');
                if (analysisHeader) {
                    analysisHeader.style.background = `linear-gradient(135deg, ${profileGaugeColor}, ${profileGaugeColor}cc)`;
                }

                // Animate the circular health ring after DOM is ready
                if (profileHealthScoreForAnimation !== null) {
                    const circumference = 2 * Math.PI * 44; // ≈ 276.46
                    setTimeout(() => {
                        const ring = document.getElementById('profileHealthRing');
                        if (ring) {
                            const dashOffset = circumference * (1 - profileHealthScoreForAnimation / 100);
                            ring.style.strokeDashoffset = dashOffset.toFixed(2);
                        }
                    }, 400);
                }
                
            } catch (error) {
                console.error('Error loading analysis:', error);
            }
        }
        
        function viewFullAnalysis() {
            _shellNav('analysis.html');
        }

        // --- Initialization ---
        (function instantInit() {
            async function setupProfile() {
                initializeTheme();
                loadUserData();
                loadAnalysis(); // REQUIREMENT 1: Load analysis
                // Macros and strategy panels moved to guidelines.html

                // Reveal the page now that critical content is rendered from localStorage.
                requestAnimationFrame(function() {
                    document.body.style.transition = 'opacity 120ms ease-out';
                    document.body.style.opacity = '1';
                });
                
                // Avatar upload functionality
                const profileAvatar = document.getElementById('profileAvatar');
                const avatarInput = document.getElementById('avatarInput');
                const _inIframe = (window.self !== window.top);

                function _applyAvatarData(imageData) {
                    try {
                        localStorage.setItem('profileAvatar', imageData);
                        renderProfileAvatar(userData?.name, userData?.email, null);
                        showAlert('Аватарът е качен успешно!', 'success');
                    } catch (err) {
                        console.error('Failed to save avatar:', err);
                        showAlert('Грешка при запазване на аватара. Изображението може да е твърде голямо.', 'error');
                    }
                }

                if (profileAvatar) {
                    // In iframe (APK shell): delegate file picking to the parent shell because
                    // Capacitor WebView does not fire onShowFileChooser for sub-frame inputs.
                    if (_inIframe) {
                        profileAvatar.addEventListener('click', function() {
                            window.parent.postMessage({ type: 'OPEN_FILE_PICKER', accept: 'image/*' }, '*');
                        });
                        window.addEventListener('message', function(e) {
                            if (e.data && e.data.type === 'FILE_PICKED' && e.data.dataUrl) {
                                _applyAvatarData(e.data.dataUrl);
                            }
                        });
                    } else if (avatarInput) {
                        // Standalone (PWA / browser): use the local file input directly.
                        profileAvatar.addEventListener('click', function() {
                            avatarInput.click();
                        });
                        avatarInput.addEventListener('change', function(e) {
                            const file = e.target.files[0];
                            if (file && file.type.startsWith('image/')) {
                                const reader = new FileReader();
                                reader.onload = function(event) { _applyAvatarData(event.target.result); };
                                reader.readAsDataURL(file);
                            }
                        });
                    }
                }
            }
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupProfile);
            } else {
                setupProfile();
            }
        })();

        // --- PWA Install Banner Functionality ---
        let deferredPrompt;
        
        // Constants
        const INSTALL_BANNER_DISMISS_DAYS = 7; // Number of days before showing banner again
        const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;
        const PWA_DEBUG = false; // Set to true for debugging PWA installation issues
        
        // Helper function to check if banner was recently dismissed
        function wasBannerRecentlyDismissed() {
            const dismissedTime = localStorage.getItem('installBannerDismissed');
            if (dismissedTime) {
                const daysSinceDismissed = (Date.now() - parseInt(dismissedTime)) / MILLISECONDS_PER_DAY;
                // Show again after configured number of days
                if (daysSinceDismissed < INSTALL_BANNER_DISMISS_DAYS) {
                    if (PWA_DEBUG) console.log('Install banner was recently dismissed');
                    return true;
                }
            }
            return false;
        }
        
        // Detect device type
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isAndroid = /Android/i.test(navigator.userAgent);
        const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        const isChrome = /Chrome/i.test(navigator.userAgent) && !/Edg/i.test(navigator.userAgent);
        const isEdge = /Edg/i.test(navigator.userAgent);
        const isSafari = /Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent);
        const isFirefox = /Firefox/i.test(navigator.userAgent);
        const isOpera = /OPR|Opera/i.test(navigator.userAgent);
        const isSamsung = /SamsungBrowser/i.test(navigator.userAgent);
        const isCapacitorNativeApp = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
        
        // Get browser name and icon for display
        function getBrowserInfo() {
            if (isChrome && isAndroid) return { name: 'Chrome', icon: 'fab fa-chrome' };
            if (isChrome && !isAndroid) return { name: 'Chrome', icon: 'fab fa-chrome' };
            if (isEdge) return { name: 'Edge', icon: 'fab fa-edge' };
            if (isSafari && isIOS) return { name: 'Safari', icon: 'fab fa-safari' };
            if (isSafari) return { name: 'Safari', icon: 'fab fa-safari' };
            if (isFirefox) return { name: 'Firefox', icon: 'fab fa-firefox' };
            if (isOpera) return { name: 'Opera', icon: 'fab fa-opera' };
            if (isSamsung) return { name: 'Samsung Internet', icon: 'fas fa-mobile-alt' };
            return { name: 'Browser', icon: 'fas fa-globe' };
        }
        
        // Update banner icon based on platform
        function updateBannerIcon() {
            const iconEl = document.getElementById('installBannerIcon');
            if (!iconEl) return;
            
            let iconClass = 'fas fa-mobile-alt';
            
            if (isAndroid) {
                iconClass = 'fab fa-android';
            } else if (isIOS) {
                iconClass = 'fab fa-apple';
            } else if (!isMobile) {
                iconClass = 'fas fa-desktop';
            }
            
            iconEl.innerHTML = `<i class="${iconClass}"></i>`;
        }
        
        // Update browser badge
        function updateBrowserBadge(showBrowser = true) {
            const browserBadge = document.getElementById('installBannerBrowser');
            const browserText = document.getElementById('installBannerBrowserText');
            
            if (browserBadge && browserText && showBrowser) {
                const browserInfo = getBrowserInfo();
                browserText.textContent = browserInfo.name;
                const iconEl = browserBadge.querySelector('i');
                if (iconEl) {
                    iconEl.className = browserInfo.icon;
                }
                browserBadge.style.display = 'inline-flex';
            } else if (browserBadge) {
                browserBadge.style.display = 'none';
            }
        }
        
        // Capture the beforeinstallprompt event — not needed in native APK
        if (!isCapacitorNativeApp) window.addEventListener('beforeinstallprompt', (e) => {
            if (PWA_DEBUG) console.log('beforeinstallprompt fired');
            e.preventDefault();
            deferredPrompt = e;
            
            // Update profile install button
            updateProfileInstallButton();
            
            // Show the install banner only if not recently dismissed
            if (!wasBannerRecentlyDismissed()) {
                showInstallBanner();
                
                // Auto-trigger installation prompt after 3 seconds for better automatic experience
                // This ensures users don't miss the installation opportunity
                setTimeout(() => {
                    if (deferredPrompt && !isInStandaloneMode()) {
                        if (PWA_DEBUG) console.log('Auto-triggering install prompt after 3 seconds');
                        triggerInstallPrompt();
                    }
                }, 3000);
            }
        });

        // Listen for app installed event
        window.addEventListener('appinstalled', (e) => {
            if (PWA_DEBUG) console.log('App installed successfully');
            deferredPrompt = null;
            updateProfileInstallButton();
        });

        // Show install banner
        function showInstallBanner() {
            if (PWA_DEBUG) console.log('Showing install banner');
            const installBanner = document.getElementById('installBanner');
            if (installBanner) {
                // Update banner text for automatic installation
                const titleEl = installBanner.querySelector('.install-banner-title');
                const textEl = installBanner.querySelector('.install-banner-text');
                
                if (titleEl) titleEl.textContent = '🎉 Готово за инсталация!';
                if (textEl) textEl.textContent = 'Приложението ще се инсталира автоматично след 3 секунди';
                
                installBanner.classList.add('show');
                if (PWA_DEBUG) console.log('Install banner displayed successfully');
            } else {
                if (PWA_DEBUG) console.error('Install banner element not found');
            }
        }
        
        // Show platform-specific install guidance if beforeinstallprompt doesn't fire
        function showPlatformInstallGuidance() {
            // Don't show if already dismissed recently
            if (wasBannerRecentlyDismissed()) return;
            
            // Don't show if already installed
            if (isInStandaloneMode()) return;
            
            const installBanner = document.getElementById('installBanner');
            if (!installBanner) return;
            
            // Update banner content based on platform
            const titleEl = document.getElementById('installBannerTitle');
            const textEl = document.getElementById('installBannerText');
            const installBtn = document.getElementById('installBtn');
            
            // Update icon and browser badge
            updateBannerIcon();
            updateBrowserBadge(true);
            
            if (!isMobile && (isChrome || isEdge)) {
                // Desktop Chrome/Edge - guide to address bar
                const browserName = isChrome ? 'Chrome' : 'Edge';
                if (titleEl) titleEl.textContent = `💻 Инсталирай в ${browserName}`;
                if (textEl) textEl.textContent = 'Потърси иконата за инсталация (⊕) в адресната лента';
                if (installBtn) {
                    installBtn.innerHTML = '<i class="fas fa-info-circle"></i><span>Инструкции</span>';
                    installBtn.onclick = () => {
                        alert('За да инсталирате приложението:\n\n1. Потърсете иконата за инсталация (⊕ или ⬇) в адресната лента в горния десен ъгъл\n2. Кликнете върху нея и изберете "Инсталирай"\n3. Или отворете менюто на браузъра (⋮) и изберете "Инсталирай NutriPlan..."');
                    };
                }
                installBanner.classList.add('show');
            } else if (isIOS && isSafari) {
                // iOS Safari - guide to Share button
                if (titleEl) titleEl.textContent = '📱 Добави към iPhone/iPad';
                if (textEl) textEl.textContent = 'Натисни бутона Share (⬆️) и избери "Add to Home Screen" (Добави към начален екран)';
                if (installBtn) {
                    installBtn.innerHTML = '<i class="fas fa-share"></i><span>Виж как</span>';
                    installBtn.onclick = () => {
                        alert('За да добавите приложението към началния екран:\n\n1. Натиснете бутона Share/Споделяне (⬆️) в долната част на екрана\n2. Превъртете надолу и изберете "Add to Home Screen" (Добави към начален екран) (Добави към начален екран)\n3. Потвърдете, като натиснете "Add" (Добави)');
                    };
                }
                installBanner.classList.add('show');
            } else if (isAndroid && (isChrome || isEdge)) {
                // Android Chrome/Edge - fallback when beforeinstallprompt doesn't fire
                const browserName = isChrome ? 'Chrome' : 'Edge';
                if (titleEl) titleEl.textContent = `📱 Инсталирай в ${browserName}`;
                if (textEl) textEl.textContent = 'Натисни менюто (⋮) и избери "Инсталирай приложение"';
                if (installBtn) {
                    installBtn.innerHTML = '<i class="fas fa-info-circle"></i><span>Инструкции</span>';
                    installBtn.onclick = () => {
                        alert('📱 Как да инсталирам на Android?\n\n✅ БЪРЗ НАЧИН:\n1. Отворете менюто на браузъра (⋮) в горния десен ъгъл\n2. Изберете "Инсталирай приложение" или "Добави към начален екран"\n3. Натиснете "Инсталирай" в диалога\n\n✅ АЛТЕРНАТИВА:\n• Потърсете иконата (⊕) в адресната лента\n• Кликнете и изберете "Инсталирай"\n\n💡 ВАЖНО: Ако не виждате опцията веднага:\n• Презаредете страницата (F5)\n• Изчакайте 2-3 секунди\n• Кликнете на някой бутон на страницата');
                    };
                }
                installBanner.classList.add('show');
            } else if (isSamsung && isAndroid) {
                // Samsung Internet on Android
                if (titleEl) titleEl.textContent = '📱 Инсталирай в Samsung Internet';
                if (textEl) textEl.textContent = 'Натисни менюто и избери "Добави към начален екран"';
                if (installBtn) {
                    installBtn.innerHTML = '<i class="fas fa-info-circle"></i><span>Инструкции</span>';
                    installBtn.onclick = () => {
                        alert('За да добавите приложението към началния екран:\n\n1. Отворете менюто на браузъра (обикновено в горната част)\n2. Потърсете опцията "Добави към начален екран" или подобна\n3. Потвърдете действието');
                    };
                }
                installBanner.classList.add('show');
            } else if (isFirefox && isAndroid) {
                // Firefox on Android
                if (titleEl) titleEl.textContent = '📱 Инсталирай в Firefox';
                if (textEl) textEl.textContent = 'Натисни менюто (⋮) и избери "Инсталирай"';
                if (installBtn) {
                    installBtn.innerHTML = '<i class="fas fa-info-circle"></i><span>Инструкции</span>';
                    installBtn.onclick = () => {
                        alert('За да добавите приложението към началния екран:\n\n1. Отворете менюто на браузъра (обикновено в горната част)\n2. Потърсете опцията "Добави към начален екран" или подобна\n3. Потвърдете действието');
                    };
                }
                installBanner.classList.add('show');
            } else if (isMobile) {
                // Other mobile browsers - generic guidance
                if (titleEl) titleEl.textContent = '📱 Добави към начален екран';
                if (textEl) textEl.textContent = 'Отвори менюто на браузъра и избери "Добави към начален екран"';
                if (installBtn) {
                    installBtn.innerHTML = '<i class="fas fa-info-circle"></i><span>Инструкции</span>';
                    installBtn.onclick = () => {
                        alert('За да добавите приложението към началния екран:\n\n1. Отворете менюто на браузъра (обикновено в горната част)\n2. Потърсете опцията "Добави към начален екран" или подобна\n3. Потвърдете действието');
                    };
                }
                installBanner.classList.add('show');
            }
        }

        // Hide install banner
        function hideInstallBanner() {
            const installBanner = document.getElementById('installBanner');
            if (installBanner) {
                installBanner.classList.remove('show');
            }
        }
        
        // Trigger install prompt (reusable function)
        async function triggerInstallPrompt() {
            if (!deferredPrompt) {
                if (PWA_DEBUG) console.log('No deferred prompt available');
                return false;
            }
            
            try {
                // Show the install prompt
                if (PWA_DEBUG) console.log('Triggering install prompt');
                deferredPrompt.prompt();
                
                // Wait for the user to respond to the prompt
                const { outcome } = await deferredPrompt.userChoice;
                if (PWA_DEBUG) console.log(`User response to the install prompt: ${outcome}`);
                
                // Hide the banner
                hideInstallBanner();
                
                // Clear the deferred prompt
                deferredPrompt = null;
                
                return outcome === 'accepted';
            } catch (error) {
                if (PWA_DEBUG) console.error('Error triggering install prompt:', error);
                return false;
            }
        }

        // Profile Install Button Handler
        async function handleProfileInstallClick() {
            if (PWA_DEBUG) console.log('Profile install button clicked');
            
            // If we have a deferred prompt (Chrome/Edge Android/Desktop), trigger it
            if (deferredPrompt) {
                const success = await triggerInstallPrompt();
                if (success) {
                    updateProfileInstallButton();
                }
            } else {
                // Show platform-specific installation instructions
                showInstallInstructions();
            }
        }

        // Show platform-specific installation instructions
        function showInstallInstructions() {
            let message = '';
            
            if (isIOS && isSafari) {
                message = '📱 Как да инсталирам на iPhone/iPad?\n\n' +
                         '1. Натиснете бутона Share/Споделяне (⬆️) в долната част на екрана\n' +
                         '2. Превъртете надолу и изберете "Add to Home Screen" (Добави към начален екран)\n' +
                         '3. Потвърдете, като натиснете "Add" (Добави)\n\n' +
                         '✨ След това приложението ще е на началния ви екран!';
            } else if (isIOS) {
                message = '⚠️ За да инсталирате приложението на iPhone/iPad, моля използвайте Safari браузъра.\n\n' +
                         'Отворете това приложение в Safari и следвайте инструкциите.';
            } else if (isAndroid && (isChrome || isEdge)) {
                const browserName = isChrome ? 'Chrome' : 'Edge';
                message = `📱 Как да инсталирам на Android (${browserName})?\n\n` +
                         '✅ БЪРЗ НАЧИН:\n' +
                         '1. Отворете менюто на браузъра (⋮) в горния десен ъгъл\n' +
                         '2. Изберете "Инсталирай приложение" или "Добави към начален екран"\n' +
                         '3. Натиснете "Инсталирай" в диалога\n\n' +
                         '✅ АЛТЕРНАТИВА:\n' +
                         '• Потърсете иконата (⊕) в адресната лента\n' +
                         '• Кликнете и изберете "Инсталирай"\n\n' +
                         '💡 ВАЖНО: Ако не виждате опцията веднага:\n' +
                         '• Презаредете страницата (F5)\n' +
                         '• Изчакайте 2-3 секунди\n' +
                         '• Кликнете на някой бутон на страницата';
            } else if (isAndroid) {
                message = '📱 Как да инсталирам на Android?\n\n' +
                         '1. Отворете менюто на браузъра (обикновено в горната част)\n' +
                         '2. Потърсете опцията "Добави към начален екран" или "Инсталирай"\n' +
                         '3. Потвърдете действието\n\n' +
                         'Препоръчваме да използвате Chrome или Edge за най-добро изживяване.';
            } else if (!isMobile && (isChrome || isEdge)) {
                const browserName = isChrome ? 'Chrome' : 'Edge';
                message = `💻 Как да инсталирам в ${browserName}?\n\n` +
                         '1. Потърсете иконата за инсталация (⊕ или ⬇) в адресната лента в горния десен ъгъл\n' +
                         '2. Кликнете върху нея и изберете "Инсталирай"\n' +
                         '3. Или отворете менюто на браузъра (⋮) и изберете "Инсталирай NutriPlan..."\n\n' +
                         'След инсталация приложението ще се отвори в отделен прозорец.';
            } else {
                message = '💻 Инсталация на приложението\n\n' +
                         'За да инсталирате приложението:\n\n' +
                         '1. Отворете менюто на браузъра\n' +
                         '2. Потърсете опцията "Инсталирай" или "Добави към начален екран"\n' +
                         '3. Потвърдете действието\n\n' +
                         'Препоръчваме Chrome или Edge за най-добро изживяване.';
            }
            
            alert(message);
        }

        // Update profile install button based on current state
        function updateProfileInstallButton() {
            const installBtn = document.getElementById('profileInstallBtn');
            const btnText = document.getElementById('profileInstallBtnText');
            const androidBtn = document.getElementById('profileAndroidBtn');
            
            if (!installBtn) return;

            // Running as native Capacitor APK — hide all install UI
            if (isCapacitorNativeApp) {
                installBtn.classList.add('hidden');
                if (androidBtn) androidBtn.style.display = 'none';
                if (PWA_DEBUG) console.log('Native APK - hiding all install UI');
                return;
            }
            
            // Check if already installed (running in standalone mode)
            if (isInStandaloneMode()) {
                installBtn.classList.add('hidden');
                if (androidBtn) androidBtn.style.display = 'none';
                if (PWA_DEBUG) console.log('App is installed - hiding install button');
                return;
            }
            
            // Show install button
            installBtn.classList.remove('hidden');

            // Show Android APK download button only on Android devices that are not running the TWA
            if (androidBtn) {
                androidBtn.style.display = isAndroid ? 'inline-flex' : 'none';
            }
            
            // Update button text based on platform
            if (deferredPrompt) {
                // Can trigger automatic install
                btnText.textContent = 'Инсталирай приложение';
                if (PWA_DEBUG) console.log('Deferred prompt available - showing install button');
            } else if (isIOS && isSafari) {
                // iOS Safari - manual instructions
                btnText.textContent = 'Как да инсталирам?';
                if (PWA_DEBUG) console.log('iOS Safari - showing how to install');
            } else if (isAndroid || !isMobile) {
                // Android or Desktop - show instructions
                btnText.textContent = 'Инструкции за инсталация';
                if (PWA_DEBUG) console.log('Showing installation instructions');
            } else {
                btnText.textContent = 'Инсталирай приложение';
            }
        }

        // iOS Install Banner Functions
        function showIosInstallBanner() {
            const hasDismissed = localStorage.getItem('ios_install_dismissed');

            if (isIOS && !isInStandaloneMode() && !hasDismissed) {
                const iosBanner = document.getElementById('ios-banner');
                const shareIconImg = document.getElementById('ios-share-icon-img');
                
                if (iosBanner) {
                    // Set the share icon SVG
                    if (shareIconImg) {
                        shareIconImg.src = getShareIconSvg();
                    }
                    iosBanner.style.display = 'block';
                    if (PWA_DEBUG) console.log('iOS install banner shown');
                }
            }
        }

        // Function to dismiss iOS banner
        function dismissIosBanner() {
            localStorage.setItem('ios_install_dismissed', 'true');
            const iosBanner = document.getElementById('ios-banner');
            if (iosBanner) {
                iosBanner.style.display = 'none';
            }
            if (PWA_DEBUG) console.log('iOS install banner dismissed');
        }

        // Initialize iOS banner after a delay — not in native APK
        if (!isCapacitorNativeApp && isIOS && isSafari) {
            setTimeout(() => {
                showIosInstallBanner();
            }, 3000); // Show after 3 seconds on iOS
        }

        // Handle install button click
        const installBtn = document.getElementById('installBtn');
        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                await triggerInstallPrompt();
            });
        }

        // Handle dismiss button click
        const dismissInstallBtn = document.getElementById('dismissInstallBtn');
        if (dismissInstallBtn) {
            dismissInstallBtn.addEventListener('click', () => {
                hideInstallBanner();
                
                // Store dismissal in localStorage (to not show again for 7 days)
                localStorage.setItem('installBannerDismissed', Date.now().toString());
            });
        }

        // Listen for app installed event
        window.addEventListener('appinstalled', () => {
            if (PWA_DEBUG) console.log('PWA was installed');
            hideInstallBanner();
            deferredPrompt = null;
        });
        
        // Don't show fallback guidance - only show banner when beforeinstallprompt fires
        // This ensures automatic installation prompt instead of manual instructions
        window.addEventListener('load', () => {
            // Hide all install UI when running as native APK
            if (isCapacitorNativeApp) {
                const installBanner = document.getElementById('installBanner');
                if (installBanner) installBanner.style.display = 'none';
                const iosBanner = document.getElementById('ios-banner');
                if (iosBanner) iosBanner.style.display = 'none';
                updateProfileInstallButton();
                return;
            }
            // Update profile install button on page load
            setTimeout(() => {
                updateProfileInstallButton();
            }, 500);
            
            setTimeout(() => {
                // Only log for debugging - don't show manual instructions
                if (!deferredPrompt && !isInStandaloneMode()) {
                    if (PWA_DEBUG) {
                        console.log('beforeinstallprompt has not fired after 2 seconds');
                        console.log('Waiting for automatic prompt - no manual instructions shown');
                    }
                }
            }, 2000);
            
            // For Android Chrome/Edge: Re-check after user engagement
            if (isAndroid && (isChrome || isEdge)) {
                let engagementStartTime = Date.now();
                let hasInteracted = false;
                
                // Track user interaction
                const interactionEvents = ['click', 'touchstart', 'scroll', 'keydown'];
                const markInteraction = () => {
                    if (!hasInteracted) {
                        hasInteracted = true;
                        if (PWA_DEBUG) console.log('User interaction detected, starting engagement timer');
                    }
                };
                
                interactionEvents.forEach(event => {
                    document.addEventListener(event, markInteraction, { once: true, passive: true });
                });
                
                // Check again after 32 seconds if user has interacted
                setTimeout(() => {
                    if (hasInteracted && !deferredPrompt && !isInStandaloneMode()) {
                        const elapsedTime = Math.floor((Date.now() - engagementStartTime) / 1000);
                        if (PWA_DEBUG) {
                            console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #3b82f6');
                            console.log('%c🔄 Re-checking PWA Installability', 'color: #3b82f6; font-weight: bold');
                            console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #3b82f6');
                            console.log(`User has been engaged for ${elapsedTime} seconds`);
                            console.log(`beforeinstallprompt still has not fired`);
                            console.log('Waiting for automatic prompt - app may already be installed or PWA criteria not met');
                            console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #3b82f6');
                        }
                        // Don't show manual instructions - wait for automatic prompt only
                    }
                }, 32000); // Check after 32 seconds (30s requirement + 2s buffer)
            }
        });

        // Debug: Check PWA installability after page load
        if (PWA_DEBUG) {
            window.addEventListener('load', () => {
                setTimeout(() => {
                    // Detect device type
                    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                    const isAndroid = /Android/i.test(navigator.userAgent);
                    const isChrome = /Chrome/i.test(navigator.userAgent) && !/Edg/i.test(navigator.userAgent);
                    const isEdge = /Edg/i.test(navigator.userAgent);
                    
                    if (!deferredPrompt) {
                        console.log('PWA Debug: beforeinstallprompt has not fired yet');
                        console.log('PWA Debug: Checking installability criteria:');
                        console.log('- Service Worker:', 'serviceWorker' in navigator ? 'Supported' : 'Not supported');
                        console.log('- HTTPS:', location.protocol === 'https:' ? 'Yes' : 'No');
                        console.log('- Manifest link:', document.querySelector('link[rel="manifest"]') ? 'Found' : 'Missing');
                        console.log('- Platform:', isMobile ? 'Mobile' : 'Desktop');
                        console.log('- Browser:', isChrome ? 'Chrome' : (isEdge ? 'Edge' : 'Other'));
                        
                        // Check if already installed
                        if (isInStandaloneMode()) {
                            console.log('- Already installed: Yes (running as standalone app)');
                        } else {
                            console.log('- Already installed: No');
                            
                            // Different explanations for desktop vs mobile
                            if (!isMobile && (isChrome || isEdge)) {
                                console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #0D9488');
                                console.log('%c✓ PWA IS INSTALLABLE!', 'color: #0D9488; font-weight: bold; font-size: 14px');
                                console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #0D9488');
                                console.log('%cINFO: On Desktop Chrome/Edge, the beforeinstallprompt event often does NOT fire.', 'color: #3b82f6; font-weight: bold');
                                console.log('%cInstead, Chrome shows an INSTALL ICON in the address bar (omnibox).', 'color: #3b82f6; font-weight: bold');
                                console.log('');
                                console.log('%cTo install this app:', 'font-weight: bold');
                                console.log('  1. Look for the install icon (⊕ or ⬇) in the address bar on the right side');
                                console.log('  2. Click the icon to install the app');
                                console.log('  3. Or open Chrome menu (⋮) → "Install NutriPlan..."');
                                console.log('');
                                console.log('%cFor automatic install prompts, test on Android Chrome/Edge.', 'color: #f59e0b');
                                console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #0D9488');
                            } else if (isAndroid && (isChrome || isEdge)) {
                                console.log('- Possible reasons why event has not fired:');
                                console.log('  1. User engagement criteria not met (needs 30+ seconds + interaction)');
                                console.log('  2. Manifest.json not valid or not accessible');
                                console.log('  3. Icons not loading properly');
                                console.log('  4. Service worker not registered successfully');
                                console.log('  5. PWA criteria not fully met');
                            } else {
                                console.log('- Note: beforeinstallprompt is only supported on Chrome/Edge (mainly Android)');
                                console.log('- For other browsers, users can install manually via browser menu');
                            }
                        }
                    } else {
                        console.log('%c✅ PWA Debug: beforeinstallprompt fired successfully!', 'color: #0D9488; font-weight: bold');
                        console.log('PWA is ready for installation with custom install prompt.');
                    }
                }, 3000);
            });
        }

        // --- PWA Service Worker Registration ---
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(registration => {
                        console.log('Service Worker registered:', registration);
                    })
                    .catch(error => {
                        console.error('Service Worker registration failed:', error);
                    });
            });
        }

        // --- PWA Helper Functions ---
        // Check if app is running in standalone mode
        function isInStandaloneMode() {
            return window.matchMedia('(display-mode: standalone)').matches || 
                   (('standalone' in window.navigator) && (window.navigator.standalone));
        }

        // Get SVG data URL for iOS share icon
        function getShareIconSvg() {
            return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='%233b82f6'%3E%3Cpath d='M18 16v2H6v-2H4v4h16v-4zM12 4l-5 5h3v6h4v-6h3z'/%3E%3C/svg%3E";
        }

        // ── UI Zone Images ────────────────────────────────────────────────────────
        (function applyUIImages() {
            const WORKER = 'https://aidiet.radilov-k.workers.dev';
            function applyData(data) {
                const img = (data.images || {})['profile_cover'];
                if (!img) return;
                const header = document.querySelector('.profile-header');
                if (!header) return;
                header.style.backgroundImage = `url(${img})`;
                header.style.backgroundSize = 'cover';
                header.style.backgroundPosition = 'center';
                header.style.backgroundRepeat = 'no-repeat';
                header.style.position = 'relative';
                header.style.overflow = 'hidden';
                if (!header.querySelector('.ui-img-overlay')) {
                    const overlay = document.createElement('div');
                    overlay.className = 'ui-img-overlay';
                    overlay.setAttribute('aria-hidden', 'true');
                    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                    overlay.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;background:' + (isDark ? 'rgba(10,26,26,0.65)' : 'rgba(240,253,250,0.65)') + ';';
                    header.insertBefore(overlay, header.firstChild);
                    new MutationObserver(() => {
                        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
                        overlay.style.background = dark ? 'rgba(10,26,26,0.65)' : 'rgba(240,253,250,0.65)';
                    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
                }
                Array.from(header.children).forEach(ch => {
                    if (!ch.classList.contains('ui-img-overlay')) ch.style.position = 'relative';
                });
            }
            getCachedUIImages(WORKER).then(applyData)
                .catch(() => {});
        })();
        // ── End UI Zone Images ─────────────────────────────────────────────────────

        // ── Current Analysis Loader ─────────────────────────────────────────────
        (function loadGameAnalytics() {
            var section = document.getElementById('gameAnalyticsSection');
            var body    = document.getElementById('gameAnalyticsBody');
            var badge   = document.getElementById('gameAnalyticsBadge');
            if (!section || !body) return;

            var enabled = localStorage.getItem('gameEnabled') === 'true';
            if (!enabled) return;
            section.style.display = 'block';
            // Open body by default
            body.style.display = 'block';
            section.classList.add('open');
            var chevronEl = document.getElementById('gameAnalyticsChevron');
            if (chevronEl) chevronEl.className = 'fas fa-chevron-up game-analytics-chevron';
            var headerEl = section.querySelector('.game-analytics-header');
            if (headerEl) headerEl.setAttribute('aria-expanded', 'true');

            // ── Helpers ───────────────────────────────────────────────────────
            function zp(n) { return n < 10 ? '0' + n : '' + n; }
            function dk(d)  { return d.getFullYear()+'-'+zp(d.getMonth()+1)+'-'+zp(d.getDate()); }
            var todayKey = dk(new Date());

            // ── Scoring constants (must match plan.html) ──────────────────────
            var FREE_MEAL_MIN_RATING   = 4;  // Suitability score threshold for a correct free meal
            var JUNK_MAX_POINTS        = 20; // Max engagement pts from junk/incorrect-meal component
            var JUNK_PENALTY_PER_MEAL  = 7;  // Engagement pts lost per junk or incorrect meal

            var allData = {};
            try { allData = JSON.parse(localStorage.getItem('gameData') || '{}'); } catch(e) {}

            // Only past days + today (exclude future)
            var days = [];
            for (var i = 6; i >= 0; i--) {
                var dd = new Date(); dd.setDate(dd.getDate() - i);
                var key = dk(dd);
                if (key <= todayKey) {
                    days.push({ key: key, rec: allData[key] || null });
                }
            }

            // ── calcDayScore ──────────────────────────────────────────────────
            function calcDayScore(rec) {
                if (!rec) return { score:null, stars:'', label:'Без данни', junkCount:0, incorrectMeals:0, excessCalories:false, calorieBalance:'balanced', engPct:0, calorieDelta:0 };
                var meals = Object.keys(rec.meals || {});
                var mealPts = 0, mealMax = meals.length * 10;
                var incorrectMeals = 0;
                meals.forEach(function(m) {
                    // Free meals are treated the same as any other planned meal.
                    if (rec.meals[m] === true) mealPts += 10;
                });
                var junkCount = 0;
                var extraCalSum = 0;
                var freeMealCalSum = 0; // calories from free meal replacements (treated as normal allowed)
                (rec.extraMeals || []).forEach(function(em) {
                    // A meal is considered consumed when it has no toggle button (not added to plan)
                    // or when its check button is checked (countCalories !== false).
                    var isConsumed = !em.isAddedToPlan || em.countCalories !== false;
                    if (em.isJunk && isConsumed && !em.isFreeMealReplacement) junkCount++;
                    if (em.isFreeMealReplacement) {
                        // Treat free meal calories as normal allowed (like lunch)
                        freeMealCalSum += (em.calories || 0);
                    } else if (em.isAddedToPlan && !em.countCalories) {
                        // meal added to plan but unchecked — do not count calories
                    } else {
                        extraCalSum += (em.calories || 0);
                    }
                });
                var mealCalMap = rec.mealCalories || {};
                var completedPlanCals = 0;
                Object.keys(rec.meals || {}).forEach(function(mt) {
                    if (rec.meals[mt] && mealCalMap[mt]) completedPlanCals += mealCalMap[mt];
                });
                var totalConsumed = completedPlanCals + extraCalSum + freeMealCalSum;
                // Free meal calories expand the planned target equally so they don't cause surplus.
                var planned = rec.plannedCalories ? (rec.plannedCalories + freeMealCalSum) : null;
                var excessCalories = false, calorieBalance = 'balanced';
                var calorieDelta = 0; // positive = surplus kcal, negative = deficit kcal
                if (totalConsumed > 0 && planned && planned > 0) {
                    var excessPct = (totalConsumed - planned) / planned;
                    calorieDelta = Math.round(totalConsumed - planned);
                    if (excessPct > 0.10) { excessCalories = true; calorieBalance = 'surplus'; }
                    else if (excessPct > 0) { calorieBalance = 'surplus'; }
                    else if (excessPct < -0.10 && completedPlanCals > 0 && (rec.morningCheck || rec.eveningCheck)) {
                        calorieBalance = 'deficit';
                    }
                } else if (extraCalSum > 0 && (!planned || planned === 0)) {
                    calorieDelta = extraCalSum;
                    if (extraCalSum > 200) { excessCalories = true; calorieBalance = 'surplus'; }
                    else { calorieBalance = 'surplus'; }
                }
                var sleepPts    = rec.morningCheck  ? (rec.morningCheck.sleptWell ? 10 : 0) : null;
                var waterPts    = rec.eveningCheck  ? (rec.eveningCheck.waterIntake ? 10 : 0) : null;
                var activityPts = rec.eveningCheck  ? ([0,0,5,10][rec.eveningCheck.activityLevel] || 0) : null;
                var balancePts  = rec.eveningCheck  ? ([0,0,5,10][rec.eveningCheck.emotionalBalance] || 0) : null;
                var wellnessEarned = (sleepPts||0)+(waterPts||0)+(activityPts||0)+(balancePts||0);
                var allMealsOk = meals.length > 0 && meals.every(function(m) {
                    return rec.meals[m] === true;
                });
                var badSleep = rec.morningCheck && rec.morningCheck.sleptWell === false;
                var badWater = rec.eveningCheck && rec.eveningCheck.waterIntake === false;
                var lowActivity = rec.eveningCheck && rec.eveningCheck.activityLevel === 1;
                var lowBalance  = rec.eveningCheck && rec.eveningCheck.emotionalBalance === 1;
                var has5StarBlocker = !allMealsOk || incorrectMeals>0 || excessCalories || badSleep || badWater || lowActivity || lowBalance || junkCount>0;
                var done = meals.filter(function(m) {
                    return rec.meals[m]===true;
                }).length;
                var mealEngPct = meals.length>0 ? done/meals.length*50 : 0;
                var mornEngPct = rec.morningCheck ? 15 : 0;
                var eveEngPct  = rec.eveningCheck  ? 15 : 0;
                var hasAnyEngagement = mealEngPct > 0 || mornEngPct > 0 || eveEngPct > 0 || junkCount > 0 || incorrectMeals > 0;
                var junkPct    = hasAnyEngagement ? Math.max(0, JUNK_MAX_POINTS-(junkCount+incorrectMeals)*JUNK_PENALTY_PER_MEAL) : 0;
                var engPct     = Math.round(mealEngPct+mornEngPct+eveEngPct+junkPct);
                var totalMax = mealMax + 40;
                var totalEarned = mealPts + wellnessEarned;
                var score = null;
                if (totalMax > 0 && (totalEarned > 0 || meals.length > 0)) {
                    var pct = totalEarned / totalMax;
                    if      (pct >= 1.00 && !has5StarBlocker) score = 5;
                    else if (pct >= 0.80) score = 4;
                    else if (pct >= 0.55) score = 3;
                    else if (pct >= 0.30) score = 2;
                    else if (pct >  0)    score = 1;
                    // pct === 0 → no earned points yet → score stays null
                    if (score === 5 && has5StarBlocker) score = 4;
                    if (score !== null && score > 3 && (junkCount > 0 || excessCalories)) score = 3;
                    if (score !== null && score > 2 && junkCount > 0 && excessCalories) score = 2;
                }
                var starIcon='<i class="fas fa-star" style="color:#fbbf24;font-size:0.8em"></i>';
                var stars='';
                for (var _s=0;_s<(score||0);_s++) stars+=starIcon;
                var label='';
                if (score===null) { label=meals.length?'Без отбелязана активност':'Без данни'; }
                else if (score===5) label='Отличен резултат!';
                else if (score===4) label='Много добре!';
                else if (score===3) label='Добре';
                else if (score===2) label='Може по-добре';
                else label='Подобри се утре';
                if (incorrectMeals>0) label+=' ⚠ '+incorrectMeals+' неправилно хранене';
                if (junkCount>0) label+=' ('+junkCount+' вредни)';
                if (calorieBalance==='surplus'&&excessCalories) label+=' — излишни кал.';
                if (calorieBalance==='deficit') label+=' — кал. дефицит';
                return { score:score, stars:stars, label:label, junkCount:junkCount,
                         incorrectMeals:incorrectMeals, excessCalories:excessCalories,
                         calorieBalance:calorieBalance, engPct:engPct, calorieDelta:calorieDelta };
            }

            // ── Core metrics ──────────────────────────────────────────────────
            var weekScores = days.map(function(d){ return d.rec ? calcDayScore(d.rec) : null; });
            var validScores= weekScores.filter(function(s){ return s&&s.score!=null; });
            var avgScore   = days.length>0 ? Math.round(validScores.reduce(function(a,s){return a+s.score;},0)/days.length*10)/10 : 0;

            var engPcts = days.map(function(d){ return d.rec ? calcDayScore(d.rec).engPct : null; });
            // No-data days count as 0% engagement (honest representation of missed tracking)
            var noDataDaysCount = days.filter(function(d){ return !d.rec; }).length;
            var engForAvg = days.map(function(d){ return d.rec ? calcDayScore(d.rec).engPct : 0; });
            var engagementPct = Math.round(engForAvg.reduce(function(a,b){return a+b;},0)/days.length);

            var extraCalsByDay = days.map(function(d){
                if(!d.rec||!d.rec.extraMeals) return null;
                // Only count extra (non-replacement) meals that are not unchecked added meals
                return d.rec.extraMeals.reduce(function(s,em){
                    if (em.isFreeMealReplacement) return s;
                    if (em.isAddedToPlan && !em.countCalories) return s;
                    return s+(em.calories||0);
                },0);
            });
            var totalExtraCals = extraCalsByDay.reduce(function(s,v){return s+(v||0);},0);

            // Signed calorie balance per day (positive = surplus, negative = deficit, null = no data)
            var calBalanceByDay = days.map(function(d){
                if (!d.rec) return null;
                return calcDayScore(d.rec).calorieDelta;
            });
            var netCalBalance = calBalanceByDay.reduce(function(s,v){return s+(v||0);},0);

            // Actual consumed calories per day (for target bar chart).
            // Computed directly from the record to avoid the calorieDelta=0 ambiguity:
            // when no meals are logged calorieDelta stays 0, which would wrongly return
            // `planned` (showing a false "at-target" bar for a day with no data).
            var calConsumedByDay = days.map(function(d){
                if (!d.rec) return null;
                var mealCalMap = d.rec.mealCalories || {};
                var completedCals = Object.keys(d.rec.meals || {}).reduce(function(sum, mt){
                    return sum + (d.rec.meals[mt] && mealCalMap[mt] ? mealCalMap[mt] : 0);
                }, 0);
                var extraCals = (d.rec.extraMeals || []).reduce(function(sum, em){
                    if (em.isFreeMealReplacement) return sum; // tracked via plan meals
                    if (em.isAddedToPlan && !em.countCalories) return sum; // added to plan but unchecked
                    return sum + (em.calories || 0);
                }, 0);
                var total = completedCals + extraCals;
                return total > 0 ? total : null;
            });
            var calPlannedByDay = days.map(function(d){
                return d.rec ? (d.rec.plannedCalories || null) : null;
            });
            // Calorie adherence: average (consumed / planned %) per day, capped at 100%.
            // Used for the horizontal progress bar in the calorie row.
            var calAdherencePct = (function(){
                var vals = [];
                calConsumedByDay.forEach(function(consumed, idx){
                    if (!consumed) return;
                    var plan = calPlannedByDay[idx];
                    if (!plan) return;
                    vals.push(Math.min(100, Math.round(consumed / plan * 100)));
                });
                return vals.length > 0
                    ? Math.round(vals.reduce(function(a,b){return a+b;},0) / vals.length)
                    : null;
            })();

            // Incorrect meal count (free meals rated 0-3) for weekly health impact
            var incorrectMealsCount7 = 0;
            days.forEach(function(d){
                if (d.rec) {
                    var ds = calcDayScore(d.rec);
                    incorrectMealsCount7 += ds.incorrectMeals || 0;
                }
            });

            var balanceByDay = days.map(function(d){
                if(!d.rec||!d.rec.eveningCheck||d.rec.eveningCheck.emotionalBalance==null) return null;
                return Math.round((d.rec.eveningCheck.emotionalBalance-1)/2*100);
            });
            var balanceValid = balanceByDay.filter(function(v){return v!==null;});
            var balancePct = balanceValid.length>0 ? Math.round(balanceValid.reduce(function(a,b){return a+b;},0)/balanceValid.length) : null;

            var sleepByDay = days.map(function(d){
                if(!d.rec||!d.rec.morningCheck||d.rec.morningCheck.sleptWell==null) return null;
                return d.rec.morningCheck.sleptWell ? 100 : 0;
            });
            var sleepValid = sleepByDay.filter(function(v){return v!==null;});
            var sleepPct = sleepValid.length>0 ? Math.round(sleepValid.reduce(function(a,b){return a+b;},0)/sleepValid.length) : null;

            var actByDay = days.map(function(d){
                if(!d.rec||!d.rec.eveningCheck||d.rec.eveningCheck.activityLevel==null) return null;
                return Math.round((d.rec.eveningCheck.activityLevel-1)/2*100);
            });
            var actValid = actByDay.filter(function(v){return v!==null;});
            var actPct = actValid.length>0 ? Math.round(actValid.reduce(function(a,b){return a+b;},0)/actValid.length) : null;

            var waterByDay = days.map(function(d){
                if(!d.rec||!d.rec.eveningCheck||d.rec.eveningCheck.waterIntake==null) return null;
                return d.rec.eveningCheck.waterIntake===true ? 100 : 0;
            });
            var waterValid = waterByDay.filter(function(v){return v!==null;});
            var waterPct = waterValid.length>0 ? Math.round(waterValid.reduce(function(a,b){return a+b;},0)/waterValid.length) : null;

            // Junk count 7 days
            var junkCount7=0;
            days.forEach(function(d){ ((d.rec&&d.rec.extraMeals)||[]).forEach(function(em){
                var isConsumed = !em.isAddedToPlan || em.countCalories !== false;
                if(em.isJunk && isConsumed) junkCount7++;
            }); });

            // Trend: last 3 days vs first 3 (of recorded) — exclude today (always incomplete)
            var pastScores = weekScores.slice(0, weekScores.length - 1); // exclude today
            var firstHalf = pastScores.slice(0,Math.floor(pastScores.length/2)).filter(function(s){ return s&&s.score!=null; });
            var lastHalf  = pastScores.slice(Math.ceil(pastScores.length/2)).filter(function(s){ return s&&s.score!=null; });
            var trendUp   = lastHalf.length>0&&firstHalf.length>0 &&
                (lastHalf.reduce(function(a,s){return a+s.score;},0)/lastHalf.length) >
                (firstHalf.reduce(function(a,s){return a+s.score;},0)/firstHalf.length + 0.3);
            var trendDown = lastHalf.length>0&&firstHalf.length>0 &&
                (firstHalf.reduce(function(a,s){return a+s.score;},0)/firstHalf.length) >
                (lastHalf.reduce(function(a,s){return a+s.score;},0)/lastHalf.length + 0.3);

            // Composite health score 0-100 (normalized by actual available weights)
            // Each incorrect free meal lowers engagement by 5% and calorie balance weight by 10 pts
            var INCORRECT_MEAL_ENG_PENALTY  = 5;  // engagement% penalty per incorrect free meal
            var INCORRECT_MEAL_CAL_PENALTY  = 10; // calorie balance weight penalty per incorrect free meal
            var healthScore = 0;
            var totalWeight = 0.35;
            var adjustedEngPct = Math.max(0, engagementPct - incorrectMealsCount7 * INCORRECT_MEAL_ENG_PENALTY);
            healthScore += adjustedEngPct * 0.35;
            if(sleepPct!=null){ healthScore += sleepPct * 0.25; totalWeight += 0.25; }
            if(balancePct!=null){ healthScore += balancePct * 0.2; totalWeight += 0.2; }
            if(actPct!=null){ healthScore += actPct * 0.2; totalWeight += 0.2; }
            var totalCalsWeight = Math.max(0, 100 - Math.round(totalExtraCals/700*100));
            totalCalsWeight = Math.max(0, totalCalsWeight - incorrectMealsCount7 * INCORRECT_MEAL_CAL_PENALTY);
            healthScore += totalCalsWeight * 0.05; totalWeight += 0.05;
            healthScore = Math.round(Math.max(0, Math.min(100, healthScore / totalWeight)));

            // ── Correlation insights ──────────────────────────────────────────
            var insights = [];
            // Sleep → Engagement correlation
            var sleepGoodEng=[], sleepBadEng=[];
            days.forEach(function(d,i){
                if(sleepByDay[i]!=null&&engPcts[i]!=null){
                    if(sleepByDay[i]===100) sleepGoodEng.push(engPcts[i]);
                    else sleepBadEng.push(engPcts[i]);
                }
            });
            if(sleepGoodEng.length>0&&sleepBadEng.length>0){
                var sgAvg=Math.round(sleepGoodEng.reduce(function(a,b){return a+b;},0)/sleepGoodEng.length);
                var sbAvg=Math.round(sleepBadEng.reduce(function(a,b){return a+b;},0)/sleepBadEng.length);
                if(sgAvg-sbAvg>15) insights.push('<i class="fas fa-bed" style="color:#6366f1"></i> В дните с добър сън ангажираността ви е <strong>'+sgAvg+'%</strong> (vs '+sbAvg+'% без добър сън)');
            }
            // Balance → Junk correlation (low emotional balance = high stress = more junk)
            var lowBalanceDays  = days.filter(function(d,i){ return balanceByDay[i]!=null&&balanceByDay[i]<=40; });
            var highBalanceDays = days.filter(function(d,i){ return balanceByDay[i]!=null&&balanceByDay[i]>=60; });
            var lbJunk = lowBalanceDays.reduce(function(s,d){return s+((d.rec&&d.rec.extraMeals||[]).filter(function(e){
                var isConsumed = !e.isAddedToPlan || e.countCalories !== false;
                return e.isJunk && isConsumed;
            }).length);},0);
            var hbJunk = highBalanceDays.reduce(function(s,d){return s+((d.rec&&d.rec.extraMeals||[]).filter(function(e){
                var isConsumed = !e.isAddedToPlan || e.countCalories !== false;
                return e.isJunk && isConsumed;
            }).length);},0);
            if(lowBalanceDays.length>0&&hbJunk===0&&lbJunk>0) insights.push('<i class="fas fa-heart-pulse" style="color:#f59e0b"></i> В дните с нисък емоционален баланс се появяват повече вредни хранения — стресът влияе на избора ви');
            else if(lowBalanceDays.length>0&&hbJunk<lbJunk) insights.push('<i class="fas fa-heart-pulse" style="color:#f59e0b"></i> Забелязваме повече вредни хранения в дни с по-нисък емоционален баланс');
            // Consecutive adherence streak — skip today if it has no data yet (incomplete day)
            var streak=0, currentStreak=0;
            var streakStart = days.length - 1;
            if (streakStart >= 0 && days[streakStart].key === todayKey &&
                    (!days[streakStart].rec || calcDayScore(days[streakStart].rec).score === null)) {
                streakStart--; // today has no activity yet — don't let it break a past-days streak
            }
            for(var si=streakStart;si>=0;si--){
                if(days[si].rec&&calcDayScore(days[si].rec).score>=4){ streak++; currentStreak=Math.max(currentStreak,streak); } else break;
            }
            if(currentStreak>=3) insights.push('<i class="fas fa-fire" style="color:#f59e0b"></i> Имате текуща серия от <strong>'+currentStreak+' отлични дни</strong> подред! Продължавайте!');
            else if(currentStreak===2) insights.push('<i class="fas fa-bolt" style="color:#0D9488"></i> Два отлични дни подред — вие сте в страхотен ритъм!');
            // Calorie deficit insights
            var deficitDays = days.filter(function(d,i){
                return calBalanceByDay[i]!==null && calBalanceByDay[i]<-100 && d.rec && (d.rec.morningCheck||d.rec.eveningCheck);
            });
            if(deficitDays.length>=2){
                insights.push('<i class="fas fa-arrow-down" style="color:#3b82f6"></i> '+deficitDays.length+' дни с калориен дефицит — следете дали приемате достатъчно хранителни вещества за постигане на целите си');
            } else if(deficitDays.length===1){
                insights.push('<i class="fas fa-arrow-down" style="color:#3b82f6"></i> 1 ден с калориен дефицит — следете дали приемате достатъчно хранителни вещества');
            }
            // Deficit vs activity correlation
            if(deficitDays.length>=2){
                var deficitLowAct=deficitDays.filter(function(d){ return d.rec&&d.rec.eveningCheck&&d.rec.eveningCheck.activityLevel===1; }).length;
                if(deficitLowAct>=Math.ceil(deficitDays.length/2)) insights.push('<i class="fas fa-bolt" style="color:#3b82f6"></i> В дните с калориен дефицит активността е по-ниска — ниският калориен прием влияе на енергийните нива');
            }

            // ── Scenario / Prediction ─────────────────────────────────────────
            var scenario = null;
            if(validScores.length>=3){
                var projected = Math.min(5, Math.round((avgScore + (trendUp?0.5:trendDown?-0.3:0))*10)/10);
                if(trendUp && projected>=4) scenario = '<i class="fas fa-chart-line" style="color:#10b981"></i> Ако запазите текущата тенденция, ще достигнете средна оценка <strong>'+projected+'/5</strong> за седмицата — отлично!';
                else if(trendDown) scenario = '<i class="fas fa-chart-line" style="color:#ef4444;transform:rotate(90deg);display:inline-block"></i> Наблюдаваме спад в последните дни. Малко повече внимание към плана ще обърне тенденцията.';
                else if(avgScore>=4) scenario = '<i class="fas fa-star" style="color:#fbbf24"></i> Стабилна и силна седмица! Ако запазите ритъма, ще затвърдите навиците дългосрочно.';
                else if(engagementPct<50) scenario = '<i class="fas fa-lightbulb" style="color:#0D9488"></i> Увеличете ангажираността с 20% (отбелязвайте хранения редовно) и оценката ви ще скочи значително.';
            }

            // ── Alerts ────────────────────────────────────────────────────────
            var alerts = [];
            var missedLast2 = days.slice(-2).filter(function(d){
                if (!d.rec) return true; // no record = genuinely skipped day
                var s = calcDayScore(d.rec);
                // null score = no activity yet (e.g. early morning) — don't count as low engagement
                return s.score !== null && s.score < 2;
            });
            if(missedLast2.length>=2) alerts.push('<i class="fas fa-triangle-exclamation" style="color:#f59e0b"></i> Последните 2 дни имате ниска ангажираност — проверете дали имате нужда от промяна в плана.');
            if(junkCount7>=4) alerts.push('<i class="fas fa-circle-exclamation" style="color:#ef4444"></i> Открихме '+junkCount7+' вредни хранения за седмицата. Опитайте да намалите до 1-2 максимум.');
            if(incorrectMealsCount7>0) alerts.push('<i class="fas fa-exclamation-circle" style="color:#ef4444"></i> '+incorrectMealsCount7+' неправилно свободно хранене за седмицата — нискокачествените замени снижават здравния ви индекс.');
            if(sleepPct!=null&&sleepPct<30) alerts.push('<i class="fas fa-triangle-exclamation" style="color:#f59e0b"></i> Качеството на съня е ниско тази седмица — това пряко влияе на метаболизма и избора на храна.');

            // ── Encouragement ─────────────────────────────────────────────────
            var leadingCriterion='', encourageText='<i class="fas fa-dumbbell" style="color:#0D9488"></i> Последователността е ключът към успеха!';
            if      (junkCount7>2)                     { leadingCriterion='Вредни храни'; encourageText='<i class="fas fa-leaf" style="color:#10b981"></i> Намалете вредните храни — планът работи когато го следвате!'; }
            else if (sleepPct!=null&&sleepPct<50)      { leadingCriterion='Сън';          encourageText='<i class="fas fa-bed" style="color:#6366f1"></i> Добрият сън е основата. Лягайте по-рано — тялото ви ще ви благодари!'; }
            else if (engagementPct<60)                 { leadingCriterion='';             encourageText='<i class="fas fa-check-circle" style="color:#10b981"></i> Спазвайте храненията по план — резултатите идват!'; }
            else if (balancePct!=null&&balancePct<40)  { leadingCriterion='Баланс';       encourageText='<i class="fas fa-person-walking" style="color:#0D9488"></i> Малко движение прави голяма разлика. Дори 15 минути помагат!'; }
            else if (engagementPct>=90)                { leadingCriterion='Отлично';      encourageText='<i class="fas fa-trophy" style="color:#fbbf24"></i> Страхотно! Продължавайте в същия дух — резултатите идват!'; }
            if (badge) badge.textContent = leadingCriterion || (validScores.length+' дни');

            // ── Explanation modal ─────────────────────────────────────────────
            var EXPLANATIONS = {
                engagement: { title:'Ангажираност към плана',
                    text:'Изчислява се всеки ден от 4 компонента:\n• Спазени хранения (50 т.)\n• Сутрешен чек-ин (15 т.)\n• Вечерен чек-ин (15 т.)\n• Без вредни храни (20 т.)\n\nСедмичният % е средна стойност (дни без данни = 0%).\nЦел: 80%+' },
                calories: { title:'Калориен баланс',
                    text:'Показва приетите калории спрямо дневния ви таргет за последните дни.\n\nВизуализация:\n• Хоризонталната линия = заложен калориен таргет\n• Лента достигаща линията = балансиран ден\n• Лента НАД линията (оранжево/червено) = излишък от калории\n• Лента ПОД линията (синьо) = калориен дефицит\n\nДефицитът се регистрира само когато са отбелязани хранения И е попълнен поне един въпросник (сутрешен или вечерен).\nСвободните хранения с рейтинг 0-3 се отчитат като "Неправилно хранене" и допълнително влошават здравния индекс.' },
                stress: { title:'Емоционален баланс',
                    text:'Изчислява се от вечерния въпрос "Емоционален баланс".\n\n• Баланс Отлично → 100%\n• Баланс Добре → 50%\n• Баланс Слабо → 0%\n\nПо-висок % = по-добре.\nЦел: 70%+\n\nВисок емоционален баланс означава нисък стрес и по-добро самочувствие.' },
                sleep: { title:'Качество на съня',
                    text:'Изчислява се от сутрешния въпрос "Спахте ли добре?".\n\nФормула: брой "Да" ÷ общо отговори × 100%\n\nПо-висок % = по-добре.\nЦел: 70%+' },
                activity: { title:'Активност',
                    text:'Изчислява се от вечерния въпрос "Ниво на активност".\n\n• Слабо → 0%\n• Добре → 50%\n• Отлично → 100%\n\nПо-висок % = по-добре.' },
                health: { title:'Здравен Индекс',
                    text:'Композитна оценка, изчислена от всички ваши данни:\n\n• Ангажираност: 35%\n• Сън: 25%\n• Активност: 20%\n• Емоционален баланс: 20%\n\nЦел: 70+' }
            };
            function showExplanation(key) {
                var info = EXPLANATIONS[key]; if(!info) return;
                var old = document.getElementById('gameExplainOverlay'); if(old) old.remove();
                var overlay = document.createElement('div');
                overlay.id = 'gameExplainOverlay'; overlay.className = 'game-explain-overlay';
                overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });
                var box = document.createElement('div'); box.className = 'game-explain-box';
                var t = document.createElement('div'); t.className='game-explain-title'; t.textContent=info.title;
                var tx= document.createElement('div'); tx.className='game-explain-text'; tx.style.whiteSpace='pre-line'; tx.textContent=info.text;
                var cb= document.createElement('button'); cb.className='game-explain-close'; cb.textContent='Разбрах';
                cb.onclick=function(){ overlay.remove(); };
                box.appendChild(t); box.appendChild(tx); box.appendChild(cb);
                overlay.appendChild(box); document.body.appendChild(overlay);
            }

            // ── Render helpers ────────────────────────────────────────────────
            function pBar(pct, color) {
                if (pct==null) return '<span style="font-size:0.75rem;color:var(--text-light)">Няма данни</span>';
                return '<div class="game-index-bar-wrap"><div class="game-index-bar" style="width:0%;background:'+color+'" data-ga-bar="'+Math.min(100,Math.max(0,pct))+'"></div></div>';
            }
            var DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
            var BAR_MIN_H = 4;   // px — minimum bar height (empty/zero day)
            var BAR_MAX_H = 36;  // px — maximum bar height (100%)
            var LABEL_STYLE = 'font-size:0.6rem;color:var(--text-light)';
            function miniBarCol(barStyle, label, dataAttr) {
                return '<div class="game-day-col">' +
                    '<div class="game-day-dot" style="' + barStyle + '"' + (dataAttr ? ' ' + dataAttr : '') + '></div>' +
                    '<span style="' + LABEL_STYLE + '">' + label + '</span>' +
                    '</div>';
            }
            function miniBarChart(perDayValues, maxVal, color) {
                var cols = perDayValues.map(function(v,idx){
                    var dow   = new Date(days[idx].key).getDay();
                    var label = DAY_NAMES[(dow+6)%7];
                    if(v==null || v===0) return miniBarCol('height:'+BAR_MIN_H+'px;background:rgba(156,163,175,0.25)', label);
                    var pct2 = maxVal>0?Math.min(100,Math.round(v/maxVal*100)):0;
                    var h    = Math.max(BAR_MIN_H, Math.round(pct2*BAR_MAX_H/100));
                    return miniBarCol('height:'+BAR_MIN_H+'px;background:'+color, label, 'data-ga-bar-h="'+h+'px"');
                });
                return '<div class="game-day-dots">'+ cols.join('') +'</div>';
            }
            // Bidirectional bar chart: surplus bars go up, deficit bars go down
            var BAR_BIDIR_HALF = 20; // px — max height for each direction
            function biDirBarChart(perDayValues, maxAbsVal, surplusColor, deficitColor) {
                var cols = perDayValues.map(function(v, idx) {
                    var dow   = new Date(days[idx].key).getDay();
                    var label = DAY_NAMES[(dow+6)%7];
                    var absMax = maxAbsVal > 0 ? maxAbsVal : 1;
                    var surplusH = (v != null && v > 0) ? Math.max(2, Math.round(Math.min(v, absMax) / absMax * BAR_BIDIR_HALF)) : 0;
                    var deficitH = (v != null && v < 0) ? Math.max(2, Math.round(Math.min(-v, absMax) / absMax * BAR_BIDIR_HALF)) : 0;
                    return '<div class="game-day-col-bidir">' +
                        '<div class="game-day-surplus-zone">' +
                            (surplusH > 0 ? '<div class="game-day-bar-up" style="height:0px;background:'+surplusColor+'" data-ga-bidir-h="'+surplusH+'px"></div>' : '') +
                        '</div>' +
                        '<span style="' + LABEL_STYLE + '">' + label + '</span>' +
                        '<div class="game-day-deficit-zone">' +
                            (deficitH > 0 ? '<div class="game-day-bar-down" style="height:0px;background:'+deficitColor+'" data-ga-bidir-h="'+deficitH+'px"></div>' : '') +
                        '</div>' +
                        '</div>';
                });
                return '<div class="game-day-dots-bidir">'+ cols.join('') +'</div>';
            }
            // Calorie target bar chart: bars grow upward, horizontal line = daily target
            function calTargetBarChart(perDayConsumed, perDayPlanned, surplusColor, deficitColor) {
                var DEFAULT_SURPLUS_THRESHOLD = 200; // kcal: fallback threshold when no plan target exists
                // LABEL_AREA: approx px occupied by the day-label + gap underneath each bar column.
                // span font-size 0.6rem ≈ 9.6px × line-height 1.2 ≈ 11.5px, plus gap:2px → ~13.5px.
                // Update this if `.game-day-dots-cal` label font-size or gap changes.
                var LABEL_AREA = 14;
                var planVals = perDayPlanned.filter(function(v){ return v != null && v > 0; });
                var avgPlanned = planVals.length > 0
                    ? Math.round(planVals.reduce(function(a,b){return a+b;},0) / planVals.length)
                    : 2000;
                // Per-day scale: consumed == dayPlanned → h == TARGET_BAR_PX (bar exactly at line).
                // The top third of BAR_MAX_H is reserved for surplus bars to grow into above the line.
                var TARGET_BAR_PX = Math.round(BAR_MAX_H * 2 / 3);
                var targetLineBottom = LABEL_AREA + TARGET_BAR_PX;
                var cols = perDayConsumed.map(function(v, idx) {
                    var dow   = new Date(days[idx].key).getDay();
                    var label = DAY_NAMES[(dow+6)%7];
                    if (v == null) return miniBarCol('height:'+BAR_MIN_H+'px;background:rgba(156,163,175,0.2)', label);
                    var consumed = v;
                    var dayPlanned = perDayPlanned[idx] || avgPlanned;
                    var isOverTarget = dayPlanned > 0 ? consumed > dayPlanned : consumed > DEFAULT_SURPLUS_THRESHOLD;
                    var color = isOverTarget ? surplusColor : deficitColor;
                    // Scale each bar so consumed/dayPlanned == 1 → h == TARGET_BAR_PX exactly.
                    // Surplus bars grow up to BAR_MAX_H (capped).
                    var pct = dayPlanned > 0 ? consumed / dayPlanned : 0;
                    var h = consumed > 0 ? Math.max(BAR_MIN_H, Math.min(BAR_MAX_H, Math.round(pct * TARGET_BAR_PX))) : BAR_MIN_H;
                    return miniBarCol('height:'+BAR_MIN_H+'px;background:'+color, label, 'data-ga-bar-h="'+h+'px"');
                });
                return '<div class="game-day-dots-cal">' +
                    '<div class="game-cal-target-line" style="bottom:'+targetLineBottom+'px"></div>' +
                    cols.join('') +
                '</div>';
            }
            // SVG ring
            function ringChart(pct, color, r) {
                r = r||26; var circ=2*Math.PI*r;
                var offset = circ - (pct||0)/100*circ;
                return '<svg class="game-ring-svg" width="'+(r*2+8)+'" height="'+(r*2+8)+'" viewBox="0 0 '+(r*2+8)+' '+(r*2+8)+'">' +
                    '<circle class="game-ring-bg" cx="'+(r+4)+'" cy="'+(r+4)+'" r="'+r+'" stroke-width="5"/>' +
                    '<circle class="game-ring-fg" cx="'+(r+4)+'" cy="'+(r+4)+'" r="'+r+'" stroke-width="5" stroke="'+color+'" stroke-dasharray="'+circ+'" stroke-dashoffset="'+circ+'" data-ga-ring-offset="'+offset.toFixed(2)+'"/>' +
                    '<text x="'+(r+4)+'" y="'+(r+4)+'" text-anchor="middle" dominant-baseline="central" style="fill:var(--text-dark);font-size:'+(r>24?'0.9':'0.78')+'rem;font-weight:700;transform:rotate(90deg);transform-origin:'+(r+4)+'px '+(r+4)+'px" data-ga-ring-count="'+(pct!=null?pct:'')+'" data-ga-ring-target="'+(pct!=null?pct:'')+'" >'+(pct!=null?'0%':'?')+'</text>' +
                    '</svg>';
            }

            // ── Build HTML ────────────────────────────────────────────────────
            var html = '';
            var weekIconClass = avgScore>=4.5?'fas fa-trophy':avgScore>=3.5?'fas fa-bullseye':avgScore>=2.5?'fas fa-chart-line':'fas fa-seedling';
            var weekIconColor = avgScore>=4.5?'#fde68a':avgScore>=3.5?'rgba(255,255,255,0.95)':avgScore>=2.5?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.75)';
            var weekStarsHtml = (function() {
                var s = '';
                var full = Math.floor(avgScore);
                var half = (avgScore - full) >= 0.5;
                for (var si = 0; si < full; si++) s += '<i class="fas fa-star" style="color:#fbbf24;font-size:0.9em"></i>';
                if (half) s += '<i class="fas fa-star-half-alt" style="color:#fbbf24;font-size:0.9em"></i>';
                var empty = 5 - full - (half ? 1 : 0);
                for (var si = 0; si < empty; si++) s += '<i class="far fa-star" style="color:rgba(255,255,255,0.45);font-size:0.9em"></i>';
                return s;
            })();

            // Weekly overview card
            html += '<div class="game-week-card ga-card-enter" style="animation-delay:0s">' +
                '<div class="game-week-icon"><i class="'+weekIconClass+'" style="color:'+weekIconColor+'"></i></div>' +
                '<div class="game-week-info">' +
                    '<div class="game-week-title">Текуща седмица</div>' +
                    '<div class="game-week-score">'+weekStarsHtml+'</div>' +
                    '<div class="game-week-sub">Ангажираност: '+engagementPct+'% · '+validScores.length+' '+(validScores.length===1?'ден':'дни')+' данни'+(noDataDaysCount>0?' · '+noDataDaysCount+' без данни':'')+' </div>' +
                    '<div class="game-week-dots">' +
                    weekScores.map(function(s){
                        var bg = (s&&s.score!=null)?(s.score>=4?'rgba(255,255,255,0.9)':s.score>=3?'rgba(251,191,36,0.85)':'rgba(248,113,113,0.8)'):'rgba(255,255,255,0.18)';
                        return '<div class="game-week-dot" style="background:'+bg+'" title="'+(s&&s.score!=null?s.label:'Няма данни')+'"></div>';
                    }).join('') +
                    '</div>' +
                '</div>' +
            '</div>';

            // Health score rings — "План %" removed; "Активност" in position #2; "Баланс" → "Емоции"
            html += '<div class="game-health-ring-row ga-card-enter" style="animation-delay:0.1s">' +
                '<div class="game-ring-wrap" data-explain="health" style="cursor:pointer">' + ringChart(healthScore,'#0D9488',22) + '<div class="game-ring-label">Здраве</div></div>' +
                (actPct!=null  ? '<div class="game-ring-wrap" data-explain="activity" style="cursor:pointer">' + ringChart(actPct,'#f59e0b',22) + '<div class="game-ring-label">Активност</div></div>' : '') +
                (sleepPct!=null ? '<div class="game-ring-wrap" data-explain="sleep" style="cursor:pointer">' + ringChart(sleepPct,'#6366f1',22) + '<div class="game-ring-label">Сън</div></div>' : '') +
                (balancePct!=null ? '<div class="game-ring-wrap" data-explain="stress" style="cursor:pointer">' + ringChart(balancePct,'#10b981',22) + '<div class="game-ring-label">Емоции</div></div>' : '') +
            '</div>';

            // Trend indicator
            if(trendUp)   html += '<div class="ga-card-enter" style="text-align:center;font-size:0.78rem;color:#10b981;font-weight:600;margin-bottom:10px;animation-delay:0.18s"><i class="fas fa-chart-line"></i> Тенденцията е нагоре — вие се подобрявате!</div>';
            if(trendDown) html += '<div class="ga-card-enter" style="text-align:center;font-size:0.78rem;color:#ef4444;font-weight:600;margin-bottom:10px;animation-delay:0.18s"><i class="fas fa-chart-line" style="transform:rotate(90deg)"></i> Леко затихване — малко повече фокус ще промени всичко</div>';

            // Alerts
            if(alerts.length>0){
                alerts.forEach(function(a, ai){ html += '<div class="game-alert-card ga-card-enter" style="animation-delay:'+(0.22+ai*0.06)+'s">'+a+'</div>'; });
            }

            // Metrics section — collapsible (default collapsed)
            html += '<div class="game-metrics-toggle ga-card-enter" style="animation-delay:0.28s" id="gameMetricsToggle" onclick="toggleDetailedMetrics()" role="button" tabindex="0" aria-expanded="false" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleDetailedMetrics();}">' +
                '<div class="game-section-title" style="margin:0">Подробни данни</div>' +
                '<i class="fas fa-chevron-down game-metrics-chevron" id="gameMetricsChevron"></i>' +
            '</div>';
            html += '<div id="gameMetricsDetails" style="display:none;">';

            html += '<div class="game-index-row" data-explain="engagement">' +
                '<div class="game-index-label"><span><i class="fas fa-utensils" style="color:#0D9488"></i> Ангажираност</span><span>'+engagementPct+'%</span></div>' +
                '<div class="game-index-hint">'+(engagementPct>=80?'<i class="fas fa-check-circle" style="color:#10b981"></i> Отлично':engagementPct>=60?'<i class="fas fa-circle" style="color:#f59e0b"></i> Добре':'<i class="fas fa-circle" style="color:#ef4444"></i> Нисък')+' · Дневен % (хранения + чек-ини) · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(engagementPct,'linear-gradient(90deg,#0D9488,#06B6D4)') + miniBarChart(engPcts,100,'#0D9488') +
            '</div>';

            var hasDeficit = calBalanceByDay.some(function(v){ return v!==null && v<-50; });
            var calBalanceLabel;
            if (netCalBalance === 0 && !hasDeficit) {
                calBalanceLabel = '<i class="fas fa-check-circle" style="color:#10b981"></i> Балансиран';
            } else if (netCalBalance > 0) {
                calBalanceLabel = netCalBalance < 700
                    ? '<i class="fas fa-circle" style="color:#f59e0b"></i> Нетен излишък'
                    : '<i class="fas fa-circle" style="color:#ef4444"></i> Голям излишък';
            } else {
                calBalanceLabel = '<i class="fas fa-arrow-down" style="color:#3b82f6"></i> Нетен дефицит';
            }
            html += '<div class="game-index-row" data-explain="calories">' +
                '<div class="game-index-label"><span><i class="fas fa-scale-balanced" style="color:#f59e0b"></i> Калориен баланс</span><span>'+(netCalBalance>0?'+':'')+netCalBalance+' kcal</span></div>' +
                '<div class="game-index-hint">'+calBalanceLabel+' · Нетен калориен баланс · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(calAdherencePct, netCalBalance>700?'linear-gradient(90deg,#ef4444,#f97316)':netCalBalance>0?'linear-gradient(90deg,#f59e0b,#fbbf24)':'linear-gradient(90deg,#3b82f6,#06B6D4)') +
                calTargetBarChart(calConsumedByDay, calPlannedByDay, netCalBalance>700?'#ef4444':'#f59e0b', '#3b82f6') +
            '</div>';

            if(balancePct!=null) html += '<div class="game-index-row" data-explain="stress">' +
                '<div class="game-index-label"><span><i class="fas fa-heart-pulse" style="color:#10b981"></i> Емоционален баланс</span><span>'+balancePct+'%</span></div>' +
                '<div class="game-index-hint">'+(balancePct>=70?'<i class="fas fa-check-circle" style="color:#10b981"></i> Висок баланс':balancePct>=40?'<i class="fas fa-circle" style="color:#f59e0b"></i> Умерен':'<i class="fas fa-circle" style="color:#ef4444"></i> Нисък баланс')+' · По-висок % = по-добре · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(balancePct,'linear-gradient(90deg,#10b981,#06B6D4)') + miniBarChart(balanceByDay,100,'#10b981') +
            '</div>';

            if(sleepPct!=null) html += '<div class="game-index-row" data-explain="sleep">' +
                '<div class="game-index-label"><span><i class="fas fa-bed" style="color:#6366f1"></i> Сън</span><span>'+sleepPct+'%</span></div>' +
                '<div class="game-index-hint">'+(sleepPct>=70?'<i class="fas fa-check-circle" style="color:#10b981"></i> Добър сън':sleepPct>=40?'<i class="fas fa-circle" style="color:#f59e0b"></i> Умерен':'<i class="fas fa-circle" style="color:#ef4444"></i> Нисък')+' · По-висок % = по-добре · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(sleepPct,'linear-gradient(90deg,#6366f1,#8b5cf6)') + miniBarChart(sleepByDay,100,'#6366f1') +
            '</div>';

            if(actPct!=null) html += '<div class="game-index-row" data-explain="activity">' +
                '<div class="game-index-label"><span><i class="fas fa-person-walking" style="color:#f59e0b"></i> Активност</span><span>'+actPct+'%</span></div>' +
                '<div class="game-index-hint">'+(actPct>=70?'<i class="fas fa-check-circle" style="color:#10b981"></i> Висока':actPct>=40?'<i class="fas fa-circle" style="color:#f59e0b"></i> Умерена':'<i class="fas fa-circle" style="color:#ef4444"></i> Ниска')+' · По-висок % = по-добре · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(actPct,'linear-gradient(90deg,#f59e0b,#fbbf24)') + miniBarChart(actByDay,100,'#f59e0b') +
            '</div>';

            if(waterPct!=null) html += '<div class="game-index-row" data-explain="water">' +
                '<div class="game-index-label"><span><i class="fas fa-droplet" style="color:#06B6D4"></i> Хидратация</span><span>'+waterPct+'%</span></div>' +
                '<div class="game-index-hint">'+(waterPct>=70?'<i class="fas fa-check-circle" style="color:#10b981"></i> Добра':waterPct>=40?'<i class="fas fa-circle" style="color:#f59e0b"></i> Умерена':'<i class="fas fa-circle" style="color:#ef4444"></i> Ниска')+' · Дни с достатъчен прием вода · <i class="fas fa-circle-info"></i> натисни за детайли</div>' +
                pBar(waterPct,'linear-gradient(90deg,#06B6D4,#0284C7)') + miniBarChart(waterByDay,100,'#06B6D4') +
            '</div>';

            if(noDataDaysCount>0) html += '<div class="game-no-data-note"><i class="fas fa-calendar-xmark"></i> ' + noDataDaysCount + ' ' + (noDataDaysCount===1?'ден':'дни') + ' без отбелязана активност (отчетени като 0%)</div>';

            // Correlations & insights section
            if(insights.length>0){
                html += '<div class="game-section-title">Корелации &amp; открития</div>';
                insights.forEach(function(ins, ii){ html += '<div class="game-insight-card ga-card-enter" style="animation-delay:'+(0.05+ii*0.08)+'s">'+ins+'</div>'; });
            }

            // Scenario / prediction
            if(scenario){
                html += '<div class="game-section-title">Прогноза</div>';
                html += '<div class="game-scenario-card ga-card-enter" style="animation-delay:0.1s"><div class="game-scenario-label">AI сценарий</div>'+scenario+'</div>';
            }

            // Encouragement
            html += '<div class="game-encourage-note ga-card-enter" style="animation-delay:0.15s">'+encourageText+'</div>';

            // Weekly AI note
            var weeklyInfo={};
            try { weeklyInfo=JSON.parse(localStorage.getItem('gameWeeklyAI')||'{}'); } catch(e) {}
            if(weeklyInfo.nextDue){ var nd=new Date(weeklyInfo.nextDue); html += '<div class="game-weekly-info"><i class="fas fa-robot"></i> Следващ AI анализ: '+nd.toLocaleDateString('bg-BG')+'</div>'; }

            html += '</div>'; // close gameMetricsDetails

            body.innerHTML = html;

            // ── Trigger entrance animations after DOM is painted ─────────────
            var GA_RING_START   = 120;  // ms delay before first ring animates
            var GA_RING_STAGGER = 130;  // ms between each ring
            var GA_RING_COUNTER = 900;  // ms counter count-up duration
            var GA_BAR_START    = 350;  // ms delay before first progress bar animates
            var GA_BAR_STAGGER  = 60;   // ms between each bar
            var GA_CHART_START  = 400;  // ms delay before mini/bidir bar charts animate
            var GA_CHART_STAGGER= 25;   // ms between each chart column
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    // 1. Animate SVG ring arcs (fill from empty to target)
                    body.querySelectorAll('[data-ga-ring-offset]').forEach(function(el, i) {
                        setTimeout(function() {
                            el.style.strokeDashoffset = el.getAttribute('data-ga-ring-offset');
                        }, GA_RING_START + i * GA_RING_STAGGER);
                    });

                    // 2. Animate ring counter text 0→value
                    body.querySelectorAll('[data-ga-ring-target]').forEach(function(el, i) {
                        var target = parseInt(el.getAttribute('data-ga-ring-target'), 10);
                        if (isNaN(target)) { el.textContent = '?'; return; }
                        var start = GA_RING_START + i * GA_RING_STAGGER;
                        var duration = GA_RING_COUNTER;
                        var startTime = null;
                        function step(ts) {
                            if (!startTime) startTime = ts;
                            var elapsed = ts - startTime;
                            if (elapsed < 0) { requestAnimationFrame(step); return; }
                            var progress = Math.min(elapsed / duration, 1);
                            var ease = 1 - Math.pow(1 - progress, 3);
                            el.textContent = Math.round(target * ease) + '%';
                            if (progress < 1) requestAnimationFrame(step);
                        }
                        setTimeout(function() { requestAnimationFrame(step); }, start);
                    });

                    // 3. Animate progress bars 0→width
                    body.querySelectorAll('[data-ga-bar]').forEach(function(el, i) {
                        setTimeout(function() {
                            el.style.width = el.getAttribute('data-ga-bar') + '%';
                        }, GA_BAR_START + i * GA_BAR_STAGGER);
                    });

                    // 4. Animate mini bar heights
                    body.querySelectorAll('[data-ga-bar-h]').forEach(function(el, i) {
                        setTimeout(function() {
                            el.style.height = el.getAttribute('data-ga-bar-h');
                        }, GA_CHART_START + i * GA_CHART_STAGGER);
                    });

                    // 5. Animate bidirectional bar heights
                    body.querySelectorAll('[data-ga-bidir-h]').forEach(function(el, i) {
                        setTimeout(function() {
                            el.style.height = el.getAttribute('data-ga-bidir-h');
                        }, GA_CHART_START + i * GA_CHART_STAGGER);
                    });
                });
            });
            // ── End entrance animations ───────────────────────────────────────

            // Attach explain handlers
            body.querySelectorAll('[data-explain]').forEach(function(el){
                el.addEventListener('click', function(){ showExplanation(el.getAttribute('data-explain')); });
            });
        })();
        // ── End Current Analysis Loader ──────────────────────────────────────
