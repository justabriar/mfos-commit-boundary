import { pool } from '../src/db/client.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';

async function main() {
  const orgId = env.DEV_ORG_ID;
  const userId = env.DEV_USER_ID;

  await pool.query(
    `
    INSERT INTO organizations (id, name)
    VALUES ($1, 'MFOS Local Org')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `,
    [orgId]
  );

  await pool.query(
    `
    INSERT INTO users (id, email, active, given_name, family_name)
    VALUES ($1, 'local-reviewer@example.com', true, 'Local', 'Reviewer')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, active = EXCLUDED.active
    `,
    [userId]
  );

  await pool.query(
    `
    INSERT INTO user_org_roles (org_id, user_id, role, active)
    VALUES ($1, $2, 'reviewer', true)
    ON CONFLICT (org_id, user_id, role) DO UPDATE SET active = EXCLUDED.active
    `,
    [orgId, userId]
  );

  await pool.query(
    `
    UPDATE message_policies
    SET is_active = false
    WHERE org_id = $1
    `,
    [orgId]
  );

  await pool.query(
    `
    INSERT INTO message_policies (org_id, version, is_active, policy_json)
    VALUES (
      $1,
      1,
      true,
      '{"requireSubjectForEmail": true, "allowedChannels": ["email"], "maxRecipients": 25}'::jsonb
    )
    ON CONFLICT (org_id, version)
    DO UPDATE SET is_active = EXCLUDED.is_active, policy_json = EXCLUDED.policy_json
    `,
    [orgId]
  );

  logger.info({ orgId, userId }, 'local seed complete');
  await pool.end();
}

void main();
