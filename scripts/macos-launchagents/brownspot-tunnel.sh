#!/bin/bash
set -euo pipefail
LOG_DIR="${HOME}/Library/Logs/brownspot"
mkdir -p "$LOG_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
CLOUDFLARED="$(command -v cloudflared || true)"
if [[ -z "$CLOUDFLARED" ]]; then
  if [[ -x /opt/homebrew/bin/cloudflared ]]; then
    CLOUDFLARED=/opt/homebrew/bin/cloudflared
  else
    echo "cloudflared not found" >&2
    exit 1
  fi
fi
exec "$CLOUDFLARED" tunnel run brownspot-api >>"$LOG_DIR/tunnel.stdout.log" 2>>"$LOG_DIR/tunnel.stderr.log"
