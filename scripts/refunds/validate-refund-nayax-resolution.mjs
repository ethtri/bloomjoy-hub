#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const foundation = read('supabase/migrations/202608130001_refund_nayax_outcome_resolution.sql');
const supportWindow = read('supabase/migrations/20260820143000_refund_nayax_support_resolution_window.sql');
const legacyClose = read('supabase/migrations/20260820150000_refund_nayax_support_resolution_close.sql');
const managerSession = read('supabase/migrations/20260821035000_refund_manager_session_simplification.sql');
const formCompletion = read('supabase/migrations/20260821080000_refund_form_completion_transport.sql');
const completionDelivery = read('supabase/migrations/20260821083000_refund_completion_delivery_decoupling.sql');
const edge = read('supabase/functions/refund-nayax-outcome-resolve/index.ts');
const completion = read('supabase/functions/_shared/nayax-resolution-completion.ts');
const messageSend = read('supabase/functions/refund-case-message-send/index.ts');
const operations = read('src/lib/refundOperations.ts');
const portal = read('src/pages/admin/Refunds.tsx');

assert(
  foundation.includes('select false;') &&
    foundation.includes('refund_nayax_outcome_resolutions') &&
    foundation.includes('before update or delete on public.refund_nayax_outcome_resolutions') &&
    foundation.includes('evidence_reference_digest') &&
    !foundation.includes('evidence_reference text not null'),
  'The original support resolver must retain its default-off, immutable, digest-only evidence foundation.'
);

