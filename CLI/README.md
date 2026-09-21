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

The CLI opens a browser, listens on `http://127.0.0.1:8788/callback`, and stores tokens under `~/.agent-cli/` (same on Windows via `%USERPROFILE%\.agent-cli`). Chat is gated when `BROWNSPOT_AUTH_REQUIRED=true`.

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

- Phase 2: ~~optional `/index` project RAG~~ → `/refs` (FTS default; see section above)
- Phase 3: `/distill` patterns into Mem0 for new projects
- Phase 4: hosted Mem0 / AWS for desktop/mobile sync

## Windows

Native Windows builds ship as `dotstart-windows-*.exe`. Install with PowerShell:

```powershell
irm https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.ps1 | iex
```

Clerk PKCE still uses `http://127.0.0.1:8788/callback`. Allow the Windows Firewall prompt for the local callback if asked.


## Reference + active project RAG

Index the **active** workspace (cwd) and up to `BROWNSPOT_MAX_REFS` (default 3) **reference** projects as style/structure teachers. Same Postgres store; `project_role` is `active` | `reference`.

- **Default retrieval:** Postgres FTS (`tsvector` + GIN). Free/cheap.
- **Embeddings:** optional, off by default (`BROWNSPOT_REF_EMBEDDINGS=false`). When on, only high-value chunks (profile, README, pkg, configs, docs) are embedded via a cheap OpenRouter model and stored as `REAL[]`.
- **Budget:** ~3800 chars injected per coding turn; incremental reindex via content hash.
- **Events:** `project_events` records `added` / `ingested` / `reindexed` / `removed` / `activated` (see `/refs status`).

```bash
# After login, optionally paste 0–3 reference paths (Enter to skip).
# Or anytime in chat:
/refs                  # list
/refs add ~/code/good-app
/refs remove good-app
/refs reindex          # or /refs reindex <slug>
/refs status           # added vs last ingested

bun run db:migrate     # applies schema including RAG tables
```

Tools: `list_reference_projects`, `search_reference_context`. Local cache: `~/.agent-cli/refs.json`.

## Agent command catalog (Postgres)

Curated, extensible shell commands live in the `agent_commands` table (git, `gh`, SSH/SCP, Bun/npm, Docker, curl, system, DB, Cloudflare). The agent discovers them with `list_agent_commands` and runs them with `run_agent_command` (params are shell-quoted; high/critical ask for approval). Runs are audited in `agent_command_runs`.

```bash
bun run db:migrate
bun run db:seed-commands   # safe to re-run; upserts by slug
```

Add more later with another seed row or `INSERT`/`ON CONFLICT` against `agent_commands`. Ad-hoc commands still use `run_shell`.

## Edit review (Cursor-style diffs)

When the agent calls `write_file`, BrownSpot prints a **colored unified diff** (red removals / green additions) and asks you to approve with `y` before applying — so you can review the change from → to like Cursor.

## Graphify + memory (always on)

BrownSpot keeps a **Graphify** AST knowledge graph for the current workspace and turns **memory on by default** (local SQLite, or Mem0 Platform if `MEM0_API_KEY` is set).

```bash
# one-time host install of the Graphify CLI
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install 'graphifyy[watch,sql]'
```

On `dotstart` start: builds/updates `graphify-out/graph.json` (code-only, no OpenRouter) and starts `graphify watch`. Agent tools: `graph_query`, `graph_path`, `graph_explain`, `graph_god_nodes`, `graph_affected`. Slash: `/graphify …`.

Disable with `BROWNSPOT_GRAPHIFY=false` or `AGENT_MEM0=false`.

