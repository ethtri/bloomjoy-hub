import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepairPreflight, normalizeRepairManifest } from './repair-machine-identities.mjs';

const ids = {
  provider: '14765000-0000-4000-8000-000000000001',
  duplicate: '14763000-0000-4000-8000-000000000001',
  target: '14763000-0000-4000-8000-000000000002',
  account: '14761000-0000-4000-8000-000000000001',
  location: '14762000-0000-4000-8000-000000000001',
};

const repair = {
  key: 'white-oaks',
  providerAccountId: ids.provider,
  sourceMachineId: '1001298',
  expectedSourceInventoryId: '159',
  expectedCurrentReportingMachineId: ids.duplicate,
  targetReportingMachineId: ids.target,
  expectedTargetAccountId: ids.account,
  expectedTargetLocationId: ids.location,
  expectedTargetMachineType: 'commercial',
  expectedTargetNayaxMachineId: '312073147',
  partnershipId: null,
  effectiveStartDate: '2025-01-01',
  effectiveEndDate: null,
  reason: 'Confirmed exact SnapCase identity repair',
};

const queue = [{
  providerAccountId: ids.provider,
  sourceMachineId: '1001298',
  sourceInventoryId: '159',
  reportingMachineId: ids.duplicate,
  partnershipId: null,
  effectiveStartDate: '2025-01-01',
  effectiveEndDate: null,
}];

const canonical = {
  id: ids.target,
  account_id: ids.account,
  location_id: ids.location,
  machine_type: 'commercial',
  sunze_machine_id: null,
  nayax_machine_id: '312073147',
};

test('dry-run controls accept an exact legacy Nayax-bound target', () => {
  const manifest = normalizeRepairManifest({ version: 1, repairs: [repair] });
  const [control] = buildRepairPreflight(manifest, queue, [canonical]);
  assert.equal(control.afterReportingMachineId, ids.target);
  assert.equal(control.rollbackReportingMachineId, ids.duplicate);
});

test('rollback controls accept the exact native SnapCase target without a Nayax identity', () => {
  const rollback = normalizeRepairManifest({
    version: 1,
    repairs: [{
      ...repair,
      expectedCurrentReportingMachineId: ids.target,
      targetReportingMachineId: ids.duplicate,
      expectedTargetMachineType: 'snapcase',
      expectedTargetNayaxMachineId: null,
      reason: 'Rollback exact SnapCase identity repair',
    }],
  });
  const rollbackQueue = [{ ...queue[0], reportingMachineId: ids.target }];
  const duplicate = {
    ...canonical,
    id: ids.duplicate,
    machine_type: 'snapcase',
    nayax_machine_id: null,
  };

  const [control] = buildRepairPreflight(rollback, rollbackQueue, [duplicate]);
  assert.equal(control.beforeReportingMachineId, ids.target);
  assert.equal(control.afterReportingMachineId, ids.duplicate);
  assert.equal(control.targetNayaxMachineId, null);
});

test('one bounded dry run validates all six exact source and target identities', () => {
  const candidateKeys = [
    ['white-oaks', '1001298', '159'],
    ['south-hills', '1001302', '162'],
    ['university-park', '1001303', '163'],
    ['arizona-mills', '1001584', '216'],
    ['gurnee-mills', '1001585', '217'],
    ['avenues-mall', '1001591', '218'],
  ];
  const repairs = candidateKeys.map(([key, sourceMachineId, inventoryId], index) => ({
    ...repair,
    key,
    sourceMachineId,
    expectedSourceInventoryId: inventoryId,
    expectedCurrentReportingMachineId: `14763000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
    targetReportingMachineId: `14763000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    expectedTargetNayaxMachineId: `3120731${index}`,
  }));
  const manifest = normalizeRepairManifest({ version: 1, repairs });
  const sixQueueRows = repairs.map((item) => ({
    providerAccountId: item.providerAccountId,
    sourceMachineId: item.sourceMachineId,
    sourceInventoryId: item.expectedSourceInventoryId,
    reportingMachineId: item.expectedCurrentReportingMachineId,
    partnershipId: null,
    effectiveStartDate: item.effectiveStartDate,
    effectiveEndDate: null,
  }));
  const sixTargets = repairs.map((item) => ({
    ...canonical,
    id: item.targetReportingMachineId,
    nayax_machine_id: item.expectedTargetNayaxMachineId,
  }));

  assert.equal(buildRepairPreflight(manifest, sixQueueRows, sixTargets).length, 6);
});

test('same-name wrong-account candidates cannot satisfy exact controls', () => {
  const manifest = normalizeRepairManifest({ version: 1, repairs: [repair] });
  assert.throws(
    () => buildRepairPreflight(manifest, queue, [{ ...canonical, account_id: '14761000-0000-4000-8000-000000000099' }]),
    /target identity controls changed/
  );
});

test('Sunze-bound candidates remain excluded even when Nayax-bound', () => {
  const manifest = normalizeRepairManifest({ version: 1, repairs: [repair] });
  assert.throws(
    () => buildRepairPreflight(manifest, queue, [{ ...canonical, sunze_machine_id: 'SUNZE-1298' }]),
    /target is not eligible/
  );
});

test('repair manifests stay bounded to six unique source and target identities', () => {
  const repairs = Array.from({ length: 7 }, (_, index) => ({
    ...repair,
    key: `candidate-${index}`,
    sourceMachineId: `100${index}`,
    targetReportingMachineId: `14763000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
  }));
  assert.throws(() => normalizeRepairManifest({ version: 1, repairs }), /between one and six/);
});
