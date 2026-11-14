# Трасира знака от логото с прозрачност: ябълката+отметката и листото поотделно → SVG пътища
# в координатите на оригинала (1536×1024). Резултат: JSON {apple, leaf}.
import sys, json
import numpy as np
from PIL import Image, ImageFilter
import potrace
src = Image.open(sys.argv[1]).convert('RGBA')
SCALE = 3  # по-гладка трасировка
a = np.array(src.getchannel('A'))
rgb = np.array(src.convert('RGB')).astype(int)
H, W = a.shape
mask = a > 127
# само знакът (над надписа)
mask[790:, :] = False
# листото: горе вдясно, над ябълката (y < 282 и x > 742) — по свързаност
from collections import deque
lab = np.zeros(mask.shape, int); comp = 0; sizes = {}
for y in range(H):
    for x in range(W):
        if mask[y, x] and not lab[y, x]:
            comp += 1; q = deque([(y, x)]); lab[y, x] = comp; n = 0
            while q:
                cy, cx = q.popleft(); n += 1
                for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny, nx = cy+dy, cx+dx
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = comp; q.append((ny, nx))
            sizes[comp] = n
big = sorted(sizes, key=lambda k: -sizes[k])[:2]
def centroid_y(c): ys, xs = np.nonzero(lab == c); return ys.mean()
leaf_c, apple_c = sorted(big, key=centroid_y)
def trace(c):
    m = Image.fromarray(((lab == c) * 255).astype('uint8'))
    m = m.resize((W * SCALE, H * SCALE), Image.LANCZOS).filter(ImageFilter.GaussianBlur(SCALE * 2.2))
    bm = potrace.Bitmap(np.array(m) < 128)  # potracer: True = фон
    path = bm.trace(turdsize=50, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.3, opticurve=True, opttolerance=1.2)
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
print(json.dumps({'apple': trace(apple_c), 'leaf': trace(leaf_c), 'sizes': [sizes[apple_c], sizes[leaf_c]]}))
