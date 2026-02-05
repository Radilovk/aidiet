# AI-Based Calorie Calculation - Simplified Approach

## Overview

As of 2026-02-03, the AI model calculates BMR, TDEE, and recommended calories **holistically** based on ALL user correlates. The AI is given **guidelines and examples**, not rigid rules, allowing it to make professional judgments based on complete data analysis.

## Philosophy

**Trust AI's Professional Judgment** - The AI model, after analyzing all correlates together, can assess more adequately than predefined percentage rules. We provide guidelines on WHAT to consider, not HOW MUCH to adjust.

## Problem Statement

**Bulgarian**: "калориите, макросите трябва да се изчисляват от ai model не от бекенда! [...] искам просто да му се дадат насоки да ги изчисли спрямо всички важни условия и особености като се даде пример, а не да му казваме кое как да изчислява точно и с колко процента."

**Translation**: "Calories and macros should be calculated by the AI model, not by the backend! [...] I just want to give it guidelines to calculate them based on all important conditions and features by giving an example, not telling it exactly how and by what percentage to calculate."

## Previous Backend Implementation

### Simple Formulas (Removed)
```javascript
// 1. Calculate BMR using Mifflin-St Jeor
const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === 'Male' ? 5 : -161);

// 2. Fixed activity multipliers for TDEE
const tdee = bmr * activityMultipliers[activityLevel];

// 3. Simple goal percentages
const recommendedCalories = {
  'Отслабване': tdee * 0.85,  // 15% deficit
  'Поддръжка': tdee * 1.0,
  'Мускулна маса': tdee * 1.1  // 10% surplus
}[goal];
```

**Problem**: Ignored sleep, stress, diet history, medical conditions, psychological factors, etc.

## New AI-Based Approach

### What AI Receives

#### 1. Base Information
- Physical parameters (weight, height, age, gender, goal)
- All user profile data (sleep, stress, activity, diet history, medical conditions, etc.)

#### 2. Guidelines (NOT Rules)
The AI is told to:
- Start with Mifflin-St Jeor formula as reference point
- Analyze holistically considering:
  - Sleep quality and stress
  - Diet history (metabolic adaptation)
  - Medical conditions and medications
  - Psychological factors and emotional eating
  - Chronotype and daily rhythm
  - Sport + daily activity balance

#### 3. One Example (For Illustration Only)
```
Good profile: BMR≈1400, TDEE≈2160, Target≈1840 kcal
Challenging profile: BMR≈1180, TDEE≈1780, Target≈1600 kcal
Note: AI assessed lower values due to cumulative effects
```

#### 4. Task
1. Analyze holistically ALL data
2. Calculate BMR, TDEE, calories based on YOUR professional assessment
3. Explain WHY you chose these specific values
4. Show logic and math in reasoning fields

### What We DON'T Tell AI

❌ "Poor sleep → reduce BMR by 5-10%"
❌ "High stress → reduce by 5-8%"  
❌ "Failed diets → reduce by 10-15%"
❌ Any specific percentage ranges or rules

### What We DO Tell AI

✅ "Sleep quality affects hormones and metabolism"
✅ "Stress affects cortisol and energy efficiency"
✅ "Diet history may indicate metabolic adaptation"
✅ "Medical conditions affect metabolism"
✅ "Psychological factors determine realistic goals"

## Example AI Response

### Optimal Profile
```json
{
  "bmr": 1405,
  "bmrReasoning": "Base Mifflin-St Jeor calculation: 1395 kcal. Client has excellent sleep (7-8h), low stress, and strong psychological profile. Applied small positive adjustment (+10 kcal) for optimal metabolic conditions.",
  
  "tdee": 2176,
  "tdeeReasoning": "BMR × 1.55 activity multiplier. Client's medium sport activity (2-4 days) combined with above-average daily movement justifies standard multiplier.",
  
  "recommendedCalories": 1850,
  "caloriesReasoning": "TDEE × 0.85 (15% deficit). Standard deficit appropriate given no diet history, good stress management, and realistic 5kg goal over 3 months. Client has strong adherence indicators."
}
```

