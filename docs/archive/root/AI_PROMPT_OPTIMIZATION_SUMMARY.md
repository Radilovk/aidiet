# AI Prompt Optimization Summary

## Date: 2026-02-08

## Problem Statement
Based on review of `ai_communication.txt`, identified issues with AI prompts:
1. **Step 1 (Analysis) was generating the complete weekly meal menu** - This should only happen in Step 3
2. **Prompts contained overly elementary instructions** - Teaching the AI model basic dietary and biological concepts it already knows
3. **Need to let AI do the analysis** - Provide data and guidance, but not hardcode logic or do analysis for it

## Solution Implemented

### Step 1: Analysis Request (generateAnalysisPrompt)

**REMOVED:**
- `weeklyBlueprint` object with full 7-day meal structure including:
  - `skipBreakfast` flag
  - `dailyMealCount` 
  - `dailyStructure` with specific meals, calorie targets, protein/carb sources for each day
- Elementary instructions about hormones, metabolic processes, dietary science
- Overly detailed medication interaction instructions (teaching AI what it already knows)
- Long lists of positive/negative factors for success chance with specific point values

**KEPT/IMPROVED:**
- Core health and metabolic analysis
- Psychological profile analysis
- Success chance calculation (but let AI determine factors)
- Key problems identification
- Macro calculations (BMR, TDEE, calories, macronutrients)

**NEW APPROACH:**
- Simplified prompt focusing on **expert holistic analysis**
- Trust AI's expertise in dietary science and biology
- Focus on **data provision** rather than teaching
- Emphasis on **correlation analysis** between factors
- Shorter, more professional prompt (reduced from ~2750 lines to ~1100 lines)

### Step 2: Strategy Request (generateStrategyPrompt)

**REMOVED:**
- References to `weeklyBlueprint` from analysis (no longer exists)
- Overly detailed supplement interaction instructions (teaching AI about vitamin K + warfarin, etc.)
- Long lists of specific supplement recommendations for specific conditions
- Elementary dietary advice

**KEPT/IMPROVED:**
- Strategic dietary approach determination
- Meal timing and pattern recommendations
- Individualized supplement recommendations (but let AI determine specifics)
- Psychological support strategies

**NEW APPROACH:**
- Prompt focuses on **holistic strategy creation**
- Let AI apply its knowledge of medication interactions
- Simplified supplement section - AI knows what supplements interact with what
- Trust AI to correlate all factors without micro-managing

### Step 3: Meal Plan Chunk Generation (generateMealPlanChunkPrompt)

**CHANGED:**
- **BEFORE**: Used `weeklyBlueprint` with hardcoded meal structure from Step 1
- **AFTER**: Uses `mealTiming` and `weeklyMealPattern` from Strategy (Step 2)

**NEW APPROACH:**
- Meal plan generation now based on **strategy guidance** not rigid blueprint
- More flexible - AI can adapt meal count and timing based on chronotype and profile
- AI determines meal structure based on:
  - Strategy's `weeklyMealPattern` (e.g., "16:8 intermittent fasting")
  - Strategy's `mealTiming.pattern` (e.g., "Mon-Fri: 2 meals, Sat-Sun: 3 meals")
  - Strategy's `chronotypeGuidance`
  - Client's preferences and habits

## Benefits of Changes

### 1. Clearer Separation of Concerns
- **Step 1**: Health/metabolic **ANALYSIS** only
- **Step 2**: Dietary **STRATEGY** with meal timing
- **Step 3**: Actual **MEAL GENERATION** based on strategy

### 2. Respects AI Capabilities
- No longer teaching AI basic dietary science
- Trust AI's knowledge of:
  - Hormonal interactions
  - Medication-food interactions  
  - Metabolic processes
  - Nutritional biochemistry

### 3. More Flexible System
- AI can adapt meal plans more dynamically
- No rigid 7-day structure predetermined in Step 1
- Allows for intermittent fasting, varied meal counts, etc.

### 4. Focused Prompts
- **Project goals clearly stated**: Achieve user health goals and maintain health
- Shorter, more professional prompts
- Easier to maintain and update

### 5. Better Use of AI
- AI does **analysis** not just execution
- AI makes **decisions** based on expertise
- AI applies **correlations** not following recipes

## Technical Details

### Files Modified
- `worker.js` - Main changes in:
  - `generateAnalysisPrompt()` function (~line 2295)
  - `generateStrategyPrompt()` function (~line 2776)
  - `generateMealPlanChunkPrompt()` function (~line 3272)

### Backward Compatibility
- Analysis output format changed (removed `weeklyBlueprint`)
- Strategy input updated (no longer expects `weeklyBlueprint`)
- Meal plan generation updated (uses strategy guidance instead)

### Lines of Code
- **Removed**: ~255 lines of overly detailed instructions
- **Modified**: ~100 lines simplified
- **Net reduction**: Approximately 350 lines of unnecessary complexity

## Expected AI Behavior Changes

### Analysis Step
**BEFORE**: 
```json
{
  "bmr": 1375,
  "weeklyBlueprint": {
    "skipBreakfast": true,
    "dailyMealCount": 4,
    "dailyStructure": [
      {
        "dayIndex": 1,
        "meals": [
          {"type": "breakfast", "active": false, "calorieTarget": 0},
          {"type": "lunch", "active": true, "calorieTarget": 550},
          {"type": "snack", "active": true, "calorieTarget": 250},
          {"type": "dinner", "active": true, "calorieTarget": 850}
        ]
      },
      // ... 6 more days
    ]
  }
}
```

**AFTER**:
```json
{
  "bmr": 1375,
  "bmrReasoning": "Based on holistic analysis...",
  "tdee": 2063,
  "recommendedCalories": 1650,
  // ... other analysis fields
  "metabolicProfile": "Detailed analysis",
  "psychologicalProfile": "Behavioral analysis"
}
```

### Strategy Step
**BEFORE**: Referenced blueprint from analysis
**AFTER**: Creates its own meal timing strategy

```json
{
  "mealTiming": {
    "pattern": "Mon-Fri: 2 meals (lunch, dinner), Sat-Sun: 3 meals with breakfast",
    "fastingWindows": "16 hours between last meal and first meal",
    "chronotypeGuidance": "Morning type: Breakfast 07:00-08:00, Dinner by 19:00"
  }
}
```

## Testing Recommendations

1. **Test with existing user data** - Verify plan generation still works
2. **Verify meal counts** - Ensure appropriate number of meals generated
3. **Check calorie totals** - Daily totals should match recommendedCalories
4. **Review meal variety** - Should still have good variety across 7 days
5. **Validate strategy coherence** - Strategy should make sense with generated meals

## Maintenance Notes

### If Updating Prompts in Future:
1. Focus on **data provision** not teaching
2. Trust AI's domain expertise
3. Keep instructions **goal-focused** not process-focused
4. Let AI make **correlations and decisions**
5. Avoid **micro-managing** AI's reasoning

### Admin Panel Templates
Note: `getDefaultPromptTemplates()` function (line ~5185) contains display templates for admin panel. These should be updated to match the new prompts for consistency, but they don't affect actual operation.

## References
- Original issue discussion in Bulgarian (problem statement)
- AI communication log: `ai_communication.txt`
- Modified file: `worker.js`
- Commits: 
  - "Optimize AI prompts - remove meal blueprint from Step 1, simplify instructions"
  - "Update meal plan generation to work without weeklyBlueprint from analysis"
