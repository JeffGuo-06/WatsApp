import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
  Linking,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { supabase } from "@/lib/supabase";
import { chatService } from "@/services/chatService";
import { RealtimeChannel, RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import Snackbar from "@/components/Snackbar";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

interface Message {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  profiles?: {
    name: string;
    watiam_id: string;
  };
}

export default function CourseChat() {
  const params = useLocalSearchParams();
  const { courseChatId, courseCode, courseTitle, courseId, showJoinPrompt } = params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(showJoinPrompt === "true");
  const [joining, setJoining] = useState(false);
  const [snackbar, setSnackbar] = useState({ visible: false, message: "", type: "success" as "success" | "error" | "info" });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const handleNewMessage = useCallback(
    async (payload: RealtimePostgresInsertPayload<Message>) => {
      const incoming = payload.new;

      setMessages((prev) => {
        if (prev.some((message) => message.id === incoming.id)) {
          return prev;
        }
        return [...prev, incoming];
      });

      // Scroll to bottom when new message arrives
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);

      if (!incoming.profiles?.name) {
        try {
          const enriched = await chatService.getMessageWithProfile(incoming.id);
          if (enriched) {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === incoming.id ? (enriched as Message) : message
              )
            );
          }
        } catch (error) {
          console.error("Error loading message sender:", error);
        }
      }
    },
    []
  );

  const initializeChat = useCallback(async () => {
    if (!courseChatId) {
      setLoading(false);
      return;
    }

    // ensure previous subscriptions are cleaned up before re-subscribing
    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }

    setLoading(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      setCurrentUserId(user.id);

      // Load initial messages (will be empty if user hasn't joined yet, but that's ok)
      try {
        const initialMessages = await chatService.getCourseMessages(courseChatId as string);
        setMessages(initialMessages);
      } catch {
        // If RLS blocks access (not enrolled), messages will be empty
        console.log("Cannot load messages yet (not enrolled)");
      }

      // Subscribe to new messages
      channelRef.current = chatService.subscribeToCourseMessages(
        courseChatId as string,
        handleNewMessage
      );
    } catch (error) {
      console.error("Error initializing chat:", error);
    } finally {
      setLoading(false);
    }
  }, [courseChatId, handleNewMessage]);

  useEffect(() => {
    initializeChat();

    return () => {
      // Cleanup subscription on unmount
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [initializeChat]);

  const handleConfirmJoin = async () => {
    if (!currentUserId || !courseId) return;

    setJoining(true);
    try {
      // Enroll user in the course
      const { error: enrollError } = await supabase
        .from("user_courses")
        .insert({
          user_id: currentUserId,
          course_id: courseId as string,
        });

      // Ignore duplicate enrollment errors
      if (enrollError && !enrollError.message.includes("duplicate")) {
        throw enrollError;
      }

      setShowModal(false);

      // Reload messages now that user is enrolled
      const initialMessages = await chatService.getCourseMessages(courseChatId as string);
      setMessages(initialMessages);

      // Show success snackbar
      setSnackbar({ visible: true, message: `Joined ${courseCode}!`, type: "success" });
    } catch (error) {
      console.error("Error joining course:", error);
      setSnackbar({ visible: true, message: "Failed to join course", type: "error" });
    } finally {
      setJoining(false);
    }
  };

  const handleCancelJoin = () => {
    setShowModal(false);
    router.back();
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !currentUserId || sending) return;

    setSending(true);
    try {
      await chatService.sendCourseMessage(
        courseChatId as string,
        currentUserId,
        { content: newMessage.trim() }
      );
      setNewMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setSending(false);
    }
  };

  const handleOpenAttachment = (url: string) => {
    Linking.openURL(url).catch((error) => {
      console.error("Error opening attachment:", error);
      Alert.alert("Unable to open", "We couldn't open that attachment. Try downloading it from a browser instead.");
    });
  };

  const uploadAndSendAttachment = async (params: {
    uri: string;
    mimeType?: string | null;
    name?: string | null;
  }) => {
    if (!currentUserId || !courseChatId) {
      Alert.alert("Not ready", "We couldn't prepare the upload yet. Please try again.");
      return;
    }

    setUploadingAttachment(true);
    try {
      const uploaded = await chatService.uploadChatAttachment({
        userId: currentUserId,
        courseChatId: courseChatId as string,
        uri: params.uri,
        mimeType: params.mimeType,
        name: params.name,
      });

      await chatService.sendCourseMessage(courseChatId as string, currentUserId, {
        content: "",
        attachmentUrl: uploaded.publicUrl,
        attachmentType: uploaded.contentType,
        attachmentName: uploaded.fileName,
        attachmentSize: uploaded.size,
      });
    } catch (error) {
      console.error("Error uploading attachment:", error);
      Alert.alert("Upload failed", "We couldn't upload that file. Please try again.");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleAttachmentPress = async () => {
    if (uploadingAttachment || sending) return;

    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.type === "cancel") {
      return;
    }

    const asset = result.assets?.[0] ?? (result as unknown as { uri?: string; mimeType?: string | null; name?: string | null });

    if (!asset || !asset.uri) {
      Alert.alert("Selection failed", "We couldn't read that file. Please try again.");
      return;
    }

    const inferredMime = asset.mimeType || (asset.name?.toLowerCase().endsWith(".pdf") ? "application/pdf" : undefined);
    const mimeType = inferredMime || (asset.name?.match(/\.png$/i) ? "image/png" : "image/jpeg");
    const name = asset.name || asset.uri.split("/").pop() || (mimeType === "application/pdf" ? "document.pdf" : "image.png");

    if (mimeType !== "application/pdf" && !mimeType.startsWith("image/")) {
      Alert.alert("Unsupported file", "Please choose a PNG image or a PDF document.");
      return;
    }

    await uploadAndSendAttachment({
      uri: asset.uri,
      mimeType,
      name,
    });
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || Number.isNaN(bytes)) return null;
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isOwnMessage = item.user_id === currentUserId;
    const senderName = item.profiles?.name || "Unknown";
    const hasAttachment = Boolean(item.attachment_url);
    const hasText = Boolean(item.content?.trim().length);

    return (
      <View
        style={[
          styles.messageContainer,
          isOwnMessage ? styles.ownMessage : styles.otherMessage,
        ]}
      >
        {!isOwnMessage && (
          <Text style={styles.senderName}>{senderName}</Text>
        )}
        <View
          style={[
            styles.messageBubble,
            isOwnMessage ? styles.ownBubble : styles.otherBubble,
          ]}
        >
          {hasAttachment && item.attachment_url ? (
            item.attachment_type?.startsWith("image/") ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => handleOpenAttachment(item.attachment_url!)}
              >
                <Image
                  source={{ uri: item.attachment_url }}
                  style={[
                    styles.attachmentImage,
                    hasText ? styles.attachmentImageWithText : null,
                  ]}
                  contentFit="cover"
                />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.attachmentFile,
                  hasText ? styles.attachmentFileWithText : null,
                ]}
                onPress={() => handleOpenAttachment(item.attachment_url!)}
              >
                <IconSymbol name="doc.richtext" size={22} color="#000" />
                <View style={styles.attachmentMeta}>
                  <Text style={styles.attachmentName} numberOfLines={1}>
                    {item.attachment_name || "Attachment"}
                  </Text>
                  {item.attachment_size ? (
                    <Text style={styles.attachmentSize}>
                      {formatFileSize(item.attachment_size)}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            )
          ) : null}

          {hasText ? (
            <Text
              style={[
                styles.messageText,
                isOwnMessage ? styles.ownMessageText : styles.otherMessageText,
              ]}
            >
              {item.content}
            </Text>
          ) : null}
        </View>
        <Text style={styles.timestamp}>
          {new Date(item.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      </View>
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <IconSymbol name="chevron.left" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.courseCode}>{courseCode}</Text>
          <Text style={styles.courseTitle}>{courseTitle}</Text>
        </View>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() =>
            router.push({
              pathname: "/course-details",
              params: {
                courseId: courseId as string,
                courseCode: courseCode as string,
                courseTitle: courseTitle as string,
                courseChatId: courseChatId as string,
              },
            })
          }
        >
          <IconSymbol name="ellipsis.circle" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySubtext}>Be the first to send a message!</Text>
          </View>
        }
      />

      <Modal
        visible={showModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCancelJoin}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Join this course?</Text>

            <View style={styles.coursePreview}>
              <Text style={styles.modalCourseCode}>{courseCode}</Text>
              <Text style={styles.modalCourseTitle}>{courseTitle}</Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={handleCancelJoin}
                disabled={joining}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.joinButton]}
                onPress={handleConfirmJoin}
                disabled={joining}
              >
                {joining ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.joinButtonText}>Join Chat</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.inputContainer}>
        <View style={styles.inputActions}>
          <TouchableOpacity
            style={[
              styles.attachmentButton,
              (uploadingAttachment || sending) && styles.attachmentButtonDisabled,
            ]}
            onPress={handleAttachmentPress}
            disabled={uploadingAttachment || sending}
          >
            {uploadingAttachment ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <IconSymbol name="paperclip" size={20} color="#000" />
            )}
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          value={newMessage}
          onChangeText={setNewMessage}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!newMessage.trim() || sending || uploadingAttachment) && styles.sendButtonDisabled,
          ]}
          onPress={sendMessage}
          disabled={!newMessage.trim() || sending || uploadingAttachment}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <IconSymbol name="paperplane.fill" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      <Snackbar
        visible={snackbar.visible}
        message={snackbar.message}
        type={snackbar.type}
        onDismiss={() => setSnackbar({ ...snackbar, visible: false })}
      />
    </KeyboardAvoidingView>
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
  menuButton: {
    marginLeft: 10,
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
  messagesList: {
    padding: 15,
    flexGrow: 1,
  },
  messageContainer: {
    marginBottom: 15,
    maxWidth: "80%",
  },
  ownMessage: {
    alignSelf: "flex-end",
  },
  otherMessage: {
    alignSelf: "flex-start",
  },
  senderName: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
    marginLeft: 10,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 16,
  },
  ownBubble: {
    backgroundColor: "#FDB515",
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: "#fff",
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
  },
  ownMessageText: {
    color: "#000",
  },
  otherMessageText: {
    color: "#000",
  },
  timestamp: {
    fontSize: 11,
    color: "#999",
    marginTop: 4,
    marginHorizontal: 10,
  },
  attachmentImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: "#ccc",
  },
  attachmentImageWithText: {
    marginBottom: 10,
  },
  attachmentFile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  attachmentFileWithText: {
    marginBottom: 10,
  },
  attachmentMeta: {
    flex: 1,
  },
  attachmentName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
  },
  attachmentSize: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#999",
  },
  inputContainer: {
    flexDirection: "row",
    padding: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    alignItems: "flex-end",
  },
  inputActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginRight: 10,
  },
  input: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    backgroundColor: "#FDB515",
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: {
    backgroundColor: "#ccc",
  },
  attachmentButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ddd",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  attachmentButtonDisabled: {
    opacity: 0.5,
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
});
