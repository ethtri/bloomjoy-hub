#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const assert = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
};

const migration = read(
  'supabase/migrations/202608030002_refund_manager_official_action_boundary.sql'
);
const providerOrchestrationMigration = read(
  'supabase/migrations/202608040004_refund_nayax_provider_orchestration.sql'
);
const providerHoldDecisionFreezeMigration = read(
  'supabase/migrations/20260812134500_refund_provider_hold_decision_freeze.sql'
);
const stepUpMigration = read(
  'supabase/migrations/202608030004_refund_manager_action_step_up.sql'
);
const dualRoleManagerAuthorityMigration = read(
  'supabase/migrations/20260812190000_refund_dual_role_manager_authority.sql'
);
const ownerTotpWindowMigration = read(
  'supabase/migrations/20260812200000_refund_owner_totp_enrollment_window.sql'
);
const authorizationHelper = read(
  'supabase/functions/_shared/refund-official-action.ts'
);
const totpHelper = read(
  'supabase/functions/_shared/refund-manager-totp.ts'
);
const stepUpEdge = read(
  'supabase/functions/refund-manager-action-step-up/index.ts'
);
const enrollmentEdge = read(
  'supabase/functions/refund-manager-totp-enrollment/index.ts'
);
const supabaseConfig = read('supabase/config.toml');
const authPreflight = read('scripts/auth-preflight.mjs');
const ownerTotpAuthReadiness = read(
  'scripts/refunds/refund-owner-totp-auth-readiness.mjs'
);
const authControlPlane = read(
  'scripts/refunds/refund-auth-control-plane.mjs'
);
const productionAuthClosedGate = read(
  'scripts/refunds/refund-production-auth-closed.mjs'
);
const adminUpdate = read(
  'supabase/functions/refund-case-admin-update/index.ts'
);
const nayaxExecution = read(
  'supabase/functions/nayax-card-refund/index.ts'
);
const operationsLibrary = read('src/lib/refundOperations.ts');
const portal = read('src/pages/admin/Refunds.tsx');
const portalUat = read('scripts/refunds/validate-refund-portal-uat.mjs');
const databaseTests = read(
  'supabase/tests/refund_manager_official_action_safety.sql'
);
const stepUpDatabaseTests = read(
  'supabase/tests/refund_manager_action_step_up_safety.sql'
);
const stepUpConcurrencyTests = read(
  'supabase/tests/refund_manager_action_step_up_concurrency.sql'
);
const ownerTotpWindowTests = read(
  'supabase/tests/refund_manager_owner_totp_window_safety.sql'
);
const totpTests = read(
  'supabase/functions/_shared/refund-manager-totp.test.ts'
);
const ownerBindingMatch = ownerTotpWindowMigration.match(
  /set totp_enrollment_owner_user_id_digest\s*=\s*'([a-f0-9]{64})'/
);

assert(
  migration.includes('refund_case_official_action_authorizations') &&
    migration.includes('actor_user_id uuid not null') &&
    migration.includes('manager_mapping_version bigint not null') &&
    migration.includes('expected_case_version bigint not null') &&
    migration.includes("status text not null default 'authorized'") &&
    migration.includes('expires_at timestamptz not null') &&
    migration.includes('consumed_at timestamptz'),
  'Official actions must use short-lived, single-use receipts tied to actor, mapping revision, and case revision.'
);

assert(
  migration.includes("action_context_hash ~ '^[a-f0-9]{64}$'") &&
    migration.includes("extensions.digest(") &&
    migration.includes('jsonb_build_array(') &&
    migration.includes("'sha256'") &&
    !migration.includes('md5(') &&
    databaseTests.includes('Changing any authorized action field invalidates the SHA-256-bound receipt'),
  'Payment-authority receipt contexts must use a 64-hex SHA-256 digest and reject any payload change.'
);

