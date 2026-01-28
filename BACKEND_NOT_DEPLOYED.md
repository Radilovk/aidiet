# Backend Not Deployed Error

## Problem

You're seeing this error when trying to submit the questionnaire:

```
TypeError: Failed to fetch
Error: Неуспешна връзка със сървъра. Моля, проверете интернет връзката и опитайте отново.
```

**Console shows:**
```
Request payload size: 725 bytes
Error submitting data: TypeError: Failed to fetch
```

## Root Cause

The **Cloudflare Worker backend has not been deployed**. 

The frontend application is hosted on GitHub Pages at:
```
https://radilovk.github.io/aidiet/
```

But it's trying to call a backend API at:
```
https://aidiet.radilov-k.workers.dev/api/generate-plan
```

This backend URL **does not exist** because the Cloudflare Worker hasn't been deployed yet.

## Quick Test

You can verify this yourself:
```bash
curl https://aidiet.radilov-k.workers.dev/api/generate-plan
# Returns: "Could not resolve host"
```

## Solution: Deploy the Backend

The backend code is ready in `worker.js`, but it needs to be deployed to Cloudflare Workers.

### Prerequisites

1. **Cloudflare Account** (Free tier is sufficient)
   - Sign up at https://cloudflare.com
   - Note: Unbound Workers (enabled in wrangler.toml) requires Paid plan ($5/month)
   - For testing, you can temporarily disable Unbound Workers

2. **API Keys** - Get ONE of these:
   - **OpenAI API Key** (recommended): https://platform.openai.com/api-keys
   - **Gemini API Key** (free tier): https://makersuite.google.com/app/apikey

3. **Wrangler CLI**
   ```bash
   npm install -g wrangler
   ```

### Deployment Steps

#### Step 1: Login to Cloudflare
```bash
wrangler login
```
This opens a browser for authentication.

#### Step 2: Create KV Namespace
```bash
wrangler kv:namespace create "page_content"
```
Copy the namespace ID returned (it's already in wrangler.toml, so this might say it exists).

#### Step 3: Configure API Keys
Choose ONE or BOTH:

**For OpenAI:**
```bash
wrangler secret put OPENAI_API_KEY
# Paste your OpenAI API key when prompted
```

**For Gemini:**
```bash
wrangler secret put GEMINI_API_KEY
# Paste your Gemini API key when prompted
```

#### Step 4: (Optional) Disable Unbound Workers for Testing

If you're on the Free tier, edit `wrangler.toml` and comment out:
```toml
# [usage_model]
# type = "unbound"
```

**Note:** This will cause timeouts after 30 seconds, but it allows you to test the deployment.

#### Step 5: Deploy
```bash
wrangler deploy
```

Expected output:
```
✨ Successfully published your script to
 https://aidiet.radilov-k.workers.dev
```

#### Step 6: Verify
```bash
curl -I https://aidiet.radilov-k.workers.dev/api/generate-plan
# Should return: HTTP/1.1 405 Method Not Allowed (that's OK - it means server is up)
```

### After Deployment

1. **Test the frontend**: Go to https://radilovk.github.io/aidiet/
2. **Complete the questionnaire**
3. **Submit** - should work now!

## Alternative: Test Locally

If you want to test without deploying to Cloudflare:

### Step 1: Run Worker Locally
```bash
cd /path/to/aidiet
wrangler dev
```

This starts the worker at `http://localhost:8787`

### Step 2: Update Frontend URL

Temporarily change the API URL in these files:
- `questionnaire.html` (line 1700)
- `profile.html` (similar line)
- `plan.html` (similar line)

From:
```javascript
const response = await fetch('https://aidiet.radilov-k.workers.dev/api/generate-plan', {
```

To:
```javascript
const response = await fetch('http://localhost:8787/api/generate-plan', {
```

### Step 3: Serve Frontend Locally
```bash
python -m http.server 8000
# or
npx serve .
```

Open http://localhost:8000 and test.

**Remember to revert the URL changes before committing!**

## Cost Breakdown

### If Using Free Cloudflare Plan
- **Cloudflare Workers Free**: Free for 100,000 requests/day
- **Limitation**: 30-second timeout (will fail on long AI requests)
- **OpenAI API**: Pay per use (~$0.002 per plan generation with gpt-3.5-turbo)
- **Total**: ~Free to very low cost

### If Using Paid Cloudflare Plan ($5/month)
- **Cloudflare Workers Paid**: $5/month + usage
- **Unbound Workers**: Removes 30s timeout (already configured in wrangler.toml)
- **OpenAI API**: Same as above
- **Total**: ~$5-6/month

### If Using Gemini (Free Tier)
- **Gemini API**: Free tier available (60 requests/minute)
- **Cost**: Free for moderate usage
- **Total**: $0-5/month depending on Cloudflare plan

## Troubleshooting

### "Could not resolve host"
- Backend not deployed yet
- Follow deployment steps above

### "401 Unauthorized" or "API key not found"
- API keys not configured
- Run: `wrangler secret put OPENAI_API_KEY` or `GEMINI_API_KEY`

### "Timeout after 30 seconds"
- Free tier has 30s limit
- Upgrade to Paid plan and enable Unbound Workers
- Or use faster AI model (gpt-3.5-turbo instead of gpt-4)

### "KV namespace not found"
- Run: `wrangler kv:namespace create "page_content"`
- Or check that the ID in wrangler.toml matches your KV namespace

## Summary

**The issue is NOT with the code** - it's ready and waiting. 

**The issue is that the backend hasn't been deployed.**

Follow the deployment steps above, and the application will work perfectly!

## Related Documentation

- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) - Complete deployment checklist
- [WORKER_README.md](./WORKER_README.md) - Worker deployment instructions
- [UNBOUND_WORKERS_DEPLOYMENT.md](./UNBOUND_WORKERS_DEPLOYMENT.md) - Unbound Workers guide
- [wrangler.toml](./wrangler.toml) - Worker configuration

## Quick Commands Summary

```bash
# Install Wrangler
npm install -g wrangler

# Login
wrangler login

# Configure API key (choose one)
wrangler secret put OPENAI_API_KEY
# or
wrangler secret put GEMINI_API_KEY

# Deploy
wrangler deploy

# Verify
curl -I https://aidiet.radilov-k.workers.dev/api/generate-plan
```

That's it! The backend will be live and the application will work. 🚀
