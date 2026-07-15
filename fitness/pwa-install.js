/**
 * KA-TRAINER — PWA инсталация (само след създаден план).
 * Детекция и насоки за актуални мобилни браузъри (средата на 2026).
 */
const DISMISS_KEY = 'ka-trainer.pwa-dismiss';
const AUTO_PROMPT_KEY = 'ka-trainer.pwa-auto';

let deferredPrompt = null;
let clientHintsCache = null;

const IN_APP_RULES = [
  { pattern: /Instagram/i, id: 'instagram', name: 'Instagram' },
  { pattern: /FBAN|FBAV|FB_IAB/i, id: 'facebook', name: 'Facebook' },
  { pattern: /Twitter/i, id: 'twitter', name: 'X (Twitter)' },
  { pattern: /TikTok/i, id: 'tiktok', name: 'TikTok' },
  { pattern: /Snapchat/i, id: 'snapchat', name: 'Snapchat' },
  { pattern: /LinkedInApp/i, id: 'linkedin', name: 'LinkedIn' },
  { pattern: /MicroMessenger/i, id: 'wechat', name: 'WeChat' },
  { pattern: /Line\//i, id: 'line', name: 'LINE' },
];

/** Синхронна детекция — тества се с mock UA. */
export function detectDeviceSync(ua = navigator.userAgent || '', hints = {}) {
  const isIPad = /iPad/i.test(ua)
    || (typeof navigator !== 'undefined'
      && navigator.platform === 'MacIntel'
      && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone|iPod/i.test(ua);
  const isIOS = isIPhone || isIPad;
  const isAndroid = /Android/i.test(ua);

  const inApp = detectInAppBrowser(ua);
  const browser = parseBrowser(ua, isIOS, isAndroid);
  const osVersion = parseOsVersion(ua, isIOS, isAndroid, hints);
  const model = resolveModel(ua, isIOS, isAndroid, isIPad, hints);

  let os = 'other';
  if (isIOS) os = 'ios';
  else if (isAndroid) os = 'android';

  const formFactor = isIPad ? 'tablet' : (isIOS || isAndroid ? 'phone' : 'unknown');
  const isMobileUa = isIOS || isAndroid || /Mobile/i.test(ua);

  return {
    ua,
    os,
    osVersion,
    formFactor,
    isIOS,
    isAndroid,
    isIPad,
    isIPhone,
    isMobileUa,
    inApp,
    browser,
    model,
    isSafari: browser.id === 'safari',
    isChrome: browser.id === 'chrome' || browser.id === 'chrome-ios',
    isSamsung: browser.id === 'samsung',
    isEdge: browser.id === 'edge' || browser.id === 'edge-ios',
    isFirefox: browser.id === 'firefox' || browser.id === 'firefox-ios',
  };
}

export async function detectDevice() {
  const hints = await loadClientHints();
  return detectDeviceSync(navigator.userAgent || '', hints);
}

async function loadClientHints() {
  if (clientHintsCache) return clientHintsCache;
  if (typeof navigator === 'undefined' || !navigator.userAgentData?.getHighEntropyValues) {
    clientHintsCache = {};
    return clientHintsCache;
  }
  try {
    clientHintsCache = await navigator.userAgentData.getHighEntropyValues([
      'platform',
      'platformVersion',
      'model',
      'mobile',
    ]);
  } catch {
    clientHintsCache = {};
  }
  return clientHintsCache;
}

function detectInAppBrowser(ua) {
  for (const rule of IN_APP_RULES) {
    if (rule.pattern.test(ua)) {
      return { id: rule.id, name: rule.name };
    }
  }
  if (/Android/i.test(ua) && /; wv\)/i.test(ua) && !/Chrome\/[\d.]+ Mobile/i.test(ua)) {
    return { id: 'webview', name: 'вграден браузър' };
  }
  return null;
}

function parseBrowser(ua, isIOS, isAndroid) {
  if (isIOS) {
    if (/CriOS/i.test(ua)) return { id: 'chrome-ios', name: 'Chrome' };
    if (/FxiOS/i.test(ua)) return { id: 'firefox-ios', name: 'Firefox' };
    if (/EdgiOS/i.test(ua)) return { id: 'edge-ios', name: 'Edge' };
    if (/OPiOS/i.test(ua)) return { id: 'opera-ios', name: 'Opera' };
    if (/Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) {
      return { id: 'safari', name: 'Safari' };
    }
    return { id: 'ios-other', name: 'браузър' };
  }
  if (isAndroid) {
    if (/SamsungBrowser/i.test(ua)) return { id: 'samsung', name: 'Samsung Internet' };
    if (/EdgA|Edg\//i.test(ua)) return { id: 'edge', name: 'Edge' };
    if (/Firefox/i.test(ua)) return { id: 'firefox', name: 'Firefox' };
    if (/OPR|Opera/i.test(ua)) return { id: 'opera', name: 'Opera' };
    if (/Chrome/i.test(ua)) return { id: 'chrome', name: 'Chrome' };
    return { id: 'android-other', name: 'браузър' };
  }
  if (/Edg\//i.test(ua)) return { id: 'edge-desktop', name: 'Edge' };
  if (/Chrome/i.test(ua)) return { id: 'chrome-desktop', name: 'Chrome' };
  if (/Firefox/i.test(ua)) return { id: 'firefox-desktop', name: 'Firefox' };
  if (/Safari/i.test(ua)) return { id: 'safari-desktop', name: 'Safari' };
  return { id: 'other', name: 'браузър' };
}

function parseOsVersion(ua, isIOS, isAndroid, hints = {}) {
  if (hints.platformVersion) {
    const major = String(hints.platformVersion).split('.')[0];
    if (major) return major;
  }
  if (isIOS) {
    const m = ua.match(/OS (\d+)[_.](\d+)/i);
    if (m) return `${m[1]}.${m[2]}`;
  }
  if (isAndroid) {
    const m = ua.match(/Android (\d+(?:\.\d+)?)/i);
    if (m) return m[1];
  }
  return '';
}

function resolveModel(ua, isIOS, isAndroid, isIPad, hints = {}) {
  if (hints.model && hints.model !== 'unknown') return sanitizeModel(hints.model);
  if (isAndroid) {
    const m = ua.match(/Android[^;]*;\s*([^)]+)\)/i);
    if (m?.[1]) return sanitizeModel(m[1]);
  }
  if (isIOS) {
    if (isIPad) return 'iPad';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPod/i.test(ua)) return 'iPod';
  }
  return '';
}

