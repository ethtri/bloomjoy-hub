import { createHash } from 'node:crypto';

export const KEXIAZHAN_API_BASE_URL = 'https://kxzcnt.kexiaozhan.com/mer';
export const KEXIAZHAN_READ_PATHS = Object.freeze([
  '/v1/machines',
  '/v1/orders',
  '/v1/payments',
]);

const forbiddenNormalizedKeys = new Set([
  'authorization',
  'bearertoken',
  'cardlast4',
  'contactemail',
  'contactperson',
  'contactphone',
  'customeremail',
  'customername',
  'deliveryaddress',
  'lastconnectip',
  'password',
  'receipturl',
  'registerip',
  'shippingaddress',
  'token',
  'workimageurl',
]);

const normalizeKey = (value) => String(value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();

export const sanitizeText = (value, maxLength = 300) =>
  String(value ?? '').trim().slice(0, maxLength);

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const amountToMinorUnits = (value) => {
  const amount = finiteNumber(value);
  if (amount === null || amount < 0) return null;
  return Math.round((amount + Number.EPSILON) * 100);
};

export const normalizeCurrencyCode = (value) => {
  const currencyCode = sanitizeText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : null;
};

export const normalizeTimestamp = (value) => {
  const raw = sanitizeText(value, 40);
  if (!raw) return { raw: null, utc: null };

  // Kexiazhan currently emits naive timestamps in parts of the portal. Do not
  // silently apply the GitHub runner's timezone. Only offset-bearing values
  // become an absolute timestamp until the vendor documents the contract.
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    return { raw, utc: null };
  }

  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime())
    ? { raw, utc: parsed.toISOString() }
    : { raw, utc: null };
};

const normalizeStatus = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return sanitizeText(value, 80);
};

const normalizeMachineType = (value) => {
  const normalized = sanitizeText(value, 80).toLowerCase();
  if (value === 1 || normalized === '1' || normalized === 'phone_case_printer') {
    return 'phone_case_printer';
  }
  if (value === 2 || normalized === '2' || normalized === 'film_applicator') {
    return 'film_applicator';
  }
  return 'unknown';
};

const normalizePaymentMethod = ({ paymentMethod, paymentInstrument }) => {
  const instrument = sanitizeText(paymentInstrument, 80).toLowerCase();
  const numericMethod = finiteNumber(paymentMethod);

  if (
    instrument.includes('credit') ||
    instrument.includes('card') ||
    instrument.includes('pos') ||
    numericMethod === 0
  ) {
    return 'credit';
  }
  if (instrument.includes('cash') || numericMethod === 1) return 'cash';
  if (instrument || numericMethod !== null) return 'other';
  return 'unknown';
};

export const assertNormalizedPayloadSafe = (value, path = 'payload') => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNormalizedPayloadSafe(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (forbiddenNormalizedKeys.has(normalizeKey(key))) {
      throw new Error(`Forbidden sensitive field in normalized provider payload at ${path}.${key}`);
    }
    assertNormalizedPayloadSafe(nestedValue, `${path}.${key}`);
  }
};

export const stablePayloadHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const normalizeKexiazhanMachine = (record) => {
  const sourceMachineId = sanitizeText(record?.id ?? record?.machineId, 120);
  if (!sourceMachineId) throw new Error('Kexiazhan machine is missing a stable machine ID');

  const normalized = {
    sourceMachineId,
    sourceSerial: sanitizeText(record?.machineSn ?? record?.serialNumber, 160) || null,
    sourceMerchantId: sanitizeText(record?.merchantId, 120) || null,
    merchantName: sanitizeText(record?.merchantName, 200) || null,
    sourceMachineType: normalizeMachineType(record?.type),
    sourceMachineName: sanitizeText(record?.machineName, 200) || null,
    sourceTimezone: sanitizeText(record?.timezone, 100) || null,
    sourceCurrencyCode: normalizeCurrencyCode(record?.currency),
    sourceStatus: normalizeStatus(record?.status ?? record?.onlineStatus),
    redactedPayload: {
      groupName: sanitizeText(record?.groupName, 160) || null,
      country: sanitizeText(record?.country, 100) || null,
      city: sanitizeText(record?.city, 100) || null,
      languageDefault: sanitizeText(record?.languageConfig?.default, 20) || null,
      onlineStatus: normalizeStatus(record?.onlineStatus),
      sourcePayloadRedacted: true,
    },
  };
  normalized.sourcePayloadHash = stablePayloadHash(normalized);
  assertNormalizedPayloadSafe(normalized);
  return normalized;
};

