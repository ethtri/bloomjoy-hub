import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';

export const DTM_HEADERS = [
  'Site ID',
  'Transaction ID',
  'Payment Method ID',
  'Currency',
  'Machine Name',
  'Authorization Value',
  'Transaction Duration',
  'Settlement Value (Vend Price)',
  'Product Selection Info',
  'Brand',
  'Payment Method (Source)',
  'Card Number',
  'Product Code in Map',
  'Authrization RRN',
  'Machine Authorization Time',
  'Machine Settlement Time',
  'Updated Date and Time (GMT)',
  'Official Acquirer',
  'Card Type',
  'Card BIN',
  'Transaction Status ID',
  'Transaction Type ID',
  'Billing Provider',
  'Batch Ref Number',
  'Acquirer Transaction ID',
  'Credit Card Type',
  'Refund Amount',
  'Refund Request By',
  'Machine Group',
];

export const DTM_OPTIONAL_HEADERS = [
  'Actor ID',
  'Machine ID',
  'Settlement Date and Time (GMT)',
  'Original Transaction ID',
  'Is Transaction Refunded',
  'Refund Request Date',
  'Refund Approval Date',
];

const REQUIRED_HEADERS = [
  'Site ID',
  'Transaction ID',
  'Currency',
  'Machine Name',
  'Authorization Value',
  'Settlement Value (Vend Price)',
  'Machine Settlement Time',
  'Updated Date and Time (GMT)',
  'Transaction Status ID',
  'Transaction Type ID',
  'Refund Amount',
  'Machine Group',
];

const invalid = (detail) => {
  const error = new Error('nayax_dtm_contract_invalid');
  error.detail = detail;
  return error;
};

const decodeXml = (value) => value
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&amp;', '&')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));

const xmlTexts = (xml) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)]
  .map((match) => decodeXml(match[1]))
  .join('');

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:\w+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?si>/g)]
    .map((match) => xmlTexts(match[1]));
}

function parseCell(cellXml, sharedStrings) {
  const type = /\bt="([^"]+)"/.exec(cellXml)?.[1] ?? 'n';
  if (type === 'inlineStr') return xmlTexts(cellXml);
  const raw = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cellXml)?.[1] ?? '';
  if (type === 's') {
    if (!/^\d+$/.test(raw) || Number(raw) >= sharedStrings.length) {
      throw invalid('shared_string_reference');
    }
    return sharedStrings[Number(raw)];
  }
  return decodeXml(raw);
}