function sanitizeModel(raw) {
  return String(raw)
    .replace(/Build\/.*/i, '')
    .replace(/;.*$/, '')
    .trim();
}

export function isStandaloneMode() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

export function isTouchMobileViewport() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.matchMedia('(max-width: 820px)').matches;
  return coarse && narrow;
}

export function canOfferInstall() {
  return !isStandaloneMode() && localStorage.getItem(DISMISS_KEY) !== '1';
}

/** Стратегия за инсталация според устройство и браузър. */
export function getInstallStrategy(device, { hasNativePrompt = false } = {}) {
  if (device.inApp) {
    return {
      mode: 'in-app',
      canAutoInstall: false,
      primaryLabel: 'Отвори в браузър',
      secondaryLabel: 'Копирай линк',
      summary: `Отвори KA-TRAINER във външен браузър — ${device.inApp.name} не поддържа инсталация.`,
      steps: buildInAppSteps(device),
    };
  }

  if (hasNativePrompt) {
    return {
      mode: 'native',
      canAutoInstall: device.isAndroid && (device.isChrome || device.isEdge),
      primaryLabel: 'Инсталирай сега',
      secondaryLabel: null,
      summary: 'Готово за инсталация на началния екран с един докосване.',
      steps: [
        'Натисни „Инсталирай сега“.',
        'Потвърди в системния диалог на Android.',
        'Иконата KA-TRAINER ще се появи на началния екран.',
      ],
    };
  }

  if (device.isIOS) {
    if (device.browser.id === 'safari') {
      return {
        mode: 'ios-safari',
        canAutoInstall: false,
        primaryLabel: 'Покажи стъпките',
        secondaryLabel: null,
        summary: 'В Safari добавянето става през менюто Share.',
        steps: buildIosSafariSteps(device),
      };
    }
    return {
      mode: 'ios-open-safari',
      canAutoInstall: false,
      primaryLabel: 'Копирай линк',
      secondaryLabel: 'Отвори в Safari',
      summary: `На iPhone/iPad инсталацията работи само през Safari (сега: ${device.browser.name}).`,
      steps: buildIosOpenSafariSteps(device),
    };
  }

  if (device.isAndroid) {
    if (device.browser.id === 'samsung') {
      return {
        mode: 'android-samsung',
        canAutoInstall: false,
        primaryLabel: 'Покажи стъпките',
        secondaryLabel: null,
        summary: 'Samsung Internet — добави от менюто на браузъра.',
        steps: [
          'Натисни иконата ≡ (меню) долу или горе вдясно.',
          'Избери „Add page to“ / „Добави страница към“.',
          'Избери „Home screen“ / „Начален екран“.',
          'Потвърди с Add / Добави.',
        ],
      };
    }
    if (device.browser.id === 'firefox') {
      return {
        mode: 'android-firefox',
        canAutoInstall: false,
        primaryLabel: 'Покажи стъпките',
        secondaryLabel: null,
        summary: 'Firefox — добави през менюто на страницата.',
        steps: [
          'Натисни менюто ⋮ горе вдясно.',
          'Избери „Install“ / „Инсталирай“ или „Add to Home screen“.',
          'Потвърди добавянето.',
        ],
      };
    }
    if (device.browser.id === 'chrome' || device.browser.id === 'edge') {
      return {
        mode: 'android-menu',
        canAutoInstall: false,
        primaryLabel: 'Покажи стъпките',
        secondaryLabel: null,
        summary: `В ${device.browser.name} потърси „Инсталирай приложение“ в менюто.`,
        steps: [
          'Провери иконата ⊕ или „Install“ в адресната лента.',
          'Ако я няма: меню ⋮ → „Install app“ / „Инсталирай приложение“.',
          'Алтернатива: „Add to Home screen“ / „Добави към начален екран“.',
          'Потвърди с Install / Инсталирай.',
        ],
      };
    }
    return {
      mode: 'android-generic',
      canAutoInstall: false,
      primaryLabel: 'Покажи стъпките',
      secondaryLabel: 'Отвори в Chrome',
      summary: 'За най-добър резултат използвай Chrome на Android.',
      steps: [
        'Отвори страницата в Chrome (бутон по-долу).',
        'Меню ⋮ → „Install app“ или „Add to Home screen“.',
        'Потвърди инсталацията.',
      ],
    };
  }

  if (device.isMobileUa || isTouchMobileViewport()) {
    return {
      mode: 'mobile-generic',
      canAutoInstall: false,
      primaryLabel: 'Покажи стъпките',
      secondaryLabel: null,
      summary: 'Добави KA-TRAINER към началния екран от менюто на браузъра.',
      steps: [
        'Отвори менюто на браузъра.',
        'Потърси „Add to Home screen“ / „Инсталирай приложение“.',
        'Потвърди добавянето.',
      ],
    };
  }

  return {
    mode: 'desktop',
    canAutoInstall: false,
    primaryLabel: hasNativePrompt ? 'Инсталирай' : 'Покажи стъпките',
    secondaryLabel: null,
    summary: 'На компютър инсталирай от иконата в адресната лента.',
    steps: [
      'Потърси иконата Install / ⊕ в адресната лента.',
      'Или меню → „Install KA-TRAINER“.',
      'Потвърди инсталацията.',
    ],
  };
}

