import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const projectReference = supabaseUrl
  .replace(/^https?:\/\//, "")
  .split(".")[0];

const authStorageKey = `sb-${projectReference}-auth-token`;

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const createWebStorage = () => {
  return {
    getItem: async (key: string) => {
      try {
        if (typeof window === "undefined") {
          return null;
        }
        const value = window.localStorage.getItem(key);
        console.log(`[Storage] getItem ${key}:`, value ? "found" : "not found");
        return value;
      } catch (error) {
        console.error(`[Storage] getItem error for ${key}:`, error);
        return null;
      }
    },
    setItem: async (key: string, value: string) => {
      try {
        if (typeof window === "undefined") {
          return;
        }
        window.localStorage.setItem(key, value);
        console.log(`[Storage] setItem ${key}: saved`);
      } catch (error) {
        console.error(`[Storage] setItem error for ${key}:`, error);
      }
    },
    removeItem: async (key: string) => {
      try {
        if (typeof window === "undefined") {
          return;
        }
        window.localStorage.removeItem(key);
        console.log(`[Storage] removeItem ${key}: removed`);
      } catch (error) {
        console.error(`[Storage] removeItem error for ${key}:`, error);
      }
    },
  };
};

const storage = Platform.OS === "web" ? createWebStorage() : ExpoSecureStoreAdapter;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Disable to prevent hanging on page refresh
    flowType: 'pkce', // Use PKCE flow for better web security
  },
});

export const clearSupabaseSession = async () => {
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(authStorageKey);
      }
      return;
    }

    await SecureStore.deleteItemAsync(authStorageKey);
  } catch (error) {
    console.warn("Failed to clear Supabase auth cache", error);
  }
};
