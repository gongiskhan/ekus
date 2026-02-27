#!/usr/bin/env bash
# Upload all PDFs in a directory to Octa Manager
# Usage: ./scripts/upload-octa.sh <directory>
#
# Requires OCTA_TOKEN in .env
# Uses 3-step process: presigned URL → S3 upload → notify

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env
[[ -f "$PROJECT_DIR/.env" ]] && source "$PROJECT_DIR/.env"

DIR="${1:-}"
if [[ -z "$DIR" ]]; then
  echo "Usage: $0 <directory-with-pdfs>"
  echo "  Uploads all PDFs to Octa Manager (MODERNMARATHON / geraldocs)"
  echo ""
  echo "Requires OCTA_TOKEN in .env"
  exit 1
fi

if [[ -z "${OCTA_TOKEN:-}" ]]; then
  echo "Error: OCTA_TOKEN not set. Add it to .env"
  echo "Get it from Octa Manager: localStorage.getItem('authToken') in browser console"
  exit 1
fi

API="https://api.octacode.pt"
CLIENT_ID=412
COMPANY="MODERNMARATHON"
DOC_TYPE="geraldocs"

SUCCESS=0
FAIL=0
ALL_FILES=()

# Count PDFs
PDF_COUNT=$(find "$DIR" -maxdepth 1 -name "*.pdf" | wc -l | tr -d ' ')
echo "Found $PDF_COUNT PDFs in $DIR"
echo ""

for f in "$DIR"/*.pdf; do
  [[ -f "$f" ]] || continue
  FNAME=$(basename "$f")
  ALL_FILES+=("$FNAME")

  echo "[$((SUCCESS+FAIL+1))/$PDF_COUNT] $FNAME"

  # Step 1: Get presigned URL
  RESPONSE=$(curl -s "$API/documentstorage/upload?client_id=$CLIENT_ID&company_name=$COMPANY&document_type=$DOC_TYPE&document_name=$FNAME" \
    -H "Authorization: Bearer $OCTA_TOKEN" \
    -H "Accept: application/json" \
    -H "X-Request-Client: octamanager")

  S3_URL=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['attributes'])" 2>/dev/null || true)

  if [[ -z "$S3_URL" ]]; then
    echo "  ❌ Failed to get presigned URL: $RESPONSE"
    FAIL=$((FAIL+1))
    continue
  fi

  # Step 2: Upload to S3
  S3_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$S3_URL" --data-binary @"$f" -H "Content-Type: application/pdf")

  if [[ "$S3_STATUS" != "200" ]]; then
    echo "  ❌ S3 upload failed (HTTP $S3_STATUS)"
    FAIL=$((FAIL+1))
    continue
  fi

  echo "  ✅ Uploaded"
  SUCCESS=$((SUCCESS+1))
done

# Step 3: Notify (batch all files)
if [[ ${#ALL_FILES[@]} -gt 0 ]]; then
  FILE_COUNT=${#ALL_FILES[@]}
  FILES_JSON=$(printf '%s\n' "${ALL_FILES[@]}" | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin]))")

  echo ""
  echo "Notifying Octa Manager ($FILE_COUNT files)..."
  NOTIFY=$(curl -s -X POST "$API/documentstorage/notify" \
    -H "Authorization: Bearer $OCTA_TOKEN" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    -H "X-Request-Client: octamanager" \
    -d "{\"file_total\":$FILE_COUNT,\"files\":$FILES_JSON,\"is_new_files\":true}")

  echo "Response: $NOTIFY"
fi

echo ""
echo "Done! ✅ $SUCCESS uploaded, ❌ $FAIL failed"
