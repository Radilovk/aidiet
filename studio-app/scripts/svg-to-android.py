#!/usr/bin/env python3
"""brand/xbody-logo.svg → android-extra/xb_logo_paths.xml (Android vector paths, 432 x 432 viewport).
Run in studio-app/ after changing the SVG; scripts/patch-android.py wraps the paths into the launch drawables."""
import re
import xml.etree.ElementTree as ET

src = re.sub(r'<!--.*?-->', '', open('brand/xbody-logo.svg', encoding='utf-8').read(), flags=re.S)
root = ET.fromstring(src)
NS = '{http://www.w3.org/2000/svg}'
def col(c):
    c = c.lstrip('#')
    if len(c) == 3: c = ''.join(x * 2 for x in c)
    return '#FF' + c.upper()
def rrect(x, y, w, h, r):
    return (f'M{x+r},{y}H{x+w-r}Q{x+w},{y} {x+w},{y+r}V{y+h-r}Q{x+w},{y+h} {x+w-r},{y+h}'
            f'H{x+r}Q{x},{y+h} {x},{y+h-r}V{y+r}Q{x},{y} {x+r},{y}Z')
out = []
def walk(el, fill, ind):
    tag = el.tag.replace(NS, '')
    f = el.get('fill', fill)
    if tag == 'circle':
        cx, cy, r = (float(el.get(k)) for k in ('cx', 'cy', 'r'))
        out.append(f'{ind}<path android:fillColor="{col(f)}" android:pathData="M{cx-r},{cy}a{r},{r} 0 1,0 {2*r},0a{r},{r} 0 1,0 {-2*r},0Z"/>')
    elif tag == 'rect':
        x, y, w, h = (float(el.get(k)) for k in ('x', 'y', 'width', 'height'))
        out.append(f'{ind}<path android:fillColor="{col(f)}" android:pathData="{rrect(x, y, w, h, float(el.get("rx", "0")))}"/>')
    elif tag == 'path':
        ft = ' android:fillType="evenOdd"' if el.get('fill-rule') == 'evenodd' else ''
        out.append(f'{ind}<path android:fillColor="{col(f)}"{ft} android:pathData="{el.get("d")}"/>')
    elif tag == 'g':
        m = re.match(r'rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)', el.get('transform', ''))
        if m: out.append(f'{ind}<group android:rotation="{m[1]}" android:pivotX="{m[2]}" android:pivotY="{m[3]}">')
        for c in el: walk(c, f, ind + '  ')
        if m: out.append(f'{ind}</group>')
for c in root: walk(c, '#000000', '    ')
open('android-extra/xb_logo_paths.xml', 'w', encoding='utf-8').write(
    '<!-- the XBODY logo as Android vector paths (432 x 432 viewport), made from brand/xbody-logo.svg by scripts/svg-to-android.py -->\n'
    + '\n'.join(out) + '\n')
print('android-extra/xb_logo_paths.xml')
