import { normalizeBatch, normalizeMachine, normalizeOrder, normalizePayment, sha256 } from './kexiazhan-contract.mjs';

const isoDate = (value, field) => {
  const result = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`${field} must use YYYY-MM-DD`);
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new Error(`${field} is invalid`);
  return result;
};

export const monthlyWindows = (startDate, endDate) => {
  const start = isoDate(startDate, 'startDate');
  const end = isoDate(endDate, 'endDate');
  if (start > end) throw new Error('startDate must not follow endDate');
  const windows = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const final = new Date(`${end}T00:00:00Z`);
  while (cursor <= final) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const windowEnd = monthEnd < final ? monthEnd : final;
    windows.push({ start: cursor.toISOString().slice(0, 10), end: windowEnd.toISOString().slice(0, 10) });
    cursor = new Date(windowEnd.getTime() + 86_400_000);
  }
  return windows;
};

const evidence = ({ resource, sourceMachineId = null, start, end, timezone, page, rejectedCount }) => ({
  resource,
  sourceMachineId,
  query: { requestedStart: start, requestedEnd: end, requestedTimezone: timezone },
  extraction: {
    status: page.status === 'complete' && rejectedCount === 0 ? 'complete' : 'partial',
    pageCount: page.pageCount,
    nextCursor: page.nextCursor,
    responseTruncated: page.responseTruncated,
    observedCount: page.observedCount,
    rejectedCount,
    maxObservedTimeRaw: null,
    maxObservedAt: null,
  },
  businessCoverageStatus: 'unverified',
  coverageReasonCode: 'source_time_semantics_unverified',
});

export const extractSnapcaseWindow = async ({
  client,
  sourceAccountKey,
  hmacSecret,
  keyVersion = 1,
  startDate,
  endDate,
  requestedTimezone = null,
  pageSize = 50,
  maxPages = 1_000,
}) => {
  if (!client) throw new Error('client is required');
  const account = String(sourceAccountKey ?? '').trim();
  if (!account) throw new Error('sourceAccountKey is required');
  const start = isoDate(startDate, 'startDate');
  const end = isoDate(endDate, 'endDate');
  if (start > end) throw new Error('startDate must not follow endDate');
  const windowDays = ((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (windowDays > 35) throw new Error('SnapCase extraction windows must not exceed 35 days');
  const context = { secret: hmacSecret, keyVersion, sourceAccountKey: account };
  const inventory = await client.getAll('/v1/machines', {}, { pageSize, maxPages });
  const machines = normalizeBatch(inventory.rows, normalizeMachine);
  const result = {
    contractVersion: 'snapcase.ingest.v1',
    sourceAccountKey: account,
    machines: machines.accepted,
    orders: [],
    payments: [],
    rejected: { machines: machines.rejected, orders: [], payments: [] },
    evidence: [evidence({ resource: 'machines', start, end, timezone: requestedTimezone, page: inventory.evidence, rejectedCount: machines.rejected.length })],
  };

  for (const machine of machines.accepted) {
    const query = {
      machineId: machine.sourceMachineId,
      paymentTimeStart: `${start} 00:00:00`,
      paymentTimeEnd: `${end} 23:59:59`,
    };
    const [orderPage, paymentPage] = await Promise.all([
      client.getAll('/v1/orders', query, { pageSize, maxPages }),
      client.getAll('/v1/payments', query, { pageSize, maxPages }),
    ]);
    const orders = normalizeBatch(orderPage.rows, (row) => normalizeOrder(row, context));
    const payments = normalizeBatch(paymentPage.rows, (row) => normalizePayment(row, context));
    result.orders.push(...orders.accepted);
    result.payments.push(...payments.accepted);
    result.rejected.orders.push(...orders.rejected.map((row) => ({ ...row, sourceMachineId: machine.sourceMachineId })));
    result.rejected.payments.push(...payments.rejected.map((row) => ({ ...row, sourceMachineId: machine.sourceMachineId })));
    result.evidence.push(
      evidence({ resource: 'orders', sourceMachineId: machine.sourceMachineId, start, end, timezone: requestedTimezone, page: orderPage.evidence, rejectedCount: orders.rejected.length }),
      evidence({ resource: 'payments', sourceMachineId: machine.sourceMachineId, start, end, timezone: requestedTimezone, page: paymentPage.evidence, rejectedCount: payments.rejected.length }),
    );
  }
  return result;
};

export const buildIngestBatches = (extraction, { runNonce, batchSize = 50 } = {}) => {
  if (!runNonce || String(runNonce).length < 8) throw new Error('runNonce is required');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error('batchSize must be between 1 and 50');
  const runKey = sha256(`${extraction.sourceAccountKey}\0${runNonce}`);
  const observationBatchCount = Math.max(
    extraction.machines.length || extraction.orders.length || extraction.payments.length ? 1 : 0,
    Math.ceil(extraction.machines.length / batchSize),
    Math.ceil(extraction.orders.length / batchSize),
    Math.ceil(extraction.payments.length / batchSize),
  );
  const evidenceBatchCount = Math.max(1, Math.ceil(extraction.evidence.length / batchSize));
  const batchCount = observationBatchCount + evidenceBatchCount;
  return Array.from({ length: batchCount }, (_, index) => {
    const isEvidenceBatch = index >= observationBatchCount;
    const evidenceIndex = index - observationBatchCount;
    const envelope = {
      contractVersion: extraction.contractVersion,
      sourceAccountKey: extraction.sourceAccountKey,
      runKey,
      batchKey: sha256(`${runKey}\0${index}`),
      machines: isEvidenceBatch ? [] : extraction.machines.slice(index * batchSize, (index + 1) * batchSize),
      orders: isEvidenceBatch ? [] : extraction.orders.slice(index * batchSize, (index + 1) * batchSize),
      payments: isEvidenceBatch ? [] : extraction.payments.slice(index * batchSize, (index + 1) * batchSize),
      // Evidence-only batches follow all observations, so a crash cannot publish
      // completed extraction evidence before its rows have been offered to ingest.
      evidence: isEvidenceBatch
        ? extraction.evidence.slice(evidenceIndex * batchSize, (evidenceIndex + 1) * batchSize)
        : [],
    };
    return { ...envelope, batchDigest: sha256(JSON.stringify(envelope)) };
  });
};
