# Testing Guide for ADLE v8 MealLogic Integration

## Overview
This document provides testing guidelines for validating the ADLE v8 MealLogic integration into the AI Diet system.

## Date
2026-01-28

## Testing Approach

Since the changes are in the AI prompt layer (not core logic), testing focuses on:
1. **Syntax validation** (completed ✅)
2. **Security scanning** (completed ✅)
3. **Manual functional testing** (recommended)

## Completed Tests

### 1. JavaScript Syntax Validation ✅
```bash
node -c worker.js
# Result: Syntax check passed!
```

### 2. CodeQL Security Analysis ✅
```bash
# CodeQL analysis completed
# Result: 0 alerts found - no security vulnerabilities
```

### 3. Git Integration ✅
- All changes committed successfully
- No merge conflicts
- Code review feedback addressed

## Recommended Manual Testing

### Test Case 1: Basic Meal Generation
**Objective**: Verify ADLE v8 rules are applied in meal generation

**Steps**:
1. Navigate to questionnaire and fill in user profile
2. Generate a meal plan (3-5 meals/day)
3. Review generated meals

**Expected Results**:
- ✅ No onion in any meals (hard ban)
- ✅ No peas + fish combinations (hard ban)
- ✅ Each meal has exactly 1 main protein (R1)
- ✅ Vegetables appear in ONE form: salad OR fresh side, not both (R2)
- ✅ Max 1 energy source per meal (R3)
- ✅ Max 1 dairy per meal (R4)

### Test Case 2: Legume Meals
**Objective**: Verify R8 (legumes-as-main blocks energy)

**Steps**:
1. Generate meals containing legumes as main protein (beans, lentils, chickpeas)
2. Check for energy sources in the same meal

**Expected Results**:
- ✅ Legume meals should NOT have rice/potatoes/pasta (Energy=0)
- ✅ Bread may be optional (1 slice wholegrain)
- ✅ No stacking of energy sources with legumes

### Test Case 3: Template C Restrictions
**Objective**: Verify R11 (Template C only for snacks)

**Steps**:
1. Generate a full day plan
2. Look for sandwich-type meals

**Expected Results**:
- ✅ Sandwiches should only appear as snacks
- ✅ No sandwiches for main meals (breakfast/lunch/dinner)
- ✅ No legumes in sandwiches

### Test Case 4: Fat Conflicts
**Objective**: Verify R5-R7 (fat conflict rules)

**Steps**:
1. Generate meals with cheese
2. Generate meals with bacon
3. Generate meals with nuts/seeds

**Expected Results**:
- ✅ Cheese meals should NOT have olive oil/butter
- ✅ Bacon meals should have Fat=0
- ✅ Nut/seed meals should NOT have olive oil/butter
- ✅ Olives + cheese is allowed (olives ≠ Fat slot)

### Test Case 5: Peas Special Handling
**Objective**: Verify R10 (peas as side blocks energy)

**Steps**:
1. Generate meals with peas as vegetable side (with meat)
2. Check for energy sources

**Expected Results**:
- ✅ Peas as side should NOT have rice/potatoes/pasta (Energy=0)
- ✅ Bread may be optional
- ✅ No peas + fish combination (hard ban)

### Test Case 6: Mode Filters
**Objective**: Verify mode priority over base rules

**Steps**:
1. Generate vegan meal plan
2. Generate keto meal plan
3. Generate gluten-free meal plan

**Expected Results - Vegan**:
- ✅ No animal protein (meat, fish, eggs, dairy)
- ✅ Legumes and plant protein only

**Expected Results - Keto**:
- ✅ Minimal energy sources (Bread=0, limited rice/potatoes)
- ✅ Higher fat and protein

**Expected Results - Gluten-Free**:
- ✅ Bread=0
- ✅ No bulgur, regular oats, regular pasta
- ✅ Only rice/potatoes/quinoa/buckwheat for energy

### Test Case 7: Rare Items Frequency
**Objective**: Verify ≤2 times/week for bacon, turkey ham

**Steps**:
1. Generate a 7-day meal plan
2. Count occurrences of bacon and turkey ham

**Expected Results**:
- ✅ Bacon appears max 2 times in 7 days
- ✅ Turkey ham appears max 2 times in 7 days

## Performance Testing

