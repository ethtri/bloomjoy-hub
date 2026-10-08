import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import {
  DTM_HEADERS,
  DTM_OPTIONAL_HEADERS,
  canonicalNayaxDtmRowHash,
  canonicalNayaxRefundEventHash,
  canonicalNayaxSourceOrderHash,
  parseDtmTimestamp,
  parseDtmWorkbook,
  inspectDtmTaxEvidence,
  parseMoneyCents,
  summarizeDtmRecords,
} from './dtm-history.mjs';

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const rowXml = (values) => `<x:row>${values.map((value) =>
  `<x:c t="inlineStr"><x:is><x:t>${escapeXml(value)}</x:t></x:is></x:c>`
).join('')}</x:row>`;

const sparseRowXml = (values) => `<x:row>${values.map(({ column, value }) =>
  `<x:c r="${column}" t="inlineStr"><x:is><x:t>${escapeXml(value)}</x:t></x:is></x:c>`
).join('')}</x:row>`;

const sourceRow = (overrides = {}) => ({
  'Site ID': '4',
  'Transaction ID': '7000000001',
  'Payment Method ID': '1',
  Currency: 'USD',
  'Machine Name': 'Example venue',
  'Authorization Value': '11.00',
  'Transaction Duration': '1',
  'Settlement Value (Vend Price)': '10.00',
  'Product Selection Info': '',
  Brand: '',
  'Payment Method (Source)': 'CLS',
  'Card Number': '',
  'Product Code in Map': '',
  'Authrization RRN': '',
  'Machine Authorization Time': '1/2/2025 3:04:05 PM',
  'Machine Settlement Time': '1/2/2025 3:04:06 PM',
  'Updated Date and Time (GMT)': '2025-01-02 23:04:07',
  'Official Acquirer': '',
  'Card Type': 'CLS',
  'Card BIN': '',
  'Transaction Status ID': '12',
  'Transaction Type ID': '0',
  'Billing Provider': '',
  'Batch Ref Number': '',
  'Acquirer Transaction ID': '',
  'Credit Card Type': '',
  'Refund Amount': '',
  'Refund Request By': '',
  'Machine Group': 'Example group',
  ...overrides,
});

