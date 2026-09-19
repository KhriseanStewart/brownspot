#!/bin/bash
# Install BrownSpot API + Cloudflare tunnel LaunchAgents (macOS).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS_SRC="$REPO_ROOT/scripts/macos-launchagents"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/brownspot"
mkdir -p "$LAUNCH_AGENTS" "$LOG_DIR"
chmod +x "$AGENTS_SRC/brownspot-api.sh" "$AGENTS_SRC/brownspot-tunnel.sh"

uid="$(id -u)"
for label in com.brownspot.api com.brownspot.tunnel; do
  plist="$LAUNCH_AGENTS/${label}.plist"
  # bootout if already loaded
  launchctl bootout "gui/$uid/$label" 2>/dev/null || launchctl unload "$plist" 2>/dev/null || true
  cp "$AGENTS_SRC/${label}.plist" "$plist"
  # Prefer bootstrap (modern)
  if launchctl bootstrap "gui/$uid" "$plist" 2>/dev/null; then
    launchctl enable "gui/$uid/$label" 2>/dev/null || true
    launchctl kickstart -k "gui/$uid/$label" 2>/dev/null || true
  else
    launchctl load -w "$plist"
  fi
done

echo "Loaded LaunchAgents:"
launchctl print "gui/$uid/com.brownspot.api" 2>&1 | head -20 || true
launchctl print "gui/$uid/com.brownspot.tunnel" 2>&1 | head -20 || true
echo "Logs: $LOG_DIR"
echo "Health check in ~5s..."
sleep 5
curl -fsS https://brownspot-api.terobytez.com/health || true
echo
