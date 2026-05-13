#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  assertSunzeOrderRowsWithinWindow,
  filterSunzeOrderRowsToWindow,
  parseSunzeOrderRows,
  parseSunzeOrderWorkbook,
  summarizeSunzeOrderRows,
  SUNZE_ORDER_HEADERS,
  SunzeOrderParseError,
} from './sunze-orders.mjs';
import { assertExportMatchesUi, extractUiRecordCount } from './reconcile-orders-export.mjs';

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const columnName = (index) => {
  let current = index + 1;
  let name = '';

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
};

const cellXml = (value, rowIndex, cellIndex) => {
  const ref = `${columnName(cellIndex)}${rowIndex + 1}`;

  if (typeof value === 'number') {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }

  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
};

const worksheetXml = (rows) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rows
      .map(
        (row, rowIndex) =>
          `<row r="${rowIndex + 1}">${row
            .map((value, cellIndex) => cellXml(value, rowIndex, cellIndex))
            .join('')}</row>`
      )
      .join('')}
  </sheetData>
</worksheet>`;

const buildWorkbook = (rows, { sheetName = 'Order' } = {}) =>
  zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(worksheetXml(rows)),
  });

const fixturePath = new URL('./sample-sunze-orders.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const rows = [fixture.headers, ...fixture.rows];
const tempPaths = [];
const createTempPath = (extension) => {
  const tempPath = join(
    tmpdir(),
    `sunze-orders-parser-${Date.now()}-${tempPaths.length + 1}.${extension}`
  );
  tempPaths.push(tempPath);
  return tempPath;
};
const tempPath = createTempPath('xlsx');

const assertParseError = (testRows, expectedMessage) => {
  assert.throws(
    () => parseSunzeOrderRows(testRows),
    (error) =>
      error instanceof SunzeOrderParseError &&
      typeof error.message === 'string' &&
      error.message.includes(expectedMessage)
  );
};

const withCell = (sourceRow, headerName, value) => {
  const row = [...sourceRow];
  row[SUNZE_ORDER_HEADERS.indexOf(headerName)] = value;
  return row;
};

const projectRowsToHeaders = (headers, sourceRows) => [
  headers,
  ...sourceRows.map((row) => headers.map((header) => row[SUNZE_ORDER_HEADERS.indexOf(header)])),
];

try {
  await writeFile(tempPath, buildWorkbook(rows));
  const parsed = await parseSunzeOrderWorkbook(tempPath);
  const summary = summarizeSunzeOrderRows(parsed);

  assert.deepEqual(fixture.headers, SUNZE_ORDER_HEADERS);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].paymentMethod, 'credit');
  assert.equal(parsed[1].paymentMethod, 'cash');
  assert.equal(parsed[2].paymentMethod, 'other');
  assert.equal(parsed[0].orderAmountCents, 1000);
  assert.equal(parsed[2].orderAmountCents, 0);
  assert.equal(parsed[0].tradeName, 'Flower dream-2');
  assert.equal(parsed[0].itemQuantity, 2);
  assert.equal(parsed[1].itemQuantity, 2);
  assert.equal(parsed[2].itemQuantity, 1);
  assert.equal(summary.rowCount, 3);
  assert.equal(summary.machineCount, 2);
  assert.equal(summary.orderAmountCents, 1800);
  assert.equal(summary.windowStart, '2026-04-22');
  assert.equal(summary.windowEnd, '2026-04-23');

  const monthlyExportSummary = {
    rowCount: 6729,
    orderAmountCents: 7237040,
    windowStart: '2026-04-02',
    windowEnd: '2026-05-01',
  };
  const weakRecordCountSummary = assertExportMatchesUi(monthlyExportSummary, [
    {
      uiWindowStart: '2026-02-28',
      uiWindowEnd: '2026-05-01',
      uiRevenueCents: 7237040,
      uiRevenueCandidatesCents: [7237040],
      ...extractUiRecordCount({ fallbackTexts: ['1 records'] }),
    },
  ]);
  assert.equal(weakRecordCountSummary.uiRecordCount, 1);
  assert.equal(weakRecordCountSummary.uiRecordCountTrusted, false);
  assert.equal(weakRecordCountSummary.uiRecordCountMatched, false);

  const trustedRecordCountSummary = assertExportMatchesUi(monthlyExportSummary, [
    {
      uiWindowStart: '2026-02-28',
      uiWindowEnd: '2026-05-01',
      uiRevenueCents: 7237040,
      uiRevenueCandidatesCents: [7237040],
      ...extractUiRecordCount({ trustedTexts: ['Total 6,729 items'] }),
    },
  ]);
  assert.equal(trustedRecordCountSummary.uiRecordCount, 6729);
  assert.equal(trustedRecordCountSummary.uiRecordCountTrusted, true);
  assert.equal(trustedRecordCountSummary.uiRecordCountMatched, true);
  const trustedRowCountFallbackSummary = assertExportMatchesUi(monthlyExportSummary, [
    {
      uiWindowStart: '2026-02-28',
      uiWindowEnd: '2026-05-01',
      uiRevenueCents: null,
      uiRevenueCandidatesCents: [],
      ...extractUiRecordCount({ trustedTexts: ['Total 6,729 items'] }),
    },
  ]);
  assert.equal(trustedRowCountFallbackSummary.uiRevenueMatched, false);
  assert.equal(trustedRowCountFallbackSummary.uiReconciliationMode, 'trusted_row_count');
  const weakRowCountFallbackSummary = assertExportMatchesUi(monthlyExportSummary, [
    {
      uiWindowStart: '2026-02-28',
      uiWindowEnd: '2026-05-01',
      uiRevenueCents: 100,
      uiRevenueCandidatesCents: [100],
      uiRevenueTrusted: false,
      uiRevenueSource: 'weak_page_text',
      ...extractUiRecordCount({ fallbackTexts: ['Total 6,729 items'] }),
    },
  ]);
  assert.equal(weakRowCountFallbackSummary.uiRevenueMatched, false);
  assert.equal(weakRowCountFallbackSummary.uiReconciliationMode, 'weak_row_count');
  assert.throws(
    () =>
      assertExportMatchesUi(monthlyExportSummary, [
        {
          uiWindowStart: '2026-02-28',
          uiWindowEnd: '2026-05-01',
          uiRevenueCents: 7237040,
          uiRevenueCandidatesCents: [7237040],
          ...extractUiRecordCount({ trustedTexts: ['Total 1 items'] }),
        },
      ]),
    /trusted UI row count 1 did not match/
  );
  assert.throws(
    () =>
      assertExportMatchesUi(monthlyExportSummary, [
        {
          uiWindowStart: '2026-02-28',
          uiWindowEnd: '2026-05-01',
          uiRevenueCents: 100,
          uiRevenueCandidatesCents: [100],
          uiRevenueTrusted: true,
          uiRevenueSource: 'scoped_revenue_text',
          ...extractUiRecordCount({ trustedTexts: ['Total 6,729 items'] }),
        },
      ]),
    /trusted UI revenue 100 did not match/
  );
  assert.throws(
    () =>
      assertExportMatchesUi(monthlyExportSummary, [
        {
          uiWindowStart: '2026-02-28',
          uiWindowEnd: '2026-05-01',
          uiRevenueCents: 100,
          uiRevenueCandidatesCents: [100],
          ...extractUiRecordCount({ fallbackTexts: ['1 records'] }),
        },
      ]),
    /Provider export mismatch/
  );

  const compactHeaders = SUNZE_ORDER_HEADERS.filter(
    (header) => !['Affiliated merchant', 'Machine name'].includes(header)
  );
  const compactParsed = parseSunzeOrderRows(projectRowsToHeaders(compactHeaders, fixture.rows));
  assert.equal(compactParsed.length, 3);
  assert.equal(compactParsed[0].machineName, '');
  assert.equal(assertSunzeOrderRowsWithinWindow(parsed, {
    windowStart: '2026-04-22',
    windowEnd: '2026-04-23',
  }), parsed);
  assert.throws(
    () =>
      assertSunzeOrderRowsWithinWindow(parsed, {
        windowStart: '2026-04-23',
        windowEnd: '2026-04-23',
      }),
    (error) =>
      error instanceof SunzeOrderParseError &&
      typeof error.message === 'string' &&
      error.message.includes('outside the selected date window')
  );
  const windowFiltered = filterSunzeOrderRowsToWindow(parsed, {
    windowStart: '2026-04-23',
    windowEnd: '2026-04-23',
  });
  assert.equal(windowFiltered.rows.length, 1);
  assert.equal(windowFiltered.outOfWindowRows.length, 2);
  assert.equal(windowFiltered.rows[0].saleDate, '2026-04-23');
  assert.equal(assertSunzeOrderRowsWithinWindow(windowFiltered.rows, {
    windowStart: '2026-04-23',
    windowEnd: '2026-04-23',
  }), windowFiltered.rows);
  const windowFilteredSummary = summarizeSunzeOrderRows(windowFiltered.rows);
  assert.equal(windowFilteredSummary.rowCount, 1);
  assert.equal(windowFilteredSummary.machineCount, 1);
  assert.equal(windowFilteredSummary.windowStart, '2026-04-23');
  assert.equal(windowFilteredSummary.windowEnd, '2026-04-23');

  const zipPath = createTempPath('zip');
  await writeFile(
    zipPath,
    zipSync({
      '2026-04.xlsx': buildWorkbook(rows),
      'nested/2026-05.xlsx': buildWorkbook(
        [
          SUNZE_ORDER_HEADERS,
          withCell(fixture.rows[0], 'Payment time', '2026/05/01 10:15:00'),
        ],
        { sheetName: '0' }
      ),
    })
  );
  const zippedParsed = await parseSunzeOrderWorkbook(zipPath);
  const zippedSummary = summarizeSunzeOrderRows(zippedParsed);
  assert.equal(zippedParsed.length, 4);
  assert.equal(zippedSummary.windowStart, '2026-04-22');
  assert.equal(zippedSummary.windowEnd, '2026-05-01');

  const emptyZipPath = createTempPath('zip');
  await writeFile(emptyZipPath, zipSync({}));
  await assert.rejects(
    () => parseSunzeOrderWorkbook(emptyZipPath),
    (error) =>
      error instanceof SunzeOrderParseError &&
      typeof error.message === 'string' &&
      error.message.includes('contains no workbook files')
  );

  const nonWorkbookZipPath = createTempPath('zip');
  await writeFile(nonWorkbookZipPath, zipSync({ 'notes.txt': strToU8('not an order export') }));
  await assert.rejects(
    () => parseSunzeOrderWorkbook(nonWorkbookZipPath),
    (error) =>
      error instanceof SunzeOrderParseError &&
      typeof error.message === 'string' &&
      error.message.includes('contains no workbook files')
  );

  const badWorkbookZipPath = createTempPath('zip');
  await writeFile(
    badWorkbookZipPath,
    zipSync({
      'bad.xlsx': buildWorkbook([[...SUNZE_ORDER_HEADERS.filter((header) => header !== 'Status')], fixture.rows[0]]),
    })
  );
  await assert.rejects(
    () => parseSunzeOrderWorkbook(badWorkbookZipPath),
    (error) =>
      error instanceof SunzeOrderParseError &&
      typeof error.message === 'string' &&
      error.message.includes('headers changed') &&
      error.message.includes('Zip entry: bad.xlsx')
  );

  const malformedWorkbookPath = createTempPath('xlsx');
  await writeFile(malformedWorkbookPath, 'not an xlsx workbook');
  await assert.rejects(
    () => parseSunzeOrderWorkbook(malformedWorkbookPath),
    (error) =>
      error instanceof SunzeOrderParseError &&
      typeof error.message === 'string' &&
      error.message.includes('could not be read')
  );

  const malformedWorkbookZipPath = createTempPath('zip');
  await writeFile(
    malformedWorkbookZipPath,
    zipSync({
      'broken.xlsx': strToU8('not an xlsx workbook'),
    })
  );
  await assert.rejects(
    () => parseSunzeOrderWorkbook(malformedWorkbookZipPath),
    (error) =>
      error instanceof SunzeOrderParseError &&
      typeof error.message === 'string' &&
      error.message.includes('could not be read') &&
      error.message.includes('Zip entry: broken.xlsx')
  );

  const duplicateUpdateRows = [
    SUNZE_ORDER_HEADERS,
    fixture.rows[0],
    withCell(fixture.rows[0], 'Order amount', 12),
  ];
  const duplicateParsed = parseSunzeOrderRows(duplicateUpdateRows);
  assert.equal(duplicateParsed.length, 2);
  assert.equal(duplicateParsed[0].sourceOrderNumber, duplicateParsed[1].sourceOrderNumber);
  assert.equal(duplicateParsed[1].orderAmountCents, 1200);

  const midnightParsed = parseSunzeOrderRows([
    SUNZE_ORDER_HEADERS,
    withCell(fixture.rows[0], 'Payment time', '2026/04/24 00:00:03'),
  ]);
  assert.equal(midnightParsed[0].saleDate, '2026-04-24');
  assert.equal(midnightParsed[0].paymentTimeIso, '2026-04-24T00:00:03.000Z');

  const timezoneParsed = parseSunzeOrderRows([
    SUNZE_ORDER_HEADERS,
    withCell(fixture.rows[0], 'Payment time', '2026-04-24T00:30:00+08:00'),
  ]);
  assert.equal(timezoneParsed[0].saleDate, '2026-04-24');
  assert.equal(timezoneParsed[0].paymentTimeIso, '2026-04-23T16:30:00.000Z');

  assertParseError(
    [[...SUNZE_ORDER_HEADERS.filter((header) => header !== 'Status')], fixture.rows[0]],
    'headers changed'
  );
  assertParseError(
    [SUNZE_ORDER_HEADERS, withCell(fixture.rows[0], 'Payment method', 'Voucher')],
    'Unknown payment method'
  );
  assertParseError(
    [SUNZE_ORDER_HEADERS, withCell(fixture.rows[0], 'Status', 'Refunded')],
    'Unknown order status'
  );
  assertParseError(
    [SUNZE_ORDER_HEADERS, withCell(fixture.rows[0], 'Order amount', -1)],
    'Invalid Order amount'
  );
  assertParseError(
    [SUNZE_ORDER_HEADERS, withCell(fixture.rows[0], 'Payment time', '2026/02/31 10:00:00')],
    'Invalid payment time'
  );
  assertParseError(
    [SUNZE_ORDER_HEADERS, withCell(fixture.rows[0], 'Payment time', '2026-04-24 00:30:00 trailing')],
    'Invalid payment time'
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        rowsParsed: parsed.length,
        rowCount: summary.rowCount,
        machineCount: summary.machineCount,
        orderAmountCents: summary.orderAmountCents,
        paymentMethods: [...new Set(parsed.map((row) => row.paymentMethod))],
        cases: [
          'header change rejection',
          'unknown payment rejection',
          'unknown status rejection',
          'negative amount rejection',
          'impossible payment date rejection',
          'zero no-pay normalization',
          'trade item quantity parsing',
          'weak UI row count reconciliation',
          'trusted UI row count reconciliation',
          'trusted row count fallback reconciliation',
          'weak row count fallback reconciliation',
          'trusted UI row count mismatch rejection',
          'trusted UI revenue mismatch rejection',
          'revenue mismatch rejection',
          'duplicate order preservation',
          'midnight date boundary',
          'zip export parsing',
          'optional metadata header handling',
          'empty zip rejection',
          'non-workbook zip rejection',
          'zipped workbook header rejection',
          'malformed workbook rejection',
          'malformed zipped workbook rejection',
          'fallback first-sheet parsing',
          'selected date window rejection',
          'selected date window filtering',
          'timezone payment time parsing',
          'partial timestamp rejection',
        ],
      },
      null,
      2
    )
  );
} finally {
  await Promise.all(tempPaths.map((path) => rm(path, { force: true })));
}
