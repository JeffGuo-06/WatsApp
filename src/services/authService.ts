import { supabase } from "../lib/supabase";
import { makeRedirectUri } from "expo-auth-session";

export const authService = {
  // Send magic link to email (passwordless sign in/up)
  sendMagicLink: async (watiamId: string, name?: string) => {
    const email = `${watiamId}@uwaterloo.ca`;
    const redirectTo = makeRedirectUri();

    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
        data: name ? { name, watiam_id: watiamId } : undefined,
      },
    });

    if (error) throw error;
    return data;
  },

  // Verify OTP code (alternative to magic link)
  verifyOTP: async (email: string, token: string) => {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (error) throw error;
    return data;
  },

  // Sign out
  signOut: async () => {
    return await supabase.auth.signOut();
  },

  // Get current session
  getSession: async () => {
    return await supabase.auth.getSession();
  },

  // Get current user profile
  getProfile: async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return data;
  },

  // Create or update profile after first sign in
  upsertProfile: async (
    userId: string,
    watiamId: string,
    email: string,
    name: string
  ) => {
    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          watiam_id: watiamId,
          email,
          name,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Update profile
  updateProfile: async (
    userId: string,
    updates: { name?: string; program?: string; year?: string }
  ) => {
    const { data, error } = await supabase
      .from("profiles")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};
