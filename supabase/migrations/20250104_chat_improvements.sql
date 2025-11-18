-- Migration: Chat System Improvements
-- Date: 2025-01-04
-- Description: Adds indexes, constraints, and optimizations for course chat functionality

-- 1. Add unique constraint on course_code + term to prevent duplicate courses
ALTER TABLE public.courses
ADD CONSTRAINT courses_code_term_unique UNIQUE (course_code, term);

-- 2. Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_courses_course_code ON public.courses(course_code);
CREATE INDEX IF NOT EXISTS idx_user_courses_user_id ON public.user_courses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_courses_course_id ON public.user_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_course_chats_course_id ON public.course_chats(course_id);
CREATE INDEX IF NOT EXISTS idx_messages_course_chat_id ON public.messages(course_chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at DESC);

-- 3. Add composite index for user course enrollment checks
CREATE INDEX IF NOT EXISTS idx_user_courses_user_course ON public.user_courses(user_id, course_id);

-- 4. Enable Realtime for messages table (skip if already enabled)
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- 5. RLS Policies for course_chats table
ALTER TABLE public.course_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view course chats they're enrolled in" ON public.course_chats;
CREATE POLICY "Users can view course chats they're enrolled in"
ON public.course_chats
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_courses
    WHERE user_courses.course_id = course_chats.course_id
    AND user_courses.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can create course chats" ON public.course_chats;
CREATE POLICY "Users can create course chats"
ON public.course_chats
FOR INSERT
WITH CHECK (true);

-- 6. RLS Policies for messages table
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages in enrolled courses" ON public.messages;
CREATE POLICY "Users can view messages in enrolled courses"
ON public.messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.course_chats
    JOIN public.user_courses ON user_courses.course_id = course_chats.course_id
    WHERE course_chats.id = messages.course_chat_id
    AND user_courses.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can send messages to enrolled courses" ON public.messages;
CREATE POLICY "Users can send messages to enrolled courses"
ON public.messages
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.course_chats
    JOIN public.user_courses ON user_courses.course_id = course_chats.course_id
    WHERE course_chats.id = messages.course_chat_id
    AND user_courses.user_id = auth.uid()
  )
);

-- 7. RLS Policies for user_courses table
ALTER TABLE public.user_courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view all course enrollments" ON public.user_courses;
CREATE POLICY "Users can view all course enrollments"
ON public.user_courses
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can enroll themselves in courses" ON public.user_courses;
CREATE POLICY "Users can enroll themselves in courses"
ON public.user_courses
FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can unenroll themselves" ON public.user_courses;
CREATE POLICY "Users can unenroll themselves"
ON public.user_courses
FOR DELETE
USING (user_id = auth.uid());

-- 8. RLS Policies for courses table
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view courses" ON public.courses;
CREATE POLICY "Anyone can view courses"
ON public.courses
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can create courses" ON public.courses;
CREATE POLICY "Users can create courses"
ON public.courses
FOR INSERT
WITH CHECK (true);

-- 9. Add helper function to get or create course chat
CREATE OR REPLACE FUNCTION get_or_create_course_chat(p_course_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_chat_id uuid;
BEGIN
  -- Try to get existing chat
  SELECT id INTO v_chat_id
  FROM public.course_chats
  WHERE course_id = p_course_id;

  -- If not found, create it
  IF v_chat_id IS NULL THEN
    INSERT INTO public.course_chats (course_id)
    VALUES (p_course_id)
    RETURNING id INTO v_chat_id;
  END IF;

  RETURN v_chat_id;
END;
$$;
