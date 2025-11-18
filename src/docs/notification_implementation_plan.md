# Push Notifications Implementation Plan

## Overview

**Goal**: Implement push notifications for course messages with per-course muting capabilities using Expo Notifications.

**Key Requirements**:
- Notify users when messages are received in their enrolled courses
- Allow users to mute/unmute notifications for specific courses (simple toggle)
- Support iOS and Android push notifications
- Handle notification permissions and token management
- Don't notify users about their own messages
- Respect app foreground/background state
- Muted courses show bell-with-cross icon instead of unread badge
- All courses are unmuted by default

---

## Phase 1: Database Schema Changes

**Create notification preferences table** (migration file):

```sql
-- Migration: notification_preferences.sql

-- Table: user_notification_settings (global notification preferences)
CREATE TABLE IF NOT EXISTS public.user_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  push_enabled BOOLEAN DEFAULT true,
  sound_enabled BOOLEAN DEFAULT true,
  vibration_enabled BOOLEAN DEFAULT true,
  show_message_preview BOOLEAN DEFAULT true,
  quiet_hours_enabled BOOLEAN DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: course_notification_settings (per-course muting)
CREATE TABLE IF NOT EXISTS public.course_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  course_chat_id UUID REFERENCES public.course_chats(id) ON DELETE CASCADE NOT NULL,
  muted BOOLEAN DEFAULT false, -- Simple toggle: muted or unmuted
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, course_chat_id)
);

-- Table: push_tokens (multi-device support)
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  device_id TEXT NOT NULL, -- Links to user_sessions.device_id
  push_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);

-- Enable RLS
ALTER TABLE public.user_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own notification settings"
  ON public.user_notification_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification settings"
  ON public.user_notification_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification settings"
  ON public.user_notification_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their course notification settings"
  ON public.course_notification_settings FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their push tokens"
  ON public.push_tokens FOR ALL
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_course_notification_settings_user ON course_notification_settings(user_id);
CREATE INDEX idx_course_notification_settings_chat ON course_notification_settings(course_chat_id);
CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX idx_push_tokens_active ON push_tokens(is_active) WHERE is_active = true;

-- Function: Get notification settings with defaults
CREATE OR REPLACE FUNCTION get_user_notification_settings(p_user_id UUID)
RETURNS TABLE (
  push_enabled BOOLEAN,
  sound_enabled BOOLEAN,
  vibration_enabled BOOLEAN,
  show_message_preview BOOLEAN,
  quiet_hours_enabled BOOLEAN,
  quiet_hours_start TIME,
  quiet_hours_end TIME
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(uns.push_enabled, true),
    COALESCE(uns.sound_enabled, true),
    COALESCE(uns.vibration_enabled, true),
    COALESCE(uns.show_message_preview, true),
    COALESCE(uns.quiet_hours_enabled, false),
    uns.quiet_hours_start,
    uns.quiet_hours_end
  FROM public.user_notification_settings uns
  WHERE uns.user_id = p_user_id;

  -- If no settings exist, return defaults
  IF NOT FOUND THEN
    RETURN QUERY SELECT true, true, true, true, false, NULL::TIME, NULL::TIME;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Phase 2: Install Dependencies

**Install Expo Notifications package**:

```bash
npx expo install expo-notifications expo-device expo-constants
```

**Update app.json/app.config.js** to configure notification settings:

```json
{
  "expo": {
    "slug": "WatsApp",
    "plugins": [
      "expo-notifications"
    ],
    "notification": {
      "iosDisplayInForeground": true,
      "androidMode": "default",
      "androidCollapsedTitle": "WatsApp"
    }
  }
}
```

Note: Using default notification icons and sounds. The Expo project slug is "WatsApp".

**Configuration**:
- Expo project slug: `WatsApp`
- Expo Project ID: `831770f5-dede-405c-b8b6-a2b94be2c0f0` (already configured in Phase 3)

---

## Phase 3: Push Token Management Service

**Create `/src/services/notificationService.ts`**:

```typescript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { SessionManager } from '../utils/SessionManager';

