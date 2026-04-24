/**
 * pwa-utils.js — Shared PWA cookie helpers for iOS Safari ↔ PWA profile handoff.
 *
 * iOS Safari and the installed PWA share cookies (same origin) but have isolated
 * localStorage.  These utilities compress the user profile into chunked cookies
 * so the PWA can restore it on first load without any backend request.
 */

const _PWA_OPTS = `;path=/;max-age=${365 * 24 * 60 * 60};SameSite=Lax;Secure`;
const _PWA_CHUNK = 3800;

/** Read a cookie value by name. */
function pwaCookieGet(name) {
    const match = document.cookie.match(
        new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')
    );
    return match ? decodeURIComponent(match[1]) : null;
}

/** Compress a string with deflate-raw and return a base64 string. */
async function pwaCompress(str) {
    const bytes = new TextEncoder().encode(str);
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(bytes); w.close();
    const parts = [];
    const r = cs.readable.getReader();
    for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        if (value) parts.push(value);
    }
    const out = new Uint8Array(parts.reduce((s, c) => s + c.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    let b = '';
    for (let i = 0; i < out.length; i += 8192) {
        b += String.fromCharCode(...out.subarray(i, i + 8192));
    }
    return btoa(b);
}

/** Decompress a base64 deflate-raw string back to a plain string. */
async function pwaDecompress(b64) {
    const bin = atob(b64);
    const bytes = Uint8Array.from({ length: bin.length }, (_, i) => bin.charCodeAt(i));
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    const parts = [];
    const r = ds.readable.getReader();
    for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        if (value) parts.push(value);
    }
    const out = new Uint8Array(parts.reduce((s, c) => s + c.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return new TextDecoder().decode(out);
}

/** Write a long base64 string to cookies in 3800-byte chunks. */
function pwaSetChunks(prefix, b64) {
    const n = Math.ceil(b64.length / _PWA_CHUNK);
    for (let i = 0; i < n; i++) {
        document.cookie = `${prefix}${i}=${b64.slice(i * _PWA_CHUNK, (i + 1) * _PWA_CHUNK)}${_PWA_OPTS}`;
    }
    document.cookie = `${prefix}n=${n}${_PWA_OPTS}`;
}

/** Read a chunked cookie sequence back into a single base64 string. Returns null if any chunk is missing. */
function pwaGetChunks(prefix) {
    const n = parseInt(pwaCookieGet(`${prefix}n`) || '0');
    if (!n) return null;
    let b64 = '';
    for (let i = 0; i < n; i++) {
        const c = pwaCookieGet(`${prefix}${i}`);
        if (c === null) return null;
        b64 += c;
    }
    return b64;
}

/**
 * Save userId + plan + userData to cookies for the iOS Safari → PWA handoff.
 * Called at questionnaire submit time.  Uses CompressionStream (iOS 16.4+)
 * to keep the cookie count low.  Falls back silently on older browsers.
 */
async function pwaSaveProfile(userId, plan, userData) {
    if (typeof CompressionStream === 'undefined') return;
    try {
        document.cookie = `np_uid=${encodeURIComponent(userId)}${_PWA_OPTS}`;
        pwaSetChunks('np_p', await pwaCompress(JSON.stringify(plan)));
        pwaSetChunks('np_u', await pwaCompress(JSON.stringify(userData)));
    } catch (e) {
        console.warn('[PWA] Cookie profile save failed:', e);
    }
}

/**
 * Restore dietPlan + userData from cookies when localStorage is empty.
 * iOS Safari and the installed PWA share cookies but have isolated localStorage.
 * Call this at page load before reading localStorage in the PWA.
 * Returns true if data was successfully restored.
 */
async function pwaRestoreProfile() {
    if (localStorage.getItem('dietPlan')) return false;
    const userId = pwaCookieGet('np_uid');
    if (!userId) return false;
    if (typeof DecompressionStream === 'undefined') return false;
    try {
        const planB64 = pwaGetChunks('np_p');
        if (!planB64) return false;
        localStorage.setItem('dietPlan', await pwaDecompress(planB64));
        localStorage.setItem('userId', userId);
        const userB64 = pwaGetChunks('np_u');
        if (userB64) {
            localStorage.setItem('userData', await pwaDecompress(userB64));
        }
        console.log('[PWA] Profile restored from cookies');
        return true;
    } catch (e) {
        console.warn('[PWA] Cookie restore failed:', e);
        return false;
    }
}

/**
 * Sync localStorage profile data to cookies when running in Safari browser
 * (non-standalone).  Keeps cookies fresh so the user can install the PWA later
 * and continue with the same profile seamlessly.  Fire-and-forget.
 */
async function pwaSyncProfile() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.navigator.standalone === true;
    if (isStandalone) return;
    if (typeof CompressionStream === 'undefined') return;
    const userId = localStorage.getItem('userId');
    const planStr = localStorage.getItem('dietPlan');
    if (!userId || !planStr) return;
    try {
        document.cookie = `np_uid=${encodeURIComponent(userId)}${_PWA_OPTS}`;
        pwaSetChunks('np_p', await pwaCompress(planStr));
        const userDataStr = localStorage.getItem('userData');
        if (userDataStr) {
            pwaSetChunks('np_u', await pwaCompress(userDataStr));
        }
        console.log('[PWA] Profile synced to cookies for Safari PWA handoff');
    } catch (e) {
        console.warn('[PWA] Cookie profile sync failed:', e);
    }
}
