# AI-Based Calorie Calculation - Implementation Guide

## Overview

As of 2026-02-03, the AI model now calculates BMR, TDEE, and recommended calories **holistically** based on ALL user correlates, rather than using simple backend formulas.

## Problem Statement

**Bulgarian**: "калориите, макросите трябва да се изчисляват от ai model не от бекенда! калориите са пряко следствие от избраната стратегия и анализ спрямо много корелати като активност, спорт, стрес, търсено отслабване и много още корелати, които ai-моделът трябва да прцени спрямо какво ще изчисли калориите и макросите!"

**Translation**: "Calories and macros should be calculated by the AI model, not by the backend! Calories are a direct consequence of the chosen strategy and analysis based on many correlates such as activity, sports, stress, desired weight loss and many other correlates, which the AI model should evaluate to determine how it will calculate the calories and macros!"

## Previous Implementation

### Backend Calculation (Simple Formulas)
```javascript
// 1. Calculate BMR using Mifflin-St Jeor
const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === 'Male' ? 5 : -161);

// 2. Calculate TDEE with fixed activity multipliers
const activityMultipliers = {
  'Никаква': 1.2,
  'Ниска': 1.375,
  'Средна': 1.55,
  'Висока': 1.725,
  'Атлети': 1.9
};
const tdee = bmr * activityMultipliers[activityLevel];

// 3. Apply simple goal percentages
const recommendedCalories = {
  'Отслабване': tdee * 0.85,  // 15% deficit
  'Поддръжка': tdee * 1.0,
  'Мускулна маса': tdee * 1.1  // 10% surplus
}[goal];
```

### Problems with This Approach
1. **Ignores sleep quality**: Poor sleep reduces metabolism by 5-10%
2. **Ignores stress**: High stress can reduce metabolic efficiency
3. **Ignores diet history**: Multiple failed diets cause metabolic adaptation (10-15% reduction)
4. **Ignores medical conditions**: Thyroid issues, PCOS, medications affect metabolism
5. **Ignores psychological factors**: Emotional eating patterns affect realistic calorie targets
6. **One-size-fits-all**: Same formulas for everyone regardless of individual circumstances

## New Implementation

### AI Holistic Calculation

The AI now receives comprehensive instructions to calculate calories considering:

#### 1. BMR Corrections
Base formula: Mifflin-St Jeor

**Correction factors:**
- **Poor sleep** (< 6 hours, interrupted): -5% to -10%
- **High stress**: -5% to -8%
- **Failed diets (yo-yo dieting)**: -10% to -15%
- **Hypothyroidism**: -10% to -20%
- **Good sleep + low stress**: +0% to +5%

#### 2. TDEE Corrections
Base: BMR × Activity Multiplier

**Correction factors:**
- **High daily activity** (not just sport): +0.05 to +0.1 to multiplier
- **High stress**: -0.05 to multiplier (reduced efficiency)
- **Poor sleep**: -0.05 to multiplier (less energy)

#### 3. Calorie Target Corrections
Base goals:
- Weight loss: TDEE × 0.85 (15% deficit)
- Maintenance: TDEE × 1.0
- Muscle gain: TDEE × 1.1 (10% surplus)

**Correction factors:**
- **Yo-yo diet history**: Smaller deficit (TDEE × 0.90, only 10% deficit) for sustainability
- **High stress + emotional eating**: Smaller deficit to prevent failure
- **Aggressive weight loss goals**: Can increase to 20-25% deficit ONLY if no diet history
- **Medical conditions** (diabetes, PCOS): Conservative approach, smaller deficit

### Example Calculations

#### Scenario 1: Optimal Profile
**Profile:**
- Woman, 35 years, 70kg, 165cm
- Medium activity (2-4 days/week sport)
- Good sleep (7-8 hours, not interrupted)
- Low stress
- No previous diet attempts
- Goal: Weight loss

**Calculation:**
```
BMR = 10×70 + 6.25×165 - 5×35 - 161 = 1395 kcal (no correction)
TDEE = 1395 × 1.55 = 2162 kcal (standard multiplier)
Target = 2162 × 0.85 = 1838 kcal (standard 15% deficit)
```

**AI Reasoning:** "Client has optimal metabolic conditions. No correction needed to base formulas. Standard 15% deficit is sustainable."

#### Scenario 2: Challenging Profile
**Profile:**
- Woman, 35 years, 70kg, 165cm
- Medium activity (2-4 days/week sport)
- **Poor sleep (5 hours, often interrupted)**
- **High stress**
- **3 previous failed diets**
- Goal: Weight loss

