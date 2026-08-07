#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStorefrontCart } from '../supabase/functions/_shared/storefront-cart.mjs';
import {
  buildOrderEmailIdempotencyKey,
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
assert.match(webhook, /checkout\.session\.async_payment_succeeded/);
assert.match(webhook, /claimDispatch/);
assert.match(webhook, /Promise\.allSettled/);
assert.match(webhook, /plus_subscription_activated/);

const checkoutClient = read('src/lib/stripeCheckout.ts');
assert.match(checkoutClient, /\{CHECKOUT_SESSION_ID\}/);
assert.match(checkoutClient, /stripe-checkout-status/);

const sticksCheckout = read('supabase/functions/stripe-sticks-checkout/index.ts');
assert.match(sticksCheckout, /maxBoxesPerCheckout = 1000/);
assert.match(sticksCheckout, /boxCount > maxBoxesPerCheckout/);

const internalEmail = read('supabase/functions/_shared/internal-email.ts');
assert.match(internalEmail, /etrifari@bloomjoysweets\.com/);
assert.match(internalEmail, /ian@bloomjoysweets\.com/);

console.log('Payment-first storefront validation passed.');
