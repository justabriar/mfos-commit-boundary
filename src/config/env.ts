import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_SSL: z
    .string()
    .default('false')
    .transform((value) => value.toLowerCase() === 'true'),

  AUTH_MODE: z.enum(['dev', 'sso']).default('dev'),
  SSO_ISSUER: z.string().url(),
  SSO_AUDIENCE: z.string().min(1),
  SSO_JWKS_URI: z.string().url(),

  DEV_USER_ID: z.string().uuid(),
  DEV_ORG_ID: z.string().uuid(),

  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(2000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  TRANSPORT_MODE: z.enum(['log']).default('log')
});

export const env = EnvSchema.parse(process.env);
