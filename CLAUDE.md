# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WatsApp is a React Native mobile app for UWaterloo students to connect and chat with classmates in their courses. It's a student-only chat space (free from instructors/TAs) built with Supabase as the backend.

**Core Feature**: Real-time course-based chat rooms where students can discuss coursework freely.

## Current Status

This is an **early-stage project** with planning documents only. No code has been written yet. The project is in Phase 1 (Setup & Planning).

## Architecture (Planned)

### Tech Stack

- **Frontend**: React Native (iOS + Android)
- **Backend**: Supabase (PostgreSQL + Realtime + Auth)
- **Authentication**: Email-based (restricted to @uwaterloo.ca emails)
- **State Management**: React Context API
- **Storage**: AsyncStorage for session persistence

### Key Components (To Be Built)

1. **Authentication System**

   - Email verification flow using Supabase Auth
   - WatIAM ID input (appends @uwaterloo.ca automatically)
   - Email domain restriction enforced at database level

2. **Course Management**

   - Course parsing from Quest schedule text (regex: `/[A-Z]{2,4}\s*\d{3}[A-Z]?/gi`)
   - Course enrollment tracking in junction table
   - Automatic chat room creation per course

3. **Real-Time Chat**

   - Supabase Realtime subscriptions for live messaging
   - Course-based chat rooms (primary feature)
   - Direct messaging between students
   - Row Level Security (RLS) to restrict chat access to enrolled students

4. **Classmate Discovery**
   - Database function `get_course_matches()` to find students with common courses
   - Match count and shared course display

### Database Schema

The schema can be found in ./src/docs/schema.sql

Tables: `profiles`, `courses`, `user_courses`, `course_chats`, `messages`, `direct_messages`

All tables use Row Level Security (RLS) policies to ensure:

- Students can only access chats for courses they're enrolled in
- Direct messages are private between sender/receiver
- Email addresses must be @uwaterloo.ca

I encourage you to add migrations in ./src/docs

## Development Commands

**Note**: Project setup not yet complete. When implemented, commands will be:

```bash
# Install dependencies
npm install

# Start Metro bundler
npx react-native start

# Run on iOS simulator
npx react-native run-ios

# Run on Android emulator/device
npx react-native run-android

# Install Supabase client (when ready)
npm install @supabase/supabase-js @react-native-async-storage/async-storage

# Install navigation (when ready)
npm install @react-navigation/native @react-navigation/stack react-native-screens react-native-safe-area-context
```

## Project Structure (Planned)

```
src/
├── lib/
│   └── supabase.js          # Supabase client configuration
├── services/
│   ├── authService.js       # Sign up, sign in, session management
│   ├── courseService.js     # Course parsing, CRUD, matching logic
│   └── chatService.js       # Message sending, Realtime subscriptions
├── context/
│   └── AuthContext.js       # Global authentication state
├── screens/
│   ├── LoginScreen.js
│   ├── CourseInputScreen.js
│   ├── CourseChatScreen.js  # PRIMARY FEATURE
│   ├── ClassmatesScreen.js
│   ├── DirectMessagesScreen.js
│   └── ProfileScreen.js
└── components/
    ├── MessageBubble.js
    ├── CourseChip.js
    └── ...
```

## Important Design Decisions

1. **Email Verification Required**: Only @uwaterloo.ca emails allowed. This is enforced both in app logic and database triggers.

2. **Chat-First Design**: The app is primarily a real-time chat platform. Course discovery and matching are secondary features to facilitate chat connections.

3. **Privacy by Design**: RLS policies ensure students can only access chats for their enrolled courses. Instructors and TAs cannot join student-only chat rooms.

4. **Course Parsing**: Supports pasting Quest schedule text with automatic course code extraction. Manual entry also supported.

5. **Realtime Architecture**: Uses Supabase Realtime (Postgres LISTEN/NOTIFY) for live message delivery. Messages table has Realtime publication enabled.

## Setup Instructions (When Ready to Build)

1. Create Supabase project at supabase.com
2. Run SQL schema from PLAN.md (Phase 2) in Supabase SQL Editor
3. Enable Realtime on `messages` and `direct_messages` tables
4. Initialize React Native project: `npx react-native init WatsApp`
5. Configure Supabase client with project URL and anon key
6. Set up iOS/Android development environments

## Security Considerations

- Never commit Supabase anon key to public repos (use environment variables)
- RLS policies must be thoroughly tested before launch
- Email verification is mandatory before chat access
- Rate limiting on email sending to prevent abuse
- Database triggers validate email domain on INSERT/UPDATE

## Development Timeline

Target MVP: 10-11 weeks (see PLAN.md for detailed phases)

Current phase: **Phase 1 - Setup & Planning**
