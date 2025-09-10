# Session Token Security System

## Overview

The Olexi Extension now uses a **seamless session token system** that provides strong security without requiring any user authentication or signup process.

## How It Works

### 1. **No User Interaction Required**
- Users install the extension and start using it immediately
- No signup forms, no login screens, no email verification
- Completely seamless user experience

### 2. **Automatic Token Generation**
- Extension generates a unique "fingerprint" based on browser characteristics
- On first use, extension automatically requests a session token from the server
- Token is stored locally and reused for subsequent requests
- Tokens expire after 24 hours (configurable) and are automatically renewed

### 3. **Multi-Layer Security**

#### Browser Fingerprinting
```javascript
// Unique fingerprint based on:
- Canvas rendering characteristics
- Screen resolution
- Timezone
- Language settings  
- Platform information
- User agent (truncated)
```

#### Session Token Validation
```python
# Server validates:
- Chrome extension origin
- Valid fingerprint format
- Token belongs to fingerprint
- Token not expired
- Suspicious request detection
```

#### Rate Limiting
```python
# Per fingerprint limits:
- 50 requests per day (configurable)
- 10 requests per hour (configurable)
- Automatic cleanup of old entries
```

## API Endpoints

### Generate Session Token
```
POST /session/token
Body: { "fingerprint": "abc123..." }
Response: { "token": "xyz789...", "expires_in_hours": 24 }
```

### Research Query (Protected)
```
POST /session/research
Headers:
  X-Extension-Fingerprint: abc123...
  X-Session-Token: xyz789...
Body: { "prompt": "Recent HCA cases..." }
```

### Token Information
```
GET /session/token/info
Headers: X-Session-Token: xyz789...
Response: { "created_at": ..., "expires_at": ..., "request_count": 5 }
```

### Revoke Token
```
POST /session/token/revoke
Headers: X-Session-Token: xyz789...
Response: { "message": "Token revoked successfully" }
```

## Configuration

### Environment Variables
```bash
# Token settings
TOKEN_LIFETIME_HOURS=24          # How long tokens last
MAX_TOKENS_PER_FINGERPRINT=3     # Max tokens per installation

# Rate limiting  
DAILY_REQUEST_LIMIT=50           # Requests per day per fingerprint
HOURLY_REQUEST_LIMIT=10          # Requests per hour per fingerprint

# Admin access
ADMIN_KEY=your_admin_key         # For /admin/stats endpoint
```

## Security Benefits

### ✅ **Prevents Casual Abuse**
- No easy way to extract and reuse tokens
- Fingerprint binding makes token sharing ineffective
- Rate limiting prevents excessive usage

### ✅ **Seamless User Experience**  
- Zero user friction - no signup required
- Automatic token management
- Graceful error handling and token renewal

### ✅ **Monitoring & Control**
- Usage statistics and monitoring
- Suspicious request detection
- Admin dashboard for system stats

### ✅ **Scalable Protection**
- Memory-efficient rate limiting
- Automatic cleanup of expired data
- Configurable limits based on usage patterns

## Token Lifecycle

```
1. User opens extension → Generate fingerprint
2. First request → Request session token from server
3. Server validates → Generate & return token
4. Token stored locally → Used for all subsequent requests
5. Token expires → Automatically request new token
6. User closes browser → Token remains valid until expiry
```

## Error Handling

### Token Expired
```
HTTP 401: "Invalid or expired session token"
→ Extension automatically requests new token
→ User retries request seamlessly
```

### Rate Limit Exceeded
```
HTTP 429: "Daily limit exceeded. Max 50 requests per day."
→ Clear error message shown to user
→ Usage statistics available via API
```

### Suspicious Activity
```
HTTP 403: "Request blocked"
→ Logged on server for monitoring
→ User sees generic error message
```

## Migration from CLIENT_TOKEN

The old `CLIENT_TOKEN` system has been replaced with session tokens:

### Before
```javascript
headers: {
  'X-Client-Token': '__CLIENT_TOKEN__'  // Static, extractable
}
```

### After  
```javascript
headers: {
  'X-Extension-Fingerprint': fingerprint,  // Dynamic per installation
  'X-Session-Token': sessionToken          // Temporary, expires
}
```

## Production Deployment

1. **Remove old CLIENT_TOKEN** environment variable
2. **Set new token configuration** (TOKEN_LIFETIME_HOURS, etc.)
3. **Monitor usage patterns** via /admin/stats endpoint
4. **Adjust rate limits** based on real usage data
5. **Set up alerting** for suspicious activity

This system provides robust protection while maintaining the seamless, no-signup user experience that makes the extension accessible to all legal researchers.
