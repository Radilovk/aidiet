// Достъп по ниво: стената е изключена по подразбиране, нивото изтича, отказът е 402.
import assert from 'node:assert/strict';
import Pricing from '../pricing-config.js';
import { gateFeature, resolveAccess, writeAccess, normalizeAccess, PAYWALL_KEY } from '../access-control.js';

const store = new Map();
const env = { page_content: {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  put: async (k, v) => { store.set(k, v); },
  delete: async (k) => { store.delete(k); }
} };
const respond = (data, status) => ({ status, data });
const ownerOk = async () => null;
const req = (body) => ({ clone: () => ({ json: async () => body }) });
let n = 0;
const ok = (name) => { n++; console.log('✅', name); };

// Цени и правила
assert.equal(Pricing.allows('start', 'chat'), false);
assert.equal(Pricing.allows('core', 'chat'), true);
assert.equal(Pricing.allows('core', 'full_week'), true);
assert.deepEqual(Pricing.PLANS.map(p => p.id), ['start', 'core']);
assert.equal(Pricing.allows('start', 'unknown_feature'), true);
assert.equal(Pricing.formatPrice(8.99), '8,99 €');
assert.equal(Pricing.formatPrice(45), '45 €');
ok('правила на нивата и формат на цената');

// Изключена стена: всичко е отворено, без да се чете тялото
const open = await resolveAccess(env, 'anon_123');
assert.equal(open.paywall, false);
assert.ok(Object.values(open.features).every(Boolean));
assert.equal(await gateFeature(req({}), env, 'chat', { checkOwner: ownerOk, respond }), null);
ok('изключена стена не заключва нищо');

// Включена стена
store.set(PAYWALL_KEY, 'true');
let r = await gateFeature(req({ userId: 'anon_1' }), env, 'chat', { checkOwner: ownerOk, respond });
assert.equal(r.status, 402); assert.equal(r.data.reason, 'account');
ok('без акаунт → 402 account');

r = await gateFeature(req({ userId: 'fb_user000001' }), env, 'photo', { checkOwner: ownerOk, respond });
assert.equal(r.status, 402); assert.equal(r.data.reason, 'tier'); assert.equal(r.data.need, 'core');
ok('акаунт в Start → 402 tier');

const denied = { status: 401 };
r = await gateFeature(req({ userId: 'fb_user000001' }), env, 'photo', { checkOwner: async () => denied, respond });
assert.equal(r, denied);
ok('чужд токен → отказът на checkOwner');

await writeAccess(env, 'fb_user000001', { tier: 'core' });
assert.equal(await gateFeature(req({ userId: 'fb_user000001' }), env, 'chat', { checkOwner: ownerOk, respond }), null);
const core = await resolveAccess(env, 'fb_user000001');
assert.equal(core.tier, 'core'); assert.ok(Object.values(core.features).every(Boolean));
ok('Core отключва всички платени функции');

// Изтичане
const now = Date.now();
await writeAccess(env, 'fb_user000002', { tier: 'core', until: new Date(now - 1000).toISOString() }, now - 5000);
const expired = await resolveAccess(env, 'fb_user000002', now);
assert.equal(expired.tier, 'start'); assert.equal(expired.expired, true);
assert.equal(normalizeAccess({ tier: 'core', until: now + 1000 }, now).tier, 'core');
ok('изтекло ниво пада до Start');

// Запис
await assert.rejects(() => writeAccess(env, 'anon_1', { tier: 'core' }));
await assert.rejects(() => writeAccess(env, 'fb_user000003', { tier: 'gold' }));
await writeAccess(env, 'fb_user000001', { tier: 'start' });
assert.equal(store.has('access:fb_user000001'), false);
ok('ниво само за акаунт; Start без срок изтрива записа');

console.log(`\nВсички ${n} проверки минаха`);
