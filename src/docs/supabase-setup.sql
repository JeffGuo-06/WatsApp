-- WatsApp incremental Supabase setup helpers
-- Run these statements in the Supabase SQL Editor after the base schema
-- in docs/schema.sql has been applied.

-- Add avatar column for profile pictures if it is missing
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Ensure Row Level Security remains enabled on core tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- Create the public storage bucket for avatars (safe to run repeatedly)
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Helper to create storage policy only when it does not already exist
CREATE OR REPLACE FUNCTION public.__create_storage_policy(
  policy_name text,
  command text,
  definition text,
  check_definition text DEFAULT NULL
) RETURNS void AS $$
DECLARE
  policy_exists boolean;
BEGIN
  SELECT true INTO policy_exists
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = policy_name;

  IF NOT policy_exists THEN
    EXECUTE format(
      'CREATE POLICY "%s" ON storage.objects FOR %s USING (%s)%s',
      policy_name,
      command,
      definition,
      CASE
        WHEN check_definition IS NOT NULL THEN
          format(' WITH CHECK (%s)', check_definition)
        ELSE
          ''
      END
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT public.__create_storage_policy(
  'Anyone can view avatars',
  'SELECT',
  'bucket_id = ''profile-photos''' );

SELECT public.__create_storage_policy(
  'Users can upload their avatar',
  'INSERT',
  'bucket_id = ''profile-photos'' AND auth.uid()::text = split_part(name, ''/'', 1)',
  'bucket_id = ''profile-photos'' AND auth.uid()::text = split_part(name, ''/'', 1)');

SELECT public.__create_storage_policy(
  'Users can update their avatar',
  'UPDATE',
  'bucket_id = ''profile-photos'' AND auth.uid()::text = split_part(name, ''/'', 1)',
  'bucket_id = ''profile-photos'' AND auth.uid()::text = split_part(name, ''/'', 1)');

SELECT public.__create_storage_policy(
  'Users can remove their avatar',
  'DELETE',
  'bucket_id = ''profile-photos'' AND auth.uid()::text = split_part(name, ''/'', 1)');

-- Drop helper to keep schema clean
DROP FUNCTION IF EXISTS public.__create_storage_policy(text, text, text, text);

-- Delete-account RPC (idempotent)
CREATE OR REPLACE FUNCTION delete_current_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.profiles WHERE id = current_user_id;
  DELETE FROM auth.users WHERE id = current_user_id;
END;
$$;

REVOKE ALL ON FUNCTION delete_current_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_current_user() TO authenticated;