function columnIndex(reference) {
  const letters = /^([A-Z]+)\d+$/i.exec(reference)?.[1]?.toUpperCase();
  if (!letters) return null;
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseRows(sheetXml, sharedStrings) {
  return [...sheetXml.matchAll(/<(?:\w+:)?row(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?row>/g)]
    .map((rowMatch) => {
      const values = [];
      let nextIndex = 0;
      for (const cellMatch of rowMatch[1].matchAll(
        /<(?:\w+:)?c(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/(?:\w+:)?c>)/g,
      )) {
        const explicitIndex = columnIndex(/\br="([^"]+)"/.exec(cellMatch[0])?.[1] ?? '');
        const index = explicitIndex ?? nextIndex;
        values[index] = parseCell(cellMatch[0], sharedStrings);
        nextIndex = index + 1;
      }
      return values;
    });
}

const cleanHeader = (value) => value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();

export const normalizedMachineNameHash = (value) => createHash('sha256')
  .update(String(value).trim().toLowerCase())
  .digest('hex');

export const canonicalNayaxSourceOrderHash = ({ actorId, siteId, transactionId }) => {
  const actor = requireIdentifier(actorId, 'actor', 30);
  const site = requireIdentifier(siteId, 'site', 30);
  const transaction = requireIdentifier(transactionId, 'transaction', 30);
  return createHash('sha256')
    .update(`nayax:${actor}:${site}:${transaction}`)
    .digest('hex');
};

const digestParts = (prefix, parts) => createHash('sha256')
  .update(`${prefix}${parts.map((value) => value ?? '').join('\u001f')}`)
  .digest('hex');

export const canonicalNayaxDtmRowHash = (row) => digestParts('nayax-dtm-row:v1:', [
  row.actorId,
  row.providerMachineId,
  row.siteId,
  row.transactionId,
  row.originalTransactionId,
  row.currencyCode,
  row.authorizationAmountCents,
  row.settlementAmountCents,
  row.providerSettledAt,
  row.machineSettledAt,
  row.updatedAt,
  row.providerStatus,
  row.providerType,
  row.refundAmountCents,
  row.isTransactionRefunded,
  row.refundRequestedAt,
  row.refundApprovedAt,
]);

export const canonicalNayaxRefundEventHash = (row) => {
  const actor = requireIdentifier(row.actorId, 'actor', 30);
  const machine = requireIdentifier(row.providerMachineId, 'machine', 30);
  const transaction = requireIdentifier(row.transactionId, 'transaction', 30);
  const original = requireIdentifier(row.originalTransactionId, 'original_transaction', 30);
  const occurredAt = parseDtmTimestamp(row.providerSettledAt?.replace(/Z$/, '') ?? '', { utc: true });
  return digestParts('nayax-refund-event:v1:', [
    actor,
    machine,
    transaction,
    original,
    occurredAt,
  ]);
};

export const canonicalNayaxRefundAnnotationHash = (row) => {
  const actor = requireIdentifier(row.actorId, 'actor', 30);
  const machine = requireIdentifier(row.providerMachineId, 'machine', 30);
  const original = requireIdentifier(row.transactionId, 'transaction', 30);
  if (!Number.isSafeInteger(row.refundAmountCents) || row.refundAmountCents <= 0) {
    throw invalid('refund_amount');
  }
  const approvedAt = parseDtmTimestamp(row.refundApprovedAt ?? '');
  return digestParts('nayax-refund-annotation:v1:', [
    actor,
    machine,
    original,
    row.refundAmountCents,
    approvedAt,
  ]);
};

export function parseMoneyCents(value, { allowBlank = false } = {}) {
  const text = String(value ?? '').trim();
  if (allowBlank && text === '') return null;
  const match = /^(-?)(\d{1,9})(?:\.(\d{1,16}))?$/.exec(text);
  if (!match) throw invalid('money');
  const numeric = Number(text);
  const cents = Math.round(numeric * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(numeric * 100 - cents) > 0.000001) {
    throw invalid('money_range');
  }
  return cents;
}

export function parseDtmTimestamp(value, { utc = false, allowBlank = false } = {}) {
  const text = String(value ?? '').trim();
  if (allowBlank && text === '') return null;
  let year;
  let month;
  let day;
  let hour;
  let minute;
  let second;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (us) {
    [, month, day, year, hour, minute, second] = us;
    if (Number(hour) < 1 || Number(hour) > 12) throw invalid('timestamp_range');
    hour = String((Number(hour) % 12) + (us[7].toUpperCase() === 'PM' ? 12 : 0));
  } else if (iso) {
    [, year, month, day, hour, minute, second] = iso;
  } else {
    throw invalid('timestamp');
  }
  const normalized = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:${second}`;
  const date = new Date(`${normalized}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== normalized) {
    throw invalid('timestamp_range');
  }
  return utc ? `${normalized}Z` : normalized;
}

const requireIdentifier = (value, name, max = 64) => {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || text.length > max) throw invalid(name);
  return text;
};

const nullableIdentifier = (value, name, max = 64) => {
  const text = String(value ?? '').trim();
  return text ? requireIdentifier(text, name, max) : null;
};

const nullableBoolean = (value, name) => {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (['true', 'yes', '1'].includes(text)) return true;
  if (['false', 'no', '0'].includes(text)) return false;
  throw invalid(name);
};

