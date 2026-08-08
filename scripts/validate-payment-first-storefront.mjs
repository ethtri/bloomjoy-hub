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
assert.match(webhook, /unit_amount: number \| null/);
assert.doesNotMatch(webhook, /Math\.round\(primaryLineItem\.amount_total/);

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
assert.match(sticksCheckout, /stripe\.prices\.retrieve\(selectedSticksPriceId\)/);
assert.match(sticksCheckout, /selectedSticksPrice\.unit_amount !== expectedUnitPriceCents/);
assert.match(sticksCheckout, /unit_price_cents: String\(selectedSticksPrice\.unit_amount\)/);

const sugarCheckout = read('supabase/functions/stripe-sugar-checkout/index.ts');
assert.match(sugarCheckout, /MICRO_CHECKOUT_ENABLED/);
assert.match(sugarCheckout, /microMachineQuantity > 0 && !microCheckoutEnabled/);
assert.match(sugarCheckout, /checkout_source: "bloomjoy_storefront"/);
assert.match(sugarCheckout, /payment_method_types: \["card"\]/);

const plusCheckout = read('supabase/functions/stripe-plus-checkout/index.ts');
const plusBilling = read('supabase/functions/_shared/plus-billing.mjs');
const plusCheckoutAttempts = read('supabase/migrations/202608080001_plus_checkout_attempts.sql');
assert.match(plusCheckout, /checkout_source: "bloomjoy_storefront"/);
assert.match(plusCheckout, /payment_method_types: \["card"\]/);
assert.match(plusCheckout, /customer: customerId/);
assert.doesNotMatch(plusCheckout, /customer_email:/);
assert.match(plusCheckout, /stripe\.customers\.update\(customerId, \{/);
assert.match(plusCheckout, /email,/);
assert.match(plusCheckout, /PLUS_SUBSCRIPTION_EXISTS/);
assert.match(plusCheckout, /PLUS_BILLING_ACCOUNT_AMBIGUOUS/);
assert.match(plusCheckout, /PLUS_CHECKOUT_INCOMPLETE/);
assert.match(plusCheckout, /resolveStripePlusBillingState/);
assert.match(plusCheckout, /resolveReusablePlusCheckoutSession/);
assert.match(plusCheckout, /findReusableOpenPlusCheckoutSession/);
assert.match(plusCheckout, /claim_my_plus_checkout_attempt/);
assert.match(plusCheckout, /complete_my_plus_checkout_attempt/);
assert.match(plusCheckout, /mark_my_plus_checkout_provider_attempt/);
assert.match(plusCheckout, /preserve_my_plus_checkout_attempt_for_retry/);
assert.match(plusCheckout, /release_my_plus_checkout_attempt/);
assert.match(plusCheckout, /buildPlusCheckoutIdempotencyKey/);
assert.match(plusCheckout, /plusCheckoutFailureDisposition/);
assert.doesNotMatch(plusCheckout, /Math\.floor\(Date\.now\(\) \/ 60000\)/);
assert.match(plusBilling, /stripe\.customers\.search/);
assert.match(plusBilling, /stripe\.customers\.list\(\{ email, limit: 100 \}\)/);
assert.match(plusBilling, /stripe\.subscriptions\.retrieve\(subscriptionId\)/);
assert.match(plusBilling, /stripe\.subscriptions\.list/);
assert.match(plusBilling, /bloomjoy-plus-checkout:\$\{userId\}:\$\{attemptToken\}/);
assert.match(plusBilling, /ownershipConflict/);
assert.match(plusCheckoutAttempts, /create table if not exists public\.plus_checkout_attempts/);
assert.match(plusCheckoutAttempts, /force row level security/);
assert.match(plusCheckoutAttempts, /revoke all on table public\.plus_checkout_attempts/);
assert.match(plusCheckoutAttempts, /create or replace function public\.claim_my_plus_checkout_attempt/);
assert.match(plusCheckoutAttempts, /create or replace function public\.complete_my_plus_checkout_attempt/);
assert.match(plusCheckoutAttempts, /create or replace function public\.mark_my_plus_checkout_provider_attempt/);
assert.match(plusCheckoutAttempts, /create or replace function public\.preserve_my_plus_checkout_attempt_for_retry/);
assert.match(plusCheckoutAttempts, /create or replace function public\.release_my_plus_checkout_attempt/);

const customerPortal = read('supabase/functions/stripe-customer-portal/index.ts');
const commercePreflight = read('scripts/commerce-preflight.mjs');
assert.match(customerPortal, /resolveStripePlusBillingState/);
assert.match(customerPortal, /PLUS_BILLING_ACCOUNT_NOT_FOUND/);
assert.match(customerPortal, /PLUS_BILLING_ACCOUNT_AMBIGUOUS/);
assert.match(customerPortal, /PLUS_CHECKOUT_INCOMPLETE/);
assert.match(customerPortal, /PLUS_SUBSCRIPTION_ENDED/);
assert.match(customerPortal, /STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID/);
assert.match(customerPortal, /configuration: portalConfigurationId/);
assert.doesNotMatch(customerPortal, /stripe\.customers\.create/);
assert.match(commercePreflight, /STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID/);

const accountPage = read('src/pages/portal/Account.tsx');
assert.match(accountPage, /PLUS_SUBSCRIPTION_EXISTS/);
assert.match(accountPage, /Fix Billing/);
assert.match(accountPage, /Renew Plus/);
assert.match(accountPage, /Finish Plus Checkout/);
assert.match(accountPage, /Access through/);

const internalEmail = read('supabase/functions/_shared/internal-email.ts');
assert.match(internalEmail, /etrifari@bloomjoysweets\.com/);
assert.match(internalEmail, /ian@bloomjoysweets\.com/);

const localPaymentUat = read('scripts/commerce/local-payment-uat.mjs');
assert.match(localPaymentUat, /SAFE_CHILD_ENVIRONMENT_KEYS/);
assert.match(localPaymentUat, /STRIPE_API_KEY: stripeTestKey/);
assert.doesNotMatch(localPaymentUat, /"--api-key"/);
assert.doesNotMatch(localPaymentUat, /env: process\.env/);
assert.match(localPaymentUat, /"WECOM_CORP_ID="/);
assert.match(localPaymentUat, /idempotencyKeyPresent: Boolean\(idempotencyKey\)/);
assert.match(localPaymentUat, /await Promise\.all\(childProcesses\.map\(terminateProcessTree\)\)/);

console.log('Payment-first storefront validation passed.');
