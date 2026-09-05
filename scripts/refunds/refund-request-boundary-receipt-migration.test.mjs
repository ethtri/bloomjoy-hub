import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareRefundRequestBoundaryReceiptRegression } from '../validate-supabase-migrations.mjs';

const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20260905190312_refund_request_time_boundary.sql', import.meta.url),
  'utf8',
);

test('legacy eligibility cleanup excludes immutable authoritative receipt cases', () => {
  const cleanup = migration.match(
    /update public\.refund_cases as case_row[\s\S]*?where receipt\.refund_case_id = case_row\.id[\s\S]*?\);/u,
  )?.[0];
  assert.ok(cleanup, 'the cleanup must bind the receipt exclusion to the updated case');
  assert.match(cleanup, /customer_request_received_at is null/u);
  assert.match(cleanup, /nayax_match_execution_eligible = true/u);
  assert.match(cleanup, /not exists\s*\([\s\S]*public\.refund_authoritative_receipts/u);
  assert.doesNotMatch(cleanup, /disable trigger|session_replication_role/u);
});

test('disposable migration validation seeds both sides of the receipt boundary before the migration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-boundary-receipt-'));
  try {
    fs.mkdirSync(path.join(root, 'migrations'));
    const fixturePath = prepareRefundRequestBoundaryReceiptRegression(root);
    assert.equal(
      path.basename(fixturePath),
      '202609051903115_refund_request_boundary_receipt_fixture.sql',
    );
    const fixture = fs.readFileSync(fixturePath, 'utf8');
    assert.match(fixture, /RF-BOUNDARY-RECEIPT/u);
    assert.match(fixture, /RF-BOUNDARY-UNCONFIRMED/u);
    assert.match(fixture, /insert into public\.refund_authoritative_receipts/u);
    assert.doesNotMatch(fixture, /customer_request_received_at/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
