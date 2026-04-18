import { useMemo, useState } from 'react';
import fixtureData from '@fixtures';
import { decideMfosMiddleware, type MfosDecision, type MfosDecisionInput } from '@middleware';

type GroundTruthCase = {
  caseId: string;
  title?: string;
  description?: string;
  input: Record<string, unknown>;
  ownership: {
    required: boolean;
    verified: boolean;
  };
  trustContext: Record<string, unknown>;
  thresholdEvaluation: {
    mechanicalTriggers: string[];
  };
  classification: {
    actionIntent: {
      targetAction: string;
    };
  };
  mfosGate: {
    decision: MfosDecision;
    reasonCodes: string[];
    explanation: string;
    requiredNextSteps: string[];
  };
  groundTruth?: {
    expectedDecision?: MfosDecision;
  };
};

type GroundTruthFixture = {
  suiteVersion: string;
  cases: GroundTruthCase[];
};

type DecisionRun = {
  actualDecision: MfosDecision;
  expectedDecision: MfosDecision;
  status: 'PASS' | 'FAIL';
  matchedReasonCodes: string[];
  explanation: string;
  requiredNextSteps: string[];
};

const fixture = fixtureData as GroundTruthFixture;

const DIRECT_RULES = new Set([
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
  'TRACE_MISSING',
  'AUTHENTICATION_FAILED',
  'AUTHORIZATION_FAILED',
  'SIGNATURE_INVALID',
  'REPLAY_DETECTED',
  'IDEMPOTENCY_KEY_MISSING',
  'TRANSPORT_UNTRUSTED'
]);

function toMiddlewareInput(selectedCase: GroundTruthCase): MfosDecisionInput {
  const maybeInput = selectedCase.input as Partial<MfosDecisionInput>;
  const inputFromCase = {
    ...maybeInput
  };

  return {
    ...inputFromCase,
    reasonCodes: Array.isArray(maybeInput.reasonCodes)
      ? maybeInput.reasonCodes
      : selectedCase.mfosGate.reasonCodes,
    ownership: maybeInput.ownership
      ? maybeInput.ownership
      : selectedCase.ownership
  };
}

function runCase(selectedCase: GroundTruthCase): DecisionRun {
  const middlewareInput = toMiddlewareInput(selectedCase);
  const actualDecision = decideMfosMiddleware(middlewareInput);
  const expectedDecision = selectedCase.groundTruth?.expectedDecision ?? selectedCase.mfosGate.decision;

  const matchedReasonCodes = middlewareInput.reasonCodes.filter((code) => DIRECT_RULES.has(code));

  return {
    actualDecision,
    expectedDecision,
    status: actualDecision === expectedDecision ? 'PASS' : 'FAIL',
    matchedReasonCodes,
    explanation: selectedCase.mfosGate.explanation,
    requiredNextSteps: selectedCase.mfosGate.requiredNextSteps
  };
}

export function App() {
  const [selectedCaseId, setSelectedCaseId] = useState(fixture.cases[0]?.caseId ?? '');
  const [decisionRun, setDecisionRun] = useState<DecisionRun | null>(null);

  const selectedCase = useMemo(
    () => fixture.cases.find((item) => item.caseId === selectedCaseId) ?? fixture.cases[0],
    [selectedCaseId]
  );

  if (!selectedCase) {
    return <main><h1>MFOS Commit Boundary Console</h1><p>No cases available.</p></main>;
  }

  const onRunDecision = () => {
    setDecisionRun(runCase(selectedCase));
  };

  const onExportJson = () => {
    if (!decisionRun) return;

    const payload = {
      caseId: selectedCase.caseId,
      suiteVersion: fixture.suiteVersion,
      input: selectedCase.input,
      output: decisionRun
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedCase.caseId}-decision.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main>
      <h1>MFOS Commit Boundary Console</h1>

      <label>
        Select Case
        <select value={selectedCase.caseId} onChange={(event) => setSelectedCaseId(event.target.value)}>
          {fixture.cases.map((item) => (
            <option key={item.caseId} value={item.caseId}>{item.caseId}</option>
          ))}
        </select>
      </label>

      <div className="layout">
        <section>
          <h2>Left Panel</h2>
          <p><strong>caseId:</strong> {selectedCase.caseId}</p>
          <p><strong>description:</strong> {selectedCase.description ?? selectedCase.title ?? 'n/a'}</p>
          <p><strong>action intent:</strong> {selectedCase.classification.actionIntent.targetAction}</p>
          <p><strong>trustContext:</strong> <code>{JSON.stringify(selectedCase.trustContext)}</code></p>
          <p><strong>ownership:</strong> <code>{JSON.stringify(selectedCase.ownership)}</code></p>
          <p><strong>mechanicalTriggers:</strong> <code>{JSON.stringify(selectedCase.thresholdEvaluation.mechanicalTriggers)}</code></p>
          <p><strong>mfosGate.decision:</strong> {selectedCase.mfosGate.decision}</p>
          <p><strong>mfosGate.reasonCodes:</strong> <code>{JSON.stringify(selectedCase.mfosGate.reasonCodes)}</code></p>
          <p><strong>mfosGate.explanation:</strong> {selectedCase.mfosGate.explanation}</p>
          <p><strong>mfosGate.requiredNextSteps:</strong> <code>{JSON.stringify(selectedCase.mfosGate.requiredNextSteps)}</code></p>
        </section>

        <section className="decision-panel">
          <h2>Right Panel</h2>
          <div className={`status-banner ${decisionRun?.status === 'FAIL' ? 'fail' : 'pass'}`}>
            {decisionRun
              ? `${decisionRun.status === 'PASS' ? '✅ PASS' : '❌ FAIL'} — expected: ${decisionRun.expectedDecision}, actual: ${decisionRun.actualDecision}`
              : 'Run Decision to compare expected vs actual'}
          </div>
          <p><strong>actual decision:</strong> {decisionRun?.actualDecision ?? '-'}</p>
          <p><strong>expected decision:</strong> {decisionRun?.expectedDecision ?? (selectedCase.groundTruth?.expectedDecision ?? '-')}</p>
          <p><strong>status:</strong> <span className={decisionRun?.status === 'FAIL' ? 'fail' : 'pass'}>{decisionRun?.status ?? '-'}</span></p>
          <p><strong>matched reason codes:</strong> <code>{JSON.stringify(decisionRun?.matchedReasonCodes ?? [])}</code></p>
          <p><strong>short explanation:</strong> {decisionRun?.explanation ?? '-'}</p>
          <p><strong>required next steps:</strong> <code>{JSON.stringify(decisionRun?.requiredNextSteps ?? [])}</code></p>
        </section>
      </div>

      <section>
        <h2>Compare</h2>
        <p><strong>Without MFOS:</strong> allow</p>
        <p><strong>With MFOS:</strong> {decisionRun?.actualDecision ?? '-'}</p>
        <p><strong>Difference:</strong> {decisionRun ? (decisionRun.actualDecision === 'allow' ? 'No difference' : `MFOS changes result to ${decisionRun.actualDecision.toUpperCase()}`) : '-'}</p>
      </section>

      <div className="actions">
        <button type="button" onClick={onRunDecision}>Run Decision</button>
        <button type="button" onClick={onExportJson} disabled={!decisionRun}>Export JSON</button>
      </div>
    </main>
  );
}
