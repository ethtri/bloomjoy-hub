import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.VITE_SUPABASE_ANON_KEY ??= 'local-refund-overview-test-key';

let vite;
let refundOperations;

test.before(async () => {
  vite = await createServer({
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
  });
  refundOperations = await vite.ssrLoadModule('/src/lib/refundOperations.ts');
});

test.after(async () => {
  await vite?.close();
});

const operationsSource = fs.readFileSync(
  new URL('../../src/lib/refundOperations.ts', import.meta.url),
  'utf8',
);
const pageSource = fs.readFileSync(
  new URL('../../src/pages/admin/Refunds.tsx', import.meta.url),
  'utf8',
);
const candidateReviewSource = fs.readFileSync(
  new URL('../../src/components/refunds/RefundTransactionCandidateReview.tsx', import.meta.url),
  'utf8',
);
const supplementSource = fs.readFileSync(
  new URL('../../src/lib/refundOperationsSupplements.ts', import.meta.url),
  'utf8',
);
const lifecycleSafetySource = fs.readFileSync(
  new URL('../../src/lib/refundOperationsLifecycleSafety.ts', import.meta.url),
  'utf8',
);
const migrationSource = fs.readFileSync(
  new URL(
    '../../supabase/migrations/20260911164704_refund_overview_lifecycle_reuse.sql',
    import.meta.url,
  ),
  'utf8',
);
const lifecyclePrecedenceMigrationSource = fs.readFileSync(
  new URL(
    '../../supabase/migrations/20260911174609_refund_lifecycle_accounting_outreach_precedence.sql',
    import.meta.url,
  ),
  'utf8',
);

const functionBody = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

test('optional reads cannot fail the critical refund overview read', () => {
  const overviewRead = functionBody(
    operationsSource,
    'export const fetchRefundOperationsOverview',
    'export type RefundOperationsSupplements',
  );
  assert.doesNotMatch(overviewRead, /get_refund_manager_work_projection/);
  assert.doesNotMatch(overviewRead, /admin_get_refund_gmail_draft_cases/);
  assert.doesNotMatch(overviewRead, /admin_get_refund_email_queue_states/);
  assert.doesNotMatch(overviewRead, /admin_get_refund_manual_nayax_context/);
  assert.doesNotMatch(overviewRead, /Promise\.all/);

  const supplementRead = functionBody(
    operationsSource,
    'export const fetchRefundOperationsSupplements',
    'export const fetchRefundManagerWorkProjection',
  );
  assert.match(supplementRead, /admin_get_refund_gmail_draft_cases/);
  assert.match(supplementRead, /admin_get_refund_email_queue_states/);
  assert.doesNotMatch(supplementRead, /admin_get_refund_manual_nayax_context/);
  assert.match(supplementRead, /unavailableSources/);
  assert.doesNotMatch(supplementSource, /officialActionBlockReason/);
  assert.doesNotMatch(supplementSource, /canPerformOfficialAction:\s*false/);
  assert.doesNotMatch(supplementSource, /canSelectNayaxCandidate:\s*false/);
  assert.match(supplementSource, /if \(!supplements\) return overview/);

  const managerRead = functionBody(
    operationsSource,
    'export const fetchRefundManagerWorkProjection',
    'export const fetchRefundCaseReconciliation',
  );
  assert.match(managerRead, /get_refund_manager_work_projection/);
  assert.match(managerRead, /return null/);
});

