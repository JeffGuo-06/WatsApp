# Aggressive Authentication Caching Implementation Plan

## Overview

Implement persistent authentication that allows users to log in once per device, with sessions lasting up to 365 days and surviving app updates/redeployments.

## Token Architecture

### Access Token

- **Lifetime**: 30 minutes
- **Storage**: Memory only (JavaScript variable/React state)
- **Purpose**: Short-lived token for API requests
- **Format**: JWT with user claims

### Refresh Token

- **Lifetime**: 365 days
- **Storage**: Platform-specific secure storage
- **Purpose**: Long-lived token to obtain new access tokens
- **Format**: JWT or opaque token (hashed in database)

## Storage Strategy by Platform

| Platform           | Refresh Token Storage                    | Access Token Storage | Survives Updates |
| ------------------ | ---------------------------------------- | -------------------- | ---------------- |
| **Web**            | HttpOnly Cookie                          | Memory (JS variable) | ✅ Yes           |
| **iOS (Expo)**     | SecureStore (Keychain)                   | Memory (React state) | ✅ Yes           |
| **Android (Expo)** | SecureStore (EncryptedSharedPreferences) | Memory (React state) | ✅ Yes           |

## Backend Requirements

### Database Schema

```sql
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  device_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  last_used_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  is_revoked BOOLEAN DEFAULT FALSE,
  INDEX idx_user_device (user_id, device_id),
  INDEX idx_token_hash (token_hash),
  INDEX idx_expires_at (expires_at)
);
```

### Token Generation

- Access tokens: JWT signed with HS256/RS256
- Refresh tokens: Cryptographically secure random string or JWT
- Store only hashed refresh tokens in database
- Include device_id in token metadata

### API Endpoints

#### POST /auth/login

```javascript
{
  email: "user@example.com",
  password: "password123",
  deviceId: "uuid-generated-on-client" // optional
}

Response:
{
  accessToken: "eyJhbG...",
  refreshToken: "abc123..." // mobile only
}
// Web: refresh token set as HttpOnly cookie
```

#### POST /auth/refresh

```javascript
// Mobile: Authorization: Bearer {refreshToken}
// Web: Cookie automatically sent

Response:
{
  accessToken: "eyJhbG...",
  refreshToken: "xyz789..." // mobile only, rotated token
}
// Web: new refresh token set as HttpOnly cookie
```

#### POST /auth/logout

```javascript
// Revokes current refresh token
// Mobile: Authorization: Bearer {refreshToken}
// Web: Cookie automatically sent
```

#### GET /auth/sessions

```javascript
// Returns list of active sessions/devices for user
Response: [
  {
    deviceId: "uuid",
    lastUsed: "2025-10-01T12:00:00Z",
    createdAt: "2025-09-01T12:00:00Z",
    current: true,
  },
];
```

#### DELETE /auth/sessions/:deviceId

```javascript
// Revoke specific device/session
```

## Frontend Implementation

### Shared Auth Storage Module

```javascript
// authStorage.js
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

class AuthStorage {
  static async setRefreshToken(token) {
    if (Platform.OS === "web") {
      // Web: backend handles via HttpOnly cookie
      return;
    }
    await SecureStore.setItemAsync("refresh_token", token);
  }

  static async getRefreshToken() {
    if (Platform.OS === "web") {
      return null; // Cookie sent automatically
    }
    return await SecureStore.getItemAsync("refresh_token");
  }

  static async deleteRefreshToken() {
    if (Platform.OS === "web") {
      return;
    }
    await SecureStore.deleteItemAsync("refresh_token");
  }

  static async getDeviceId() {
    let deviceId = await SecureStore.getItemAsync("device_id");
    if (!deviceId) {
      deviceId = this.generateUUID();
      await SecureStore.setItemAsync("device_id", deviceId);
    }
    return deviceId;
  }

  static generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

export default AuthStorage;
```

### Auth Service

```javascript
// authService.js
import AuthStorage from "./authStorage";
import { Platform } from "react-native";

class AuthService {
  static accessToken = null;
  static refreshPromise = null; // Prevent concurrent refreshes

  static async login(email, password) {
    const deviceId = await AuthStorage.getDeviceId();

    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      credentials: "include", // Important for cookies
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, deviceId }),
    });

    if (!response.ok) {
      throw new Error("Login failed");
    }

    const data = await response.json();
    this.accessToken = data.accessToken;

    // Mobile: store refresh token
    if (Platform.OS !== "web" && data.refreshToken) {
      await AuthStorage.setRefreshToken(data.refreshToken);
    }

    return true;
  }

  static async refreshAccessToken() {
    // Prevent concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const refreshToken = await AuthStorage.getRefreshToken();

        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(Platform.OS !== "web" && refreshToken
              ? { Authorization: `Bearer ${refreshToken}` }
              : {}),
          },
        });

        if (!response.ok) {
          throw new Error("Refresh failed");
        }

        const data = await response.json();
        this.accessToken = data.accessToken;

        // Mobile: update refresh token
        if (Platform.OS !== "web" && data.refreshToken) {
          await AuthStorage.setRefreshToken(data.refreshToken);
        }

        return this.accessToken;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  static async getAccessToken() {
    // If we have a valid token, return it
    if (this.accessToken && !this.isTokenExpired(this.accessToken)) {
      return this.accessToken;
    }

    // Otherwise, refresh
    try {
      return await this.refreshAccessToken();
    } catch (error) {
      // Refresh failed, user needs to login
      throw new Error("Not authenticated");
    }
  }

  static async authenticatedFetch(url, options = {}) {
    const token = await this.getAccessToken();

    const response = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    // If 401, try to refresh once
    if (response.status === 401) {
      this.accessToken = null; // Invalidate current token
      const newToken = await this.getAccessToken();

      return fetch(url, {
        ...options,
        credentials: "include",
        headers: {
          ...options.headers,
          Authorization: `Bearer ${newToken}`,
        },
      });
    }

    return response;
  }

  static async logout() {
    try {
      await this.authenticatedFetch(`${API_URL}/auth/logout`, {
        method: "POST",
      });
    } catch (error) {
      // Ignore errors on logout
    }

    await AuthStorage.deleteRefreshToken();
    this.accessToken = null;
  }

  static isTokenExpired(token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      // Add 30 second buffer
      return payload.exp * 1000 < Date.now() + 30000;
    } catch {
      return true;
    }
  }
}

export default AuthService;
```

