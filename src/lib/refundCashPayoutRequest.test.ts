/// <reference lib="deno.ns" />
import { assertEquals } from 'jsr:@std/assert@1';
import { canRequestDistinctCashPayoutDestination } from './refundCashPayoutRequest.ts';

const availableLedger = {
  state: 'not_started' as const,
  canRequest: true,
  payloadRedacted: true as const,
};

Deno.test('an unrelated delivery-unknown record does not suppress one distinct payout request', () => {
  assertEquals(canRequestDistinctCashPayoutDestination({
    paymentMethod: 'cash',
    zellePaymentContact: null,
    payoutDestinationRequest: availableLedger,
    customerCorrection: null,
  }), true);
});

Deno.test('an active amount or payout correction keeps the existing one-request guard', () => {
  for (const requestedFields of [['amount'], ['zelle_payment_contact']]) {
    assertEquals(canRequestDistinctCashPayoutDestination({
      paymentMethod: 'cash',
      zellePaymentContact: null,
      payoutDestinationRequest: availableLedger,
      customerCorrection: { isActive: true, requestedFields },
    }), false);
  }
});

Deno.test('a saved payout ledger never allows another request', () => {
  assertEquals(canRequestDistinctCashPayoutDestination({
    paymentMethod: 'cash',
    zellePaymentContact: null,
    payoutDestinationRequest: {
      state: 'waiting',
      canRequest: false,
      payloadRedacted: true,
    },
    customerCorrection: null,
  }), false);
});
