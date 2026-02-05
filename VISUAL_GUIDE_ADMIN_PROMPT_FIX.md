# Visual Guide: Admin Prompt Fix

## Before vs After

### BEFORE (Problem) ❌

```
┌─────────────────────────────────────────────────────────┐
│  Admin Panel - admin.html                               │
│                                                          │
│  User clicks: "Виж Стандартен Промпт"                   │
│                     ↓                                    │
│  function viewDefaultPrompt(type) {                      │
│    const promptMap = {                                   │
│      'analysis': DEFAULT_ANALYSIS_PROMPT,  ← Hardcoded! │
│      'strategy': DEFAULT_STRATEGY_PROMPT,  ← Hardcoded! │
│      ...                                                 │
│    };                                                    │
│    document.getElementById('xxx').value = promptMap[...];│
│  }                                                       │
│                     ↓                                    │
│  Shows: OLD/OUTDATED prompts from admin.html            │
└─────────────────────────────────────────────────────────┘

Problem: Prompts in admin.html ≠ Prompts in worker.js
         System uses worker.js, but admin shows admin.html
```

### AFTER (Solution) ✅

```
┌─────────────────────────────────────────────────────────┐
│  Admin Panel - admin.html                               │
│                                                          │
│  User clicks: "Виж Стандартен Промпт"                   │
│                     ↓                                    │
│  async function viewDefaultPrompt(type, elementId) {     │
│    const response = await fetch(                         │
│      `/api/admin/get-default-prompt?type=${type}`       │
│    );                ↓ API CALL                          │
│    ...          ┌────────────────────────────┐           │
│  }              │  worker.js                 │           │
│                 │  /api/admin/get-default-   │           │
│                 │  prompt endpoint           │           │
│                 │         ↓                  │           │
│                 │  Returns ACTUAL prompts    │           │
│                 │  from worker.js code       │           │
│                 └────────────────────────────┘           │
│                     ↓                                    │
│  Shows: CURRENT/REAL prompts from worker.js             │
└─────────────────────────────────────────────────────────┘

Solution: Single source of truth = worker.js
          Admin panel fetches prompts via API
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERACTION                          │
│                                                                  │
│  1. Click "Виж Стандартен Промпт" in Admin Panel               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                      ADMIN.HTML (Frontend)                       │
│                                                                  │
│  async function viewDefaultPrompt(promptType, elementId) {      │
│    try {                                                        │
│      const response = await fetch(                             │
│        `/api/admin/get-default-prompt?type=${promptType}`      │
│      );                                                         │
│      const data = await response.json();                       │
│      document.getElementById(elementId).value = data.prompt;   │
│    } catch (error) {                                           │
│      showError('Грешка при зареждане: ' + error.message);     │
│    }                                                            │
│  }                                                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP GET Request
                               │ /api/admin/get-default-prompt?type=analysis
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                      WORKER.JS (Backend)                         │
│                                                                  │
│  Route: /api/admin/get-default-prompt                          │
│         ↓                                                       │
│  async function handleGetDefaultPrompt(request, env) {         │
│    const type = url.searchParams.get('type');                  │
│                                                                 │
│    const defaultPrompts = {                                    │
│      analysis: `Expert nutritional analysis...`,               │
│      strategy: `Dietary strategy optimization...`,             │
│      meal_plan: `ADLE meal plan generation...`,                │
│      summary: `Generate summary...`,                           │
│      consultation: `ТЕКУЩ РЕЖИМ: КОНСУЛТАЦИЯ...`,             │
│      modification: `ТЕКУЩ РЕЖИМ: ПРОМЯНА НА ПЛАНА...`         │
│    };                                                           │
│                                                                 │
│    return jsonResponse({                                       │
│      success: true,                                            │
│      prompt: defaultPrompts[type]                              │
│    });                                                          │
│  }                                                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │ JSON Response
                               │ { success: true, prompt: "..." }
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                      ADMIN.HTML (Frontend)                       │
│                                                                  │
│  Receives prompt → Displays in textarea                         │
│  User can view/edit → Save if needed                           │
└─────────────────────────────────────────────────────────────────┘
```

## Prompt Types Flow

```
┌────────────────────────────────────────────────────────────────┐
│                    PROMPT TYPES SUPPORTED                       │
└────────────────────────────────────────────────────────────────┘

  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
  │  analysis   │      │  strategy   │      │  meal_plan  │
  │             │      │             │      │             │
  │ Step 1 of   │  →   │ Step 2 of   │  →   │ Steps 3-6   │
  │ generation  │      │ generation  │      │ generation  │
  └─────────────┘      └─────────────┘      └─────────────┘
         ↓                    ↓                     ↓
  Health analysis      Dietary strategy     Individual meals
  + BMR/TDEE/kcal      + supplements        (2 days/chunk)
  + macros             + meal timing        + recipes
  + key problems       + principles         + ingredients

  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
  │   summary   │      │consultation │      │modification │
  │             │      │             │      │             │
  │ Final step  │      │ Chat mode   │      │ Chat mode   │
  │ generation  │      │ (read-only) │      │ (editable)  │
  └─────────────┘      └─────────────┘      └─────────────┘
         ↓                    ↓                     ↓
  Week summary         Answer questions     Modify plan
  + tips               + guidance           + regenerate
  + recommendations    + motivation         + adjustments
```