// Configure notification handler for foreground notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const notificationService = {
  // Register for push notifications and save token
  async registerForPushNotifications(userId: string): Promise<string | null> {
    if (!Device.isDevice) {
      console.log('Push notifications only work on physical devices');
      return null;
    }

    // Check existing permission
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permission if not granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission denied');
      return null;
    }

    // Get push token
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: '831770f5-dede-405c-b8b6-a2b94be2c0f0',
    });
    const token = tokenData.data;

    // Get device ID (links to user_sessions table)
    const deviceId = await SessionManager.getDeviceId();

    // Save token to database
    await this.savePushToken(userId, deviceId, token);

    return token;
  },

  // Save/update push token in database
  async savePushToken(userId: string, deviceId: string, token: string) {
    const platform = Platform.OS;

    const { error } = await supabase
      .from('push_tokens')
      .upsert({
        user_id: userId,
        device_id: deviceId,
        push_token: token,
        platform: platform,
        is_active: true,
        updated_at: new Date().toISOString(),
        last_used_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,device_id'
      });

    if (error) {
      console.error('Error saving push token:', error);
      throw error;
    }
  },

  // Deactivate push token (on logout)
  async deactivatePushToken(userId: string, deviceId: string) {
    const { error } = await supabase
      .from('push_tokens')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('device_id', deviceId);

    if (error) {
      console.error('Error deactivating push token:', error);
    }
  },

  // Get user's notification settings
  async getNotificationSettings(userId: string) {
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // Not found error
      console.error('Error fetching notification settings:', error);
      return null;
    }

    // Return defaults if no settings exist
    return data || {
      push_enabled: true,
      sound_enabled: true,
      vibration_enabled: true,
      show_message_preview: true,
      quiet_hours_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
    };
  },

  // Update global notification settings
  async updateNotificationSettings(userId: string, settings: Partial<NotificationSettings>) {
    const { error } = await supabase
      .from('user_notification_settings')
      .upsert({
        user_id: userId,
        ...settings,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      });

    if (error) {
      console.error('Error updating notification settings:', error);
      throw error;
    }
  },

  // Get course-specific mute status
  async getCourseNotificationSettings(userId: string, courseChatId: string) {
    const { data, error } = await supabase
      .from('course_notification_settings')
      .select('*')
      .eq('user_id', userId)
      .eq('course_chat_id', courseChatId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching course notification settings:', error);
      return { muted: false };
    }

    return data || { muted: false };
  },

  // Toggle course mute/unmute
  async setCourseMuted(userId: string, courseChatId: string, muted: boolean) {
    const { error } = await supabase
      .from('course_notification_settings')
      .upsert({
        user_id: userId,
        course_chat_id: courseChatId,
        muted: muted,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,course_chat_id'
      });

    if (error) {
      console.error('Error updating course mute settings:', error);
      throw error;
    }
  },

  // Check if course is currently muted
  async isCourseMuted(userId: string, courseChatId: string): Promise<boolean> {
    const settings = await this.getCourseNotificationSettings(userId, courseChatId);
    return settings.muted;
  },

  // Add notification listeners (foreground/background/interaction)
  addNotificationListeners(
    onNotificationReceived: (notification: Notifications.Notification) => void,
    onNotificationTapped: (response: Notifications.NotificationResponse) => void
  ) {
    // Foreground notification listener
    const foregroundSubscription = Notifications.addNotificationReceivedListener(onNotificationReceived);

    // Notification tapped/interacted listener
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(onNotificationTapped);

    return () => {
      foregroundSubscription.remove();
      responseSubscription.remove();
    };
  },

  // Update badge count
  async updateBadgeCount(count: number) {
    await Notifications.setBadgeCountAsync(count);
  },

  // Clear badge count
  async clearBadgeCount() {
    await Notifications.setBadgeCountAsync(0);
  },
};

interface NotificationSettings {
  push_enabled: boolean;
  sound_enabled: boolean;
  vibration_enabled: boolean;
  show_message_preview: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}
