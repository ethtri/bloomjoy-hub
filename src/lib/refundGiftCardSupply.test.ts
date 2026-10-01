/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { requireRefundGiftCardSupply, refundGiftCardSupplyStatus } from './refundGiftCardSupply.ts';

const pool = { id: 'synthetic-pool', provider: 'sunzee', currency: 'USD', faceValueCents: 1500,
  expiresAt: '2027-09-30T23:59:59Z', enabled: true, eligibleLocations: ['Bloomjoy Test Mall'],
  usableCount: 8, expiredCount: 2, minAvailable: 5, targetAvailable: 20, maxBatchSize: 10, configured: true,
  lastCheckAt: null, lastReason: 'healthy_stock', refillState: 'not_started' };

Deno.test('supply display discards codes, account identifiers, credentials and configuration', () => {
  assertEquals(requireRefundGiftCardSupply({ payloadRedacted: true, pools: [{ ...pool,
    code: 'PRIVATE-CODE', providerAccountId: 'PRIVATE-ACCOUNT', credential: 'PRIVATE-SECRET', providerConfig: { machine_ids: ['PRIVATE'] } }] }), [pool]);
  assertThrows(() => requireRefundGiftCardSupply({ payloadRedacted: false, pools: [pool] }));
  assertThrows(() => requireRefundGiftCardSupply({ payloadRedacted: true, pools: [{ ...pool, usableCount: -1 }] }));
});
Deno.test('supply status distinguishes setup, uncertain refill and available inventory', () => {
  assertEquals(refundGiftCardSupplyStatus({ ...pool, enabled: false }), 'Supply is being set up');
  assertEquals(refundGiftCardSupplyStatus({ ...pool, refillState: 'unknown' }), 'Replenishment result is being checked');
  assertEquals(refundGiftCardSupplyStatus({ ...pool, usableCount: 0 }), 'Waiting for automatic replenishment');
  assertEquals(refundGiftCardSupplyStatus(pool), 'Automatic replenishment is ready');
});
