#!/usr/bin/env bash
# auto-learn-prompt.sh — UserPromptSubmit hook
# Injects a reminder to check memory files before starting work.

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')

# Skip trivial prompts (greetings, short messages, continuations)
PROMPT_LEN=${#PROMPT}
if [ "$PROMPT_LEN" -lt 15 ]; then
  exit 0
fi

# Skip if the user is explicitly asking about memory or learning
if echo "$PROMPT" | grep -qiE 'memory|learn|remember|claude\.md'; then
  exit 0
fi

echo "Before starting: if this task involves a domain you've worked with before, check memory/lessons-learned.md and memory/workflows.md for proven solutions and known pitfalls."
