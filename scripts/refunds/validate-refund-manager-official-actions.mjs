#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read('supabase/migrations/20260821035000_refund_manager_session_simplification.sql');
const sharedAuthorizer = read('supabase/functions/_shared/refund-official-action.ts');
const adminUpdate = read('supabase/functions/refund-case-admin-update/index.ts');
const nayaxRefund = read('supabase/functions/nayax-card-refund/index.ts');
const operations = read('src/lib/refundOperations.ts');
const portal = read('src/pages/admin/Refunds.tsx');
const databaseTests = read('supabase/tests/refund_manager_official_action_safety.sql');
const confirmationMigration = read('supabase/migrations/20260824160609_refund_confirmation_readiness.sql');
const confirmationConcurrency = read('supabase/tests/refund_confirmation_readiness_concurrency.sql');
const refundReadiness = read('supabase/functions/_shared/refund-readiness.ts');
const cashCompletionMigration = read('supabase/migrations/20260825000909_refund_manual_external_cash_completion.sql');
const refundEmail = read('supabase/functions/_shared/refund-email.ts');
const cashCompletionHelper = read('supabase/functions/_shared/manual-external-cash-completion.ts');

assert(
  migration.includes('create or replace function public.refund_official_actions_enabled()') &&
    migration.includes('select true;') &&
    migration.includes('admin_authorize_refund_official_action') &&
    migration.includes('authorization_method') &&
    migration.includes("'manager_session'") &&
    migration.includes('statement_timestamp() + interval \'90 seconds\''),
  'Normal official actions must use one short-lived manager-session authorization.'
);

assert(
  migration.includes('auth.uid()') &&
    migration.includes('can_perform_refund_official_action') &&
    migration.includes("manager.status = 'active'") &&
    migration.includes('manager.revoked_at is null') &&
    migration.includes('official_action_version is distinct from p_expected_case_version') &&
    migration.includes('assert_refund_official_action_payload_shape') &&
    migration.includes('pg_advisory_xact_lock') &&
    migration.includes('refund_official_action_context_hash'),
  'Manager-session authorization must bind the exact active mapping, case version, payload, and lock.'
);

assert(
  migration.includes("if new.authorization_method = 'manager_session'") &&
    migration.includes('Manager-session reservation evidence must be complete or absent') &&
    migration.includes("intent.authorization_method = 'manager_session'") &&
    migration.includes('intent.manager_totp_enrollment_version is null') &&
    migration.includes("new.action = 'nayax_execute'"),
  'Manager-session receipts must carry no user TOTP evidence; only the existing server reservation marker is allowed.'
);

assert(
  migration.includes('revoke execute on function public.admin_authorize_refund_official_action') &&
    migration.includes('to authenticated;') &&
    migration.includes('grant execute on function public.admin_authorize_refund_official_action'),
  'The authorizer must be granted only through the authenticated application boundary.'
);

assert(
  sharedAuthorizer.includes('admin_authorize_refund_official_action') &&
    sharedAuthorizer.includes('managerSessionArguments') &&
    sharedAuthorizer.includes('return {') &&
    sharedAuthorizer.includes('authorizationId: authorization.authorizationId') &&
    sharedAuthorizer.indexOf('admin_authorize_refund_official_action') <
      sharedAuthorizer.indexOf('admin_consume_refund_action_step_up_intent'),
  'The normal Edge path must authorize directly before the retained legacy TOTP fallback.'
);

assert(
  adminUpdate.includes('authorizeRefundOfficialAction') &&
    adminUpdate.includes('service_apply_refund_official_case_update') &&
    adminUpdate.includes('service_complete_cash_refund_official') &&
    nayaxRefund.includes('service_reserve_nayax_refund_manager_action') &&
    nayaxRefund.includes('expectedOfficialActionVersion'),
  'Case updates and Nayax execution must continue consuming exact server-side authorization and reservation controls.'
);

