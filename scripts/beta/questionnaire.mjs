/** Попълва questionnaire2.html като персоната — въпрос по въпрос, през интерфейса. */
import { answerFor } from './personas.mjs';

export async function fillQuestionnaire(page, persona, { maxSteps = 160, trail = [] } = {}) {
  for (let i = 0; i < maxSteps; i++) {
    if (/plan-pending|analysis\.html|plan\.html|index\.html/.test(page.url())) return { done: true, trail };
    const consent = await page.$('#consentCheck');
    if (consent) { await consent.check(); await page.click('#consentOk'); await page.waitForTimeout(400); continue; }
    const q = await page.evaluate(() => {
      try { const s = currentQueue[currentIndex]; return s ? { id: s.id, type: s.type, options: s.options || [], idx: currentIndex, len: currentQueue.length, optional: !!s.optional } : null; } catch { return null; }
    });
    const next = await page.$('#nextBtn');
    const nextVisible = next && await next.isVisible();
    if (!q || !nextVisible) {
      // Изпращане / зареждане — чакаме смяна на страницата.
      await page.waitForTimeout(500);
      if (i > 0 && !nextVisible) {
        // Изпратено: чакаме плана (или грешка на екрана) до 90 сек.
        try { await page.waitForURL(/plan-pending|analysis\.html|plan\.html|index\.html/, { timeout: 90000 }); return { done: true, trail }; }
        catch { const t = await page.evaluate(() => document.body.innerText.slice(0, 600)); return { done: false, endText: t.replace(/\s+/g, ' '), trail }; }
      }
      continue;
    }
    const ans = answerFor(persona, q);
    trail.push({ id: q.id, type: q.type, ans });
    if (['text', 'number', 'email'].includes(q.type)) {
      await page.fill('.question-card input.modern-input, input.modern-input', String(ans));
    } else if (q.type === 'textarea') {
      if (ans) await page.fill('textarea.modern-input', ans);
    } else if (q.type === 'radio' || q.type === 'checkbox') {
      const want = Array.isArray(ans) ? ans : [ans];
      for (const w of want) {
        const label = page.locator('label.option-label', { has: page.locator(`input.option-input[value="${w.replace(/"/g, '\\"')}"]`) });
        if (await label.count()) await label.first().click();
      }
    }
    await page.waitForTimeout(150);
    const before = q.idx;
    const moved = await page.evaluate((b) => { try { return currentIndex !== b; } catch { return false; } }, before);
    if (!moved) {
      const enabled = await page.$eval('#nextBtn', (b) => !b.disabled).catch(() => false);
      if (!enabled) return { done: false, stuck: q, trail };
      await page.click('#nextBtn');
      await page.waitForTimeout(250);
    }
  }
  return { done: false, trail };
}
