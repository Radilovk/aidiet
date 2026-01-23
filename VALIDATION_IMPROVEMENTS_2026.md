# План Validation Improvements and AI Correction Loop - January 2026

## Overview
This document describes the improvements made to the plan validation system and the introduction of an AI-powered correction loop for handling validation errors gracefully.

## Changes Summary

### 1. Late-Night Snack Support (Късна закуска)

**Problem**: The system previously prohibited any meals after dinner, which was too restrictive for certain justified scenarios.

**Solution**: Introduced support for an optional "Късна закуска" (late-night snack) after dinner with strict validation rules.

#### When Late-Night Snacks are Justified:
- Long period between dinner and sleep (> 4 hours)
- Sleep problems due to hunger
- Diabetes type 2 (to stabilize blood sugar overnight)
- Intense evening workouts
- Shift work (night shifts)

#### Validation Rules for Late-Night Snacks:
1. **Position**: Only after "Вечеря" (dinner), never before
2. **Frequency**: Maximum 1 per day
3. **Glycemic Index**: Only low GI foods (GI < 55):
   - Yogurt (кисело мляко), kefir
   - Nuts: 30-40g almonds/walnuts/hazelnuts/cashews
   - Berries: strawberries/blueberries/raspberries (50-100g)
   - Avocado (half)
   - Seeds: chia/flax/pumpkin seeds (1-2 tbsp)
4. **Calories**: Maximum 150-200 kcal
5. **Justification**: Must be justified by client's profile

#### Code Changes:
- **Constants** (worker.js lines 641-662):
  - `MAX_MEALS_PER_DAY`: Updated from 5 to 6
  - `MAX_CORRECTION_ATTEMPTS`: New constant (2 attempts)
  - `MEAL_ORDER_MAP`: Added 'Късна закуска': 4
  - `ALLOWED_MEAL_TYPES`: Added 'Късна закуска'
  - `LOW_GI_FOODS`: New constant array with approved low GI foods

- **Validation Logic** (worker.js lines 720-758):
  - Updated meal ordering validation to allow late-night snacks
  - Added low GI food content validation
  - Added calorie limit validation (max 200 kcal)
  - Added check for multiple late-night snacks per day

### 2. AI Correction Loop

**Problem**: When validation failed, the system would immediately return an error to the user, wasting the AI-generated plan and requiring manual regeneration.

**Solution**: Implemented an intelligent correction loop that requests the AI to fix specific validation errors before final output.

#### How It Works:
1. Generate plan with multi-step approach
2. Validate the plan
3. **If validation fails**:
   - Generate a correction prompt with specific errors
   - Request AI to fix only the problematic parts
   - Parse the corrected plan
   - Re-validate
   - Repeat up to MAX_CORRECTION_ATTEMPTS (2 times)
4. **If still invalid**: Return error with details
5. **If valid**: Return the corrected plan with correction count

#### Code Changes:
- **handleGeneratePlan** (worker.js lines 361-428):
  - Implemented while loop for correction attempts
  - Added correction attempt tracking
  - Enhanced error messages with attempt count
  - Returns `correctionAttempts` in response

- **generateCorrectionPrompt** (worker.js lines 904-1000):
  - New function that creates targeted correction prompts
  - Includes specific validation errors
  - Provides complete validation rules
  - Includes client data for context
  - Returns only the corrected JSON plan

### 3. Enhanced AI Prompts

**Problem**: AI prompts didn't include complete validation requirements, leading to validation failures.

**Solution**: Updated all AI generation prompts with comprehensive validation rules.

#### Updated Prompts:
1. **Meal Plan Generation** (generateMealPlanPrompt):
   - Added detailed late-night snack rules
   - Specified when late-night snacks are justified
   - Listed allowed low GI foods with portions
   - Updated meal count from 1-5 to 1-6

