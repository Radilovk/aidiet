#!/usr/bin/env node
/**
 * Знакът Nutriin — геометричен чертеж (централна линия), записва brand/nutriin-mark.json.
 * Конструкция в квадрат 1000: ябълката е огледално симетрична (ос x=500); „i“ и стъблото на „n“ са
 * вертикали; диагоналът на „n“ е точно 45°; всички чупки са радиусни закръгления (дъги, апроксимирани
 * с кубични Безие); крайните точки на „i“, „n“ и ъглите долу лежат на обща долна линия.
 * Листото е лещa от две еднакви дъги. node scripts/build-mark.mjs && npm run build:brand
 */
import fs from 'node:fs';
const W = 46;                                  // дебелина (за справка; рисува се в build-brand.mjs)
const XI = 335, XN = 445, NTOP = 680, B = 900, ITOP = 520, NEND = 884;
const XE = XN + (B - NTOP);                    // краят на диагонала (45°) = 665, огледален на XI
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
const mir = (p) => [1000 - p[0], p[1]];
// ляв ъгъл: „i“ надолу → лявата страна нагоре-наляво
const fL = fillet([XI, B], down, upLeft, 44);
const A = add(fL.b, upLeft, 0);
// лява половина на ябълката (отдолу нагоре до вдлъбнатината)
const L = [96, 380], T = [284, 168], N = [500, 246];
const left = [
  `L${P(A)}`,
  `C${P(add(A, upLeft, 150))} ${P([L[0], L[1] + 250])} ${P(L)}`,
  `C${P([L[0], L[1] - 125])} ${P([T[0] - 108, T[1]])} ${P(T)}`,
  `C${P([T[0] + 92, T[1]])} ${P([N[0] - 50, N[1]])} ${P(N)}`
];
// дясна половина — огледална, обратно
const right = [
  `C${P(mir([N[0] - 50, N[1]]))} ${P(mir([T[0] + 92, T[1]]))} ${P(mir(T))}`,
  `C${P(mir([T[0] - 108, T[1]]))} ${P(mir([L[0], L[1] - 125]))} ${P(mir(L))}`,
  `C${P(mir([L[0], L[1] + 250]))} ${P(mir(add(A, upLeft, 150)))} ${P(mir(A))}`
];
// десен ъгъл: страната надолу-наляво → диагоналът нагоре-наляво (90°)
const fR = fillet([XE, B], downLeft, upLeft, 44);
// връх на „n“: диагоналът нагоре-наляво → стъблото надолу (135°)
const fN = fillet([XN, NTOP], upLeft, down, 46);
// долната линия: най-ниската точка на ъглите → крайните точки на „i“/„n“ стоят на нея
const low = (fl, d1, C) => C[1];   // справка
const stroke = [
  `M${P([XI, ITOP])}`, `L${P(fL.a)}`, fL.c, ...left, ...right,
  `L${P(fR.a)}`, fR.c, `L${P(fN.a)}`, fN.c, `L${P([XN, NEND])}`
].join(' ');
// листо: леща между основата и върха, две еднакви дъги
const base = [516, 182], tip = [738, -10];
const v = [tip[0] - base[0], tip[1] - base[1]], len = Math.hypot(...v), n = unit([v[1], -v[0]]);
const s = len * 0.34, mid = add(base, v, 0.5);
const c1 = add(mid, n, s * 1.33), c2 = add(mid, n, -s * 1.33);
const q = (c) => [add(base, [c[0] - base[0], c[1] - base[1]], 2 / 3), add(tip, [c[0] - tip[0], c[1] - tip[1]], 2 / 3)];
const [a1, b1] = q(c1), [a2, b2] = q(c2);
const leaf = `M${P(base)} C${P(a1)} ${P(b1)} ${P(tip)} C${P(b2)} ${P(a2)} ${P(base)} Z`;
const pad = W / 2 + 8;
const box = { x: Math.floor(L[0] - pad), y: Math.floor(tip[1] - pad), w: Math.ceil(1000 - 2 * L[0] + 2 * pad), h: Math.ceil(B - tip[1] + 2 * pad) };
fs.writeFileSync(new URL('../brand/nutriin-mark.json', import.meta.url), JSON.stringify({
  note: 'Знакът Nutriin — геометричен чертеж (scripts/build-mark.mjs): симетрична ябълка, „i“ и „n“ на обща долна линия, диагонал 45°, радиусни заобляния, листо-леща. Рисува се като щрих.',
  width: W, box, stroke, leaf }, null, 1) + '\n');
console.log('mark ok', box);
