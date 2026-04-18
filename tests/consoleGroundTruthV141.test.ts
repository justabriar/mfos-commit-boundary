import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/mfos_ground_truth_v1_4_1.json' assert { type: 'json' };
import { decideMfosMiddleware, type MfosDecisionInput } from '../src/middleware/mfosDecision.js';

type GroundTruthCase = (typeof fixture.cases)[number];

function toMiddlewareInput(selectedCase: GroundTruthCase): MfosDecisionInput {
  const maybeInput = selectedCase.input as Partial<MfosDecisionInput>;

  return {
    ...maybeInput,
    reasonCodes: Array.isArray(maybeInput.reasonCodes)
      ? maybeInput.reasonCodes
      : selectedCase.mfosGate.reasonCodes,
    ownership: maybeInput.ownership
      ? maybeInput.ownership
      : selectedCase.ownership
  };
}

test('at least first 3 cases match expected decision on run path', () => {
  const firstThree = fixture.cases.slice(0, 3);
  assert.equal(firstThree.length, 3);

  for (const c of firstThree) {
    const actual = decideMfosMiddleware(toMiddlewareInput(c));
    const expected = c.groundTruth?.expectedDecision ?? c.mfosGate.decision;
    assert.equal(actual, expected, `mismatch for ${c.caseId}`);
  }
});
