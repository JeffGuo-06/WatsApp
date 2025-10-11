import { supabase, clearSupabaseSession } from "../lib/supabase";
import { makeRedirectUri } from "expo-auth-session";
import SessionManager, { UserSession } from "../utils/SessionManager";

const WATERLOO_EMAIL_DOMAIN = "uwaterloo.ca";
const WATIAM_REGEX = /^[a-z][a-z0-9]{2,15}$/;
const PROFILE_AVATAR_BUCKET = "profile-photos";

type AvatarUploadSource = {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  type?: string | null;
};

type SupabaseOtpResponse = Awaited<
  ReturnType<typeof supabase.auth.signInWithOtp>
>;

type VerifiedOtpResponse = Awaited<
  ReturnType<typeof supabase.auth.verifyOtp>
>;

const normalizeWatIamId = (value: string) => value.trim().toLowerCase();

const resolveWatIamId = (value: string) => {
  const normalized = normalizeWatIamId(value);

  if (!normalized) {
    throw new Error("Please enter your WatIAM ID.");
  }

  if (!WATIAM_REGEX.test(normalized)) {
    throw new Error(
      "Enter a valid WatIAM ID using letters and numbers only."
    );
  }

  return normalized;
};

const buildWaterlooEmail = (watiamId: string) =>
  `${watiamId}@${WATERLOO_EMAIL_DOMAIN}`;

