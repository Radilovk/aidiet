# AI Prompt Refactoring Summary

## Overview

This document describes the refactoring of the AI analysis prompt (Step 1) to simplify the logic and focus on core requirements as specified in the problem statement.

## Problem Statement (Bulgarian - translated)

The user requested simplification of Prompt 1, which had too many unnecessary requests and scattered logic. The focus should be on:

1. **Determining temperament** based on specific questionnaire fields
2. **Determining psychoprofile** based on temperament + other fields  
3. **Identifying negative factors** (both general health and specifically hindering the goal)
4. **Correcting calories and macros** through percentage-based adjustments

## Key Changes

### 1. New Adjustment-Based Calorie Correction Formula

The old approach had the AI recalculate BMR/TDEE from scratch. The new approach:
- Backend calculates BMR and TDEE once (already done)
- AI applies **percentage-based corrections** through 3 adjustment factors:

```
Final_Calories = TDEE × (1 + clinicalAdjustmentPercent/100 + metabolicAdjustmentPercent/100 + goalAdjustmentPercent/100)
```

#### Clinical Adjustment (-20% to +10%)
Based on:
- `medicalConditions`
- `medications`
- `additionalNotes` (only if directly health-related)

Negative for metabolism-slowing conditions (hypothyroidism, PCOS, insulin resistance)
Positive for metabolism-accelerating conditions (hyperthyroidism)

#### Metabolic Adjustment (-15% to +15%)
Based on:
- `sportActivity`
- `sleepHours`
- `sleepInterrupt`
- `stressLevel`
- `psychoprofileResult`
- `temperamentResult`
- `additionalNotes`

Negative for poor sleep, high stress, low activity, yo-yo diet history
Positive for good sleep, low stress, high activity, good metabolism

#### Goal Adjustment (-25% to +15%)
Based on:
- `goal`
- `additionalNotes`

- Weight loss: -15% to -25% (aggressive deficit)
- Maintenance: 0%
- Weight/muscle gain: +10% to +15%

### 2. Temperament Determination

Analyzes specific fields:
- age, gender, chronotype
- sleepHours, sleepInterrupt, stressLevel
- foodTriggers, overeatingFrequency, compensationMethods
- dailyActivityLevel, sportActivity

Returns temperament type (Choleric, Sanguine, Phlegmatic, Melancholic) only if confidence > 80%.

### 3. Psychoprofile Determination

Analyzes temperament (from step 1) plus:
- age, gender, goal, lossKg
- dietHistory, eatingHabits, foodCravings
- drinksSweet, drinksAlcohol, waterIntake
- socialComparison, dietPreference, dietDislike, dietLove
- weightChange, additionalNotes

Produces detailed psychological profile including:
- Behavioral patterns
- Emotional triggers and coping mechanisms
- Motivational factors
- Psychological barriers
- Communication style recommendations

### 4. Negative Factors Identification

Two categories, each rated 1-3 for severity:

**Health Factors** (generally unhealthy):
- Medical conditions
- Medications
- Sleep quality
- Stress
- Hydration

**Goal-Hindering Factors** (specifically blocking goal achievement):
- Eating habits
- Emotional triggers
- Overeating frequency
- Compensatory methods
- Social comparison
- Diet history/results

### 5. Macro Determination

Based on:
- `psychoprofileResult`
- `temperamentResult`
- Behavioral keys (foodCravings, foodTriggers, compensationMethods)
- Clinical keys (medicalConditions, medications)

Returns protein %, carbs %, fats %, and fiber (grams).

### 6. Analysis Page Requirements

Maintains existing requirements:
- At least 5 optimistic improvements (forecastOptimistic)
- At least 5 pessimistic risks (forecastPessimistic)
- Current health status (underestimated by 10% for motivation)
- Key problems (3-6 critical issues)

## Files Modified

### 1. `KV/prompts/admin_analysis_prompt.txt`
- Complete rewrite with new simplified structure
- Focuses on the 6 key areas above
- Clear step-by-step instructions for AI
- Explicit JSON output format

### 2. `worker.js`
- Updated fallback JSON structure (lines 4085-4168)
- Matches new prompt output format
- Maintains backward compatibility

### 3. `KV/prompts/admin_analysis_prompt.txt.backup`
- Backup of original prompt for reference

## JSON Output Structure

### Sector 1: Backend Processing
```json
{
  "temperamentResult": {
    "temperament": "string or null",
    "probability": "number or null",
    "reasoning": "string"
  },
  "psychoprofileResult": {
    "behavioralPatterns": "string",
    "emotionalTriggers": "string",
    "motivationalFactors": "string",
    "psychologicalBarriers": "string",
    "communicationStyle": "string"
  },
  "negativeFactors": {
    "healthFactors": [...],
    "goalHinderingFactors": [...]
  },
  "calorieCorrections": {
    "baseTDEE": number,
    "clinicalAdjustmentPercent": number,
    "clinicalAdjustmentReasoning": "string",
    "metabolicAdjustmentPercent": number,
    "metabolicAdjustmentReasoning": "string",
    "goalAdjustmentPercent": number,
    "goalAdjustmentReasoning": "string",
    "finalCalories": number
  },
  "macroRatios": {...},
  "macroGrams": {...}
}
```

### Sector 2: Frontend Display
```json
{
  "currentHealthStatus": {...},
  "forecastPessimistic": {
    "risks": [5+ items]
  },
  "forecastOptimistic": {
    "improvements": [5+ items]
  },
  "keyProblems": [...]
}
```

### Sector 3: Pass to Step 2
```json
{
  "bmr": number,
  "tdee": number,
  "recommendedCalories": number,
  "macroRatios": {...},
  "macroGrams": {...},
  "psychoProfile": {
    "temperament": "string or null",
    "probability": "number or null"
  },
  "metabolicProfile": "string",
  "healthRisks": [...],
  "nutritionalNeeds": [...],
  "psychologicalProfile": "string",
  "successChance": number
}
```

## Backward Compatibility

The `psychoProfile` field in Sector 3 maintains the old structure for compatibility with existing code:
```javascript
// Old code still works:
analysis.psychoProfile.temperament
analysis.psychoProfile.probability
```

## Usage

### For Developers
The new prompt template is in `/KV/prompts/admin_analysis_prompt.txt`. To use it:

1. Upload to Cloudflare KV storage:
```bash
cd /home/runner/work/aidiet/aidiet
./KV/upload-kv-keys.sh
```

2. The worker will automatically use it when generating analysis prompts

### For Admin Users
Edit the prompt via the admin panel at:
`https://aidiet.radilov-k.workers.dev/admin.html`

Note: When editing via admin panel, use `{variableName}` syntax for variable replacement, not `${variableName}`.

## Testing

To test the new prompt:
1. Upload the prompt to KV storage (see above)
2. Create a new nutrition plan through the UI
3. Check the analysis response matches the new structure
4. Verify all three adjustment percentages are present and calculated
5. Verify temperament/psychoprofile are determined correctly
6. Verify at least 5 optimistic improvements and 5 pessimistic risks

## Security Summary

CodeQL analysis completed with **0 security alerts**.

## Next Steps

1. ✅ Prompt template created and reviewed
2. ✅ Code review completed and issues fixed
3. ✅ Security check passed
4. ⏳ Upload prompt to production KV storage
5. ⏳ Test with real user data
6. ⏳ Monitor AI responses for quality

## References

- Problem statement: Issue request in Bulgarian
- Original prompt: `/KV/prompts/admin_analysis_prompt.txt.backup`
- Worker code: `/worker.js` (lines 4061-4517)
