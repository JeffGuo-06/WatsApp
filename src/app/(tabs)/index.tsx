import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { courseService } from "@/services/courseService";
import { chatService } from "@/services/chatService";
import { router, useFocusEffect } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { chatReadStorage } from "@/utils/chatReadStorage";
import { notificationService } from "@/services/notificationService";
import { Ionicons } from "@expo/vector-icons";

interface CourseChatLink {
  id: string;
}

interface UserCourse {
  id: string;
  course_id: string;
  courses: {
    id: string;
    course_code: string;
    course_name: string | null;
    term: string;
    course_chats?: CourseChatLink | CourseChatLink[] | null;
  };
}

const getCourseChatId = (course: UserCourse): string | undefined => {
  const relation = course.courses?.course_chats;
  if (!relation) return undefined;
  if (Array.isArray(relation)) {
    return relation[0]?.id;
  }
  return relation.id;
};

export default function HomeScreen() {
  const { user, profile } = useAuth();
  const [courses, setCourses] = useState<UserCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [courseChatIds, setCourseChatIds] = useState<Record<string, string>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mutedCourses, setMutedCourses] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (user) {
      console.log("[Home] User detected, loading courses", { userId: user.id });
      loadCourses();
    }
  }, [user]);

  // Refresh courses when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      if (user) {
        loadCourses();
      }
    }, [user])
  );

  useEffect(() => {
    let isActive = true;

    const computeUnreadCounts = async () => {
      if (!courses.length) {
        if (isActive) {
          setUnreadCounts({});
        }
        return;
      }

      const discoveredChatIds: Record<string, string> = {};
      const results = await Promise.all(
        courses.map(async (course) => {
          try {
            let chatId = getCourseChatId(course) ?? courseChatIds[course.courses.id];
            if (!chatId) {
              const chatRoom = await chatService.getCourseChatRoom(course.courses.id);
              chatId = chatRoom?.id;
              if (chatId) {
                discoveredChatIds[course.courses.id] = chatId;
              }
            }

            if (!chatId) {
              return null;
            }

            const lastReadAt = await chatReadStorage.getLastReadAt(chatId);
            const count = await chatService.getUnreadMessageCount(chatId, lastReadAt);
            return { chatId, count };
          } catch (error) {
            console.error("Error calculating unread messages", {
              courseId: course.courses.id,
              error,
            });
            return null;
          }
        })
      );

      if (!isActive) {
        return;
      }

      if (Object.keys(discoveredChatIds).length) {
        setCourseChatIds((prev) => {
          const next = { ...prev };
          let changed = false;
          Object.entries(discoveredChatIds).forEach(([courseId, chatId]) => {
            if (next[courseId] !== chatId) {
              next[courseId] = chatId;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }

      const nextCounts: Record<string, number> = {};
      results.forEach((result) => {
        if (result?.chatId) {
          nextCounts[result.chatId] = result.count ?? 0;
        }
      });

      setUnreadCounts(nextCounts);
    };

    computeUnreadCounts();

    return () => {
      isActive = false;
    };
  }, [courses, courseChatIds]);

  // Load mute status for each course
  useEffect(() => {
    const loadMuteStatuses = async () => {
      if (!user || !courses.length) {
        setMutedCourses({});
        return;
      }

      const muteStatuses: Record<string, boolean> = {};

      await Promise.all(
        courses.map(async (course) => {
          const chatId = getCourseChatId(course) ?? courseChatIds[course.courses.id];
          if (chatId) {
            try {
              const isMuted = await notificationService.isCourseMuted(user.id, chatId);
              muteStatuses[chatId] = isMuted;
            } catch (error) {
              console.error('Error loading mute status for course:', course.courses.course_code, error);
            }
          }
        })
      );

      setMutedCourses(muteStatuses);
    };

    loadMuteStatuses();
  }, [user, courses, courseChatIds]);

  const loadCourses = async () => {
    try {
      console.log("[Home] Fetching courses for user", { userId: user?.id });
      const data = await courseService.getUserCourses(user!.id);
      console.log("[Home] Loaded courses successfully", { count: data.length, courses: data });
      setCourses(data);
      setCourseChatIds((prev) => {
        const next = { ...prev };
        let changed = false;
        data.forEach((course) => {
          const chatId = getCourseChatId(course);
          if (chatId && next[course.courses.id] !== chatId) {
            next[course.courses.id] = chatId;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    } catch (error) {
      console.error("[Home] ERROR loading courses:", error);
      // Show error details
      if (error instanceof Error) {
        console.error("[Home] Error message:", error.message);
        console.error("[Home] Error stack:", error.stack);
      }
      // Set empty array on error so loading stops
      setCourses([]);
    } finally {
      console.log("[Home] Loading complete, setting loading to false");
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    console.log("[Home] Pull-to-refresh triggered");
    loadCourses();
  };

  const handleCoursePress = async (course: UserCourse) => {
    try {
      console.log("[Home] Opening course chat", {
        courseId: course.courses.id,
        courseCode: course.courses.course_code,
      });
      // Get the course chat
      const chatRoom = await chatService.getCourseChatRoom(course.courses.id);
      console.log("[Home] Navigating to course chat", { chatId: chatRoom.id });

      setUnreadCounts((prev) => {
        if (prev[chatRoom.id] === 0) {
          return prev;
        }
        return { ...prev, [chatRoom.id]: 0 };
      });
      setCourseChatIds((prev) => {
        if (prev[course.courses.id] === chatRoom.id) {
          return prev;
        }
        return { ...prev, [course.courses.id]: chatRoom.id };
      });

      router.push({
        pathname: "/course-chat",
        params: {
          courseChatId: chatRoom.id,
          courseCode: course.courses.course_code,
          courseTitle: course.courses.course_name || course.courses.course_code,
          courseId: course.courses.id,
        }
      });
    } catch (error) {
      console.error("Error opening course chat:", error);
    }
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
        <Text style={styles.title}>My Courses</Text>
        <Text style={styles.subtitle}>WatsApp, {profile?.name}!</Text>
        <TouchableOpacity
          style={styles.addCourseButton}
          onPress={() => router.push("/course-search")}
        >
          <IconSymbol name="plus.circle.fill" size={28} color="#000" />
        </TouchableOpacity>
      </View>

      {courses.length === 0 ? (
        <View style={styles.emptyState}>
          <IconSymbol name="book.closed" size={64} color="#ccc" />
          <Text style={styles.emptyText}>No courses added yet</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push("/course-search")}
          >
            <Text style={styles.addButtonText}>Add Your First Course</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const chatId = getCourseChatId(item) ?? courseChatIds[item.courses.id];
            const unreadCount = chatId ? unreadCounts[chatId] ?? 0 : 0;
            const unreadLabel = unreadCount > 9 ? "9+" : `${unreadCount}`;
            const isMuted = chatId ? mutedCourses[chatId] ?? false : false;

            return (
              <TouchableOpacity
                style={styles.courseCard}
                onPress={() => handleCoursePress(item)}
              >
                <View style={styles.courseHeader}>
                  <View style={styles.courseInfo}>
                    <Text style={styles.courseCode}>{item.courses.course_code}</Text>
                    {item.courses.course_name && (
                      <Text style={styles.courseName}>{item.courses.course_name}</Text>
                    )}
                    <Text style={styles.courseTerm}>{item.courses.term}</Text>
                  </View>
                  <View style={styles.courseMeta}>
                    {isMuted ? (
                      <Ionicons name="notifications-off" size={20} color="#999" style={{ marginRight: 8 }} />
                    ) : (
                      unreadCount > 0 && (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadBadgeText}>{unreadLabel}</Text>
                        </View>
                      )
                    )}
                    <IconSymbol name="chevron.right" size={20} color="#999" />
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#FDB515"
            />
          }
        />
      )}
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
    padding: 20,
    paddingTop: 60,
    position: "relative",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#000",
  },
  subtitle: {
    fontSize: 16,
    color: "#000",
    marginTop: 5,
  },
  addCourseButton: {
    position: "absolute",
    top: 60,
    right: 20,
  },
  list: {
    padding: 15,
  },
  courseCard: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  courseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  courseInfo: {
    flex: 1,
  },
  courseMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 12,
  },
  unreadBadge: {
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  unreadBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  courseCode: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#000",
  },
  courseName: {
    fontSize: 14,
    color: "#666",
    marginTop: 5,
  },
  courseTerm: {
    fontSize: 12,
    color: "#999",
    marginTop: 5,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    color: "#666",
    marginTop: 20,
    marginBottom: 20,
  },
  addButton: {
    backgroundColor: "#FDB515",
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#000",
  },
});
