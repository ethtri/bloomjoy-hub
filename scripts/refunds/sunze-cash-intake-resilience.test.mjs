#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const intake = readFileSync("supabase/functions/refund-case-intake/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260914202530_sunze_cash_correlation_service.sql",
  "utf8",
);

test("cash correlation failure remains non-blocking after durable intake", () => {
  assert.match(intake, /refund intake Sunze cash correlation deferred/u);
  assert.doesNotMatch(
    intake,
    /if \(correlationError\) \{\s*throw new Error\("Unable to retain cash sales evidence safely\."\)/u,
  );
  assert.match(intake, /return !correlatedCaseError && correlatedCase/u);
});

test("corrected-fact trigger defers evidence failure without rolling back intake", () => {
  assert.match(
    migration,
    /trigger_recorrelate_sunze_cash_case\(\)[\s\S]*exception when others then[\s\S]*cash_match_state = 'checking_sales_history'[\s\S]*sunze_cash_correlation_deferred/u,
  );
});

test("replayed intake retries an unevaluated, checking, or legacy-null cash state", () => {
  assert.match(
    intake,
    /cash_match_evaluated_fact_version === cashCase\.deterministic_fact_version[\s\S]*typeof cashCase\.cash_match_state === "string"[\s\S]*cash_match_state !== "checking_sales_history"/u,
  );
  assert.ok(
    (intake.match(/await runCashCorrelationIfReady\(/gu) ?? []).length >= 5,
    "new and replayed intake paths must share the retry helper",
  );
});
