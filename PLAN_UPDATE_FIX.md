# Plan Update Fix Documentation

## Problem Description

When users attempted to modify their meal plan through the chat assistant (e.g., requesting to remove a meal), the AI would respond in the chat with an UPDATE_PLAN instruction, but the actual plan would not be updated in the system.

### Root Cause

1. **Token Limit Too Low**: The `maxTokens` parameter was set to 500 tokens for chat responses
2. **Large JSON Payloads**: UPDATE_PLAN instructions contain full meal arrays which can be 1000+ tokens
3. **Truncated Responses**: AI responses were being cut off mid-JSON due to token limit
4. **Silent Parsing Failures**: When JSON.parse() failed on truncated JSON, the error was caught but the plan wasn't updated
5. **User Confusion**: Users saw the bot's message in chat but didn't see the plan change

### Example Failure Scenario

User: "моля премахни последното междинно хранене" (please remove the last snack)

AI Response (truncated at 500 tokens):
```
Разбирам, искате да премахнете последното междинно хранене. 
[UPDATE_PLAN:{"weekPlan":{"day1":{"meals":[{"type": "Закуска", "time": "08:00", ...
```

The JSON is incomplete, so parsing fails and the plan isn't updated.

## Solution Implemented

### 1. Increased Token Limit (worker.js:189-190)

**Before:**
```javascript
const aiResponse = await callAIModel(env, chatPrompt, 500);
```

**After:**
```javascript
const aiResponse = await callAIModel(env, chatPrompt, 2000);
```

**Impact:** 4x increase in token limit allows complete JSON payloads for plan updates

### 2. Enhanced Error Logging (worker.js:277-284)

Added logging of the last 500 characters of the AI response when parsing fails:

```javascript
console.error('AI Response excerpt (last 500 chars):', 
  aiResponse.substring(Math.max(0, aiResponse.length - 500)));
```

**Impact:** Makes it easier to debug if truncation issues occur in the future

### 3. Improved AI Instructions (worker.js:742-769)

**Key Changes:**
- Explicitly mentioned "премахване на хранене" (meal removal) as a supported operation
- Clarified that the ENTIRE meals array must be included for modified days
- Added specific examples for removal operations
- Standardized the meal object format (calories as number, not string)
- Added more meal type options: "Следобедна закуска/Междинно хранене"

**Before:**
```
ВАЖНО: В UPDATE_PLAN включи САМО частите на плана, които променяш.
```

**After:**
```
ВАЖНО: Винаги включвай ЦЕЛИЯ масив meals за дните, които променяш, 
дори ако променяш само едно хранене!

Примери:
- Премахване на последното хранене от Ден 1: включи целия масив meals за day1 БЕЗ последното хранене
- Замяна на закуската за Ден 2: включи целия масив meals за day2 с новата закуска
```

**Impact:** AI now understands it needs to send complete day data, making updates more reliable

### 4. Format Standardization

Standardized the meal object format to prevent parsing issues:

```javascript
{
  "type": "Закуска/Обяд/Вечеря/Следобедна закуска/Междинно хранене",
  "time": "08:00",
  "name": "Име на ястието",
  "weight": "250g",
  "calories": 350,  // Number, not string
  "description": "Описание",
  "benefits": "Ползи"
}
```

## Testing Recommendations

To verify the fix works:

1. **Test Meal Removal:**
   - User: "моля премахни последното междинно хранене"
   - Expected: Last snack is removed from the day's meals
   - Verify: Check plan.html updates and localStorage

2. **Test Meal Replacement:**
   - User: "замени закуската с омлет"
   - Expected: Breakfast is replaced with omelet
   - Verify: Check plan updates correctly

3. **Test Multiple Day Updates:**
   - User: "премахни всички междинни хранения от седмицата"
   - Expected: All snacks removed from all days
   - Verify: Full week plan updates

4. **Check Logs:**
   - Deploy to Cloudflare Workers
   - Monitor console logs for "Plan updated successfully"
   - If errors occur, check the logged response excerpt

## Rollback Plan

If issues occur:

```javascript
// Revert to previous token limit
const aiResponse = await callAIModel(env, chatPrompt, 500);
```

However, this will bring back the original problem. Better approach: debug using the new error logs.

## Future Improvements

1. **Streaming Responses**: Use streaming API to avoid token limit issues entirely
2. **Structured Outputs**: Use OpenAI's structured output mode to ensure valid JSON
3. **Delta Updates**: Implement a more efficient update format that sends only changes
4. **Retry Logic**: Add retry with higher token limit if first attempt is truncated

## Related Files

- `worker.js`: Backend API handler (main changes)
- `plan.html`: Frontend that displays the plan and handles chat
- `generateChatPrompt()`: Function that creates the AI prompt

## Deployment

Changes are in `worker.js` only. Deploy with:

```bash
wrangler deploy
```

No database migrations or frontend changes required.
