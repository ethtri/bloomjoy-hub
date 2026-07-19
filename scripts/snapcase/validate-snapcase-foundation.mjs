import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  KEXIAZHAN_API_BASE_URL,
  KexiazhanReadOnlyClient,
  assertNormalizedPayloadSafe,
  normalizeKexiazhanMachine,
  normalizeKexiazhanOrder,
  normalizeKexiazhanPayment,
  normalizeNayaxTransaction,
} from './kexiazhan-contract.mjs';

const fixtureUrl = new URL('./sample-provider-records.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const machine = normalizeKexiazhanMachine(fixture.machines[0]);
const order = normalizeKexiazhanOrder(fixture.orders[0], machine);
const payment = normalizeKexiazhanPayment(fixture.payments[0], machine);
const nayax = normalizeNayaxTransaction(fixture.nayaxTransactions[0]);

assert.equal(machine.sourceMachineType, 'phone_case_printer');
assert.equal(machine.sourceCurrencyCode, 'USD');
assert.equal(order.paymentAmountMinor, 2500);
assert.equal(order.paymentAt, '2026-07-18T18:01:00.000Z');
assert.equal(payment.normalizedPaymentMethod, 'credit');
assert.equal(payment.sourceOrderIds.length, 1);
assert.equal(nayax.authorizationAmountMinor, 2500);
assert.equal(nayax.currencyCode, 'USD');

for (const normalized of [machine, order, payment, nayax]) {
  const serialized = JSON.stringify(normalized).toLowerCase();
  assert.equal(serialized.includes('must never be copied'), false);
  assert.equal(serialized.includes('deliveryaddress'), false);
  assert.equal(serialized.includes('workimageurl'), false);
  assert.equal(serialized.includes('cardlast4'), false);
  assertNormalizedPayloadSafe(normalized);
}

const naiveOrder = normalizeKexiazhanOrder({
  orderNo: 'naive-demo',
  paymentTime: '2026-07-18 18:01:00',
});
assert.equal(naiveOrder.paymentAt, null, 'Naive provider timestamps must not be guessed');
assert.equal(naiveOrder.paymentTimeRaw, '2026-07-18 18:01:00');

assert.throws(
  () => assertNormalizedPayloadSafe({ customerEmail: 'not-allowed' }),
  /Forbidden sensitive field/,
);
assert.throws(
  () => new KexiazhanReadOnlyClient({ baseUrl: 'https://example.invalid/mer' }),
  /egress allowlist/,
);

const providerCalls = [];
const fetchImpl = async (url, options) => {
  providerCalls.push({ url: String(url), options });
  if (String(url).endsWith('/user/login')) {
    return new Response(JSON.stringify({
      code: 0,
      data: { token: 'transient-test-token' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    code: 0,
    data: { list: fixture.machines, total: 1 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const client = new KexiazhanReadOnlyClient({
  baseUrl: KEXIAZHAN_API_BASE_URL,
  fetchImpl,
});
await client.login({ username: 'fixture-user', password: 'fixture-password' });
const rows = await client.getAll('/v1/machines', {}, { pageSize: 10, delayMs: 0 });
assert.equal(rows.length, 1);
assert.equal(providerCalls[0].options.method, 'POST');
assert.equal(providerCalls[1].options.method, 'GET');
assert.equal(providerCalls[1].options.headers.Authorization, 'Bearer transient-test-token');
assert.equal(JSON.stringify(client).includes('transient-test-token'), false);
await assert.rejects(() => client.getPage('/v1/machine-actions'), /not allowlisted/);

const migration = await readFile(
  new URL('../../supabase/migrations/202607190001_snapcase_data_foundation.sql', import.meta.url),
  'utf8',
);
assert.match(migration, /machine_type in \('commercial', 'mini', 'micro', 'snapcase', 'unknown'\)/);
assert.match(migration, /enable row level security/g);
assert.match(migration, /salesPublicationEnabled', false/);
assert.doesNotMatch(
  migration,
  /machine_sales_facts[\s\S]{0,300}kexiazhan_api/,
  'Foundation migration must not enable Kexiazhan sales-fact publication',
);

const ingestFunction = await readFile(
  new URL('../../supabase/functions/snapcase-data-ingest/index.ts', import.meta.url),
  'utf8',
);
assert.match(ingestFunction, /requiredSha256\(order\.sourcePayloadHash/);
assert.match(ingestFunction, /pickRedactedPayload\(order\.redactedPayload/);
assert.match(ingestFunction, /pickRedactedPayload\(payment\.redactedPayload/);
assert.match(ingestFunction, /pickRedactedPayload\(transaction\.redactedPayload/);
assert.doesNotMatch(
  ingestFunction,
  /redacted_payload:\s*(order|payment|transaction)\.redactedPayload/,
  'Ingest must reconstruct redacted payloads from explicit field allowlists',
);

console.log('Snapcase foundation validation passed: redaction, read-only routes, normalization, hashes, and publication gate.');