assert(
  cashCompletionMigration.includes("'completion_method', 'manual_external'") &&
    cashCompletionMigration.includes('server_refund_amount_cents := before_row.payment_amount_cents') &&
    cashCompletionMigration.includes('confirmation_time timestamptz := statement_timestamp()') &&
    cashCompletionMigration.includes("before_row.status in ('denied', 'closed')") &&
    cashCompletionMigration.includes("before_row.status not in (") &&
    cashCompletionMigration.includes("'submitted'") &&
    cashCompletionMigration.includes("'needs_review'") &&
    cashCompletionMigration.includes("'cash_zelle_pending'") &&
    cashCompletionMigration.includes("refund_case_row.payment_method = 'cash'") &&
    cashCompletionMigration.includes('not is_manual_external_cash'),
  'Manual external cash completion must derive trusted fields, accept active legacy states, and preserve the card correlation guard.'
);

assert(
  adminUpdate.includes('serverCashRefundAmountCents') &&
    adminUpdate.includes('deriveManualExternalCashCompletionContext') &&
    adminUpdate.includes('paymentAmountCents: beforeRow.payment_amount_cents') &&
    adminUpdate.includes('p_manual_refund_reference: null') &&
    adminUpdate.includes('p_cash_payout_sent_at: null') &&
    !adminUpdate.includes('timestampFromInput') &&
    cashCompletionHelper.includes('refundAmountCents: amount') &&
    cashCompletionHelper.includes('manualRefundReference: null') &&
    cashCompletionHelper.includes('cashPayoutSentAt: null') &&
    portal.includes('Mark ${formatCurrency(refundCase.paymentAmountCents)} as refunded') &&
    portal.includes('Confirm that you already refunded this customer outside Bloomjoy Hub.') &&
    portal.includes('Mark refunded') &&
    !portal.includes('data-testid="refund-cash-reference-input"') &&
    !portal.includes('data-testid="refund-cash-payout-time-input"') &&
    !portal.includes('data-testid="refund-cash-payment-confirmed"') &&
    refundEmail.includes('using the payment method arranged with you'),
  'The Edge and manager surfaces must expose one channel-neutral action with server-derived completion details.'
);

assert(
  operations.includes('expectedOfficialActionVersion: number') &&
    portal.includes('selectedCase?.canPerformOfficialAction !== true') &&
    portal.includes('officialActionVersion <= 0') &&
    !portal.includes('refund-owner-totp-readiness') &&
    !portal.includes('Set up your refund authenticator'),
  'The manager UI must retain mapping/version fail-closed behavior without exposing authenticator setup.'
);

assert(
  databaseTests.includes('A mapped Super Admin receives official-action authority only from the exact Machine Manager mapping') &&
    databaseTests.includes('A mapped Scoped Admin receives official-action authority only from the exact Machine Manager mapping') &&
    databaseTests.includes('An official-action receipt cannot be replayed') &&
    databaseTests.includes('A revoked manager cannot mint a new receipt') &&
    databaseTests.includes('Two receipts minted for one case cannot both commit an official action') &&
    databaseTests.includes('A service identity cannot impersonate a manager to approve through the legacy wrapper'),
  'Existing database regression coverage must retain persona, replay, revocation, race, and impersonation checks.'
);

assert(
  confirmationMigration.includes("'selectionApplied', false") &&
    confirmationMigration.includes("'transactionConfirmed', true") &&
    confirmationMigration.includes('for update') &&
    confirmationMigration.includes('refund_case_nayax_manager_readiness') &&
    databaseTests.includes('An exact replay succeeds despite the old review version and creates no second event') &&
    confirmationConcurrency.includes('Two simultaneous exact confirmations return one write and one successful replay'),
  'Transaction confirmation must be row-locked, replay-safe, and return authoritative readiness.'
);

assert(
  adminUpdate.includes('selectionApplied: updateApplied') &&
    adminUpdate.includes('transactionConfirmed: refundReadiness?.transactionConfirmed === true') &&
    adminUpdate.includes('refundReadiness,') &&
    refundReadiness.includes('globally_paused') &&
    refundReadiness.includes('provider_unavailable') &&
    refundReadiness.includes('machine_not_enabled'),
  'The Edge response must return one bounded confirmation and runtime-readiness contract.'
);

console.log('PASS: normal refund decisions use the exact mapped-manager session');
console.log('PASS: payload, version, replay, row-lock, and provider safety controls remain server-side');
console.log('PASS: the manager surface no longer exposes TOTP setup or per-action codes');
console.log('PASS: transaction confirmation is replay-safe and returns bounded refund readiness');
console.log('PASS: cash completion is one action, channel-neutral, and server-derived');
