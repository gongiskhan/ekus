# Slack Skill

Interact with Slack via the Slack Web API using `curl` and the bot token from `.env`.

## Setup

Requires `SLACK_BOT_TOKEN` in `.env` (starts with `xoxb-`).

## Key IDs

| Entity | ID | Notes |
|--------|-----|-------|
| Gonçalo (user) | U091FP30H9V | Main user |
| Gonçalo DM | D0ADZB7D733 | Direct message channel |
| Bot user | U0ADLDDEVKL | Ekus bot |

## API Patterns

All calls use:
```bash
source .env
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H "Content-Type: application/json" ...
```

### Send a message
```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"D0ADZB7D733","text":"Hello!"}'
```

### Send to a thread
```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"D0ADZB7D733","text":"Reply","thread_ts":"1712023032.1234"}'
```

### Read messages
```bash
curl -s "https://slack.com/api/conversations.history?channel=D0ADZB7D733&limit=20" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

### Read thread replies
```bash
curl -s "https://slack.com/api/conversations.replies?channel=D0ADZB7D733&ts=1712023032.1234" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

### React to a message
```bash
curl -s -X POST https://slack.com/api/reactions.add \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"D0ADZB7D733","timestamp":"1712023032.1234","name":"white_check_mark"}'
```

### Edit a message
```bash
curl -s -X POST https://slack.com/api/chat.update \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"D0ADZB7D733","ts":"1712023032.1234","text":"Updated text"}'
```

### Delete a message
```bash
curl -s -X POST https://slack.com/api/chat.delete \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"D0ADZB7D733","ts":"1712023032.1234"}'
```

### Pin/Unpin
```bash
# Pin
curl -s -X POST https://slack.com/api/pins.add \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"D0ADZB7D733","timestamp":"1712023032.1234"}'

# Unpin
curl -s -X POST https://slack.com/api/pins.remove \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel":"D0ADZB7D733","timestamp":"1712023032.1234"}'
```

### Upload a file
```bash
curl -s -X POST https://slack.com/api/files.uploadV2 \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -F "channel_id=D0ADZB7D733" \
  -F "file=@/path/to/file.pdf" \
  -F "title=My File"
```

### Get user info
```bash
curl -s "https://slack.com/api/users.info?user=U091FP30H9V" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

### List channels
```bash
curl -s "https://slack.com/api/conversations.list?types=public_channel,private_channel,im&limit=100" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

## Rich Formatting

Slack uses mrkdwn (not markdown):
- Bold: `*bold*`
- Italic: `_italic_`
- Strike: `~strike~`
- Code: `` `code` ``
- Code block: ` ```code``` `
- Link: `<https://example.com|text>`
- User mention: `<@U091FP30H9V>`
- Channel: `<#C123>`
- Emoji: `:emoji_name:`

## Tips

- Always `source .env` before API calls
- Default DM channel for Gonçalo: `D0ADZB7D733`
- Message timestamps (ts) are IDs — use them for replies, reactions, edits
- For rich messages, use Block Kit: <https://api.slack.com/block-kit>
