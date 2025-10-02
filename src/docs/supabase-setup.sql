-- WatsApp Database Schema
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  watiam_id VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  program VARCHAR(100),
  year VARCHAR(10),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Courses table
CREATE TABLE public.courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_code VARCHAR(20) NOT NULL,
  course_name VARCHAR(255),
  term VARCHAR(20) NOT NULL DEFAULT 'Winter 2025',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(course_code, term)
);

-- User courses junction table
CREATE TABLE public.user_courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  section VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, course_id)
);

-- Course chat rooms (one per course)
CREATE TABLE public.course_chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Chat messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_chat_id UUID REFERENCES public.course_chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Direct messages between students
CREATE TABLE public.direct_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Courses policies (all users can view all courses)
CREATE POLICY "Anyone can view courses"
  ON public.courses FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert courses"
  ON public.courses FOR INSERT
  WITH CHECK (true);

-- User courses policies
CREATE POLICY "Users can view all user_courses"
  ON public.user_courses FOR SELECT
  USING (true);

CREATE POLICY "Users can manage own courses"
  ON public.user_courses FOR ALL
  USING (auth.uid() = user_id);

-- Course chats policies
CREATE POLICY "Users can view course chats"
  ON public.course_chats FOR SELECT
  USING (true);

CREATE POLICY "Users can create course chats"
  ON public.course_chats FOR INSERT
  WITH CHECK (true);

-- Messages policies (users in the course can read/write)
CREATE POLICY "Users can view messages in their courses"
  ON public.messages FOR SELECT
  USING (
    course_chat_id IN (
      SELECT cc.id FROM public.course_chats cc
      JOIN public.user_courses uc ON uc.course_id = cc.course_id
      WHERE uc.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can send messages to their courses"
  ON public.messages FOR INSERT
  WITH CHECK (
    course_chat_id IN (
      SELECT cc.id FROM public.course_chats cc
      JOIN public.user_courses uc ON uc.course_id = cc.course_id
      WHERE uc.user_id = auth.uid()
    )
    AND user_id = auth.uid()
  );

-- Direct messages policies
CREATE POLICY "Users can view their own DMs"
  ON public.direct_messages FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "Users can send DMs"
  ON public.direct_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Users can update their received DMs"
  ON public.direct_messages FOR UPDATE
  USING (receiver_id = auth.uid());

-- Enable Realtime on messages tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;

-- Function to find course matches
CREATE OR REPLACE FUNCTION get_course_matches(target_user_id UUID)
RETURNS TABLE (
  user_id UUID,
  name VARCHAR,
  email VARCHAR,
  program VARCHAR,
  year VARCHAR,
  common_courses JSONB,
  match_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id as user_id,
    p.name,
    p.email,
    p.program,
    p.year,
    jsonb_agg(c.course_code) as common_courses,
    COUNT(DISTINCT c.id) as match_count
  FROM public.profiles p
  JOIN public.user_courses uc ON uc.user_id = p.id
  JOIN public.courses c ON c.id = uc.course_id
  WHERE c.id IN (
    SELECT course_id
    FROM public.user_courses
    WHERE user_id = target_user_id
  )
  AND p.id != target_user_id
  GROUP BY p.id, p.name, p.email, p.program, p.year
  ORDER BY match_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate email domain
CREATE OR REPLACE FUNCTION validate_uwaterloo_email()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email NOT LIKE '%@uwaterloo.ca' THEN
    RAISE EXCEPTION 'Only @uwaterloo.ca emails are allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_email_domain
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION validate_uwaterloo_email();
