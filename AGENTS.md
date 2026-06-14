# AGENTS.md

## Cursor Cloud specific instructions

This is a single-page **React 19 + Vite + TypeScript** app ("Budgeted – Shared Expense Tracker"). It uses **Firebase** (Firestore + Google Auth) and an optional **Gemini** AI insights feature.

### Commands (see `package.json` scripts)
- Lint/typecheck: `npm run lint` (runs `tsc --noEmit`)
- Build: `npm run build` (`vite build`)
- Dev server: `npm run dev` (serves on `0.0.0.0:3000`)

### Services
There is only one service: the Vite dev server. The Express / better-sqlite3 packages in `package.json` are unused (no server entrypoint exists); everything runs client-side against a hosted Firebase project.

### Non-obvious notes
- Firebase config is committed in `firebase-applet-config.json` and pointed at a shared hosted demo project (`makersuite-showcase`). There is no local Firebase emulator; the running app talks to the real hosted Firestore/Auth.
- **Authentication is Google-only** (`signInWithPopup`). The entire app (dashboard, groups, expenses) is gated behind sign-in, and Firestore rules deny all access when `request.auth == null`.
- The committed `makersuite-showcase` project does **not** authorize `localhost` for OAuth (verified via the Identity Toolkit `authorizedDomains` list), so signing in against the real project from a local dev server fails with `auth/unauthorized-domain`. This is a Google-owned shared demo project and cannot be changed from this repo.
- To exercise authenticated flows locally (sign in, create group, add expense), use the **Firebase Local Emulator Suite** (`firebase emulators:start` with `auth` + `firestore`, loading `firestore.rules`) and temporarily point the client at it via `connectAuthEmulator(auth, 'http://127.0.0.1:9099')` and `connectFirestoreEmulator(db, '127.0.0.1', 8080)` in `src/firebase.ts`. The Auth emulator lets you create a fake Google test user with no real credentials. Revert that temporary wiring before committing. `firebase-tools` is not a project dependency (install it ad hoc, e.g. into a temp prefix); the emulators need Java (already present).
- This is a demo app: signed-in user data is auto-deleted 24 hours after first sign-in (see the demo-reset logic in `src/App.tsx`).
- `GEMINI_API_KEY` (read in `vite.config.ts` and used in `src/components/GroupView.tsx`) is only needed for the optional "AI insights" feature. The app builds and runs without it; only that one feature will error if invoked.
- HMR can be disabled by setting `DISABLE_HMR=true` (see `vite.config.ts`).
