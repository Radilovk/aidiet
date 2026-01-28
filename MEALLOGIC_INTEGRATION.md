# ADLE v8 MealLogic Integration

## Overview
This document describes the integration of the new meallogic.txt (ADLE v8 EN - Universal Meal Constructor) into the AI Diet system's worker.js backend.

## Date
2026-01-28

## Integration Scope

### What Was Integrated
The ADLE v8 Universal Meal Constructor brings a sophisticated slot-based meal generation system with strict validation rules. The key improvements include:

1. **Hard Bans (0% Always)**
   - Onion (any form)
   - Turkey meat
   - Artificial sweeteners
   - Honey, sugar, jam, syrups
   - Ketchup, mayonnaise, BBQ/sweet sauces
   - Peas + fish combination

2. **Rare Items (≤2 times/week)**
   - Turkey ham
   - Bacon

3. **12 Hard Rules (R1-R12)**
   - R1: Exactly 1 main protein, secondary only with breakfast+eggs
   - R2: 1-2 vegetables in ONE form only (Salad OR Fresh side, not both)
   - R3: 0-1 energy sources (never 2)
   - R4: Max 1 dairy per meal (including sauces/dressings)
   - R5: 0-1 fat source; nuts/seeds block olive oil/butter
   - R6: Cheese blocks olive oil/butter; olives allowed with cheese
   - R7: Bacon blocks other fat sources
   - R8: Legumes-as-main blocks energy sources; bread optional
   - R9: Bread optional only when Energy=0 (outside Template C)
   - R10: Peas as side blocks energy slot; bread optional
   - R11: Template C (sandwich) only for snacks; no legumes
   - R12: Outside-whitelist additions only when objectively required with reason

4. **Priority System**
   Hard bans → Mode filter → Template constraints → Hard rules → Repair → Output

5. **Special Rules**
   - Peas + fish = strictly forbidden
   - Vegetables: ONE form per meal (Salad XOR Fresh side)
   - Dairy count includes sauces/dressings
   - Olives are salad add-on, not Fat slot
   - Corn is not energy source
   - Template C only for snacks

## Files Modified

### worker.js
**Lines 731-764**: Added ADLE v8 constants
- `ADLE_V8_HARD_BANS`: Array of completely banned items
- `ADLE_V8_RARE_ITEMS`: Array of items limited to ≤2 times/week
- `ADLE_V8_HARD_RULES`: Object containing R1-R12 rule descriptions
- `ADLE_V8_SPECIAL_RULES`: Object containing special edge case rules
- **Note**: These constants are currently used for documentation/reference and can be utilized in future validation logic or dynamic prompt generation

**Lines 1715-1746**: Updated `generateMealPlanChunkPrompt()`
- Added comprehensive ADLE v8 STRICT RULES section
- Integrated priority system
- Added hard bans list
- Added all 12 hard rules (R1-R12)
- Added special rules for edge cases

**Lines 1976-2006**: Updated `generateMealPlanPrompt()`
- Added identical ADLE v8 STRICT RULES section
- Ensures consistency between progressive and legacy generation modes

## Compatibility with Existing System

### Preserved Features
✅ Multi-step generation approach (3 AI queries)
✅ Dietary modifiers (Веган, Кето, Без глутен, etc.)
✅ Medical principles for meal ordering
✅ Chronotype-based calorie distribution
✅ Correlation with stress, sleep, and nutrition
✅ Template architecture (A, B, C, D)
✅ Category system ([PRO], [ENG], [VOL], [FAT], [CMPX])
✅ Late-night snack restrictions
✅ Bulgarian/Mediterranean food focus

### Enhanced Features
✨ **More Precise Rules**: 12 hard rules vs. previous flexible guidelines
✨ **Conflict Prevention**: Explicit fat/dairy/energy conflict rules
✨ **Vegetable Form Constraint**: Prevents salad + fresh side combo
✨ **Legume Optimization**: Clear energy blocking when legumes are main
✨ **Peas Special Handling**: Dedicated rule for peas as side dish
✨ **Priority System**: Clear execution order for validators
✨ **Outside-Whitelist Control**: Requires justification for rare items

## Symbiosis Approach

Rather than replacing the existing archprompt.txt logic, the integration creates a **symbiosis**:

1. **Base Architecture Preserved**
   - Category system ([PRO], [ENG], [VOL], [FAT], [CMPX]) remains
   - Template types (A, B, C, D) remain
   - Modifier filtering approach remains

2. **Rules Enhanced**
   - Previous flexible guidelines → now strict hard rules
   - Previous "avoid" suggestions → now absolute bans
   - Previous template freedom → now constrained by context

3. **Validation Strengthened**
   - Priority system ensures deterministic rule application
   - Repair logic now follows clear order
   - Edge cases explicitly handled

## Benefits of Integration

1. **Precision**: Meals follow strict nutritional logic
2. **Consistency**: Same rules applied across all meals
3. **Medical Compliance**: Better adherence to dietary restrictions
4. **Conflict Prevention**: Explicit rules prevent invalid combinations
5. **Maintainability**: Rules documented and testable
6. **Scalability**: Easy to add new modes/restrictions

## Testing Recommendations

To validate the integration:

1. **Test Basic Meals**
   - Standard mode with 3 meals/day
   - Verify R1 (1 protein), R2 (1 veg form), R3 (0-1 energy)

2. **Test Edge Cases**
   - Legume meals (should have Energy=0 per R8)
   - Peas as side (should block Energy per R10)
   - Cheese meals (should exclude olive oil/butter per R6)
   - Sandwich/Template C (should be snack only per R11)

3. **Test Mode Filters**
   - Vegan mode (no animal protein)
   - Keto mode (minimal energy sources)
   - Gluten-free mode (limited energy sources)

4. **Test Bans**
   - Verify onion never appears
   - Verify peas+fish never appear together
   - Verify ketchup/mayo never appear

## Future Enhancements

Potential improvements for future iterations:

1. **Machine-Friendly Output**: Add template/mode labels to JSON output
2. **Repair Function**: Implement deterministic repair logic in JavaScript
3. **Validation Layer**: Add pre-generation validation of constraints
4. **Analytics**: Track rule violations and repair frequency
5. **A/B Testing**: Compare ADLE v8 vs. previous algorithm outcomes

## Notes

- The integration is **additive**, not replacive
- Existing functionality is preserved
- Rules are enforced via AI prompts, not hardcoded logic
- System remains flexible while adding precision
- Bulgarian language and cultural context maintained

## References

- Source: `/home/runner/work/aidiet/aidiet/meallogic.txt` (ADLE v8 EN)
- Previous: `/home/runner/work/aidiet/aidiet/archprompt.txt` (ADLE v5.1 BG)
- Modified: `/home/runner/work/aidiet/aidiet/worker.js`
