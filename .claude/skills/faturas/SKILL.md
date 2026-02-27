# Faturas — Monthly Invoice Collection & Upload

Collect invoices for **Modern Marathon LDA** and upload to the accountant's portal (Octa Manager).

## Overview

Every month, the accountant (Accoprime — info@accoprime.com) needs company invoices uploaded to **Octa Manager** (https://manager.octacode.pt). They periodically send a list of missing documents via email (subject: "Documentos em falta").

**Company:** Modern Marathon LDA
**Accountant:** Accoprime (R C Caldas, info@accoprime.com)
**Portal:** Octa Manager (https://manager.octacode.pt)
**Octa Client ID:** 412
**Octa Company:** MODERNMARATHON
**Octa Document Type:** geraldocs

## Step 1: Check for Missing Invoices List

Search email from Accoprime:
```
Search: from accoprime subject "documentos em falta"
```
They attach PDFs listing missing invoices per month, organized by company name + NIF.

## Step 2: Search Gmail for Invoices

Use Gmail MCP (or himalaya CLI) to find invoices. Search by company name, NIF, or subject keywords.

### Known Invoice Sources (email)

| Company | NIF | Email Subject Pattern | Attachments | Notes |
|---------|-----|----------------------|-------------|-------|
| Vodafone | 502544180 | "Faturação Vodafone de..." | fatura_YYYYMMDD.pdf + detalhe | Both fatura + detalhe needed |
| CrediBom | 503533726 | "Envio de Fatura nº CL..." | PDF | Car lease invoices |
| Via Verde / Brisa | 502790024 | "Extracto Digital Via Verde..." | PDF + CSV | Need extracto + detalhe files |
| Prio.E | 509299652 | "Prio.E Mobility - Fatura Nº..." | PDF | EV charging invoices |
| BCP / Millennium | 501525882 | "Documentos em formato digital" | PDF | Bank notes, not traditional invoices |
| Nespresso | 500201307 | "Cópia do detalhe da encomenda" | PDF | Coffee orders |
| Atlantic Summit | 515547168 | "...enviou-lhe um documento através do TOConline" | Link (no PDF) | Access via TOConline link |

### Companies NOT Found in Email (need portals or manual)

| Company | NIF | Where to Find |
|---------|-----|---------------|
| Tesla | 514063858 | tesla.com account → charging invoices |
| Uber Eats | — | Uber Eats app/website → individual order receipts (can be 20+ per month!) |
| Worten | 503630330 | worten.pt/cliente → purchase invoices |
| InvoiceXpress (VISMA) | 508025338 | InvoiceXpress subscription portal |
| Montes & Cabral | 518105504 | Request directly or paper |
| Pereira & Canas | 513119302 | Request directly or paper |
| Lusoponte | 503174688 | Portal or paper |
| ANA Aeroportos | 500700834 | Portal |
| Infraestruturas de Portugal | 503933813 | Portal |
| Auto-Estradas do Atlântico | 504290592 | Portal |

### Search Patterns

```bash
# Search by company
himalaya envelope list "from vodafone subject fatura"
himalaya envelope list "from credibom subject fatura"
himalaya envelope list "from viaverde or from brisa subject extracto"
himalaya envelope list "from prio subject fatura"

# Search by NIF (useful for less common companies)
himalaya envelope list "body 502544180"

# Download attachment from email
himalaya attachment download <EMAIL_ID> --all --output ./faturas/
```

**Important:** Use `himalaya` CLI for email, NOT `gog` (gog crashes with SIGKILL).

## Step 3: Search WhatsApp (if available)

Some receipts come via WhatsApp (e.g., Uber Eats). If wacli is authenticated:
```bash
wacli messages search "fatura" --after 2026-01-01
wacli messages search "recibo" --after 2026-01-01
wacli media download <message-id>
```

## Step 4: Portal Access (browser)

For invoices not in email/WhatsApp, use browser automation:

1. **Preferred:** Claude for Chrome extension (user already logged in)
2. **Fallback:** agent-browser CLI

**⚠️ Some portals have aggressive bot detection** (Tesla, Worten, banking sites).
For these, prefer the Chrome extension where the user is already authenticated.

## Step 5: Upload to Octa Manager

### Getting the Auth Token

The Octa Manager JWT token is needed for API uploads. To get it:
1. Open https://manager.octacode.pt in browser
2. User must be logged in (goncalo.p.gomes@gmail.com)
3. Extract token via browser console:
   ```javascript
   localStorage.getItem('authToken')
   ```
4. Save to `.env` as `OCTA_TOKEN=...`
5. Token lasts ~1 year

### Upload via API (3-step process)

**ALWAYS use the API. Browser UI upload does not work reliably.**

```bash
source .env

# Variables
API="https://api.octacode.pt"
CLIENT_ID=412
COMPANY="MODERNMARATHON"
DOC_TYPE="geraldocs"

# Step 1: Get presigned S3 URL
curl -s "$API/documentstorage/upload?client_id=$CLIENT_ID&company_name=$COMPANY&document_type=$DOC_TYPE&document_name=FILENAME.pdf" \
  -H "Authorization: Bearer $OCTA_TOKEN" \
  -H "Accept: application/json" \
  -H "X-Request-Client: octamanager"
# Returns: {"attributes": "<presigned_s3_url>", "status": 200}

# Step 2: Upload file to S3
curl -s -X PUT "<presigned_s3_url>" \
  --data-binary @file.pdf \
  -H "Content-Type: application/pdf"
# Returns: 200 OK

# Step 3: Notify (AFTER ALL files uploaded — one batch call)
curl -s -X POST "$API/documentstorage/notify" \
  -H "Authorization: Bearer $OCTA_TOKEN" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "X-Request-Client: octamanager" \
  -d '{"file_total": 5, "files": ["file1.pdf", "file2.pdf", ...], "is_new_files": true}'
# Returns: {"attributes": "success", "status": 200}
```

### Batch Upload Script

See `scripts/upload-octa.sh` for a complete batch upload script.

## Step 6: Verify

After uploading:
1. Open Octa Manager in browser
2. Navigate to Contabilista → MODERNMARATHON → Geral
3. Check the year selector (top right) shows the correct year
4. Confirm all files appear in the table

## Working Directory

Organize collected invoices:
```
faturas/
  2026-Q1/
    found/          # Downloaded PDFs ready for upload
    missing.md      # Tracking what's still missing
```

## Schedule

- **When:** Beginning of each month, or when Accoprime sends "Documentos em falta"
- **Volume:** ~30-60 files per quarter
- **Priority:** High — accountant deadlines are firm

## Lessons Learned

1. **Browser upload doesn't work** — Always use the 3-step API (presigned URL → S3 → notify)
2. **himalaya > gog for email** — gog CLI hangs/crashes, himalaya is reliable
3. **Uber Eats has MANY receipts** — Can be 20+ per month across accounts
4. **Vodafone and Via Verde send multiple files** — Need both fatura + detalhe
5. **Notify must be called ONCE after ALL uploads** — batch all filenames together
6. **Some companies don't email invoices** — Need portal access or manual request
7. **BCP sends bank documents, not invoices** — Still needed by accountant
8. **InvoiceXpress subscription may lapse** — Check if payments are current
9. **Tesla/Worten have bot detection** — Use Chrome extension, not headless browser
