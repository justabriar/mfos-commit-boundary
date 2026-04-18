CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'decision_type_enum') THEN
    CREATE TYPE decision_type_enum AS ENUM ('approve', 'reject', 'request_changes');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outbox_status_enum') THEN
    CREATE TYPE outbox_status_enum AS ENUM ('pending', 'sending', 'sent', 'delivery_failed', 'dead_letter', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draft_status_enum') THEN
    CREATE TYPE draft_status_enum AS ENUM ('pending', 'committed', 'cancelled', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role_enum') THEN
    CREATE TYPE org_role_enum AS ENUM ('author', 'reviewer', 'admin');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  external_id TEXT NULL,
  given_name TEXT NULL,
  family_name TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_org_roles (
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role org_role_enum NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS message_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  version INTEGER NOT NULL CHECK (version > 0),
  is_active BOOLEAN NOT NULL DEFAULT false,
  policy_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS message_policies_one_active_per_org_uidx
  ON message_policies (org_id)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  payload_json JSONB NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  pinned_policy_version INTEGER NOT NULL CHECK (pinned_policy_version > 0),
  status draft_status_enum NOT NULL DEFAULT 'pending',
  supersedes_draft_id UUID NULL REFERENCES drafts(id),
  committed_decision_id UUID NULL,
  preflighted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT drafts_committed_fields_consistent CHECK (
    (
      status = 'committed'
      AND committed_at IS NOT NULL
      AND committed_decision_id IS NOT NULL
    )
    OR
    (
      status <> 'committed'
      AND committed_at IS NULL
      AND committed_decision_id IS NULL
    )
  ),
  CONSTRAINT drafts_pinned_policy_positive CHECK (pinned_policy_version > 0)
);

CREATE INDEX IF NOT EXISTS drafts_org_status_created_idx
  ON drafts (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS drafts_org_hash_idx
  ON drafts (org_id, content_hash);

CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  draft_id UUID NOT NULL REFERENCES drafts(id),
  decision_version INTEGER NOT NULL CHECK (decision_version > 0),
  decision_type decision_type_enum NOT NULL,
  decided_by_user_id UUID NOT NULL REFERENCES users(id),
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key TEXT NOT NULL,
  rationale TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, draft_id, decision_version),
  UNIQUE (org_id, draft_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS decisions_single_approval_per_draft_uidx
  ON decisions (org_id, draft_id)
  WHERE decision_type = 'approve';

ALTER TABLE drafts
  DROP CONSTRAINT IF EXISTS drafts_committed_decision_fk;

ALTER TABLE drafts
  ADD CONSTRAINT drafts_committed_decision_fk
  FOREIGN KEY (committed_decision_id) REFERENCES decisions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX IF NOT EXISTS drafts_committed_decision_uidx
  ON drafts (committed_decision_id)
  WHERE committed_decision_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  draft_id UUID NULL REFERENCES drafts(id),
  decision_id UUID NULL REFERENCES decisions(id),
  actor_user_id UUID NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_org_created_idx
  ON audit_events (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_draft_created_idx
  ON audit_events (draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  draft_id UUID NOT NULL REFERENCES drafts(id),
  decision_id UUID NOT NULL REFERENCES decisions(id),
  status outbox_status_enum NOT NULL DEFAULT 'pending',
  payload_json JSONB NOT NULL,
  provider_message_id TEXT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT NULL,
  sending_started_at TIMESTAMPTZ NULL,
  sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (decision_id)
);

CREATE INDEX IF NOT EXISTS outbox_status_created_idx
  ON outbox_messages (status, created_at);

CREATE INDEX IF NOT EXISTS outbox_org_status_created_idx
  ON outbox_messages (org_id, status, created_at);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drafts_set_updated_at_trg ON drafts;
CREATE TRIGGER drafts_set_updated_at_trg
BEFORE UPDATE ON drafts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS outbox_set_updated_at_trg ON outbox_messages;
CREATE TRIGGER outbox_set_updated_at_trg
BEFORE UPDATE ON outbox_messages
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION audit_events_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; % is not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_events_no_update_trg ON audit_events;
CREATE TRIGGER audit_events_no_update_trg
BEFORE UPDATE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_append_only_guard();

DROP TRIGGER IF EXISTS audit_events_no_delete_trg ON audit_events;
CREATE TRIGGER audit_events_no_delete_trg
BEFORE DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_append_only_guard();

CREATE OR REPLACE FUNCTION enforce_outbox_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('sending', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'sending' AND NEW.status IN ('sent', 'delivery_failed', 'dead_letter') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'delivery_failed' AND NEW.status IN ('pending', 'dead_letter', 'cancelled') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid outbox status transition: % -> %', OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS outbox_status_transition_trg ON outbox_messages;
CREATE TRIGGER outbox_status_transition_trg
BEFORE UPDATE ON outbox_messages
FOR EACH ROW
EXECUTE FUNCTION enforce_outbox_status_transition();

CREATE OR REPLACE FUNCTION enforce_draft_update_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'draft org_id is immutable';
  END IF;

  IF OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id THEN
    RAISE EXCEPTION 'draft created_by_user_id is immutable';
  END IF;

  IF OLD.payload_json IS DISTINCT FROM NEW.payload_json THEN
    RAISE EXCEPTION 'draft payload_json is immutable after preflight';
  END IF;

  IF OLD.content_hash IS DISTINCT FROM NEW.content_hash THEN
    RAISE EXCEPTION 'draft content_hash is immutable after preflight';
  END IF;

  IF OLD.pinned_policy_version IS DISTINCT FROM NEW.pinned_policy_version THEN
    RAISE EXCEPTION 'draft pinned_policy_version is immutable after preflight';
  END IF;

  IF OLD.status = 'pending' THEN
    IF NEW.status NOT IN ('pending', 'committed', 'cancelled', 'expired') THEN
      RAISE EXCEPTION 'invalid draft status transition from pending to %', NEW.status;
    END IF;

    IF NEW.status = 'committed' THEN
      IF NEW.committed_at IS NULL OR NEW.committed_decision_id IS NULL THEN
        RAISE EXCEPTION 'committed draft requires committed_at and committed_decision_id';
      END IF;
    ELSE
      IF NEW.committed_at IS NOT NULL OR NEW.committed_decision_id IS NOT NULL THEN
        RAISE EXCEPTION 'non-committed draft cannot carry commit fields';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF ROW(OLD.status, OLD.committed_at, OLD.committed_decision_id)
     IS DISTINCT FROM
     ROW(NEW.status, NEW.committed_at, NEW.committed_decision_id) THEN
    RAISE EXCEPTION 'terminal draft rows are immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drafts_enforce_rules_trg ON drafts;
CREATE TRIGGER drafts_enforce_rules_trg
BEFORE UPDATE ON drafts
FOR EACH ROW
EXECUTE FUNCTION enforce_draft_update_rules();
