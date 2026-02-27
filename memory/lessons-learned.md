# Lessons Learned

*Hard-won knowledge from real-world usage. Read this to avoid repeating mistakes.*

---

## Software Development

### Always Use Agent Teams for Complex Tasks
Never try to do complex dev work inline. For anything beyond trivial edits:
1. `TeamCreate` to set up a team with shared task list
2. `TaskCreate` to define work items with dependencies (`addBlockedBy`)
3. Spawn teammates via `Task` tool with `team_name` + `name` params
   - `general-purpose` for implementation (full file/bash access)
   - `Explore` for research (read-only, fast)
   - `Plan` for architecture (read-only)
4. Assign tasks via `TaskUpdate` with `owner` param
5. The team lead (you) does NO coding — only plans, delegates, and verifies
6. A tester agent is ALWAYS required — uses `agent-browser` to verify visually
7. Teammates go idle after each turn — this is normal, send them a message to wake them
8. Messages auto-deliver via `SendMessage` — never poll inboxes
9. Shutdown via `SendMessage(type: "shutdown_request")`, then `TeamDelete`
10. Only declare success after tester confirms with screenshots

### Always Verify Work in Browser
After any UI/frontend change, verify it works visually:
- `agent-browser` CLI is preferred
- Chrome extension is fallback
- Never assume code changes work without visual verification

### agent-browser CLI Patterns
```bash
agent-browser open <url>        # Navigate
agent-browser snapshot -i       # Get interactive elements with refs
agent-browser click @e1         # Click element
agent-browser fill @e2 "text"   # Fill input
agent-browser screenshot        # Take screenshot proof
agent-browser close             # Close
```

### Template Literal Gotchas
Avoid `</script>` and triple backticks inside template literals in HTML files.
The browser parser gets confused. Use string concatenation or escape sequences.

### Roadmap/Config Changes = Commit + Push Immediately
When asked for changes to roadmaps, configs, or docs — always commit and push right away.

## Email

### himalaya > gog CLI
The `himalaya` CLI works reliably for Gmail (search, read, attachments).
The `gog` CLI hangs and crashes (SIGKILL). Use himalaya as primary.

### himalaya Search Syntax
```bash
himalaya envelope list --page-size 50 "subject fatura or subject recibo"
himalaya envelope list "from vodafone"
himalaya message read <ID>
```
- Use `or` (lowercase) not `OR`
- Max ~3 conditions per search (IMAP limitation)
- Search in INBOX by default, use `--folder` for others

## Invoice Collection (Faturas)

Recurring monthly task. Sources:
- **Gmail**: Vodafone, Credibom, Via Verde, Prio, BCP
- **WhatsApp**: Uber Eats receipts
- **Portals**: InvoiceXpress, Atlantic Summit (need browser automation)
- **Download strategy**: Search email → download attachments → organize by month
- **Upload to accountant portal** (Octa Manager): Use direct API, not browser upload

## Browser Automation

### Cookie Banners First
Always dismiss cookie/consent banners before interacting with a page.

### Login Flows
Fill one field at a time. Verify each step. Take screenshots at key moments.

### Bot Detection
Some portals (banking, government) have aggressive bot detection.
For these, use real Chrome (Claude for Chrome extension) not headless browsers.

### Ref-Based Clicks > Coordinate Clicks
Some links/buttons on SPAs (like Vendus) don't respond to coordinate clicks.
Use `mcp__claude-in-chrome__find` to get a ref, then click via `ref` parameter instead of `coordinate`.
This is especially true for: "+ Criar Novo Item" links, "Emitir" buttons in dialogs, and any dynamically rendered elements.

### Chrome Extension Disconnects
The Chrome extension disconnects frequently during long browser sessions.
When the user says "i connected the chrome extension again":
1. Call `tabs_context_mcp` to get fresh tab IDs (they may or may not change)
2. Take a screenshot to verify current state
3. Resume from where you left off — the page state usually persists

### React Form Inputs (nativeInputValueSetter)
React-controlled inputs ignore direct `.value = x` assignments. You must use:
```javascript
const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
nativeSetter.call(element, 'new value');
element.dispatchEvent(new Event('input', {bubbles: true}));
```
For `<select>` elements, `.value = x` works but must be followed by:
```javascript
element.dispatchEvent(new Event('change', {bubbles: true}));
```

