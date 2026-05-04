# Deployment Checklist

## Pre-Deployment Setup

- [ ] Install Wrangler CLI globally
  ```bash
  npm install -g wrangler
  ```

- [ ] Login to Cloudflare
  ```bash
  wrangler login
  ```

## Cloudflare Configuration

### 1. Create KV Namespace

- [ ] Create production KV namespace
  ```bash
  wrangler kv:namespace create "page_content"
  ```

- [ ] Note the namespace ID (format: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

- [ ] Update `wrangler.toml` with the KV namespace ID
  - Replace `YOUR_KV_NAMESPACE_ID` in both `[[kv_namespaces]]` sections

### 2. Configure AI API Keys

Choose ONE of the following options:

#### Option A: OpenAI (Recommended for quality)

- [ ] Get API key from https://platform.openai.com/api-keys

- [ ] Set the secret
  ```bash
  wrangler secret put OPENAI_API_KEY
  ```

#### Option B: Google Gemini (Free tier available)

- [ ] Get API key from https://makersuite.google.com/app/apikey

- [ ] Set the secret
  ```bash
  wrangler secret put GEMINI_API_KEY
  ```

#### Option C: Both (Worker will prefer OpenAI if both are set)

- [ ] Set both secrets as described above

## Deploy Worker

- [ ] Test locally first
  ```bash
  wrangler dev
  ```

- [ ] Deploy to production
  ```bash
  wrangler deploy
  ```

- [ ] Verify deployment at: https://aidiet.radilov-k.workers.dev/

## Test Deployment

### 1. Test API Endpoints

- [ ] Test generate plan endpoint
  ```bash
  curl -X POST https://aidiet.radilov-k.workers.dev/api/generate-plan \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Test User",
      "age": 30,
      "height": 180,
      "weight": 85,
      "gender": "Мъж",
      "goal": "Отслабване",
      "email": "test@example.com"
    }'
  ```

- [ ] Test chat endpoint (use userId from previous response)
  ```bash
  curl -X POST https://aidiet.radilov-k.workers.dev/api/chat \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "YOUR_USER_ID",
      "message": "Може ли да ям банани?"
    }'
  ```

### 2. Test Frontend

- [ ] Open test.html in browser
- [ ] Click "Test Generate Plan"
- [ ] Verify plan is generated
- [ ] Click "Test Chat"
- [ ] Verify chat response

### 3. Complete User Flow

- [ ] Open index.html
- [ ] Click "Започни Сега"
- [ ] Complete questionnaire
- [ ] Verify plan generation
- [ ] Test day navigation (Day 1-7)
- [ ] Test meal info modals
- [ ] Open chat assistant
- [ ] Send test messages
- [ ] Verify context-aware responses

## Monitoring & Maintenance

- [ ] Check Cloudflare Workers dashboard for analytics
- [ ] Monitor KV storage usage
- [ ] Check API usage/costs (OpenAI/Gemini)
- [ ] Review error logs if issues occur

## Troubleshooting

### If deployment fails:
- Verify wrangler.toml syntax
- Check KV namespace ID is correct
- Ensure you have permissions in Cloudflare

### If API calls fail:
- Verify API keys are set correctly
- Check API key permissions and quotas
- Review worker logs: `wrangler tail`

### If frontend doesn't work:
- Check browser console for errors
- Verify worker URL in questionnaire.html and plan.html
- Check CORS settings in worker.js

## Optional Enhancements

- [ ] Set up custom domain
- [ ] Add rate limiting
- [ ] Implement user authentication
- [ ] Set up monitoring/alerts
- [ ] Configure caching headers
- [ ] Add analytics tracking

## Notes

- Mock data is used when no API keys are configured
- KV storage has free tier limits (check Cloudflare docs)
- Worker has 100k requests/day on free tier
- Consider upgrading for production use

## Support

For issues, check:
- Worker logs: `wrangler tail`
- Cloudflare dashboard: https://dash.cloudflare.com/
- Documentation: See README.md and WORKER_README.md
