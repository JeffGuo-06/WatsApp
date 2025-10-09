# Authentication Persistence Implementation Guide

## Overview

This implementation adds **session tracking and multi-device management** to WatsApp's existing Supabase authentication system.

**Key Features:**
- ✅ Session persistence already handled by Supabase (365-day refresh tokens)
- ✅ Automatic token refresh (built into Supabase)
- ✅ Secure storage via SecureStore (mobile) and LocalStorage (web)
- ✅ NEW: Device/session tracking and management
- ✅ NEW: View all active devices
- ✅ NEW: Remote session revocation
- ✅ NEW: Sign out from all other devices

## Architecture

### How It Works

1. **Supabase handles auth tokens** (no custom implementation needed)
   - Access tokens: 1 hour lifetime (auto-refreshed)
   - Refresh tokens: 365 days (stored securely)
   - Storage: SecureStore (iOS/Android) or LocalStorage (Web)

2. **Session tracking layer** (newly implemented)
   - Tracks devices in `user_sessions` table
   - Updates `last_active_at` every 10 minutes
   - Enables multi-device management UI

### Files Created/Modified

**New Files:**
- `src/docs/migrations/20250108_auth_session_tracking.sql` - Database migration
- `src/utils/SessionManager.ts` - Device identification utility
- `src/app/sessions.tsx` - Session management screen (example)

**Modified Files:**
- `src/services/authService.ts` - Added session management methods
- `src/context/AuthContext.tsx` - Added automatic session tracking

## Setup Instructions

### 1. Run the Database Migration

Open your Supabase SQL Editor and run the migration:

```bash
# File: src/docs/migrations/20250108_auth_session_tracking.sql
```

This creates:
- `user_sessions` table for tracking devices
- Database functions for session management
- RLS policies for security
- Automatic cleanup on password change

### 2. (Optional) Install expo-device

For better device identification on mobile:

```bash
cd src
npm install expo-device
```

Without this package, device names will default to "iPhone" or "Android Device".

### 3. Test the Implementation

1. **Login on multiple devices/browsers**
   - Mobile app
   - Different web browsers
   - Incognito/private windows

2. **Navigate to the Sessions screen**
   - Add a link in your profile: `router.push("/sessions")`
   - You should see all active sessions

3. **Test session revocation**
   - Revoke a session from another device
   - Verify you're signed out on that device

## Usage Examples

### Accessing the Sessions Screen

Add to your profile screen (`src/app/(tabs)/profile.tsx`):

```tsx
import { router } from "expo-router";
import { TouchableOpacity, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Inside your profile component:
<TouchableOpacity onPress={() => router.push("/sessions")}>
  <View style={{ flexDirection: "row", alignItems: "center", padding: 16 }}>
    <Ionicons name="phone-portrait-outline" size={24} color="#007AFF" />
    <Text style={{ marginLeft: 12, fontSize: 16 }}>Active Sessions</Text>
  </View>
</TouchableOpacity>
```

### Programmatic Session Management

```tsx
import { authService } from "../services/authService";

// Get all active sessions
const sessions = await authService.getActiveSessions();

// Revoke a specific session
await authService.revokeSession(sessionId);

// Sign out from all other devices
const revokedCount = await authService.revokeAllOtherSessions();

// Track current session (already automatic, but can call manually)
await authService.trackSession();
```

### Custom Device Names

Users see device info like:
- "Apple iPhone 15 Pro" (if expo-device installed)
- "Web Browser" (for web)
- "Samsung Galaxy S24" (Android)

### Session Information Display

Each session shows:
- Device name and model
- Platform (iOS/Android/Web)
- Last active timestamp (e.g., "5 minutes ago")
- "Current" badge for active device

## Security Features

### Automatic Session Tracking

Sessions are automatically tracked:
- ✅ On app startup (if authenticated)
- ✅ On login/signup
- ✅ Every 10 minutes (while app is active)

### Password Change Protection

When a user changes their password:
- All sessions are automatically revoked
- User must log in again on all devices
- Implemented via database trigger

### Session Expiration

- Sessions expire after 365 days of inactivity
- Expired sessions are hidden from UI
- Cleanup function available: `cleanup_expired_sessions()`

### Row Level Security (RLS)

All session data is protected:
- Users can only view/manage their own sessions
- Database-level enforcement via RLS policies
- No session data leaks between users

## API Reference

### Database Functions

Available in `src/docs/migrations/20250108_auth_session_tracking.sql`:

