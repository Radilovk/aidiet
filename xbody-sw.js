// Service Worker for XBody Ability PWA
// Minimal, isolated from the NutriPlan service worker
const CACHE_NAME = 'xbody-v6';
const ACUITY_ORIGIN = 'https://app.acuityscheduling.com';
const ACUITY_PROXY_PATH = '/schedule.php';
const ACUITY_PROXY_CACHE = 'xbody-acuity-proxy-v1';
// Core files that MUST be cached for the PWA shell to work offline.
const STATIC_CACHE = [
  'xbody.html',
  'xbody-manifest.json'
];
// Icons are optional – missing icons should not fail the SW install.
const OPTIONAL_CACHE = [
  'icon-192.png',
  'icon-512.png'
];
const PERSISTENCE_SCRIPT = `
<script>
(function () {
  var params = new URLSearchParams(location.search);
  var owner = params.get('owner') || 'default';
  var appointmentType = params.get('appointmentType') || 'default';
  var STORAGE_KEY = 'xbody:acuity:form:' + owner + ':' + appointmentType;
  var FIELD_SELECTOR = 'input, textarea, select';
  var SAVE_DELAY_MS = 120;
  var RESTORE_DELAY_MS = 180;
  var saveTimer = 0;
  var restoreTimer = 0;
  var isRestoring = false;
  var PAYMENT_KEYWORDS = [
    'card',
    'cc-',
    'cc_',
    'cvc',
    'cvv',
    'expiry',
    'exp-month',
    'exp-year',
    'expdate',
    'stripe',
    'payment'
  ];

  function safeParse(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function normalizeText(value) {
    return String(value || '').replace(/\\s+/g, ' ').trim();
  }

  function getLabelText(element) {
    if (element.labels && element.labels.length) {
      return normalizeText(Array.prototype.map.call(element.labels, function (label) {
        return label.textContent || '';
      }).join(' '));
    }
    if (element.id) {
      var explicit = null;
      var labels = document.querySelectorAll('label[for]');
      for (var i = 0; i < labels.length; i += 1) {
        if (labels[i].getAttribute('for') === element.id) {
          explicit = labels[i];
          break;
        }
      }
      if (explicit) return normalizeText(explicit.textContent || '');
    }
    var wrappingLabel = element.closest('label');
    return wrappingLabel ? normalizeText(wrappingLabel.textContent || '') : '';
  }

  function getDomPath(element) {
    var parts = [];
    var node = element;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + node.id;
        parts.unshift(part);
        break;
      }
      var index = 1;
      var sibling = node;
      while ((sibling = sibling.previousElementSibling)) index += 1;
      parts.unshift(part + ':nth-child(' + index + ')');
      node = node.parentElement;
    }
    return parts.join('>');
  }

  function getBaseKey(element) {
    var name = normalizeText(element.getAttribute('name'));
    if (name) return 'name:' + name;
    var id = normalizeText(element.id);
    if (id) return 'id:' + id;
    var autocomplete = normalizeText(element.getAttribute('autocomplete'));
    if (autocomplete) return 'autocomplete:' + autocomplete;
    var label = getLabelText(element);
    if (label) return 'label:' + label;
    return 'path:' + getDomPath(element);
  }

  function getFieldKey(element) {
    var type = (element.type || '').toLowerCase();
    var baseKey = getBaseKey(element);
    if (type === 'radio') return 'radio:' + baseKey;
    if (type === 'checkbox') return 'checkbox:' + baseKey + ':value:' + normalizeText(element.value || 'on');
    return 'field:' + baseKey;
  }

  function getFieldMeta(element) {
    var parts = [
      element.type,
      element.name,
      element.id,
      element.getAttribute('autocomplete'),
      element.getAttribute('placeholder'),
      element.getAttribute('aria-label'),
      getLabelText(element)
    ];
    var parent = element.closest('[id], [class], [data-payment], [data-stripe]');
    if (parent) {
      parts.push(parent.id);
      parts.push(parent.className);
      parts.push(parent.getAttribute('data-payment'));
      parts.push(parent.getAttribute('data-stripe'));
    }
    return parts
      .map(function (value) { return normalizeText(value).toLowerCase(); })
      .filter(Boolean)
      .join(' ');
  }

  function isPaymentField(element) {
    var meta = getFieldMeta(element);
    if (!meta) return false;
    if (PAYMENT_KEYWORDS.some(function (keyword) { return meta.indexOf(keyword) !== -1; })) return true;
    return !!element.closest('[data-payment], [data-stripe], .payment, .stripe, [id*="payment"], [class*="payment"], iframe');
  }

  function isPersistableField(element) {
    if (!element || element.disabled) return false;
    var tag = element.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
    var type = (element.type || '').toLowerCase();
    if (['password', 'file', 'hidden', 'submit', 'reset', 'button', 'image'].indexOf(type) !== -1) return false;
    return !isPaymentField(element);
  }

  function readState() {
    var payload = safeParse(localStorage.getItem(STORAGE_KEY));
    return payload && payload.fields ? payload.fields : {};
  }

  function persistState() {
    if (isRestoring) return;
    var fields = {};
    document.querySelectorAll(FIELD_SELECTOR).forEach(function (element) {
      if (!isPersistableField(element)) return;
      var key = getFieldKey(element);
      var type = (element.type || '').toLowerCase();

      if (type === 'radio') {
        fields[key] = { kind: 'radio', value: element.checked ? element.value : (fields[key] && fields[key].value) || null };
        return;
      }

      if (type === 'checkbox') {
        fields[key] = { kind: 'checkbox', checked: !!element.checked };
        return;
      }

      if (element.tagName === 'SELECT' && element.multiple) {
        fields[key] = {
          kind: 'select-multiple',
          values: Array.prototype.map.call(element.selectedOptions || [], function (option) { return option.value; })
        };
        return;
      }

      fields[key] = { kind: 'value', value: element.value };
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        fields: fields
      }));
    } catch (_) {}
  }

  function dispatchFieldEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function restoreState() {
    var fields = readState();
    var keys = Object.keys(fields);
    if (!keys.length) return;
    isRestoring = true;
    try {
      document.querySelectorAll(FIELD_SELECTOR).forEach(function (element) {
        if (!isPersistableField(element)) return;
        var key = getFieldKey(element);
        var saved = fields[key];
        if (!saved) return;
        var type = (element.type || '').toLowerCase();
        var changed = false;

        if (type === 'radio' && saved.kind === 'radio') {
          var shouldCheck = saved.value !== null && String(saved.value) === String(element.value);
          changed = element.checked !== shouldCheck;
          element.checked = shouldCheck;
        } else if (type === 'checkbox' && saved.kind === 'checkbox') {
          changed = element.checked !== !!saved.checked;
          element.checked = !!saved.checked;
        } else if (element.tagName === 'SELECT' && element.multiple && saved.kind === 'select-multiple') {
          var selected = Array.isArray(saved.values) ? saved.values.map(String) : [];
          Array.prototype.forEach.call(element.options, function (option) {
            option.selected = selected.indexOf(String(option.value)) !== -1;
          });
          changed = true;
        } else if (saved.kind === 'value') {
          var nextValue = saved.value == null ? '' : String(saved.value);
          changed = element.value !== nextValue;
          element.value = nextValue;
        }

        if (changed) dispatchFieldEvents(element);
      });
    } finally {
      setTimeout(function () {
        isRestoring = false;
      }, 0);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistState, SAVE_DELAY_MS);
  }

  function scheduleRestore() {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restoreState, RESTORE_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreState, { once: true });
  } else {
    restoreState();
  }

  window.addEventListener('pageshow', scheduleRestore);
  window.addEventListener('beforeunload', persistState);
  document.addEventListener('input', scheduleSave, true);
  document.addEventListener('change', scheduleSave, true);
  document.addEventListener('blur', scheduleSave, true);

  if (document.documentElement) {
    new MutationObserver(scheduleRestore).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();
</script>
`;

