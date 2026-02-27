# Task Management — Unified Task System

Manage tasks across Trello, Google Calendar, Scheduler, Slack, and WhatsApp.

## Overview

- **Trello** is the source of truth for all tasks
- **Google Calendar** holds time-bound events and deadlines
- **Scheduler** triggers notifications and recurring jobs
- **Slack DM** (D0ADZB7D733) and **WhatsApp Ekus Alertas** (120363343316234999@g.us) are notification channels
- Commands come from Slack, WhatsApp, or direct Claude Code conversation
- Ekus checks for new commands every 10 minutes and sends hourly digests

## Setup

Credentials in `.env`:
```
TRELLO_KEY=...
TRELLO_TOKEN=...
SLACK_BOT_TOKEN=xoxb-...
```

Board/list config in `config/trello.json`. Always `source .env` before API calls.

## Trello Board Layout

### Geral Board (59a674f0a5bae0f9ea4d4dab)

| List | ID | When to use |
|------|----|-------------|
| A Fazer | 692ef0efcda3c6ad22f446b0 | Today's tasks / immediate |
| Brevemente | 5a38df428080f0d513df0672 | Soon, next few days |
| Eventualmente | 637b435304bbf002656e3793 | Someday / low priority |
| Projetos | 6868e0175b1e810b52ae494e | Ongoing projects |

### Baby D Board (68a97075391c0af8726a5a62)

| List | ID | When to use |
|------|----|-------------|
| A Fazer | 68cbac003d69bc903482219d | Baby tasks for today |
| Manhas | 68a963bb8fae0b0cee33672e | Morning routine |
| Tardes/Noites | 68a970ec31e62f1c070f96c5 | Afternoon/evening routine |
| Semanalmente | 68a972d4850a2629a7d985bd | Weekly baby tasks |
| A Comprar | 68a975437ca206439d27a699 | Baby shopping list |
| Coisas a Levar | 693f9f5ddc5e865fce7999c3 | Things to bring (daycare, trips) |

Use the Baby D board when the task is baby-related: diapers, pediatrician, baby food, daycare, etc.

## Command Patterns

Ekus recognizes these triggers in both English and Portuguese:

| Action | Triggers (EN) | Triggers (PT) |
|--------|--------------|---------------|
| Add task | "add task", "todo", "remind me to" | "tarefa", "lembra-me de", "adiciona" |
| Schedule | "schedule", "calendar", "set event" | "agendar", "marca", "calendário" |
| Complete | "done", "complete", "archive" | "feito", "concluído", "arquivo" |
| List | "tasks", "list", "what's on" | "tarefas", "lista", "o que tenho" |
| Move | "move to", "change to" | "muda para", "brevemente", "eventualmente" |

## Adding Tasks

When the user asks to add a task:

1. Determine the right list based on urgency:
   - Today / urgent / no qualifier → **A Fazer**
   - Next few days / soon → **Brevemente**
   - Low priority / someday → **Eventualmente**
   - Ongoing project → **Projetos**
   - Baby-related → appropriate **Baby D** list
2. Create the Trello card
3. If there's a specific date/time → also create a calendar event
4. Acknowledge on the same channel the user asked from

```bash
# Create task in A Fazer
source .env
curl -s -X POST "https://api.trello.com/1/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN" \
  -d "idList=692ef0efcda3c6ad22f446b0" \
  --data-urlencode "name=Task description here"

# Create task with due date
curl -s -X POST "https://api.trello.com/1/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN" \
  -d "idList=692ef0efcda3c6ad22f446b0" \
  -d "due=2026-03-01T09:00:00.000Z" \
  --data-urlencode "name=Task with deadline"

# Create baby task in A Comprar
curl -s -X POST "https://api.trello.com/1/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN" \
  -d "idList=68a975437ca206439d27a699" \
  --data-urlencode "name=Comprar fraldas tamanho 4"
```

## Scheduling Events

When the user wants to schedule something:

1. Create Trello card with due date
2. Create Google Calendar event via `gcal_create_event` MCP tool
3. If recurring → add job to `config/jobs.json` and install via scheduler
4. If one-shot reminder → add self-removing crontab entry
5. Confirm with the user, including the exact date/time

