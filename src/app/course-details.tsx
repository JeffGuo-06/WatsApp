import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { supabase } from "@/lib/supabase";
import { courseService } from "@/services/courseService";

interface CourseMember {
  id: string;
  profiles: {
    name: string;
    watiam_id: string;
  };
}

export default function CourseDetails() {
  const params = useLocalSearchParams();
  const { courseId, courseCode, courseTitle, courseChatId } = params;

  const [members, setMembers] = useState<CourseMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userCourseId, setUserCourseId] = useState<string | null>(null);

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
        .select("id, user_id, profiles(name, watiam_id)")
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
              router.dismiss();
              router.dismiss(); // Dismiss course-details and course-chat
            } catch (error) {
              console.error("Error leaving course:", error);
              Alert.alert("Error", "Failed to leave course");
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
              <View style={styles.memberCard}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>
                    {item.profiles?.name?.charAt(0).toUpperCase() || "?"}
                  </Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{item.profiles?.name}</Text>
                  <Text style={styles.memberWatiam}>@{item.profiles?.watiam_id}</Text>
                </View>
              </View>
            )}
            contentContainerStyle={styles.membersList}
          />
        </View>

        <TouchableOpacity style={styles.leaveButton} onPress={handleLeaveCourse}>
          <IconSymbol name="arrow.left.square" size={20} color="#fff" />
          <Text style={styles.leaveButtonText}>Leave Course</Text>
        </TouchableOpacity>
      </View>
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
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FDB515",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
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
});
