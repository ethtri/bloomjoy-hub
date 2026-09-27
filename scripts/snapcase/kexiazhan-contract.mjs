import { createHash, createHmac } from 'node:crypto';
import { resolveLocalDateTimeInZone } from '../../supabase/functions/_shared/timezone-resolution.mjs';

const cleanText = (value, maxLength) => {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result ? result.slice(0, maxLength) : null;
};

const requiredText = (value, field, maxLength = 200) => {
  if (!['string', 'number'].includes(typeof value)) {
    throw new SnapcaseRecordError('invalid_identifier_type', field);
  }
  const result = String(value).trim();
  if (!result) throw new SnapcaseRecordError('missing_required_field', field);
  if (result.length > maxLength) throw new SnapcaseRecordError('identifier_too_long', field);
  return result;
};

const optionalIdentifier = (value, field, maxLength = 200) =>
  value === null || value === undefined || value === ''
    ? null
    : requiredText(value, field, maxLength);

const rawScalar = (value, maxLength = 120) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return String(value);
  return cleanText(value, maxLength);
};

const rawAmount = (value) => {
  const result = rawScalar(value, 80);
  return result && /^-?\d+(?:\.\d+)?$/.test(result) ? result : null;
};

const rawTimestamp = (value, timeZone) => {
  const raw = cleanText(value, 80);
  if (!raw) return { raw: null, utc: null, resolution: 'missing' };
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime())
      ? { raw, utc: parsed.toISOString(), resolution: 'exact' }
      : { raw, utc: null, resolution: 'invalid' };
  }
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (!match || !timeZone) return { raw, utc: null, resolution: 'invalid' };
  const resolved = resolveLocalDateTimeInZone({
    localDate: match[1],
    localTime: match[2],
    timeZone,
  });
  return {
    raw,
    utc: ['exact', 'ambiguous', 'nonexistent'].includes(resolved.resolution)
      ? resolved.instant
      : null,
    resolution: resolved.resolution,
  };
};

const decimalAmount = (value) => {
  const raw = rawAmount(value);
  if (raw === null) return { raw: null, minor: null, valid: value === null || value === undefined || value === '' };
  const match = raw.match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) return { raw, minor: null, valid: false };
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return { raw, minor: null, valid: false };
  return { raw, minor: Number(minor), valid: true };
};

const normalizedCurrency = (recordCurrency, machineCurrency) => {
  const source = cleanText(recordCurrency, 20) ?? cleanText(machineCurrency, 20);
  return { source, code: source?.toUpperCase() === 'USD' ? 'USD' : null };
};

const normalizedTender = (code, label) => {
  const normalizedCode = rawScalar(code);
  const normalizedLabel = cleanText(label, 160)?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  if (normalizedCode === '1' && normalizedLabel === 'cash') return 'cash';
  if (normalizedCode === '0' && ['creditcard', 'pos'].includes(normalizedLabel)) return 'card';
  if (normalizedCode === '3' && ['creditcard', 'paymentboard'].includes(normalizedLabel)) return 'card';
  if (normalizedCode !== null && PAYMENT_METHOD_LABELS[normalizedCode] !== undefined) return 'other';
  return 'unknown';
};

const unique = (values) => [...new Set(values)];

const PAYMENT_METHOD_LABELS = Object.freeze({
  0: 'pos',
  1: 'banknote',
  2: 'cloud_manager',
  3: 'payment_board',
  4: 'free_coupon',
  5: 'machine_free',
  6: 'leyao',
});

const PAYMENT_STATUS_LABELS = Object.freeze({
  0: 'pending',
  1: 'success',
  2: 'failed',
  3: 'refunding',
  4: 'refund_success',
  5: 'refund_failed',
});

const ORDER_STATUS_LABELS = Object.freeze({
  0: 'awaiting_payment',
  1: 'paid',
  2: 'printing',
  3: 'complete',
  4: 'cancelled',
  5: 'marked_refunded',
  6: 'print_failed',
  7: 'waiting_to_print',
  8: 'refunded',
});

const enumLabel = (labels, value) => labels[rawScalar(value)] ?? null;

export class SnapcaseRecordError extends Error {
  constructor(code, field = null) {
    super(`SnapCase record rejected: ${code}${field ? ` (${field})` : ''}`);
    this.name = 'SnapcaseRecordError';
    this.code = code;
    this.field = field;
  }
}

