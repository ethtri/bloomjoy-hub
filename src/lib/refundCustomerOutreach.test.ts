/// <reference lib="deno.ns" />

import {
  canRequestRefundCustomerDetailsManually,
  getRefundCustomerOutreachPresentation,
} from './refundCustomerOutreach.ts';
import type { RefundCustomerOutreachContract } from './refundLifecycle.ts';

const base: RefundCustomerOutreachContract = {
  schemaVersion: 'refund_customer_outreach_v1',
  state: 'manual_fallback',
  owner: 'Machine Manager',
  nextAction: 'request_details',
  manualFallbackEligible: true,
  requestedFields: ['incident_time'],
  requestMessageId: null,
  cycleId: '10000000-0000-4000-8000-000000000001',
  cycleNumber: 1,
  caseFactVersion: 2,
  clarificationAttemptCount: 1,
  clarificationLimit: 2,
  requestCreatedAt: '2026-09-10T18:00:00.000Z',
  requestSentAt: null,
  deliveryState: null,
  deliveryStateUpdatedAt: null,
  replyReceivedAt: null,
  recheckStartedAt: null,
  reasonCode: 'automatic_handoff_unavailable',
  failureCode: null,
  payloadRedacted: true,
};

Deno.test('manual customer request requires the complete explicit server fallback contract', () => {
  if (!canRequestRefundCustomerDetailsManually(base)) throw new Error('exact fallback should be eligible');
  for (const outreach of [
    { ...base, state: 'preparing' as const },
    { ...base, owner: 'System' as const },
    { ...base, nextAction: 'wait_for_queue' as const },
    { ...base, manualFallbackEligible: false },
    { ...base, requestedFields: [] },
    undefined,
  ]) {
    if (canRequestRefundCustomerDetailsManually(outreach)) {
      throw new Error('partial or absent fallback contract must stay ineligible');
    }
  }
});

Deno.test('queued and unconfirmed outreach never claims delivery', () => {
  const queued = getRefundCustomerOutreachPresentation({
    ...base,
    state: 'queued',
    owner: 'System',
    nextAction: 'wait_for_delivery',
    manualFallbackEligible: false,
  });
  const unconfirmed = getRefundCustomerOutreachPresentation({
    ...base,
    state: 'sent_unconfirmed',
    owner: 'System',
    nextAction: 'wait_for_delivery',
    manualFallbackEligible: false,
  });
  if (!queued.explanation.includes('not been confirmed as delivered')) {
    throw new Error('queued copy must distinguish queueing from delivery');
  }
  if (!unconfirmed.explanation.includes('not confirmed')) {
    throw new Error('unconfirmed copy must distinguish provider send from delivery');
  }
});

Deno.test('failure category stays private unless the server grants operations detail', () => {
  const failed = { ...base, state: 'delivery_failed' as const, failureCode: 'recipient_route_invalid' };
  const ordinary = getRefundCustomerOutreachPresentation(failed);
  const operations = getRefundCustomerOutreachPresentation(failed, { canViewOperationsDetail: true });
  if (ordinary.operationsDetail !== null) throw new Error('ordinary detail must be redacted');
  if (operations.operationsDetail !== 'Internal category: recipient route invalid') {
    throw new Error('operations should receive only the safe category');
  }
});

