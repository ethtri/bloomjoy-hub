/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { requireRefundGiftCardOffer, requireRefundGiftCardStatus, giftCardStatusCopy } from './refundGiftCard.ts';

const offer = { pool_id: 'synthetic-pool', value: 1500, currency: 'USD', eligible_locations: ['Bloomjoy Test Mall'],
  expires_at: '2027-09-30T23:59:59Z', one_use: true, redemption_instructions: 'Enter the code on the machine’s gift card screen.' };
const card = { state: 'issued', value: 1500, currency: 'USD', eligible_locations: ['Bloomjoy Test Mall'],
  expires_at: offer.expires_at, issued_at: '2026-09-30T12:00:00Z', delivery_state: 'sent' };

Deno.test('offers require all actual terms before customer acceptance and discard private fields', () => {
  assertEquals(requireRefundGiftCardOffer({ ...offer, code: 'PRIVATE', prior_issued_count: 2 }), offer);
  for (const invalid of [{ value: 15.1 }, { eligible_locations: [] }, { expires_at: '' }, { one_use: false }, { redemption_instructions: '' }]) {
    assertThrows(() => requireRefundGiftCardOffer({ ...offer, ...invalid }));
  }
});
Deno.test('public status never retains codes or prior issuance history', () => {
  assertEquals(requireRefundGiftCardStatus({ ...card, code: 'PRIVATE', previous_issuance: { customerEmail: 'private' } }), card);
  assertEquals(requireRefundGiftCardStatus(null), null);
  assertThrows(() => requireRefundGiftCardStatus({ ...card, state: 'paid_cash' }));
});
Deno.test('transport acceptance, inbox delivery, and delivery recovery stay distinct', () => {
  const status = requireRefundGiftCardStatus(card)!;
  assertEquals(giftCardStatusCopy(status).next.includes('have sent'), true);
  assertEquals(giftCardStatusCopy({ ...status, delivery_state: 'delivered' }).next.includes('was delivered'), true);
  for (const delivery_state of ['pending', 'failed', 'bounced', 'delivery_unknown', 'delivery_unconfirmed', 'unknown']) {
    assertEquals(giftCardStatusCopy({ ...status, delivery_state }).next.includes('was delivered'), false);
    assertEquals(giftCardStatusCopy({ ...status, delivery_state }).next.includes('same request again'), false);
  }
  assertEquals(giftCardStatusCopy({ ...status, delivery_state: 'unknown' }).next.includes('needs attention'), true);
  for (const state of ['pending_inventory', 'manager_review'] as const) {
    assertEquals(giftCardStatusCopy({ ...status, state }).next.includes('submit again'), state === 'manager_review');
    assertEquals(giftCardStatusCopy({ ...status, state }).detail.includes('saved'), true);
  }
});

Deno.test('partial SQL projection crosses existing public parser and status copy using approved gift value', () => {
  // Same fields asserted against actual SQL projection in refund_exception_amounts.sql.
  const projection = { ...card, state: 'issued', purchase_amount: 3000, affected_amount: 1000,
    value: 1000, goodwill_amount: 0, currency: 'USD', eligible_locations: ['Exceptions venue'] };
  const parsed = requireRefundGiftCardStatus(projection)!;
  assertEquals(parsed.value, 1000);
  assertEquals(parsed.eligible_locations, ['Exceptions venue']);
  assertEquals(giftCardStatusCopy(parsed).detail, 'Your $10.00 Bloomjoy gift card is ready.');
  assertEquals('purchase_amount' in parsed, false);
  assertEquals(giftCardStatusCopy(parsed).detail.includes('$30'), false);
});
