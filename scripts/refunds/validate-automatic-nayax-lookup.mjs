import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const automatic = read("supabase/functions/_shared/automatic-nayax-lookup.ts");
const intake = read("supabase/functions/refund-case-intake/index.ts");
const sweep = read("supabase/functions/refund-case-automation-sweep/index.ts");
const portal = read("src/pages/admin/Refunds.tsx");
const migration = read("supabase/migrations/202608150001_refund_automatic_nayax_lookup.sql");
const lookup = read("supabase/functions/_shared/nayax-lookup.ts");
const scopeRecovery = read("supabase/migrations/20260901060000_refund_nayax_scope_recovery.sql");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(automatic.includes("deriveRefundMissingFields"), "automatic trigger must reuse the canonical readiness helper");
assert(automatic.includes("lookupNayaxCandidatesForRefundCase"), "automatic trigger must reuse the existing Nayax lookup");
assert(!automatic.includes("nayax-card-refund"), "automatic lookup must not invoke the refund adapter");
assert(intake.includes("runAutomaticNayaxLookupIfReady"), "hosted intake must trigger the ready-case lookup");
assert(sweep.includes('source: "customer_reply_recheck"'), "customer reply recheck must trigger lookup readiness");
assert(sweep.includes("nayax_lookup:${refundCase.id}:v${refundCase.deterministic_fact_version}"), "sweep must share the fact-version action claim");
assert(migration.includes("action.action_key ="), "manager state must resolve the current fact-version lookup operation");
assert(portal.includes("Refresh transaction results"), "manual refresh fallback must remain available");
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
  scopeRecovery.includes("nayax_lookup_retry_count between 0 and 1") &&
    scopeRecovery.includes("A read-only Nayax retry is not safe") &&
    scopeRecovery.includes("Refund Operations owns the reviewed internal fallback"),
  "automatic lookup failure must allow at most one safe internal retry before fallback"
);
assert(
  portal.includes('data-testid="nayax-internal-setup-owner"') &&
    portal.includes("Customer action: none") &&
    !portal.includes("Try again or ask the customer for more details."),
  "mapping and account failures must be manager-owned without customer repetition"
);

console.log("Automatic Nayax lookup integration validation passed.");
