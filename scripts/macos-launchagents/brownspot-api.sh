#!/bin/bash
set -euo pipefail
LOG_DIR="${HOME}/Library/Logs/brownspot"
mkdir -p "$LOG_DIR"
CLI_DIR="${BROWNSPOT_CLI_DIR:-$HOME/Projects/Project BrownSpot/CLI}"
ENV_FILE="${BROWNSPOT_ENV_FILE:-$CLI_DIR/.env}"
BUN_BIN="${BROWNSPOT_BUN_BIN:-$HOME/.bun/bin/bun}"
if [[ ! -x "$BUN_BIN" ]]; then
  BUN_BIN="$(command -v bun || true)"
fi
if [[ -z "${BUN_BIN}" || ! -x "$BUN_BIN" ]]; then
  echo "bun not found" >&2
  exit 1
fi
cd "$CLI_DIR"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
export BROWNSPOT_API_HOST="${BROWNSPOT_API_HOST:-127.0.0.1}"
export BROWNSPOT_API_PORT="${BROWNSPOT_API_PORT:-8787}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:$PATH"
exec "$BUN_BIN" run src/server/index.ts >>"$LOG_DIR/api.stdout.log" 2>>"$LOG_DIR/api.stderr.log"
