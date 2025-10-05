import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { courseService } from "@/services/courseService";
import { chatService } from "@/services/chatService";
import { router, useFocusEffect } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";

interface UserCourse {
  id: string;
  courses: {
    id: string;
    course_code: string;
    course_name: string | null;
    term: string;
  };
}

export default function HomeScreen() {
  const { user, profile } = useAuth();
  const [courses, setCourses] = useState<UserCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user) {
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

  const loadCourses = async () => {
    try {
      const data = await courseService.getUserCourses(user!.id);
      setCourses(data);
    } catch (error) {
      console.error("Error loading courses:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadCourses();
  };

  const handleCoursePress = async (course: UserCourse) => {
    try {
      // Get the course chat
      const chatRoom = await chatService.getCourseChatRoom(course.courses.id);

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
        <Text style={styles.subtitle}>Welcome, {profile?.name}!</Text>
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
          renderItem={({ item }) => (
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
                <IconSymbol name="chevron.right" size={20} color="#999" />
              </View>
            </TouchableOpacity>
          )}
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
