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
  managerSessionMigration: 'supabase/migrations/202608160001_refund_nayax_manager_session_execution.sql',
  managerSelectedMigration: 'supabase/migrations/202608170001_refund_manager_selected_nayax_execution.sql',
  officialActionMigration: 'supabase/migrations/202608030002_refund_manager_official_action_boundary.sql',
  providerOrchestrationMigration: 'supabase/migrations/202608040004_refund_nayax_provider_orchestration.sql',
  providerCapsMigration: 'supabase/migrations/202608110020_refund_nayax_provider_caps.sql',
  pendingApprovalRecoveryMigration: 'supabase/migrations/20260820041101_refund_nayax_pending_approval_recovery.sql',
  dailyReadinessUsageMigration: 'supabase/migrations/20260824224813_refund_nayax_daily_readiness_usage.sql',
  productionSimplificationMigration: 'supabase/migrations/20260830202234_refund_production_simplification.sql',
  providerOrchestration: 'supabase/functions/_shared/nayax-refund-orchestration.ts',
  providerGates: 'supabase/functions/_shared/nayax-refund-gates.ts',
  providerGatesTest: 'supabase/functions/_shared/nayax-refund-gates.test.ts',
  providerAdapter: 'supabase/functions/_shared/nayax-refund-provider.mjs',
  providerAdapterTest: 'scripts/refunds/validate-nayax-refund-provider.mjs',
  providerOrchestrationTest: 'supabase/functions/_shared/nayax-refund-orchestration.test.ts',
  providerEvidenceProducer: 'supabase/functions/_shared/nayax-refund-orchestration-evidence.ts',
  providerOrchestrationDatabaseTest: 'supabase/tests/refund_nayax_provider_orchestration.sql',
  officialActionHelper: 'supabase/functions/_shared/refund-official-action.ts',
  refundReadiness: 'supabase/functions/_shared/refund-readiness.ts',
  function: 'supabase/functions/nayax-card-refund/index.ts',
  config: 'supabase/config.toml',
  envExample: '.env.example',
  commercePreflight: 'scripts/commerce-preflight.mjs',
  nayaxLookup: 'supabase/functions/nayax-transaction-lookup/index.ts',
  nayaxLookupShared: 'supabase/functions/_shared/nayax-lookup.ts',
  refundAdminUpdate: 'supabase/functions/refund-case-admin-update/index.ts',
  refundCaseMessageSend: 'supabase/functions/refund-case-message-send/index.ts',
  refundManualMessageOutbox: 'supabase/functions/_shared/refund-manual-message-outbox.ts',
  refundManualMessageOutboxMigration: 'supabase/migrations/20260902002716_refund_manual_message_outbox.sql',
  refundEmailShared: 'supabase/functions/_shared/refund-email.ts',
  refundOperationsLib: 'src/lib/refundOperations.ts',
  refundOperationsUi: 'src/pages/admin/Refunds.tsx',
  refundReadPolling: 'src/lib/refundReadPolling.ts',
  refundPortalUat: 'scripts/refunds/validate-refund-portal-uat.mjs',
  nayaxCandidateTokenMigration: 'supabase/migrations/202605130001_refund_nayax_lookup_candidate_tokens.sql',
  nayaxRecommendationMigration: 'supabase/migrations/202607210003_refund_nayax_recommendation_state.sql',
  selectedNayaxEvidenceMigration: 'supabase/migrations/20260901050000_refund_selected_nayax_transaction_evidence.sql',
  manualPortalTest: 'supabase/tests/refund_nc_manual_nayax_portal.sql',
};

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');

const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
};

