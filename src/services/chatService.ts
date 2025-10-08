import { supabase } from "../lib/supabase";
import { RealtimeChannel, RealtimePostgresInsertPayload } from "@supabase/supabase-js";

export const chatService = {
  // Get course chat room
  getCourseChatRoom: async (courseId: string) => {
    const { data, error } = await supabase
      .from("course_chats")
      .select("*")
      .eq("course_id", courseId)
      .single();

    if (error) throw error;
    return data;
  },

  // Get messages for a course chat
  getCourseMessages: async (courseChatId: string, limit = 50) => {
    const { data, error } = await supabase
      .from("messages")
      .select("*, profiles(name, watiam_id)")
      .eq("course_chat_id", courseChatId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data.reverse(); // Show oldest first
  },

  // Send message to course chat
  sendCourseMessage: async (
    courseChatId: string,
    userId: string,
    content: string
  ) => {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        course_chat_id: courseChatId,
        user_id: userId,
        content,
      })
      .select("*, profiles(name, watiam_id)")
      .single();

    if (error) throw error;
    return data;
  },

  getMessageWithProfile: async (messageId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("*, profiles(name, watiam_id)")
      .eq("id", messageId)
      .single();

    if (error) throw error;
    return data;
  },

  // Subscribe to new messages in real-time
  subscribeToCourseMessages: (
    courseChatId: string,
    callback: (payload: RealtimePostgresInsertPayload<any>) => void | Promise<void>
  ): RealtimeChannel => {
    return supabase
      .channel(`course-chat-${courseChatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `course_chat_id=eq.${courseChatId}`,
        },
        callback
      )
      .subscribe();
  },

  // Direct messages
  getDirectMessages: async (userId: string, otherUserId: string) => {
    const { data, error } = await supabase
      .from("direct_messages")
      .select(
        "*, sender:profiles!sender_id(name), receiver:profiles!receiver_id(name)"
      )
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .or(`sender_id.eq.${otherUserId},receiver_id.eq.${otherUserId}`)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data;
  },

  sendDirectMessage: async (
    senderId: string,
    receiverId: string,
    content: string
  ) => {
    const { data, error } = await supabase
      .from("direct_messages")
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        content,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Subscribe to direct messages
  subscribeToDirectMessages: (
    userId: string,
    callback: (payload: any) => void
  ): RealtimeChannel => {
    return supabase
      .channel(`direct-messages-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `receiver_id=eq.${userId}`,
        },
        callback
      )
      .subscribe();
  },
};