export const normalizeKexiazhanOrder = (record, machineContext = {}) => {
  const sourceOrderId = sanitizeText(record?.orderNo, 160);
  if (!sourceOrderId) throw new Error('Kexiazhan order is missing a stable order number');

  const created = normalizeTimestamp(record?.createTime);
  const paid = normalizeTimestamp(record?.paymentTime);
  const finished = normalizeTimestamp(record?.finishTime);
  const normalized = {
    sourceOrderId,
    sourceMachineId: sanitizeText(record?.machineId, 120) || null,
    sourceMerchantId:
      sanitizeText(record?.merchantId, 120) ||
      sanitizeText(machineContext?.sourceMerchantId, 120) ||
      null,
    sourceOrderType: finiteNumber(record?.type),
    sourceOrderStatus: normalizeStatus(record?.status),
    sourcePaymentStatus: normalizeStatus(record?.paymentStatus),
    createdTimeRaw: created.raw,
    createdAtUtc: created.utc,
    paymentTimeRaw: paid.raw,
    paymentAt: paid.utc,
    finishTimeRaw: finished.raw,
    finishedAt: finished.utc,
    sourceTimezone:
      sanitizeText(machineContext?.sourceTimezone, 100) || null,
    currencyCode:
      normalizeCurrencyCode(record?.currencyCode) ||
      normalizeCurrencyCode(machineContext?.sourceCurrencyCode),
    orderAmountMinor: amountToMinorUnits(record?.orderAmount),
    discountAmountMinor: amountToMinorUnits(record?.discountAmount),
    paymentAmountMinor: amountToMinorUnits(record?.paymentAmount),
    refundAmountMinor: amountToMinorUnits(record?.refundAmount),
    taxAmountMinor: amountToMinorUnits(record?.taxRateAmount),
    tipAmountMinor: amountToMinorUnits(record?.tipAmount),
    productName: sanitizeText(record?.goodsName, 240) || null,
    redactedPayload: {
      materialCount: finiteNumber(record?.materialCount),
      platform: normalizeStatus(record?.platform),
      itemQuantity: finiteNumber(record?.itemQuantity),
      sourcePayloadRedacted: true,
    },
  };
  normalized.sourcePayloadHash = stablePayloadHash({
    ...normalized,
    sourceOrderId: '[transit-only]',
  });
  assertNormalizedPayloadSafe(normalized);
  return normalized;
};

export const normalizeKexiazhanPayment = (record, machineContext = {}) => {
  const orderIds = Array.isArray(record?.orderNos)
    ? record.orderNos.map((value) => sanitizeText(value, 160)).filter(Boolean)
    : [];
  const externalReference = sanitizeText(record?.outTradeNo, 180);
  const paid = normalizeTimestamp(record?.paymentTime);
  const sourcePaymentId =
    externalReference ||
    [
      'unstable',
      sanitizeText(record?.machineId, 120),
      paid.raw ?? 'missing-time',
      sanitizeText(record?.paymentAmount, 40),
      orderIds.join(','),
    ].join(':');

  const normalized = {
    sourcePaymentId,
    stableSourceId: Boolean(externalReference),
    externalReference: externalReference || null,
    sourceOrderIds: orderIds,
    sourceMachineId: sanitizeText(record?.machineId, 120) || null,
    sourceMerchantId:
      sanitizeText(record?.merchantId, 120) ||
      sanitizeText(machineContext?.sourceMerchantId, 120) ||
      null,
    paymentTimeRaw: paid.raw,
    paymentAt: paid.utc,
    sourceTimezone: sanitizeText(machineContext?.sourceTimezone, 100) || null,
    currencyCode:
      normalizeCurrencyCode(record?.currencyCode) ||
      normalizeCurrencyCode(machineContext?.sourceCurrencyCode),
    normalizedPaymentMethod: normalizePaymentMethod(record ?? {}),
    sourcePaymentMethod: normalizeStatus(record?.paymentMethod),
    sourcePaymentInstrument: sanitizeText(record?.paymentInstrument, 100) || null,
    sourcePaymentStatus: normalizeStatus(record?.status ?? record?.paymentStatus),
    paymentAmountMinor: amountToMinorUnits(record?.paymentAmount),
    refundAmountMinor: amountToMinorUnits(record?.refundAmount),
    tipAmountMinor: amountToMinorUnits(record?.tipAmount),
    redactedPayload: {
      orderReferenceCount: orderIds.length,
      sourcePayloadRedacted: true,
    },
  };
  normalized.sourcePayloadHash = stablePayloadHash({
    ...normalized,
    sourcePaymentId: '[transit-only]',
    externalReference: externalReference ? '[transit-only]' : null,
    sourceOrderIds: orderIds.map(() => '[transit-only]'),
  });
  assertNormalizedPayloadSafe(normalized);
  return normalized;
};

