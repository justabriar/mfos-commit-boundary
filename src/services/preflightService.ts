import { z } from 'zod';
import { withTransaction } from '../db/client.js';
import { sha256Hex } from '../utils/canonicalize.js';

const PreflightInputSchema = z.object({
  orgId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
  supersedesDraftId: z.string().uuid().optional()
});

export type PreflightInput = z.infer<typeof PreflightInputSchema>;

export async function preflightMessage(input: PreflightInput) {
  const parsed = PreflightInputSchema.parse(input);
  const contentHash = sha256Hex(parsed.payload);

  return withTransaction(async (client) => {
    const policyRes = await client.query<{ version: number }>(
      `
      SELECT version
      FROM message_policies
      WHERE org_id = $1
        AND is_active = true
      ORDER BY version DESC
      LIMIT 1
      `,
      [parsed.orgId]
    );

    if (policyRes.rowCount !== 1) {
      throw new Error('No active policy version found for org');
    }

    const pinnedPolicyVersion = policyRes.rows[0].version;

    const draftRes = await client.query<{ id: string; preflighted_at: string }>(
      `
      INSERT INTO drafts (
        org_id,
        created_by_user_id,
        payload_json,
        content_hash,
        pinned_policy_version,
        supersedes_draft_id
      )
      VALUES ($1, $2, $3::jsonb, $4, $5, $6)
      RETURNING id, preflighted_at
      `,
      [
        parsed.orgId,
        parsed.actorUserId,
        JSON.stringify(parsed.payload),
        contentHash,
        pinnedPolicyVersion,
        parsed.supersedesDraftId ?? null
      ]
    );

    const draft = draftRes.rows[0]!;

    await client.query(
      `
      INSERT INTO audit_events (
        org_id,
        draft_id,
        actor_user_id,
        event_type,
        event_payload
      )
      VALUES ($1, $2, $3, 'message_preflighted', $4::jsonb)
      `,
      [
        parsed.orgId,
        draft.id,
        parsed.actorUserId,
        JSON.stringify({
          contentHash,
          pinnedPolicyVersion
        })
      ]
    );

    return {
      draftId: draft.id,
      contentHash,
      pinnedPolicyVersion,
      preflightedAt: draft.preflighted_at
    };
  });
}
