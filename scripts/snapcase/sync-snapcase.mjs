import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildIngestBatches, extractSnapcaseWindow } from './extract-snapcase.mjs';
import { KexiazhanReadOnlyClient } from './kexiazhan-client.mjs';

const defaultFixtureUrl = new URL('./fixtures/provider-records.json', import.meta.url);

export class SnapcaseSyncError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SnapcaseSyncError';
    this.code = code;
  }
}

const option = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const isoDate = (value) => {
  const result = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new SnapcaseSyncError('invalid_date');
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new SnapcaseSyncError('invalid_date');
  }
  return result;
};

const routineWindow = (now) => {
  const end = new Date(now);
  const start = new Date(end.getTime() - 34 * 86_400_000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

export const fixtureClient = (fixture) => ({
  async getAll(path, query = {}, { pageSize = 50 } = {}) {
    const source = path === '/v1/machines'
      ? fixture.machines ?? []
      : path === '/v1/orders'
        ? fixture.orders ?? []
        : fixture.payments ?? [];
    const machineRows = query.machineId
      ? source.filter((row) => String(row?.machineId ?? '') === String(query.machineId))
      : source;
    const rows = query.paymentTimeStart && query.paymentTimeEnd
      ? machineRows.filter((row) => {
        const paymentTime = String(row?.paymentTime ?? '');
        return paymentTime >= query.paymentTimeStart && paymentTime < query.paymentTimeEnd;
      })
      : machineRows;
    return {
      rows,
      evidence: {
        status: 'complete',
        pageCount: 1,
        observedCount: rows.length,
        expectedTotal: rows.length,
        effectivePageSize: rows.length || pageSize,
        nextCursor: null,
        responseTruncated: false,
      },
    };
  },
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const postBatch = async ({ batch, ingestUrl, ingestToken, fetchImpl, sleep }) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(ingestUrl, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${ingestToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!response.ok || payload?.ok !== true) {
        if (retryable && attempt < 3) {
          await sleep(250 * attempt);
          continue;
        }
        throw new SnapcaseSyncError('ingest_batch_failed');
      }
      const expected = {
        machineCount: batch.machines.length,
        orderCount: batch.orders.length,
        paymentCount: batch.payments.length,
        evidenceCount: batch.evidence.length,
      };
      if (Object.entries(expected).some(([key, value]) => Number(payload[key]) !== value)) {
        throw new SnapcaseSyncError('ingest_ack_mismatch');
      }
      return;
    } catch (error) {
      if (error instanceof SnapcaseSyncError) throw error;
      if (attempt === 3) throw new SnapcaseSyncError('ingest_transport_failed');
      await sleep(250 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
};

export const runSnapcaseSync = async ({
  args = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = wait,
  now = new Date(),
  runNonce = randomUUID(),
} = {}) => {
  const liveProvider = args.includes('--live-provider');
  const ingest = args.includes('--ingest');
  const allowSyntheticIngest = args.includes('--allow-synthetic-ingest');
  if (ingest && !liveProvider && !allowSyntheticIngest) {
    throw new SnapcaseSyncError('synthetic_ingest_not_allowed');
  }

  const requestedStart = option(args, '--date-start');
  const requestedEnd = option(args, '--date-end');
  if (Boolean(requestedStart) !== Boolean(requestedEnd)) throw new SnapcaseSyncError('incomplete_date_window');
  const window = requestedStart
    ? { startDate: isoDate(requestedStart), endDate: isoDate(requestedEnd) }
    : routineWindow(now);

  let client;
  let sourceAccountKey;
  let hmacSecret;
  if (liveProvider) {
    const username = String(env.KEXIAOZHAN_REPORTING_USERNAME ?? '');
    const password = String(env.KEXIAOZHAN_REPORTING_PASSWORD ?? '');
    sourceAccountKey = String(env.SNAPCASE_ACCOUNT_KEY ?? '').trim();
    hmacSecret = String(env.REPORTING_ROW_HASH_SALT ?? '');
    if (!username || !password || !sourceAccountKey || !hmacSecret) {
      throw new SnapcaseSyncError('live_configuration_missing');
    }
    client = new KexiazhanReadOnlyClient({ fetchImpl, timezone: 'UTC' });
    await client.login({ username, password });
  } else {
    const fixturePath = option(args, '--fixture');
    const fixture = JSON.parse(await readFile(fixturePath ?? defaultFixtureUrl, 'utf8'));
    client = fixtureClient(fixture);
    sourceAccountKey = 'synthetic-account';
    hmacSecret = 'synthetic-fixture-secret-only';
  }

  const extraction = await extractSnapcaseWindow({
    client,
    sourceAccountKey,
    hmacSecret,
    startDate: window.startDate,
    endDate: window.endDate,
    requestedTimezone: 'UTC',
  });
  const batches = buildIngestBatches(extraction, { runNonce });
  const summary = {
    ok: true,
    mode: ingest ? 'ingest' : 'dry-run',
    machineCount: extraction.machines.length,
    orderCount: extraction.orders.length,
    paymentCount: extraction.payments.length,
    rejectedCount:
      extraction.rejected.machines.length +
      extraction.rejected.orders.length +
      extraction.rejected.payments.length,
    evidenceCount: extraction.evidence.length,
    batchCount: batches.length,
    businessCoverageStatus: 'unverified',
    published: false,
  };
  if (!ingest) return summary;

  const ingestUrl = String(env.SNAPCASE_INGEST_URL ?? '').trim();
  const ingestToken = String(env.REPORTING_INGEST_TOKEN ?? '');
  if (!ingestUrl || !ingestToken) throw new SnapcaseSyncError('ingest_configuration_missing');
  for (const batch of batches) {
    await postBatch({ batch, ingestUrl, ingestToken, fetchImpl, sleep });
  }
  return summary;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runSnapcaseSync({ args: process.argv.slice(2) })));
  } catch (error) {
    const errorCode = error instanceof SnapcaseSyncError ? error.code : 'sync_failed';
    console.error(JSON.stringify({ ok: false, errorCode }));
    process.exitCode = 1;
  }
}
