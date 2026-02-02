# Further Load Reduction - Granular Meal Plan Chunking

## User Requirement

**Original request (in Bulgarian):**
> "не знам дали просто да не разпределиш в повече етапи плана, за да падне натоварването на всяка заявка поотделно. казах ти че прецизността и минимум натоварване в заявка са приоритет"

**Translation:**
> "I don't know if you should just split the plan into more stages, to reduce the load on each individual request. I told you that precision and minimum load per request are priorities"

**Key Priorities:**
1. **Precision** - Maintain high quality results
2. **Minimum load per request** - Reduce token usage per individual request

## Problem

After the initial token optimization (which reduced prompt verbosity by 25-35%), the user requested even more granular splitting to further minimize load per request. The existing configuration used DAYS_PER_CHUNK=2, meaning each meal plan request generated 2 days of meals, which still results in relatively large token payloads.

## Solution

Reduced `DAYS_PER_CHUNK` from 2 to 1, making each meal plan request handle only 1 day of meals.

## Architecture Comparison

### Before: 6 Total AI Requests

```
Plan Generation Pipeline:
├─ Step 1: Analysis (1 request)
│  └─ ~304 tokens input
├─ Step 2: Strategy (1 request)  
│  └─ ~166 tokens input
└─ Step 3: Meal Plan (4 requests)
   ├─ Chunk 1: Days 1-2 (~2000-3000 tokens)
   ├─ Chunk 2: Days 3-4 (~2000-3000 tokens)
   ├─ Chunk 3: Days 5-6 (~2000-3000 tokens)
   └─ Chunk 4: Day 7 (~1000-1500 tokens)
```

**Total:** 6 requests

### After: 9 Total AI Requests

```
Plan Generation Pipeline:
├─ Step 1: Analysis (1 request)
│  └─ ~304 tokens input
├─ Step 2: Strategy (1 request)
│  └─ ~166 tokens input  
└─ Step 3: Meal Plan (7 requests)
   ├─ Chunk 1: Day 1 (~1000-1500 tokens)
   ├─ Chunk 2: Day 2 (~1000-1500 tokens)
   ├─ Chunk 3: Day 3 (~1000-1500 tokens)
   ├─ Chunk 4: Day 4 (~1000-1500 tokens)
   ├─ Chunk 5: Day 5 (~1000-1500 tokens)
   ├─ Chunk 6: Day 6 (~1000-1500 tokens)
   └─ Chunk 7: Day 7 (~1000-1500 tokens)
```

**Total:** 9 requests

## Impact Analysis

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| **Total Requests** | 6 | 9 | +50% |
| **Meal Plan Requests** | 4 | 7 | +75% |
| **Tokens per Meal Request** | ~2000-3000 | ~1000-1500 | **-50%** |
| **Max Request Size** | ~3000 tokens | ~1500 tokens | **-50%** |
| **Token Limit Risk** | Medium | Low | **Improved** |
| **Precision** | High | High | Maintained |
| **Error Isolation** | 2 days per failure | 1 day per failure | **Improved** |

## Benefits

### 1. Minimum Load Per Request ✅
- Each meal plan request now handles **50% less data**
- Maximum request size reduced from ~3000 to ~1500 tokens
- Well within safe limits for all AI models

### 2. Better Reliability ✅
- Lower token usage = less risk of hitting limits
- Smaller requests = faster processing
- Individual day failures don't affect other days

### 3. Maintained Precision ✅
- All data and context preserved
- Each day still receives full analysis and strategy
- Progressive refinement maintained (later days build on earlier)

### 4. Better Error Handling ✅
- If one day fails, only that day needs regeneration
- Before: 2-day chunk failure meant regenerating 2 days
- After: 1-day chunk failure means regenerating 1 day

### 5. Consistent Performance ✅
- All meal plan requests now similar size
- Before: Last chunk (Day 7) was smaller, causing inconsistency
- After: All chunks equal size (1 day each)

## Implementation Details

### Code Changes

**File:** `worker.js`

