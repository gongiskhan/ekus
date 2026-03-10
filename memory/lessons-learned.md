# Lessons Learned

*Hard-won knowledge from real-world usage. Read this to avoid repeating mistakes.*

---

## Cloudflare Workers / Wrangler

### Wrangler OAuth Expires — Keep Token Fresh
Wrangler OAuth tokens expire. When deploying dashboard, if you get "Failed to fetch auth token: 400 Bad Request", run `npx wrangler login` (opens browser) then retry. The refresh token also expires, so a full re-login is needed.

### Account ID Required for Multi-Account Users
If the Cloudflare account has access to multiple accounts, wrangler deploy fails with "More than one account available". Add `account_id = "173040a19332ef9902a322debcfdde59"` to wrangler.toml.

### Worker Code is Bundled — Can't Edit In Place
`workers_get_worker_code` returns a bundled multipart form. To update the worker, maintain source locally in `dashboard/src/` and deploy with `npx wrangler deploy`. Never try to edit the deployed bundle directly.

### KV Key Prefix Pattern for Multi-Use Namespace
The `ekus-dashboard-data` KV namespace stores both tasks and memory. Tasks use key `TASKS.md`, memory files use `memory:` prefix (e.g., `memory:MEMORY.md`). The `list({ prefix: "memory:" })` API efficiently filters.

### Local Memory and Cloud Memory Are NOT Auto-Synced
After moving memory to Cloudflare KV, the local files (auto-memory at `~/.claude/projects/.../memory/MEMORY.md` and project memory at `~/ekus/memory/`) are NOT automatically synced to the cloud dashboard. They will drift apart unless a sync mechanism is added (hook, scheduler step, or dual-write).

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
- **Gmail**: Vodafone, Credibom, Via Verde, Prio, BCP, Ageas, Nexperience/Vendus
- **WhatsApp**: Uber Eats receipts
- **Portals**: InvoiceXpress, Atlantic Summit (need browser automation)
- **Not in email**: ESLI (parking), Placegar (parking) — need portal or paper
- **Download strategy**: Search email → download attachments → organize by month
- **Upload to accountant portal** (Octa Manager): Use direct API, not browser upload

### Octa Token Retrieval
To get the Octa JWT token without himalaya:
1. Open https://manager.octacode.pt in Chrome (must be logged in)
2. Use JavaScript tool: create blob with `localStorage.getItem('authToken')`, trigger download
3. Read file from ~/Downloads, append to .env as `OCTA_TOKEN=...`
4. Token lasts ~1 year

### Gmail Attachment Download (without himalaya)
himalaya requires complex OAuth2 setup. Workaround:
1. Navigate to each email in Chrome via `mail.google.com/mail/u/0/#all/{messageId}`
2. Scroll to attachments, hover to reveal download button, click download icon
3. For multiple attachments, click the "Download all" icon (downloads as zip)
4. Files land in ~/Downloads — move to faturas folder

### BCP Enterprise Emails
- From `alertas.empresas@millenniumbcp.pt` to goncalo.p.gomes@gmail.com (company account)
- Separate from personal `banco@millenniumbcp.pt` to googlemail.com
- January docs arrive in early February — search Feb 1-10 for January invoices
- Attachments named "NL {timestamp}.pdf" contain bank fee invoices

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

### Archive via Form Body, Not Query String
Use `-d "closed=true"` (form body) instead of `?closed=true` (query string). The query string version intermittently returns "missing scopes". Some cards still fail — likely a token permission issue for cards created by other members.

## Hourly Digest

### Python Subprocess Doesn't Inherit Shell Env Vars
`source .env` sets variables in the current shell but does NOT export them. Python's `os.environ` only sees exported variables. Fix: `source .env && export SLACK_WEBHOOK_URL && python3 << 'PYEOF'`. Alternatively, use `set -a; source .env; set +a` to auto-export all sourced vars.

### Google Calendar MCP Requires User Permission
The `gcal_list_events` MCP tool requires interactive user approval. In `claude -p` (non-interactive), this silently fails. For automated digests, either pre-approve the tool or use the Google Calendar REST API directly with an API key/OAuth token.

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

### Claude Code Stop Hook: "approve" not "allow"
The Stop hook schema uses `"decision": "approve"` or `"decision": "block"`. Using `"allow"` causes a JSON validation error.

### Scheduler Prompts Must Be Self-Contained
When writing prompts for `config/jobs.json`, remember:
- `claude -p` runs in a fresh session — no conversation history
- The prompt must include ALL instructions (source .env, IDs, API patterns)
- Keep prompts focused but complete — include exact list IDs, channel IDs, etc.
- Test JSON validity after editing: `python3 -c "import json; json.load(open('config/jobs.json'))"`
- **MCP tools are NOT available** in `claude -p` mode — use curl/bash for everything
- Add `Do NOT save to memory files` to prevent noisy memory writes from scheduled jobs

