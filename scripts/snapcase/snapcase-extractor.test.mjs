import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  normalizeMachine,
  normalizeOrder,
  normalizePayment,
} from './kexiazhan-contract.mjs';
import {
  KEXIAOZHAN_API_BASE_URL,
  KexiazhanReadOnlyClient,
} from './kexiazhan-client.mjs';
import { buildIngestBatches, extractSnapcaseWindow, monthlyWindows } from './extract-snapcase.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/provider-records.json', import.meta.url)));
const context = {
  sourceAccountKey: 'synthetic-account',
  secret: 'synthetic-test-secret-only',
  keyVersion: 1,
  machineTimezone: 'America/Los_Angeles',
  machineCurrency: 'USD',
};

const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

const success = (list, total = list.length) => ({ code: 0, data: { list, total } });

const authenticatedClient = async (fetchImpl, options = {}) => {
  const client = new KexiazhanReadOnlyClient({
    fetchImpl,
    sleep: async () => {},
    random: () => 0,
    ...options,
  });
  await client.login({ username: 'fixture-user', password: 'fixture-password' });
  return client;
};

test('normalization keeps machine inventory id distinct from the sales query machineId', () => {
  const machine = normalizeMachine(fixture.machines[0]);
  assert.equal(machine.sourceInventoryId, 'inventory-row-17');
  assert.equal(machine.sourceMachineId, 'machine-filter-key-901');
  assert.notEqual(machine.sourceInventoryId, machine.sourceMachineId);
  assert.equal(machine.sourceTimezone, 'America/Los_Angeles');
  assert.equal(machine.sourceCurrency, 'USD');
  assert.equal(JSON.stringify(machine).includes('must-be-dropped'), false);
});

test('normalization applies confirmed machine-local time, USD minor units, and known statuses', () => {
  const order = normalizeOrder(fixture.orders[0], context);
  const payment = normalizePayment(fixture.payments[0], context);
  assert.equal(order.normalizedTender, 'unknown');
  assert.equal(order.sourceStatus, 'complete');
  assert.equal(order.sourcePaymentStatus, 'success');
  assert.equal(order.sourceTenderCode, '7');
  assert.equal(order.sourceTenderLabel, 'Cash-like label requiring review');
  assert.equal(order.amountMinor, 1234);
  assert.equal(order.sourceAmountText, '12.34');
  assert.equal(order.occurredAt, '2026-09-20T17:00:00.000Z');
  assert.equal(Object.hasOwn(order, 'settledTimeRaw'), false);
  assert.equal(order.sourceCurrency, 'USD');
  assert.equal(order.currencyCode, 'USD');
  assert.equal(order.exceptionCodes.includes('source_time_semantics_unverified'), false);
  assert.equal(payment.occurredAt, '2026-09-20T17:00:00.000Z');
  assert.equal(payment.sourceStatus, 'success');
  assert.equal(payment.sourceTenderCode, '9');
  assert.equal(payment.sourceTenderLabel, 'Card-like label requiring review');
  assert.equal(payment.sourceCurrency, 'USD');
  assert.equal(payment.currencyCode, 'USD');
  assert.equal(payment.exceptionCodes.includes('currency_unverified'), false);
  assert.equal(payment.relatedOrderKeys.length, 1);
  assert.match(payment.relatedOrderKeys[0], /^[a-f0-9]{64}$/);
  assert.match(payment.sourceTransactionKey, /^[a-f0-9]{64}$/);
  assert.equal(payment.amountMinor, 1234);
  assert.match(payment.sourceKey, /^[a-f0-9]{64}$/);
  assert.equal(payment.keyVersion, 1);
  assert.equal(JSON.stringify({ order, payment }).includes('customerEmail'), false);
  assert.equal(JSON.stringify({ order, payment }).includes('cardLast4'), false);
  assert.equal(JSON.stringify({ order, payment }).includes('synthetic-order-1'), false);
  assert.equal(JSON.stringify({ order, payment }).includes('synthetic-payment-1'), false);
  assert.ok(payment.exceptionCodes.includes('financial_tender_semantics_unverified'));
});

test('proved Kexiaozhan cash normalizes without product or quantity requirements', () => {
  const payment = normalizePayment({
    outTradeNo: 'cash-payment',
    orderNos: ['cash-order'],
    machineId: 'machine-filter-key-901',
    paymentTime: '2026-11-02 10:15:30',
    paymentMethod: 1,
    paymentInstrument: 'cash',
    status: 1,
    paymentAmount: '10.05',
    currency: 'USD',
  }, context);
  assert.equal(payment.normalizedTender, 'cash');
  assert.equal(payment.amountMinor, 1005);
  assert.equal(payment.occurredAt, '2026-11-02T18:15:30.000Z');
  assert.equal(payment.quantity, null);
  assert.equal(payment.productLabel, null);
  assert.deepEqual(payment.exceptionCodes, ['financial_status_semantics_unverified']);
});

