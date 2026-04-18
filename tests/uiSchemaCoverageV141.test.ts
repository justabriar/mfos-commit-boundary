import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/mfos_ground_truth_v1_4_1.json' assert { type: 'json' };

test('v1.4.1 fixture includes all fields required by console rendering', () => {
  for (const c of fixture.cases) {
    assert.ok(c.trustContext, `missing trustContext for ${c.caseId}`);
    assert.ok(c.ownership, `missing ownership for ${c.caseId}`);
    assert.ok(c.thresholdEvaluation?.mechanicalTriggers, `missing mechanicalTriggers for ${c.caseId}`);
    assert.ok(c.mfosGate?.decision, `missing mfosGate.decision for ${c.caseId}`);
    assert.ok(c.mfosGate?.reasonCodes, `missing mfosGate.reasonCodes for ${c.caseId}`);
    assert.ok(c.mfosGate?.explanation, `missing mfosGate.explanation for ${c.caseId}`);
    assert.ok(c.mfosGate?.requiredNextSteps, `missing mfosGate.requiredNextSteps for ${c.caseId}`);
  }
});
