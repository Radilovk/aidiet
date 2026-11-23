#!/usr/bin/env node
/** Сън по използването на телефона (sleep-signal.js): нощта по сесиите и сливането с отговора. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../sleep-signal.js');
const S = globalThis.NutriPlanSleepSignal;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('✗ ' + m); } };

const K = '2026-11-23';
const t = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const use = (d, h, m, mins) => [t(d, h, m), t(d, h, m) + mins * 60000];

// 22:30 последно използване, 06:40 първо — една чиста нощ
const clean = S.analyzeNight([use(22, 20, 0, 150), use(23, 6, 40, 20)], K);
ok(clean && clean.quietH === 8.2 && clean.wakeups === 0, 'чиста нощ: 8,2 ч, без събуждания');
ok(S.levelOf(clean) === 'good', 'чиста нощ — добро ниво');
// кратко светване на известие (30 с) не прекъсва
ok(S.analyzeNight([use(22, 22, 0, 30), [t(23, 2, 0), t(23, 2, 0) + 30000], use(23, 6, 30, 10)], K).wakeups === 0, 'известие < 1 мин. — не е събуждане');
// две ползвания през нощта (5 мин. всяко) — събуждания; почивката е сборът
const broken = S.analyzeNight([use(22, 23, 0, 30), use(23, 2, 0, 5), use(23, 4, 30, 5), use(23, 7, 0, 10)], K);
ok(broken.wakeups === 2 && broken.quietH > 6.5 && broken.quietH < 7.5, `две събуждания, ${broken.quietH} ч`);
ok(broken.lastUse === t(22, 23, 30) && broken.firstUse === t(23, 7, 0), 'последно и първо използване — краищата на нощта');
// един час ползване в средата не е „същата нощ“ — вечерна почивка не се слива
const evening = S.analyzeNight([use(22, 20, 0, 10), use(22, 22, 0, 60), use(23, 6, 30, 10)], K);
ok(evening && evening.wakeups === 0 && evening.quietH === 7.5, 'вечерна пауза под 90 мин. + дълго ползване — отделно от нощта');
// кратка нощ
const short = S.analyzeNight([use(23, 1, 0, 60), use(23, 5, 0, 10)], K);
ok(short && short.quietH === 3 && S.levelOf(short) === 'bad', 'нощ от 3 ч — лошо');
// без сесии от едната страна → няма нощ
ok(S.analyzeNight([use(23, 6, 30, 10)], K) === null, 'без използване преди нощта — няма данни');
ok(S.analyzeNight([], K) === null, 'без сесии — null');

// Сливане: телефонът само сваля
const good = { sleptWell: true, level: 'good' };
ok(S.merge(good, short).level === 'bad' && S.merge(good, short).sleptWell === false, 'добър сън + 3 ч тишина → лош');
ok(S.merge(good, { quietH: 6.5, wakeups: 0 }).level === 'mid', '6,5 ч → среден');
ok(S.merge(good, { quietH: 8, wakeups: 3 }).level === 'mid', '3 събуждания → среден');
ok(S.merge({ sleptWell: false, level: 'bad' }, clean).level === 'bad' && !S.merge({ sleptWell: false }, clean).changed, 'лош сън + чиста нощ — остава лош (не качва)');
ok(S.merge({ sleptWell: true }, short).level === 'bad', 'отговор „да“ без ниво — като добър');
ok(!S.merge({ sleptWell: true, level: 'good', source: 'device' }, short).changed, 'сън от гривна не се пипа');
ok(/телефон: без използване 22:30–06:40 \(8,2 ч\)/.test(S.noteOf(clean)), 'бележка: ' + S.noteOf(clean));
ok(/2 събуждания/.test(S.noteOf(broken)), 'бележка със събуждания');
// без устройство
ok(S.supported() === false, 'в браузър — не се поддържа, без грешка');

console.log(`sleep-signal: ${pass} OK, ${fail} грешки`);
process.exit(fail ? 1 : 0);