test('known free-coupon payment context is retained without classifying face value as cash or card', () => {
  // The provider enum names method 4 free_coupon. This synthetic contract test
  // does not claim that a live split-payment/redemption shape was observed.
  const payment = normalizePayment({
    outTradeNo: 'synthetic-coupon-payment', orderNos: ['synthetic-coupon-order'],
    machineId: 'machine-filter-key-901', paymentTime: '2026-11-02 10:15:30',
    paymentMethod: 4, paymentInstrument: 'free_coupon', status: 1,
    paymentAmount: '15.00', currency: 'USD',
  }, context);
  assert.equal(payment.normalizedTender, 'other');
  assert.equal(payment.sourceTenderCode, '4');
  assert.equal(payment.sourceTenderLabel, 'free_coupon');
  assert.equal(payment.amountMinor, 1500);
});

test('machine inventory USD fills an omitted or blank row currency but never overrides a conflict', () => {
  const base = {
    outTradeNo: 'currency-payment', machineId: 'machine-filter-key-901',
    paymentTime: '2026-11-02 10:15:30', paymentMethod: 1,
    paymentInstrument: 'cash', status: 1, paymentAmount: '10.05',
  };
  const inherited = normalizePayment(base, context);
  const inheritedFromBlank = normalizePayment({ ...base, outTradeNo: 'currency-blank', currency: '  ' }, context);
  const conflicting = normalizePayment({ ...base, outTradeNo: 'currency-conflict', currency: 'EUR' }, context);
  assert.equal(inherited.sourceCurrency, 'USD');
  assert.equal(inherited.currencyCode, 'USD');
  assert.equal(inherited.exceptionCodes.includes('currency_unverified'), false);
  assert.equal(inheritedFromBlank.sourceCurrency, 'USD');
  assert.equal(inheritedFromBlank.currencyCode, 'USD');
  assert.equal(inheritedFromBlank.exceptionCodes.includes('currency_unverified'), false);
  assert.equal(conflicting.sourceCurrency, 'EUR');
  assert.equal(conflicting.currencyCode, null);
  assert.ok(conflicting.exceptionCodes.includes('currency_unverified'));
});

test('only exact configured AUD or A$ cash payments use the owner-confirmed USD interpretation', () => {
  const base = {
    outTradeNo: 'valley-aud-cash', machineId: 'machine-filter-key-901',
    paymentTime: '2025-09-18 10:15:30', paymentMethod: 1,
    paymentInstrument: 'cash', status: 1, paymentAmount: '10.05', currency: 'AUD',
  };
  const unlisted = normalizePayment(base, context);
  const listed = normalizePayment(base, {
    ...context,
    usdInterpretationPaymentSourceKeys: new Set([unlisted.sourceKey]),
  });
  const aDollar = normalizePayment({ ...base, outTradeNo: 'valley-a-dollar', currency: 'A$' }, context);
  const listedADollar = normalizePayment({ ...base, outTradeNo: 'valley-a-dollar', currency: 'A$' }, {
    ...context,
    usdInterpretationPaymentSourceKeys: new Set([aDollar.sourceKey]),
  });
  const eur = normalizePayment({ ...base, outTradeNo: 'listed-eur', currency: 'EUR' }, context);
  const listedEur = normalizePayment({ ...base, outTradeNo: 'listed-eur', currency: 'EUR' }, {
    ...context,
    usdInterpretationPaymentSourceKeys: new Set([eur.sourceKey]),
  });
  const missingRowCurrency = normalizePayment({
    ...base, outTradeNo: 'listed-missing-row-currency', currency: undefined,
  }, { ...context, machineCurrency: 'AUD' });
  const listedMissingRowCurrency = normalizePayment({
    ...base, outTradeNo: 'listed-missing-row-currency', currency: undefined,
  }, {
    ...context,
    machineCurrency: 'AUD',
    usdInterpretationPaymentSourceKeys: new Set([missingRowCurrency.sourceKey]),
  });
  const card = normalizePayment({
    ...base, outTradeNo: 'listed-card', paymentMethod: 0, paymentInstrument: 'credit card',
  }, context);
  const listedCard = normalizePayment({
    ...base, outTradeNo: 'listed-card', paymentMethod: 0, paymentInstrument: 'credit card',
  }, {
    ...context,
    usdInterpretationPaymentSourceKeys: new Set([card.sourceKey]),
  });

  assert.equal(unlisted.sourceCurrency, 'AUD');
  assert.equal(unlisted.currencyCode, null);
  assert.ok(unlisted.exceptionCodes.includes('currency_unverified'));
  assert.equal(listed.sourceCurrency, 'AUD');
  assert.equal(listed.currencyCode, 'USD');
  assert.equal(listed.exceptionCodes.includes('currency_unverified'), false);
  assert.equal(listed.sourceKey, unlisted.sourceKey);
  assert.notEqual(listed.revisionDigest, unlisted.revisionDigest);
  assert.equal(listedADollar.sourceCurrency, 'A$');
  assert.equal(listedADollar.currencyCode, 'USD');
  assert.equal(listedEur.currencyCode, null);
  assert.ok(listedEur.exceptionCodes.includes('currency_unverified'));
  assert.equal(listedMissingRowCurrency.sourceCurrency, 'AUD');
  assert.equal(listedMissingRowCurrency.currencyCode, null);
  assert.ok(listedMissingRowCurrency.exceptionCodes.includes('currency_unverified'));
  assert.equal(listedCard.normalizedTender, 'card');
  assert.equal(listedCard.currencyCode, null);
  assert.ok(listedCard.exceptionCodes.includes('currency_unverified'));
});

