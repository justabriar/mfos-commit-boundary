import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/client.js';

export const scimRouter = Router();

scimRouter.get('/ServiceProviderConfig', (_req, res) => {
  res.type('application/scim+json').json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        primary: true
      }
    ]
  });
});

const ScimUserSchema = z.object({
  userName: z.string().email(),
  active: z.boolean().default(true),
  externalId: z.string().optional(),
  name: z
    .object({
      givenName: z.string().optional(),
      familyName: z.string().optional()
    })
    .optional()
});

scimRouter.post('/Users', async (req, res, next) => {
  try {
    const body = ScimUserSchema.parse(req.body);

    const result = await pool.query<{ id: string; email: string; active: boolean }>(
      `
      INSERT INTO users (email, active, external_id, given_name, family_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, active
      `,
      [
        body.userName,
        body.active,
        body.externalId ?? null,
        body.name?.givenName ?? null,
        body.name?.familyName ?? null
      ]
    );

    const row = result.rows[0]!;

    res.status(201).type('application/scim+json').json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: row.id,
      userName: row.email,
      active: row.active
    });
  } catch (error) {
    next(error);
  }
});

scimRouter.patch('/Users/:id', async (req, res, next) => {
  try {
    const PatchSchema = z.object({
      Operations: z.array(
        z.object({
          op: z.enum(['replace']),
          path: z.string(),
          value: z.any()
        })
      )
    });

    const body = PatchSchema.parse(req.body);

    let active: boolean | undefined;

    for (const op of body.Operations) {
      if (op.path === 'active') {
        active = Boolean(op.value);
      }
    }

    if (typeof active !== 'boolean') {
      return res.status(400).json({
        error: 'invalid_patch',
        message: 'Only active replacement is currently supported'
      });
    }

    const result = await pool.query<{ id: string; email: string; active: boolean }>(
      `
      UPDATE users
      SET active = $2
      WHERE id = $1
      RETURNING id, email, active
      `,
      [req.params.id, active]
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({ error: 'not_found' });
    }

    const row = result.rows[0]!;

    return res.type('application/scim+json').json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: row.id,
      userName: row.email,
      active: row.active
    });
  } catch (error) {
    next(error);
  }
});