```sql
-- Track/update a session
upsert_user_session(
  p_device_id VARCHAR,
  p_device_name VARCHAR DEFAULT NULL,
  p_device_type VARCHAR DEFAULT NULL,
  p_device_info JSONB DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS UUID

-- Get all active sessions for current user
get_active_sessions() RETURNS TABLE (...)

-- Revoke a specific session
revoke_session(p_session_id UUID) RETURNS BOOLEAN

-- Revoke all sessions except one
revoke_all_other_sessions(p_current_device_id VARCHAR) RETURNS INT

-- Cleanup expired/revoked sessions (cron job)
cleanup_expired_sessions() RETURNS INT
```

### TypeScript/React Methods

From `authService.ts`:

```typescript
// Session tracking
await authService.trackSession(): Promise<string>

// Get active sessions
await authService.getActiveSessions(): Promise<UserSession[]>

// Revoke session
await authService.revokeSession(sessionId: string): Promise<boolean>

// Revoke all others
await authService.revokeAllOtherSessions(): Promise<number>

// Sign out and revoke
await authService.signOutAndRevokeSession(): Promise<void>
```

### SessionManager Utility

From `utils/SessionManager.ts`:

```typescript
// Get persistent device ID
await SessionManager.getDeviceId(): Promise<string>

// Get device information
await SessionManager.getDeviceInfo(): Promise<DeviceInfo>

// Get human-readable device name
await SessionManager.getDeviceName(): Promise<string>

// Format session for display
SessionManager.formatSessionInfo(session: UserSession): {
  title: string;
  subtitle: string;
  platform: "web" | "ios" | "android";
}

// Clear device ID (testing/logout)
await SessionManager.clearDeviceId(): Promise<void>
```

## Monitoring and Maintenance

### Database Cleanup

Run periodically (e.g., via Supabase cron or scheduled function):

```sql
SELECT cleanup_expired_sessions();
```

This removes sessions that:
- Expired more than 30 days ago
- Were revoked more than 30 days ago

### Monitoring Metrics

Track these in your analytics:
- Number of active sessions per user
- Session duration distribution
- Failed revocation attempts
- Average sessions per user

### Alerts to Consider

- Spike in active sessions (potential account sharing/compromise)
- High rate of session revocations
- Unusual device patterns for a single user

## Differences from PERSISTENCE_PLAN.md

The original plan was designed for a custom backend with manual JWT handling. Since WatsApp uses **Supabase**, the implementation differs:

**What Supabase Already Handles:**
- ✅ Access token generation (JWT)
- ✅ Refresh token generation and rotation
- ✅ Automatic token refresh
- ✅ Secure storage (SecureStore/LocalStorage)
- ✅ Session persistence across app updates
- ✅ 365-day session lifetime (configurable)

**What We Added:**
- ✅ Session tracking table for multi-device visibility
- ✅ Device identification and metadata
- ✅ Session management UI
- ✅ Remote session revocation
- ✅ Security features (auto-revoke on password change)

**What We Didn't Need:**
- ❌ Custom JWT signing/verification (Supabase handles this)
- ❌ Custom refresh endpoints (Supabase provides `/auth/token`)
- ❌ Token rotation logic (Supabase does this automatically)
- ❌ Custom storage adapters (already configured in `lib/supabase.ts`)

## Troubleshooting

### Sessions Not Appearing

1. **Check migration was run**: Verify `user_sessions` table exists
2. **Check user is authenticated**: Session tracking only works for logged-in users
3. **Check database logs**: Look for errors in Supabase dashboard

### Device Name Shows as "Unknown Device"

1. **Install expo-device**: `npm install expo-device`
2. **Rebuild app**: After installing, restart Metro bundler
3. **Check permissions**: Some device info requires runtime permissions

### Session Not Auto-Revoking on Password Change

1. **Check trigger exists**: Run this in Supabase SQL Editor:
   ```sql
   SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_password_change';
   ```
2. **Verify trigger is on auth.users**: May need service role to create
3. **Manual revocation**: Use `authService.revokeAllOtherSessions()` as fallback

### RLS Policy Errors

If you get "permission denied" errors:

1. **Check RLS is enabled**:
   ```sql
   SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'user_sessions';
   ```
2. **Verify policies exist**:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'user_sessions';
   ```
3. **Re-run migration**: Drop and recreate policies

## Future Enhancements

Consider adding:
- 📱 Push notifications on new device login
- 🔒 Trusted device management (skip MFA)
- 🌍 Geolocation-based security alerts
- 📊 Session analytics dashboard
- 🔐 Biometric authentication for sensitive actions
- ⏰ Configurable session expiration per user

## Support

For issues or questions:
1. Check the Supabase Auth documentation
2. Review the migration file for schema details
3. Check browser/app console for errors
4. Verify RLS policies are correctly applied

---

**Implementation completed**: January 8, 2025

**Compatible with**: Supabase Auth v2+, React Native (Expo), TypeScript
