import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  'supabase/migrations/20260930004634_refund_cash_positive_evidence_without_coverage.sql',
  'utf8',
);
const pgTap = fs.readFileSync(
  'supabase/tests/refund_sunze_cash_positive_evidence.sql',
  'utf8',
);
const component = fs.readFileSync(
  'src/components/refunds/CashRefundEvidencePanel.tsx',
  'utf8',
);
const parser = fs.readFileSync('src/lib/refundSunzeCashCorrelation.ts', 'utf8');

test('positive cash evidence stays review-only when complete coverage is unavailable', () => {
  assert.match(migration, /positive_sales_found_without_validated_coverage/);
  assert.match(migration, /result_state := 'multiple_possible_sales'/);
  assert.match(migration, /elsif candidate_total = 1 and watermark\.import_run_id is not null/);
  assert.match(migration, /'coverage_unvalidated'/);
  assert.match(migration, /'source_time_unvalidated'/);
  assert.match(migration, /time_delta_seconds, amount_delta_cents/);
  assert.match(migration, /ranked\.reported_payment_time,[\s\S]*ranked\.net_sales_cents,[\s\S]*null,/);
  assert.doesNotMatch(
    migration.slice(
      migration.indexOf("elsif positive_candidate_digest is not null then"),
      migration.indexOf("select * into active_link"),
    ),
    /system_single_candidate/,
  );
});

test('positive evidence binds the current complete import group and fails stale selection closed', () => {
  assert.match(migration, /machine_coverage_verified' = 'true'/);
  assert.match(migration, /visible_machine_count_mismatch' = 'false'/);
  assert.match(migration, /source_order_hash/);
  assert.match(migration, /md5\(string_agg/);
  assert.match(migration, /attempt_row\.source_snapshot_key is distinct from/);
  assert.match(pgTap, /A newer completed import makes the prior positive snapshot stale/);
  assert.match(pgTap, /No positive row remains unavailable rather than becoming no-sale evidence/);
  assert.match(pgTap, /Evidence selection does not decide, complete, or account for a refund/);
});

test('operator UI labels unvalidated provider time without inventing precision', () => {
  assert.match(component, /Reported sale time \(timezone unverified\)/);
  assert.match(component, /timestamp basis and complete coverage are not validated/);
  assert.match(parser, /timeDeltaSeconds: number \| null/);
  assert.match(parser, /value\.timeDeltaSeconds === null \|\| isInteger/);
  assert.match(parser, /sourceTimeUnvalidated: boolean/);
  assert.match(component, /selectedSale\.sourceTimeUnvalidated \|\| unvalidatedCandidateIds\.has/);
  assert.match(migration, /evidence\.attempt_id = link_row\.correlation_attempt_id/);
});
