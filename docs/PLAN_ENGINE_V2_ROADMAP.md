# Plan Engine v2 — Roadmap

Цел: ястия от каталог → филтър → избор → пропорционално мащабиране. AI само за текст (Step 4–5), не за цяла седмица хранения.

Активиране: `PLAN_ENGINE=v2` (default от етап 5). Legacy: `PLAN_ENGINE=v1`.

**Преди всеки етап:** `git fetch origin main` + merge/rebase — `main` се движи бързо (step2/step3/meal-dishes).

---

## Етап 1 — Резервен път без full-week AI fallback ✅ (този PR)

- [x] `plan-engine.js` — `PLAN_ENGINE=v1|v2`
- [x] `step3-deterministic` — `relaxed` режим (по-мек филтър при липса на ястие)
- [x] `worker.entry.js` — при v2: retry relaxed → без AI fallback за цял chunk
- [x] Тестове + bundle `worker.js`

**Критерий:** при `PLAN_ENGINE=v2` Step 3 никога не пуска `generateMealPlanChunkPrompt` за цяла седмица.

---

## Етап 2 — По-добра ротация ✅ (този PR)

- [x] Седмичен rotation index per slot (`usedDishes` + `slotDishUses`, dish score ×3)
- [x] `dish_tags` в `meal-dishes.js` + `dish-tags.js` (low_carb, gluten_free, liquid_breakfast…)
- [x] Филтър по tags от `questionnaire-engine-map` + `diet-registry` profile

**Критерий:** същото ястие max 1×/ден, min 4 различни main ястия/седмица.

---

## Етап 3 — Slot-level AI repair ✅ (този PR)

- [x] Ако след relaxed няма ястие за 1 слот → 1 AI call с 5 кандидата от каталога
- [x] Промпт без ADLE v8 — само „избери 1 от списъка“
- [x] Резултатът се валидира срещу каталога преди запис

**Критерий:** max 1–2 AI calls за хранения на цял план (само при catalog gap).

---

## Етап 4 — Разширяване на каталога ✅ (този PR)

- [x] Тагове и timing за всички 95+ ястия (inferred + explicit за IR/liquid/sweet)
- [x] IR / liquid breakfast / controlled sweet като отделни ястия в `meal-dishes.js`
- [x] Admin/KV overlay поддържа `tags` без дублиране на източника на истина

**Критерий:** <5% профили без пълен 7-дневен план при v2.

---

## Етап 5 — A/B и default switch ✅ (този PR)

- [x] `_meta.engine` — `planEngine`, `step3Engine`, `slotRepairCalls`, `step3DurationMs`, `dishCatalogCount`
- [x] `buildPlanEngineMeta()` в `plan-engine.js` за сравнение v1 vs v2
- [x] `PLAN_ENGINE=v2` като default (`PLAN_ENGINE=v1` за legacy)
- [x] `docs/CATALOG_EDITING.md` + `scripts/list-catalog-sources.mjs`

**Критерий:** всеки план носи engine telemetry; default е v2.

---

## Справочник за редакция на каталога

- **`docs/CATALOG_EDITING.md`** — ястия, продукти, диети, admin KV, workflow
- **`node scripts/list-catalog-sources.mjs`** — бърз инвентар

---

## Какво НЕ правим

- Нов orchestrator / protocol-engine wire в main flow
- weeklyBlueprint / framework-selector като отделна система
- ADLE правила в AI промптове за Step 3
- SQL база — единствен източник остава `meal-dishes.js`