const workbook = (records, headers = DTM_HEADERS, { includeFooter = true } = {}) => {
  const footer = Object.fromEntries(headers.map((header) => [header, '']));
  footer['Authorization Value'] = '0';
  footer['Settlement Value (Vend Price)'] = '0';
  const rows = [
    rowXml(['Dynamic Transactions Monitor']),
    rowXml(headers.map((header) => `${header}  `)),
    ...records.map((record) => rowXml(headers.map((header) => record[header] ?? ''))),
    ...(includeFooter ? [rowXml(headers.map((header) => footer[header] ?? ''))] : []),
  ].join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${rows}</x:sheetData></x:worksheet>`;
  return zipSync({
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  });
};

test('tax discovery does not turn absent tax columns or zero source values into evidence', () => {
  const ordinary = inspectDtmTaxEvidence(workbook([sourceRow()]));
  assert.equal(ordinary.status, 'no_explicit_tax_columns');
  assert.deepEqual(ordinary.taxColumns, []);
  const bytes = workbook([sourceRow({ Tax: '0', 'Convenience Fee': '7', 'Card Number': 'PRIVATE-PAYMENT' })],
    [...DTM_HEADERS, 'Tax', 'Convenience Fee']);
  const audit = inspectDtmTaxEvidence(bytes);
  assert.equal(audit.status, 'tax_columns_require_source_contract');
  assert.deepEqual(audit.taxColumns, ['Tax']);
  assert.deepEqual(audit.extraChargeColumns, ['Convenience Fee']);
  assert.equal(audit.fileDigest.length, 64);
  assert.equal(JSON.stringify(audit).includes('PRIVATE-PAYMENT'), false);
  assert.equal('ratePercent' in audit, false);
  assert.equal('taxCents' in audit, false);
  // Discovery does not broaden the approved money importer contract.
  assert.throws(() => parseDtmWorkbook(bytes), /nayax_dtm_contract_invalid/);
});

test('tax discovery rejects missing and duplicate identity headers', () => {
  assert.throws(() => inspectDtmTaxEvidence(workbook([sourceRow()], ['Tax'])), /nayax_dtm_contract_invalid/);
  assert.throws(() => inspectDtmTaxEvidence(workbook([sourceRow()], [...DTM_HEADERS, 'Tax', 'Tax'])), /nayax_dtm_contract_invalid/);
});

test('parses raw OpenXML without loading malformed workbook styles', () => {
  const parsed = parseDtmWorkbook(workbook([
    sourceRow(),
    sourceRow({
      'Transaction ID': '7000000002',
      'Authorization Value': '10.000000000000002',
      'Settlement Value (Vend Price)': '10.000000000000002',
      'Transaction Status ID': '62',
      'Refund Amount': '10.00',
    }),
    sourceRow({
      'Transaction ID': '7000000003',
      'Authorization Value': '-10.00',
      'Settlement Value (Vend Price)': '-10.00',
      'Transaction Status ID': '',
      'Transaction Type ID': '1',
      'Refund Amount': '',
      'Machine Authorization Time': '2025-01-04 01:02:03',
      'Machine Settlement Time': '2025-01-04 01:02:03',
    }),
    sourceRow({
      'Transaction ID': '7000000004',
      'Settlement Value (Vend Price)': '',
      'Transaction Status ID': '21',
    }),
  ]));

  assert.equal(parsed.rowCount, 4);
  assert.equal(parsed.records[0].authorizationAmountCents, 1100);
  assert.equal(parsed.records[0].settlementAmountCents, 1000);
  assert.equal(parsed.records[0].machineAuthorizedAt, '2025-01-02T15:04:05');
  assert.equal(parsed.records[0].updatedAt, '2025-01-02T23:04:07Z');
  assert.equal(parsed.records[1].refundAmountCents, 1000);
  assert.equal(parsed.records[2].providerStatus, null);
  assert.equal(parsed.records[2].providerType, 1);
  assert.equal(parsed.records[2].settlementAmountCents, -1000);
  assert.equal(parsed.records[3].settlementAmountCents, null);

  assert.deepEqual(summarizeDtmRecords(parsed.records), {
    rowCount: 4,
    authorizationCents: 2200,
    settlementCents: 1000,
    refundCents: 1000,
    refundRows: 1,
    blankRefundRows: 3,
    positiveSettlementRows: 2,
    zeroSettlementRows: 1,
    negativeSettlementRows: 1,
    currencies: { USD: 4 },
    statusCounts: { 12: 1, 21: 1, 62: 1, blank: 1 },
    typeCounts: { 0: 3, 1: 1 },
    distinctMachineLabels: 1,
    distinctTransactionIdentities: 4,
    duplicateIdentityGroups: 0,
    repeatedIdenticalRows: 0,
  });
});

test('keeps separate negative events even when Nayax reuses a transaction ID', () => {
  const parsed = parseDtmWorkbook(workbook([
    sourceRow({
      'Transaction ID': '7000000099',
      'Authorization Value': '-10.00',
      'Settlement Value (Vend Price)': '-10.00',
      'Transaction Status ID': '',
      'Transaction Type ID': '1',
      'Machine Settlement Time': '2025-01-04 01:02:03',
    }),
    sourceRow({
      'Transaction ID': '7000000099',
      'Authorization Value': '-10.00',
      'Settlement Value (Vend Price)': '-10.00',
      'Transaction Status ID': '',
      'Transaction Type ID': '1',
      'Machine Settlement Time': '2025-03-04 01:02:03',
    }),
  ]));
  const summary = summarizeDtmRecords(parsed.records);
  assert.equal(summary.distinctTransactionIdentities, 1);
  assert.equal(summary.duplicateIdentityGroups, 1);
  assert.equal(summary.negativeSettlementRows, 2);
});

test('accepts stable provider identity columns and reproduces the scheduled-report key', () => {
  const headers = [...DTM_HEADERS, ...DTM_OPTIONAL_HEADERS];
  const parsed = parseDtmWorkbook(workbook([
    sourceRow({
      'Actor ID': '2000000001',
      'Machine ID': '3000000001',
      'Settlement Date and Time (GMT)': '2025-01-02 23:04:06',
      'Original Transaction ID': '6999999999',
      'Is Transaction Refunded': 'Yes',
      'Refund Request Date': '1/3/2025 1:02:03 PM',
      'Refund Approval Date': '1/3/2025 1:03:04 PM',
    }),
  ], headers));
  const row = parsed.records[0];
  assert.equal(row.actorId, '2000000001');
  assert.equal(row.providerMachineId, '3000000001');
  assert.equal(row.providerSettledAt, '2025-01-02T23:04:06Z');
  assert.equal(row.originalTransactionId, '6999999999');
  assert.equal(row.isTransactionRefunded, true);
  assert.equal(
    canonicalNayaxSourceOrderHash(row),
    'e88d44bfaa90e94689a27292572605b7c47f740a65dcc6f4928e1167e8a4aae8',
  );
  assert.match(canonicalNayaxDtmRowHash(row), /^[a-f0-9]{64}$/);
});

test('refund event identity uses the original ID and UTC event time', () => {
  const first = {
    ...parseDtmWorkbook(workbook([sourceRow({
      'Actor ID': '2000000001',
      'Machine ID': '3000000001',
      'Original Transaction ID': '6999999999',
      'Settlement Date and Time (GMT)': '2025-01-04 09:02:03',
      'Transaction Status ID': '',
      'Transaction Type ID': '1',
      'Authorization Value': '-10.00',
      'Settlement Value (Vend Price)': '-10.00',
    })], [...DTM_HEADERS, ...DTM_OPTIONAL_HEADERS])).records[0],
  };
  const later = { ...first, providerSettledAt: '2025-03-04T09:02:03Z' };
  const otherOriginal = { ...first, originalTransactionId: '6999999998' };
  assert.notEqual(canonicalNayaxRefundEventHash(first), canonicalNayaxRefundEventHash(later));
  assert.notEqual(canonicalNayaxRefundEventHash(first), canonicalNayaxRefundEventHash(otherOriginal));
});

test('uses OpenXML cell references when blank cells are omitted', () => {
  const headers = [...DTM_HEADERS, ...DTM_OPTIONAL_HEADERS];
  const rows = [
    sparseRowXml([{ column: 'A1', value: 'Dynamic Transactions Monitor' }]),
    rowXml(headers),
    sparseRowXml([
      { column: 'A3', value: '4' },
      { column: 'B3', value: '7000000001' },
      { column: 'D3', value: 'USD' },
      { column: 'E3', value: 'Example venue' },
      { column: 'F3', value: '10.00' },
      { column: 'H3', value: '10.00' },
      { column: 'O3', value: '1/2/2025 3:04:05 PM' },
      { column: 'P3', value: '1/2/2025 3:04:06 PM' },
      { column: 'Q3', value: '2025-01-02 23:04:07' },
      { column: 'U3', value: '12' },
      { column: 'V3', value: '0' },
      { column: 'AC3', value: 'Example group' },
    ]),
  ].join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${rows}</x:sheetData></x:worksheet>`;
  const bytes = zipSync({
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  });
  assert.equal(parseDtmWorkbook(bytes).records[0].paymentMethodId, null);
  assert.equal(parseDtmWorkbook(bytes).records[0].actorId, null);
});

