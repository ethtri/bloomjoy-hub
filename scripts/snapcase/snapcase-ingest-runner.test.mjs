import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { runSnapcaseSync } from './sync-snapcase.mjs';

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

test('fixture dry run is the default and performs no network request', async () => {
  let requests = 0;
  const result = await runSnapcaseSync({
    args: ['--date-start', '2026-09-01', '--date-end', '2026-09-26'],
    fetchImpl: async () => {
      requests += 1;
      throw new Error('network should not run');
    },
    runNonce: 'fixture-run-1',
  });
  assert.equal(requests, 0);
  assert.deepEqual(result, {
    ok: true,
    mode: 'dry-run',
    machineCount: 1,
    orderCount: 1,
    paymentCount: 1,
    rejectedCount: 0,
    evidenceCount: 3,
    batchCount: 2,
    completedWindowCount: 0,
    changedWindowCount: 0,
    publishedCashFactCount: 0,
  });
});

test('fixture ingest waits for every acknowledged batch before succeeding', async () => {
  const received = [];
  await withServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer fixture-ingest-token');
    const body = await readJson(request);
    received.push(body);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      machineCount: body.machines.length,
      orderCount: body.orders.length,
      paymentCount: body.payments.length,
      evidenceCount: body.evidence.length,
    }));
  }, async (ingestUrl) => {
    const result = await runSnapcaseSync({
      args: [
        '--ingest',
        '--allow-synthetic-ingest',
        '--date-start', '2026-09-01',
        '--date-end', '2026-09-26',
      ],
      env: {
        SNAPCASE_INGEST_URL: ingestUrl,
        REPORTING_INGEST_TOKEN: 'fixture-ingest-token',
      },
      runNonce: 'fixture-run-2',
    });
    assert.equal(result.ok, true);
    assert.equal(result.batchCount, 2);
  });
  assert.equal(received.length, 2);
  assert.equal(received[0].evidence.length, 0);
  assert.equal(received[1].evidence.length, 3);
  assert.equal(received[0].runKey, received[1].runKey);
});

test('a failed batch retries the same digest and prevents success', async () => {
  const digests = [];
  let requests = 0;
  await withServer(async (request, response) => {
    const body = await readJson(request);
    requests += 1;
    digests.push(body.batchDigest);
    if (body.evidence.length === 0) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        machineCount: body.machines.length,
        orderCount: body.orders.length,
        paymentCount: body.payments.length,
        evidenceCount: 0,
      }));
      return;
    }
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'redacted' }));
  }, async (ingestUrl) => {
    await assert.rejects(() => runSnapcaseSync({
      args: [
        '--ingest',
        '--allow-synthetic-ingest',
        '--date-start', '2026-09-01',
        '--date-end', '2026-09-26',
      ],
      env: {
        SNAPCASE_INGEST_URL: ingestUrl,
        REPORTING_INGEST_TOKEN: 'fixture-ingest-token',
      },
      sleep: async () => {},
      runNonce: 'fixture-run-3',
    }), { code: 'ingest_batch_failed' });
  });
  assert.equal(requests, 4);
  assert.equal(new Set(digests.slice(1)).size, 1);
});
