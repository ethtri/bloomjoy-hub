import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const operationsSource = fs.readFileSync(
  new URL('../../src/lib/refundOperations.ts', import.meta.url),
  'utf8',
);
const pageSource = fs.readFileSync(
  new URL('../../src/pages/admin/Refunds.tsx', import.meta.url),
  'utf8',
);
const supplementSource = fs.readFileSync(
  new URL('../../src/lib/refundOperationsSupplements.ts', import.meta.url),
  'utf8',
);
const migrationSource = fs.readFileSync(
  new URL(
    '../../supabase/migrations/20260911164704_refund_overview_lifecycle_reuse.sql',
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
    'type RefundManualNayaxContext',
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
  assert.match(supplementRead, /admin_get_refund_manual_nayax_context/);
  assert.match(supplementRead, /unavailableSources/);
  assert.match(supplementSource, /officialActionBlockReason: 'official_actions_disabled'/);
  assert.match(supplementSource, /canPerformOfficialAction: false/);
  assert.match(supplementSource, /canSelectNayaxCandidate: false/);

  const managerRead = functionBody(
    operationsSource,
    'export const fetchRefundManagerWorkProjection',
    'export const fetchRefundCaseReconciliation',
  );
  assert.match(managerRead, /get_refund_manager_work_projection/);
  assert.match(managerRead, /return null/);
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
