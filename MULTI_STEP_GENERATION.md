# Multi-Step Plan Generation for Maximum Precision

## Overview

The application uses a **multi-step AI approach** for generating nutrition plans, making **3 separate AI requests** instead of 1. This dramatically improves personalization, precision, and quality.

## Why Multiple Requests?

### Single-Step Approach (Basic)
```
User Data → [AI: Generate Plan] → Complete Plan
```
**Problems:**
- AI tries to do everything at once
- Less deep analysis
- Generic recommendations
- No progressive refinement

### Multi-Step Approach (Advanced) ✅
```
User Data → [AI: Analyze Profile] → Health Analysis
         ↓
User Data + Analysis → [AI: Create Strategy] → Dietary Strategy
         ↓
User Data + Analysis + Strategy → [AI: Generate Meals] → Complete Plan
```

**Benefits:**
- ✅ **Better individualization** - Each step builds on previous insights
- ✅ **More precise analysis** - Dedicated AI focus per step
- ✅ **Higher quality output** - Strategy informs meal generation
- ✅ **Deeper understanding** - Correlations between health parameters
- ✅ **Progressive refinement** - Each step adds more context

## The 3 Steps

### Step 1: Profile Analysis (1st AI Request)

**Input:** Raw user questionnaire data  
**Focus:** Deep holistic health analysis

**AI Task:**
- Calculate BMR and TDEE
- Analyze metabolic profile
- Identify health risks
- Understand nutritional needs
- Map correlations (sleep ↔ stress ↔ eating patterns)
- Create psychological profile

**Output:**
```json
{
  "bmr": "1650 kcal with explanation",
  "tdee": "2200 kcal with details",
  "recommendedCalories": "1870 kcal based on goal",
  "macroRatios": {
    "protein": "30% - rationale",
    "carbs": "45% - rationale",
    "fats": "25% - rationale"
  },
  "metabolicProfile": "Detailed analysis...",
  "healthRisks": ["Risk 1 with explanation", "Risk 2..."],
  "nutritionalNeeds": ["Need 1 based on profile", "Need 2..."],
  "psychologicalProfile": "Emotional eating patterns..."
}
```

**Why Separate?**
- Allows AI to deeply analyze health without distraction of meal planning
- Establishes scientific foundation for next steps
- Can identify correlations that would be missed in single-step

### Step 2: Strategy Generation (2nd AI Request)

**Input:** User data + Analysis from Step 1  
**Focus:** Personalized dietary approach

**AI Task:**
- Choose optimal diet type (Mediterranean, balanced, low-carb, etc.)
- Determine meal timing based on chronotype
- Define key principles
- List foods to include/avoid
- Recommend supplements
- Create hydration strategy
- Develop psychological support plan

**Output:**
```json
{
  "dietType": "Balanced Mediterranean-style",
  "mealTiming": {
    "breakfast": "07:30 - optimal for morning chronotype",
    "lunch": "12:30",
    "dinner": "19:00",
    "snacks": "2 snacks at 10:30 and 16:00"
  },
  "keyPrinciples": ["Principle 1", "Principle 2", "Principle 3"],
  "foodsToInclude": ["Food 1", "Food 2", "Food 3"],
  "foodsToAvoid": ["Food 1", "Food 2", "Food 3"],
  "supplementRecommendations": ["Supplement 1 with dosage", "Supplement 2..."],
  "hydrationStrategy": "2.5L daily, distributed...",
  "psychologicalSupport": ["Tip 1", "Tip 2", "Tip 3"]
}
```

**Why Separate?**
- Strategy should be informed by deep analysis, not generic
- Focuses AI on "how" to approach the diet, not "what" to eat
- Creates framework for meal generation

### Step 3: Meal Plan Generation (3rd AI Request)

**Input:** User data + Analysis + Strategy  
**Focus:** Specific meals, portions, timing

**AI Task:**
- Generate 7-day meal plan
- Create 3-4 meals per day
- Ensure variety (no repetition)
- Match strategy timing and principles
- Stay within calorie/macro targets
- Use preferred and available foods
- Avoid disliked/restricted foods
- Create realistic, tasty meals