const extractFileExtension = (
  uri: string,
  mimeType?: string | null,
  fileName?: string | null
) => {
  const parseExt = (value?: string | null) => {
    if (!value) return undefined;
    const sanitized = value.split(/[?#]/)[0];
    const dotIndex = sanitized.lastIndexOf(".");
    if (dotIndex === -1) return undefined;
    return sanitized.substring(dotIndex + 1);
  };

  const fromName = parseExt(fileName);
  if (fromName) return fromName.toLowerCase();

  const fromUri = parseExt(uri);
  if (fromUri) return fromUri.toLowerCase();

  if (mimeType && mimeType.includes("/")) {
    const mimeExt = mimeType.split("/").pop();
    if (mimeExt) return mimeExt.toLowerCase();
  }

  return "jpg";
};

const loadBlobFromUri = async (
  uri: string,
  mimeTypeHint?: string | null,
  fileName?: string | null
) => {
  const mimeType = mimeTypeHint || "image/jpeg";
  const fileExt = extractFileExtension(uri, mimeType, fileName);

  // Read file as base64 and convert to ArrayBuffer for Supabase upload
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error("Unable to read the selected file.");
  }

  const arrayBuffer = await response.arrayBuffer();
  return { data: arrayBuffer, mimeType, fileExt } as const;
};

const resolveMimeType = (source: AvatarUploadSource) => {
  if (source.mimeType) return source.mimeType;
  if (source.type === "image") return "image/jpeg";
  return "application/octet-stream";
};

const createUploadPayload = async (source: AvatarUploadSource) => {
  const mimeType = resolveMimeType(source);

  if (source.base64) {
    const base64Payload = source.base64.replace(/\s/g, "");
    const dataUri = `data:${mimeType};base64,${base64Payload}`;
    const response = await fetch(dataUri);

    if (!response.ok) {
      throw new Error("Unable to process the selected image.");
    }

    const arrayBuffer = await response.arrayBuffer();
    const fileExt = extractFileExtension(source.uri, mimeType, source.fileName ?? undefined);
    return { data: arrayBuffer, mimeType, fileExt } as const;
  }

  return loadBlobFromUri(source.uri, mimeType, source.fileName ?? undefined);
};

export const authService = {
  // Send magic link/OTP to Waterloo email (passwordless sign in/up)
  sendMagicLink: async (
    rawWatIamId: string,
    name?: string
  ): Promise<{
    data: SupabaseOtpResponse["data"];
    email: string;
    watiamId: string;
  }> => {
    const watiamId = resolveWatIamId(rawWatIamId);
    const email = buildWaterlooEmail(watiamId);
    const redirectTo = makeRedirectUri();
    const trimmedName = name?.trim();

    const metadata = {
      watiam_id: watiamId,
      ...(trimmedName ? { name: trimmedName } : {}),
    };

    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: true,
        data: metadata,
      },
    });

    if (error) throw error;
    return { data, email, watiamId };
  },

  // Verify OTP code (alternative to magic link)
  verifyOTP: async (
    rawWatIamId: string,
    token: string
  ): Promise<
    VerifiedOtpResponse["data"] & { email: string; watiamId: string }
  > => {
    const watiamId = resolveWatIamId(rawWatIamId);
    const email = buildWaterlooEmail(watiamId);

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (error) throw error;
    return { ...data, email, watiamId };
  },

  // Sign out and clear cached session
  signOut: async () => {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) throw error;
    await clearSupabaseSession();
  },

  updateAvatar: async (userId: string, source: AvatarUploadSource) => {
    const { data: fileData, mimeType, fileExt } = await createUploadPayload(source);
    const objectPath = `${userId}/avatar.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(PROFILE_AVATAR_BUCKET)
      .upload(objectPath, fileData, {
        cacheControl: "3600",
        upsert: true,
        contentType: mimeType,
      });

    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(objectPath);

    // Add cache-busting timestamp to URL
    const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;

    const { data, error } = await supabase
      .from("profiles")
      .update({
        avatar_url: cacheBustedUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
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
    rawWatIamId: string,
    name: string
  ) => {
    const watiamId = resolveWatIamId(rawWatIamId);
    const email = buildWaterlooEmail(watiamId);
    const trimmedName = name.trim();

    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          watiam_id: watiamId,
          email,
          name: trimmedName || name,
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
    updates: {
      name?: string;
      program?: string;
      year?: string;
      instagram?: string | null;
    }
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

  deleteAccount: async () => {
    const { error } = await supabase.rpc("delete_current_user");
    if (error) throw error;
  },

  // ========== Session Management ==========

  /**
   * Track/update the current session in the database
   * Call this on login and periodically during app usage
   */
  trackSession: async () => {
    try {
      const deviceId = await SessionManager.getDeviceId();
      const deviceInfo = await SessionManager.getDeviceInfo();
      const deviceName = await SessionManager.getDeviceName();
      const userAgent = SessionManager.getUserAgent();

      const { data, error } = await supabase.rpc("upsert_user_session", {
        p_device_id: deviceId,
        p_device_name: deviceName,
        p_device_type: deviceInfo.deviceType,
        p_device_info: deviceInfo,
        p_ip_address: null, // Could be detected server-side
        p_user_agent: userAgent,
      });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error tracking session:", error);
      throw error;
    }
  },

  /**
   * Get all active sessions for the current user
   */
  getActiveSessions: async (): Promise<UserSession[]> => {
    try {
      const currentDeviceId = await SessionManager.getDeviceId();

      const { data, error } = await supabase.rpc("get_active_sessions");

      if (error) throw error;

      // Mark the current device
      const sessions = (data || []).map((session: any) => ({
        ...session,
        is_current: session.device_id === currentDeviceId,
      }));

      return sessions;
    } catch (error) {
      console.error("Error getting active sessions:", error);
      throw error;
    }
  },

  /**
   * Revoke a specific session by ID
   */
  revokeSession: async (sessionId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.rpc("revoke_session", {
        p_session_id: sessionId,
      });

      if (error) throw error;
      return data === true;
    } catch (error) {
      console.error("Error revoking session:", error);
      throw error;
    }
  },

  /**
   * Revoke all sessions except the current device
   */
  revokeAllOtherSessions: async (): Promise<number> => {
    try {
      const currentDeviceId = await SessionManager.getDeviceId();

      const { data, error } = await supabase.rpc("revoke_all_other_sessions", {
        p_current_device_id: currentDeviceId,
      });

      if (error) throw error;
      return data || 0;
    } catch (error) {
      console.error("Error revoking other sessions:", error);
      throw error;
    }
  },

  /**
   * Sign out and revoke the current session
   */
  signOutAndRevokeSession: async () => {
    try {
      // First revoke the current device session
      const currentDeviceId = await SessionManager.getDeviceId();
      await supabase.rpc("revoke_all_other_sessions", {
        p_current_device_id: "non-existent", // Revoke current by excluding it from keep list
      });

      // Then sign out from Supabase
      await authService.signOut();
    } catch (error) {
      console.error("Error signing out and revoking session:", error);
      // Still attempt to sign out even if revocation fails
      await authService.signOut();
    }
  },
};

export const waterlooAuthUtils = {
  buildWaterlooEmail,
  normalizeWatIamId,
};
