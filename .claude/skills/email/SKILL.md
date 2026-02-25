# Email Access

Search, read, and manage emails via Gmail MCP integration.

## Setup

Gmail MCP should be configured in `.claude/settings.json` under mcpServers.
This gives you tools like:
- Search emails
- Read email content
- List folders/labels
- Send emails (ask user first!)

## Common Tasks

### Search for invoices/receipts
```
Search for emails from specific senders with attachments:
- "from:dentist subject:fatura"
- "from:psicologo has:attachment"
- "subject:recibo after:2025/01/27"
```

### Read and extract info
1. Search for the email
2. Read its content
3. Extract relevant data (dates, amounts, attachments)
4. Download attachments if needed

### Send email (ALWAYS ask user first)
1. Compose the email content
2. Show it to the user for approval
3. Only send after explicit confirmation

## Best Practices

- **Never send emails without explicit user approval**
- **Search broadly first**, then narrow down
- **Check multiple folders** — invoices might be in Promotions or other labels
- **Download attachments** to a local folder for processing
- For recurring searches, note the patterns that work in memory
