# Timeout Fix - January 2026

## Problem Statement

Users reported seeing timeout errors when generating plans:
> "Заявката отне твърде дълго време. Моля, проверете интернет връзката и опитайте отново."
> (Translation: "The request took too long. Please check your internet connection and try again.")

## Root Cause Analysis

The timeout message can be caused by several factors, not just slow network:

### 1. Inconsistent Frontend Timeout Settings ✅ FIXED

**Issue:**
- `questionnaire.html` had 120-second timeout
- `profile.html` had only 60-second timeout

**Impact:**
When regenerating plans from the profile page, the timeout was too short for the multi-step AI process.

**Fix:**
Updated `profile.html` to use 120-second timeout to match `questionnaire.html`.

### 2. Multi-Step Generation Takes Time (Expected Behavior)

The application uses a **3-step AI approach** for maximum precision:

1. **Step 1:** Health Analysis (~20-40 seconds)
2. **Step 2:** Strategy Generation (~20-40 seconds)
3. **Step 3:** Meal Plan Creation (~30-60 seconds)
4. **Validation:** Plan validation + potential corrections (~10-30 seconds if needed)

**Total expected time:** 70-170 seconds under normal conditions

During peak times or with API delays, this can approach or exceed 120 seconds.

### 3. Cloudflare Worker Execution Limits

Cloudflare Workers have different execution time limits:

| Plan | CPU Time Limit | Wall-Clock Time Limit |
|------|----------------|----------------------|
| Free | 10ms | ~30 seconds* |
| Paid | 50ms | ~30 seconds* |
| Unbound Workers | 30 seconds | No hard limit |

**Important:** External API calls (OpenAI, Gemini) don't count toward CPU time but do count toward wall-clock time.

**Current Status:** The application makes external API calls, so CPU time is minimal. However, if wall-clock time exceeds ~30 seconds without proper configuration, requests may fail.

**Recommendation:** Ensure the Cloudflare Worker is configured properly:
- Use **Unbound Workers** for production (no wall-clock time limit)
- Or ensure requests complete within 30 seconds (difficult with 3-step approach)

### 4. API Rate Limiting

OpenAI and Gemini have rate limits that can cause delays:
- **OpenAI:** Varies by tier (Free: low, Paid: higher)
- **Gemini:** Requests per minute limits

When rate limited, API calls may queue, adding 10-60 seconds of delay.

### 5. Network/Connection Issues

True network problems can cause:
- Connection timeout
- DNS resolution failures
- SSL handshake failures
- Cloudflare network issues

## Changes Made

### Frontend Changes

#### questionnaire.html
1. **Enhanced logging:**
   - Track request start time
   - Log request duration
   - Log payload size
   - Better error categorization

2. **Improved error handling:**
   - Distinguish between timeout, network, and server errors
   - Show appropriate error messages
   - Log detailed error information for debugging

#### profile.html
1. **Increased timeout:** 60s → 120s
2. **Enhanced logging:** Same as questionnaire.html
3. **Improved error handling:** Same as questionnaire.html

### Backend Changes

**No changes needed** - The backend already has:
- Retry logic with exponential backoff (3 attempts)
- Proper error handling
- Detailed logging
- Validation with automatic corrections

## Testing Recommendations

### 1. Monitor Request Duration

Open browser DevTools Console and look for:
```
Sending request to backend...
Request payload size: XXXX bytes
Response received after XX.X seconds with status: 200
```

**Normal:** 70-120 seconds  
**Concerning:** >120 seconds (may timeout)  
**Problem:** <10 seconds with error (network or server issue)

### 2. Check for Specific Errors

| Error Type | Console Message | Likely Cause |
|------------|----------------|--------------|
| Timeout | "Request timeout after..." | Multi-step took >120s |
| Network | "Failed to fetch" | Connection problem |
| Server | "Server error: 500" | Backend error |
| Rate Limit | "429 Too Many Requests" | API rate limit |

