# BrownSpot CLI

Terminal AI agent (Bun + TypeScript) with OpenRouter chat, file tools, token-saving context, Mem0 personal memory, Clerk login, and a small Hono API.

## Setup

```bash
bun install
cp .env.example .env
# edit .env — at least AGENT_API_KEY and AGENT_MODEL
```

### Local Postgres (Homebrew, no Docker)

```bash
brew install postgresql@16
brew services start postgresql@16
createdb brownspot   # once
bun run db:migrate
```

`DATABASE_URL` defaults to `postgresql://localhost/brownspot`.

## Auth (Clerk PKCE — Codex/Claude style)

The CLI opens a browser, listens on `http://127.0.0.1:{random}/callback`, and stores tokens under `~/.brownspot/`. Chat is gated when `BROWNSPOT_AUTH_REQUIRED=true`.

### 1) Clerk Dashboard

1. Create (or open) your Clerk application.
2. Create an **OAuth application** that is **Public** and uses **PKCE**.
3. Add this **exact** redirect URI (CLI listens on port 8788 by default):
   - `http://127.0.0.1:8788/callback`
   - Override with `BROWNSPOT_OAUTH_CALLBACK_PORT` if that port is taken
4. Copy the **Client ID** and your **Frontend API** URL (`https://….clerk.accounts.dev`).
5. Optionally copy the **Secret Key** for server-side token checks (`CLERK_SECRET_KEY`).

### 2) Paste into `.env`

```bash
CLERK_OAUTH_CLIENT_ID=…          # public PKCE OAuth client id
CLERK_FRONTEND_API=https://YOUR_INSTANCE.clerk.accounts.dev
CLERK_SECRET_KEY=sk_test_…       # or sk_live_…
CLERK_PUBLISHABLE_KEY=pk_test_…  # optional; from clerk env pull
```

### 3) Commands

```bash
bun run login     # browser PKCE login (also auto-runs from dev if needed)
bun run whoami    # show current user
bun run logout
bun run dev       # always requires login → then chat REPL
bun run api       # Hono API on :8787  (GET /health, /me, POST /v1/chat)
```

`bun run dev` always opens Clerk login if you are signed out, then enters chat.
In chat: `/whoami`, `/logout`, `/login`.

## Run

```bash
bun run dev
```

## Layout

```
src/
  index.ts              # CLI entry (login / logout / whoami + gated REPL)
  config.ts             # env
  agent/                # loop, tools, context, style, memory/
  auth/                 # PKCE, Clerk OAuth, credentials, session
  db/                   # Postgres client + schema + users
  server/               # Hono API (health, /me, /v1/chat)
  cli/commands/         # login, logout, whoami
```

## Personal memory (Phase 1)

**Preferred:** Mem0 Platform free tier via `mem0ai` (`MemoryClient`).

```bash
MEM0_API_KEY=m0-your-key
AGENT_USER_ID=alex          # optional; after login, Clerk `sub` is used if unset
AGENT_AGENT_ID=developer
AGENT_ROLE=developer
```

Commands: `/memory status`, `/memory search <query>`, `/memory on|off`.

**Fallback:** without a Mem0 key, `AGENT_MEM0=true` uses local Bun SQLite under `~/.agent-cli/mem0/`.

`AGENT_MEMORY.md` in the workspace still loads as static notes.

## Token savings

FIFO window + optional cheap-model summary of older turns (`src/agent/context.ts`). See `.env.example`.

## Roadmap

- Phase 2: optional `/index` project RAG
- Phase 3: `/distill` patterns into Mem0 for new projects
- Phase 4: hosted Mem0 / AWS for desktop/mobile sync