test('exact USD interpretation reaches the ingest envelope while retaining raw provider currency', async () => {
  const paymentRecord = {
    outTradeNo: 'valley-envelope-cash', orderNos: ['valley-envelope-order'],
    machineId: 'machine-filter-key-901', paymentTime: '2025-10-08 10:15:30',
    paymentMethod: 1, paymentInstrument: 'cash', status: 1,
    paymentAmount: '12.00', currency: 'AUD',
  };
  const paymentSourceKey = normalizePayment(paymentRecord, context).sourceKey;
  const fakeClient = {
    async getAll(path) {
      const rows = path === '/v1/machines'
        ? fixture.machines
        : path === '/v1/payments'
          ? [paymentRecord]
          : [];
      return {
        rows,
        evidence: {
          status: 'complete', pageCount: 1, observedCount: rows.length,
          expectedTotal: rows.length, effectivePageSize: rows.length || 50,
          nextCursor: null, responseTruncated: false,
        },
      };
    },
  };
  const extraction = await extractSnapcaseWindow({
    client: fakeClient,
    sourceAccountKey: context.sourceAccountKey,
    hmacSecret: context.secret,
    startDate: '2025-10-01',
    endDate: '2025-10-31',
    usdInterpretationPaymentSourceKeys: new Set([paymentSourceKey]),
  });
  const batches = buildIngestBatches(extraction, { runNonce: 'valley-envelope-run' });
  const emitted = batches.flatMap((batch) => batch.payments);

  assert.equal(extraction.usdInterpretedPaymentCount, 1);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].normalizedTender, 'cash');
  assert.equal(emitted[0].sourceCurrency, 'AUD');
  assert.equal(emitted[0].currencyCode, 'USD');
  assert.equal(emitted[0].exceptionCodes.includes('currency_unverified'), false);
  assert.equal(Object.hasOwn(extraction, 'usdInterpretationPaymentSourceKeys'), false);
  assert.equal(batches.some((batch) => Object.hasOwn(batch, 'usdInterpretationPaymentSourceKeys')), false);
});

test('only an exact configured method-17 webhook payment becomes nonfinancial', () => {
  const webhookRecord = {
    outTradeNo: 'verified-test-payment',
    orderNos: ['verified-test-order'],
    machineId: 'machine-filter-key-901',
    transactionId: 'verified-test-transaction',
    paymentTime: '2026-07-16 10:00:00',
    paymentMethod: 17,
    paymentInstrument: 'webhook',
    status: 1,
    paymentAmount: '30.00',
    currency: 'USD',
  };
  const unlisted = normalizePayment(webhookRecord, context);
  const listed = normalizePayment(webhookRecord, {
    ...context,
    nonfinancialTestPaymentSourceKeys: new Set([unlisted.sourceKey]),
  });
  const cash = normalizePayment({
    ...webhookRecord,
    outTradeNo: 'ordinary-cash',
    paymentMethod: 1,
    paymentInstrument: 'cash',
  }, context);
  const listedCash = normalizePayment({
    ...webhookRecord,
    outTradeNo: 'ordinary-cash',
    paymentMethod: 1,
    paymentInstrument: 'cash',
  }, {
    ...context,
    nonfinancialTestPaymentSourceKeys: new Set([cash.sourceKey]),
  });

  assert.equal(unlisted.normalizedTender, 'unknown');
  assert.equal(listed.normalizedTender, 'other');
  assert.equal(listed.sourceKey, unlisted.sourceKey);
  assert.notEqual(listed.revisionDigest, unlisted.revisionDigest);
  assert.equal(normalizePayment(webhookRecord, {
    ...context,
    nonfinancialTestPaymentSourceKeys: new Set([unlisted.sourceKey]),
  }).revisionDigest, listed.revisionDigest);
  assert.equal(listed.sourceTenderCode, '17');
  assert.equal(listed.sourceTenderLabel, 'webhook');
  assert.ok(listed.exceptionCodes.includes('financial_tender_semantics_unverified'));
  assert.equal(listedCash.normalizedTender, 'cash');
  assert.equal(listedCash.sourceKey, cash.sourceKey);
  assert.equal(listedCash.revisionDigest, cash.revisionDigest);
});