export const normalizeNayaxTransaction = (record) => {
  const sourceTransactionId = sanitizeText(
    record?.TransactionID ?? record?.TransactionId ?? record?.transactionId,
    160,
  );
  if (!sourceTransactionId) throw new Error('Nayax transaction is missing a stable transaction ID');

  const authorized = normalizeTimestamp(
    record?.AuthorizationDateTimeGMT ?? record?.MachineAuthorizationTime,
  );
  const settled = normalizeTimestamp(record?.SettlementDateTimeGMT);
  const normalized = {
    sourceTransactionId,
    paymentServiceTransactionId:
      sanitizeText(record?.PaymentServiceTransactionID, 180) || null,
    sourceMachineId:
      sanitizeText(record?.MachineID ?? record?.MachineId, 120) || null,
    authorizationTimeRaw: authorized.raw,
    authorizedAt: authorized.utc,
    settlementTimeRaw: settled.raw,
    settledAt: settled.utc,
    currencyCode: normalizeCurrencyCode(record?.CurrencyCode),
    authorizationAmountMinor: amountToMinorUnits(record?.AuthorizationValue),
    settlementAmountMinor: amountToMinorUnits(record?.SettlementValue),
    sourcePaymentMethod: sanitizeText(record?.PaymentMethod, 100) || null,
    sourcePaymentStatus: sanitizeText(record?.Status, 100) || null,
    productName: sanitizeText(record?.ProductName, 240) || null,
    quantity: finiteNumber(record?.Quantity),
    redactedPayload: {
      paymentServiceProvider:
        sanitizeText(record?.PaymentServiceProviderName, 120) || null,
      sourcePayloadRedacted: true,
    },
  };
  normalized.sourcePayloadHash = stablePayloadHash({
    ...normalized,
    sourceTransactionId: '[transit-only]',
    paymentServiceTransactionId: normalized.paymentServiceTransactionId
      ? '[transit-only]'
      : null,
  });
  assertNormalizedPayloadSafe(normalized);
  return normalized;
};

const unwrapPage = (payload) => {
  if (Number(payload?.code) !== 0) {
    throw new Error(`Kexiazhan API returned a non-success response code`);
  }
  const data = payload?.data ?? {};
  const list = Array.isArray(data?.list) ? data.list : [];
  const total = Number(data?.total ?? list.length);
  return {
    list,
    total: Number.isFinite(total) && total >= 0 ? total : list.length,
  };
};

const delay = (milliseconds) =>
  milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();

export class KexiazhanReadOnlyClient {
  #baseUrl;
  #token = null;
  #fetch;
  #language;
  #timezone;

  constructor({
    baseUrl = KEXIAZHAN_API_BASE_URL,
    fetchImpl = globalThis.fetch,
    language = 'en-US',
    timezone = 'UTC',
  } = {}) {
    if (baseUrl !== KEXIAZHAN_API_BASE_URL) {
      throw new Error('Kexiazhan API base URL is not on the approved egress allowlist');
    }
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
    this.#baseUrl = baseUrl;
    this.#fetch = fetchImpl;
    this.#language = language;
    this.#timezone = timezone;
  }

  async login({ username, password }) {
    if (!sanitizeText(username, 320) || !sanitizeText(password, 500)) {
      throw new Error('Kexiazhan reporting credentials are required');
    }
    const response = await this.#fetch(`${this.#baseUrl}/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) throw new Error(`Kexiazhan login failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (Number(payload?.code) !== 0 || !sanitizeText(payload?.data?.token, 2000)) {
      throw new Error('Kexiazhan login did not return an access token');
    }
    this.#token = payload.data.token;
  }

  async getPage(path, query = {}) {
    if (!KEXIAZHAN_READ_PATHS.includes(path)) {
      throw new Error(`Kexiazhan read path is not allowlisted: ${path}`);
    }
    if (!this.#token) throw new Error('Kexiazhan client is not authenticated');

    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    const response = await this.#fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.#token}`,
        'X-App-Language': this.#language,
        'X-App-TimeZone': this.#timezone,
      },
    });
    if (!response.ok) throw new Error(`Kexiazhan read failed with HTTP ${response.status}`);
    return unwrapPage(await response.json());
  }

  async getAll(path, query = {}, {
    pageSize = 100,
    maxPages = 5000,
    delayMs = 500,
  } = {}) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
      throw new Error('Kexiazhan page size must be between 1 and 1000');
    }
    const rows = [];
    let total = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.getPage(path, { ...query, page, size: pageSize });
      total ??= result.total;
      rows.push(...result.list);
      if (rows.length >= total || result.list.length === 0) return rows;
      await delay(delayMs);
    }
    throw new Error('Kexiazhan pagination exceeded the configured page limit');
  }
}