export function normalizeDtmRow(raw) {
  const currencyCode = raw['Currency'].trim().toUpperCase();
  if (currencyCode !== 'USD') throw invalid('currency');
  const machineName = raw['Machine Name'].trim();
  const machineGroup = raw['Machine Group'].trim();
  if (!machineName || machineName.length > 200 || !machineGroup || machineGroup.length > 200) {
    throw invalid('machine_identity');
  }
  const statusId = nullableIdentifier(raw['Transaction Status ID'], 'status', 9);
  const typeId = nullableIdentifier(raw['Transaction Type ID'], 'type', 9);
  return {
    actorId: nullableIdentifier(raw['Actor ID'], 'actor', 30),
    providerMachineId: nullableIdentifier(raw['Machine ID'], 'machine', 30),
    siteId: requireIdentifier(raw['Site ID'], 'site', 30),
    transactionId: requireIdentifier(raw['Transaction ID'], 'transaction', 30),
    paymentMethodId: nullableIdentifier(raw['Payment Method ID'], 'payment_method', 64),
    currencyCode,
    machineName,
    machineGroup,
    authorizationAmountCents: parseMoneyCents(raw['Authorization Value'], { allowBlank: true }),
    settlementAmountCents: parseMoneyCents(raw['Settlement Value (Vend Price)'], { allowBlank: true }),
    refundAmountCents: parseMoneyCents(raw['Refund Amount'], { allowBlank: true }),
    machineAuthorizedAt: parseDtmTimestamp(raw['Machine Authorization Time'], { allowBlank: true }),
    machineSettledAt: parseDtmTimestamp(raw['Machine Settlement Time'], { allowBlank: true }),
    providerSettledAt: parseDtmTimestamp(raw['Settlement Date and Time (GMT)'], {
      utc: true,
      allowBlank: true,
    }),
    updatedAt: parseDtmTimestamp(raw['Updated Date and Time (GMT)'], { utc: true }),
    originalTransactionId: nullableIdentifier(
      raw['Original Transaction ID'],
      'original_transaction',
      30,
    ),
    isTransactionRefunded: nullableBoolean(raw['Is Transaction Refunded'], 'is_refunded'),
    refundRequestedAt: parseDtmTimestamp(raw['Refund Request Date'], { allowBlank: true }),
    refundApprovedAt: parseDtmTimestamp(raw['Refund Approval Date'], { allowBlank: true }),
    providerStatus: statusId === null ? null : Number(statusId),
    providerType: typeId === null ? null : Number(typeId),
  };
}

function readDtmRows(bytes) {
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw invalid('zip');
  }
  const decoder = new TextDecoder();
  const sheetBytes = files['xl/worksheets/sheet1.xml'];
  if (!sheetBytes) throw invalid('worksheet');
  const sharedStrings = parseSharedStrings(
    files['xl/sharedStrings.xml'] ? decoder.decode(files['xl/sharedStrings.xml']) : '',
  );
  const rows = parseRows(decoder.decode(sheetBytes), sharedStrings);
  if (rows.length < 3) throw invalid('rows');
  return rows;
}

// Discovery only: a column name cannot establish its amount basis, effective
// dates or a zero-tax exemption. Never return private row values from this audit.
export function inspectDtmTaxEvidence(bytes) {
  const rows = readDtmRows(bytes);
  const headers = rows[1].map(cleanHeader);
  if (!headers.includes('Transaction ID') || new Set(headers).size !== headers.length) {
    throw invalid('headers');
  }
  const taxColumns = headers.filter(header => /\b(tax|vat|gst|hst)\b/i.test(header));
  const extraChargeColumns = headers.filter(header => /extra.?charge|surcharge|convenience.?fee/i.test(header));
  return {
    fileDigest: createHash('sha256').update(bytes).digest('hex'),
    columnCount: headers.length,
    taxColumns,
    extraChargeColumns,
    status: taxColumns.length ? 'tax_columns_require_source_contract' : 'no_explicit_tax_columns',
  };
}