test('exact test-payment configuration reaches the private ingest envelope without exposing config', async () => {
  const webhookRecord = {
    outTradeNo: 'verified-envelope-payment',
    orderNos: ['verified-envelope-order'],
    machineId: 'machine-filter-key-901',
    transactionId: 'verified-envelope-transaction',
    paymentTime: '2026-07-16 10:00:00',
    paymentMethod: 17,
    paymentInstrument: 'webhook',
    status: 1,
    paymentAmount: '30.00',
    currency: 'USD',
  };
  const sourceKey = normalizePayment(webhookRecord, context).sourceKey;
  const fakeClient = {
    async getAll(path) {
      const rows = path === '/v1/machines'
        ? fixture.machines
        : path === '/v1/payments'
          ? [webhookRecord]
          : [];
      return {
        rows,
        evidence: {
          status: 'complete', pageCount: 1, observedCount: rows.length,
          expectedTotal: rows.length, effectivePageSize: rows.length || 50,
          nextCursor: null, responseTruncated: false,
        },
      };
    },
  };
  const extraction = await extractSnapcaseWindow({
    client: fakeClient,
    sourceAccountKey: context.sourceAccountKey,
    hmacSecret: context.secret,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    nonfinancialTestPaymentSourceKeys: new Set([sourceKey]),
  });
  const batches = buildIngestBatches(extraction, { runNonce: 'verified-envelope-run' });
  const emitted = batches.flatMap((batch) => batch.payments);

  assert.equal(extraction.nonfinancialTestPaymentCount, 1);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].normalizedTender, 'other');
  assert.equal(emitted[0].sourceTenderCode, '17');
  assert.equal(emitted[0].sourceTenderLabel, 'webhook');
  assert.ok(emitted[0].exceptionCodes.includes('financial_tender_semantics_unverified'));
  assert.equal(Object.hasOwn(extraction, 'nonfinancialTestPaymentSourceKeys'), false);
  assert.equal(batches.some((batch) => Object.hasOwn(batch, 'nonfinancialTestPaymentSourceKeys')), false);
});

test('machine-local normalization keeps DST gaps and folds on their local business date', () => {
  const gap = normalizePayment({
    outTradeNo: 'gap-payment', machineId: 'machine-filter-key-901',
    paymentTime: '2026-03-08 02:30:00', paymentMethod: 1,
    paymentInstrument: 'cash', status: 1, paymentAmount: '1.00', currency: 'USD',
  }, context);
  const fold = normalizePayment({
    outTradeNo: 'fold-payment', machineId: 'machine-filter-key-901',
    paymentTime: '2026-11-01 01:30:00', paymentMethod: 1,
    paymentInstrument: 'cash', status: 1, paymentAmount: '1.00', currency: 'USD',
  }, context);
  assert.match(gap.occurredAt, /^2026-03-08T/);
  assert.match(fold.occurredAt, /^2026-11-01T/);
  assert.equal(gap.exceptionCodes.includes('source_time_semantics_unverified'), false);
  assert.equal(fold.exceptionCodes.includes('source_time_semantics_unverified'), false);
});

test('invalid machine-local dates remain scoped normalization exceptions', () => {
  const invalid = normalizePayment({
    outTradeNo: 'invalid-date-payment', machineId: 'machine-filter-key-901',
    paymentTime: '2026-02-30 10:00:00', paymentMethod: 1,
    paymentInstrument: 'cash', status: 1, paymentAmount: '1.00', currency: 'USD',
  }, context);
  assert.equal(invalid.occurredAt, null);
  assert.ok(invalid.exceptionCodes.includes('source_time_semantics_unverified'));
});

