// Service Worker for XBody Ability PWA
// Minimal, isolated from the NutriPlan service worker
const CACHE_NAME = 'xbody-v7';
const ACUITY_ORIGIN = 'https://app.acuityscheduling.com';
const ACUITY_PROXY_PATH = '/schedule.php';
const ACUITY_PERSISTENCE_SCRIPT_MARKER = '/*_xbody_form_persistence_v1*/';
// Core files that MUST be cached for the PWA shell to work offline.
const STATIC_CACHE = [
  'xbody.html',
  'xbody-manifest.json'
];
// Icons are optional – missing icons should not fail the SW install.
const OPTIONAL_CACHE = [
  'xbody-icon-192.png',
  'xbody-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Required files – any failure here aborts SW installation intentionally.
      await cache.addAll(STATIC_CACHE);
      // Best-effort: cache icons individually so a missing file doesn't
      // prevent the service worker from installing.
      for (const url of OPTIONAL_CACHE) {
        try {
          const resp = await fetch(url);
          // Only cache a successful response; a 404 (missing icon) is silently
          // skipped.  Other errors (network failure, quota exceeded) are also
          // swallowed here because icons are non-critical – the PWA shell works
          // without them.  Errors appear in DevTools console via the unhandled
          // fetch warning, which is sufficient for debugging.
          if (resp.ok) await cache.put(url, resp);
        } catch (_) { /* network error or quota exceeded – skip icon */ }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('xbody-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Cache-first for same-origin static files, except the main shell page.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return; // pass through cross-origin requests
  }

  if (event.request.mode === 'navigate' && url.pathname === ACUITY_PROXY_PATH) {
    event.respondWith(handleAcuityProxyRequest(url));
    return;
  }

  // Always refresh xbody.html from network first so users do not stay on a
  // stale shell that can disable/skip translation logic.
  const isXbodyShell = event.request.mode === 'navigate' || url.pathname.endsWith('/xbody.html');
  if (isXbodyShell) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(event.request);
        if (fresh && fresh.ok) await cache.put(event.request, fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw _;
      }
    })());
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});

async function handleAcuityProxyRequest(url) {
  const remoteUrl = `${ACUITY_ORIGIN}${url.pathname}${url.search}`;
  const response = await fetch(remoteUrl, {
    headers: {
      'accept': 'text/html,application/xhtml+xml'
    }
  });

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !/text\/html/i.test(contentType)) {
    return response;
  }

  const html = await response.text();
  const proxiedHtml = injectAcuityEnhancements(html);
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-security-policy');
  headers.delete('content-security-policy-report-only');
  headers.delete('content-length');
  headers.delete('x-frame-options');

  return new Response(proxiedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function injectAcuityEnhancements(html) {
  if (html.includes(ACUITY_PERSISTENCE_SCRIPT_MARKER)) {
    return html;
  }

  const injection = `<base href="${ACUITY_ORIGIN}/">${buildAcuityPersistenceScript()}`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
  }

  return injection + html;
}