test('overview parser localizes optional skew while core identity and capability remain fail-closed', () => {
  const fixture = refundOperations.buildLocalRefundDemoOverview();
  const selectedIndex = fixture.cases.findIndex((refundCase) => refundCase.selectedNayaxTransaction);
  assert.ok(selectedIndex >= 0);

  const malformedSelection = structuredClone(fixture);
  malformedSelection.cases[selectedIndex].selectedNayaxTransaction.transactionId = 'x';
  const localizedSelection = refundOperations.parseRefundOperationsOverview(malformedSelection);
  assert.equal(localizedSelection.cases.length, fixture.cases.length);
  assert.equal(localizedSelection.cases[selectedIndex].selectedNayaxTransaction, null);
  assert.equal(
    localizedSelection.cases[selectedIndex].canPerformOfficialAction,
    fixture.cases[selectedIndex].canPerformOfficialAction,
  );
  assert.equal(localizedSelection.cases[0].id, fixture.cases[0].id);

  const malformedTime = structuredClone(fixture);
  malformedTime.cases[selectedIndex].selectedNayaxTransaction.timeEvidence.providerTimestampSource = 'future_contract';
  const localizedTime = refundOperations.parseRefundOperationsOverview(malformedTime);
  assert.equal(
    localizedTime.cases[selectedIndex].selectedNayaxTransaction.transactionId,
    fixture.cases[selectedIndex].selectedNayaxTransaction.transactionId,
  );
  assert.equal(localizedTime.cases[selectedIndex].selectedNayaxTransaction.timeEvidence, null);

  const skewedLifecycle = structuredClone(fixture);
  skewedLifecycle.lifecycleContractVersion = 'refund_lifecycle_v99';
  const localizedLifecycle = refundOperations.parseRefundOperationsOverview(skewedLifecycle);
  assert.equal(localizedLifecycle.cases.length, fixture.cases.length);
  assert.equal(localizedLifecycle.lifecycleContractVersion, undefined);
  assert.ok(localizedLifecycle.lifecycleValidationFailureCount > 0);
  assert.ok(localizedLifecycle.cases.every((refundCase) => refundCase.lifecycle === null));
  assert.ok(localizedLifecycle.cases.every((refundCase, index) =>
    fixture.cases[index].lifecycle == null || refundCase.workflowProjectionUnavailable === true));

  const missingCapability = structuredClone(fixture);
  delete missingCapability.cases[0].canPerformOfficialAction;
  delete missingCapability.cases[0].canSelectNayaxCandidate;
  const parsedWithoutCapability = refundOperations.parseRefundOperationsOverview(missingCapability);
  assert.equal(parsedWithoutCapability.cases[0].canPerformOfficialAction, undefined);
  assert.equal(parsedWithoutCapability.cases[0].canSelectNayaxCandidate, undefined);

  const malformedIdentity = structuredClone(fixture);
  malformedIdentity.cases[0].id = '';
  assert.throws(
    () => refundOperations.parseRefundOperationsOverview(malformedIdentity),
    /Unsupported refund queue response/,
  );

  const duplicateBinding = structuredClone(fixture);
  duplicateBinding.cases[1].id = duplicateBinding.cases[0].id;
  assert.throws(
    () => refundOperations.parseRefundOperationsOverview(duplicateBinding),
    /Unsupported refund queue response/,
  );

  const unredactedSelection = structuredClone(fixture);
  unredactedSelection.cases[selectedIndex].selectedNayaxTransaction.payloadRedacted = false;
  assert.throws(
    () => refundOperations.parseRefundOperationsOverview(unredactedSelection),
    /Unsupported selected Nayax transaction response/,
  );

  const unredactedLegacyCandidateTime = structuredClone(fixture);
  delete unredactedLegacyCandidateTime.candidateTimeContractVersion;
  const candidateCase = unredactedLegacyCandidateTime.cases.find(
    (refundCase) => refundCase.nayaxLookupCandidates.some((candidate) => candidate.timeEvidence),
  );
  assert.ok(candidateCase);
  const candidateWithTime = candidateCase.nayaxLookupCandidates.find((candidate) => candidate.timeEvidence);
  assert.ok(candidateWithTime);
  candidateWithTime.timeEvidence.payloadRedacted = false;
  assert.throws(
    () => refundOperations.parseRefundOperationsOverview(unredactedLegacyCandidateTime),
    /Unsupported refund candidate time response/,
  );
});

