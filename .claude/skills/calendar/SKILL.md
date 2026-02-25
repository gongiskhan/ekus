# Calendar Access

Manage Google Calendar events via MCP integration.

## Setup

Google Calendar MCP should be configured in `.claude/settings.json`.

## Common Tasks

### View today's agenda
List all events for today across all calendars.

### Create events
- Quick events: "Meeting tomorrow at 10am"
- Detailed events: with location, attendees, reminders

### Check availability
- Look at free/busy slots for scheduling
- Check for conflicts before creating events

### Reminders
When asked to remind about something:
1. Create a calendar event at the specified time
2. Add a clear title describing the reminder
3. Optionally create a Trello card too (belt and suspenders)

## Best Practices

- **Check multiple calendars** — user may have personal + work + family
- **Include timezone** — always use Europe/Lisbon unless specified
- **Conflict check** — always check for existing events before creating
- **Reminders = calendar event + Trello card** (both, for ADHD support)
