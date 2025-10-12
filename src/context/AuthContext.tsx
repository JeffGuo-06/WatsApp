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
    let sessionTimeout: NodeJS.Timeout;

    const initializeAuth = async () => {
      try {
        // Add timeout protection for session restoration
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) => {
          sessionTimeout = setTimeout(() => {
            reject(new Error("Session restoration timeout"));
          }, 10000); // 10 second timeout
        });

        const { data: { session } } = await Promise.race([
          sessionPromise,
          timeoutPromise
        ]) as Awaited<ReturnType<typeof supabase.auth.getSession>>;

        clearTimeout(sessionTimeout);

        if (!mounted) return;

        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          await fetchProfile(session.user.id);
          // Track session on app start if authenticated
          try {
            await authService.trackSession();
          } catch (error) {
            console.error("Failed to track session on startup:", error);
          }
        }
      } catch (error) {
        console.error("Session restoration failed:", error);
        // Clear potentially corrupted session data
        if (error instanceof Error && error.message === "Session restoration timeout") {
          console.warn("Session timeout - clearing cached session");
          await supabase.auth.signOut({ scope: "local" });
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
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
      clearTimeout(sessionTimeout);
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