### Scheduler Survives Reboots Only If launchd Plist Exists
- The plist at `~/Library/LaunchAgents/com.ekus.scheduler.plist` must exist and be loaded
- After a reboot, macOS auto-loads plists from `~/Library/LaunchAgents/` — if the file is gone, nothing runs
- Always include `RunAtLoad: true` so the scheduler fires immediately on login
- The install script is `scripts/install-scheduler.sh` — re-run after any OS update/migration
- **Critical**: The PATH in the plist must include `~/.local/bin` for the `claude` CLI

### Google Calendar API Key ≠ OAuth (No Calendar via curl)
The `GOOGLE_API_KEY` in `.env` is a simple API key — it works for public APIs but NOT for Calendar (which requires OAuth2 user consent). In automated/scheduled jobs (`claude -p`), MCP Calendar also fails because it needs interactive permission approval. For now, the hourly digest falls back to "Calendario indisponivel" in automated mode. Calendar data only works when the user grants MCP permission interactively.

### `source .env` Doesn't Export to Subprocesses
Running `source .env` in a Bash tool call makes vars available in that shell, but Python subprocesses (`subprocess.run`, `os.environ`) won't see them. Two solutions:
1. **Shell-side**: `set -a && source .env && set +a` before calling Python — auto-exports all vars
2. **Python-side**: Load `.env` from within Python by parsing the file directly (useful when the Python script IS the main command)
3. **Temp file**: Python writes output (e.g., JSON payload) to `/tmp/`, then bash uses it with `curl -d @/tmp/file` — avoids env var and escaping issues entirely
4. **urllib in Python**: Use `urllib.request` directly in Python instead of `subprocess.run(["curl", ...])` — avoids env var issues entirely since you can hardcode or read the URL within Python

### .env Values With Spaces Must Be Quoted
The `GMAIL_APP_PASSWORD` has spaces (Google app passwords are 4 groups of 4 chars). If unquoted, `source .env` treats the second word as a command. Always quote: `VAR="value with spaces"`.

### Use Slack Incoming Webhooks for Outbound Messages
- Bot tokens (`xoxb-`) require proper OAuth setup and the OAuth page sometimes won't load
- Incoming Webhooks are simpler: just POST JSON to a URL, no auth headers
- Webhook URL is self-authenticating — the URL IS the secret
- Set up via api.slack.com/apps > Incoming Webhooks > Add New Webhook > select channel
- Limitation: webhooks can only SEND to one channel; for reading messages or sending to multiple channels, you still need a bot token

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

## Portal das Finanças (e-fatura)

### Session Switching Between Personal and Company NIF
The e-fatura portal maintains separate sessions for personal and company NIFs. During a browser session, navigating directly to invoice detail URLs (e.g., `detalheDocumentoAdquirente.action?idDocumento=...`) can cause the session to switch to a different NIF (e.g., from personal "Gonçalo Paraizo Gomes" to company "Modern Marathon Lda"). Always check the welcome message ("Bem-vindo(a) [name]") after navigating. If it switches, the user must log out ("Fechar Sessão") and re-login with the correct NIF.

### "Outros" = Despesas Gerais Familiares
In the detail page dropdown ("Atividade de Realização da Aquisição"), "Outros" (C99) is the equivalent of "Despesas Gerais Familiares" (DGF). The listing page shows "DGF" as a search filter, but the edit form uses "Outros".

### Invoice Category Codes
- C01: Veículos automóveis (repair)
- C02: Motociclos (repair)
- C03: Alojamento/restauração
- C04: Cabeleireiro/beleza
- C05: Saúde
- C06: Educação
- C07: Imóveis
- C08: Lares
- C09: Veterinário
- C10: Transportes públicos
- C11: Ginásios
- C12: Jornais/Revistas
- C99: Outros (= Despesas Gerais Familiares)

### Deadline for Validating Invoices
2025 expenses must be validated on e-fatura by **March 2, 2026** (normally end of Feb, but extended because it falls on a weekend).

### CAE Mismatch — Cannot Override Emitter's Sector
When categorizing an invoice into a sector that doesn't match the emitter's registered CAE/CIRS codes, the portal redirects to `resolverPendenciaAdquirente.action` with a warning: "O emitente não tem atividade registada (CAE/CIRS) pertencente ao setor indicado." This is a **server-side validation** that cannot be bypassed. Examples:
- **MetLife** (NIF 980479436, insurance company) → cannot be set to Saúde (C05) despite health insurance being IRS-deductible as health
- **BCP / Santander** (banks) → cannot be set to Imóveis (C07) despite mortgage payments being housing deductions
- **Solution**: Leave these as Outros (C99) on e-fatura. Declare them manually on **IRS Modelo 3 Anexo H** (Benefícios Fiscais e Deduções) to claim the correct deduction.

### Listing Page "Setor" Column Shows Emitter's Sector, Not Acquirer's Classification
The "Setor" column on the listing page (`consultarDocumentosAdquirente.action`) shows the emitter's registered business sector, NOT the classification chosen by the acquirer. Healthcare providers (pharmacies, clinics) often show blank because they haven't declared a sector with AT. The acquirer's chosen classification is only visible on the detail page (`detalheDocumentoAdquirente.action`) in the `ambitoAquisicao` select/input.

