# Workflows

*Proven step-by-step processes for common tasks.*

---

## Task Management (Daily)

### Morning Setup
1. Fetch today's calendar events
2. Fetch Trello "A Fazer" cards
3. Merge into task list (avoid duplicates — match by title)
4. Dev tasks (Indy, CSG, Ekoa, NB, etc.) go under Dev priority section
5. Calendar events get timestamps
6. Save to `memory/today-tasks.md`

### Task Updates
When asked to modify tasks:
1. Update local task list
2. Sync to Trello (create/move/archive cards)
3. If task has a date, update calendar too

### End of Day
- Mark completed tasks as done (archive in Trello)
- Move unfinished tasks to tomorrow
- Note any blockers

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
1. Assess complexity — trivial (do inline) vs complex (agent teams)
2. For complex tasks:
   - Define clear requirements
   - Break into agent roles
   - Include a tester agent
   - Verify visually with agent-browser
3. Commit and push when done
4. Report results with evidence (screenshots, test output)

### Common Dev Projects
- **Ekoa** (ekoa-monorepo) — Primary project, TypeScript/React/Next.js
- **Indy** — Cinema apps (Capacitor)
- **CSG** — Client project
- **NB (Next Border)** — CTO role, has partners
- **CountApp** — Utility app
