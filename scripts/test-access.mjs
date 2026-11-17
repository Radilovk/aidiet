// Достъп по ниво: стената е изключена по подразбиране, нивото изтича, отказът е 402,
// месечните тавани се броят само при успех.
import assert from 'node:assert/strict';
import Pricing from '../pricing-config.js';
import {
  gateFeature, resolveAccess, writeAccess, normalizeAccess, planUsesAI, addUsage, readUsage, monthOf, PAYWALL_KEY
} from '../access-control.js';

const store = new Map();
const env = { page_content: {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  put: async (k, v) => { store.set(k, v); },
  delete: async (k) => { store.delete(k); }
} };
const respond = (data, status) => ({ status, data });
const ownerOk = async () => null;
const req = (body) => ({ clone: () => ({ json: async () => body }) });
const gate = (body, feature, extra = {}) => gateFeature(req(body), env, feature, { checkOwner: ownerOk, respond, ...extra });
let n = 0;
const ok = (name) => { n++; console.log('✅', name); };

// Цени и правила
assert.deepEqual(Pricing.PLANS.map(p => p.id), ['start', 'core', 'plus']);
assert.equal(Pricing.allows('start', 'chat'), false);
assert.equal(Pricing.allows('core', 'chat'), true);
assert.equal(Pricing.allows('start', 'unknown_feature'), true);
assert.equal(Pricing.quota('core', 'chat'), 50);
assert.equal(Pricing.quota('plus', 'chat'), 200);
assert.equal(Pricing.quota('core', 'weekly'), null);
assert.equal(Pricing.upgradeFor('core', 'chat'), 'plus');
assert.equal(Pricing.upgradeFor('plus', 'chat'), null);
assert.equal(Pricing.quotaText(1, 'replan'), '1 нов план');
assert.equal(Pricing.quotaText(50, 'chat'), '50 въпроса');
assert.equal(Pricing.formatPrice(8.99), '8,99 €');
for (const tier of ['core', 'plus']) {
  for (const f of Object.keys(Pricing.QUOTAS[tier])) assert.ok(Pricing.allows(tier, f), `${tier}:${f}`);
}
ok('нива, тавани и формат на цената');

// Изключена стена: всичко е отворено, без да се чете тялото
const open = await resolveAccess(env, 'anon_123');
assert.equal(open.paywall, false);
assert.ok(Object.values(open.features).every(Boolean));
assert.equal((await gate({}, 'chat')).deny, null);
assert.equal(await planUsesAI(env, '', null, async () => ({})), true);
ok('изключена стена не заключва нищо и планът е с AI');

// Включена стена
store.set(PAYWALL_KEY, 'true');
let g = await gate({ userId: 'anon_1' }, 'chat');
assert.equal(g.deny.status, 402); assert.equal(g.deny.data.reason, 'account');
ok('без акаунт → 402 account');

g = await gate({ userId: 'fb_user000001' }, 'photo');
assert.equal(g.deny.status, 402); assert.equal(g.deny.data.reason, 'tier'); assert.equal(g.deny.data.need, 'core');
ok('акаунт в Start → 402 tier');

const denied = { status: 401 };
g = await gateFeature(req({ userId: 'fb_user000001' }), env, 'photo', { checkOwner: async () => denied, respond });
assert.equal(g.deny, denied);
ok('чужд токен → отказът на checkOwner');

// Тавани
await writeAccess(env, 'fb_user000001', { tier: 'core' });
const now = Date.parse('2026-11-15T10:00:00Z');
for (let i = 0; i < 5; i++) {
  g = await gate({ userId: 'fb_user000001' }, 'menu_photo', { now });
  assert.equal(g.deny, null, `снимка ${i + 1}`);
  await g.commit();
}
g = await gate({ userId: 'fb_user000001' }, 'menu_photo', { now });
assert.equal(g.deny.status, 402); assert.equal(g.deny.data.reason, 'quota');
assert.equal(g.deny.data.limit, 5); assert.equal(g.deny.data.upgrade, 'plus');
ok('Core: 5 снимки на меню, шестата → 402 quota с предложение за Plus');

g = await gate({ userId: 'fb_user000001' }, 'chat', { now });
assert.equal(g.deny, null); // без commit — неуспешна заявка не се брои
assert.equal((await readUsage(env, 'fb_user000001', now)).chat, undefined);
ok('неуспешна заявка не изяжда от тавана');

const next = Date.parse('2026-12-01T00:00:01Z');
assert.equal((await gate({ userId: 'fb_user000001' }, 'menu_photo', { now: next })).deny, null);
assert.notEqual(monthOf(now), monthOf(next));
ok('новият месец започва отначало');

const acc = await resolveAccess(env, 'fb_user000001', now);
assert.deepEqual(acc.quotas.menu_photo, { used: 5, limit: 5 });
assert.equal(acc.quotas.weekly, undefined);
ok('resolveAccess връща използваното и таваните');

await writeAccess(env, 'fb_user000001', { tier: 'plus' });
assert.equal((await gate({ userId: 'fb_user000001' }, 'menu_photo', { now })).deny, null);
ok('Plus вдига тавана веднага');

// Тяло, подадено отвън (генериране на план: _userId/_idToken)
g = await gateFeature(null, env, 'replan', { checkOwner: ownerOk, respond, body: { userId: 'fb_user000009' } });
assert.equal(g.deny.data.reason, 'tier');
ok('нов план след промяна е платен');

// AI в плана
const verify = async () => ({ uid: 'user000001' });
assert.equal(await planUsesAI(env, 'fb_user000001', 'tok', verify), true);
assert.equal(await planUsesAI(env, 'fb_user000001', null, verify), false);
assert.equal(await planUsesAI(env, 'anon_1', 'tok', verify), false);
assert.equal(await planUsesAI(env, 'fb_other00001', 'tok', verify), false);
await writeAccess(env, 'fb_user000005', { tier: 'start', until: new Date(now + 864e5).toISOString() });
assert.equal(await planUsesAI(env, 'fb_user000005', 'tok', async () => ({ uid: 'user000005' })), false);
ok('AI в плана само за платен акаунт с валиден токен');

// Изтичане и запис
const t = Date.now();
await writeAccess(env, 'fb_user000002', { tier: 'core', until: new Date(t - 1000).toISOString() }, t - 5000);
const expired = await resolveAccess(env, 'fb_user000002', t);
assert.equal(expired.tier, 'start'); assert.equal(expired.expired, true);
assert.equal(normalizeAccess({ tier: 'core', until: t + 1000 }, t).tier, 'core');
await assert.rejects(() => writeAccess(env, 'anon_1', { tier: 'core' }));
await assert.rejects(() => writeAccess(env, 'fb_user000003', { tier: 'gold' }));
await writeAccess(env, 'fb_user000001', { tier: 'start' });
assert.equal(store.has('access:fb_user000001'), false);
await addUsage(env, 'fb_user000004', 'chat', now);
assert.equal((await readUsage(env, 'fb_user000004', now)).chat, 1);
ok('изтичане, запис на ниво и броене');

console.log(`\nВсички ${n} проверки минаха`);