```

---

## Phase 4: Backend Notification Trigger (Supabase Edge Function)

**Create Supabase Edge Function** at `/supabase/functions/send-push-notification/index.ts`:

This function will be triggered by a database webhook when a new message is inserted.

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

serve(async (req) => {
  try {
    const { record } = await req.json(); // Webhook payload from messages table INSERT

    // Extract message details
    const { course_chat_id, user_id: sender_id, content, id: message_id } = record;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all enrolled users for this course (except the sender)
    const { data: enrolledUsers, error: usersError } = await supabase
      .from('user_courses')
      .select(`
        user_id,
        courses!inner(
          course_name,
          course_code,
          course_chats!inner(id)
        )
      `)
      .eq('courses.course_chats.id', course_chat_id)
      .neq('user_id', sender_id);

    if (usersError) throw usersError;

    // Get sender's profile for notification
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', sender_id)
      .single();

    const senderName = senderProfile?.name || 'Someone';
    const courseName = enrolledUsers[0]?.courses?.course_code || 'Course';

    // Prepare push notifications
    const pushMessages = [];

    for (const user of enrolledUsers) {
      const userId = user.user_id;

      // Check if user has push enabled
      const { data: settings } = await supabase
        .from('user_notification_settings')
        .select('push_enabled, show_message_preview, quiet_hours_enabled, quiet_hours_start, quiet_hours_end')
        .eq('user_id', userId)
        .single();

      if (settings && !settings.push_enabled) continue;

      // Check if course is muted
      const { data: courseMute } = await supabase
        .from('course_notification_settings')
        .select('muted')
        .eq('user_id', userId)
        .eq('course_chat_id', course_chat_id)
        .single();

      // Skip if muted
      if (courseMute?.muted) continue;

      // Check quiet hours
      if (settings?.quiet_hours_enabled && settings.quiet_hours_start && settings.quiet_hours_end) {
        const now = new Date();
        const currentTime = `${now.getHours()}:${now.getMinutes()}`;
        if (currentTime >= settings.quiet_hours_start && currentTime <= settings.quiet_hours_end) {
          continue; // Skip notification during quiet hours
        }
      }

      // Get user's active push tokens
      const { data: tokens } = await supabase
        .from('push_tokens')
        .select('push_token, platform')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (!tokens || tokens.length === 0) continue;

      // Create push notification for each device
      for (const tokenData of tokens) {
        const messageBody = settings?.show_message_preview ? content : 'New message';

        pushMessages.push({
          to: tokenData.push_token,
          sound: 'default',
          title: `${senderName} in ${courseName}`,
          body: messageBody.substring(0, 100), // Limit message preview
          data: {
            type: 'course_message',
            course_chat_id: course_chat_id,
            message_id: message_id,
            sender_id: sender_id,
          },
          badge: 1, // Increment badge count
          priority: 'high',
        });
      }
    }

    // Send push notifications via Expo Push API
    if (pushMessages.length > 0) {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pushMessages),
      });

      const result = await response.json();
      console.log('Push notifications sent:', result);
    }

    return new Response(JSON.stringify({ success: true, sent: pushMessages.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error sending push notifications:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
```

**Create Database Webhook**:
1. In Supabase Dashboard → Database → Webhooks
2. Create webhook for `messages` table on INSERT
3. Point to Edge Function URL: `https://<project-ref>.supabase.co/functions/v1/send-push-notification`

---

## Phase 5: Frontend Integration

**Update `/src/context/AuthContext.tsx`** to register push notifications on login:

```typescript
// Add to AuthContext after successful login
useEffect(() => {
  if (user) {
    // Register for push notifications
    notificationService.registerForPushNotifications(user.id).catch(console.error);
  }
}, [user]);
```

**Create notification listener in app root** (`/src/app/_layout.tsx`):

```typescript
import { notificationService } from '../services/notificationService';
import { router } from 'expo-router';

useEffect(() => {
  // Set up notification listeners
  const removeListeners = notificationService.addNotificationListeners(
    // Foreground notification handler
    (notification) => {
      console.log('Notification received in foreground:', notification);
      // Optionally show in-app banner
    },
    // Notification tapped handler
    (response) => {
      const data = response.notification.request.content.data;

      if (data.type === 'course_message' && data.course_chat_id) {
        // Navigate to course chat
        router.push(`/course-chat?chatId=${data.course_chat_id}`);
      }
    }
  );

  return removeListeners;
}, []);
```

---

## Phase 6: Notification Settings UI

**Create `/src/app/notification-settings.tsx`** screen:

Features:
- Toggle push notifications on/off
- Toggle sound/vibration
- Toggle message preview
- Set quiet hours (start/end time pickers)
- Test notification button

**Add mute toggle to course chat screen** (`/src/app/course-chat.tsx`):

```typescript
// In course chat header - simple toggle button
<TouchableOpacity onPress={() => toggleMute()}>
  <Ionicons
    name={isMuted ? 'notifications-off' : 'notifications'}
    size={24}
  />
</TouchableOpacity>

// Toggle mute function
const toggleMute = async () => {
  const newMutedState = !isMuted;
  await notificationService.setCourseMuted(userId, courseChatId, newMutedState);
  setIsMuted(newMutedState);
};
```

