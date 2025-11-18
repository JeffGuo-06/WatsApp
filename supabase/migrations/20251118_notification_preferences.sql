-- Migration: notification_preferences.sql
-- Create notification preferences and push token tables

-- Table: user_notification_settings (global notification preferences)
CREATE TABLE IF NOT EXISTS public.user_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  push_enabled BOOLEAN DEFAULT true,
  sound_enabled BOOLEAN DEFAULT true,
  vibration_enabled BOOLEAN DEFAULT true,
  show_message_preview BOOLEAN DEFAULT true,
  quiet_hours_enabled BOOLEAN DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: course_notification_settings (per-course muting)
CREATE TABLE IF NOT EXISTS public.course_notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  course_chat_id UUID REFERENCES public.course_chats(id) ON DELETE CASCADE NOT NULL,
  muted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, course_chat_id)
);

-- Table: push_tokens (multi-device support)
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  device_id TEXT NOT NULL,
  push_token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);

-- Enable RLS
ALTER TABLE public.user_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_notification_settings
CREATE POLICY "Users can view their own notification settings"
  ON public.user_notification_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification settings"
  ON public.user_notification_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification settings"
  ON public.user_notification_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for course_notification_settings
CREATE POLICY "Users can view their course notification settings"
  ON public.course_notification_settings FOR ALL
  USING (auth.uid() = user_id);

-- RLS Policies for push_tokens
CREATE POLICY "Users can view their push tokens"
  ON public.push_tokens FOR ALL
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_course_notification_settings_user ON course_notification_settings(user_id);
CREATE INDEX idx_course_notification_settings_chat ON course_notification_settings(course_chat_id);
CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX idx_push_tokens_active ON push_tokens(is_active) WHERE is_active = true;

-- Function: Get notification settings with defaults
CREATE OR REPLACE FUNCTION get_user_notification_settings(p_user_id UUID)
RETURNS TABLE (
  push_enabled BOOLEAN,
  sound_enabled BOOLEAN,
  vibration_enabled BOOLEAN,
  show_message_preview BOOLEAN,
  quiet_hours_enabled BOOLEAN,
  quiet_hours_start TIME,
  quiet_hours_end TIME
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(uns.push_enabled, true),
    COALESCE(uns.sound_enabled, true),
    COALESCE(uns.vibration_enabled, true),
    COALESCE(uns.show_message_preview, true),
    COALESCE(uns.quiet_hours_enabled, false),
    uns.quiet_hours_start,
    uns.quiet_hours_end
  FROM public.user_notification_settings uns
  WHERE uns.user_id = p_user_id;

  -- If no settings exist, return defaults
  IF NOT FOUND THEN
    RETURN QUERY SELECT true, true, true, true, false, NULL::TIME, NULL::TIME;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
