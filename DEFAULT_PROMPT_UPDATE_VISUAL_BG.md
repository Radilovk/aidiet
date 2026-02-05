# Визуално Ръководство: Актуализация на Default Prompts
# Visual Guide: Default Prompts Update Flow

## 🔄 Пълен процес (Complete Process)

```
┌───────────────────────────────────────────────────────────────────┐
│ СТЪПКА 1: Редактиране на worker.js                               │
│ STEP 1: Edit worker.js                                           │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  📝 File: worker.js (lines 4447-5048)                            │
│                                                                   │
│  const defaultPrompts = {                                        │
│    analysis: `Ти си експертен диетолог...`,                     │
│    strategy: `Базирайки се на здравословния профил...`,         │
│    meal_plan: `Ти действаш като ADLE...`,                       │
│    summary: `Създай summary...`,                                │
│    consultation: `ТЕКУЩ РЕЖИМ: КОНСУЛТАЦИЯ...`,                 │
│    modification: `ТЕКУЩ РЕЖИМ: ПРОМЯНА НА ПЛАНА...`             │
│  };                                                              │
│                                                                   │
│  ✏️  ПРОМЯНА: Редактирайте текста на който и да е промпт        │
│  ✏️  CHANGE: Edit the text of any prompt                        │
│                                                                   │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ↓
┌───────────────────────────────────────────────────────────────────┐
│ СТЪПКА 2: Валидация (Optional)                                    │
│ STEP 2: Validation (Optional)                                     │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  $ node --check worker.js                                        │
│  ✅ No errors found                                              │
│                                                                   │
│  $ wrangler dev                                                  │
│  🌐 Running on http://localhost:8787                            │
│                                                                   │
│  $ curl http://localhost:8787/api/admin/get-default-prompt?type=analysis │
│  ✅ Returns updated prompt                                       │
│                                                                   │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ↓
┌───────────────────────────────────────────────────────────────────┐
│ СТЪПКА 3: Deploy в Cloudflare                                     │
│ STEP 3: Deploy to Cloudflare                                      │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  $ wrangler deploy                                               │
│                                                                   │
│  📤 Uploading worker code...                                     │
│  ⏱️  Total Upload: 127.45 KB                                     │
│  🚀 Uploaded aidiet-worker (1.23 sec)                           │
│  ✅ Published aidiet-worker (0.45 sec)                          │
│     https://aidiet.radilov-k.workers.dev                        │
│                                                                   │
│  ⚡ Cloudflare Edge Network:                                     │
│     - Автоматично разпространение                               │
│     - 5-30 секунди за global update                             │
│     - Няма нужда от ръчно refresh                               │
│                                                                   │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             ↓
┌───────────────────────────────────────────────────────────────────┐
│ СТЪПКА 4: Проверка в Admin Panel                                  │
│ STEP 4: Verify in Admin Panel                                     │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  🌐 Open: https://radilov-k.github.io/aidiet/admin.html        │
│                                                                   │
│  1️⃣  Scroll to "AI Промпт за Анализ (Стъпка 1)"                │
│      Scroll to "AI Prompt for Analysis (Step 1)"                │
│                                                                   │
│  2️⃣  Click [Виж Стандартен Промпт] button                       │
│      Click [View Default Prompt] button (blue)                  │
│                                                                   │
│  3️⃣  ✅ НОВИЯТ промпт се показва в textarea!                     │
│      ✅ NEW prompt displays in textarea!                         │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## 📊 Времева линия (Timeline)

```
t=0s    Edit worker.js
        └─ Промяната е САМО локална
           Change is ONLY local

t=+30s  wrangler deploy
        ├─ Upload to Cloudflare (5s)
        ├─ Validation (2s)
        ├─ Compilation (3s)
        ├─ Distribution to Edge (20s)
        └─ ✅ LIVE on production

t=+35s  Click "View Default Prompt"
        └─ ✅ NEW prompt appears immediately
```

---

## 🔀 Сравнение: Преди vs След (Comparison: Before vs After)

### ❌ ПРЕДИ промяната (BEFORE the fix)

```
Admin Panel
    ↓ Click "View Default Prompt"
    ↓
Returns hardcoded short English stub
    ↓
❌ 75 lines, generic English
❌ DOESN'T match production
❌ Outdated instructions
```

### ✅ СЕГА (NOW)

```
Admin Panel
    ↓ Click "View Default Prompt"
    ↓ GET /api/admin/get-default-prompt
    ↓
Worker.js (deployed on Cloudflare)
    ↓ handleGetDefaultPrompt()
    ↓ Returns defaultPrompts[type]
    ↓
✅ 159-235 lines, Bulgarian
✅ MATCHES production exactly
✅ Always up-to-date after deploy
```

---

## 🔄 Актуализация при промяна (Update Flow on Change)

### Сценарий: Промяна на meal_plan промпта
**Scenario: Change meal_plan prompt**

```
┌──────────────────┐
│ 1. Локална       │
│    промяна       │  $ vim worker.js
│    Local change  │  [Edit line 4739]
└────────┬─────────┘
         │
         ↓ wrangler deploy
         │
┌────────┴─────────┐
│ 2. Cloudflare    │  ⚡ Edge Network Update
│    Deploy        │  🌍 Global distribution
└────────┬─────────┘
         │
         ↓ 5-30 seconds
         │
┌────────┴─────────┐
│ 3. Production    │  ✅ All users see new version
│    Live          │  🔄 Zero downtime
└────────┬─────────┘
         │
         ↓ User clicks button
         │
