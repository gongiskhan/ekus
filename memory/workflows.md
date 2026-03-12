# Workflows

*Proven step-by-step processes for common tasks.*

---

## Dashboard (Ekus App)

The Ekus App is a Next.js static export served from the Mac Mini gateway at `http://100.90.155.85:7600/` (Tailscale).
Frontend: `ekus-app/` (Next.js, builds to `out/`, copied to `mac-mini/gateway/static/`).
Backend: `mac-mini/gateway/main.py` (FastAPI v0.3.0).
4 tabs: Chat (SSE streaming), Tasks (kanban), Scheduler (CRUD), Memory (view/edit).
Deploy: `./scripts/mac-mini.sh deploy` (builds Next.js, rsyncs, restarts gateway).

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

## Mac Mini — Migration from MacBook Pro

Steps to move ekus execution from MacBook Pro to Mac Mini:

1. **Commit and push** all changes from MacBook Pro
2. **Pull on Mac Mini**: `ssh ggomes@100.90.155.85 "cd ~/Projects/ekus && git pull"`
3. **Install scheduler**: Copy launchd plist to `~/Library/LaunchAgents/com.ekus.scheduler.plist`, `launchctl load` it
4. **Install gateway service**: Create `com.ekus.gateway.plist` with KeepAlive, `launchctl load` it
5. **Set minimal settings.json** on Mac Mini (no plugins, no hooks — they hang `claude -p`)
6. **Disable local scheduler**: `launchctl unload`, rename plist to `.disabled`
7. **Verify**: `curl http://100.90.155.85:7600/health`, send a test job, check scheduler log
