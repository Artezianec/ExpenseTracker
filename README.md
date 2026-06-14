<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Budgeted — shared expense tracker

React + Vite app for tracking shared budgets and expenses. Uses **ApexStream** for end-user auth, realtime WebSocket, and Document Database (no Firebase).

Patterns follow [apexstream/examples](https://github.com/apexstream/examples) (`auth-email-password`, `document-db`).

## Run locally

**Prerequisites:** Node.js, running ApexStream stack (API + gateway), Document DB enabled (`APEXSTREAM_DATABASE_ENABLED=true`).

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill in ApexStream keys from your dashboard
3. Optional: set `GEMINI_API_KEY` for AI spending insights
4. Start **two processes** (writes need the Budget API server):
   - Terminal 1: `npm run dev:server` (uses `APEXSTREAM_SECRET_KEY=sk_live_…`)
   - Terminal 2: `npm run dev`
   - Or: `npm run dev:all`

### Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_APEXSTREAM_APP_ID` | browser | App id (auth) |
| `VITE_APEXSTREAM_PUBLISHABLE_KEY` | browser | Publishable key `pk_live_…` (auth) |
| `VITE_APEXSTREAM_CONTROL_PLANE_URL` | browser | Control plane HTTP |
| `VITE_APEXSTREAM_WS_URL` | browser | Gateway WebSocket `…/v1/ws` |
| `VITE_APEXSTREAM_API_KEY` | browser | Read/subscribe key `pk_live_…` |
| `APEXSTREAM_SECRET_KEY` | **server only** | Write key `sk_live_…` for Budget API |

Browser reads + live `db.*` subscriptions use `pk_live_`. All mutations go through `server/index.mjs`, which verifies the user session and writes with `sk_live_` (see [document-db example](https://github.com/apexstream/examples/tree/main/document-db)).

## Data model (ApexStream Document DB)

Collections: `users`, `groups`, `expenses`, `members` — flat documents with live `db.*` subscriptions.
