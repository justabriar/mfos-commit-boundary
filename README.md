# MFOS Outbound Enforcement Service

A runnable starter for the MFOS outbound enforcement service.

What this package gives you:
- `/api/v2/messages/preflight`
- `/api/v2/messages/commit`
- Postgres-backed draft, decision, audit, and outbox persistence
- DB-enforced idempotency, approval uniqueness, append-only audit behavior, and outbox state transitions
- auth scaffold with dev bypass for local testing
- SCIM starter routes
- outbox worker with a log transport for local validation

## Local bootstrap

1. Copy env file:

```bash
cp .env.example .env
```

2. Start Postgres:

```bash
docker compose up -d
```

3. Install dependencies:

```bash
npm install
```

4. Run migrations:

```bash
npm run migrate
```

5. Seed local org, user, role, and active policy:

```bash
npm run seed
```

6. Start the API:

```bash
npm run dev
```

7. Start the outbox worker in another terminal:

```bash
npm run worker:outbox
```

## Local test flow

In `AUTH_MODE=dev`, requests do not require a real bearer token.
Use these seeded IDs by default:
- org: `00000000-0000-0000-0000-000000000001`
- user: `11111111-1111-1111-1111-111111111111`

### Preflight

```bash
curl -s http://localhost:3000/api/v2/messages/preflight \
  -H 'content-type: application/json' \
  -d '{
    "orgId": "00000000-0000-0000-0000-000000000001",
    "actorUserId": "11111111-1111-1111-1111-111111111111",
    "payload": {
      "channel": "email",
      "to": ["test@example.com"],
      "subject": "MFOS boundary test",
      "body": "This message should only move with a valid recorded decision."
    }
  }'
```

### Commit approval

Take the `draftId` and `contentHash` from the preflight response.

```bash
curl -s http://localhost:3000/api/v2/messages/commit \
  -H 'content-type: application/json' \
  -d '{
    "orgId": "00000000-0000-0000-0000-000000000001",
    "actorUserId": "11111111-1111-1111-1111-111111111111",
    "draftId": "REPLACE_DRAFT_ID",
    "expectedContentHash": "REPLACE_CONTENT_HASH",
    "idempotencyKey": "commit-001",
    "decisionType": "approve",
    "rationale": "Boundary approval for local test"
  }'
```

The worker will pick up the outbox row and mark it `sent` using the local log transport.

## Notes

- `AUTH_MODE=dev` is only a local testing bypass.
- policy validation is intentionally deterministic and starter-grade. It blocks approval if required fields are missing from the message payload.
- the outbox transport is a local stub so you can validate the decision-to-send handoff before wiring SES, SMTP, or another provider.