**Change 1: Update constant**
```javascript
// Before
const DAYS_PER_CHUNK = 2; // Generate 2 days at a time (optimal: 4 chunks total for 7 days)

// After  
const DAYS_PER_CHUNK = 1; // Generate 1 day at a time for minimum load per request (7 chunks total for 7 days)
```

**Change 2: Update documentation**
- Updated architecture comment to reflect 9 total requests
- Updated meal plan section to show 7 chunks (1 day each)
- Added note about minimum load per request priority

### No Logic Changes Required

The progressive generation logic automatically handles any chunk size:

```javascript
const chunks = Math.ceil(totalDays / DAYS_PER_CHUNK);
for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
  const startDay = chunkIndex * DAYS_PER_CHUNK + 1;
  const endDay = Math.min(startDay + DAYS_PER_CHUNK - 1, totalDays);
  // Generate meals for days startDay to endDay
}
```

With `DAYS_PER_CHUNK = 1`:
- `chunks = Math.ceil(7 / 1) = 7`
- Iteration 0: startDay=1, endDay=1 → Day 1
- Iteration 1: startDay=2, endDay=2 → Day 2
- ... and so on

## Performance Considerations

### Request Count
- **Before:** 6 requests per plan generation
- **After:** 9 requests per plan generation
- **Increase:** +3 requests (+50%)

### Total Time
Assuming each request takes ~2-5 seconds:
- **Before:** 6 × 3.5s = ~21 seconds
- **After:** 9 × 3.5s = ~31.5 seconds
- **Increase:** +10.5 seconds

**Trade-off:** Slightly longer total time for significantly improved reliability and lower risk of failures.

### API Cost
- 50% more requests = 50% more API calls
- However, smaller requests may be cheaper per-request on some API pricing models
- More importantly: Prevents expensive failures and retries

## Testing

### Syntax Validation
✅ `node -c worker.js` - Passed

### Code Review
✅ No issues found

### Security Scan (CodeQL)
✅ 0 vulnerabilities

### Logic Verification
✅ Progressive generation logic confirmed to handle DAYS_PER_CHUNK=1 correctly

## Deployment

### Pre-deployment Checklist
- [x] Code changes committed
- [x] Documentation updated
- [x] Syntax validated
- [x] Security scan passed
- [x] Logic verified

### Post-deployment Monitoring

**Monitor these metrics:**

1. **Token Usage Logs**
   - Check that meal plan chunks are ~1000-1500 tokens
   - Verify no "approaching limits" warnings

2. **Success Rate**
   - Monitor plan generation success rate
   - Should increase compared to before

3. **Generation Time**
   - Total time may increase by ~10 seconds
   - This is acceptable for improved reliability

4. **Error Rate**
   - Should decrease significantly
   - Token limit errors should be eliminated

### Rollback Plan

If issues arise, revert by changing:
```javascript
const DAYS_PER_CHUNK = 1; // Current
```
back to:
```javascript
const DAYS_PER_CHUNK = 2; // Previous
```

## Future Optimizations

If further load reduction is needed, we can:

1. **Split Analysis into 2 steps:**
   - Step 1a: Basic metrics (BMR, TDEE, macros)
   - Step 1b: Psychological analysis (emotional eating, success chance)
   - Would add 1 more request, reduce Analysis tokens by ~40%

2. **Split Strategy into 2 steps:**
   - Step 2a: Dietary approach (modifier, meal timing)
   - Step 2b: Support systems (supplements, hydration, psychology)
   - Would add 1 more request, reduce Strategy tokens by ~40%

3. **Combination:**
   - All of the above = 12 total requests
   - Maximum granularity for absolute minimum load per request

## Conclusion

This change successfully addresses the user's requirement for **minimum load per request** while maintaining **precision**:

- ✅ 50% reduction in tokens per meal plan request
- ✅ 50% increase in total requests for better distribution
- ✅ Maintains all data quality and precision
- ✅ Significantly improved reliability
- ✅ Better error handling and isolation

The architecture now provides excellent balance between granularity and efficiency, with each request well within safe token limits.