export const sha256 = (value) =>
  createHash('sha256').update(String(value)).digest('hex');

export const sourceKey = ({ secret, keyVersion, sourceAccountKey, resource, sourceId }) => {
  if (!secret || String(secret).length < 16) throw new Error('A server-side HMAC secret is required');
  if (!Number.isInteger(keyVersion) || keyVersion < 1) throw new Error('keyVersion must be positive');
  return createHmac('sha256', secret)
    .update(`${keyVersion}\0${sourceAccountKey}\0${resource}\0${sourceId}`)
    .digest('hex');
};

const revisionDigest = (record) => sha256(JSON.stringify(record));

const eventIdentity = (record, context, resource, idField) => ({
  sourceKey: sourceKey({
    ...context,
    resource,
    sourceId: requiredText(record?.[idField], idField),
  }),
  keyVersion: context.keyVersion,
});

export const normalizeMachine = (record) => {
  // Kexiaozhan inventory `id` and the sales-query `machineId` are different keys.
  const normalized = {
    sourceInventoryId: requiredText(record?.id, 'id', 200),
    sourceMachineId: requiredText(record?.machineId, 'machineId', 200),
    sourceMerchantId: cleanText(record?.merchantId, 180),
    sourceMerchantName: cleanText(record?.merchantName, 200),
    sourceLabel: cleanText(record?.machineName, 200),
    sourceStatus: rawScalar(record?.status ?? record?.onlineStatus),
    sourceTimezone: cleanText(record?.timezone, 100),
    sourceCurrency: cleanText(record?.currency, 20),
  };
  return { ...normalized, revisionDigest: revisionDigest(normalized) };
};

export const normalizeOrder = (record, context) => {
  const identity = eventIdentity(record, context, 'order', 'orderNo');
  const paid = rawTimestamp(record?.paymentTime, context.machineTimezone);
  const currency = normalizedCurrency(record?.currency, context.machineCurrency);
  const amount = decimalAmount(record?.paymentAmount);
  const refund = decimalAmount(record?.refundAmount);
  const productLabel = cleanText(record?.goodsName, 240);
  const sourceStatus = enumLabel(ORDER_STATUS_LABELS, record?.status);
  const sourcePaymentStatus = enumLabel(PAYMENT_STATUS_LABELS, record?.paymentStatus);
  const sourceTenderCode = rawScalar(record?.paymentMethod);
  const sourceTenderLabel = cleanText(record?.paymentInstrument, 160)
    ?? enumLabel(PAYMENT_METHOD_LABELS, record?.paymentMethod);
  const tender = normalizedTender(sourceTenderCode, sourceTenderLabel);
  const exceptionCodes = [];
  if (!paid.utc) exceptionCodes.push('source_time_semantics_unverified');
  if (!amount.valid || amount.minor === null) exceptionCodes.push('amount_unit_unverified');
  if (!amount.valid) exceptionCodes.push('invalid_amount_text');
  if (!currency.code) exceptionCodes.push('currency_unverified');
  // The staging contract retains this provenance marker whenever raw provider
  // status fields are present. Financial publication interprets only the
  // explicitly enumerated labels below.
  if (rawScalar(record?.status) !== null || rawScalar(record?.paymentStatus) !== null) {
    exceptionCodes.push('financial_status_semantics_unverified');
  }
  if (tender === 'unknown') exceptionCodes.push('financial_tender_semantics_unverified');
  if (refund.raw !== null) exceptionCodes.push('refund_semantics_unverified');
  const normalized = {
    ...identity,
    sourceMachineId: requiredText(record?.machineId, 'machineId'),
    sourceMerchantId: cleanText(record?.merchantId, 180),
    sourceStatus: sourceStatus ?? rawScalar(record?.status),
    sourcePaymentStatus: sourcePaymentStatus ?? rawScalar(record?.paymentStatus),
    sourceTenderCode,
    sourceTenderLabel,
    normalizedTender: tender,
    occurredTimeRaw: paid.raw,
    occurredAt: paid.utc,
    sourceCurrency: currency.source,
    currencyCode: currency.code,
    sourceAmountText: amount.raw,
    amountMinor: amount.minor,
    sourceRefundAmountText: refund.raw,
    refundAmountMinor: refund.minor,
    productLabel,
    quantity: null,
    exceptionCodes: unique(exceptionCodes),
  };
  return { ...normalized, revisionDigest: revisionDigest(normalized) };
};

