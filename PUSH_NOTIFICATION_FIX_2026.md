# Push Notification Fix - February 2026

## Problem Summary

**Issue:** When admin sends a personalized message via `/api/admin/send-message`, users receive push notifications but the message content is not displayed - notifications appear empty.

**Root Cause:** Push notifications were being sent without payload encryption. According to Web Push standards (RFC 8291), push notification payloads MUST be encrypted using the subscriber's public key (p256dh) and auth secret. Without encryption, browsers reject or ignore the payload data.

## Solution

Implemented RFC 8291 Web Push payload encryption in `worker.js`:

### New Functions

1. **`encryptWebPushPayload(payload, subscription)`**
   - Encrypts notification payload using ECDH + HKDF + AES-128-GCM
   - Parameters:
     - `payload`: JSON string to encrypt
     - `subscription`: Push subscription object with keys.p256dh and keys.auth
   - Returns: `{ ciphertext, salt, publicKey }`

2. **`hkdfExpand(prk, info, length)`**
   - HKDF-Expand key derivation per RFC 5869
   - Includes input validation for security
   - Derives encryption keys and nonce

3. **`buildInfo(type, userPublicKey, localPublicKey)`**
   - Constructs info buffer for HKDF per RFC 8291 specification
   - Includes all required parameters: content encoding, P-256 context, public keys

### Modified Functions

**`sendWebPushNotification(subscription, payload, env)`**
- Now encrypts payload before sending
- Adds required encryption headers:
  - `Content-Encoding: aesgcm`
  - `Encryption: salt=<base64url>`
  - `Crypto-Key: dh=<ephemeral-key>; p256ecdsa=<vapid-key>`

## Encryption Flow

```
1. Generate ephemeral ECDH P-256 key pair
   ↓
2. Perform ECDH with user's public key → shared secret
   ↓
3. HKDF-Extract(auth secret, shared secret) → PRK
   ↓
4. HKDF-Expand(PRK, "aesgcm" info) → Content Encryption Key (16 bytes)
   HKDF-Expand(PRK, "nonce" info) → Nonce (12 bytes)
   ↓
5. Add RFC 8188 padding to payload (2-byte length prefix)
   ↓
6. AES-128-GCM encrypt(padded payload, CEK, nonce) → ciphertext
   ↓
7. Send ciphertext with encryption headers via Web Push protocol
```

## Technical Standards

- **RFC 8291**: Message Encryption for Web Push (aesgcm content encoding)
- **RFC 5869**: HMAC-based Key Derivation Function (HKDF)
- **RFC 8188**: Encrypted Content-Encoding for HTTP (padding)
- **Web Crypto API**: All cryptographic operations use browser-native crypto

## Security

✅ **CodeQL Analysis**: 0 alerts found
✅ **Encryption**: AES-128-GCM with ephemeral keys
✅ **Key Derivation**: Proper HKDF with auth secret
✅ **Input Validation**: Length checks on key derivation
✅ **Standards Compliant**: Follows RFC 8291 and RFC 5869

### Future Enhancements

- Consider implementing random padding to prevent traffic analysis
- Evaluate migrating to 'aes128gcm' (RFC 8188) for newer standard
- Add padding randomization for better privacy

## Deployment

### Prerequisites

1. VAPID keys must be configured in Cloudflare Workers:
   - `VAPID_PUBLIC_KEY` - Base64url-encoded public key
   - `VAPID_PRIVATE_KEY` - Base64url-encoded private key

2. Push subscriptions must include encryption keys:
   - `keys.p256dh` - User's public key
   - `keys.auth` - Authentication secret

### Deploy Steps

```bash
# Deploy to Cloudflare Workers
wrangler deploy

# Verify deployment
curl https://aidiet.radilov-k.workers.dev/api/push/vapid-public-key
```

## Testing

### Test Admin Message

1. Open `admin.html` in browser
2. Navigate to "Изпращане на AI Асистент Съобщения" section
3. Enter test user ID (get from browser console when user visits site)
4. Enter a test message
5. Click "Изпрати Съобщение"

### Expected Behavior

**Before Fix:**
- ✗ Notification received but appears empty
- ✗ No message text visible
- ✗ Only opens page on click

**After Fix:**
- ✅ Notification received with message text
- ✅ Title: "AI Асистент - NutriPlan"
- ✅ Body: Your personalized message
- ✅ Opens /plan.html on click

### Debugging

Check browser console and worker logs for:

```javascript
// Service Worker (sw.js)
[SW] Push notification received
[SW] Notification data: { title: "...", bodyLength: 42, type: "chat" }

// Cloudflare Worker (worker.js)
Sending push notification to user user_123: title="AI Асистент - NutriPlan", bodyLength=42, type=chat
Push notification sent successfully to user user_123
```

## Files Modified

- `worker.js` - Added encryption functions and updated sendWebPushNotification
- `sw.js` - Improved logging for debugging

## Rollback Plan

If issues occur after deployment:

1. Revert to previous version:
   ```bash
   git revert <commit-hash>
   wrangler deploy
   ```

2. Check for:
   - VAPID key format issues
   - Subscription key availability
   - Browser compatibility

## Browser Compatibility

✅ Chrome/Edge 50+
✅ Firefox 44+
✅ Opera 37+
⚠️ Safari - Limited support (iOS/macOS Web Push has restrictions)

## Support

For issues:
1. Check Cloudflare Worker logs for encryption errors
2. Verify VAPID keys are properly configured
3. Ensure subscriptions include p256dh and auth keys
4. Test with different browsers

---

**Implementation Date:** February 2026  
**Standards:** RFC 8291, RFC 5869, RFC 8188  
**Security:** CodeQL verified (0 alerts)
