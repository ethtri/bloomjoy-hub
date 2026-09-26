import { createHash, createHmac } from 'node:crypto';

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

const rawTimestamp = (value) => {
  const raw = cleanText(value, 80);
  if (!raw) return { raw: null, utc: null, ambiguous: false };
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) return { raw, utc: null, ambiguous: true };
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime())
    ? { raw, utc: parsed.toISOString(), ambiguous: false }
    : { raw, utc: null, ambiguous: true };
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
  const paid = rawTimestamp(record?.paymentTime);
  const sourceCurrency = cleanText(record?.currency, 20);
  const sourceRefundAmountText = rawAmount(record?.refundAmount);
  const productLabel = cleanText(record?.goodsName, 240);
  const amountValues = [record?.paymentAmount, record?.refundAmount];
  const exceptionCodes = [
    'source_time_semantics_unverified',
    'amount_unit_unverified',
    'financial_status_semantics_unverified',
    'financial_tender_semantics_unverified',
  ];
  if (amountValues.some((value) => value !== null && value !== undefined && rawAmount(value) === null)) {
    exceptionCodes.push('invalid_amount_text');
  }
  if (paid.ambiguous) {
    exceptionCodes.push('source_clock_offset_missing');
  }
  if (sourceCurrency) exceptionCodes.push('currency_unverified');
  if (sourceRefundAmountText !== null) exceptionCodes.push('refund_semantics_unverified');
  if (productLabel) exceptionCodes.push('product_unverified');
  const normalized = {
    ...identity,
    sourceMachineId: requiredText(record?.machineId, 'machineId'),
    sourceMerchantId: cleanText(record?.merchantId, 180),
    sourceStatus:
      enumLabel(ORDER_STATUS_LABELS, record?.status) ?? rawScalar(record?.status),
    sourcePaymentStatus:
      enumLabel(PAYMENT_STATUS_LABELS, record?.paymentStatus) ?? rawScalar(record?.paymentStatus),
    sourceTenderCode: rawScalar(record?.paymentMethod),
    sourceTenderLabel:
      cleanText(record?.paymentInstrument, 160) ??
      enumLabel(PAYMENT_METHOD_LABELS, record?.paymentMethod),
    normalizedTender: 'unknown',
    occurredTimeRaw: paid.raw,
    occurredAt: paid.utc,
    sourceCurrency,
    currencyCode: null,
    sourceAmountText: rawAmount(record?.paymentAmount),
    amountMinor: null,
    sourceRefundAmountText,
    refundAmountMinor: null,
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
  const paid = rawTimestamp(record?.paymentTime);
  const sourceCurrency = cleanText(record?.currency, 20);
  const sourceRefundAmountText = rawAmount(record?.refundAmount);
  const amountValues = [record?.paymentAmount, record?.refundAmount, record?.tipAmount];
  const exceptionCodes = [
    'source_time_semantics_unverified',
    'amount_unit_unverified',
    'financial_status_semantics_unverified',
    'financial_tender_semantics_unverified',
  ];
  if (amountValues.some((value) => value !== null && value !== undefined && rawAmount(value) === null)) {
    exceptionCodes.push('invalid_amount_text');
  }
  if (paid.ambiguous) exceptionCodes.push('source_clock_offset_missing');
  if (sourceCurrency) exceptionCodes.push('currency_unverified');
  if (sourceRefundAmountText !== null) exceptionCodes.push('refund_semantics_unverified');
  const normalized = {
    ...identity,
    relatedOrderKeys,
    sourceTransactionKey: transactionId
      ? sourceKey({ ...context, resource: 'payment_transaction', sourceId: transactionId })
      : null,
    sourceMachineId: requiredText(record?.machineId, 'machineId'),
    sourceMerchantId: cleanText(record?.merchantId, 180),
    sourceStatus:
      enumLabel(PAYMENT_STATUS_LABELS, record?.status ?? record?.paymentStatus) ??
      rawScalar(record?.status ?? record?.paymentStatus),
    sourceTenderCode: rawScalar(record?.paymentMethod),
    sourceTenderLabel:
      cleanText(record?.paymentInstrument, 160) ??
      enumLabel(PAYMENT_METHOD_LABELS, record?.paymentMethod),
    normalizedTender: 'unknown',
    occurredTimeRaw: paid.raw,
    occurredAt: paid.utc,
    sourceCurrency,
    currencyCode: null,
    sourceAmountText: rawAmount(record?.paymentAmount),
    amountMinor: null,
    sourceRefundAmountText,
    refundAmountMinor: null,
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
