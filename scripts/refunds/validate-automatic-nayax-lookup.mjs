import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const automatic = read("supabase/functions/_shared/automatic-nayax-lookup.ts");
const intake = read("supabase/functions/refund-case-intake/index.ts");
const gmailSync = read("supabase/functions/refund-gmail-sync/index.ts");
const sweep = read("supabase/functions/refund-case-automation-sweep/index.ts");
const portal = read("src/pages/admin/Refunds.tsx");
const lookupEndpoint = read("supabase/functions/nayax-transaction-lookup/index.ts");
const recoveryMigration = read("supabase/migrations/20260911210036_simplify_refund_nayax_lookup.sql");
const recoveryConcurrency = read("supabase/tests/refund_server_owned_nayax_lookup_concurrency.sql");
const recoverySql = read("supabase/tests/refund_server_owned_nayax_lookup_recovery.sql");
const migration = read("supabase/migrations/202608150001_refund_automatic_nayax_lookup.sql");
const lookup = read("supabase/functions/_shared/nayax-lookup.ts");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  lookup.includes("result.preliminary.consideredTransactionIds") &&
    lookup.includes("transactionIds: preliminary.consideredTransactionIds") &&
    !lookup.includes("preliminary.candidates.map"),
  "both single and grouped lookups must check local refund state for all considered originals before display limits",
);

