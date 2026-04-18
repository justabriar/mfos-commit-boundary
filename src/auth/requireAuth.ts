import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';

const jwks = createRemoteJWKSet(new URL(env.SSO_JWKS_URI));

export type AuthContext = {
  subject: string;
  email?: string;
  orgId?: string;
  claims: JWTPayload;
};

export type AuthenticatedRequest = Request & {
  auth?: AuthContext;
};

function getBearerToken(req: Request): string {
  const header = req.header('authorization');
  if (!header) throw new Error('Missing Authorization header');

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new Error('Invalid Authorization header');
  }

  return token;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (env.AUTH_MODE === 'dev') {
      req.auth = {
        subject: env.DEV_USER_ID,
        orgId: env.DEV_ORG_ID,
        claims: {
          sub: env.DEV_USER_ID,
          org_id: env.DEV_ORG_ID,
          mode: 'dev'
        }
      };
      return next();
    }

    const token = getBearerToken(req);

    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.SSO_ISSUER,
      audience: env.SSO_AUDIENCE
    });

    req.auth = {
      subject: String(payload.sub),
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.org_id === 'string' ? { orgId: payload.org_id } : {}),
      claims: payload
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      error: 'unauthorized',
      message: error instanceof Error ? error.message : 'token verification failed'
    });
  }
}
