# BrownSpot

Terminal AI agent (`dotstart`). Desktop and mobile apps planned.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.sh | bash
```

That installs `dotstart` into `~/.local/bin` (override with `BROWNSPOT_INSTALL_DIR`).

Pin a version:

```bash
BROWNSPOT_VERSION=0.0.2 curl -fsSL https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.sh | bash
```

Then:

```bash
dotstart login
dotstart
# or: bun run whoami / logout from a source checkout
```

Make sure `~/.local/bin` is on your `PATH`.

## Develop from source

```bash
cd CLI
bun install
cp .env.example .env
# set AGENT_API_KEY, AGENT_MODEL, and Clerk keys (see CLI/README.md)
bun run db:migrate   # optional local Postgres
bun run dev          # always opens Clerk login if needed, then chat
```

## Layout

- `CLI/` — Bun agent CLI
- `desktop/` — planned
- `mobile/` — planned
- `scripts/install.sh` — curl installer

## Auth

Clerk PKCE (production Frontend API: `https://clerk.brownspot.terobytez.com`). Google SSO is enabled in the Clerk dashboard. Chat always requires login; `/whoami`, `/logout`, and `/login` work inside the REPL.
