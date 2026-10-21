# Chat JSON Wrapping Fix

**Date:** 2026-02-16  
**Issue:** Chat assistant responses were being wrapped in JSON format with markdown code blocks

---

## Problem Description

When users interacted with the chat assistant, responses were appearing in JSON format:

```json
{
  "response": "Здравей, kakadu! Готов съм да ти помогна да постигнеш целите си..."
}
```

Instead of plain text:
```
Здравей, kakadu! Готов съм да ти помогна да постигнеш целите си...
```

---

## Root Cause

The `enforceJSONOnlyPrompt()` function was being applied to **ALL** AI requests in `callAIModel()`, including chat messages. This function prepends instructions to the prompt forcing the AI to return only JSON:

```javascript
function enforceJSONOnlyPrompt(prompt) {
  const jsonPrefix = `CRITICAL INSTRUCTION: You MUST respond with ONLY a valid JSON object. 
Do not include any explanatory text, markdown formatting, or anything outside the JSON structure.
Your response must start with { or [ and end with } or ].
NO text before the JSON. NO text after the JSON. ONLY JSON.

`;
  return jsonPrefix + prompt;
}
```

This is necessary for:
- Meal plan generation
- Analysis steps
- Strategy generation
- Summary generation

But **NOT** for chat, which should return natural conversational text.

---

## Solution

### 1. Modified `callAIModel` Function

Added optional parameter `skipJSONEnforcement` (default: `false`):

```javascript
async function callAIModel(env, prompt, maxTokens = null, stepName = 'unknown', 
                           sessionId = null, userData = null, calculatedData = null, 
                           skipJSONEnforcement = false) {
  // Apply strict JSON-only enforcement to reduce unnecessary output
  // Skip enforcement for chat requests where plain text responses are expected
  const enforcedPrompt = skipJSONEnforcement ? prompt : enforceJSONOnlyPrompt(prompt);
  
  // ... rest of function
}
```

### 2. Updated `handleChat` Function

Pass `true` for `skipJSONEnforcement` when calling AI for chat:

```javascript
// Call AI model with standard token limit (no need for large JSONs with new regeneration approach)
// Skip JSON enforcement for chat to get plain text conversational responses
const aiResponse = await callAIModel(env, chatPrompt, 2000, 'chat_consultation', 
                                     null, effectiveUserData, null, true);
```

---

## Impact

### ✅ Benefits
- Chat responses are now plain text as expected
- No changes to existing plan generation functionality
- Minimal code changes (2 lines modified)
- No breaking changes

### 🔒 Security
- No security vulnerabilities introduced (CodeQL scan passed)
- No new dependencies added
- Code review completed with no issues

### 📊 What Still Uses JSON Enforcement
- `generateSimplifiedFallbackPlan` - needs JSON for meal plan structure
- `handlePlanGeneration` - analysis, strategy, meal plans all need JSON
- `handlePlanRegeneration` - same as above

### 📝 What Now Gets Plain Text
- **Chat consultations** - conversational responses
- **Chat modification mode** - explanations and confirmations (except `[REGENERATE_PLAN:...]` instructions which are still parsed separately)

---

## Testing Recommendations

1. **Open chat window** in the app
2. **Send a message** to the assistant
3. **Verify response** appears as plain text without JSON wrapping
4. **Test modification mode** - ensure plan changes still work
5. **Verify plan generation** still produces valid JSON structures

---

## Related Documentation

- `CHAT_OPTIMIZATION_BEFORE_AFTER.md` - Chat optimization details
- `REVOLUTIONARY_CHAT_OPTIMIZATION_BG.md` - Bulgarian version
- `worker.js` lines 1146-1149, 2427 - Implementation
- `plan.html` line 3345 - Frontend response handling