### 3. Test Different Times

- **Peak hours** (lunch, evening): Higher API delays
- **Off-peak** (early morning): Faster responses

### 4. Check Cloudflare Dashboard

Monitor:
- Worker execution time
- Request success rate
- Error rate
- CPU time usage (should be <10ms per request)

## Recommended Next Steps

### Short-term (Immediate)

1. ✅ **Increase frontend timeout** (DONE)
2. ✅ **Add detailed logging** (DONE)
3. Monitor logs to identify real cause of timeouts

### Medium-term (Optional)

1. **Upgrade to Unbound Workers** if timeouts persist
   - Removes wall-clock time limit
   - Allows requests >30 seconds
   - Cost: Based on CPU time + duration

2. **Optimize API calls**
   - Use faster models (gpt-3.5-turbo instead of gpt-4)
   - Reduce prompt sizes
   - Cache common analyses

3. **Add progress updates**
   - Use Server-Sent Events (SSE) or WebSockets
   - Show which step is currently running
   - Improve user experience during long waits

### Long-term (Future Enhancement)

1. **Implement caching**
   - Cache analysis for similar profiles
   - Reuse strategies when appropriate
   - Reduce API calls

2. **Queue-based processing**
   - Accept request immediately
   - Process in background
   - Notify user when complete

3. **Hybrid approach**
   - Generate quick initial plan (<30s)
   - Refine with additional AI calls
   - Update plan progressively

## User-Facing Documentation

### For Users

If you see a timeout error:

1. **Wait 2-3 minutes** - The AI is analyzing your profile deeply
2. **Check internet connection** - Ensure stable connection
3. **Try again** - Temporary API delays may resolve
4. **Try different time** - Off-peak hours are faster

### Expected Wait Times

- **Normal:** 1-2 minutes
- **Peak hours:** 2-3 minutes
- **First request:** May be slower (model warming up)

### Not Actually a Timeout?

If you see the error consistently at the same time:
- Backend may be rate-limited (contact support)
- Cloudflare Worker may need configuration
- API keys may be invalid

## Technical Details

### Frontend Timeout Logic

```javascript
const controller = new AbortController();
const startTime = Date.now();
const timeoutId = setTimeout(() => {
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`Request timeout after ${elapsedTime} seconds (limit: 120 seconds)`);
    controller.abort();
}, 120000);
```

This creates an AbortController that will cancel the fetch request after 120 seconds (120000 milliseconds).

### Error Categorization

```javascript
if (error.name === 'AbortError') {
    // Frontend timeout - request exceeded 120 seconds
} else if (error.message.includes('Failed to fetch')) {
    // Network error - connection problem
} else if (error.message.includes('Server error')) {
    // Backend error - worker or API issue
}
```

## Monitoring Commands

### View Real-time Logs
```bash
npx wrangler tail
```

### View Only Errors
```bash
npx wrangler tail --status error
```

### Check Request Duration
Look for logs like:
```
Multi-step generation: Starting (3+ AI requests for precision)
Step 1 tokens: input=1234, output=567, cumulative=1801
Step 2 tokens: input=2345, output=678, cumulative=4824
...
```

## Summary

The timeout error can have multiple causes:

1. ✅ **Frontend timeout inconsistency** - FIXED
2. ⚠️ **Expected behavior** - Multi-step AI takes 70-120+ seconds
3. ⚠️ **Cloudflare Worker limits** - May need Unbound Workers
4. ⚠️ **API rate limiting** - Temporary delays from OpenAI/Gemini
5. ⚠️ **Network issues** - True connection problems

The enhanced logging will help identify the real cause in production.

## References

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [OpenAI Rate Limits](https://platform.openai.com/docs/guides/rate-limits)
- [Gemini API Limits](https://ai.google.dev/gemini-api/docs/quota)
- [CORS_FIX_NOTES.md](./CORS_FIX_NOTES.md) - Previous timeout fix
