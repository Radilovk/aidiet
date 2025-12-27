# AI Diet Application - Architecture Overview

## System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  index.html  │  │questionnaire │  │  plan.html   │        │
│  │   Landing    │─▶│    .html     │─▶│  Diet Plan   │        │
│  │     Page     │  │  Въпросник   │  │   + Chat     │        │
│  └──────────────┘  └──────┬───────┘  └──────┬───────┘        │
│                            │                  │                 │
│                            │ POST             │ POST            │
│                            │ /generate-plan   │ /chat           │
│                            │                  │ (with context)  │
└────────────────────────────┼──────────────────┼────────────────┘
                             │                  │
                             ▼                  ▼
┌────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKER                            │
│                       (worker.js)                               │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │              API ENDPOINTS (STATELESS)                    │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │  POST /api/generate-plan  - Generate nutrition plan      │ │
│  │  POST /api/chat           - Chat with AI assistant       │ │
│  │  (NO user data storage - all data from client)           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │           ADMIN CONFIG (KV Storage)                       │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │  • AI prompts (plan, chat, modification)                │ │
│  │  • AI provider settings (OpenAI/Gemini)                 │ │
│  │  • Model selection                                       │ │
│  └──────────────────────────────────────────────────────────┘ │
│                          │                                      │
│                          ├───► KV Storage (admin config only)   │
│                          │                                      │
│  ┌──────────────────────┴───────────────────────────────────┐ │
│  │             AI INTEGRATION                                │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │  if (OPENAI_API_KEY)    ─▶  OpenAI GPT-4o-mini          │ │
│  │  else if (GEMINI_API_KEY) ─▶ Google Gemini Pro          │ │
│  │  else                     ─▶  Mock Data (Development)     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                     EXTERNAL SERVICES                           │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐          ┌─────────────────────┐    │
│  │   OpenAI API        │          │   Google Gemini     │    │
│  │   GPT-4o-mini       │    OR    │   Gemini Pro        │    │
│  │   Chat Completions  │          │   Generate Content  │    │
│  └─────────────────────┘          └─────────────────────┘    │
│                                                                 │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                     CLIENT STORAGE (localStorage)               │
├────────────────────────────────────────────────────────────────┤
│  • dietPlan - Full 7-day nutrition plan                        │
│  • userData - Questionnaire responses                          │
│  • chatHistory - Conversation history                          │
│  • userId - Unique identifier                                  │
│                                                                 │
│  ⚠️  ALL USER DATA STORED LOCALLY - NEVER ON SERVER           │
└────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### 1. Nutrition Plan Generation Flow

```
┌─────────┐
│  User   │
└────┬────┘
     │ 1. Fills questionnaire (30+ questions)
     ▼
┌─────────────────┐
│questionnaire.   │
│    html         │
└────┬────────────┘
     │ 2. Submit data via POST /api/generate-plan
     ▼
┌─────────────────┐
│  Worker.js      │  3. NO caching - stateless processing
│  Backend        │
└────┬────────────┘
     │ 4. Generate prompt with user data
     ▼
┌─────────────────┐
│   Call AI API   │
│ (OpenAI/Gemini) │
└────┬────────────┘
     │ 5. Receive structured JSON
     ▼
┌─────────────────┐
│  Parse & Return │
│  NO server      │
│  storage        │
└────┬────────────┘
     │ 6. Return plan + userId
     ▼
┌─────────────────┐
│questionnaire.   │
│    html         │
│ Store in        │
│ localStorage    │
└────┬────────────┘
     │ 7. Redirect to plan.html
     ▼
┌─────────────────┐
│  plan.html      │
│ Load from       │
│ localStorage    │
│ Render 7-day    │
│ meal plan       │
└─────────────────┘
```

### 2. Chat Assistant Flow

```
┌─────────┐
│  User   │ Clicks chat button
└────┬────┘
     │
     ▼
┌─────────────────┐
│  plan.html      │ Opens chat window
│  Chat UI        │
└────┬────────────┘
     │ User types message
     ▼
┌─────────────────┐
│ Send message    │
│ POST /api/chat  │
│ { message,      │
│   userData,     │
│   userPlan,     │
│   chatHistory   │
│ }               │
└────┬────────────┘
     │ Full context from localStorage
     ▼
┌─────────────────┐
│  Worker.js      │
│  Chat Handler   │
│  (Stateless)    │
└────┬────────────┘
     │
     ▼
┌─────────────────┐
│ Build Context   │
│ Prompt:         │
│ - User profile  │
│ - Diet plan     │
│ - Chat history  │
│ - User message  │
│ (all from       │
│  client)        │
└────┬────────────┘
     │
     ▼
┌─────────────────┐
│   Call AI API   │
│ with full       │
│ context         │
└────┬────────────┘
     │
     ▼
┌─────────────────┐
│ Return Response │
│ + updated       │
│ history         │
│ + updated plan  │
│ (if modified)   │
└────┬────────────┘
     │
     ▼
┌─────────────────┐
│  plan.html      │
│ Display response│
│ in chat window  │
│ Update          │
│ localStorage    │
└─────────────────┘
```

## KV Storage Structure

