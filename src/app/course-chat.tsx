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
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { supabase } from "@/lib/supabase";
import { chatService } from "@/services/chatService";
import { RealtimeChannel, RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import Snackbar from "@/components/Snackbar";

interface Message {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
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
        newMessage.trim()
      );
      setNewMessage("");
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isOwnMessage = item.user_id === currentUserId;
    const senderName = item.profiles?.name || "Unknown";

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
          <Text
            style={[
              styles.messageText,
              isOwnMessage ? styles.ownMessageText : styles.otherMessageText,
            ]}
          >
            {item.content}
          </Text>
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
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          value={newMessage}
          onChangeText={setNewMessage}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!newMessage.trim() || sending) && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={!newMessage.trim() || sending}
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
