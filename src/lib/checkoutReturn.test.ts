/// <reference lib="deno.ns" />
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { claimPaidCartReturn, isVerifiedPaidCheckout, readCheckoutReturn, rememberCheckoutCart } from './checkoutReturn.ts';

Deno.test('only paid recognized physical checkout responses can confirm the cart', () => {
  for (const orderType of ['sugar', 'micro_machine', 'mixed']) {
    assertEquals(isVerifiedPaidCheckout({ paymentStatus: 'paid', orderType }, 'cart'), true);
    for (const paymentStatus of ['unpaid', 'no_payment_required', 'return', 'success', '']) {
      assertEquals(isVerifiedPaidCheckout({ paymentStatus, orderType }, 'cart'), false);
    }
  }
  for (const orderType of ['unknown', 'plus', 'blank_sticks', '']) {
    assertEquals(isVerifiedPaidCheckout({ paymentStatus: 'paid', orderType }, 'cart'), false);
  }
});

Deno.test('sticks confirmation cannot accept another checkout category', () => {
  assertEquals(isVerifiedPaidCheckout({ paymentStatus: 'paid', orderType: 'blank_sticks' }, 'sticks'), true);
  assertEquals(isVerifiedPaidCheckout({ paymentStatus: 'unpaid', orderType: 'blank_sticks' }, 'sticks'), false);
  assertEquals(isVerifiedPaidCheckout({ paymentStatus: 'paid', orderType: 'sugar' }, 'sticks'), false);
});

Deno.test('a repeated verified return cannot clear a newer cart in the same browser', () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  const cart = [{ sku: 'sugar-white-1kg', quantity: 20, type: 'supply' }];
  assertEquals(rememberCheckoutCart('https://checkout.stripe.com/c/pay/cs_test_first#synthetic', cart, storage), true);
  storage.setItem('bloomjoy-cart', JSON.stringify({ state: { items: cart }, version: 2 }));
  assertEquals(claimPaidCartReturn('cs_test_first', cart, storage), 'clear');
  assertEquals(claimPaidCartReturn('cs_test_first', [{ ...cart[0], quantity: 30 }], storage), 'already-handled');
  assertEquals(claimPaidCartReturn('cs_test_other', cart, storage), 'retain');
});

Deno.test('first paid return retains a cart edited after checkout or missing its exact snapshot', () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  const cart = [{ sku: 'sugar-white-1kg', quantity: 20, type: 'supply' }];
  rememberCheckoutCart('https://checkout.stripe.com/c/pay/cs_test_changed', cart, storage);
  assertEquals(claimPaidCartReturn('cs_test_changed', [{ ...cart[0], quantity: 30 }], storage), 'retain');
  rememberCheckoutCart('https://checkout.stripe.com/c/pay/cs_test_added', cart, storage);
  assertEquals(claimPaidCartReturn('cs_test_added', [...cart, { sku: 'sugar-blue-1kg', quantity: 5, type: 'supply' }], storage), 'retain');
  assertEquals(claimPaidCartReturn('cs_test_unassociated', cart, storage), 'retain');
  assertEquals(rememberCheckoutCart('https://example.com/c/pay/cs_test_other', cart, storage), false);
});

Deno.test('a newer persisted cart in another tab is preserved even when in-memory items are stale', () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
  const cart = [{ sku: 'sugar-white-1kg', quantity: 20, type: 'supply' }];
  rememberCheckoutCart('https://checkout.stripe.com/c/pay/cs_test_otherTab', cart, storage);
  const newerCart = JSON.stringify({ state: { items: [{ ...cart[0], quantity: 25 }] }, version: 2 });
  storage.setItem('bloomjoy-cart', newerCart);
  assertEquals(claimPaidCartReturn('cs_test_otherTab', cart, storage), 'retain');
  assertEquals(storage.getItem('bloomjoy-cart'), newerCart);
  rememberCheckoutCart('https://checkout.stripe.com/c/pay/cs_test_malformed', cart, storage);
  storage.setItem('bloomjoy-cart', 'invalid');
  assertEquals(claimPaidCartReturn('cs_test_malformed', cart, storage), 'retain');
});

Deno.test('success-like query values and incomplete returns cannot confirm payment', async () => {
  let requests = 0;
  const server = () => { requests++; return Promise.resolve({ paymentStatus: 'paid', orderType: 'sugar' }); };
  assertEquals(await readCheckoutReturn('success', 'synthetic-session', 'cart', server), { status: 'error' });
  assertEquals(await readCheckoutReturn('paid', 'synthetic-session', 'cart', server), { status: 'error' });
  assertEquals(await readCheckoutReturn('return', null, 'cart', server), { status: 'error' });
  assertEquals(await readCheckoutReturn('cancel', 'synthetic-session', 'cart', server), { status: 'canceled' });
  assertEquals(await readCheckoutReturn(null, null, 'cart', server), { status: 'none' });
  assertEquals(requests, 0);
});

Deno.test('every return re-verifies with the server, including refresh and failed reads', async () => {
  const requested: string[] = [];
  const server = (id: string) => { requested.push(id); return Promise.resolve({ paymentStatus: 'paid', orderType: 'sugar' }); };
  assertEquals(await readCheckoutReturn('return', 'synthetic-session', 'cart', server), { status: 'paid', orderType: 'sugar' });
  assertEquals(await readCheckoutReturn('return', 'synthetic-session', 'cart', server), { status: 'paid', orderType: 'sugar' });
  assertEquals(requested, ['synthetic-session', 'synthetic-session']);
  assertEquals(await readCheckoutReturn('return', 'synthetic-session', 'cart', () => Promise.reject(new Error('network'))), { status: 'error' });
  assertEquals(await readCheckoutReturn('return', 'synthetic-session', 'cart', () => Promise.resolve({ paymentStatus: 'unpaid', orderType: 'sugar' })), { status: 'pending' });
  assertEquals(await readCheckoutReturn('return', 'synthetic-session', 'cart', () => Promise.resolve({ paymentStatus: 'paid', orderType: 'blank_sticks' })), { status: 'error' });
});
