-- Migration: Authentication Session Tracking
-- Date: 2025-01-08
-- Description: Adds session tracking for multi-device management and security features
-- Note: Works alongside Supabase's built-in auth tokens (not replacing them)

-- 1. Create user_sessions table for tracking active devices/sessions
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL,
  device_name VARCHAR(255),
  device_type VARCHAR(50), -- 'web', 'ios', 'android'
  device_info JSONB, -- Browser, OS, app version, etc.
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '365 days'),
  is_revoked BOOLEAN DEFAULT FALSE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT user_sessions_user_device_unique UNIQUE (user_id, device_id)
);

-- 2. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_device_id ON public.user_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON public.user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_active ON public.user_sessions(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active ON public.user_sessions(user_id, is_revoked, expires_at);

-- 3. Enable Row Level Security
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies - Users can only manage their own sessions
DROP POLICY IF EXISTS "Users can view their own sessions" ON public.user_sessions;
CREATE POLICY "Users can view their own sessions"
ON public.user_sessions
FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create their own sessions" ON public.user_sessions;
CREATE POLICY "Users can create their own sessions"
ON public.user_sessions
FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own sessions" ON public.user_sessions;
CREATE POLICY "Users can update their own sessions"
ON public.user_sessions
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own sessions" ON public.user_sessions;
CREATE POLICY "Users can delete their own sessions"
ON public.user_sessions
FOR DELETE
USING (user_id = auth.uid());

-- 5. Function to upsert session on login/activity
CREATE OR REPLACE FUNCTION public.upsert_user_session(
  p_device_id VARCHAR(255),
  p_device_name VARCHAR(255) DEFAULT NULL,
  p_device_type VARCHAR(50) DEFAULT NULL,
  p_device_info JSONB DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Insert or update session
  INSERT INTO public.user_sessions (
    user_id,
    device_id,
    device_name,
    device_type,
    device_info,
    ip_address,
    user_agent,
    last_active_at
  )
  VALUES (
    v_user_id,
    p_device_id,
    p_device_name,
    p_device_type,
    p_device_info,
    p_ip_address,
    p_user_agent,
    NOW()
  )
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET
    device_name = COALESCE(EXCLUDED.device_name, user_sessions.device_name),
    device_type = COALESCE(EXCLUDED.device_type, user_sessions.device_type),
    device_info = COALESCE(EXCLUDED.device_info, user_sessions.device_info),
    ip_address = COALESCE(EXCLUDED.ip_address, user_sessions.ip_address),
    user_agent = COALESCE(EXCLUDED.user_agent, user_sessions.user_agent),
    last_active_at = NOW(),
    is_revoked = FALSE,
    revoked_at = NULL
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

-- 6. Function to get active sessions for current user
CREATE OR REPLACE FUNCTION public.get_active_sessions()
RETURNS TABLE (
  session_id UUID,
  device_id VARCHAR(255),
  device_name VARCHAR(255),
  device_type VARCHAR(50),
  device_info JSONB,
  created_at TIMESTAMP WITH TIME ZONE,
  last_active_at TIMESTAMP WITH TIME ZONE,
  is_current BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    us.id,
    us.device_id,
    us.device_name,
    us.device_type,
    us.device_info,
    us.created_at,
    us.last_active_at,
    FALSE::BOOLEAN -- Will be set by client based on current device_id
  FROM public.user_sessions us
  WHERE us.user_id = v_user_id
    AND us.is_revoked = FALSE
    AND us.expires_at > NOW()
  ORDER BY us.last_active_at DESC;
END;
$$;

-- 7. Function to revoke a specific session
CREATE OR REPLACE FUNCTION public.revoke_session(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_affected_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_sessions
  SET
    is_revoked = TRUE,
    revoked_at = NOW()
  WHERE id = p_session_id
    AND user_id = v_user_id
    AND is_revoked = FALSE;

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;
  RETURN v_affected_count > 0;
END;
$$;

-- 8. Function to revoke all sessions except current device
CREATE OR REPLACE FUNCTION public.revoke_all_other_sessions(p_current_device_id VARCHAR(255))
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_affected_count INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_sessions
  SET
    is_revoked = TRUE,
    revoked_at = NOW()
  WHERE user_id = v_user_id
    AND device_id != p_current_device_id
    AND is_revoked = FALSE;

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;
  RETURN v_affected_count;
END;
$$;

-- 9. Cleanup function for expired/revoked sessions (run via cron)
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  DELETE FROM public.user_sessions
  WHERE expires_at < NOW() - INTERVAL '30 days'
     OR (is_revoked = TRUE AND revoked_at < NOW() - INTERVAL '30 days');

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- 10. Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION public.upsert_user_session(VARCHAR, VARCHAR, VARCHAR, JSONB, INET, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_other_sessions(VARCHAR) TO authenticated;

-- 11. Trigger to auto-revoke sessions on password change
CREATE OR REPLACE FUNCTION public.handle_user_password_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if password was changed (encrypted_password field changed)
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
    -- Revoke all sessions for this user
    UPDATE public.user_sessions
    SET
      is_revoked = TRUE,
      revoked_at = NOW()
    WHERE user_id = NEW.id
      AND is_revoked = FALSE;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger on auth.users table (requires superuser or service role)
-- Note: This may need to be run manually in Supabase SQL Editor with service role
DROP TRIGGER IF EXISTS on_auth_user_password_change ON auth.users;
CREATE TRIGGER on_auth_user_password_change
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_password_change();

-- 12. Add comment documentation
COMMENT ON TABLE public.user_sessions IS 'Tracks active user sessions across devices for management and security';
COMMENT ON FUNCTION public.upsert_user_session IS 'Creates or updates a session record on login or activity';
COMMENT ON FUNCTION public.get_active_sessions IS 'Returns all active (non-revoked, non-expired) sessions for current user';
COMMENT ON FUNCTION public.revoke_session IS 'Revokes a specific session by ID';
COMMENT ON FUNCTION public.revoke_all_other_sessions IS 'Revokes all sessions except the specified device';
COMMENT ON FUNCTION public.cleanup_expired_sessions IS 'Cleans up old expired/revoked sessions (run via cron)';
