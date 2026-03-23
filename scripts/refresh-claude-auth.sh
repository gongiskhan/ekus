#!/bin/bash
# Refresh Claude Code OAuth token before it expires.
#
# Claude Code on macOS stores credentials in Keychain, which is inaccessible
# from SSH/cron. This script maintains file-based copies that work everywhere.
#
# Strategy:
#   1. Try to read from .credentials.json (with dot, Claude Code's file format)
#   2. If missing, try to extract from macOS Keychain via osascript (GUI context)
#   3. If that fails, fall back to credentials.json (without dot, our backup)
#   4. After refresh, write to BOTH files so we always have a backup
#
# Usage: ./scripts/refresh-claude-auth.sh [--force]

set -euo pipefail

LOG_TAG="[refresh-claude-auth]"
CLIENT_ID="9d1c250a-e61b-44d9-88ed-5944d1962f5e"
TOKEN_URL="https://platform.claude.com/v1/oauth/token"
USER_AGENT="claude-code/2.1.80"
CREDS_DOT="$HOME/.claude/.credentials.json"
CREDS_NODOT="$HOME/.claude/credentials.json"

log() { echo "$LOG_TAG $(date '+%Y-%m-%d %H:%M:%S') $*" >&2; }

# ── Step 1: Find credentials ────────────────────────────────────────

CREDS_FILE=""
if [ -f "$CREDS_DOT" ]; then
  CREDS_FILE="$CREDS_DOT"
elif [ -f "$CREDS_NODOT" ]; then
  CREDS_FILE="$CREDS_NODOT"
fi

# Step 2: If no file, try extracting from macOS Keychain via GUI context
if [ -z "$CREDS_FILE" ]; then
  log "No credentials file found. Trying Keychain extraction via osascript..."
  TMPFILE=$(mktemp)
  osascript -e "tell application \"Terminal\"
    do script \"security find-generic-password -s \\\"Claude Code-credentials\\\" -a \\\"ggomes\\\" -w > $TMPFILE 2>&1\"
  end tell" 2>/dev/null || true
  sleep 3

  if [ -s "$TMPFILE" ] && python3 -c "import json; json.load(open('$TMPFILE'))" 2>/dev/null; then
    python3 -c "
import json
with open('$TMPFILE') as f:
    creds = json.load(f)
with open('$CREDS_DOT', 'w') as f:
    json.dump(creds, f, indent=2)
with open('$CREDS_NODOT', 'w') as f:
    json.dump(creds, f, indent=2)
print('Extracted credentials from Keychain')
"
    CREDS_FILE="$CREDS_DOT"
    log "Extracted credentials from Keychain to files."
  else
    rm -f "$TMPFILE"
    log "ERROR: No credentials file and Keychain extraction failed."
    exit 1
  fi
  rm -f "$TMPFILE"
fi

log "Using credentials: $CREDS_FILE"

# ── Step 3: Check expiry ────────────────────────────────────────────

EXPIRES_AT=$(python3 -c "
import json
with open('$CREDS_FILE') as f:
    print(json.load(f)['claudeAiOauth']['expiresAt'])
")
REFRESH_TOKEN=$(python3 -c "
import json
with open('$CREDS_FILE') as f:
    print(json.load(f)['claudeAiOauth']['refreshToken'])
")

NOW_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
REMAINING_MS=$((EXPIRES_AT - NOW_MS))
REMAINING_S=$((REMAINING_MS / 1000))

FORCE="${1:-}"

if [ "$FORCE" != "--force" ] && [ "$REMAINING_S" -gt 0 ]; then
  # Refresh if less than 2 hours remain (gives margin for 6h cron interval)
  if [ "$REMAINING_S" -gt 7200 ]; then
    log "Token still valid for ${REMAINING_S}s ($(python3 -c "print(f'{$REMAINING_S/3600:.1f}h')")). Skipping."
    exit 0
  fi
  log "Token expires in ${REMAINING_S}s — refreshing..."
else
  if [ "$REMAINING_S" -le 0 ]; then
    log "Token EXPIRED $((-REMAINING_S))s ago — refreshing..."
  else
    log "Force refresh requested. Token has ${REMAINING_S}s remaining."
  fi
fi

# ── Step 4: Refresh token ───────────────────────────────────────────

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$TOKEN_URL" \
  -H "Content-Type: application/json" \
  -H "User-Agent: $USER_AGENT" \
  -d "{\"grant_type\":\"refresh_token\",\"refresh_token\":\"$REFRESH_TOKEN\",\"client_id\":\"$CLIENT_ID\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  log "ERROR: Refresh failed with HTTP $HTTP_CODE: $BODY"
  exit 1
fi

# ── Step 5: Write to BOTH credential files ──────────────────────────

python3 -c "
import json, time, os

resp = json.loads('''$BODY''')

new_oauth = {
    'accessToken': resp['access_token'],
    'refreshToken': resp['refresh_token'],
    'expiresAt': int(time.time() * 1000) + (resp['expires_in'] * 1000),
    'scopes': 'user:inference user:mcp_servers user:profile user:sessions:claude_code'
}

creds = {'claudeAiOauth': new_oauth}

# Write to both files
for path in ['$CREDS_DOT', '$CREDS_NODOT']:
    # Read existing file to preserve any extra keys
    try:
        with open(path) as f:
            existing = json.load(f)
        existing['claudeAiOauth'] = new_oauth
    except:
        existing = creds

    with open(path, 'w') as f:
        json.dump(existing, f, indent=2)
    os.chmod(path, 0o600)

import datetime
exp = datetime.datetime.fromtimestamp(new_oauth['expiresAt'] / 1000)
ttl_h = resp['expires_in'] / 3600
print(f'New expiry: {exp} (TTL: {ttl_h:.1f}h)')
"

log "Token refreshed successfully. Written to both credential files."
