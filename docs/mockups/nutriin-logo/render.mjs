import { variants, G } from './variants.mjs';
import fs from 'fs';
const mark = (k, c, size, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" style="background:${bg||'transparent'}">${variants[k].svg(c)}</svg>`;
const tile = (k, size) => `<div class="tile" style="width:${size}px;height:${size}px;border-radius:${size*0.23}px">${mark(k,'#fff',size*0.72)}</div>`;
let rows='';
for (const k of Object.keys(variants)) {
  const v=variants[k];
  rows+=`<section><header><b>${k} · ${v.name}</b><p>${v.idea}</p></header><div class="row">
   <div class="cell light">${mark(k,G,190)}</div>
   <div class="cell dark">${mark(k,'#3FD884',190)}</div>
   <div class="cell icons">${tile(k,96)}<div class="small">${mark(k,G,48)}${mark(k,G,32)}${mark(k,G,20)}</div></div></div></section>`;
}
fs.writeFileSync('sheet.html',`<!DOCTYPE html><meta charset="utf-8"><style>
body{margin:0;padding:28px;background:#EEF4F2;font:15px/1.45 Inter,system-ui,sans-serif;color:#0E2A27;width:980px}
h1{font-size:26px;margin:0 0 4px}.sub{margin:0 0 22px;color:#4E6B66}
section{background:#fff;border-radius:22px;padding:18px 20px;margin-bottom:16px;box-shadow:0 12px 30px -20px rgba(0,0,0,.3)}
header b{font-size:18px}header p{margin:4px 0 12px;color:#4E6B66;max-width:880px}
.row{display:flex;gap:14px;align-items:center}.cell{width:260px;height:230px;border-radius:16px;display:grid;place-items:center}
.light{background:#fff;border:1px solid #e3ece8}.dark{background:#071312}
.icons{display:flex;flex-direction:column;gap:16px;justify-content:center;align-items:center;background:#F5F8F7}
.tile{display:grid;place-items:center;background:linear-gradient(155deg,#16B05C,#0B8743);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 10px 24px -10px rgba(11,135,67,.7)}
.small{display:flex;gap:18px;align-items:center}
</style><h1>Nutri In — варианти на знака</h1><p class="sub">Без букви на пръв поглед; „in“ е скрито във формата. Светъл фон · тъмен фон · икона на приложението · 48 / 32 / 20 px.</p>${rows}`);