test('normalized records match the locked private-ingest allowlist exactly', () => {
  const machine = normalizeMachine(fixture.machines[0]);
  const order = normalizeOrder(fixture.orders[0], context);
  const payment = normalizePayment(fixture.payments[0], context);
  assert.deepEqual(Object.keys(machine).sort(), [
    'revisionDigest', 'sourceCurrency', 'sourceInventoryId', 'sourceLabel',
    'sourceMachineId', 'sourceMerchantId', 'sourceMerchantName', 'sourceStatus',
    'sourceTimezone',
  ]);
  const eventKeys = [
    'amountMinor', 'currencyCode', 'exceptionCodes', 'keyVersion', 'normalizedTender',
    'occurredAt', 'occurredTimeRaw', 'productLabel', 'quantity', 'refundAmountMinor',
    'revisionDigest', 'sourceAmountText', 'sourceCurrency', 'sourceKey',
    'sourceMachineId', 'sourceMerchantId', 'sourceRefundAmountText', 'sourceStatus',
    'sourceTenderCode', 'sourceTenderLabel',
  ];
  assert.deepEqual(Object.keys(order).sort(), [...eventKeys, 'sourcePaymentStatus'].sort());
  assert.deepEqual(Object.keys(payment).sort(), [
    ...eventKeys,
    'relatedOrderKeys',
    'sourceTransactionKey',
  ].sort());
});

test('stable identifiers are rejected instead of truncated before hashing', () => {
  const sharedPrefix = 'x'.repeat(200);
  assert.throws(
    () => normalizeOrder({ orderNo: `${sharedPrefix}a`, machineId: 'machine-a' }, context),
    /identifier_too_long.*orderNo/,
  );
  assert.throws(
    () => normalizeMachine({ id: { nested: true }, machineId: 'machine-a' }),
    /invalid_identifier_type.*id/,
  );
  assert.throws(
    () => normalizePayment({
      outTradeNo: 'payment-a',
      machineId: 'machine-a',
      orderNos: [`${sharedPrefix}a`],
    }, context),
    /identifier_too_long.*orderNos/,
  );
  assert.throws(
    () => normalizePayment({
      outTradeNo: 'payment-a',
      machineId: 'machine-a',
      transactionId: `${sharedPrefix}b`,
    }, context),
    /identifier_too_long.*transactionId/,
  );
});

test('client permits only login POST and allowlisted GET endpoints', async () => {
  const calls = [];
  const client = await authenticatedClient(async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body, redirect: options.redirect });
    if (String(url).endsWith('/user/login')) return response({ code: 0, data: { token: 'fixture-token' } });
    return response(success([], 0));
  });
  await client.getAll('/v1/machines');
  await assert.rejects(() => client.getPage('/v1/machine/control'), /not allowlisted/);
  await assert.rejects(() => client.getPage('/v1/orders', { password: 'nope' }), /query field is not allowlisted/);
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET']);
  assert.ok(calls.every((call) => call.redirect === 'error'));
  assert.equal(calls[0].url, `${KEXIAOZHAN_API_BASE_URL}/user/login`);
  assert.equal(JSON.stringify(client).includes('fixture-token'), false);
  assert.throws(() => new KexiazhanReadOnlyClient({ baseUrl: 'https://example.invalid' }), /not allowlisted/);
});

test('pagination follows the observed 50-row cap and proves an exact stable count', async () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({ orderNo: `order-${index}` }));
  const client = await authenticatedClient(async (url) => {
    if (String(url).endsWith('/user/login')) return response({ code: 0, data: { token: 'fixture-token' } });
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get('page'));
    return response(success(rows.slice((page - 1) * 50, page * 50), 120));
  });
  const result = await client.getAll('/v1/orders', {}, { pageSize: 50 });
  assert.equal(result.rows.length, 120);
  assert.deepEqual(result.evidence, {
    status: 'complete',
    pageCount: 3,
    observedCount: 120,
    nextCursor: null,
    responseTruncated: false,
    expectedTotal: 120,
    effectivePageSize: 50,
  });
  await assert.rejects(() => client.getAll('/v1/orders', {}, { pageSize: 51 }), /cap of 50/);
});

test('pagination rejects premature empty pages, count drift, and repeated page records', async (t) => {
  await t.test('premature empty', async () => {
    const client = await authenticatedClient(async (url) => {
      if (String(url).endsWith('/user/login')) return response({ code: 0, data: { token: 't' } });
      const page = Number(new URL(url).searchParams.get('page'));
      return response(success(page === 1 ? [{ orderNo: 'one' }] : [], 2));
    });
    await assert.rejects(() => client.getAll('/v1/orders', {}, { pageSize: 1 }), { code: 'premature_empty_page' });
  });
  await t.test('count drift', async () => {
    const client = await authenticatedClient(async (url) => {
      if (String(url).endsWith('/user/login')) return response({ code: 0, data: { token: 't' } });
      const page = Number(new URL(url).searchParams.get('page'));
      return response(success([{ orderNo: `order-${page}` }], page === 1 ? 2 : 3));
    });
    await assert.rejects(() => client.getAll('/v1/orders', {}, { pageSize: 1 }), { code: 'count_drift' });
  });
  await t.test('repeated row', async () => {
    const client = await authenticatedClient(async (url) => {
      if (String(url).endsWith('/user/login')) return response({ code: 0, data: { token: 't' } });
      return response(success([{ orderNo: 'same' }], 2));
    });
    await assert.rejects(() => client.getAll('/v1/orders', {}, { pageSize: 1 }), { code: 'duplicate_page_record' });
  });
});

