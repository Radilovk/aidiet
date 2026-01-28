# Unbound Workers Deployment Guide

## Overview

This guide explains how to deploy the Unbound Workers configuration to fix the server timeout issue at 40-50% progress.

## Problem Fixed

**Issue:** Users were getting "Неуспешна връзка със сървъра" (server connection failure) at 40-50% progress (~30 seconds into the request).

**Root Cause:** Cloudflare Workers on standard plans have a ~30 second wall-clock time limit. The multi-step AI generation takes 70-170 seconds, causing consistent timeouts.

**Solution:** Unbound Workers removes the wall-clock time limit, allowing the full AI generation process to complete.

## Prerequisites

### 1. Cloudflare Paid Plan Required

Unbound Workers requires a Cloudflare **Paid plan** (Workers Paid or higher).

- **Free tier:** Cannot use Unbound Workers
- **Workers Paid ($5/month):** Includes Unbound Workers
- **Bundled/Business plans:** Also include Unbound Workers

**Check your plan:**
1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **Workers & Pages**
3. Click on **Plans** to see your current plan
4. Upgrade if needed at [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)

### 2. Wrangler CLI

Ensure you have Wrangler installed:

```bash
npm install -g wrangler
# or use npx
npx wrangler --version
```

### 3. Authentication

Log into Cloudflare:

```bash
wrangler login
```

This will open a browser window for authentication.

## Deployment Steps

### Step 1: Verify Configuration

The Unbound Workers configuration is already added to `wrangler.toml`:

```toml
[usage_model]
type = "unbound"
```

Verify it's present:

```bash
cat wrangler.toml | grep -A 1 "usage_model"
```

Expected output:
```
[usage_model]
type = "unbound"
```

### Step 2: Test Locally (Optional)

Test the worker locally:

```bash
wrangler dev
```

This runs the worker in development mode. Try generating a plan to ensure everything works.

**Note:** Local development doesn't have the same time limits as production, so timeouts won't occur locally.

### Step 3: Deploy to Production

Deploy the worker with Unbound configuration:

```bash
wrangler deploy
```

