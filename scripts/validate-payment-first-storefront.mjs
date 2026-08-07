#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStorefrontCart } from '../supabase/functions/_shared/storefront-cart.mjs';
import {
  buildOrderEmailIdempotencyKey,
  hasAllowedCheckoutPrices,
  hasExpectedPlusSubscriptionPrice,
  isBloomjoyCheckoutSession,
  isBloomjoyPlusSubscription,
  shouldFulfillCheckoutSession,
} from '../supabase/functions/_shared/paid-checkout.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

assert.deepEqual(
  normalizeStorefrontCart([{ sku: 'micro', quantity: 1, type: 'machine' }]),
  {
    ok: true,
    orderType: 'micro_machine',
    sugarBreakdown: { white: 0, blue: 0, orange: 0, red: 0 },
    totalSugarKg: 0,
    microMachineQuantity: 1,
  }
);

assert.equal(
  normalizeStorefrontCart([
    { sku: 'sugar-blue-1kg', quantity: 4, type: 'supply' },
    { sku: 'micro', quantity: 1, type: 'machine' },
  ]).orderType,
  'mixed'
);
assert.equal(normalizeStorefrontCart([{ sku: 'commercial-robotic', quantity: 1 }]).ok, false);
assert.equal(normalizeStorefrontCart([{ sku: 'micro', quantity: 0 }]).ok, false);

assert.equal(
  shouldFulfillCheckoutSession('checkout.session.completed', {
    mode: 'payment',
    payment_status: 'unpaid',
  }),
  false
);
assert.equal(
  shouldFulfillCheckoutSession('checkout.session.completed', {
    mode: 'payment',
    payment_status: 'paid',
  }),
  true
);
assert.equal(
  shouldFulfillCheckoutSession('checkout.session.async_payment_succeeded', {
    mode: 'payment',
    payment_status: 'paid',
  }),
  true
);
assert.equal(
  shouldFulfillCheckoutSession(
    'checkout.session.completed',
    { mode: 'subscription', payment_status: 'paid' },
    'subscription'
  ),
  true
);
assert.equal(
  shouldFulfillCheckoutSession('checkout.session.async_payment_failed', {
    mode: 'payment',
    payment_status: 'unpaid',
  }),
  false
);
assert.equal(
  isBloomjoyCheckoutSession({
    mode: 'payment',
    metadata: { checkout_source: 'bloomjoy_storefront', order_type: 'sugar' },
  }),
  true
);
assert.equal(
  isBloomjoyCheckoutSession({
    mode: 'payment',
    metadata: { order_type: 'sugar' },
  }),
  false
);
assert.equal(
  isBloomjoyCheckoutSession(
    {
      mode: 'subscription',
      metadata: { checkout_source: 'bloomjoy_storefront', order_type: 'plus_subscription' },
    },
    'subscription'
  ),
  true
);
assert.equal(
  isBloomjoyCheckoutSession(
    {
      mode: 'subscription',
      metadata: { checkout_source: 'bloomjoy_storefront', order_type: 'unrelated_subscription' },
    },
    'subscription'
  ),
  false
);
assert.equal(
  isBloomjoyPlusSubscription(
    {
      metadata: { checkout_source: 'bloomjoy_storefront', order_type: 'plus_subscription' },
      items: { data: [{ price: { id: 'price_plus' } }] },
    },
    'price_plus'
  ),
  true
);
assert.equal(
  isBloomjoyPlusSubscription(
    {
      metadata: { checkout_source: 'bloomjoy_storefront', order_type: 'plus_subscription' },
      items: { data: [{ price: { id: 'price_unrelated' } }] },
    },
    'price_plus'
  ),
  false
);
const checkoutPriceConfig = {
  sugarPriceIds: ['price_sugar_member', 'price_sugar_standard'],
  sticksPriceIds: ['price_sticks_member', 'price_sticks_standard'],
  microMachinePriceId: 'price_micro',
  plusPriceId: 'price_plus',
};
assert.equal(
  hasAllowedCheckoutPrices(
    {
      metadata: { order_type: 'sugar' },
      line_items: { data: [{ price: { id: 'price_sugar_standard' } }] },
    },
    checkoutPriceConfig
  ),
  true
);
assert.equal(
  hasAllowedCheckoutPrices(
    {
      metadata: { order_type: 'sugar' },
      line_items: { data: [{ price: { id: 'price_unrelated' } }] },
    },
    checkoutPriceConfig
  ),
  false
);
assert.equal(
  hasExpectedPlusSubscriptionPrice(
    { items: { data: [{ price: { id: 'price_plus' } }] } },
    'price_plus'
  ),
  true
);
assert.equal(
  isBloomjoyPlusSubscription(
    {
      metadata: { order_type: 'plus_subscription' },
      items: { data: [{ price: { id: 'price_plus' } }] },
    },
    'price_plus'
  ),
  false
);

