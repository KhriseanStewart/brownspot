# BrownSpot

Terminal AI agent (`dotstart`). Desktop and mobile apps planned.

## Install

### macOS / Linux (and WSL)

```bash
curl -fsSL https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.sh | bash
```

Installs to `~/.local/bin` (override with `BROWNSPOT_INSTALL_DIR`).

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.ps1 | iex
```

Installs to `%LOCALAPPDATA%\BrownSpot\bin` (override with `$env:BROWNSPOT_INSTALL_DIR`). Add that folder to your user PATH if the installer says it is missing.

Pin a version:

```bash
# macOS / Linux
BROWNSPOT_VERSION=0.0.2 curl -fsSL https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.sh | bash
```

```powershell
# Windows
$env:BROWNSPOT_VERSION = "0.0.2"
irm https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.ps1 | iex
```

Then:

```bash
dotstart login
dotstart
```

On Windows the binary is `dotstart.exe`; PowerShell still accepts `dotstart`.

## Auth (Clerk)

Works the same on Windows, macOS, and Linux:

- Browser PKCE login against `https://clerk.brownspot.terobytez.com`
- Local callback: `http://127.0.0.1:8788/callback` (allow through Windows Firewall if prompted)
- Google SSO is enabled in the Clerk dashboard
- Chat always requires login; `/whoami`, `/logout`, `/login` work in the REPL

## Develop from source

```bash
cd CLI
bun install
cp .env.example .env
# set AGENT_API_KEY, AGENT_MODEL, and Clerk keys (see CLI/README.md)
bun run db:migrate   # optional local Postgres
bun run dev          # opens Clerk login if needed, then chat
```

## Layout

- `CLI/` — Bun agent CLI
- `desktop/` — planned
- `mobile/` — planned
- `scripts/install.sh` — macOS / Linux / WSL installer
- `scripts/install.ps1` — Windows installer

## Release binaries

`dotstart-darwin-*`, `dotstart-linux-*`, `dotstart-windows-x64.exe`, `dotstart-windows-arm64.exe`.