**Output:**
```json
{
  "summary": {
    "bmr": "1650",
    "dailyCalories": "1870",
    "macros": { "protein": "120g", "carbs": "180g", "fats": "60g" }
  },
  "weekPlan": {
    "day1": {
      "meals": [
        {
          "type": "Закуска",
          "time": "07:30",
          "name": "Овесена каша с горски плодове и орехи",
          "weight": "280g",
          "description": "Богата на фибри...",
          "benefits": "Подобрява храносмилането...",
          "calories": 380
        },
        // ... more meals
      ]
    },
    // ... 7 days
  },
  "recommendations": ["Препоръка 1", "Препоръка 2", "Препоръка 3"],
  "forbidden": ["Забранена храна 1", "Забранена храна 2"],
  "psychology": ["Психологически съвет 1", "Съвет 2", "Съвет 3"],
  "waterIntake": "2.5л дневно...",
  "supplements": ["Добавка 1 с дозировка", "Добавка 2..."]
}
```

**Why Separate?**
- Meal generation informed by analysis AND strategy
- AI can focus solely on creating delicious, appropriate meals
- Uses established framework from previous steps

## Progressive Context Building

Each step receives MORE context than the previous:

```
Step 1: User Data (30+ fields)
        ↓
Step 2: User Data + Health Analysis (BMR, risks, needs, psychology)
        ↓
Step 3: User Data + Health Analysis + Dietary Strategy (principles, timing, foods)
        ↓
Final Plan: Complete, highly individualized nutrition plan
```

## Example: How Correlation Insights Flow

### Step 1 Analysis Discovers:
- User has poor sleep (5-6 hours)
- High stress level
- Cravings for sweets in evening
- Goal: Weight loss

**AI Correlates:** Poor sleep + stress → cortisol elevation → evening sugar cravings

### Step 2 Strategy Uses This:
- Recommend magnesium supplement (improves sleep)
- Suggest protein-rich evening snack (stabilizes blood sugar)
- Add stress-management psychological tips
- Plan earlier dinner to avoid late-night cravings

### Step 3 Meal Plan Implements:
- 19:00 dinner with lean protein and complex carbs
- No late snacks (per strategy)
- Magnesium-rich foods in evening meal
- Satisfying portions to prevent cravings

**Result:** Highly individualized plan that addresses ROOT CAUSE, not just symptoms.

## Can We Add More Steps?

**Yes!** The system is extensible:

### Potential Step 4: Grocery List Generation
```
Input: Meal Plan
Output: Shopping list organized by store section
```

### Potential Step 5: Meal Prep Instructions
```
Input: Meal Plan
Output: Batch cooking guide for the week
```

### Potential Step 6: Progress Tracking Setup
```
Input: User Data + Plan
Output: Personalized tracking metrics and milestones
```

## Performance Considerations

**Time:**
- Single-step: ~5-8 seconds
- Multi-step: ~10-20 seconds (3 requests)

**Quality Gain:** Worth the extra time!

**Cost:**
- 3x API calls per plan generation
- But plans are cached locally, so only generated once

## Implementation in Code

### Current Implementation (worker.js)

```javascript
async function generatePlanMultiStep(env, data) {
  // Step 1: Health Analysis
  const analysis = await callAIModel(env, generateAnalysisPrompt(data));
  
  // Step 2: Dietary Strategy
  const strategy = await callAIModel(env, generateStrategyPrompt(data, analysis));
  
  // Step 3: Meal Plan
  const mealPlan = await callAIModel(env, generateMealPlanPrompt(data, analysis, strategy));
  
  // Combine everything
  return {
    ...mealPlan,
    analysis: analysis,
    strategy: strategy
  };
}
```

### Used For:
1. **Initial plan generation** (`/api/generate-plan`)
2. **Plan regeneration** (when user modifies plan via chat)

## Fallback Mechanism

If multi-step fails (API error, parsing error):
```javascript
try {
  return await generatePlanMultiStep(env, data);
} catch (error) {
  // Fallback to single-step
  return await generateSingleStep(env, data);
}
```

Ensures plan generation never fails completely.

## User Benefits

1. **Better Results** - More personalized, precise recommendations
2. **Deeper Understanding** - Analysis and strategy included in plan
3. **Scientific Approach** - Based on health correlations, not generic templates
4. **Psychological Support** - Specific to user's emotional eating patterns
5. **Higher Success Rate** - Plans address individual needs and barriers

## Conclusion

The multi-step approach is ALREADY IMPLEMENTED and working! It uses 3 AI requests to progressively build a highly individualized plan:

1. **Analyze** → Understand the person
2. **Strategize** → Create personalized approach
3. **Execute** → Generate specific meals

This ensures **maximum precision and individualization** for every user.

---

**Note:** The system can be extended with additional steps for even more data and precision if needed in the future.
