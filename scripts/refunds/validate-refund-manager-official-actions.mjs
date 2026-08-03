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
const authorizationHelper = read(
  'supabase/functions/_shared/refund-official-action.ts'
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
  migration.includes('create or replace function public.refund_official_actions_enabled()') &&
    migration.includes('-- #692 replaces this protocol stub only') &&
    migration.includes('select false;') &&
    migration.indexOf('Official refund actions are disabled until manager step-up verification is deployed') <
      migration.indexOf('A fresh authenticator verification is required for this official action') &&
    migration.includes("auth.jwt() ->> 'aal' = 'aal2'") &&
    migration.includes("method ->> 'method' = 'totp'") &&
    migration.includes("statement_timestamp() - interval '2 minutes'") &&
    databaseTests.includes('AAL1 cannot authorize an official action') &&
    databaseTests.includes('AAL2 without a TOTP AMR entry') &&
    databaseTests.includes('A stale TOTP AMR entry'),
  'Official actions must stay hard-disabled until #692 and then require AAL2 with a fresh TOTP AMR entry.'
);

assert(
  migration.includes('actor_user_id uuid := auth.uid()') &&
    migration.includes("auth.role() is distinct from 'authenticated'") &&
    migration.includes(
      'create or replace function public.admin_authorize_refund_official_action(\n  p_case_id uuid,\n  p_action text,\n  p_expected_case_version bigint'
    ),
  'The browser authorizer must derive the actor from auth.uid() instead of accepting an actor identifier.'
);

assert(
  migration.includes('from public.admin_roles admin_role') &&
    migration.includes('admin_role.active = true') &&
    migration.includes('from public.admin_scoped_access_grants admin_grant') &&
    migration.includes('public.admin_scoped_grant_is_active(') &&
    databaseTests.includes('Dual-entitlement Super Admin exclusion test') &&
    databaseTests.includes('Dual-entitlement Scoped Admin exclusion test'),
  'Mapped Super Admin and Scoped Admin identities must remain review-only during the pilot.'
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
    databaseTests.includes('cannot mark provider success or completion'),
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
    authorizationHelper.includes('"admin_authorize_refund_official_action"') &&
    authorizationHelper.includes('p_expected_case_version: context.expectedCaseVersion'),
  'Edge Functions must mint receipts through the caller\'s browser bearer token and exact reviewed case revision.'
);

assert(
  adminUpdate.includes('authorizeRefundOfficialAction') &&
    adminUpdate.includes('service_apply_refund_official_case_update') &&
    adminUpdate.includes('service_complete_cash_refund_official') &&
    adminUpdate.includes('expectedOfficialActionVersion') &&
    nayaxExecution.includes('authorizeRefundOfficialAction') &&
    nayaxExecution.includes('service_consume_nayax_refund_official_action') &&
    nayaxExecution.includes('expectedOfficialActionVersion'),
  'All portal official-action paths must authorize and consume the exact browser-reviewed action.'
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
    portal.includes('Official refund actions remain disabled until the per-action manager authenticator flow is deployed.') &&
    portal.includes("? 'refund-manager-verification-banner'") &&
    portal.includes(": 'refund-review-only-banner'") &&
    portal.includes('Only a currently mapped Machine Manager can approve, decline, complete, or issue this'),
  'The portal must fail closed with explicit disabled, step-up-required, and mapping-required review-only states.'
);

assert(
  portal.includes("new URLSearchParams(window.location.search).get('case')") &&
    portal.includes('handleSelectCase(caseFromUrl)') &&
    !portal.includes('shouldAutoRunNayaxLookup') &&
    !portal.includes('autoLookupAttemptedRef'),
  'Refund case deep links must select the case only and never auto-run a Nayax lookup.'
);

assert(
  databaseTests.includes('A mapped Super Admin remains review-capable but cannot perform a Machine Manager action') &&
    databaseTests.includes('A mapped Scoped Admin remains review-capable but cannot perform a Machine Manager action') &&
    databaseTests.includes('An official-action receipt cannot be replayed') &&
    databaseTests.includes('Customer identity and local incident context changes invalidate a minted receipt') &&
    databaseTests.includes('A revoked manager cannot mint a new receipt') &&
    databaseTests.includes('An admin entitlement activated after receipt mint invalidates execution') &&
    databaseTests.includes('Two receipts minted for one case cannot both commit') &&
    databaseTests.includes('A service identity cannot impersonate a manager'),
  'Regression coverage must include personas, replay, stale cases, authority drift, double action, and service impersonation.'
);

assert(
  portalUat.includes("name: 'mapped Super Admin'") &&
    portalUat.includes("name: 'mapped Scoped Admin'") &&
    portalUat.includes('A case with a missing review version cannot inherit the previous case version') &&
    portalUat.includes('Refund case deep link selects the case without automatically querying Nayax'),
  'Portal UAT must cover dual-entitlement review-only personas, version reset, and navigation-only deep links.'
);

console.log('Refund Machine Manager official-action boundary validated.');
