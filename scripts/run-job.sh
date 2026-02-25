#!/usr/bin/env bash
# Run a scheduled job by ID
# Usage: ./scripts/run-job.sh <job-id>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
JOBS_FILE="$PROJECT_DIR/config/jobs.json"
LOG_DIR="$PROJECT_DIR/logs"

mkdir -p "$LOG_DIR"

JOB_ID="${1:-}"
if [[ -z "$JOB_ID" ]]; then
  echo "Usage: $0 <job-id>"
  echo "Available jobs:"
  python3 -c "import json; [print(f'  {j[\"id\"]} — {j.get(\"description\",\"\")}') for j in json.load(open('$JOBS_FILE'))['jobs'] if j.get('enabled', True)]" 2>/dev/null || echo "  (no jobs configured)"
  exit 1
fi

# Load .env if exists
[[ -f "$PROJECT_DIR/.env" ]] && source "$PROJECT_DIR/.env"

# Find job
PROMPT=$(python3 -c "
import json, sys
jobs = json.load(open('$JOBS_FILE'))['jobs']
job = next((j for j in jobs if j['id'] == '$JOB_ID'), None)
if not job:
    print('ERROR: Job not found', file=sys.stderr)
    sys.exit(1)
if not job.get('enabled', True):
    print('ERROR: Job is disabled', file=sys.stderr)
    sys.exit(1)
print(job['prompt'])
")

if [[ $? -ne 0 ]]; then
  echo "Job '$JOB_ID' not found or disabled"
  exit 1
fi

TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="$LOG_DIR/${JOB_ID}_${TIMESTAMP}.log"

echo "[$TIMESTAMP] Running job: $JOB_ID" | tee "$LOG_FILE"
echo "Prompt: $PROMPT" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"

# Run claude in print mode (non-interactive)
cd "$PROJECT_DIR"
claude -p "$PROMPT" 2>&1 | tee -a "$LOG_FILE"

echo "" >> "$LOG_FILE"
echo "[$( date '+%Y-%m-%d_%H-%M-%S' )] Job completed" >> "$LOG_FILE"