function buildInAppSteps(device) {
  const target = device.isIOS ? 'Safari' : 'Chrome';
  return [
    `В ${device.inApp.name} инсталацията не е възможна.`,
    `Натисни „Отвори в браузър“ или копирай линка.`,
    `Постави линка в ${target} и отвори страницата.`,
    device.isIOS
      ? 'В Safari: Share (⬆️) → Add to Home Screen.'
      : 'В Chrome: меню ⋮ → Install app / Add to Home screen.',
  ];
}

function buildIosSafariSteps(device) {
  const deviceName = device.isIPad ? 'iPad' : 'iPhone';
  return [
    `Увери се, че си в Safari на ${deviceName}.`,
    'Натисни Share / Споделяне (⬆️) долу в екрана.',
    'Превърти надолу и избери „Add to Home Screen“.',
    'Потвърди името KA-TRAINER и натисни Add / Добави.',
  ];
}

function buildIosOpenSafariSteps(device) {
  return [
    `Копирай линка (бутон по-долу).`,
    'Отвори приложението Safari.',
    'Постави линка в адресната лента и зареди страницата.',
    'Share (⬆️) → Add to Home Screen → Add.',
  ];
}

export function formatDeviceLabel(device) {
  const parts = [];
  if (device.os === 'ios') {
    parts.push(device.isIPad ? 'iPadOS' : 'iOS');
    if (device.osVersion) parts.push(device.osVersion);
  } else if (device.os === 'android') {
    parts.push('Android');
    if (device.osVersion) parts.push(device.osVersion);
  }
  if (device.model) parts.push(device.model);
  parts.push(device.browser.name);
  if (device.inApp) parts.push(`(${device.inApp.name})`);
  return parts.join(' · ') || 'Мобилно устройство';
}

