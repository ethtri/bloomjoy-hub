#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { parseSunzeOrderWorkbook, SUNZE_ORDER_HEADERS } from './sunze-orders.mjs';

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

const buildWorkbook = (rows) =>
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
    <sheet name="Order" sheetId="1" r:id="rId1"/>
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
const tempPath = join(tmpdir(), `sunze-orders-parser-${Date.now()}.xlsx`);

try {
  await writeFile(tempPath, buildWorkbook(rows));
  const parsed = await parseSunzeOrderWorkbook(tempPath);

  assert.deepEqual(fixture.headers, SUNZE_ORDER_HEADERS);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].paymentMethod, 'credit');
  assert.equal(parsed[1].paymentMethod, 'cash');
  assert.equal(parsed[2].paymentMethod, 'other');
  assert.equal(parsed[0].orderAmountCents, 1000);
  assert.equal(parsed[2].orderAmountCents, 0);

  console.log(
    JSON.stringify(
      {
        ok: true,
        rowsParsed: parsed.length,
        paymentMethods: [...new Set(parsed.map((row) => row.paymentMethod))],
      },
      null,
      2
    )
  );
} finally {
  await rm(tempPath, { force: true });
}
