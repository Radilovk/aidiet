# Admin Panel Default Prompt Fix Documentation

## Problem Statement

Previously, the admin panel's "viewDefaultPrompt" functionality was showing hardcoded prompts from `admin.html` instead of the actual default prompts used by the system in `worker.js`. This caused confusion because:

1. The displayed "default" prompts did not match what the system actually uses
2. Users couldn't see the real default prompts from worker.js
3. The hardcoded prompts in admin.html were outdated and different from worker.js

## Solution Overview

The fix implements a new API endpoint that exposes the actual default prompts from worker.js, and updates the admin panel to fetch these prompts dynamically.

## Changes Made

### 1. New API Endpoint in worker.js

**Route:** `/api/admin/get-default-prompt`  
**Method:** GET  
**Query Parameter:** `type` (one of: analysis, strategy, meal_plan, summary, consultation, modification)

**Function:** `handleGetDefaultPrompt(request, env)`

This endpoint returns the exact default prompts that the system uses when no custom prompt is saved in KV storage.

**Example Request:**
```
GET /api/admin/get-default-prompt?type=analysis
```

**Example Response:**
```json
{
  "success": true,
  "prompt": "Expert nutritional analysis. Calculate BMR, TDEE, target kcal, macros. Review baseline holistically using all client factors.\n\nCRITICAL QUALITY STANDARDS:\n..."
}
```

**Error Response:**
```json
{
  "error": "Unknown prompt type: invalid. Valid types: analysis, strategy, meal_plan, summary, consultation, modification"
}
```

### 2. Updated viewDefaultPrompt Function in admin.html

**Before:**
```javascript
function viewDefaultPrompt(promptType, elementId) {
    const promptMap = {
        'analysis': DEFAULT_ANALYSIS_PROMPT,
        'strategy': DEFAULT_STRATEGY_PROMPT,
        // ... hardcoded constants
    };
    const defaultPrompt = promptMap[promptType];
    document.getElementById(elementId).value = defaultPrompt;
}
```

**After:**
```javascript
async function viewDefaultPrompt(promptType, elementId) {
    try {
        const response = await fetch(`/api/admin/get-default-prompt?type=${promptType}`);
        const data = await response.json();
        
        if (data.success && data.prompt) {
            document.getElementById(elementId).value = data.prompt;
            showSuccess(`Стандартният промпт от worker.js за ${promptType} е зареден в редактора.`);
        }
    } catch (error) {
        showError(`Грешка при зареждане на стандартен промпт: ${error.message}`);
    }
}
```

## Supported Prompt Types

| Type | Description | Used In |
|------|-------------|---------|
| `analysis` | Health analysis and calorie calculations | Step 1 of plan generation |
| `strategy` | Dietary strategy and supplement recommendations | Step 2 of plan generation |
| `meal_plan` | Individual meal generation (2 days per chunk) | Steps 3-6 of plan generation |
| `summary` | Week summary, tips, and recommendations | Final step of plan generation |
| `consultation` | Chat mode for questions (read-only) | Chat consultation mode |
| `modification` | Chat mode for plan modifications | Chat modification mode |

## How It Works

### Viewing Default Prompts

1. User clicks "Виж Стандартен Промпт" button in admin panel
2. Admin panel calls `viewDefaultPrompt(promptType, elementId)`
3. Function makes async GET request to `/api/admin/get-default-prompt?type={promptType}`
4. Worker.js returns the actual default prompt from the code
5. Prompt is loaded into the textarea for viewing/editing

### Editing and Saving Custom Prompts

The editing and saving functionality remains unchanged:

1. User edits the prompt in the textarea
2. User clicks "Запази Промпт" button
3. Admin panel calls existing save function
4. Custom prompt is saved to Cloudflare KV storage
5. System uses custom prompt for all future generations

### Resetting to Defaults

The reset functionality remains unchanged:

1. User clicks "Възстанови по подразбиране" button
2. Admin panel saves empty string to KV storage
3. System automatically falls back to default prompt from worker.js

## Benefits

1. **Accuracy:** Users now see the actual default prompts used by the system
2. **Consistency:** No more confusion between admin.html constants and worker.js defaults
3. **Maintainability:** Default prompts are only defined in one place (worker.js)
4. **Transparency:** Admins can see exactly what the system is using

## Testing

### Automated Tests
- ✅ JavaScript syntax validation (node -c worker.js)
- ✅ Wrangler dev server startup
- ✅ Prompt lookup logic verification

### Manual Testing Required
1. Open admin panel
2. For each prompt type (analysis, strategy, meal_plan, summary, consultation, modification):
   - Click "Виж Стандартен Промпт" button
   - Verify the correct default prompt from worker.js is displayed
   - Edit the prompt and save it
   - Reload the page and verify the custom prompt is loaded
   - Click "Възстанови по подразбиране" to reset
   - Verify the system falls back to the default prompt

## Notes

- The old `DEFAULT_*_PROMPT` constants in admin.html are still present for backward compatibility with legacy features (e.g., the old "AI Prompt Template" editor)
- These constants are no longer used by the main prompt editors
- The new API endpoint only serves the 6 main prompt types used by the current system
- Custom prompts stored in KV storage take precedence over default prompts

## API Reference

### Existing Endpoints (Unchanged)

- `POST /api/admin/save-prompt` - Save custom prompt to KV
- `GET /api/admin/get-prompt` - Get custom prompt from KV (returns null if not set)
- `GET /api/admin/get-config` - Get all admin configuration

### New Endpoint

- `GET /api/admin/get-default-prompt` - Get default prompt from worker.js code

## Code Locations

- **Worker.js Changes:** Lines 414 (route), 4177-4528 (handler function)
- **Admin.html Changes:** Lines 2137-2156 (viewDefaultPrompt function)
