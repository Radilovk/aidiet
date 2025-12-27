# Migration to Local Storage Architecture

## Overview

This document explains the migration from server-side KV storage to client-side localStorage for all user data.

## Why This Change?

**Privacy First**: The previous architecture stored user data (plans, profiles, chat history) on the server in Cloudflare KV. While this data had TTL expiration, it still meant user data was temporarily stored on a server.

The new architecture follows a **privacy-first, client-side storage model** where:
- ✅ **NO user data is stored on the server**
- ✅ **All data remains in the user's browser/phone**
- ✅ **GDPR compliant by design**
- ✅ **User has full control over their data**
- ✅ **No risk of server data breaches**

## What Changed?

### Backend (worker.js)

#### Removed Functions
- `getCachedPlan()` - No longer fetches plans from KV
- `cachePlan()` - No longer stores plans in KV
- `getCachedUserData()` - No longer fetches user data from KV
- `cacheUserData()` - No longer stores user data in KV
- `getConversationHistory()` - No longer fetches chat history from KV
- `updateConversationHistory()` - No longer stores chat history in KV
- `clearUserCache()` - No longer clears KV cache

#### Modified Endpoints

**POST /api/generate-plan**
- Before: Checked KV cache, cached results
- After: Stateless - generates plan and returns it immediately
- No caching on server

**POST /api/chat**
- Before: Fetched user data and plan from KV
- After: Receives full context from client in request body
- Request now includes: `userData`, `userPlan`, `conversationHistory`
- Returns: AI response + updated plan/userData (if regenerated)

#### Removed Endpoints
- `GET /api/get-plan` - No longer needed (data is in localStorage)
- `POST /api/update-plan` - No longer needed (updates happen client-side)

### Frontend (plan.html)

#### Modified Chat Request
- Now sends full context with every chat message:
  ```javascript
  {
    message: "user message",
    userData: {...},  // Full questionnaire data
    userPlan: {...},  // Complete 7-day plan
    conversationHistory: [...],  // Chat history
    mode: "consultation"
  }
  ```

#### Updated Response Handling
- Saves updated plan/userData to localStorage when plan is regenerated
- No longer fetches plan from server
- All data management is local

### Documentation

Updated files:
- `README.md` - New storage structure, updated API docs
- `ARCHITECTURE.md` - New architecture diagrams, data flows

## What Stays the Same?

### KV Storage for Admin Config
The server still uses KV storage for **administrative configuration only**:
- AI prompts (plan, consultation, modification)
- AI provider settings (OpenAI/Gemini)
- Model selection

This is configuration data, not user data.

### User Experience
From the user's perspective:
- ✅ Same functionality
- ✅ Same features (plan generation, chat, modifications)
- ✅ Same or better performance (localStorage is instant)

## Benefits

### 1. Privacy
- **Zero server-side user data storage**
- User data never leaves their device except when making API calls
- No tracking, no analytics, no data retention

### 2. GDPR Compliance
- No personal data stored on servers
- No need for data deletion requests
- Users can clear their data anytime via browser

### 3. Simplicity
- No database management
- No data retention policies needed
- Simpler architecture

### 4. Cost
- Lower server costs (no storage fees for user data)
- Only AI API calls and admin config storage

### 5. User Control
- Users own their data
- Can export/backup via browser dev tools
- Can clear anytime

## Potential Considerations

### Multi-Device Sync
- Data is per-device (no automatic sync between devices)
- Users need to regenerate plans on each device
- This is a trade-off for maximum privacy

### Data Loss
- If user clears browser data, plan is lost
- Recommendation: Add export/download feature in future

### Browser Storage Limits
- localStorage typically has 5-10MB limit
- Current data (plan + profile + chat) is well within limits
- Estimated usage: ~100-500KB per user

## Testing Checklist

- [ ] Generate new plan → verify it saves to localStorage
- [ ] Refresh page → verify plan loads from localStorage
- [ ] Use chat in consultation mode → verify responses work
- [ ] Use chat in modification mode → verify plan updates
- [ ] Check browser dev tools → verify no server calls to get-plan
- [ ] Check Network tab → verify full context sent with chat
- [ ] Clear localStorage → verify app asks to regenerate plan

## Migration Notes

### For Existing Users
**No migration needed!** The frontend already stores data in localStorage. The only difference is:
- Server no longer caches a copy
- Chat requests now send full context

### For Developers
If you're running the worker locally:
1. Deploy updated `worker.js`
2. No database changes needed
3. Existing KV data will expire naturally (7 days for plans, 24h for chat)

## Security Considerations

### Advantages
- ✅ No server data breaches possible (no data on server)
- ✅ HTTPS still encrypts data in transit
- ✅ Users can clear sensitive data easily

### Unchanged
- ✅ API keys still secured via environment variables
- ✅ Input validation still in place
- ✅ XSS prevention via HTML escaping
- ✅ CORS headers properly configured

## Future Enhancements

Possible additions to improve the local storage model:
1. **Export/Import** - Let users backup their plans as JSON files
2. **Encrypted Storage** - Encrypt localStorage data with user password
3. **Cloud Sync (Optional)** - Allow users to opt-in to cloud sync
4. **IndexedDB** - Move to IndexedDB for larger storage capacity

## Summary

This migration transforms the application from a **server-cached** model to a **privacy-first, local-only** storage model. All user data now resides exclusively on the user's device, giving them full control while maintaining all functionality.

**Key Principle**: "Your data, your device, your control."
