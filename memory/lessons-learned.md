---
tags:
  - ekus
  - memory
aliases:
  - Lessons Learned
---
# Lessons Learned

*Hard-won knowledge from real-world usage. Read this to avoid repeating mistakes.*

## Table of Contents
- [[#Dashboard & Task Storage]]
- [[#Software Development]]
- [[#Python / Package Management]]
- [[#Email]]
- [[#Invoice Collection (Faturas)]]
- [[#Browser Automation]]
- [[#Trello API]]
- [[#Hourly Digest]]
- [[#Scheduling & Reminders]]
- [[#Image Generation]]
- [[#Voice / TTS]] (includes faster-whisper, WebSocket streaming)
- [[#Task Sync]]
- [[#Portal das Finanças (e-fatura)]]
- [[#Message Checker]]
- [[#Mac Mini Remote Automation]]
- [[#Skill Creator]]
- [[#Claude Code Channels]]
- [[#Frontend / UI]]
- [[#People]]

---

## Dashboard & Task Storage

### Cloudflare KV Was Migrated Away (2026-03-10)
The Cloudflare KV dashboard was introduced by Claude in commit `63a0703` (Feb 27) because the MacBook Pro isn't always on. After migrating ekus to the Mac Mini (always-on, Tailscale on all devices), the Cloudflare dependency was removed. Tasks and memory are now served from the Mac Mini gateway (port 7600) using local files (`data/tasks.md` and `memory/` directory). The `ekus-dashboard` Worker and `ekus-dashboard-data` KV namespace were deleted from Cloudflare. The `calendar-blockify-proxy` Worker was kept (unrelated). Joaquim's account (`1bae6fbaa2224005462fbbff7051ac05`) was not touched.

### Dashboard isCloudMode Check
The dashboard SPA has an `isCloudMode` variable that controls whether it auto-loads from the API. Originally it excluded `localhost` and `127.0.0.1`. For the gateway (accessed via Tailscale IP), this was simplified to just `!location.protocol.startsWith('file')` so it always loads from the API when served over HTTP.

### Obsidian Vault Moved Into Project (2026-03-12)
The Obsidian vault was moved from `~/Documents/obsidian-vault/` into the ekus project at `/Users/ggomes/Projects/ekus/obsidian-vault/`. Obsidian app config was updated to point to the new path. The vault has its own `.git/` repo and `obsidian-git` plugin for auto-commits — excluded from ekus git via `.gitignore`. The `memory/` directory contains symlinks to `obsidian-vault/Ekus/Memory/`. The deploy script uses `rsync -L` to follow symlinks and excludes `obsidian-vault/` from rsync. `obsidian-cli` (Yakitrak) is configured with the vault as default.

### Official Obsidian CLI Needs Enabling (2026-03-12)
The official `obsidian` CLI (referenced in `.claude/skills/obsidian-cli/SKILL.md`) is bundled with Obsidian.app but disabled by default. Enable it in: Obsidian → Settings → General → Advanced → Enable CLI. The third-party `obsidian-cli` (Yakitrak, installed via `brew tap yakitrak/yakitrak`) is a separate tool with different syntax (`obsidian-cli print` vs `obsidian read`).

### obsidian-cli Quirks (2026-03-12)
- `set-default` takes a **positional arg** (`obsidian-cli set-default /path/to/vault`), NOT `--vault=` flag — the `--vault` flag doesn't exist despite what you'd expect
- `search-content "term"` returns "Cannot find note in vault" — it seems to expect a note name, not a search term. Use `obsidian-cli print "note-name"` to read specific notes instead
- `print` works well for reading notes by name (matches fuzzy on filename without extension)

### Gateway Memory API — Dynamic Discovery (2026-03-12)
The memory API (`mac-mini/gateway/main.py`) was changed from a hardcoded `ALLOWED_MEMORY_FILES` set to dynamic discovery via `MEMORY_DIR.glob("*.md")`. New .md files added to `memory/` (which are symlinks to vault) auto-appear in the dashboard without code changes. Path traversal protection via `resolve().relative_to()` replaces the allowlist security model.

### Claude Code Runs ON the Mac Mini (2026-03-12)
The ekus project working directory IS on the Mac Mini. Do NOT try to SSH or rsync to it — you're already there. To deploy dashboard changes, just build locally and copy:
```bash
cd ekus-app && npx next build
rm -rf ../mac-mini/gateway/static && cp -r out ../mac-mini/gateway/static
```
No SSH, no gateway jobs, no git push needed. The `./scripts/mac-mini.sh deploy` script is for deploying FROM the MacBook TO the Mac Mini — irrelevant when already on the Mac Mini.

### Dashboard Deploy Requires SW Cache Bust (2026-03-12)
After deploying new static files, the service worker must be updated or users get `Cannot read properties of undefined (reading 'call')` from stale cached Webpack chunks. The `sw.js` now has a version string (`CACHE_VERSION`) and skips caching `_next/static/chunks/` entirely. The gateway serves `/sw.js` with `Cache-Control: no-cache` headers (custom route before StaticFiles mount). Users may still need a hard refresh after a deploy if the old SW is still active.

### Service Worker Caches Stale JS Chunks (2026-03-12)
The `sw.js` had a static `CACHE_NAME = 'ekus-v1'` that never changed between deploys. Since it uses network-first but caches responses, old JS chunks (from previous Next.js builds) would be served from cache when the network fetch returned a 404 for the old chunk URL. This caused `Cannot read properties of undefined (reading 'call')` — a Webpack module resolution error from mixing chunk versions. Fix: bump cache version on each deploy and skip caching `_next/static/chunks/` (they already have content hashes in filenames). Users may need to hard-refresh or unregister the service worker after a deploy.

### `claude -p` Streaming — Node.js PTY Server (2026-03-17)
`claude -p` in text mode buffers ALL output until done — no streaming, even in a PTY. **Fix:** Use `claude -p --output-format stream-json --verbose --include-partial-messages`. The three flags are ALL required: `--verbose` (otherwise error), `--include-partial-messages` (without it, stream-json only emits event-level chunks like full `assistant` and `result` messages, NOT token-level `content_block_delta` events). With all three flags, you get `stream_event` wrapping `content_block_delta` with `text_delta` — true token-by-token streaming. Terminal server (`mac-mini/terminal/server.js`) parses these via `extractText()`, sends clean text via WebSocket. Frontend `useJobStream` hook connects WS to port 7601, falls back to SSE after 3s. **Gotchas:** (1) node-pty's `spawn-helper` binary loses execute permission after npm install — `chmod +x` it; (2) Delete `CLAUDECODE` env var from PTY env or claude refuses to start; (3) node-pty delivers data in 1024-byte PTY buffer chunks — accumulate in lineBuffer, split on `\n`; (4) OAuth tokens on Mac Mini expire ~weekly — refresh with `ssh -tt mac-mini "claude auth login"` (`-tt` needed for PTY); (5) Skip `assistant`/`result` events when `gotStreamDeltas` is true to avoid duplicate text output.

### Streaming Output Race Condition — Use `stream.jobId` Not `activeStreamId` (2026-03-17)
When mapping streaming output to chat messages in React, do NOT use the state variable that tracks "which job are we streaming" (`activeStreamId`). When a new job starts, `activeStreamId` updates to the new ID but `stream.output` still holds the previous job's text for one render cycle. This causes `outputs[newJobId] = oldJobText` — responses appear under the wrong message. **Fix:** The `useJobStream` hook returns a `jobId` field that updates synchronously with output reset (both happen inside the same `useEffect`). Use `stream.jobId` to key the outputs map:
```typescript
useEffect(() => {
  if (stream.jobId && stream.output) {
    setOutputs((prev) => ({ ...prev, [stream.jobId!]: stream.output }));
  }
}, [stream.jobId, stream.output]);
```
This ensures output is always attributed to the correct job, even during the transition between jobs.

### Session Context — Inject Conversation History Into `claude -p` (2026-03-17)
`claude -p` is stateless — each invocation has no memory of previous calls. To maintain conversation context across messages in a session, the gateway (`_build_conversation_prompt()` in `main.py`) collects previous completed jobs from the same `conversation_id`, reads their prompts + log file outputs, and wraps them in `<conversation_history>` tags prepended to the current prompt. This gives Claude the illusion of a multi-turn conversation. **Key details:** (1) Only includes completed/failed jobs (not running ones, to avoid race conditions); (2) Prioritizes recent turns — if history exceeds 80K chars, it re-collects from newest to oldest; (3) Uses `full_prompt` field from YAML (not truncated `prompt`); (4) Reads output from `.log` files, not YAML summary. Alternative: `claude -p --resume <id>` uses Claude Code's internal session persistence but is harder to control with `stream-json` mode.

### Chat SSE Stream Field Mismatch (2026-03-12)
The gateway SSE stream sends `{type: "output", content: "..."}` but `use-job-stream.ts` was reading `data.text` instead of `data.content`. This caused: (1) `undefined` prepended to output, (2) crash on `undefined.length` fell into catch block which appended raw JSON string. Fixed by using `data.content ?? data.text ?? ''`. Also: jobs submitted via API (not typed by user) show as user messages in Chat tab — could be improved by distinguishing API-submitted vs user-submitted jobs.

### Chat Job ID Mismatch — `job_id` vs `id` (2026-03-12)
Gateway `POST /job` returns `{job_id: "xxx"}` but the frontend `chat-tab.tsx` checked `result.id`. Since `result.id` was always undefined, the SSE stream never started immediately after sending — it relied on SWR polling (3s delay) to detect the running job. Fixed by using `result.job_id || result.id`.

### Stale Closure in React SSE Reconnect (2026-03-12)
The `useJobStream` hook's `onerror` callback checked `status` (a state variable) to decide whether to reconnect. But the callback captured the stale closure value of `status` from when the effect ran, not the current value. Fix: use a `useRef` (`statusRef.current`) for values accessed inside event handler callbacks defined within `useEffect`. Pattern:
```typescript
const statusRef = useRef(status);
const updateStatus = (s) => { statusRef.current = s; setStatus(s); };
// In onerror: check statusRef.current, not status
```

### Channel Mode File Uploads — Must Upload Before Sending (2026-03-20)
In channel mode, `chat-tab.tsx` was passing `files.map(f => f.name)` (just filenames) to `channel.sendMessage()` instead of actually uploading the files first via `api.uploadFile()`. The upload endpoint returns `{path: "2026-03-20/uuid_filename.jpg"}` which must be stored as the file reference. Three things needed for images to work in chat: (1) Upload files via `/api/upload` before sending the channel message, pass returned paths; (2) Render `msg.files` array in chat bubbles (it existed on the message type but was never displayed); (3) Add CSS for images in `.markdown-content` (`max-width: 100%`, `height: auto`, `border-radius`). Also: `react-markdown` component overrides have `src` typed as `string | Blob | undefined` for `img` — needs explicit `typeof src === 'string'` guard.

### Image URLs — Three Path Formats Need Unified Handling (2026-03-20)
Image `src` and file attachment paths come in three formats that all need to resolve to `/api/uploads/{relative}`: (1) Already valid: `/api/uploads/...` or `http...` — pass through; (2) Absolute Mac Mini path: `/Users/.../uploads/2026-03-20/img.png` — regex extract after `uploads/`; (3) Relative upload path: `2026-03-20/img.png` — prefix with `/api/uploads/`. The shared `fixFileSrc()` in `markdown-renderer.tsx` handles all three. Both markdown images (via `MarkdownRenderer`) and file attachments (in `chat-tab.tsx`) must use this same function — duplicate URL logic is a bug magnet.

### Mobile File Uploads — HEIC Format & Silent Failures (2026-03-20)
iPhone photos are commonly `.heic` — must be in `ALLOWED_UPLOAD_TYPES` on the gateway or uploads silently fail. Additionally, the channel mode upload path in `chat-tab.tsx` had no `try-catch` — if the upload HTTP request returned a 400 (wrong format, too large), `Promise.all` resolved with error bodies (no `.path` field), but the message still tried to send with `undefined` paths. The user saw nothing happen. Fix: (1) Add `.heic`/`.heif` to allowed types in `main.py`; (2) Check `resp.ok` per-file and throw with the server's error detail; (3) Wrap uploads in try-catch with `channel.addErrorMessage()` for user feedback; (4) Add `uploading` state to show a spinner on the send button during upload.

## Software Development

### `claude mcp add` — Variadic Header Flag Eats Positional Args
The `-H`/`--header` option is variadic (`<header...>`), so it consumes all subsequent arguments including the server name and URL. Use `--` to separate options from positional args:
```bash
# Wrong — "stitch" gets consumed as a header value:
claude mcp add -t http -H "X-Api-Key: ..." stitch https://example.com/mcp

# Correct — use -- to stop option parsing:
claude mcp add -t http -H "X-Api-Key: ..." -- stitch https://example.com/mcp
```
Also: there is no `--url` flag — the URL is a positional argument (`<commandOrUrl>`).

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

### iOS Safari/PWA: File Input Picker Quirks
On iOS Safari (especially in PWA/homescreen mode), programmatic `.click()` on `<input type="file">` is unreliable — even with `sr-only` (visually hidden). The `display: none` approach fails completely, `sr-only` works inconsistently. The bulletproof fix: use `<label htmlFor="input-id">` instead of `<button onClick={() => ref.click()}>`. The browser natively associates the label tap with the input, bypassing all JS click reliability issues. Give each input an `id` and use matching `htmlFor` on the label.

**Second-use bug:** Even with `<label htmlFor>` and resetting `e.target.value = ''`, iOS/PWA won't re-trigger the file picker on the same input element a second time. Fix: use a React `key` that increments after each selection (e.g., `<input key={`photo-${inputKey}`} ...>`), forcing React to destroy and recreate the DOM element. A fresh input always works.

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

### Parallel Agent Workers vs Full Agent Teams
For large projects where work streams touch non-overlapping files (e.g., backend API vs frontend app), use parallel `Agent` tool calls with `run_in_background: true` instead of the full `TeamCreate`/`TaskCreate` flow. Simpler, less overhead, and just as effective when there are no inter-agent dependencies. Reserve Agent Teams for cases where agents need to communicate mid-task (e.g., one agent's output feeds another's input).

### CWD Shifts During Long Agent Sessions
Subagents may `cd` into subdirectories (e.g., `ekus-app/`), which changes the CWD for subsequent bash commands in the main agent too. Always use absolute paths (`/Users/ggomes/Projects/ekus/...`) when verifying files after agent teams finish. Relative paths like `ekus-app/src/...` will fail if CWD drifted.

### Ralph Loop + Agent Team Delegation
When running a Ralph loop with agent team delegation, the main agent just monitors progress each iteration (check TaskList, verify files). The team lead handles all coordination. Send a status check message to the team lead if a task stays in_progress for 5+ iterations — it may need a nudge. Don't spawn duplicate teams on re-entry — check if team already exists.

### dashboard.html Is Too Large to Read in One Go
The file exceeds 25k tokens. Read in chunks with `offset` + `limit` params, or search for specific sections with Grep.

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

### Verify Card ID Before Archiving
Trello card IDs can look very similar (e.g., `69aa7497...` vs `69aa7496...`). Always cross-reference the card `name` field before archiving — archiving the wrong card requires an immediate unarchive (`closed=false`) to fix.

### Archive via Form Body, Not Query String
Use `-d "closed=true"` (form body) instead of `?closed=true` (query string). The query string version intermittently returns "missing scopes".

### Trello Token Has Read+Write Scope (updated 2026-03-23)
Token was regenerated with `read,write` scope. Archive, create, and move operations all work now. Two-way sync (Trello ↔ Dashboard) is fully operational.

### trello.json Config Structure
The config at `config/trello.json` uses nested keys: `boards.geral.id` for the board ID and `boards.geral.lists.a_fazer` etc. for list IDs. There is NO top-level `board_id` key. Always parse with the correct path: `json['boards']['geral']['id']`.

### "unauthorized permission requested" = Wrong List ID
The Trello API returns `unauthorized permission requested` when you use a non-existent or wrong list ID — NOT a clear 404. Always verify list IDs via `GET /1/boards/{boardId}/lists` if you get this error. The Eventualmente list ID had a typo in `config/trello.json` (`3` vs `4` in one character) that caused silent failures.

## Hourly Digest

### Python Subprocess Doesn't Inherit Shell Env Vars
`source .env` sets variables in the current shell but does NOT export them. Python's `os.environ` only sees exported variables. Fix: `source .env && export SLACK_WEBHOOK_URL && python3 << 'PYEOF'`. Alternatively, use `set -a; source .env; set +a` to auto-export all sourced vars.

### Google Calendar MCP Requires User Permission
The `gcal_list_events` MCP tool requires interactive user approval. In `claude -p` (non-interactive), this silently fails. For automated digests, pre-approve the tool in `.claude/settings.json` under `allowedTools`.

### Google Calendar MCP Works in Interactive Mode (confirmed 2026-03-23)
The MCP Calendar connection (list events, create, delete) all work fine in interactive sessions. The issue was only with automated/non-interactive runs. Used successfully to list and delete 8 Easter events in one session.

### Google Calendar REST API Needs OAuth, Not API Key
The `GOOGLE_API_KEY` in `.env` does NOT work for Calendar API — returns 403 "Method doesn't allow unregistered callers". Calendar API requires OAuth2 tokens, not simple API keys. For automated access, either pre-approve the MCP tool or set up OAuth2 credentials with a refresh token.

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
- As of 2026-03-20, both `SLACK_BOT_TOKEN` and `SLACK_WEBHOOK_URL` are configured in `.env` and working
- MCP Slack tool (`slack_send_message`) also requires interactive permission approval, so it fails in `claude -p` automated mode
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

### getUserMedia Requires HTTPS (Secure Context)
`navigator.mediaDevices.getUserMedia` is blocked on plain HTTP origins (like `http://100.90.155.85:7600`). Browsers require HTTPS or localhost. Solution: uvicorn dual-bind — gateway serves both HTTP (7600) and HTTPS (7443) using Tailscale certs (in `certs/` dir). Do NOT use a separate HTTPS reverse proxy — `urllib`/`http.server` proxies break multipart file uploads and can't handle WebSocket upgrade. The gateway's `__main__` block uses `asyncio.gather(http_server.serve(), https_server.serve())` when certs exist.

### Gateway Must Load .env for API Keys
The gateway (`main.py`) uses `os.environ.get()` for API keys but doesn't auto-load `.env`. Added inline `.env` loader at top of `main.py` (reads `../../.env` relative to gateway). Without this, OPENAI_API_KEY and ANTHROPIC_API_KEY are missing and voice endpoints return 500.

### faster-whisper Requires ffmpeg + onnxruntime on Mac Mini (2026-03-22)
The streaming dictation pipeline has two extra dependencies beyond faster-whisper:
- **ffmpeg**: subprocess to decode WebM/Opus to PCM (`brew install ffmpeg`). Spawns `ffmpeg -i pipe:0 -f s16le -ar 16000 -ac 1 pipe:1` per session.
- **onnxruntime**: Silero VAD uses ONNX model directly (NOT torch). The `voice/vad.py` module downloads `silero_vad.onnx` from GitHub to `~/.cache/silero-vad/` and runs inference via `ort.InferenceSession`. This avoids the heavy torch dependency.
After deploy, always check `uv sync` ran and gateway logs for import errors.

### Gateway Dependencies Must Be Installed on Mac Mini
The deploy script rsyncs code but doesn't run `uv sync` or `pip install`. New Python dependencies (like `httpx`) must be installed manually on Mac Mini: `ssh mac-mini "cd ~/Projects/ekus/mac-mini/gateway && uv add <package>"`. Check gateway logs (`/tmp/ekus-gateway.log`) for `ModuleNotFoundError` after deploy.

### Import Order Matters in main.py
When adding early-loading code (like .env parsing) to `main.py`, ensure `from pathlib import Path` comes before it's used. The original imports are scattered — `Path` was imported at line 28, but .env loading needed it at line 15. Move the import up or use `pathlib.Path` inline.

### Voice Tab Backend API (Gateway)
The Voice tab uses 3 separate backend endpoints (not one combined endpoint):
- `POST /api/voice/transcribe` — accepts audio file (multipart), calls OpenAI Whisper (whisper-1), returns `{audio_id, text}`
- `POST /api/voice/analyze` — accepts text + optional prompt, calls Claude CLI (`/opt/homebrew/bin/claude -p`) using Max account OAuth auth, returns `{analysis}`. Must strip `ANTHROPIC_API_KEY` from subprocess env so Claude CLI uses its own OAuth instead of the invalid env key.
- `POST /api/voice/tts` — accepts text + optional voice, calls OpenAI TTS (tts-1), streams back audio/mpeg
- WhatsApp: `GET /api/whatsapp/conversations` (uses `wacli chats list --json --limit 20`) + `POST /api/whatsapp/send` (text only) + `POST /api/whatsapp/send-audio` (generates TTS then sends MP3 via `wacli send file`)
- Voice+WhatsApp sends **audio files, not text**. The `/api/whatsapp/send-audio` endpoint takes `{recipient, text, voice?}`, generates TTS internally (OpenAI tts-1), saves MP3 to `data/voice/`, and sends via `wacli send file --to <jid> --file <path>`. Default voice is `onyx` (male).
- wacli commands: `chats list` (not `list`), `send text --to --message`, `send file --to --file`. Use `--json` for machine-readable output. Needs `wacli auth` + QR scan first.
- **wacli JSON keys are capitalized**: `Name`, `JID`, `Kind`, `LastMessageTS` — NOT lowercase. The gateway was returning empty contacts because it read `chat.get("name")` instead of `chat.get("Name")`. Always check actual wacli output before parsing.
Frontend: voice-tab.tsx has inline contact picker (scrollable chips), auto-send toggle. WhatsApp send button is rendered **inside VoiceResults** compressed card (not in the parent voice-tab.tsx — buttons at the bottom of scrollable containers get hidden on mobile). Auto-send useEffect calls `api.sendWhatsAppAudio()` directly instead of going through `sendToWhatsApp` callback to avoid stale closures. Processing hook in `use-voice-processing.ts`.

### Claude OAuth Tokens ≠ API Keys for Direct Calls
Claude Code OAuth tokens (`sk-ant-oat01-*`) from `~/.claude/.credentials.json` do NOT work as `x-api-key` or `Authorization: Bearer` for direct `api.anthropic.com` calls. They only work through the Claude Agent SDK or Claude CLI. For gateway endpoints that need Claude, spawn `claude -p --output-format text` as a subprocess with absolute path (`/opt/homebrew/bin/claude`). Strip `ANTHROPIC_API_KEY` from env so CLI uses its own OAuth. `uv run` strips PATH so subprocess can't find `claude` without absolute paths.

### API Client Must Check r.ok Before Parsing JSON (2026-03-20)
The `api.ts` helper uses `fetch().then(r => r.json())` which never checks `r.ok`. When a backend endpoint returns HTTP 4xx/5xx, `fetch` still resolves (only rejects on network errors). The error JSON (`{"detail":"..."}`) gets parsed, but the expected fields are missing — so the result is silently undefined. Fixed for voice endpoints with a `checkedJson()` helper that throws on non-200. **The rest of api.ts still has this pattern** — fix other endpoints as they break.

### faster-whisper on Mac Mini (2026-03-22)
When switching from OpenAI Whisper API to local faster-whisper on Mac Mini (Apple Silicon):
- Use `compute_type="int8"` — quantization reduces model from ~3GB to ~1.6GB and improves CPU throughput by ~40% with minimal quality loss
- Use `cpu_threads=4` for M-series chips (efficiency + performance cores)
- Lazy-load the model (first call takes ~5s, then stays resident)
- Always wrap transcription in `asyncio.to_thread()` since faster-whisper is CPU-bound and will block the FastAPI event loop
- `vad_filter=True` in faster-whisper enables built-in Silero VAD, but for streaming you need to run VAD explicitly on incoming audio chunks (not wait for entire recording)
- The `initial_prompt` parameter is key to quality: include language instruction, known vocabulary, and correction pairs to bias recognition

### Gateway Must Be Fully Restarted After Deploy (2026-03-22)
The deploy script (`mac-mini.sh deploy`) rsyncs code and restarts, but if `kill $(lsof -ti :7600)` doesn't fully terminate the old process (e.g., port still bound), the new gateway may fail to start on :7600 while :7443 HTTPS starts fine. Always kill BOTH ports: `kill $(lsof -ti :7600) 2>/dev/null; kill $(lsof -ti :7443) 2>/dev/null; sleep 2` before starting. Also: testing imports with bare `python3` misses venv packages — always use `uv run python` on Mac Mini. Quick restart one-liner: `ssh ggomes@100.90.155.85 "export PATH=/opt/homebrew/bin:\$HOME/.local/bin:\$PATH && kill \$(lsof -ti :7600) 2>/dev/null; kill \$(lsof -ti :7443) 2>/dev/null; sleep 2 && cd ~/Projects/ekus/mac-mini/gateway && nohup uv run python main.py > /tmp/ekus-gateway.log 2>&1 &"`

### Deploy Voice Dictation Checklist (2026-03-22)
After deploying the voice dictation feature: (1) `./scripts/mac-mini.sh deploy` builds+rsyncs+restarts, (2) `uv sync` on Mac Mini — needs full PATH export since SSH doesn't load shell profile: `export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"`, (3) verify ffmpeg installed (`brew install ffmpeg`), (4) smoke test: `curl /api/voice/preferences` and `curl /api/voice/corrections`, (5) first transcription downloads large-v3 model (~1.6GB) — allow a few minutes.

### VoiceResults "Transcribe Only" Mode Hides Transcription (2026-03-23)
In `voice-results.tsx`, the "Original" transcription section uses `showOriginal` state that defaults to `false` (collapsed). In "Transcribe Only" mode (no analysis/compression), the transcription is the PRIMARY result but was invisible — user had to click to expand. Fix: `useEffect` that auto-expands when `transcription` exists without `analysis`, and auto-collapses when `analysis` arrives. Also relabel "Original" → "Transcription" and boost text contrast when it's the primary result.

### Auto-Learn Hook Resets Per Turn (2026-03-22)
The `auto-learn-stop.sh` hook counts tool calls since last memory save, but resets each turn. In long agent-team sessions where the lead is mostly coordinating (sending messages, checking tasks), the counter hits 150+ without any file write. Fix: do a memory write early in each long coordination stretch, not just once at the start.

### Voice Dictation System File Layout (2026-03-22)
Backend: `mac-mini/gateway/voice/` (8 modules: transcriber, vad, pipeline, db, cleanup, routes, eval, __init__). Frontend: `ekus-app/src/features/voice/dictation/` (7 files: use-dictation, use-corrections, dictation-view, dictation-controls, dictation-transcript, dictation-toolbar, corrections-panel). SQLite DB at `data/voice/dictation.db`. Eval test corpus at `data/voice/eval/`.

### New Voice Router Coexists with Old Endpoints (2026-03-22)
When adding the new `voice_router` (mounted at `/api/voice`), existing endpoints like `POST /api/voice/transcribe` in main.py still work because FastAPI matches more-specific routes first. The new router adds `/transcribe-local`, `/corrections`, `/vocabulary`, `/preferences`, `/cleanup`, and WS `/dictation` — none conflict with the old `/transcribe`, `/analyze`, `/tts` endpoints. Always keep old endpoints for backward compat until the frontend is fully migrated.

### WebSocket Audio Streaming Architecture (2026-03-22)
For real-time voice dictation in a PWA (not Electron):
- Use a DEDICATED WebSocket (not reuse existing channel WS) — mixing binary audio with JSON chat is fragile
- Browser sends WebM/Opus chunks via MediaRecorder `timeslice: 500` (500ms chunks)
- Server decodes to PCM via streaming ffmpeg subprocess (stdin pipe, 16kHz mono s16le)
- Silero VAD runs on 30ms frames to detect speech boundaries
- Segment assembly needs pre-roll (200ms) + post-roll (350ms) padding around detected speech
- Partials (beam_size=1 for speed) every ~2s during speech; finals (beam_size=5) on segment end
- Claude cleanup runs ONCE when user stops (not per-segment) to keep latency reasonable

### Agent Teams: Parallel Backend + Frontend (2026-03-22)
For large features touching both backend and frontend, spawn both teammates in parallel from the start. The frontend can build against the planned API contract (types, hooks, component structure) while the backend builds the actual endpoints. Sequential phases (like VAD pipeline depending on transcriber) should be assigned to the same teammate to avoid handoff overhead. Keep task dependencies explicit via TaskUpdate addBlockedBy. Idle notifications between turns are normal — teammates wake up when messaged. For 5-phase projects: 2 teammates can cover all work by reassigning after each phase completes.

### iOS/Safari MediaRecorder Doesn't Support WebM (2026-03-20)
`MediaRecorder` on iOS Safari only supports `audio/mp4` (not `audio/webm`). Hardcoding `audio/webm` causes either a `NotSupportedError` or produces broken output. Fix: probe supported types in order: `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4` → `audio/aac` → omit (let browser pick default). Also ensure the blob type and filename extension match the actual recorded format when uploading to Whisper.

### Faster-Whisper Model Load Takes 44s on Mac Mini CPU (2026-03-23)
First load of `WhisperModel("large-v3", device="cpu", compute_type="int8", cpu_threads=4)` takes ~44s on Mac Mini M2. Subsequent transcriptions take ~9s for ~10s of audio. The dictation pipeline's `stop()` originally had a 10s timeout for the processor task, which killed transcriptions mid-flight. Fix: (1) increase timeout to 120s, (2) add `warm_up()` function in transcriber.py, (3) call it from `@app.on_event("startup")` via `asyncio.create_task(asyncio.to_thread(warm_up))` so the model is pre-loaded before the first dictation request. Note: the warm-up singleton has a race condition if called from multiple threads — two loads can happen, but only the first result is kept.

### Silero VAD Threshold Too High for Phone Microphone (2026-03-23)
Default VAD threshold of 0.5 works for Portuguese but fails for English on phone mic — probabilities hover at 0.3-0.5, never sustaining above 0.5 for enough consecutive frames. Lowered to 0.35 and reduced `min_speech_duration_ms` from 250 to 160 (5 consecutive frames instead of 7). Phone mic audio is also much quieter than test TTS audio (rms=278 vs rms=7038), so the threshold needs headroom.

### Silero VAD ONNX Model Is Broken — Use PyTorch (2026-03-23)
The Silero VAD ONNX model downloaded from `https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx` returns ~0.001 probability for ALL inputs (silence, sine waves, real speech). The model is non-functional as of silero-vad v6. Fix: install `silero-vad` pip package (`uv add silero-vad`, which pulls in `torch` + `torchaudio`) and use `load_silero_vad(onnx=False)` for PyTorch inference. The PyTorch model works correctly (0.999 for real speech). Also: Silero VAD requires 512-sample frames (32ms at 16kHz), NOT 480 (30ms). Using wrong frame size produces garbage probabilities.

### WebSocket Closes Before Transcription Completes (2026-03-23)
The dictation WS handler calls `await session.stop()` which waits for transcription (13s+ on CPU). The frontend had a 5s timeout that gave up and set status to 'idle'. Meanwhile, the backend's `session.stop()` completed and tried to send results via the closed WS → "Cannot call send once a close message has been sent". Fix: (1) increase frontend timeout from 5s to 60s, (2) close WS only AFTER receiving the 'stopped' event (call `cleanupWs()` in the `stopped` handler), (3) wrap the backend's `send_json` in try/except so send failures don't crash the handler. The general pattern: for long-running async operations over WebSocket, the frontend must keep the connection alive until the operation completes.

### Voice Dictation Pipeline Debugging Strategy (2026-03-23)
When dictation produces no transcription, diagnose stage by stage with `print(..., flush=True)` (not logging — see Python logging lesson):
1. **WebSocket**: Check `[WS] Chunk #N` — are audio chunks arriving? (271KB = ~8.5s of 16kHz PCM)
2. **FFmpeg**: Check `[FFMPEG] First PCM chunk` and `[FFMPEG] EOF after N bytes` — is ffmpeg producing PCM output?
3. **Frames**: Check `[FRAMES] #N: rms=X max=Y` — is PCM data non-silent? (rms > 100 = real audio, rms < 10 = silence/corrupt)
4. **VAD**: Check `[VAD] frame=N prob=X` — what speech probabilities is Silero returning? (prob > 0.5 = speech detected)
5. **Transcription**: Check `[TRANSCRIBE] Segment N` — did a segment finalize and get sent to faster-whisper?
If audio flows through ffmpeg (step 2 OK) but VAD never fires (step 4 shows prob always < 0.5), check: ffmpeg output format (must be s16le 16kHz mono), MediaRecorder input format (iOS sends mp4, not webm — ffmpeg `-f webm` won't decode mp4).

## Task Sync

### Tasks Live on Mac Mini Gateway
The task list is stored in `data/tasks.md` on the Mac Mini and served via the gateway API.
- **Dashboard:** http://100.90.155.85:7600/dashboard (Tailscale)
- **Read:** `GET /api/tasks`
- **Write:** `PUT /api/tasks` with `Content-Type: text/plain`
- Memory files served from `memory/` directory via `/api/memory` endpoints.

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

### Mac Mini SSH — Specify Identity File Explicitly (2026-03-12)
SSH to Mac Mini fails with "Too many authentication failures" unless `-o IdentityFile=~/.ssh/id_ed25519 -o IdentitiesOnly=yes` is specified. The deploy script `mac-mini.sh` `ssh_cmd()` function and rsync `-e` flag must include these options. The MacBook Air key (`ggomes@Goncalos-MacBook-Air.local`) was missing from `~/.ssh/authorized_keys` on the Mac Mini — added via a gateway job. If SSH breaks again, check authorized_keys first.

### Deploy Script Paths (2026-03-12)
The `mac-mini.sh` deploy section had hardcoded `/Users/ggomes/ekus/` instead of the correct `/Users/ggomes/Projects/ekus/`. Fixed to use `$(cd "$(dirname "$0")/.." && pwd)` for the project root. Always derive paths relative to the script location.

### Mac Mini Gateway — Start Pattern
```bash
# On Mac Mini:
cd ~/Projects/ekus/mac-mini/gateway
nohup uv run python main.py > /tmp/ekus-gateway.log 2>&1 &
```
Management script: `./scripts/mac-mini.sh start|stop|restart|status`

### Mac Mini Gateway — `nohup uv` Fails Over SSH (2026-03-23)
`nohup uv run python main.py` fails with "uv: No such file or directory" when run via `ssh mac-mini '...'` because `uv` is installed via Homebrew and not in the default SSH PATH. Use the full path: `nohup /opt/homebrew/bin/uv run python main.py > /tmp/ekus-gateway.log 2>&1 &`. Alternatively, `lsof -ti:7600` may show the gateway is supervised by launchd and auto-restarts on kill — in that case, `kill -9 <pid>` is enough to restart with new code (after clearing `__pycache__`).

### Mac Mini Gateway — Rsync to Correct Path (2026-03-23)
The gateway runs from `/Users/ggomes/Projects/ekus/mac-mini/gateway/` (verified via `lsof -p <pid> | grep cwd`). An earlier rsync target of `/Users/ggomes/ekus/` was wrong — code deployed there is never loaded. Always rsync to: `ggomes@100.90.155.85:/Users/ggomes/Projects/ekus/mac-mini/gateway/voice/`

### Mac Mini Gateway — Launchd Auto-Restart (2026-03-23)
The gateway process is managed by launchd and auto-restarts when killed. To restart with new code: (1) clear `__pycache__`, (2) `kill -9 <pid>` — launchd respawns it automatically. No need for manual `nohup` start. Verify the new PID is different after kill.

### Claude Code Credentials File Is `.credentials.json` (With Leading Dot)
Claude Code stores OAuth credentials in `~/.claude/.credentials.json` (with a leading dot), NOT `~/.claude/credentials.json`. On macOS it tries the Keychain first, then falls back to this plaintext file. If you write credentials to the wrong filename, `claude auth status` will report `loggedIn: false`.

### macOS Keychain Blocks SSH-Based Claude Auth (2026-03-22, updated 2026-03-23)
Claude Code on macOS always prefers Keychain storage. Even after deleting the Keychain entry and re-running `claude auth login`, the running Claude Code session recreates the Keychain entry and may delete `.credentials.json`. SSH sessions can't read Keychain (`errSecInteractionNotAllowed`), so the auto-refresh cron loses access to tokens.

**Full fix (3 layers):**
1. `channel-start` script deletes Keychain entry before starting Claude Code: `security delete-generic-password -s "Claude Code-credentials" 2>/dev/null`
2. After `claude auth login`, extract Keychain → file via GUI context: `osascript -e 'tell application "Terminal" to do script "security find-generic-password -s \"Claude Code-credentials\" -a \"ggomes\" -w > /tmp/kc.txt"'` then copy to `.credentials.json` + `credentials.json`
3. Auto-renewal cron (`scripts/refresh-claude-auth.sh` every 2h) writes to BOTH files; if files are missing, tries Keychain extraction via osascript

**Key insight:** Claude Code token TTL is ~8 hours. Cron at 2h intervals with 2h threshold means refresh happens at ~6h mark, giving 2h of margin. Write to BOTH `.credentials.json` and `credentials.json` as redundancy.

### Mac Mini Jobs — Headed Tmux (2026-03-13)
User prefers "headed" tmux sessions for agent jobs — Terminal.app window opens so you can watch the agent work live. `worker.py` uses AppleScript (`tell application "Terminal" to do script`) instead of `tmux new-session -d`. The capture-pane polling and sentinel logic works identically whether the session is attached or detached.

### macOS Screen Recording Permission Can't Be Granted via SSH (2026-03-13)
Screen recording (`kTCCServiceScreenCapture`) lives in the **system** TCC database (`/Library/Application Support/com.apple.TCC/TCC.db`), which is SIP-protected — even `sudo sqlite3` returns "attempt to write a readonly database". The only way to grant it is via the GUI: System Settings > Privacy & Security > Screen Recording.

**What works from SSH:** `screencapture`, `open` (launch apps), `sudo` (via heredoc). **What doesn't:** `osascript` System Events (no Accessibility for SSH session), `cliclick` keyboard/mouse (same reason), `tccutil` (can only reset/remove permissions, not grant), LaunchAgents with AppleScript (don't interact with GUI from SSH context), direct TCC.db sqlite3 writes (SIP-blocked even with root).

**Workaround:** Enable macOS built-in VNC via ARD kickstart (requires sudo), connect via VNC, toggle the permission manually in System Settings. See workflow "Restore macOS GUI Permission Remotely via VNC."

**sudo password gotcha on MacBook Pro:** The `!!!` in the password gets expanded by bash history. Must use heredoc with quoted delimiter: `cat << "PASS" | sudo -S <command>\n2WS4rf3ed!!!\nPASS` — quoting the heredoc delimiter ("PASS") prevents shell expansion.

### Chrome Extension JS Click > Coordinate Click for OAuth Pages
On the Claude OAuth authorize page, coordinate-based clicks on the "Authorize" button don't register. Use JavaScript `document.querySelector('button').click()` via `mcp__claude-in-chrome__javascript_tool` instead.

### Deploy Workflow: rsync vs git pull Conflict
When using `./scripts/mac-mini.sh deploy` (rsync) AND `git pull` on the Mac Mini, they conflict — rsync writes files directly, then `git pull` sees them as local changes and refuses to merge. **Pick one**: either always use `deploy` (rsync) OR always use `git push` + `git pull`. For code in the repo, prefer git push/pull. Reserve rsync deploy for quick iterations during development only.

### Mac Mini settings.json Must Be Minimal (No Plugins/Hooks)
The `~/.claude/settings.json` is synced from the MacBook Pro but its plugins, hooks, and status line commands cause `claude -p` to hang indefinitely on the Mac Mini (zero output, no timeout). The Mac Mini needs a **minimal** settings.json with only:
```json
{ "permissions": {"defaultMode": "default"}, "skipDangerousModePermissionPrompt": true, "promptSuggestionEnabled": false, "effortLevel": "high" }
```
The plugins (context7, frontend-design, etc.) try to connect to MCP servers or load resources that aren't available headless. The hooks reference `terminal-notifier` which isn't installed. Either causes indefinite hang.

### .env Already Deployed to Mac Mini
The `./scripts/mac-mini.sh deploy` rsync excludes `.env` (to avoid overwriting). The `.env` was manually copied earlier and has all the same keys as the local one. If new keys are added locally, they must be manually copied to the Mac Mini.

### Worker Tmux Sessions — Headed by Default (2026-03-13)
User prefers "headed" tmux sessions (Terminal.app window opens so you can watch live). For headless/SSH-only operation, fall back to `tmux new-session -d -s name -c cwd`. See "Mac Mini Jobs — Headed Tmux" entry above for details.

## Python / Shell

### Python Heredoc Parses Numbers as Code
When piping multiline text through `python3 << 'PYEOF'`, any content that looks like Python code gets parsed — e.g., `0222` in a task description triggers `SyntaxError: leading zeros in decimal integer literals`. **Fix:** use file-based approach instead: write content to a temp file, then process it. Avoid embedding arbitrary user content inside Python heredocs.

## Python / Package Management

### macOS: Use pipx for Python CLI Tools (2026-03-20)
macOS (Homebrew Python) blocks `pip install` system-wide due to PEP 668 ("externally-managed-environment"). Use `pipx` to install Python CLI tools in isolated venvs:
1. `brew install pipx && pipx ensurepath` (one-time setup)
2. `pipx install "package[extras]"` to install CLI tools
3. For packages that bundle Playwright, the `playwright` CLI isn't directly exposed by pipx. Run it from the venv: `~/.local/pipx/venvs/<package>/bin/playwright install chromium`
4. Installed CLIs land in `~/.local/bin/` — may need `export PATH="$HOME/.local/bin:$PATH"` or new terminal.

**Installed tools via pipx:** `notebooklm-py` (v0.3.4, with browser extras + Playwright chromium)

## Skill Creator

### SKILL.md `name` Must Be Hyphen-Case
The `name` field in SKILL.md frontmatter must be lowercase hyphen-case (e.g., `brainstorm`, `my-skill`). Title case like `Brainstorm` fails validation. The packaging script enforces this.

### Packaging Script Needs PyYAML via pipx
The `package_skill.py` and `quick_validate.py` scripts require `pyyaml` which isn't available system-wide on macOS. Run with: `pipx run --spec pyyaml python3 scripts/package_skill.py <path> <output>`. `uv run` also fails because it doesn't resolve the yaml dep automatically.

### Packaging Script Path
Always `cd` to the skill-creator directory first or use full paths: `cd /Users/ggomes/.claude/skills/skill-creator && pipx run --spec pyyaml python3 scripts/package_skill.py <skill-path> <output-dir>`

## Claude Code Channels

### Channels Require v2.1.80+ and claude.ai Auth (2026-03-20, updated 2026-03-23)
Claude Code Channels are a research preview feature (as of March 2026). Requirements: v2.1.80+, claude.ai OAuth login (no API keys/Console). Custom channels need `--dangerously-load-development-channels server:<name>` flag. The channel server is an MCP server spawned by Claude Code as a subprocess via `.mcp.json` — it communicates over stdio. For external input, the channel server runs its own HTTP listener in the same process. See `obsidian-vault/Ekus/Knowledge/Claude Code Channels.md` for full protocol reference.

**Version gotcha:** Claude Code on Mac Mini can silently downgrade (e.g., from 2.1.80 to 2.1.66) when the symlink at `~/.local/bin/claude` gets stale. Always run `claude update` before starting the channel. Current: v2.1.81. Check with `claude --version`.

### Keep `claude auth login` Alive in tmux (2026-03-20)
The `claude auth login` process must stay alive to exchange the OAuth code (PKCE requires the code_verifier from the same process). Use tmux to keep it running: `tmux new-session -d -s claude-auth 'claude auth login 2>&1 | tee /tmp/claude-auth.log'`. Then feed the code back via `tmux send-keys -t claude-auth "CODE" Enter`. If the process dies before receiving the code, you must start over with a fresh URL.

### OAuth URL Is Session-Specific (code_challenge) (2026-03-20)
The `claude auth login` OAuth URL contains a `code_challenge` that is tied to the specific `claude auth login` process. If that process dies (e.g., SSH disconnect, timeout), the code_challenge becomes invalid and you need to re-run `claude auth login` to get a fresh URL. The auth login process must stay alive to receive the code callback. On Mac Mini via SSH, use `ssh -tt` for PTY allocation and capture the URL before the process terminates.

### Piping `claude` (non -p mode) Through tee Breaks It (2026-03-20)
Running `claude ... 2>&1 | tee logfile` in tmux causes "Error: Input must be provided either through stdin or as a prompt argument when using --print" — the pipe interferes with Claude's terminal UI. For logging, redirect stderr only: `claude ... 2>/tmp/log` or use `script` command. The interactive `claude` command needs a real TTY.

### Bun Install on Mac Mini (2026-03-20)
Bun is not available via Homebrew on the Mac Mini. Install with: `curl -fsSL https://bun.sh/install | bash`. Binary goes to `~/.bun/bin/bun`. Add `$HOME/.bun/bin` to PATH in all scripts. Installed version: 1.3.11.

### macOS Has No `timeout` Command (2026-03-20)
macOS doesn't ship with GNU `timeout`. Use background process + sleep + kill pattern instead, or install `coreutils` via Homebrew for `gtimeout`. For SSH commands that might hang, use `ssh -o ConnectTimeout=5` instead.

### Channel MCP Server Needs GATEWAY_URL Env Var (2026-03-20)
The ekus-channel MCP server (`mac-mini/channel/server.ts`) defaults `GATEWAY_URL` to `http://localhost:7600`. Since it runs locally as a Claude Code subprocess but the gateway is on the Mac Mini (`100.90.155.85:7600`), replies fail with "Internal Server Error" — the POST to `/api/channel/reply` hits localhost which has no gateway. Fix: set `"env": {"GATEWAY_URL": "http://100.90.155.85:7600"}` in `.mcp.json`.

### FastAPI WebSocket Requires `websockets` Package (2026-03-20)
FastAPI's `@app.websocket()` decorator silently fails with 404 if the `websockets` PyPI package isn't installed. Uvicorn can't handle the WebSocket upgrade without it. Always add `websockets` to `pyproject.toml` dependencies when using `@app.websocket()`.

### Use `exec claude` in tmux (No Pipes) (2026-03-20)
When starting Claude Code in tmux for channel mode, use `exec claude --dangerously-load-development-channels ...` — do NOT pipe through `tee` or redirect stdout. The `| tee` pipe makes Claude detect a non-TTY stdout and switch to `--print` mode, which then errors with "Input must be provided either through stdin or as a prompt argument." Use `exec` so Claude replaces the shell and gets the real TTY.

### Make tmux Sessions Visible on Mac Mini (2026-03-20, updated 2026-03-23)
Detached tmux sessions (`tmux new-session -d`) are invisible when sitting at the Mac Mini. Use `osascript` to open a Terminal.app window that auto-attaches: `osascript -e 'tell application "Terminal" to do script "tmux attach -t ekus-claude"'`.

**Terminal.app window cleanup (critical):** When sessions are killed (switching, stopping), the Terminal.app windows with `tmux attach` become orphaned and accumulate. Fix in `_stop_claude_session()` and `_start_claude_session()` in `main.py`: (1) `pkill -f "tmux attach -t ekus-claude"` kills the attach processes, (2) `osascript -e 'tell application "Terminal" to close (every window whose processes = {})'` closes empty Terminal windows, (3) THEN kill the tmux session. Same pattern in `mac-mini.sh channel-start/stop` using `pgrep -f | xargs kill`.

### `--dangerously-load-development-channels` Requires Interactive Confirmation (2026-03-20)
Claude Code v2.1.80+ shows a safety prompt ("I am using this for local development" / "Exit") when using `--dangerously-load-development-channels`. In tmux, auto-confirm with `tmux send-keys -t ekus-claude Enter` after a short delay. The channel server won't start until this is confirmed.

### Gateway Session Controller: asyncio.Lock at Module Level (2026-03-20)
`asyncio.Lock()` can be created at module level in FastAPI apps — uvicorn's event loop is set up before the module's coroutines run. Used for `_session_lock` to serialize session switch operations and prevent concurrent switches from corrupting state.

### Claude Code --session-id and --resume Flags (2026-03-20)
`--session-id <uuid>` starts Claude Code with a pre-determined session UUID (we generate it). `--resume <uuid>` resumes an existing session with full context. Sessions stored as `.jsonl` files in `~/.claude/projects/<project-hash>/`. If the JSONL file is missing, `--resume` fails silently — always check existence before resuming and fall back to fresh `--session-id`.

### Chat First-Message Blank Screen Bug (2026-03-21)
In channel mode, the first message would cause the chat to go blank, recovering only on the second message. **Root cause (two-fold):**
1. **`clearMessages()` race condition** — The `useEffect` watching `activeSessionId` called `channel.clearMessages()` whenever `activeSessionId` was null. In channel mode, sessions start null, so every mount/re-render cleared messages. **Fix:** Track previous session via `useRef` and only clear when transitioning FROM a named session to null.
2. **Rendering gated on flickering `channelAvailable`** — The JSX only rendered channel messages when `channelAvailable` was true, but this flag (from `/api/channel/status` polling) can flicker to false momentarily. **Fix:** Use `isChannelMode = channel.messages.length > 0 || channelAvailable || sessionState === 'ready'` so messages survive brief status flickers.

**Pattern:** When gating UI rendering on an async polling status, always include the actual data presence (`messages.length > 0`) as a fallback condition — don't rely solely on the status endpoint.

## Frontend / UI

### PWA Service Worker Cache Blocks New Deploys (2026-03-22)
After deploying a new Next.js build, the browser may continue serving the OLD build from the service worker cache — even with a network-first strategy. Symptoms: UI looks outdated, new features missing, no errors. The JS file hash in the console (e.g., `page-7f133b8a12633765.js`) won't match the deployed file (e.g., `page-5f60966118844397.js`). **Fix:** Always bump `CACHE_VERSION` in `sw.js` before rebuilding. The new SW will install, activate, and delete old caches. Without this, the old SW keeps serving stale `index.html` which references old JS hashes. **Deploy checklist addition:** After `npm run build` + rsync, verify the browser loads the correct build hash by checking DevTools Network tab or `document.querySelectorAll('script[src*="page-"]')`.

### Python Logging Under Uvicorn Is Unreliable — Use print() (2026-03-23)
`logging.getLogger(__name__)` in FastAPI modules (e.g., `voice.routes`) produces NO output under uvicorn, even with `logging.basicConfig(level=logging.INFO)` added to `main.py`. Uvicorn's internal `dictConfig()` call overrides/interferes with the root logger's handlers. Tested: `log.warning()` and `log.info()` both silently drop. **Only `print(..., flush=True)` reliably appears in `/tmp/ekus-gateway.log`** (which captures both stdout and stderr via `nohup ... > log 2>&1`). For production diagnostics in the gateway, always use `print()` with `flush=True` — don't waste time debugging Python logging configuration under uvicorn.

### PWA Icon Replacement Requires Home Screen Re-add (2026-03-21)
Changing PWA icons (manifest.json icons, apple-touch-icon) doesn't update the icon on the user's home screen. They must delete the PWA and re-add it. Also: bump the service worker cache version and clean old caches (both `ekus-*` and `ekoa-*` prefixes) so stale assets don't persist. Source icons live in `ekoa-dev/_app-reference/public/ekoa-icon.png` (2048x2048) — use `sips -z` to generate 192/512 PNGs.

### Fixed Input Overlapping Bottom Nav (2026-03-21)
Chat input was `fixed bottom-[60px]` but the bottom nav is ~64px tall (pt-2 + min-h-56px items) before safe area. On iPhones with home indicator, the nav grows even taller. Fix: `bottom-[76px]` gives reliable clearance. Rule of thumb: measure the nav's actual rendered height (padding + item height + safe area) and add 8-12px gap.

### Claude Code Refreshes Tokens In-Memory, Not On Disk (2026-03-22)
`~/.claude/credentials.json` can show an expired `expiresAt` while `claude auth status` reports `loggedIn: true`. Claude Code refreshes OAuth tokens in-memory during a session but does NOT write updated tokens back to the file. This means: (1) copying credentials.json between machines gives you stale tokens, (2) the file's `expiresAt` is only accurate right after `claude auth login`, (3) you can't rely on the file to check if auth is valid — use `claude auth status` instead. **Implication for auto-renewal:** a cron-based refresh script must proactively refresh tokens via the OAuth endpoint and write them back to disk, since Claude Code won't do this for you.

### OAuth Refresh Rate Limits Are Token-Based, Not IP-Based (2026-03-22)
The `platform.claude.com/v1/oauth/token` refresh endpoint rate-limits by refresh token, not by IP. Retrying from a different machine (Mac Mini → MacBook) hits the same 429. Rate limit window appears to be 5+ minutes. **Lesson:** Don't rapid-fire refresh attempts. The auto-renewal script (`scripts/refresh-claude-auth.sh`) should run infrequently (every 6h) and only refresh when <1h remains.

### Mac Mini SSH PATH Missing Claude and Tmux (2026-03-22)
Non-interactive SSH sessions on the Mac Mini don't load the full PATH. `claude` is at `~/.local/bin/claude` and `tmux` is at `/opt/homebrew/bin/tmux` — neither is in the default SSH PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). Fix: always prepend `export PATH="/opt/homebrew/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH"` in SSH commands or tmux send-keys.

### Glass Morphism Kills Readability on Dark Backgrounds (2026-03-21)
Using `rgba(255, 255, 255, 0.08)` with `backdrop-filter: blur()` for chat message bubbles made them virtually invisible against the dark navy (#0f1419) background. The 8% white opacity provides almost no visual separation. **Fix:** Use solid dark surfaces (`#1a2636`) for any container that holds readable text. Reserve glass morphism for decorative elements (headers, nav bars) where contrast isn't critical. For chat specifically: user bubbles use the brand color (teal gradient) with white text, AI bubbles use a solid elevated dark surface with a colored left accent border.

## People

### Wilson Bicalho
Next Border (NB) team member. Handles business development / investor outreach. Sends pitch decks to potential investors on behalf of NB. Email: wilson@nextborder.co (or similar NB domain).

### Carla Lima
Next Border (NB) partner. Has a recurring "SYNC Estratégico Next Border" meeting with Gonçalo (weekly/biweekly on Mondays at 11:00). Strategic role at NB.

### Dona Ana
Cleaning lady. Coordinate house cleaning with her for special occasions.

### Household Context
- **Marília** — Gonçalo's wife. Her parents are part of family events.
- **Diogo** — Gonçalo and Marília's son.
- **Laura** — Gonçalo and Marília's daughter.
- **Elsa** — family member, invited to gatherings with her family.
- **Talho de Tires** — butcher shop, requires early reservation for lamb orders.
- **Quinta dos Cafanhotos** — lady who prepares baked cod trays (tabuleiros de bacalhau assado). Marília has the contact.
