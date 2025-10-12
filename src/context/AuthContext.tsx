import React, { createContext, useState, useEffect, useContext } from "react";
import { supabase } from "../lib/supabase";
import { User, Session } from "@supabase/supabase-js";
import { authService } from "../services/authService";

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

    const initializeAuth = async () => {
      try {
        const startTime = performance.now();
        console.log("[AuthContext] Starting session restoration...");

        const { data: { session }, error } = await supabase.auth.getSession();

        const duration = performance.now() - startTime;
        console.log(`[AuthContext] getSession() completed in ${duration.toFixed(0)}ms`);

        if (error) {
          console.error("[AuthContext] Session restoration error:", error);
          throw error;
        }

        console.log("[AuthContext] Session restored:", session ? "authenticated" : "no session");

        if (!mounted) return;

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          console.log("[AuthContext] User found, fetching profile...");
          // Fetch profile but don't block on it
          fetchProfile(session.user.id).catch(err => {
            console.error("[AuthContext] Profile fetch failed (non-blocking):", err);
          });

          // Track session but don't block on it
          authService.trackSession().catch(err => {
            console.error("[AuthContext] Session tracking failed (non-blocking):", err);
          });
        }
      } catch (error) {
        console.error("[AuthContext] Session restoration failed:", error);
        // On error, ensure we're logged out
        setSession(null);
        setUser(null);
        setProfile(null);
      } finally {
        if (mounted) {
          console.log("[AuthContext] Setting loading to false");
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log("[AuthContext] Auth state changed:", _event, session ? "authenticated" : "no session");
      if (!mounted) return;

      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user.id);
        // Track session on login/auth change
        try {
          await authService.trackSession();
        } catch (error) {
          console.error("Failed to track session on auth change:", error);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

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