assert(
  stepUpMigration.includes('create or replace function public.refund_official_actions_enabled()') &&
    stepUpMigration.includes('select false;') &&
    stepUpMigration.includes('totp_enrollment_enabled boolean not null default false') &&
    supabaseConfig.includes('[auth.mfa.totp]') &&
    supabaseConfig.includes('enroll_enabled = false') &&
    authPreflight.includes("['enroll_enabled = false', 'owner-controlled, closed-by-default TOTP enrollment']") &&
    stepUpMigration.includes("auth.jwt() ->> 'aal' <> 'aal2'") &&
    stepUpMigration.includes("method ->> 'method' = 'totp'") &&
    stepUpMigration.includes("summary.newest_epoch <= extract(epoch from date_trunc('second', p_not_before))") &&
    stepUpDatabaseTests.includes('AAL1 cannot consume even with a TOTP-shaped AMR') &&
    stepUpDatabaseTests.includes('AAL2 without TOTP cannot consume') &&
    stepUpDatabaseTests.includes('A stale login-time TOTP cannot consume'),
  'Official actions and enrollment must default closed, then require AAL2 with a TOTP proof strictly newer than the exact action intent.'
);

assert(
  stepUpMigration.includes('authenticated_actor_user_id uuid := auth.uid()') &&
    stepUpMigration.includes("auth.role() is distinct from 'authenticated'") &&
    stepUpMigration.includes('admin_prepare_refund_action_step_up_intent') &&
    stepUpMigration.includes('admin_consume_refund_action_step_up_intent'),
  'The step-up boundary must derive the actor from auth.uid() instead of accepting an actor identifier.'
);

assert(
  dualRoleManagerAuthorityMigration.includes('create or replace function public.user_is_active_refund_manager(') &&
    dualRoleManagerAuthorityMigration.includes('create or replace function public.user_is_active_refund_manager_only(') &&
    dualRoleManagerAuthorityMigration.includes('create or replace function public.can_perform_refund_official_action(') &&
    dualRoleManagerAuthorityMigration.includes("manager.status = 'active'") &&
    dualRoleManagerAuthorityMigration.includes('manager.revoked_at is null') &&
    !dualRoleManagerAuthorityMigration.includes('from public.admin_roles') &&
    !dualRoleManagerAuthorityMigration.includes('from public.admin_scoped_access_grants') &&
    databaseTests.includes('Dual-role Super Admin manager authority test') &&
    databaseTests.includes('Dual-role Scoped Admin manager authority test') &&
    stepUpDatabaseTests.includes('A mapped Super Admin can prepare the same owner-approved action-bound intent') &&
    stepUpDatabaseTests.includes('Admin access alone cannot prepare an intent without a current Machine Manager mapping'),
  'A current exact-machine mapping must be the only source of payment authority; separate admin access neither grants nor revokes it.'
);

assert(
  ownerTotpWindowMigration.includes(
    'create or replace function public.open_refund_manager_totp_enrollment_window_current_user()'
  ) &&
    ownerTotpWindowMigration.includes('current_actor_user_id uuid := auth.uid()') &&
    ownerTotpWindowMigration.includes("owner_role.role = 'super_admin'") &&
    ownerTotpWindowMigration.includes('public.user_is_active_refund_manager(p_user_id)') &&
    ownerTotpWindowMigration.includes("opened_at + interval '5 minutes'") &&
    ownerTotpWindowMigration.includes("hashtextextended('refund-totp-enrollment-owner-window', 782)") &&
    ownerTotpWindowMigration.includes("'status', 'already_open'") &&
    ownerTotpWindowMigration.includes("'status', 'already_enrolled'") &&
    ownerTotpWindowMigration.includes('totp_enrollment_owner_user_id_digest') &&
    ownerTotpWindowMigration.includes("convert_to(owner_user.id::text, 'UTF8')") &&
    !ownerTotpWindowMigration.includes('lower(trim(owner_user.email))') &&
    !ownerTotpWindowMigration.includes('@') &&
    !ownerTotpWindowMigration.includes('grant execute on function public.open_refund_manager_totp_enrollment_window_current_user()\n  to service_role'),
  'The owner enrollment opener must be self-only, exact-bound, non-extendable, five-minute, mapping-backed, and unavailable to service identities.'
);

