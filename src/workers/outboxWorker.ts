import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { pool, withTransaction } from '../db/client.js';

type OutboxRow = {
  id: string;
  org_id: string;
  draft_id: string;
  decision_id: string;
  payload_json: unknown;
  attempt_count: number;
};

type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; error: string };

async function sendOutboundMessage(payload: unknown): Promise<SendResult> {
  if (env.TRANSPORT_MODE === 'log') {
    logger.info({ payload }, 'simulated outbound send');
    return {
      ok: true,
      providerMessageId: randomUUID()
    };
  }

  return {
    ok: false,
    retryable: false,
    error: 'Unsupported transport mode'
  };
}

async function claimPendingBatch(limit: number): Promise<OutboxRow[]> {
  return withTransaction(async (client) => {
    const result = await client.query<OutboxRow>(
      `
      WITH next_batch AS (
        SELECT id
        FROM outbox_messages
        WHERE status = 'pending'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE outbox_messages o
      SET status = 'sending',
          sending_started_at = now(),
          updated_at = now()
      FROM next_batch nb
      WHERE o.id = nb.id
      RETURNING
        o.id,
        o.org_id,
        o.draft_id,
        o.decision_id,
        o.payload_json,
        o.attempt_count
      `,
      [limit]
    );

    return result.rows;
  });
}

async function markSent(id: string, providerMessageId: string) {
  await pool.query(
    `
    UPDATE outbox_messages
    SET status = 'sent',
        provider_message_id = $2,
        sent_at = now(),
        updated_at = now()
    WHERE id = $1
    `,
    [id, providerMessageId]
  );
}

async function markFailure(id: string, error: string, retryable: boolean) {
  await pool.query(
    `
    UPDATE outbox_messages
    SET status = CASE
          WHEN $3::boolean = false THEN 'dead_letter'
          WHEN attempt_count + 1 >= 10 THEN 'dead_letter'
          ELSE 'delivery_failed'
        END,
        attempt_count = attempt_count + 1,
        last_error = $2,
        updated_at = now()
    WHERE id = $1
    `,
    [id, error, retryable]
  );
}

async function requeueFailures(limit: number) {
  await pool.query(
    `
    WITH retry_batch AS (
      SELECT id
      FROM outbox_messages
      WHERE status = 'delivery_failed'
      ORDER BY updated_at
      LIMIT $1
    )
    UPDATE outbox_messages o
    SET status = 'pending',
        updated_at = now()
    FROM retry_batch rb
    WHERE o.id = rb.id
    `,
    [limit]
  );
}

async function tick() {
  await requeueFailures(100);
  const batch = await claimPendingBatch(env.OUTBOX_BATCH_SIZE);

  if (batch.length === 0) {
    return;
  }

  for (const row of batch) {
    try {
      const result = await sendOutboundMessage(row.payload_json);

      if (result.ok) {
        await markSent(row.id, result.providerMessageId);
      } else {
        await markFailure(row.id, result.error, result.retryable);
      }
    } catch (error) {
      await markFailure(
        row.id,
        error instanceof Error ? error.message : 'unknown transport error',
        true
      );
    }
  }

  logger.info({ claimed: batch.length }, 'outbox batch processed');
}

async function main() {
  logger.info('outbox worker started');

  for (;;) {
    try {
      await tick();
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : error },
        'outbox worker tick failed'
      );
    }

    await new Promise((resolve) => setTimeout(resolve, env.OUTBOX_POLL_MS));
  }
}

void main();