function shouldProxyAcuity(url) {
  return url.pathname === ACUITY_PROXY_PATH;
}

function buildAcuityUrl(url) {
  return new URL(url.pathname + url.search, ACUITY_ORIGIN);
}

function sanitizeProxyRequestHeaders(request) {
  const headers = new Headers(request.headers);
  [
    'host',
    'origin',
    'referer',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto'
  ].forEach((name) => headers.delete(name));
  return headers;
}

function sanitizeProxyResponseHeaders(response) {
  const headers = new Headers(response.headers);
  [
    'content-length',
    'content-encoding',
    'content-security-policy',
    'content-security-policy-report-only',
    'x-frame-options'
  ].forEach((name) => headers.delete(name));
  return headers;
}

function injectPersistence(html) {
  if (html.includes('xbody:acuity:form:')) return html;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, PERSISTENCE_SCRIPT + '\n</body>');
  }
  return html + PERSISTENCE_SCRIPT;
}

async function proxyAcuityRequest(request) {
  const requestUrl = new URL(request.url);
  const acuityUrl = buildAcuityUrl(requestUrl);
  const init = {
    method: request.method,
    headers: sanitizeProxyRequestHeaders(request),
    redirect: 'follow'
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.clone().arrayBuffer();
  }

  const cache = request.method === 'GET' ? await caches.open(ACUITY_PROXY_CACHE) : null;

  try {
    const response = await fetch(acuityUrl.toString(), init);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (!contentType.includes('text/html')) {
      return response;
    }

    const html = await response.text();
    const proxiedResponse = new Response(injectPersistence(html), {
      status: response.status,
      statusText: response.statusText,
      headers: sanitizeProxyResponseHeaders(response)
    });

    if (cache && response.ok) {
      await cache.put(request, proxiedResponse.clone());
    }

    return proxiedResponse;
  } catch (error) {
    if (cache) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    throw error;
  }
}

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

  if (shouldProxyAcuity(url)) {
    event.respondWith(proxyAcuityRequest(event.request));
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
