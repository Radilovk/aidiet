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
                    // Non-tab page (questionnaire, food-picker, etc.): navigate top window
                    if (replace) window.top.location.replace(url);
                    else window.top.location.href = url;
                } else {
                    if (replace) window.location.replace(url);
                    else window.location.href = url;
                }
            };
        })();

        // Worker URL configuration
        const WORKER_URL = 'https://aidiet.radilov-k.workers.dev';
        
        // Global state
        let dietPlan = null;
        let userId = null;
        let userData = null;
        let currentDay = 1;
        let chatVisible = false;
        let conversationId = Date.now().toString();
        let chatMode = 'consultation'; // 'consultation', 'modification', or 'report'
        let modificationModeEnabled = false;
        let chatHistory = []; // Store chat messages for persistence
        
        // REVOLUTIONARY OPTIMIZATION: Chat context caching state
        let chatContextCached = false; // Track if context is cached on server
        let cacheSyncInProgress = false; // Prevent duplicate cache sync requests
        
        // Enhancement #1: Retry mechanism state
        let isSending = false;
        const MAX_RETRIES = 2;
        const RETRY_DELAYS = [2000, 5000]; // Exponential backoff delays in ms
        
        // Enhancement #2: Debouncing state
        let sendMessageTimeout = null;
        const DEBOUNCE_DELAY = 300; // ms
        
        // Enhancement #6: Undo functionality - Plan history
        let planHistory = [];
        const MAX_HISTORY_SIZE = 5;
        
        // Enhancement #7: Rate limiting
        let messageTimestamps = [];
        const RATE_LIMIT_WINDOW = 60000; // 1 minute
        const MAX_MESSAGES_PER_WINDOW = 10;
        
        // Enhancement #8: Offline message queue with deduplication
        let offlineMessageQueue = [];
        let messageIdCounter = 0;
        let isOnline = navigator.onLine;
        
        // Enhancement #9: Message deduplication cache
        // Prevents duplicate messages from being sent within a time window
        let recentMessageCache = new Map(); // Map<messageText, timestamp>
        const MESSAGE_DEDUP_WINDOW = 3000; // 3 seconds - if same message sent within this window, it's ignored
        
        // Demo version: Daily limits
        const MAX_DAILY_CHAT_MESSAGES = 5;    // Demo: 5 chat requests per day
        const MAX_DAILY_IMAGE_ANALYSES = 5;   // Demo: 5 image analyses per day
        let isDemoLimitUnlocked = false;

        function getTodayKey() {
            const d = new Date();
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }

        function getDailyChatCount() {
            const key = 'demoChatCount_' + getTodayKey();
            return parseInt(localStorage.getItem(key) || '0', 10);
        }

        function incrementDailyChatCount() {
            const key = 'demoChatCount_' + getTodayKey();
            const newVal = getDailyChatCount() + 1;
            localStorage.setItem(key, String(newVal));
            return newVal;
        }

        function getDailyImageCount() {
            const key = 'demoImageCount_' + getTodayKey();
            return parseInt(localStorage.getItem(key) || '0', 10);
        }

        function incrementDailyImageCount() {
            const key = 'demoImageCount_' + getTodayKey();
            const newVal = getDailyImageCount() + 1;
            localStorage.setItem(key, String(newVal));
            return newVal;
        }
        
        /**
         * Check if a message is a duplicate of a recent message
         * Returns true if message should be blocked (is duplicate)
         */
        function isDuplicateMessage(message) {
            const now = Date.now();
            const normalizedMessage = message.toLowerCase().trim();
            
            // Clean up old entries from cache
            for (const [msg, timestamp] of recentMessageCache.entries()) {
                if (now - timestamp > MESSAGE_DEDUP_WINDOW) {
                    recentMessageCache.delete(msg);
                }
            }
            
            // Check if message exists in recent cache
            if (recentMessageCache.has(normalizedMessage)) {
                const lastSent = recentMessageCache.get(normalizedMessage);
                if (now - lastSent < MESSAGE_DEDUP_WINDOW) {
                    console.log('[Dedup] Blocking duplicate message within 3s window:', message);
                    return true; // Duplicate detected
                }
            }
            
            // Add message to cache
            recentMessageCache.set(normalizedMessage, now);
            return false; // Not a duplicate
        }
        
        // ===================================================================
        // GAME NOTIFIER – gamification-based notification scheduling
        // ===================================================================

        /**
         * Platform Detection Utility
         */
        const PlatformDetector = {
            isIOS: () => {
                return /iPhone|iPad|iPod/i.test(navigator.userAgent);
            },
            isAndroid: () => {
                return /Android/i.test(navigator.userAgent);
            },
            isHuawei: () => {
                // Detect Huawei devices
                return /huawei/i.test(navigator.userAgent) || /harmony/i.test(navigator.userAgent);
            },
            isSafari: () => {
                return /Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent);
            },
            isChrome: () => {
                return /Chrome/i.test(navigator.userAgent) && !/Edg/i.test(navigator.userAgent);
            },
            isFirefox: () => {
                return /Firefox/i.test(navigator.userAgent);
            },
            isEdge: () => {
                return /Edg/i.test(navigator.userAgent);
            },
            isPWA: () => {
                // Check if running as installed PWA
                return window.matchMedia('(display-mode: standalone)').matches || 
                       window.navigator.standalone === true;
            },
            supportsNotifications: () => {
                return 'Notification' in window && 'serviceWorker' in navigator;
            },
            getBrowserName: () => {
                if (PlatformDetector.isEdge()) return 'Edge';
                if (PlatformDetector.isChrome()) return 'Chrome';
                if (PlatformDetector.isFirefox()) return 'Firefox';
                if (PlatformDetector.isSafari()) return 'Safari';
                return 'Unknown';
            },
            getCompatibilityInfo: () => {
                const info = {
                    platform: 'unknown',
                    browser: PlatformDetector.getBrowserName(),
                    notificationsSupported: false,
                    requiresPWAInstall: false,
                    limitedSupport: false,
                    recommendations: []
                };
                
                if (PlatformDetector.isIOS()) {
                    info.platform = 'iOS';
                    info.requiresPWAInstall = !PlatformDetector.isPWA();
                    info.limitedSupport = true;
                    info.notificationsSupported = PlatformDetector.isPWA();
                    
                    if (!PlatformDetector.isSafari()) {
                        // Chrome or Firefox on iOS
                        info.notificationsSupported = false;
                        info.recommendations.push('Chrome и Firefox на iOS не поддържат известия');
                        info.recommendations.push('Моля използвайте Safari и инсталирайте приложението');
                        info.recommendations.push('Safari → Share → Add to Home Screen');
                    } else if (!PlatformDetector.isPWA()) {
                        info.recommendations.push('Инсталирайте приложението на начален екран за известия');
                        info.recommendations.push('Safari → Share → Add to Home Screen');
                        info.recommendations.push('След това отворете от началния екран');
                    }
                } else if (PlatformDetector.isHuawei()) {
                    info.platform = 'Huawei';
                    info.notificationsSupported = true;   // calendar subscription counts
                    info.calendarFallback = true;
                    info.calendarUrl = 'webcal://aidiet.radilov-k.workers.dev/api/calendar.ics';
                    info.limitedSupport = true;
                    info.recommendations.push('Абонирайте се за напомняния чрез Calendar приложението');
                    info.recommendations.push('Натиснете "Абонирай се" за автоматични напомняния');
                    info.recommendations.push('Huawei Calendar ще се обновява автоматично при промени');
                } else if (PlatformDetector.isAndroid()) {
                    info.platform = 'Android';
                    info.notificationsSupported = PlatformDetector.supportsNotifications();
                    info.limitedSupport = false;
                    if (!info.notificationsSupported) {
                        info.recommendations.push('Вашият браузър не поддържа известия');
                        info.recommendations.push('Използвайте Chrome, Firefox или Samsung Internet');
                    }
                } else {
                    info.platform = 'Desktop';
                    info.notificationsSupported = PlatformDetector.supportsNotifications();
                    info.limitedSupport = false;
                    if (!info.notificationsSupported) {
                        info.recommendations.push('Вашият браузър не поддържа известия');
                        info.recommendations.push('Използвайте модерен браузър: Chrome, Firefox, Edge или Safari 16+');
                    }
                }
                
                return info;
            }
        };

        /**
         * Schedule / reschedule game notifications via GameNotifier (local-scheduler.js).
         * Only acts when notification permission is already granted.
         */
        function scheduleNotifications() {
            if (!window.GameNotifier) return;
            const isCapacitorApp = !!(
                window.Capacitor &&
                typeof window.Capacitor.isNativePlatform === 'function' &&
                window.Capacitor.isNativePlatform()
            );
            if (!isCapacitorApp) {
                if (!('Notification' in window) || Notification.permission !== 'granted') return;
            }
            window.GameNotifier.init().catch(e =>
                console.warn('[Notifications] GameNotifier.init error:', e)
            );
        }

        // ===================================================================
        // END GAME NOTIFIER
        // ===================================================================
            
        
        // UI strings for chat modes
        const CHAT_MODE_STRINGS = {
            consultation: {
                activatedMessage: '🔒 Режимът за консултация е активиран. Мога да отговарям на въпроси, но не мога да променям плана.',
                modeLabel: 'Режим: Консултация',
                icon: { color: '#4CAF50' },
                background: '#E8F5E9',
                backgroundDark: '#2d4a2e'
            },
            modification: {
                activatedMessage: '🔓 Режимът за промяна на плана е активиран. Сега мога да променям вашия план според желанията ви.',
                modeLabel: 'Режим: Промяна на план',
                icon: { color: '#FF5722' },
                background: '#FFEBEE',
                backgroundDark: '#4a2d2d'
            },
            report: {
                activatedMessage: '📝 Режимът за докладване на проблем е активиран. Опишете проблема, който срещате, и той ще бъде изпратен до администратора.',
                modeLabel: 'Режим: Докладване на проблем',
                icon: { color: '#ff9800' },
                background: '#FFF3E0',
                backgroundDark: '#4a3d2d'
            },
            // Button labels for switching modes (key is the target mode)
            toggleButtons: {
                toModification: '<i class="fas fa-edit"></i><span>Промени план</span>',
                toConsultation: '<i class="fas fa-comment"></i><span>Консултация</span>',
                toReport: '<i class="fas fa-exclamation-circle"></i><span>Докладвай проблем</span>'
            },
            buttonColors: {
                toModification: 'var(--primary-red)',
                toConsultation: '#4CAF50',
                toReport: '#ff9800'
            }
        };
        
        // Enhancement #8: Online/Offline event listeners
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        
        function handleOnline() {
            isOnline = true;
            console.log('Connection restored');
            // Process queued messages
            processOfflineQueue();
        }
        
        function handleOffline() {
            isOnline = false;
            console.log('Connection lost');
            addMessageToChat('⚠️ Няма връзка с интернет. Съобщенията ще бъдат изпратени при възстановяване на връзката.', 'assistant');
        }
        
        async function processOfflineQueue() {
            if (offlineMessageQueue.length === 0) return;
            
            addMessageToChat('✓ Връзката е възстановена. Изпращам запазени съобщения...', 'assistant');
            
            const queue = [...offlineMessageQueue];
            offlineMessageQueue = [];
            
            for (const messageObj of queue) {
                // Start with retry count 0 for queued messages (fresh attempt)
                await sendMessageInternal(messageObj.text, 0, messageObj.id);
                await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between messages
            }
            
            // Clear localStorage after successful processing
            saveOfflineQueue();
        }

        // --- Instant Initialization (runs before DOMContentLoaded for faster startup) ---
        (function instantInit() {
            // Initialize theme immediately
            initializeTheme();
            
            // Load critical data synchronously from localStorage
            loadChatModeConfig();
            
            // Pre-initialize any sync data structures
            if (document.readyState === 'loading') {
                // DOM still loading, wait for it
                document.addEventListener('DOMContentLoaded', initializeDOMDependentFeatures);
            } else {
                // DOM already loaded, run immediately
                initializeDOMDependentFeatures();
            }
        })();
        
        // --- DOM-Dependent Initialization ---
        async function initializeDOMDependentFeatures() {
            // On Capacitor APK: restore plan data from Android SharedPreferences into
            // localStorage before checking for plan data (handles APK reinstall scenario).
            if (typeof NativeBackup !== 'undefined') {
                await NativeBackup.init().catch(() => {});
            }
            loadDietData();
            // Reveal the page now that critical content is rendered from localStorage.
            // Using rAF ensures the browser has committed the opacity:0 frame before
            // transitioning to opacity:1 so the CSS transition fires correctly.
            requestAnimationFrame(function() {
                document.body.style.transition = 'opacity 120ms ease-out';
                document.body.style.opacity = '1';
            });
            // Enhancement #8: Load offline queue
            loadOfflineQueue();
            // Enhancement #6: Load plan history
            loadPlanHistory();
            // Load chat history
            loadChatHistory();
            // Initialise game notifications (GameNotifier in local-scheduler.js).
            // GameNotifier.init() uses only locally cached config — no backend calls on app open.
            scheduleNotifications();
            // Handle URL action params from notification taps
            const urlParams = new URLSearchParams(window.location.search);
            const action = urlParams.get('action');
            if (action === 'morning_check' || action === 'evening_check') {
                // Clean URL immediately so refresh doesn't re-trigger
                window.history.replaceState({}, '', window.location.pathname);
                // Wait for gamification module to initialise, then fire the question
                setTimeout(function() {
                    if (action === 'morning_check' && typeof window._gameShowMorning === 'function') {
                        window._gameShowMorning(true);
                    } else if (action === 'evening_check' && typeof window._gameShowEvening === 'function') {
                        window._gameShowEvening(true);
                    }
                }, 2000);
            }
            // Auto-open chat if navigated with ?chat=1
            if (urlParams.get('chat') === '1') {
                setTimeout(function() { openChat(); }, 500);
                window.history.replaceState({}, '', window.location.pathname);
            }
        }

        function loadChatModeConfig() {
            // Reads ONLY from localStorage — no backend call ever from plan.html.
            // The setting is written to localStorage only by admin.html when the admin
            // explicitly enables or disables the feature (that POST to the backend is
            // the ONLY legitimate backend call for this config).
            modificationModeEnabled = localStorage.getItem('chatModificationModeEnabled') === 'true';

            if (!modificationModeEnabled && chatMode === 'modification') {
                chatMode = 'consultation';
                saveChatHistory();
            }

            if (chatVisible) updateModeUI();
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

        function getProfileSyncSignature(uid, planStr, userDataStr, planSource) {
            const input = [uid || '', planSource || '', planStr || '', userDataStr || ''].join('\n');
            let hash = 2166136261;
            for (let i = 0; i < input.length; i++) {
                hash ^= input.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return String(input.length) + ':' + (hash >>> 0).toString(36);
        }

        // --- Load Diet Data ---
        // Guard flag to prevent re-entry after backend restore
        let _loadDietDataCalled = false;
        function loadDietData() {
            try {
                // Guard: plan submitted via questionnaire2 must wait for admin approval
                if (localStorage.getItem('planSource') === 'questionnaire2') {
                    _shellNav('plan-pending.html', true);
                    return;
                }

                // Load from localStorage
                const planData = localStorage.getItem('dietPlan');
                userId = localStorage.getItem('userId');
                const userDataStr = localStorage.getItem('userData');
                
                if (!planData || !userId) {
                    // Before showing an error, try to restore from the backend using
                    // the np_uid cookie.  This handles the iOS PWA isolated-storage
                    // scenario where index.html was bypassed (e.g. user bookmarked
                    // plan.html directly) or cookies were not yet restored.
                    // The _loadDietDataCalled guard prevents infinite recursion.
                    const cookieMatch = document.cookie.match(/(?:^|;\s*)np_uid=([^;]*)/);
                    const cookieUserId = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
                    if (cookieUserId && !_loadDietDataCalled) {
                        _loadDietDataCalled = true;
                        fetch(`https://aidiet.radilov-k.workers.dev/api/user/profile?userId=${encodeURIComponent(cookieUserId)}`)
                            .then(r => r.ok ? r.json() : null)
                            .then(data => {
                                if (data && data.found && data.plan) {
                                    localStorage.setItem('dietPlan', JSON.stringify(data.plan));
                                    localStorage.setItem('userId', cookieUserId);
                                    if (data.userData) {
                                        localStorage.setItem('userData', JSON.stringify(data.userData));
                                    }
                                    console.log('[PWA] Plan restored from backend in plan.html');
                                    // Re-run loadDietData now that localStorage is populated
                                    loadDietData();
                                } else {
                                    showError('Няма намерен план. Моля, попълнете въпросника.', true);
                                }
                            })
                            .catch(() => showError('Няма намерен план. Моля, попълнете въпросника.', true));
                        return;
                    }
                    // Redirect to questionnaire if no data
                    showError('Няма намерен план. Моля, попълнете въпросника.', true);
                    return;
                }

                dietPlan = JSON.parse(planData);
                migrateMealTypes(dietPlan);
                correctPlanCalories(dietPlan);
                userData = userDataStr ? JSON.parse(userDataStr) : {};
                
                // Validate plan structure
                if (!dietPlan.weekPlan || typeof dietPlan.weekPlan !== 'object') {
                    throw new Error('Invalid plan structure');
                }
                
                // Validate at least one day exists with meals
                const hasDays = Object.keys(dietPlan.weekPlan).some(key => 
                    dietPlan.weekPlan[key] && Array.isArray(dietPlan.weekPlan[key].meals)
                );
                if (!hasDays) {
                    throw new Error('No meal data found in plan');
                }
                
                // Update user avatar with first letter of name
                const avatar = document.querySelector('.user-avatar');
                if (avatar && userData.name) {
                    avatar.textContent = userData.name.charAt(0).toUpperCase();
                }

                // Update greeting — no longer a banner; kept for future use only
                // (greetingName element removed from DOM)

                // Render initial data – use the day already set by the inline script
                // This prevents flashing from Monday to the actual current day
                const initialDay = window._initialPlanDay || getTodayPlanDay();
                selectDay(initialDay);
                
                // REQUIREMENT 3: Display plan justification
                displayPlanJustification();
                
                // Macros visualization moved to guidelines.html
                
                // Initialize client-side notification scheduler
                scheduleNotifications();

                // Ensure np_uid cookie + backend profile exist so the iOS PWA can restore
                // data via restoreProfileFromCookies() in index.html.
                // np_uid is always refreshed; backend save is retried until np_profile_synced
                // is confirmed (guards against silent fetch failures on first run).
                (async function ensureProfileCookies() {
                    const uid = localStorage.getItem('userId');
                    const planStr = localStorage.getItem('dietPlan');
                    if (!uid || !planStr) return;
                    // Always refresh the cookie so it doesn't expire
                    const OPTS = `;path=/;max-age=${365*24*60*60};SameSite=Lax;Secure`;
                    document.cookie = `np_uid=${encodeURIComponent(uid)}${OPTS}`;
                    const udStr = localStorage.getItem('userData');
                    const planSource = localStorage.getItem('planSource') || '';
                    const profileSig = getProfileSyncSignature(uid, planStr, udStr || '', planSource);
                    // Skip backend save only when this exact local profile was already confirmed.
                    if (localStorage.getItem('np_profile_synced') === '1' &&
                        localStorage.getItem('np_profile_sync_sig') === profileSig) return;
                    const fbAuth = window.npFirebaseAuth;
                    const idToken = (uid.startsWith('fb_') && fbAuth && fbAuth.currentUser)
                        ? await fbAuth.currentUser.getIdToken().catch(() => null)
                        : null;
                    fetch('https://aidiet.radilov-k.workers.dev/api/user/save-profile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: uid,
                            plan: JSON.parse(planStr),
                            userData: udStr ? JSON.parse(udStr) : {},
                            planSource,
                            ...(idToken ? { idToken } : {})
                        })
                    }).then(r => {
                        if (r && r.ok) {
                            localStorage.setItem('np_profile_synced', '1');
                            localStorage.setItem('np_profile_sync_sig', profileSig);
                        }
                    })
                      .catch(() => {});
                })();

            } catch (error) {
                console.error('Error loading diet data:', error);
                showError('Грешка при зареждане на данните. Моля, генерирайте нов план.', true);
            }
        }

        // Store welcome message and plan justification; show modal on first load of new plan
        function displayPlanJustification() {
            try {
                if (!dietPlan || !dietPlan.strategy) {
                    return;
                }

                const strategy = dietPlan.strategy;

                // Get AI-generated welcome message from strategy
                let welcomeMessage = strategy.welcomeMessage || '';

                // Fallback to planJustification if welcomeMessage is not available (backward compatibility)
                if (!welcomeMessage || welcomeMessage.length < 50) {
                    welcomeMessage = strategy.planJustification || '';

                    // If still empty, create basic fallback
                    if (!welcomeMessage || welcomeMessage.length < 20) {
                        const modifier = strategy.dietaryModifier || 'Балансиран';
                        const goal = (userData && userData.goal) ? userData.goal : 'здравословен живот';

                        welcomeMessage = `Здравейте, ${userData && userData.name ? userData.name : ''}!\n\n`;
                        welcomeMessage += `Този ${modifier.toLowerCase()} план е създаден специално за Вас, базиран на вашата уникална комбинация от фактори. `;
                        welcomeMessage += `Целта ви за ${goal.toLowerCase()} е водеща при изграждането на плана.\n\n`;
                        welcomeMessage += `Всяка калория, всеки макронутриент и всяко хранене са прецизно подбрани, за да Ви помогнат да постигнете желаните резултати по здравословен и устойчив начин.`;
                    }
                }

                // Store for use in profile page (keep planJustification for profile)
                const justification = strategy.planJustification || welcomeMessage;
                localStorage.setItem('planJustification', justification);
                localStorage.setItem('welcomeMessage', welcomeMessage);

                // Store all strategy detail fields for display in profile
                if (strategy.longTermStrategy) {
                    localStorage.setItem('longTermStrategy', strategy.longTermStrategy);
                }
                if (strategy.mealCountJustification) {
                    localStorage.setItem('mealCountJustification', strategy.mealCountJustification);
                }
                if (strategy.afterDinnerMealJustification && strategy.afterDinnerMealJustification !== 'Не са необходими') {
                    localStorage.setItem('afterDinnerMealJustification', strategy.afterDinnerMealJustification);
                } else {
                    localStorage.removeItem('afterDinnerMealJustification');
                }
                if (strategy.modifierReasoning) {
                    localStorage.setItem('modifierReasoning', strategy.modifierReasoning);
                }
                if (strategy.hydrationStrategy) {
                    localStorage.setItem('hydrationStrategy', strategy.hydrationStrategy);
                }

                // Show welcome modal only on first load of a newly generated plan
                const hasSeenJustification = localStorage.getItem('hasSeenPlanJustification');
                if (!hasSeenJustification || hasSeenJustification !== 'true') {
                    const welcomeMessageElement = document.getElementById('aiWelcomeMessage');
                    if (welcomeMessageElement) {
                        welcomeMessageElement.textContent = welcomeMessage;
                    }
                    welcomeModal.classList.add('active');
                    // Note: hasSeenPlanJustification is set when user closes the modal
                }

            } catch (error) {
                console.error('Error displaying plan justification:', error);
            }
        }

        // Show error message
        function showError(message, redirect = false) {
            const container = document.querySelector('.container');
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px;">
                        <div style="font-size: 3rem; color: #e74c3c; margin-bottom: 20px;">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <h2 style="color: var(--text-dark); margin-bottom: 15px;">Грешка</h2>
                        <p style="color: var(--text-light); margin-bottom: 30px;">${message}</p>
                        <button onclick="_shellNav('questionnaire.html')" 
                                style="background: var(--primary-red); color: white; border: none; 
                                       padding: 15px 30px; border-radius: 25px; font-size: 1rem; 
                                       font-weight: 600; cursor: pointer;">
                            Към въпросника
                        </button>
                    </div>
                `;
            }
            if (redirect) {
                // When embedded in the app shell the auth overlay is already visible
                // on top; after login onAuthStateChanged calls window.loadDietData()
                // which overwrites this error — so never auto-navigate away from inside
                // the iframe (it would replace app.html and lose all tabs).
                if (window.self !== window.top) return;
                setTimeout(() => {
                    _shellNav('questionnaire.html');
                }, 3000);
            }
        }

        // --- Calorie corrector: fixes per-meal calorie inconsistencies and sets free-meal planned calories ---
        // If a meal's declared calories differ from protein×4+carbs×4+fats×9 by more than 10%,
        // the calculated value is used. "Свободно хранене" gets its planned calories from the
        // strategy weeklyScheme Хранене 2 mealBreakdown entry so it is counted in dailyTotals.
        const PLAN_DAY_NUMBER_TO_KEY = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        function correctPlanCalories(plan) {
            if (!plan || !plan.weekPlan) return;
            Object.keys(plan.weekPlan).forEach(function(dayKey) {
                var dayData = plan.weekPlan[dayKey];
                if (!dayData || !Array.isArray(dayData.meals)) return;
                var dayNum = parseInt(dayKey.replace('day', ''), 10);
                var weekdayKey = (dayNum >= 1 && dayNum <= 7) ? PLAN_DAY_NUMBER_TO_KEY[dayNum - 1] : null;
                var totalCal = 0, totalProtein = 0, totalCarbs = 0, totalFats = 0;
                dayData.meals.forEach(function(meal) {
                    if (meal.type === 'Свободно хранене') {
                        // Estimate planned calories for the free meal from strategy mealBreakdown
                        var freeCal = 0;
                        if (plan.strategy && plan.strategy.weeklyScheme && weekdayKey) {
                            var ds = plan.strategy.weeklyScheme[weekdayKey];
                            if (ds && Array.isArray(ds.mealBreakdown)) {
                                var lunchEntry = ds.mealBreakdown.find(function(m) {
                                    return m.type === 'Хранене 2' || m.type === 'Свободно хранене';
                                });
                                if (lunchEntry && lunchEntry.calories) freeCal = parseInt(lunchEntry.calories) || 0;
                            }
                            // Fallback: evenly distribute day calories across meals
                            if (!freeCal && plan.strategy.weeklyScheme[weekdayKey]) {
                                var ds2 = plan.strategy.weeklyScheme[weekdayKey];
                                if (ds2.calories && ds2.meals) freeCal = Math.round(ds2.calories / ds2.meals);
                            }
                        }
                        if (freeCal > 0) meal._plannedCalories = freeCal;
                        totalCal += freeCal;
                        return;
                    }
                    if (meal.macros) {
                        var p = parseFloat(meal.macros.protein) || 0;
                        var c = parseFloat(meal.macros.carbs) || 0;
                        var f = parseFloat(meal.macros.fats) || 0;
                        var calcCal = Math.round(p * 4 + c * 4 + f * 9);
                        if (calcCal > 0) {
                            var declared = parseInt(meal.calories) || 0;
                            // Replace declared calories when missing or diverging >10% from macro formula
                            if (declared <= 0 || Math.abs(declared - calcCal) / calcCal > 0.10) {
                                meal.calories = calcCal;
                            }
                        }
                        totalProtein += p;
                        totalCarbs += c;
                        totalFats += f;
                    }
                    totalCal += parseInt(meal.calories) || 0;
                });
                if (!dayData.dailyTotals) dayData.dailyTotals = {};
                dayData.dailyTotals.calories = totalCal;
                if (totalProtein > 0) dayData.dailyTotals.protein = Math.round(totalProtein);
                if (totalCarbs > 0) dayData.dailyTotals.carbs = Math.round(totalCarbs);
                if (totalFats > 0) dayData.dailyTotals.fats = Math.round(totalFats);
            });
        }

        // Helper function to escape HTML and preserve newlines as <br>
        function escapeHtmlWithBreaks(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML.replace(/\n/g, '<br>');
        }

        // --- Date-key helpers (global scope, shared by renderDay and addToMyMenu) ---
        function _zp(n) { return n < 10 ? '0' + n : '' + n; }
        /** Return 'YYYY-MM-DD' for the calendar date that corresponds to plan day 1-7 (Mon-Sun). */
        function planDayToDateKey(dayNum) {
            var now = new Date();
            var jsDay = now.getDay(); // 0=Sun
            var todayPlanDay = jsDay === 0 ? 7 : jsDay;
            var offset = dayNum - todayPlanDay;
            var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
            return d.getFullYear() + '-' + _zp(d.getMonth() + 1) + '-' + _zp(d.getDate());
        }
        /** Return 'YYYY-MM-DD' for today. */
        function todayDateKey() {
            var now = new Date();
            return now.getFullYear() + '-' + _zp(now.getMonth() + 1) + '-' + _zp(now.getDate());
        }
        /** Format a suitability object into a benefit string for openModal. */
        function formatSuitabilityBenefit(suitability) {
            if (!suitability) return '';
            return (suitability.verdict || '') + (suitability.explanation ? ': ' + suitability.explanation : '');
        }

        /**
         * Migrates old meal type strings in a stored plan to the new canonical names.
         * Called once after JSON.parse() on load; mutates the plan in-place so all
         * subsequent logic sees only the canonical "Хранене N" types.
         */
        function migrateMealTypes(plan) {
            var aliases = {
                'Закуска':            'Хранене 1',
                'Обяд':               'Хранене 2',
                'Следобедна закуска': 'Хранене 3',
                'Следобедна':         'Хранене 3',
                'Десерт':             'Хранене 3',
                'Вечеря':             'Хранене 4',
                'Късна закуска':      'Хранене 5',
                'Междинно':           'Хранене 3',
                'Снак':               'Хранене 3',
                'Снек':               'Хранене 3',
                'Лека закуска':       'Хранене 3',
            };
            var weekPlan = plan && plan.weekPlan;
            if (!weekPlan) return;
            Object.keys(weekPlan).forEach(function(dayKey) {
                var day = weekPlan[dayKey];
                if (!day || !Array.isArray(day.meals)) return;
                day.meals.forEach(function(meal) {
                    if (meal && meal.type && aliases[meal.type]) {
                        meal.type = aliases[meal.type];
                    }
                });
            });
        }

        /**
         * Return the earliest hour at which a named meal type becomes available for check-in.
         * Returns -1 for unknown / intermediate meal types that are eaten "now".
         */
        function _mealUnlockHour(type) {
            var base = (type || '').replace(/_\d+$/, '');
            if (base === 'Хранене 1' || base === 'Закуска') return 6;
            if (base === 'Хранене 2' || base === 'Обяд')    return 12;
            if (base === 'Свободно хранене') return 12; // free meal replaces lunch slot
            if (base === 'Хранене 3' || base === 'Следобедна закуска' || base === 'Следобедна' || base === 'Десерт') return 14;
            if (base === 'Хранене 4' || base === 'Вечеря') return 18;
            if (base === 'Хранене 5' || base === 'Късна закуска') return 20;
            return -1; // unknown / intermediate — use ts-based hour
        }
        /**
         * Return the display-order hour for a photo-added meal so it can be
         * interleaved with planned meals.  For intermediate / unknown meal types
         * the timestamp of capture is used instead of a fixed window hour.
         */
        function _addedMealOrderHour(type, ts) {
            var h = _mealUnlockHour(type);
            if (h >= 0) return h;
            if (ts) { try { return new Date(ts).getHours(); } catch(e) {} }
            return new Date().getHours();
        }

        /**
         * Returns a human-friendly display label for a canonical meal type.
         * Falls back to the raw type string for unknown/legacy types.
         */
        var MEAL_DISPLAY_LABELS = {
            'Хранене 1': 'Закуска',
            'Хранене 2': 'Обяд',
            'Хранене 3': 'Следобедна закуска',
            'Хранене 4': 'Вечеря',
            'Хранене 5': 'Късна закуска',
            'Свободно хранене': 'Свободно хранене',
        };
        function getMealDisplayLabel(type) {
            return MEAL_DISPLAY_LABELS[type] || type;
        }

        // --- Render Day Meals ---
        function renderDay(dayNum) {
            currentDay = dayNum;
            // Set early so getCurrentViewDayKey() works correctly for the entire function
            window._gameCurrentPlanDay = dayNum;
            const dayKey = `day${dayNum}`;
            const dayData = dietPlan.weekPlan && dietPlan.weekPlan[dayKey];
            
            if (!dayData || !dayData.meals) {
                console.warn(`No data for ${dayKey}`);
                return;
            }

            const mealContainer = document.getElementById('mealContainer');
            mealContainer.innerHTML = '';

            // Check if the current day has a free eating meal (determined by AI in step 3)
            const hasFreeMeal = dayData.meals.some(meal => meal.type === 'Свободно хранене');

            // Use freeDayNumber from strategy as the specific key for the free eating day
            const strategyFreeDayNumber = dietPlan.strategy && dietPlan.strategy.freeDayNumber != null
                ? Number(dietPlan.strategy.freeDayNumber) : null;
            const isFreeDayByStrategy = strategyFreeDayNumber !== null && strategyFreeDayNumber === dayNum;

            // If strategy marks this as free day but AI didn't generate the free meal entry, inject it at the lunch slot
            let effectiveMeals = dayData.meals;
            if (isFreeDayByStrategy && !hasFreeMeal) {
                const freeMealEntry = {type: 'Свободно хранене', name: 'Свободно хранене', weight: '-'};
                const lunchIdx = effectiveMeals.findIndex(m => m.type === 'Хранене 2' || m.type === 'Обяд');
                if (lunchIdx >= 0) {
                    effectiveMeals = [...effectiveMeals.slice(0, lunchIdx), freeMealEntry, ...effectiveMeals.slice(lunchIdx + 1)];
                } else {
                    effectiveMeals = [...effectiveMeals.slice(0, 1), freeMealEntry, ...effectiveMeals.slice(1)];
                }
            }
            const effectiveHasFreeMeal = hasFreeMeal || isFreeDayByStrategy;

            // Build breakfast-note element if strategy includes one
            const bs = dietPlan.strategy && dietPlan.strategy.breakfastStrategy;
            const skipsBreakfast = userData && Array.isArray(userData.eatingHabits) && userData.eatingHabits.includes('Не закусвам');
            let bsEl = null;
            if (bs) {
                const BREAKFAST_STRATEGY_COLLAPSE_THRESHOLD = 80;
                bsEl = document.createElement('div');
                bsEl.className = 'breakfast-note';
                if (bs.length > BREAKFAST_STRATEGY_COLLAPSE_THRESHOLD) {
                    bsEl.innerHTML = `<details><summary>☕ Сутрешен детокс и хидратация</summary>${escapeHtmlWithBreaks(bs)}</details>`;
                } else {
                    bsEl.innerHTML = `☕ <strong>Сутрешен детокс и хидратация:</strong> ${escapeHtmlWithBreaks(bs)}`;
                }
            }

            // If client skips breakfast, show breakfast-note BEFORE meal cards
            if (bsEl && skipsBreakfast) {
                mealContainer.appendChild(bsEl);
                bsEl = null; // already added, don't append again later
            }

            // Show animated reward banner only when the day contains a free eating meal
            if (effectiveHasFreeMeal) {
                const banner = document.createElement('div');
                banner.className = 'free-day-banner';
                banner.innerHTML = '<span class="free-day-icon">🍕</span><div class="free-day-title">Свободно хранене!</div><div class="free-day-subtitle">Насладете се на любимата си храна — заслужихте го!</div>';
                mealContainer.appendChild(banner);
            }

            effectiveMeals.forEach((meal) => {
                const isFreeMeal = meal.type === 'Свободно хранене';
                const mealCard = document.createElement('div');
                mealCard.className = isFreeMeal ? 'meal-card free-day' : 'meal-card';
                if (meal.calories) mealCard.setAttribute('data-meal-calories', meal.calories);
                else if (meal._plannedCalories) mealCard.setAttribute('data-meal-calories', meal._plannedCalories);
                if (meal.type) mealCard.setAttribute('data-meal-type', meal.type);
                mealCard.setAttribute('data-order-hour', _mealUnlockHour(meal.type));
                
                // Create button element separately to handle click with meal data
                const infoBtn = document.createElement('button');
                infoBtn.className = 'info-btn';
                infoBtn.innerHTML = '<i class="fas fa-info"></i>';
                infoBtn.onclick = function() {
                    if (isFreeMeal) {
                        openModal(
                            'Свободно хранене',
                            'Можеш свободно да консумираш любимата си храна.\n\nВажно: Любимата храна може да бъде консумирана след прием на зеленолистна салата, поръсена със семена или смлени ядки, поправена със зехтин и лимонов сок.',
                            'Насладете се на любимата си храна — заслужихте го!',
                            null, null, null, null
                        );
                    } else {
                        openModal(
                            meal.name, 
                            meal.description || '', 
                            meal.benefits || '',
                            meal.macros || null,
                            meal.dessert || null,
                            meal.weight || null,
                            meal.calories || null
                        );
                    }
                };
                
                const mealInfo = document.createElement('div');
                mealInfo.className = 'meal-info';
                mealInfo.innerHTML = `
                    <div class="meal-type">${escapeHtmlWithBreaks(getMealDisplayLabel(meal.type))}</div>
                    <div class="meal-name">${isFreeMeal ? 'Свободно хранене' : escapeHtmlWithBreaks(meal.name)}</div>
                    ${meal.dessert && typeof meal.dessert === 'object' && meal.dessert.name ? `<div class="meal-dessert"><i class="fas fa-cookie-bite"></i> <strong>Десерт:</strong> ${escapeHtmlWithBreaks(meal.dessert.name)}${meal.dessert.weight ? ` • ${escapeHtmlWithBreaks(meal.dessert.weight)}` : ''}</div>` : ''}
                `;
                
                mealCard.appendChild(mealInfo);
                mealCard.appendChild(infoBtn);
                mealContainer.appendChild(mealCard);
            });

            // Render photo-added meals for this day (from "Добави в плана"),
            // interleaved with planned meals by order hour.
            (function() {
                var viewDateKey = planDayToDateKey(dayNum);
                var addedMeals = [];
                try { addedMeals = JSON.parse(localStorage.getItem('addedMeals_' + viewDateKey) || '[]'); } catch(e) {}
                addedMeals.forEach(function(addedMeal, idx) {
                    var addedCard = document.createElement('div');
                    addedCard.className = 'meal-card added-meal-card';
                    addedCard.setAttribute('data-added-idx', idx);
                    var orderHour = _addedMealOrderHour(addedMeal.type, addedMeal.ts);
                    addedCard.setAttribute('data-order-hour', orderHour);

                    var addedInfo = document.createElement('div');
                    addedInfo.className = 'meal-info';
                    addedInfo.innerHTML =
                        '<div class="meal-type"><i class="fas fa-camera" style="font-size:0.75em;margin-right:4px;opacity:0.7"></i>' + escapeHtmlWithBreaks(addedMeal.type) + '</div>' +
                        '<div class="meal-name">' + escapeHtmlWithBreaks(addedMeal.name) + '</div>' +
                        (addedMeal.calories > 0 ? '<div class="added-meal-kcal">' + Math.round(addedMeal.calories) + ' kcal</div>' : '');

                    var addedBtn = document.createElement('button');
                    addedBtn.className = 'info-btn';
                    addedBtn.innerHTML = '<i class="fas fa-info"></i>';
                    (function(m) {
                        addedBtn.onclick = function() {
                            openModal(m.name, m.description || '', formatSuitabilityBenefit(m.suitability), m.macros || null, null, m.weight || null, m.calories || null);
                        };
                    })(addedMeal);

                    addedCard.appendChild(addedInfo);
                    addedCard.appendChild(addedBtn);

                    // Insert after the last planned meal whose order-hour is <= this meal's
                    // order-hour, so photo meals group near their time-period siblings.
                    var plannedCards = mealContainer.querySelectorAll('.meal-card:not(.added-meal-card)');
                    var insertBefore = null;
                    for (var i = 0; i < plannedCards.length; i++) {
                        if (parseInt(plannedCards[i].getAttribute('data-order-hour'), 10) > orderHour) {
                            insertBefore = plannedCards[i];
                            break;
                        }
                    }
                    if (insertBefore) {
                        mealContainer.insertBefore(addedCard, insertBefore);
                    } else {
                        mealContainer.appendChild(addedCard);
                    }
                });
            })();

            // Enhance meal cards with game checkmarks if game is enabled
            // (window._gameCurrentPlanDay already set at the top of renderDay)
            // Store planned calories in game record for this day (used for calorie balance computation)
            if (typeof window.gameModule !== 'undefined' && window.gameModule.isEnabled()) {
                var planCalTotal = effectiveMeals.reduce(function(s, m) { return s + (m.calories || m._plannedCalories || 0); }, 0);
                if (planCalTotal > 0) {
                    (function(cal) {
                        setTimeout(function() {
                            var dateKey = typeof window.gameModule.getCurrentViewDayKey === 'function'
                                ? window.gameModule.getCurrentViewDayKey() : null;
                            if (dateKey) {
                                var r = window.gameModule.getRecord(dateKey);
                                if (!r.plannedCalories) {
                                    r.plannedCalories = Math.round(cal);
                                    window.gameModule.saveRecord(dateKey, r);
                                }
                            }
                        }, 50);
                    })(planCalTotal);
                }
            }
            if (typeof window._gameEnhanceMealCards === 'function') {
                setTimeout(window._gameEnhanceMealCards, 0);
            }
            // Auto-show unanswered questions when navigating to a past day (up to 2 days back)
            if (typeof window._gameCheckPastDayQuestions === 'function') {
                var viewDateKey = typeof window.gameModule !== 'undefined' && typeof window.gameModule.getCurrentViewDayKey === 'function'
                    ? window.gameModule.getCurrentViewDayKey() : null;
                if (viewDateKey) {
                    window._gameCheckPastDayQuestions(viewDateKey);
                }
            }

            // breakfast-note is only shown when the client skips breakfast (already appended above)
        }

        // --- Helper function to format text with bullet points ---
        function formatContentWithBulletPoints(text, icon = 'fa-check-circle') {
            if (!text) return '';
            
            // Split by newlines or double newlines
            const lines = text.split(/\n+/);
            let formattedHTML = '<ul class="info-list">';
            
            lines.forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine) {
                    // Check if line starts with bullet point indicators (including !)
                    if (trimmedLine.match(/^[!-•*]\s*/)) {
                        // Remove the bullet indicator and add as list item
                        const content = trimmedLine.replace(/^[!-•*]\s*/, '');
                        formattedHTML += `<li><i class="fas ${icon}" style="color: var(--primary-accent); margin-right: 8px;"></i>${content}</li>`;
                    } else if (trimmedLine.match(/^\d+\.\s*/)) {
                        // Numbered list
                        const content = trimmedLine.replace(/^\d+\.\s*/, '');
                        formattedHTML += `<li><i class="fas ${icon}" style="color: var(--primary-accent); margin-right: 8px;"></i>${content}</li>`;
                    } else {
                        // Regular paragraph - add as list item with icon
                        formattedHTML += `<li><i class="fas ${icon}" style="color: var(--secondary-accent); margin-right: 8px;"></i>${trimmedLine}</li>`;
                    }
                }
            });
            
            formattedHTML += '</ul>';
            return formattedHTML;
        }

        // --- Helper: Normalize array to exactly 3 items ---
        const DEFAULT_MESSAGES = {
            psychology: 'Консултирайте се с диетолог за допълнителни съвети',
            supplements: 'Консултирайте се с лекар преди приемане на нови добавки'
        };
        
        const ICON_CLASSES = {
            psychology: 'fa-brain',
            supplements: 'fa-pills'
        };
        
        function normalizeToThreeItems(data, fieldName, defaultMessage) {
            // Handle string data - try to parse or return null
            if (typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    if (Array.isArray(parsed)) {
                        data = parsed;
                    } else {
                        return null; // Let caller handle string formatting
                    }
                } catch (e) {
                    return null; // Let caller handle string formatting
                }
            }
            
            // Ensure we have an array with exactly 3 items
            if (Array.isArray(data)) {
                let items = data.slice(0, 3);
                while (items.length < 3) {
                    items.push(defaultMessage);
                }
                return items;
            }
            
            return null;
        }
        
        // --- Helper: Generate HTML list item with icon ---
        function generateListItem(content, contentType, index) {
            const iconClass = ICON_CLASSES[contentType] || 'fa-info-circle';
            
            if (typeof content === 'string') {
                // Remove any "!" prefix if present (backward compatibility with old data format from before 2025-12-27)
                const cleanContent = content.replace(/^!\s*/, '').trim();
                if (cleanContent) {
                    return `<li>${cleanContent}</li>`;
                }
            } else if (typeof content === 'object' && content !== null) {
                // Handle structured objects (for psychology tips or supplement objects)
                let details = '';
                if (content.title || content.name) {
                    details = content.title || content.name;
                } else {
                    details = contentType === 'psychology' ? `Съвет ${index + 1}` : `Добавка ${index + 1}`;
                }
                
                if (content.description) details += ` - ${content.description}`;
                if (content.dosage) details += ` - Дозировка: ${content.dosage}`;
                if (content.intake) details += ` - Прием: ${content.intake}`;
                
                return `<li>${details}</li>`;
            }
            return '';
        }

        // --- Render Recommendations ---
        function renderRecommendations() {
            if (!dietPlan) return;

            // Update recommendations section
            if (dietPlan.recommendations) {
                const recList = document.querySelector('.acc-item:nth-child(1) .good-list');
                if (recList) {
                    recList.innerHTML = dietPlan.recommendations.map(r => `<li>${r}</li>`).join('');
                }
            }

            // Update forbidden foods
            if (dietPlan.forbidden) {
                const forbiddenList = document.querySelector('.acc-item:nth-child(2) .bad-list');
                if (forbiddenList) {
                    forbiddenList.innerHTML = dietPlan.forbidden.map(f => `<li>${f}</li>`).join('');
                }
            }

            // Update psychology section
            renderPsychology();

            // Update supplements section
            renderSupplements();

            // Update hacks section (hardcoded per goal)
            renderHacks();
        }

        // --- Render Psychology ---
        function renderPsychology() {
            const psychContent = document.querySelector('.acc-item:nth-child(3) .acc-content-inner');
            if (!psychContent) return;

            if (dietPlan.psychology) {
                let psychologyHTML = '';
                
                // Try to normalize to array of 3 items
                const normalized = normalizeToThreeItems(
                    dietPlan.psychology, 
                    'psychology',
                    DEFAULT_MESSAGES.psychology
                );
                
                if (normalized) {
                    // Successfully normalized to array - use info-list style like recommendations/forbidden
                    psychologyHTML = '<ul class="info-list">';
                    normalized.forEach((tip, index) => {
                        const item = generateListItem(tip, 'psychology', index);
                        if (item) {
                            // Wrap item content with icon
                            const cleanItem = item.replace('<li>', '').replace('</li>', '');
                            psychologyHTML += `<li><i class="fas fa-brain" style="color: var(--primary-accent); margin-right: 8px;"></i>${cleanItem}</li>`;
                        }
                    });
                    psychologyHTML += '</ul>';
                } else if (typeof dietPlan.psychology === 'string') {
                    // Fallback to string formatting
                    psychologyHTML = formatContentWithBulletPoints(dietPlan.psychology, ICON_CLASSES.psychology);
                } else {
                    psychologyHTML = `<p style="color: var(--text-light); font-style: italic;">${DEFAULT_MESSAGES.psychology}</p>`;
                }
                
                psychContent.innerHTML = psychologyHTML;
            } else {
                psychContent.innerHTML = `<p style="color: var(--text-light); font-style: italic;">${DEFAULT_MESSAGES.psychology}</p>`;
            }
        }

        // --- Render Supplements ---
        function renderSupplements() {
            const supplementsContent = document.getElementById('supplementsContent');
            if (!supplementsContent) return;

            if (dietPlan.supplements) {
                let supplementsHTML = '';
                
                // Try to normalize to array of 3 items
                const normalized = normalizeToThreeItems(
                    dietPlan.supplements,
                    'supplements',
                    DEFAULT_MESSAGES.supplements
                );
                
                if (normalized) {
                    // Successfully normalized to array - use info-list style like recommendations/forbidden
                    supplementsHTML = '<ul class="info-list">';
                    normalized.forEach((supplement, index) => {
                        const item = generateListItem(supplement, 'supplements', index);
                        if (item) {
                            // Wrap item content with icon
                            const cleanItem = item.replace('<li>', '').replace('</li>', '');
                            supplementsHTML += `<li><i class="fas fa-pills" style="color: var(--primary-accent); margin-right: 8px;"></i>${cleanItem}</li>`;
                        }
                    });
                    supplementsHTML += '</ul>';
                } else if (typeof dietPlan.supplements === 'string') {
                    // Fallback to string formatting
                    supplementsHTML = formatContentWithBulletPoints(dietPlan.supplements, ICON_CLASSES.supplements);
                } else {
                    supplementsHTML = `<p style="color: var(--text-light); font-style: italic;">${DEFAULT_MESSAGES.supplements}</p>`;
                }
                
                supplementsContent.innerHTML = supplementsHTML;
            } else {
                supplementsContent.innerHTML = `<p style="color: var(--text-light); font-style: italic;">${DEFAULT_MESSAGES.supplements}</p>`;
            }
        }

        // --- Render Hacks (hardcoded per goal, not AI-generated) ---
        function renderHacks() {
            const hacksContent = document.getElementById('hacksContent');
            if (!hacksContent) return;

            if (dietPlan.hacks && Array.isArray(dietPlan.hacks) && dietPlan.hacks.length > 0) {
                let hacksHTML = '<ul class="info-list">';
                dietPlan.hacks.forEach((hack) => {
                    // Escape HTML to prevent XSS
                    const safeHack = String(hack).replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    hacksHTML += `<li><i class="fas fa-bolt" style="color: var(--accent-yellow); margin-right: 8px;"></i>${safeHack}</li>`;
                });
                hacksHTML += '</ul>';
                hacksContent.innerHTML = hacksHTML;
            } else {
                hacksContent.innerHTML = `<p style="color: var(--text-light); font-style: italic;">Практически съвети за постигане на целта...</p>`;
            }
        }

        // --- Navigation Logic ---
        function goBack() {
            history.back();
        }

        function goToProfile() {
            _shellNav('profile.html');
        }

        function getDayTimeIcon() {
            const h = new Date().getHours();
            // Morning 5–11: sun rising
            if (h >= 5 && h < 12) {
                return `<span class="day-time-icon" aria-label="сутрин"><svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="4"/>
                    <line x1="12" y1="2" x2="12" y2="4"/>
                    <line x1="12" y1="20" x2="12" y2="22"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="2" y1="12" x2="4" y2="12"/>
                    <line x1="20" y1="12" x2="22" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg></span>`;
            }
            // Noon 12–16: sun at peak
            if (h >= 12 && h < 17) {
                return `<span class="day-time-icon" aria-label="обед"><svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/>
                    <line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/>
                    <line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg></span>`;
            }
            // Evening 17–21: crescent moon
            if (h >= 17 && h < 22) {
                return `<span class="day-time-icon" aria-label="вечер"><svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg></span>`;
            }
            // Night 22–4: moon + star
            return `<span class="day-time-icon" aria-label="нощ"><svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                <line x1="19" y1="3" x2="19" y2="5"/>
                <line x1="18" y1="4" x2="20" y2="4"/>
            </svg></span>`;
        }

        function renderDayBanner(activeDayNum, direction) {
            const fullDayNames = ['Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота', 'Неделя'];
            const label = document.getElementById('dayBannerLabel');

            // Animate label
            if (direction) {
                label.classList.remove('slide-left', 'slide-right');
                // Force reflow to restart CSS animation from the beginning
                void label.offsetWidth;
                label.classList.add(direction === 'next' ? 'slide-left' : 'slide-right');
            }

            label.innerHTML = fullDayNames[activeDayNum - 1] + getDayTimeIcon();
        }

        function selectDay(dayNum, direction) {
            // Save selected day to localStorage to prevent flash on next page load
            try {
                localStorage.setItem('lastSelectedDay', dayNum.toString());
            } catch (e) {
                console.warn('Failed to save lastSelectedDay:', e);
            }
            renderDayBanner(dayNum, direction);
            renderDay(dayNum);
        }

        // --- Day Banner Arrow & Swipe Navigation ---
        (function initDayBannerNav() {
            const prevBtn = document.getElementById('dayBannerPrev');
            const nextBtn = document.getElementById('dayBannerNext');
            const banner  = document.getElementById('dayBannerContainer');

            function navigate(dir) {
                const day = (currentDay - 1 + (dir === 'next' ? 1 : -1) + 7) % 7 + 1;
                selectDay(day, dir);
            }

            if (prevBtn) prevBtn.addEventListener('click', () => navigate('prev'));
            if (nextBtn) nextBtn.addEventListener('click', () => navigate('next'));

            // Keyboard support on the banner itself
            if (banner) {
                banner.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowRight') navigate('next');
                    else if (e.key === 'ArrowLeft') navigate('prev');
                });

                // Touch / swipe support
                let touchStartX = 0;
                let touchStartY = 0;
                banner.addEventListener('touchstart', (e) => {
                    touchStartX = e.changedTouches[0].clientX;
                    touchStartY = e.changedTouches[0].clientY;
                }, { passive: true });
                banner.addEventListener('touchend', (e) => {
                    const dx = e.changedTouches[0].clientX - touchStartX;
                    const dy = e.changedTouches[0].clientY - touchStartY;
                    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
                        navigate(dx < 0 ? 'next' : 'prev');
                    }
                }, { passive: true });
            }
        })();

        // --- Auto-select today's plan day (no backend required) ---
        // Monday = day 1, Tuesday = day 2, …, Sunday = day 7.
        // Falls back to day 1 if the weekday's slot is missing in the plan.
        function getTodayPlanDay() {
            const jsDay = new Date().getDay(); // 0 = Sun, 1 = Mon … 6 = Sat
            // Convert JS Sunday-first → Monday-first (1–7)
            const planDay = jsDay === 0 ? 7 : jsDay;

            // If the plan actually has that day, use it; otherwise fall back to 1
            if (dietPlan && dietPlan.weekPlan && dietPlan.weekPlan[`day${planDay}`] &&
                    Array.isArray(dietPlan.weekPlan[`day${planDay}`].meals)) {
                return planDay;
            }
            return 1;
        }

        // --- Accordion Logic ---
        function toggleAccordion(header) {
            const item = header.parentElement;
            const content = item.querySelector('.acc-content');
            
            // Toggle current
            item.classList.toggle('open');
            
            if (item.classList.contains('open')) {
                content.style.maxHeight = content.scrollHeight + "px";
            } else {
                content.style.maxHeight = "0";
            }
        }

        // --- Macro Breakdown Collapsible Toggle ---
        function toggleMacroBreakdown() {
            const macroBreakdown = document.getElementById('macroBreakdown');
            const header = macroBreakdown ? macroBreakdown.querySelector('.macro-breakdown-header') : null;
            if (macroBreakdown) {
                const isOpen = macroBreakdown.classList.toggle('open');
                // Update aria-expanded for accessibility
                if (header) {
                    header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                }
            }
        }

        // Keyboard handler for macro breakdown toggle (Enter/Space)
        function handleMacroBreakdownKeydown(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleMacroBreakdown();
            }
        }

        // --- Modal Logic ---
        const modal = document.getElementById('infoModal');
        const mTitle = document.getElementById('mTitle');
        const mDesc = document.getElementById('mDesc');
        const mBenefit = document.getElementById('mBenefit');

        // Helper function to parse macronutrient values
        function parseMacronutrients(macros) {
            return {
                protein: parseFloat(macros.protein) || 0,
                carbs: parseFloat(macros.carbs) || 0,
                fats: parseFloat(macros.fats) || 0,
                fiber: parseFloat(macros.fiber) || 0
            };
        }

        // Helper function to create a stacked bar segment (calorie-based percentage)
        function createMacroSegment(type, label, grams, percent, calories = null) {
            const segment = document.createElement('div');
            segment.className = `macro-segment ${type}`;
            segment.style.width = percent + '%';
            
            const roundedPercent = Math.round(percent);
            const percentText = roundedPercent + '%';
            
            if (percent > 10) {
                segment.setAttribute('data-percent', percentText);
            }
            // Show calories in tooltip if provided
            const calorieInfo = calories !== null ? ` → ${Math.round(calories)} kcal` : '';
            segment.title = `${label}: ${grams}г${calorieInfo} (${percentText} от калориите)`;
            return segment;
        }

        // Helper function to create a legend item with calorie contribution
        function createLegendItem(type, label, value, calories = null) {
            const item = document.createElement('div');
            item.className = 'macro-legend-item';
            // Show grams and optionally calorie contribution
            const calorieText = calories !== null ? ` (${Math.round(calories)} kcal)` : '';
            item.innerHTML = `
                <span class="macro-dot ${type}"></span>
                <span class="macro-label">${label}:</span>
                <span class="macro-value">${value}г${calorieText}</span>
            `;
            return item;
        }

        function openModal(title, description, benefit, macros, dessert, weight, calories) {
            // Strip dessert name from title to avoid duplication with the mDessert section below
            let displayTitle = title;
            if (dessert && dessert.name) {
                const escapedDessertName = dessert.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                displayTitle = displayTitle
                    .replace(new RegExp('[,+\\s]+' + escapedDessertName + '.*$', 'i'), '')
                    .replace(/[,+\s]+$/, '')
                    .trim();
                if (!displayTitle) displayTitle = title;
            }
            mTitle.textContent = displayTitle;
            
            // Show weight / calorie badge below title
            const mWeightBadge = document.getElementById('mWeightBadge');
            const mWeightText  = document.getElementById('mWeightText');
            if (mWeightBadge && mWeightText) {
                if (weight) {
                    // For plans generated before the backend started adding dessert weight to
                    // meal.weight, add the dessert weight here at display time.
                    // New plans have dessert._weightAddedToMeal = true so we skip the addition.
                    let displayWeight = weight;
                    if (dessert && dessert.weight && !dessert._weightAddedToMeal) {
                        const mainMatch = String(weight).match(/(\d+(?:\.\d+)?)/);
                        const dessertMatch = String(dessert.weight).match(/(\d+(?:\.\d+)?)/);
                        if (mainMatch && dessertMatch) {
                            const totalGrams = Math.round(parseFloat(mainMatch[1]) + parseFloat(dessertMatch[1]));
                            displayWeight = `${totalGrams}г`;
                        }
                    }
                    const calText = calories ? ` • ${Math.round(calories)} kcal` : '';
                    mWeightText.textContent = `${displayWeight}${calText}`;
                    mWeightBadge.style.display = 'inline-flex';
                } else {
                    mWeightBadge.style.display = 'none';
                }
            }
            
            // Display description as-is (contains ingredient weights from AI)
            mDesc.innerHTML = escapeHtmlWithBreaks(description);
            mBenefit.textContent = benefit;
            
            // Render dessert component section if present (as part of meal description)
            // Using new ROW layout structure
            const existingDessertSection = document.getElementById('mDessert');
            if (existingDessertSection) existingDessertSection.remove();
            if (dessert && dessert.name) {
                const dessertEl = document.createElement('div');
                dessertEl.id = 'mDessert';
                dessertEl.className = 'meal-dessert';
                
                // Build structured row layout
                let innerHtml = `<div class="dessert-header"><i class="fas fa-cookie-bite"></i><strong>Десерт</strong></div>`;
                innerHtml += `<div class="dessert-name">${escapeHtmlWithBreaks(dessert.name)}</div>`;
                
                if (dessert.weight) {
                    innerHtml += `<div class="dessert-weight">${escapeHtmlWithBreaks(dessert.weight)}</div>`;
                }
                
                if (dessert.description) {
                    innerHtml += `<span class="meal-dessert-desc">${escapeHtml(dessert.description)}</span>`;
                }
                
                dessertEl.innerHTML = innerHtml;
                mDesc.insertAdjacentElement('afterend', dessertEl);
            }
            
            // Handle macronutrient visualization
            // meal.macros already includes the dessert contribution (dessert is part of the meal)
            const macroBreakdown = document.getElementById('macroBreakdown');
            const macroBar = document.getElementById('macroBar');
            const macroLegend = document.getElementById('macroLegend');
            
            const effectiveMacros = macros;

            if (effectiveMacros && (effectiveMacros.protein || effectiveMacros.carbs || effectiveMacros.fats)) {
                // Parse numeric values using helper function
                const { protein, carbs, fats } = parseMacronutrients(effectiveMacros);
                
                // Calculate calorie contribution from each macro (protein×4, carbs×4, fats×9)
                // Fiber is intentionally excluded – it is indigestible and contributes no usable calories.
                const proteinCalories = protein * 4;
                const carbsCalories = carbs * 4;
                const fatsCalories = fats * 9;
                const totalCalories = proteinCalories + carbsCalories + fatsCalories;
                
                if (totalCalories > 0) {
                    // Calculate percentages based on calorie contribution
                    const proteinPercent = (proteinCalories / totalCalories) * 100;
                    const carbsPercent = (carbsCalories / totalCalories) * 100;
                    const fatsPercent = (fatsCalories / totalCalories) * 100;
                    
                    // Build stacked bar using helper function
                    macroBar.innerHTML = '';
                    
                    if (proteinCalories > 0) {
                        macroBar.appendChild(createMacroSegment('protein', 'Протеин', protein, proteinPercent, proteinCalories));
                    }
                    if (fatsCalories > 0) {
                        macroBar.appendChild(createMacroSegment('fats', 'Мазнини', fats, fatsPercent, fatsCalories));
                    }
                    if (carbsCalories > 0) {
                        macroBar.appendChild(createMacroSegment('carbs', 'Въглехидрати', carbs, carbsPercent, carbsCalories));
                    }
                    
                    // Build legend using helper function
                    macroLegend.innerHTML = '';
                    
                    if (proteinCalories > 0) {
                        macroLegend.appendChild(createLegendItem('protein', 'Протеин', protein, proteinCalories));
                    }
                    if (fatsCalories > 0) {
                        macroLegend.appendChild(createLegendItem('fats', 'Мазнини', fats, fatsCalories));
                    }
                    if (carbsCalories > 0) {
                        macroLegend.appendChild(createLegendItem('carbs', 'Въглехидрати', carbs, carbsCalories));
                    }
                    
                    macroBreakdown.style.display = 'block';
                    // Ensure it starts collapsed (closed by default)
                    macroBreakdown.classList.remove('open');
                } else {
                    macroBreakdown.style.display = 'none';
                }
            } else {
                macroBreakdown.style.display = 'none';
            }
            
            modal.classList.add('active');
        }

        function closeModal() {
            modal.classList.remove('active');
        }

        // Close modal if clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // Welcome modal functions
        const welcomeModal = document.getElementById('welcomeModal');
        
        function closeWelcomeModal() {
            welcomeModal.classList.remove('active');
            localStorage.setItem('hasSeenPlanJustification', 'true');
        }
        
        // Close welcome modal if clicking outside
        welcomeModal.addEventListener('click', (e) => {
            if (e.target === welcomeModal) closeWelcomeModal();
        });

        // --- Chat Logic ---
        function openChat() {
            if (chatVisible) {
                closeChatWindow();
                return;
            }

            // Create chat window
            const chatWindow = document.createElement('div');
            chatWindow.id = 'chatWindow';
            chatWindow.style.cssText = `
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                width: 100%;
                height: 70vh;
                max-height: 600px;
                background: var(--card-bg);
                border-radius: 16px 16px 0 0;
                box-shadow: 0 -5px 40px rgba(0,0,0,0.3);
                display: flex;
                flex-direction: column;
                z-index: 999;
                animation: slideUp 0.3s ease;
            `;

            const modificationButtonHtml = modificationModeEnabled
                ? `
                        <button onclick="switchToMode('modification')" id="modificationBtn" style="background: var(--primary-red); color: white; border: none; padding: 6px 12px; border-radius: 12px; cursor: pointer; font-size: 0.8rem; font-weight: 500; display: flex; align-items: center; gap: 5px;">
                            <i class="fas fa-edit"></i>
                            <span>Промени план</span>
                        </button>`
                : '';

            chatWindow.innerHTML = `
                <div style="padding: 15px; background: var(--primary-red); color: white; border-radius: 16px 16px 0 0; display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 1rem;"><i class="fas fa-user-md"></i> AI Диетолог Асистент</h3>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button onclick="startNewChat()" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 5px 10px; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: 500;" title="Нов чат">
                            <i class="fas fa-plus"></i> Нов чат
                        </button>
                        <button onclick="closeChatWindow()" style="background: none; border: none; color: white; font-size: 1.2rem; cursor: pointer;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div id="chatModeIndicator" style="padding: 10px 15px; border-bottom: 1px solid var(--text-light); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 5px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-circle" id="modeIcon" style="font-size: 0.6rem; color: #4CAF50;"></i>
                        <span id="modeText" style="font-size: 0.85rem; font-weight: 500;">Режим: Консултация</span>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        ${modificationButtonHtml}
                        <button onclick="switchToMode('report')" id="reportBtn" style="background: #ff9800; color: white; border: none; padding: 6px 12px; border-radius: 12px; cursor: pointer; font-size: 0.8rem; font-weight: 500; display: flex; align-items: center; gap: 5px;">
                            <i class="fas fa-exclamation-circle"></i>
                            <span>Проблем</span>
                        </button>
                    </div>
                </div>
                <div id="chatMessages" style="flex: 1; overflow-y: auto; padding: 15px; background: var(--bg-color);">
                </div>
                <div style="padding: 15px; border-top: 1px solid var(--text-light); background: var(--card-bg); border-radius: 0 0 16px 16px;">
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="chatInput" placeholder="Напишете съобщение..." 
                            style="flex: 1; padding: 10px 15px; border: 1px solid var(--text-light); border-radius: 20px; outline: none; font-size: 0.9rem; background: var(--card-bg); color: var(--text-dark);"
                            onkeypress="if(event.key==='Enter') sendMessage()">
                        <button onclick="sendMessage()" style="background: var(--primary-red); color: white; border: none; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(chatWindow);
            chatVisible = true;

            // Update mode UI to reflect current mode
            updateModeUI();

            // Load chat history or show welcome message
            if (chatHistory.length > 0) {
                // Restore chat history
                chatHistory.forEach(msg => {
                    addMessageToChat(msg.text, msg.role, false); // false = don't save to history
                });
            } else {
                // Show welcome message
                addMessageToChat(`Здравейте, ${userData.name || 'приятелю'}! 👋\n\nАз съм вашият AI диетолог асистент. Как мога да ви помогна днес?`, 'assistant', false);
            }

            // Show Demo mode warning
            if (!isDemoLimitUnlocked) {
                const chatMessages = document.getElementById('chatMessages');
                if (chatMessages) {
                    const usedToday = getDailyChatCount();
                    const remaining = Math.max(0, MAX_DAILY_CHAT_MESSAGES - usedToday);
                    const demoNotice = document.createElement('div');
                    demoNotice.style.cssText = '';
                    demoNotice.className = 'demo-mode-notice';
                    demoNotice.innerHTML = `<i class="fas fa-info-circle"></i> <strong>Демо режим:</strong> Системата е в демо режим и позволява до ${MAX_DAILY_CHAT_MESSAGES} чат заявки на ден. Оставащи днес: <strong>${remaining}</strong>.`;
                    chatMessages.appendChild(demoNotice);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            }

            // Focus input only on desktop (prevent keyboard popup on mobile)
            setTimeout(() => {
                const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                if (!isMobile) {
                    const chatInput = document.getElementById('chatInput');
                    if (chatInput) {
                        chatInput.focus();
                    }
                }
            }, 100);
        }

        function closeChatWindow() {
            const chatWindow = document.getElementById('chatWindow');
            if (chatWindow) {
                // Save chat history before closing
                saveChatHistory();
                chatWindow.remove();
                chatVisible = false;
                // Reset chatMode to consultation on close to avoid confusion when reopening
                // User needs to explicitly activate modification mode each time
                chatMode = 'consultation';
            }
        }

        function switchToMode(targetMode) {
            if (targetMode === 'modification' && !modificationModeEnabled) {
                chatMode = 'consultation';
                updateModeUI();
                addMessageToChat('ℹ️ Режимът „Промяна на план“ е изключен от администратора.', 'assistant');
                return;
            }

            // Validate target mode
            const validModes = ['consultation', 'modification', 'report'];
            if (!validModes.includes(targetMode)) {
                console.error('Invalid mode:', targetMode);
                return;
            }
            
            if (chatMode === targetMode) {
                // If already in this mode, switch back to consultation
                chatMode = 'consultation';
            } else {
                // Switch to the requested mode
                chatMode = targetMode;
            }
            
            // Update UI to reflect the new mode
            updateModeUI();
            
            // Add a system message to inform the user
            const modeMessage = CHAT_MODE_STRINGS[chatMode].activatedMessage;
            addMessageToChat(modeMessage, 'assistant');
        }

        function updateModeUI() {
            const modeText = document.getElementById('modeText');
            const modeIcon = document.getElementById('modeIcon');
            const modificationBtn = document.getElementById('modificationBtn');
            const reportBtn = document.getElementById('reportBtn');
            const modeIndicator = document.getElementById('chatModeIndicator');
            
            if (!modeText || !modeIcon || !reportBtn || !modeIndicator || (modificationModeEnabled && !modificationBtn)) return;

            if (!modificationModeEnabled && chatMode === 'modification') {
                chatMode = 'consultation';
            }
            
            const currentModeConfig = CHAT_MODE_STRINGS[chatMode];
            const currentTheme = document.documentElement.getAttribute('data-theme');
            
            // Update mode label and icon
            modeText.textContent = currentModeConfig.modeLabel;
            modeIcon.style.color = currentModeConfig.icon.color;
            
            // Use theme-aware background
            const bgColor = currentTheme === 'dark' ? currentModeConfig.backgroundDark : currentModeConfig.background;
            modeIndicator.style.background = bgColor;
            
            // Ensure text color is appropriate for current theme
            modeText.style.color = 'var(--text-dark)';
            
            // Update button styles based on active mode
            if (chatMode === 'modification') {
                if (modificationBtn) {
                    modificationBtn.style.background = '#4CAF50';
                    modificationBtn.innerHTML = '<i class="fas fa-comment"></i><span>Консултация</span>';
                }
                reportBtn.style.background = '#ff9800';
                reportBtn.innerHTML = CHAT_MODE_STRINGS.toggleButtons.toReport;
            } else if (chatMode === 'report') {
                reportBtn.style.background = '#4CAF50';
                reportBtn.innerHTML = '<i class="fas fa-comment"></i><span>Консултация</span>';
                if (modificationBtn) {
                    modificationBtn.style.background = 'var(--primary-red)';
                    modificationBtn.innerHTML = CHAT_MODE_STRINGS.toggleButtons.toModification;
                }
            } else {
                // consultation mode
                if (modificationBtn) {
                    modificationBtn.style.background = 'var(--primary-red)';
                    modificationBtn.innerHTML = CHAT_MODE_STRINGS.toggleButtons.toModification;
                }
                reportBtn.style.background = '#ff9800';
                reportBtn.innerHTML = CHAT_MODE_STRINGS.toggleButtons.toReport;
            }
        }

        /**
         * Helper function to create compact week plan for consultation mode
         * Reduces payload size by ~60-70% while keeping essential meal information
         * 
         * FULL meal object: ~200-300 bytes (with description, benefits, weight)
         * COMPACT meal object: ~50-70 bytes (only type, name, calories)
         * 
         * For a 7-day plan with 3 meals/day = 21 meals:
         * - Full: ~5-6 KB
         * - Compact: ~1.2-1.5 KB
         * 
         * This optimization allows AI to understand the meal plan context
         * without needing detailed descriptions for consultation questions.
         */
        function compactWeekPlan(weekPlan) {
            if (!weekPlan) return null;
            
            const compact = {};
            for (const dayKey in weekPlan) {
                if (weekPlan[dayKey] && weekPlan[dayKey].meals) {
                    compact[dayKey] = {
                        meals: weekPlan[dayKey].meals.map(meal => ({
                            type: meal.type,
                            name: meal.name,
                            calories: meal.calories
                            // Omit: time (removed), description, benefits, weight (not needed for consultation)
                        }))
                    };
                }
            }
            return compact;
        }

        async function sendMessage() {
            const input = document.getElementById('chatInput');
            const message = input.value.trim();
            
            if (!message) return;

            // Food picker command
            if (message.toLowerCase() === '*selectfoods') {
                addMessageToChat('🥗 Отваряне на избора на продукти…', 'assistant');
                input.value = '';
                setTimeout(() => { _shellNav('food-picker.html'); }, 700);
                return;
            }

            // Gamification command
            if (message.toLowerCase() === '*game') {
                input.value = '';
                if (window.gameModule) {
                    if (!window.gameModule.isEnabled()) {
                        window.gameModule.activateGame();
                        addMessageToChat('Геймификацията е активирана!\n\nОт сега ще събирам данни за:\n• Отбелязване на храненията\n• Сутрешна проверка (05:00) – качество на съня\n• Вечерна проверка (20:00) – активност, емоционален баланс, вода\n• Дневна оценка и насърчение\n\nАнализът ще е наличен в таба „Профил" → раздел Геймификация.\n\nЗа да тествате сега, напишете *game-morning или *game-evening.', 'assistant');
                    } else {
                        addMessageToChat('Геймификацията вече е активирана. Следете оценките в таба „Профил".', 'assistant');
                    }
                } else {
                    addMessageToChat('⚠️ Геймификационният модул се зарежда. Моля, опитайте след малко.', 'assistant');
                }
                return;
            }

            // Gamification test commands
            if (message.toLowerCase() === '*game-morning') {
                input.value = '';
                if (window._gameShowMorning) { window._gameShowMorning(true); }
                addMessageToChat('Показвам сутрешния въпрос…', 'assistant');
                return;
            }
            if (message.toLowerCase() === '*game-evening') {
                input.value = '';
                if (window._gameShowEvening) { window._gameShowEvening(true); }
                addMessageToChat('Показвам вечерните въпроси…', 'assistant');
                return;
            }

            // Secret unlock command for demo limit
            if (message.toLowerCase() === 'unlockme') {
                isDemoLimitUnlocked = true;
                localStorage.setItem('chatDemoLimitUnlocked', 'true');
                addMessageToChat('✅ Чат лимитът за демо режима е премахнат за този профил.', 'assistant');
                input.value = '';
                return;
            }
            
            // Check demo version daily limit
            if (!isDemoLimitUnlocked && getDailyChatCount() >= MAX_DAILY_CHAT_MESSAGES) {
                addMessageToChat(`⚠️ Демо версията позволява до ${MAX_DAILY_CHAT_MESSAGES} чат заявки на ден. Лимитът за днес е достигнат. Моля, свържете се с нас за пълен достъп.`, 'assistant');
                input.value = '';
                return;
            }
            
            // Enhancement #9: Check for duplicate messages
            if (isDuplicateMessage(message)) {
                addMessageToChat('⚠️ Това съобщение току-що бе изпратено. Моля, изчакайте отговора.', 'assistant');
                input.value = ''; // Clear input
                return;
            }
            
            // Enhancement #2: Debouncing - Clear any pending send
            if (sendMessageTimeout) {
                clearTimeout(sendMessageTimeout);
            }
            
            // Enhancement #7: Rate limiting check
            if (!checkRateLimit()) {
                addMessageToChat('⚠️ Твърде много съобщения. Моля, изчакайте малко.', 'assistant');
                return;
            }
            
            // Clear input immediately for better UX
            input.value = '';

            // Enhancement #2: Debounce - Wait before actually sending
            sendMessageTimeout = setTimeout(() => {
                sendMessageWithRetry(message);
            }, DEBOUNCE_DELAY);
        }
        
        // Enhancement #7: Rate limiting check
        function checkRateLimit() {
            const now = Date.now();
            // Remove timestamps older than the window
            messageTimestamps = messageTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
            
            if (messageTimestamps.length >= MAX_MESSAGES_PER_WINDOW) {
                return false;
            }
            
            messageTimestamps.push(now);
            return true;
        }
        
        // Enhancement #1: Retry wrapper
        async function sendMessageWithRetry(message, retryCount = 0) {
            // Enhancement #8: Generate unique message ID for deduplication
            const messageId = `msg_${++messageIdCounter}_${Date.now()}`;
            
            // Enhancement #8: Offline handling
            if (!isOnline) {
                // Check if message already in queue (by text)
                const alreadyQueued = offlineMessageQueue.some(m => m.text === message);
                if (!alreadyQueued) {
                    offlineMessageQueue.push({ id: messageId, text: message, timestamp: Date.now() });
                    addMessageToChat(message, 'user');
                    addMessageToChat('📤 Съобщението е запазено и ще бъде изпратено при възстановяване на връзката.', 'assistant');
                    // Save to localStorage for persistence
                    saveOfflineQueue();
                }
                return;
            }
            
            try {
                await sendMessageInternal(message, retryCount, messageId);
            } catch (error) {
                console.error('Message send failed:', error);
                
                // Enhancement #1: Retry logic
                if (retryCount < MAX_RETRIES) {
                    const delay = RETRY_DELAYS[retryCount];
                    addMessageToChat(`⚠️ Грешка при изпращане. Опитвам отново след ${delay/1000} секунди... (опит ${retryCount + 1}/${MAX_RETRIES})`, 'assistant');
                    
                    setTimeout(() => {
                        sendMessageWithRetry(message, retryCount + 1);
                    }, delay);
                } else {
                    // All retries exhausted - add to offline queue if not already there
                    const alreadyQueued = offlineMessageQueue.some(m => m.id === messageId);
                    if (!alreadyQueued) {
                        offlineMessageQueue.push({ id: messageId, text: message, timestamp: Date.now() });
                        saveOfflineQueue();
                    }
                    addMessageToChat('❌ Не успях да изпратя съобщението след няколко опита. Съобщението е запазено и ще бъде изпратено при възстановяване на връзката.', 'assistant');
                }
            }
        }
        
        // Core send message logic (Enhancement #1: Extracted for retry)
        async function sendMessageInternal(message, retryCount, messageId) {
            // Prevent multiple simultaneous sends
            if (isSending) {
                return;
            }
            
            isSending = true;
            
            // Add user message to chat only on first attempt
            if (retryCount === 0) {
                addMessageToChat(message, 'user');
            }

            // Show typing indicator
            const typingId = addTypingIndicator();

            try {
                // If in report mode, send to report endpoint instead
                if (chatMode === 'report') {
                    await sendReportProblem(message, typingId, messageId);
                    return;
                }
                
                // Add timeout for slow connections (60 seconds to allow AI more time)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort('Request timeout after 60 seconds'), 60000);

                // Transform chatHistory to API format {role, content}
                // Enhancement #10: Limit conversation history to last 10 messages to reduce payload
                // Keep most recent context while avoiding excessive data transfer
                const MAX_HISTORY_MESSAGES = 10;
                const recentHistory = chatHistory.slice(-MAX_HISTORY_MESSAGES);
                
                const apiHistory = recentHistory.map(msg => ({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.text || msg.content || ''
                }));
                
                if (chatHistory.length > MAX_HISTORY_MESSAGES) {
                    console.log(`[Optimization] Trimmed conversation history from ${chatHistory.length} to ${MAX_HISTORY_MESSAGES} messages`);
                }
                
                // REVOLUTIONARY OPTIMIZATION: Use cached context when possible
                // Reduces payload from 10-20KB to ~100 bytes (85-95% reduction!)
                let useCachedContext = chatContextCached;
                let optimizedPlan = null;
                let optimizedUserData = null;
                
                // ALWAYS prepare fallback context to handle cache misses in stateless workers
                // Cloudflare Workers can route requests to different instances where cache may not exist
                if (chatMode === 'consultation') {
                    // Consultation: send compact version as fallback
                    optimizedPlan = {
                        summary: dietPlan.summary,
                        weekPlan: compactWeekPlan(dietPlan.weekPlan),
                        recommendations: dietPlan.recommendations,
                        forbidden: dietPlan.forbidden,
                        communicationStyle: dietPlan.strategy?.communicationStyle
                    };
                    
                    optimizedUserData = {
                        name: userData.name,
                        age: userData.age,
                        weight: userData.weight,
                        height: userData.height,
                        gender: userData.gender,
                        goal: userData.goal,
                        dietPreference: userData.dietPreference,
                        dietDislike: userData.dietDislike,
                        dietLove: userData.dietLove,
                        medicalConditions: userData.medicalConditions
                    };
                } else {
                    // Modification mode: send full data as fallback
                    optimizedPlan = dietPlan;
                    optimizedUserData = userData;
                }
                
                // For first message or modification mode, don't try to use cache
                if (chatMode === 'modification' || !chatContextCached) {
                    useCachedContext = false;
                }
                
                // Log payload sizes for debugging
                if (console && console.log) {
                    const actualSize = JSON.stringify({ 
                        userId, 
                        message, 
                        conversationHistory: apiHistory,
                        useCachedContext: useCachedContext,
                        userData: optimizedUserData,
                        userPlan: optimizedPlan
                    }).length;
                    
                    if (useCachedContext) {
                        console.log(`[REVOLUTIONARY] Chat payload: ${actualSize} bytes with fallback context (server will prefer cache if available)`);
                    } else {
                        const fullSize = JSON.stringify({ userData, userPlan: dietPlan, conversationHistory: apiHistory }).length;
                        console.log(`Chat payload: ${actualSize} bytes (${Math.round((1 - actualSize/fullSize) * 100)}% reduction via optimization)`);
                    }
                }
                
                // Send to backend with revolutionary optimization
                // ALWAYS include fallback context to handle cache misses in stateless workers
                const requestBody = {
                    userId: userId,
                    message: message,
                    conversationId: conversationId,
                    mode: chatMode,
                    conversationHistory: apiHistory,
                    useCachedContext: useCachedContext,
                    // Include fallback context - server will use cache if available, fallback if not
                    userData: optimizedUserData,
                    userPlan: optimizedPlan
                };
                
                const response = await fetch('https://aidiet.radilov-k.workers.dev/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text().catch(() => 'Unable to read error');
                    throw new Error(`HTTP ${response.status} ${response.statusText}: ${errorText}`);
                }

                const result = await response.json();

                // Remove typing indicator
                removeTypingIndicator(typingId);

                if (result.success) {
                    // Remove from offline queue if it was queued (successful send)
                    if (messageId) {
                        offlineMessageQueue = offlineMessageQueue.filter(m => m.id !== messageId);
                        saveOfflineQueue();
                    }
                    
                    // REVOLUTIONARY: Track cache status from server response
                    if (result.cacheUsed !== undefined) {
                        chatContextCached = result.cacheUsed;
                        if (result.cacheUsed) {
                            console.log('[REVOLUTIONARY] Server used cached context - massive bandwidth savings!');
                        } else {
                            chatContextCached = true; // Server now has our context cached
                            console.log('[REVOLUTIONARY] Context cached on server - future messages will be ultra-light!');
                        }
                    }
                    
                    addMessageToChat(result.response, 'assistant');
                    
                    // If plan was updated, update local storage with new plan
                    if (result.planUpdated && result.updatedPlan) {
                        // Enhancement #6: Save current plan to history before updating
                        savePlanToHistory();
                        
                        // Update dietPlan and userData from server response
                        dietPlan = result.updatedPlan;
                        migrateMealTypes(dietPlan);
                        if (result.updatedUserData) {
                            userData = result.updatedUserData;
                            localStorage.setItem('userData', JSON.stringify(userData));
                        }
                        const planSyncStr = JSON.stringify(dietPlan);
                        const userDataSyncStr = JSON.stringify(userData);
                        localStorage.setItem('dietPlan', planSyncStr);

                        // Keep the backend profile in sync so the updated plan is
                        // available after reinstalling or on other devices/contexts.
                        if (userId) {
                            const fbAuth = window.npFirebaseAuth;
                            const _idToken = (userId.startsWith('fb_') && fbAuth && fbAuth.currentUser)
                                ? await fbAuth.currentUser.getIdToken().catch(() => null)
                                : null;
                            const planSourceSync = localStorage.getItem('planSource') || '';
                            fetch('https://aidiet.radilov-k.workers.dev/api/user/save-profile', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    userId,
                                    plan: dietPlan,
                                    userData,
                                    planSource: planSourceSync,
                                    ...(_idToken ? { idToken: _idToken } : {})
                                })
                            }).then(r => {
                                if (r && r.ok) {
                                    localStorage.setItem('np_profile_synced', '1');
                                    localStorage.setItem('np_profile_sync_sig', getProfileSyncSignature(userId, planSyncStr, userDataSyncStr, planSourceSync));
                                } else {
                                    localStorage.removeItem('np_profile_synced');
                                }
                            }).catch(e => {
                                localStorage.removeItem('np_profile_synced');
                                console.warn('[PWA] Backend plan update save failed:', e);
                            });
                        }
                        
                        // IMPORTANT: Cache invalidated on server, need to re-cache on next message
                        chatContextCached = false;
                        console.log('[REVOLUTIONARY] Cache invalidated due to plan update - will re-sync on next message');
                        
                        setTimeout(() => {
                            // Enhancement #5: Visual indicator - Highlight changed meals
                            highlightChangedMeals(currentDay);
                            renderDay(currentDay);
                            
                            // Enhancement #5: Show undo button
                            addMessageToChat('✓ Планът е актуализиран успешно!', 'assistant');
                            showUndoButton();
                        }, 1000);
                    }
                } else {
                    addMessageToChat('Съжалявам, имаше проблем. Моля, опитайте отново.', 'assistant');
                    throw new Error('Backend returned error');
                }
            } catch (error) {
                console.error('Chat error:', error);
                removeTypingIndicator(typingId);
                
                // Re-throw to let retry logic handle it
                throw error;
            } finally {
                isSending = false;
            }
        }
        
        // Send problem report to admin
        async function sendReportProblem(message, typingId, messageId) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort('Request timeout after 30 seconds'), 30000);
                
                const response = await fetch('https://aidiet.radilov-k.workers.dev/api/report-problem', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        userId: userId,
                        userName: userData.name || 'Anonymous',
                        message: message,
                        timestamp: new Date().toISOString(),
                        userAgent: navigator.userAgent
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                removeTypingIndicator(typingId);
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        // Remove from offline queue if it was queued
                        if (messageId) {
                            offlineMessageQueue = offlineMessageQueue.filter(m => m.id !== messageId);
                            saveOfflineQueue();
                        }
                        addMessageToChat('✓ Вашият доклад за проблем е изпратен успешно до администратора. Благодарим ви за обратната връзка!', 'assistant');
                    } else {
                        throw new Error('Report submission failed');
                    }
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error) {
                console.error('Report problem error:', error);
                removeTypingIndicator(typingId);
                addMessageToChat('❌ Грешка при изпращане на доклада. Моля, опитайте отново по-късно.', 'assistant');
                throw error;
            } finally {
                isSending = false;
            }
        }
        
        // Enhancement #8: Save offline queue to localStorage
        function saveOfflineQueue() {
            try {
                localStorage.setItem('offlineMessageQueue', JSON.stringify(offlineMessageQueue));
            } catch (e) {
                console.error('Failed to save offline queue:', e);
            }
        }
        
        // Enhancement #8: Load offline queue from localStorage
        function loadOfflineQueue() {
            try {
                const saved = localStorage.getItem('offlineMessageQueue');
                if (saved) {
                    offlineMessageQueue = JSON.parse(saved);
                    if (offlineMessageQueue.length > 0 && isOnline) {
                        processOfflineQueue();
                    }
                }
            } catch (e) {
                console.error('Failed to load offline queue:', e);
            }
        }
        
        // Enhancement #6: Load plan history from localStorage
        function loadPlanHistory() {
            try {
                const saved = localStorage.getItem('planHistory');
                if (saved) {
                    planHistory = JSON.parse(saved);
                }
            } catch (e) {
                console.error('Failed to load plan history:', e);
                planHistory = [];
            }
        }
        
        // Enhancement #6: Save plan to history
        function savePlanToHistory() {
            if (!dietPlan) return;
            
            const snapshot = {
                plan: JSON.parse(JSON.stringify(dietPlan)),
                timestamp: Date.now()
            };
            
            planHistory.push(snapshot);
            
            // Keep only last MAX_HISTORY_SIZE items
            if (planHistory.length > MAX_HISTORY_SIZE) {
                planHistory.shift();
            }
            
            // Save to localStorage
            try {
                localStorage.setItem('planHistory', JSON.stringify(planHistory));
            } catch (e) {
                console.error('Failed to save plan history:', e);
            }
        }
        
        // Enhancement #6: Undo last change
        function undoLastChange() {
            if (planHistory.length === 0) {
                addMessageToChat('⚠️ Няма налични промени за връщане.', 'assistant');
                return;
            }
            
            const lastSnapshot = planHistory.pop();
            dietPlan = lastSnapshot.plan;
            migrateMealTypes(dietPlan);
            
            // Save to localStorage and backend
            localStorage.setItem('dietPlan', JSON.stringify(dietPlan));
            
            // Update UI
            renderDay(currentDay);
            addMessageToChat('↩️ Промяната е отменена успешно!', 'assistant');
            
            // Hide undo button if no more history
            if (planHistory.length === 0) {
                hideUndoButton();
            }
            
            // Update history in localStorage
            try {
                localStorage.setItem('planHistory', JSON.stringify(planHistory));
            } catch (e) {
                console.error('Failed to save plan history:', e);
            }
        }
        
        // Enhancement #5 & #6: Show undo button
        function showUndoButton() {
            // Check if undo button already exists
            let undoBtn = document.getElementById('undoButton');
            if (!undoBtn) {
                const chatMessages = document.getElementById('chatMessages');
                if (!chatMessages) return;
                
                undoBtn = document.createElement('div');
                undoBtn.id = 'undoButton';
                undoBtn.style.cssText = `
                    display: flex;
                    justify-content: center;
                    margin: 10px 0;
                    animation: fadeIn 0.3s ease-in;
                `;
                undoBtn.innerHTML = `
                    <button onclick="undoLastChange()" style="
                        background: #FF9800;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 20px;
                        cursor: pointer;
                        font-size: 0.85rem;
                        font-weight: 500;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        box-shadow: 0 2px 6px rgba(255, 152, 0, 0.3);
                        transition: all 0.2s ease;
                    " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                        <i class="fas fa-undo"></i> Отмени промяната
                    </button>
                `;
                chatMessages.appendChild(undoBtn);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }
        
        // Enhancement #6: Hide undo button
        function hideUndoButton() {
            const undoBtn = document.getElementById('undoButton');
            if (undoBtn) {
                undoBtn.remove();
            }
        }
        
        // Enhancement #5: Highlight changed meals
        function highlightChangedMeals(dayNum) {
            // Add a temporary highlight animation to meal cards
            setTimeout(() => {
                const mealCards = document.querySelectorAll('.meal-card');
                mealCards.forEach(card => {
                    card.style.animation = 'highlightPulse 1.5s ease-in-out';
                    setTimeout(() => {
                        card.style.animation = '';
                    }, 1500);
                });
            }, 100);
        }

        function addMessageToChat(message, role, saveToHistory = true) {
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages) return;

            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${role}`;
            messageDiv.style.cssText = `
                display: flex;
                justify-content: ${role === 'user' ? 'flex-end' : 'flex-start'};
                margin-bottom: 10px;
            `;

            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            bubble.style.cssText = `
                background: ${role === 'user' ? 'var(--primary-red)' : 'var(--card-bg)'};
                color: ${role === 'user' ? 'white' : 'var(--text-dark)'};
                padding: 10px 15px;
                border-radius: 12px;
                max-width: 80%;
                font-size: 0.9rem;
                line-height: 1.6;
                word-wrap: break-word;
                white-space: pre-wrap;
            `;

            // Format message to preserve line breaks and structure
            const formattedMessage = formatChatMessage(message);

            // Haptic feedback for new assistant messages (not history loads)
            if (role === 'assistant' && saveToHistory && typeof navigator !== 'undefined' && navigator.vibrate) {
                // Two-tap "new message received" pattern: short buzz · pause · medium buzz.
                navigator.vibrate([20, 55, 50]);
            }

            // Typewriter effect for new assistant messages only (not history loads)
            if (role === 'assistant' && saveToHistory) {
                bubble.textContent = '';
                bubble.classList.add('chat-typing');
                messageDiv.appendChild(bubble);
                chatMessages.appendChild(messageDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;

                let i = 0;
                const charDelay = 18; // ms per character — ~55 chars/sec
                function tick() {
                    if (i < message.length) {
                        bubble.textContent += message[i++];
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                        setTimeout(tick, charDelay);
                    } else {
                        // Typing done — swap plain text to formatted HTML
                        bubble.classList.remove('chat-typing');
                        bubble.innerHTML = formattedMessage;
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    }
                }
                tick();
            } else {
                bubble.innerHTML = formattedMessage;
                messageDiv.appendChild(bubble);
                chatMessages.appendChild(messageDiv);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }

            // Save to chat history if requested
            if (saveToHistory) {
                chatHistory.push({ text: message, role: role, timestamp: Date.now() });
                saveChatHistory();
                
                // Increment daily chat messages counter for user messages
                if (role === 'user') {
                    incrementDailyChatCount();
                }
            }
        }
        
        function formatChatMessage(message) {
            // Escape HTML to prevent XSS
            let formatted = escapeHtml(message);
            
            // Split by double line breaks for paragraphs
            let paragraphs = formatted.split(/\n\n+/);
            
            // Process each paragraph
            paragraphs = paragraphs.map(para => {
                // Check if paragraph contains list items (lines starting with -, •, or *)
                const lines = para.split('\n');
                const hasListItems = lines.some(line => /^\s*[-•*]\s+/.test(line));
                
                if (hasListItems) {
                    // Convert to HTML list - handle mixed content properly
                    let result = '';
                    let inList = false;
                    
                    lines.forEach(line => {
                        const trimmed = line.trim();
                        if (/^[-•*]\s+/.test(trimmed)) {
                            // List item
                            if (!inList) {
                                result += '<ul style="margin: 8px 0; padding-left: 20px;">';
                                inList = true;
                            }
                            const content = trimmed.replace(/^[-•*]\s+/, '');
                            result += `<li style="margin: 4px 0;">${content}</li>`;
                        } else if (trimmed) {
                            // Non-list line - close list if open, add as paragraph
                            if (inList) {
                                result += '</ul>';
                                inList = false;
                            }
                            result += `<p style="margin: 8px 0;">${trimmed}</p>`;
                        }
                    });
                    
                    // Close list if still open
                    if (inList) {
                        result += '</ul>';
                    }
                    
                    return result;
                } else {
                    // Regular paragraph - convert single line breaks to <br>
                    return '<p style="margin: 8px 0;">' + para.replace(/\n/g, '<br>') + '</p>';
                }
            });
            
            formatted = paragraphs.join('');
            
            // Clean up empty paragraphs
            formatted = formatted.replace(/<p[^>]*>\s*<\/p>/g, '');
            
            return formatted;
        }

        function addTypingIndicator() {
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages) return null;

            const typingDiv = document.createElement('div');
            const id = 'typing-' + Date.now();
            typingDiv.id = id;
            typingDiv.style.cssText = 'display: flex; justify-content: flex-start; margin-bottom: 10px;';
            typingDiv.innerHTML = `
                <div style="background: var(--card-bg); color: var(--text-light); padding: 10px 15px; border-radius: 12px; font-size: 0.9rem;">
                    <i class="fas fa-ellipsis-h fa-pulse"></i> Пише...
                </div>
            `;

            chatMessages.appendChild(typingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;

            return id;
        }

        function removeTypingIndicator(id) {
            const indicator = document.getElementById(id);
            if (indicator) {
                indicator.remove();
            }
        }

        // Helper function
        function escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, m => map[m]);
        }

        // Chat history management functions
        function saveChatHistory() {
            try {
                // Limit history size to prevent localStorage quota issues
                const maxHistoryItems = 50;
                if (chatHistory.length > maxHistoryItems) {
                    chatHistory = chatHistory.slice(-maxHistoryItems);
                }
                
                localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
                localStorage.setItem('chatMode', chatMode);
                localStorage.setItem('conversationId', conversationId);
            } catch (e) {
                console.error('Failed to save chat history:', e);
                // If quota exceeded, try to clear old data and retry
                if (e.name === 'QuotaExceededError' || e.code === 22) {
                    console.warn('LocalStorage quota exceeded. Clearing old chat history...');
                    try {
                        chatHistory = chatHistory.slice(-20); // Keep only last 20
                        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
                        localStorage.setItem('chatMode', chatMode);
                        localStorage.setItem('conversationId', conversationId);
                    } catch (retryError) {
                        console.error('Failed to save even after cleanup. Clearing all history:', retryError);
                        chatHistory = [];
                        localStorage.removeItem('chatHistory');
                    }
                }
            }
        }

        function loadChatHistory() {
            try {
                const saved = localStorage.getItem('chatHistory');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // Validate that it's an array
                    if (Array.isArray(parsed)) {
                        chatHistory = parsed;
                    } else {
                        console.warn('Invalid chat history format, resetting');
                        chatHistory = [];
                    }
                }
                const savedMode = localStorage.getItem('chatMode');
                if (savedMode && (savedMode === 'consultation' || savedMode === 'modification')) {
                    chatMode = savedMode;
                }
                if (!modificationModeEnabled && chatMode === 'modification') {
                    chatMode = 'consultation';
                }
                const savedConversationId = localStorage.getItem('conversationId');
                if (savedConversationId) {
                    conversationId = savedConversationId;
                }
                
                // Load demo limit unlock flag
                isDemoLimitUnlocked = localStorage.getItem('chatDemoLimitUnlocked') === 'true';
            } catch (e) {
                console.error('Failed to load chat history:', e);
                chatHistory = [];
                // Clear corrupted data
                localStorage.removeItem('chatHistory');
            }
        }

        function startNewChat() {
            // Confirm before clearing history
            if (chatHistory.length > 0) {
                if (!confirm('Това ще изтрие цялата история на чата. Сигурни ли сте?')) {
                    return;
                }
            }
            
            // Clear chat history
            chatHistory = [];
            chatMode = 'consultation';
            conversationId = Date.now().toString();
            saveChatHistory();
            
            // Clear chat messages from UI
            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages) {
                chatMessages.innerHTML = '';
                // Show welcome message
                addMessageToChat(`Здравейте, ${userData.name || 'приятелю'}! 👋\n\nАз съм вашият AI диетолог асистент. Как мога да ви помогна днес?`, 'assistant', false);
            }
            
            // Reset mode UI
            updateModeUI();
        }

        // Add animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideUp {
                from {
                    transform: translateY(20px);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);


        // ═══════════════════════════════════════════════════════════
        // FOOD IMAGE ANALYSIS FEATURE
        // ═══════════════════════════════════════════════════════════

        // Helper: returns true when running inside the native Capacitor APK
        let foodAnalysisImageData = null;  // Base64 image data
        let foodAnalysisImageMime = null;  // MIME type
        let foodAnalysisInProgress = false;
        let foodAnalysisMode = 'food';     // 'food' | 'menu'
        let _lastFoodAnalysis = null;      // Stores latest analysis for "add to my menu"

        function resetFoodCaptureUI(mode) {
            const hint = mode === 'menu' ? 'Натиснете за да снимате менюто' : 'Натиснете за да направите снимка';
            const captureArea = document.getElementById('foodCaptureArea');
            if (captureArea) captureArea.classList.remove('has-image');
            const captureContent = document.getElementById('foodCaptureContent');
            if (captureContent) {
                captureContent.innerHTML = `
                    <div class="food-capture-icon"><i class="fas fa-camera"></i></div>
                    <div class="food-capture-text">${hint}</div>
                `;
            }
            foodAnalysisImageData = null;
            foodAnalysisImageMime = null;
            const analyzeBtn = document.getElementById('foodAnalyzeBtn');
            if (analyzeBtn) {
                analyzeBtn.disabled = true;
                analyzeBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Изпрати за анализ';
            }
            const results = document.getElementById('foodResults');
            if (results) {
                results.classList.remove('visible');
                results.innerHTML = '';
            }
        }

        function switchFoodMode(mode) {
            foodAnalysisMode = mode;
            const tabFood = document.getElementById('modeTabFood');
            const tabMenu = document.getElementById('modeTabMenu');
            const title = document.getElementById('foodAnalysisTitle');
            if (tabFood) tabFood.classList.toggle('active', mode === 'food');
            if (tabMenu) tabMenu.classList.toggle('active', mode === 'menu');
            if (title) {
                title.innerHTML = mode === 'menu'
                    ? '<i class="fas fa-book-open"></i> Меню от ресторант'
                    : '<i class="fas fa-utensils"></i> Анализ на Храна';
            }
            resetFoodCaptureUI(mode);
        }

        function handleFoodAnalyzeClick() {
            if (foodAnalysisMode === 'menu') {
                analyzeMenuImage();
            } else {
                analyzeFoodImage();
            }
        }

        function openFoodAnalysis() {
            const overlay = document.getElementById('foodAnalysisOverlay');
            if (overlay) {
                overlay.classList.add('active');
                // Reset state
                resetFoodAnalysis();

                // Show demo mode notice inside the modal
                if (!isDemoLimitUnlocked) {
                    const usedToday = getDailyImageCount();
                    const remaining = Math.max(0, MAX_DAILY_IMAGE_ANALYSES - usedToday);
                    const body = overlay.querySelector('.food-analysis-body');
                    if (body) {
                        const existingNotice = body.querySelector('.demo-notice');
                        if (!existingNotice) {
                            const notice = document.createElement('div');
                            notice.className = 'demo-notice demo-mode-notice';
                            notice.style.cssText = '';
                            notice.innerHTML = `<i class="fas fa-info-circle"></i> <strong>Демо режим:</strong> Системата е в демо режим и позволява до ${MAX_DAILY_IMAGE_ANALYSES} AI анализа на изображения на ден. Оставащи днес: <strong>${remaining}</strong>.`;
                            body.insertBefore(notice, body.firstChild);
                        }
                    }
                }
            }
        }

        function closeFoodAnalysis() {
            const overlay = document.getElementById('foodAnalysisOverlay');
            if (overlay) {
                overlay.classList.remove('active');
            }
        }

        function resetFoodAnalysis() {
            foodAnalysisInProgress = false;
            foodAnalysisMode = 'food';

            const tabFood = document.getElementById('modeTabFood');
            const tabMenu = document.getElementById('modeTabMenu');
            if (tabFood) tabFood.classList.add('active');
            if (tabMenu) tabMenu.classList.remove('active');
            const title = document.getElementById('foodAnalysisTitle');
            if (title) title.innerHTML = '<i class="fas fa-utensils"></i> Анализ на Храна';

            resetFoodCaptureUI('food');
        }

        function triggerFoodCapture() {
            if (foodAnalysisInProgress) return;
            const input = document.getElementById('foodImageInput');
            if (input) { input.value = ''; input.click(); }
        }

        // Handle file selection - Initialize immediately when DOM is ready
        (function initFoodAnalysis() {
            function setupFoodAnalysis() {
                const fileInput = document.getElementById('foodImageInput');
                if (fileInput) {
                    fileInput.addEventListener('change', handleFoodImageSelected);
                }

                // Close modal on overlay click
                const overlay = document.getElementById('foodAnalysisOverlay');
                if (overlay) {
                    overlay.addEventListener('click', function(e) {
                        if (e.target === overlay) {
                            closeFoodAnalysis();
                        }
                    });
                }

                // Auto-select meal context based on time of day
                autoSelectMealContext();

                // Auto-open food analysis if navigated here with ?food=1
                if (new URLSearchParams(window.location.search).get('food') === '1') {
                    openFoodAnalysis();
                }
            }
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupFoodAnalysis);
            } else {
                setupFoodAnalysis();
            }
        })();

        function autoSelectMealContext() {
            const hour = new Date().getHours();
            const select = document.getElementById('foodMealContext');
            if (!select) return;
            
            if (hour >= 5 && hour < 10) {
                select.value = 'Хранене 1';
            } else if (hour >= 10 && hour < 14) {
                select.value = 'Хранене 2';
            } else if (hour >= 14 && hour < 17) {
                select.value = 'Хранене 3';
            } else if (hour >= 17 && hour < 22) {
                select.value = 'Хранене 4';
            } else {
                select.value = 'Хранене 5';
            }
        }

        function handleFoodImageSelected(event) {
            const file = event.target.files[0];
            if (!file) return;

            // Validate file type — accept any image type, canvas will convert to JPEG
            if (!file.type.startsWith('image/')) {
                alert('Файлът не е изображение. Моля, изберете изображение във формат JPG, PNG или WebP.');
                return;
            }

            foodAnalysisImageMime = 'image/jpeg'; // We'll convert to JPEG for compression

            // Show compression progress for large files
            const analyzeBtn = document.getElementById('foodAnalyzeBtn');
            if (analyzeBtn) {
                analyzeBtn.disabled = true;
                analyzeBtn.innerHTML = '<div class="food-spinner"></div> Обработка на изображението...';
            }

            // Compress and preview image
            compressImage(file, function(compressedBase64) {
                foodAnalysisImageData = compressedBase64;

                // Show preview
                const captureArea = document.getElementById('foodCaptureArea');
                const captureContent = document.getElementById('foodCaptureContent');
                if (captureArea && captureContent) {
                    captureArea.classList.add('has-image');
                    captureContent.innerHTML = `
                        <img src="${compressedBase64}" class="food-preview-img" alt="${foodAnalysisMode === 'menu' ? 'Снимка на меню' : 'Снимка на храна'}">
                        <div style="margin-top:8px;font-size:0.8rem;color:var(--text-light);">
                            <i class="fas fa-redo"></i> Натиснете за нова снимка
                        </div>
                    `;
                }

                // Enable analyze button
                const analyzeBtn = document.getElementById('foodAnalyzeBtn');
                if (analyzeBtn) {
                    analyzeBtn.disabled = false;
                    analyzeBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Изпрати за анализ';
                }
            });
        }

        /**
         * Compress image to JPEG with max 1600px dimension and quality 0.85
         * Higher resolution ensures AI can identify foods, portion sizes, and ingredients accurately.
         * Even large original images (10MB+) compress to ~300-500KB at these settings.
         */
        function compressImage(file, callback) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const MAX_DIM = 1600;
                    let width = img.width;
                    let height = img.height;

                    if (width > MAX_DIM || height > MAX_DIM) {
                        if (width > height) {
                            height = Math.round(height * MAX_DIM / width);
                            width = MAX_DIM;
                        } else {
                            width = Math.round(width * MAX_DIM / height);
                            height = MAX_DIM;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const compressed = canvas.toDataURL('image/jpeg', 0.85);
                    callback(compressed);
                };
                img.onerror = function() {
                    alert('Неуспешно зареждане на изображението. Моля, опитайте с друго.');
                };
                img.src = e.target.result;
            };
            reader.onerror = function() {
                alert('Неуспешно четене на файла. Моля, опитайте отново.');
            };
            reader.readAsDataURL(file);
        }

        async function analyzeFoodImage() {
            if (!foodAnalysisImageData || foodAnalysisInProgress) return;

            // Check daily image analysis limit
            if (!isDemoLimitUnlocked && getDailyImageCount() >= MAX_DAILY_IMAGE_ANALYSES) {
                const resultsDiv = document.getElementById('foodResults');
                if (resultsDiv) {
                    resultsDiv.innerHTML = `
                        <div class="food-result-section demo-mode-notice demo-limit-reached" style="border-left:3px solid #ffc107;">
                            <h4 style="color:#7a3b00;"><i class="fas fa-info-circle"></i> Демо лимит</h4>
                            <p style="font-size:0.88rem;">Демо версията позволява до ${MAX_DAILY_IMAGE_ANALYSES} AI анализа на изображения на ден. Лимитът за днес е достигнат. Моля, свържете се с нас за пълен достъп.</p>
                        </div>
                    `;
                    resultsDiv.classList.add('visible');
                }
                return;
            }

            foodAnalysisInProgress = true;
            const analyzeBtn = document.getElementById('foodAnalyzeBtn');
            const resultsDiv = document.getElementById('foodResults');

            // Show loading state
            if (analyzeBtn) {
                analyzeBtn.disabled = true;
                analyzeBtn.innerHTML = '<div class="food-spinner"></div> Анализиране...';
            }
            if (resultsDiv) {
                resultsDiv.classList.remove('visible');
                resultsDiv.innerHTML = '';
            }

            try {
                const mealContext = document.getElementById('foodMealContext')?.value || 'Обяд';

                // Prepare compact user data and plan for context
                const compactUserData = userData ? {
                    name: userData.name,
                    goal: userData.goal,
                    weight: userData.weight,
                    height: userData.height,
                    gender: userData.gender,
                    dietPreference: userData.dietPreference,
                    medicalConditions: userData.medicalConditions,
                    dietDislike: userData.dietDislike
                } : null;

                const compactPlan = dietPlan ? {
                    summary: dietPlan.summary
                } : null;

                const response = await fetch(WORKER_URL + '/api/analyze-food-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        imageData: foodAnalysisImageData,
                        mimeType: foodAnalysisImageMime,
                        userData: compactUserData,
                        dietPlan: compactPlan,
                        mealContext: mealContext
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                }

                const result = await response.json();

                if (result.success && result.analysis) {
                    incrementDailyImageCount();
                    renderFoodAnalysisResults(result.analysis);
                } else if (result.parseError && result.rawResponse) {
                    // Fallback: show raw AI response
                    if (resultsDiv) {
                        resultsDiv.innerHTML = `
                            <div class="food-result-section">
                                <h4><i class="fas fa-robot"></i> AI Анализ</h4>
                                <p style="font-size:0.88rem;line-height:1.6;white-space:pre-line;">${escapeHtmlWithBreaks(result.rawResponse)}</p>
                            </div>
                        `;
                        resultsDiv.classList.add('visible');
                    }
                } else {
                    throw new Error(result.error || 'Неуспешен анализ');
                }
            } catch (error) {
                console.error('Food analysis error:', error);
                if (resultsDiv) {
                    resultsDiv.innerHTML = `
                        <div class="food-result-section" style="border-left:3px solid #ef4444;">
                            <h4 style="color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Грешка</h4>
                            <p style="font-size:0.88rem;color:var(--text-light);">${escapeHtmlWithBreaks(error.message)}</p>
                        </div>
                    `;
                    resultsDiv.classList.add('visible');
                }
            } finally {
                foodAnalysisInProgress = false;
                if (analyzeBtn) {
                    analyzeBtn.disabled = false;
                    analyzeBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Изпрати за повторен анализ';
                }
            }
        }

        function renderFoodAnalysisResults(analysis) {
            const resultsDiv = document.getElementById('foodResults');
            if (!resultsDiv) return;

            let html = '';

            // 1. Detected foods with weights and calories
            if (analysis.foods && analysis.foods.length > 0) {
                html += `<div class="food-result-section">
                    <h4><i class="fas fa-drumstick-bite"></i> Разпознати храни 
                        <span class="food-confidence ${analysis.confidence || 'medium'}">${
                            analysis.confidence === 'high' ? '✓ Висока точност' :
                            analysis.confidence === 'low' ? '⚠ Ниска точност' : '~ Средна точност'
                        }</span>
                    </h4>`;
                
                analysis.foods.forEach(function(food) {
                    html += `<div class="food-item-row">
                        <span class="food-item-name">${escapeHtmlWithBreaks(food.name)}</span>
                        <span class="food-item-weight">${escapeHtmlWithBreaks(food.estimatedWeight || '')}</span>
                        <span class="food-item-cals">${Math.round(food.calories || 0)} kcal</span>
                    </div>`;
                });

                // Totals row
                html += `<div class="food-item-row" style="font-weight:700;border-top:2px solid rgba(0,0,0,0.1);margin-top:4px;padding-top:10px;">
                    <span class="food-item-name">Общо</span>
                    <span class="food-item-weight">${escapeHtmlWithBreaks(analysis.totalWeight || '')}</span>
                    <span class="food-item-cals">${Math.round(analysis.totalCalories || 0)} kcal</span>
                </div>`;
                html += '</div>';
            }

            // 2. Macronutrient breakdown
            const totalP = analysis.totalProtein || 0;
            const totalC = analysis.totalCarbs || 0;
            const totalF = analysis.totalFats || 0;
            // Fiber excluded from calorie total – indigestible, contributes no usable calories.
            const totalCals = (totalP * 4) + (totalC * 4) + (totalF * 9);

            if (totalCals > 0) {
                const pPct = Math.round((totalP * 4 / totalCals) * 100);
                const cPct = Math.round((totalC * 4 / totalCals) * 100);
                const fPct = Math.max(0, 100 - pPct - cPct);

                html += `<div class="food-result-section">
                    <h4><i class="fas fa-chart-pie"></i> Макронутриенти</h4>
                    <div class="food-macros-bar">
                        <div class="food-macro-segment protein" style="width:${pPct}%"></div>
                        <div class="food-macro-segment fats" style="width:${fPct}%"></div>
                        <div class="food-macro-segment carbs" style="width:${cPct}%"></div>
                    </div>
                    <div class="food-macros-legend">
                        <span class="food-macro-label"><span class="food-macro-dot protein"></span> Протеин: ${Math.round(totalP)}г (${pPct}%)</span>
                        <span class="food-macro-label"><span class="food-macro-dot fats"></span> Мазнини: ${Math.round(totalF)}г (${fPct}%)</span>
                        <span class="food-macro-label"><span class="food-macro-dot carbs"></span> Въглех.: ${Math.round(totalC)}г (${cPct}%)</span>
                    </div>
                </div>`;
            }

            // 3. Diet suitability assessment
            if (analysis.dietSuitability) {
                const suit = analysis.dietSuitability;
                const score = suit.score != null ? suit.score : 3;
                const suitClass = score >= 4 ? 'suitable' : score >= 2 ? 'partial' : 'unsuitable';

                html += `<div class="food-result-section">
                    <h4><i class="fas fa-clipboard-check"></i> Оценка за диетата</h4>
                    <div class="food-suitability ${suitClass}">
                        <div class="food-suitability-score">${score}/5</div>
                        <div class="food-suitability-info">
                            <div class="food-suitability-verdict">${escapeHtmlWithBreaks(suit.verdict || '')}</div>
                            <div class="food-suitability-explanation">${escapeHtmlWithBreaks(suit.explanation || '')}</div>
                        </div>
                    </div>
                </div>`;
            }

            // 4. Suggestions
            if (analysis.suggestions) {
                html += `<div class="food-result-section">
                    <h4><i class="fas fa-lightbulb"></i> Препоръки</h4>
                    <div class="food-suggestions">${escapeHtmlWithBreaks(analysis.suggestions)}</div>
                </div>`;
            }

            resultsDiv.innerHTML = html;
            resultsDiv.classList.add('visible');

            // Store analysis for "add to my menu" action
            _lastFoodAnalysis = { type: 'food', ts: new Date().toISOString(), analysis };

            // Append "Add to my menu" / "не добавяй" action buttons
            const actionDiv = document.createElement('div');
            actionDiv.className = 'food-action-btns';
            actionDiv.innerHTML = `
                <button class="food-add-menu-btn" onclick="addToMyMenu()">
                    <i class="fas fa-plus"></i> Добави в моето меню
                </button>
                <button class="food-no-add-btn" onclick="closeFoodAnalysis()">не добавяй</button>
            `;
            resultsDiv.appendChild(actionDiv);

            // Log consumed food to game data if game is enabled
            if (window.gameModule && window.gameModule.isEnabled() && analysis.foods && analysis.foods.length > 0) {
                const foodNames = analysis.foods.map(function(f) { return f.name; }).join(', ');
                const totalCals = analysis.totalCalories || 0;
                const suitScore = analysis.dietSuitability ? analysis.dietSuitability.score : 3;
                const mealCtxEl = document.getElementById('foodMealContext');
                const context = mealCtxEl ? mealCtxEl.value : '';
                window.gameModule.logExtraFood(foodNames, totalCals, suitScore, context);
            }

            // Scroll to results
            setTimeout(function() {
                resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }

        // ═══════════════════════════════════════════════════════════
        // END FOOD IMAGE ANALYSIS FEATURE
        // ═══════════════════════════════════════════════════════════

        async function analyzeMenuImage() {
            if (!foodAnalysisImageData || foodAnalysisInProgress) return;

            // Check daily image analysis limit
            if (!isDemoLimitUnlocked && getDailyImageCount() >= MAX_DAILY_IMAGE_ANALYSES) {
                const resultsDiv = document.getElementById('foodResults');
                if (resultsDiv) {
                    resultsDiv.innerHTML = `
                        <div class="food-result-section demo-mode-notice demo-limit-reached" style="border-left:3px solid #ffc107;">
                            <h4 style="color:#7a3b00;"><i class="fas fa-info-circle"></i> Демо лимит</h4>
                            <p style="font-size:0.88rem;">Демо версията позволява до ${MAX_DAILY_IMAGE_ANALYSES} AI анализа на изображения на ден. Лимитът за днес е достигнат. Моля, свържете се с нас за пълен достъп.</p>
                        </div>
                    `;
                    resultsDiv.classList.add('visible');
                }
                return;
            }

            foodAnalysisInProgress = true;
            const analyzeBtn = document.getElementById('foodAnalyzeBtn');
            const resultsDiv = document.getElementById('foodResults');

            if (analyzeBtn) {
                analyzeBtn.disabled = true;
                analyzeBtn.innerHTML = '<div class="food-spinner"></div> Анализиране на менюто...';
            }
            if (resultsDiv) {
                resultsDiv.classList.remove('visible');
                resultsDiv.innerHTML = '';
            }

            try {
                const mealContext = document.getElementById('foodMealContext')?.value || 'Обяд';

                const compactUserData = userData ? {
                    name: userData.name,
                    goal: userData.goal,
                    weight: userData.weight,
                    height: userData.height,
                    gender: userData.gender,
                    dietPreference: userData.dietPreference,
                    medicalConditions: userData.medicalConditions,
                    dietDislike: userData.dietDislike
                } : null;

                const compactPlan = dietPlan ? { summary: dietPlan.summary } : null;

                const response = await fetch(WORKER_URL + '/api/analyze-menu-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        imageData: foodAnalysisImageData,
                        mimeType: foodAnalysisImageMime,
                        userData: compactUserData,
                        dietPlan: compactPlan,
                        mealContext: mealContext
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP ${response.status}`);
                }

                const result = await response.json();

                if (result.success && result.analysis) {
                    incrementDailyImageCount();
                    renderMenuAnalysisResults(result.analysis);
                } else if (result.parseError && result.rawResponse) {
                    if (resultsDiv) {
                        resultsDiv.innerHTML = `
                            <div class="food-result-section">
                                <h4><i class="fas fa-robot"></i> AI Анализ на менюто</h4>
                                <p style="font-size:0.88rem;line-height:1.6;white-space:pre-line;">${escapeHtmlWithBreaks(result.rawResponse)}</p>
                            </div>
                        `;
                        resultsDiv.classList.add('visible');
                    }
                } else {
                    throw new Error(result.error || 'Неуспешен анализ');
                }
            } catch (error) {
                console.error('Menu analysis error:', error);
                if (resultsDiv) {
                    resultsDiv.innerHTML = `
                        <div class="food-result-section" style="border-left:3px solid #ef4444;">
                            <h4 style="color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Грешка</h4>
                            <p style="font-size:0.88rem;color:var(--text-light);">${escapeHtmlWithBreaks(error.message)}</p>
                        </div>
                    `;
                    resultsDiv.classList.add('visible');
                }
            } finally {
                foodAnalysisInProgress = false;
                if (analyzeBtn) {
                    analyzeBtn.disabled = false;
                    analyzeBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Анализирай отново';
                }
            }
        }

        function renderMenuAnalysisResults(analysis) {
            const resultsDiv = document.getElementById('foodResults');
            if (!resultsDiv) return;

            const score = Math.min(5, Math.max(0, Math.round(analysis.suitabilityScore != null ? analysis.suitabilityScore : 3)));
            const scoreColors = ['#6b7280', '#ef4444', '#f97316', '#fbbf24', '#84cc16', '#0D9488'];
            const scoreColor = scoreColors[score] || '#0D9488';

            // Build stars HTML
            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
                starsHtml += `<span class="menu-star${i <= score ? ' filled' : ''}">★</span>`;
            }

            const scoreLabels = ['Абсолютно неподходящо', 'Неподходящо', 'Слабо подходящо', 'Частично подходящо', 'Добро избор', 'Отлично избор'];
            const scoreLabel = scoreLabels[score] || '';

            let html = `<div class="menu-result-card">
                <div class="menu-result-header" style="background: linear-gradient(135deg, ${scoreColor} 0%, ${scoreColor}cc 100%);">
                    <div class="menu-result-dish">${escapeHtmlWithBreaks(analysis.recommendedDish || 'Препоръчано ястие')}</div>
                    <div class="menu-score-row">
                        <div class="menu-stars">${starsHtml}</div>
                        <span class="menu-score-label">${score}/5 — ${scoreLabel}</span>
                    </div>
                </div>
                <div class="menu-result-body">`;

            if (analysis.description) {
                html += `<div class="menu-info-block">
                    <div class="menu-info-block-label"><i class="fas fa-info-circle"></i> Описание</div>
                    ${escapeHtmlWithBreaks(analysis.description)}
                </div>`;
            }

            if (analysis.reasoning) {
                html += `<div class="menu-info-block">
                    <div class="menu-info-block-label"><i class="fas fa-balance-scale"></i> Аргументация</div>
                    ${escapeHtmlWithBreaks(analysis.reasoning)}
                </div>`;
            }

            if (analysis.adaptationTip) {
                html += `<div class="menu-adaptation-block">
                    <div class="menu-info-block-label"><i class="fas fa-lightbulb"></i> Препоръка за адаптация</div>
                    ${escapeHtmlWithBreaks(analysis.adaptationTip)}
                </div>`;
            }

            if (analysis.alternatives && analysis.alternatives.length > 0) {
                html += `<div class="menu-alternatives">
                    <div class="menu-info-block-label" style="margin-bottom:6px;"><i class="fas fa-list-ul"></i> Алтернативи</div>`;
                analysis.alternatives.forEach(function(alt) {
                    html += `<div class="menu-alt-item">
                        <span class="menu-alt-name">${escapeHtmlWithBreaks(alt.name || '')}</span>
                        <span class="menu-alt-reason">${escapeHtmlWithBreaks(alt.reason || '')}</span>
                    </div>`;
                });
                html += '</div>';
            }

            html += '</div></div>';

            resultsDiv.innerHTML = html;
            resultsDiv.classList.add('visible');

            // Store analysis for "add to my menu" action
            _lastFoodAnalysis = { type: 'menu', ts: new Date().toISOString(), analysis };

            // Append "Add to my menu" / "не добавяй" action buttons
            const actionDiv = document.createElement('div');
            actionDiv.className = 'food-action-btns';
            actionDiv.innerHTML = `
                <button class="food-add-menu-btn" onclick="addToMyMenu()">
                    <i class="fas fa-plus"></i> Добави в моето меню
                </button>
                <button class="food-no-add-btn" onclick="closeFoodAnalysis()">не добавяй</button>
            `;
            resultsDiv.appendChild(actionDiv);

            // Log menu recommendation to game data (mirrors food-photo analysis logging).
            // Menu analysis scans a restaurant menu to recommend a dish; the AI cannot reliably
            // estimate portion weights or calorie totals from a menu listing, so calories are 0.
            // The suitability score (isJunk flag) is still captured so that low-rated menu choices
            // correctly affect junkCount / engPct without inflating the calorie total.
            if (window.gameModule && window.gameModule.isEnabled()) {
                const menuCtxEl = document.getElementById('foodMealContext');
                const menuContext = menuCtxEl ? menuCtxEl.value : '';
                window.gameModule.logExtraFood(
                    analysis.recommendedDish || 'Препоръчано ястие',
                    0,
                    score,
                    menuContext
                );
            }

            setTimeout(function() {
                resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }

        // ═══════════════════════════════════════════════════════════
        // END MENU ANALYSIS FEATURE
        // ═══════════════════════════════════════════════════════════

        // ── Add to plan: save photo-analysed food as a meal card in today’s plan tab ──
        function addToMyMenu() {
            if (!_lastFoodAnalysis) return;
            var snapshot = _lastFoodAnalysis;
            var a = snapshot.analysis || {};
            var mealCtx = (document.getElementById('foodMealContext') || {}).value || 'Хранене';

            // Determine whether this meal is already in its consumption window.
            // consumed=false means the card will be time-locked until the designated hour.
            var currentHour = new Date().getHours();
            var unlockHour  = _mealUnlockHour(mealCtx);
            // Intermediate / unknown types (unlockHour < 0) are always consumed right now.
            var consumed = unlockHour < 0 || currentHour >= unlockHour;

            var mealEntry;
            if (snapshot.type === 'food') {
                var names = (a.foods || []).map(function(f){ return f.name; }).join(', ');
                var foodLines = (a.foods || []).map(function(f) {
                    var parts = [f.name];
                    if (f.estimatedWeight) parts.push(f.estimatedWeight);
                    if (f.calories) parts.push(Math.round(f.calories) + ' kcal');
                    return parts.join(' • ');
                }).join('\n');
                mealEntry = {
                    type:        mealCtx,
                    name:        names || 'Анализирана храна',
                    weight:      a.totalWeight || '',
                    calories:    a.totalCalories || 0,
                    description: foodLines,
                    macros:      {
                        protein: a.totalProtein || 0,
                        carbs:   a.totalCarbs   || 0,
                        fats:    a.totalFats    || 0,
                        fiber:   a.totalFiber   || 0
                    },
                    suitability: a.dietSuitability || null,
                    addedFrom:   'photo',
                    consumed:    consumed,
                    ts:          snapshot.ts
                };
            } else {
                // Menu analysis — no direct calorie data, just the recommended dish
                mealEntry = {
                    type:        mealCtx,
                    name:        a.recommendedDish || 'Препоръчано ястие',
                    weight:      '',
                    calories:    0,
                    description: a.description || '',
                    macros:      null,
                    suitability: { verdict: (a.suitabilityScore || 0) + '/5', explanation: a.reasoning || '' },
                    addedFrom:   'photo',
                    consumed:    consumed,
                    ts:          snapshot.ts
                };
            }

            // Save to per-day added meals for TODAY
            var storageKey = 'addedMeals_' + todayDateKey();
            var added = [];
            try { added = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch(e) {}
            // Generate a unique ID so we can link this plan entry to the game record's extraMeals entry.
            mealEntry.planId = String(Date.now()) + '_' + Math.random().toString(36).substr(2, 9);
            added.push(mealEntry);
            localStorage.setItem(storageKey, JSON.stringify(added));

            // Link the newly-added plan entry to the most recently logged extraMeals entry in the
            // game record. This lets the check button toggle calorie inclusion for this meal.
            if (window.gameModule && window.gameModule.isEnabled()) {
                var gRec = window.gameModule.getTodayRecord();
                if (gRec && gRec.extraMeals && gRec.extraMeals.length > 0) {
                    var gEntry = gRec.extraMeals[gRec.extraMeals.length - 1];
                    gEntry.planId = mealEntry.planId;
                    gEntry.isAddedToPlan = true;
                    // `consumed` here means "meal is already within its consumption window" (past
                    // the designated hour), so we start counting its calories immediately. Meals
                    // scheduled for later in the day start with countCalories=false and are only
                    // included once the user checks them.
                    gEntry.countCalories = consumed;
                    window.gameModule.saveTodayRecord(gRec);
                }
            }

            _lastFoodAnalysis = null;
            closeFoodAnalysis();

            // Refresh current plan day view to show the new card inline
            if (typeof renderDay === 'function' && typeof currentDay !== 'undefined') {
                renderDay(currentDay);
            }

            // Brief toast
            var toast = document.createElement('div');
            toast.textContent = '✓ Добавено в плана';
            toast.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);' +
                'background:#0D9488;color:#fff;padding:10px 20px;border-radius:20px;' +
                'font-size:0.88rem;font-weight:600;z-index:9999;pointer-events:none;';
            document.body.appendChild(toast);
            setTimeout(function(){ toast.remove(); }, 2400);
        }
        // ── End Add to plan ─────────────────────────────────────────────


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
        
        // Capture the beforeinstallprompt event
        window.addEventListener('beforeinstallprompt', (e) => {
            if (PWA_DEBUG) console.log('beforeinstallprompt fired');
            e.preventDefault();
            deferredPrompt = e;
            
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

        // Initialize iOS banner after a delay
        if (isIOS && isSafari) {
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
        (function initPWAInstallBanner() {
            function setupInstallBanner() {
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
                                console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #06B6D4');
                                console.log('%c🔄 Re-checking PWA Installability', 'color: #06B6D4; font-weight: bold');
                                console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #06B6D4');
                                console.log(`User has been engaged for ${elapsedTime} seconds`);
                                console.log(`beforeinstallprompt still has not fired`);
                                console.log('Waiting for automatic prompt - app may already be installed or PWA criteria not met');
                                console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #06B6D4');
                            }
                            // Don't show manual instructions - wait for automatic prompt only
                        }
                    }, 32000); // Check after 32 seconds (30s requirement + 2s buffer)
                }
            }
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupInstallBanner);
            } else {
                setupInstallBanner();
            }
        })();

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
                                console.log('%cINFO: On Desktop Chrome/Edge, the beforeinstallprompt event often does NOT fire.', 'color: #06B6D4; font-weight: bold');
                                console.log('%cInstead, Chrome shows an INSTALL ICON in the address bar (omnibox).', 'color: #06B6D4; font-weight: bold');
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
        const isCapacitorNativeApp = !!(
            window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === 'function' &&
            window.Capacitor.isNativePlatform()
        );

        if (!isCapacitorNativeApp && 'serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(registration => {
                        console.log('Service Worker registered:', registration);
                        
                        // Check if push notifications are supported and request permission
                        if ('PushManager' in window && 'Notification' in window) {
                            checkNotificationPermission(registration);
                        } else if (PlatformDetector.isHuawei()) {
                            // Huawei without Notification API – fall back to calendar subscription
                            setTimeout(() => showCalendarBanner(), 3000);
                        }
                    })
                    .catch(error => {
                        console.error('Service Worker registration failed:', error);
                    });
            });
        }
        
        // --- Push Notifications (local + server-push) ---
        // Local scheduling is done via GameNotifier (local-scheduler.js).
        // Server-push subscriptions are also registered so the admin panel can
        // send push notifications (plan reminders, AI messages) to specific users.

        // Holds the SW registration so showNotificationPrompt() can use it.
        let swRegistration = null;

        async function checkNotificationPermission(registration) {
            swRegistration = registration;
            // Display user ID for debugging purposes
            const userId = localStorage.getItem('userId');
            if (userId) {
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('🔑 Your User ID (debug):', userId);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            }

            // Huawei devices: web push unreliable – use calendar subscription instead
            if (PlatformDetector.isHuawei()) {
                console.log('[Notifications] Huawei device – offering calendar subscription');
                setTimeout(() => showCalendarBanner(), 3000);
                return;
            }

            if (Notification.permission === 'granted') {
                console.log('📱 Notification permission already granted');
                scheduleNotifications();
                registerServerPush(registration);
            } else if (Notification.permission !== 'denied') {
                // Wait a bit before showing the banner so the user isn't overwhelmed on load
                setTimeout(() => {
                    showNotificationBanner();
                }, 5000);
            }
        }

        function showCalendarBanner() {
            if (document.getElementById('notif-banner')) return;
            const calUrl = window.GameNotifier
                ? window.GameNotifier.getCalendarSubscribeUrl()
                : 'webcal://aidiet.radilov-k.workers.dev/api/calendar.ics';
            const banner = document.createElement('div');
            banner.id = 'notif-banner';
            banner.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#0D9488;color:#fff;padding:12px 16px;border-radius:12px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:calc(100vw - 32px);font-size:14px;';
            banner.innerHTML = '<span>📅 Абонирайте се за автоматични напомняния</span>';
            const btn = document.createElement('a');
            btn.textContent = 'Абонирай се';
            btn.href = calUrl;
            btn.style.cssText = 'background:#fff;color:#0D9488;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none;';
            btn.onclick = () => banner.remove();
            const close = document.createElement('button');
            close.textContent = '✕';
            close.style.cssText = 'background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:0 4px;';
            close.onclick = () => banner.remove();
            banner.appendChild(btn);
            banner.appendChild(close);
            document.body.appendChild(banner);
        }

        function showNotificationBanner() {
            if (document.getElementById('notif-banner')) return;
            const banner = document.createElement('div');
            banner.id = 'notif-banner';
            banner.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;background:#0D9488;color:#fff;padding:12px 16px;border-radius:12px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:calc(100vw - 32px);font-size:14px;';
            banner.innerHTML = '<span>🔔 Разрешете известия за напомняния за храна и съобщения</span>';
            const btn = document.createElement('button');
            btn.textContent = 'Разреши';
            btn.style.cssText = 'background:#fff;color:#0D9488;border:none;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;white-space:nowrap;';
            btn.onclick = async () => {
                banner.remove();
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    console.log('Notification permission granted');
                    scheduleNotifications();
                    if (swRegistration) registerServerPush(swRegistration);
                }
            };
            const close = document.createElement('button');
            close.textContent = '✕';
            close.style.cssText = 'background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:0 4px;';
            close.onclick = () => banner.remove();
            banner.appendChild(btn);
            banner.appendChild(close);
            document.body.appendChild(banner);
        }

        /**
         * Subscribe this browser to server-side Web Push and save the subscription
         * in KV so the admin panel can target this user by their userId.
         * Skips silently if VAPID keys are not configured or already subscribed.
         */
        async function registerServerPush(registration) {
            try {
                if (!('PushManager' in window)) return;

                // Avoid re-subscribing on every page load
                const existing = await registration.pushManager.getSubscription();
                if (existing) {
                    // Still ensure it's persisted on the server (idempotent)
                    await _saveSubscriptionToServer(existing);
                    return;
                }

                const vapidRes = await fetch(`${WORKER_URL}/api/push/vapid-public-key`);
                if (!vapidRes.ok) return;
                const vapidData = await vapidRes.json();
                if (!vapidData.success || !vapidData.publicKey ||
                    vapidData.publicKey === 'VAPID_PUBLIC_KEY_NOT_CONFIGURED') {
                    console.warn('[Push] VAPID key not configured – server push unavailable');
                    return;
                }

                // Convert base64url-encoded VAPID public key to Uint8Array.
                // Padding ensures the string length is a multiple of 4, required by atob().
                // (e.g. length 43 → add 1 '='; length 42 → add 2 '=='; divisible by 4 → add 0)
                const rawKey = vapidData.publicKey;
                const padding = '='.repeat((4 - rawKey.length % 4) % 4);
                const b64 = (rawKey + padding).replace(/-/g, '+').replace(/_/g, '/');
                const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: raw
                });

                await _saveSubscriptionToServer(subscription);
            } catch (e) {
                console.warn('[Push] registerServerPush error:', e);
            }
        }

        async function _saveSubscriptionToServer(subscription) {
            try {
                const userId = localStorage.getItem('userId');
                if (!userId) return;
                const res = await fetch(`${WORKER_URL}/api/push/subscribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, subscription: subscription.toJSON() })
                });
                if (res.ok) {
                    console.log('[Push] Server push subscription saved for', userId);
                }
            } catch (e) {
                console.warn('[Push] _saveSubscriptionToServer error:', e);
            }
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

    // Scroll-to-top button visibility
    window.addEventListener('scroll', function() {
        const btn = document.getElementById('scrollTopBtn');
        if (btn) {
            if (window.scrollY > 400) {
                btn.classList.add('visible');
            } else {
                btn.classList.remove('visible');
            }
        }
    });

    // ── UI Zone Images ────────────────────────────────────────────────────────
    (function applyUIImages() {
        const WORKER = 'https://aidiet.radilov-k.workers.dev';
        getCachedUIImages(WORKER)
            .then(data => {
                const img = (data.images || {})['plan_greeting'];
                if (!img) return;
                const dayBanner = document.getElementById('dayBannerContainer');
                if (!dayBanner) return;
                dayBanner.style.backgroundImage = `url(${img})`;
                dayBanner.style.backgroundSize = 'cover';
                dayBanner.style.backgroundPosition = 'center';
                dayBanner.style.backgroundRepeat = 'no-repeat';
                if (!dayBanner.querySelector('.ui-img-overlay')) {
                    const overlay = document.createElement('div');
                    overlay.className = 'ui-img-overlay';
                    overlay.setAttribute('aria-hidden', 'true');
                    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                    overlay.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;background:' + (isDark ? 'rgba(10,26,26,0.60)' : 'rgba(240,253,250,0.60)') + ';';
                    dayBanner.insertBefore(overlay, dayBanner.firstChild);
                    new MutationObserver(() => {
                        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
                        overlay.style.background = dark ? 'rgba(10,26,26,0.60)' : 'rgba(240,253,250,0.60)';
                    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
                }
                Array.from(dayBanner.children).forEach(ch => {
                    if (!ch.classList.contains('ui-img-overlay')) ch.style.position = 'relative';
                });
            })
            .catch(() => {});
    })();
    // ── End UI Zone Images ─────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════════
    // GAMIFICATION MODULE — *game command activation
    // All data in localStorage; no backend except weekly summary prep
    // ═══════════════════════════════════════════════════════════════════════════
    (function() {
        var GAME_ENABLED_KEY       = 'gameEnabled';
        var GAME_DATA_KEY          = 'gameData';
        var GAME_WEEKLY_AI_KEY     = 'gameWeeklyAI';
        var FREE_MEAL_MIN_RATING   = 4;   // Suitability rating threshold: >=4 = correct free meal
        var JUNK_SUITABILITY_MAX   = 2;   // Suitability rating threshold: <=2 = junk/harmful food
        var JUNK_MAX_POINTS        = 20;  // Max engagement pts from junk/incorrect-meal component
        var JUNK_PENALTY_PER_MEAL  = 7;   // Engagement pts lost per junk or incorrect meal
        var _promptIntervalId      = null;

        // ── Helpers ──────────────────────────────────────────────────────────
        function zp(n) { return n < 10 ? '0' + n : '' + n; }
        function dateKey(d) {
            d = d || new Date();
            return d.getFullYear() + '-' + zp(d.getMonth()+1) + '-' + zp(d.getDate());
        }
        function getTodayKey()     { return dateKey(new Date()); }
        function getYesterdayKey() { var d = new Date(); d.setDate(d.getDate()-1); return dateKey(d); }

        // Map plan day number (1=Mon … 7=Sun) to actual calendar date string
        function getDateForPlanDay(planDay) {
            var now = new Date(); // single snapshot to avoid midnight boundary issues
            var jsDay = now.getDay(); // 0=Sun
            var todayPlanDay = jsDay === 0 ? 7 : jsDay;
            var offset = planDay - todayPlanDay;
            var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
            return dateKey(d);
        }
        // Return the date key for the plan day currently being viewed
        function getCurrentViewDayKey() {
            var planDay = window._gameCurrentPlanDay;
            if (!planDay) return getTodayKey();
            return getDateForPlanDay(planDay);
        }
        function isFutureDayKey(key) { return key > getTodayKey(); }
        function isPastDayKey(key)   { return key < getTodayKey(); }
        // Returns true when the day is more than 2 days in the past (edits are not allowed).
        function isAgeLocked(key) {
            if (key >= getTodayKey()) return false;
            var d = new Date();
            d.setDate(d.getDate() - 2);
            return key < dateKey(d);
        }

        // ── Meal unlock hours: check button only available after these hours ──────
        function getMealUnlockHour(mealType) {
            // Strip index suffix if present (e.g. "Хранене 1_2" → "Хранене 1")
            var base = mealType.replace(/_\d+$/, '');
            if (base === 'Хранене 1' || base === 'Закуска') return 6;
            if (base === 'Хранене 2' || base === 'Обяд')    return 12;
            if (base === 'Свободно хранене') return 12; // free meal replaces lunch slot
            if (base === 'Хранене 3' || base === 'Следобедна закуска' || base === 'Следобедна' || base === 'Десерт') return 14;
            if (base === 'Хранене 4' || base === 'Вечеря') return 18;
            if (base === 'Хранене 5' || base === 'Късна закуска') return 20;
            return 6; // default: available from early morning
        }

        function startPromptInterval() {
            if (_promptIntervalId) clearInterval(_promptIntervalId);
            _promptIntervalId = setInterval(function() {
                checkTimePrompts();
                // Re-evaluate time locks on all visible check buttons every minute
                _refreshTimeLocks();
            }, 60000);
        }

        // Periodically re-evaluate time locks so buttons unlock at the right hour
        function _refreshTimeLocks() {
            if (!isGameEnabled()) return;
            var container = document.getElementById('mealContainer');
            if (!container) return;
            var dayKey = getCurrentViewDayKey();
            if (isPastDayKey(dayKey)) return; // past days are always unlocked
            var currentHour = new Date().getHours();
            container.querySelectorAll('.meal-check-btn.locked').forEach(function(btn) {
                var card = btn.closest('.meal-card');
                if (!card) return;
                var mealType = card.getAttribute('data-meal-type') || '';
                if (!mealType) {
                    var typeEl = card.querySelector('.meal-type');
                    mealType = typeEl ? typeEl.textContent.replace(/\(.*\)/,'').trim() : '';
                }
                if (getMealUnlockHour(mealType) <= currentHour) {
                    btn.classList.remove('locked');
                    btn.title = '';
                    btn.setAttribute('aria-label', '\u041E\u0442\u0431\u0435\u043B\u0435\u0436\u0438 \u0445\u0440\u0430\u043D\u0435\u043D\u0435');
                }
            });
        }

        function isGameEnabled() { return localStorage.getItem(GAME_ENABLED_KEY) === 'true'; }
        function enableGame()    { localStorage.setItem(GAME_ENABLED_KEY, 'true'); }

        var _gameDataCache = null; // in-memory cache to avoid repeated JSON.parse
        function getGameData() {
            if (_gameDataCache) return _gameDataCache;
            try { _gameDataCache = JSON.parse(localStorage.getItem(GAME_DATA_KEY) || '{}'); }
            catch(e) { _gameDataCache = {}; }
            return _gameDataCache;
        }
        function saveGameData(d) { _gameDataCache = d; localStorage.setItem(GAME_DATA_KEY, JSON.stringify(d)); }
        // Invalidate cache when another tab or external code modifies the same key
        window.addEventListener('storage', function(e) {
            if (e.key === GAME_DATA_KEY) _gameDataCache = null;
        });

        function emptyRecord(key) {
            return { date: key, meals: {}, extraMeals: [], freeMealRatings: {},
                     morningCheck: null, eveningCheck: null, plannedCalories: null,
                     mealCalories: {}, dailyScore: null, missing: false };
        }
        function getRecord(key)       { var d = getGameData(); return d[key] || emptyRecord(key); }
        function saveRecord(key, rec) { var d = getGameData(); d[key] = rec; saveGameData(d); }
        function getTodayRecord()     { return getRecord(getTodayKey()); }
        function saveTodayRecord(rec) { saveRecord(getTodayKey(), rec); }

        function getUserName() {
            try { var p = JSON.parse(localStorage.getItem('userData') || '{}'); return p.name ? p.name.split(' ')[0] : null; }
            catch(e) { return null; }
        }

        // ── Typewriter ────────────────────────────────────────────────────────
        function typewriter(el, text, speed, cb) {
            el.textContent = '';
            el.classList.add('typing');
            var i = 0;
            function tick() {
                // Guard against the element being removed from the DOM mid-animation
                if (!document.contains(el)) { if (cb) cb(); return; }
                if (i < text.length) {
                    el.textContent += text[i++];
                    // Haptic: light buzz every 3rd character to reduce battery drain and
                    // avoid overwhelming the vibration motor on older Android devices.
                    if (i % 3 === 0 && typeof navigator !== 'undefined' && navigator.vibrate) {
                        navigator.vibrate(8);
                    }
                    setTimeout(tick, speed || 30);
                }
                else { el.classList.remove('typing'); if (cb) cb(); }
            }
            tick();
        }

        // ── Confetti ──────────────────────────────────────────────────────────
        function makeConfetti(container, count) {
            var colors = ['#0D9488','#fbbf24','#f87171','#818cf8','#34d399','#fb923c','#ec4899','#06b6d4','#a3e635'];
            for (var i = 0; i < count; i++) {
                var s = document.createElement('span');
                var c = colors[Math.floor(Math.random()*colors.length)];
                var sz = (5 + Math.random()*9);
                var shapeRoll = Math.random();
                var borderRadius = shapeRoll > 0.66 ? '50%' : shapeRoll > 0.33 ? '2px' : '0 50% 50% 50%';
                var rotate = Math.round(Math.random() * 360);
                s.style.cssText = 'left:' + (Math.random()*100) + '%;background:' + c +
                    ';width:' + sz + 'px;height:' + Math.round(sz * (0.5 + Math.random())) + 'px' +
                    ';border-radius:' + borderRadius +
                    ';transform:rotate(' + rotate + 'deg)' +
                    ';animation-duration:' + (1.2+Math.random()*2.4) + 's' +
                    ';animation-delay:' + (Math.random()*0.8) + 's' +
                    ';opacity:' + (0.75 + Math.random()*0.25);
                container.appendChild(s);
            }
        }

        // ── Scoring ───────────────────────────────────────────────────────────
        // Perfect day (5★) = 100% completion:
        //   • All planned meals done (free meals must be rated 4-5 to count)
        //   • Morning check: sleptWell = true
        //   • Evening check: waterIntake = true, activityLevel = 3, emotionalBalance = 3
        //   • No calorie excess >10% above plan
        //
        // Scoring (0–100 pts → 1–5 stars):
        //   Meals:        each planned meal = 10 pts (free meal: 4-5/5 → 10 pts; 0-3/5 → 0 pts + flag)
        //   Sleep:        sleptWell = true  → 10 pts
        //   Water:        waterIntake = true → 10 pts
        //   Activity:     1→0, 2→5, 3→10 pts
        //   Balance:      1→0, 2→5, 3→10 pts
        //   Calories:     used only as a 5★ blocker (no separate pts awarded)
        //
        // Denominator = (mealCount × 10) + 40 (wellness always contributes full 40 to denominator)
        //   Unanswered wellness questions contribute 0 earned pts but the denominator stays at 40.
        // Stars: 100%→5, 80-99%→4, 55-79%→3, 30-54%→2, 1-29%→1, 0%→null
        function calcDayScore(rec) {
            if (!rec) return { score:null, stars:'', label:'Без данни', junkCount:0,
                                incorrectMeals:0, excessCalories:false, calorieBalance:'balanced', engPct:0, calorieDelta:0 };

            // ── Meals ──────────────────────────────────────────────────────
            var meals = Object.keys(rec.meals || {});
            var mealPts = 0, mealMax = meals.length * 10;
            var incorrectMeals = 0;

            meals.forEach(function(m) {
                // Free meals are treated the same as any other planned meal: the check button
                // marks them done; no photo or rating is required.
                if (rec.meals[m] === true) mealPts += 10;
            });

            // ── Extra meals ────────────────────────────────────────────────
            var junkCount = 0;
            var extraCalSum = 0;
            var freeMealCalSum = 0; // calories from free meal replacements (treated as normal allowed)
            (rec.extraMeals || []).forEach(function(em) {
                // A meal is considered consumed when it has no toggle button (not added to plan)
                // or when its check button is checked (countCalories !== false).
                var isConsumed = !em.isAddedToPlan || em.countCalories !== false;
                // Free meal replacements are already penalised via incorrectMeals (from freeMealRatings).
                // Counting them here too would double-penalise the same meal.
                if (em.isJunk && isConsumed && !em.isFreeMealReplacement) junkCount++;
                if (em.isFreeMealReplacement) {
                    // Treat free meal calories as normal allowed (like lunch) — add to both
                    // consumed and planned so they don't distort the calorie balance.
                    freeMealCalSum += (em.calories || 0);
                } else if (em.isAddedToPlan && !em.countCalories) {
                    // This meal was added to the daily plan but the check button is unchecked —
                    // do not include its calories in the daily total.
                } else {
                    extraCalSum += (em.calories || 0);
                }
            });

            // ── Calorie balance ────────────────────────────────────────────
            // Flag surplus when completed planned meals + extra food exceeds the daily plan.
            // Flag deficit when completed planned meals are below plan AND user showed engagement.
            // Completed planned calories come from per-meal calorie data stored at check time.
            var mealCalMap = rec.mealCalories || {};
            var completedPlanCals = 0;
            Object.keys(rec.meals || {}).forEach(function(mt) {
                if (rec.meals[mt] === true && mealCalMap[mt]) {
                    completedPlanCals += mealCalMap[mt];
                }
            });
            var totalConsumed = completedPlanCals + extraCalSum + freeMealCalSum;
            // Free meal calories are treated as normal allowed (like lunch): expand the planned
            // target by the same amount so they don't distort the surplus/deficit balance.
            var planned = rec.plannedCalories ? (rec.plannedCalories + freeMealCalSum) : null;
            var excessCalories = false;
            var calorieBalance = 'balanced';
            var calorieDelta = 0; // positive = surplus kcal, negative = deficit kcal
            if (totalConsumed > 0 && planned && planned > 0) {
                var excessPct = (totalConsumed - planned) / planned;
                calorieDelta = Math.round(totalConsumed - planned);
                if (excessPct > 0.10)   { excessCalories = true; calorieBalance = 'surplus'; }
                else if (excessPct > 0) { calorieBalance = 'surplus'; }
                else if (excessPct < -0.10 && completedPlanCals > 0 && (rec.morningCheck || rec.eveningCheck)) {
                    // Deficit is only valid for completed days: past days, or today after 20:00
                    var recDate = rec.date || getTodayKey();
                    var dayIsDone = recDate < getTodayKey() || new Date().getHours() >= 20;
                    if (dayIsDone) calorieBalance = 'deficit';
                }
            } else if (extraCalSum > 0 && (!planned || planned === 0)) {
                // No target known: show surplus only when extra intake is meaningful (>50 kcal)
                calorieDelta = extraCalSum;
                if (extraCalSum > 200) { excessCalories = true; calorieBalance = 'surplus'; }
                else if (extraCalSum > 50) { calorieBalance = 'surplus'; }
            }

            // ── Wellness points ─────────────────────────────────────────────
            var sleepPts    = rec.morningCheck  ? (rec.morningCheck.sleptWell ? 10 : 0) : null;
            var waterPts    = rec.eveningCheck  ? (rec.eveningCheck.waterIntake ? 10 : 0) : null;
            var activityPts = rec.eveningCheck  ? ([0,0,5,10][rec.eveningCheck.activityLevel] || 0) : null;
            var balancePts  = rec.eveningCheck  ? ([0,0,5,10][rec.eveningCheck.emotionalBalance] || 0) : null;

            var wellnessEarned = (sleepPts || 0) + (waterPts || 0) + (activityPts || 0) + (balancePts || 0);
            // Always use the full 40-pt wellness denominator.
            // Wellness questions that have not been answered contribute 0 earned points but
            // the denominator stays at 40, preventing meals alone from inflating the score to 5★.
            var wellnessMax = 40;

            // ── 5-star blocker flags ────────────────────────────────────────
            var allMealsOk    = meals.length > 0 && meals.every(function(m) {
                return rec.meals[m] === true;
            });
            var badSleep       = rec.morningCheck  && rec.morningCheck.sleptWell === false;
            var badWater       = rec.eveningCheck  && rec.eveningCheck.waterIntake === false;
            var lowActivity    = rec.eveningCheck  && rec.eveningCheck.activityLevel === 1;
            var lowBalance     = rec.eveningCheck  && rec.eveningCheck.emotionalBalance === 1;
            var has5StarBlocker = !allMealsOk || incorrectMeals > 0 || excessCalories ||
                                  badSleep || badWater || lowActivity || lowBalance || junkCount > 0;

            // ── Engagement % (kept for backward compatibility) ──────────────
            var done     = meals.filter(function(m) {
                return rec.meals[m] === true;
            }).length;
            var mealEngPct = meals.length > 0 ? done / meals.length * 50 : 0;
            var mornEngPct = rec.morningCheck ? 15 : 0;
            var eveEngPct  = rec.eveningCheck ? 15 : 0;
            // junkPct is a "no-junk bonus" and only makes sense when the user has actually engaged.
            // Without at least one checked meal, check-in, or logged junk/incorrect meal the day
            // has zero activity and should show 0% — not a phantom 20% from the junk-avoidance bonus.
            var hasAnyEngagement = mealEngPct > 0 || mornEngPct > 0 || eveEngPct > 0 || junkCount > 0 || incorrectMeals > 0;
            var junkPct    = hasAnyEngagement ? Math.max(0, JUNK_MAX_POINTS - (junkCount + incorrectMeals) * JUNK_PENALTY_PER_MEAL) : 0; // engagement pts from junk/incorrect meal component
            var engPct     = Math.round(mealEngPct + mornEngPct + eveEngPct + junkPct);

            // ── Score calculation ───────────────────────────────────────────
            var totalMax    = mealMax + wellnessMax;
            var totalEarned = mealPts + wellnessEarned;
            var hasAnyActivity = totalEarned > 0 || meals.length > 0;

            var score = null;
            if (totalMax > 0 && hasAnyActivity) {
                var pct = totalEarned / totalMax;
                if      (pct >= 1.00 && !has5StarBlocker) score = 5;
                else if (pct >= 0.80) score = 4; // 5-star blockers cap the ceiling, not this band
                else if (pct >= 0.55) score = 3;
                else if (pct >= 0.30) score = 2;
                else if (pct >  0)    score = 1;
                // pct === 0 → no earned points yet → score stays null (no stars shown)
                // Hard enforce: 5-star blockers always cap at 4
                if (score === 5 && has5StarBlocker) score = 4;
                // Junk food or excess calories lower the cap further
                if (score !== null && score > 3 && (junkCount > 0 || excessCalories)) score = 3;
                if (score !== null && score > 2 && junkCount > 0 && excessCalories) score = 2;
            }

            // ── Stars HTML ──────────────────────────────────────────────────
            var starIcon = '<i class="fas fa-star" style="color:#fbbf24;font-size:0.85em"></i>';
            var stars = '';
            for (var _s = 0; _s < (score || 0); _s++) { stars += starIcon; }

            // ── Label ───────────────────────────────────────────────────────
            var label = '';
            if (score === null) {
                label = meals.length ? 'Без отбелязана активност' : 'Без данни';
            } else if (score === 5)  { label = 'Отличен резултат!'; }
            else if (score === 4)    { label = 'Много добре!'; }
            else if (score === 3)    { label = 'Добре'; }
            else if (score === 2)    { label = 'Може по-добре'; }
            else                     { label = 'Подобри се утре'; }

            return { score:score, stars:stars, label:label, junkCount:junkCount,
                     incorrectMeals:incorrectMeals, excessCalories:excessCalories,
                     calorieBalance:calorieBalance, engPct:engPct, calorieDelta:calorieDelta };
        }

        function recalcAndShowScore(key) {
            key = key || getCurrentViewDayKey();
            var rec = getRecord(key);
            // Capture previous score BEFORE recalculating to detect star gains
            var prevScore = (rec.dailyScore && rec.dailyScore.score) ? rec.dailyScore.score : 0;
            rec.dailyScore = calcDayScore(rec);
            saveRecord(key, rec);
            var viewKey = getCurrentViewDayKey();
            if (key === viewKey) renderDailyScoreCard(key, prevScore);
        }

        function renderDailyScoreCard(dayKey, prevScore) {
            dayKey = dayKey || getCurrentViewDayKey();
            var card = document.getElementById('dailyScoreCard');
            if (!card) {
                card = document.createElement('div');
                card.id = 'dailyScoreCard';
                card.setAttribute('role','status');
                card.setAttribute('aria-live','polite');
                card.onclick = function() { _shellNav('game-analytics.html'); };
                var container = document.getElementById('mealContainer');
                if (container && container.parentNode) container.parentNode.insertBefore(card, container);
            }
            // Future days: never show analysis
            if (isFutureDayKey(dayKey)) { card.style.display='none'; return; }

            // Check if there is any real data for this day
            var rawData = getGameData();
            var hasStoredRecord = !!rawData[dayKey];

            // Past day with no recorded data at all — show "missing data" notice
            if (isPastDayKey(dayKey) && !hasStoredRecord) {
                var dayNames2 = ['\u041D\u0434','\u041F\u043D','\u0412\u0442','\u0421\u0440','\u0427\u0442','\u041F\u0442','\u0421\u0431'];
                var dMissing = new Date(dayKey + 'T00:00:00');
                card.style.display = 'flex';
                card.style.background = 'linear-gradient(135deg, rgba(107,114,128,0.18) 0%, rgba(75,85,99,0.22) 100%)';
                card.style.boxShadow = 'none';
                card.innerHTML = '<div class="daily-score-info">' +
                        '<div class="daily-score-label" style="opacity:0.7">\u041E\u0446\u0435\u043D\u043A\u0430 \u0437\u0430 \u0434\u0435\u043D\u044F</div>' +
                        '<div class="daily-score-value" style="color:var(--text-gray)">\u041B\u0438\u043F\u0441\u0432\u0430\u0442 \u0434\u0430\u043D\u043D\u0438</div>' +
                        '<div class="daily-score-stars" style="font-size:0.75rem;color:var(--text-gray);opacity:0.72">\u041D\u0435 \u0435 \u043E\u0442\u0431\u0435\u043B\u044F\u0437\u0430\u043D\u0430 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442</div>' +
                    '</div>';
                return;
            }

            var rec = getRecord(dayKey);
            if (!rec || !rec.dailyScore) { card.style.display='none'; return; }
            var ds = rec.dailyScore;
            card.style.display = 'flex';
            card.style.background = '';
            card.style.boxShadow = '';
            var esc = typeof escapeHtmlWithBreaks === 'function' ? escapeHtmlWithBreaks : function(s){return s;};
            // Show score label only after the day is complete:
            // — past day: always show
            // — today: only after the evening check is answered (or after midnight the score becomes final)
            var isViewingToday = (dayKey === getTodayKey());
            var showLabel = ds.score !== null && (!isViewingToday || rec.eveningCheck !== null);
            // Build warnings list
            var extraCals = (rec.extraMeals || []).reduce(function(s,em) {
                if (em.isFreeMealReplacement) return s;
                if (em.isAddedToPlan && !em.countCalories) return s;
                return s + (em.calories || 0);
            }, 0);
            var mCalMap = rec.mealCalories || {};
            var completedCals = Object.keys(rec.meals || {}).reduce(function(s, mt) {
                return (rec.meals[mt] === true && mCalMap[mt]) ? s + mCalMap[mt] : s;
            }, 0);
            var planCals = rec.plannedCalories || 0;
            var totalCals = completedCals + extraCals;
            var warningsList = [];
            if (ds.calorieBalance === 'surplus' && totalCals > 0) {
                var surplusKcal = planCals > 0 ? Math.round(totalCals - planCals) : extraCals;
                if (surplusKcal > 0) warningsList.push('<i class="fas fa-exclamation-triangle" style="color:#fde68a"></i> \u0417\u0430\u0432\u0438\u0448\u0435\u043D \u043F\u0440\u0438\u0435\u043C \u043D\u0430 \u043A\u0430\u043B\u043E\u0440\u0438\u0438: +' + surplusKcal + ' kcal \u043D\u0430\u0434 \u043F\u043B\u0430\u043D\u0430');
            } else if (ds.calorieBalance === 'deficit' && planCals > 0 && totalCals > 0) {
                var deficitKcal = Math.round(planCals - totalCals);
                if (deficitKcal > 0) warningsList.push('<i class="fas fa-exclamation-triangle" style="color:#fde68a"></i> \u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u044A\u0447\u0435\u043D \u043F\u0440\u0438\u0435\u043C \u043D\u0430 \u043A\u0430\u043B\u043E\u0440\u0438\u0438: \u2212' + deficitKcal + ' kcal \u043F\u043E\u0434 \u043F\u043B\u0430\u043D\u0430');
            }
            if (ds.incorrectMeals > 0) warningsList.push('<i class="fas fa-exclamation-triangle" style="color:#fde68a"></i> ' + ds.incorrectMeals + ' \u043D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u043D\u043E \u0445\u0440\u0430\u043D\u0435\u043D\u0435');
            if (ds.junkCount > 0) warningsList.push('<i class="fas fa-exclamation-triangle" style="color:#fde68a"></i> ' + ds.junkCount + ' \u0432\u0440\u0435\u0434\u043D\u0438 \u0445\u0440\u0430\u043D\u0438');
            if (rec.morningCheck && rec.morningCheck.sleptWell === false) warningsList.push('<i class="fas fa-exclamation-triangle" style="color:#fde68a"></i> \u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u044A\u0447\u043D\u043E \u0441\u044A\u043D');
            if (rec.eveningCheck && rec.eveningCheck.waterIntake === false) warningsList.push('<i class="fas fa-exclamation-triangle" style="color:#fde68a"></i> \u041B\u043E\u0448\u0430 \u0445\u0438\u0434\u0440\u0430\u0442\u0430\u0446\u0438\u044F');
            var warningsBadge = warningsList.length > 0
                ? '<div class="daily-warnings">' + warningsList.map(function(w) { return '<div class="daily-warning-item">' + w + '</div>'; }).join('') + '</div>'
                : '';
            var progPct = Math.max(0, Math.min(100, ds.engPct || 0));
            // Read previously rendered pct so we can avoid animating from 0 on re-renders
            var NO_PREV_PCT = -1;
            var prevProgPct = parseFloat(card.getAttribute('data-prog-pct') || NO_PREV_PCT);
            card.setAttribute('data-prog-pct', progPct);
            var streak = (dayKey === getTodayKey()) ? calcStreak() : 0;
            // Animate streak badge only when the streak value increases
            var prevStreak = parseInt(card.getAttribute('data-prev-streak') || '0', 10);
            var streakIsNew = streak > prevStreak;
            card.setAttribute('data-prev-streak', streak >= 2 ? streak : '0');
            var streakBadge = streak >= 2
                ? '<div class="daily-streak-badge' + (streakIsNew ? ' streak-badge-new' : '') + '"><i class="fas fa-fire" style="font-size:0.9em"></i> ' + streak + ' \u0434\u043D\u0438 \u043F\u043E\u0440\u0435\u0434</div>'
                : '';
            // Build stars: stagger-pop each icon when a new tier is reached
            var STAR_STAGGER_DELAY_MS = 55;
            var newScore = ds.score || 0;
            var starsHtml;
            if (prevScore !== undefined && newScore > 0 && newScore > prevScore) {
                starsHtml = '';
                for (var si = 0; si < newScore; si++) {
                    starsHtml += '<i class="fas fa-star ds-star-item" style="color:#fbbf24;font-size:0.85em;animation-delay:' + (si * STAR_STAGGER_DELAY_MS) + 'ms"></i>';
                }
            } else {
                starsHtml = ds.stars;
            }
            card.innerHTML = '<div class="daily-score-info">' +
                    '<div class="daily-score-label">\u041E\u0446\u0435\u043D\u043A\u0430 \u0437\u0430 \u0434\u0435\u043D\u044F</div>' +
                    (showLabel ? '<div class="daily-score-value">' + esc(ds.label) + '</div>' : '') +
                    '<div class="daily-score-stars">' + starsHtml + '</div>' +
                    warningsBadge +
                    '<div class="daily-score-progress"><div class="daily-score-progress-fill" style="width:' + (prevProgPct >= 0 ? prevProgPct : 0) + '%"></div></div>' +
                    streakBadge +
                '</div>';
            // Animate progress bar: skip transition if pct didn't change
            (function(pct, changed) {
                if (!changed) {
                    // Already at correct width; set directly without transition to keep it crisp
                    var fill = card.querySelector('.daily-score-progress-fill');
                    if (fill) fill.style.width = pct + '%';
                    return;
                }
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                        var fill = card.querySelector('.daily-score-progress-fill');
                        if (fill) fill.style.width = pct + '%';
                    });
                });
            })(progPct, progPct !== prevProgPct);

            // ── Star celebration animation ──────────────────────────────────
            // Trigger animation only when stars increase (prevScore is passed from recalcAndShowScore)
            if (prevScore !== undefined && newScore > 0 && newScore > prevScore) {
                triggerStarCelebration(card, newScore);
            }
        }

        // ── Star celebration ──────────────────────────────────────────────────
        function triggerStarCelebration(card, starCount) {
            // Remove previous animation classes
            card.classList.remove('sc-anim-1','sc-anim-2','sc-anim-3','sc-anim-4','sc-anim-5');
            // Force reflow so animation restarts
            void card.offsetWidth;
            card.classList.add('sc-anim-' + starCount);
            // Remove class after animation ends to allow re-triggering
            setTimeout(function() { card.classList.remove('sc-anim-' + starCount); }, 1200);

            // Haptic feedback: escalating pattern
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                if      (starCount === 1) navigator.vibrate(60);
                else if (starCount === 2) navigator.vibrate([60, 40, 80]);
                else if (starCount === 3) navigator.vibrate([80, 40, 80, 40, 120]);
                else if (starCount === 4) navigator.vibrate([100, 50, 100, 50, 150, 50, 150]);
                else                     navigator.vibrate([150, 60, 150, 60, 200, 60, 200, 60, 300]);
            }

            // Flying stars burst overlay
            _triggerStarBurst(card, starCount);

            // Level 5: show screen glow + flash banner
            if (starCount === 5) {
                setTimeout(function() {
                    var glow = document.createElement('div');
                    glow.className = 'star5-screen-glow';
                    document.body.appendChild(glow);
                    setTimeout(function() { glow.remove(); }, 2000);
                    var flash = document.createElement('div');
                    flash.className = 'excellent-day-flash';
                    var fiveStars = Array(5).fill('<i class="fas fa-star" style="color:#fbbf24"></i>').join('');
                    flash.innerHTML = '<div style="font-size:1.4rem;margin-bottom:4px;letter-spacing:2px">' + fiveStars + '</div>' +
                        '<div>Отличен резултат!</div>' +
                        '<div style="font-size:0.8rem;font-weight:500;margin-top:4px;opacity:0.7">Всичко изпълнено перфектно \u2713</div>';
                    document.body.appendChild(flash);
                    setTimeout(function() { flash.remove(); }, 2500);
                }, 150);
            }
        }

        function _triggerStarBurst(card, starCount) {
            // Remove any lingering overlays from rapid star gains before adding a new one
            document.querySelectorAll('.star-burst-overlay').forEach(function(el) { el.remove(); });
            var overlay = document.createElement('div');
            overlay.className = 'star-burst-overlay';
            document.body.appendChild(overlay);

            // Determine origin point from card position
            var rect = card.getBoundingClientRect();
            var originX = rect.left + rect.width / 2;
            var originY = rect.top + rect.height / 2;

            // Number of flying elements and sizes scale with star count
            var count = [0, 6, 10, 16, 24, 36][starCount] || 8;

            for (var i = 0; i < count; i++) {
                (function(idx) {
                    var el = document.createElement('div');
                    el.className = 'sb-star' + (starCount === 5 && idx < 6 ? ' big' : '');
                    el.innerHTML = '<i class="fas fa-star" style="color:#fbbf24"></i>';

                    // Random angle and distance
                    var angle = (Math.random() * 360) * Math.PI / 180;
                    var dist  = 80 + Math.random() * (starCount * 40 + 60);
                    var tx    = Math.round(Math.cos(angle) * dist);
                    var ty    = Math.round(Math.sin(angle) * dist - dist * 0.3); // slightly upward bias
                    var rot   = Math.round(Math.random() * 720 - 360);
                    var delay = idx * (starCount >= 4 ? 35 : 55);
                    var dur   = 0.9 + Math.random() * 0.5;

                    el.style.cssText = 'left:' + originX + 'px;top:' + originY + 'px;' +
                        '--tx:' + tx + 'px;--ty:' + ty + 'px;--rot:' + rot + 'deg;' +
                        'animation-duration:' + dur + 's;animation-delay:' + delay + 'ms;';
                    overlay.appendChild(el);
                })(i);
            }

            // Remove overlay after all animations finish
            var totalDuration = count * (starCount >= 4 ? 35 : 55) + 1600;
            setTimeout(function() { overlay.remove(); }, totalDuration);
        }

        // ── Meal check micro-burst (ripple + floating pts) ────────────────────
        function _triggerMealCheckBurst(btn, card, isDone, isJunk) {
            if (!isDone) return; // only on check, not uncheck
            var btnRect = btn.getBoundingClientRect();
            // Use fixed positioning to avoid touching the card's position style
            var ripple = document.createElement('div');
            ripple.className = 'meal-check-ripple';
            var JUNK_RIPPLE_COLOR    = 'rgba(245,158,11,0.45)';
            var SUCCESS_RIPPLE_COLOR = 'rgba(16,185,129,0.45)';
            var rippleColor = isJunk ? JUNK_RIPPLE_COLOR : SUCCESS_RIPPLE_COLOR;
            ripple.style.cssText = 'left:' + Math.round(btnRect.left) + 'px;top:' + Math.round(btnRect.top) + 'px;background:' + rippleColor + ';';
            document.body.appendChild(ripple);
            setTimeout(function() { ripple.remove(); }, 600);
            // Floating "+10 т" label
            var fl = document.createElement('div');
            fl.className = 'score-pts-float';
            fl.textContent = '+10 т';
            fl.style.cssText = 'left:' + Math.round(btnRect.left + btnRect.width / 2 - 20) + 'px;top:' + Math.round(btnRect.top - 2) + 'px;';
            document.body.appendChild(fl);
            setTimeout(function() { fl.remove(); }, 1300);
        }

        // ── Streak: consecutive days with ≥3 stars (includes today if scored) ─
        function calcStreak() {
            var allData = getGameData();
            var streak = 0;
            var d = new Date();
            for (var i = 0; i < 30; i++) {
                var k = dateKey(d);
                var r = allData[k];
                if (!r || !r.dailyScore || (r.dailyScore.score || 0) < 3) break;
                streak++;
                d.setDate(d.getDate() - 1);
            }
            return streak;
        }

        // ── Meal checkmarks ───────────────────────────────────────────────────
        function enhanceMealCards() {
            if (!isGameEnabled()) return;
            var container = document.getElementById('mealContainer');
            if (!container) return;
            var dayKey = getCurrentViewDayKey();

            // Future days: remove any leftover check buttons, hide score card
            if (isFutureDayKey(dayKey)) {
                container.querySelectorAll('.meal-check-btn').forEach(function(b){ b.remove(); });
                var sc = document.getElementById('dailyScoreCard');
                if (sc) sc.style.display = 'none';
                return;
            }

            var rec = getRecord(dayKey);
            if (!rec.freeMealRatings) rec.freeMealRatings = {}; // backward compat: preserve existing field in stored records
            if (!rec.mealCalories) rec.mealCalories = {};
            var mealsInitialized = false;

            // Compute planned calorie total from rendered meal cards (best effort)
            // Also capture per-meal calorie data for accurate completed-meal calorie tracking
            // Only count planned meals (not added-meal-cards which lack data-meal-calories)
            var plannedCals = 0;
            container.querySelectorAll('.meal-card:not(.added-meal-card)').forEach(function(card) {
                var calEl = card.querySelector('[data-meal-calories]');
                if (calEl) { plannedCals += parseFloat(calEl.getAttribute('data-meal-calories')) || 0; }
            });
            if (plannedCals > 0 && (!rec.plannedCalories || (rec.plannedCalories > 0 && Math.abs(rec.plannedCalories - plannedCals) > rec.plannedCalories * 0.05))) {
                rec.plannedCalories = Math.round(plannedCals);
                mealsInitialized = true;
            }

            var seenMealTypes = {};
            // Skip added-meal-card elements: they represent extra food already tracked
            // via extraMeals from logExtraFood. Including them as planned meal slots
            // would inflate the denominator and cause double-counting issues.
            container.querySelectorAll('.meal-card:not([data-ge]):not(.added-meal-card)').forEach(function(card) {
                var mealType = card.getAttribute('data-meal-type') || '';
                if (!mealType) {
                    var typeEl = card.querySelector('.meal-type');
                    mealType = typeEl ? typeEl.textContent.replace(/\(.*\)/,'').trim() : '';
                }
                if (!mealType) return;
                card.setAttribute('data-ge','1');
                var isFreeMeal = card.classList.contains('free-day');

                // Generate a unique storage key per card to avoid collisions when multiple
                // cards share the same meal type label (e.g. two "Вечеря" entries).
                // The first occurrence keeps the plain type name for backward-compatibility.
                seenMealTypes[mealType] = (seenMealTypes[mealType] || 0) + 1;
                var mealKey = seenMealTypes[mealType] === 1 ? mealType : mealType + '_' + seenMealTypes[mealType];

                // Store per-meal calories for calorie-balance calculation
                // Update only when the value changes to reflect plan regeneration
                var calAttr = card.getAttribute('data-meal-calories');
                if (calAttr) {
                    var calVal = Math.round(parseFloat(calAttr) || 0);
                    if (calVal > 0 && rec.mealCalories[mealKey] !== calVal) {
                        rec.mealCalories[mealKey] = calVal;
                        mealsInitialized = true;
                    }
                }

                // Ensure all planned meals are present in the record so calcDayScore knows the total
                if (!(mealKey in rec.meals)) {
                    rec.meals[mealKey] = false;
                    mealsInitialized = true;
                }
                var isDone = rec.meals[mealKey] === true;
                var checkBtn = document.createElement('button');

                // ── Time-based lock: meal check only available after its designated hour ──
                var unlockHour = getMealUnlockHour(mealType);
                var currentHour = new Date().getHours();
                var isTimeLocked = !isPastDayKey(dayKey) && currentHour < unlockHour;
                var isAgeLockedDay = isAgeLocked(dayKey);
                checkBtn.className = 'meal-check-btn' + (isDone ? ' done' : '') + ((isTimeLocked || isAgeLockedDay) ? ' locked' : '');
                if (isAgeLockedDay) {
                    checkBtn.title = 'Не може да се редактира ден, по-стар от 2 дни';
                    checkBtn.setAttribute('aria-label', 'Отбелязването е заключено за дни по-стари от 2 дни');
                } else if (isTimeLocked) {
                    checkBtn.title = 'Ще се отключи по-късно';
                    checkBtn.setAttribute('aria-label', 'Отбелязването ще се отключи по-късно');
                }

                checkBtn.innerHTML = '<i class="fas fa-check"></i>';
                if (!isTimeLocked && !isAgeLockedDay) checkBtn.setAttribute('aria-label','\u041E\u0442\u0431\u0435\u043B\u0435\u0436\u0438 \u0445\u0440\u0430\u043D\u0435\u043D\u0435');
                checkBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    // Block edits for days older than 2 days
                    if (isAgeLocked(dayKey)) return;
                    // Re-check time lock at click time (button could have been rendered earlier)
                    var clickHour = new Date().getHours();
                    if (!isPastDayKey(dayKey) && clickHour < getMealUnlockHour(mealType)) return;
                    var r = getRecord(dayKey);
                    if (!r.mealCalories) r.mealCalories = {};
                    r.meals[mealKey] = !r.meals[mealKey];
                    // Sync per-meal calories from DOM at check time
                    var cAttr = card.getAttribute('data-meal-calories');
                    if (cAttr) {
                        var cVal = Math.round(parseFloat(cAttr) || 0);
                        if (cVal > 0) r.mealCalories[mealKey] = cVal;
                    }
                    saveRecord(dayKey, r);
                    checkBtn.classList.toggle('done', r.meals[mealKey]);
                    if (!calcDayScore(r).excessCalories) {
                        var mealIsJunk = card.getAttribute('data-incorrect-meal') === '1';
                        _triggerMealCheckBurst(checkBtn, card, r.meals[mealKey], mealIsJunk);
                    }
                    recalcAndShowScore(dayKey);
                });
                card.appendChild(checkBtn);
            });
            if (mealsInitialized) saveRecord(dayKey, rec);
            recalcAndShowScore(dayKey);

            // ── Photo-added meal check buttons ───────────────────────────────
            // Give each added-meal-card a toggleable consumed button.
            // These do NOT count toward the day-score denominator — they are
            // purely for personal tracking of photographed / advance-planned meals.
            var addedDateKey = dayKey; // same date-string format as addedMeals_DATEKEY

            // ── Sync addedMeals.consumed → extraMeals.countCalories on every render ──
            (function() {
                var syncList = [];
                try { syncList = JSON.parse(localStorage.getItem('addedMeals_' + addedDateKey) || '[]'); } catch(e) {}
                if (!syncList.length) return;
                var syncRec = getRecord(addedDateKey);
                if (!syncRec.extraMeals || !syncRec.extraMeals.length) return;
                var changed = false;
                syncList.forEach(function(am) {
                    var shouldCount = (am.consumed !== false);
                    for (var i = 0; i < syncRec.extraMeals.length; i++) {
                        var em = syncRec.extraMeals[i];
                        var matched = am.planId ? em.planId === am.planId
                            : (!em.planId && !em.isFreeMealReplacement &&
                               em.name === am.name && Math.round(em.calories || 0) === Math.round(am.calories || 0));
                        if (matched) {
                            if (!em.isAddedToPlan) { em.isAddedToPlan = true; changed = true; }
                            if (em.countCalories !== shouldCount) { em.countCalories = shouldCount; changed = true; }
                            break;
                        }
                    }
                });
                if (changed) {
                    saveRecord(addedDateKey, syncRec);
                    recalcAndShowScore(addedDateKey);
                }
            })();

            container.querySelectorAll('.added-meal-card:not([data-ge-added])').forEach(function(addedCard) {
                addedCard.setAttribute('data-ge-added', '1');
                var idx = parseInt(addedCard.getAttribute('data-added-idx'), 10);
                if (isNaN(idx)) return;
                var storedList = [];
                try { storedList = JSON.parse(localStorage.getItem('addedMeals_' + addedDateKey) || '[]'); } catch(e) {}
                var addedMeal = storedList[idx];
                if (!addedMeal) return;

                // Backward-compat: entries without consumed property are treated as consumed.
                var isDoneAdded = addedMeal.consumed !== false;
                var mealTypeAdded = addedMeal.type || '';

                // Only apply time-lock for recognised meal types (not intermediate/unknown).
                var KNOWN_TYPES = ['Хранене 1','Хранене 2','Хранене 3','Хранене 4','Хранене 5','Свободно хранене',
                                   'Закуска','Обяд','Следобедна закуска','Следобедна','Десерт','Вечеря'];
                var isKnownType = KNOWN_TYPES.indexOf(mealTypeAdded) >= 0;
                var unlockHAdded = isKnownType ? getMealUnlockHour(mealTypeAdded) : -1;
                var isAgeLockedAdded = isAgeLocked(dayKey);
                var isLockedAdded = isAgeLockedAdded || (isKnownType && !isPastDayKey(dayKey) && new Date().getHours() < unlockHAdded);

                var addedCheckBtn = document.createElement('button');
                addedCheckBtn.className = 'meal-check-btn' + (isDoneAdded ? ' done' : '') + (isLockedAdded ? ' locked' : '');
                addedCheckBtn.innerHTML = '<i class="fas fa-check"></i>';
                if (isAgeLockedAdded) {
                    addedCheckBtn.title = 'Не може да се редактира ден, по-стар от 2 дни';
                    addedCheckBtn.setAttribute('aria-label', 'Отбелязването е заключено за дни по-стари от 2 дни');
                } else if (isLockedAdded) {
                    addedCheckBtn.title = 'Ще се отключи по-късно';
                    addedCheckBtn.setAttribute('aria-label', 'Отбелязването ще се отключи по-късно');
                } else {
                    addedCheckBtn.setAttribute('aria-label', 'Отбележи хранене');
                }

                (function(cardIdx, btn, mType, knownType) {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        // Block edits for days older than 2 days
                        if (isAgeLocked(dayKey)) return;
                        var clickH = new Date().getHours();
                        if (!isPastDayKey(dayKey) && knownType && clickH < getMealUnlockHour(mType)) return;
                        var arr = [];
                        try { arr = JSON.parse(localStorage.getItem('addedMeals_' + addedDateKey) || '[]'); } catch(e) {}
                        if (arr[cardIdx]) {
                            arr[cardIdx].consumed = (arr[cardIdx].consumed === false);
                            localStorage.setItem('addedMeals_' + addedDateKey, JSON.stringify(arr));
                            btn.classList.toggle('done', arr[cardIdx].consumed !== false);

                            // Sync the consumed state to the extraMeals game record.
                            var updMeal = arr[cardIdx];
                            var countVal = (updMeal.consumed !== false);
                            var dRec = getRecord(addedDateKey);
                            if (!dRec.extraMeals) dRec.extraMeals = [];
                            var matchFound = false;
                            for (var j = 0; j < dRec.extraMeals.length; j++) {
                                var em = dRec.extraMeals[j];
                                var matched = updMeal.planId ? em.planId === updMeal.planId
                                    : (!em.planId && !em.isFreeMealReplacement &&
                                       em.name === updMeal.name && Math.round(em.calories || 0) === Math.round(updMeal.calories || 0));
                                if (matched) {
                                    em.isAddedToPlan = true;
                                    em.countCalories = countVal;
                                    matchFound = true;
                                    break;
                                }
                            }
                            if (!matchFound && (updMeal.calories || 0) > 0) {
                                dRec.extraMeals.push({
                                    name: updMeal.name || 'Добавено хранене',
                                    calories: Math.round(updMeal.calories || 0),
                                    isJunk: !!(updMeal.suitability && typeof updMeal.suitability.score === 'number' && updMeal.suitability.score <= JUNK_SUITABILITY_MAX),
                                    isFreeMealReplacement: false,
                                    isAddedToPlan: true,
                                    planId: updMeal.planId,
                                    countCalories: countVal,
                                    mealContext: updMeal.type || '',
                                    ts: updMeal.ts || new Date().toISOString()
                                });
                            }
                            saveRecord(addedDateKey, dRec);
                            if (!calcDayScore(dRec).excessCalories) {
                                var addedIsJunk = !!(updMeal.suitability && typeof updMeal.suitability.score === 'number' && updMeal.suitability.score <= JUNK_SUITABILITY_MAX);
                                _triggerMealCheckBurst(btn, btn.closest('.meal-card') || btn.parentElement, arr[cardIdx].consumed !== false, addedIsJunk);
                            }
                            recalcAndShowScore(addedDateKey);
                        }
                    });
                })(idx, addedCheckBtn, mealTypeAdded, isKnownType);

                addedCard.appendChild(addedCheckBtn);
            });
        }

        // ── Extra food logging ────────────────────────────────────────────────
        // mealContext: the meal slot name (e.g. 'Обяд', 'Вечеря', etc.)
        function logExtraFood(name, calories, suitabilityScore, mealContext) {
            if (!isGameEnabled()) return;
            var rec = getTodayRecord();
            var isJunk = (suitabilityScore != null && suitabilityScore <= JUNK_SUITABILITY_MAX);
            // Ensure freeMealRatings object exists (backward compat with stored records)
            if (!rec.freeMealRatings) rec.freeMealRatings = {};

            // All logged food is treated as regular extra food — free meals are now handled
            // via the normal check button and no longer require photo analysis.
            rec.extraMeals.push({ name: name || 'Допълнително хранене',
                calories: Math.round(calories || 0), isJunk: isJunk,
                isFreeMealReplacement: false,
                mealContext: mealContext || '', ts: new Date().toISOString() });
            saveTodayRecord(rec);
            recalcAndShowScore();
        }

        // ── Bubble UI ─────────────────────────────────────────────────────────
        var YES_NO = [
            { label:'Да', icon:'<i class="fas fa-check" style="color:#10b981"></i>', value:true,  cls:'yes' },
            { label:'Не', icon:'<i class="fas fa-xmark" style="color:#ef4444"></i>', value:false, cls:'no'  }
        ];
        // Reversed order for hydration question (Не left, Да right per UX spec)
        var NO_YES = [
            { label:'Не', icon:'<i class="fas fa-xmark" style="color:#ef4444"></i>', value:false, cls:'no'  },
            { label:'Да', icon:'<i class="fas fa-check" style="color:#10b981"></i>', value:true,  cls:'yes' }
        ];
        var starI = '<i class="fas fa-star" style="color:#fbbf24;font-size:0.9em"></i>';
        // Context-specific answer arrays for 3-option questions
        var ACTIVITY_1_3 = [
            { label:'Ниска',   icons:starI,               value:1, stars:true },
            { label:'Умерена', icons:starI+starI,         value:2, stars:true },
            { label:'Висока',  icons:starI+starI+starI,   value:3, stars:true }
        ];
        var BALANCE_1_3 = [
            { label:'Напрегнат',  icons:starI,               value:1, stars:true },
            { label:'Спокоен',    icons:starI+starI,         value:2, stars:true },
            { label:'Позитивен',  icons:starI+starI+starI,   value:3, stars:true }
        ];

        var _fabLowerTimer = null;
        var _queueDepth    = 0; // incremented for each active runQueue; FAB stays raised while > 0
        var _openPromptPending = false; // prevents double-scheduling of checkOpenAppPrompts
        var _bubbleSeq = 0; // cancels delayed bubble renders when prompts change quickly
        // Delay must exceed the longest inter-question pause (350–400 ms) so that
        // a chained showBubble call (in the queue) fires before the timer and can
        // cancel the lower animation — keeping the FAB raised throughout the queue.
        var FAB_LOWER_DELAY = 500;

        function _scheduleFabLower() {
            var fab = document.querySelector('.fab-chat');
            if (fab) {
                if (_fabLowerTimer) clearTimeout(_fabLowerTimer);
                _fabLowerTimer = setTimeout(function(){
                    fab.classList.remove('fab-raised');
                    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'GAME_PROMPT_STATE', active: false }, '*'); } catch(_) {}
                    _fabLowerTimer = null;
                }, FAB_LOWER_DELAY);
            }
        }

        function removeBubble() {
            _bubbleSeq++;
            var o=document.getElementById('gameBubble'); if(o) o.remove();
            // Keep FAB raised while a question queue is still running
            if (_queueDepth > 0) return;
            _scheduleFabLower();
        }

        function showBubble(question, answers, onAnswer, opts) {
            opts = opts || {};
            var seq = ++_bubbleSeq;
            // Cancel pending lower animation — new question is coming
            if (_fabLowerTimer) { clearTimeout(_fabLowerTimer); _fabLowerTimer = null; }

            var fab = document.querySelector('.fab-chat');
            var wasRaised = fab && fab.classList.contains('fab-raised');
            if (fab) {
                fab.classList.add('fab-raised', 'game-prompt');
                try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'GAME_PROMPT_STATE', active: true }, '*'); } catch(_) {}
                setTimeout(function(){ fab.classList.remove('game-prompt'); }, 2600);
            }

            var existing = document.getElementById('gameBubble');

            // Helper: populate answer buttons into a container
            function fillAnswers(ansWrap) {
                ansWrap.innerHTML = '';
                var isStars = answers.length === 3 && answers[0].stars;
                if (isStars) {
                    var starsRow = document.createElement('div');
                    starsRow.className = 'game-stars-wrap';
                    answers.forEach(function(a) {
                        var btn = document.createElement('button');
                        btn.className = 'game-star-btn';
                        btn.innerHTML = '<span class="star-icons">'+a.icons+'</span><span class="star-label">'+a.label+'</span>';
                        btn.addEventListener('click', function(){ onAnswer(a.value); removeBubble(); });
                        starsRow.appendChild(btn);
                    });
                    ansWrap.appendChild(starsRow);
                } else {
                    answers.forEach(function(a) {
                        var btn = document.createElement('button');
                        btn.className = 'game-answer-btn ' + (a.cls||'yes');
                        btn.innerHTML = (a.icon?'<span>'+a.icon+'</span>':'') + '<span>'+a.label+'</span>';
                        btn.addEventListener('click', function(){ onAnswer(a.value); removeBubble(); });
                        ansWrap.appendChild(btn);
                    });
                }
            }

            // If FAB is already raised and a bubble is visible → update content in-place (no flicker)
            if (existing && wasRaised) {
                var grEl = existing.querySelector('.game-bubble-greeting');
                var qEl  = existing.querySelector('.game-bubble-q');
                var awEl = existing.querySelector('.game-bubble-answers');
                if (grEl && qEl && awEl) {
                    var name = getUserName();
                    grEl.textContent = opts.greeting ? opts.greeting :
                                       (opts.showName && name) ? 'Здравейте, '+name+'!' : 'AI Асистент';
                    awEl.classList.remove('visible');
                    fillAnswers(awEl);
                    typewriter(qEl, question, 32, function() {
                        setTimeout(function(){ awEl.classList.add('visible'); }, 120);
                    });
                    return;
                }
            }

            // Remove existing bubble (fresh start or no existing bubble)
            if (existing) existing.remove();

            // If FAB wasn't already raised, wait for the raise animation to complete
            // before showing the bubble (gives the animated-upward effect).
            // 440ms = 400ms CSS transition duration + 40ms buffer for smooth UX.
            var raiseDelay = (!wasRaised && fab) ? 440 : 0;

            setTimeout(function() {
                if (seq !== _bubbleSeq) return;
                var bubble = document.createElement('div');
                bubble.id = 'gameBubble';
                bubble.className = 'game-bubble';
                // If the FAB is currently raised to top, position the bubble below it
                var fabForPos = document.querySelector('.fab-chat');
                if (fabForPos && fabForPos.classList.contains('fab-raised')) {
                    bubble.classList.add('game-bubble--top');
                }

                // Header
                var hdr = document.createElement('div');
                hdr.className = 'game-bubble-header';
                var av = document.createElement('div');
                av.className = 'game-bubble-avatar';
                av.innerHTML = '<i class="fas fa-robot"></i>';
                var gr = document.createElement('div');
                gr.className = 'game-bubble-greeting';
                var name = getUserName();
                gr.textContent = opts.greeting ? opts.greeting :
                                 (opts.showName && name) ? 'Здравейте, '+name+'!' :
                                 'AI Асистент';
                hdr.appendChild(av); hdr.appendChild(gr);

                // Body
                var body = document.createElement('div');
                body.className = 'game-bubble-body';
                var qDiv = document.createElement('div');
                qDiv.className = 'game-bubble-q';
                var ansWrap = document.createElement('div');
                ansWrap.className = 'game-bubble-answers';

                fillAnswers(ansWrap);

                body.appendChild(qDiv);
                body.appendChild(ansWrap);
                bubble.appendChild(hdr);
                bubble.appendChild(body);
                document.body.appendChild(bubble);

                // Typewriter then reveal buttons
                typewriter(qDiv, question, 32, function() {
                    setTimeout(function(){ ansWrap.classList.add('visible'); }, 120);
                });
            }, raiseDelay);
        }

        // ── Morning / Evening questions ───────────────────────────────────────
        function getPromptDayMeta(recordKey) {
            if (recordKey === getTodayKey()) {
                return { prefix:'', greetingMorning:undefined, greetingEvening:'Добър вечер!', showName:true };
            }
            var todayDate = new Date(getTodayKey() + 'T00:00:00');
            var recDate = new Date(recordKey + 'T00:00:00');
            var daysAgo = Math.max(1, Math.round((todayDate - recDate) / 86400000));
            var label = daysAgo === 1 ? 'Вчера' : 'Преди ' + daysAgo + ' дни';
            return {
                prefix:'[' + label + '] ',
                greetingMorning:'Въвеждане за ' + label.toLowerCase(),
                greetingEvening:'Въвеждане за ' + label.toLowerCase(),
                showName:false
            };
        }

        function showMorningQuestion(force, recordKey, doneCb) {
            recordKey = recordKey || getTodayKey();
            var rec = getRecord(recordKey);
            if (!force && rec.morningCheck) { if (doneCb) doneCb(); return; }
            var meta = getPromptDayMeta(recordKey);
            showBubble(
                meta.prefix + 'Спахте ли добре тази нощ?',
                YES_NO,
                function(val) {
                    var r = getRecord(recordKey);
                    r.morningCheck = { sleptWell: val, ts: new Date().toISOString() };
                    saveRecord(recordKey, r);
                    recalcAndShowScore(recordKey);
                    if (doneCb) { setTimeout(doneCb, 350); }
                    else { setTimeout(function(){ showEncouragement(buildEncouragement(recordKey)); }, 400); }
                },
                { greeting: meta.greetingMorning, showName: meta.showName }
            );
        }

        function showEveningFlow(force, recordKey, doneCb, opts) {
            recordKey = recordKey || getTodayKey();
            var rec = getRecord(recordKey);
            if (!force && rec.eveningCheck) { if (doneCb) doneCb(); return; }
            var meta = getPromptDayMeta(recordKey);
            var prefix = meta.prefix;
            var hdrOpts = { greeting: meta.greetingEvening };
            var prefillWater = !!(opts && opts.prefillWater);
            var eveData = { waterIntake: prefillWater ? true : undefined };
            function finish() {
                var r = getRecord(recordKey);
                r.eveningCheck = { activityLevel: eveData.activityLevel,
                    emotionalBalance: eveData.emotionalBalance, waterIntake: !!eveData.waterIntake, ts: new Date().toISOString() };
                saveRecord(recordKey, r);
                recalcAndShowScore(recordKey);
                if (doneCb) { setTimeout(doneCb, 350); }
                else if (recordKey === getTodayKey()) {
                    setTimeout(function(){
                        var upd = getRecord(recordKey);
                        showDayEndModal(upd.dailyScore || calcDayScore(upd));
                    }, 500);
                } else {
                    setTimeout(function(){ showEncouragement(buildEncouragement(recordKey)); }, 400);
                }
            }
            function q3() {
                if (prefillWater) { finish(); return; }
                showBubble(prefix+'Изпихте ли поне 2 л вода?', NO_YES, function(v) {
                    eveData.waterIntake = v;
                    finish();
                }, hdrOpts);
            }
            function q2() {
                showBubble(prefix+'Емоционален баланс?', BALANCE_1_3,
                    function(v){ eveData.emotionalBalance=v; setTimeout(q3,400); }, hdrOpts);
            }
            function q1() {
                showBubble(prefix+'Ниво на активност?', ACTIVITY_1_3,
                    function(v){ eveData.activityLevel=v; setTimeout(q2,400); }, hdrOpts);
            }
            q1();
        }

        // ── Question queue ────────────────────────────────────────────────────
        function buildDayQueue(recordKey) {
            var rec = getRecord(recordKey);
            var queue = [];
            var isToday = recordKey === getTodayKey();
            var h = new Date().getHours();
            // Morning (sleep) question: only relevant after 6 am — asking before
            // that makes no sense (the user may not have slept yet).
            if (!rec.morningCheck && (!isToday || h >= 6)) {
                queue.push(function(next){ showMorningQuestion(true, recordKey, next); });
            }
            if (!rec.eveningCheck && (!isToday || h >= 20)) {
                queue.push(function(next){ showEveningFlow(true, recordKey, next); });
            }
            return queue;
        }

        function runQueue(queue, onDone) {
            if (!queue.length) { if (onDone) onDone(); return; }
            _queueDepth++;
            var idx = 0;
            function next() {
                if (idx < queue.length) {
                    queue[idx++](next);
                } else {
                    _queueDepth = Math.max(0, _queueDepth - 1);
                    recalcAndShowScore();
                    if (onDone) onDone();
                    // Now that the queue is done, schedule FAB lowering
                    if (_queueDepth === 0) _scheduleFabLower();
                }
            }
            next();
        }

        // ── On-open prompts ───────────────────────────────────────────────────
        // Called every time plan.html loads.  Shows whichever wellness questions
        // are still unanswered for today (morning from 06:00, evening from 20:00).
        // buildDayQueue already skips questions that have been answered, so no
        // per-day blocking flag is needed — the questions are shown on every open
        // until they are actually answered.
        function checkOpenAppPrompts() {
            if (!isGameEnabled()) return;
            if (_openPromptPending || _queueDepth > 0) return;
            var today = getTodayKey();
            var queue = buildDayQueue(today);
            if (!queue.length) return; // nothing pending (too early, or all answered)
            _openPromptPending = true;
            setTimeout(function(){
                _openPromptPending = false;
                // Re-check: answers could have come in during the 1.8 s delay, or
                // another queue (e.g. retroactive entry) may have started.
                if (_queueDepth > 0) return;
                var freshQueue = buildDayQueue(today);
                if (!freshQueue.length) return;
                runQueue(freshQueue, function(){
                    setTimeout(function(){ showEncouragement(buildEncouragement()); }, 600);
                });
            }, 1800);
        }

        // ── Retroactive entry (last 2 days) ─────────────────────────────────
        function checkRetroEntry() {
            if (!isGameEnabled()) return;
            var allData = getGameData();
            for (var offset = 1; offset <= 2; offset++) {
                var pastDate = new Date(); pastDate.setDate(pastDate.getDate() - offset);
                var pKey = dateKey(pastDate);
                if (!allData[pKey]) continue; // no real data for this day — skip (e.g. game was just activated)
                var rec  = getRecord(pKey);
                if (rec.missing) continue;
                if (rec.morningCheck && rec.eveningCheck) continue;
                var offerKey = 'gameRetroOffered_' + pKey;
                if (localStorage.getItem(offerKey)) continue;
                localStorage.setItem(offerKey, '1');
                (function(dayKey, daysAgo) {
                    var greeting = daysAgo === 1 ? 'Вчерашни данни' : 'Данни от преди ' + daysAgo + ' дни';
                    var msg = daysAgo === 1
                        ? 'Вчерашните въпроси не са попълнени. Искате ли да ги попълните сега?'
                        : 'Данните от ' + daysAgo + ' дни назад не са попълнени. Искате ли да ги въведете сега?';
                    setTimeout(function(){
                        // Do not interrupt a question queue that is already in progress
                        if (_queueDepth > 0) return;
                        showBubble(
                            msg,
                            YES_NO,
                            function(yes){
                                if (!yes) return;
                                var q = buildDayQueue(dayKey);
                                if (q.length) setTimeout(function(){ runQueue(q); }, 350);
                            },
                            { greeting: greeting }
                        );
                    }, 2800);
                })(pKey, offset);
                break; // offer one at a time to avoid bubble spam
            }
        }

        // ── Encouragement ─────────────────────────────────────────────────────
        var ENC = {
            sleep:   '<i class="fas fa-bed" style="color:#6366f1"></i> Добрият сън е основата. Лягайте по-рано — тялото ви ще ви благодари!',
            water:   '<i class="fas fa-droplet" style="color:#06B6D4"></i> Целта е 2 л вода на ден. Поставете бутилка на видно място!',
            activity:'<i class="fas fa-person-walking" style="color:#0D9488"></i> Дори 15 мин. разходка подобрява метаболизма и настроението!',
            junk:    '<i class="fas fa-leaf" style="color:#10b981"></i> Вредните храни са изкушение, но планът работи. Утре нов старт!',
            perfect: '<i class="fas fa-trophy" style="color:#fbbf24"></i> Страхотен ден! Спазихте плана отлично. Резултатите идват!',
            good:    '<i class="fas fa-check-circle" style="color:#10b981"></i> Добре се справяте! Малките крачки водят до голямата цел!',
            def:     '<i class="fas fa-dumbbell" style="color:#0D9488"></i> На прав път сте! Последователността е ключът!'
        };
        function buildEncouragement(recordKey) {
            var rec = getRecord(recordKey || getTodayKey());
            var ds  = rec.dailyScore || calcDayScore(rec);
            if (ds.junkCount > 0) return { text: ENC.junk, type: 'warn' };
            if (rec.morningCheck && !rec.morningCheck.sleptWell) return { text: ENC.sleep, type: 'warn' };
            if (rec.eveningCheck && !rec.eveningCheck.waterIntake) return { text: ENC.water, type: 'warn' };
            if (rec.eveningCheck && rec.eveningCheck.activityLevel === 1) return { text: ENC.activity, type: 'warn' };
            if (ds.score === 5 && !ds.junkCount) return { text: ENC.perfect, type: 'perfect' };
            if (ds.score >= 4) return { text: ENC.good, type: 'good' };
            return { text: ENC.def, type: 'good' };
        }
        function showEncouragement(textOrObj) {
            var text = (textOrObj && typeof textOrObj === 'object') ? textOrObj.text : textOrObj;
            var type = (textOrObj && typeof textOrObj === 'object') ? (textOrObj.type || '') : '';
            var t = document.getElementById('gameEncourageToast');
            if (!t) {
                t = document.createElement('div');
                t.id = 'gameEncourageToast';
                document.body.appendChild(t);
            }
            t.className = 'game-encourage-toast' + (type ? ' enc-' + type : '');
            t.innerHTML = text;
            requestAnimationFrame(function(){
                requestAnimationFrame(function(){
                    t.classList.add('visible');
                    setTimeout(function(){ t.classList.remove('visible'); }, 4500);
                });
            });
        }

        // ── Day-end modal ─────────────────────────────────────────────────────
        var DAY_LEVELS = [
            { min:5, iconClass:'fas fa-trophy', iconColor:'#fbbf24', title:'Перфектен резултат!',  color:'#fbbf24',
              msg:'Изпълнихте плана 100%! Вие сте шампион. Резултатите ще дойдат!', confetti:true  },
            { min:4, iconClass:'fas fa-award',  iconColor:'#10b981', title:'Отличен резултат!',    color:'#10b981',
              msg:'Браво! Почти перфектно. Малко крачки = голям успех!', confetti:true  },
            { min:3, iconClass:'fas fa-thumbs-up', iconColor:'#0D9488', title:'Задоволителен резултат!',   color:'#0D9488',
              msg:'Справихте се добре. Утре може дори по-добре!', confetti:false },
            { min:2, iconClass:'fas fa-dumbbell', iconColor:'#f59e0b', title:'Може по-добре', color:'#f59e0b',
              msg:'Трудно е понякога, но не се отказвайте. Всеки ден е нов шанс!', confetti:false },
            { min:0, iconClass:'fas fa-seedling', iconColor:'#6366f1', title:'Нов старт утре!', color:'#6366f1',
              msg:'Днес беше предизвикателно. Малките промени правят голяма разлика!', confetti:false }
        ];

        function showDayEndModal(ds) {
            var old = document.getElementById('gameDayEndModal');
            if (old) old.remove();
            var lv = DAY_LEVELS[DAY_LEVELS.length-1];
            for (var i=0; i<DAY_LEVELS.length; i++) {
                if ((ds.score||0) >= DAY_LEVELS[i].min) { lv = DAY_LEVELS[i]; break; }
            }
            var overlay = document.createElement('div');
            overlay.id = 'gameDayEndModal';
            overlay.className = 'game-modal-overlay';
            overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });

            var modal = document.createElement('div');
            modal.className = 'game-modal';

            if (lv.confetti) {
                var cf = document.createElement('div');
                cf.className = 'game-confetti';
                makeConfetti(cf, 28);
                modal.appendChild(cf);
            }

            var emoEl = document.createElement('span');
            emoEl.className = 'game-modal-emoji';
            emoEl.innerHTML = '<i class="'+lv.iconClass+'" style="color:'+lv.iconColor+'"></i>';
            modal.appendChild(emoEl);

            var titleEl = document.createElement('div');
            titleEl.className = 'game-modal-title';
            titleEl.textContent = lv.title;
            modal.appendChild(titleEl);

            var scoreEl = document.createElement('div');
            scoreEl.className = 'game-modal-score';
            scoreEl.style.cssText = 'background:linear-gradient(135deg,'+lv.color+','+lv.color+'99);color:white;';
            scoreEl.innerHTML = '\u041E\u0446\u0435\u043D\u043A\u0430: <strong>' + (ds.stars||'') + '</strong>';
            modal.appendChild(scoreEl);

            var engEl = document.createElement('div');
            engEl.className = 'game-modal-score';
            engEl.style.cssText = 'background:rgba(13,148,136,0.12);color:#0D9488;';
            engEl.innerHTML = '<i class="fas fa-chart-bar" style="color:#0D9488"></i> Ангажираност: <strong>' + (ds.engPct||0) + '%</strong>';
            modal.appendChild(engEl);

            var msgEl = document.createElement('div');
            msgEl.className = 'game-modal-msg';
            msgEl.textContent = lv.msg;
            modal.appendChild(msgEl);

            var closeBtn = document.createElement('button');
            closeBtn.className = 'game-modal-btn';
            closeBtn.style.cssText = 'background:linear-gradient(135deg,'+lv.color+',#0F766E);color:white;';
            closeBtn.textContent = '\u2713 \u0421\u0442\u0440\u0430\u0445\u043E\u0442\u043D\u043E, \u043F\u0440\u043E\u0434\u044A\u043B\u0436\u0430\u0432\u0430\u0439!';
            closeBtn.onclick = function(){ overlay.remove(); };
            modal.appendChild(closeBtn);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        }

        // ── Weekly recap ──────────────────────────────────────────────────────
        function calcWeeklyScore() {
            var allData = getGameData();
            var today = new Date();
            var days = [], engSum=0, scoreSum=0, count=0, noDataDays=0;
            for (var i=6; i>=0; i--) {
                var d = new Date(today); d.setDate(d.getDate()-i);
                var key = dateKey(d);
                var rec = allData[key] || null;
                days.push({ key:key, rec:rec });
                if (rec) {
                    var ds = rec.dailyScore || calcDayScore(rec);
                    // A record with no activity (auto-initialized, nothing logged) is treated as no data
                    if (ds.score === null && (ds.engPct || 0) === 0) {
                        noDataDays++;
                    }
                    engSum   += ds.engPct || 0;
                    scoreSum += ds.score  || 0;
                    count++;
                } else {
                    // Past or today with no data counts as 0% engagement
                    noDataDays++;
                    count++;
                }
            }
            return { days:days, avgScore:count>0?Math.round(scoreSum/count*10)/10:0,
                     avgEngPct:count>0?Math.round(engSum/count):0,
                     daysRecorded:count-noDataDays, noDataDays:noDataDays };
        }

        function showWeeklyRecapModal(wd) {
            var old = document.getElementById('gameWeeklyModal');
            if (old) old.remove();
            var avg = wd.avgScore;
            var iconClass, iconColor, title, msg, color;
            if      (avg>=4.5){ iconClass='fas fa-trophy'; iconColor='#fbbf24'; title='Фантастична седмица!'; color='#fbbf24';
                msg='Изключително представяне! Вие сте на правилния път. Продължавайте!'; }
            else if (avg>=3.5){ iconClass='fas fa-bullseye'; iconColor='#10b981'; title='Много добра седмица!'; color='#10b981';
                msg='Отлично! Малко повече внимание ще ви доведе до перфекцията.'; }
            else if (avg>=2.5){ iconClass='fas fa-chart-line'; iconColor='#0D9488'; title='Добри резултати!'; color='#0D9488';
                msg='Напредвате стабилно. Наберете кой аспект да подобрите следващата седмица.'; }
            else               { iconClass='fas fa-seedling'; iconColor='#6366f1'; title='Нова седмица, нов шанс!'; color='#6366f1';
                msg='Всяка седмица е нов старт. Малките промени правят трайни резултати!'; }

            var overlay = document.createElement('div');
            overlay.id = 'gameWeeklyModal';
            overlay.className = 'game-modal-overlay';
            overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });

            var modal = document.createElement('div');
            modal.className = 'game-modal';

            if (avg >= 3.5) {
                var cf2 = document.createElement('div');
                cf2.className = 'game-confetti';
                makeConfetti(cf2, 40);
                modal.appendChild(cf2);
            }

            var emoEl2 = document.createElement('span');
            emoEl2.className = 'game-modal-emoji';
            emoEl2.innerHTML = '<i class="'+iconClass+'" style="color:'+iconColor+'"></i>';
            modal.appendChild(emoEl2);

            var titleEl2 = document.createElement('div');
            titleEl2.className = 'game-modal-title';
            titleEl2.textContent = title;
            modal.appendChild(titleEl2);

            var sc2 = document.createElement('div');
            sc2.className = 'game-modal-score';
            sc2.style.cssText = 'background:linear-gradient(135deg,'+color+','+color+'99);color:white;';
            sc2.innerHTML = '\u0421\u0440\u0435\u0434\u043D\u0430 \u043E\u0446\u0435\u043D\u043A\u0430: <strong>' + avg + '/5</strong>';
            modal.appendChild(sc2);

            var en2 = document.createElement('div');
            en2.className = 'game-modal-score';
            en2.style.cssText = 'background:rgba(13,148,136,0.12);color:#0D9488;';
            en2.innerHTML = '<i class="fas fa-chart-bar" style="color:#0D9488"></i> Ангажираност: <strong>' + wd.avgEngPct + '%</strong>';
            modal.appendChild(en2);

            if (wd.noDataDays > 0) {
                var nd2 = document.createElement('div');
                nd2.className = 'game-modal-score';
                nd2.style.cssText = 'background:rgba(107,114,128,0.1);color:#6b7280;font-size:0.8rem;';
                nd2.innerHTML = '<i class="fas fa-calendar-xmark"></i> ' + wd.noDataDays + ' ' + (wd.noDataDays === 1 ? 'ден' : 'дни') + ' без отбелязана активност';
                modal.appendChild(nd2);
            }

            var mg2 = document.createElement('div');
            mg2.className = 'game-modal-msg';
            mg2.textContent = msg;
            modal.appendChild(mg2);

            // 7-day dot strip
            var dotsWrap = document.createElement('div');
            dotsWrap.style.cssText = 'display:flex;gap:5px;justify-content:center;margin:6px 0 16px;';
            wd.days.forEach(function(day) {
                var dot = document.createElement('div');
                var ds2 = day.rec ? (day.rec.dailyScore||calcDayScore(day.rec)) : null;
                var bg = '#e5e7eb';
                if (ds2 && ds2.score !== null) bg = ds2.score>=4?'#10b981':ds2.score>=3?'#f59e0b':'#f87171';
                dot.style.cssText = 'width:18px;height:18px;border-radius:50%;background:'+bg+';cursor:default;';
                dot.title = day.key;
                dotsWrap.appendChild(dot);
            });
            modal.appendChild(dotsWrap);

            var btnRow = document.createElement('div');
            btnRow.className = 'game-modal-btn-row';

            var profBtn = document.createElement('button');
            profBtn.className = 'game-modal-btn';
            profBtn.style.cssText = 'flex:1;background:rgba(13,148,136,0.1);color:#0D9488;border:1.5px solid rgba(13,148,136,0.25);';
            profBtn.textContent = '\uD83D\uDCCA \u0412\u0438\u0436 \u0430\u043D\u0430\u043B\u0438\u0437\u0438';
            profBtn.onclick = function(){ overlay.remove(); _shellNav('profile.html'); };

            var closBtn2 = document.createElement('button');
            closBtn2.className = 'game-modal-btn';
            closBtn2.style.cssText = 'flex:1;background:linear-gradient(135deg,'+color+',#0F766E);color:white;';
            closBtn2.textContent = '\u2713 \u0417\u0430\u0442\u0432\u043E\u0440\u0438';
            closBtn2.onclick = function(){ overlay.remove(); };

            btnRow.appendChild(profBtn);
            btnRow.appendChild(closBtn2);
            modal.appendChild(btnRow);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        }

        // ── Time-based prompts ────────────────────────────────────────────────
        function checkTimePrompts() {
            if (!isGameEnabled()) return;
            // Do not interrupt a queue that is already in progress (e.g. the
            // on-open queue started by checkOpenAppPrompts).
            if (_queueDepth > 0 || _openPromptPending) return;
            var h = new Date().getHours(), today = getTodayKey();
            var rec = getTodayRecord();
            // Morning: show once per hour from 6–9 while unanswered
            if (h >= 6 && h <= 9 && !rec.morningCheck) {
                var smKey = 'gameMorningShownH_' + today + '_' + h;
                if (!localStorage.getItem(smKey)) {
                    localStorage.setItem(smKey, '1');
                    showMorningQuestion(false, today, null);
                }
            }
            // Evening: show once per hour from 20–23 while unanswered
            if (h >= 20 && h <= 23 && !rec.eveningCheck) {
                var seKey = 'gameEveningShownH_' + today + '_' + h;
                if (!localStorage.getItem(seKey)) {
                    localStorage.setItem(seKey, '1');
                    showEveningFlow(false, today, null);
                }
            }
        }

        // ── Weekly AI trigger ─────────────────────────────────────────────────
        function maybeRequestWeeklyAI() {
            if (!isGameEnabled()) return;
            var info = {};
            try { info = JSON.parse(localStorage.getItem(GAME_WEEKLY_AI_KEY)||'{}'); } catch(e) {}
            var now = Date.now();
            if (info.lastRun && now - new Date(info.lastRun).getTime() < 7*24*60*60*1000) return;
            var wd = calcWeeklyScore();
            if (wd.daysRecorded >= 5) {
                var shownKey = 'gameWeeklyRecapShown_' + getTodayKey();
                if (!localStorage.getItem(shownKey)) {
                    localStorage.setItem(shownKey,'1');
                    setTimeout(function(){ showWeeklyRecapModal(wd); }, 1600);
                }
            }
            info.lastRun = new Date().toISOString();
            info.nextDue = new Date(now + 7*24*60*60*1000).toISOString();
            localStorage.setItem(GAME_WEEKLY_AI_KEY, JSON.stringify(info));
        }

        // ── Activate ──────────────────────────────────────────────────────────
        function activateGame() {
            enableGame();
            setTimeout(function(){
                enhanceMealCards();
                checkOpenAppPrompts();
                showEncouragement(buildEncouragement());
                startPromptInterval();
                maybeRequestWeeklyAI();
            }, 200);
        }

        // ── Init on page load ─────────────────────────────────────────────────
        (function initGameModule() {
            function setupGame() {
                if (!isGameEnabled()) return;
                setTimeout(function(){
                    enhanceMealCards();
                    checkOpenAppPrompts();
                    checkRetroEntry();
                    startPromptInterval();
                    maybeRequestWeeklyAI();
                }, 1600);
            }
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupGame);
            } else {
                setupGame();
            }
        })();

        // ── Public API ────────────────────────────────────────────────────────
        window.gameModule = {
            isEnabled:               isGameEnabled,
            activateGame:            activateGame,
            getTodayRecord:          getTodayRecord,
            saveTodayRecord:         saveTodayRecord,
            getRecord:               getRecord,
            saveRecord:              saveRecord,
            getGameData:             getGameData,
            getCurrentViewDayKey:    getCurrentViewDayKey,
            logExtraFood:            logExtraFood,
            calcDayScore:            calcDayScore,
            calcWeeklyScore:         calcWeeklyScore,
            recalcAndShowScore:      recalcAndShowScore
        };
        window._gameEnhanceMealCards = enhanceMealCards;
        window._gameShowMorning = function(f){ showMorningQuestion(f, getTodayKey(), null); };
        window._gameShowEvening = function(f, opts){ showEveningFlow(f, getTodayKey(), null, opts); };

        // Called by renderDay when user navigates to a past day (up to 2 days back).
        // Automatically asks any unanswered gamification questions for that day.
        window._gameCheckPastDayQuestions = function(dayKey) {
            if (!isGameEnabled()) return;
            var today = getTodayKey();
            if (!dayKey || dayKey >= today) return; // only past days
            // Limit to 2 days back
            var todayDate = new Date(today + 'T00:00:00');
            var limit = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 2);
            var viewDate = new Date(dayKey + 'T00:00:00');
            if (viewDate < limit) return;
            var q = buildDayQueue(dayKey);
            if (q.length) {
                setTimeout(function() { runQueue(q); }, 800);
            }
        };
    })();
    // ═══════════════════════════════════════════════════════════════════════════
    // END GAMIFICATION MODULE
    // ═══════════════════════════════════════════════════════════════════════════
