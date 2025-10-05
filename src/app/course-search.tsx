import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { supabase } from "@/lib/supabase";
import { courseService } from "@/services/courseService";
import Snackbar from "@/components/Snackbar";

interface Course {
  subject: string;
  catalog: string;
  title: string;
  campus: string;
}

export default function CourseSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [filteredCourses, setFilteredCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCourses();
  }, []);

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
      const response = await fetch(`${API_URL}/api/courses`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.courses) {
        throw new Error("Invalid response format");
      }

      setAllCourses(data.courses);
    } catch (error) {
      console.error("Error fetching courses:", error);
      setAllCourses([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);

    if (text.length < 2) {
      setFilteredCourses([]);
      return;
    }

    // Remove whitespace and convert to lowercase for comparison
    const searchNormalized = text.replace(/\s+/g, '').toLowerCase();

    const results = allCourses
      .map((course) => {
        const courseCode = `${course.subject}${course.catalog}`.toLowerCase();
        const courseCodeWithSpace = `${course.subject} ${course.catalog}`.toLowerCase();
        const courseTitle = course.title.toLowerCase();

        // Prioritize course code matches
        let priority = 0;
        if (courseCode.startsWith(searchNormalized)) {
          priority = 3; // Exact start match
        } else if (courseCode.includes(searchNormalized)) {
          priority = 2; // Course code contains search
        } else if (courseCodeWithSpace.includes(text.toLowerCase())) {
          priority = 2; // Course code with space matches
        } else if (courseTitle.includes(text.toLowerCase())) {
          priority = 1; // Title contains search
        }

        return { course, priority };
      })
      .filter((item) => item.priority > 0)
      .sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        // If same priority, sort alphabetically by course code
        return `${a.course.subject}${a.course.catalog}`.localeCompare(
          `${b.course.subject}${b.course.catalog}`
        );
      })
      .slice(0, 50)
      .map((item) => item.course);

    setFilteredCourses(results);
  };

  const handleCourseSelect = async (course: Course) => {
    try {
      const courseCode = `${course.subject} ${course.catalog}`;
      const term = "Winter 2025";

      // 1. Create or get course (WITHOUT enrolling user yet)
      const { data: existingCourse } = await supabase
        .from("courses")
        .select("id")
        .eq("course_code", courseCode)
        .eq("term", term)
        .single();

      let createdCourseId: string;

      if (existingCourse) {
        createdCourseId = existingCourse.id;
      } else {
        // Create new course
        const { data: newCourse, error: createError } = await supabase
          .from("courses")
          .insert({
            course_code: courseCode,
            course_name: course.title,
            term,
          })
          .select("id")
          .single();

        if (createError) throw createError;
        createdCourseId = newCourse.id;
      }

      // 2. Get or create course chat
      const { data: createdChatId, error: chatError } = await supabase.rpc(
        "get_or_create_course_chat",
        { p_course_id: createdCourseId }
      );

      if (chatError) throw chatError;

      // 3. Navigate to chat room with showJoinPrompt flag
      router.push({
        pathname: "/course-chat",
        params: {
          courseChatId: createdChatId,
          courseCode: `${course.subject} ${course.catalog}`,
          courseTitle: course.title,
          courseId: createdCourseId,
          showJoinPrompt: "true"
        }
      });
    } catch (error) {
      console.error("Error preparing chat:", error);
    }
  };


  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <IconSymbol name="chevron.left" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Search Courses</Text>
      </View>

      <View style={styles.searchContainer}>
        <IconSymbol name="magnifyingglass" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by course code or title..."
          value={searchQuery}
          onChangeText={handleSearchChange}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FDB515" />
        </View>
      ) : (
        <FlatList
          data={filteredCourses}
          keyExtractor={(item, index) => `${item.subject}-${item.catalog}-${index}`}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.courseCard}
              onPress={() => handleCourseSelect(item)}
            >
              <View style={styles.courseHeader}>
                <Text style={styles.courseCode}>
                  {item.subject} {item.catalog}
                </Text>
                <Text style={styles.campus}>{item.campus}</Text>
              </View>
              <Text style={styles.courseTitle}>{item.title}</Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            searchQuery.length >= 2 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No courses found</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Start typing to search courses</Text>
              </View>
            )
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
  header: {
    backgroundColor: "#FDB515",
    padding: 20,
    paddingTop: 60,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    marginRight: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#000",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    margin: 15,
    paddingHorizontal: 15,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 15,
    fontSize: 16,
    color: "#000",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  list: {
    padding: 15,
    paddingTop: 0,
  },
  courseCard: {
    backgroundColor: "#fff",
    padding: 15,
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
    marginBottom: 5,
  },
  courseCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000",
  },
  campus: {
    fontSize: 12,
    color: "#666",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
  },
  courseTitle: {
    fontSize: 14,
    color: "#666",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: "#999",
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 30,
    width: "85%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#000",
    textAlign: "center",
    marginBottom: 20,
  },
  coursePreview: {
    backgroundColor: "#f5f5f5",
    padding: 20,
    borderRadius: 12,
    marginBottom: 25,
  },
  modalCourseCode: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#000",
    marginBottom: 8,
  },
  modalCourseTitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 8,
  },
  modalCampus: {
    fontSize: 14,
    color: "#999",
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "#e0e0e0",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
  },
  joinButton: {
    backgroundColor: "#FDB515",
  },
  joinButtonText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#000",
  },
  preparingText: {
    fontSize: 16,
    color: "#666",
    marginTop: 15,
    textAlign: "center",
  },
});