test('client honors Retry-After and refreshes a rejected bearer token once', async () => {
  const delays = [];
  let loginCount = 0;
  let readCount = 0;
  const client = await authenticatedClient(async (url) => {
    if (String(url).endsWith('/user/login')) {
      loginCount += 1;
      return response({ code: 0, data: { token: `fixture-token-${loginCount}` } });
    }
    readCount += 1;
    if (readCount === 1) return response({}, 429, { 'retry-after': '2' });
    if (readCount === 2) return response({}, 401);
    return response(success([], 0));
  }, { sleep: async (milliseconds) => delays.push(milliseconds) });
  const result = await client.getAll('/v1/machines');
  assert.equal(result.evidence.status, 'complete');
  assert.deepEqual(delays, [2_000]);
  assert.equal(loginCount, 2);
  assert.equal(readCount, 3);
});

test('client turns an aborted request into a bounded timeout error', async () => {
  let calls = 0;
  const client = new KexiazhanReadOnlyClient({
    maxAttempts: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ code: 0, data: { token: 'fixture-token' } });
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    },
  });
  await client.login({ username: 'fixture-user', password: 'fixture-password' });
  await assert.rejects(() => client.getAll('/v1/machines'), { code: 'timeout' });
});

test('client blocks redirects and bounds JSON body reads', async () => {
  const redirects = [];
  let calls = 0;
  const client = new KexiazhanReadOnlyClient({
    timeoutMs: 5,
    maxAttempts: 1,
    fetchImpl: async (_url, options) => {
      redirects.push(options.redirect);
      calls += 1;
      if (calls === 1) return response({ code: 0, data: { token: 'fixture-token' } });
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        }),
      };
    },
  });
  await client.login({ username: 'fixture-user', password: 'fixture-password' });
  await assert.rejects(() => client.getAll('/v1/machines'), { code: 'timeout' });
  assert.deepEqual(redirects, ['error', 'error']);
});

test('client fails closed instead of shortening a long Retry-After', async () => {
  const delays = [];
  const client = await authenticatedClient(async (url) => {
    if (String(url).endsWith('/user/login')) return response({ code: 0, data: { token: 'fixture-token' } });
    return response({}, 429, { 'retry-after': '60' });
  }, { maxDelayMs: 10_000, sleep: async (milliseconds) => delays.push(milliseconds) });
  await assert.rejects(() => client.getAll('/v1/machines'), { code: 'retry_after_exceeds_limit' });
  assert.deepEqual(delays, []);
});

test('concurrent 401 responses share one token refresh and retry at the attempt boundary', async () => {
  let loginCount = 0;
  let releaseRefresh;
  const refreshGate = new Promise((resolve) => { releaseRefresh = resolve; });
  const client = await authenticatedClient(async (url, options) => {
    if (String(url).endsWith('/user/login')) {
      loginCount += 1;
      if (loginCount === 2) await refreshGate;
      return response({ code: 0, data: { token: `fixture-token-${loginCount}` } });
    }
    if (options.headers.Authorization === 'Bearer fixture-token-1') return response({}, 401);
    return response(success([], 0));
  }, { maxAttempts: 1 });
  const first = client.getAll('/v1/orders', { machineId: 'machine-a' });
  const second = client.getAll('/v1/payments', { machineId: 'machine-a' });
  await new Promise((resolve) => setImmediate(resolve));
  releaseRefresh();
  await Promise.all([first, second]);
  assert.equal(loginCount, 2);
});

test('per-machine extraction rejects rows returned for another machine', async () => {
  const client = await authenticatedClient(async (url) => {
    if (String(url).endsWith('/user/login')) return response({ code: 0, data: { token: 'fixture-token' } });
    return response(success([{ orderNo: 'order-1', machineId: 'wrong-machine' }], 1));
  });
  await assert.rejects(
    () => client.getAll('/v1/orders', { machineId: 'expected-machine' }),
    { code: 'machine_filter_mismatch' },
  );
});

