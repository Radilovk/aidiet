#!/usr/bin/env python3
"""Трасира знака от концепцията (ярка форма върху тъмен фон) → SVG пътища (JSON).

   python3 scripts/trace-mark.py brand/concept-eatologix.png > brand/mark-trace.json

- Примката (най-голямата форма) става огледална: маската се осреднява със своето отражение
  около оста, после се изглажда — двете половини са еднакви, без неравностите на рисунката.
- Отметката (втората форма) се трасира такава, каквато е.
Координатите са тези на изображението.
"""
import sys, json
import numpy as np
from PIL import Image, ImageFilter
from collections import deque
import potrace

src = Image.open(sys.argv[1]).convert('RGB')
a = np.array(src).astype(int)
H, W, _ = a.shape
mask = a.max(axis=2) > 120          # формата е ярка (циан/зелено), фонът и сиянието — тъмни

lab = np.zeros(mask.shape, int); sizes = {}; comp = 0
for y in range(H):
    for x in range(W):
        if mask[y, x] and not lab[y, x]:
            comp += 1; q = deque([(y, x)]); lab[y, x] = comp; n = 0
            while q:
                cy, cx = q.popleft(); n += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = comp; q.append((ny, nx))
            sizes[comp] = n
loop_c, check_c = sorted(sizes, key=lambda k: -sizes[k])[:2]

SCALE = 3
def to_path(m, blur):
    img = Image.fromarray((m * 255).astype('uint8')).resize((W * SCALE, H * SCALE), Image.LANCZOS)
    img = img.filter(ImageFilter.GaussianBlur(SCALE * blur))
    bm = potrace.Bitmap(np.array(img) < 128)          # potracer: True = фон
    path = bm.trace(turdsize=80, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.3,
                    opticurve=True, opttolerance=1.0)
    k = 1 / SCALE; out = []
    for curve in path:
        sp = curve.start_point; out.append(f'M{sp.x*k:.1f},{sp.y*k:.1f}')
        for seg in curve.segments:
            if seg.is_corner:
                out.append(f'L{seg.c.x*k:.1f},{seg.c.y*k:.1f} L{seg.end_point.x*k:.1f},{seg.end_point.y*k:.1f}')
            else:
                out.append(f'C{seg.c1.x*k:.1f},{seg.c1.y*k:.1f} {seg.c2.x*k:.1f},{seg.c2.y*k:.1f} {seg.end_point.x*k:.1f},{seg.end_point.y*k:.1f}')
        out.append('Z')
    return ' '.join(out)

# Оста: средата на примката по ширина.
loop = (lab == loop_c)
xs = np.nonzero(loop.any(axis=0))[0]
axis = (xs.min() + xs.max()) / 2
# Огледално осредняване (с подпиксел: отражение на мащабирана маска).
f = loop.astype(float)
mirror = np.zeros_like(f)
for x in range(W):
    xm = 2 * axis - x
    x0 = int(np.floor(xm)); t = xm - x0
    if 0 <= x0 < W - 1: mirror[:, x] = (1 - t) * f[:, x0] + t * f[:, x0 + 1]
sym = ((f + mirror) / 2) >= 0.5

ys = np.nonzero(sym.any(axis=1))[0]
print(json.dumps({
    'axis': round(float(axis), 1),
    'box': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
    'loop': to_path(sym, 2.2),
    'check': to_path(lab == check_c, 2.2),
}))
