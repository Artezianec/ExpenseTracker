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
- **Authentication is Google-only** (`signInWithPopup`). The entire app (dashboard, groups, expenses) is gated behind sign-in, and Firestore rules deny all access when `request.auth == null`. End-to-end testing of core flows (create group, add expense) therefore requires an interactive Google login through the Desktop pane — it cannot be scripted headlessly.
- This is a demo app: signed-in user data is auto-deleted 24 hours after first sign-in (see the demo-reset logic in `src/App.tsx`).
- `GEMINI_API_KEY` (read in `vite.config.ts` and used in `src/components/GroupView.tsx`) is only needed for the optional "AI insights" feature. The app builds and runs without it; only that one feature will error if invoked.
- HMR can be disabled by setting `DISABLE_HMR=true` (see `vite.config.ts`).
