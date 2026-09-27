import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { backfillWindows, runSnapcaseBackfill } from './backfill-snapcase.mjs';
import { extractSnapcaseWindow } from './extract-snapcase.mjs';

const withServer = async (handler, run) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}/ingest`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const acknowledge = (response, body) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    ok: true,
    machineCount: body.machines.length,
    orderCount: body.orders.length,
    paymentCount: body.payments.length,
    evidenceCount: body.evidence.length,
  }));
};

test('backfill windows preserve calendar boundaries, including a one-day tail', () => {
  assert.deepEqual(backfillWindows('2025-01-01', '2025-02-01'), [
    { start: '2025-01-01', end: '2025-01-31' },
    { start: '2025-02-01', end: '2025-02-01' },
  ]);
  assert.deepEqual(backfillWindows('2025-01-01', '2025-01-01'), [
    { start: '2025-01-01', end: '2025-01-01' },
  ]);
});

test('account-wide extraction retains retired machine sales and honest empty global receipts', async () => {
  const queries = [];
  const client = {
    async getAll(path, query) {
      queries.push({ path, query });
      const rows = path === '/v1/machines'
        ? [{ id: 'current-inventory', machineId: 'machine-current' }]
        : path === '/v1/orders'
          ? [{ orderNo: 'old-order', machineId: 'machine-retired', paymentTime: '2025-01-02 01:02:03' }]
          : [];
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
    client,
    sourceAccountKey: 'fixture-account',
    hmacSecret: 'fixture-secret-long-enough',
    startDate: '2025-01-01',
    endDate: '2025-01-31',
    accountWideSales: true,
  });
  assert.equal(result.orders[0].sourceMachineId, 'machine-retired');
  assert.equal(queries.find((entry) => entry.path === '/v1/orders').query.machineId, undefined);
  const paymentEvidence = result.evidence.find((entry) => entry.resource === 'payments');
  assert.equal(paymentEvidence.sourceMachineId, null);
  assert.equal(paymentEvidence.query.requestedStart, '2025-01-01T00:00:00Z');
  assert.equal(paymentEvidence.query.requestedEnd, '2025-02-01T00:00:00Z');
  assert.equal(paymentEvidence.extraction.expectedTotal, 0);
  assert.equal(paymentEvidence.businessCoverageStatus, 'unverified');
  assert.ok(queries.some((entry) =>
    entry.path === '/v1/payments' && entry.query.machineId === 'machine-current'
  ));
  const machinePaymentEvidence = result.evidence.find((entry) =>
    entry.resource === 'payments' && entry.sourceMachineId === 'machine-current'
  );
  assert.equal(machinePaymentEvidence.extraction.status, 'complete');
  assert.equal(machinePaymentEvidence.extraction.observedCount, 0);
  assert.equal(machinePaymentEvidence.query.requestedTimezone, null);
});

test('interrupted delivery leaves no window checkpoint and resume uses a new attempt run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snapcase-backfill-'));
  const checkpoint = join(directory, 'checkpoint.local');
  const runKeys = [];
  let failEvidence = true;
  let requestCount = 0;
  try {
    await withServer(async (request, response) => {
      const body = await readJson(request);
      requestCount += 1;
      runKeys.push(body.runKey);
      if (failEvidence && body.evidence.length > 0) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'redacted' }));
        return;
      }
      acknowledge(response, body);
    }, async (ingestUrl) => {
      const common = {
        args: [
          '--ingest', '--allow-synthetic-ingest',
          '--date-start', '2025-01-01', '--date-end', '2025-01-31',
          '--checkpoint', checkpoint,
        ],
        env: { SNAPCASE_INGEST_URL: ingestUrl, REPORTING_INGEST_TOKEN: 'fixture-token' },
        sleep: async () => {},
        now: new Date('2025-02-15T00:00:00Z'),
      };
      await assert.rejects(() => runSnapcaseBackfill({
        ...common,
        attemptNonce: () => 'attempt-one',
      }), { code: 'ingest_batch_failed' });
      await assert.rejects(() => readFile(checkpoint, 'utf8'), { code: 'ENOENT' });

      failEvidence = false;
      const resumed = await runSnapcaseBackfill({
        ...common,
        attemptNonce: () => 'attempt-two',
      });
      assert.equal(resumed.deliveredWindowCount, 1);
      const saved = JSON.parse(await readFile(checkpoint, 'utf8'));
      assert.deepEqual(saved.deliveredWindows.map((entry) => entry.window), ['2025-01-01/2025-01-31']);

      const requestsBeforeSkip = requestCount;
      const skipped = await runSnapcaseBackfill({
        ...common,
        args: common.args.filter((value, index, values) =>
          value !== '--date-end' && values[index - 1] !== '--date-end'),
        now: new Date('2025-02-16T00:00:00Z'),
        attemptNonce: () => 'attempt-three',
      });
      assert.equal(skipped.skippedWindowCount, 1);
      assert.equal(requestCount, requestsBeforeSkip);
      await assert.rejects(() => runSnapcaseBackfill({
        ...common,
        env: {
          SNAPCASE_INGEST_URL: `${ingestUrl}/different-target`,
          REPORTING_INGEST_TOKEN: 'fixture-token',
        },
      }), { code: 'checkpoint_scope_mismatch' });
    });
    assert.equal(new Set(runKeys.slice(0, 4)).size, 1, 'HTTP retries must retain the same run key');
    assert.notEqual(runKeys[0], runKeys.at(-1), 'a refetched attempt must use a new run key');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('backfill rejects unsupported, future, and checkpoint target ranges', async () => {
  const now = new Date('2026-09-26T00:00:00Z');
  await assert.rejects(() => runSnapcaseBackfill({
    args: ['--date-start', '2024-12-31', '--date-end', '2025-01-31'], now,
  }), { code: 'date_before_supported_history' });
  await assert.rejects(() => runSnapcaseBackfill({
    args: ['--date-start', '2025-01-01', '--date-end', '2099-01-31'], now,
  }), { code: 'invalid_date_range' });
});