assert(automatic.includes("deriveRefundMissingFields"), "automatic trigger must reuse the canonical readiness helper");
assert(
  !automatic.includes('"service_enqueue_refund_nayax_lookup"') &&
    automatic.includes("The refund case is the durable work item") &&
    !automatic.includes("lookupNayaxCandidatesForRefundCase") &&
    !automatic.includes("beginNayaxLookup") &&
    !automatic.includes("persistNayaxLookupResult"),
  "event triggers must make the case due without owning provider research",
);
assert(!automatic.includes("nayax-card-refund"), "automatic lookup must not invoke the refund adapter");
assert(intake.includes("runAutomaticNayaxLookupIfReady"), "hosted intake must trigger the ready-case lookup");
assert(
  gmailSync.includes('import { runAutomaticNayaxLookupIfReady } from "../_shared/automatic-nayax-lookup.ts";'),
  "verified Gmail corrections must use the shared automatic lookup coordinator",
);
const gmailApplicationAccepted = gmailSync.indexOf(
  'classifyRefundCustomerFactApplication(application) !== "accepted"',
);
const gmailReplyRecheck = gmailSync.indexOf(
  'source: "customer_reply_recheck"',
  gmailApplicationAccepted,
);
assert(
  gmailApplicationAccepted >= 0 && gmailReplyRecheck > gmailApplicationAccepted,
  "accepted or idempotently replayed Gmail fact applications must coordinate the current fact-version recheck",
);
assert(sweep.includes('source: "customer_reply_recheck"'), "customer reply recheck must trigger lookup readiness");
assert(
  sweep.includes('"service_claim_due_refund_nayax_lookups"') &&
    sweep.includes("nayax_lookup:${refundCase.id}:v${refundCase.deterministic_fact_version}:g${lookupGeneration}") &&
    sweep.includes("lookupNayaxCandidatesForRefundCase"),
  "sweep must be the sole provider-read owner for the final-schema exact recovery claim",
);
assert(migration.includes("action.action_key ="), "manager state must resolve the current fact-version lookup operation");
assert(
  !portal.includes("Refresh transaction results") &&
    !portal.includes("Refresh transactions") &&
    !portal.includes("void handleNayaxLookup({ silent: true })"),
  "page open, selection, and routine manager actions must remain read-only",
);
assert(
  portal.includes("matchFactorDisplayLabel") &&
    portal.includes("Why this looks like a match") &&
    portal.includes("Why this transaction cannot be selected"),
  "plain-language match and conflict reasons must be visible"
);
assert(!portal.includes("The transaction search will run when this case opens."), "opening a case must not be described as the trigger");
assert(!portal.includes("Check Nayax transaction"), "routine initial lookup must not require manager-start copy");
assert(
  lookup.includes('if (normalized !== defaultNayaxAccountKey) return "";') &&
    lookup.includes('"account_access_unavailable"'),
  "a separate Nayax account must never borrow the default credential"
);
assert(
  recoveryMigration.includes("nayax_lookup_retry_count < 1") &&
    recoveryMigration.includes("interval '2 minutes'") &&
    recoveryMigration.includes("pg_try_advisory_xact_lock") &&
    recoveryMigration.includes("for update of c skip locked") &&
    recoveryMigration.includes("service_claim_due_refund_nayax_lookups") &&
    recoveryMigration.includes("drop table if exists public.refund_nayax_lookup_recoveries"),
  "final schema must bound retries and fairly claim the case without a second queue",
);
assert(
  recoveryConcurrency.includes("dblink_send_query('lookup_work_a'") &&
    recoveryConcurrency.includes("dblink_send_query('lookup_work_b'") &&
    recoveryConcurrency.includes("Competing sweeps obtain exactly one case-owned lookup claim"),
  "disposable database coverage must prove competing case claims",
);
assert(
  recoveryMigration.includes("refund_authoritative_receipts") &&
    recoveryMigration.includes("refund_case_nayax_refund_attempts") &&
    recoveryMigration.includes("nayax_refund_execution_status = 'not_requested'") &&
    recoveryMigration.includes("9999-12-31") &&
    lookup.includes('expires_at: durableCandidateExpiry'),
  "lookup work must stay read-only and preserve completed evidence",
);
const immutableGuardDefinition = recoveryMigration.indexOf(
  "create or replace function public.reject_refund_nayax_candidate_update()",
);
const durableEvidenceBackfill = recoveryMigration.indexOf(
  "update public.refund_nayax_lookup_candidates",
);
assert(
  immutableGuardDefinition >= 0 &&
    immutableGuardDefinition < durableEvidenceBackfill &&
    recoveryMigration.includes("facts_unchanged") &&
    recoveryMigration.includes("durable_transition") &&
    recoveryMigration.includes("actor_binding_transition") &&
    recoveryMigration.includes("old.actor_user_id is null") &&
    recoveryMigration.includes("candidate_row.actor_user_id is not null"),
  "the production backfill must retain immutable transaction facts and allow only one-way durability and manager binding metadata",
);
assert(
  recoverySql.includes("Automatic lookup metadata can make immutable evidence durable") &&
    recoverySql.includes("An unclaimed automatic candidate can bind to one manager") &&
    recoverySql.includes("Transaction evidence cannot be rewritten during a metadata transition") &&
    recoverySql.includes("A candidate cannot be rebound to another manager") &&
    recoverySql.includes("Manual portal evidence keeps its reviewed expiry boundary"),
  "database coverage must exercise both permitted metadata transitions and reject fact mutation, rebinding, and manual evidence extension",
);
assert(
  recoveryMigration.includes("'{canSelectNayaxCandidate}','false'::jsonb") &&
    recoverySql.includes('Unknown historical coverage is not presented as a proved no-match') &&
    recoverySql.includes('An exhausted automatic retry routes to Refund Operations'),
  "case-owned work must disable selection while active and distinguish inconclusive history",
);
assert(
  lookupEndpoint.includes('"is_super_admin"') &&
    lookupEndpoint.includes('"Refund Operations access required."') &&
    lookupEndpoint.includes('"service_begin_refund_nayax_operations_lookup"') &&
    !lookupEndpoint.includes('"can_manage_refund_case"'),
  "the narrow manual endpoint must reject an ordinary mapped manager",
);
assert(
  portal.includes("selectedCase.nayaxLookupWork?.state === 'refund_operations'") &&
    portal.includes('data-testid="nayax-operations-recovery"') &&
    portal.includes('Run an operations transaction check'),
  "only the elevated Refund Operations projection exposes deliberate recovery",
);
assert(
  portal.includes('data-testid="nayax-internal-setup-owner"') &&
    portal.includes("No customer follow-up is needed.") &&
    !portal.includes("Try again or ask the customer for more details."),
  "mapping and account failures must be manager-owned without customer repetition"
);

console.log("Automatic Nayax lookup integration validation passed.");
