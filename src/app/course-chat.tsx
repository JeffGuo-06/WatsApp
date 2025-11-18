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
  Pressable,
  Keyboard,
  Animated,
  SafeAreaView,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { supabase } from "@/lib/supabase";
import { chatService } from "@/services/chatService";
import { RealtimeChannel, RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import Snackbar from "@/components/Snackbar";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { chatReadStorage } from "@/utils/chatReadStorage";
import { useIsFocused } from "@react-navigation/native";
import { notificationService } from "@/services/notificationService";
import { useAuth } from "@/context/AuthContext";

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
    avatar_url?: string | null;
    program?: string | null;
    year?: string | null;
    instagram?: string | null;
    email?: string | null;
  };
  reply_to_message_id?: string | null;
  reply_to?: {
    id: string;
    content: string | null;
    user_id: string;
    attachment_url?: string | null;
    profiles?: {
      name: string;
      avatar_url?: string | null;
    } | null;
  } | null;
}

interface PendingAttachment {
  id: string;
  uri: string;
  mimeType: string;
  name: string;
  type: "image" | "file";
}

const getInitials = (name?: string) => {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || name.charAt(0).toUpperCase() || "?";
};

const normalizeInstagramLink = (value?: string | null) => {
  if (!value) return null;
  if (value.startsWith("http")) return value;
  const handle = value.replace(/^@/, "");
  return `https://instagram.com/${handle}`;
};

const formatInstagramHandle = (value?: string | null) => {
  if (!value) return null;
  if (value.startsWith("@")) return value;
  if (value.startsWith("http")) {
    try {
      const url = new URL(value);
      const [segment] = url.pathname.replace(/^\/+/, "").split("/");
      return segment ? `@${segment}` : value;
    } catch {
      return value;
    }
  }
  return `@${value.replace(/^@/, "")}`;
};