const concurrentInternalKeys = Array.from({ length: 25 }, () =>
  buildOrderEmailIdempotencyKey('internal', 'cs_paid_fixture')
);
const concurrentCustomerKeys = Array.from({ length: 25 }, () =>
  buildOrderEmailIdempotencyKey('customer', 'cs_paid_fixture')
);
assert.equal(new Set(concurrentInternalKeys).size, 1);
assert.equal(new Set(concurrentCustomerKeys).size, 1);
assert.notEqual(concurrentInternalKeys[0], concurrentCustomerKeys[0]);

const suppliesPage = read('src/pages/Supplies.tsx');
assert.match(suppliesPage, /onClick=\{handleStartBlankCheckout\}/);
assert.doesNotMatch(suppliesPage, /Submit Bloomjoy Branded Stick Request/);
assert.doesNotMatch(suppliesPage, /Submit Custom Stick Request/);

const commercialPage = read('src/pages/products/CommercialRobotic.tsx');
assert.match(commercialPage, /Request a Quote/);

const microPage = read('src/pages/products/Micro.tsx');
assert.match(microPage, /Buy Micro Machine/);
assert.match(microPage, /Checkout Pending/);
assert.match(microPage, /disabled=\{!isMicroCheckoutEnabled\}/);

const commerceAvailability = read('src/lib/commerceAvailability.ts');
assert.match(commerceAvailability, /VITE_MICRO_CHECKOUT_ENABLED === 'true'/);

const cartPage = read('src/pages/Cart.tsx');
assert.match(cartPage, /hasUnavailableMicro/);
assert.match(cartPage, /Micro checkout is pending a shipping decision/);

const miniPage = read('src/pages/products/Mini.tsx');
assert.match(miniPage, /Coming Soon/);

const webhook = read('supabase/functions/stripe-webhook/index.ts');
assert.match(webhook, /shouldFulfillCheckoutSession/);
assert.match(webhook, /isBloomjoyCheckoutSession/);
assert.match(webhook, /hasAllowedCheckoutPrices/);
assert.match(webhook, /checkout\.session\.async_payment_succeeded/);
assert.match(webhook, /claimDispatch/);
assert.match(webhook, /Promise\.allSettled/);
assert.match(webhook, /plus_subscription_activated/);

const checkoutClient = read('src/lib/stripeCheckout.ts');
assert.match(checkoutClient, /\{CHECKOUT_SESSION_ID\}/);
assert.match(checkoutClient, /stripe-checkout-status/);

const checkoutStatus = read('supabase/functions/stripe-checkout-status/index.ts');
assert.match(checkoutStatus, /hasAllowedCheckoutPrices/);
assert.match(checkoutStatus, /expand: \["line_items"\]/);

const sticksCheckout = read('supabase/functions/stripe-sticks-checkout/index.ts');
assert.match(sticksCheckout, /maxBoxesPerCheckout = 1000/);
assert.match(sticksCheckout, /boxCount > maxBoxesPerCheckout/);
assert.match(sticksCheckout, /checkout_source: "bloomjoy_storefront"/);
assert.match(sticksCheckout, /payment_method_types: \["card"\]/);

const sugarCheckout = read('supabase/functions/stripe-sugar-checkout/index.ts');
assert.match(sugarCheckout, /MICRO_CHECKOUT_ENABLED/);
assert.match(sugarCheckout, /microMachineQuantity > 0 && !microCheckoutEnabled/);
assert.match(sugarCheckout, /checkout_source: "bloomjoy_storefront"/);
assert.match(sugarCheckout, /payment_method_types: \["card"\]/);

const plusCheckout = read('supabase/functions/stripe-plus-checkout/index.ts');
assert.match(plusCheckout, /checkout_source: "bloomjoy_storefront"/);
assert.match(plusCheckout, /payment_method_types: \["card"\]/);

const internalEmail = read('supabase/functions/_shared/internal-email.ts');
assert.match(internalEmail, /etrifari@bloomjoysweets\.com/);
assert.match(internalEmail, /ian@bloomjoysweets\.com/);

console.log('Payment-first storefront validation passed.');
