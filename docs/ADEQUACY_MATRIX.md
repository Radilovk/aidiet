# Adequacy Matrix — правила, тестове, покритие

Референция за NutriPlan rebuild: кое правило **къде** се проверява и какво **не** е покрито.

## Трите слоя

| Слой | Правило | Offline | Live matrix |
|------|---------|---------|-------------|
| **1. Deterministic wrapper** | Frozen scheme (slot kcal/P/C/F не се пренаписват) | `test-plan-adequacy-contract` §11 | kamen_benchmark |
| | DietRegistry само стеснява | `test-registry-arch` | aip_autoimmune, keto_pref |
| | Atomic fixed portions | `test-registry-arch`, `test-ready-meal-expand` | — (implicit in catalog) |
| | H3/H5 slot caps & content | contract §2–5, dietetic §5 | kamen_benchmark (H5) |
| | Skip breakfast | `test-skip-breakfast`, contract §10 | skip_breakfast_athlete, kamen_benchmark |
| | Fixed dessert / free meal inject | worker contract tests | skip_breakfast_athlete (dessert) |
| **2. AI composition** | Products only, no grams from AI | `test-rebuild-stage1`, KV prompts | all matrix (implicit) |
| | Week-at-once `DAYS_PER_CHUNK=7` | `test-rebuild-stage2-week` | all matrix |
| **3. Solver + validation** | `solveMealGrams` kcal hard, macros soft | `test-solver`, `test-chunk-validation` | kamen_benchmark |
| | Slot kcal ±10% blocking | contract §1, nutrition validators | all matrix |
| | Daily macro grams soft when kcal OK | `test-chunk-validation` | generationWarnings in matrix report |
| | Composition repair (slot-level) | `test-rebuild-stage17-2` | — (runtime only) |

---

## Приоритети P1 / P2 / P3

### P1 — Nutrition math

| Правило | Offline тест | Matrix профил |
|---------|--------------|---------------|
| Slot kcal ±10% | `test-solver`, `test-plan-adequacy-nutrition` | **kamen_benchmark**, всички |
| Weight ≤900g, min per slot | `test-solver`, `validateMealGramsAndWeight` | kamen_benchmark |
| P×4+C×4+F×9 | `validateMealMacroArithmetic` | всички |
| Macros от written grams | `validateMealMacrosFromGrams` | всички |
| Fish+potato infeasible @1112 | `test-solver` regression | kamen_benchmark |
| High-kcal feasible (chicken+rice+oil) | `test-solver` | kamen_benchmark |
| Дневен kcal budget | `test-plan-adequacy-nutrition` §3 | всички |

### P2 — Dietetic / clinical

| Правило | Offline тест | Matrix профил |
|---------|--------------|---------------|
| Лактация floor (+300 kcal) | `test-plan-adequacy-dietetic` | **lactation** |
| Кето ≤15% carbs | dietetic + `test-plan-normalize` | **keto_pref** |
| Мускулна маса ≥1.4g/kg | dietetic | **vegan_active** |
| Веган (без животински) | dietetic | **vegan_active** |
| AIP forbidden foods | dietetic + catalog | **aip_autoimmune** |
| Диабет / IR | dietetic | **diabetes_sweets_craving** |
| H3 fruit+nuts, no cooked meat | contract §4 | kamen_benchmark, skip_breakfast_athlete |
| H5 dairy+nuts, no fruit, ≤200 kcal | contract §2–3 | kamen_benchmark |

### P3 — Structure & profile

| Правило | Offline тест | Matrix профил |
|---------|--------------|---------------|
| `weeklyScheme` / `mealBreakdown` | `validateStrategy` | всички |
| Skip breakfast → no H1 | contract §10, `validateProfileRules` | **skip_breakfast_athlete**, kamen_benchmark |
| Dessert само при sweet craving | `validateProfileRules` | skip_breakfast_athlete (да), kamen_benchmark (не) |
| No ready_meal in description | `validateProfileRules` | всички |
| Recommendations + supplements | live/matrix only | всички |
| Weekly variety (warning) | `test-rebuild-stage17-2` | — (non-blocking) |

---

## Команди

```bash
# Offline — без AI (~30s)
npm run test:worker

# Live matrix — 7 AI плана, пълен validator suite
npm run test:plan-adequacy:matrix -- --confirm

# Подмножество (икономично)
npm run test:plan-adequacy:matrix -- --confirm --only=kamen_benchmark,lactation

# Пълен hard benchmark (6+ профила)
npm run test:plan-adequacy:benchmark -- --confirm --profiles=hard
```

### Matrix профили (7 → минимално пълно покритие)

| ID | Покрива |
|----|---------|
| `skip_breakfast_athlete` | skip breakfast, dessert+ sweet, standard P1 |
| `lactation` | postpartum clinical floor |
| `keto_pref` | keto macros |
| `kamen_benchmark` | high-kcal slots ~1112, H5, hard P1 |
| `vegan_active` | vegan + muscle protein |
| `aip_autoimmune` | AIP protocol |
| `diabetes_sweets_craving` | diabetes + dessert |

---

## Какво `npm run test:worker` включва

| Suite | Какво доказва |
|-------|----------------|
| `test-rebuild-stage0` | validatePlan blocking vs soft, medical floors |
| `test-rebuild-stage1` | solver, composition-only, frozen scheme |
| `test-rebuild-stage17-2` | composition repair, #PD, variety |
| `test-rebuild-stage2-week` | DAYS_PER_CHUNK=7, schema day1–7 |
| `test-chunk-validation` | kcal-first chunk blocking/soft split |
| `test-solver` | slot adequacy + infeasibility |
| `test-registry-arch` | overlay, atomic, diet registry, sourceMeta |
| `test-stage3-food` | ledger, adherence, admin catalog wiring |
| `test-skip-breakfast` | prompt + inject contracts |
| `test-plan-adequacy-*` | P1/P2/P3 на fixtures |
| `plan-adequacy` offline | synthetic full week (не AI) |

---

## Непокрито / изисква live или deploy

| Област | Статус |
|--------|--------|
| End-to-end AI adequacy на всички hard profiles | live matrix / benchmark |
| Materials RAG | ❌ няма тест |
| Admin UI (ledger overlay) | contract wiring only |
| Token cap / btoa / Gemini schema hotfixes | production health; няма dedicated regression |
| Chunk validation #1361 на production | изисква merge + deploy преди live PASS |

---

## Критерии за PASS (live matrix)

1. **Генерацията завършва** (не ERROR от worker)
2. **Нулеви issues** от пълния validator suite:
   - analysis, strategy, mealPlan, nutrition, foods, combinations
   - frontend projection, **profile rules**, dietetic
   - recommendations + supplements налични
3. **`generationWarnings`** — не fail-ват, но се отчитат в JSON report (soft daily macro drift след #1361)

Резултатите се записват в `benchmark-results/matrix-live-*.json`.