```bash
# One-shot crontab reminder (fires once, then self-removes)
(crontab -l 2>/dev/null; echo "0 9 1 3 * cd ~/ekus && ./scripts/run-job.sh reminder-dentist && crontab -l | grep -v 'reminder-dentist' | crontab -") | crontab -
```

For the calendar event, use the MCP tool:
```
gcal_create_event(
  summary="Dentist appointment",
  start="2026-03-01T10:00:00",
  end="2026-03-01T11:00:00",
  description="Annual checkup"
)
```

## Completing Tasks

When the user says a task is done:

1. Search for the card on Trello
2. Archive it (closed=true)
3. Confirm completion

```bash
# Search for a card
source .env
curl -s "https://api.trello.com/1/search?key=$TRELLO_KEY&token=$TRELLO_TOKEN" \
  --data-urlencode "query=dentist" \
  -d "modelTypes=cards" \
  -d "card_fields=name,idList,due,id"

# Archive the card
curl -s -X PUT "https://api.trello.com/1/cards/${CARD_ID}?key=$TRELLO_KEY&token=$TRELLO_TOKEN&closed=true"
```

## Moving Tasks Between Lists

```bash
# Move card to Brevemente
source .env
curl -s -X PUT "https://api.trello.com/1/cards/${CARD_ID}?key=$TRELLO_KEY&token=$TRELLO_TOKEN&idList=5a38df428080f0d513df0672"

# Move card to Eventualmente
curl -s -X PUT "https://api.trello.com/1/cards/${CARD_ID}?key=$TRELLO_KEY&token=$TRELLO_TOKEN&idList=637b435304bbf002656e3793"
```

## Listing Tasks

Fetch cards from relevant lists and present a clean summary:

```bash
source .env

# Get A Fazer cards
curl -s "https://api.trello.com/1/lists/692ef0efcda3c6ad22f446b0/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN&fields=name,id,due,labels"

# Get Brevemente cards
curl -s "https://api.trello.com/1/lists/5a38df428080f0d513df0672/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN&fields=name,id,due,labels"
```

Format output as a clean list, grouped by list name. Include due dates where present.

## Reminders — Triple-Action (ADHD Support)

When setting a reminder, use all three channels to maximize the chance it's noticed:

1. **Trello card** with due date → visible in task lists and digests
2. **Calendar event** at exact time → phone notification
3. **Scheduler job** or **crontab entry** → pushes to Slack + WhatsApp

```bash
# Step 1: Trello card
source .env
curl -s -X POST "https://api.trello.com/1/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN" \
  -d "idList=692ef0efcda3c6ad22f446b0" \
  -d "due=2026-03-01T14:00:00.000Z" \
  --data-urlencode "name=Ligar para o contabilista"

# Step 2: Calendar event (via MCP gcal_create_event)

# Step 3: Crontab notification (self-removing)
(crontab -l 2>/dev/null; echo "0 14 1 3 * cd ~/ekus && claude -p 'Send reminder to Slack and WhatsApp: Ligar para o contabilista' && crontab -l | grep -v 'reminder-contabilista' | crontab -") | crontab -
```

## Notification Channels

### Slack DM
```bash
source .env
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"D0ADZB7D733","text":"Reminder: Ligar para o contabilista"}'
```

### WhatsApp Ekus Alertas
```bash
wacli send text --to "120363343316234999@g.us" --message "Reminder: Ligar para o contabilista"
```

### Hourly Digest
The digest job runs hourly (see scheduler skill) and sends a summary of today's tasks to both Slack and WhatsApp. It fetches cards from A Fazer, checks calendar for upcoming events, and formats a clean summary.

## Best Practices

- Always URL-encode card names with `--data-urlencode` (Portuguese accents)
- Archive done tasks, never delete them
- When creating time-bound tasks, always create both the Trello card and calendar event
- For reminders, use the triple-action pattern (Trello + Calendar + Scheduler)
- Acknowledge task actions on the same channel the user used
- Check for duplicate cards before creating (search first if unsure)
- Baby-related tasks go to the Baby D board, everything else to Geral
- Default to A Fazer if urgency is unclear — better to over-prioritize than forget
