# Scheduler — Cron-based Task Scheduling

Run scheduled tasks using macOS launchd or crontab.

## Architecture

The scheduler uses a simple bash daemon (`scripts/scheduler.sh`) that:
1. Reads job definitions from `config/jobs.json`
2. Executes Claude Code in headless mode (`claude -p "prompt"`) at scheduled times
3. Logs output to `logs/`

For simpler needs, use raw crontab entries.

## Setup

### Option A: launchd (recommended for macOS)

Install the launch agent:
```bash
./scripts/install-scheduler.sh
```

This creates `~/Library/LaunchAgents/com.ekus.scheduler.plist` that runs the scheduler every minute.

### Option B: crontab

```bash
# Edit crontab
crontab -e

# Add entries like:
# Task list every hour on weekdays 6am-9pm
0 6-21 * * 1-5 cd ~/Projects/ekus && ./scripts/run-job.sh task-list

# Daily morning briefing at 8am
0 8 * * * cd ~/Projects/ekus && ./scripts/run-job.sh morning-briefing

# One-shot reminder (add and remove after firing)
0 9 25 2 * cd ~/Projects/ekus && ./scripts/run-job.sh reminder-finanças && crontab -l | grep -v "reminder-finanças" | crontab -
```

## Job Definitions

Jobs are defined in `config/jobs.json`:
```json
{
  "jobs": [
    {
      "id": "task-list",
      "schedule": "0 6-21 * * 1-5",
      "prompt": "Read config/trello.json, fetch cards from Trello, check calendar, and compile a task list summary.",
      "enabled": true
    }
  ]
}
```

## Creating Jobs

### From Claude Code
When asked to create a reminder or scheduled task:
1. Add entry to `config/jobs.json`
2. If using crontab, add the cron entry
3. Log it in `memory/reminders.md`

### Manually
```bash
./scripts/add-job.sh "reminder-name" "0 9 * * *" "Remind Gonçalo about the meeting"
```

## Scripts

- `scripts/run-job.sh <job-id>` — Run a specific job now
- `scripts/add-job.sh <id> <cron> <prompt>` — Add a new job
- `scripts/list-jobs.sh` — List all jobs
- `scripts/install-scheduler.sh` — Install launchd agent

## Best Practices

- Use crontab for simple recurring tasks
- Use launchd for tasks that need to survive reboots
- Always log output to `logs/`
- For one-shot reminders, self-delete after firing
- Test jobs with `run-job.sh` before scheduling
