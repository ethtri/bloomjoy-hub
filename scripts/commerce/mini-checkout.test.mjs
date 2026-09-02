import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import * as cart from '../../supabase/functions/_shared/storefront-cart.mjs';
import * as paid from '../../supabase/functions/_shared/paid-checkout.mjs';
import * as browserUrls from '../../supabase/functions/_shared/browser-url-allowlist.mjs';

// Execute the actual Edge handlers with external boundaries replaced by local
// adapters. No Stripe request, database write, or message leaves this process.
function loadHandler(relativePath, env, modules) {
  let handler;
  const source = readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const require = (name) => {
    if (name.includes('/http/server.ts')) return { serve: (value) => { handler = value; } };
    if (name.endsWith('/cors.ts')) return { corsHeaders: {} };
    if (name.endsWith('/auth.ts')) return { resolveForwardedSupabaseAccessToken: () => '' };
    if (name.endsWith('/browser-url-allowlist.mjs')) return browserUrls;
    if (name.endsWith('/storefront-cart.mjs')) return cart;
    if (name.endsWith('/paid-checkout.mjs')) return paid;
    if (name in modules) return modules[name];
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function('require', 'exports', 'Deno', 'console', code)(require, {}, {
    env: { get: (name) => env[name] },
  }, { error() {}, warn() {}, info() {} });
  return handler;
}

const env = {
  STRIPE_SECRET_KEY: 'local-fixture-only', STRIPE_WEBHOOK_SECRET: 'local-fixture-only',
  MINI_CHECKOUT_ENABLED: 'true', STRIPE_MINI_PRICE_ID: 'price_mini',
  STRIPE_MINI_SHIPPING_RATE_ID: 'shr_mini', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'local-fixture-only',
};
const stripeModule = 'https://esm.sh/stripe@12.18.0?target=deno';
const supabaseModule = 'https://esm.sh/@supabase/supabase-js@2.48.1';
const price = { active: true, type: 'one_time', currency: 'usd', unit_amount: 400000,
  tax_behavior: 'exclusive', product: { active: true, tax_code: 'reviewed-test-code' } };
const shipping = { active: true, type: 'fixed_amount', fixed_amount: { currency: 'usd', amount: 25000 },
  delivery_estimate: { minimum: { unit: 'business_day', value: 5 }, maximum: { unit: 'business_day', value: 10 } } };
const request = (items = [{ sku: 'mini', quantity: 1, price: 1 }]) => new Request('http://localhost/checkout', {
  method: 'POST', body: JSON.stringify({ items,
    successUrl: 'https://www.bloomjoyusa.com/cart?checkout=return&session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://www.bloomjoyusa.com/cart?checkout=cancel',
  }),
});

function checkout(overrides = {}, priceOverride = price, shippingOverride = shipping) {
  const created = [];
  class Stripe {
    prices = { retrieve: async () => priceOverride };
    shippingRates = { retrieve: async () => shippingOverride };
    checkout = { sessions: { create: async (params) => { created.push(params); return { url: 'https://checkout.stripe.com/local-fixture' }; } } };
  }
  const handler = loadHandler('supabase/functions/stripe-sugar-checkout/index.ts', { ...env, ...overrides }, {
    [stripeModule]: { default: Stripe }, [supabaseModule]: { createClient: () => { throw new Error('Guest checkout must not need a user'); } },
  });
  return { handler, created };
}

test('Mini uses the server price, one shipping rate, address collection and tax', async () => {
  const { handler, created } = checkout();
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(created[0].line_items, [{ price: 'price_mini', quantity: 1 }]);
  assert.deepEqual(created[0].shipping_options, [{ shipping_rate: 'shr_mini' }]);
  assert.deepEqual(created[0].shipping_address_collection.allowed_countries, ['US']);
  assert.equal(created[0].automatic_tax.enabled, true);
  assert.equal(created[0].phone_number_collection.enabled, true);
  assert.equal(created[0].metadata.order_type, 'mini_machine');
  assert.equal(created[0].metadata.mini_machine_quantity, '1');
  assert.equal(created[0].payment_method_types, undefined);
});

test('disabled or incomplete Mini config never creates a session', async () => {
  for (const overrides of [{ MINI_CHECKOUT_ENABLED: undefined }, { MINI_CHECKOUT_ENABLED: 'false' },
    { STRIPE_MINI_PRICE_ID: undefined }, { STRIPE_MINI_SHIPPING_RATE_ID: undefined }]) {
    const { handler, created } = checkout(overrides);
    assert.ok((await handler(request())).status >= 400);
    assert.equal(created.length, 0);
  }
});

test('incorrect price, archived products, inclusive tax or missing delivery estimate block payment', async () => {
  for (const override of [{ unit_amount: 399999 }, { currency: 'eur' }, { type: 'recurring' },
    { active: false }, { tax_behavior: 'inclusive' }, { product: { active: false, tax_code: 'code' } },
    { product: { active: true } }]) {
    const { handler, created } = checkout({}, { ...price, ...override });
    assert.equal((await handler(request())).status, 503);
    assert.equal(created.length, 0);
  }
  for (const override of [{ active: false }, { delivery_estimate: null }, { fixed_amount: { currency: 'eur' } }]) {
    const { handler, created } = checkout({}, price, { ...shipping, ...override });
    assert.equal((await handler(request())).status, 503);
    assert.equal(created.length, 0);
  }
});

test('multiple Minis, duplicate rows, mixed carts and invalid quantities cannot underpay shipping', async () => {
  const { handler, created } = checkout();
  for (const items of [
    [{ sku: 'mini', quantity: 2 }], [{ sku: 'mini', quantity: 1 }, { sku: 'mini', quantity: 1 }],
    [{ sku: 'mini', quantity: 1 }, { sku: 'sugar-blue-1kg', quantity: 4 }],
    [{ sku: 'mini', quantity: 1 }, { sku: 'micro', quantity: 1 }],
    [{ sku: 'mini', quantity: 0 }], [{ sku: 'mini', quantity: 1.5 }],
  ]) assert.equal((await handler(request(items))).status, 400);
  assert.equal(created.length, 0);
});

const paidSession = {
  id: 'cs_test_minifixture', mode: 'payment', payment_status: 'paid', status: 'complete', created: 1788357600,
  metadata: { checkout_source: 'bloomjoy_storefront', order_type: 'mini_machine', mini_machine_quantity: '99' },
  line_items: { has_more: false, data: [{ description: 'Bloomjoy Sweets Mini Machine', quantity: 1,
    amount_total: 440000, currency: 'usd', price: { id: 'price_mini', unit_amount: 400000 } }] },
  amount_total: 465000, currency: 'usd', total_details: { amount_shipping: 25000 },
  customer_details: { email: 'buyer@example.invalid', name: 'Fixture Buyer', phone: '+15555550100' },
  shipping_details: { name: 'Fixture Buyer', address: { line1: '100 Fixture Street', city: 'Test City', state: 'CA', postal_code: '90001', country: 'US' } },
};

test('status verifies a paid Mini and rejects wrong-price or wrong-quantity sessions', async () => {
  let session = structuredClone(paidSession);
  class Stripe { checkout = { sessions: { retrieve: async () => session } }; }
  const handler = loadHandler('supabase/functions/stripe-checkout-status/index.ts', env, { [stripeModule]: { default: Stripe } });
  const statusRequest = () => new Request('http://localhost/status', { method: 'POST', body: JSON.stringify({ sessionId: session.id }) });
  assert.deepEqual(await (await handler(statusRequest())).json(), { paymentStatus: 'paid', checkoutStatus: 'complete', orderType: 'mini_machine' });
  session.line_items.data[0].quantity = 2;
  assert.equal((await handler(statusRequest())).status, 404);
  session = structuredClone(paidSession);
  session.line_items.data[0].price.id = 'price_unrelated';
  assert.equal((await handler(statusRequest())).status, 404);
});

test('paid and delayed-payment Mini events persist one correct order and dispatch once on replay', async () => {
  const orders = new Map();
  const dispatches = new Set();
  const messages = [];
  const confirmations = [];
  const alerts = [];
  let currentSession = structuredClone(paidSession);
  const db = {
    schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
    from(table) {
      if (table === 'orders') return {
        upsert(payload) {
          orders.set(payload.stripe_checkout_session_id, { ...orders.get(payload.stripe_checkout_session_id), ...payload, id: 'order_fixture' });
          return { select: () => ({ single: async () => ({ data: orders.get(payload.stripe_checkout_session_id) }) }) };
        },
        update: (patch) => ({ eq: async () => { Object.assign(orders.get(currentSession.id), patch); return {}; } }),
      };
      if (table === 'internal_notification_dispatches') return {
        insert: async ({ event_key }) => {
          if (dispatches.has(event_key)) return { error: { code: '23505' } };
          dispatches.add(event_key); return {};
        }, update: () => ({ eq: async () => ({}) }),
      };
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  class Stripe {
    webhooks = { constructEventAsync: async (payload, signature) => { if (signature !== 'local-valid') throw new Error('invalid'); return JSON.parse(payload); } };
    checkout = { sessions: { retrieve: async () => currentSession } };
  }
  const handler = loadHandler('supabase/functions/stripe-webhook/index.ts', env, {
    [stripeModule]: { default: Stripe }, [supabaseModule]: { createClient: () => db },
    '../_shared/storefront-email.ts': { sendInternalEmail: async (m) => messages.push(m), sendTransactionalEmail: async (m) => confirmations.push(m) },
    '../_shared/wecom-alert.ts': { sendWeComAlertResult: async (m) => { alerts.push(m); return { ok: true }; } },
    '../_shared/customer-order-email.ts': { buildCustomerOrderEmail: (context) => { assert.equal(context.miniMachine.quantity, 1); return { subject: 'Mini', text: 'Fixture', html: '' }; } },
  });
  const send = (type, payment_status = 'paid', signature = 'local-valid') => handler(new Request('http://localhost/webhook', {
    method: 'POST', headers: { 'stripe-signature': signature }, body: JSON.stringify({ type, data: { object: { ...currentSession, payment_status } } }),
  }));
  assert.equal((await send('checkout.session.completed', 'paid', 'invalid')).status, 400);
  assert.equal((await send('checkout.session.completed', 'unpaid')).status, 200);
  assert.equal(orders.size, 0);
  assert.equal(messages.length + confirmations.length + alerts.length, 0);
  assert.equal((await send('checkout.session.async_payment_succeeded')).status, 200);
  assert.equal((await send('checkout.session.completed')).status, 200);
  assert.equal(orders.size, 1);
  const order = orders.get(currentSession.id);
  assert.equal(order.order_type, 'mini_machine');
  assert.equal(order.shipping_total_cents, 25000);
  assert.equal(order.amount_total, 465000);
  assert.equal(order.customer_email, 'buyer@example.invalid');
  assert.equal(order.shipping_address.state, 'CA');
  assert.equal(order.line_items[0].quantity, 1);
  assert.equal(messages.length, 1);
  assert.equal(confirmations.length, 1);
  assert.equal(alerts.length, 1);
  assert.match(messages[0].text, /Mini Machine Details:[\s\S]*Quantity: 1/);
  currentSession = { ...structuredClone(paidSession), id: 'cs_test_otherfixture' };
  currentSession.line_items.data[0].price.id = 'price_other';
  assert.equal((await send('checkout.session.completed')).status, 200);
  assert.equal(orders.size, 1);
});
