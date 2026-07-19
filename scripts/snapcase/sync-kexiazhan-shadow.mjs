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

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};

const dryRun = hasFlag('--dry-run') || process.env.DRY_RUN === 'true';
const confirmLive = hasFlag('--confirm-live') || process.env.CONFIRM_LIVE === 'true';
const fixturePath = valueAfter('--fixture');
const accountKey = String(process.env.KEXIAZHAN_ACCOUNT_KEY ?? '').trim();
const ingestUrl = String(process.env.SNAPCASE_INGEST_URL ?? '').trim();
const ingestToken = String(process.env.SNAPCASE_INGEST_TOKEN ?? '').trim();
const reportingTimezone = String(
  process.env.KEXIAZHAN_REPORTING_TIMEZONE ?? 'UTC',
).trim();
const pageSize = Number(process.env.KEXIAZHAN_PAGE_SIZE ?? '100');
const delayMs = Number(process.env.KEXIAZHAN_REQUEST_DELAY_MS ?? '500');

const isoDate = (value) => {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('Date values must use YYYY-MM-DD');
  }
  return normalized;
};

const defaultWindow = () => {
  const end = new Date();
  const start = new Date(end.getTime() - 34 * 24 * 60 * 60 * 1000);
  return {
    dateStart: start.toISOString().slice(0, 10),
    dateEnd: end.toISOString().slice(0, 10),
  };
};

const requestedStart = valueAfter('--date-start');
const requestedEnd = valueAfter('--date-end');
if (Boolean(requestedStart) !== Boolean(requestedEnd)) {
  throw new Error('--date-start and --date-end must be provided together');
}
const window = requestedStart
  ? { dateStart: isoDate(requestedStart), dateEnd: isoDate(requestedEnd) }
  : defaultWindow();
const windowStart = new Date(`${window.dateStart}T00:00:00Z`);
const windowEnd = new Date(`${window.dateEnd}T23:59:59Z`);
if (
  !Number.isFinite(windowStart.getTime()) ||
  !Number.isFinite(windowEnd.getTime()) ||
  windowEnd < windowStart ||
  windowEnd.getTime() - windowStart.getTime() > 35 * 24 * 60 * 60 * 1000
) {
  throw new Error('Kexiazhan sync window must be valid and no longer than 35 days');
}

const postIngest = async (body) => {
  if (!ingestUrl || !ingestToken) {
    throw new Error('SNAPCASE_INGEST_URL and SNAPCASE_INGEST_TOKEN are required');
  }
  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ingestToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : `Snapcase ingest failed with HTTP ${response.status}`,
    );
  }
  return payload;
};

const normalizeFixture = async (path) => {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  const machines = (fixture.machines ?? []).map(normalizeKexiazhanMachine);
  const machineById = new Map(machines.map((machine) => [machine.sourceMachineId, machine]));
  const orders = (fixture.orders ?? []).map((order) =>
    normalizeKexiazhanOrder(order, machineById.get(String(order.machineId)) ?? {}),
  );
  const payments = (fixture.payments ?? []).map((payment) =>
    normalizeKexiazhanPayment(payment, machineById.get(String(payment.machineId)) ?? {}),
  );
  const nayaxTransactions = (fixture.nayaxTransactions ?? []).map(normalizeNayaxTransaction);
  return { machines, orders, payments, nayaxTransactions };
};

const fetchLiveKexiazhan = async () => {
  if (process.env.KEXIAZHAN_API_APPROVED !== 'true') {
    throw new Error('KEXIAZHAN_API_APPROVED=true is required before private API access');
  }
  if (!accountKey || !ingestUrl || !ingestToken) {
    throw new Error('Kexiazhan account and Snapcase ingest configuration are required');
  }
  const username = String(process.env.KEXIAZHAN_REPORTING_USERNAME ?? '');
  const password = String(process.env.KEXIAZHAN_REPORTING_PASSWORD ?? '');
  if (!username || !password) throw new Error('Kexiazhan reporting credentials are required');

  const scope = await postIngest({
    action: 'get_sync_scope',
    accountKey,
  });
  if (scope?.approved !== true) {
    throw new Error('Kexiazhan provider contract and account scope are not approved');
  }
  const allowedMachineIds = new Set(
    Array.isArray(scope.machineIds) ? scope.machineIds.map(String) : [],
  );

  const client = new KexiazhanReadOnlyClient({
    baseUrl: KEXIAZHAN_API_BASE_URL,
    timezone: reportingTimezone,
  });
  await client.login({ username, password });

  const machineRecords = await client.getAll(
    '/v1/machines',
    {},
    { pageSize, delayMs },
  );
  const machines = machineRecords.map(normalizeKexiazhanMachine);
  const machineById = new Map(machines.map((machine) => [machine.sourceMachineId, machine]));
  const orders = [];
  const payments = [];

  for (const machineId of [...allowedMachineIds].sort()) {
    const machineContext = machineById.get(machineId) ?? {};
    const machineOrders = await client.getAll(
      '/v1/orders',
      {
        type: 1,
        machineId,
        paymentTimeStart: `${window.dateStart} 00:00:00`,
        paymentTimeEnd: `${window.dateEnd} 23:59:59`,
      },
      { pageSize, delayMs },
    );
    const machinePayments = await client.getAll(
      '/v1/payments',
      {
        machineId,
        paymentTimeStart: `${window.dateStart} 00:00:00`,
        paymentTimeEnd: `${window.dateEnd} 23:59:59`,
      },
      { pageSize, delayMs },
    );
    orders.push(...machineOrders.map((order) => normalizeKexiazhanOrder(order, machineContext)));
    payments.push(
      ...machinePayments.map((payment) => normalizeKexiazhanPayment(payment, machineContext)),
    );
  }

  return { machines, orders, payments, nayaxTransactions: [] };
};

if (!dryRun && !confirmLive) {
  throw new Error('Shadow staging writes require --confirm-live');
}

const normalized = fixturePath
  ? await normalizeFixture(fixturePath)
  : await fetchLiveKexiazhan();
assertNormalizedPayloadSafe(normalized);

if (!ingestUrl || !ingestToken) {
  if (!fixturePath || !dryRun) {
    throw new Error('Local validation without ingest is allowed only for a fixture dry run');
  }
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    fixtureOnly: true,
    machineCount: normalized.machines.length,
    orderCount: normalized.orders.length,
    paymentCount: normalized.payments.length,
    nayaxTransactionCount: normalized.nayaxTransactions.length,
    salesPublicationEnabled: false,
  }));
  process.exit(0);
}

const result = await postIngest({
  action: 'stage',
  accountKey,
  nayaxAccountKey: String(process.env.NAYAX_ACCOUNT_KEY ?? '').trim() || null,
  dryRun,
  windowStart: windowStart.toISOString(),
  windowEnd: windowEnd.toISOString(),
  machines: normalized.machines,
  orders: normalized.orders,
  payments: normalized.payments,
  nayaxTransactions: normalized.nayaxTransactions,
});

console.log(JSON.stringify({
  ok: result?.ok === true,
  dryRun,
  machineCount: Number(result?.machineCount ?? 0),
  orderCount: Number(result?.orderCount ?? 0),
  paymentCount: Number(result?.paymentCount ?? 0),
  nayaxTransactionCount: Number(result?.nayaxTransactionCount ?? 0),
  salesPublicationEnabled: false,
}));
