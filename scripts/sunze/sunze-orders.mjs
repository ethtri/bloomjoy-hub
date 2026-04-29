import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { unzipSync } from 'fflate';
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

const optionalOrderHeaders = new Set(['Affiliated merchant', 'Machine name']);

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

const pad2 = (value) => String(value).padStart(2, '0');

const workbookExtensions = new Set(['.xlsx', '.xlsm']);

const buildDateString = (year, month, day) =>
  `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;

const buildUtcIso = ({ year, month, day, hour = 0, minute = 0, second = 0 }) =>
  `${buildDateString(year, month, day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}.000Z`;

const isValidUtcDateTimeParts = ({ year, month, day, hour, minute, second }) => {
  if (
    ![year, month, day, hour, minute, second].every(Number.isFinite) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second
  );
};

const throwInvalidPaymentTime = (rowNumber) => {
  throw new SunzeOrderParseError(`Invalid payment time at row ${rowNumber}.`, {
    rowNumber,
  });
};

const normalizeTimezoneOffset = (value) => {
  const source = String(value ?? '');
  if (source.toUpperCase() === 'Z') return 'Z';
  return source.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
};

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
    const year = value.getUTCFullYear();
    const month = value.getUTCMonth() + 1;
    const day = value.getUTCDate();
    const hour = value.getUTCHours();
    const minute = value.getUTCMinutes();
    const second = value.getUTCSeconds();

    return {
      paymentTimeIso: buildUtcIso({ year, month, day, hour, minute, second }),
      saleDate: buildDateString(year, month, day),
    };
  }

  const source = toText(value);
  const timezoneDateMatch = source.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i
  );

  if (timezoneDateMatch) {
    const [
      ,
      yearRaw,
      monthRaw,
      dayRaw,
      hourRaw,
      minuteRaw,
      secondRaw = '0',
      fractionRaw = '',
      timezoneRaw,
    ] = timezoneDateMatch;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw);

    if (isValidUtcDateTimeParts({ year, month, day, hour, minute, second })) {
      const normalizedSource = `${buildDateString(year, month, day)}T${pad2(hour)}:${pad2(
        minute
      )}:${pad2(second)}${fractionRaw}${normalizeTimezoneOffset(timezoneRaw)}`;
      const parsed = new Date(normalizedSource);

      if (Number.isFinite(parsed.getTime())) {
        return {
          paymentTimeIso: parsed.toISOString(),
          saleDate: buildDateString(year, month, day),
        };
      }
    }

    throwInvalidPaymentTime(rowNumber);
  }

  const localDateMatch = source.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (localDateMatch) {
    const [, yearRaw, monthRaw, dayRaw, hourRaw = '0', minuteRaw = '0', secondRaw = '0'] =
      localDateMatch;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw);

    if (isValidUtcDateTimeParts({ year, month, day, hour, minute, second })) {
      return {
        paymentTimeIso: buildUtcIso({ year, month, day, hour, minute, second }),
        saleDate: buildDateString(year, month, day),
      };
    }

    throwInvalidPaymentTime(rowNumber);
  }

  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(source)) {
    throwInvalidPaymentTime(rowNumber);
  }

  const parsed = new Date(source);

  if (!source || !Number.isFinite(parsed.getTime())) {
    throwInvalidPaymentTime(rowNumber);
  }

  return {
    paymentTimeIso: parsed.toISOString(),
    saleDate: parsed.toISOString().slice(0, 10),
  };
};

const validateHeaders = (headers) => {
  const normalized = headers.map(normalizeHeader);
  const requiredHeaders = SUNZE_ORDER_HEADERS.filter((header) => !optionalOrderHeaders.has(header));
  const missing = requiredHeaders.filter((header) => !normalized.includes(header));
  const unexpected = normalized.filter((header) => header && !SUNZE_ORDER_HEADERS.includes(header));

  if (missing.length || unexpected.length) {
    throw new SunzeOrderParseError('Provider order export headers changed.', {
      expectedHeaders: SUNZE_ORDER_HEADERS,
      requiredHeaders,
      optionalHeaders: [...optionalOrderHeaders],
      observedHeaders: normalized,
      missingHeaders: missing,
      unexpectedHeaders: unexpected,
    });
  }

  return Object.fromEntries(SUNZE_ORDER_HEADERS.map((header) => [header, normalized.indexOf(header)]));
};

export const parseSunzeOrderRows = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SunzeOrderParseError('Provider order workbook is empty.');
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
      const { paymentTimeIso, saleDate } = parsePaymentTime(cell('Payment time'), rowNumber);
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
        saleDate,
        sourceStatus,
      };
    });
};

const isMissingOrderSheetError = (error) =>
  error instanceof Error && /Sheet "Order" not found/i.test(error.message);

const wrapWorkbookReadError = (error, filePath) =>
  new SunzeOrderParseError('Provider order workbook could not be read.', {
    fileName: basename(filePath),
    cause: error instanceof Error ? error.message : String(error),
  });

const parseSunzeOrderWorkbookFile = async (filePath) => {
  let rows;

  try {
    rows = await readSheet(filePath, SUNZE_ORDER_SHEET);
  } catch (error) {
    if (!isMissingOrderSheetError(error)) {
      throw wrapWorkbookReadError(error, filePath);
    }

    try {
      rows = await readSheet(filePath, 1);
    } catch (fallbackError) {
      throw wrapWorkbookReadError(fallbackError, filePath);
    }
  }

  return parseSunzeOrderRows(rows);
};

const safeTempWorkbookName = (entryName, index) => {
  const fileName = basename(entryName).replace(/[^A-Za-z0-9._-]/g, '_') || `orders-${index}.xlsx`;
  const extension = extname(fileName).toLowerCase();
  return workbookExtensions.has(extension) ? `${index}-${fileName}` : `${index}-${fileName}.xlsx`;
};

const parseSunzeOrderZip = async (filePath) => {
  const source = await readFile(filePath);
  let entries;

  try {
    entries = unzipSync(new Uint8Array(source));
  } catch (error) {
    throw new SunzeOrderParseError('Provider order zip is invalid.', {
      fileName: basename(filePath),
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const workbookEntries = Object.entries(entries)
    .filter(([entryName]) => {
      const name = entryName.replace(/\\/g, '/');
      const fileName = basename(name);
      return workbookExtensions.has(extname(fileName).toLowerCase()) && !fileName.startsWith('~$');
    })
    .sort(([left], [right]) => left.localeCompare(right));

  if (workbookEntries.length === 0) {
    throw new SunzeOrderParseError('Provider order zip contains no workbook files.', {
      fileName: basename(filePath),
    });
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sunze-order-zip-'));
  const rows = [];

  try {
    for (let index = 0; index < workbookEntries.length; index += 1) {
      const [entryName, bytes] = workbookEntries[index];
      const tempPath = join(tempRoot, safeTempWorkbookName(entryName, index + 1));

      await writeFile(tempPath, bytes);

      try {
        rows.push(...(await parseSunzeOrderWorkbookFile(tempPath)));
      } catch (error) {
        if (error instanceof SunzeOrderParseError) {
          throw new SunzeOrderParseError(`${error.message} Zip entry: ${entryName}.`, {
            ...error.details,
            zipEntry: entryName,
          });
        }
        throw error;
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (rows.length === 0) {
    throw new SunzeOrderParseError('Provider order zip contains no order rows.', {
      fileName: basename(filePath),
      workbookCount: workbookEntries.length,
    });
  }

  return rows;
};

export const parseSunzeOrderWorkbook = async (filePath) => {
  if (extname(filePath).toLowerCase() === '.zip') {
    return parseSunzeOrderZip(filePath);
  }

  return parseSunzeOrderWorkbookFile(filePath);
};

export const assertSunzeOrderRowsWithinWindow = (rows, { windowStart, windowEnd } = {}) => {
  if (!windowStart || !windowEnd) return rows;

  const outsideRow = rows.find(
    (row) => row.saleDate && (row.saleDate < windowStart || row.saleDate > windowEnd)
  );

  if (outsideRow) {
    throw new SunzeOrderParseError('Provider order export includes rows outside the selected date window.', {
      windowStart,
      windowEnd,
      observedSaleDate: outsideRow.saleDate,
      machineCode: outsideRow.machineCode,
    });
  }

  return rows;
};

export const summarizeSunzeOrderRows = (rows) => {
  const saleDates = rows.map((row) => row.saleDate).filter(Boolean).sort();

  return {
    rowCount: rows.length,
    machineCount: new Set(rows.map((row) => row.machineCode).filter(Boolean)).size,
    orderAmountCents: rows.reduce((sum, row) => sum + Number(row.orderAmountCents ?? 0), 0),
    windowStart: saleDates[0] ?? null,
    windowEnd: saleDates[saleDates.length - 1] ?? null,
  };
};
