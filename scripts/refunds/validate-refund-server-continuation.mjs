import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const [migration, sweep, worker, tests] = await Promise.all([
  read("supabase/migrations/20260911001848_refund_server_approval_continuation.sql"),
  read("supabase/functions/refund-case-automation-sweep/index.ts"),
  read("supabase/functions/_shared/nayax-server-approval-continuation.ts"),
  read("supabase/tests/refund_attempt_continuation_outcomes.sql"),
]);

assert.match(migration, /for update of attempt, refund_case skip locked/i);
assert.match(migration, /attempt\.provider_claim_expires_at <= statement_timestamp\(\)/i);
assert.match(migration, /authz\.status = 'consumed'/i);
assert.match(migration, /not exists \([\s\S]*refund_authoritative_receipts/i);
assert.match(migration, /request_result\.approval_authorized is true/i);
assert.match(migration, /request_result\.stage = 'request'/i);
assert.match(migration, /not exists \([\s\S]*approval_stage\.stage = 'approve'/i);
assert.match(migration, /machine\.nayax_account_key = p_account_key/i);
assert.match(migration, /current_manager_mapping_version/i);
assert.match(worker, /executionPlan !== "approval_continuation"/);
assert.doesNotMatch(worker, /requestToken|executeNayaxRefundRequest/i);
assert.match(sweep, /NAYAX_REFUND_SERVER_CONTINUATION_ENABLED/);
assert.match(sweep, /NAYAX_REFUND_SERVER_CONTINUATION_ACCOUNT_KEY/);
assert.match(sweep, /executeNayaxRefundApprovalOnly/);
assert.match(sweep, /limit: 2/);
assert.match(tests, /coalesced second worker cannot claim/i);
assert.match(tests, /survives a manager handoff/i);
assert.match(tests, /Stale-version rejection creates no continuation claim/i);

console.log("Refund server approval continuation validation passed.");
