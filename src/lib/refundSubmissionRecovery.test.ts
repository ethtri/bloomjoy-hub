/// <reference lib="deno.ns" />

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';
import {
  prepareRefundSubmissionAttempt,
  readRefundSubmissionReceipt,
  resolveRefundThankYouContext,
  storeRefundSubmissionReceipt,
} from './refundSubmissionRecovery.ts';

const input = {
  customerEmail: 'customer@example.invalid',
  issueSummary: '',
  incidentDate: '2026-09-10',
  incidentTime: '12:15',
  paymentMethod: 'card' as const,
};

Deno.test('an unchanged response-loss retry reuses its submission identity', async () => {
  let id = 0;
  const createId = () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;
  const first = await prepareRefundSubmissionAttempt({ current: null, input, storage: null, createId });
  const retry = await prepareRefundSubmissionAttempt({
    current: first.attempt,
    input: { ...input },
    storage: null,
    createId,
  });
  assertEquals(retry.attempt, first.attempt);

  const changedPurchase = await prepareRefundSubmissionAttempt({
    current: retry.attempt,
    input: { ...input, incidentTime: '12:45' },
    storage: null,
    createId,
  });
  assertNotEquals(changedPurchase.attempt.submissionId, first.attempt.submissionId);
});

Deno.test('a refresh restores the opaque identity using only a non-PII fingerprint', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const createId = () => '00000000-0000-4000-8000-000000000001';
  const first = await prepareRefundSubmissionAttempt({ current: null, input, storage, createId });
  const reloaded = await prepareRefundSubmissionAttempt({
    current: null,
    input: { paymentMethod: 'card', incidentTime: '12:15', ...input },
    storage,
    createId: () => '00000000-0000-4000-8000-000000000002',
  });

  assertEquals(first.persisted, true);
  assertEquals(reloaded.attempt.submissionId, first.attempt.submissionId);
  const persisted = values.get('bloomjoy-refund-submission-attempt') ?? '';
  assertEquals(persisted.includes('customer@example.invalid'), false);
  assertEquals(persisted.includes('12:15'), false);
});

Deno.test('throwing session storage never crashes or claims durable recovery', async () => {
  const storage = {
    getItem: (_key: string): string | null => { throw new Error('blocked'); },
    setItem: (_key: string, _value: string): void => { throw new Error('blocked'); },
    removeItem: (_key: string): void => { throw new Error('blocked'); },
  };
  const prepared = await prepareRefundSubmissionAttempt({
    current: null,
    input,
    storage,
    createId: () => '00000000-0000-4000-8000-000000000001',
  });
  assertEquals(prepared.persisted, false);
  assertEquals(storeRefundSubmissionReceipt(storage, {
    publicReference: 'RF-SYNTHETIC',
    statusToken: null,
    statusExpiresAt: null,
  }), false);
  assertEquals(readRefundSubmissionReceipt(storage), null);
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

Deno.test('explicit navigation and URL context take precedence over a stale saved receipt', () => {
  const savedReceipt = {
    publicReference: 'RF-STALE',
    statusToken: 's'.repeat(43),
    statusExpiresAt: '2099-01-01T00:00:00.000Z',
    paymentMethod: 'cash' as const,
  };
  assertEquals(resolveRefundThankYouContext({
    navigationState: { reference: 'RF-CURRENT', statusToken: null, paymentMethod: 'card' },
    hasQueryReference: false,
    queryReference: null,
    savedReceipt,
  }), { reference: 'RF-CURRENT', statusToken: null, paymentMethod: 'card' });
  assertEquals(resolveRefundThankYouContext({
    navigationState: null,
    hasQueryReference: true,
    queryReference: 'RF-URL',
    savedReceipt,
  }), { reference: 'RF-URL', statusToken: null, paymentMethod: undefined });
  assertEquals(resolveRefundThankYouContext({
    navigationState: null,
    hasQueryReference: false,
    queryReference: null,
    savedReceipt,
  }), { reference: 'RF-STALE', statusToken: 's'.repeat(43), paymentMethod: 'cash' });
});
