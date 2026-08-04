#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const files = {
  migration: 'supabase/migrations/202605120002_refund_full_automation_foundation.sql',
  managerAuthorizationMigration: 'supabase/migrations/202605160001_refund_nayax_execution_manager_authorization.sql',
  officialActionMigration: 'supabase/migrations/202608030002_refund_manager_official_action_boundary.sql',
  providerOrchestrationMigration: 'supabase/migrations/202608040004_refund_nayax_provider_orchestration.sql',
  providerOrchestration: 'supabase/functions/_shared/nayax-refund-orchestration.ts',
  providerOrchestrationTest: 'supabase/functions/_shared/nayax-refund-orchestration.test.ts',
  providerEvidenceProducer: 'supabase/functions/_shared/nayax-refund-orchestration-evidence.ts',
  officialActionHelper: 'supabase/functions/_shared/refund-official-action.ts',
  function: 'supabase/functions/nayax-card-refund/index.ts',
  config: 'supabase/config.toml',
  envExample: '.env.example',
  commercePreflight: 'scripts/commerce-preflight.mjs',
  nayaxLookup: 'supabase/functions/nayax-transaction-lookup/index.ts',
  nayaxLookupShared: 'supabase/functions/_shared/nayax-lookup.ts',
  refundAdminUpdate: 'supabase/functions/refund-case-admin-update/index.ts',
  refundCaseMessageSend: 'supabase/functions/refund-case-message-send/index.ts',
  refundOperationsLib: 'src/lib/refundOperations.ts',
  refundOperationsUi: 'src/pages/admin/Refunds.tsx',
  nayaxCandidateTokenMigration: 'supabase/migrations/202605130001_refund_nayax_lookup_candidate_tokens.sql',
  nayaxRecommendationMigration: 'supabase/migrations/202607210003_refund_nayax_recommendation_state.sql',
};

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
};

const migration = read(files.migration);
const managerAuthorizationMigration = read(files.managerAuthorizationMigration);
const officialActionMigration = read(files.officialActionMigration);
const providerOrchestrationMigration = read(files.providerOrchestrationMigration);
const providerOrchestration = read(files.providerOrchestration);
const providerOrchestrationTest = read(files.providerOrchestrationTest);
const providerEvidenceProducer = read(files.providerEvidenceProducer);
const officialActionHelper = read(files.officialActionHelper);
const fn = read(files.function);
const config = read(files.config);
const envExample = read(files.envExample);
const preflight = read(files.commercePreflight);
const nayaxLookup = read(files.nayaxLookup);
const nayaxLookupShared = read(files.nayaxLookupShared);
const refundAdminUpdate = read(files.refundAdminUpdate);
const refundCaseMessageSend = read(files.refundCaseMessageSend);
const refundOperationsLib = read(files.refundOperationsLib);
const refundOperationsUi = read(files.refundOperationsUi);
const nayaxCandidateTokenMigration = read(files.nayaxCandidateTokenMigration);
const nayaxRecommendationMigration = read(files.nayaxRecommendationMigration);