### Vendus Alterar Button Needs Double-Click Sometimes
The "Alterar" button next to document type in Vendus sometimes needs two clicks:
first click highlights the button, second click opens the radio options.

## Trello API

### URL-encode Portuguese Characters
Always use `--data-urlencode "name=..."` for card names with accents.

### Archiving = Done
Done tasks get `closed=true` (archived), never deleted.

### Sync Pattern
1. Fetch all cards from list
2. Compare with local task list (match by title)
3. Create missing cards, archive done ones
4. Never create duplicates — always check first

## Scheduling & Reminders

### Triple-Action Reminders (ADHD Support)
For any reminder, use ALL available channels:
1. Calendar event (exact time)
2. Trello card (with due date)
3. Scheduler notification (Slack + WhatsApp)

This ensures nothing gets missed even if one system is ignored.

### Gmail category:primary Doesn't Filter Reliably
Searching `is:inbox category:primary newer_than:1h` via MCP still returns CATEGORY_UPDATES emails.
To properly filter, check `labelIds` in results — only include messages with `CATEGORY_PERSONAL` or `IMPORTANT` labels, and exclude `CATEGORY_UPDATES`, `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, `CATEGORY_FORUMS`.

### Scheduler Prompts Must Be Self-Contained
When writing prompts for `config/jobs.json`, remember:
- `claude -p` runs in a fresh session — no conversation history
- The prompt must include ALL instructions (source .env, IDs, API patterns)
- Keep prompts focused but complete — include exact list IDs, channel IDs, etc.
- Test JSON validity after editing: `python3 -c "import json; json.load(open('config/jobs.json'))"`

### Cron Expression Cheat Sheet
```
* * * * *
│ │ │ │ │
│ │ │ │ └─ Day of week (1-7, Mon=1)
│ │ │ └─── Month (1-12)
│ │ └───── Day of month (1-31)
│ └─────── Hour (0-23)
└───────── Minute (0-59)

Examples:
0 8 * * 1-5     = 8am weekdays
0 6-21 * * 1-5  = Every hour 6am-9pm weekdays
*/30 * * * *    = Every 30 minutes
0 9 25 2 *      = Feb 25 at 9am (one-shot)
```

## Image Generation

### Gemini > DALL-E for Logos
Gemini Nano Banana Pro is better for precise logos. Always specify:
- Pure white background (#FFFFFF) — no true transparency
- Exact colors with hex codes
- PNG format

## Voice / TTS

### ElevenLabs Pipeline
1. Generate speech via API (`eleven_multilingual_v2` for Portuguese)
2. Speed up 1.5x: `ffmpeg -i input.mp3 -filter:a "atempo=1.5" -y output.mp3`
3. Send the sped-up file

### Keep Text Under 5000 chars per TTS request

## Task Sync

### Tasks Live in Cloudflare KV (Not Local)
The task list is stored in Cloudflare KV and served via the dashboard Worker.
- **Dashboard:** https://ekus-dashboard.goncalo-p-gomes.workers.dev
- **Read:** `GET /api/tasks`
- **Write:** `PUT /api/tasks` with `Content-Type: text/plain`
- There is NO local TASKS.md — always use the API.
- The Worker source is deployed via wrangler. Cloudflare API token is in `.env` as `CLOUDFARE_API_TOKEN`.
- KV namespace ID: `03bb45bba2ee4d38806967e7ff02f2ea`

### Never Re-Add Intentionally Removed Tasks
When syncing tasks with Trello (or any external source), a task present in Trello but absent from the task list does NOT necessarily mean it's missing — it may have been intentionally removed by the user. Only flag genuinely NEW cards (created after the last sync). If a task was previously in the list and is now gone, assume the user removed it on purpose.

## People

### Wilson Bicalho
Next Border (NB) team member. Handles business development / investor outreach. Sends pitch decks to potential investors on behalf of NB. Email: wilson@nextborder.co (or similar NB domain).

### Carla Lima
Next Border (NB) partner. Has a recurring "SYNC Estratégico Next Border" meeting with Gonçalo (weekly/biweekly on Mondays at 11:00). Strategic role at NB.