### App Initialization

```javascript
// App.js
import { useEffect, useState } from "react";
import AuthService from "./authService";

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function initAuth() {
      try {
        // Try to get access token (will auto-refresh if needed)
        await AuthService.getAccessToken();
        setIsAuthenticated(true);
      } catch (error) {
        // No valid session
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    }

    initAuth();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Proactive token refresh every 20 minutes
    const interval = setInterval(async () => {
      try {
        await AuthService.getAccessToken();
      } catch (error) {
        setIsAuthenticated(false);
      }
    }, 20 * 60 * 1000);

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return isAuthenticated ? <MainApp /> : <LoginScreen />;
}
```

### Example API Usage

```javascript
// In any component
async function fetchUserData() {
  const response = await AuthService.authenticatedFetch("/api/user/profile");
  const data = await response.json();
  return data;
}
```

## Backend Implementation Details

### Token Rotation Strategy

- On each refresh, issue a new refresh token
- Invalidate the old refresh token immediately
- Store both tokens briefly during rotation window (5 seconds) to handle race conditions

### Security Measures

1. **Rate Limiting**: Max 10 refresh attempts per hour per IP
2. **Suspicious Activity Detection**:
   - Multiple failed refresh attempts
   - Token reuse after rotation
   - Geolocation changes (optional)
3. **Session Management**:
   - Allow users to view active sessions
   - One-click revoke all sessions
   - Auto-revoke on password change
4. **Token Validation**:
   - Check expiration
   - Check revocation status
   - Validate device_id matches

### Cleanup Jobs

```javascript
// Run daily
async function cleanupExpiredTokens() {
  await db.query(`
    DELETE FROM refresh_tokens 
    WHERE expires_at < NOW() 
    OR is_revoked = TRUE
  `);
}
```

## Testing Checklist

### Functionality

- [ ] User can login and receive tokens
- [ ] Access token works for authenticated requests
- [ ] Access token auto-refreshes when expired
- [ ] Refresh token persists across app restarts
- [ ] Refresh token persists across app updates
- [ ] User stays logged in for 365 days
- [ ] Logout properly clears all tokens
- [ ] Multiple devices can be logged in simultaneously

### Security

- [ ] Refresh tokens are hashed in database
- [ ] Web refresh tokens are HttpOnly
- [ ] Mobile refresh tokens are in SecureStore
- [ ] Access tokens are never stored persistently
- [ ] Token rotation works correctly
- [ ] Old tokens are invalidated after rotation
- [ ] Rate limiting prevents brute force
- [ ] Revoked tokens cannot be used

### Edge Cases

- [ ] Handle network failures gracefully
- [ ] Handle concurrent refresh requests
- [ ] Handle expired refresh tokens (redirect to login)
- [ ] Handle revoked tokens (redirect to login)
- [ ] Handle app kill during token refresh
- [ ] Handle 401 responses with retry logic

## Deployment Considerations

### Environment Variables

```bash
JWT_ACCESS_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret-key
ACCESS_TOKEN_EXPIRY=30m
REFRESH_TOKEN_EXPIRY=365d
COOKIE_DOMAIN=yourdomain.com
```

### CORS Configuration

```javascript
app.use(
  cors({
    origin: ["https://yourdomain.com", "http://localhost:3000"],
    credentials: true, // Important for cookies
  })
);
```

### Cookie Configuration for Production

```javascript
res.cookie("refresh_token", token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  domain: process.env.COOKIE_DOMAIN,
  maxAge: 365 * 24 * 60 * 60 * 1000,
});
```

## Migration Strategy

### From Existing Auth System

1. Keep old auth system running
2. Add new refresh token endpoints
3. On next login, issue refresh tokens
4. Gradually migrate users as they login
5. After 90 days, deprecate old system

### Database Migration

```sql
-- Add refresh_tokens table
-- Add device_id to existing sessions
-- Migrate active sessions to new format
```

## Monitoring and Alerts

### Metrics to Track

- Active refresh tokens per user
- Refresh token lifetime distribution
- Failed refresh attempts
- Token rotation success rate
- Average session duration

### Alerts

- Spike in failed refresh attempts (potential attack)
- High rate of token revocations
- Unusual device patterns per user

## User-Facing Features

### Account Security Page

- View all active sessions/devices
- See last used timestamp for each device
- Revoke individual sessions
- "Sign out all devices" button
- Notification on new device login (optional)

## Future Enhancements

- Biometric authentication for sensitive operations
- Trusted device management
- Geographic-based security policies
- Automatic logout on password change
- Remember device for reduced friction
