import { supabase } from "../lib/supabase";
import { RealtimeChannel, RealtimePostgresInsertPayload } from "@supabase/supabase-js";

const ATTACHMENT_BUCKET = "chat-attachments";

type CourseMessagePayload = {
  content?: string;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  replyToMessageId?: string | null;
};

type UploadAttachmentOptions = {
  userId: string;
  courseChatId: string;
  uri: string;
  mimeType?: string | null;
  name?: string | null;
};

type UploadedAttachment = {
  publicUrl: string;
  path: string;
  fileName: string;
  contentType: string;
  size: number;
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

const getExtension = (mimeType?: string | null, originalName?: string | null) => {
  if (originalName && originalName.includes(".")) {
    return originalName.split(".").pop()?.toLowerCase() || "bin";
  }

  if (mimeType && MIME_EXTENSION_MAP[mimeType]) {
    return MIME_EXTENSION_MAP[mimeType];
  }

  return "bin";
};

const generateFileName = (extension: string) => {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "") || "bin";
  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${uniquePart}.${safeExtension}`;
};

const fetchFileAsBase64 = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error("Failed to read file for upload");
  }

  // Convert to base64 for React Native compatibility
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove the data URL prefix (e.g., "data:image/png;base64,")
      const base64Data = base64.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

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
      .select(
        "*, profiles(name, watiam_id, avatar_url), reply_to:reply_to_message_id(id, content, user_id, attachment_url, profiles(name, avatar_url))"
      )
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
    payload: CourseMessagePayload
  ) => {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        course_chat_id: courseChatId,
        user_id: userId,
        content: payload.content ?? "",
        attachment_url: payload.attachmentUrl ?? null,
        attachment_type: payload.attachmentType ?? null,
        attachment_name: payload.attachmentName ?? null,
        attachment_size: payload.attachmentSize ?? null,
        reply_to_message_id: payload.replyToMessageId ?? null,
      })
      .select(
        "*, profiles(name, watiam_id, avatar_url), reply_to:reply_to_message_id(id, content, user_id, attachment_url, profiles(name, avatar_url))"
      )
      .single();

    if (error) throw error;
    return data;
  },

  uploadChatAttachment: async (
    options: UploadAttachmentOptions
  ): Promise<UploadedAttachment> => {
    const base64Data = await fetchFileAsBase64(options.uri);
    const extension = getExtension(options.mimeType, options.name);
    const fileName = generateFileName(extension);
    const filePath = `${options.courseChatId}/${options.userId}/${fileName}`;
    const contentType = options.mimeType || "application/octet-stream";

    // Convert base64 to arraybuffer for upload
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(filePath, bytes, {
        upsert: false,
        contentType,
        cacheControl: "3600",
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from(ATTACHMENT_BUCKET)
      .getPublicUrl(filePath, {
        download: false,
      });

    if (!data?.publicUrl) {
      throw new Error("Failed to generate attachment URL");
    }

    return {
      publicUrl: data.publicUrl,
      path: filePath,
      fileName: options.name || fileName,
      contentType,
      size: bytes.length,
    };
  },

  getMessageWithProfile: async (messageId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select(
        "*, profiles(name, watiam_id, avatar_url), reply_to:reply_to_message_id(id, content, user_id, attachment_url, profiles(name, avatar_url))"
      )
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