assert(
  migration.includes('refund_case_nayax_refund_attempts'),
  'Migration must create a durable Nayax refund attempt table.'
);
assert(
  migration.includes('idempotency_key text not null') &&
    migration.includes('refund_case_nayax_attempt_idempotency_unique'),
  'Nayax attempts must include a unique idempotency key.'
);
assert(
  migration.includes('nayax_refunds_enabled boolean not null default false') &&
    migration.includes('nayax_refund_max_amount_cents'),
  'Machine-level Nayax refund allowlist and cap fields are required.'
);
assert(
  migration.includes('can_prepare_nayax_refund_execution') &&
    officialActionMigration.includes('public.can_perform_refund_official_action(p_user_id, refund_case.id)') &&
    officialActionMigration.includes('refund_case.refund_amount_cents is not null') &&
    officialActionMigration.includes('refund_case.refund_amount_cents = refund_case.payment_amount_cents') &&
    officialActionMigration.includes('refund_case.refund_amount_cents = refund_case.matched_nayax_amount_cents') &&
    officialActionMigration.includes("refund_case.matched_nayax_currency_code = 'USD'") &&
    !officialActionMigration.includes('public.is_super_admin(p_user_id)'),
  'Execution readiness must require the currently mapped Machine Manager while using the stored refund amount and preserving service-role-only execution gates.'
);
assert(
  managerAuthorizationMigration.includes('revoke execute on function public.can_prepare_nayax_refund_execution(uuid, uuid) from public, anon, authenticated') &&
    managerAuthorizationMigration.includes('grant execute on function public.can_prepare_nayax_refund_execution(uuid, uuid) to service_role') &&
    officialActionMigration.includes('revoke execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)') &&
    officialActionMigration.includes('grant execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)') &&
    officialActionMigration.includes('to service_role'),
  'The final Machine Manager authorization boundary must keep execution readiness service-role-only.'
);
assert(
  migration.includes('revoke execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)') &&
    migration.includes('from public, anon, authenticated') &&
    migration.includes('grant execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)') &&
    migration.includes('to service_role'),
  'Execution readiness RPC must be service-role-only and not browser-callable.'
);
assert(
  migration.includes('refund_case_nayax_one_live_attempt_per_case_idx') &&
    migration.includes("status in ('in_progress', 'requested', 'approved', 'succeeded')"),
  'Nayax attempts must prevent more than one live execution attempt per refund case.'
);
assert(
  migration.includes('refund_business_fingerprint') &&
    migration.includes('Potential duplicate refund settlement adjustment requires review'),
  'Cross-workflow refund duplicate fingerprint guard is required.'
);
assert(
  fn.includes('NAYAX_REFUND_EXECUTION_KILL_SWITCH') &&
    fn.includes('NAYAX_REFUND_EXECUTION_ENABLED') &&
    fn.includes('NAYAX_REFUND_EXECUTION_DRY_RUN') &&
    fn.includes('NAYAX_REFUND_EXECUTION_SPONSOR_GO_NO_GO') &&
    fn.includes('NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED'),
  'The hard-off HTTP boundary must continue reporting every legacy rollout gate.'
);
assert(
  fn.includes('can_perform_refund_official_action') &&
    fn.includes('provider: disabledNayaxProviderAdapter') &&
    fn.includes('orchestrateNayaxRefund') &&
    !fn.includes('authorizeRefundOfficialAction') &&
    !fn.includes('service_consume_nayax_refund_official_action') &&
    !fn.includes('can_manage_refund_case') &&
    !fn.includes('actorIsSuperAdmin'),
  'The real HTTP function must authorize visibility but stay hard-off before manager evidence, reservation, or provider execution.'
);
assert(
  officialActionHelper.includes('p_expected_case_version: context.expectedCaseVersion') &&
    refundOperationsUi.includes('expectedOfficialActionVersion: officialActionVersion') &&
    officialActionMigration.includes('authorization_row.expected_case_version') &&
    officialActionMigration.includes("authorization_row.status <> 'authorized'") &&
    officialActionMigration.includes('authorization_row.expires_at <= statement_timestamp()') &&
    officialActionMigration.includes('drop function if exists public.service_finalize_nayax_refund_official_action') &&
    !officialActionMigration.includes('create or replace function public.service_finalize_nayax_refund_official_action') &&
    officialActionMigration.includes('refund_nayax_candidate_evidence_hash') &&
    officialActionMigration.includes('Nayax execution uses the persisted approved match and does not accept a candidate token'),
  'Nayax execution must reject stale, replayed, expired, or candidate-mutated receipts and must not expose a provider-success finalizer before attempt-bound integration.'
);
assert(
  fn.includes('refundCase.refund_amount_cents ?? 0') &&
    !fn.includes('body?.refundAmountCents') &&
    !fn.includes('requestedRefundAmountCents') &&
    !fn.includes('refundCase.refund_amount_cents ='),
  'Nayax execution must use the server-stored refund amount and must not let callers override the execution amount.'
);
assert(
  providerOrchestration.includes('provider_execution_not_yet_enabled') &&
    fn.includes('Disabled production adapter cannot reserve an attempt') &&
    !fn.includes('mode: "synthetic"') &&
    !fn.includes('/payment/refund-request') &&
    !fn.includes('/payment/refund-approve'),
  'This release must expose no live or synthetic HTTP execution switch.'
);
assert(
  providerOrchestrationMigration.includes('service_reserve_and_consume_nayax_refund_attempt') &&
    providerOrchestrationMigration.includes('service_settle_nayax_refund_attempt') &&
    providerOrchestrationMigration.includes('provider_claim_digest') &&
    providerOrchestrationMigration.includes('assert_nayax_provider_executor') &&
    providerOrchestrationMigration.includes('Card completion requires token-bound confirmed provider settlement') &&
    providerOrchestrationMigration.includes('from public, anon, authenticated, service_role') &&
    providerOrchestrationMigration.includes('service_consume_nayax_refund_official_action'),
  'Local proof must use assertion-scoped atomic reservation/settlement and revoke the legacy service consumer.'
);
assert(
  providerOrchestration.includes('deliverCommittedCompletion') &&
    providerOrchestration.includes('status: "delivery_unknown"') &&
    providerOrchestrationTest.includes('delivery failure must never cause a second provider attempt') &&
    providerEvidenceProducer.includes('local_injected_provider_adapter') &&
    providerEvidenceProducer.includes('replayProviderAttempts'),
  'Injected local proof must measure all outcomes and replay safety without representing browser mocks as real handler success.'
);
assert(
  refundAdminUpdate.includes('provider_settlement_required') &&
    refundAdminUpdate.includes('Card completion and customer success email require token-bound confirmed provider settlement') &&
    refundOperationsUi.includes('applyNayaxExecutionResult') &&
    !refundOperationsUi.includes("handleSaveCase(completedEditor, 'completed')"),
  'Card completion/success copy must be provider-settlement-owned and the UI must not chain an admin completion mutation.'
);
assert(
  fn.includes('card_wallet_used') &&
    fn.includes('manual_review'),
  'Wallet/Apple Pay last-four mismatch must stay manual-review for v1 execution.'
);
assert(
  config.includes('[functions.nayax-card-refund]') &&
    config.includes('[functions.refund-case-admin-update]') &&
    config.includes('[functions.refund-case-automation-sweep]') &&
    config.includes('[functions.refund-case-message-send]'),
  'Supabase config must list the refund automation Edge Functions.'
);
assert(
  envExample.includes('NAYAX_REFUND_EXECUTION_KILL_SWITCH=true') &&
    envExample.includes('NAYAX_REFUND_EXECUTION_DRY_RUN=true') &&
    envExample.includes('NAYAX_REFUND_EXECUTION_ENABLED=false'),
  '.env.example must document fail-closed Nayax refund defaults.'
);
assert(
  preflight.includes('NAYAX_REFUND_EXECUTION_KILL_SWITCH') &&
    preflight.includes('REFUND_AUTOMATION_SWEEP_SECRET'),
  'Commerce preflight must validate refund automation configuration.'
);
assert(
  nayaxLookup.includes('lookupNayaxCandidatesForRefundCase') &&
    nayaxLookupShared.includes('refund_nayax_lookup_candidates') &&
    nayaxLookupShared.includes('candidateToken') &&
    nayaxLookupShared.includes('export type NayaxResponseCandidate = Omit<') &&
    nayaxLookupShared.includes('"transactionId" | "siteId" | "providerMachineId"') &&
    nayaxLookupShared.includes('toPublicNayaxCandidate(candidate, token)') &&
    nayaxLookupShared.includes('defaultLookupWindowHours = 6'),
  'Nayax lookup must return opaque candidate tokens, not raw provider transaction IDs.'
);
assert(
  nayaxCandidateTokenMigration.includes('refund_nayax_lookup_candidates') &&
    nayaxCandidateTokenMigration.includes('revoke all on public.refund_nayax_lookup_candidates from authenticated') &&
    nayaxCandidateTokenMigration.includes('grant select, insert, update, delete on public.refund_nayax_lookup_candidates to service_role'),
  'Tokenized Nayax lookup candidates must be stored in a service-role-only table.'
);
assert(
  refundAdminUpdate.includes('matchedNayaxCandidateToken') &&
    refundAdminUpdate.includes('refund_nayax_lookup_candidates'),
  'Refund admin updates must resolve Nayax evidence tokens server-side.'
);
assert(
  refundCaseMessageSend.includes('can_manage_refund_case') &&
    refundCaseMessageSend.includes('buildEditableRefundCustomerEmail') &&
    refundCaseMessageSend.includes('replyTo: getRefundReplyToEmail()') &&
    refundCaseMessageSend.includes('created_by: user.id'),
  'Portal customer messaging must be authorized, logged, editable from approved templates, and reply-to the support inbox.'
);
assert(
  !refundOperationsLib.includes('transactionId: string') &&
    !refundOperationsLib.includes('matchedNayaxTransactionId'),
  'Browser refund operation types must not expose raw Nayax transaction IDs.'
);
assert(
  !refundOperationsUi.includes('candidate.transactionId') &&
    !refundOperationsUi.includes('matchedNayaxTransactionId'),
  'Browser refund UI must not store or submit raw Nayax transaction IDs.'
);
assert(
  fn.includes('nayax_recommendation_state !== "high_confidence"') &&
    fn.includes('!refundCase.nayax_match_execution_eligible') &&
    fn.includes('refundCase.card_wallet_used') &&
    fn.includes('duplicate_transaction') &&
    nayaxRecommendationMigration.includes("refund_case.nayax_recommendation_state = 'high_confidence'") &&
    nayaxRecommendationMigration.includes('refund_case.nayax_match_execution_eligible = true') &&
    nayaxRecommendationMigration.includes('refund_cases_unique_matched_nayax_transaction_id_idx') &&
    nayaxRecommendationMigration.includes("refund_case.card_wallet_used = false"),
  'Nayax execution must require a manager-confirmed high-confidence recommendation in both the Edge Function and database predicate.'
);
assert(
  refundAdminUpdate.includes('selection_allowed') &&
    refundAdminUpdate.includes('nayaxDisagreementReason') &&
    refundAdminUpdate.includes('nayax_match_execution_eligible: false'),
  'Manager selection must reject safety-blocked candidates, record structured alternate reasons, and close eligibility before changing a match.'
);
assert(
  nayaxRecommendationMigration.includes('nayaxLookupCandidates') &&
    nayaxRecommendationMigration.includes("'oneClickEligible'") &&
    nayaxRecommendationMigration.includes("'matchFactors'"),
  'The live overview RPC must return the sanitized versioned recommendation contract after reload.'
);

console.log('Nayax refund execution guardrails validated.');
