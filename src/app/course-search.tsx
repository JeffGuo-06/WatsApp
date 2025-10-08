import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Modal,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { supabase } from "@/lib/supabase";
import Constants from "expo-constants";
import localCoursesData from "@/data/courses.json";
import { courseService } from "@/services/courseService";
import { parseQuestSchedule } from "@/utils/questScheduleParser";

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
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadText, setUploadText] = useState("");
  const [processingUpload, setProcessingUpload] = useState(false);
  const [detectedCourses, setDetectedCourses] = useState<string[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const knownCourseCodes = useMemo(() => {
    if (!allCourses.length) return null;
    const set = new Set<string>();
    allCourses.forEach((course) => {
      set.add(`${course.subject} ${course.catalog}`.toUpperCase());
    });
    return set;
  }, [allCourses]);

  const fetchCourses = useCallback(async () => {
    setLoading(true);
    try {
      const endpoints = new Set<string>();

      if (Platform.OS === "web" && typeof window !== "undefined") {
        const { origin, hostname } = window.location;
        endpoints.add(`${origin}/api/courses`);

        if (hostname === "localhost" || hostname === "127.0.0.1") {
          endpoints.add("http://localhost:3000/api/courses");
        }
      } else {
        const legacyDebuggerHost = (
          Constants.manifest as Record<string, unknown> | undefined
        )?.debuggerHost as string | undefined;
        const hostUri =
          Constants.expoConfig?.hostUri ??
          Constants.manifest2?.extra?.expoGo?.developer?.hostUri ??
          legacyDebuggerHost;

        if (hostUri) {
          const host = hostUri.split(":")[0];
          if (host) {
            endpoints.add(`http://${host}:3000/api/courses`);
          }
        }
      }

      endpoints.add("https://wats-app.vercel.app/api/courses");

      let courses: Course[] | null = null;
      let lastError: unknown;

      for (const endpoint of Array.from(endpoints)) {
        try {
          const response = await fetch(endpoint);

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data = await response.json();

          if (!data?.courses) {
            throw new Error("Invalid response format");
          }

          courses = data.courses;
          break;
        } catch (error) {
          lastError = error;
          console.warn(`Course fetch failed for ${endpoint}`, error);
        }
      }

      if (!courses) {
        if (localCoursesData?.courses?.length) {
          console.warn("Falling back to bundled course data");
          setAllCourses(localCoursesData.courses as Course[]);
          return;
        }

        throw lastError || new Error("Unable to fetch courses");
      }

      setAllCourses(courses);
    } catch (error) {
      console.error("Error fetching courses:", error);
      setAllCourses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

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

  const resetUploadState = () => {
    setUploadText("");
    setProcessingUpload(false);
    setShowUploadModal(false);
    setDetectedCourses([]);
    setSelectedCourses(new Set());
  };

  useEffect(() => {
    if (!showUploadModal) return;

    const parsed = parseQuestSchedule(uploadText, {
      knownCourses: knownCourseCodes,
    });

    setDetectedCourses(parsed);
    setSelectedCourses(new Set(parsed));
  }, [uploadText, showUploadModal, knownCourseCodes]);

  const toggleSelectedCourse = (courseCode: string) => {
    setSelectedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseCode)) {
        next.delete(courseCode);
      } else {
        next.add(courseCode);
      }
      return next;
    });
  };

  const handleUploadCourses = async () => {
    if (!uploadText.trim()) {
      Alert.alert("Nothing to parse", "Paste your schedule text before uploading.");
      return;
    }

    if (!detectedCourses.length) {
      Alert.alert(
        "No courses found",
        "We couldn't detect any course codes in that text. Please check the paste and try again."
      );
      return;
    }

    const courseCodes = Array.from(selectedCourses).filter(Boolean);

    if (!courseCodes.length) {
      Alert.alert(
        "Select a course",
        "Choose at least one of the detected courses before uploading."
      );
      return;
    }

    setProcessingUpload(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        Alert.alert("Not signed in", "You need to be logged in to upload your schedule.");
        setProcessingUpload(false);
        return;
      }

      await courseService.addCourses(user.id, courseCodes);

      resetUploadState();
      Alert.alert(
        "Courses added",
        `We matched ${courseCodes.length} course${courseCodes.length === 1 ? "" : "s"} from your schedule.`
      );
    } catch (error) {
      console.error("Error processing schedule upload:", error);
      Alert.alert(
        "Upload failed",
        "We couldn't add your courses right now. Please try again in a moment."
      );
      setProcessingUpload(false);
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

      <TouchableOpacity
        style={styles.uploadButton}
        onPress={() => setShowUploadModal(true)}
      >
        <IconSymbol name="tray.and.arrow.up" size={18} color="#000" />
        <Text style={styles.uploadButtonText}>Upload Now</Text>
      </TouchableOpacity>

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

      <Modal
        animationType="fade"
        transparent
        visible={showUploadModal}
        onRequestClose={() => {
          if (!processingUpload) {
            resetUploadState();
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Upload Schedule</Text>
            <Text style={styles.modalInstructions}>
              Paste your course schedule from Quest below. We&apos;ll match the course codes and add the classes for you.
            </Text>
            <TextInput
              style={styles.uploadTextInput}
              value={uploadText}
              onChangeText={setUploadText}
              placeholder="Paste your schedule text here..."
              multiline
              editable={!processingUpload}
            />
            {detectedCourses.length > 0 ? (
              <View style={styles.detectedCoursesContainer}>
                <Text style={styles.detectedCoursesTitle}>
                  Detected courses ({detectedCourses.length})
                </Text>
                <View style={styles.courseChipWrap}>
                  {detectedCourses.map((code) => {
                    const isSelected = selectedCourses.has(code);
                    return (
                      <TouchableOpacity
                        key={code}
                        style={[styles.courseChip, isSelected && styles.courseChipSelected]}
                        onPress={() => toggleSelectedCourse(code)}
                        disabled={processingUpload}
                      >
                        <Text
                          style={[styles.courseChipText, isSelected && styles.courseChipTextSelected]}
                        >
                          {code}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : (
              !!uploadText.trim() && (
                <Text style={styles.noCoursesFound}>No course codes detected yet.</Text>
              )
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={resetUploadState}
                disabled={processingUpload}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.joinButton, processingUpload && styles.disabledButton]}
                onPress={handleUploadCourses}
                disabled={processingUpload}
              >
                {processingUpload ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.joinButtonText}>Add Courses</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  uploadButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FDB515",
    marginHorizontal: 15,
    marginBottom: 15,
    paddingVertical: 12,
    borderRadius: 10,
  },
  uploadButtonText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "600",
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
  modalInstructions: {
    fontSize: 14,
    color: "#666",
    marginBottom: 20,
    textAlign: "center",
  },
  uploadTextInput: {
    minHeight: 160,
    maxHeight: 260,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: 16,
    textAlignVertical: "top",
    fontSize: 14,
    color: "#000",
    marginBottom: 20,
  },
  detectedCoursesContainer: {
    marginBottom: 20,
  },
  detectedCoursesTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    marginBottom: 10,
  },
  courseChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  courseChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "#e0e0e0",
  },
  courseChipSelected: {
    backgroundColor: "#FDB515",
  },
  courseChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#444",
  },
  courseChipTextSelected: {
    color: "#000",
  },
  noCoursesFound: {
    fontSize: 13,
    color: "#999",
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
  disabledButton: {
    opacity: 0.6,
  },
  preparingText: {
    fontSize: 16,
    color: "#666",
    marginTop: 15,
    textAlign: "center",
  },
});
