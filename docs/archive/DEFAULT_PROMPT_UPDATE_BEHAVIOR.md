# Default Prompt Auto-Update Behavior

## Въпрос (Question)
Сега при евентуална промяна на worker.js и промптовете вътре, ще се актуализира ли при кликване на "viewDefaultPrompt" бутона и в админ панела?

**Translation:** Now if there's a change to worker.js and the prompts inside, will it be updated when clicking the "viewDefaultPrompt" button in the admin panel?

## Отговор (Answer)
**ДА!** Промптовете ще се актуализират автоматично, **НО** само след редеплоймънт на worker.js в Cloudflare.

**Translation:** **YES!** The prompts will update automatically, **BUT** only after redeploying worker.js to Cloudflare.

---

## Как работи (How It Works)

### 1. Кликване на "Виж Стандартен Промпт" (Clicking "View Default Prompt")

```
Admin Panel (admin.html)
    ↓
viewDefaultPrompt(promptType, elementId)
    ↓
GET /api/admin/get-default-prompt?type={promptType}
    ↓
Cloudflare Worker (worker.js)
    ↓
handleGetDefaultPrompt(request, env)
    ↓
Returns defaultPrompts[type] from lines 4447-5048
    ↓
Displays in textarea in admin panel
```

### 2. Откъде идват промптовете (Where Prompts Come From)

Промптовете са **hardcoded** директно в `worker.js` на линии 4447-5048:

```javascript
const defaultPrompts = {
  analysis: `...159 lines of Bulgarian prompt...`,
  strategy: `...130 lines of Bulgarian prompt...`,
  meal_plan: `...235 lines of Bulgarian prompt with ADLE v8...`,
  summary: `...29 lines of Bulgarian prompt...`,
  consultation: `...14 lines of Bulgarian prompt...`,
  modification: `...80 lines of Bulgarian prompt...`
};
```

**Ключова точка:** Тези промпти са част от кода на worker.js, не се съхраняват в база данни или файлове.

**Key point:** These prompts are part of the worker.js code, not stored in a database or files.

---

## Кога се актуализират (When They Update)

### ✅ Промптовете СЕ актуализират автоматично (Prompts DO update automatically):

1. **След редеплоймънт на worker** - When you deploy worker.js to Cloudflare
2. **Веднага след deploy** - Immediately after deployment completes
3. **За всички потребители** - For all users simultaneously
4. **Без нужда от кеш изчистване** - No cache clearing needed

### ❌ Промптовете НЕ се актуализират (Prompts DON'T update):

1. **Само при промяна на локалния файл** - Just by changing the local file
2. **Без deploy** - Without deploying
3. **В dev режим на други машини** - In dev mode on other machines

---

## Стъпки за актуализация (Steps to Update)

### Сценарий: Искате да промените analysis промпта
**Scenario:** You want to change the analysis prompt

#### Стъпка 1: Редактирайте worker.js
```javascript
// Line 4448 in worker.js
analysis: `Ти си експертен диетолог... [YOUR CHANGES HERE]`
```

#### Стъпка 2: Тествайте локално (Optional)
```bash
cd /home/runner/work/aidiet/aidiet
wrangler dev
```
- Open http://localhost:8787
- Test the endpoint: `GET /api/admin/get-default-prompt?type=analysis`

#### Стъпка 3: Deploy в Cloudflare
```bash
wrangler deploy
```

Изход (Output):
```
Uploading worker code...
Total Upload: XX KB
Uploaded aidiet-worker (X.XX sec)
Published aidiet-worker (X.XX sec)
  https://aidiet.radilov-k.workers.dev
```

#### Стъпка 4: Проверете в админ панела
1. Отворете https://radilov-k.github.io/aidiet/admin.html
2. Отидете на секция "AI Промпт за Анализ (Стъпка 1)"
3. Кликнете "Виж Стандартен Промпт" (blue button)
4. ✅ Ще видите НОВИЯ промпт веднага!

**Translation:**
1. Open https://radilov-k.github.io/aidiet/admin.html
2. Go to section "AI Prompt for Analysis (Step 1)"
3. Click "View Default Prompt" (blue button)
4. ✅ You will see the NEW prompt immediately!

---

## Защо работи така (Why It Works This Way)

### Архитектура (Architecture)

```
┌─────────────────────────────────────────┐
│  Admin Panel (GitHub Pages)             │
│  https://radilov-k.github.io/aidiet/    │
│                                          │
│  - admin.html (static HTML)             │
│  - JavaScript running in browser        │
└────────────────┬────────────────────────┘
                 │ HTTP Request
                 │ GET /api/admin/get-default-prompt
                 ↓
┌─────────────────────────────────────────┐
│  Cloudflare Worker (Edge Computing)     │
│  https://aidiet.radilov-k.workers.dev   │
│                                          │
│  - worker.js (deployed code)            │
│  - Runs on every request                │
│  - NO caching of prompts                │
└─────────────────────────────────────────┘
```

