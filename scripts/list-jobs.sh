#!/usr/bin/env bash
# List all scheduled jobs

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
JOBS_FILE="$PROJECT_DIR/config/jobs.json"

echo "📋 Ekus Scheduled Jobs"
echo "======================"
echo ""

python3 << PYEOF
import json
with open("$JOBS_FILE") as f:
    data = json.load(f)

for job in data["jobs"]:
    status = "✅" if job.get("enabled", True) else "⏸️"
    print(f'{status} {job["id"]}')
    print(f'   Schedule: {job["schedule"]}')
    print(f'   Prompt: {job["prompt"][:80]}{"..." if len(job["prompt"]) > 80 else ""}')
    print()
PYEOF

echo "Crontab entries:"
echo "----------------"
crontab -l 2>/dev/null | grep "ekus" || echo "(none)"
