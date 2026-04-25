import { readSheet } from 'read-excel-file/node';

export const SUNZE_ORDER_SHEET = 'Order';

export const SUNZE_ORDER_HEADERS = [
  'Order number',
  'Trade name',
  'Affiliated merchant',
  'Machine code',
  'Machine name',
  'Order amount',
  'Tax',
  'Payment method',
  'Payment time',
  'Status',
];

export class SunzeOrderParseError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SunzeOrderParseError';
    this.details = details;
  }
}

const toText = (value) => String(value ?? '').trim();

const normalizeHeader = (value) => toText(value).replace(/\s+/g, ' ');

const normalizeSourceLabel = (value) => toText(value).replace(/\s+/g, ' ');

export const parseTradeItemQuantity = (value) => {
  const source = normalizeSourceLabel(value);

  if (!source) {
    return 0;
  }

  return source.split(',').reduce((total, segment) => {
    const trimmed = segment.trim();
    if (!trimmed) {
      return total;
    }

    const quantityMatch = trimmed.match(/-(\d+)\s*$/);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;

    return total + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1);
  }, 0);
};

const parseCents = (value, columnName, rowNumber) => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const numberValue =
    typeof value === 'number' ? value : Number(String(value).replace(/[$,]/g, '').trim());

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new SunzeOrderParseError(`Invalid ${columnName} at row ${rowNumber}.`, {
      rowNumber,
      columnName,
    });
  }

  return Math.round(numberValue * 100);
};

const normalizePaymentMethod = (value, rowNumber) => {
  const source = normalizeSourceLabel(value);
  const normalized = source.toLowerCase();

  if (normalized === 'credit card' || normalized.includes('credit') || normalized.includes('card')) {
    return { paymentMethod: 'credit', sourcePaymentMethod: source };
  }

  if (normalized === 'coin + notes' || normalized.includes('coin') || normalized.includes('cash') || normalized.includes('note')) {
    return { paymentMethod: 'cash', sourcePaymentMethod: source };
  }

  if (normalized === 'no-pay' || normalized === 'no pay' || normalized === 'free') {
    return { paymentMethod: 'other', sourcePaymentMethod: source };
  }

  throw new SunzeOrderParseError(`Unknown payment method "${source}" at row ${rowNumber}.`, {
    rowNumber,
    sourcePaymentMethod: source,
  });
};

const normalizeStatus = (value, rowNumber) => {
  const source = normalizeSourceLabel(value);

  if (source.toLowerCase() !== 'payment success') {
    throw new SunzeOrderParseError(`Unknown order status "${source}" at row ${rowNumber}.`, {
      rowNumber,
      sourceStatus: source,
    });
  }

  return source;
};

const parsePaymentTime = (value, rowNumber) => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  const source = toText(value);
  const normalized = source.includes('/') ? source.replace(/\//g, '-') : source;
  const parsed = new Date(normalized);

  if (!source || !Number.isFinite(parsed.getTime())) {
    throw new SunzeOrderParseError(`Invalid payment time at row ${rowNumber}.`, {
      rowNumber,
    });
  }

  return parsed.toISOString();
};

const validateHeaders = (headers) => {
  const normalized = headers.map(normalizeHeader);
  const missing = SUNZE_ORDER_HEADERS.filter((header) => !normalized.includes(header));
  const unexpected = normalized.filter((header) => header && !SUNZE_ORDER_HEADERS.includes(header));

  if (missing.length || unexpected.length) {
    throw new SunzeOrderParseError('Sunze order export headers changed.', {
      expectedHeaders: SUNZE_ORDER_HEADERS,
      observedHeaders: normalized,
      missingHeaders: missing,
      unexpectedHeaders: unexpected,
    });
  }

  return Object.fromEntries(SUNZE_ORDER_HEADERS.map((header) => [header, normalized.indexOf(header)]));
};

export const parseSunzeOrderRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SunzeOrderParseError('Sunze order workbook is empty.');
  }

  const headerIndexes = validateHeaders(rows[0] ?? []);

  return rows
    .slice(1)
    .filter((row) => Array.isArray(row) && row.some((cell) => toText(cell) !== ''))
    .map((row, index) => {
      const rowNumber = index + 2;
      const cell = (header) => row[headerIndexes[header]];
      const sourceOrderNumber = toText(cell('Order number'));
      const tradeName = normalizeSourceLabel(cell('Trade name'));
      const machineCode = toText(cell('Machine code'));
      const machineName = toText(cell('Machine name'));
      const paymentTimeIso = parsePaymentTime(cell('Payment time'), rowNumber);
      const sourceStatus = normalizeStatus(cell('Status'), rowNumber);
      const { paymentMethod, sourcePaymentMethod } = normalizePaymentMethod(
        cell('Payment method'),
        rowNumber
      );

      if (!sourceOrderNumber) {
        throw new SunzeOrderParseError(`Missing order number at row ${rowNumber}.`, { rowNumber });
      }

      if (!machineCode) {
        throw new SunzeOrderParseError(`Missing machine code at row ${rowNumber}.`, { rowNumber });
      }

      return {
        sourceOrderNumber,
        tradeName,
        itemQuantity: parseTradeItemQuantity(tradeName),
        machineCode,
        machineName,
        orderAmountCents: parseCents(cell('Order amount'), 'Order amount', rowNumber),
        taxCents: parseCents(cell('Tax'), 'Tax', rowNumber),
        paymentMethod,
        sourcePaymentMethod,
        paymentTimeIso,
        saleDate: paymentTimeIso.slice(0, 10),
        sourceStatus,
      };
    });
};

export const parseSunzeOrderWorkbook = async (filePath) => {
  const rows = await readSheet(filePath, SUNZE_ORDER_SHEET);
  return parseSunzeOrderRows(rows);
};
