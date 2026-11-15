# Центрова линия на примката (за линия с прекъсвания): скелет на огледалната маска → гладка крива.
# Центровата линия на примката → brand/mark-center.json (за знака с тирета, scripts/mark-tech.mjs).
#   python3 scripts/trace-center.py > brand/mark-center.json   (нужни: scikit-image, scipy)
import sys, json, numpy as np
from PIL import Image
from collections import deque
from skimage.morphology import skeletonize
from scipy.ndimage import distance_transform_edt, label
from scipy.interpolate import splprep, splev
a = np.array(Image.open('brand/concept-eatologix.png').convert('RGB')).astype(int)
mask = a.max(axis=2) > 120
lab, n = label(mask); sizes = np.bincount(lab.ravel()); sizes[0] = 0
loop = lab == sizes.argmax()
xs = np.nonzero(loop.any(axis=0))[0]; axis = (xs.min() + xs.max()) / 2
H, W = loop.shape; f = loop.astype(float); mir = np.zeros_like(f)
for x in range(W):
    xm = 2 * axis - x; x0 = int(np.floor(xm)); t = xm - x0
    if 0 <= x0 < W - 1: mir[:, x] = (1 - t) * f[:, x0] + t * f[:, x0 + 1]
sym = (f + mir) / 2 >= 0.5
dt = distance_transform_edt(sym); sk = skeletonize(sym)
width = 2 * float(np.median(dt[sk]))
# Лявата половина на скелета (без кръстовището): отворена крива.
cut = int(axis - width * 1.2)
L = sk.copy(); L[:, cut:] = False
ys, xs2 = np.nonzero(L); pts = set(zip(ys, xs2))
def nb(p): return [(p[0]+dy, p[1]+dx) for dy in (-1,0,1) for dx in (-1,0,1) if (dy or dx) and (p[0]+dy, p[1]+dx) in pts]
ends = [p for p in pts if len(nb(p)) == 1]
ends.sort(key=lambda p: -p[0])                     # долният край (диагоналът) първи
cur, prev, order = ends[0], None, [ends[0]]; seen = {ends[0]}
while True:
    nx = [q for q in nb(cur) if q not in seen]
    if not nx: break
    cur = min(nx, key=lambda q: abs(q[0]-cur[0]) + abs(q[1]-cur[1])); seen.add(cur); order.append(cur)
P = np.array([(x, y) for y, x in order], float)
# Кръстовището: средата между двата края, на оста.
col = np.nonzero(sym[:, int(round(axis))])[0]
run = [col[0]]
for r in col[1:]:
    if r != run[-1] + 1: break
    run.append(r)
C = np.array([axis, (run[0] + run[-1]) / 2])
print('C', C, 'ends', P[0], P[-1], file=sys.stderr)
left = np.vstack([C, P[::4]])
right = left.copy(); right[:, 0] = 2 * axis - right[:, 0]
full = np.vstack([left, right])                    # затворена фигура осем през кръстовището
tck, _ = splprep([full[:, 0], full[:, 1]], s=len(full) * 1.5, per=True)
u = np.linspace(0, 1, 1600, endpoint=False); X, Y = splev(u, tck)
pts = np.stack([X, Y], 1)
# Огледална симетрия: лявата половина от гладката крива + огледалото ѝ.
print(json.dumps({'axis': axis, 'width': round(width, 1), 'pts': [[round(x, 2), round(y, 2)] for x, y in pts]}))
