# AI Diet Worker Deployment

## Setup Instructions

### 1. Install Wrangler CLI
```bash
npm install -g wrangler
```

### 2. Login to Cloudflare
```bash
wrangler login
```

### 3. Create KV Namespace
```bash
# Create production KV namespace
wrangler kv:namespace create "page_content"

# Note the ID returned and update it in wrangler.toml
```

### 4. Configure API Keys
Choose either OpenAI or Gemini (or both):

#### For OpenAI:
```bash
wrangler secret put OPENAI_API_KEY
# Enter your OpenAI API key when prompted
```

#### For Gemini:
```bash
wrangler secret put GEMINI_API_KEY
# Enter your Gemini API key when prompted
```

### 5. Update wrangler.toml
Replace `YOUR_KV_NAMESPACE_ID` with the actual KV namespace ID from step 3.

### 6. Deploy Worker
```bash
wrangler deploy
```

## API Endpoints

### POST /api/generate-plan
Generate nutrition plan from questionnaire data.

**Request:**
```json
{
  "name": "Иван",
  "gender": "Мъж",
  "age": 30,
  "height": 180,
  "weight": 85,
  "email": "ivan@example.com",
  "goal": "Отслабване",
  "sleepHours": "7-8",
  "sportActivity": "Средна"
  // ... other questionnaire fields
}
```

**Response:**
```json
{
  "success": true,
  "plan": { /* structured nutrition plan */ },
  "userId": "unique_user_id",
  "cached": false
}
```

### POST /api/chat
Chat with AI assistant about diet and health.

**Request:**
```json
{
  "userId": "unique_user_id",
  "message": "Може ли да ям банани?",
  "conversationId": "optional_conversation_id"
}
```

**Response:**
```json
{
  "success": true,
  "response": "AI assistant response"
}
```

### GET /api/get-plan?userId=xxx
Retrieve cached nutrition plan.

**Response:**
```json
{
  "success": true,
  "plan": { /* cached nutrition plan */ }
}
```

## KV Storage Structure

The worker uses KV storage with the following keys:

- `plan_{userId}` - Cached nutrition plan (expires after 7 days)
- `user_{userId}` - Cached user questionnaire data (expires after 7 days)
- `chat_{userId}_{conversationId}` - Conversation history (expires after 24 hours)

## Development

To test locally:
```bash
wrangler dev
```

## Notes

- The worker returns mock data when no API keys are configured
- Configure either OPENAI_API_KEY or GEMINI_API_KEY (or both)
- The worker will automatically choose which AI model to use based on available keys
- CORS is enabled for all origins (customize CORS_HEADERS in worker.js if needed)
