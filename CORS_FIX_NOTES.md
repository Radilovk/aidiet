# CORS and Timeout Fix Documentation

## Problem Description

Users were experiencing an "AbortError: signal is aborted without reason" when trying to generate their nutrition plan. The frontend would send a POST request to `/api/generate-plan`, but it would fail before reaching the backend.

### Symptoms
- OPTIONS (CORS preflight) request succeeded with status 200
- POST request never reached the backend (no logs for POST)
- Frontend showed: `AbortError: signal is aborted without reason`
- Error occurred at the timeout controller line

### Root Causes Identified

1. **CORS Headers Not Properly Configured**
   - Missing `Access-Control-Max-Age` header to cache preflight responses
   - OPTIONS response should use status 204 instead of 200 with null body

2. **Timeout Too Short**
   - 60-second timeout was insufficient for AI model processing
   - Some AI API calls can take 60+ seconds during peak times

3. **Insufficient Error Logging**
   - Backend lacked detailed logging to track request flow
   - Frontend didn't distinguish between different error types

## Changes Made

### Backend (worker.js)

1. **Enhanced CORS Headers**
```javascript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
  'Content-Type': 'application/json'
};
```

2. **Improved OPTIONS Handler**
```javascript
if (request.method === 'OPTIONS') {
  console.log('CORS preflight request');
  return new Response(null, { 
    status: 204,  // Proper status for preflight
    headers: CORS_HEADERS 
  });
}
```

3. **Added Detailed Logging**
```javascript
async function handleGeneratePlan(request, env) {
  console.log('handleGeneratePlan: Starting');
  const data = await request.json();
  console.log('handleGeneratePlan: Data received', JSON.stringify(data).substring(0, 100));
  // ... more logging throughout the function
}
```

### Frontend (questionnaire.html)

1. **Increased Timeout**
```javascript
// Changed from 60 seconds to 120 seconds
const timeoutId = setTimeout(() => {
    console.error('Request timeout after 120 seconds');
    controller.abort();
}, 120000);
```

2. **Enhanced Error Handling**
```javascript
if (error.name === 'AbortError') {
    errorMessage = 'Заявката отне твърде дълго време. Моля, проверете интернет връзката и опитайте отново.';
} else if (error.message.includes('Failed to fetch')) {
    errorMessage = 'Неуспешна връзка със сървъра. Моля, проверете интернет връзката и опитайте отново.';
}
```

3. **Better Logging**
```javascript
console.log('Sending request to backend...');
console.log('Response status:', response.status);
console.log('Result received:', result);
```

## Technical Explanation

### Why Access-Control-Max-Age Matters
- Without this header, browsers make a preflight OPTIONS request before EVERY POST request
- With the header set to 86400 seconds (24 hours), the browser caches the CORS check
- This reduces latency and prevents race conditions

### Why Status 204 for OPTIONS
- Status 204 (No Content) is the standard for successful OPTIONS with no response body
- Some browsers/networks handle 200 + null body differently
- 204 is more explicit and universally supported

### Why 120-Second Timeout
- AI model calls (OpenAI GPT-4o-mini, Gemini Pro) can take 30-90 seconds
- Network latency adds 5-15 seconds
- During peak times, API queuing adds 10-30 seconds
- 120 seconds provides adequate buffer while still preventing indefinite hangs

## Testing Recommendations

### Backend Testing
```bash
# Test CORS preflight
curl -X OPTIONS https://aidiet.radilov-k.workers.dev/api/generate-plan \
  -H "Origin: https://radilovk.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v

# Should return 204 with CORS headers including Access-Control-Max-Age
```

### Frontend Testing
1. Open browser DevTools Network tab
2. Complete questionnaire and submit
3. Verify:
   - Only ONE OPTIONS request (subsequent requests should be cached)
   - POST request reaches server (check backend logs)
   - Response arrives within 120 seconds
   - No AbortError in console

### Monitoring Points
- Check Cloudflare Worker logs for request flow
- Monitor response times from AI APIs
- Track CORS preflight frequency (should be low after first request)

## Prevention

To prevent similar issues in the future:

1. **Always set Access-Control-Max-Age** for cross-origin APIs
2. **Use 204 status** for OPTIONS responses
3. **Set generous timeouts** for AI/ML API calls (2x expected time)
4. **Add detailed logging** at every step of request handling
5. **Test cross-origin requests** from the actual deployment domain

## References

- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Cloudflare Workers CORS Guide](https://developers.cloudflare.com/workers/examples/cors-header-proxy/)
- [HTTP Status 204](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/204)
