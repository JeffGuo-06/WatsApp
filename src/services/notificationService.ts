import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { SessionManager } from '../utils/SessionManager';

// Configure notification handler for foreground notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface NotificationSettings {
  push_enabled: boolean;
  sound_enabled: boolean;
  vibration_enabled: boolean;
  show_message_preview: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export interface CourseNotificationSettings {
  muted: boolean;
}

export const notificationService = {
  /**
   * Register for push notifications and save token
   */
  async registerForPushNotifications(userId: string): Promise<string | null> {
    if (!Device.isDevice) {
      console.log('Push notifications only work on physical devices');
      return null;
    }

    // Set up Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'WatsApp Messages',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
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
    try {
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;

      if (!projectId) {
        throw new Error('Project ID not found');
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      const token = tokenData.data;

      // Get device ID (links to user_sessions table)
      const deviceId = await SessionManager.getDeviceId();

      // Save token to database
      await this.savePushToken(userId, deviceId, token);

      // Set up push token listener for token refreshes
      this.addPushTokenListener(userId);

      return token;
    } catch (error) {
      console.error('Failed to get push token:', error);
      return null;
    }
  },

  /**
   * Add push token listener to handle token refreshes
   */
  addPushTokenListener(userId: string) {
    return Notifications.addPushTokenListener(async (token) => {
      console.log('Push token updated:', token.data);
      const deviceId = await SessionManager.getDeviceId();
      await this.savePushToken(userId, deviceId, token.data);
    });
  },

  /**
   * Save/update push token in database
   */
  async savePushToken(userId: string, deviceId: string, token: string) {
    const platform = Platform.OS;

    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        {
          user_id: userId,
          device_id: deviceId,
          push_token: token,
          platform: platform,
          is_active: true,
          updated_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,device_id',
        }
      );

    if (error) {
      console.error('Error saving push token:', error);
      throw error;
    }
  },

  /**
   * Deactivate push token (on logout)
   */
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

  /**
   * Get user's notification settings
   */
  async getNotificationSettings(userId: string): Promise<NotificationSettings> {
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // Not found error
      console.error('Error fetching notification settings:', error);
    }

    // Return defaults if no settings exist
    return (
      data || {
        push_enabled: true,
        sound_enabled: true,
        vibration_enabled: true,
        show_message_preview: true,
        quiet_hours_enabled: false,
        quiet_hours_start: null,
        quiet_hours_end: null,
      }
    );
  },

  /**
   * Update global notification settings
   */
  async updateNotificationSettings(
    userId: string,
    settings: Partial<NotificationSettings>
  ) {
    const { error } = await supabase
      .from('user_notification_settings')
      .upsert(
        {
          user_id: userId,
          ...settings,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id',
        }
      );

    if (error) {
      console.error('Error updating notification settings:', error);
      throw error;
    }
  },

  /**
   * Get course-specific mute status
   */
  async getCourseNotificationSettings(
    userId: string,
    courseChatId: string
  ): Promise<CourseNotificationSettings> {
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

  /**
   * Toggle course mute/unmute
   */
  async setCourseMuted(
    userId: string,
    courseChatId: string,
    muted: boolean
  ) {
    const { error } = await supabase
      .from('course_notification_settings')
      .upsert(
        {
          user_id: userId,
          course_chat_id: courseChatId,
          muted: muted,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,course_chat_id',
        }
      );

    if (error) {
      console.error('Error updating course mute settings:', error);
      throw error;
    }
  },

  /**
   * Check if course is currently muted
   */
  async isCourseMuted(userId: string, courseChatId: string): Promise<boolean> {
    const settings = await this.getCourseNotificationSettings(
      userId,
      courseChatId
    );
    return settings.muted;
  },

  /**
   * Add notification listeners (foreground/background/interaction)
   */
  addNotificationListeners(
    onNotificationReceived: (
      notification: Notifications.Notification
    ) => void,
    onNotificationTapped: (
      response: Notifications.NotificationResponse
    ) => void
  ) {
    // Foreground notification listener
    const foregroundSubscription =
      Notifications.addNotificationReceivedListener(onNotificationReceived);

    // Notification tapped/interacted listener
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener(
        onNotificationTapped
      );

    return () => {
      foregroundSubscription.remove();
      responseSubscription.remove();
    };
  },

  /**
   * Update badge count
   */
  async updateBadgeCount(count: number) {
    await Notifications.setBadgeCountAsync(count);
  },

  /**
   * Clear badge count
   */
  async clearBadgeCount() {
    await Notifications.setBadgeCountAsync(0);
  },

  /**
   * Schedule a local notification (for testing)
   */
  async scheduleTestNotification() {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Test Notification 📬',
        body: 'This is a test notification from WatsApp',
        data: { type: 'test' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 2,
      },
    });
  },
};
