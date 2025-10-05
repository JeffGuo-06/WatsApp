import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";

import { useAuth } from "@/context/AuthContext";
import { authService } from "@/services/authService";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import Snackbar from "@/components/Snackbar";

const AVATAR_SIZE = 120;

const getInitials = (name?: string) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const [first = "", second = ""] = parts;
  const initials = `${first.charAt(0)}${second.charAt(0)}`.trim();
  return initials.toUpperCase() || name.charAt(0).toUpperCase();
};

export default function ProfileScreen() {
  const { profile, user, refreshProfile, loading } = useAuth();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [snackbar, setSnackbar] = useState<{
    visible: boolean;
    message: string;
    type: "success" | "error" | "info";
  }>({ visible: false, message: "", type: "info" });
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? "light"];
  const isDark = colorScheme === "dark";
  const cardBackground = isDark ? "#1F1F1F" : "#0F1F3A";
  const surfaceText = "#FFFFFF";
  const subtleText = isDark ? "#9BA1A6" : "#C9D6EB";

  const showSnackbar = (
    message: string,
    type: "success" | "error" | "info" = "info"
  ) => {
    setSnackbar({ visible: true, message, type });
  };

  const hideSnackbar = () => {
    setSnackbar({ ...snackbar, visible: false });
  };

  const avatarSource = useMemo(() => {
    if (profile?.avatar_url) {
      return { uri: profile.avatar_url };
    }
    return null;
  }, [profile?.avatar_url]);

  const handleSelectAvatar = async () => {
    if (!user) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      showSnackbar(
        "Please allow photo library access to set a profile picture.",
        "error"
      );
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    if (pickerResult.canceled || !pickerResult.assets?.length) {
      return;
    }

    const asset = pickerResult.assets[0];

    try {
      setUploadingAvatar(true);
      await authService.updateAvatar(user.id, {
        uri: asset.uri,
        base64: asset.base64 ?? null,
        mimeType: asset.mimeType ?? null,
        fileName: asset.fileName ?? null,
        type: asset.type ?? null,
      });
      await refreshProfile();
      showSnackbar("Profile picture updated", "success");
    } catch (error: any) {
      showSnackbar(
        error?.message || "Could not update your profile picture",
        "error"
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authService.signOut();
      router.replace("/(auth)/login");
    } catch (error: any) {
      showSnackbar(error?.message || "Unable to sign out right now", "error");
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete account?",
      "This will permanently remove your account, courses, and messages. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!user) return;
            try {
              setDeletingAccount(true);
              await authService.deleteAccount();
              router.replace("/(auth)/login");
            } catch (error: any) {
              showSnackbar(
                error?.message || "Unable to delete your account",
                "error"
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshProfile();
    } finally {
      setRefreshing(false);
    }
  };

  const handleEditName = () => {
    setNameValue(profile?.name || "");
    setEditingName(true);
  };

  const handleSaveName = async () => {
    if (!user || !nameValue.trim()) {
      setEditingName(false);
      return;
    }

    try {
      await authService.updateProfile(user.id, { name: nameValue.trim() });
      await refreshProfile();
      setEditingName(false);
      showSnackbar("Name updated", "success");
    } catch (error: any) {
      showSnackbar(error?.message || "Could not update your name", "error");
    }
  };

  const handleCancelEditName = () => {
    setEditingName(false);
    setNameValue("");
  };

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["top"]}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={isDark ? "#FFFFFF" : "#3B82F6"}
            colors={["#3B82F6"]}
          />
        }
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: cardBackground,
              borderColor: isDark ? "#2B2B2B" : "#1B2C47",
            },
          ]}
        >
          <View style={styles.avatarContainer}>
            <TouchableOpacity
              onPress={handleSelectAvatar}
              disabled={uploadingAvatar || !user}
              activeOpacity={0.7}
            >
              {avatarSource ? (
                <Image
                  source={avatarSource}
                  style={styles.avatar}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={[
                    styles.avatar,
                    styles.avatarFallback,
                    colorScheme === "dark" && styles.avatarFallbackDark,
                  ]}
                >
                  <Text
                    style={[
                      styles.avatarInitials,
                      colorScheme === "dark" && styles.avatarInitialsDark,
                    ]}
                  >
                    {getInitials(profile?.name)}
                  </Text>
                </View>
              )}
              {uploadingAvatar && (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator color="#FFFFFF" size="large" />
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.infoSection}>
            {loading && !profile ? (
              <ActivityIndicator />
            ) : (
              <>
                {editingName ? (
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: subtleText }]}>
                      Name
                    </Text>
                    <TextInput
                      style={[styles.nameInput, { color: surfaceText }]}
                      value={nameValue}
                      onChangeText={setNameValue}
                      placeholder="Enter your name"
                      placeholderTextColor={subtleText}
                      autoFocus
                      onSubmitEditing={handleSaveName}
                      onBlur={handleCancelEditName}
                    />
                  </View>
                ) : (
                  <TouchableOpacity onPress={handleEditName}>
                    <InfoRow
                      label="Name"
                      value={profile?.name || "Unknown"}
                      labelColor={subtleText}
                      valueColor={surfaceText}
                    />
                  </TouchableOpacity>
                )}
                <InfoRow
                  label="Waterloo Email"
                  value={profile?.email || "N/A"}
                  labelColor={subtleText}
                  valueColor={surfaceText}
                />
                <InfoRow
                  label="WatIAM ID"
                  value={profile?.watiam_id || "N/A"}
                  labelColor={subtleText}
                  valueColor={surfaceText}
                />
                <InfoRow
                  label="Program"
                  value={profile?.program || "Add your program"}
                  labelColor={subtleText}
                  valueColor={surfaceText}
                />
                <InfoRow
                  label="Year"
                  value={profile?.year || "Add your year"}
                  labelColor={subtleText}
                  valueColor={surfaceText}
                />
              </>
            )}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.outlineButton]}
              onPress={handleLogout}
            >
              <Text style={[styles.outlineButtonText, { color: surfaceText }]}>
                Sign out
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                styles.dangerButton,
                deletingAccount && styles.buttonDisabled,
              ]}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
            >
              {deletingAccount ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Delete account</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      <Snackbar
        visible={snackbar.visible}
        message={snackbar.message}
        type={snackbar.type}
        onDismiss={hideSnackbar}
      />
    </SafeAreaView>
  );
}

function InfoRow({
  label,
  value,
  labelColor,
  valueColor,
}: {
  label: string;
  value: string;
  labelColor: string;
  valueColor: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: labelColor }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: Platform.select({ ios: 48, default: 32 }),
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    gap: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    flex: 1,
    borderWidth: 1,
  },
  avatarContainer: {
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "#E5E5E5",
    overflow: "hidden",
  },
  avatarOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackDark: {
    backgroundColor: "#3A3A3A",
  },
  avatarInitials: {
    fontSize: 36,
    fontWeight: "700",
    color: "#555",
  },
  avatarInitialsDark: {
    color: "#ECEDEE",
  },
  infoSection: {
    gap: 12,
    paddingBottom: 8,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: "600",
  },
  actions: {
    gap: 12,
    marginTop: "auto",
  },
  button: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    backgroundColor: Colors.light.tint,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  outlineButton: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  outlineButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  dangerButton: {
    backgroundColor: "#E5484D",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  nameInput: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "right",
    flex: 1,
  },
});
