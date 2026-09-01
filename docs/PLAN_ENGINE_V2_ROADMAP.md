# Plan Engine v2 — Roadmap

Цел: ястия от каталог → филтър → избор → пропорционално мащабиране. AI само за текст (Step 4–5), не за цяла седмица хранения.

Активиране: `PLAN_ENGINE=v2` (env на Worker). По подразбиране: `v1` (сегашно поведение).

---

## Етап 1 — Резервен път без full-week AI fallback ✅ (този PR)

- [x] `plan-engine.js` — `PLAN_ENGINE=v1|v2`
- [x] `step3-deterministic` — `relaxed` режим (по-мек филтър при липса на ястие)
- [x] `worker.entry.js` — при v2: retry relaxed → без AI fallback за цял chunk
- [x] Тестове + bundle `worker.js`

**Критерий:** при `PLAN_ENGINE=v2` Step 3 никога не пуска `generateMealPlanChunkPrompt` за цяла седмица.

---

## Етап 2 — По-добра ротация (следващ)

- [ ] Седмичен rotation index per slot (не само `usedProducts` count)
- [ ] `dish_tags` в `meal-dishes.js` (low_carb, gluten_free, liquid_breakfast…)
- [ ] Филтър по tags от `questionnaire-engine-map` + diet profile

**Критерий:** същото ястие max 1×/ден, min 4 различни main ястия/седмица.

---

## Етап 3 — Slot-level AI repair (само при дупка)

- [ ] Ако след relaxed няма ястие за 1 слот → 1 AI call с 5 кандидата от каталога
- [ ] Промпт без ADLE v8 — само „избери 1 от списъка“
- [ ] Резултатът се валидира срещу каталога преди запис

**Критерий:** max 1–2 AI calls за хранения на цял план (само при catalog gap).

---

## Етап 4 — Разширяване на каталога (заедно с редакция)

- [ ] Тагове и timing за всички 81+ ястия
- [ ] IR / liquid breakfast / controlled sweet като отделни ястия в `meal-dishes.js`
- [ ] Admin/KV overlay без дублиране на източника на истина

**Критерий:** <5% профили без пълен 7-дневен план при v2.

---

## Етап 5 — A/B и default switch

- [ ] Логване `_meta.planEngine` + `step3Engine` във всеки план
- [ ] Сравнение v1 vs v2 (време, AI calls, validation errors)
- [ ] При по-добри резултати → `PLAN_ENGINE=v2` като default в production

---

## Какво НЕ правим

- Нов orchestrator / protocol-engine wire в main flow
- weeklyBlueprint / framework-selector като отделна система
- ADLE правила в AI промптове за Step 3
- SQL база — единствен източник остава `meal-dishes.js`