### Metrics to Monitor
1. **Response Time**: Meal plan generation should complete within reasonable time
2. **Token Usage**: Verify prompts stay within MEAL_PLAN_TOKEN_LIMIT (8000)
3. **Completion Rate**: All 7 days should be generated successfully

### Expected Performance
- Progressive generation: 3 chunks (days 1-2, 3-4, 5-7)
- Each chunk: < 30 seconds
- Total generation: < 2 minutes
- Token usage per chunk: < 8000 tokens

## Edge Cases to Test

### Edge Case 1: Conflicting User Preferences
**Scenario**: User likes cheese but dislikes olive oil
**Expected**: Should work seamlessly (R6 prevents olive oil with cheese anyway)

### Edge Case 2: Multiple Dietary Restrictions
**Scenario**: Vegan + gluten-free + low-carb
**Expected**: Should generate valid meals or return "no valid result under these constraints"

### Edge Case 3: Medical Conditions
**Scenario**: Diabetes + IBS + high cholesterol
**Expected**: Meals should respect all medical constraints from mode filter

## Regression Testing

Verify existing functionality still works:

1. ✅ Multi-step generation (3 AI queries)
2. ✅ BMR and TDEE calculation
3. ✅ Macro nutrient calculations
4. ✅ Meal chronological ordering
5. ✅ Late-night snack restrictions
6. ✅ Chronotype-based calorie distribution
7. ✅ Stress-based food recommendations
8. ✅ Medical correlation logic

## Automated Testing (Future Enhancement)

### Recommended Test Suite Structure
```javascript
describe('ADLE v8 MealLogic Integration', () => {
  describe('Hard Bans (R0)', () => {
    test('should not generate meals with onion');
    test('should not generate peas + fish combinations');
    test('should limit bacon to ≤2 times/week');
  });
  
  describe('Hard Rules (R1-R12)', () => {
    test('R1: should have exactly 1 main protein per meal');
    test('R2: should have vegetables in ONE form only');
    test('R3: should have 0-1 energy sources per meal');
    test('R8: should block energy when legumes are main');
    test('R10: should block energy when peas are side');
  });
  
  describe('Mode Filters', () => {
    test('vegan mode should exclude all animal products');
    test('keto mode should minimize energy sources');
    test('gluten-free mode should exclude gluten sources');
  });
});
```

## Bug Reporting Template

If issues are found during testing:

```markdown
**Bug Title**: [Brief description]

**Severity**: [Critical/High/Medium/Low]

**Test Case**: [Which test case revealed the bug]

**Steps to Reproduce**:
1. 
2. 
3. 

**Expected Result**:
[What should happen according to ADLE v8 rules]

**Actual Result**:
[What actually happened]

**Rule Violated**:
[Which rule from R0-R12 or special rules]

**Additional Context**:
- User profile settings:
- Mode filter applied:
- Meal type:
```

## Testing Notes

### Limitations
- **AI-Driven**: Rules are enforced via AI prompts, not hard-coded logic
- **Non-Deterministic**: AI may occasionally deviate from rules
- **Language Model Dependent**: Results depend on AI model capabilities

### Monitoring
- Monitor AI responses for rule violations
- Track frequency of "no valid result" responses
- Log instances where repair logic is triggered

## Success Criteria

The integration is considered successful if:

1. ✅ All hard bans are consistently enforced (100% compliance)
2. ✅ Hard rules R1-R12 are followed in >95% of generated meals
3. ✅ Mode filters override base rules correctly
4. ✅ No security vulnerabilities introduced
5. ✅ No performance degradation
6. ✅ Existing functionality remains intact
7. ✅ User satisfaction with meal quality maintained or improved

## Rollback Plan

If critical issues are discovered:

1. Revert commit: `git revert c6c09ad`
2. Remove ADLE v8 sections from prompts
3. Restore constants if causing issues
4. Test reversion
5. Document issues for future fix

## Sign-Off

- [x] Syntax validated
- [x] Security scanned (0 vulnerabilities)
- [x] Code review feedback addressed
- [x] Documentation complete
- [ ] Manual functional testing (recommended before production)
- [ ] Performance testing (recommended before production)
- [ ] User acceptance testing (recommended before production)

---

**Note**: This integration follows a symbiosis approach - it enhances existing logic rather than replacing it. The base architecture and templates remain intact, with ADLE v8 adding precision through strict rules.
