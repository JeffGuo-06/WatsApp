import React, { createContext, useState, useEffect, useContext } from "react";
import { supabase } from "../lib/supabase";
import { User, Session } from "@supabase/supabase-js";
import { authService } from "../services/authService";
import { notificationService } from "../services/notificationService";

interface Profile {
  id: string;
  watiam_id: string;
  email: string;
  name: string;
  avatar_url?: string;
  program?: string;
  year?: string;
  instagram?: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  refreshProfile: async () => {},
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error("Error fetching profile:", error);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  useEffect(() => {
    let mounted = true;
    let initialAuthResolved = false;

    // Listen for auth changes - this is the PRIMARY auth mechanism
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log("[AuthContext] Auth state changed:", _event, session ? "authenticated" : "no session");
      if (!mounted) return;

      // Mark that initial auth has been handled by the listener
      if (!initialAuthResolved) {
        initialAuthResolved = true;
        console.log("[AuthContext] Initial auth resolved via listener");
      }

      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        // Fetch profile but don't block
        fetchProfile(session.user.id).catch(err => {
          console.error("[AuthContext] Profile fetch failed:", err);
        });

        // Track session but don't block
        authService.trackSession().catch(err => {
          console.error("[AuthContext] Session tracking failed:", err);
        });

        // Register for push notifications but don't block
        notificationService.registerForPushNotifications(session.user.id).catch(err => {
          console.error("[AuthContext] Push notification registration failed:", err);
        });
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    // Try getSession() as backup in case listener doesn't fire immediately
    // This handles edge cases but isn't critical
    const tryGetSession = async () => {
      try {
        console.log("[AuthContext] Attempting getSession() as backup...");

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("getSession timeout")), 2000);
        });

        const { data: { session } } = await Promise.race([
          supabase.auth.getSession(),
          timeoutPromise
        ]);

        console.log("[AuthContext] getSession() succeeded");

        // Only use this if the listener hasn't fired yet
        if (!initialAuthResolved && mounted) {
          console.log("[AuthContext] Using getSession() result (listener didn't fire)");
          initialAuthResolved = true;
          setSession(session);
          setUser(session?.user ?? null);

          if (session?.user) {
            fetchProfile(session.user.id).catch(() => {});
            authService.trackSession().catch(() => {});
          }

          setLoading(false);
        }
      } catch (error) {
        console.log("[AuthContext] getSession() failed/timed out (expected, using listener instead)");

        // If listener hasn't fired after 3 seconds total, assume no session
        if (!initialAuthResolved && mounted) {
          setTimeout(() => {
            if (!initialAuthResolved && mounted) {
              console.log("[AuthContext] No auth detected, stopping loading");
              initialAuthResolved = true;
              setLoading(false);
            }
          }, 1000);
        }
      }
    };

    tryGetSession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Periodically update session activity (every 10 minutes)
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      try {
        await authService.trackSession();
      } catch (error) {
        console.error("Failed to update session activity:", error);
      }
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(interval);
  }, [user]);

  return (
    <AuthContext.Provider
      value={{ user, profile, session, loading, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
};
