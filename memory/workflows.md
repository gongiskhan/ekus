# Workflows

*Proven step-by-step processes for common tasks.*

---

## Task Management (Automated)

### Hourly Digest (runs every hour 6am–11pm)
1. Fetch Trello cards from a_fazer, brevemente, eventualmente lists
2. Fetch today's calendar events (only future ones)
3. Check primary inbox for notable emails (last hour)
4. Format digest with sections: Tasks Today, Calendar, Notable Emails, Coming Soon
5. Send via Slack DM (channel D0ADZB7D733)
6. Send via WhatsApp (Ekus Alertas group)

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

### Process
1. Search all sources for the target month
2. Download PDFs/images
3. Organize in folder: `faturas/YYYY-QN/` (e.g., `faturas/2026-Q1/`)
4. Upload to accountant portal
5. Track what's found vs missing in a checklist

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
