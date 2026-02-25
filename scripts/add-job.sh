#!/usr/bin/env bash
# Add a new scheduled job
# Usage: ./scripts/add-job.sh <id> <cron-expression> <prompt> [--crontab]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
JOBS_FILE="$PROJECT_DIR/config/jobs.json"

JOB_ID="${1:-}"
CRON_EXPR="${2:-}"
PROMPT="${3:-}"
ADD_CRONTAB="${4:-}"

if [[ -z "$JOB_ID" || -z "$CRON_EXPR" || -z "$PROMPT" ]]; then
  echo "Usage: $0 <id> <cron-expression> <prompt> [--crontab]"
  echo ""
  echo "Examples:"
  echo "  $0 task-list '0 6-21 * * 1-5' 'Compile task list from Trello and Calendar'"
  echo "  $0 morning-brief '0 8 * * *' 'Give morning briefing' --crontab"
  exit 1
fi

# Add to jobs.json
python3 << PYEOF
import json

with open("$JOBS_FILE", "r") as f:
    data = json.load(f)

# Check for duplicate
if any(j["id"] == "$JOB_ID" for j in data["jobs"]):
    print(f"Job '$JOB_ID' already exists. Remove it first.")
    exit(1)

data["jobs"].append({
    "id": "$JOB_ID",
    "schedule": "$CRON_EXPR",
    "prompt": """$PROMPT""",
    "enabled": True
})

with open("$JOBS_FILE", "w") as f:
    json.dump(data, f, indent=2)

print(f"✅ Added job '$JOB_ID' to jobs.json")
PYEOF

# Optionally add to crontab
if [[ "$ADD_CRONTAB" == "--crontab" ]]; then
  CRON_LINE="$CRON_EXPR cd $PROJECT_DIR && ./scripts/run-job.sh $JOB_ID >> $PROJECT_DIR/logs/cron.log 2>&1"
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo "✅ Added crontab entry"
fi
