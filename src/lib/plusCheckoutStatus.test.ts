/// <reference lib="deno.ns" />
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { getPlusPaymentState } from './plusCheckoutStatus.ts';

Deno.test('Plus confirms only a paid subscription checkout', () => {
  assertEquals(getPlusPaymentState({ paymentStatus: 'paid', orderType: 'plus_subscription' }), 'confirmed');
  for (const paymentStatus of ['unpaid', 'no_payment_required', '', 'unknown']) {
    assertEquals(getPlusPaymentState({ paymentStatus, orderType: 'plus_subscription' }), 'pending');
  }
});

Deno.test('paid physical and unknown checkout categories are errors rather than pending Plus payments', () => {
  for (const orderType of ['sugar', 'mixed', 'micro_machine', 'blank_sticks', 'unknown', '']) {
    assertEquals(getPlusPaymentState({ paymentStatus: 'paid', orderType }), 'error');
  }
});