**Calculation:**
```
BMR = 1395 × 0.85 = 1186 kcal
  ↳ 15% reduction due to:
    - Poor sleep: -5%
    - High stress: -5%
    - Metabolic adaptation from 3 failed diets: -5%

TDEE = 1186 × 1.50 = 1779 kcal
  ↳ Reduced multiplier (1.50 instead of 1.55) due to:
    - Poor sleep reduces activity efficiency
    
Target = 1779 × 0.90 = 1601 kcal
  ↳ Smaller deficit (10% instead of 15%) because:
    - Diet history indicates aggressive deficits don't work
    - High stress + emotional eating risk
    - Need sustainable approach
```

**AI Reasoning:** "Client shows signs of metabolic adaptation from previous diet attempts. Poor sleep and high stress further reduce basal metabolic rate. Recommend conservative 10% deficit (1601 kcal) rather than standard 15% to ensure sustainability and prevent another failed attempt. Focus on stress management and sleep improvement will be crucial."

## JSON Response Format

The AI now returns:

```json
{
  "bmr": 1186,
  "bmrReasoning": "Base Mifflin-St Jeor: 1395 kcal. Applied 15% reduction due to poor sleep (5h, interrupted: -5%), high stress (-5%), and metabolic adaptation from 3 previous failed diets (-5%). Total: 1395 × 0.85 = 1186 kcal.",
  
  "tdee": 1779,
  "tdeeReasoning": "BMR (1186) × activity multiplier 1.50 (reduced from standard 1.55 due to poor sleep affecting physical efficiency) = 1779 kcal.",
  
  "recommendedCalories": 1601,
  "caloriesReasoning": "TDEE × 0.90 (10% deficit rather than standard 15%). Conservative approach necessary due to: (1) diet history indicates aggressive deficits lead to failure, (2) high stress increases emotional eating risk, (3) metabolic adaptation requires sustainable pace. Priority: avoid another failed attempt.",
  
  "macroRatios": {"protein": 30, "carbs": 35, "fats": 35},
  "macroRatiosReasoning": {
    "protein": "30% (120g) - Higher protein to preserve muscle mass during calorie deficit and increase satiety",
    "carbs": "35% - Moderate carbs for energy, focusing on low GI options due to stress",
    "fats": "35% - Healthy fats support hormone balance and help manage stress"
  },
  
  "macroGrams": {"protein": 120, "carbs": 140, "fats": 62}
}
```

## Implementation Details

### Changes in `worker.js`

#### 1. `generateAnalysisPrompt()` Function

**Before:**
```javascript
const bmr = calculateBMR(data);  // Backend calculation
const tdee = calculateTDEE(bmr, data.sportActivity);
const recommendedCalories = /* simple goal-based calculation */;

return `
BMR: ${bmr} kcal (Mifflin-St Jeor формула)
TDEE: ${tdee} kcal (BMR × активност)
Препоръчани калории: ${recommendedCalories} kcal
`;
```

**After:**
```javascript
// No backend calculation!
return `
IMPORTANT: YOU calculate BMR, TDEE, and calories based on ALL correlates!

[Detailed instructions on how to calculate with examples...]

Response format:
{
  "bmr": number (YOU calculate holistically),
  "bmrReasoning": "explanation of corrections",
  "tdee": number (YOU calculate holistically),
  "tdeeReasoning": "explanation of corrections",
  "recommendedCalories": number (YOU determine),
  "caloriesReasoning": "explanation of goal + corrections"
}
`;
```

#### 2. Backend Functions Deprecated

```javascript
/**
 * NOTE (2026-02-03): DEPRECATED for primary calculation.
 * AI now calculates holistically. Kept ONLY for:
 * - Safety validation
 * - Fallback if AI fails
 * - Testing/comparison
 */
function calculateBMR(data) { /* ... */ }
function calculateTDEE(bmr, activityLevel) { /* ... */ }
```

### Backward Compatibility

- ✅ Backend functions still exist (for validation/fallback)
- ✅ Parsing code already handles numeric values
- ✅ No API changes
- ✅ Frontend receives same structure

## Benefits

### 1. Personalization
Each person gets truly individualized calorie targets based on their complete profile, not just age/weight/height.

### 2. Realistic Targets
People with diet history get more realistic (smaller) deficits that they can actually sustain.

### 3. Health Considerations
Sleep, stress, and medical conditions are properly factored into metabolic calculations.

### 4. Sustainability
The AI can recommend less aggressive deficits when psychological or historical factors indicate higher failure risk.

### 5. Transparency
The AI explains its reasoning, so users understand WHY they get certain calorie recommendations.

## Validation & Safety

### AI Value Validation
Even though AI calculates the values, we should validate they're reasonable:

```javascript
// Reasonable ranges for safety
const validation = {
  bmr: {
    min: 1000,  // Minimum safe BMR
    max: 3000   // Maximum reasonable BMR
  },
  tdee: {
    min: 1200,  // Minimum safe TDEE
    max: 5000   // Maximum reasonable TDEE
  },
  recommendedCalories: {
    min: 1200,  // Minimum safe calories (1200 for women, 1500 for men)
    max: 4000   // Maximum reasonable target
  }
};

// If AI values are outside ranges, log warning and use fallback
if (analysis.bmr < validation.bmr.min || analysis.bmr > validation.bmr.max) {
  console.warn(`AI BMR ${analysis.bmr} outside safe range, using fallback`);
  analysis.bmr = calculateBMR(data);  // Fallback to backend
}
```

### Comparison with Backend
For monitoring and quality assurance:

```javascript
const backendBMR = calculateBMR(data);
const aiBMR = analysis.bmr;
const difference = Math.abs(aiBMR - backendBMR);
const percentDiff = (difference / backendBMR) * 100;

if (percentDiff > 30) {
  console.warn(`AI BMR differs by ${percentDiff}% from backend calculation`);
  // Log for review but don't override - AI may have good reasons
}
```

## Testing

### Test Cases

#### Test 1: Optimal Profile (Should match backend closely)
```javascript
const profile = {
  age: 35, gender: 'Жена', weight: 70, height: 165,
  goal: 'Отслабване',
  sleepHours: '7-8', sleepInterrupt: 'Не',
  stressLevel: 'Ниско',
  sportActivity: 'Средна (2-4 дни седмично)',
  dietHistory: 'Не'
};

// Expected: AI values ≈ backend values (within 5%)
// BMR ≈ 1395, TDEE ≈ 2162, Calories ≈ 1838
```

#### Test 2: Metabolic Adaptation (Should be significantly lower)
```javascript
const profile = {
  age: 35, gender: 'Жена', weight: 70, height: 165,
  goal: 'Отслабване',
  sleepHours: '4-6', sleepInterrupt: 'Да',
  stressLevel: 'Високо',
  sportActivity: 'Средна (2-4 дни седмично)',
  dietHistory: 'Да',
  dietResult: 'Неуспешна (наддадох теглото обратно)'  // Multiple times
};

// Expected: AI values significantly lower than backend
// BMR ≈ 1200 (vs 1395)
// TDEE ≈ 1800 (vs 2162)
// Calories ≈ 1600 (vs 1838)
// Plus detailed reasoning explaining the corrections
```

#### Test 3: Medical Conditions
```javascript
const profile = {
  // ... standard profile ...
  medicalConditions: ['Хипотиреоидизъм'],
  medications: 'Да',
  medicationsDetails: 'Левотироксин за щитовидна жлеза'
};

// Expected: AI applies medical correction
// BMR reduced by 10-20%
// Reasoning mentions thyroid impact
```

### Validation Checklist

- [ ] AI returns numeric values for bmr, tdee, recommendedCalories
- [ ] Reasoning fields are populated and explain corrections
- [ ] Values are within safe ranges (1000-3000 for BMR, etc.)
- [ ] Optimal profiles get values close to backend formulas
- [ ] Challenged profiles get appropriately corrected values
- [ ] Reasoning mentions specific factors (sleep, stress, history, etc.)
- [ ] Math in reasoning is correct (percentages, multipliers)

## Migration Notes

### For Developers
1. ✅ No code changes needed in frontend - same JSON structure
2. ✅ May want to add validation of AI values
3. ✅ Can compare AI vs backend for monitoring

### For Users
1. ✅ More personalized recommendations
2. ✅ Better explanations (reasoning fields)
3. ✅ More realistic targets for people with diet history

### For QA/Testing
1. Test with diverse profiles (optimal vs challenged)
2. Verify reasoning is clear and logical
3. Check values are safe and reasonable
4. Compare AI vs backend calculations for various profiles

## Future Enhancements

### 1. Learning from Outcomes
Track whether AI's adjusted calories lead to better success rates than backend formulas.

### 2. Additional Correlates
Consider adding:
- Menstrual cycle phase (affects metabolism in women)
- Season (people are less active in winter)
- Job type (desk job vs physical labor)
- Commute type (walking vs driving)

### 3. Dynamic Adjustments
Allow AI to suggest calorie adjustments after 2-4 weeks based on actual results vs expected results.

## Conclusion

This change represents a shift from **formulaic** to **holistic** nutrition planning. By allowing the AI to consider all correlates when calculating calories, we provide:

- More accurate metabolic estimates
- More realistic and sustainable targets
- Better outcomes for people with challenging profiles
- Transparent reasoning that users can understand

The AI is now truly acting as a personalized nutrition consultant, not just applying standard formulas.