┌────────┴─────────┐
│ 4. Admin Panel   │  📄 New prompt displayed
│    Shows new     │  ⚡ Instant response
└──────────────────┘
```

---

## 🎯 Критични точки (Critical Points)

### ✅ ДА (DO):
```
✓ Edit worker.js
✓ Run `wrangler deploy`
✓ Wait 5-30 seconds
✓ Click "View Default Prompt"
✓ See new prompt immediately
```

### ❌ НЕ (DON'T):
```
✗ Edit only locally without deploy
✗ Expect automatic sync from git
✗ Think browser cache affects it
✗ Worry about clearing caches
```

---

## 🏗️ Архитектура на системата (System Architecture)

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  GitHub Pages: https://radilov-k.github.io/aidiet/             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  admin.html (Static HTML + JavaScript)                          │
│                                                                  │
│  function viewDefaultPrompt(promptType, elementId) {            │
│    fetch('https://aidiet.radilov-k.workers.dev/                │
│           api/admin/get-default-prompt?type=' + promptType)     │
│  }                                                               │
│                                                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTPS Request
                             │ (No authentication needed)
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                     CLOUDFLARE EDGE                              │
│  Global CDN Network (200+ locations)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Worker Instance (Stateless)                                    │
│  ├─ Runs on EVERY request                                       │
│  ├─ NO persistent state                                         │
│  ├─ NO caching of prompts                                       │
│  └─ Fresh code execution                                        │
│                                                                  │
│  worker.js - handleGetDefaultPrompt()                           │
│  {                                                               │
│    const defaultPrompts = {                                     │
│      analysis: `...7424 chars...`,    ← HARDCODED IN CODE      │
│      strategy: `...9398 chars...`,    ← UPDATED ON DEPLOY      │
│      meal_plan: `...11605 chars...`,  ← NO DATABASE LOOKUP     │
│      summary: `...1147 chars...`,     ← INSTANT RESPONSE       │
│      consultation: `...693 chars...`, ← ZERO LATENCY          │
│      modification: `...3261 chars...` ← ALWAYS CURRENT        │
│    };                                                            │
│    return defaultPrompts[type];                                 │
│  }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📈 Производителност (Performance)

```
Request Flow Timeline:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

0ms     User clicks "View Default Prompt"
        │
10ms    Browser sends HTTPS request
        │
50ms    Request reaches Cloudflare Edge (nearest location)
        │
55ms    Worker starts execution
        │
56ms    handleGetDefaultPrompt() called
        │
57ms    defaultPrompts object accessed (in-memory)
        │
58ms    JSON response generated
        │
60ms    Response sent back
        │
100ms   Browser receives response
        │
105ms   Textarea updated with prompt
        │
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total:  ~100ms (типично)
```

### Защо е толкова бързо? (Why so fast?)

1. **No database lookup** - Prompts are in code
2. **No external API calls** - Everything in worker
3. **Edge computing** - Runs close to user
4. **No caching needed** - Direct memory access
5. **Stateless execution** - No overhead

---

## 🔐 Сигурност (Security)

### Public Endpoint
```
✅ GET /api/admin/get-default-prompt?type=analysis
   └─ No authentication required
   └─ Read-only operation
   └─ Returns template only (no sensitive data)
```

### Protected Endpoints
```
🔒 POST /api/admin/save-prompt
   └─ Should have authentication
   └─ Writes to KV storage
   └─ Modifies user data
```

**Note:** Default prompts are public by design. They're templates, not user data.

---

## 🧪 Тестови сценарии (Test Scenarios)

### Test 1: Basic Update
```bash
# 1. Before change
curl -s https://aidiet.radilov-k.workers.dev/api/admin/get-default-prompt?type=analysis | \
  jq -r '.prompt' | head -1

# Output: Ти си експертен диетолог...

# 2. Edit worker.js - add "v2.0" to first line

# 3. Deploy
wrangler deploy

# 4. After change
curl -s https://aidiet.radilov-k.workers.dev/api/admin/get-default-prompt?type=analysis | \
  jq -r '.prompt' | head -1

# Output: v2.0 Ти си експертен диетолог...
```

### Test 2: Multiple Prompt Types
```bash
for type in analysis strategy meal_plan summary consultation modification; do
  echo "Testing $type..."
  curl -s "https://aidiet.radilov-k.workers.dev/api/admin/get-default-prompt?type=$type" | \
    jq -r '.prompt' | wc -l
done
```

Expected output:
```
Testing analysis...
159
Testing strategy...
130
Testing meal_plan...
235
Testing summary...
29
Testing consultation...
14
Testing modification...
80
```

---

## 📚 Заключение (Conclusion)

### Кратък отговор (Short Answer)
**ДА, промптовете се актуализират автоматично след `wrangler deploy`**
**YES, prompts update automatically after `wrangler deploy`**

### Дълъг отговор (Long Answer)
Default промптовете са **hardcoded** в worker.js кода. Когато направите deploy с `wrangler deploy`, новият код се разпространява в целия Cloudflare Edge Network за 5-30 секунди. След това, при всяко кликване на "View Default Prompt", admin панелът извиква живия worker, който връща актуалните промпти от кода. **Няма кеширане**, **няма база данни**, **няма закъснения** - промптите са директно в кода и се актуализират веднага след deploy.

---

**Последна актуализация:** 2026-02-05  
**Версия:** 1.0  
**Статус:** ✅ Активно и тествано