### Automated Invoice Categorization Flow (JavaScript)
The working pattern for automating invoice categorization:
1. On listing page: click "Pesquisar", set page size to 50, click invoice link
2. On detail page: click "Alterar" (`#alterarDocumentoBtn`), set `#ambitoAquisicao` to category code, set `#ambitoActividadeProf` to "1" (Não), click "Guardar" link
3. Verify: check for "guardada com sucesso" in page text
4. Navigate back to `consultarDocumentosAdquirente.action` (don't use history.back())
Important: The Guardar button handler uses jQuery `.one()` — fires only once per page load.

## Message Checker

### MCP Slack Tools as Fallback for Bot Token
When the Slack bot token is an `xapp-` app-level token (which can't call `conversations.history`), the MCP `mcp__claude_ai_Slack__slack_read_channel` tool works as an alternative — it uses its own OAuth connection. However, it requires the user to grant permission each time. For the automated scheduler (`claude -p`), this won't work since there's no user to approve. **Fix the root cause**: get a proper `xoxb-` bot token installed.

### Both Channels Must Be Functional for Message Checker
The check-messages job is useless until at least one channel works:
- **Slack**: Needs `xoxb-` bot token (not `xapp-`)
- **WhatsApp**: Needs `wacli` session reconnected (`wacli login`)
Until fixed, the scheduler job just burns cycles.

## Mac Mini Remote Automation

### Claude Code Auth on Remote Machine — Copy Credentials Won't Work If Token Expired
Copying `~/.claude/credentials.json` from one machine to another only works if the access token is still valid. If expired, the refresh token needs the original machine's auth session context. The safest approach: open the `claude auth login` OAuth URL from the remote machine in a **local browser** (where you're already logged into claude.ai), click "Authorize", then copy the auth code back.

### `claude auth login` Uses Raw Terminal Input
The CLI uses a Node.js terminal UI (likely Ink) that reads input in raw mode. This means:
- `tmux send-keys` doesn't reliably paste the OAuth code
- `expect`/`send` also fails with TIMEOUT_AFTER_CODE
- The auth URL approach (opening in a browser) + copying the code back is the only reliable programmatic method

### Mac Mini SSH — Always Prefix PATH
Homebrew on Mac Mini is at `/opt/homebrew/bin` but not in default SSH PATH. Always prefix commands with: `export PATH=/opt/homebrew/bin:$PATH`

### Mac Mini Gateway — Start Pattern
```bash
# On Mac Mini:
cd ~/Projects/ekus/mac-mini/gateway
nohup uv run python main.py > /tmp/ekus-gateway.log 2>&1 &
```
Management script: `./scripts/mac-mini.sh start|stop|restart|status`

### Claude Code Credentials File Is `.credentials.json` (With Leading Dot)
Claude Code stores OAuth credentials in `~/.claude/.credentials.json` (with a leading dot), NOT `~/.claude/credentials.json`. On macOS it tries the Keychain first, then falls back to this plaintext file. If you write credentials to the wrong filename, `claude auth status` will report `loggedIn: false`.

### Chrome Extension JS Click > Coordinate Click for OAuth Pages
On the Claude OAuth authorize page, coordinate-based clicks on the "Authorize" button don't register. Use JavaScript `document.querySelector('button').click()` via `mcp__claude-in-chrome__javascript_tool` instead.

### Mac Mini settings.json Must Be Minimal (No Plugins/Hooks)
The `~/.claude/settings.json` is synced from the MacBook Pro but its plugins, hooks, and status line commands cause `claude -p` to hang indefinitely on the Mac Mini (zero output, no timeout). The Mac Mini needs a **minimal** settings.json with only:
```json
{ "permissions": {"defaultMode": "default"}, "skipDangerousModePermissionPrompt": true, "promptSuggestionEnabled": false, "effortLevel": "high" }
```
The plugins (context7, frontend-design, etc.) try to connect to MCP servers or load resources that aren't available headless. The hooks reference `terminal-notifier` which isn't installed. Either causes indefinite hang.

### .env Already Deployed to Mac Mini
The `./scripts/mac-mini.sh deploy` rsync excludes `.env` (to avoid overwriting). The `.env` was manually copied earlier and has all the same keys as the local one. If new keys are added locally, they must be manually copied to the Mac Mini.

### Headless Worker — Use tmux -d, Not Terminal.app
The original mac-mini-agent used `osascript` to open Terminal.app windows. For headless/SSH operation, use `tmux new-session -d -s name -c cwd` instead. This works over SSH without a GUI session.

## People

### Wilson Bicalho
Next Border (NB) team member. Handles business development / investor outreach. Sends pitch decks to potential investors on behalf of NB. Email: wilson@nextborder.co (or similar NB domain).

### Carla Lima
Next Border (NB) partner. Has a recurring "SYNC Estratégico Next Border" meeting with Gonçalo (weekly/biweekly on Mondays at 11:00). Strategic role at NB.
