import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const migration = await readFile(new URL(
  'supabase/migrations/20260913090000_refund_single_manager_gate.sql', root
), 'utf8');
const systemBoundaryMigration = await readFile(new URL(
  'supabase/migrations/20260913153000_refund_system_saved_approval_boundary.sql', root
), 'utf8');
const officialAction = await readFile(new URL(
  'supabase/functions/_shared/refund-official-action.ts', root
), 'utf8');
const orchestration = await readFile(new URL(
  'supabase/functions/_shared/nayax-refund-orchestration.ts', root
), 'utf8');
const portal = await readFile(new URL('src/pages/admin/Refunds.tsx', root), 'utf8');
const refundOperations = await readFile(new URL('src/lib/refundOperations.ts', root), 'utf8');
const journalRecoveryMigration = await readFile(new URL(
  'supabase/migrations/20260908221526_refund_same_source_duplicate_settlement_recovery.sql', root
), 'utf8');
const providerOrchestrationDbTest = await readFile(new URL(
  'supabase/tests/refund_nayax_provider_orchestration.sql', root
), 'utf8');
const managerSessionDbTest = await readFile(new URL(
  'supabase/tests/refund_nayax_manager_session_execution.sql', root
), 'utf8');
const managerSessionRaceDbTest = await readFile(new URL(
  'supabase/tests/refund_manager_action_step_up_concurrency.sql', root
), 'utf8');
const systemSavedApprovalDbTest = await readFile(new URL(
  'supabase/tests/refund_nayax_system_saved_approval.sql', root
), 'utf8');
const retiredLaneDbTest = await readFile(new URL(
  'supabase/tests/refund_manager_action_step_up_safety.sql', root
), 'utf8');
const retiredPilotRaceDbTest = await readFile(new URL(
  'supabase/tests/refund_nayax_controlled_owner_pilot_concurrency.sql', root
), 'utf8');
const nayaxEdge = await readFile(new URL(
  'supabase/functions/nayax-card-refund/index.ts', root
), 'utf8');
const automationSweep = await readFile(new URL(
  'supabase/functions/refund-case-automation-sweep/index.ts', root
), 'utf8');
const systemSavedApprovalWorker = await readFile(new URL(
  'supabase/functions/_shared/nayax-system-saved-approval.ts', root
), 'utf8');
const outcomeResolveEdge = await readFile(new URL(
  'supabase/functions/refund-nayax-outcome-resolve/index.ts', root
), 'utf8');
const retiredStepUpEdge = await readFile(new URL(
  'supabase/functions/refund-manager-action-step-up/index.ts', root
), 'utf8');
const retiredTotpEnrollmentEdge = await readFile(new URL(
  'supabase/functions/refund-manager-totp-enrollment/index.ts', root
), 'utf8');

