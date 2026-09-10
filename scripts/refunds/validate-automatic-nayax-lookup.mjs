import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const automatic = read("supabase/functions/_shared/automatic-nayax-lookup.ts");
const intake = read("supabase/functions/refund-case-intake/index.ts");
const gmailSync = read("supabase/functions/refund-gmail-sync/index.ts");
const sweep = read("supabase/functions/refund-case-automation-sweep/index.ts");
const portal = read("src/pages/admin/Refunds.tsx");
const lookupEndpoint = read("supabase/functions/nayax-transaction-lookup/index.ts");
const recoveryMigration = read("supabase/migrations/20260910035559_refund_server_owned_nayax_lookup_recovery.sql");
const recoveryConcurrency = read("supabase/tests/refund_server_owned_nayax_lookup_concurrency.sql");
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
  automatic.includes('"service_enqueue_refund_nayax_lookup"') &&
    !automatic.includes("lookupNayaxCandidatesForRefundCase") &&
    !automatic.includes("beginNayaxLookup") &&
    !automatic.includes("persistNayaxLookupResult"),
  "event triggers must durably enqueue only and must never own provider research",
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
  sweep.includes('"service_claim_refund_nayax_lookup_recoveries"') &&
    sweep.includes("nayax_lookup:${refundCase.id}:v${refundCase.deterministic_fact_version}:r${recoveryGeneration}:a${attemptOrdinal}") &&
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
  recoveryMigration.includes("attempt_ordinal between 0 and 1") &&
    recoveryMigration.includes("recovery_generation between 0 and 1000000") &&
    recoveryMigration.includes("interval '2 minutes'") &&
    recoveryMigration.includes("for update of recovery skip locked") &&
    recoveryMigration.includes("order by recovery.next_attempt_at, recovery.created_at, recovery.refund_case_id") &&
    recoveryMigration.includes("service_mark_refund_nayax_lookup_recovery_started") &&
    recoveryMigration.includes("service_enqueue_refund_nayax_lookup") &&
    recoveryMigration.includes("unique (refund_case_id, deterministic_fact_version, recovery_generation, attempt_ordinal)"),
  "final schema must bound retries and fairly claim one exact lookup generation",
);
assert(
  recoveryConcurrency.includes("dblink_send_query('lookup_recovery_a'") &&
    recoveryConcurrency.includes("dblink_send_query('lookup_recovery_b'") &&
    recoveryConcurrency.includes("Competing sweep sessions obtain exactly one active provider-read claim") &&
    recoveryConcurrency.includes("The late worker leaves the newer fact version and its completed lookup evidence unchanged"),
  "disposable database coverage must prove competing claims and late-lease stale protection",
);
assert(
  recoveryMigration.includes("refund_authoritative_receipts") &&
    recoveryMigration.includes("refund_case_nayax_refund_attempts") &&
    recoveryMigration.includes("nayax_refund_execution_status = 'not_requested'") &&
    recoveryMigration.includes("previous candidate") &&
    recoveryMigration.includes("expired.expired_at <= statement_timestamp()"),
  "recovery must stay read-only, preserve prior evidence, and refresh expiry automatically",
);
assert(
  lookupEndpoint.includes('"is_super_admin"') &&
    lookupEndpoint.includes('"Refund Operations access required."') &&
    !lookupEndpoint.includes('"can_manage_refund_case"'),
  "the narrow manual endpoint must reject an ordinary mapped manager",
);
assert(
  portal.includes("selectedCase.nayaxLookupRecovery?.state === 'refund_operations'") &&
    portal.includes('data-testid="nayax-operations-recovery"') &&
    portal.includes('Recover transaction check'),
  "only the elevated Refund Operations projection exposes deliberate recovery",
);
assert(
  portal.includes('data-testid="nayax-internal-setup-owner"') &&
    portal.includes("No customer follow-up is needed.") &&
    !portal.includes("Try again or ask the customer for more details."),
  "mapping and account failures must be manager-owned without customer repetition"
);

console.log("Automatic Nayax lookup integration validation passed.");
