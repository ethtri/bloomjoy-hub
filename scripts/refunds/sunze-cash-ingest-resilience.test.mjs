#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ingest = readFileSync("supabase/functions/sunze-sales-ingest/index.ts", "utf8");

test("post-import cash correlation failure does not downgrade a completed import", () => {
  const completed = ingest.indexOf('status: "completed"');
  const correlationTry = ingest.indexOf("const correlation = await correlateCompletedCashImport");
  const deferredLog = ingest.indexOf("Sunze cash post-import correlation deferred");
  const outerCatch = ingest.indexOf("} catch (error) {", correlationTry);

  assert.ok(completed >= 0 && completed < correlationTry);
  assert.ok(correlationTry >= 0 && deferredLog > correlationTry);
  assert.ok(deferredLog < outerCatch, "correlation must be caught before the ingest failure handler");
  assert.match(ingest, /cashCorrelationDeferred = true/u);
  assert.match(ingest, /cashCorrelationDeferred,/u);
});

test("post-import hook drains bounded batches and reports retained backlog", () => {
  assert.match(ingest, /drainSunzeCashCorrelation/u);
  assert.match(ingest, /p_limit: limit/u);
  assert.match(ingest, /cashCorrelationRemaining = correlation\.remaining/u);
  assert.match(ingest, /cashCorrelationDeferred = correlation\.deferred/u);
});
