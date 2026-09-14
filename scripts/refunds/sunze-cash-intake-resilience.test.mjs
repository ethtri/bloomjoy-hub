#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const intake = readFileSync("supabase/functions/refund-case-intake/index.ts", "utf8");

test("cash correlation failure remains non-blocking after durable intake", () => {
  assert.match(intake, /refund intake Sunze cash correlation deferred/u);
  assert.doesNotMatch(
    intake,
    /if \(correlationError\) \{\s*throw new Error\("Unable to retain cash sales evidence safely\."\)/u,
  );
  assert.match(intake, /return !correlatedCaseError && correlatedCase/u);
});

test("replayed intake retries only an unevaluated cash fact version", () => {
  assert.match(
    intake,
    /cash_match_evaluated_fact_version === cashCase\.deterministic_fact_version[\s\S]*cash_match_state !== "checking_sales_history"/u,
  );
  assert.ok(
    (intake.match(/await runCashCorrelationIfReady\(/gu) ?? []).length >= 5,
    "new and replayed intake paths must share the retry helper",
  );
});
