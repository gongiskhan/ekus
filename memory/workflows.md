---
tags:
  - ekus
  - memory
aliases:
  - Workflows
---
# Workflows

*Proven step-by-step processes for common tasks.*

---

## Organize My Day

When the user asks to organize their day/tasks, follow this process:

1. **Fetch current state** (in parallel):
   - Dashboard tasks: `GET http://100.90.155.85:7600/api/tasks`
   - Trello cards: all lists from `config/trello.json` (`boards.geral.lists.*`)
   - Google Calendar: `gcal_list_events` for the day
2. **Map user's tasks** to existing Trello cards and dashboard items — avoid duplicates
3. **Trello updates** (in parallel):
   - Create new cards for tasks not already in Trello (use `pos=top` for priorities)
   - Rename/update existing cards if scope changed
   - Move cards between lists if priority changed (e.g., Brevemente → A Fazer)
4. **Dashboard update**: `PUT /api/tasks` with reorganized task list — priorities at the top of Active
5. **Calendar reminders**: Create daily morning reminder (8:30 AM) with popup notification, recurring for the requested period, with task summary in description
6. **Reply** with summary of all changes

**Voice transcription note:** "ECOSH" = Ekus (dashboard), "ECHOA" = Ekoa (app builder project).

---

## Dashboard (Ekoa App)

