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

const functionBody = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

test('optional manager work cannot fail the critical refund overview read', () => {
  const overviewRead = functionBody(
    operationsSource,
    'export const fetchRefundOperationsOverview',
    'export const fetchRefundManagerWorkProjection',
  );
  assert.doesNotMatch(overviewRead, /get_refund_manager_work_projection/);

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
    'const liveOverview = useMemo',
  );
  assert.match(managerQuery, /queryFn: fetchRefundManagerWorkProjection/);
  assert.match(managerQuery, /overviewReadStatus === 'success'/);
  assert.match(managerQuery, /retry: false/);
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
});
