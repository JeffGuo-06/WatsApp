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
      if (typeof window === "undefined") {
        return null;
      }
      return window.localStorage.getItem(key);
    },
    setItem: async (key: string, value: string) => {
      if (typeof window === "undefined") {
        return;
      }
      window.localStorage.setItem(key, value);
    },
    removeItem: async (key: string) => {
      if (typeof window === "undefined") {
        return;
      }
      window.localStorage.removeItem(key);
    },
  };
};

const storage = Platform.OS === "web" ? createWebStorage() : ExpoSecureStoreAdapter;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web", // Enable URL detection for web (magic links)
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
