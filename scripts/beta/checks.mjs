/** Проверки на един екран (кадър): хоризонтален скрол, цели за докосване, числа по картите. */
export async function screenChecks(frame) {
  return frame.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = { overflowX: document.documentElement.scrollWidth - vw > 2, smallTargets: [], numericCards: [] };
    const seen = new Set();
    for (const el of document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || r.bottom < 0 || r.top > innerHeight * 3) continue;
      // Свързан текст вътре в абзац не е самостоятелна цел.
      if (el.tagName === 'A' && el.closest('p, li') && cs.display === 'inline') continue;
      if (r.width < 40 || r.height < 40) {
        const name = (el.getAttribute('aria-label') || el.textContent || el.id || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 40);
        const key = name + Math.round(r.width) + 'x' + Math.round(r.height);
        if (!seen.has(key)) { seen.add(key); out.smallTargets.push(`${name} (${Math.round(r.width)}×${Math.round(r.height)})`); }
      }
    }
    for (const c of document.querySelectorAll('.meal-card')) {
      const t = c.innerText || '';
      if (/\d+\s*(kcal|ккал)/i.test(t)) out.numericCards.push(t.split('\n')[0].slice(0, 50));
    }
    out.smallTargets = out.smallTargets.slice(0, 15);
    return out;
  });
}
