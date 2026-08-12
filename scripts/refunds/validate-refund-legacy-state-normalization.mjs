#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read(
  'supabase/migrations/20260812210000_refund_legacy_card_state_normalization.sql'
);
const databaseTests = read('supabase/tests/refund_legacy_card_state_normalization.sql');
const concurrencyTests = read(
  'supabase/tests/refund_legacy_card_state_normalization_concurrency.sql'
);
const operations = read('src/lib/refundOperations.ts');
const portal = read('src/pages/admin/Refunds.tsx');
const portalUat = read('scripts/refunds/validate-refund-portal-uat.mjs');
const runbook = read('Docs/PRODUCTION_RUNBOOK.md');
const smoke = read('Docs/QA_SMOKE_TEST_CHECKLIST.md');

const operationStart = migration.indexOf(
  'create or replace function public.owner_normalize_refund_legacy_card_state('
);
const operationEnd = migration.indexOf(
  'revoke all on function public.owner_normalize_refund_legacy_card_state',
  operationStart
);
const ownerOperation = migration.slice(operationStart, operationEnd);

assert(
  operationStart >= 0 && operationEnd > operationStart &&
    /p_confirmation is distinct from\s+'NORMALIZE_LEGACY_CARD_STATE_WITHOUT_PROVIDER_ACTION'/.test(ownerOperation) &&
    ownerOperation.includes("legacy_case.status is distinct from 'card_refund_pending'") &&
    ownerOperation.includes("legacy_case.decision is distinct from 'approved'") &&
    ownerOperation.includes("legacy_case.nayax_refund_execution_status is distinct from 'not_requested'") &&
    ownerOperation.includes('provider_attempt_count <> 0') &&
    ownerOperation.includes('total_message_count <> 1') &&
    ownerOperation.includes('approved_message_count <> 1') &&
    ownerOperation.includes('sent_approved_message_count <> 1') &&
    ownerOperation.includes('completed_message_count <> 0') &&
    ownerOperation.includes('pending_message_count <> 0') &&
    ownerOperation.includes('operation_owner <> database_owner') &&
    ownerOperation.includes('current_user <> operation_owner') &&
    ownerOperation.includes('session_user <> database_owner'),
  'The owner repair must require the exact legacy contradiction and explicit confirmation.'
);

assert(
  migration.includes(
    'revoke all on function public.owner_normalize_refund_legacy_card_state(uuid, text)'
  ) &&
    !migration.includes(
      'grant execute on function public.owner_normalize_refund_legacy_card_state'
    ),
  'No browser, service, or workflow role may invoke the owner-only repair.'
);

assert(
  ownerOperation.includes("status = 'needs_review'") &&
    ownerOperation.includes('decision = null') &&
    ownerOperation.includes('decision_reason = null') &&
    ownerOperation.includes('refund_amount_cents = null') &&
    ownerOperation.includes("correlation_status = 'manual_review'") &&
    ownerOperation.includes('matched_nayax_transaction_id = null') &&
    ownerOperation.includes('matched_nayax_machine_auth_time = null') &&
    ownerOperation.includes('nayax_recommendation_state = null') &&
    ownerOperation.includes("'previous_match_present'") &&
    ownerOperation.includes('nayax_match_execution_eligible = false') &&
    ownerOperation.includes('delete from public.refund_nayax_lookup_candidates') &&
    ownerOperation.includes("'stale_lookup_candidate_count'") &&
    ownerOperation.includes("'legacy_card_state_normalized'") &&
    ownerOperation.includes("'provider_action_taken', false") &&
    ownerOperation.includes("'customer_message_sent', false") &&
    !ownerOperation.includes('refund_case_nayax_refund_attempts (') &&
    !ownerOperation.includes('insert into public.refund_case_messages') &&
    !ownerOperation.includes('http_post') &&
    !ownerOperation.includes('net.http') &&
    !ownerOperation.includes('gmail'),
  'The repair must only write truthful case state and redacted audit history, with no provider or communication side effect.'
);

