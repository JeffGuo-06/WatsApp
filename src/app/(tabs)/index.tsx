import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { courseService } from "@/services/courseService";
import { router } from "expo-router";

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

  useEffect(() => {
    if (user) {
      loadCourses();
    }
  }, [user]);

  const loadCourses = async () => {
    try {
      const data = await courseService.getUserCourses(user!.id);
      setCourses(data);
    } catch (error) {
      console.error("Error loading courses:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Courses</Text>
        <Text style={styles.subtitle}>Welcome, {profile?.name}!</Text>
      </View>

      {courses.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No courses added yet</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push("/course-search")}
          >
            <Text style={styles.addButtonText}>Add Courses</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.courseCard}>
              <Text style={styles.courseCode}>{item.courses.course_code}</Text>
              {item.courses.course_name && (
                <Text style={styles.courseName}>{item.courses.course_name}</Text>
              )}
              <Text style={styles.courseTerm}>{item.courses.term}</Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.list}
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
  header: {
    backgroundColor: "#FDB515",
    padding: 20,
    paddingTop: 60,
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
    fontSize: 16,
    color: "#666",
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
