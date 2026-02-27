#!/usr/bin/env bash
# auto-learn-stop.sh — Stop hook
# Checks if a non-trivial task was completed without saving learnings.
# If so, blocks the stop and reminds Claude to reflect and save.

INPUT=$(cat)

# Prevent infinite loops: if stop hook already fired once, allow through
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
if [ "$STOP_ACTIVE" = "true" ]; then
  echo '{"decision": "approve"}'
  exit 0
fi

# Check if Claude already saved learnings or explicitly said nothing to save
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""')
if echo "$LAST_MSG" | grep -qiE 'saved to memory|nothing new to save|no new learnings|nothing worth saving'; then
  echo '{"decision": "approve"}'
  exit 0
fi

# Check transcript for non-trivial work (tool calls = actual work done)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // ""')
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo '{"decision": "approve"}'
  exit 0
fi

# Count tool uses as proxy for non-trivial work
TOOL_COUNT=$(grep -c '"type":"tool_use"' "$TRANSCRIPT" 2>/dev/null || echo "0")

# Less than 5 tool calls = probably trivial, let it through
if [ "$TOOL_COUNT" -lt 5 ]; then
  echo '{"decision": "approve"}'
  exit 0
fi

# Non-trivial work without learning save — block and remind (keep short, Claude knows the protocol from CLAUDE.md)
echo "{\"decision\": \"block\", \"reason\": \"Auto-learn: $TOOL_COUNT tool calls, no save detected. Run the Auto-Learning protocol from CLAUDE.md.\"}"
