<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Budgeted — shared expense tracker

React + Vite app for tracking shared budgets and expenses. Uses **Express + MySQL** with simple email/password auth (JWT).

## Run locally

**Prerequisites:** Node.js, MySQL server.

1. Create database: `CREATE DATABASE budgeted;`
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and set MySQL credentials + `JWT_SECRET`
4. Optional: set `GEMINI_API_KEY` for AI spending insights
5. Start **two processes**:
   - Terminal 1: `npm run dev:server` (API + MySQL)
   - Terminal 2: `npm run dev` (Vite frontend)
   - Or: `npm run dev:all`

### Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `MYSQL_HOST` | server | MySQL host |
| `MYSQL_USER` | server | MySQL user |
| `MYSQL_PASSWORD` | server | MySQL password |
| `MYSQL_DATABASE` | server | Database name (default `budgeted`) |
| `JWT_SECRET` | server | Secret for signing auth tokens |
| `BUDGET_API_PORT` | server | API port (default `3001`) |
| `GEMINI_API_KEY` | optional | AI insights feature |

The server auto-creates tables on startup (`server/schema.sql`). The Vite dev server proxies `/api` to the Budget API.

## Data model (MySQL)

Tables: `users`, `groups`, `group_members`, `expenses`.