### Защо няма кеширане (Why No Caching)

1. **Cloudflare Workers са stateless** - Each request runs fresh code
2. **Кодът се изпълнява при всяка заявка** - Code executes on every request
3. **Няма in-memory кеш между заявки** - No in-memory cache between requests
4. **Промптовете са в самия код** - Prompts are in the code itself

---

## Често задавани въпроси (FAQ)

### Q1: Трябва ли да рестартирам нещо след deploy?
**A:** НЕ. Cloudflare автоматично активира новата версия веднага.

**A:** NO. Cloudflare automatically activates the new version immediately.

### Q2: Колко време отнема актуализацията?
**A:** Обикновено 5-30 секунди след завършване на deploy.

**A:** Usually 5-30 seconds after deployment completes.

### Q3: Трябва ли потребителите да refresh-нат страницата?
**A:** НЕ за default промпти. Но ДА за custom промпти (те се взимат от KV storage).

**A:** NO for default prompts. But YES for custom prompts (they come from KV storage).

### Q4: Какво става с custom промптите?
**A:** Custom промптите (запазени в KV) остават непокътнати. Default промптите са fallback.

**A:** Custom prompts (saved in KV) remain untouched. Default prompts are fallback.

### Q5: Мога ли да тествам промените преди deploy?
**A:** ДА, с `wrangler dev` можете да тествате локално.

**A:** YES, with `wrangler dev` you can test locally.

### Q6: Ще се счупи ли нещо ако промена промпта?
**A:** Ако JavaScript синтаксиса е правилен, НЕ. Но може AI отговорът да стане по-различен.

**A:** If JavaScript syntax is correct, NO. But AI response might be different.

---

## Тестване (Testing)

### Тест 1: Проверка на текуща версия
```bash
# Check deployed version
curl https://aidiet.radilov-k.workers.dev/api/admin/get-default-prompt?type=analysis | jq -r '.prompt' | head -5
```

Очакван резултат (Expected):
```
Ти си експертен диетолог, психолог и ендокринолог. Направи ХОЛИСТИЧЕН АНАЛИЗ на клиента и ИЗЧИСЛИ калориите и макросите.

═══ КЛИЕНТСКИ ПРОФИЛ ═══
{userData} (will be replaced with full client JSON data including: name, age, gender, height, weight, goal...
```

### Тест 2: Проверка след промяна
1. Edit worker.js - добавете "TEST" в началото на analysis промпта
2. Deploy: `wrangler deploy`
3. Run: `curl https://aidiet.radilov-k.workers.dev/api/admin/get-default-prompt?type=analysis | jq -r '.prompt' | head -1`
4. Should see: `TEST Ти си експертен диетолог...`

---

## Поддръжка (Maintenance)

### Препоръчителен workflow:

```bash
# 1. Create branch for prompt changes
git checkout -b update-prompts-2026

# 2. Edit worker.js (lines 4447-5048)
vim worker.js

# 3. Test locally
wrangler dev
# Test: http://localhost:8787/api/admin/get-default-prompt?type=analysis

# 4. Validate syntax
node --check worker.js

# 5. Commit changes
git add worker.js
git commit -m "Update analysis prompt with improved instructions"

# 6. Deploy to production
wrangler deploy

# 7. Verify in admin panel
# Open admin.html and click "View Default Prompt"

# 8. Push to GitHub
git push origin update-prompts-2026
```

---

## Заключение (Conclusion)

✅ **Промптовете СЕ актуализират автоматично след deploy**
✅ **Prompts DO update automatically after deployment**

❌ **Промптовете НЕ се актуализират без deploy**
❌ **Prompts DON'T update without deployment**

🔑 **Ключова стъпка:** `wrangler deploy`
🔑 **Key step:** `wrangler deploy`

---

## Свързани файлове (Related Files)

- `worker.js` (lines 4447-5048) - Default prompts definition
- `admin.html` (lines 2132-2153) - viewDefaultPrompt() function
- `wrangler.toml` - Deployment configuration
- `DEPLOYMENT_CHECKLIST.md` - Full deployment guide
- `ADMIN_PROMPT_FIX_DOCUMENTATION.md` - Original prompt fix documentation

---

## История (History)

- **2026-02-05** - Fixed default prompts to return actual production templates (159-235 lines each)
- **2026-02-05** - Documented auto-update behavior after deployment
- **Previous** - Prompts were short English stubs, now full Bulgarian production prompts