test('rejects unknown headers, non-USD rows, invalid timestamps and sub-cent amounts', () => {
  assert.throws(
    () => parseDtmWorkbook(workbook([sourceRow()], DTM_HEADERS.slice(0, -1))),
    /nayax_dtm_contract_invalid/,
  );
  assert.throws(
    () => parseDtmWorkbook(workbook([sourceRow({ Currency: 'CAD' })])),
    /nayax_dtm_contract_invalid/,
  );
  assert.throws(() => parseDtmTimestamp('2025-02-30 01:02:03'), /nayax_dtm_contract_invalid/);
  assert.throws(() => parseDtmTimestamp('1/2/2025 0:04:05 PM'), /nayax_dtm_contract_invalid/);
  assert.throws(() => parseDtmTimestamp('1/2/2025 13:04:05 PM'), /nayax_dtm_contract_invalid/);
  assert.throws(() => parseMoneyCents('1.001'), /nayax_dtm_contract_invalid/);
});

test('rejects an unrecognized final non-transaction row instead of dropping it', () => {
  const headers = [...DTM_HEADERS];
  const malformed = sourceRow({ 'Transaction ID': 'not-a-transaction', 'Machine Name': 'bad final row' });
  assert.throws(
    () => parseDtmWorkbook(workbook([sourceRow(), malformed], headers, { includeFooter: false })),
    /nayax_dtm_contract_invalid/,
  );
});

test('rejects a footer with non-money text in a control total', () => {
  const headers = [...DTM_HEADERS];
  const rows = [
    rowXml(['Dynamic Transactions Monitor']),
    rowXml(headers),
    rowXml(headers.map((header) => sourceRow()[header] ?? '')),
    rowXml(headers.map((header) => header === 'Currency'
      ? 'Total'
      : header === 'Settlement Value (Vend Price)'
        ? 'not-money'
        : '')),
  ].join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${rows}</x:sheetData></x:worksheet>`;
  const bytes = zipSync({
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  });
  assert.throws(() => parseDtmWorkbook(bytes), /nayax_dtm_contract_invalid/);
});