test('one normalized authority resolver feeds one canonical authorization path', () => {
  assert.match(migration, /create or replace function public\.refund_official_action_authority/);
  assert.match(migration, /'kind','machine_manager'/);
  assert.match(migration, /'kind','super_admin'/);
  assert.doesNotMatch(migration, /pre_single_manager_gate|super_admin_only/i);
  assert.equal((migration.match(/create or replace function public\.admin_authorize_refund_official_action\(/g) ?? []).length, 1);
  assert.equal((migration.match(/create or replace function public\.service_reserve_nayax_refund_manager_action\(/g) ?? []).length, 1);
});

test('authority identity is separate from case readiness blockers', () => {
  const resolver = migration.match(
    /create or replace function public\.refund_official_action_authority\([\s\S]*?revoke all on function public\.refund_official_action_authority/
  )?.[0] ?? '';
  assert.doesNotMatch(resolver, /duplicate_of_refund_case_id|unresolved_reconciliation|gmail_case_link_review/);
  assert.match(migration, /c\.duplicate_of_refund_case_id is not null/);
  assert.match(migration, /refund_case_has_unresolved_reconciliation\(c\.id\)/);
  assert.match(migration, /review\.status='pending'/);
});

test('normal manager confirmation creates one receipt and no step-up artifact', () => {
  assert.equal((migration.match(/insert into public\.refund_case_official_action_authorizations/g) ?? []).length, 2,
    'one generic decision receipt insert plus one direct Nayax receipt insert');
  assert.match(migration, /Nayax execution authorization is created only by the atomic refund reservation/);
  assert.doesNotMatch(migration, /insert into public\.refund_manager_action_step_up_intents/);
  assert.match(migration, /'authorized'.*null,null,evidence_hash,'manager_session'/s);
  assert.match(migration, /receipt\.step_up_intent_id is not null or receipt\.verified_totp_at is not null/);
  assert.match(orchestration, /authorizationMethod === "manager_session" && action\.stepUpIntentId != null/);
  assert.doesNotMatch(portal, /manual_nayax_approval|handleApproveManualNayaxRefund|Approve refund for Nayax portal|technicalRefundOperationsAction/);
  assert.match(
    migration,
    /revoke execute on function public\.admin_begin_refund_manual_nayax_portal\(uuid,bigint\)\s+from public,anon,authenticated,service_role;/,
    'no application role can create a current manual-portal attempt',
  );
  assert.match(migration, /raise exception 'The manual Nayax portal refund lane is retired'\s+using errcode='42501'/);
  assert.match(
    migration,
    /revoke execute on function public\.admin_prepare_refund_action_step_up_intent\([\s\S]*?from public,anon,authenticated,service_role;/,
  );
  assert.match(
    migration,
    /revoke execute on function public\.admin_consume_refund_action_step_up_intent\([\s\S]*?from public,anon,authenticated,service_role;/,
  );
  assert.doesNotMatch(refundOperations, /beginRefundManualNayaxPortal|admin_begin_refund_manual_nayax_portal/);
  assert.doesNotMatch(portal, /legacy-refund-run-nayax-refund/);
  assert.doesNotMatch(portal + refundOperations, /manager_verification_required|Manager verification required/);
  assert.match(systemBoundaryMigration, /admin_get_refund_operations_overview_pre_single_manager_gate_v1/);
  assert.match(systemBoundaryMigration, /'canPerformOfficialAction',public\.refund_official_actions_enabled\(\)[\s\S]*?public\.can_perform_refund_official_action/);
  assert.equal(
    (portal.match(/onClick=\{\(\) => void handleRunNayaxRefund\(\)\}/g) ?? []).length,
    1,
    'only the confirmation dialog calls the refund handler directly',
  );
  assert.equal(
    (portal.match(/hasReadyRefund \? 'refund-run-nayax-refund'/g) ?? []).length,
    1,
    'ready card cases render one primary refund action',
  );
  assert.match(
    migration,
    /create or replace function public\.service_settle_nayax_refund_attempt_pre_definitive_retry_v1\([\s\S]*?authorization_row\.authorization_method is distinct from 'manager_session'[\s\S]*?authorization_row\.step_up_intent_id is not null[\s\S]*?authorization_row\.verified_totp_at is not null/,
    'the deepest settlement implementation directly requires the single manager-session receipt',
  );
  assert.match(
    journalRecoveryMigration,
    /and attempt\.actor_user_id = authz\.actor_user_id/,
    'the journal receipt predicate anchor comes from the real canonical definition',
  );
  assert.match(migration, /create or replace function public\.refund_nayax_unsettled_api_success_journal_proved\([\s\S]*?and authz\.authorization_method = 'manager_session'[\s\S]*?and authz\.step_up_intent_id is null[\s\S]*?and authz\.verified_totp_at is null/);
  assert.doesNotMatch(migration, /pg_get_functiondef/, 'migrations use explicit readable function definitions');
  const normalizedJournalRecoveryMigration = journalRecoveryMigration.replace(/\r\n/g, '\n');
  const journalFunction = normalizedJournalRecoveryMigration.match(
    /create function public\.refund_nayax_unsettled_api_success_journal_proved\([\s\S]*?revoke all on function public\.refund_nayax_unsettled_api_success_journal_proved/
  )?.[0] ?? '';
  const transformedJournalFunction = journalFunction
    .replace(
      `    join public.refund_manager_action_step_up_intents intent\n` +
        `      on intent.id = attempt.step_up_intent_id\n` +
        `      and intent.id = authz.step_up_intent_id\n`,
      '',
    )
    .replace(
      `      and authz.verified_totp_at is not null\n` +
        `      and authz.nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'\n` +
        `      and intent.status = 'consumed'\n` +
        `      and intent.action = 'nayax_execute'\n` +
        `      and intent.target_function = 'nayax-card-refund'\n` +
        `      and intent.refund_case_id = refund_case.id\n` +
        `      and intent.actor_user_id = authz.actor_user_id\n` +
        `      and intent.verified_totp_at = authz.verified_totp_at\n` +
        `      and intent.nayax_execution_evidence_hash = authz.nayax_execution_evidence_hash\n`,
      `      and authz.authorization_method = 'manager_session'\n` +
        `      and authz.step_up_intent_id is null\n` +
        `      and authz.verified_totp_at is null\n` +
        `      and authz.nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'\n`,
    );
  assert.doesNotMatch(transformedJournalFunction, /intent\.|refund_manager_action_step_up_intents/);
  assert.match(transformedJournalFunction, /authz\.authorization_method = 'manager_session'/);
  assert.match(providerOrchestrationDbTest, /if p_legacy_step_up then/);
  assert.match(providerOrchestrationDbTest, /evidence_hash, 'manager_session'/);
  assert.match(providerOrchestrationDbTest, /series = 6/);
  assert.equal(
    (providerOrchestrationDbTest.match(/insert into public\.refund_manager_action_step_up_intents/g) ?? []).length,
    1,
    'only the dedicated legacy fixture creates a step-up row',
  );
});

test('the four execution protections remain explicit and customer mail stays success-only', () => {
  assert.match(migration, /Manager authority changed before confirmation/);
  assert.match(migration, /Refund case changed since review/);
  assert.match(migration, /selected Nayax transaction is not ready for refund/i);
  assert.match(migration, /idempotency key is bound to different immutable context/i);
  assert.match(migration, /provider_outcome='success'/);
  assert.match(orchestration, /deliverCustomerCompletion/);
  assert.match(orchestration, /attempt\.providerOutcome === "success"/);
  assert.doesNotMatch(officialAction, /scoped_admin/);
});

test('approval continuation preserves the original receipt without a second manager gate', () => {
  const receiptConsumer = migration.match(
    /create or replace function public\.consume_refund_official_action_authorization\([\s\S]*?revoke all on function public\.consume_refund_official_action_authorization/
  )?.[0] ?? '';
  const receiptAuthority = migration.match(
    /create or replace function public\.refund_official_action_receipt_authority_valid\([\s\S]*?revoke all on function public\.refund_official_action_receipt_authority_valid/
  )?.[0] ?? '';
  const systemConsumer = migration.match(
    /create or replace function public\.service_consume_nayax_refund_official_action\([\s\S]*?revoke execute on function public\.service_consume_nayax_refund_official_action/
  )?.[0] ?? '';
  assert.match(migration, /refund_official_action_receipt_authority_valid/);
  assert.doesNotMatch(receiptConsumer, /refund_official_action_authority|reporting_machine_refund_managers|admin_roles/);
  assert.doesNotMatch(receiptAuthority, /reporting_machine_refund_managers|admin_roles|can_perform_refund_official_action/);
  assert.doesNotMatch(systemConsumer, /can_prepare_nayax_refund_execution|can_perform_refund_official_action|reporting_machine_refund_managers|admin_roles/);
  assert.match(systemConsumer, /nayax_execution_evidence_hash/);
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.service_consume_nayax_refund_official_action\([\s\S]*?to service_role/,
  );
  assert.match(migration, /drop column current_manager_mapping_id/);
  assert.match(migration, /candidate\.approving_actor_user_id/);
  assert.doesNotMatch(migration, /currentManagerMappingId|currentManagerMappingVersion/);
  assert.match(migration, /It never creates or repeats the refund request/);
  assert.match(
    migration,
    /current_execution_authorized := public\.refund_official_action_receipt_authority_valid/,
    'the execution-context trigger starts from the immutable receipt, not live authority',
  );
  assert.match(
    managerSessionDbTest,
    /set status='revoked',[\s\S]*?revoke_reason='Synthetic post-approval authority change'[\s\S]*?execution evidence changed/,
    'executable coverage changes access after approval while preserving evidence-drift protection',
  );
  assert.match(managerSessionDbTest, /authorization expired/);
  assert.match(managerSessionDbTest, /cannot be consumed for a different case/);
  assert.match(managerSessionDbTest, /A stale case version creates no receipt or provider attempt/);
  assert.match(managerSessionRaceDbTest, /Exactly one racing request owns the provider call/);
  assert.match(managerSessionRaceDbTest, /expected_case_version=1/);
});

test('saved human approval is isolated behind a private System receipt boundary', () => {
  assert.match(systemBoundaryMigration, /create table public\.refund_nayax_system_saved_approval_receipts/);
  assert.match(systemBoundaryMigration, /source_approval_authorization_id uuid not null unique/);
  assert.match(systemBoundaryMigration, /original_authority_kind in \('machine_manager','super_admin'\)/);
  assert.match(systemBoundaryMigration, /status in \('available','claimed','consumed','held'\)/);
  assert.doesNotMatch(systemBoundaryMigration, /created_at\+interval '30 days'/);
  assert.match(systemBoundaryMigration, /provider_claim_expires_at=statement_timestamp\(\)\+interval '5 minutes'/);
  const receiptTable = systemBoundaryMigration.match(
    /create table public\.refund_nayax_system_saved_approval_receipts[\s\S]*?\n\);/,
  )?.[0] ?? '';
  assert.doesNotMatch(receiptTable, /provider_claim_digest|provider_claim_expires_at/);
  assert.match(systemBoundaryMigration, /enable row level security/);
  assert.match(
    systemBoundaryMigration,
    /revoke all on table public\.refund_nayax_system_saved_approval_receipts\s+from public,anon,authenticated,service_role/,
  );
  assert.match(systemBoundaryMigration, /official_action_authorization_id is null and step_up_intent_id is null/);
  assert.match(systemBoundaryMigration, /source_approval\.action<>'approve'/);
  assert.match(systemBoundaryMigration, /source_approval\.authorization_method<>'manager_session'/);
  assert.match(systemBoundaryMigration, /source_approval\.expected_case_version\+1<>refund_case\.official_action_version/);
  assert.match(systemBoundaryMigration, /selected_nayax_candidate_evidence_hash/);
  assert.match(systemBoundaryMigration, /refund_nayax_candidate_identifier_evidence_state/);
  assert.match(systemBoundaryMigration, /refund_nayax_attempt_system_receipt_case_fk/);
  assert.match(systemBoundaryMigration, /refund_nayax_system_receipt_attempt_case_fk/);
  assert.match(systemBoundaryMigration, /machine_authorization_time_serialization_mode/);
  assert.match(systemBoundaryMigration, /refund_email_list_mode/);
  assert.match(systemBoundaryMigration, /provider_contract_version/);
  assert.match(systemBoundaryMigration, /journal_contract_version/);
  assert.match(systemBoundaryMigration, /provider_account_scope_digest/);
  assert.doesNotMatch(systemBoundaryMigration, /'accountKey'|"accountKey"/);
  assert.match(systemBoundaryMigration, /selector_machine\.nayax_account_key=p_account_key/);
  assert.match(systemBoundaryMigration, /p_limit is distinct from 1/);
  assert.match(systemBoundaryMigration, /service_reclaim_nayax_system_saved_approval_no_call_v1/);
  assert.match(systemBoundaryMigration, /attempt\.system_saved_approval_receipt_id is null/);
  assert.match(systemBoundaryMigration, /not exists\(select 1 from public\.refund_nayax_provider_stage_journal/);
  assert.match(systemBoundaryMigration, /'providerWireContext'/);
  assert.doesNotMatch(systemBoundaryMigration, /'executionContext',jsonb_build_object/);
  assert.match(systemBoundaryMigration, /revoke all on function public\.guard_refund_nayax_system_saved_approval_receipt\(\)/);
  assert.match(systemBoundaryMigration, /System owns approved refund continuation/);
  assert.doesNotMatch(systemBoundaryMigration, /authorization_method\s+in\s*\([^)]*system_saved_approval/i);
  assert.match(systemBoundaryMigration, /refund_nayax_system_receipt_source_case_fk/);
  assert.match(systemBoundaryMigration, /refund_nayax_system_receipt_candidate_case_fk/);
  assert.match(systemBoundaryMigration, /refund_official_action_selected_candidate_case_fk/);
  assert.match(systemBoundaryMigration, /exact_count=1/);
  assert.match(systemBoundaryMigration, /Saved approval evidence is missing or ambiguous/);
  assert.match(systemBoundaryMigration, /refund_nayax_system_unsettled_api_success_proved_v1/);
  assert.match(systemBoundaryMigration, /refund_record_nayax_system_late_accounting_exception_v1/);
  assert.match(systemBoundaryMigration, /service_settle_nayax_system_saved_approval_v1/);
  assert.match(systemBoundaryMigration, /refund_nayax_system_saved_approval_terminal_binding_valid_v1/);
  assert.match(systemBoundaryMigration, /refund_nayax_system_definitive_rejection_proved_v1/);
  assert.match(systemBoundaryMigration, /journal_contract_version='nayax-provider-journal-v3'/);
  assert.match(systemBoundaryMigration, /bloomjoy\.nayax_definitive_rejection_attempt_id/);
  assert.match(systemBoundaryMigration, /safe_transport_stage='released_no_refund'/);
  assert.match(systemBoundaryMigration, /terminal_refund_receipt_recording_deferred/);
  assert.match(systemBoundaryMigration, /provider_rejection_requires_reconciliation/);
  assert.match(systemBoundaryMigration, /safeRetryEligible',definitive_rejection/);
  assert.doesNotMatch(systemBoundaryMigration, /pg_get_functiondef/);
  assert.doesNotMatch(
    systemBoundaryMigration.match(/create function public\.refund_nayax_system_saved_approval_snapshot_v1[\s\S]*?revoke all on function public\.refund_nayax_system_saved_approval_snapshot_v1/)?.[0] ?? '',
    /can_perform_refund_official_action|is_super_admin|reporting_machine_refund_managers/,
  );
  assert.match(systemSavedApprovalDbTest, /changing current manager access does not invalidate immutable system authority/i);
  assert.match(systemSavedApprovalDbTest, /old provider token is invalid immediately after safe reclaim/i);
  assert.match(systemSavedApprovalDbTest, /legacy backfill reconstructs only one unique exact candidate/i);
  assert.match(systemSavedApprovalDbTest, /ambiguous legacy evidence is held with zero provider attempt/i);
  assert.match(systemSavedApprovalDbTest, /evidence drift is held before any System receipt, attempt, or provider call/i);
  assert.match(systemSavedApprovalDbTest, /fresh manager key cannot race a saved human approval before System claims it/i);
  assert.match(
    systemBoundaryMigration,
    /source_approval\.action='approve'[\s\S]*?source_approval\.status='consumed'[\s\S]*?nayax_refund_execution_authorized/,
    'manager reservation blocks a saved approval by case, not only by idempotency key',
  );
});

test('the browser is read-only after approval and cannot request continuation', () => {
  assert.match(portal, /System is finishing this approved refund/);
  assert.match(portal, /No action is needed\. Do not try the refund again\./);
  assert.match(portal, /Check the exact transaction in Nayax/);
  assert.ok(
    portal.indexOf('if (refundCase.providerHold)') <
      portal.indexOf("refundCase.status === 'card_refund_pending'"),
    'an unknown provider outcome is shown before the ordinary System-finishing state',
  );
  assert.match(
    portal,
    /refundCase\.status === 'card_refund_pending' &&\s*refundCase\.decision === 'approved'\s*\)/,
    'every approved card-pending case is read-only even if readiness metadata is absent',
  );
  assert.doesNotMatch(portal, /nayaxApprovedExecutionRequestRef|nayaxApprovedExecutionAttemptedRef/);
  assert.doesNotMatch(portal, /queueMicrotask\(\(\) => nayaxApprovedExecutionRequestRef/);
  assert.doesNotMatch(nayaxEdge, /service_reserve_nayax_refund_approval_continuation_v2/);
  assert.match(nayaxEdge, /operation === "execute"[\s\S]*?status: "system_finishing"[\s\S]*?providerAttempted: false/);
  assert.match(nayaxEdge, /refund_nayax_approved_card_read_state_v1[\s\S]*?approvedReadState === "provider_hold"[\s\S]*?Check this exact transaction in Nayax/);
  assert.match(systemBoundaryMigration, /refund_nayax_approved_card_read_state_v1[\s\S]*?nayax_refund_execution_status in \('ambiguous','manual_review'\)[\s\S]*?return 'provider_hold'/);
  assert.ok(
    nayaxEdge.indexOf('if (!actorCanViewCaseStatus)') <
      nayaxEdge.indexOf('status: "system_finishing"'),
    'the browser receives System status only after read-only case authorization',
  );
  assert.ok(
    nayaxEdge.indexOf('status: "system_finishing"') <
      nayaxEdge.indexOf('if (!actorCanPerformOfficialAction)'),
    'read-only System status does not re-check live approval authority',
  );
  assert.match(systemBoundaryMigration, /can_view_refund_system_finishing_status_v1[\s\S]*?source_approval\.actor_user_id=p_user_id/);
  assert.equal(
    (portal.match(/onClick=\{\(\) => void handleRunNayaxRefund\(\)\}/g) ?? []).length,
    1,
    'only the initial manager confirmation can invoke the browser refund handler',
  );
});

test('the scheduled sweep is the only typed System executor after approval', () => {
  assert.match(automationSweep, /runNayaxSystemSavedApprovalSweep/);
  assert.match(
    automationSweep,
    /failureStage = "nayax_system_saved_approval";\s*await runNayaxSystemSavedApprovalSweep\(counters\);/,
    'the live automation handler invokes the System saved-approval sweep',
  );
  assert.match(automationSweep, /service_claim_due_nayax_system_saved_approvals_v1/);
  assert.match(automationSweep, /service_reclaim_nayax_system_saved_approval_no_call_v1/);
  assert.match(automationSweep, /p_limit: 1/);
  assert.match(automationSweep, /service_settle_nayax_system_saved_approval_v1/);
  assert.match(automationSweep, /service_get_nayax_refund_provider_journal_capability_v3/);
  assert.match(automationSweep, /machineAuthorizationTime: claim\.wire\.machineAuthorizationTime/);
  assert.match(automationSweep, /machineAuthorizationTimeInstant:\s*claim\.wire\.machineAuthorizationTimeInstant/);
  assert.match(automationSweep, /machineAuthorizationTimeWire: claim\.wire\.machineAuthorizationTimeWire/);
  assert.match(systemSavedApprovalWorker, /root\.accountKey !== undefined/);
  assert.match(systemSavedApprovalWorker, /root\.nayax_account_key !== undefined/);
  assert.match(systemSavedApprovalWorker, /wire\.machineAuthorizationTimeWire !==[\s\n]*expectedMachineAuthorizationTimeWire/);
  assert.match(systemSavedApprovalWorker, /completionErrorCode/);
  assert.match(migration, /attempt\.system_saved_approval_receipt_id is null/);
  assert.match(systemBoundaryMigration, /create function public\.refund_nayax_system_api_terminal_evidence_proved_v1/);
  assert.match(
    systemBoundaryMigration,
    /attempt\.actor_user_id is null[\s\S]*?refund_nayax_system_saved_approval_terminal_binding_valid_v1/,
    'System terminal proof uses its immutable receipt instead of inventing a human executor',
  );
  assert.match(systemSavedApprovalDbTest, /System success records one case, adjustment, terminal receipt, and refunded allocation/);
  assert.match(systemSavedApprovalDbTest, /System success is eligible for one exact customer-completion claim/);
  assert.match(
    systemBoundaryMigration,
    /refund_claim_nayax_form_receipt_completion_internal[\s\S]*?system_authority[\s\S]*?refund_nayax_system_api_terminal_evidence_proved_v1/,
    'form completion has a separate exact System proof while retaining the human predicate',
  );
  assert.match(systemSavedApprovalDbTest, /form-origin System success queues its customer notice without inventing a human executor/i);
});

test('retired authenticator entrypoints fail before Auth, database, or client mutation', () => {
  for (const source of [retiredStepUpEdge, retiredTotpEnrollmentEdge]) {
    assert.match(source, /actionTaken: false/);
    assert.match(source, /}, 410\)/);
    assert.doesNotMatch(source, /createClient|resolveSupabaseAccessToken|\.auth\.|\.rpc\(|fetch\(/);
  }
  assert.doesNotMatch(refundOperations, /refund-manager-action-step-up|refund-manager-totp-enrollment/);
  assert.doesNotMatch(refundOperations, /beginRefundManagerTotpEnrollment|cancelRefundManagerTotpEnrollment|verifyRefundManagerTotpEnrollment/);
});

test('held System outcomes use a provider-free evidence path', () => {
  assert.match(systemBoundaryMigration, /create function public\.admin_record_nayax_system_outcome_evidence_v1/);
  assert.match(systemBoundaryMigration, /systemOutcomeEvidenceAvailable/);
  assert.match(systemBoundaryMigration, /provider_call_made',false,'provider_retry_made',false/);
  assert.match(
    systemBoundaryMigration,
    /admin_resolve_refund_nayax_outcome_manager_session[\s\S]*?System-owned refund outcomes use the dedicated no-retry reconciliation path/,
  );
  assert.match(
    outcomeResolveEdge,
    /systemSavedApprovalEvidence\s*\? "admin_record_nayax_system_outcome_evidence_v1"\s*: "admin_resolve_refund_nayax_outcome_manager_session"/,
  );
  assert.match(portal, /systemSavedApprovalEvidence:\s*nayaxResolutionReadiness\.systemOutcomeEvidenceAvailable === true/);
  assert.match(
    portal,
    /selectedCase\.canPerformOfficialAction === true &&\s*nayaxResolutionReadiness\?\.systemOutcomeEvidenceAvailable === true/,
    'the assigned Manager can see the evidence form without Super-admin-only operations access',
  );
});

test('all predecessor execution lanes fail before writes, including owner races', () => {
  assert.doesNotMatch(nayaxEdge, /controlled_owner_pilot|controlled_pilot_not_ready|service_settle_nayax_controlled_pilot_attempt/);
  assert.match(
    migration,
    /create or replace function public\.admin_begin_refund_manual_nayax_portal_pre_ops_v1\([\s\S]*?manual Nayax portal refund lane is retired/,
  );
  assert.match(retiredLaneDbTest, /admin_begin_refund_manual_nayax_portal_pre_ops_v1/);
  assert.match(retiredLaneDbTest, /Service-context calls to retired functions fail before any evidence or attempt write/);
  assert.match(migration, /create or replace function public\.owner_authorize_refund_nayax_controlled_pilot\([\s\S]*?controlled Nayax pilot lane is retired/);
  assert.match(retiredPilotRaceDbTest, /dblink_send_query/);
  assert.match(retiredPilotRaceDbTest, /Concurrent retired-lane calls create no authorization, receipt, attempt, stage, or event writes/);
});

test('the first Refund click saves one approval and leaves provider work to System', () => {
  assert.match(nayaxEdge, /admin_approve_selected_nayax_refund_for_system_v1/);
  assert.match(nayaxEdge, /approved: true,[\s\S]*?status: "system_finishing"[\s\S]*?providerAttempted: false/);
  assert.doesNotMatch(nayaxEdge, /service_reserve_nayax_refund_manager_action_v5/);
  assert.doesNotMatch(nayaxEdge, /orchestrateNayaxRefund|createNayaxRefundProviderAdapter/);
  assert.match(
    systemBoundaryMigration,
    /create function public\.admin_approve_selected_nayax_refund_for_system_v1[\s\S]*?admin_authorize_refund_official_action[\s\S]*?service_apply_persisted_nayax_approval_for_system_v1/,
  );
  const persistedApproval = systemBoundaryMigration.match(
    /create function public\.service_apply_persisted_nayax_approval_for_system_v1[\s\S]*?revoke all on function public\.service_apply_persisted_nayax_approval_for_system_v1/,
  )?.[0] ?? '';
  assert.doesNotMatch(persistedApproval, /expires_at>statement_timestamp|actor_user_id=authorization_row\.actor_user_id/);
  assert.match(systemSavedApprovalDbTest, /Agent A can save the exact sale and Manager B can later approve an aged correlated case once for System work/);
  assert.match(systemBoundaryMigration, /event_row\.actor_user_id=selected_candidate\.actor_user_id/);
  assert.doesNotMatch(
    systemBoundaryMigration.match(/create function public\.refund_nayax_system_saved_approval_snapshot_v1[\s\S]*?revoke all on function public\.refund_nayax_system_saved_approval_snapshot_v1/)?.[0] ?? '',
    /selected_candidate\.actor_user_id is distinct from source_approval\.actor_user_id/,
  );
  assert.match(
    migration,
    /create or replace function public\.service_reserve_nayax_refund_manager_action_pre_context_v1\([\s\S]*?service_reserve_nayax_refund_manager_action\(/,
  );
  const baseReservation = migration.match(
    /create or replace function public\.service_reserve_nayax_refund_manager_action\([\s\S]*?revoke execute on function public\.service_reserve_nayax_refund_manager_action/
  )?.[0] ?? '';
  assert.match(baseReservation, /service_reserve_and_consume_nayax_refund_attempt\(/);
  assert.doesNotMatch(baseReservation, /service_reserve_and_consume_nayax_refund_attempt_v2/);
});

test('typed authority parsing rejects unknown roles', () => {
  assert.match(officialAction, /\["machine_manager", "super_admin"\]/);
  assert.match(officialAction, /return null/);
});
