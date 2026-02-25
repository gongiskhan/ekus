# Trello Task Management

Manage tasks via Trello REST API.

## Setup

Credentials in `.env`:
```
TRELLO_KEY=your_api_key
TRELLO_TOKEN=your_token
```

Board/list configuration in `config/trello.json`.

## API Patterns

Always `source .env` before making calls.

### List cards in a list
```bash
curl -s "https://api.trello.com/1/lists/${LIST_ID}/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN&fields=name,id,due,labels" | python3 -m json.tool
```

### Create a card
```bash
curl -s -X POST "https://api.trello.com/1/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN" \
  -d "idList=$LIST_ID" \
  -d "name=Task Name" \
  -d "due=2026-02-25T09:00:00.000Z"
```

### Move a card to another list
```bash
curl -s -X PUT "https://api.trello.com/1/cards/${CARD_ID}?key=$TRELLO_KEY&token=$TRELLO_TOKEN&idList=$TARGET_LIST_ID"
```

### Archive a card (mark done)
```bash
curl -s -X PUT "https://api.trello.com/1/cards/${CARD_ID}?key=$TRELLO_KEY&token=$TRELLO_TOKEN&closed=true"
```

### Update card name
```bash
curl -s -X PUT "https://api.trello.com/1/cards/${CARD_ID}?key=$TRELLO_KEY&token=$TRELLO_TOKEN" \
  --data-urlencode "name=New Name"
```

### Search cards
```bash
curl -s "https://api.trello.com/1/search?key=$TRELLO_KEY&token=$TRELLO_TOKEN&query=search+term&modelTypes=cards&card_fields=name,idList,due"
```

## Task Management Rules

- **"A Fazer" list** = today's tasks
- **"Brevemente" list** = soon/later tasks
- **Done tasks get archived** (closed=true), never deleted
- **Dev tasks** (Indy, CSG, Ekoa, NB, etc.) go under Dev priority
- When creating a task, also create a calendar event if it has a deadline

## Best Practices

- Always URL-encode card names with special characters
- Use `--data-urlencode` for names with accents (Portuguese)
- Batch operations: get all cards first, then process
- For sync: compare local task list with Trello cards to avoid duplicates
