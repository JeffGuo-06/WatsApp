import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  Linking,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { supabase } from "@/lib/supabase";
import { courseService } from "@/services/courseService";
import Snackbar from "@/components/Snackbar";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

interface CourseMember {
  id: string;
  profiles: {
    name: string;
    watiam_id: string;
    avatar_url?: string | null;
    program?: string | null;
    year?: string | null;
    instagram?: string | null;
    email?: string | null;
  };
}

const getInitials = (name?: string) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || name.charAt(0).toUpperCase() || "?";
};

const normalizeInstagramLink = (value?: string | null) => {
  if (!value) return null;
  if (value.startsWith("http")) return value;
  const handle = value.replace(/^@/, "");
  return `https://instagram.com/${handle}`;
};

const formatInstagramHandle = (value?: string | null) => {
  if (!value) return null;
  if (value.startsWith("@")) return value;
  if (value.startsWith("http")) {
    try {
      const url = new URL(value);
      const [segment] = url.pathname.replace(/^\/+/, "").split("/");
      return segment ? `@${segment}` : value;
    } catch {
      return value;
    }
  }
  return `@${value.replace(/^@/, "")}`;
};

export default function CourseDetails() {
  const params = useLocalSearchParams();
  const { courseId, courseCode, courseTitle, courseChatId } = params;

  const [members, setMembers] = useState<CourseMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userCourseId, setUserCourseId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState({ visible: false, message: "", type: "success" as "success" | "error" | "info" });
  const [selectedMember, setSelectedMember] = useState<CourseMember | null>(null);
  const [profileModalVisible, setProfileModalVisible] = useState(false);

  const closeProfileModal = () => {
    setProfileModalVisible(false);
    setSelectedMember(null);
  };

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Get all members enrolled in this course
      const { data: enrollments, error } = await supabase
        .from("user_courses")
        .select("id, user_id, profiles(name, watiam_id, avatar_url, program, year, instagram, email)")
        .eq("course_id", courseId as string);

      if (error) throw error;

      setMembers(enrollments || []);

      // Find current user's enrollment ID for leaving
      const userEnrollment = enrollments?.find((e) => e.user_id === user.id);
      if (userEnrollment) {
        setUserCourseId(userEnrollment.id);
      }
    } catch (error) {
      console.error("Error loading members:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveCourse = () => {
    Alert.alert(
      "Leave Course",
      `Are you sure you want to leave ${courseCode}? You will no longer have access to the chat.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            try {
              if (!userCourseId) return;
              await courseService.removeCourse(userCourseId);

              // Show snackbar before dismissing
              setSnackbar({ visible: true, message: `Left ${courseCode}`, type: "info" });

              // Wait a bit for snackbar to show, then dismiss
              setTimeout(() => {
                router.dismiss();
                router.dismiss(); // Dismiss course-details and course-chat
              }, 1500);
            } catch (error) {
              console.error("Error leaving course:", error);
              setSnackbar({ visible: true, message: "Failed to leave course", type: "error" });
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FDB515" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <IconSymbol name="chevron.left" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.courseCode}>{courseCode}</Text>
          <Text style={styles.courseTitle}>Course Details</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Members ({members.length})</Text>
          <FlatList
            data={members}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.memberCard}
                activeOpacity={0.7}
                onPress={() => {
                  setSelectedMember(item);
                  setProfileModalVisible(true);
                }}
              >
                <View style={styles.avatarWrapper}>
                  {item.profiles?.avatar_url ? (
                    <Image
                      source={{ uri: item.profiles.avatar_url }}
                      style={styles.avatarImage}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarFallbackText}>
                        {getInitials(item.profiles?.name)}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{item.profiles?.name}</Text>
                  <Text style={styles.memberWatiam}>@{item.profiles?.watiam_id}</Text>
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.membersList}
          />
        </View>

        <TouchableOpacity style={styles.leaveButton} onPress={handleLeaveCourse}>
          <IconSymbol name="arrow.left.square" size={20} color="#fff" />
          <Text style={styles.leaveButtonText}>Leave Course</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={profileModalVisible && !!selectedMember}
        transparent
        animationType="fade"
        onRequestClose={closeProfileModal}
      >
        <TouchableOpacity
          style={styles.profileModalOverlay}
          activeOpacity={1}
          onPress={closeProfileModal}
        >
          <TouchableOpacity
            style={styles.profileModalContent}
            activeOpacity={1}
            onPress={(event) => event.stopPropagation()}
          >
            <TouchableOpacity
              style={styles.profileModalClose}
              onPress={closeProfileModal}
            >
              <IconSymbol name="xmark.circle.fill" size={24} color="#64748B" />
            </TouchableOpacity>
            <View style={styles.profileModalHeader}>
              <View style={styles.profileModalAvatarWrapper}>
                {selectedMember?.profiles?.avatar_url ? (
                  <Image
                    source={{ uri: selectedMember.profiles.avatar_url }}
                    style={styles.profileModalAvatar}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.profileModalAvatarFallback}>
                    <Text style={styles.profileModalInitials}>
                      {getInitials(selectedMember?.profiles?.name)}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.profileModalName}>{selectedMember?.profiles?.name}</Text>
              <Text style={styles.profileModalHandle}>
                @{selectedMember?.profiles?.watiam_id}
              </Text>
            </View>
            <View style={styles.profileModalDetails}>
              {selectedMember?.profiles?.email ? (
                <View style={styles.profileModalRow}>
                  <Text style={styles.profileModalLabel}>Email</Text>
                  <Text style={styles.profileModalValue}>
                    {selectedMember.profiles.email}
                  </Text>
                </View>
              ) : null}
              {selectedMember?.profiles?.program ? (
                <View style={styles.profileModalRow}>
                  <Text style={styles.profileModalLabel}>Program</Text>
                  <Text style={styles.profileModalValue}>
                    {selectedMember.profiles.program}
                  </Text>
                </View>
              ) : null}
              {selectedMember?.profiles?.year ? (
                <View style={styles.profileModalRow}>
                  <Text style={styles.profileModalLabel}>Year</Text>
                  <Text style={styles.profileModalValue}>
                    {selectedMember.profiles.year}
                  </Text>
                </View>
              ) : null}
              {selectedMember?.profiles?.instagram ? (
                <View style={styles.profileConnectionGroup}>
                  <Text style={styles.profileModalLabel}>Instagram</Text>
                  <TouchableOpacity
                    style={styles.profileConnectionCard}
                    activeOpacity={0.85}
                    onPress={() => {
                      const url = normalizeInstagramLink(selectedMember.profiles?.instagram);
                      if (url) {
                        Linking.openURL(url).catch(() =>
                          setSnackbar({
                            visible: true,
                            message: "Could not open Instagram",
                            type: "error",
                          })
                        );
                      }
                    }}
                  >
                    <View style={styles.profileConnectionIconWrapper}>
                      <Ionicons name="logo-instagram" size={28} color="#FFFFFF" />
                    </View>
                    <View style={styles.profileConnectionInfo}>
                      <Text style={styles.profileConnectionHandle}>
                        {formatInstagramHandle(selectedMember.profiles.instagram)}
                      </Text>
                      <Text style={styles.profileConnectionSubtitle}>Instagram</Text>
                    </View>
                    <IconSymbol name="arrow.up.right" size={18} color="#BFDBFE" />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Snackbar
        visible={snackbar.visible}
        message={snackbar.message}
        type={snackbar.type}
        onDismiss={() => setSnackbar({ ...snackbar, visible: false })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  header: {
    backgroundColor: "#FDB515",
    padding: 15,
    paddingTop: 60,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    marginRight: 10,
  },
  headerInfo: {
    flex: 1,
  },
  courseCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000",
  },
  courseTitle: {
    fontSize: 14,
    color: "#333",
  },
  content: {
    flex: 1,
    padding: 15,
  },
  section: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000",
    marginBottom: 15,
  },
  membersList: {
    paddingBottom: 10,
  },
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  avatarWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    marginRight: 12,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: "#FDB515",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
    marginBottom: 2,
  },
  memberWatiam: {
    fontSize: 14,
    color: "#666",
  },
  leaveButton: {
    backgroundColor: "#ff3b30",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 15,
    borderRadius: 10,
    gap: 8,
  },
  leaveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  profileModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  profileModalContent: {
    width: "100%",
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  profileModalClose: {
    alignSelf: "flex-end",
  },
  profileModalHeader: {
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  profileModalAvatarWrapper: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: "hidden",
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  profileModalAvatar: {
    width: "100%",
    height: "100%",
  },
  profileModalAvatarFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: "#FDB515",
    alignItems: "center",
    justifyContent: "center",
  },
  profileModalInitials: {
    fontSize: 32,
    fontWeight: "700",
    color: "#000",
  },
  profileModalName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
    textAlign: "center",
  },
  profileModalHandle: {
    fontSize: 14,
    color: "#475569",
  },
  profileModalDetails: {
    gap: 14,
  },
  profileModalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  profileModalLabel: {
    fontSize: 13,
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  profileModalValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1F2937",
  },
  profileConnectionCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E3561",
    backgroundColor: "#15284B",
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 8,
    gap: 12,
  },
  profileConnectionGroup: {
    gap: 8,
  },
  profileConnectionIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#F77737",
    alignItems: "center",
    justifyContent: "center",
  },
  profileConnectionInfo: {
    flex: 1,
    gap: 2,
  },
  profileConnectionHandle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  profileConnectionSubtitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.7)",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