export const normalizePayment = (record, context) => {
  const identity = eventIdentity(record, context, 'payment', 'outTradeNo');
  if (Array.isArray(record?.orderNos) && record.orderNos.length > 50) {
    throw new SnapcaseRecordError('too_many_related_orders', 'orderNos');
  }
  const relatedOrderKeys = Array.isArray(record?.orderNos)
    ? record.orderNos
      .map((orderNo) => requiredText(orderNo, 'orderNos', 200))
      .map((orderNo) => sourceKey({ ...context, resource: 'order', sourceId: orderNo }))
    : [];
  const transactionId = optionalIdentifier(record?.transactionId, 'transactionId', 200);
  const paid = rawTimestamp(record?.paymentTime, context.machineTimezone);
  const currency = normalizedCurrency(record?.currency, context.machineCurrency);
  const amount = decimalAmount(record?.paymentAmount);
  const refund = decimalAmount(record?.refundAmount);
  const sourceStatus = enumLabel(PAYMENT_STATUS_LABELS, record?.status ?? record?.paymentStatus);
  const sourceTenderCode = rawScalar(record?.paymentMethod);
  const sourceTenderLabel = cleanText(record?.paymentInstrument, 160)
    ?? enumLabel(PAYMENT_METHOD_LABELS, record?.paymentMethod);
  const sourceTender = normalizedTender(sourceTenderCode, sourceTenderLabel);
  const configuredUsdInterpretation = context.usdInterpretationPaymentSourceKeys?.has(identity.sourceKey) === true
    && sourceTender === 'cash'
    && ['AUD', 'A$'].includes(currency.source?.toUpperCase());
  const currencyCode = configuredUsdInterpretation ? 'USD' : currency.code;
  const configuredNonfinancialTest = context.nonfinancialTestPaymentSourceKeys?.has(identity.sourceKey) === true
    && sourceTenderCode === '17'
    && sourceTenderLabel?.trim().toLowerCase() === 'webhook';
  const tender = configuredNonfinancialTest ? 'other' : sourceTender;
  const exceptionCodes = [];
  if (!paid.utc) exceptionCodes.push('source_time_semantics_unverified');
  if (!amount.valid || amount.minor === null) exceptionCodes.push('amount_unit_unverified');
  if (!amount.valid) exceptionCodes.push('invalid_amount_text');
  if (!currencyCode) exceptionCodes.push('currency_unverified');
  if (rawScalar(record?.status ?? record?.paymentStatus) !== null) {
    exceptionCodes.push('financial_status_semantics_unverified');
  }
  if (sourceTender === 'unknown') exceptionCodes.push('financial_tender_semantics_unverified');
  if (refund.raw !== null) exceptionCodes.push('refund_semantics_unverified');
  const normalized = {
    ...identity,
    relatedOrderKeys,
    sourceTransactionKey: transactionId
      ? sourceKey({ ...context, resource: 'payment_transaction', sourceId: transactionId })
      : null,
    sourceMachineId: requiredText(record?.machineId, 'machineId'),
    sourceMerchantId: cleanText(record?.merchantId, 180),
    sourceStatus: sourceStatus ?? rawScalar(record?.status ?? record?.paymentStatus),
    sourceTenderCode,
    sourceTenderLabel,
    normalizedTender: tender,
    occurredTimeRaw: paid.raw,
    occurredAt: paid.utc,
    sourceCurrency: currency.source,
    currencyCode,
    sourceAmountText: amount.raw,
    amountMinor: amount.minor,
    sourceRefundAmountText: refund.raw,
    refundAmountMinor: refund.minor,
    productLabel: null,
    quantity: null,
    exceptionCodes: unique(exceptionCodes),
  };
  return { ...normalized, revisionDigest: revisionDigest(normalized) };
};

export const normalizeBatch = (records, normalizer) => {
  const accepted = [];
  const rejected = [];
  records.forEach((record, index) => {
    try {
      accepted.push(normalizer(record));
    } catch (error) {
      rejected.push({
        index,
        code: error instanceof SnapcaseRecordError ? error.code : 'invalid_record',
        field: error instanceof SnapcaseRecordError ? error.field : null,
      });
    }
  });
  return { accepted, rejected };
};
