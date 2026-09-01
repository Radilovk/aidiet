/**
 * Shared helpers for static list editors (load JSON, edit, download).
 */
export function parseCsv(s) {
  return String(s || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean);
}

export function joinCsv(arr) {
  return (arr || []).join(', ');
}

export function setStatus(el, text, kind = '') {
  if (!el) return;
  el.textContent = text;
  el.className = 'status' + (kind ? ` ${kind}` : '');
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function loadListJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Неуспешно зареждане (${r.status})`);
  return r.json();
}

export function filterRows(rows, q, fields) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(row => {
    const hay = fields.map(f => {
      const v = row[f];
      if (Array.isArray(v)) return v.join(' ');
      if (typeof v === 'object' && v) return JSON.stringify(v);
      return String(v ?? '');
    }).join(' ').toLowerCase();
    return hay.includes(needle);
  });
}

export function bindFileImport(inputEl, onData) {
  inputEl.addEventListener('change', async () => {
    const file = inputEl.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      onData(data);
    } catch (e) {
      alert('Невалиден JSON: ' + e.message);
    }
    inputEl.value = '';
  });
}

export function productLinesToArray(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(.+?)\s*[:|,]\s*(\d+(?:\.\d+)?)\s*g?$/i);
    if (!m) throw new Error(`Ред "${line}" — формат: продукт: грамове`);
    return { name: m[1].trim(), grams: Number(m[2]) };
  });
}

export function productsToLines(products) {
  return (products || []).map(p => `${p.name}: ${p.grams}`).join('\n');
}
