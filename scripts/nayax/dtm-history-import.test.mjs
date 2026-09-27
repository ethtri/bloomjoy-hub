import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { DTM_HEADERS, DTM_OPTIONAL_HEADERS } from './dtm-history.mjs';
import { buildDtmHistoryImport } from './dtm-history-import.mjs';

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const rowXml = (values) => `<x:row>${values.map((value) =>
  `<x:c t="inlineStr"><x:is><x:t>${escapeXml(value)}</x:t></x:is></x:c>`
).join('')}</x:row>`;

const sourceRow = (overrides = {}) => ({
  'Site ID': '4',
  'Transaction ID': '7000000001',
  'Payment Method ID': '1',
  Currency: 'USD',
  'Machine Name': 'Example venue',
  'Authorization Value': '11.00',
  'Settlement Value (Vend Price)': '10.00',
  'Machine Authorization Time': '1/2/2025 3:04:05 PM',
  'Machine Settlement Time': '1/2/2025 3:04:06 PM',
  'Settlement Date and Time (GMT)': '2025-01-02 23:04:06',
  'Updated Date and Time (GMT)': '2025-01-02 23:04:07',
  'Transaction Status ID': '12',
  'Transaction Type ID': '0',
  'Refund Amount': '',
  'Machine Group': 'Example group',
  'Actor ID': '2000000001',
  'Machine ID': '3000000001',
  'Original Transaction ID': '',
  'Is Transaction Refunded': '',
  'Refund Request Date': '',
  'Refund Approval Date': '',
  ...overrides,
});

const workbook = (records) => {
  const headers = [...DTM_HEADERS, ...DTM_OPTIONAL_HEADERS];
  const footer = Object.fromEntries(headers.map((header) => [header, '']));
  footer.Currency = 'Total';
  footer['Authorization Value'] = records.reduce(
    (sum, row) => sum + Number(row['Authorization Value'] || 0),
    0,
  ).toFixed(2);
  footer['Settlement Value (Vend Price)'] = records.reduce(
    (sum, row) => sum + Number(row['Settlement Value (Vend Price)'] || 0),
    0,
  ).toFixed(2);
  footer['Refund Amount'] = records.reduce(
    (sum, row) => sum + Number(row['Refund Amount'] || 0),
    0,
  ).toFixed(2);
  const rows = [
    rowXml(['Dynamic Transactions Monitor']),
    rowXml(headers),
    ...records.map((record) => rowXml(headers.map((header) => record[header] ?? ''))),
    rowXml(headers.map((header) => footer[header] ?? '')),
  ].join('');
  return zipSync({
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${rows}</x:sheetData></x:worksheet>`),
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  });
};

test('builds canonical sales and once-only native or approved-annotation refunds', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nayax-dtm-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'nayax_dynamic_transactions_2025_full_account_stable_ids.xlsx');
  await writeFile(filename, workbook([
    sourceRow(),
    sourceRow({
      'Transaction ID': '7000000002',
      'Transaction Status ID': '62',
      'Refund Amount': '10.00',
      'Is Transaction Refunded': 'Yes',
      'Refund Request Date': '1/3/2025 1:00:00 PM',
      'Refund Approval Date': '1/3/2025 1:02:03 PM',
    }),
    sourceRow({
      'Transaction ID': '7000000003',
      'Original Transaction ID': '7000000002',
      'Transaction Status ID': '',
      'Transaction Type ID': '1',
      'Authorization Value': '-10.00',
      'Settlement Value (Vend Price)': '-10.00',
      'Machine Settlement Time': '1/3/2025 1:02:03 PM',
      'Settlement Date and Time (GMT)': '2025-01-03 21:02:03',
      'Updated Date and Time (GMT)': '2025-01-03 21:02:03',
    }),
    sourceRow({
      'Transaction ID': '7000000004',
      'Transaction Status ID': '62',
      'Refund Amount': '10.00',
      'Is Transaction Refunded': 'Yes',
      'Refund Request Date': '1/4/2025 1:00:00 PM',
      'Refund Approval Date': '1/4/2025 1:02:03 PM',
    }),
    sourceRow({
      'Transaction ID': '7000000005',
      'Transaction Status ID': '63',
      'Refund Amount': '10.00',
      'Refund Request Date': '1/5/2025 1:00:00 PM',
      'Refund Approval Date': '',
      'Machine Name': 'Relocation candidate',
    }),
  ]));

  const [built] = await buildDtmHistoryImport([filename], {
    stagedMachineNames: ['Relocation candidate'],
    inactiveHistoricalMachineNames: ['Example venue'],
  });
  assert.equal(built.receipt.rowCount, 5);
  assert.equal(built.rows[0].machineSaleDate, '2025-01-02');
  assert.equal(built.rows[0].historyScopeDisposition, 'in_scope');
  assert.equal(built.rows[0].historicalMappingDisposition, 'historical_inactive_exact_link');
  assert.match(built.rows[0].sourceOrderHash, /^[a-f0-9]{64}$/);
  assert.equal(built.rows[1].refundEvidenceKind, null);
  assert.equal(built.rows[2].refundEvidenceKind, 'native_event');
  assert.match(built.rows[2].refundIdentityHash, /^[a-f0-9]{64}$/);
  assert.equal(built.rows[3].refundEvidenceKind, 'approved_original_annotation');
  assert.equal(built.rows[4].refundEvidenceKind, null);
  assert.equal(built.rows[4].historicalMappingDisposition, 'relocation_candidate');
});