test('window extraction discovers every machine and queries sales with machineId', async () => {
  const queries = [];
  const fakeClient = {
    async getAll(path, query) {
      queries.push({ path, query });
      if (path === '/v1/machines') return { rows: fixture.machines, evidence: { status: 'complete', pageCount: 1, observedCount: 1, expectedTotal: 1, effectivePageSize: 1, nextCursor: null, responseTruncated: false } };
      if (path === '/v1/orders') return { rows: fixture.orders, evidence: { status: 'complete', pageCount: 1, observedCount: 1, expectedTotal: 1, effectivePageSize: 1, nextCursor: null, responseTruncated: false } };
      return { rows: fixture.payments, evidence: { status: 'complete', pageCount: 1, observedCount: 1, expectedTotal: 1, effectivePageSize: 1, nextCursor: null, responseTruncated: false } };
    },
  };
  const result = await extractSnapcaseWindow({
    client: fakeClient,
    sourceAccountKey: 'synthetic-account',
    hmacSecret: 'synthetic-test-secret-only',
    startDate: '2026-09-01',
    endDate: '2026-09-26',
    requestedTimezone: 'America/Los_Angeles',
  });
  assert.equal(result.machines.length, 1);
  assert.equal(result.orders.length, 1);
  assert.equal(result.payments.length, 1);
  assert.equal(queries[1].query.machineId, 'machine-filter-key-901');
  assert.equal(queries[2].query.machineId, 'machine-filter-key-901');
  assert.notEqual(queries[1].query.machineId, 'inventory-row-17');
  assert.equal(queries[1].query.paymentTimeEnd, '2026-09-27 00:00:00');
  assert.equal(queries[2].query.paymentTimeEnd, '2026-09-27 00:00:00');
  assert.equal(result.evidence[1].extraction.expectedTotal, 1);
  assert.equal(result.evidence[1].extraction.effectivePageSize, 1);
  assert.equal(result.evidence[2].query.requestedStart, '2026-09-01T07:00:00.000Z');
  assert.equal(result.evidence[2].query.requestedEnd, '2026-09-27T07:00:00.000Z');
  assert.equal(result.evidence[2].query.requestedTimezone, 'America/Los_Angeles');
  for (const item of result.evidence) {
    assert.equal(item.extraction.status, 'complete');
    assert.equal(item.businessCoverageStatus, 'unverified');
    assert.equal(item.coverageReasonCode, 'source_time_semantics_unverified');
  }
});

test('optional order fetch failure does not cancel complete payment extraction', async () => {
  const fakeClient = {
    async getAll(path) {
      if (path === '/v1/machines') return {
        rows: fixture.machines,
        evidence: { status: 'complete', pageCount: 1, observedCount: 1, expectedTotal: 1, effectivePageSize: 1, nextCursor: null, responseTruncated: false },
      };
      if (path === '/v1/orders') throw new Error('optional order endpoint unavailable');
      return {
        rows: [{
          ...fixture.payments[0],
          paymentMethod: 1,
          paymentInstrument: 'cash',
          paymentTime: '2026-09-20 10:00:00',
        }],
        evidence: { status: 'complete', pageCount: 1, observedCount: 1, expectedTotal: 1, effectivePageSize: 1, nextCursor: null, responseTruncated: false },
      };
    },
  };
  const result = await extractSnapcaseWindow({
    client: fakeClient,
    sourceAccountKey: 'synthetic-account',
    hmacSecret: 'synthetic-test-secret-only',
    startDate: '2026-09-20',
    endDate: '2026-09-20',
  });
  assert.equal(result.orders.length, 0);
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].normalizedTender, 'cash');
  assert.equal(result.evidence[1].extraction.status, 'failed');
  assert.equal(result.evidence[2].extraction.status, 'complete');
});

test('exclusive provider end includes the final second and excludes next midnight', async () => {
  const boundaryRows = [
    { orderNo: 'last-second', outTradeNo: 'last-second-payment', machineId: 'boundary-machine', paymentTime: '2026-09-26 23:59:59' },
    { orderNo: 'next-midnight', outTradeNo: 'next-midnight-payment', machineId: 'boundary-machine', paymentTime: '2026-09-27 00:00:00' },
  ];
  const fakeClient = {
    async getAll(path, query) {
      const rows = path === '/v1/machines'
        ? [{ id: 'boundary-inventory', machineId: 'boundary-machine' }]
        : boundaryRows.filter((row) =>
          row.paymentTime >= query.paymentTimeStart && row.paymentTime < query.paymentTimeEnd);
      return {
        rows,
        evidence: {
          status: 'complete', pageCount: 1, observedCount: rows.length,
          expectedTotal: rows.length, effectivePageSize: 50,
          nextCursor: null, responseTruncated: false,
        },
      };
    },
  };
  const result = await extractSnapcaseWindow({
    client: fakeClient,
    sourceAccountKey: 'synthetic-account',
    hmacSecret: 'synthetic-test-secret-only',
    startDate: '2026-09-26',
    endDate: '2026-09-26',
  });
  assert.equal(result.orders.length, 1);
  assert.equal(result.payments.length, 1);
  assert.equal(result.orders[0].occurredTimeRaw, '2026-09-26 23:59:59');
});

