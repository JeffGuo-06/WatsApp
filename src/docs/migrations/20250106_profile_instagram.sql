-- Add instagram field to user profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS instagram text;
