import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { notificationService, NotificationSettings } from '@/services/notificationService';

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<NotificationSettings>({
    push_enabled: true,
    sound_enabled: true,
    vibration_enabled: true,
    show_message_preview: true,
    quiet_hours_enabled: false,
    quiet_hours_start: null,
    quiet_hours_end: null,
  });

  useEffect(() => {
    loadSettings();
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;

    try {
      const userSettings = await notificationService.getNotificationSettings(user.id);
      setSettings(userSettings);
    } catch (error) {
      console.error('Error loading notification settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (key: keyof NotificationSettings, value: any) => {
    if (!user) return;

    try {
      const newSettings = { ...settings, [key]: value };
      setSettings(newSettings);

      await notificationService.updateNotificationSettings(user.id, {
        [key]: value,
      });
    } catch (error) {
      console.error('Error updating notification settings:', error);
      Alert.alert('Error', 'Failed to update notification settings');
      // Revert on error
      loadSettings();
    }
  };

  const handleTestNotification = async () => {
    try {
      await notificationService.scheduleTestNotification();
      Alert.alert('Success', 'Test notification scheduled!');
    } catch (error) {
      console.error('Error scheduling test notification:', error);
      Alert.alert('Error', 'Failed to schedule test notification');
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        {/* General Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>General</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Push Notifications</Text>
              <Text style={styles.settingDescription}>
                Enable push notifications for course messages
              </Text>
            </View>
            <Switch
              value={settings.push_enabled}
              onValueChange={(value) => updateSetting('push_enabled', value)}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Sound</Text>
              <Text style={styles.settingDescription}>
                Play sound when notifications arrive
              </Text>
            </View>
            <Switch
              value={settings.sound_enabled}
              onValueChange={(value) => updateSetting('sound_enabled', value)}
              disabled={!settings.push_enabled}
            />
          </View>

          {Platform.OS !== 'web' && (
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Vibration</Text>
                <Text style={styles.settingDescription}>
                  Vibrate when notifications arrive
                </Text>
              </View>
              <Switch
                value={settings.vibration_enabled}
                onValueChange={(value) => updateSetting('vibration_enabled', value)}
                disabled={!settings.push_enabled}
              />
            </View>
          )}

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Message Preview</Text>
              <Text style={styles.settingDescription}>
                Show message content in notifications
              </Text>
            </View>
            <Switch
              value={settings.show_message_preview}
              onValueChange={(value) => updateSetting('show_message_preview', value)}
              disabled={!settings.push_enabled}
            />
          </View>
        </View>

        {/* Quiet Hours */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quiet Hours</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Enable Quiet Hours</Text>
              <Text style={styles.settingDescription}>
                Mute notifications during specified hours
              </Text>
            </View>
            <Switch
              value={settings.quiet_hours_enabled}
              onValueChange={(value) => updateSetting('quiet_hours_enabled', value)}
              disabled={!settings.push_enabled}
            />
          </View>

          {settings.quiet_hours_enabled && (
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Time Range</Text>
                <Text style={styles.settingDescription}>
                  {settings.quiet_hours_start && settings.quiet_hours_end
                    ? `${settings.quiet_hours_start} - ${settings.quiet_hours_end}`
                    : 'Not set'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  Alert.alert(
                    'Coming Soon',
                    'Time picker will be implemented in the next update'
                  );
                }}
              >
                <Ionicons name="time-outline" size={24} color="#007AFF" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Course-Specific Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Course Notifications</Text>
          <Text style={styles.settingDescription}>
            You can mute notifications for specific courses from the course chat screen
            using the notification toggle in the header.
          </Text>
        </View>

        {/* Test Button */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.testButton}
            onPress={handleTestNotification}
            disabled={!settings.push_enabled}
          >
            <Ionicons name="notifications-outline" size={20} color="#fff" />
            <Text style={styles.testButtonText}>Send Test Notification</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    color: '#000',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginTop: 8,
  },
  testButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
