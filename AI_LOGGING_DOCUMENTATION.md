# AI Communication Logging Feature

## Overview

This feature automatically logs all communication between the backend and AI models, providing detailed insights into each step's requirements and performance.

## What Is Logged

Each AI interaction logs:

### Request Information
- **Step Name**: Identifies the step (e.g., `step1_analysis`, `step2_strategy`, `chat_consultation`)
- **Timestamp**: When the request was made (ISO 8601 format)
- **Prompt Length**: Number of characters in the prompt
- **Estimated Input Tokens**: Approximate token count for the input
- **Max Output Tokens**: Maximum tokens allowed for the response
- **Provider**: AI provider used (openai, google, mock)
- **Model Name**: Specific model used (e.g., gpt-4o-mini, gemini-1.5-flash)

### Response Information
- **Response Length**: Number of characters in the response
- **Estimated Output Tokens**: Approximate token count for the output
- **Duration**: Time taken to get the response (milliseconds)
- **Success**: Whether the request was successful
- **Error**: Any error message if the request failed

## Step Names

The following step names are used to identify different types of AI interactions:

### Plan Generation Steps
- `step1_analysis` - Health profile analysis
- `step2_strategy` - Dietary strategy generation
- `step3_meal_plan_full` - Full meal plan generation (non-progressive mode)
- `step3_meal_plan_chunk_1` through `step3_meal_plan_chunk_4` - Progressive meal plan chunks
- `step4_summary` - Summary and recommendations
- `plan_correction` - Plan correction attempts
- `fallback_plan_generation` - Fallback plan generation

### Chat Steps
- `chat_consultation` - User consultation through chat

## API Endpoint

### Get AI Logs

**Endpoint**: `GET /api/admin/get-ai-logs`

**Query Parameters**:
- `limit` (optional, default: 50): Number of logs to return
- `offset` (optional, default: 0): Number of logs to skip (for pagination)

**Example Request**:
```
GET /api/admin/get-ai-logs?limit=10&offset=0
```

**Response Format**:
```json
{
  "success": true,
  "logs": [
    {
      "id": "ai_log_1706923456789_abc123",
      "timestamp": "2026-02-03T01:00:00.000Z",
      "stepName": "step1_analysis",
      "type": "request",
      "promptLength": 3456,
      "estimatedInputTokens": 864,
      "maxOutputTokens": 4000,
      "provider": "openai",
      "modelName": "gpt-4o-mini",
      "response": {
        "id": "ai_log_1706923456789_abc123",
        "timestamp": "2026-02-03T01:00:05.234Z",
        "stepName": "step1_analysis",
        "type": "response",
        "responseLength": 5678,
        "estimatedOutputTokens": 1420,
        "duration": 5234,
        "success": true,
        "error": null
      }
    }
  ],
  "total": 100,
  "limit": 10,
  "offset": 0
}
```

## Storage

Logs are stored in Cloudflare KV with the following structure:

- **Log Entries**: `ai_communication_log:{logId}` (request data)
- **Response Entries**: `ai_communication_log:{logId}_response` (response data)
- **Log Index**: `ai_communication_log_index` (array of log IDs, most recent first, max 1000 entries)

## Use Cases

### 1. Performance Monitoring
Track how long each step takes and identify bottlenecks:
```javascript
// Find slow requests
logs.filter(log => log.response?.duration > 10000)
```

### 2. Token Usage Analysis
Monitor token consumption per step:
```javascript
// Calculate total tokens used
const totalTokens = logs.reduce((sum, log) => 
  sum + log.estimatedInputTokens + (log.response?.estimatedOutputTokens || 0), 
  0
);
```

### 3. Error Analysis
Identify which steps fail most frequently:
```javascript
// Find failed requests
logs.filter(log => !log.response?.success)
```

### 4. Load Distribution
See how the multi-step approach distributes the load:
```javascript
// Group by step
const byStep = logs.reduce((acc, log) => {
  acc[log.stepName] = (acc[log.stepName] || 0) + 1;
  return acc;
}, {});
```

## Token Estimation

Token estimation uses a simplified formula:
- **Cyrillic/Bulgarian text**: ~3.5 characters per token
- **Mixed content**: ~4 characters per token
- **English text**: ~4 characters per token

This provides a reasonable approximation for monitoring purposes. Actual token counts may vary based on the specific tokenizer used by the AI model.

## Limitations

1. **Storage Limit**: Only the most recent 1000 log entries are kept in the index
2. **Approximation**: Token counts are estimates, not exact
3. **KV Dependency**: Requires Cloudflare KV to be configured
4. **No Prompt Content**: Full prompt text is not stored (only length) to save space

## Future Enhancements

Possible improvements:
1. Add filtering by date range
2. Add filtering by step name
3. Store aggregated statistics (daily/hourly summaries)
4. Add cost estimation based on token usage
5. Export logs to external analytics systems
6. Add charts and visualizations in admin panel