export function initPwaInstall({ onChange } = {}) {
  const notify = () => { try { onChange?.(); } catch { /* noop */ } };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export async function triggerInstall(strategy) {
  if (deferredPrompt && strategy?.mode === 'native') {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return outcome;
  }
  return 'manual';
}

export async function copyPageLink() {
  const url = location.href;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch { /* fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function openInExternalBrowser() {
  const url = location.href;
  const device = detectDeviceSync();

  if (device.isAndroid && !device.inApp) {
    const intent = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    location.href = intent;
    return 'android-intent';
  }

  if (device.isIOS) {
    return 'ios-manual';
  }

  window.open(url, '_blank', 'noopener');
  return 'new-tab';
}

export function dismissInstallOffer() {
  localStorage.setItem(DISMISS_KEY, '1');
}

export function maybeAutoInstall(device, strategy) {
  if (!canOfferInstall() || !deferredPrompt || !strategy?.canAutoInstall) return;
  if (device.inApp) return;
  if (sessionStorage.getItem(AUTO_PROMPT_KEY)) return;
  sessionStorage.setItem(AUTO_PROMPT_KEY, '1');
  setTimeout(() => {
    if (deferredPrompt) void triggerInstall(strategy);
  }, 1400);
}

function renderSteps(stepsEl, steps) {
  if (!stepsEl) return;
  stepsEl.innerHTML = '';
  if (!steps?.length) {
    stepsEl.classList.add('hidden');
    return;
  }
  const ol = document.createElement('ol');
  ol.className = 'pwa-install-steps';
  for (const step of steps) {
    const li = document.createElement('li');
    li.textContent = step;
    ol.appendChild(li);
  }
  stepsEl.appendChild(ol);
  stepsEl.classList.remove('hidden');
}

export function bindPwaInstallCard(cardEl, { hasPlan } = {}) {
  if (!cardEl) return;

  const btn = cardEl.querySelector('[data-pwa-install]');
  const secondaryBtn = cardEl.querySelector('[data-pwa-secondary]');
  const dismiss = cardEl.querySelector('[data-pwa-dismiss]');
  const textEl = cardEl.querySelector('[data-pwa-text]');
  const hintEl = cardEl.querySelector('[data-pwa-hint]');
  const deviceEl = cardEl.querySelector('[data-pwa-device]');
  const stepsEl = cardEl.querySelector('[data-pwa-steps]');
  const toastEl = cardEl.querySelector('[data-pwa-toast]');

  let lastStrategy = null;
  let stepsVisible = false;

  const showToast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  };

  const refresh = async () => {
    const hasPlanNow = Boolean(hasPlan?.());
    const eligible = hasPlanNow && canOfferInstall()
      && (isTouchMobileViewport() || deferredPrompt || detectDeviceSync().isMobileUa);

    cardEl.classList.toggle('hidden', !eligible);
    if (!eligible) return;

    const device = await detectDevice();
    const strategy = getInstallStrategy(device, { hasNativePrompt: Boolean(deferredPrompt) });
    lastStrategy = strategy;

    if (textEl) textEl.textContent = strategy.summary;
    if (hintEl) {
      hintEl.textContent = strategy.mode === 'native'
        ? 'Системен диалог на Android — без допълнителни стъпки.'
        : 'Следвай стъпките по-долу за твоето устройство.';
    }
    if (deviceEl) deviceEl.textContent = formatDeviceLabel(device);

    cardEl.dataset.pwaMode = strategy.mode;

    if (btn) {
      btn.textContent = strategy.primaryLabel;
      btn.classList.toggle('hidden', !strategy.primaryLabel);
    }

    if (secondaryBtn) {
      const showSecondary = Boolean(strategy.secondaryLabel)
        || strategy.mode === 'in-app'
        || strategy.mode === 'ios-open-safari'
        || strategy.mode === 'android-generic';
      secondaryBtn.classList.toggle('hidden', !showSecondary);
      secondaryBtn.textContent = strategy.secondaryLabel
        || (strategy.mode === 'in-app' ? 'Копирай линк' : 'Отвори в Chrome');
    }

    if (!stepsVisible) {
      stepsEl?.classList.add('hidden');
    } else {
      renderSteps(stepsEl, strategy.steps);
    }
  };

  btn?.addEventListener('click', async () => {
    if (!lastStrategy) return;

    if (lastStrategy.mode === 'native') {
      const outcome = await triggerInstall(lastStrategy);
      if (outcome === 'accepted') cardEl.classList.add('hidden');
      void refresh();
      return;
    }

    if (lastStrategy.mode === 'in-app') {
      const result = openInExternalBrowser();
      if (result === 'ios-manual') {
        const copied = await copyPageLink();
        showToast(copied ? 'Линкът е копиран — отвори Safari.' : 'Копирай адреса от адресната лента.');
      }
      stepsVisible = true;
      renderSteps(stepsEl, lastStrategy.steps);
      return;
    }

    stepsVisible = true;
    renderSteps(stepsEl, lastStrategy.steps);
    cardEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  secondaryBtn?.addEventListener('click', async () => {
    if (!lastStrategy) return;

    if (lastStrategy.mode === 'ios-open-safari' || lastStrategy.secondaryLabel === 'Копирай линк') {
      const copied = await copyPageLink();
      showToast(copied ? 'Линкът е копиран.' : 'Неуспешно копиране — копирай от адресната лента.');
      stepsVisible = true;
      renderSteps(stepsEl, lastStrategy.steps);
      return;
    }

    if (lastStrategy.mode === 'in-app' || lastStrategy.mode === 'android-generic') {
      openInExternalBrowser();
      stepsVisible = true;
      renderSteps(stepsEl, lastStrategy.steps);
      return;
    }

    if (lastStrategy.secondaryLabel === 'Отвори в Safari') {
      const copied = await copyPageLink();
      showToast(copied ? 'Линкът е копиран — отвори Safari.' : 'Отвори страницата в Safari.');
      stepsVisible = true;
      renderSteps(stepsEl, lastStrategy.steps);
    }
  });

  dismiss?.addEventListener('click', () => {
    dismissInstallOffer();
    cardEl.classList.add('hidden');
  });

  initPwaInstall({ onChange: () => { void refresh(); } });
  void refresh();

  return async () => {
    const device = await detectDevice();
    const strategy = getInstallStrategy(device, { hasNativePrompt: Boolean(deferredPrompt) });
    maybeAutoInstall(device, strategy);
    return refresh();
  };
}
