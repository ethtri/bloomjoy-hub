/// <reference lib="deno.ns" />

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';
import {
  getRefundSubmissionAttempt,
  readRefundSubmissionReceipt,
  storeRefundSubmissionReceipt,
} from './refundSubmissionRecovery.ts';

const input = {
  customerEmail: 'customer@example.invalid',
  issueSummary: '',
  incidentDate: '2026-09-10',
  incidentTime: '12:15',
  paymentMethod: 'card' as const,
};

Deno.test('an unchanged response-loss retry reuses its submission identity', () => {
  let id = 0;
  const createId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;
  const first = getRefundSubmissionAttempt(null, input, createId);
  const retry = getRefundSubmissionAttempt(first, { ...input }, createId);
  assertEquals(retry, first);

  const changedPurchase = getRefundSubmissionAttempt(
    retry,
    { ...input, incidentTime: '12:45' },
    createId,
  );
  assertNotEquals(changedPurchase.submissionId, first.submissionId);
});

Deno.test('the thank-you receipt survives refresh without accepting malformed storage', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const receipt = {
    publicReference: 'RF-SYNTHETIC',
    statusToken: 'a'.repeat(43),
    statusExpiresAt: '2099-01-01T00:00:00.000Z',
    paymentMethod: 'card' as const,
  };

  storeRefundSubmissionReceipt(storage, receipt);
  assertEquals(readRefundSubmissionReceipt(storage), receipt);

  values.set('bloomjoy-refund-submission-receipt', '{bad');
  assertEquals(readRefundSubmissionReceipt(storage), null);
});
