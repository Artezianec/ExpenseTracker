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
4. Start: `npm run dev`

### Environment variables

| Variable | Purpose |
|----------|---------|
| `VITE_APEXSTREAM_APP_ID` | App id (auth) |
| `VITE_APEXSTREAM_PUBLISHABLE_KEY` | Publishable key `pk_live_…` (auth) |
| `VITE_APEXSTREAM_CONTROL_PLANE_URL` | Control plane HTTP |
| `VITE_APEXSTREAM_WS_URL` | Gateway WebSocket `…/v1/ws` |
| `VITE_APEXSTREAM_API_KEY` | Read/subscribe key `pk_live_…` |
| `VITE_APEXSTREAM_SECRET_KEY` | Optional write key `sk_live_…` for browser CRUD in dev |

For production writes, prefer a backend with `sk_live_` as in the document-db example.

## Data model (ApexStream Document DB)

Collections: `users`, `groups`, `expenses`, `members` — flat documents with live `db.*` subscriptions.
