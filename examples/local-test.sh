#!/usr/bin/env bash
set -euo pipefail

ORG_ID="00000000-0000-0000-0000-000000000001"
USER_ID="11111111-1111-1111-1111-111111111111"

PREFLIGHT_RESPONSE=$(curl -s http://localhost:3000/api/v2/messages/preflight \
  -H 'content-type: application/json' \
  -d "{
    \"orgId\": \"${ORG_ID}\",
    \"actorUserId\": \"${USER_ID}\",
    \"payload\": {
      \"channel\": \"email\",
      \"to\": [\"test@example.com\"],
      \"subject\": \"MFOS boundary test\",
      \"body\": \"This message should only move with a valid recorded decision.\"
    }
  }")

echo "Preflight: ${PREFLIGHT_RESPONSE}"

DRAFT_ID=$(echo "$PREFLIGHT_RESPONSE" | node -e "process.stdin.on('data', d => { const o = JSON.parse(d.toString()); console.log(o.draftId); });")
CONTENT_HASH=$(echo "$PREFLIGHT_RESPONSE" | node -e "process.stdin.on('data', d => { const o = JSON.parse(d.toString()); console.log(o.contentHash); });")

COMMIT_RESPONSE=$(curl -s http://localhost:3000/api/v2/messages/commit \
  -H 'content-type: application/json' \
  -d "{
    \"orgId\": \"${ORG_ID}\",
    \"actorUserId\": \"${USER_ID}\",
    \"draftId\": \"${DRAFT_ID}\",
    \"expectedContentHash\": \"${CONTENT_HASH}\",
    \"idempotencyKey\": \"commit-001\",
    \"decisionType\": \"approve\",
    \"rationale\": \"Boundary approval for local test\"
  }")

echo "Commit: ${COMMIT_RESPONSE}"
