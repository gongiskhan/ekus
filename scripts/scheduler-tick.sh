#!/usr/bin/env bash
# Called every minute by launchd. Checks if any job is due and runs it.
# Uses a simple "last run" tracking file to avoid double-runs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
JOBS_FILE="$PROJECT_DIR/config/jobs.json"
STATE_FILE="$PROJECT_DIR/config/.scheduler-state.json"
LOG_DIR="$PROJECT_DIR/logs"

mkdir -p "$LOG_DIR"

# Load .env
[[ -f "$PROJECT_DIR/.env" ]] && source "$PROJECT_DIR/.env"

# Initialize state file if missing
[[ -f "$STATE_FILE" ]] || echo '{}' > "$STATE_FILE"

# Current time components
MINUTE=$(date '+%-M')
HOUR=$(date '+%-H')
DOM=$(date '+%-d')
MONTH=$(date '+%-m')
DOW=$(date '+%u')  # 1=Mon, 7=Sun
NOW_KEY=$(date '+%Y-%m-%d-%H-%M')

python3 << 'PYEOF'
import json, subprocess, sys, os
from datetime import datetime

project_dir = os.environ.get("PROJECT_DIR", ".")
jobs_file = f"{project_dir}/config/jobs.json"
state_file = f"{project_dir}/config/.scheduler-state.json"
log_dir = f"{project_dir}/logs"

now = datetime.now()
now_key = now.strftime("%Y-%m-%d-%H-%M")

with open(jobs_file) as f:
    jobs = json.load(f)["jobs"]

with open(state_file) as f:
    state = json.load(f)

def cron_matches(expr, now):
    """Simple cron expression matcher (min hour dom month dow)"""
    parts = expr.split()
    if len(parts) != 5:
        return False
    
    checks = [
        (parts[0], now.minute),
        (parts[1], now.hour),
        (parts[2], now.day),
        (parts[3], now.month),
        (parts[4], now.isoweekday()),  # 1=Mon, 7=Sun
    ]
    
    for pattern, value in checks:
        if not field_matches(pattern, value):
            return False
    return True

def field_matches(pattern, value):
    """Match a single cron field"""
    if pattern == "*":
        return True
    
    for part in pattern.split(","):
        if "-" in part:
            start, end = part.split("-", 1)
            if int(start) <= value <= int(end):
                return True
        elif "/" in part:
            base, step = part.split("/", 1)
            base_val = 0 if base == "*" else int(base)
            if (value - base_val) % int(step) == 0:
                return True
        else:
            # Map day names if needed
            day_map = {"mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 7}
            try:
                if int(part) == value:
                    return True
            except ValueError:
                if day_map.get(part.lower(), -1) == value:
                    return True
    return False

ran_something = False
for job in jobs:
    if not job.get("enabled", True):
        continue
    
    job_id = job["id"]
    last_run = state.get(job_id, "")
    
    if last_run == now_key:
        continue  # Already ran this minute
    
    if cron_matches(job["schedule"], now):
        print(f"[{now_key}] Running job: {job_id}")
        state[job_id] = now_key
        
        # Save state before running (prevent double-run)
        with open(state_file, "w") as f:
            json.dump(state, f, indent=2)
        
        # Run the job
        log_file = f"{log_dir}/{job_id}_{now.strftime('%Y-%m-%d_%H-%M')}.log"
        try:
            result = subprocess.run(
                ["claude", "-p", job["prompt"]],
                cwd=project_dir,
                capture_output=True,
                text=True,
                timeout=300  # 5 min timeout
            )
            with open(log_file, "w") as f:
                f.write(f"Job: {job_id}\nTime: {now_key}\nPrompt: {job['prompt']}\n---\n")
                f.write(result.stdout)
                if result.stderr:
                    f.write(f"\n--- STDERR ---\n{result.stderr}")
            print(f"  Done. Log: {log_file}")
        except subprocess.TimeoutExpired:
            print(f"  TIMEOUT after 5 min")
        except Exception as e:
            print(f"  ERROR: {e}")
        
        ran_something = True

if not ran_something:
    pass  # Silent when nothing to do

PYEOF
