import React from "react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { AuthProvider } from "@/context/AuthContext";
import { notificationService } from "@/services/notificationService";

export const unstable_settings = {
  anchor: "(tabs)",
};

// Notification listener component that has access to router
function NotificationListener() {
  const router = useRouter();

  React.useEffect(() => {
    // Set up notification listeners
    const removeListeners = notificationService.addNotificationListeners(
      // Foreground notification handler
      (notification) => {
        console.log('[NotificationListener] Notification received in foreground:', notification);
        // Optionally show in-app banner or toast here
      },
      // Notification tapped handler
      (response) => {
        const data = response.notification.request.content.data;
        console.log('[NotificationListener] Notification tapped:', data);

        if (data.type === 'course_message' && data.course_chat_id) {
          // Navigate to course chat
          router.push(`/course-chat?chatId=${data.course_chat_id}`);
        }
      }
    );

    return removeListeners;
  }, [router]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Add Vanta fog background styles for web
  React.useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const styleId = "vanta-fog-styles";
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
          html {
            background-color: #fffef8;
          }
          body {
            background-color: transparent;
          }
          #vanta-bg {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            pointer-events: none;
          }
        `;
        document.head.appendChild(style);
      }
    }
  }, []);

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <NotificationListener />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="course-search" options={{ headerShown: false }} />
          <Stack.Screen name="course-chat" options={{ headerShown: false }} />
          <Stack.Screen name="course-details" options={{ headerShown: false }} />
          <Stack.Screen name="notification-settings" options={{ headerShown: false }} />
          <Stack.Screen
            name="modal"
            options={{ presentation: "modal", title: "Modal" }}
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}