export function parseDtmWorkbook(bytes) {
  const rows = readDtmRows(bytes);
  const headers = rows[1].map(cleanHeader);
  const supportedHeaders = new Set([...DTM_HEADERS, ...DTM_OPTIONAL_HEADERS]);
  if (new Set(headers).size !== headers.length ||
      REQUIRED_HEADERS.some((header) => !headers.includes(header)) ||
      headers.some((header) => !supportedHeaders.has(header))) {
    throw invalid('headers');
  }
  const dataRows = rows.slice(2);
  const footer = dataRows.at(-1);
  const transactionIndex = headers.indexOf('Transaction ID');
  const footerValues = footer
    ? Object.fromEntries(headers.map((header, index) => [header, String(footer[index] ?? '').trim()]))
    : null;
  const footerAllowedValues = new Set([
    'Currency',
    'Authorization Value',
    'Settlement Value (Vend Price)',
    'Refund Amount',
  ]);
  let footerMoneyValid = true;
  try {
    for (const header of ['Authorization Value', 'Settlement Value (Vend Price)', 'Refund Amount']) {
      parseMoneyCents(footerValues?.[header], { allowBlank: true });
    }
  } catch {
    footerMoneyValid = false;
  }
  const hasRecognizedFooter = footerValues &&
    footerValues['Transaction ID'] === '' &&
    ['', 'USD', 'Total'].includes(footerValues.Currency) &&
    footerMoneyValid &&
    Object.entries(footerValues).every(([header, value]) => value === '' || footerAllowedValues.has(header)) &&
    ['Authorization Value', 'Settlement Value (Vend Price)', 'Refund Amount']
      .some((header) => footerValues[header] !== '');
  if (footer && !/^\d+$/.test(String(footer[transactionIndex] ?? '').trim()) && !hasRecognizedFooter) {
    throw invalid('footer');
  }
  const records = (hasRecognizedFooter ? dataRows.slice(0, -1) : dataRows).map((values) => {
    if (values.length > headers.length) throw invalid('column_count');
    const raw = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    return normalizeDtmRow(raw);
  });
  return {
    fileDigest: createHash('sha256').update(bytes).digest('hex'),
    title: cleanHeader(rows[0].join(' ')),
    rowCount: records.length,
    records,
  };
}

export function summarizeDtmRecords(records) {
  const byStatus = {};
  const byType = {};
  let authorizationCents = 0;
  let settlementCents = 0;
  let refundCents = 0;
  let refundRows = 0;
  let blankRefundRows = 0;
  let positiveSettlementRows = 0;
  let zeroSettlementRows = 0;
  let negativeSettlementRows = 0;
  const currencies = {};
  const machineKeys = new Set();
  const identitySignatures = new Map();
  for (const row of records) {
    const statusKey = row.providerStatus === null ? 'blank' : row.providerStatus;
    const typeKey = row.providerType === null ? 'blank' : row.providerType;
    byStatus[statusKey] = (byStatus[statusKey] ?? 0) + 1;
    byType[typeKey] = (byType[typeKey] ?? 0) + 1;
    currencies[row.currencyCode] = (currencies[row.currencyCode] ?? 0) + 1;
    authorizationCents += row.authorizationAmountCents ?? 0;
    settlementCents += row.settlementAmountCents ?? 0;
    if (row.refundAmountCents === null) blankRefundRows += 1;
    else {
      refundRows += 1;
      refundCents += row.refundAmountCents;
    }
    if ((row.settlementAmountCents ?? 0) > 0) positiveSettlementRows += 1;
    else if ((row.settlementAmountCents ?? 0) < 0) negativeSettlementRows += 1;
    else zeroSettlementRows += 1;
    machineKeys.add(`${row.machineGroup}\u0000${row.machineName}`);
    const identity = `${row.machineGroup}\u0000${row.siteId}\u0000${row.transactionId}`;
    const signature = JSON.stringify(row);
    const signatures = identitySignatures.get(identity) ?? new Set();
    signatures.add(signature);
    identitySignatures.set(identity, signatures);
  }
  const duplicateIdentityGroups = [...identitySignatures.values()].filter((values) => values.size > 1).length;
  const repeatedIdenticalRows = records.length - identitySignatures.size -
    [...identitySignatures.values()].reduce((total, values) => total + Math.max(values.size - 1, 0), 0);
  return {
    rowCount: records.length,
    authorizationCents,
    settlementCents,
    refundCents,
    refundRows,
    blankRefundRows,
    positiveSettlementRows,
    zeroSettlementRows,
    negativeSettlementRows,
    currencies,
    statusCounts: byStatus,
    typeCounts: byType,
    distinctMachineLabels: machineKeys.size,
    distinctTransactionIdentities: identitySignatures.size,
    duplicateIdentityGroups,
    repeatedIdenticalRows,
  };
}
