# Reminders & Scheduling

Create reminders using multiple channels for reliability.

## Reminder Strategy (Belt and Suspenders)

When asked to create a reminder, use ALL available methods:

1. **Calendar event** — via Calendar MCP
2. **Trello card** — via Trello API (with due date)
3. **Local file** — append to `memory/reminders.md`

This triple-action approach ensures nothing gets missed (critical for ADHD support).

## Create a Reminder

### 1. Calendar Event
Create an event at the reminder time with a clear title.

### 2. Trello Card
```bash
source .env
curl -s -X POST "https://api.trello.com/1/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN" \
  -d "idList=$A_FAZER_LIST_ID" \
  --data-urlencode "name=⏰ Reminder: [description]" \
  -d "due=2026-02-25T09:00:00.000Z"
```

### 3. Local Log
Append to `memory/reminders.md`:
```
## 2026-02-25 09:00 — [Description]
- Created: 2026-02-24
- Status: pending
```

## Follow-up

When reviewing tasks, check `memory/reminders.md` for any pending reminders
that might have been missed.

## Best Practices

- Always include the timezone (Europe/Lisbon)
- For recurring reminders, note the pattern
- Mark reminders as done when completed
- If a reminder is time-sensitive, create the calendar event FIRST
