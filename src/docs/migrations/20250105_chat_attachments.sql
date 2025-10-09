-- Migration: Enable file attachments in course chats
-- Date: 2025-01-05
-- Description:
--   * Adds optional attachment metadata columns to messages
--   * Creates a public storage bucket for chat attachments
--   * Adds storage policies so only the uploading user can manage their files

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_size integer;

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Users can upload chat attachments'
      AND schemaname = 'storage'
      AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Users can upload chat attachments"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'chat-attachments'
      AND split_part(name, '/', 2) = auth.uid()::text
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Users can update own chat attachments'
      AND schemaname = 'storage'
      AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Users can update own chat attachments"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'chat-attachments'
      AND split_part(name, '/', 2) = auth.uid()::text
    )
    WITH CHECK (
      bucket_id = 'chat-attachments'
      AND split_part(name, '/', 2) = auth.uid()::text
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Users can delete own chat attachments'
      AND schemaname = 'storage'
      AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Users can delete own chat attachments"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'chat-attachments'
      AND split_part(name, '/', 2) = auth.uid()::text
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'Anyone can view chat attachments'
      AND schemaname = 'storage'
      AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Anyone can view chat attachments"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'chat-attachments');
  END IF;
END $$;