assert(
  supabaseConfig.includes('[auth.mfa.totp]') &&
    supabaseConfig.includes('enroll_enabled = false') &&
    supabaseConfig.includes('verify_enabled = true') &&
    authPreflight.includes("['enroll_enabled = false', 'owner-controlled, closed-by-default TOTP enrollment']") &&
    authPreflight.includes("['verify_enabled = true', 'TOTP verification']") &&
    authControlPlane.includes('/config/auth') &&
    authControlPlane.includes("method: 'GET'") &&
    authControlPlane.includes('mfa_totp_enroll_enabled') &&
    authControlPlane.includes('mfa_totp_verify_enabled') &&
    authControlPlane.includes('SUPABASE_AUTH_CONFIG_READ_TOKEN') &&
    ownerTotpAuthReadiness.includes('requireExactRefundProductionProject') &&
    productionAuthClosedGate.includes('requireHostedRefundTotpState(state, false)') &&
    !authControlPlane.includes("method: 'PATCH'") &&
    !authControlPlane.includes("method: 'POST'") &&
    !productionAuthClosedGate.includes("method: 'PATCH'") &&
    !productionAuthClosedGate.includes("method: 'POST'"),
  'Auth must remain enrollment-off/verification-on in source, with a read-only real control-plane readiness and restore check.'
);

