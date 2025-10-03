# WatsApp

WatsApp is an Expo + Supabase prototype that connects University of Waterloo students through course-based chats. The app runs on iOS, Android, and web via Expo Router.

## Prerequisites

- Node.js 18 or newer (Expo recommends the LTS release)
- A Supabase project with the base schema in `docs/schema.sql` and the incremental setup in `docs/supabase-setup.sql` applied
- `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` values in `src/.env`

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Ensure `src/.env` exports your Supabase URL and anon key. Optional: adjust `EXPO_DEV_SERVER_PORT` / `EXPO_WEB_PORT` for local port conflicts.
3. Start the Expo dev server:
   ```bash
   cd src
   npx expo start
   ```
4. Use the on-screen options to open the web build, iOS simulator, Android emulator, or Expo Go.

## Waterloo Email Login Flow

- Users sign in with their WatIAM ID (e.g. `j23smith`).
- The app sends a 6-digit Supabase OTP to the matching Waterloo address (`<watIam>@uwaterloo.ca`).
- Only Waterloo addresses are accepted; IDs are validated before the request is sent.
- After verifying the code, the app creates/updates the user profile in Supabase with their WatIAM ID, Waterloo email, and name.

If you need to test with a non-Waterloo inbox, adjust the validation logic in `src/services/authService.ts` or seed test users directly in Supabase.

## Profile & Account Management

- The Profile tab lets students upload an avatar, view their info, sign out, or delete their account.
- Avatar uploads use the Supabase storage bucket `profile-photos`. Make sure the bucket exists and the policies in `src/docs/supabase-setup.sql` are applied.
- Deleting an account calls the `delete_current_user()` RPC (also defined in `src/docs/supabase-setup.sql`) which removes the Supabase auth user and profile.
- Install the native dependency with `npx expo install expo-image-picker` after pulling these changes; the install failed in this offline environment.

## Project Structure Highlights

- `src/app` – Expo Router routes (authentication, tabs, modal screens)
- `src/context` – React context providers (e.g., authentication state)
- `src/services` – API/service layer including Supabase helpers
- `src/components` – Reusable UI primitives
- `docs/` – SQL and setup notes for the backend

## Useful Scripts

- `npm run lint` – Run Expo ESLint config
- `npm run reset-project` – Restore the Expo starter shell (see `src/scripts/reset-project.js`)

## Troubleshooting

- Metro port collisions → update `EXPO_DEV_SERVER_PORT` / `EXPO_WEB_PORT` in `src/.env`.
- OTP email not arriving → verify the Supabase SMTP provider is configured and the domain allows outgoing mail.
- SecureStore issues on web → falls back to `localStorage` automatically (see `src/lib/supabase.ts`).
