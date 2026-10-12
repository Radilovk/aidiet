/**
 * AI като готвач и кулинарен критик — извън плана, при подготовката на данните.
 * Gemini пише рецепти за ястията без рецепта и преглежда съчетанията; всичко
 * минава през същата проверка като ръчно писаните (validate.mjs). Нищо не
 * стига до клиент без преглед: рецептите влизат в data/engine/recipes.json
 * чрез PR, а находките на прегледа са само предложения (culinary-audit.json).
 *
 *   GEMINI_API_KEY=… node scripts/culinary/ai-culinary.mjs recipes   # само липсващите рецепти
 *   GEMINI_API_KEY=… node scripts/culinary/ai-culinary.mjs audit     # преглед на всички ястия
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DISHES, food } from '../../nutrition-engine/knowledge.js';
import { partRefs, recipeIssues } from '../../nutrition-engine/recipes.js';
import { FOOD_LABELS } from './validate.mjs';

const mode = process.argv[2] || 'recipes';
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
if (!key) {
  console.error('Липсва GEMINI_API_KEY (GitHub → Settings → Secrets → Actions).');
  process.exit(1);
}

const root = new URL('../../', import.meta.url);
const recipesFile = new URL('data/engine/recipes.json', root);
const auditFile = new URL('data/engine/culinary-audit.json', root);
const SYSTEM = readFileSync(new URL('culinary-prompt.md', import.meta.url), 'utf8');

/** Ястието така, както го вижда AI: части с имена и варианти с етикети. */
export function dishForPrompt(dish) {
  const refs = partRefs(dish);
  return {
    id: dish.id,
    meals: dish.meals,
    name: dish.name,
    currentPrep: dish.prep,
    parts: dish.parts.map((p, i) => ({
      ref: refs[i],
      optional: !(p.range[0] > 0),
      onlyStyles: p.onlyStyles || undefined,
      onlyPatterns: p.onlyPatterns || undefined,
      options: p.options.map((o) => o.map((id) => food(id).label).join(' + ')),
    })),
    fixed: dish.fixed.map(([id]) => food(id).label),
    sides: dish.sides,
  };
}

async function ask(text) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 16384, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return JSON.parse((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
}

const doc = JSON.parse(readFileSync(recipesFile, 'utf8'));
const BATCH = 6;

if (mode === 'recipes') {
  const pending = DISHES.filter((d) => !doc.recipes[d.id]);
  console.log(`ястия без рецепта: ${pending.length}`);
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    let feedback = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const out = await ask(`Напиши САМО рецепти (audit може да е празен) за:\n${JSON.stringify(batch.map(dishForPrompt))}${feedback}`);
        const bad = [];
        for (const dish of batch) {
          if (doc.recipes[dish.id]) continue;
          const recipe = out?.recipes?.[dish.id];
          const issues = recipeIssues(dish, recipe, FOOD_LABELS);
          if (issues.length) bad.push(`${dish.id}: ${issues.join('; ')}`);
          else doc.recipes[dish.id] = recipe;
        }
        if (!bad.length) break;
        // Втори опит: AI получава точно какво не е минало проверката.
        feedback = `\n\nПредишният отговор не мина проверката:\n${bad.join('\n')}\nПоправи тези рецепти.`;
        console.log(`опит ${attempt}: ${bad.length} рецепти не минаха проверката`);
      } catch (e) {
        console.error(`партида ${i / BATCH + 1}, опит ${attempt}: ${e.message}`);
      }
    }
    writeFileSync(recipesFile, `${JSON.stringify(doc, null, 2)}\n`);
  }
  console.log(`с рецепта: ${DISHES.filter((d) => doc.recipes[d.id]).length} / ${DISHES.length}`);
} else if (mode === 'audit') {
  const findings = [];
  for (let i = 0; i < DISHES.length; i += BATCH) {
    const batch = DISHES.slice(i, i + BATCH);
    try {
      const out = await ask(`Направи САМО кулинарния преглед (recipes може да е празен) за:\n${JSON.stringify(batch.map(dishForPrompt))}`);
      const ids = new Set(batch.map((d) => d.id));
      for (const f of Array.isArray(out?.audit) ? out.audit : []) if (ids.has(f?.dishId)) findings.push(f);
    } catch (e) {
      console.error(`партида ${i / BATCH + 1}: ${e.message}`);
    }
  }
  writeFileSync(auditFile, `${JSON.stringify({ about: 'Предложения от AI прегледа — прилагат се след човешки преглед (dishes.json / pairings.json).', model, findings }, null, 2)}\n`);
  for (const f of findings) console.log(`- ${f.dishId} ${f.type} ${f.ref || ''} ${f.option || ''} — ${f.reason}`);
  console.log(`находки: ${findings.length}`);
} else {
  console.error(`непознат режим „${mode}“ (recipes | audit)`);
  process.exit(1);
}
