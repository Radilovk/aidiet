/**
 * KA-TRAINER — PWA инсталация (само след създаден план).
 */
const DISMISS_KEY = 'ka-trainer.pwa-dismiss';
const AUTO_PROMPT_KEY = 'ka-trainer.pwa-auto';

let deferredPrompt = null;

export function detectDevice() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isSafari = isIOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  const isChrome = /Chrome/i.test(ua) && !/Edg/i.test(ua);
  const isSamsung = /SamsungBrowser/i.test(ua);
  const isEdge = /Edg/i.test(ua);
  const model = (ua.match(/Android[^;]*;\s*([^)]+)\)/i) || [])[1]?.trim()
    || (isIOS ? (/iPhone|iPad|iPod/.exec(ua)?.[0] || 'iPhone') : '');
  let os = 'other';
  if (isIOS) os = 'ios';
  else if (isAndroid) os = 'android';
  return { os, isIOS, isAndroid, isSafari, isChrome, isSamsung, isEdge, model, ua };
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export function canOfferInstall() {
  return !isStandalone() && localStorage.getItem(DISMISS_KEY) !== '1';
}

function installHint(device) {
  if (device.isIOS && device.isSafari) {
    return 'Натисни Share (⬆️) → „Add to Home Screen“ (Добави към начален екран).';
  }
  if (device.isAndroid && (device.isChrome || device.isEdge)) {
    return deferredPrompt
      ? 'Ще се покаже системен диалог за инсталация.'
      : 'Меню (⋮) → „Инсталирай приложение“ или „Добави към начален екран“.';
  }
  if (device.isSamsung) {
    return 'Меню → „Добави страница към“ → „Начален екран“.';
  }
  if (device.isAndroid) {
    return 'Меню на браузъра → „Добави към начален екран“.';
  }
  return 'Добави към началния екран за бърз достъп до програмата.';
}

function deviceLabel(device) {
  const parts = [];
  if (device.os === 'ios') parts.push('iOS');
  else if (device.os === 'android') parts.push('Android');
  if (device.model) parts.push(device.model);
  if (device.isSamsung) parts.push('Samsung Internet');
  else if (device.isChrome) parts.push('Chrome');
  else if (device.isSafari) parts.push('Safari');
  else if (device.isEdge) parts.push('Edge');
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

export async function triggerInstall() {
  const device = detectDevice();

  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return outcome;
  }

  if (device.isIOS && device.isSafari) {
    alert(
      'Добави KA-TRAINER на началния екран (iPhone/iPad):\n\n'
      + '1. Натисни бутона Share / Споделяне (⬆️) долу в Safari\n'
      + '2. Превърти и избери „Add to Home Screen“\n'
      + '   (на български: „Добави към начален екран“)\n'
      + '3. Потвърди с Add / Добави',
    );
    return 'ios-guide';
  }

  if (device.isAndroid) {
    const browser = device.isSamsung ? 'Samsung Internet'
      : device.isChrome ? 'Chrome'
        : device.isEdge ? 'Edge' : 'браузъра';
    alert(
      `Инсталирай KA-TRAINER на Android (${browser}):\n\n`
      + '1. Отвори менюто (⋮) горе вдясно\n'
      + '2. Избери „Инсталирай приложение“ или „Добави към начален екран“\n'
      + '3. Потвърди с „Инсталирай“\n\n'
      + 'Алтернатива: иконата (⊕) в адресната лента, ако я виждаш.',
    );
    return 'android-guide';
  }

  alert('Отвори KA-TRAINER на телефона си (Chrome или Safari) за да го добавиш на началния екран.');
  return 'unavailable';
}

export function dismissInstallOffer() {
  localStorage.setItem(DISMISS_KEY, '1');
}

/** Android: еднократен системен диалог след създаден план (ако браузърът го позволява). */
export function maybeAutoInstall() {
  if (!canOfferInstall() || !deferredPrompt) return;
  const device = detectDevice();
  if (!device.isAndroid) return;
  if (sessionStorage.getItem(AUTO_PROMPT_KEY)) return;
  sessionStorage.setItem(AUTO_PROMPT_KEY, '1');
  setTimeout(() => {
    if (deferredPrompt) void triggerInstall();
  }, 1200);
}

export function bindPwaInstallCard(cardEl, { hasPlan } = {}) {
  if (!cardEl) return;

  const btn = cardEl.querySelector('[data-pwa-install]');
  const dismiss = cardEl.querySelector('[data-pwa-dismiss]');
  const textEl = cardEl.querySelector('[data-pwa-text]');
  const hintEl = cardEl.querySelector('[data-pwa-hint]');
  const deviceEl = cardEl.querySelector('[data-pwa-device]');

  const refresh = () => {
    const show = Boolean(hasPlan?.()) && canOfferInstall();
    cardEl.classList.toggle('hidden', !show);
    if (!show) return;

    const device = detectDevice();
    if (textEl) {
      textEl.textContent = deferredPrompt
        ? 'Готово за инсталация на началния екран.'
        : 'Добави програмата на началния екран за бърз достъп.';
    }
    if (hintEl) hintEl.textContent = installHint(device);
    if (deviceEl) deviceEl.textContent = deviceLabel(device);
    if (btn) {
      btn.textContent = deferredPrompt ? 'Инсталирай сега' : 'Как да инсталирам';
    }
  };

  btn?.addEventListener('click', async () => {
    const outcome = await triggerInstall();
    if (outcome === 'accepted') cardEl.classList.add('hidden');
    refresh();
  });

  dismiss?.addEventListener('click', () => {
    dismissInstallOffer();
    cardEl.classList.add('hidden');
  });

  initPwaInstall({ onChange: refresh });
  refresh();
  return refresh;
}
