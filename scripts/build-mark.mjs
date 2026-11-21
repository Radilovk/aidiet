#!/usr/bin/env node
/**
 * Знакът Nutriin — геометричен чертеж (централна линия), записва brand/nutriin-mark.json.
 * Конструкция в квадрат 1000: ябълката е огледално симетрична (ос x=500); „i“ и стъблото на „n“ са
 * вертикали; диагоналът на „n“ е точно 45°; всички чупки са радиусни закръгления (дъги, апроксимирани
 * с кубични Безие); крайните точки на „i“, „n“ и ъглите долу лежат на обща долна линия.
 * Листото е лещa от две еднакви дъги. node scripts/build-mark.mjs && npm run build:brand
 */
import fs from 'node:fs';
const W = 54;                                  // дебелина (за справка; рисува се в build-brand.mjs)
const CX = 485, XI = 365, XN = 455, NTOP = 692, B = 884, BR = 892, ITOP = 606, NEND = 922;
const XE = XN + (BR - NTOP);                   // краят на диагонала (45°)
const f = (n) => +n.toFixed(2);
const P = (p) => `${f(p[0])},${f(p[1])}`;
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const unit = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
/** Заобляне на ъгъл C между посоки d1 (вход) и d2 (изход) с радиус r → {a, b, curve} */
function fillet(C, d1, d2, r) {
  const dot = d1[0] * d2[0] + d1[1] * d2[1];
  const th = Math.acos(Math.max(-1, Math.min(1, dot)));          // отклонение
  const t = r * Math.tan(th / 2), k = (4 / 3) * Math.tan(th / 4) * r;
  const a = add(C, d1, -t), b = add(C, d2, t);
  return { a, b, c: `C${P(add(a, d1, k))} ${P(add(b, d2, -k))} ${P(b)}` };
}
const D = Math.SQRT1_2;
const down = [0, 1], upLeft = [-D, -D], downLeft = [-D, D];
const sideL = [-0.62, -0.78], sideR = [-0.62, 0.78];   // страните влизат в долните ъгли под ~33°
const mir = (p) => [2 * CX - p[0], p[1]];
// ляв ъгъл: „i“ надолу → лявата страна нагоре-наляво
const fL = fillet([XI, B], down, sideL, 16);
const A = fL.b;
// лява половина на ябълката (отдолу нагоре до вдлъбнатината)
const M = [180, 770], dM = [-0.6, -0.8];          // долу вляво: точка и посока (нагоре) по образеца
const L = [71, 540], T = [282, 300], N = [CX, 376];
// Долните части на страните — напаснати по образеца (отклонение ≤ 2.5 px): ъгълът при „i“ е стегнато заобляне.
const SL = [254, 880], dSL = [-0.76, -0.65], SR = [726, 880], dSR = [-0.74, 0.67];
const left = [
  `L${P([XI, 880])}`, `C${P([XI, 918])} ${P(add(SL, dSL, -50))} ${P(SL)}`,
  `C${P(add(SL, dSL, 134))} ${P([L[0], L[1] + 124])} ${P(L)}`,
  `C${P([L[0], L[1] - 165])} ${P([T[0] - 112, T[1]])} ${P(T)}`,
  `C${P([T[0] + 92, T[1]])} ${P([N[0] - 50, N[1]])} ${P(N)}`
];
const fR = fillet([XE, BR], sideR, upLeft, 46);   // десен ъгъл: страната → диагонала (90°)
// дясна половина — огледална, обратно
const right = [
  `C${P(mir([N[0] - 50, N[1]]))} ${P(mir([T[0] + 92, T[1]]))} ${P(mir(T))}`,
  `C${P(mir([T[0] - 112, T[1]]))} ${P(mir([L[0], L[1] - 165]))} ${P(mir(L))}`,
  `C${P(mir([L[0], L[1] + 131]))} ${P(add(SR, dSR, -136))} ${P(SR)}`,
  `C${P(add(SR, dSR, 40))} ${P([671, 908])} ${P([650, 887])}`
];
// връх на „n“: диагоналът нагоре-наляво → стъблото надолу (135°)
const fN = fillet([XN, NTOP], upLeft, down, 46);
// долната линия: най-ниската точка на ъглите → крайните точки на „i“/„n“ стоят на нея
const low = (fl, d1, C) => C[1];   // справка
const stroke = [
  `M${P([XI, ITOP])}`, ...left, ...right,
  `L${P(fN.a)}`, fN.c, `L${P([XN, NEND])}`
].join(' ');
// листо: леща между основата и върха, две еднакви дъги
const base = [482, 300], tip = [716, 64];
const v = [tip[0] - base[0], tip[1] - base[1]], len = Math.hypot(...v), n = unit([v[1], -v[0]]);
const s = len * 0.45, mid = add(base, v, 0.5);
const c1 = add(mid, n, s * 1.8), c2 = add(mid, n, -s * 0.3);   // горната дъга по-изпъкнала (по образеца)
const q = (c) => [add(base, [c[0] - base[0], c[1] - base[1]], 2 / 3), add(tip, [c[0] - tip[0], c[1] - tip[1]], 2 / 3)];
const [a1, b1] = q(c1), [a2, b2] = q(c2);
const leaf = 'M482,300 C442,222 468,112 560,80 C622,60 680,58 716,64 C708,150 662,200 602,224 C552,244 512,262 482,300 Z';   // по образеца
const pad = W / 2 + 8;
const box = { x: Math.floor(L[0] - pad), y: Math.floor(tip[1] - pad), w: Math.ceil(2 * CX - 2 * L[0] + 2 * pad), h: Math.ceil(NEND - tip[1] + 2 * pad) };
fs.writeFileSync(new URL('../brand/nutriin-mark.json', import.meta.url), JSON.stringify({
  note: 'Знакът Nutriin — геометричен чертеж (scripts/build-mark.mjs): симетрична ябълка, „i“ и „n“ на обща долна линия, диагонал 45°, радиусни заобляния, листо-леща. Рисува се като щрих.',
  width: W, box, stroke, leaf }, null, 1) + '\n');
console.log('mark ok', box);
