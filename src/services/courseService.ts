import { supabase } from "../lib/supabase";

export const courseService = {
  // Parse course codes from text (Quest schedule paste)
  parseCourses: (text: string): string[] => {
    const coursePattern = /[A-Z]{2,4}\s*\d{3}[A-Z]?/gi;
    const matches = text.match(coursePattern) || [];
    return [
      ...new Set(
        matches.map((c) => c.replace(/\s+/g, " ").toUpperCase().trim())
      ),
    ];
  },

  // Add courses for user
  addCourses: async (userId: string, courseCodes: string[]) => {
    // First, ensure courses exist in courses table
    const courseInserts = courseCodes.map((code) => ({
      course_code: code,
      term: "Winter 2025",
    }));

    const { data: courses, error: courseError } = await supabase
      .from("courses")
      .upsert(courseInserts, {
        onConflict: "course_code,term",
        ignoreDuplicates: true,
      })
      .select();

    if (courseError) throw courseError;

    // Create course chats if they don't exist
    if (courses) {
      const chatInserts = courses.map((course) => ({
        course_id: course.id,
      }));

      await supabase
        .from("course_chats")
        .upsert(chatInserts, { onConflict: "course_id", ignoreDuplicates: true });
    }

    // Then link to user
    if (courses) {
      const userCourseInserts = courses.map((course) => ({
        user_id: userId,
        course_id: course.id,
      }));

      const { error: linkError } = await supabase
        .from("user_courses")
        .upsert(userCourseInserts, {
          onConflict: "user_id,course_id",
          ignoreDuplicates: true,
        });

      if (linkError) throw linkError;
    }

    return courses;
  },

  // Get user's courses
  getUserCourses: async (userId: string) => {
    const { data, error } = await supabase
      .from("user_courses")
      .select("*, courses(*)")
      .eq("user_id", userId);

    if (error) throw error;
    return data;
  },

  // Remove course
  removeCourse: async (userCourseId: string) => {
    const { error } = await supabase
      .from("user_courses")
      .delete()
      .eq("id", userCourseId);

    if (error) throw error;
  },

  // Find matches using the database function
  findMatches: async (userId: string) => {
    const { data, error } = await supabase.rpc("get_course_matches", {
      target_user_id: userId,
    });

    if (error) throw error;
    return data;
  },
};
