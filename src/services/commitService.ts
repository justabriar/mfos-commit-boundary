import { z } from 'zod';
import { withTransaction } from '../db/client.js';
import { validateDecisionAgainstPolicy } from './policyService.js';

const DecisionTypeSchema = z.enum(['approve', 'reject', 'request_changes']);

const CommitInputSchema = z.object({
  orgId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  draftId: z.string().uuid(),
  expectedContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  idempotencyKey: z.string().min(1).max(255),
  decisionType: DecisionTypeSchema,
  rationale: z.string().max(4000).optional()
});

export type CommitInput = z.infer<typeof CommitInputSchema>;

export async function commitMessage(input: CommitInput) {
  const parsed = CommitInputSchema.parse(input);

  return withTransaction(async (client) => {
    const draftRes = await client.query<{
      id: string;
      org_id: string;
      created_by_user_id: string;
      payload_json: unknown;
      content_hash: string;
      pinned_policy_version: number;
      status: 'pending' | 'committed' | 'cancelled' | 'expired';
    }>(
      `
      SELECT id, org_id, created_by_user_id, payload_json, content_hash, pinned_policy_version, status
      FROM drafts
      WHERE id = $1
        AND org_id = $2
      FOR UPDATE
      `,
      [parsed.draftId, parsed.orgId]
    );

    if (draftRes.rowCount !== 1) {
      throw new Error('Draft not found');
    }

    const draft = draftRes.rows[0]!;

    if (draft.status !== 'pending') {
      throw new Error(`Draft is not committable from status: ${draft.status}`);
    }

    if (draft.content_hash !== parsed.expectedContentHash) {
      throw new Error('Draft content hash mismatch');
    }

    const authRes = await client.query<{
      can_review: boolean | null;
      is_admin: boolean | null;
    }>(
      `
      SELECT
        BOOL_OR(role IN ('reviewer', 'admin')) AS can_review,
        BOOL_OR(role = 'admin') AS is_admin
      FROM user_org_roles
      WHERE org_id = $1
        AND user_id = $2
        AND active = true
      `,
      [parsed.orgId, parsed.actorUserId]
    );

    const auth = authRes.rows[0]!;

    if (!auth?.can_review) {
      throw new Error('Actor is not authorized to review at commit time');
    }

    if (parsed.decisionType === 'approve' && draft.created_by_user_id === parsed.actorUserId) {
      throw new Error('Self-approval is prohibited');
    }

    const policyRes = await client.query<{ version: number; policy_json: unknown }>(
      `
      SELECT version, policy_json
      FROM message_policies
      WHERE org_id = $1
        AND version = $2
      `,
      [parsed.orgId, draft.pinned_policy_version]
    );

    if (policyRes.rowCount !== 1) {
      throw new Error('Pinned policy version not found');
    }

    const policy = policyRes.rows[0]!;

    const validation = validateDecisionAgainstPolicy({
      decisionType: parsed.decisionType,
      policy: policy.policy_json,
      payload: draft.payload_json
    });

    if (!validation.ok) {
      throw new Error(validation.reason);
    }

    const versionRes = await client.query<{ next_version: number }>(
      `
      SELECT COALESCE(MAX(decision_version), 0) + 1 AS next_version
      FROM decisions
      WHERE org_id = $1
        AND draft_id = $2
      `,
      [parsed.orgId, parsed.draftId]
    );

    const nextDecisionVersion = versionRes.rows[0].next_version;

    const decisionRes = await client.query<{
      id: string;
      decision_version: number;
      decision_type: 'approve' | 'reject' | 'request_changes';
    }>(
      `
      INSERT INTO decisions (
        org_id,
        draft_id,
        decision_version,
        decision_type,
        decided_by_user_id,
        policy_version,
        content_hash,
        idempotency_key,
        rationale
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (org_id, draft_id, idempotency_key)
      DO UPDATE SET rationale = decisions.rationale
      RETURNING id, decision_version, decision_type
      `,
      [
        parsed.orgId,
        parsed.draftId,
        nextDecisionVersion,
        parsed.decisionType,
        parsed.actorUserId,
        draft.pinned_policy_version,
        draft.content_hash,
        parsed.idempotencyKey,
        parsed.rationale ?? null
      ]
    );

    const decision = decisionRes.rows[0]!;

    await client.query(
      `
      INSERT INTO audit_events (
        org_id,
        draft_id,
        decision_id,
        actor_user_id,
        event_type,
        event_payload
      )
      VALUES ($1, $2, $3, $4, 'message_decided', $5::jsonb)
      `,
      [
        parsed.orgId,
        parsed.draftId,
        decision.id,
        parsed.actorUserId,
        JSON.stringify({
          decisionType: decision.decision_type,
          decisionVersion: decision.decision_version,
          policyVersion: draft.pinned_policy_version,
          contentHash: draft.content_hash,
          idempotencyKey: parsed.idempotencyKey
        })
      ]
    );

    if (parsed.decisionType === 'approve') {
      await client.query(
        `
        INSERT INTO outbox_messages (
          org_id,
          draft_id,
          decision_id,
          status,
          payload_json
        )
        VALUES ($1, $2, $3, 'pending', $4::jsonb)
        `,
        [parsed.orgId, parsed.draftId, decision.id, JSON.stringify(draft.payload_json)]
      );

      await client.query(
        `
        UPDATE drafts
        SET status = 'committed',
            committed_at = now(),
            committed_decision_id = $2
        WHERE id = $1
        `,
        [parsed.draftId, decision.id]
      );
    } else {
      await client.query(
        `
        UPDATE drafts
        SET status = 'cancelled'
        WHERE id = $1
        `,
        [parsed.draftId]
      );
    }

    return {
      draftId: parsed.draftId,
      decisionId: decision.id,
      decisionVersion: decision.decision_version,
      decisionType: decision.decision_type,
      outboxQueued: parsed.decisionType === 'approve'
    };
  });
}
