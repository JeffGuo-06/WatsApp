-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.course_chats (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  course_id uuid UNIQUE,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT course_chats_pkey PRIMARY KEY (id),
  CONSTRAINT course_chats_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id)
);
CREATE TABLE public.courses (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  course_code character varying NOT NULL,
  course_name character varying,
  term character varying NOT NULL DEFAULT 'Winter 2025'::character varying,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT courses_pkey PRIMARY KEY (id)
);
CREATE TABLE public.direct_messages (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  sender_id uuid,
  receiver_id uuid,
  content text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT direct_messages_pkey PRIMARY KEY (id),
  CONSTRAINT direct_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id),
  CONSTRAINT direct_messages_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  course_chat_id uuid,
  user_id uuid,
  content text NOT NULL,
  reply_to_message_id uuid,
  attachment_url text,
  attachment_type text,
  attachment_name text,
  attachment_size integer,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_course_chat_id_fkey FOREIGN KEY (course_chat_id) REFERENCES public.course_chats(id),
  CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES public.messages(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  watiam_id character varying NOT NULL UNIQUE,
  email character varying NOT NULL UNIQUE,
  name character varying NOT NULL,
  program character varying,
  year character varying,
  instagram character varying,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  avatar_url text,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_courses (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  course_id uuid,
  section character varying,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT user_courses_pkey PRIMARY KEY (id),
  CONSTRAINT user_courses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT user_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id)
);
