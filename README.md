# BrownSpot

Terminal AI agent CLI (`dotstart`), with desktop and mobile apps planned.

## Install (curl)

```bash
curl -fsSL https://raw.githubusercontent.com/KhriseanStewart/brownspot/main/scripts/install.sh | bash
```

This downloads the matching standalone binary from [GitHub Releases](https://github.com/KhriseanStewart/brownspot/releases) and installs `dotstart` to `~/.local/bin` (created if needed). Pin a version with `BROWNSPOT_VERSION=0.0.1`.

Then run:

```bash
dotstart
```

If the installer warns that `~/.local/bin` is not on your `PATH`, add:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Layout

- `CLI/` — Bun agent CLI (publish + curl install target)
- `scripts/install.sh` — curl-friendly installer
- `desktop/` — planned
- `mobile/` — planned

## Quick start (dev with Bun)

```bash
cd CLI
bun install
cp .env.example .env
bun run dev
# or: bunx --bun .   /   bun link   then: dotstart
```

Build local standalones:

```bash
cd CLI
bun run build:all   # writes CLI/dist/dotstart-{darwin,linux}-{arm64,x64}
```