function buildAcuityPersistenceScript() {
  return `<script>${ACUITY_PERSISTENCE_SCRIPT_MARKER}
(function () {
  var STORAGE_PREFIX = 'xbody_acuity_form_state_v1';

  function safeRead() {
    try {
      return window.localStorage;
    } catch (_) {
      return null;
    }
  }

  function storageKey() {
    var params = new URLSearchParams(window.location.search);
    return [
      STORAGE_PREFIX,
      params.get('owner') || 'unknown-owner',
      params.get('appointmentType') || 'unknown-type'
    ].join(':');
  }

  function loadState() {
    var storage = safeRead();
    if (!storage) return { fields: {} };
    try {
      var raw = storage.getItem(storageKey());
      if (!raw) return { fields: {} };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.fields !== 'object') {
        return { fields: {} };
      }
      return parsed;
    } catch (_) {
      return { fields: {} };
    }
  }

  function saveState(state) {
    var storage = safeRead();
    if (!storage) return;
    try {
      storage.setItem(storageKey(), JSON.stringify(state));
    } catch (_) {}
  }

  function normalize(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\\s+/g, ' ')
      .slice(0, 120);
  }

  function getLabelText(element) {
    if (!element) return '';
    if (element.labels && element.labels.length) {
      return Array.prototype.map.call(element.labels, function (label) {
        return label.textContent || '';
      }).join(' ');
    }
    if (element.id) {
      var explicitLabel = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
      if (explicitLabel) return explicitLabel.textContent || '';
    }
    var wrappingLabel = element.closest('label');
    return wrappingLabel ? wrappingLabel.textContent || '' : '';
  }

  function getFormScope(element) {
    if (!element || !element.form) return 'global';
    var form = element.form;
    var identifier = normalize(form.getAttribute('id') || form.getAttribute('name'));
    if (identifier) return identifier;
    return 'form-' + Array.prototype.indexOf.call(document.forms, form);
  }

  function isSensitiveField(element) {
    var metadata = [
      element.name,
      element.id,
      element.getAttribute('autocomplete'),
      element.getAttribute('placeholder'),
      element.getAttribute('aria-label'),
      getLabelText(element)
    ].join(' ').toLowerCase();

    return /(card|credit|cvc|cvv|security code|expiry|exp date|card number)/.test(metadata);
  }

  function shouldTrack(element) {
    if (!element || element.disabled || !element.tagName) return false;
    var tag = element.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false;
    var type = (element.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'file', 'password', 'reset'].indexOf(type) !== -1) {
      return false;
    }
    return !isSensitiveField(element);
  }

  function getFieldKey(element) {
    if (!shouldTrack(element)) return '';
    var type = (element.type || '').toLowerCase();
    var tag = element.tagName.toLowerCase();
    var descriptor = normalize(
      element.getAttribute('name') ||
      element.id ||
      element.getAttribute('autocomplete') ||
      element.getAttribute('placeholder') ||
      element.getAttribute('aria-label') ||
      getLabelText(element)
    );
    if (!descriptor) {
      descriptor = 'index-' + Array.prototype.indexOf.call(document.querySelectorAll(tag), element);
    }
    if (type === 'radio') {
      return ['radio', getFormScope(element), descriptor].join(':');
    }
    return [tag, type || 'text', getFormScope(element), descriptor].join(':');
  }

  function readFieldValue(element) {
    var type = (element.type || '').toLowerCase();
    if (type === 'checkbox') return !!element.checked;
    if (type === 'radio') return element.checked ? element.value : undefined;
    return element.value;
  }

  function setNativeValue(element, value) {
    var prototype = Object.getPrototypeOf(element);
    var descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  function setNativeChecked(element, checked) {
    var prototype = Object.getPrototypeOf(element);
    var descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'checked');
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, checked);
    } else {
      element.checked = checked;
    }
  }

  function notifyFieldMutation(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function persistAllFields() {
    var state = { fields: {}, savedAt: Date.now() };
    var fields = document.querySelectorAll('input, textarea, select');
    fields.forEach(function (element) {
      var key = getFieldKey(element);
      if (!key) return;
      var value = readFieldValue(element);
      if (typeof value === 'undefined') return;
      state.fields[key] = value;
    });
    saveState(state);
  }

  function restoreField(element, fields) {
    var key = getFieldKey(element);
    if (!key || !Object.prototype.hasOwnProperty.call(fields, key)) return;

    var value = fields[key];
    var type = (element.type || '').toLowerCase();

    if (type === 'checkbox') {
      if (!!element.checked !== !!value) {
        setNativeChecked(element, !!value);
        notifyFieldMutation(element);
      }
      return;
    }

    if (type === 'radio') {
      var shouldCheck = value === element.value;
      if (!!element.checked !== shouldCheck) {
        setNativeChecked(element, shouldCheck);
        notifyFieldMutation(element);
      }
      return;
    }

    var nextValue = value == null ? '' : String(value);
    if (element.value !== nextValue) {
      setNativeValue(element, nextValue);
      notifyFieldMutation(element);
    }
  }

  function restoreAllFields() {
    var state = loadState();
    var fields = state.fields || {};
    document.querySelectorAll('input, textarea, select').forEach(function (element) {
      restoreField(element, fields);
    });
  }

  var persistTimer = null;
  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistAllFields, 150);
  }

  var restoreTimer = null;
  function scheduleRestore() {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restoreAllFields, 60);
  }

  document.addEventListener('input', function (event) {
    if (shouldTrack(event.target)) schedulePersist();
  }, true);

  document.addEventListener('change', function (event) {
    if (shouldTrack(event.target)) schedulePersist();
  }, true);

  document.addEventListener('DOMContentLoaded', scheduleRestore);
  window.addEventListener('load', scheduleRestore);
  window.addEventListener('pageshow', scheduleRestore);
  window.addEventListener('pagehide', persistAllFields);
  window.addEventListener('beforeunload', persistAllFields);

  new MutationObserver(scheduleRestore).observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  scheduleRestore();
})();
</script>`;
}
