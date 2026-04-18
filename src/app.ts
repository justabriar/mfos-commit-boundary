import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import { requireAuth, type AuthenticatedRequest } from './auth/requireAuth.js';
import { logger } from './config/logger.js';
import { scimRouter } from './routes/scim.js';
import { preflightMessage } from './services/preflightService.js';
import { commitMessage } from './services/commitService.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post('/api/v2/messages/preflight', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = req.body as {
        orgId: string;
        actorUserId: string;
        payload: Record<string, unknown>;
        supersedesDraftId?: string;
      };

      const result = await preflightMessage({
        orgId: body.orgId,
        actorUserId: body.actorUserId,
        payload: body.payload,
        ...(body.supersedesDraftId ? { supersedesDraftId: body.supersedesDraftId } : {})
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/messages/commit', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = req.body as {
        orgId: string;
        actorUserId: string;
        draftId: string;
        expectedContentHash: string;
        idempotencyKey: string;
        decisionType: 'approve' | 'reject' | 'request_changes';
        rationale?: string;
      };

      const result = await commitMessage({
        orgId: body.orgId,
        actorUserId: body.actorUserId,
        draftId: body.draftId,
        expectedContentHash: body.expectedContentHash,
        idempotencyKey: body.idempotencyKey,
        decisionType: body.decisionType,
        ...(body.rationale ? { rationale: body.rationale } : {})
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use('/scim/v2', scimRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'internal error';
    logger.error({ err: message }, 'request failed');
    res.status(400).json({ error: 'request_failed', message });
  });

  return app;
}