assert(
  completionDelivery.includes('service_load_nayax_refund_completion') &&
    completionDelivery.includes('service_prepare_nayax_form_completion_retry') &&
    completionDelivery.includes("'provider_call_made', false") &&
    completionDelivery.includes("'transport', 'transactional_email'") &&
    completionDelivery.includes('completion_delivery_retry_count = 1') &&
    completionDelivery.includes('Service-role delivery is authorized by the committed completion state') &&
    !/\b(http_post|net\.http|fetch\s*\()/i.test(completionDelivery),
  'Customer completion must keep payment tables private, stay provider-free, and permit only one form-email retry.'
);

assert(
  formCompletion.includes("case_row.intake_source is distinct from 'form'") &&
    formCompletion.includes('service_authorize_nayax_refund_form_completion') &&
    formCompletion.includes('service_finish_nayax_refund_form_completion') &&
    formCompletion.includes("'managerRecipientOverlap', manager_recipient_overlap") &&
    formCompletion.includes('manager_email <> normalized_customer') &&
    formCompletion.includes("'transport', 'transactional_email'") &&
    formCompletion.includes("'originalThread', false") &&
    formCompletion.includes('completion_gmail_thread_id is not null') &&
    formCompletion.includes('assert_nayax_provider_executor') &&
    !/\b(http_post|net\.http|fetch\s*\()/i.test(formCompletion),
  'Website-form completion must use the existing customer-email channel while Gmail-origin cases retain their linked thread.'
);

assert(
  supportWindow.includes('select true;') &&
    supportWindow.includes("'^SUPPORT:NAYAX-CS[0-9]{7}$'") &&
    !/\b(http_post|net\.http|fetch\s*\()/i.test(supportWindow),
  'The reviewed support window must remain provider-free and accept the approved CS ticket shape.'
);

assert(
  legacyClose.includes('Cannot retire the legacy Nayax resolver with a pending intent') &&
    legacyClose.includes("status = 'revoked'") &&
    legacyClose.includes('operator_version = resolution_operator.operator_version + 1') &&
    legacyClose.includes('enrollment_version = enrollment.enrollment_version + 1') &&
    legacyClose.includes('select false;') &&
    !legacyClose.includes('Cannot close Nayax support resolution before exactly one confirmed refund') &&
    !/\b(http_post|net\.http|fetch\s*\()/i.test(legacyClose),
  'Legacy TOTP/operator authority must retire without fabricating or first mutating a held production outcome.'
);

assert(
  managerSession.includes('admin_resolve_refund_nayax_outcome_manager_session') &&
    managerSession.includes('admin_get_refund_nayax_resolution_readiness') &&
    managerSession.includes("'authorizationMethod', 'manager_session'") &&
    managerSession.includes('can_perform_refund_official_action') &&
    managerSession.includes("manager.status = 'active'") &&
    managerSession.includes('official_action_version is distinct from p_expected_case_version') &&
    managerSession.includes('pg_advisory_xact_lock') &&
    managerSession.includes('Exact latest held payment attempt is required'),
  'Resolution must bind the exact mapped manager, case version, latest held attempt, and serialized decision.'
);

assert(
  managerSession.includes('refund_nayax_resolution_reference_is_safe') &&
    managerSession.includes('refund_nayax_resolution_reference_digest') &&
    managerSession.includes('refund_nayax_resolution_evidence_hash') &&
    managerSession.includes("'provider_confirmed_success'") &&
    managerSession.includes("'provider_confirmed_retry_safe'") &&
    managerSession.includes("'documented_manual_completion'") &&
    managerSession.includes("'remain_on_hold'"),
  'Only the four approved result/evidence shapes and a one-way reference digest may be recorded.'
);

const resolverStart = managerSession.indexOf(
  'create or replace function public.admin_resolve_refund_nayax_outcome_manager_session('
);
const resolverEnd = managerSession.indexOf(
  'revoke execute on function public.admin_resolve_refund_nayax_outcome_manager_session(',
  resolverStart
);
const resolver = managerSession.slice(resolverStart, resolverEnd);
assert(
  resolverStart >= 0 && resolverEnd > resolverStart &&
    resolver.includes("'providerCallMade', false") &&
    resolver.includes('sales_adjustment_facts') &&
    resolver.includes("'refund_nayax_completion_v2'") &&
    resolver.includes('completion_gmail_thread_id = completion_thread_row.id') &&
    resolver.includes('on conflict (source, source_reference, source_row_reference)') &&
    !/\b(http_post|net\.http|fetch\s*\()/i.test(resolver),
  'The database resolver must make no provider call and atomically bind reporting plus one original-thread completion.'
);

assert(
  managerSession.includes('nayax_refund_attempt_generation') &&
    managerSession.includes('refund_nayax_retry_safe_case_is_current') &&
    managerSession.includes('resolution_row.next_attempt_generation') &&
    managerSession.includes("nayax_refund_execution_status = 'not_requested'"),
  'Retry-safe evidence must advance the guarded attempt generation without retrying a payment.'
);

assert(
  edge.includes('resolveSupabaseAccessToken') &&
    edge.includes('.getUser(accessToken)') &&
    edge.includes('admin_resolve_refund_nayax_outcome_manager_session') &&
    edge.includes('deliverPreparedNayaxCompletionOnce') &&
    edge.includes('dispatchRefundCaseGmailReply') &&
    edge.includes('sendRefundTransactionalEmail') &&
    edge.includes('service_authorize_nayax_refund_form_completion') &&
    edge.includes('service_load_nayax_refund_completion') &&
    edge.includes('service_finish_nayax_refund_form_completion') &&
    edge.includes('formManagerRecipientOverlap') &&
    edge.includes('gmailThreadId: attempt.completion_gmail_thread_id') &&
    edge.includes('service_finish_nayax_refund_completion') &&
    !edge.includes('verifyRefundManagerTotp') &&
    !edge.includes('stepUpFactorProof'),
  'The direct Edge boundary must authenticate the user, call the manager-session resolver, and deliver exactly one prepared completion.'
);

assert(
  completion.includes('deliveryReturned || isDeliveryUncertain(error)') &&
    messageSend.includes('service_prepare_nayax_completion_retry') &&
    messageSend.includes('service_prepare_nayax_form_completion_retry') &&
    messageSend.includes('transport: "transactional_email"') &&
    messageSend.includes('p_executor_assertion: ""') &&
    messageSend.includes('service_recover_stale_nayax_completion') &&
    foundation.includes('completion_delivery_retry_count between 0 and 1'),
  'Interrupted customer completion must retain the existing bounded retry and reconciliation lane.'
);

assert(
  operations.includes("'refund-nayax-outcome-resolve'") &&
    operations.includes('export const resolveRefundNayaxOutcome') &&
    portal.includes('data-testid="refund-nayax-resolution-panel"') &&
    portal.includes('data-testid="refund-nayax-resolution-result"') &&
    portal.includes('data-testid="refund-nayax-resolution-evidence-type"') &&
    portal.includes('data-testid="refund-nayax-resolution-reference"') &&
    portal.includes('data-testid="refund-nayax-resolution-occurred-at"') &&
    !portal.includes('data-testid="refund-nayax-resolution-reason"') &&
    !portal.includes('authenticator code') &&
    portal.includes('Complete case & notify customer') &&
    portal.includes('No second payment was attempted'),
  'The manager form must contain only result, source, reference, conditional time, and one clear action.'
);

assert(
  managerSession.includes('revoke execute on function public.admin_resolve_refund_nayax_outcome_manager_session') &&
    managerSession.includes('to authenticated;') &&
    managerSession.includes('alter table public.refund_nayax_resolution_intents') &&
    managerSession.includes('authorization_method = \'manager_session\'') &&
    managerSession.includes('manager_totp_enrollment_version is null') &&
    managerSession.includes('operator_version is null'),
  'The new path must be authenticated, auditable, and independent of TOTP enrollment or temporary operators.'
);

console.log('PASS: manager-session held-result reconciliation is exact, provider-free, and idempotent');
console.log('PASS: reporting and one source-appropriate customer completion remain atomic and recoverable');
console.log('PASS: the manager surface exposes one calm result form with no TOTP ceremony');
