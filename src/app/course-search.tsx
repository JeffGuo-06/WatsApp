import React, { useState } from "react";
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

interface Course {
  subject: string;
  catalog: string;
  title: string;
  campus: string;
}

export default function CourseSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);

  const searchCourses = async (query: string) => {
    if (query.length < 2) {
      setCourses([]);
      return;
    }

    setLoading(true);
    try {
      // TODO: Replace with your Vercel deployment URL after deployment
      // For now, you can test locally with: vercel dev
      const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
      const response = await fetch(`${API_URL}/api/courses`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.courses) {
        throw new Error("Invalid response format");
      }

      const searchLower = query.toLowerCase();
      const filteredCourses = data.courses
        .filter((course: Course) => {
          const courseCode = `${course.subject} ${course.catalog}`.toLowerCase();
          const courseTitle = course.title.toLowerCase();
          return courseCode.includes(searchLower) || courseTitle.includes(searchLower);
        })
        .slice(0, 50); // Limit to 50 results

      setCourses(filteredCourses);
    } catch (error) {
      console.error("Error fetching courses:", error);
      setCourses([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    searchCourses(text);
  };

  const handleCourseSelect = (course: Course) => {
    // TODO: Add course to user's courses
    console.log("Selected course:", course);
    router.back();
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
          data={courses}
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
});
