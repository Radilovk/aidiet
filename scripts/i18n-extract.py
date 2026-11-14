#!/usr/bin/env python3
"""Изважда статичния български текст от HTML страница (текст + aria-label/placeholder/title/alt/value).
   python3 scripts/i18n-extract.py page.html [--missing i18n/en/page.json] → JSON списък."""
import sys, json, re
from html.parser import HTMLParser
CYR = re.compile('[Ѐ-ӿ]')
SKIP = {'script', 'style', 'noscript', 'textarea', 'code', 'pre', 'svg'}
ATTRS = {'aria-label', 'placeholder', 'title', 'alt'}
class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.stack = []; self.out = []; self.skipdepth = 0
    def handle_starttag(self, tag, attrs):
        if tag in SKIP: self.skipdepth += 1
        a = dict(attrs)
        if 'data-i18n-skip' in a and tag not in ('input','img','meta','br','hr','link'): pass
        for k, v in attrs:
            if v and (k in ATTRS or (k == 'value' and tag == 'input' and a.get('type') in ('button', 'submit'))) and CYR.search(v):
                self.out.append(' '.join(v.split()))
        if tag == 'meta' and a.get('content') and CYR.search(a['content']) and re.match(r'(description|og:|twitter:)', a.get('name') or a.get('property') or ''):
            self.out.append(' '.join(a['content'].split()))
    def handle_endtag(self, tag):
        if tag in SKIP and self.skipdepth: self.skipdepth -= 1
    def handle_data(self, d):
        if self.skipdepth: return
        t = ' '.join(d.split())
        if t and CYR.search(t): self.out.append(t)
src = open(sys.argv[1], encoding='utf-8').read()
p = P(); p.feed(src)
seen = []; s = set()
for t in p.out:
    if t not in s: s.add(t); seen.append(t)
if '--missing' in sys.argv:
    try: have = json.load(open(sys.argv[sys.argv.index('--missing') + 1], encoding='utf-8')).get('strings', {})
    except FileNotFoundError: have = {}
    seen = [t for t in seen if t not in have]
print(json.dumps(seen, ensure_ascii=False, indent=0))