### Challenging Profile
```json
{
  "bmr": 1195,
  "bmrReasoning": "Base Mifflin-St Jeor: 1395 kcal. Client reports poor sleep (5h, frequently interrupted), high work stress, and 3 previous failed diet attempts. These factors suggest significant metabolic adaptation. Reduced to 1195 kcal to reflect realistic metabolic state. Sleep improvement is critical priority.",
  
  "tdee": 1792,
  "tdeeReasoning": "BMR × 1.50 multiplier (reduced from standard 1.55). While client exercises 2-4 days/week, chronic poor sleep and stress reduce physical efficiency and recovery. Daily activity also lower due to fatigue.",
  
  "recommendedCalories": 1613,
  "caloriesReasoning": "TDEE × 0.90 (10% deficit, not standard 15%). Previous aggressive deficits have failed - pattern shows need for sustainable approach. High stress + emotional eating triggers require smaller deficit to prevent another failure cycle. Focus on building healthy relationship with food rather than rapid weight loss."
}
```

## Benefits of This Approach

### 1. AI Freedom
AI can make nuanced decisions based on complete picture, not constrained by rigid percentage rules.

### 2. Better Individualization
Each person gets truly unique assessment:
- Someone with mild sleep issues but excellent psychological profile might get minimal adjustment
- Someone with severe metabolic adaptation might get more conservative approach than any predefined rule

### 3. Context-Aware
AI can consider interactions between factors:
- Good stress management might offset poor sleep partially
- Strong psychological profile might allow slightly more aggressive deficit despite diet history
- Medical conditions + medications combinations handled better

### 4. Transparent Reasoning
AI explains its actual thought process, not just "followed rule X with percentage Y"

### 5. Flexible for Edge Cases
Can handle unusual combinations that don't fit predefined rules

## Implementation

### Prompt Structure

```javascript
function generateAnalysisPrompt(data) {
  return `
  [Physical parameters]
  
  ВАЖНО: Използвай Mifflin-St Jeor като база, но АНАЛИЗИРАЙ ХОЛИСТИЧНО:
  - [List of WHAT factors to consider]
  
  НАСОКИ ЗА ХОЛИСТИЧНО ИЗЧИСЛЕНИЕ:
  - [Base formulas for reference]
  - [Key factors to consider (without specific percentages)]
  - [ONE example for illustration]
  
  ТВОЯТА ЗАДАЧА:
  1. АНАЛИЗИРАЙ ХОЛИСТИЧНО всички данни
  2. ИЗЧИСЛИ според ТВОЯТА ПРОФЕСИОНАЛНА ПРЕЦЕНКА
  3. ОБЯСНИ ЗАЩО си избрал тези стойности
  `;
}
```

### Backend Functions

```javascript
/**
 * DEPRECATED for primary calculation (kept for validation only)
 */
function calculateBMR(data) { /* ... */ }
function calculateTDEE(bmr, activityLevel) { /* ... */ }
```

## Validation

Even with AI freedom, we validate safety:

```javascript
// Reasonable ranges
const validation = {
  bmr: { min: 1000, max: 3000 },
  tdee: { min: 1200, max: 5000 },
  recommendedCalories: { min: 1200, max: 4000 }
};

// Log if outside ranges (but trust AI's reasoning)
if (analysis.bmr < validation.bmr.min) {
  console.warn(`AI BMR ${analysis.bmr} is low - review reasoning`);
  // Check reasoning field before overriding
}
```

## Testing

### Test Case 1: Optimal Profile
- Should get values close to backend formulas
- Reasoning should be straightforward
- Adjustments should be minimal

### Test Case 2: Challenging Profile  
- Should get significantly adjusted values
- Reasoning should explain each factor's impact
- Should show nuanced thinking, not just "rule says X%"

### Test Case 3: Complex Interactions
- Multiple factors (e.g., poor sleep BUT good stress management)
- AI should explain how factors interact
- Should show holistic thinking

## Documentation Philosophy

### What We Document
- ✅ WHAT factors AI should consider
- ✅ WHY each factor matters physiologically
- ✅ Examples for illustration
- ✅ Expected reasoning quality

### What We DON'T Document
- ❌ Specific percentage adjustments
- ❌ Rigid rules and thresholds
- ❌ "If X then Y" prescriptions
- ❌ Limiting decision trees

## Conclusion

By trusting the AI model to analyze holistically and make professional judgments, we get:

- **More accurate** recommendations (considers all factors together)
- **More nuanced** decisions (not limited by rules)
- **Better reasoning** (explains actual thought process)
- **More flexible** (handles edge cases naturally)

The AI acts as a true **expert nutritionist**, not a rule-following calculator.

