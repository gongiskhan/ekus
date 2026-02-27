#!/usr/bin/env bash
# auto-learn-stop.sh — Stop hook
# Checks if a non-trivial task was completed without saving learnings.
# If so, blocks the stop and reminds Claude to reflect and save.

INPUT=$(cat)

# Prevent infinite loops: if stop hook already fired once, allow through
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
if [ "$STOP_ACTIVE" = "true" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Check if Claude already saved learnings or explicitly said nothing to save
LAST_MSG=$(echo "$INPUT" | jq -r '.last_assistant_message // ""')
if echo "$LAST_MSG" | grep -qiE 'saved to memory|nothing new to save|no new learnings|nothing worth saving'; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Check transcript for non-trivial work (tool calls = actual work done)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // ""')
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Count tool uses as proxy for non-trivial work
TOOL_COUNT=$(grep -c '"type":"tool_use"' "$TRANSCRIPT" 2>/dev/null || echo "0")

# Less than 5 tool calls = probably trivial, let it through
if [ "$TOOL_COUNT" -lt 5 ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Non-trivial work without learning save — block and remind
cat <<EOF
{"decision": "block", "reason": "AUTO-LEARNING: You completed a non-trivial task ($TOOL_COUNT tool calls). Before finishing, follow the Auto-Learning protocol: (1) Evaluate what you learned — new facts, gotchas, reusable processes. (2) Save to the right file: MEMORY.md for facts, memory/lessons-learned.md for tips/gotchas, memory/workflows.md for repeatable processes. (3) Check for duplicates first. (4) End with: Saved to memory: [summary]. If genuinely nothing was learned, say: Nothing new to save."}
EOF
