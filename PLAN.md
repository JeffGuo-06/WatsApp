# WatsApp - MVP Development Plan (Supabase Edition)

## Project Overview

WatsApp is a React Native mobile app for UWaterloo students to connect and chat with classmates in their courses - a student-only space free from instructor and TA restrictions. Built with Supabase as the backend.

---

## Phase 1: Setup & Planning (Week 1)

### Development Environment

- [x] Install Node.js (v18+) and npm/yarn
- [x] Install React Native CLI and dependencies (using Expo)
- [x] Set up React Native project: `npx create-expo-app WatsApp`
- [ ] Install Expo Go app on mobile device for testing
- [x] Set up version control with Git/GitHub

### Supabase Setup

- [ ] Create free Supabase account at supabase.com
- [ ] Create new Supabase project
- [ ] Note your project URL and anon key
- [ ] Enable email authentication in Supabase dashboard

### Design & UX

- [ ] Create wireframes for 4 core screens (Login, Courses, Matches, Profile)
- [ ] Design app branding (logo, colors - UW gold/black theme)
- [ ] Plan user flow diagram
- [ ] Create component hierarchy

### Research

- [ ] Research Quest schedule format for parsing
- [ ] Determine data privacy requirements (FIPPA compliance)
- [ ] Plan email verification flow
- [ ] Integrate UWaterloo class schedule (https://classes.uwaterloo.ca/uwpcshtm.html) for searchable course list

---

## Phase 2: Backend Setup with Supabase (Week 2)

### Database Schema

Create these tables in Supabase SQL Editor:

```sql
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
```

### Supabase Realtime Setup

Enable Realtime for chat functionality:

```sql
-- Enable Realtime on messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
```

Create a function to find matches:

```sql
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
```

### Email Configuration

- [ ] Configure email templates in Supabase dashboard
- [ ] Customize verification email with UWaterloo branding
- [ ] Set up custom SMTP (optional - for better deliverability)
- [ ] Test email delivery to @uwaterloo.ca addresses

### Supabase Tasks

- [ ] Create all database tables
- [ ] Set up Row Level Security policies
- [ ] Create database functions for matching
- [ ] Configure email authentication settings
- [ ] Test database connections
- [ ] Add sample data for testing

---

## Phase 3: Frontend Development (Week 3-4)

### Expo Setup

```bash
# Navigate to project directory
cd WatsApp

# Install Supabase client
npm install @supabase/supabase-js

# Install secure storage for Expo
npm install expo-secure-store

# Install additional utilities (if needed)
npm install @react-native-async-storage/async-storage
```

**Note**: Expo Router and React Navigation are already included in the Expo project.

### Supabase Client Setup

Create `lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Expo SecureStore adapter for Supabase
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

Create `.env` file in project root:
```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url_here
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

### Authentication Service

Create `src/services/authService.js`:

```javascript
import { supabase } from "../lib/supabase";

export const authService = {
  // Sign up with WatIAM ID
  signUp: async (watiamId, name, password) => {
    const email = `${watiamId}@uwaterloo.ca`;

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    // Create profile
    const { error: profileError } = await supabase.from("profiles").insert({
      id: authData.user.id,
      watiam_id: watiamId,
      email,
      name,
    });

    if (profileError) throw profileError;

    return authData;
  },

  // Sign in
  signIn: async (watiamId, password) => {
    const email = `${watiamId}@uwaterloo.ca`;
    return await supabase.auth.signInWithPassword({ email, password });
  },

  // Sign out
  signOut: async () => {
    return await supabase.auth.signOut();
  },

  // Get current session
  getSession: async () => {
    return await supabase.auth.getSession();
  },
};
```

### Course Service

Create `src/services/courseService.js`:

```javascript
import { supabase } from "../lib/supabase";

export const courseService = {
  // Parse course codes from text
  parseCourses: (text) => {
    const coursePattern = /[A-Z]{2,4}\s*\d{3}[A-Z]?/gi;
    const matches = text.match(coursePattern) || [];
    return [
      ...new Set(
        matches.map((c) => c.replace(/\s+/g, " ").toUpperCase().trim())
      ),
    ];
  },

  // Add courses for user
  addCourses: async (userId, courseCodes) => {
    // First, ensure courses exist in courses table
    const courseInserts = courseCodes.map((code) => ({
      course_code: code,
      term: "Winter 2025",
    }));

    const { data: courses, error: courseError } = await supabase
      .from("courses")
      .upsert(courseInserts, {
        onConflict: "course_code,term",
        ignoreDuplicates: true,
      })
      .select();

    if (courseError) throw courseError;

    // Create course chats if they don't exist
    const chatInserts = courses.map((course) => ({
      course_id: course.id,
    }));

    await supabase
      .from("course_chats")
      .upsert(chatInserts, { onConflict: "course_id", ignoreDuplicates: true });

    // Then link to user
    const userCourseInserts = courses.map((course) => ({
      user_id: userId,
      course_id: course.id,
    }));

    const { error: linkError } = await supabase
      .from("user_courses")
      .upsert(userCourseInserts, {
        onConflict: "user_id,course_id",
        ignoreDuplicates: true,
      });

    if (linkError) throw linkError;
  },

  // Get user's courses
  getUserCourses: async (userId) => {
    const { data, error } = await supabase
      .from("user_courses")
      .select("*, courses(*)")
      .eq("user_id", userId);

    if (error) throw error;
    return data;
  },

  // Remove course
  removeCourse: async (userCourseId) => {
    const { error } = await supabase
      .from("user_courses")
      .delete()
      .eq("id", userCourseId);

    if (error) throw error;
  },

  // Find matches using the database function
  findMatches: async (userId) => {
    const { data, error } = await supabase.rpc("get_course_matches", {
      target_user_id: userId,
    });

    if (error) throw error;
    return data;
  },
};
```

### Chat Service

Create `src/services/chatService.js`:

```javascript
import { supabase } from "../lib/supabase";

export const chatService = {
  // Get course chat room
  getCourseChatRoom: async (courseId) => {
    const { data, error } = await supabase
      .from("course_chats")
      .select("*")
      .eq("course_id", courseId)
      .single();

    if (error) throw error;
    return data;
  },

  // Get messages for a course chat
  getCourseMessages: async (courseChatId, limit = 50) => {
    const { data, error } = await supabase
      .from("messages")
      .select("*, profiles(name, watiam_id)")
      .eq("course_chat_id", courseChatId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data.reverse(); // Show oldest first
  },

  // Send message to course chat
  sendCourseMessage: async (courseChatId, userId, content) => {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        course_chat_id: courseChatId,
        user_id: userId,
        content,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Subscribe to new messages in real-time
  subscribeToCourseMessages: (courseChatId, callback) => {
    return supabase
      .channel(`course-chat-${courseChatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `course_chat_id=eq.${courseChatId}`,
        },
        callback
      )
      .subscribe();
  },

  // Direct messages
  getDirectMessages: async (userId, otherUserId) => {
    const { data, error } = await supabase
      .from("direct_messages")
      .select(
        "*, sender:profiles!sender_id(name), receiver:profiles!receiver_id(name)"
      )
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .or(`sender_id.eq.${otherUserId},receiver_id.eq.${otherUserId}`)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data;
  },

  sendDirectMessage: async (senderId, receiverId, content) => {
    const { data, error } = await supabase
      .from("direct_messages")
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        content,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};
```

### Screen Components

#### 1. Login/Signup Screen

```javascript
Features:
- Input for WatIAM ID (e.g., "j23smith")
- Automatically appends @uwaterloo.ca
- Input for full name (signup only)
- Password input
- Toggle between login/signup
- Email verification notice
- App logo and branding
```

#### 2. Email Verification Screen

```javascript
Features:
- Message to check email
- Resend verification button
- Manual code input (if needed)
```

#### 3. Course Input Screen

```javascript
Features:
- Text area for pasting Quest schedule
- Course parsing with live preview
- Manual course input form
- Display parsed courses as chips
- Add/remove courses
- Save button
```

#### 4. My Courses Screen

```javascript
Features:
- List of all added courses
- Each course shows chat icon and member count
- Tap course to open chat
- Edit/delete courses
- Navigate to find classmates
```

#### 5. Course Chat Screen (PRIMARY FEATURE)

```javascript
Features:
- Real-time chat for each course
- Message bubbles (user's messages on right)
- Show sender name and timestamp
- Text input at bottom
- Send button
- Auto-scroll to latest message
- Pull to refresh for message history
- Only students in the course can see/send messages
```

#### 6. Classmates Screen (formerly Matches)

```javascript
Features:
- List of students with common courses
- Match count badge
- Course overlap display
- Tap to view profile or DM
- Filter by specific course
```

#### 7. Direct Messages Screen

```javascript
Features:
- List of ongoing DM conversations
- Unread message badges
- Tap to open conversation
- Similar to course chat but 1-on-1
```

#### 8. Profile Screen

```javascript
Features:
- User info display
- List of user's courses
- Edit name/program/year
- Logout button
- Delete account
```

### State Management with Context

Create `src/context/AuthContext.js`:

```javascript
import React, { createContext, useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
```

### Frontend Tasks

- [ ] Set up Supabase client
- [ ] Create authentication service
- [ ] Create course service
- [ ] Create chat service with Realtime
- [ ] Set up navigation structure (Stack + Bottom Tabs)
- [ ] Create reusable components (Button, Card, CourseChip, MessageBubble)
- [ ] Implement login/signup flow
- [ ] Build email verification screen
- [ ] Build course input and parsing UI
- [ ] Create course list screen with chat access
- [ ] **Implement real-time course chat (CORE FEATURE)**
- [ ] Build classmates discovery screen
- [ ] Implement direct messaging
- [ ] Add profile management
- [ ] Add loading states and error handling
- [ ] Test real-time message delivery
- [ ] Test all CRUD operations

---

## Phase 4: Authentication Implementation (Week 5)

### Email Verification Flow

**Simplified Flow (No Password Initially)**

1. User enters WatIAM ID (e.g., "j23smith")
2. User enters full name
3. App generates temporary password or uses magic link
4. Verification email sent to j23smith@uwaterloo.ca
5. User clicks link to verify
6. Account activated

**Alternative: OTP Code**

- Use Supabase's built-in OTP via email
- User enters 6-digit code
- No password needed (more secure!)

### Supabase Auth Configuration

- [ ] Enable email auth in Supabase dashboard
- [ ] Configure redirect URLs for mobile app
- [ ] Customize email templates
- [ ] Set up email rate limiting
- [ ] Test verification flow end-to-end

### Email Restrictions

- [ ] Add validation: only @uwaterloo.ca emails
- [ ] Consider: email domain verification in database trigger
- [ ] Handle bounced emails

```sql
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
```

---

## Phase 5: Core Features - Real-Time Chat (Week 6)

### Chat Implementation Priority

**WatsApp is primarily a chat app**, so this is the most important feature:

1. **Course Chat Rooms**

   - Auto-create chat room when course is added
   - Only students enrolled in the course can access
   - Real-time message updates using Supabase Realtime
   - Message history with pagination

2. **Real-Time Features**

   ```javascript
   // Example: Subscribe to new messages
   const subscription = chatService.subscribeToCourseMessages(
     courseChatId,
     (payload) => {
       // Update UI with new message
       setMessages((prev) => [...prev, payload.new]);
     }
   );
   ```

3. **Message Features**
   - Text messages only (MVP)
   - Sender name display
   - Timestamps (relative: "2 min ago")
   - Auto-scroll to latest
   - Send on Enter (keyboard)

### Course Parsing Algorithm

```javascript
Features needed:
- Regex pattern: /[A-Z]{2,4}\s*\d{3}[A-Z]?/gi
- Handle Quest format variations
- Extract course code and section
- Validate against known patterns
- Deduplicate courses
```

### Implementation Tasks

- [ ] Write course parsing function with tests
- [ ] Set up Supabase Realtime subscriptions
- [ ] Build chat UI components (MessageBubble, ChatInput)
- [ ] Implement real-time message sending/receiving
- [ ] Add message history loading
- [ ] Test chat with multiple users simultaneously
- [ ] Add typing indicators (optional for MVP)
- [ ] Implement direct messaging
- [ ] Add client-side filtering for classmates
- [ ] Cache messages in AsyncStorage for offline viewing

---

## Phase 6: Testing (Week 7)

### Backend Testing

- [ ] Test all database queries in Supabase SQL editor
- [ ] Test RLS policies (ensure users can only access their courses' chats)
- [ ] Test course parsing edge cases
- [ ] Test real-time message delivery between multiple clients
- [ ] Test direct message privacy (can't see others' DMs)
- [ ] Verify chat room creation on course add
- [ ] Test with 50+ sample users and messages

### Frontend Testing

- [ ] Test authentication flow completely
- [ ] Test course add/remove
- [ ] **Test real-time chat functionality**
- [ ] Test message sending/receiving
- [ ] Test chat with 2+ users simultaneously
- [ ] Test direct messaging
- [ ] Test classmates discovery
- [ ] Test on iOS and Android devices
- [ ] Test various screen sizes
- [ ] Test offline behavior (cached messages)
- [ ] Test error handling (no internet, message send failures)
- [ ] Test Realtime reconnection after network loss

### User Testing

- [ ] Recruit 10-20 UWaterloo students for beta testing
- [ ] Use TestFlight (iOS) and Google Play Beta (Android)
- [ ] Gather feedback on UX
- [ ] Track bugs using GitHub Issues
- [ ] Iterate based on feedback

---

## Phase 7: Polish & Launch Prep (Week 8)

### Polish

- [ ] Design app icon and splash screen
- [ ] Add loading animations
- [ ] Improve error messages
- [ ] Add empty states for all screens
- [ ] Implement pull-to-refresh
- [ ] Add haptic feedback
- [ ] Dark mode support (optional)

### Security & Privacy

- [ ] Review RLS policies one more time
- [ ] Add privacy policy and terms of service
- [ ] Implement account deletion flow
- [ ] Add user blocking/reporting (optional for MVP)
- [ ] Test token expiration handling

### Performance

- [ ] Optimize course list rendering
- [ ] Implement pagination for matches
- [ ] Add loading skeletons
- [ ] Test app on older devices
- [ ] Minimize app bundle size

---

## Phase 8: Deployment (Week 9)

### Supabase Production Setup

- [ ] Review database indexes for performance
- [ ] Set up database backups (automatic in Supabase)
- [ ] Configure production email settings
- [ ] Set up monitoring in Supabase dashboard
- [ ] Review rate limits and quotas

### Mobile App Deployment with Expo

**Option 1: EAS Build (Recommended)**
```bash
# Install EAS CLI
npm install -g eas-cli

# Configure EAS
eas build:configure

# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

**Option 2: Expo Application Services (Free Tier)**
- [ ] Create Expo account
- [ ] Configure app.json with proper identifiers
- [ ] Build using EAS Build
- [ ] Test builds with TestFlight (iOS) and internal testing (Android)

**App Store Submission**
- [ ] Create Apple Developer account ($99/year)
- [ ] Submit iOS build via EAS Submit or manually
- [ ] Create App Store listing
- [ ] Submit for review (7-14 days)

**Google Play Submission**
- [ ] Create Google Play Developer account ($25 one-time)
- [ ] Submit Android build via EAS Submit or manually
- [ ] Create Play Store listing
- [ ] Submit for review (1-3 days)

### Marketing Materials

- [ ] Create app screenshots (5-8 per platform)
- [ ] Write compelling app description
- [ ] Design promotional graphics
- [ ] Create 15-30 second demo video
- [ ] Prepare social media posts

---

## Phase 9: Launch (Week 10-11)

### Soft Launch

- [ ] Release to TestFlight/Beta first
- [ ] Monitor Supabase dashboard for issues
- [ ] Check user signup flow
- [ ] Verify email delivery
- [ ] Make quick fixes if needed

### Public Launch

- [ ] Publish to App Store and Google Play
- [ ] Announce on r/uwaterloo with focus on "student-only chat space"
- [ ] Post in UWaterloo Facebook groups
- [ ] Share in Discord servers (CS, Math, Eng) - emphasize privacy from TAs/profs
- [ ] Email student clubs and organizations
- [ ] Create Instagram/TikTok content showing the chat feature
- [ ] Consider poster campaign: "Chat with your classmates freely - No TAs, No Profs"
- [ ] Partner with course clubs (CSCLUB, MathSoc, etc.)

### Monitoring

- [ ] Track signups in Supabase dashboard
- [ ] Monitor database performance
- [ ] **Track chat engagement (messages per user, active chats)**
- [ ] Check email delivery rates
- [ ] Monitor Realtime connection stability
- [ ] Gather user feedback via in-app form
- [ ] Track course chat activity (which courses are most active)

---

## Post-Launch Roadmap

### Version 1.1 Features

- Push notifications for new messages
- Image/file sharing in chats
- Reactions to messages (emojis)
- Message threading (reply to specific messages)
- Anonymous posting option
- Voice messages

### Version 1.2 Features

- Study group formation with dedicated group chats
- Course resources sharing (notes, practice problems)
- Event planning (study sessions, exam prep)
- Polls in course chats
- Link previews
- Message search

---

## Budget Estimate

### Development Costs

- Supabase Free Tier: $0/month (500MB database, 50k monthly active users)
- Domain name: $15/year (optional)
- Apple Developer: $99/year
- Google Play Developer: $25 one-time
- **Total Year 1: ~$140**

### When You'll Need to Upgrade Supabase

- Pro Plan ($25/month): When you exceed 8GB database or 100k MAU
- Likely not needed until 1,000+ active users

---

## Advantages of Expo + Supabase + Chat-First Approach

✅ **Expo simplifies mobile development** - no native config needed for MVP
✅ **Expo Go for instant testing** - test on real devices without builds
✅ **EAS Build for production** - managed build service for iOS/Android
✅ **No backend code to write initially** - just database queries
✅ **Built-in authentication** - email verification included
✅ **Real-time capabilities built-in** - perfect for chat!
✅ **Free tier is generous** - perfect for MVP
✅ **Scales automatically** - no server management
✅ **Row Level Security** - secure chat rooms by default
✅ **Great documentation** - easy to learn
✅ **Fast development** - launch in weeks not months
✅ **Student-only space** - enforced by @uwaterloo.ca email requirement
✅ **Chat-first design** - exactly what students want for course discussions

---

## Development Timeline Summary

| Phase                | Duration   | Key Deliverables                  |
| -------------------- | ---------- | --------------------------------- |
| Setup & Planning     | Week 1     | Project structure, Supabase setup |
| Database Setup       | Week 2     | Schema, RLS policies, functions   |
| Frontend Development | Week 3-4   | All screens, Supabase integration |
| Authentication       | Week 5     | Email verification working        |
| Core Features        | Week 6     | Parsing, matching live            |
| Testing              | Week 7     | Bug-free MVP                      |
| Polish & Launch Prep | Week 8     | Production-ready                  |
| Deployment           | Week 9     | Apps submitted                    |
| Launch               | Week 10-11 | Public release                    |

**Total Time: 10-11 weeks (~2.5 months)**

---

## Next Immediate Steps

1. ✅ Set up Expo project
2. [ ] Create Supabase account and project
3. [ ] Create database schema in Supabase
4. [ ] Install Supabase client and expo-secure-store
5. [ ] Configure environment variables
6. [ ] Test database connection
7. [ ] Build login screen prototype with Expo Router

**Ready to build with Expo + Supabase! 🚀**
