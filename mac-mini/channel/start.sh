#!/bin/bash
# Start Claude Code with the Ekus channel in a tmux session.
# Run this on the Mac Mini.

set -euo pipefail

export PATH="/opt/homebrew/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH"
EKUS_ROOT="$HOME/Projects/ekus"

cd "$EKUS_ROOT"

# Install channel server dependencies if needed
if [ ! -d "mac-mini/channel/node_modules" ]; then
  echo "Installing channel server dependencies..."
  cd mac-mini/channel && bun install && cd "$EKUS_ROOT"
fi

# Kill existing channel session if any
tmux kill-session -t ekus-claude 2>/dev/null || true

# Source .env for any needed vars
set -a
source .env 2>/dev/null || true
set +a

echo "Starting Claude Code with ekus-channel..."

# Start Claude in tmux with the channel enabled
tmux new-session -d -s ekus-claude \
  "export PATH=/opt/homebrew/bin:\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH; \
   cd $EKUS_ROOT && \
   source .env 2>/dev/null; \
   exec claude --dangerously-load-development-channels server:ekus-channel \
          --dangerously-skip-permissions"

sleep 2

# Check if session started
if tmux has-session -t ekus-claude 2>/dev/null; then
  echo "✅ ekus-claude tmux session started"
  # Open a visible Terminal window attached to the session
  osascript -e 'tell application "Terminal"
      activate
      do script "tmux attach -t ekus-claude"
  end tell' 2>/dev/null || echo "   (Could not open Terminal — attach manually: tmux attach -t ekus-claude)"
else
  echo "❌ Failed to start ekus-claude session"
  exit 1
fi