export default function CourseChat() {
  const params = useLocalSearchParams();
  const { courseChatId, courseCode, courseTitle, courseId, showJoinPrompt } = params;
  const normalizedCourseChatId =
    typeof courseChatId === "string"
      ? courseChatId
      : Array.isArray(courseChatId)
        ? courseChatId[0]
        : undefined;
  const isFocused = useIsFocused();
  const { user } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [showModal, setShowModal] = useState(showJoinPrompt === "true");
  const [joining, setJoining] = useState(false);
  const [snackbar, setSnackbar] = useState({ visible: false, message: "", type: "success" as "success" | "error" | "info" });
  const [selectedMember, setSelectedMember] = useState<Message | null>(null);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const allowNewlineRef = useRef(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

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

      const needsEnrichment =
        !incoming.profiles?.name ||
        (incoming as any).reply_to_message_id;

      if (needsEnrichment) {
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
    if (!normalizedCourseChatId) {
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
        const initialMessages = await chatService.getCourseMessages(normalizedCourseChatId);
        setMessages(initialMessages);
      } catch {
        // If RLS blocks access (not enrolled), messages will be empty
        console.log("Cannot load messages yet (not enrolled)");
      }

      // Subscribe to new messages
      channelRef.current = chatService.subscribeToCourseMessages(
        normalizedCourseChatId,
        handleNewMessage
      );
    } catch (error) {
      console.error("Error initializing chat:", error);
    } finally {
      setLoading(false);
    }
  }, [normalizedCourseChatId, handleNewMessage]);

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

  // Load mute status
  useEffect(() => {
    const loadMuteStatus = async () => {
      if (!user || !normalizedCourseChatId) return;

      try {
        const muted = await notificationService.isCourseMuted(user.id, normalizedCourseChatId);
        setIsMuted(muted);
      } catch (error) {
        console.error('Error loading mute status:', error);
      }
    };

    loadMuteStatus();
  }, [user, normalizedCourseChatId]);

  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setIsKeyboardVisible(true)
    );
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setIsKeyboardVisible(false)
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, []);

  useEffect(() => {
    if (showAttachmentMenu) {
      setIsAnimating(true);
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 120,
        friction: 12,
      }).start();
    } else if (isAnimating) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setIsAnimating(false);
      });
    }
  }, [showAttachmentMenu, slideAnim, isAnimating]);

  useEffect(() => {
    if (!isFocused || !normalizedCourseChatId) {
      return;
    }

    const updateLastRead = async () => {
      const latestTimestamp =
        messages.length > 0
          ? messages[messages.length - 1].created_at
          : new Date().toISOString();
      await chatReadStorage.setLastReadAt(normalizedCourseChatId, latestTimestamp);
    };

    updateLastRead();
  }, [isFocused, normalizedCourseChatId, messages]);

  const handleConfirmJoin = async () => {
    if (!currentUserId || !courseId || !normalizedCourseChatId) return;

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
      const initialMessages = await chatService.getCourseMessages(normalizedCourseChatId);
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

  const handleToggleMute = async () => {
    if (!user || !normalizedCourseChatId) return;

    try {
      const newMutedState = !isMuted;
      setIsMuted(newMutedState);
      await notificationService.setCourseMuted(user.id, normalizedCourseChatId, newMutedState);

      setSnackbar({
        visible: true,
        message: newMutedState ? 'Notifications muted' : 'Notifications enabled',
        type: 'success'
      });
    } catch (error) {
      console.error('Error toggling mute:', error);
      // Revert on error
      setIsMuted(!isMuted);
      setSnackbar({ visible: true, message: 'Failed to update notification settings', type: 'error' });
    }
  };

  const sendMessage = async (overrideContent?: string | null) => {
    const base = typeof overrideContent === "string" ? overrideContent : newMessage;
    const messageText = base.trim();
    const hasAttachments = pendingAttachments.length > 0;

    if (!messageText && !hasAttachments) return;
    if (!currentUserId || sending || !normalizedCourseChatId) return;

    setSending(true);
    try {
      // If there are attachments, upload and send each one
      if (hasAttachments) {
        for (const attachment of pendingAttachments) {
          const uploaded = await chatService.uploadChatAttachment({
            userId: currentUserId,
            courseChatId: normalizedCourseChatId,
            uri: attachment.uri,
            mimeType: attachment.mimeType,
            name: attachment.name,
          });

          await chatService.sendCourseMessage(normalizedCourseChatId, currentUserId, {
            content: "", // Send attachments separately
            attachmentUrl: uploaded.publicUrl,
            attachmentType: uploaded.contentType,
            attachmentName: uploaded.fileName,
            attachmentSize: uploaded.size,
            replyToMessageId: replyTarget?.id ?? null,
          });
        }
        setPendingAttachments([]);
      }

      // Send text message if there's any text
      if (messageText) {
        await chatService.sendCourseMessage(normalizedCourseChatId, currentUserId, {
          content: messageText,
          replyToMessageId: replyTarget?.id ?? null,
        });
      }

      setNewMessage("");
      cancelReply();
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Failed to send", "We couldn't send your message. Please try again.");
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
    if (!currentUserId || !normalizedCourseChatId) {
      Alert.alert("Not ready", "We couldn't prepare the upload yet. Please try again.");
      return;
    }

    setUploadingAttachment(true);
    try {
      const uploaded = await chatService.uploadChatAttachment({
        userId: currentUserId,
        courseChatId: normalizedCourseChatId,
        uri: params.uri,
        mimeType: params.mimeType,
        name: params.name,
      });

      await chatService.sendCourseMessage(normalizedCourseChatId, currentUserId, {
        content: "",
        attachmentUrl: uploaded.publicUrl,
        attachmentType: uploaded.contentType,
        attachmentName: uploaded.fileName,
        attachmentSize: uploaded.size,
        replyToMessageId: replyTarget?.id ?? null,
      });
      cancelReply();
    } catch (error) {
      console.error("Error uploading attachment:", error);
      Alert.alert("Upload failed", "We couldn't upload that file. Please try again.");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handlePickFromFiles = async () => {
    setShowAttachmentMenu(false);

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

    // Add to pending attachments queue
    const newAttachment: PendingAttachment = {
      id: `${Date.now()}-${Math.random()}`,
      uri: asset.uri,
      mimeType,
      name,
      type: mimeType.startsWith("image/") ? "image" : "file",
    };
    setPendingAttachments((prev) => [...prev, newAttachment]);
  };

  const handlePickFromPhotos = async () => {
    setShowAttachmentMenu(false);

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissionResult.granted) {
      Alert.alert("Permission required", "We need permission to access your photos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    if (!asset || !asset.uri) {
      Alert.alert("Selection failed", "We couldn't read that photo. Please try again.");
      return;
    }

    const mimeType = asset.mimeType || asset.uri.match(/\.png$/i) ? "image/png" : "image/jpeg";
    const name = asset.fileName || asset.uri.split("/").pop() || "image.jpg";

    // Add to pending attachments queue
    const newAttachment: PendingAttachment = {
      id: `${Date.now()}-${Math.random()}`,
      uri: asset.uri,
      mimeType,
      name,
      type: "image",
    };
    setPendingAttachments((prev) => [...prev, newAttachment]);
  };

  const handleAttachmentPress = () => {
    if (uploadingAttachment || sending) return;

    // On desktop/web, go straight to file picker
    if (Platform.OS === "web" || Platform.OS === "macos" || Platform.OS === "windows") {
      handlePickFromFiles();
      return;
    }

    // On mobile, show the menu
    setShowAttachmentMenu(true);
  };

  const removeAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || Number.isNaN(bytes)) return null;
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const closeProfileModal = () => {
    setProfileModalVisible(false);
    setSelectedMember(null);
  };

  const cancelReply = () => {
    setReplyTarget(null);
  };

  const summarizeMessage = (
    message: { content?: string | null; attachment_url?: string | null } | null
  ) => {
    if (!message) return "";
    const text = message.content?.trim();
    if (text) return text;
    if (message.attachment_url) return "Attachment";
    return "Message";
  };

  const scrollToMessage = (messageId: string | null) => {
    if (!messageId) return;
    const index = messages.findIndex((msg) => msg.id === messageId);
    if (index === -1) return;
    try {
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    } catch (error) {
      console.warn("Unable to scroll to message", error);
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  };

  const handleChangeText = (text: string) => {
    if (text.endsWith("\n")) {
      if (allowNewlineRef.current) {
        allowNewlineRef.current = false;
        setNewMessage(text);
        return;
      }

      const sanitized = text.replace(/[\r\n]+$/, "");
      setNewMessage(sanitized);
      if (sanitized.trim().length > 0) {
        sendMessage(sanitized);
      }
      return;
    }
    setNewMessage(text);
  };

  const handleKeyPress = (event: { nativeEvent: { key?: string; shiftKey?: boolean } }) => {
    if (event.nativeEvent.key === "Enter" && event.nativeEvent.shiftKey) {
      allowNewlineRef.current = true;
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isOwnMessage = item.user_id === currentUserId;
    const senderName = item.profiles?.name || "Unknown";
    const hasAttachment = Boolean(item.attachment_url);
    const hasText = Boolean(item.content?.trim().length);
    const avatarUrl = item.profiles?.avatar_url || null;
    const avatarSource = avatarUrl ? { uri: avatarUrl } : null;
    const avatarInitials = getInitials(senderName);
    const previousMessage = index > 0 ? messages[index - 1] : null;
    const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;

    const withinGroupWindow = 5 * 60 * 1000; // 5 minutes
    const previousSameSender =
      previousMessage?.user_id === item.user_id &&
      Math.abs(new Date(item.created_at).getTime() - new Date(previousMessage.created_at).getTime()) <=
        withinGroupWindow;
    const nextSameSender =
      nextMessage?.user_id === item.user_id &&
      Math.abs(new Date(nextMessage.created_at).getTime() - new Date(item.created_at).getTime()) <=
        withinGroupWindow;
    const isFirstInGroup = !previousSameSender;
    const isLastInGroup = !nextSameSender;

    return (
      <View
        style={[
          styles.messageRow,
          isOwnMessage ? styles.ownRow : styles.otherRow,
          !isFirstInGroup && styles.messageRowGrouped,
          !isLastInGroup && styles.messageRowConnected,
        ]}
      >
        {!isOwnMessage && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              setSelectedMember(item);
              setProfileModalVisible(true);
            }}
          >
            <View
              style={[
                styles.avatarContainer,
                previousSameSender && styles.avatarHidden,
              ]}
            >
              {avatarSource ? (
                <Image
                  source={avatarSource}
                  style={styles.avatarImage}
                  contentFit="cover"
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>{avatarInitials}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}
        <View
          style={[
            styles.messageColumn,
            isOwnMessage ? styles.messageColumnOwn : styles.messageColumnOther,
          ]}
        >
          {!isOwnMessage && !previousSameSender && (
            <Text style={styles.senderName}>{senderName}</Text>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.messagePressable,
              pressed && styles.messagePressed,
            ]}
            delayLongPress={250}
            onLongPress={() => setReplyTarget(item)}
          >
            <View
              style={[
                styles.messageBubble,
                isOwnMessage ? styles.ownBubble : styles.otherBubble,
                isOwnMessage && isFirstInGroup && styles.ownFirstBubble,
                isOwnMessage && !isFirstInGroup && styles.ownMidBubble,
                isOwnMessage && isLastInGroup && styles.ownLastBubble,
                !isOwnMessage && isFirstInGroup && styles.otherFirstBubble,
                !isOwnMessage && !isFirstInGroup && styles.otherMidBubble,
                !isOwnMessage && isLastInGroup && styles.otherLastBubble,
                replyTarget?.id === item.id && styles.messageBubbleActive,
              ]}
            >
              {item.reply_to ? (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => scrollToMessage(item.reply_to?.id ?? null)}
                  style={[
                    styles.replySnippet,
                    isOwnMessage
                      ? styles.replySnippetOwn
                      : styles.replySnippetOther,
                  ]}
                >
                  <Text
                    style={[
                      styles.replySnippetAuthor,
                      isOwnMessage && styles.replySnippetAuthorOwn,
                    ]}
                    numberOfLines={1}
                  >
                    {item.reply_to?.profiles?.name || "Unknown"}
                  </Text>
                  <Text
                    style={[
                      styles.replySnippetMessage,
                      isOwnMessage && styles.replySnippetMessageOwn,
                    ]}
                    numberOfLines={2}
                  >
                    {summarizeMessage(item.reply_to)}
                  </Text>
                </TouchableOpacity>
              ) : null}
            {hasAttachment && item.attachment_url ? (
              item.attachment_type?.startsWith("image/") ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setImagePreviewUrl(item.attachment_url!)}
                >
                  <Image
                    source={{ uri: item.attachment_url }}
                    style={[
                      styles.attachmentImage,
                      hasText ? styles.attachmentImageWithText : null,
                    ]}
                    contentFit="cover"
                    transition={200}
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
                  <IconSymbol name="doc.richtext" size={28} color="#3B82F6" />
                  <Text style={styles.attachmentName} numberOfLines={1}>
                    {item.attachment_name || "Attachment"}
                  </Text>
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
          </Pressable>
          <Text
            style={[
              styles.timestamp,
              isOwnMessage ? styles.ownTimestamp : styles.otherTimestamp,
              !isLastInGroup && styles.timestampHidden,
            ]}
          >
            {new Date(item.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
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
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
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
          style={styles.muteButton}
          onPress={handleToggleMute}
        >
          <Ionicons
            name={isMuted ? 'notifications-off' : 'notifications'}
            size={24}
            color="#000"
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => {
            if (!normalizedCourseChatId) return;
            router.push({
              pathname: "/course-details",
              params: {
                courseId: courseId as string,
                courseCode: courseCode as string,
                courseTitle: courseTitle as string,
                courseChatId: normalizedCourseChatId,
              },
            });
          }}
        >
          <IconSymbol name="ellipsis.circle" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        extraData={replyTarget?.id}
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

      {replyTarget && (
        <View style={styles.replyPreview}>
          <View style={styles.replyPreviewIndicator} />
          <View style={styles.replyPreviewText}>
            <Text style={styles.replyPreviewLabel} numberOfLines={1}>
              Replying to {replyTarget.profiles?.name || "Unknown"}
            </Text>
            <Text style={styles.replyPreviewMessage} numberOfLines={1}>
              {summarizeMessage(replyTarget)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={cancelReply}
            style={styles.replyPreviewClose}
            accessibilityLabel="Cancel reply"
          >
            <IconSymbol name="xmark.circle.fill" size={22} color="#64748B" />
          </TouchableOpacity>
        </View>
      )}

      {pendingAttachments.length > 0 && (
        <View style={styles.attachmentPreviewContainer}>
          <FlatList
            data={pendingAttachments}
            horizontal
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.attachmentPreviewList}
            renderItem={({ item }) => (
              <View style={styles.attachmentPreviewItem}>
                {item.type === "image" ? (
                  <Image
                    source={{ uri: item.uri }}
                    style={styles.attachmentPreviewImage}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.attachmentPreviewFile}>
                    <Ionicons name="document-text" size={32} color="#3B82F6" />
                  </View>
                )}
                <TouchableOpacity
                  style={styles.attachmentPreviewRemove}
                  onPress={() => removeAttachment(item.id)}
                >
                  <Ionicons name="close-circle" size={24} color="#EF4444" />
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      )}

      <View style={[
        styles.inputContainer,
        !isKeyboardVisible && styles.inputContainerWithPadding,
      ]}>
        <View style={styles.inputActions}>
          <View style={styles.attachmentButtonWrapper}>
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
            {(showAttachmentMenu || isAnimating) && (
              <>
                <Pressable
                  style={styles.attachmentMenuBackdrop}
                  onPress={() => setShowAttachmentMenu(false)}
                />
                <Animated.View
                  style={[
                    styles.attachmentMenuPopup,
                    {
                      transform: [
                        {
                          translateX: slideAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-150, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <TouchableOpacity
                    style={styles.attachmentMenuOption}
                    activeOpacity={0.7}
                    onPress={handlePickFromPhotos}
                  >
                    <View style={styles.attachmentMenuIconContainer}>
                      <Ionicons name="images" size={22} color="#FDB515" />
                    </View>
                    <Text style={styles.attachmentMenuOptionTitle}>Photos</Text>
                  </TouchableOpacity>

                  <View style={styles.attachmentMenuDivider} />

                  <TouchableOpacity
                    style={styles.attachmentMenuOption}
                    activeOpacity={0.7}
                    onPress={handlePickFromFiles}
                  >
                    <View style={styles.attachmentMenuIconContainer}>
                      <Ionicons name="document-text" size={22} color="#3B82F6" />
                    </View>
                    <Text style={styles.attachmentMenuOptionTitle}>Files</Text>
                  </TouchableOpacity>
                </Animated.View>
              </>
            )}
          </View>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          value={newMessage}
          onChangeText={handleChangeText}
          onKeyPress={handleKeyPress}
          onSubmitEditing={() => sendMessage(null)}
          multiline
          maxLength={1000}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            ((!newMessage.trim() && pendingAttachments.length === 0) || sending || uploadingAttachment) && styles.sendButtonDisabled,
          ]}
          onPress={() => sendMessage(null)}
          disabled={(!newMessage.trim() && pendingAttachments.length === 0) || sending || uploadingAttachment}
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
      <Modal
        visible={profileModalVisible && !!selectedMember}
        transparent
        animationType="fade"
        onRequestClose={closeProfileModal}
      >
        <TouchableOpacity
          style={styles.profileModalOverlay}
          activeOpacity={1}
          onPress={closeProfileModal}
        >
          <TouchableOpacity
            style={styles.profileModalContent}
            activeOpacity={1}
            onPress={(event) => event.stopPropagation()}
          >
            <TouchableOpacity
              style={styles.profileModalClose}
              onPress={closeProfileModal}
            >
              <IconSymbol name="xmark.circle.fill" size={24} color="#64748B" />
            </TouchableOpacity>
            <View style={styles.profileModalHeader}>
              <View style={styles.profileModalAvatarWrapper}>
                {selectedMember?.profiles?.avatar_url ? (
                  <Image
                    source={{ uri: selectedMember.profiles.avatar_url }}
                    style={styles.profileModalAvatar}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.profileModalAvatarFallback}>
                    <Text style={styles.profileModalInitials}>
                      {getInitials(selectedMember?.profiles?.name)}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.profileModalName}>{selectedMember?.profiles?.name}</Text>
              <Text style={styles.profileModalHandle}>
                @{selectedMember?.profiles?.watiam_id}
              </Text>
            </View>
            <View style={styles.profileModalDetails}>
              {selectedMember?.profiles?.email ? (
                <View style={styles.profileModalRow}>
                  <Text style={styles.profileModalLabel}>Email</Text>
                  <Text style={styles.profileModalValue}>
                    {selectedMember.profiles.email}
                  </Text>
                </View>
              ) : null}
              {selectedMember?.profiles?.program ? (
                <View style={styles.profileModalRow}>
                  <Text style={styles.profileModalLabel}>Program</Text>
                  <Text style={styles.profileModalValue}>
                    {selectedMember.profiles.program}
                  </Text>
                </View>
              ) : null}
              {selectedMember?.profiles?.year ? (
                <View style={styles.profileModalRow}>
                  <Text style={styles.profileModalLabel}>Year</Text>
                  <Text style={styles.profileModalValue}>
                    {selectedMember.profiles.year}
                  </Text>
                </View>
              ) : null}
              {selectedMember?.profiles?.instagram ? (
                <View style={styles.profileConnectionGroup}>
                  <Text style={styles.profileModalLabel}>Instagram</Text>
                  <TouchableOpacity
                    style={styles.profileConnectionCard}
                    activeOpacity={0.85}
                    onPress={() => {
                      const url = normalizeInstagramLink(selectedMember.profiles?.instagram);
                      if (url) {
                        Linking.openURL(url).catch(() =>
                          setSnackbar({
                            visible: true,
                            message: "Could not open Instagram",
                            type: "error",
                          })
                        );
                      }
                    }}
                  >
                    <View style={styles.profileConnectionIconWrapper}>
                      <Ionicons name="logo-instagram" size={28} color="#FFFFFF" />
                    </View>
                    <View style={styles.profileConnectionInfo}>
                      <Text style={styles.profileConnectionHandle}>
                        {formatInstagramHandle(selectedMember.profiles.instagram)}
                      </Text>
                      <Text style={styles.profileConnectionSubtitle}>Instagram</Text>
                    </View>
                    <IconSymbol name="arrow.up.right" size={18} color="#BFDBFE" />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!imagePreviewUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setImagePreviewUrl(null)}
      >
        <Pressable
          style={styles.imagePreviewModal}
          onPress={() => setImagePreviewUrl(null)}
        >
          <SafeAreaView style={styles.imagePreviewModalContent}>
            <TouchableOpacity
              style={styles.imagePreviewClose}
              onPress={() => setImagePreviewUrl(null)}
            >
              <Ionicons name="close" size={32} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={styles.imagePreviewImageWrapper}>
              <Image
                source={{ uri: imagePreviewUrl || "" }}
                style={styles.imagePreviewImage}
                contentFit="contain"
              />
            </View>
          </SafeAreaView>
        </Pressable>
      </Modal>
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
  muteButton: {
    marginLeft: 10,
    padding: 4,
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
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  messageRowGrouped: {
    marginTop: -4,
  },
  messageRowConnected: {
    marginBottom: 6,
  },
  ownRow: {
    justifyContent: "flex-end",
  },
  otherRow: {
    justifyContent: "flex-start",
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    marginRight: 12,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarHidden: {
    opacity: 0,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    flex: 1,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1F2937",
  },
  avatarInitials: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  senderName: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  messageColumn: {
    flexShrink: 1,
    maxWidth: "80%",
    gap: 4,
  },
  messageColumnOwn: {
    alignItems: "flex-end",
    alignSelf: "flex-end",
  },
  messageColumnOther: {
    alignItems: "flex-start",
  },
  messagePressable: {
    width: "100%",
    borderRadius: 18,
  },
  messagePressed: {
    opacity: 0.92,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 16,
  },
  ownBubble: {
    backgroundColor: "#FDB515",
  },
  otherBubble: {
    backgroundColor: "#fff",
  },
  ownFirstBubble: {
    borderTopRightRadius: 16,
    borderBottomRightRadius: 6,
  },
  ownMidBubble: {
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  ownLastBubble: {
    borderBottomRightRadius: 16,
  },
  otherFirstBubble: {
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 6,
  },
  otherMidBubble: {
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  otherLastBubble: {
    borderBottomLeftRadius: 16,
  },
  messageBubbleActive: {
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.45)",
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
  replySnippet: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    borderRadius: 10,
    marginBottom: 8,
    gap: 2,
  },
  replySnippetOwn: {
    borderLeftColor: "rgba(255, 255, 255, 0.7)",
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  replySnippetOther: {
    borderLeftColor: "#93C5FD",
    backgroundColor: "rgba(59, 130, 246, 0.08)",
  },
  replySnippetAuthor: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1F2937",
  },
  replySnippetAuthorOwn: {
    color: "#0F172A",
  },
  replySnippetMessage: {
    fontSize: 13,
    color: "#4B5563",
  },
  replySnippetMessageOwn: {
    color: "#1F2937",
  },
  timestamp: {
    fontSize: 11,
    color: "#999",
    marginTop: 6,
  },
  timestampHidden: {
    opacity: 0,
    height: 0,
  },
  ownTimestamp: {
    alignSelf: "flex-end",
  },
  otherTimestamp: {
    alignSelf: "flex-start",
  },
  attachmentImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: "#ccc",
    borderWidth: 0.5,
    borderColor: "#FDB515",
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
    color: "#1E40AF",
    flexShrink: 1,
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
    paddingTop: 10,
    paddingHorizontal: 10,
    paddingBottom: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    alignItems: "flex-end",
  },
  inputContainerWithPadding: {
    paddingBottom: 30,
  },
  inputActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginRight: 10,
    zIndex: 10,
    elevation: 10,
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
    zIndex: 10,
    elevation: 10,
  },
  sendButtonDisabled: {
    backgroundColor: "#ccc",
  },
  attachmentButtonWrapper: {
    position: "relative",
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
  replyPreview: {
    marginHorizontal: 15,
    marginBottom: 4,
    backgroundColor: "#E0EDFF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  replyPreviewIndicator: {
    width: 4,
    backgroundColor: "#3B82F6",
    borderRadius: 999,
    alignSelf: "stretch",
  },
  replyPreviewText: {
    flex: 1,
    gap: 2,
  },
  replyPreviewLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1D4ED8",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  replyPreviewMessage: {
    fontSize: 14,
    color: "#0F172A",
  },
  replyPreviewClose: {
    padding: 4,
  },
  profileModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  profileModalContent: {
    width: "100%",
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  profileModalClose: {
    alignSelf: "flex-end",
  },
  profileModalHeader: {
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  profileModalAvatarWrapper: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: "hidden",
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  profileModalAvatar: {
    width: "100%",
    height: "100%",
  },
  profileModalAvatarFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: "#FDB515",
    alignItems: "center",
    justifyContent: "center",
  },
  profileModalInitials: {
    fontSize: 32,
    fontWeight: "700",
    color: "#000",
  },
  profileModalName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
    textAlign: "center",
  },
  profileModalHandle: {
    fontSize: 14,
    color: "#475569",
  },
  profileModalDetails: {
    gap: 14,
  },
  profileModalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  profileModalLabel: {
    fontSize: 13,
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  profileModalValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1F2937",
  },
  profileConnectionGroup: {
    gap: 8,
  },
  profileConnectionCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E3561",
    backgroundColor: "#15284B",
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 8,
    gap: 12,
  },
  profileConnectionIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#F77737",
    alignItems: "center",
    justifyContent: "center",
  },
  profileConnectionInfo: {
    flex: 1,
    gap: 2,
  },
  profileConnectionHandle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  profileConnectionSubtitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.7)",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  attachmentMenuBackdrop: {
    position: "absolute",
    top: -1000,
    left: -1000,
    right: -1000,
    bottom: -1000,
    zIndex: -1,
  },
  attachmentMenuPopup: {
    position: "absolute",
    bottom: 50,
    left: -5,
    width: 200,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
    zIndex: 0,
    opacity: 1,
    overflow: "hidden",
  },
  attachmentMenuOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 14,
  },
  attachmentMenuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentMenuOptionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
  },
  attachmentMenuDivider: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginHorizontal: 20,
  },
  attachmentPreviewContainer: {
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#E5E5E5",
    paddingVertical: 12,
    overflow: "visible",
  },
  attachmentPreviewList: {
    paddingHorizontal: 15,
    gap: 12,
    paddingTop: 8,
  },
  attachmentPreviewItem: {
    position: "relative",
    marginRight: 8,
    overflow: "visible",
  },
  attachmentPreviewImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: "#E5E5E5",
  },
  attachmentPreviewFile: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  attachmentPreviewRemove: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: "#fff",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 10,
  },
  imagePreviewModal: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
  },
  imagePreviewModalContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  imagePreviewClose: {
    position: "absolute",
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 8,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 20,
  },
  imagePreviewImageWrapper: {
    width: "90%",
    height: "80%",
  },
  imagePreviewImage: {
    width: "100%",
    height: "100%",
  },
});