```
KV Namespace: page_content

ONLY FOR ADMIN CONFIGURATION - NO USER DATA:

├─ admin_plan_prompt
│  └─ Value: Custom prompt template for plan generation
│
├─ admin_consultation_prompt
│  └─ Value: Custom prompt for consultation chat mode
│
├─ admin_modification_prompt
│  └─ Value: Custom prompt for modification chat mode
│
├─ admin_ai_provider
│  └─ Value: 'openai' | 'google' | 'mock'
│
└─ admin_ai_model_name
   └─ Value: Model name (e.g., 'gpt-4o-mini', 'gemini-pro')

⚠️  USER DATA IS NEVER STORED ON SERVER
⚠️  All client data (plans, profiles, chat) is in browser localStorage
```

## Component Interactions

### Frontend Components
```
index.html
    ↓ (User clicks "Започни Сега")
questionnaire.html
    ↓ (Collects 30+ data points)
    ↓ (Submits to backend)
    ↓ (Receives plan + userId)
    ↓ (Saves to localStorage)
plan.html
    ├─ Loads data from localStorage
    ├─ Renders 7-day meal plan
    ├─ Provides day navigation
    ├─ Shows meal details in modals
    └─ Offers chat assistant
        ↓ (User opens chat)
        ↓ (Sends messages)
        ↓ (Receives contextual responses)
```

### Backend Logic
```
worker.js
    ├─ handleGeneratePlan()
    │   ├─ Validate input
    │   ├─ Generate prompt
    │   ├─ Call AI (callAIModel)
    │   ├─ Parse response
    │   └─ Return plan (NO caching)
    │
    ├─ handleChat()
    │   ├─ Validate input
    │   ├─ Receive full context from client
    │   │   ├─ userData (from request)
    │   │   ├─ userPlan (from request)
    │   │   └─ conversationHistory (from request)
    │   ├─ Build context prompt
    │   ├─ Call AI (callAIModel)
    │   ├─ Process plan regeneration (if requested)
    │   └─ Return response + updated data
    │
    └─ callAIModel()
        ├─ Check for OPENAI_API_KEY → callOpenAI()
        ├─ Check for GEMINI_API_KEY → callGemini()
        └─ Else → generateMockResponse()
```

## Caching Strategy

### NO USER DATA CACHING

```
Client Request → Worker (Stateless Processing) → AI API → Response → Client

NO server-side caching of user data
All data stored in browser localStorage
```

### Admin Config Caching (In-Memory)
```
Admin settings cached in worker memory for 5 minutes to reduce KV reads
```

### Benefits of Local Storage Architecture
- **Privacy**: User data never leaves their device
- **GDPR Compliant**: No personal data stored on servers
- **Simplicity**: No database management needed
- **Cost**: Lower server costs (no storage fees)
- **Speed**: Data access is instant (no network calls)
- **Offline**: Can work offline once plan is generated

## Security Layers

```
┌─────────────────────────────────────────┐
│         Security Measures               │
├─────────────────────────────────────────┤
│ 1. CORS Headers                         │
│    - Controlled cross-origin access     │
│                                          │
│ 2. Input Validation                     │
│    - Required fields checked            │
│    - Type validation                    │
│                                          │
│ 3. HTML Escaping                        │
│    - XSS prevention (escapeHtml)        │
│                                          │
│ 4. Environment Variables                │
│    - API keys not in code               │
│    - Managed via Wrangler secrets       │
│                                          │
│ 5. No Server-Side User Data Storage    │
│    - Privacy by design                  │
│    - GDPR compliant                     │
│    - No data breach risk                │
│                                          │
│ 6. Local Storage Only                   │
│    - User controls their data           │
│    - Can clear at any time              │
│    - No server tracking                 │
│                                          │
│ 7. Rate Limiting (Cloudflare)           │
│    - Built-in DDoS protection           │
│    - Request throttling                 │
└─────────────────────────────────────────┘
```

## Deployment Flow

```
Local Development
    ├─ Edit code
    ├─ Test with mock data
    └─ Use test.html for validation
         ↓
    wrangler dev (local testing)
         ↓
         ├─ Create KV namespace
         ├─ Configure wrangler.toml
         └─ Set API secrets
              ↓
         wrangler deploy
              ↓
         Production (aidiet.radilov-k.workers.dev)
              ↓
         Monitor via Cloudflare Dashboard
```

## Performance Characteristics

| Operation | Performance | Notes |
|-----------|------------|-------|
| Generate Plan | 3-15s | AI processing time |
| Chat Response | 1-5s | AI processing time |
| Load Plan Page | <100ms | From localStorage |
| Update Plan | 3-15s | Regeneration via AI |

**Key Changes from Previous Architecture:**
- No KV cache reads/writes for user data = simpler, more private
- Slightly slower on repeat visits (no cached plans) but privacy-first
- localStorage is instant vs. KV which had 50-100ms latency

## Scalability

- **Cloudflare Workers**: Auto-scales globally
- **Stateless Design**: No shared state between requests
- **Edge Computing**: Low latency everywhere
- **No Database**: No scaling concerns for user data
- **localStorage**: Infinite client-side storage (per-user)
- **Free Tier**: 100k requests/day
- **Paid Tier**: Millions of requests/day

**Privacy-First Architecture:**
This application follows a privacy-first, client-side storage model where NO user data is retained on the server. This ensures maximum privacy and GDPR compliance while maintaining excellent performance through browser localStorage.