**Update home screen** course cards (`/src/app/(tabs)/index.tsx`):

When a course is muted:
- **Hide the unread count badge** completely
- **Show a bell-with-cross icon** (🔕 or `notifications-off` icon) to indicate notifications are muted
- This provides clear visual feedback that the course is muted

---

## Phase 7: Badge Count Management

**Update badge count** when receiving notifications:

```typescript
// In notificationService.ts
async updateBadgeCount(count: number) {
  await Notifications.setBadgeCountAsync(count);
},

async clearBadgeCount() {
  await Notifications.setBadgeCountAsync(0);
},
```

**Calculate total unread count** across all courses and update badge:

```typescript
// In home screen or app root
const totalUnread = courses.reduce((sum, course) => sum + course.unreadCount, 0);
await notificationService.updateBadgeCount(totalUnread);
```

---

## Phase 8: Testing Strategy

**Test Cases**:

1. **Permission Flow**
   - Deny permission → should gracefully handle
   - Grant permission → token saved to database
   - Revoke permission → notifications stop

2. **Message Notifications**
   - Send message from User A → User B receives push
   - User sends message → does NOT receive own notification
   - Message sent while app in foreground → shows in-app
   - Message sent while app in background → shows system notification
   - Tap notification → navigates to correct course chat

3. **Muting**
   - Mute course → no notifications sent
   - Unmute course → notifications resume immediately
   - Muted course shows bell-with-cross icon instead of unread badge on home screen
   - Mute toggle button in course chat header updates correctly

4. **Settings**
   - Disable push globally → no notifications for any course
   - Disable message preview → notifications show generic text
   - Quiet hours → no notifications during specified time
   - Sound/vibration toggles work correctly

5. **Multi-Device**
   - Login on Device A → receives notifications
   - Login on Device B → receives notifications
   - Logout from Device A → Device A stops receiving, Device B continues

6. **Edge Cases**
   - User not enrolled in course → no notification
   - User leaves course → notifications stop
   - Token expires → refreshes automatically
   - Network offline → queues notifications

---

## Implementation Timeline

**Phase 1** (2-3 hours): Database schema + migration
**Phase 2** (1 hour): Install dependencies + configuration
**Phase 3** (3-4 hours): Notification service implementation
**Phase 4** (4-5 hours): Backend Edge Function + webhook setup
**Phase 5** (2 hours): Frontend integration (AuthContext + listeners)
**Phase 6** (4-5 hours): Settings UI + mute functionality
**Phase 7** (1-2 hours): Badge count management
**Phase 8** (3-4 hours): Testing and refinement

**Total Estimated Time**: 20-26 hours

---

## Dependencies Summary

```json
{
  "expo-notifications": "~0.27.0",
  "expo-device": "~6.0.0",
  "expo-constants": "~16.0.0"
}
```

---

## Security Considerations

1. **RLS Policies**: All notification tables have RLS enabled - users can only access their own settings
2. **Service Role Key**: Edge Function uses service role key (never exposed to client)
3. **Token Validation**: Push tokens validated before sending
4. **Rate Limiting**: Implement rate limiting on Edge Function to prevent spam
5. **Content Filtering**: Message previews limited to 100 characters
6. **Permission Checks**: Always check notification permissions before sending

---

## Future Enhancements

- **Notification Grouping**: Group messages by course
- **Rich Notifications**: Show sender avatar, course icon
- **Action Buttons**: Quick reply, mark as read
- **Direct Message Notifications**: Extend to DMs
- **Mention Notifications**: Special priority for @mentions
- **Email Notifications**: Fallback for users without push
- **Notification History**: In-app notification center
- **Smart Bundling**: Bundle multiple messages from same course

---

## Integration with Existing Architecture

This notification system integrates seamlessly with your current WatsApp architecture:

- **Database**: Extends existing schema with notification tables (follows same RLS patterns)
- **Services**: New `notificationService.ts` follows same patterns as `chatService.ts` and `authService.ts`
- **Session Tracking**: Leverages existing `user_sessions` table for multi-device support
- **Realtime**: Complements existing Supabase Realtime subscriptions
- **Storage**: Uses AsyncStorage pattern similar to `chatReadStorage.ts`
- **Auth Flow**: Integrates with existing `AuthContext.tsx` session management

The implementation respects your existing code organization and architectural decisions.