test('a rejected observation prevents complete extraction evidence', async () => {
  const fakeClient = {
    async getAll(path) {
      if (path === '/v1/machines') return { rows: fixture.machines, evidence: { status: 'complete', pageCount: 1, observedCount: 1, expectedTotal: 1, effectivePageSize: 1, nextCursor: null, responseTruncated: false } };
      return { rows: [{}], evidence: { status: 'complete', pageCount: 1, observedCount: 1, expectedTotal: 1, effectivePageSize: 1, nextCursor: null, responseTruncated: false } };
    },
  };
  const result = await extractSnapcaseWindow({
    client: fakeClient,
    sourceAccountKey: 'synthetic-account',
    hmacSecret: 'synthetic-test-secret-only',
    startDate: '2026-09-01',
    endDate: '2026-09-26',
  });
  assert.equal(result.orders.length, 0);
  assert.equal(result.payments.length, 0);
  assert.equal(result.evidence[1].extraction.status, 'partial');
  assert.equal(result.evidence[2].extraction.status, 'partial');
});

test('historical work is split into bounded calendar-month windows', () => {
  assert.deepEqual(monthlyWindows('2025-01-15', '2025-03-02'), [
    { start: '2025-01-15', end: '2025-01-31' },
    { start: '2025-02-01', end: '2025-02-28' },
    { start: '2025-03-01', end: '2025-03-02' },
  ]);
});

test('a single extraction window cannot exceed 35 days', async () => {
  await assert.rejects(() => extractSnapcaseWindow({
    client: {},
    sourceAccountKey: 'synthetic-account',
    hmacSecret: 'synthetic-test-secret-only',
    startDate: '2025-01-01',
    endDate: '2025-02-05',
  }), /must not exceed 35 days/);
});

test('ingest envelopes are bounded and defer completion evidence to the final batch', () => {
  const records = Array.from({ length: 51 }, (_, index) => ({ revisionDigest: String(index) }));
  const batches = buildIngestBatches({
    contractVersion: 'snapcase.ingest.v1',
    sourceAccountKey: 'synthetic-account',
    machines: records,
    orders: records,
    payments: records,
    evidence: [{
      resource: 'machines',
      sourceMachineId: null,
      query: { requestedStart: '2026-09-01', requestedEnd: '2026-09-26', requestedTimezone: null },
      extraction: { status: 'complete', pageCount: 1, nextCursor: null, responseTruncated: false, observedCount: 51, expectedTotal: 51, effectivePageSize: 50, rejectedCount: 0, maxObservedTimeRaw: null, maxObservedAt: null },
      businessCoverageStatus: 'unverified',
      coverageReasonCode: 'source_time_semantics_unverified',
    }],
  }, { runNonce: 'synthetic-run-1' });
  assert.equal(batches.length, 3);
  assert.equal(batches[0].machines.length, 50);
  assert.equal(batches[0].orders.length, 50);
  assert.equal(batches[0].payments.length, 50);
  assert.deepEqual(batches[0].evidence, []);
  assert.equal(batches[1].machines.length, 1);
  assert.deepEqual(batches[1].evidence, []);
  assert.deepEqual(batches[2].machines, []);
  assert.equal(batches[2].evidence.length, 1);
  assert.match(batches[0].runKey, /^[a-f0-9]{64}$/);
  assert.match(batches[0].batchKey, /^[a-f0-9]{64}$/);
  assert.match(batches[0].batchDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(batches[0]).sort(), [
    'batchDigest', 'batchKey', 'contractVersion', 'evidence', 'machines',
    'orders', 'payments', 'runKey', 'sourceAccountKey',
  ]);
  assert.deepEqual(Object.keys(batches[2].evidence[0]).sort(), [
    'businessCoverageStatus', 'coverageReasonCode', 'extraction', 'query',
    'resource', 'sourceMachineId',
  ]);
  assert.deepEqual(Object.keys(batches[2].evidence[0].extraction).sort(), [
    'effectivePageSize', 'expectedTotal', 'maxObservedAt', 'maxObservedTimeRaw',
    'nextCursor', 'observedCount', 'pageCount', 'rejectedCount',
    'responseTruncated', 'status',
  ]);
});
