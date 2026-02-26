# WhatsApp Skill

Send WhatsApp messages, search history, and manage chats via `wacli` CLI.

## Setup

Install: `brew install steipete/tap/wacli`
Auth: `wacli auth` (scan QR code with phone)
Sync: `wacli sync --follow` (continuous sync, run in background)
Doctor: `wacli doctor` (check health)

Store dir: `~/.wacli`

## Key Contacts

| Contact | Number/JID | Notes |
|---------|-----------|-------|
| Gonçalo (principal) | +351936256982 | Main number |
| Gonçalo (business) | +351912287967 | WhatsApp Business |
| Ekus Alertas (group) | 120363343316234999@g.us | Alerts/reminders group |

## Commands

### Find chats
```bash
wacli chats list --limit 20
wacli chats list --query "name or number"
```

### Search messages
```bash
wacli messages search "query" --limit 20
wacli messages search "invoice" --chat <jid> --after 2025-01-01 --before 2025-12-31
```

### Send text
```bash
# To a person
wacli send text --to "+351936256982" --message "Hello!"

# To a group
wacli send text --to "120363343316234999@g.us" --message "Reminder: check tasks"
```

### Send file
```bash
wacli send file --to "+351936256982" --file /path/to/file.pdf --caption "Here's the document"
```

### History backfill
```bash
wacli history backfill --chat <jid> --requests 2 --count 50
```

## JID Format

- Direct chats: `<number>@s.whatsapp.net` (e.g. `351936256982@s.whatsapp.net`)
- Groups: `<id>@g.us` (use `wacli chats list` to find group JIDs)

## Safety Rules

- **Always confirm recipient + message before sending** (unless it's a reminder to Gonçalo)
- Use `--json` flag for machine-readable output when parsing
- Backfill requires phone online; results are best-effort
- For media, max 50MB

## Tips

- Use the Ekus Alertas group for automated reminders
- `wacli chats list --json` to get JIDs programmatically
- Search is powerful: combine `--after`, `--before`, `--chat` filters
