import { z } from 'zod';

const MessagePolicySchema = z.object({
  requireSubjectForEmail: z.boolean().default(true),
  allowedChannels: z.array(z.string()).default(['email']),
  maxRecipients: z.number().int().positive().default(25)
});

const MessagePayloadSchema = z.object({
  channel: z.string(),
  to: z.array(z.string()).min(1),
  subject: z.string().optional(),
  body: z.string().min(1)
});

export type PolicyValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateDecisionAgainstPolicy(params: {
  decisionType: 'approve' | 'reject' | 'request_changes';
  policy: unknown;
  payload: unknown;
}): PolicyValidationResult {
  if (params.decisionType !== 'approve') {
    return { ok: true };
  }

  const parsedPolicy = MessagePolicySchema.safeParse(params.policy);
  if (!parsedPolicy.success) {
    return { ok: false, reason: 'Pinned policy payload is invalid' };
  }

  const parsedPayload = MessagePayloadSchema.safeParse(params.payload);
  if (!parsedPayload.success) {
    return { ok: false, reason: 'Draft payload is invalid for approval' };
  }

  const policy = parsedPolicy.data;
  const payload = parsedPayload.data;

  if (!policy.allowedChannels.includes(payload.channel)) {
    return { ok: false, reason: `Channel ${payload.channel} is not allowed by policy` };
  }

  if (payload.to.length > policy.maxRecipients) {
    return { ok: false, reason: `Recipient count exceeds policy max of ${policy.maxRecipients}` };
  }

  if (payload.channel === 'email' && policy.requireSubjectForEmail && !payload.subject?.trim()) {
    return { ok: false, reason: 'Email approval requires a subject under the pinned policy' };
  }

  return { ok: true };
}
