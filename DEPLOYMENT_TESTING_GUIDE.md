# Deployment and Testing Guide for CORS Fix

## Changes Summary

This fix addresses the "AbortError: signal is aborted without reason" issue when generating nutrition plans.

### Files Modified
1. **worker.js** - Backend CORS and logging improvements
2. **questionnaire.html** - Frontend timeout and error handling
3. **CORS_FIX_NOTES.md** - Comprehensive documentation (NEW)

## Deployment Steps

### 1. Deploy Backend (Cloudflare Worker)

```bash
# Navigate to project directory
cd /home/runner/work/aidiet/aidiet

# Deploy worker
npx wrangler deploy

# Or if wrangler is installed globally
wrangler deploy
```

Expected output:
```
Total Upload: ~43 KiB
Published aidiet-worker (X.XX sec)
  https://aidiet.radilov-k.workers.dev
```

### 2. Deploy Frontend (GitHub Pages)

The frontend is automatically deployed via GitHub Pages from the repository.

If you need to manually trigger a deployment:
1. Go to repository Settings → Pages
2. Verify source is set to deploy from branch
3. Any push to the main/master branch will trigger a rebuild

**Frontend URL**: https://radilovk.github.io/aidiet/

## Testing Procedure

### Pre-Test Checklist
- [ ] Worker is deployed and accessible
- [ ] Frontend is deployed on GitHub Pages
- [ ] Browser DevTools is open (Network tab)

### Test 1: CORS Preflight Cache

1. Open https://radilovk.github.io/aidiet/questionnaire.html
2. Open DevTools Network tab
3. Complete the questionnaire
4. Submit the form
5. **Check**: First request shows OPTIONS + POST
6. Refresh and submit again
7. **Expected**: Only POST request (OPTIONS is cached)

### Test 2: Timeout Handling

1. Complete questionnaire normally
2. Submit form
3. **Expected**: Request completes within 120 seconds
4. **Check**: No AbortError in console
5. **Check**: Backend logs show full request flow

### Test 3: Error Messages

Test with invalid data (optional):
1. Modify questionnaire.html temporarily to send invalid data
2. Submit form
3. **Expected**: User-friendly error message
4. **Expected**: No sensitive data exposed in UI

### Test 4: Backend Logs

View real-time logs:
```bash
npx wrangler tail
```

Then trigger a request from frontend. You should see:
```
POST /api/generate-plan
handleGeneratePlan: Starting
handleGeneratePlan: Request received for userId: XXXXX
handleGeneratePlan: Generating new plan for userId: XXXXX
handleGeneratePlan: AI response received for userId: XXXXX
handleGeneratePlan: Plan structured for userId: XXXXX
handleGeneratePlan: Plan cached for userId: XXXXX
```

### Test 5: Full User Flow

1. Go to https://radilovk.github.io/aidiet/
2. Click "Започни Сега" (Start Now)
3. Complete all questionnaire sections:
   - Basic info (name, age, gender, etc.)
   - Sleep and lifestyle
   - Food preferences
   - Medical conditions
4. Submit questionnaire
5. **Expected**: Loading spinner appears
6. **Expected**: Within 120 seconds, success message appears
7. **Expected**: Redirect to plan.html works
8. **Expected**: Generated plan is displayed correctly

## Monitoring

### Key Metrics to Watch

1. **CORS Preflight Rate**
   - Should be LOW (1 per user per 24 hours)
   - Check in Cloudflare Analytics

2. **Request Success Rate**
   - Should be HIGH (>95%)
   - Check error logs for failures

3. **Response Time**
   - Average: 30-60 seconds
   - Max: 120 seconds
   - Check in Cloudflare Analytics

4. **Error Patterns**
   - Monitor for AbortError (should be eliminated)
   - Monitor for timeout errors (should be rare)

### Log Monitoring Commands

```bash
# Real-time logs
npx wrangler tail

# Filter for errors only
npx wrangler tail --status error

# Follow specific user
npx wrangler tail | grep "userId: XXXXX"
```

## Rollback Plan

If issues persist after deployment:

1. **Revert Backend**
   ```bash
   git checkout <previous-commit-hash>
   npx wrangler deploy
   ```

2. **Revert Frontend**
   ```bash
   git revert HEAD
   git push
   ```

## Success Criteria

- [ ] No AbortError in browser console
- [ ] POST requests reach backend (visible in logs)
- [ ] OPTIONS requests are cached (visible in Network tab)
- [ ] Plans generate successfully within 120 seconds
- [ ] User-friendly error messages for failures
- [ ] No sensitive data in logs or error messages

## Known Limitations

1. **120-second timeout** may still be insufficient during extreme peak times
   - Consider implementing retry logic if this becomes an issue
   
2. **Mock data** is returned if no AI API keys are configured
   - Ensure OPENAI_API_KEY or GEMINI_API_KEY is set via `wrangler secret put`

3. **CORS headers allow all origins** (`*`)
   - For production, consider restricting to specific origins

## Support Resources

- **Worker Logs**: `npx wrangler tail`
- **Cloudflare Dashboard**: https://dash.cloudflare.com/
- **Fix Documentation**: CORS_FIX_NOTES.md
- **Deployment Guide**: DEPLOYMENT_CHECKLIST.md

## Contact

For issues or questions about this fix, refer to:
- CORS_FIX_NOTES.md for technical details
- GitHub Issues for bug reports
- Cloudflare Worker logs for runtime errors