2. **Progressive Meal Plan Chunks** (generateMealPlanChunkPrompt):
   - Added same validation rules as main prompt
   - Updated meal count range
   - Clarified late-night snack justifications

3. **Correction Prompt** (generateCorrectionPrompt):
   - Comprehensive validation rules
   - Specific error feedback
   - Medical condition considerations
   - Chronological meal ordering rules

## Benefits

### For Users:
- More flexible meal planning for legitimate needs
- Fewer plan generation failures
- Better sleep support through appropriate late-night snacks
- Automatic error correction without manual intervention

### For System:
- Reduced wasted AI requests
- Better quality control
- Self-correcting behavior
- Improved success rate of plan generation

### For Developers:
- Clear validation rules
- Maintainable correction logic
- Comprehensive error tracking
- Better debugging information

## Technical Details

### Validation Flow
```
User Request
    ↓
Generate Plan (Multi-step)
    ↓
Validate Plan ← ┐
    ↓           │
Valid?          │
  ├─ No ────────┤ MAX_CORRECTION_ATTEMPTS
  │          Generate Correction Prompt
  │          Call AI for Correction
  │          Parse Corrected Plan
  │             │
  │             ↓
  │          Re-validate
  │             │
  └─ Yes ───────┘
    ↓
Return Plan + correctionAttempts
```

### Constants Reference
```javascript
MIN_MEALS_PER_DAY = 1
MAX_MEALS_PER_DAY = 6
MIN_DAILY_CALORIES = 800
MAX_CORRECTION_ATTEMPTS = 2
MEAL_ORDER_MAP = {
  'Закуска': 0,
  'Обяд': 1,
  'Следобедна закуска': 2,
  'Вечеря': 3,
  'Късна закуска': 4
}
```

### Low GI Foods Reference
The system validates late-night snacks against this approved list:
- Dairy: кисело мляко, кефир
- Nuts: ядки, бадеми, орехи, кашу, лешници
- Fruits: ябълка, круша, ягоди, боровинки, малини, черници
- Vegetables: авокадо, краставица, домат, зелени листни зеленчуци
- Legumes/Seeds: хумус, тахан, семена, чиа, ленено семе, тиквени семки

## Testing Recommendations

### Manual Testing:
1. Generate a plan for a user with diabetes type 2
   - Verify late-night snack is included when appropriate
   - Verify it contains low GI foods
   - Verify calories are under 200

2. Generate a plan with validation errors
   - Verify correction loop activates
   - Verify errors are fixed
   - Check correctionAttempts in response

3. Test edge cases:
   - Multiple meals after dinner (should fail)
   - High-calorie late-night snack (should fail)
   - High GI foods in late snack (should fail)

### Validation Testing:
- Check meal ordering is correct
- Verify only 1 late-night snack per day
- Confirm low GI food detection works
- Verify calorie limits are enforced

## Future Improvements

1. **Machine Learning**: Track which corrections work best and learn from patterns
2. **User Feedback**: Collect data on late-night snack effectiveness
3. **Expanded GI Database**: Add more low GI foods to the approved list
4. **Dynamic Correction Attempts**: Adjust MAX_CORRECTION_ATTEMPTS based on error complexity
5. **Correction Analytics**: Log and analyze common validation failures

## Related Files
- `worker.js`: Main implementation (lines 641-1000, 1542-1700, 1840-1900)
- `ARCHITECTURE.md`: System architecture documentation
- `CORRELATION_FIXES_2026.md`: Previous correlation improvements

## Migration Notes
- **No breaking changes**: Existing plans without late-night snacks remain valid
- **Backward compatible**: System still supports 1-5 meals per day
- **API response change**: New field `correctionAttempts` added to successful responses
- **No database changes**: All validation is runtime-only

## Conclusion
These improvements significantly enhance the robustness and flexibility of the diet planning system while maintaining strict validation for health and safety. The AI correction loop reduces wasted requests and improves user experience by automatically fixing common validation errors.
