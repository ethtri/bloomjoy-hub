import { strict as assert } from 'node:assert';
import { assertCompanyExportScope, companyChange, companyOptions, groupCompanyRows, resolveCompanyScope } from './companyReporting.ts';
import { defaultWorkspaceState, operationalReportHref, parseSavedViews, readWorkspaceState, writeWorkspaceState } from './reportingWorkspace.ts';

const dimensions = [
  { machineId: 'm1', locationId: 'old', accountId: 'a', accountName: 'Alpha' },
  { machineId: 'm1', locationId: 'current', accountId: 'a', accountName: 'Alpha' },
  { machineId: 'm2', locationId: 'current', accountId: 'b', accountName: 'Alpha' },
  { machineId: 'm3', locationId: 'unknown', accountId: null, accountName: null },
];
Deno.test('company IDs remain distinct despite equal names, historical locations do not duplicate machines', () => {
  assert.equal(companyOptions(dimensions).length, 2);
  assert.deepEqual(resolveCompanyScope(dimensions, 'a').machineIds, ['m1']);
  const grouped = groupCompanyRows([{ machineId: 'm1', amount: 3 }, { machineId: 'm1', amount: 5 }, { machineId: 'm2', amount: 7 }, { machineId: 'm3', amount: null }], dimensions);
  assert.equal(grouped.length, 3);
  assert.equal(grouped.find(row => row.id === 'a')!.rows.reduce((sum, row) => sum + (row.amount ?? 0), 0), 8);
  assert.equal(grouped.find(row => row.id === 'a')!.machineIds.size, 1);
  assert.equal(grouped.find(row => row.id === 'unassigned')!.rows[0].amount, null);
});
Deno.test('empty and unauthorized company intersections never widen into all machines', () => {
  for (const [company, location, machine] of [['a', 'unknown', 'all'], ['a', 'all', 'm2'], ['missing', 'all', 'all']]) {
    const scope = resolveCompanyScope(dimensions, company, location, machine);
    assert.equal(scope.empty, true); assert.equal(scope.invalid, true); assert.deepEqual(scope.machineIds, []);
  }
  assert.throws(() => assertCompanyExportScope(dimensions, 'a', [{ machineId: 'm2' }]));
  assert.throws(() => assertCompanyExportScope(dimensions.filter(row => row.accountId !== 'a'), 'a', [{ machineId: 'm1' }]));
});
Deno.test('company changes retain compatible historical locations and clear only incompatible scope', () => {
  assert.deepEqual(companyChange(dimensions, 'a', 'old', 'm1'), { companyId: 'a', locationId: 'old', machineId: 'm1' });
  assert.deepEqual(companyChange(dimensions, 'b', 'old', 'm1'), { companyId: 'b', locationId: 'all', machineId: 'all' });
});
Deno.test('company URLs and saved views round-trip while old views default to All companies', () => {
  const state = { ...defaultWorkspaceState(), companyId: 'a', dateFrom: '2026-07-15', dateTo: '2026-07-21' };
  assert.deepEqual(readWorkspaceState(writeWorkspaceState(state)), state);
  assert(operationalReportHref('refunds', state).includes('company=a'));
  assert(!operationalReportHref('labor', state).includes('company='));
  const legacy = { ...state } as Partial<typeof state>; delete legacy.companyId;
  assert.equal(parseSavedViews(JSON.stringify([{ id: 'old', name: 'Old', state: legacy }]))[0].state.companyId, 'all');
});
