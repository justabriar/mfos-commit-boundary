import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { decideMfosMiddleware } from '../src/middleware/mfosDecision.js';

type GroundTruthCase = {
  caseId: string;
  thresholdEvaluation: {
    mechanicalTriggers: string[];
  };
  ownership: {
    required: boolean;
    verified: boolean;
  };
  mfosGate: {
    decision: 'allow' | 'slow' | 'block';
    reasonCodes: string[];
  };
};

type GroundTruthFixture = {
  gateRules: {
    allow: string[];
    slow: string[];
    block: string[];
  };
  decisionPriority: Array<'block' | 'slow' | 'allow'>;
  cases: GroundTruthCase[];
};

const fixture = JSON.parse(readFileSync('fixtures/mfos_ground_truth_v1_4_1.json', 'utf8')) as GroundTruthFixture;

const TRIGGER_TO_DECISION = new Map<string, 'allow' | 'slow' | 'block'>([
  ['ACTION_NONE', 'allow'],
  ['CONSEQUENCE_LOW', 'allow'],
  ['ACTION_IMPLIED', 'slow'],
  ['PRESSURE_MODERATE', 'slow'],
  ['CONSEQUENCE_MEDIUM', 'slow'],
  ['OWNERSHIP_UNCLEAR', 'slow'],
  ['IDENTITY_UNVERIFIED', 'slow'],
  ['AMBIGUITY_HIGH', 'slow'],
  ['VERIFICATION_PENDING', 'slow'],
  ['AUTHENTICATION_PARTIAL', 'slow'],
  ['TRUST_CONTEXT_LOW', 'slow'],
  ['SIGNATURE_MISSING', 'slow'],
  ['TRACE_MISSING', 'slow'],
  ['AUTHENTICATION_FAILED', 'block'],
  ['AUTHORIZATION_FAILED', 'block'],
  ['SIGNATURE_INVALID', 'block'],
  ['REPLAY_DETECTED', 'block'],
  ['IDEMPOTENCY_KEY_MISSING', 'block'],
  ['TRANSPORT_UNTRUSTED', 'block']
]);

test('report mismatches between gate policy rules and case mechanical triggers', () => {
  const mismatches: Array<{ caseId: string; policyOnlyDecision: 'allow' | 'slow' | 'block'; expectedDecision: 'allow' | 'slow' | 'block' }> = [];

  for (const c of fixture.cases) {
    let policyOnlyDecision: 'allow' | 'slow' | 'allow' | 'block' = 'allow';

    for (const trigger of c.thresholdEvaluation.mechanicalTriggers) {
      const mapped = TRIGGER_TO_DECISION.get(trigger);
      if (mapped === 'block') {
        policyOnlyDecision = 'block';
        break;
      }
      if (mapped === 'slow' && policyOnlyDecision !== 'block') {
        policyOnlyDecision = 'slow';
      }
    }

    if (policyOnlyDecision !== c.mfosGate.decision) {
      mismatches.push({
        caseId: c.caseId,
        policyOnlyDecision,
        expectedDecision: c.mfosGate.decision
      });
    }
  }

  assert.deepEqual(mismatches, [
    {
      caseId: 'financial_pressure_cashapp_001',
      policyOnlyDecision: 'slow',
      expectedDecision: 'block'
    },
    {
      caseId: 'ownership_self_approval_001',
      policyOnlyDecision: 'allow',
      expectedDecision: 'block'
    }
  ]);
});

test('deterministic middleware decision matches every fixture case', () => {
  for (const c of fixture.cases) {
    const actual = decideMfosMiddleware({
      reasonCodes: c.mfosGate.reasonCodes,
      ownership: {
        required: c.ownership.required,
        verified: c.ownership.verified
      }
    });

    assert.equal(actual, c.mfosGate.decision, `decision mismatch for case ${c.caseId}`);
  }
});

test('composite AND rules are evaluated after direct triggers', () => {
  const noDirectTriggerDecision = decideMfosMiddleware({
    reasonCodes: ['ACTION_EXPLICIT', 'TEMPO_HARD'],
    ownership: {
      required: false,
      verified: false
    },
    policy: {
      compositeRules: [
        {
          type: 'AND',
          requires: ['ACTION_EXPLICIT', 'TEMPO_HARD'],
          decision: 'slow'
        }
      ]
    }
  });

  assert.equal(noDirectTriggerDecision, 'slow');

  const directTriggerPrecedenceDecision = decideMfosMiddleware({
    reasonCodes: ['AUTHENTICATION_FAILED'],
    ownership: {
      required: false,
      verified: false
    },
    policy: {
      compositeRules: [
        {
          type: 'AND',
          requires: ['AUTHENTICATION_FAILED'],
          decision: 'allow'
        }
      ]
    }
  });

  assert.equal(directTriggerPrecedenceDecision, 'block');
});
