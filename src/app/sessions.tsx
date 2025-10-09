import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { authService } from "../services/authService";
import SessionManager, { UserSession } from "../utils/SessionManager";

/**
 * Sessions Management Screen
 *
 * Displays all active sessions/devices for the current user
 * Allows revoking individual sessions or all other sessions
 *
 * Usage: Add a navigation link to this screen from your profile/settings
 * Example: router.push("/sessions")
 */
export default function SessionsScreen() {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  const loadSessions = async () => {
    try {
      const activeSessions = await authService.getActiveSessions();
      setSessions(activeSessions);
    } catch (error) {
      console.error("Error loading sessions:", error);
      Alert.alert("Error", "Failed to load active sessions");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadSessions();
  };

  const handleRevokeSession = async (session: UserSession) => {
    if (session.is_current) {
      Alert.alert(
        "Cannot Revoke",
        "You cannot revoke your current session. Use 'Sign Out' instead."
      );
      return;
    }

    Alert.alert(
      "Revoke Session",
      `Are you sure you want to sign out this device?\n\n${SessionManager.formatSessionInfo(session).title}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            setRevokingSessionId(session.session_id);
            try {
              const success = await authService.revokeSession(session.session_id);
              if (success) {
                setSessions((prev) =>
                  prev.filter((s) => s.session_id !== session.session_id)
                );
                Alert.alert("Success", "Session revoked successfully");
              } else {
                Alert.alert("Error", "Failed to revoke session");
              }
            } catch (error) {
              console.error("Error revoking session:", error);
              Alert.alert("Error", "Failed to revoke session");
            } finally {
              setRevokingSessionId(null);
            }
          },
        },
      ]
    );
  };

  const handleRevokeAllOthers = () => {
    const otherSessionsCount = sessions.filter((s) => !s.is_current).length;

    if (otherSessionsCount === 0) {
      Alert.alert("No Other Sessions", "You don't have any other active sessions.");
      return;
    }

    Alert.alert(
      "Sign Out All Other Devices",
      `This will sign you out from ${otherSessionsCount} other device${
        otherSessionsCount === 1 ? "" : "s"
      }. Your current device will remain signed in.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out All",
          style: "destructive",
          onPress: async () => {
            try {
              const revokedCount = await authService.revokeAllOtherSessions();
              setSessions((prev) => prev.filter((s) => s.is_current));
              Alert.alert(
                "Success",
                `Signed out from ${revokedCount} device${revokedCount === 1 ? "" : "s"}`
              );
            } catch (error) {
              console.error("Error revoking other sessions:", error);
              Alert.alert("Error", "Failed to sign out other devices");
            }
          },
        },
      ]
    );
  };

  const renderPlatformIcon = (platform: "web" | "ios" | "android") => {
    const iconName =
      platform === "web"
        ? "globe-outline"
        : platform === "ios"
        ? "phone-portrait-outline"
        : "phone-portrait-outline";

    return <Ionicons name={iconName as any} size={24} color="#666" />;
  };

  const renderSession = ({ item }: { item: UserSession }) => {
    const { title, subtitle, platform } = SessionManager.formatSessionInfo(item);
    const isRevoking = revokingSessionId === item.session_id;

    return (
      <View style={styles.sessionCard}>
        <View style={styles.sessionIcon}>{renderPlatformIcon(platform)}</View>

        <View style={styles.sessionInfo}>
          <View style={styles.sessionTitleRow}>
            <Text style={styles.sessionTitle}>{title}</Text>
            {item.is_current && (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>Current</Text>
              </View>
            )}
          </View>
          <Text style={styles.sessionSubtitle}>{subtitle}</Text>
        </View>

        {!item.is_current && (
          <TouchableOpacity
            style={styles.revokeButton}
            onPress={() => handleRevokeSession(item)}
            disabled={isRevoking}
          >
            {isRevoking ? (
              <ActivityIndicator size="small" color="#FF3B30" />
            ) : (
              <Ionicons name="close-circle-outline" size={24} color="#FF3B30" />
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#007AFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Active Sessions</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      </View>
    );
  }

  const otherSessionsCount = sessions.filter((s) => !s.is_current).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Active Sessions</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.infoText}>
          These are the devices where you're currently signed in. You can sign out from
          any device remotely.
        </Text>
      </View>

      <FlatList
        data={sessions}
        renderItem={renderSession}
        keyExtractor={(item) => item.session_id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="phone-portrait-outline" size={48} color="#999" />
            <Text style={styles.emptyText}>No active sessions found</Text>
          </View>
        }
      />

      {otherSessionsCount > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.revokeAllButton}
            onPress={handleRevokeAllOthers}
          >
            <Text style={styles.revokeAllButtonText}>
              Sign Out All Other Devices ({otherSessionsCount})
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#000",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  infoSection: {
    backgroundColor: "#FFF",
    padding: 16,
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  listContent: {
    padding: 16,
  },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  sessionIcon: {
    marginRight: 12,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
    marginRight: 8,
  },
  currentBadge: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  currentBadgeText: {
    fontSize: 12,
    color: "#FFF",
    fontWeight: "600",
  },
  sessionSubtitle: {
    fontSize: 14,
    color: "#666",
  },
  revokeButton: {
    padding: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 16,
    color: "#999",
    marginTop: 12,
  },
  footer: {
    padding: 16,
    backgroundColor: "#FFF",
    borderTopWidth: 1,
    borderTopColor: "#E5E5E5",
  },
  revokeAllButton: {
    backgroundColor: "#FF3B30",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  revokeAllButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
