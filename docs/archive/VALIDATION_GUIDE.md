# AI Diet Plan Generation - Validation Guide

## Changes Made

This document describes the architectural improvements made to fix data quality and consistency issues identified in the log analysis (`logove/system.txt`).

## Problem Statement (from system.txt)

The system had three critical issues:
1. **Mixed Types in Numeric Fields**: Fields like `bmr` contained strings with units and explanations (e.g., "1395 kcal (изчислен от backend)") instead of pure numbers
2. **Narrative in Data Fields**: Fields contained essays instead of values (e.g., `protein: "30% - Увеличеният прием..."`)
3. **Structural Amnesia**: AI forgot constraints between steps (e.g., skipBreakfast flag not consistently applied)
4. **Mathematical Inconsistencies**: Daily calorie totals didn't match targets

## Solution Implemented

### 1. Clean Data Types in Step 1 Analysis

**Changed Fields:**
- `bmr`: Now returns `number` instead of `"1395 kcal (изчислен от backend)"`
- `tdee`: Now returns `number` instead of string with units
- `recommendedCalories`: Now returns `number` instead of string
- `macroRatios`: Now returns `{protein: 30, carbs: 35, fats: 35}` (numbers) instead of strings with explanations

**New Fields:**
- `macroRatiosReasoning`: Separate object for explanations
- `macroGrams`: Precise gram amounts for daily intake
- `weeklyBlueprint`: Structured plan for all 7 days

### 2. Weekly Blueprint Structure

The `weeklyBlueprint` object provides:
```json
{
  "skipBreakfast": true/false,
  "dailyMealCount": 2-4,
  "mealCountReasoning": "explanation",
  "dailyStructure": [
    {
      "dayIndex": 1,
      "meals": [
        {
          "type": "breakfast/lunch/dinner/snack",
          "active": true/false,
          "calorieTarget": 900,
          "proteinSource": "chicken",
          "carbSource": "quinoa"
        }
      ]
    }
  ]
}
```

### 3. Validation Tests

To validate the implementation, check the following:

#### Test 1: Numeric Field Types
**What to check:**
- `analysis.bmr` should be a number (e.g., `1395`)
- `analysis.tdee` should be a number
- `analysis.recommendedCalories` should be a number
- `analysis.macroRatios.protein` should be a number (e.g., `30`)
- `analysis.macroRatios.carbs` should be a number
- `analysis.macroRatios.fats` should be a number
- `summary.bmr` should be a number
- `summary.dailyCalories` should be a number
- `summary.macros.protein` should be a number
- `summary.macros.carbs` should be a number
- `summary.macros.fats` should be a number

**Expected Result:** All numeric fields contain pure numbers without text, units, or explanations

#### Test 2: Weekly Blueprint Structure
**What to check:**
- `analysis.weeklyBlueprint` should exist
- `analysis.weeklyBlueprint.skipBreakfast` should be a boolean
- `analysis.weeklyBlueprint.dailyMealCount` should be a number (2-4)
- `analysis.weeklyBlueprint.dailyStructure` should be an array with 7 items
- Each day should have a `meals` array with meal definitions

**Expected Result:** Blueprint provides complete structure for all 7 days

#### Test 3: Mathematical Consistency
**What to check:**
For each day in the generated plan:
1. Sum the `calorieTarget` values from the blueprint for active meals
2. Sum the actual `calories` from generated meals
3. Compare with `analysis.recommendedCalories`

**Expected Result:** 
- Blueprint daily totals ≈ recommendedCalories (±50 kcal tolerance)
- Generated meal totals ≈ blueprint targets

#### Test 4: Structural Consistency
**What to check:**
If `weeklyBlueprint.skipBreakfast === true`:
- All 7 days should have `breakfast.active === false` in blueprint
- All 7 days should have NO breakfast meals in the generated plan

**Expected Result:** Breakfast behavior is consistent across all 7 days

#### Test 5: Backward Compatibility
**What to check:**
The parsing code should handle both:
- Old format: `bmr: "1395 kcal (изчислен от backend)"`
- New format: `bmr: 1395`

**Expected Result:** Code works with both string and numeric values

## How to Test

### Option 1: Generate a Plan Through the UI
1. Fill out the questionnaire at `questionnaire.html`
2. Generate a plan
3. Open browser DevTools and inspect the plan object in localStorage
4. Verify the structure matches the expected format above

### Option 2: Use the Worker Directly
1. Send a POST request to the `/generate-plan` endpoint with user data
2. Inspect the response JSON
3. Verify numeric types and blueprint structure

### Option 3: Check Logs
1. Generate a plan
2. Check the AI communication logs in the `logove` folder
3. Verify the response from Step 1 (analysis) contains numeric values

## Expected Benefits

1. **No More String Parsing**: Frontend can use numeric values directly without regex
2. **Type Safety**: TypeScript/JavaScript can properly validate types
3. **Mathematical Accuracy**: Calorie calculations are precise
4. **Consistency**: Meal structure (breakfast skip, meal count) is consistent across all days
5. **Token Efficiency**: Separating explanations from data reduces token usage

## Sample Valid Response

```json
{
  "analysis": {
    "bmr": 1395,
    "tdee": 2162,
    "recommendedCalories": 1838,
    "macroRatios": {
      "protein": 30,
      "carbs": 35,
      "fats": 35
    },
    "macroRatiosReasoning": {
      "protein": "Увеличеният прием на протеин е важен за запазване на мускулната маса",
      "carbs": "Умерено количество въглехидрати за енергия",
      "fats": "Здравословни мазнини за хормонален баланс"
    },
    "macroGrams": {
      "protein": 138,
      "carbs": 161,
      "fats": 71
    },
    "weeklyBlueprint": {
      "skipBreakfast": true,
      "dailyMealCount": 2,
      "mealCountReasoning": "Клиентът не закусва и предпочита интермитентно гладуване",
      "dailyStructure": [
        {
          "dayIndex": 1,
          "meals": [
            {
              "type": "breakfast",
              "active": false,
              "calorieTarget": 0
            },
            {
              "type": "lunch",
              "active": true,
              "calorieTarget": 900,
              "proteinSource": "chicken",
              "carbSource": "quinoa"
            },
            {
              "type": "dinner",
              "active": true,
              "calorieTarget": 938,
              "proteinSource": "salmon",
              "carbSource": "vegetables"
            }
          ]
        }
      ]
    }
  },
  "summary": {
    "bmr": 1395,
    "dailyCalories": 1838,
    "macros": {
      "protein": 138,
      "carbs": 161,
      "fats": 71
    }
  }
}
```

## Troubleshooting

### Issue: Still Getting String Values
**Check:** Make sure you're using the latest version of worker.js
**Solution:** Clear any caches and redeploy the worker

### Issue: Blueprint Missing
**Check:** The AI model might not be following the new prompt format
**Solution:** Verify the AI response in logs, may need to adjust the prompt temperature or model parameters

### Issue: Mathematical Inconsistencies
**Check:** Blueprint might not be enforced in meal generation
**Solution:** Verify the meal generation prompt includes the blueprint section