const migration = read(files.migration);
const managerAuthorizationMigration = read(files.managerAuthorizationMigration);
const managerSessionMigration = read(files.managerSessionMigration);
const managerSelectedMigration = read(files.managerSelectedMigration);
const officialActionMigration = read(files.officialActionMigration);
const providerOrchestrationMigration = read(files.providerOrchestrationMigration);
const providerCapsMigration = read(files.providerCapsMigration);
const pendingApprovalRecoveryMigration = read(files.pendingApprovalRecoveryMigration);
const dailyReadinessUsageMigration = read(files.dailyReadinessUsageMigration);
const productionSimplificationMigration = read(files.productionSimplificationMigration);
const executionContextMigration = read('supabase/migrations/20260903134847_refund_selected_nayax_execution_context.sql');
const providerOrchestration = read(files.providerOrchestration);
const providerGates = read(files.providerGates);
const providerGatesTest = read(files.providerGatesTest);
const providerAdapter = read(files.providerAdapter);
const providerAdapterTest = read(files.providerAdapterTest);
const providerOrchestrationTest = read(files.providerOrchestrationTest);
const providerEvidenceProducer = read(files.providerEvidenceProducer);
const providerOrchestrationDatabaseTest = read(files.providerOrchestrationDatabaseTest);
const officialActionHelper = read(files.officialActionHelper);
const refundReadiness = read(files.refundReadiness);
const fn = read(files.function);
const normalPreflight = fn.slice(
  fn.indexOf('const getPreflightBlocks'),
  fn.indexOf('const getDuplicateTransactionBlocks'),
);
const availabilityBranch = fn.slice(
  fn.indexOf('if (operation === "availability" && !requestedCaseId)'),
  fn.indexOf('const caseId = requestedCaseId'),
);
const config = read(files.config);
const envExample = read(files.envExample);
const preflight = read(files.commercePreflight);
const nayaxLookup = read(files.nayaxLookup);
const nayaxLookupShared = read(files.nayaxLookupShared);
const refundAdminUpdate = read(files.refundAdminUpdate);
const refundCaseMessageSend = read(files.refundCaseMessageSend);
const refundManualMessageOutbox = read(files.refundManualMessageOutbox);
const refundManualMessageOutboxMigration = read(files.refundManualMessageOutboxMigration);
const refundEmailShared = read(files.refundEmailShared);
const refundOperationsLib = read(files.refundOperationsLib);
const refundOperationsUi = read(files.refundOperationsUi);
const refundReadPolling = read(files.refundReadPolling);
const refundPortalUat = read(files.refundPortalUat);
const nayaxCandidateTokenMigration = read(files.nayaxCandidateTokenMigration);
const nayaxRecommendationMigration = read(files.nayaxRecommendationMigration);
const selectedNayaxEvidenceMigration = read(files.selectedNayaxEvidenceMigration);
const manualPortalTest = read(files.manualPortalTest);

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
    migration.includes('nayax_refund_max_amount_cents') &&
    productionSimplificationMigration.includes('set nayax_refund_max_amount_cents = null'),
  'Machine-level Nayax enablement remains required while the historical launch-cap field is retired.'
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
  providerGates.includes('NAYAX_REFUND_EXECUTION_KILL_SWITCH') &&
    providerGates.includes('NAYAX_REFUND_EXECUTION_ENABLED') &&
    providerGates.includes('NAYAX_REFUND_EXECUTION_DRY_RUN') &&
    providerGates.includes('NAYAX_REFUND_EXECUTOR_ASSERTION') &&
    providerGates.includes('NAYAX_REFUND_IDEMPOTENCY_SECRET') &&
    !providerGates.includes('remainingValueVerified') &&
    fn.includes('service_get_refund_nayax_execution_context') &&
    fn.includes('p_execution_context_hash: refundCase.executionContext!.contextHash'),
  'The HTTP boundary retains ordinary gates and binds the automatic exact selected purchase.'
);
assert(
  fn.includes('can_perform_refund_official_action') &&
    fn.includes('createNayaxRefundProviderAdapter') &&
    fn.includes('service_reserve_nayax_refund_manager_action_v3') &&
    fn.includes('service_record_nayax_refund_provider_stage_v3') &&
    fn.includes('service_get_nayax_refund_provider_journal_capability_v3') &&
    fn.includes('orchestrateNayaxRefund') &&
    fn.includes('authorizeRefundOfficialAction') &&
    fn.includes('service_settle_nayax_refund_attempt') &&
    !fn.includes('service_consume_nayax_refund_official_action') &&
    !fn.includes('can_manage_refund_case') &&
    !fn.includes('actorIsSuperAdmin'),
  'The HTTP function must use mapped-manager authorization for the normal path while retaining atomic reservation and settlement.'
);
const operationAllowlist = fn.slice(
  fn.indexOf('!new Set(['),
  fn.indexOf('const executionConfig = resolveNayaxRefundExecutionConfig'),
);
const normalExecutionGate = fn.indexOf('if (preExecutionBlocks.length > 0)');
const normalIdempotency = fn.lastIndexOf(
  'const idempotencyKey = await buildNayaxRefundIdempotencyKey',
);
const normalOrchestration = fn.indexOf('await orchestrateNayaxRefund', normalIdempotency);
assert(
  fn.includes('resolveNayaxRefundExecutionConfig') &&
    fn.indexOf('if (authError || !user)') <
      fn.indexOf('const executionConfig = resolveNayaxRefundExecutionConfig') &&
    operationAllowlist.includes('"execute"') &&
    operationAllowlist.includes('"availability"') &&
    !operationAllowlist.includes('controlled_owner_pilot') &&
    operationAllowlist.includes('approve_pending_request') &&
    !fn.includes('NAYAX_REFUND_EXTERNAL_PARTIAL_GUARD_SUPPORTED') &&
    !fn.includes('preExecutionBlocks.includes("provider_remaining_value_unverified")') &&
    fn.includes('NAYAX_REFUND_PENDING_APPROVAL_RECOVERY_SUPPORTED = false') &&
    fn.includes('pending_approval_recovery_retired') &&
    normalIdempotency > normalExecutionGate &&
    normalOrchestration > normalIdempotency &&
    providerGates.includes('NAYAX_REFUND_EXECUTOR_ASSERTION') &&
    providerGates.includes('NAYAX_REFUND_IDEMPOTENCY_SECRET') &&
    !providerGates.includes('NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS') &&
    !providerGates.includes('NAYAX_REFUND_DAILY_COUNT_CAP') &&
    providerGatesTest.includes('legacy canary and cap variables do not gate qualified transactions') &&
    providerGatesTest.includes('configured first attempts require no remaining-balance attestation') &&
    providerGatesTest.includes('normal amount uses the selected original purchase without inventing a remaining balance') &&
    managerSessionMigration.includes('pg_catalog.pg_advisory_xact_lock') &&
    providerGatesTest.includes('preserves runtime and credential gates'),
  'Production execute/availability and the retired forensic route retain their contracts, while normal execution retains scoped gates before idempotency and provider orchestration.'
);
assert(
  fn.includes('operation === "availability" && !requestedCaseId') &&
    fn.includes('refund_case_nayax_manager_readiness') &&
    fn.includes('resolveCaseRefundReadiness({') &&
    fn.includes('resolveNayaxRefundAvailability({') &&
    fn.includes('executionConfig,') &&
    fn.includes('NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED') &&
    fn.indexOf('if (authError || !user)') <
      fn.indexOf('const operation = sanitizeText') &&
    fn.indexOf('const operation = sanitizeText') <
      fn.indexOf('const executionConfig = resolveNayaxRefundExecutionConfig') &&
    fn.indexOf('operation === "availability" && !requestedCaseId') <
      fn.indexOf('const caseId = requestedCaseId') &&
    fn.indexOf('operation === "availability" && !requestedCaseId') <
      fn.indexOf('const refundCase = await getRefundCase') &&
    fn.lastIndexOf('if (operation === "availability")', fn.indexOf('if (operation === "approve_pending_request")')) >
      fn.indexOf('const refundCase = await getRefundCase') &&
    fn.lastIndexOf('if (operation === "availability")', fn.indexOf('if (operation === "approve_pending_request")')) <
      fn.indexOf('if (operation === "approve_pending_request")') &&
    fn.indexOf('if (operation === "availability")') <
      fn.indexOf('const idempotencyKey = await buildNayaxRefundIdempotencyKey') &&
    fn.indexOf('if (operation === "availability")') <
      fn.indexOf('await orchestrateNayaxRefund') &&
    providerGates.includes('payloadRedacted: true') &&
    providerGates.includes('NAYAX_REFUND_OFFICIAL_ACTIONS_ENABLED = true') &&
    providerGatesTest.includes('performs zero execution side effects'),
  'Authenticated availability must keep the legacy global check read-only and make case-specific readiness return before HMAC, reservation, provider execution, orchestration, or mutation.'
);
assert(
  providerGates.includes('official_actions_disabled') &&
    providerGates.includes('kill_switch_active') &&
    !providerGates.includes('provider_remaining_value_unverified') &&
    providerGates.includes('configuration_missing') &&
    !availabilityBranch.includes('...executionConfig') &&
    !availabilityBranch.includes('executionConfig.blocks') &&
    !availabilityBranch.includes('idempotencySecret') &&
    !availabilityBranch.includes('executorAssertion'),
  'Availability must collapse private configuration into the approved redacted reason enum without interpolating raw config or blocks.'
);
assert(
  providerGates.includes('buildNayaxRefundIdempotencyKey') &&
    !fn.includes('supabaseServiceRoleKey || "local-dev"') &&
    providerGatesTest.includes('never falls back to a service key or local default'),
  'Nayax idempotency must require its own strong secret with no service-role or local fallback.'
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
  fn.includes('resolveNormalNayaxRefundAmountCents({') &&
  fn.includes('matchedTransactionAmountCents: refundCase.matched_nayax_amount_cents') &&
  !fn.includes('remainingRefundableAmountCents') &&
  !fn.includes('body?.refundAmountCents') &&
  !fn.includes('requestedRefundAmountCents') &&
  !fn.includes('refundCase.refund_amount_cents ='),
  'Nayax execution uses the selected original amount and does not accept caller amount overrides.'
);
assert(
  providerGates.includes('resolveNormalNayaxRefundAmountCents') &&
    providerGatesTest.includes('normal amount uses the selected original purchase without inventing a remaining balance') &&
    providerGatesTest.includes('Invalid amount rejected') &&
    manualPortalTest.includes('The same account-scope transaction cannot enter a second case') &&
    nayaxRecommendationMigration.includes('refund_cases_unique_matched_nayax_transaction_id_idx'),
  'Focused tests must prove original-amount selection, invalid amount rejection, and cross-case exact-transaction uniqueness.'
);
assert(
  productionSimplificationMigration.includes('create or replace function public.refund_nayax_direct_api_execution_hard_disabled()') &&
    productionSimplificationMigration.includes('create or replace function public.admin_begin_refund_manual_nayax_portal_pre_ops_v1(') &&
    productionSimplificationMigration.includes("'reviewedNayaxPortalFallbackKind', case") &&
    productionSimplificationMigration.includes("else 'ordinary_exact_match'") &&
    productionSimplificationMigration.includes("refund_case.nayax_recommendation_state = 'high_confidence',\n            false") &&
    productionSimplificationMigration.includes('then machine.nayax_manual_portal_timezone') &&
    productionSimplificationMigration.includes('machine.nayax_manual_portal_enabled is true\n      or (') &&
    productionSimplificationMigration.includes('case_row.card_wallet_used is true') &&
    productionSimplificationMigration.includes('case_row.nayax_match_execution_eligible is false') &&
    productionSimplificationMigration.includes("'provider_call_made', false") &&
    productionSimplificationMigration.includes("'customer_message_created', false") &&
    manualPortalTest.includes('An unattempted ordinary match cannot bypass the API') &&
    manualPortalTest.includes('Legacy portal work is discoverable before evidence') &&
    manualPortalTest.includes('legacy context becomes selected after the guarded evidence-selection boundary') &&
    manualPortalTest.includes('The server enforces the same rejection requirement') &&
    executionContextMigration.includes('refund_nayax_original_portal_fallback_ready') &&
    refundPortalUat.includes('Ordinary portal fallback cannot bypass') &&
    refundPortalUat.includes('Manual portal completion requires explicit verification of the full selected amount'),
  'Reviewed portal fallback must be rejection-bound, wallet-capable, provider-free on approval, and full-amount evidenced on completion.'
);
assert(
  providerOrchestration.includes('provider_execution_not_yet_enabled') &&
    fn.includes('NAYAX_REFUND_MANAGER_CONTRACT_JSON') &&
    fn.includes('service_record_nayax_refund_provider_stage') &&
    fn.includes('provider,') &&
    !fn.includes('contractVersion: "nayax-production-manager-v1"') &&
    !fn.includes('provider: disabledNayaxProviderAdapter') &&
    !fn.includes('mode: "synthetic"') &&
    !fn.includes('/payment/refund-request') &&
    !fn.includes('/payment/refund-approve'),
  'The reviewed live adapter uses automatic original identity and the existing execution gates.'
);
assert(
  fn.includes('operation === "approve_pending_request"') &&
    fn.includes('NAYAX_REFUND_PENDING_APPROVAL_RECOVERY_SUPPORTED = false') &&
    fn.includes('pending_approval_recovery_retired') &&
    fn.includes('...executionConfig.blocks') &&
    fn.includes('NAYAX_REFUND_APPROVE_WRITE_TOKEN_${accountKey}') &&
    fn.includes('approval_contract_version_invalid') &&
    fn.includes('executeNayaxRefundApprovalOnly') &&
    fn.includes('service_reserve_nayax_pending_approval_recovery') &&
    fn.includes('service_settle_nayax_pending_approval_recovery') &&
    pendingApprovalRecoveryMigration.includes('nayax_refund_attempt_id uuid not null unique') &&
    pendingApprovalRecoveryMigration.includes("provider_status is distinct from 'request_unknown_contract_mismatch'") &&
    pendingApprovalRecoveryMigration.includes("journal.stage = 'approve'") &&
    !pendingApprovalRecoveryMigration.includes('/payment/refund-request'),
  'The legacy pending-request recovery must remain retired while preserving its single-use forensic boundary and full current gates.'
);
assert(
  providerAdapter.includes('ALLOWED_NAYAX_REFUND_HOSTS') &&
    providerAdapter.includes('url.port') &&
    providerAdapter.includes('must match an exact Result and Status pair') &&
    providerAdapter.includes('refund-request') &&
    providerAdapter.includes('refund-approve') &&
    providerAdapter.includes('IsRefundedExternally: false') &&
    providerAdapter.includes('freezeNayaxRefundEvidence') &&
    providerAdapter.includes('frozen orchestration evidence') &&
    providerAdapter.includes('redirect: "error"') &&
    providerAdapter.includes('payloadRedacted: true') &&
    providerAdapterTest.includes('Approval uncertainty is never retried internally') &&
    providerAdapterTest.includes('Evidence mismatch fails before any provider call') &&
    providerAdapterTest.includes('The kill switch defaults to active'),
  'The production adapter must be host-bounded, evidence-bound, exact-contract, redacted, timeout-safe, and comprehensively tested.'
);
assert(
  providerCapsMigration.includes('pg_catalog.pg_advisory_xact_lock') &&
    productionSimplificationMigration.includes('service_reserve_and_consume_nayax_refund_attempt(') &&
    productionSimplificationMigration.includes("function_definition := replace(\n    function_definition,\n    daily_cap_call_anchor,\n    cap_free_call"),
  'Production preserves the atomic reservation and exact replay controls while bypassing retired rollout caps.'
);
assert(
  dailyReadinessUsageMigration.includes('create or replace function public.service_refund_nayax_daily_usage()') &&
    !refundReadiness.includes('parseNayaxRefundDailyUsage') &&
    !fn.includes('service_refund_nayax_daily_usage') &&
    !refundAdminUpdate.includes('service_refund_nayax_daily_usage') &&
    refundAdminUpdate.includes('service_get_nayax_refund_provider_journal_capability_v3') &&
    refundAdminUpdate.includes('parseNayaxRefundProviderContract') &&
    refundAdminUpdate.includes('providerJournalAvailable') &&
    !fn.includes('.from("refund_case_nayax_refund_attempts")') &&
    !refundAdminUpdate.includes('.from("refund_case_nayax_refund_attempts")'),
  'Production readiness ignores the historical daily-usage aggregate and never directly reads the private provider-attempt ledger.'
);
assert(
  providerOrchestrationMigration.includes('service_reserve_and_consume_nayax_refund_attempt') &&
  providerOrchestrationMigration.includes('service_settle_nayax_refund_attempt') &&
    providerOrchestrationMigration.includes('provider_claim_digest') &&
    providerOrchestrationMigration.includes("current_setting('bloomjoy.nayax_settlement_provider_claim', true)") &&
    providerOrchestrationMigration.includes("perform set_config(\n    'bloomjoy.nayax_settlement_provider_claim'") &&
    (providerOrchestrationMigration.match(
      /attempt\.provider_claim_digest = settlement_provider_claim_digest/g
    ) ?? []).length === 2 &&
    providerOrchestrationMigration.includes('assert_nayax_provider_executor') &&
    providerOrchestrationMigration.includes('Card completion requires token-bound confirmed provider settlement') &&
    providerOrchestrationMigration.includes('from public, anon, authenticated, service_role') &&
    providerOrchestrationMigration.includes('service_consume_nayax_refund_official_action'),
  'Local proof must use assertion-scoped atomic reservation/settlement and revoke the legacy service consumer.'
);
assert(
  providerOrchestrationMigration.indexOf(
    "perform set_config(\n    'bloomjoy.nayax_settlement_provider_claim'"
  ) > providerOrchestrationMigration.indexOf('Valid unused attempt-scoped provider claim required') &&
    providerOrchestrationDatabaseTest.includes(
      'Attempt ID alone cannot authorize a raw card completion through a SECURITY DEFINER wrapper'
    ) &&
    providerOrchestrationDatabaseTest.includes(
      'A wrong raw provider claim cannot authorize another official mutation through a SECURITY DEFINER wrapper'
    ) &&
    providerOrchestrationDatabaseTest.includes(
      'ID-only trigger bypass attempts leave case, provider attempt, and reporting state unchanged'
    ) &&
    providerOrchestrationDatabaseTest.includes(
      'Wrong-token trigger bypass attempts leave case, provider attempt, and reporting state unchanged'
    ) &&
    providerOrchestrationDatabaseTest.includes(
      'The correct raw claim through the settlement wrapper atomically proves terminal attempt, case finalization, and reporting'
    ) &&
    providerOrchestrationDatabaseTest.includes(
      'The consumed provider claim cannot be reused and a terminal provider outcome cannot be rewritten'
    ),
  'The trigger capability must be claim-bound only after wrapper validation and regression-tested against ID-only, wrong-token, replay, and terminal rewrites.'
);
const providerCompletionFinish = providerOrchestrationMigration.slice(
  providerOrchestrationMigration.indexOf(
    'create or replace function public.service_finish_nayax_refund_completion'
  ),
  providerOrchestrationMigration.indexOf(
    'revoke execute on function public.assert_nayax_provider_executor'
  )
);
assert(
  providerCompletionFinish.includes(
    "outbound_row.recipient_resolution_status is distinct from 'resolved'"
  ) &&
    !providerCompletionFinish.includes("'resolved_with_exclusions'") &&
    providerOrchestrationDatabaseTest.includes(
      'Provider completion rejects an exclusion-status route even when its visible CC count otherwise matches'
    ),
  'Provider completion must require exact complete current-manager routing and reject partial exclusion-status proof.'
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
  refundPortalUat.includes('functionCalls.length === 0') &&
    refundPortalUat.includes("functionCalls: ['future-mutating-edge-function']") &&
    refundPortalUat.includes('Navigation safety proof fails closed for an unknown Edge Function call') &&
    refundPortalUat.includes('rpcCalls.every((name) => NAVIGATION_READ_ONLY_RPCS.has(name))'),
  'Portal navigation evidence must fail closed on every Edge Function call and every non-allowlisted RPC, including an unknown-function negative self-check.'
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
    preflight.includes('REFUND_AUTOMATION_SWEEP_SECRET') &&
    preflight.includes("'NAYAX_REFUND_MANAGER_CONTRACT_JSON'") &&
    preflight.includes("'NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED'") &&
    preflight.includes("'NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED'") &&
    preflight.includes('NAYAX_REFUND_REQUEST_WRITE_TOKEN_') &&
    preflight.includes('NAYAX_REFUND_APPROVE_WRITE_TOKEN_') &&
    !preflight.includes("'NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED'"),
  'Commerce preflight must validate active v3 refund configuration rather than the retired pilot assertion.'
);
assert(
  fn.includes('NAYAX_REFUND_PRODUCTION_BASE_URL') &&
    fn.includes('provider_contract_host_invalid') &&
    fn.includes('areNayaxRefundWriteCredentialsReady') &&
    refundAdminUpdate.includes('NAYAX_REFUND_PRODUCTION_BASE_URL') &&
    refundAdminUpdate.includes('areNayaxRefundWriteCredentialsReady'),
  'Normal execution and both readiness paths must require the exact production host and adapter-valid write credentials.'
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
    refundManualMessageOutbox.includes('sendRefundTransactionalEmail') &&
    refundEmailShared.includes('replyTo: getRefundReplyToEmail()') &&
    refundManualMessageOutboxMigration.includes('p_actor_user_id') &&
    refundManualMessageOutboxMigration.includes('customer_message_queued') &&
    refundCaseMessageSend.includes('validateRefundCustomerMessageRequest') &&
    refundCaseMessageSend.includes('decisionReason: refundCase.decision_reason') &&
    refundEmailShared.includes('sanitizeRefundCustomerSafeDenialReason') &&
    refundEmailShared.includes('A customer-safe denial reason is required for a denial message.'),
  'Portal customer messaging must be authorized, logged, editable from approved templates, reply-to the support inbox, reject premature card approval/completion messages, and expose only customer-safe denial reasons.'
);
assert(
  refundOperationsLib.includes("selectedNayaxTransactionContractVersion?: 'refund_selected_nayax_transaction_v1'") &&
    refundOperationsLib.includes('selectedNayaxTransaction?: RefundSelectedNayaxTransaction | null') &&
    !refundOperationsLib.includes('matchedNayaxTransactionId') &&
    selectedNayaxEvidenceMigration.includes("refund_case.matched_nayax_transaction_id is not null") &&
    selectedNayaxEvidenceMigration.includes("'payloadRedacted', true"),
  'Browser refund operation types may expose only the redacted, already-selected transaction evidence contract.'
);
assert(
  !refundOperationsUi.includes('candidate.transactionId') &&
    !refundOperationsUi.includes('matchedNayaxTransactionId') &&
    refundOperationsUi.includes('selectedTransactionEvidence.transactionId') &&
    refundOperationsUi.includes('navigator.clipboard.writeText(selectedTransactionEvidence.transactionId)'),
  'Browser refund UI must keep candidates tokenized and may copy only the exact selected transaction reference.'
);
assert(
  !normalPreflight.includes('if (refundCase.card_wallet_used) blocks.push("manual_review")') &&
    !normalPreflight.includes('refundCase.nayax_recommendation_state !== "high_confidence"') &&
    !normalPreflight.includes('refundCase.payment_amount_cents !== amountCents') &&
    normalPreflight.includes('refundCase.matched_nayax_amount_cents !== amountCents') &&
    fn.includes('duplicate_transaction') &&
    managerSelectedMigration.includes("selection_event.event_type = 'nayax_match_selected'") &&
    managerSelectedMigration.includes('create or replace function public.can_prepare_nayax_refund_execution') &&
    managerSelectedMigration.includes("refund_case.nayax_recommendation_state = 'high_confidence'") &&
    managerSelectedMigration.includes('or exists (') &&
    managerSelectedMigration.includes('refund_case.refund_amount_cents is distinct from p_amount_cents') &&
    managerSelectedMigration.includes('refund_case.matched_nayax_amount_cents is distinct from p_amount_cents') &&
    !managerSelectedMigration.includes("refund_case.nayax_recommendation_state <> 'high_confidence'") &&
    !managerSelectedMigration.includes('or refund_case.card_wallet_used') &&
    nayaxRecommendationMigration.includes('refund_cases_unique_matched_nayax_transaction_id_idx'),
  'Nayax execution must require an audited manager selection and the exact selected provider amount without treating wallet digits, confidence, or the reported amount as execution gates.'
);
assert(
  refundAdminUpdate.includes('selection_allowed') &&
    refundAdminUpdate.includes('nayaxDisagreementReason') &&
    refundAdminUpdate.includes('nayax_match_execution_eligible: false'),
  'Manager selection must reject safety-blocked candidates, record structured alternate reasons, and close eligibility before changing a match.'
);
assert(
  refundAdminUpdate.includes('validateRefundEvidenceSelectionRequest') &&
    refundAdminUpdate.includes('validateCardPreExecutionRequest'),
  'The refund admin endpoint must enforce evidence-only Nayax selection and reject premature card approvals server-side.'
);
assert(
  refundOperationsUi.includes("label: 'Confirm this transaction'") &&
    refundOperationsUi.includes("This does not issue a refund or email the customer") &&
    refundOperationsUi.includes("targetStatus: 'needs_review'") &&
    refundOperationsUi.includes("mode: 'nayax_evidence_selection'") &&
    !refundOperationsUi.includes("label: 'Confirm this card sale'"),
  'The manager UI must present transaction selection as evidence review, never as refund approval.'
);
assert(
  refundOperationsUi.includes('candidateOption(') &&
    refundOperationsUi.includes('nayax-candidate-availability') &&
    refundOperationsUi.includes('nayax-transaction-comparison') &&
    refundOperationsUi.includes('role="radiogroup"') &&
    refundOperationsUi.includes('type="radio"') &&
    refundOperationsUi.includes('candidateUnavailableReason') &&
    refundOperationsUi.includes('caseAllowsCandidateSelection') &&
    refundOperationsUi.includes('refundAmount:') &&
    refundOperationsUi.includes('(candidate.amountCents / 100).toFixed(2)') &&
    refundOperationsUi.includes('const refundAmountCents = selectedCase.matchedNayaxAmountCents') &&
    refundOperationsUi.includes('The full selected Nayax transaction amount is set automatically') &&
    refundOperationsUi.includes("refundCase.reviewedNayaxPortalFallbackKind === 'ordinary_exact_match'") &&
    !refundOperationsUi.includes("refundReadiness?.blockReason === 'provider_remaining_value_unverified'") &&
    refundOperationsUi.includes("refundCase.reviewedNayaxPortalFallbackKind === 'legacy_manual_evidence'") &&
    refundOperationsUi.includes('Approve refund for Nayax portal') &&
    !refundOperationsUi.includes('data-testid="legacy-refund-amount-input"') &&
    !refundOperationsUi.includes('Match strength:') &&
    !refundOperationsUi.includes('Card details agree'),
  'The manager UI must show safe candidates, provide no editable normal amount, and preserve the reviewed manual portal fallback while direct execution is blocked.'
);
assert(
  refundOperationsUi.includes('RefundLifecycleProgress') &&
    refundOperationsUi.includes('overviewPolling.interval(refundOverviewPollingInterval(') &&
    refundReadPolling.includes('lifecycle.refreshAfterSeconds') &&
    refundReadPolling.includes('!lifecycle.terminal') &&
    refundOperationsUi.includes('lookupRequestSequenceRef') &&
    refundOperationsUi.includes('Refresh transactions') &&
    refundOperationsUi.includes('refundOperationsAccess') &&
    refundOperationsUi.includes('Needs Refund Operations') &&
    refundOperationsUi.includes('60-minute SLA'),
  'The manager UI must consume the canonical lifecycle, discard stale lookups, expose safe refresh, and keep technical reconciliation in Refund Operations.'
);
assert(
  nayaxRecommendationMigration.includes('nayaxLookupCandidates') &&
    nayaxRecommendationMigration.includes("'oneClickEligible'") &&
    nayaxRecommendationMigration.includes("'matchFactors'"),
  'The live overview RPC must return the sanitized versioned recommendation contract after reload.'
);

console.log('Nayax refund execution guardrails validated.');