assert(
  migration.includes('Legacy refund normalization evidence is append-only') &&
    migration.includes('refund_cases_guard_legacy_state_actions') &&
    migration.includes('refund_case_messages_guard_legacy_state') &&
    migration.includes('before insert or update on public.refund_case_messages') &&
    migration.includes('refund_nayax_attempts_guard_legacy_state') &&
    migration.includes("'legacyStateReviewRequired'") &&
    migration.includes('or public.refund_case_legacy_state_review_required(refund_case.id)'),
  'The normalized state must remain immutable and block decisions, messages, and provider attempts until fresh review.'
);

assert(
  operations.includes('legacyStateReviewRequired?: boolean') &&
    operations.includes('legacyStateReviewRequired: boolean') &&
    operations.includes('legacyStateReviewRequired: state.legacyStateReviewRequired') &&
    portal.includes("return 'Payment history check'") &&
    portal.includes("return 'Fresh check needed'") &&
    portal.includes("label: 'Historical payment review required'") &&
    portal.includes('refund-legacy-state-review-banner') &&
    portal.includes('refund-legacy-state-freeze') &&
    portal.includes('const effectiveCandidates = selectedCase.legacyStateReviewRequired ? [] : nayaxCandidates') &&
    portal.includes("? 'Waiting for a fresh transaction check'") &&
    portal.includes('!selectedCase.legacyStateReviewRequired') &&
    portal.includes('Historical approval email sent') &&
    portal.includes('No provider refund is recorded.') &&
    portal.includes('Customer decisions and email are paused during this payment history check.'),
  'The portal must present one plain truthful state and keep customer decisions hidden.'
);

assert(
  portalUat.includes("if (arg === '--legacy-state-only')") &&
    portalUat.includes('runLegacyStateNormalizationChecks') &&
    portalUat.includes('Deliberately retain the prior matched fields and candidate response') &&
    portalUat.includes("getByTestId('nayax-candidate-option').count()) === 0") &&
    portalUat.includes("getByText('Transaction selected', { exact: true }).count()) === 0") &&
    portalUat.includes('Opening normalized legacy review performs no official, provider, or customer action') &&
    portalUat.includes('Normalized legacy review has no mobile horizontal overflow') &&
    portalUat.includes('refund-legacy-state-review-desktop.png') &&
    portalUat.includes('refund-legacy-state-review-mobile.png'),
  'Focused desktop/mobile browser UAT must prove truthful copy, blocked actions, and zero side effects.'
);

assert(
  databaseTests.includes('select plan(30)') &&
    databaseTests.includes('The private operation is owned by the exact database owner') &&
    databaseTests.includes('Normalization removes every stale replaceable lookup candidate') &&
    databaseTests.includes('Normalization creates no provider attempt') &&
    databaseTests.includes('The historical customer message remains unchanged') &&
    databaseTests.includes('Normalization alone cannot enable a new official decision') &&
    databaseTests.includes('Normalization alone cannot enable a customer message') &&
    databaseTests.includes('Normalization freezes updates to every pre-existing customer message') &&
    databaseTests.includes('Normalization alone cannot enable a provider attempt or retry') &&
    databaseTests.includes('A later fresh transaction evaluation resolves only the historical-review freeze'),
  'pgTAP must prove exact targeting, history preservation, blocking, and the fresh-review exit.'
);

assert(
  concurrencyTests.includes('select plan(11)') &&
    concurrencyTests.includes('dblink_send_query') &&
    concurrencyTests.includes('Exactly one concurrent owner call performs the normalization') &&
    concurrencyTests.includes('A provider attempt queued behind normalization fails closed') &&
    concurrencyTests.includes('A customer message queued behind normalization fails closed') &&
    concurrencyTests.includes('A case decision queued behind normalization fails closed') &&
    concurrencyTests.includes('All concurrent paths complete with zero provider side effects') &&
    concurrencyTests.includes('no customer communication'),
  'Two-session pgTAP must prove owner idempotency and zero-side-effect action races.'
);

assert(
  runbook.includes('Legacy card-state normalization (`#784`)') &&
    smoke.includes('Legacy card-state normalization (`#784`)'),
  'Owner execution, sanitized verification, repair posture, and UAT must be documented.'
);

console.log('Refund legacy card-state normalization boundary validated.');