test('local demo card purchase keeps one exact provider authorization instant', () => {
  const refundCase = refundOperations.buildLocalRefundDemoOverview().cases.find(
    (entry) => entry.id === 'demo-card-match',
  );
  assert.ok(refundCase);
  const candidate = refundCase.nayaxLookupCandidates?.[0];
  assert.ok(candidate);
  assert.equal(refundCase.matchedNayaxMachineAuthTime, candidate.machineAuthorizationTime);
  assert.equal(refundCase.selectedNayaxTransaction?.providerAuthorizedAt, candidate.machineAuthorizationTime);
  assert.equal(refundCase.selectedNayaxTransaction?.providerTimestampAt, candidate.authorizedAt);
});

test('overview parser omits only cases with malformed message or candidate collections', () => {
  const fixture = refundOperations.buildLocalRefundDemoOverview();
  const malformedIndex = fixture.cases.findIndex(
    (refundCase) => refundCase.canPerformOfficialAction === true &&
      refundCase.canSelectNayaxCandidate === true,
  );
  assert.ok(malformedIndex >= 0);
  const malformedCaseId = fixture.cases[malformedIndex].id;
  const healthyCases = fixture.cases.filter((refundCase) => refundCase.id !== malformedCaseId);

  for (const collection of ['messages', 'nayaxLookupCandidates']) {
    const malformed = structuredClone(fixture);
    malformed.cases[malformedIndex][collection] = { unexpected: true };

    const parsed = refundOperations.parseRefundOperationsOverview(malformed);
    assert.equal(parsed.cases.length, healthyCases.length);
    assert.equal(parsed.cases.some((refundCase) => refundCase.id === malformedCaseId), false);
    for (const healthyCase of healthyCases) {
      const parsedCase = parsed.cases.find((refundCase) => refundCase.id === healthyCase.id);
      assert.ok(parsedCase);
      assert.equal(parsedCase.canPerformOfficialAction, healthyCase.canPerformOfficialAction);
      assert.equal(parsedCase.canSelectNayaxCandidate, healthyCase.canSelectNayaxCandidate);
    }
  }

  const unredactedOmittedCase = structuredClone(fixture);
  const selectedIndex = unredactedOmittedCase.cases.findIndex(
    (refundCase) => refundCase.selectedNayaxTransaction,
  );
  assert.ok(selectedIndex >= 0);
  unredactedOmittedCase.cases[selectedIndex].messages = { unexpected: true };
  unredactedOmittedCase.cases[selectedIndex].selectedNayaxTransaction.payloadRedacted = false;
  assert.throws(
    () => refundOperations.parseRefundOperationsOverview(unredactedOmittedCase),
    /Unsupported selected Nayax transaction response/,
  );
});

test('the portal schedules manager work only after the core overview succeeds', () => {
  const overviewQuery = functionBody(
    pageSource,
    "queryKey: ['admin-refund-operations-overview']",
    "queryKey: ['refund-manager-work-projection']",
  );
  assert.match(overviewQuery, /fetchRefundOperationsOverview/);
  assert.doesNotMatch(overviewQuery, /fetchRefundManagerWorkProjection/);

  const managerQuery = functionBody(
    pageSource,
    "queryKey: ['refund-manager-work-projection']",
    "queryKey: ['refund-operations-supplements']",
  );
  assert.match(managerQuery, /queryFn: fetchRefundManagerWorkProjection/);
  assert.match(managerQuery, /overviewReadStatus === 'success'/);
  assert.match(managerQuery, /retry: false/);

  const supplementQuery = functionBody(
    pageSource,
    "queryKey: ['refund-operations-supplements']",
    'const liveOverview = useMemo',
  );
  assert.match(supplementQuery, /queryFn: fetchRefundOperationsSupplements/);
  assert.match(supplementQuery, /overviewReadStatus === 'success'/);
  assert.match(supplementQuery, /retry: false/);

  const liveOverview = functionBody(
    pageSource,
    'const liveOverview = useMemo',
    'const availabilityCaseIsTerminal',
  );
  assert.match(liveOverview, /mergeRefundOperationsSupplements/);
});

