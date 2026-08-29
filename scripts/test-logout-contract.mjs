#!/usr/bin/env node
/**
 * Logout contract: signing out must end the session, not just change the page.
 *
 * The bug this guards: profile.html delegated to the SPA shell *before* signing
 * out and clearing, and the shell handler only navigated — so inside the app
 * (web tabs and the APK) logout left the Firebase session and every plan key in
 * place, and the next load signed the user straight back in.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, msg, detail = '') {
  if (cond) { pass++; console.log(`✓ ${msg}`); }
  else { fail++; console.error(`✗ ${msg}${detail ? ` — ${detail}` : ''}`); }
}

/** In every logout function, the shell delegation must come after the cleanup. */
function delegationIsLast(source, fnStart, label) {
  const idx = source.indexOf(fnStart);
  if (idx < 0) return ok(false, `${label}: logout function found`);
  const body = source.slice(idx, idx + 2000);
  const delegate = body.search(/requestShellAction\('NUTRIPLAN_LOGOUT'\)|postMessage\(\{\s*type:\s*'NUTRIPLAN_LOGOUT'/);
  if (delegate < 0) return ok(true, `${label}: no shell delegation`);
  const cleanup = body.search(/signOut\(|clearAuthSessionKeepingAnalytics|clearUserSessionData|clearProfileSessionFallback|clearIndexSessionData|_clearUserPlanData/);
  ok(cleanup >= 0 && cleanup < delegate,
    `${label}: session is cleared before the shell is asked to navigate`,
    cleanup < 0 ? 'no cleanup at all' : 'delegation happens first');
}

const profile = read('profile.html');
delegationIsLast(profile, 'window.doLogout = async function()', 'profile.html doLogout');
delegationIsLast(profile, 'window.doLogout = window.doLogout || async function()', 'profile.html fallback doLogout');
delegationIsLast(read('plan.html'), 'window.planSignOut = async function', 'plan.html planSignOut');
delegationIsLast(read('index.html'), 'window.indexSignOut = async function', 'index.html indexSignOut');

// The shell must not rely on the caller having done the work.
const app = read('app.js');
const handlerIdx = app.indexOf("data.type === 'NUTRIPLAN_LOGOUT'");
ok(handlerIdx > 0, 'app.js handles NUTRIPLAN_LOGOUT');
const handler = app.slice(handlerIdx, handlerIdx + 800);
ok(/clearShellSession\(/.test(handler), 'shell clears the session before navigating');
ok(/NutriPlanAuthSignOut/.test(app), 'shell signs out of Firebase via the index.html hook');
ok(/window\.NutriPlanAuthSignOut\s*=/.test(read('index.html')), 'index.html exposes the sign-out hook');

console.log(`\n=== logout contract: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
