export type MfosDecision = 'allow' | 'slow' | 'block';

export type MfosDecisionInput = {
  reasonCodes: string[];
  ownership: {
    required: boolean;
    verified: boolean;
  };
  policy?: {
    compositeRules?: CompositeRule[];
  };
};

export type CompositeRule = {
  type: 'AND';
  requires: string[];
  decision: MfosDecision;
};

const SLOW_REASON_CODES = new Set([
  'ACTION_IMPLIED',
  'PRESSURE_MODERATE',
  'CONSEQUENCE_MEDIUM',
  'OWNERSHIP_UNCLEAR',
  'IDENTITY_UNVERIFIED',
  'AMBIGUITY_HIGH',
  'VERIFICATION_PENDING',
  'AUTHENTICATION_PARTIAL',
  'TRUST_CONTEXT_LOW',
  'SIGNATURE_MISSING',
  'TRACE_MISSING'
]);

const DIRECT_BLOCK_REASON_CODES = new Set([
  'AUTHENTICATION_FAILED',
  'AUTHORIZATION_FAILED',
  'SIGNATURE_INVALID',
  'REPLAY_DETECTED',
  'IDEMPOTENCY_KEY_MISSING',
  'TRANSPORT_UNTRUSTED'
]);

function hasAll(reasonCodes: Set<string>, required: string[]): boolean {
  return required.every((reasonCode) => reasonCodes.has(reasonCode));
}

function evaluateCompositeRules(
  reasonCodes: Set<string>,
  compositeRules: CompositeRule[] | undefined
): MfosDecision | null {
  if (!compositeRules || compositeRules.length === 0) {
    return null;
  }

  let bestDecision: MfosDecision | null = null;
  const decisionPriority: MfosDecision[] = ['allow', 'slow', 'block'];

  for (const rule of compositeRules) {
    if (rule.type !== 'AND') {
      continue;
    }

    if (!hasAll(reasonCodes, rule.requires)) {
      continue;
    }

    if (!bestDecision) {
      bestDecision = rule.decision;
      continue;
    }

    if (decisionPriority.indexOf(rule.decision) > decisionPriority.indexOf(bestDecision)) {
      bestDecision = rule.decision;
    }
  }

  return bestDecision;
}

export function decideMfosMiddleware(input: MfosDecisionInput): MfosDecision {
  const reasonCodes = new Set(input.reasonCodes);

  if (hasAll(reasonCodes, ['ACTION_EXPLICIT', 'PRESSURE_STRONG'])) {
    return 'block';
  }

  if (
    reasonCodes.has('CONSEQUENCE_HIGH')
    && (
reasonCodes.has('IDENTITY_UNVERIFIED')
      || reasonCodes.has('AUTHENTICATION_PARTIAL')
      || reasonCodes.has('AUTHENTICATION_FAILED')
    )
  ) {
    return 'block';
  }

  if (reasonCodes.has('IRREVERSIBLE_ACTION') && (input.ownership.required && !input.ownership.verified)) {
    return 'block';
  }

  if (hasAll(reasonCodes, ['SELF_APPROVAL_BLOCKED', 'SECOND_REVIEW_REQUIRED'])) {
    return 'block';
  }

  if (
    reasonCodes.has('SECRECY_PRESENT')
    && (reasonCodes.has('CONSEQUENCE_HIGH') || reasonCodes.has('IRREVERSIBLE_ACTION'))
  ) {
    return 'block';
  }

  if (reasonCodes.has('TRUST_CONTEXT_LOW') && reasonCodes.has('AUTHENTICATION_FAILED')) {
    return 'block';
  }

  for (const reasonCode of reasonCodes) {
    if (DIRECT_BLOCK_REASON_CODES.has(reasonCode)) {
      return 'block';
    }
  }

  for (const reasonCode of reasonCodes) {
    if (SLOW_REASON_CODES.has(reasonCode)) {
      return 'slow';
    }
  }

  const compositeDecision = evaluateCompositeRules(reasonCodes, input.policy?.compositeRules);
  if (compositeDecision) {
    return compositeDecision;
  }

  if (hasAll(reasonCodes, ['ACTION_NONE', 'CONSEQUENCE_LOW'])) {
    return 'allow';
  }

  if (!reasonCodes.has('PRESSURE_STRONG') && !reasonCodes.has('PRESSURE_MODERATE')) {
    return 'allow';
  }

  if (!input.ownership.required || input.ownership.verified) {
    return 'allow';
  }

  return 'slow';
}
