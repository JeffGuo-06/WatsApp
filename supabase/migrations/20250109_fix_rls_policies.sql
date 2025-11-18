-- Migration: Fix Missing RLS Policies
-- Date: 2025-01-09
-- Description: Applies all necessary RLS policies for user_courses, courses, course_chats, messages, and profiles tables
--
-- This migration ensures that Row Level Security policies are properly configured
-- to allow users to:
-- - View and enroll in courses
-- - Access course chats they're enrolled in
-- - Send and view messages in enrolled courses
-- - Manage their own profiles

-- ========================================
-- 1. COURSES TABLE
-- ========================================
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

-- ========================================
-- 2. USER_COURSES TABLE (CRITICAL - was missing!)
-- ========================================
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

-- ========================================
-- 3. COURSE_CHATS TABLE
-- ========================================
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

-- ========================================
-- 4. MESSAGES TABLE
-- ========================================
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

-- ========================================
-- 5. PROFILES TABLE
-- ========================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view all profiles"
ON public.profiles
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY "Users can delete own profile"
ON public.profiles
FOR DELETE
USING (id = auth.uid());

-- ========================================
-- 6. DIRECT_MESSAGES TABLE (if exists)
-- ========================================
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'direct_messages') THEN
    ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view their direct messages" ON public.direct_messages;
    CREATE POLICY "Users can view their direct messages"
    ON public.direct_messages
    FOR SELECT
    USING (sender_id = auth.uid() OR receiver_id = auth.uid());

    DROP POLICY IF EXISTS "Users can send direct messages" ON public.direct_messages;
    CREATE POLICY "Users can send direct messages"
    ON public.direct_messages
    FOR INSERT
    WITH CHECK (sender_id = auth.uid());

    DROP POLICY IF EXISTS "Users can update their received messages" ON public.direct_messages;
    CREATE POLICY "Users can update their received messages"
    ON public.direct_messages
    FOR UPDATE
    USING (receiver_id = auth.uid())
    WITH CHECK (receiver_id = auth.uid());
  END IF;
END $$;

-- ========================================
-- VERIFICATION QUERIES (optional - comment out if not needed)
-- ========================================

-- Uncomment these to verify policies were created:
/*
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('courses', 'user_courses', 'course_chats', 'messages', 'profiles', 'direct_messages')
ORDER BY tablename, policyname;
*/
