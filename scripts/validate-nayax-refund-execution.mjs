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
    managerAuthorizationMigration.includes('public.can_manage_refund_case(p_user_id, refund_case.id)') &&
    !managerAuthorizationMigration.includes('public.is_super_admin(p_user_id)'),
  'Execution readiness must allow authorized refund case managers while preserving service-role-only execution gates.'
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
    fn.includes('NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED') &&
    fn.includes('NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS') &&
    fn.includes('NAYAX_REFUND_DAILY_COUNT_CAP'),
  'Nayax execution function must be gated by all fail-closed execution flags.'
);
assert(
  fn.includes('can_manage_refund_case') &&
    !fn.includes('actorIsSuperAdmin'),
  'Nayax execution function must authorize assigned Machine Managers through refund case access, not a super-admin-only UI path.'
);
assert(
  fn.includes('provider_execution_not_yet_enabled') &&
    !fn.includes('/payment/refund-request') &&
    !fn.includes('/payment/refund-approve'),
  'This release must not call live Nayax refund endpoints.'
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
    nayaxLookupShared.includes('Omit<NayaxProviderCandidate, "transactionId" | "siteId">') &&
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

console.log('Nayax refund execution guardrails validated.');
