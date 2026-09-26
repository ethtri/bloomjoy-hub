import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildIngestBatches, extractSnapcaseWindow, monthlyWindows } from './extract-snapcase.mjs';
import { KexiazhanReadOnlyClient } from './kexiazhan-client.mjs';
import { sha256 } from './kexiazhan-contract.mjs';
import { fixtureClient, postBatch, SnapcaseSyncError } from './sync-snapcase.mjs';

const HISTORY_START = '2025-01-01';
const defaultFixtureUrl = new URL('./fixtures/backfill-provider-records.json', import.meta.url);

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

export const backfillWindows = (startDate, endDate) => {
  return monthlyWindows(isoDate(startDate), isoDate(endDate));
};

const checkpointKey = ({ sourceAccountKey, startDate, endDate, ingestUrl }) => ({
  version: 1,
  contractVersion: 'snapcase.ingest.v1',
  sourceAccountKey,
  startDate,
  endDate,
  targetKey: sha256(ingestUrl),
});

const readCheckpoint = async (path, binding) => {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const matches = Object.entries(binding).every(([key, value]) => parsed?.[key] === value);
    if (!matches || !Array.isArray(parsed.deliveredWindows)) {
      throw new SnapcaseSyncError('checkpoint_scope_mismatch');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...binding, deliveredWindows: [] };
    if (error instanceof SnapcaseSyncError) throw error;
    throw new SnapcaseSyncError('checkpoint_invalid');
  }
};

const checkpointEndDate = async (path) => {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return typeof parsed?.endDate === 'string' ? parsed.endDate : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new SnapcaseSyncError('checkpoint_invalid');
  }
};

const writeCheckpoint = async (path, checkpoint) => {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, absolute);
};

const windowKey = ({ start, end }) => `${start}/${end}`;

export const runSnapcaseBackfill = async ({
  args = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  now = new Date(),
  attemptNonce = randomUUID,
} = {}) => {
  const liveProvider = args.includes('--live-provider');
  const ingest = args.includes('--ingest');
  const allowSyntheticIngest = args.includes('--allow-synthetic-ingest');
  if (ingest && !liveProvider && !allowSyntheticIngest) {
    throw new SnapcaseSyncError('synthetic_ingest_not_allowed');
  }

  const checkpointPath = option(args, '--checkpoint') ?? 'snapcase-backfill-checkpoint.local';
  const requestedEnd = option(args, '--date-end');
  const resumedEnd = ingest && !requestedEnd ? await checkpointEndDate(checkpointPath) : null;
  const startDate = isoDate(option(args, '--date-start') ?? HISTORY_START);
  const endDate = isoDate(requestedEnd ?? resumedEnd ?? now.toISOString().slice(0, 10));
  const today = now.toISOString().slice(0, 10);
  if (startDate < HISTORY_START) throw new SnapcaseSyncError('date_before_supported_history');
  if (startDate > endDate || endDate > today) throw new SnapcaseSyncError('invalid_date_range');
  const windows = backfillWindows(startDate, endDate);

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

  const ingestUrl = String(env.SNAPCASE_INGEST_URL ?? '').trim();
  const ingestToken = String(env.REPORTING_INGEST_TOKEN ?? '');
  if (ingest && (!ingestUrl || !ingestToken)) {
    throw new SnapcaseSyncError('ingest_configuration_missing');
  }
  const binding = checkpointKey({ sourceAccountKey, startDate, endDate, ingestUrl });
  const checkpoint = ingest
    ? await readCheckpoint(checkpointPath, binding)
    : { ...binding, deliveredWindows: [] };
  const delivered = new Set(checkpoint.deliveredWindows.map((entry) => entry.window));

  const totals = { machineCount: 0, orderCount: 0, paymentCount: 0, evidenceCount: 0, batchCount: 0 };
  let skippedWindowCount = 0;
  let deliveredWindowCount = 0;
  for (const window of windows) {
    const key = windowKey(window);
    if (delivered.has(key)) {
      skippedWindowCount += 1;
      continue;
    }
    const extraction = await extractSnapcaseWindow({
      client,
      sourceAccountKey,
      hmacSecret,
      startDate: window.start,
      endDate: window.end,
      requestedTimezone: 'UTC',
      accountWideSales: true,
    });
    const rejectedCount = Object.values(extraction.rejected)
      .reduce((count, rows) => count + rows.length, 0);
    if (rejectedCount > 0) throw new SnapcaseSyncError('backfill_records_rejected');
    const batches = buildIngestBatches(extraction, { runNonce: attemptNonce() });
    totals.machineCount += extraction.machines.length;
    totals.orderCount += extraction.orders.length;
    totals.paymentCount += extraction.payments.length;
    totals.evidenceCount += extraction.evidence.length;
    totals.batchCount += batches.length;
    if (!ingest) continue;

    for (const batch of batches) {
      await postBatch({ batch, ingestUrl, ingestToken, fetchImpl, sleep });
    }
    checkpoint.deliveredWindows.push({ window: key, batchCount: batches.length });
    await writeCheckpoint(checkpointPath, checkpoint);
    delivered.add(key);
    deliveredWindowCount += 1;
  }

  return {
    ok: true,
    mode: ingest ? 'ingest' : 'dry-run',
    requestedWindowCount: windows.length,
    deliveredWindowCount,
    skippedWindowCount,
    ...totals,
    businessCoverageStatus: 'unverified',
    published: false,
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runSnapcaseBackfill({ args: process.argv.slice(2) })));
  } catch (error) {
    const errorCode = error instanceof SnapcaseSyncError ? error.code : 'backfill_failed';
    console.error(JSON.stringify({ ok: false, errorCode }));
    process.exitCode = 1;
  }
}