The Ekoa App (formerly Ekus) is a Next.js static export served from the Mac Mini gateway at `http://100.90.155.85:7600/` (Tailscale).
Frontend: `ekus-app/` (Next.js, builds to `out/`, copied to `mac-mini/gateway/static/`).
Backend: `mac-mini/gateway/main.py` (FastAPI) + `mac-mini/terminal/server.js` (Node.js PTY server).
Design: Dark theme (#0f1419) with teal accents (#2a9d8f), glass morphism, Ekoa branding.
7 tabs: Chat, Tasks (kanban), Scheduler (CRUD), Notes (CRUD), Memory (view/edit), Voice (record/transcribe/TTS/WhatsApp), Projects.
Deploy: `./scripts/mac-mini.sh deploy` (builds Next.js, rsyncs, restarts both services).

### UI Redesign via Agent Teams
For large UI redesigns spanning many components, use Agent Teams:
1. Update `globals.css` (design tokens/variables) first — this is the foundation
2. Spawn 3-4 agents in parallel, each handling a group of related components
3. Give each agent the Stitch HTML references + the new CSS variable names
4. Run `npm run build` after all agents complete to catch TypeScript/import errors
5. Deploy to Mac Mini for visual verification

### After Any Code Change (MANDATORY)
Always deploy+restart after modifying frontend or backend code:
```bash
cd /Users/ggomes/Projects/ekus && ./scripts/mac-mini.sh deploy
```
This builds Next.js, rsyncs to Mac Mini, and restarts gateway + terminal server.
Verify: `curl -s http://100.90.155.85:7600/health`

### HTTPS Access (for browser mic/camera)
- Gateway serves HTTPS on port 7443 natively (uvicorn dual-bind, no separate proxy)
- URL: `https://goncalos-mac-mini-1.tail31efa.ts.net:7443/`
- Certs at `mac-mini/gateway/certs/` (generated via `tailscale cert`, gitignored)
- HTTPS auto-starts if certs exist (same process as HTTP, supports WebSocket + multipart)
- Renew certs: `ssh mac-mini "/Applications/Tailscale.app/Contents/MacOS/Tailscale cert --cert-file ~/Projects/ekus/mac-mini/gateway/certs/cert.pem --key-file ~/Projects/ekus/mac-mini/gateway/certs/key.pem goncalos-mac-mini-1.tail31efa.ts.net"`

### Restart Services (Local — on Mac Mini)
1. `lsof -ti:7600 | xargs kill -9 2>/dev/null || true` — stop gateway
2. `lsof -ti:7601 | xargs kill -9 2>/dev/null || true` — stop terminal server
3. `cd mac-mini/terminal && npm install --production` — ensure deps
4. `cd mac-mini/terminal && nohup node server.js > /tmp/ekus-terminal.log 2>&1 &` — start terminal
5. `cd mac-mini/gateway && nohup uv run python main.py > /tmp/ekus-gateway.log 2>&1 &` — start gateway
6. Verify: `curl -s http://localhost:7600/health && curl -s http://localhost:7601/health`

### Deploy Dashboard (Local — on Mac Mini)
Claude Code runs ON the Mac Mini. Deploy is just a local build + copy + restart:
1. `cd ekus-app && npm install && npm run build`
2. `rm -rf ../mac-mini/gateway/static && cp -r out ../mac-mini/gateway/static`
3. Restart services (see above)
4. Verify: `curl -s http://localhost:7600/health && curl -s http://localhost:7601/health`

## Task Management (Automated)

### Hourly Digest (runs every hour 6am-11pm weekdays)
0. **Trello Sync**: Fetch Trello A Fazer + Brevemente cards AND Dashboard Active + Waiting On tasks. Fuzzy-match titles (case-insensitive, ignore accents/punctuation). Add missing items to both sides. PUT updated dashboard if changed.
1. Fetch tasks from local API: `curl -s "http://localhost:7600/api/tasks"`
2. Parse markdown: `## Active` = current tasks, `## Waiting On` = brevemente
3. Fetch today's + tomorrow's calendar events via MCP `gcal_list_events` (requires user permission -- falls back to "Calendario indisponivel" in automated runs)
4. Format as Slack mrkdwn: Agenda, Dev (priority), Outras, Brevemente, Amanha + dashboard link
5. Send via Slack webhook (`$SLACK_WEBHOOK_URL`) to #tudo (C091FP35C95)
6. Use `python3` heredoc to build JSON payload (avoids shell escaping issues)
7. Must `export` env vars before calling Python subprocess (`set -a && source .env && set +a` or explicit `export`)

### Message Checker (runs every 10 min, 6am–11pm)
1. Read last-checked timestamps from `config/message-checker-state.json`
2. Fetch new Slack DM messages from Gonçalo (user U091FP30H9V)
3. Fetch new WhatsApp messages from Gonçalo (+351936256982)
4. Process task commands: add task → Trello card, schedule → Trello + Calendar, autonomous tasks → just do them
5. Reply via same channel
6. Update state file with new timestamps

### Adding a Task (from any channel)
1. Determine the right Trello list (a_fazer for today, brevemente for soon, eventualmente for later)
2. Create Trello card: `curl -s -X POST "https://api.trello.com/1/cards?key=$TRELLO_KEY&token=$TRELLO_TOKEN" -d "idList=LIST_ID" --data-urlencode "name=Task name"`
3. If task has a date → create calendar event via gcal_create_event MCP
4. If recurring → add scheduler job via `scripts/add-job.sh`
5. Acknowledge to user in the channel they asked from

### Triple-Action Reminder (ADHD Support)
1. Create Trello card with due date
2. Create calendar event at exact time
3. Add scheduler job or crontab entry for notification
4. Confirm all three channels are set up

## Invoice Collection (Monthly)

### Sources to Check
1. **Email** — search: `subject fatura or subject recibo` (limit to date range)
2. **WhatsApp** — check for receipt images from Uber Eats, etc.
3. **Portals** — InvoiceXpress, banking portals (need browser)

### Full Workflow (proven 2026-02-27)
1. Search Gmail for Accoprime email: `from:accoprime subject:"documentos em falta"`
2. Open email in Chrome, click PDF attachment to preview the missing docs list
3. Read the list — note NIF, company name, doc number, date, amount for each
4. Search Gmail per company (use `from:` and `after:/before:` date filters):
   - BCP: `from:millenniumbcp "documentos em formato digital"` (enterprise emails from alertas.empresas@)
   - Credibom: `from:credibom subject:fatura` (arrives ~3rd of next month)
   - Via Verde: `from:viaverde OR from:brisa subject:extracto` (arrives ~14th of next month)
   - Ageas: `ageas fatura 503454109` (from documentacao.digital@ageas.pt)
   - Nexperience/Vendus: `509442013` or search for FT number (from info@vendus.pt)
5. Download attachments via Chrome: navigate to email → scroll to attachment → hover → click download icon
6. Move files from ~/Downloads to `faturas/YYYY-QN/found/`
7. Get Octa token if not in .env: Chrome → manager.octacode.pt → JS `localStorage.getItem('authToken')` → download as file
8. Upload via API (3 steps per file): presigned URL → PUT to S3 → notify (batch, once at end)
   ```bash
   source .env
   # Per file: get presigned URL, upload to S3
   # After all: POST /documentstorage/notify with file list
   ```
9. Verify on Octa Manager: Contabilista → MODERNMARATHON → Geral → check year selector
10. Report what's still missing (portals: Uber Eats, ESLI, Placegar, InvoiceXpress)

## Insurance Invoices (Seguros)

### What to Look For
- Psychologist invoices
- Psychiatrist invoices
- Dentist invoices (RiT Dental Care, etc.)
- Any other health-related receipts

### Where to Find Them
- Email (search by provider name)
- WhatsApp (check for forwarded receipts)
- Ask user if they have paper receipts to scan

### Upload to Insurance Portal
- Portal: Fidelidade MyFidelidade (my.fidelidade.pt)
- Need NIF + password to login
- Upload via "Pedido de Reembolso" section

## e-Fatura Invoice Categorization (IRS Personal Deductions)

### When
Annually, before March 2 (deadline for validating previous year's expenses).

### IRS Deduction Categories & Rates
- **Despesas Gerais Familiares** (Outros/C99): 35%, max 250€/person
- **Saúde** (C05): 15%, max 1000€ — pharmacies, hospitals, clinics, psychotherapy, health insurance (MetLife, Medis, etc.)
- **Educação** (C06): 30%, max 800€
- **Imóveis** (C07): 15%, max 502-700€ — mortgage interest, rent
- **Lares** (C08): 25%, max 403.75€
- **Alojamento/restauração** (C03): 15% — restaurants, hotels
- **Ginásios** (C11): 30% — sports/gym
- **Transportes públicos** (C10): 100% — monthly passes
- **Jornais/Revistas** (C12): 100%

### Steps (per invoice)
1. Navigate to `faturas.portaldasfinancas.gov.pt/consultarDocumentosAdquirente.action`
2. Check welcome message shows personal NIF (not company)
3. Click invoice link to open detail page
4. In "Informação Complementar" section, change "Atividade de Realização da Aquisição" dropdown to correct category
5. Set "Realizado no âmbito da atividade profissional?" to "Não"
6. Click "Guardar"
7. Navigate back to listing, repeat for next invoice

### Common Categorizations (Gonçalo's invoices)
- EDP, NOS, supermarkets, bank fees → Outros (DGF)
- Pharmacies, hospitals, clinics, psychotherapy → Saúde
- MetLife (health insurance) → Saúde
- BCP/Santander large payments (mortgage) → Imóveis
- Aegon Santander Não Vida (non-life insurance) → Outros (DGF)

## Scheduler Debugging / Fix (proven 2026-03-05)

1. Check launchd: `launchctl list | grep ekus` — exit code 0 = OK, 127 = command not found, `-` = not loaded
2. Check plist exists: `ls ~/Library/LaunchAgents/com.ekus.scheduler.plist`
3. Check logs: `cat ~/ekus/logs/scheduler.log` and `scheduler-error.log`
4. Check crontab: `crontab -l`
5. Common fixes:
   - Plist missing → run `./scripts/install-scheduler.sh`
   - Exit 127 → PATH in plist doesn't include `~/.local/bin` (where `claude` lives)
   - `.env` sourcing errors → check for unquoted values with spaces
   - Slack not sending → check token type (`xapp-` vs `xoxb-` vs webhook URL)
6. Test manually: `./scripts/run-job.sh hourly-digest`
7. Verify ticking: wait 60s, check logs again

## Development Workflow

### For Any Coding Task
1. Assess complexity — trivial (do inline) vs complex (use Agent Teams)
2. For complex tasks, use the full Agent Teams workflow:
   ```
   TeamCreate("project-name")
   TaskCreate tasks with dependencies (addBlockedBy)
   Spawn teammates:
     Task(team_name="project-name", name="implementer", subagent_type="general-purpose")
     Task(team_name="project-name", name="tester", subagent_type="general-purpose")
   TaskUpdate to assign tasks (owner="implementer", owner="tester")
   Monitor progress — teammates auto-report via SendMessage
   Verify visually — tester agent uses agent-browser for screenshots
   SendMessage(type="shutdown_request") to each teammate
   TeamDelete to clean up
   ```
3. Commit and push when done
4. Report results with evidence (screenshots, test output)

### Common Dev Projects
- **Ekoa** (ekoa-monorepo) — Primary project, TypeScript/React/Next.js
- **Indy** — Cinema apps (Capacitor)
- **CSG** — Client project
- **NB (Next Border)** — CTO role, has partners
- **CountApp** — Utility app

## Vendus — Create Fatura Recibo

Account: `goncalo-paraiso-gomes.vendus.pt` (personal) or `modern-marathon.vendus.pt` (company).

### Steps (per invoice)
1. **Criar Documento** — start from Documents menu or "Criar Novo Documento?" link after previous invoice
2. **Change doc type** — click "Alterar" next to "Fatura" → select "Fatura Recibo" radio → may need to click Alterar twice (first click highlights, second shows options)
3. **Set client** — click client field → type name → if 0 results, click "Criar Cliente" → name auto-fills → click "Guardar"
4. **Add product item** — click "+ Criar Novo Item" (use ref-based click via `find` tool, coordinate clicks often fail on this link) → product panel opens on the right
5. **Fill product form via JavaScript** (React-controlled inputs need nativeInputValueSetter):
   ```javascript
   const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
   const allInputs = document.querySelectorAll('input[type="text"], input[placeholder]');
   let nameEl, refEl, priceEl;
   allInputs.forEach(i => {
     if (i.placeholder === 'Nome') nameEl = i;
     if (i.placeholder === 'Referência') refEl = i;
     if (i.placeholder === 'Preço') priceEl = i;
   });
   nativeSetter.call(nameEl, '<NAME>'); nameEl.dispatchEvent(new Event('input', {bubbles: true}));
   nativeSetter.call(refEl, '<REF>'); refEl.dispatchEvent(new Event('input', {bubbles: true}));
   nativeSetter.call(priceEl, '<PRICE>'); priceEl.dispatchEvent(new Event('input', {bubbles: true}));
   document.getElementById('form_type_id').value = 'S'; // S=Serviço, P=Produto
   document.getElementById('form_type_id').dispatchEvent(new Event('change', {bubbles: true}));
   document.getElementById('form_tax_id').value = 'RED'; // RED=6%, ISE=0%, INT=13%, NOR=23%
   document.getElementById('form_tax_id').dispatchEvent(new Event('change', {bubbles: true}));
   ```
6. **Save product** — click "Gravar" at TOP of panel (coordinate ~1001, 46). Bottom Gravar button is less reliable.
7. **Set date** — click "Data de Emissão" > "Alterar" → triple-click the date field → type `YYYY-MM-DD` → press Enter
8. **Set payment** — click "Pagamentos" > "Alterar" → check the appropriate box (e.g. "Transferência Bancária")
9. **Set Referência Externa** — scroll down, click the "Referência Externa" input field → type the reference
10. **Submit** — click "Criar Fatura Recibo" button (use ref-based click via `find` tool for reliability)
11. **Confirm** — in dialog "Emitir Fatura Recibo de €X?", click "Emitir" (use ref-based click via `find` tool)
12. **Success** — page redirects to document detail showing "Documento Emitido com Sucesso"

### Key IDs
- `form_type_id`: P=Produto, S=Serviço
- `form_tax_id`: RED=6% (Taxa Reduzida), ISE=0% (Isento), INT=13% (Intermédia), NOR=23% (Normal)

---

## Family Event Planning (Meals, Gatherings)

Reusable process for planning family meals/events with multiple tasks spread over weeks.

1. **Build timeline** — work backwards from event date, assign deadlines to each task
2. **Create Trello cards** — urgent tasks in A Fazer, later tasks in Brevemente, each with due date and description (use `--data-urlencode` for Portuguese)
3. **Set up crontab reminders** — self-removing entries (`grep -v 'tag' | crontab -`) that fire at 9am on key dates, send to Slack via webhook. Include a follow-up reminder mid-week for urgent tasks.
4. **Update dashboard** — add tasks to Active/Waiting On via `PUT /api/tasks` (write full content to temp file first, use `--data-binary @file` to avoid shell escaping)
5. **Update reminders.md** — full timeline table + shopping lists as backup reference
6. **Tag all tasks** with event emoji (e.g., 🐣) for easy visual filtering

Key: avoid Python heredocs for processing task content (numbers like `0222` cause syntax errors). Use file-based approach instead.

### Cross-System Task Cleanup (proven 2026-03-23)
When cancelling/removing tasks that exist across multiple systems:
1. **Trello** — archive cards (`PUT /cards/{id}?closed=true`), batch with a for loop
2. **Google Calendar** — delete events via `gcal_delete_event` MCP (can parallelize all calls)
3. **Dashboard** — rebuild full task markdown (write to temp file, `PUT /api/tasks --data-binary @file`)
4. **Crontab** — filter out tagged entries: `crontab -l | grep -v 'tag' | crontab -`
5. **reminders.md** — clear or update the relevant section
6. **Verify** each system independently after cleanup
7. **Slack update** — notify with summary of what was removed and current state

Tip: emoji tags (🐣) in task names make cross-system identification trivial.

---

## Mac Mini — Claude Code Auth (Manual PKCE Flow)

When `claude auth login` fails on the Mac Mini (raw terminal UI can't accept piped input), use this manual PKCE flow:

1. **Generate PKCE pair on Mac Mini:**
   ```bash
   ssh ggomes@100.90.155.85 "export PATH=/opt/homebrew/bin:\$PATH && node -e \"
   const crypto = require('crypto');
   const v = crypto.randomBytes(32).toString('base64url');
   const c = crypto.createHash('sha256').update(v).digest('base64url');
   const s = crypto.randomBytes(32).toString('base64url');
   console.log(JSON.stringify({ verifier: v, challenge: c, state: s }));
   \""
   ```

2. **Build and open auth URL in local browser** (where you're logged into claude.ai):
   ```
   https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers&code_challenge={CHALLENGE}&code_challenge_method=S256&state={STATE}
   ```

3. **Click "Authorize"**, get redirected to callback URL with `?code=XXX`

4. **Exchange code for tokens on Mac Mini** (write Node.js script to `/tmp/exchange-token.js`):
   - POST `https://platform.claude.com/v1/oauth/token` with JSON body:
     ```json
     { "grant_type": "authorization_code", "code": "XXX", "redirect_uri": "https://platform.claude.com/oauth/code/callback", "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e", "code_verifier": "{VERIFIER}", "state": "{STATE}" }
     ```

5. **Write credentials** to `~/.claude/.credentials.json` (note the leading dot!):
   ```json
   { "claudeAiOauth": { "accessToken": "...", "refreshToken": "...", "expiresAt": <now + expires_in * 1000>, "scopes": "..." } }
   ```

6. **Verify**: `claude auth status` should show `loggedIn: true`

Key gotchas:
- File is `.credentials.json` (with leading dot), NOT `credentials.json`
- Claude Code tries macOS Keychain first, falls back to plaintext file
- Access token expires in 8 hours but auto-refreshes via refresh token
- Auth codes are single-use — if exchange fails, re-authorize

---

## Mac Mini — Channel System Deploy & Restart

Deploy and restart the Claude Code Channel system on Mac Mini:

1. **Deploy code**: `./scripts/mac-mini.sh deploy` (builds Next.js, rsyncs, restarts gateway+terminal)
2. **Start channel session**: `./scripts/mac-mini.sh channel-start`
   - Accepts interactive prompts automatically (development channels warning)
   - If it prompts for API key vs claude.ai auth, select claude.ai (send `Down` then `Enter` via tmux)
3. **Verify all services**:
   ```bash
   ./scripts/mac-mini.sh channel-status
   # Should show: channel server OK, gateway reachable, tmux session ACTIVE
   ```
4. **Test round-trip**: Open http://100.90.155.85:7600, verify "Channel" badge, send a message

Troubleshooting:
- **Session dies immediately**: Check `tmux capture-pane` output — likely a `| tee` pipe issue (use `exec claude` without pipes)
- **WebSocket 404**: Ensure `websockets` package is in `pyproject.toml` and installed (`uv sync`). **Critical**: the gateway process must be restarted AFTER installing websockets — a running process won't pick up the new package. Restart: `lsof -ti:7600 | xargs kill -9; nohup uv run python main.py > /tmp/ekus-gateway.log 2>&1 &`
- **Reply not arriving**: Check gateway logs for `/api/channel/reply` errors — likely `GATEWAY_URL` env var issue in `.mcp.json`
- **OAuth expired**: Run `./scripts/mac-mini.sh channel-stop`, then re-auth with tmux-based `claude auth login`, then `channel-start`
- **After `channel-start`, always verify gateway is fresh**: `channel-start` only restarts the tmux Claude session, NOT the gateway. If gateway deps changed, restart it separately.

---

## Restore macOS GUI Permission Remotely via VNC

When a macOS TCC permission (e.g. Screen Recording) needs GUI interaction to grant, and you can't physically access the machine:

1. **SSH in**: `ssh ggomes@100.108.210.116` (MacBook Pro Tailscale IP)
2. **Get sudo** (heredoc required for `!!!` password):
   ```bash
   cat << "PASS" | sudo -S <command> 2>&1
   2WS4rf3ed!!!
   PASS
   ```
3. **Enable VNC via ARD kickstart**:
   ```bash
   sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \
     -activate -configure -access -on -users ggomes -privs -all -restart -agent -menu
   sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart \
     -configure -clientopts -setvnclegacy -vnclegacy yes -setvncpw -vncpw ekus2026
   ```
4. **Verify**: `netstat -an | grep 5900` — should show LISTEN
5. **Connect via VNC** from your machine: `open vnc://100.108.210.116` (password: `ekus2026`)
6. **Toggle the permission** in System Settings → Privacy & Security → Screen Recording
7. **Disable VNC** when done:
   ```bash
   sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart -deactivate -stop
   ```

## Mac Mini — Migration from MacBook Pro

Steps to move ekus execution from MacBook Pro to Mac Mini:

1. **Commit and push** all changes from MacBook Pro
2. **Pull on Mac Mini**: `ssh ggomes@100.90.155.85 "cd ~/Projects/ekus && git pull"`
3. **Install scheduler**: Copy launchd plist to `~/Library/LaunchAgents/com.ekus.scheduler.plist`, `launchctl load` it
4. **Install gateway service**: Create `com.ekus.gateway.plist` with KeepAlive, `launchctl load` it
5. **Set minimal settings.json** on Mac Mini (no plugins, no hooks — they hang `claude -p`)
6. **Disable local scheduler**: `launchctl unload`, rename plist to `.disabled`
7. **Verify**: `curl http://100.90.155.85:7600/health`, send a test job, check scheduler log

## Sync Claude Code Config from claude-share Repo

The `gongiskhan/claude-share` GitHub repo is a backup of `~/.claude/` config (settings, skills, hooks, plugins).

1. `git clone https://github.com/gongiskhan/claude-share.git /tmp/claude-share`
2. `cp /tmp/claude-share/settings.json ~/.claude/settings.json` — settings, hooks, statusLine, plugins
3. `rsync -av /tmp/claude-share/skills/ ~/.claude/skills/` — sync skills (no --delete, preserves local-only)
4. `rsync -av /tmp/claude-share/hooks/ ~/.claude/hooks/` — sync hooks
5. `rsync -av /tmp/claude-share/plugins/ ~/.claude/plugins/` — sync plugins + cache
6. Restart Claude Code for changes to take effect
7. `rm -rf /tmp/claude-share` — cleanup

**Note:** Local `~/.claude/skills/` may have project-specific skills not in the repo (google-analytics, weather, worktree, etc.) — rsync without --delete preserves them.
**Note:** `gh` CLI may not be authenticated — use `git clone` with HTTPS directly.

## Fetch Stitch Design Screens

Download screen mockups from a Google Stitch project (MCP tool).

1. Load Stitch tools: `ToolSearch("select:mcp__stitch__get_screen")`
2. Call `mcp__stitch__get_screen` for each screen (all in parallel):
   - `name`: `projects/{projectId}/screens/{screenId}`
   - `projectId` and `screenId` also required as separate params
3. Extract `screenshot.downloadUrl` from each response
4. Download images: `curl -L -o <filename>.png "<downloadUrl>"`
5. Check `htmlCode` field — if it has a `downloadUrl`, download it too: `curl -L -o <filename>.html "<htmlCode.downloadUrl>"`
6. If `htmlCode` is empty `{}`, screens are design-only mockups with no generated code

**Notes:**
- `htmlCode` availability depends on whether Stitch generated code for the screen. Regenerating/editing screens in Stitch can produce HTML where it was previously empty.
- HTML files use Tailwind CSS CDN (`cdn.tailwindcss.com`) and are self-contained single-file pages.
- Some HTML files can be very large (600KB+) due to embedded SVG backgrounds or inline image data — check with `wc -c` before reading.
- The kanban/tasks screen in particular tends to have large embedded SVG noise textures.

## Refresh Claude Code Auth on Mac Mini

When the Mac Mini's Claude Code session shows "Not logged in":

1. Start `claude auth login` in tmux on the Mac Mini:
   ```bash
   ssh ggomes@100.90.155.85 'export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH" && tmux kill-session -t auth-refresh 2>/dev/null; tmux new-session -d -s auth-refresh && tmux send-keys -t auth-refresh "export PATH=\"$HOME/.local/bin:\$PATH\" && claude auth login --email goncalo.p.gomes@gmail.com" Enter'
   ```
2. Wait 3-5 seconds, then capture the OAuth URL:
   ```bash
   ssh ggomes@100.90.155.85 'export PATH="/opt/homebrew/bin:$PATH" && tmux capture-pane -t auth-refresh -p -J' 2>/dev/null
   ```
3. Open the `https://claude.ai/oauth/authorize?...` URL in a browser (can be any machine where you're logged into claude.ai)
4. Click "Authorize" — use JS click via Chrome extension if coordinate click doesn't register
5. The tmux process exchanges the code automatically; verify:
   ```bash
   ssh ggomes@100.90.155.85 'export PATH="$HOME/.local/bin:$PATH" && claude auth status'
   ```
6. Restart the ekus-claude session: `./scripts/mac-mini.sh channel-start`

**Auto-renewal:** `scripts/refresh-claude-auth.sh` refreshes tokens before they expire. Deploy to Mac Mini and set up a cron job (every 6h) to prevent manual re-auth.