## How It Works: Complete Flow

```
┌──────────────────────────────────────────────────────────────┐
│                  1. VIEW DEFAULT PROMPT                       │
└──────────────────────────────────────────────────────────────┘
                              ↓
         User clicks "Виж Стандартен Промпт"
                              ↓
                   API call to worker.js
                              ↓
              Returns ACTUAL default prompt
                              ↓
              Display in textarea (read/edit)

┌──────────────────────────────────────────────────────────────┐
│                  2. EDIT CUSTOM PROMPT                        │
└──────────────────────────────────────────────────────────────┘
                              ↓
         User modifies prompt in textarea
                              ↓
              User clicks "Запази Промпт"
                              ↓
     POST /api/admin/save-prompt (existing endpoint)
                              ↓
           Saves to Cloudflare KV storage
                              ↓
    System uses custom prompt for all generations

┌──────────────────────────────────────────────────────────────┐
│                  3. RESET TO DEFAULT                          │
└──────────────────────────────────────────────────────────────┘
                              ↓
    User clicks "Възстанови по подразбиране"
                              ↓
       Saves empty string to KV storage
                              ↓
     System falls back to default from worker.js
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROMPT RESOLUTION LOGIC                       │
└─────────────────────────────────────────────────────────────────┘

  When generating plan:
  
  generateAnalysisPrompt() in worker.js
            ↓
  Check KV storage for custom prompt
            ↓
       ┌────────────┐
       │ Custom     │ YES → Use custom prompt
       │ exists?    │────────────────────────→ replacePromptVariables()
       └────────────┘                                   ↓
            │ NO                               Insert user data
            ↓                                           ↓
  Use default prompt from code                 Send to AI
            ↓                                           ↓
  replacePromptVariables()                     Generate response
            ↓
  Insert user data
            ↓
  Send to AI
            ↓
  Generate response

  KEY: Custom prompts in KV = Priority 1
       Default prompts in code = Fallback (Priority 2)
```

## API Endpoints Comparison

```
┌──────────────────────────────────────────────────────────────┐
│              OLD vs NEW API ENDPOINTS                         │
└──────────────────────────────────────────────────────────────┘

EXISTING ENDPOINTS (Unchanged):
┌─────────────────────────────────────────────────────────────┐
│ GET  /api/admin/get-prompt?type=analysis                    │
│ → Returns: Custom prompt from KV (or null if not set)      │
│                                                             │
│ POST /api/admin/save-prompt                                 │
│ → Saves: Custom prompt to KV storage                       │
└─────────────────────────────────────────────────────────────┘

NEW ENDPOINT (Added):
┌─────────────────────────────────────────────────────────────┐
│ GET  /api/admin/get-default-prompt?type=analysis           │
│ → Returns: DEFAULT prompt from worker.js code              │
│            (what system uses when no custom prompt)        │
└─────────────────────────────────────────────────────────────┘

DIFFERENCE:
- get-prompt        = Custom (from KV) or null
- get-default-prompt = Always returns the code default
```

## Testing Checklist

```
┌────────────────────────────────────────────────────────────┐
│                   TESTING CHECKLIST                         │
└────────────────────────────────────────────────────────────┘

AUTOMATED TESTS:
✅ JavaScript syntax validation
✅ Wrangler dev server startup
✅ Prompt lookup logic
✅ CodeQL security scan

MANUAL TESTS (After deployment):
□ Open admin panel in browser
□ Test "Виж Стандартен Промпт" for each type:
  □ analysis
  □ strategy
  □ meal_plan
  □ summary
  □ consultation
  □ modification
□ Verify correct prompts displayed
□ Test editing and saving custom prompt
□ Reload page, verify custom prompt loads
□ Test reset to default functionality
□ Generate a plan, verify custom prompt is used
□ Reset prompt, generate again, verify default used
```

## Key Benefits

```
┌────────────────────────────────────────────────────────────┐
│                      BEFORE FIX                             │
└────────────────────────────────────────────────────────────┘
  ❌ Admins see OLD prompts from admin.html
  ❌ Confusion: displayed ≠ actual
  ❌ Two sources of prompts (admin.html + worker.js)
  ❌ Hard to maintain (update in 2 places)
  ❌ No transparency

┌────────────────────────────────────────────────────────────┐
│                      AFTER FIX                              │
└────────────────────────────────────────────────────────────┘
  ✅ Admins see ACTUAL prompts from worker.js
  ✅ What you see = what system uses
  ✅ Single source of truth (worker.js)
  ✅ Easy to maintain (update in 1 place)
  ✅ Full transparency
```