test('manual refresh completes the critical overview before optional manager work', () => {
  const refresh = functionBody(pageSource, 'const refresh = async () => {', 'const isUsingDemoData');
  const overviewIndex = refresh.indexOf(
    "await queryClient.invalidateQueries({ queryKey: ['admin-refund-operations-overview'] })",
  );
  const managerIndex = refresh.indexOf(
    "queryClient.invalidateQueries({ queryKey: ['refund-manager-work-projection'] })",
  );
  assert.ok(overviewIndex >= 0);
  assert.ok(managerIndex > overviewIndex);
  assert.ok(refresh.indexOf(
    "queryClient.invalidateQueries({ queryKey: ['refund-operations-supplements'] })",
  ) > overviewIndex);
});

test('manager queue projection reuses the delegated lifecycle without an N+1 call', () => {
  assert.match(
    migrationSource,
    /select item\.case_json -> 'lifecycle' as lifecycle_json/,
  );
  assert.doesNotMatch(migrationSource, /refund_lifecycle_contract\s*\(/);
  assert.match(
    migrationSource,
    /revoke all on function\s+public\.admin_get_refund_operations_overview_pre_customer_correction_v1\(\)/,
  );
});

test('one malformed lifecycle cannot discard the queue or revoke server capability', () => {
  assert.match(operationsSource, /applyRefundLifecycleSafety/);
  assert.match(operationsSource, /lifecycleValidationFailureCount/);
  assert.match(lifecycleSafetySource, /\.\.\.refundCase,[\s\S]*lifecycle: null/);
  assert.doesNotMatch(lifecycleSafetySource, /canPerformOfficialAction:\s*false/);
  assert.doesNotMatch(lifecycleSafetySource, /canSelectNayaxCandidate:\s*false/);
  assert.doesNotMatch(
    lifecycleSafetySource,
    /officialActionBlockReason:\s*['"]official_actions_disabled['"]/,
  );
  assert.match(
    pageSource,
    /const candidateSelectionAuthorized\s*=\s*reviewedFinalDecisionReady\s*\? selectedCase\.canPerformOfficialAction === true\s*: \(selectedCase\.canSelectNayaxCandidate \?\? selectedCase\.canPerformOfficialAction\) === true/,
  );
  assert.match(pageSource, /canSelectCandidate:\s*candidateSelectionAuthorized/);
  assert.match(
    pageSource,
    /canAccessCandidateSelection={candidateSelectionAuthorized}/,
  );
  assert.match(
    candidateReviewSource,
    /!canAccessCandidateSelection[\s\S]*You can review this result, but your current case access does not allow you to \$\{reviewedFinalDecision \? 'decide this refund' : 'save it'\}\./,
  );
  assert.doesNotMatch(
    `${pageSource}\n${candidateReviewSource}`,
    /\(selectedCase\.canSelectNayaxCandidate \?\? selectedCase\.canPerformOfficialAction\) !== false/,
  );
  assert.match(pageSource, /data-testid="refund-lifecycle-read-status"/);
  assert.match(pageSource, /lifecycle and progress detail is unavailable/);
  assert.match(pageSource, /const refundQueueTruthUnavailable = !isUsingDemoData/);
  assert.match(pageSource, /Refund case list temporarily unavailable/);
  assert.match(pageSource, /isRefundWorkflowProjectionUnavailable\(refundCase\)/);
});

test('pending accounting ownership wins over historical outreach state', () => {
  const accountingGuard = lifecyclePrecedenceMigrationSource.indexOf(
    "if p_lifecycle #>> '{accountingState,state}' = 'pending' then",
  );
  const outreachQueueOverride = lifecyclePrecedenceMigrationSource.indexOf(
    "'managerAction', jsonb_build_object(",
  );
  assert.ok(accountingGuard >= 0);
  assert.ok(outreachQueueOverride > accountingGuard);
  assert.match(lifecyclePrecedenceMigrationSource, /return result;/);
  assert.match(
    lifecyclePrecedenceMigrationSource,
    /revoke all on function public\.refund_apply_customer_outreach_to_lifecycle\(jsonb, jsonb\)/,
  );
});
