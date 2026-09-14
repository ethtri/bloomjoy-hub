#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260914202530_sunze_cash_correlation_service.sql",
  "utf8",
);
const intake = readFileSync("supabase/functions/refund-case-intake/index.ts", "utf8");
const ingest = readFileSync("supabase/functions/sunze-sales-ingest/index.ts", "utf8");
const test = readFileSync("supabase/tests/refund_sunze_cash_correlation.sql", "utf8");

for (const object of [
  "refund_sunze_cash_correlation_attempts",
  "refund_sunze_cash_correlation_candidates",
  "refund_sunze_cash_sale_links",
]) {
  assert.match(migration, new RegExp(`alter table public\\.${object} enable row level security`));
  assert.match(migration, new RegExp(`revoke all on table public\\.${object} from public, anon, authenticated`));
}

assert.match(migration, /policy_version = 'sunze_cash_correlation_v1'/u);
assert.match(migration, /unique \(refund_case_id, case_fact_version, policy_version, source_snapshot_key\)/u);
assert.match(migration, /raise exception 'Stale Sunze correlation worker'/u);
assert.match(migration, /row_number\(\) over \(order by/u);
assert.match(migration, /amount_delta_cents/u);
assert.match(migration, /Amount and rank are advisory/u);
assert.match(migration, /create unique index refund_sunze_cash_sale_links_active_sale_unique_idx/u);
assert.match(migration, /create or replace function public\.service_release_sunze_cash_sale_link/u);
assert.match(migration, /create or replace function public\.service_get_sunze_cash_correlation/u);
assert.match(migration, /create or replace function public\.service_select_sunze_cash_candidate/u);
assert.match(migration, /p_dry_run boolean default true/u);
assert.match(migration, /status in \('submitted', 'needs_review', 'waiting_on_customer', 'correlated'\)/u);
assert.match(intake, /service_correlate_sunze_cash_case/u);
assert.doesNotMatch(intake, /candidate_sales_fact_ids/u);
assert.match(ingest, /service_correlate_sunze_cash_import/u);
assert.match(test, /replay returns the original durable attempt/u);
assert.match(test, /Stale worker versions are rejected/u);
assert.match(test, /Completed evidence cannot be released/u);

console.log("Sunze cash correlation contract validated.");