assert(
  ownerBindingMatch?.[1]?.length === 64 &&
    !ownerTotpWindowMigration.includes('email_digest') &&
    !ownerTotpWindowMigration.includes('identity_digest') &&
    !/convert_to\([^\n]*email/i.test(ownerTotpWindowMigration) &&
    !/digest\([^)]*email/i.test(ownerTotpWindowMigration),
  'The preapproved owner binding must be one private high-entropy Auth UUID digest, never an email literal or email hash.'
);

assert(
  ownerTotpWindowMigration.includes(
    'create or replace function public.can_enroll_refund_manager_totp_current_user()'
  ) &&
    ownerTotpWindowMigration.includes(
      'create or replace function public.service_record_refund_manager_totp_enrollment('
    ) &&
    ownerTotpWindowMigration.includes(
      'coalesce(public.refund_totp_enrollment_owner_is_user(current_actor_user_id), false)'
    ) &&
    ownerTotpWindowMigration.includes(
      'or public.refund_totp_enrollment_owner_is_user(p_actor_user_id) is distinct from true'
    ) &&
    ownerTotpWindowTests.includes('Revoking Super Admin after open blocks enrollment precheck') &&
    ownerTotpWindowTests.includes('Changing the immutable owner binding after open blocks durable enrollment consumption'),
  'Exact owner role, mapping, confirmed identity, and immutable binding must be revalidated under lock before Auth start and durable consumption.'
);

assert(
  ownerTotpWindowMigration.includes("'totp_enrollment_window_opened'") &&
    ownerTotpWindowMigration.includes("'totp_enrollment_window_expired'") &&
    ownerTotpWindowMigration.includes("'totp_enrollment_window_cancelled'") &&
    ownerTotpWindowMigration.includes('totp_enrollment_enabled = false') &&
    ownerTotpWindowTests.includes('different mapped Super Admin cannot open') &&
    ownerTotpWindowTests.includes('cannot open enrollment without an active manager mapping') &&
    ownerTotpWindowTests.includes('does not extend the window') &&
    ownerTotpWindowTests.includes('closes logically when its timestamp expires') &&
    ownerTotpWindowTests.includes('create no official receipt, provider attempt, customer message') &&
    stepUpConcurrencyTests.includes('Two concurrent owner opens serialize into one open') &&
    portalUat.includes('--owner-totp-only') &&
    portalUat.includes('Setup failure remains isolated from official, provider, and customer side effects') &&
    portal.includes('Setup alone cannot issue a refund.') &&
    portal.includes('Do not share the screen, QR code, or six-digit code with an agent'),
  'Owner enrollment must close on expiry/success/cancel, audit safely, serialize concurrency, and prove zero payment or communication side effects.'
);

assert(
  migration.includes("authorization_row.status <> 'authorized'") &&
    migration.includes('authorization_row.expires_at <= statement_timestamp()') &&
    migration.includes('refund_case.official_action_version is distinct from authorization_row.expected_case_version') &&
    migration.includes('manager.mapping_version = authorization_row.manager_mapping_version') &&
    migration.includes("status = 'consumed'") &&
    migration.includes('consumed_at = statement_timestamp()'),
  'Receipt consumption must reject replay, expiry, case drift, and Machine Manager mapping drift.'
);

assert(
  migration.includes('service_apply_refund_official_case_update') &&
    migration.includes('service_complete_cash_refund_official') &&
    migration.includes('service_consume_nayax_refund_official_action') &&
    migration.includes('Official refund actions require a browser-authenticated Machine Manager authorization') &&
    migration.includes('revoke execute on function public.service_complete_cash_refund_as_actor') &&
    migration.includes('from public, anon, authenticated, service_role'),
  'Service workflows must consume browser receipts and legacy actor wrappers must remain triage-only.'
);

assert(
  migration.includes('enforce_refund_case_official_transition_boundary') &&
    migration.includes("current_user in ('anon', 'authenticated', 'service_role')") &&
    migration.includes('Official refund state cannot be inserted by a browser or service identity') &&
    migration.includes('Official refund transitions require a browser-authenticated Machine Manager receipt') &&
    migration.includes('enforce_refund_official_event_boundary') &&
    migration.includes("'nayax_match_selected'") &&
    migration.includes('drop function if exists public.service_finalize_nayax_refund_official_action') &&
    !migration.includes('create or replace function public.service_finalize_nayax_refund_official_action') &&
    !migration.includes('grant execute on function public.service_finalize_nayax_refund_official_action') &&
    migration.includes('Nayax execution uses the persisted approved match and does not accept a candidate token') &&
    databaseTests.includes('A raw service-role table update cannot proxy an official refund transition') &&
    databaseTests.includes('A raw service identity cannot insert a pre-approved refund case') &&
    databaseTests.includes('Approved match and correlation evidence cannot be swapped') &&
    databaseTests.includes('cannot spoof manager evidence or a provider-success event') &&
    databaseTests.includes('Denied legacy consumption leaves manager authority and card case untouched'),
  'Raw service writes must not create official state, rewrite frozen evidence, spoof audit events, or finalize provider success.'
);

assert(
  migration.includes('refund_nayax_lookup_candidate_immutable') &&
    migration.includes('refund_nayax_candidate_evidence_hash') &&
    migration.includes('p_candidate_evidence_hash') &&
    databaseTests.includes('cannot rewrite reviewed Nayax candidate evidence in place') &&
    databaseTests.includes('Delete-and-reinsert candidate evidence is detected'),
  'Nayax candidate evidence must be immutable in place and cryptographically bound across delete/reinsert replacement.'
);

assert(
  migration.includes('refund_case_official_payment_locked') &&
    migration.includes('create or replace function public.service_cancel_refund_wallet_correction') &&
    migration.includes('create or replace function public.service_get_refund_wallet_correction') &&
    databaseTests.includes('Stale wallet SECURITY DEFINER paths cannot issue, apply, cancel, reveal, or mutate') &&
    databaseTests.includes('legacy SECURITY DEFINER wrapper cannot reopen a closed official case'),
  'Every SECURITY DEFINER wallet and legacy service path must refuse to reopen an official or payment-terminal case.'
);

assert(
  migration.includes('public.can_perform_refund_official_action(p_user_id, refund_case.id)') &&
    migration.includes('public.can_prepare_nayax_refund_execution') &&
    migration.includes('service_consume_nayax_refund_official_action'),
  'The database must revalidate the active machine mapping at official mutation and Nayax preparation boundaries.'
);

assert(
  authorizationHelper.includes("createClient(supabaseUrl, supabaseAnonKey") &&
    authorizationHelper.includes('global: { headers: { Authorization: `Bearer ${accessToken}` } }') &&
    authorizationHelper.includes('"admin_prepare_refund_action_step_up_intent"') &&
    authorizationHelper.includes('"admin_consume_refund_action_step_up_intent"') &&
    authorizationHelper.includes('p_factor_verification_proof: context.stepUpFactorProof') &&
    !authorizationHelper.includes('"admin_authorize_refund_official_action"') &&
    authorizationHelper.includes('p_expected_case_version: context.expectedCaseVersion'),
  'Edge Functions must create and consume action-bound intents through the caller-derived bearer token and exact reviewed case revision.'
);

assert(
    adminUpdate.includes('authorizeRefundOfficialAction') &&
    adminUpdate.includes('providerHoldStatuses.has(beforeRow.nayax_refund_execution_status)') &&
    adminUpdate.includes('"declined",') &&
    adminUpdate.includes('provider_refund_rejected') &&
    adminUpdate.includes('provider_outcome_unconfirmed') &&
    adminUpdate.includes('service_apply_refund_official_case_update') &&
    adminUpdate.includes('service_complete_cash_refund_official') &&
    adminUpdate.includes('expectedOfficialActionVersion') &&
    nayaxExecution.includes('disabledNayaxProviderAdapter') &&
    nayaxExecution.includes('authorizeRefundOfficialAction') &&
    nayaxExecution.includes('service_reserve_and_consume_nayax_refund_attempt_v2') &&
    providerOrchestrationMigration.includes(
      'create or replace function public.service_reserve_and_consume_nayax_refund_attempt'
    ) &&
    providerOrchestrationMigration.includes(
      'authorization_context := public.service_consume_nayax_refund_official_action('
    ) &&
    providerOrchestrationMigration.includes('p_authorization_id uuid') &&
    providerOrchestrationMigration.includes("authorization_row.action is distinct from 'nayax_execute'"),
  'All portal official-action paths must authorize and consume the exact browser-reviewed action.'
);

assert(
  stepUpMigration.includes('refund_manager_action_step_up_one_live_actor_idx') &&
    stepUpMigration.includes('refund_manager_action_step_up_one_use_totp_idx') &&
    stepUpMigration.includes("statement_timestamp() + interval '2 minutes'") &&
    stepUpMigration.includes("statement_timestamp() + interval '30 seconds'") &&
    stepUpMigration.includes('This authenticator verification already authorized a different official action') &&
    stepUpMigration.includes('Action-bound manager step-up intent required for every official refund action') &&
    stepUpDatabaseTests.includes('One TOTP verification cannot consume a second intent even with positive clock skew') &&
    stepUpDatabaseTests.includes('Consumed intent cannot be replayed') &&
    stepUpDatabaseTests.includes('Changing the exact amount invalidates the intent') &&
    stepUpDatabaseTests.includes('Manager mapping revision drift invalidates the intent'),
  'Action-bound step-up must be short-lived, one-use per actor and TOTP proof, replay-safe, and invalidated by payload or authority drift.'
);

assert(
  stepUpMigration.includes('refund_manager_totp_enrollments') &&
    stepUpMigration.includes('approved_factor_binding_hash') &&
    stepUpMigration.includes('manager_totp_enrollment_version') &&
    stepUpMigration.includes('totp_enrollment_approved_manager_user_id') &&
    stepUpMigration.includes('service_record_refund_manager_totp_enrollment') &&
    stepUpMigration.includes('admin_refund_manager_step_up_factor_is_approved') &&
    stepUpMigration.includes('service_mark_refund_manager_step_up_factor_verified') &&
    stepUpMigration.includes('factor_verification_proof_hash') &&
    stepUpMigration.includes("'bloomjoy-refund-manager-step-up-proof-v1:'") &&
    stepUpDatabaseTests.includes('generic pre-existing Auth TOTP cannot prepare') &&
    stepUpDatabaseTests.includes('fresh generic-factor AAL2 token cannot bypass') &&
    stepUpDatabaseTests.includes('caller cannot guess or substitute') &&
    stepUpDatabaseTests.includes('Enrollment revocation or replacement invalidates'),
  'Only a durable, owner-targeted, exact-factor enrollment and trusted one-use Edge proof may consume refund step-up intents.'
);

assert(
  stepUpMigration.includes('refund_nayax_execution_evidence_hash') &&
    stepUpMigration.includes("'refund_nayax_execution_evidence_v1'") &&
    stepUpMigration.includes('nayax_execution_evidence_hash') &&
    stepUpMigration.includes('for share;') &&
    stepUpMigration.includes('Nayax execution evidence changed after manager verification') &&
    stepUpDatabaseTests.includes('Valid-to-valid Nayax account configuration drift') &&
    stepUpDatabaseTests.includes('Service consumption revalidates locked Nayax evidence'),
  'Nayax verification must bind and revalidate locked persisted match, amount, and provider configuration evidence.'
);

assert(
  stepUpConcurrencyTests.includes("dblink_send_query(") &&
    stepUpConcurrencyTests.includes('Two independent database sessions') &&
    stepUpConcurrencyTests.includes('Exactly one of two concurrent sessions can consume') &&
    stepUpConcurrencyTests.includes('Concurrent regression restores the production hard-off gate'),
  'Database regression coverage must exercise real two-session prepare and consume races.'
);

assert(
  stepUpEdge.includes('verifyRefundManagerTotp') &&
    stepUpEdge.includes('admin_refund_manager_step_up_factor_is_approved') &&
    stepUpEdge.includes('service_mark_refund_manager_step_up_factor_verified') &&
    stepUpEdge.includes('x-supabase-auth-token') &&
    stepUpEdge.includes('stepUpIntentId: intentId') &&
    stepUpEdge.includes('stepUpFactorProof') &&
    totpHelper.includes('body: { challenge_id: challengeId, code }') &&
    totpHelper.includes('cancelRefundManagerTotpEnrollment') &&
    enrollmentEdge.includes('operation === "cancel"') &&
    enrollmentEdge.includes('can_enroll_refund_manager_totp_current_user') &&
    enrollmentEdge.includes('service_record_refund_manager_totp_enrollment') &&
    enrollmentEdge.includes('bestEffortCompensateRefundManagerTotpEnrollment') &&
    enrollmentEdge.includes('service_compensate_refund_manager_totp_enrollment') &&
    !stepUpEdge.includes('console.log') &&
    !enrollmentEdge.includes('console.log') &&
    totpTests.includes('malformed codes fail before any Auth request') &&
    totpTests.includes("cancelling enrollment removes only the caller's unfinished TOTP factor") &&
    totpTests.includes('enrollment verification rejects a second TOTP') &&
    totpTests.includes('compensation still removes Auth factor when durable rollback fails'),
  'The trusted Edge flow must bind the exact approved factor, compensate failed durable enrollment, keep secrets server-side, and avoid sensitive success logging.'
);

assert(
  operationsLibrary.includes('canPerformOfficialAction?: boolean') &&
    operationsLibrary.includes("| 'official_actions_disabled'") &&
    operationsLibrary.includes('officialActionVersion?: number') &&
    operationsLibrary.includes('expectedOfficialActionVersion: number') &&
    portal.includes('selectedCase?.canPerformOfficialAction !== true') &&
    portal.includes('setOfficialActionVersion(nextVersion > 0 ? nextVersion : 0)') &&
    portal.includes('selectedCaseIsReviewOnly || officialActionVersion <= 0') &&
    portal.includes("selectedCaseOfficialActionBlockReason === 'official_actions_disabled'") &&
    portal.includes('Refund actions are temporarily unavailable.') &&
    portal.includes('data-testid="refund-manager-step-up-dialog"') &&
    portal.includes('Manager confirmation required') &&
    portal.includes('Do not share the code') &&
    portal.includes('You can take this action because you are assigned to manage this machine') &&
    portal.includes('Do not screenshot, copy, email, or share it') &&
    portal.includes('ask the account owner to help recover access before issuing refunds') &&
    portal.includes("? 'refund-manager-verification-banner'") &&
    portal.includes(": 'refund-review-only-banner'") &&
    portal.includes('only the assigned Machine Manager can decide or issue the refund'),
  'The portal must fail closed with explicit disabled, step-up-required, and mapping-required review-only states.'
);

assert(
  portal.includes('refund-customer-decision-freeze') &&
    portal.includes("label: 'Refund status not confirmed'") &&
    providerHoldDecisionFreezeMigration.includes('guard_refund_provider_hold_case_update') &&
    providerHoldDecisionFreezeMigration.includes('guard_refund_provider_hold_customer_message') &&
    providerHoldDecisionFreezeMigration.includes("in ('unconfirmed', 'rejected')") &&
    providerHoldDecisionFreezeMigration.includes('future audited payment-support migration') &&
    providerHoldDecisionFreezeMigration.includes("old.nayax_refund_execution_status, ''))) <> 'requested'") &&
    portalUat.includes('freezes customer decisions while the payment outcome is unconfirmed') &&
    portalUat.includes('remains frozen after a full reload') &&
    portalUat.includes('Synthetic browser rejected remains frozen after a full reload'),
  'An unconfirmed provider outcome must freeze every manager decision and customer outcome message, including after refresh.'
);

assert(
  portal.includes("refundCase.officialActionBlockReason === 'manager_verification_required'") &&
    portalUat.includes('Fresh manager step-up names the exact action') &&
    portalUat.includes('Personally authorize this exact action'),
  'A mapped manager awaiting fresh personal verification must retain only the action-bound authenticator entry point.'
);

assert(
  portal.includes('while payment support resolves the rejection') &&
    portalUat.includes('Synthetic browser rejected remains frozen after a full reload'),
  'A rejected provider outcome must remain frozen after refresh and direct the manager to payment support without implying that the outcome is unknown.'
);

assert(
  portal.includes("new URLSearchParams(window.location.search).get('case')") &&
    portal.includes('handleSelectCase(caseFromUrl)') &&
    !portal.includes('shouldAutoRunNayaxLookup') &&
    !portal.includes('autoLookupAttemptedRef'),
  'Refund case deep links must select the case only and never auto-run a Nayax lookup.'
);

assert(
  databaseTests.includes('A mapped Super Admin receives official-action authority only from the exact Machine Manager mapping') &&
    databaseTests.includes('A mapped Scoped Admin receives official-action authority only from the exact Machine Manager mapping') &&
    databaseTests.includes('Admin access can review but cannot perform an official action without an exact Machine Manager mapping') &&
    databaseTests.includes('An official-action receipt cannot be replayed') &&
    databaseTests.includes('Customer identity and local incident context changes invalidate a minted receipt') &&
    databaseTests.includes('A revoked manager cannot mint a new receipt') &&
    databaseTests.includes('A later admin entitlement does not invalidate a receipt whose exact Machine Manager mapping remains current') &&
    databaseTests.includes('Two receipts minted for one case cannot both commit') &&
    databaseTests.includes('A service identity cannot impersonate a manager'),
  'Regression coverage must include personas, replay, stale cases, authority drift, double action, and service impersonation.'
);

assert(
  portalUat.includes("name: 'mapped Super Admin'") &&
    portalUat.includes("name: 'mapped Scoped Admin'") &&
    portalUat.includes('reaches the exact mapped-manager verification instead of a review-only dead end') &&
    portalUat.includes('performs no payment action before personal verification') &&
    portalUat.includes('A case with a missing review version cannot inherit the previous case version') &&
    portalUat.includes('Deep link, status filter, and queue-row selection make no lookup or official-action call') &&
    portalUat.includes('Cancelling step-up invalidates the pending intent and takes no official action') &&
    portalUat.includes('A bad authenticator code leaves the reviewed action pending') &&
    portalUat.includes('Expired step-up fails before authenticator verification or target execution') &&
    portalUat.includes('Successful verification submits only the frozen reviewed target, case, and version') &&
    portalUat.includes('Cancelling supervised enrollment asks the trusted Edge flow to remove the unfinished factor'),
  'Portal UAT must cover dual-role mapped managers, version reset, navigation-only deep links, fresh step-up, cancellation, expiry, bad codes, frozen payloads, and enrollment cleanup.'
);

console.log('Refund Machine Manager official-action boundary validated.');