**Expected output:**
```
 ⛅️ wrangler 4.x.x
───────────────────
Total Upload: XX.XX KiB / gzip: XX.XX KiB
Uploaded aidiet-worker (X.XX sec)
Published aidiet-worker (X.XX sec)
  https://aidiet.radilov-k.workers.dev
Current Deployment ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Step 4: Verify Deployment

Check the worker is deployed successfully:

```bash
wrangler deployments list
```

This shows recent deployments and their status.

### Step 5: Test in Production

1. Open the application: https://aidiet.radilov-k.workers.dev
2. Complete the questionnaire
3. Wait for plan generation (should take 70-170 seconds)
4. Verify it completes successfully without timeout at 40-50%

**What to expect:**
- Progress should reach 90-99% before completion
- No "Неуспешна връзка със сървъра" error at 40-50%
- Full plan generation completes successfully

## Monitoring

### Check Worker Logs

View real-time logs:

```bash
wrangler tail
```

This shows all requests and their duration.

### Check for Errors

View only errors:

```bash
wrangler tail --status error
```

### Monitor Usage

Check the Cloudflare Dashboard:

1. Go to **Workers & Pages**
2. Click on **aidiet-worker**
3. View **Metrics** tab
4. Check:
   - Success rate (should be >95%)
   - CPU time per request (should be <50ms)
   - Duration per request (70-170 seconds)
   - Errors (should be minimal)

## Pricing Impact

### Unbound Workers Pricing

| Component | Free Tier | Paid Plan |
|-----------|-----------|-----------|
| Base price | N/A | $5/month |
| Requests | 100,000/day included | 10 million/month included |
| Duration | Standard (30s limit) | Charged: $12.50 per million GB-s |
| CPU time | 10ms per request | 30 seconds per request |

### Estimated Cost for AI Diet

**Assumptions:**
- 100 plan generations per day
- Average duration: 120 seconds per request
- Average CPU time: 5ms per request (external API calls don't count)
- Memory usage: 128 MB per request

**Monthly cost calculation:**
- Base plan: $5/month
- Requests: 3,000/month (well within 10 million included)
- Duration: 3,000 × 120s × 0.128GB = 46,080 GB-s/month
  - First 400,000 GB-s included
  - Additional: 0 GB-s (within included)
- CPU time: 3,000 × 5ms = 15,000ms = 15s total (negligible)

**Total estimated cost: $5/month** (just the base plan)

Even with 1,000 generations per day:
- Duration: 460,800 GB-s/month
- Additional charge: ~$0.76/month
- **Total: ~$5.76/month**

### Cost Optimization

The cost is minimal because:
1. **CPU time is low:** External API calls (OpenAI, Gemini) don't count
2. **Duration is reasonable:** 120 seconds per request is normal for AI
3. **Memory usage is efficient:** 128 MB per request
4. **Included quotas are generous:** 400,000 GB-s/month included

## Troubleshooting

### Issue: "Your account does not have access to Unbound Workers"

**Solution:** Upgrade to a Paid plan:
1. Go to [Workers Plans](https://dash.cloudflare.com/?to=/:account/workers/plans)
2. Select **Workers Paid** ($5/month)
3. Complete the upgrade
4. Redeploy: `wrangler deploy`

### Issue: Worker still timing out at 30 seconds

**Possible causes:**
1. Deployment didn't apply the Unbound configuration
   - Re-run: `wrangler deploy`
   - Verify: `wrangler deployments list`

2. Using an old deployment
   - Check browser cache (hard refresh with Ctrl+Shift+R)
   - Verify deployment ID in dashboard matches recent deploy

3. Still on Free plan
   - Verify plan in dashboard
   - Ensure payment method is added

### Issue: Increased costs

**Check:**
1. View **Metrics** in Cloudflare Dashboard
2. Look for unexpected spikes in requests or duration
3. Enable rate limiting if needed (see CORS_FIX_NOTES.md)

## Alternative Solutions

If you cannot upgrade to a Paid plan:

### Option 1: Optimize for 30-second limit

Reduce AI generation time by:
1. Using faster models (gpt-3.5-turbo instead of gpt-4)
2. Reducing prompt sizes
3. Removing validation step
4. Using cached analyses

**Trade-off:** Lower quality AI generation

### Option 2: Split into multiple requests

Change to multi-step UI:
1. Request 1: Health Analysis (20s) → show results
2. Request 2: Strategy (20s) → show results
3. Request 3: Meal Plan (30s) → show final plan

**Trade-off:** More complex UI, worse user experience

### Option 3: Queue-based processing

Use Cloudflare Queues:
1. Accept request immediately
2. Process in background with Unbound Worker
3. Notify user when complete (email or push notification)

**Trade-off:** Requires significant code changes

## Recommended: Keep Unbound Workers

The Paid plan ($5/month) with Unbound Workers is the **recommended solution** because:

✅ Simplest implementation (already done)  
✅ Best user experience (no changes needed)  
✅ Minimal cost (~$5-6/month)  
✅ No quality trade-offs  
✅ Scales well with usage  

## References

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Unbound Workers Documentation](https://developers.cloudflare.com/workers/platform/pricing/#unbound-usage-model)
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [TIMEOUT_FIX_2026.md](./TIMEOUT_FIX_2026.md) - Technical details
- [РЕШЕНИЕ_ТАЙМАУТ_2026.md](./РЕШЕНИЕ_ТАЙМАУТ_2026.md) - Bulgarian documentation

## Support

If you encounter issues:

1. Check [Cloudflare Status](https://www.cloudflarestatus.com/)
2. Review worker logs: `wrangler tail`
3. Check metrics in Cloudflare Dashboard
4. Contact Cloudflare Support (available on Paid plans)

## Summary

**What was changed:**
- Added `[usage_model] type = "unbound"` to `wrangler.toml`

**What needs to be done:**
1. Ensure Cloudflare Paid plan is active
2. Deploy with: `wrangler deploy`
3. Test plan generation
4. Monitor for ~24 hours

**Expected result:**
- No more timeouts at 40-50% progress
- Plan generation completes successfully
- Cost: ~$5-6/month

The fix is minimal and highly effective! 🎉
