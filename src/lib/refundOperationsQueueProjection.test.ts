/// <reference lib="deno.ns" />

import {
  assertEquals,
  assertStrictEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  localizeRefundManagerQueueProjection,
  REFUND_MANAGER_QUEUE_CONTRACT_VERSION,
  REFUND_MANAGER_QUEUE_PROJECTION_WARNING,
} from './refundManagerWork.ts';

const validProjection = {
  schemaVersion: 'refund_manager_work_v1',
  observedAt: '2026-09-19T18:00:00.000Z',
  bucketCounts: {
    needs_action: 0,
    ready_to_pay: 0,
    in_progress: 0,
    provider_hold: 0,
    waiting_on_customer: 0,
    completed: 0,
  },
  digestCounts: {
    needsDecision: 0,
    newInformation: 0,
    aging: 0,
    exceptionsBeingHandled: 0,
  },
  oldestActionableAgeMinutes: null,
  recentMaterialChangeCount: 0,
  items: [],
  metrics: {
    emailsSentToday: 0,
    digestEligibleCount: 0,
    duplicatesSuppressedToday: 0,
    oldestActionableAgeMinutes: null,
    oldestDecisionAgeMinutes: null,
    payloadRedacted: true,
  },
  payloadRedacted: true,
};

Deno.test('valid embedded manager queue projection remains available', () => {
  const cases = [{ id: 'case-1', canPerformOfficialAction: true }];
  const result = localizeRefundManagerQueueProjection({
    cases,
    managerQueueContractVersion: REFUND_MANAGER_QUEUE_CONTRACT_VERSION,
    managerWork: validProjection,
  });

  assertStrictEquals(result.cases, cases);
  assertEquals(result.cases[0].canPerformOfficialAction, true);
  assertEquals(result.managerQueueContractVersion, REFUND_MANAGER_QUEUE_CONTRACT_VERSION);
  assertEquals(result.managerWork?.items, []);
  assertEquals(result.managerQueueProjectionWarning, null);
});

Deno.test('manager queue contract skew is localized to a null projection and warning', () => {
  const cases = [{ id: 'case-1', canPerformOfficialAction: true }];
  const result = localizeRefundManagerQueueProjection({
    cases,
    managerQueueContractVersion: 'refund_manager_queue_v3',
    managerWork: validProjection,
  });

  assertStrictEquals(result.cases, cases);
  assertEquals(result.cases[0].canPerformOfficialAction, true);
  assertEquals(result.managerQueueContractVersion, undefined);
  assertEquals(result.managerWork, null);
  assertEquals(result.managerQueueProjectionWarning, REFUND_MANAGER_QUEUE_PROJECTION_WARNING);
});

Deno.test('malformed manager queue payload is localized to a null projection and warning', () => {
  const cases = [{ id: 'case-1', canPerformOfficialAction: false }];
  const result = localizeRefundManagerQueueProjection({
    cases,
    managerQueueContractVersion: REFUND_MANAGER_QUEUE_CONTRACT_VERSION,
    managerWork: {
      ...validProjection,
      payloadRedacted: false,
    },
  });

  assertStrictEquals(result.cases, cases);
  assertEquals(result.cases[0].canPerformOfficialAction, false);
  assertEquals(result.managerQueueContractVersion, REFUND_MANAGER_QUEUE_CONTRACT_VERSION);
  assertEquals(result.managerWork, null);
  assertEquals(result.managerQueueProjectionWarning, REFUND_MANAGER_QUEUE_PROJECTION_WARNING);
});
