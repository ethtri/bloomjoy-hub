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
