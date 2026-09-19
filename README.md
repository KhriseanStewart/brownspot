# BrownSpot

Terminal AI agent (`dotstart`). Desktop and mobile apps planned.

## Install (from your terminal)

### macOS / Linux / WSL / Git Bash (Windows)

```bash
curl -fsSL https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.sh | bash
```

### Windows PowerShell / Windows Terminal

Same idea — one line in the terminal:

```powershell
irm https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.ps1 | iex
```

Or from **cmd.exe** / any shell that has `curl`:

```bat
curl -fsSL https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.ps1 -o %TEMP%\bs-install.ps1 && powershell -ExecutionPolicy Bypass -File %TEMP%\bs-install.ps1
```

- PowerShell / cmd install to `%LOCALAPPDATA%\BrownSpot\bin`
- bash / Git Bash install to `~/.local/bin` (override with `BROWNSPOT_INSTALL_DIR`)

Pin a version:

```bash
BROWNSPOT_VERSION=0.0.3 curl -fsSL https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.sh | bash
```

```powershell
$env:BROWNSPOT_VERSION = "0.0.3"
irm https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.ps1 | iex
```

Then in that same terminal:

```bash
dotstart login
dotstart
```

## Auth (Clerk)

Works the same on Windows, macOS, and Linux:

- Browser PKCE against `https://clerk.brownspot.terobytez.com`
- Local callback `http://127.0.0.1:8788/callback` (allow Windows Firewall if prompted)
- Google SSO enabled in Clerk
- Chat always requires login; `/whoami`, `/logout`, `/login` in the REPL

## Develop from source

```bash
cd CLI
bun install
cp .env.example .env
bun run dev
```

## Layout

- `CLI/` — Bun agent CLI
- `scripts/install.sh` — macOS / Linux / WSL / Git Bash
- `scripts/install.ps1` — Windows PowerShell / Windows Terminal
