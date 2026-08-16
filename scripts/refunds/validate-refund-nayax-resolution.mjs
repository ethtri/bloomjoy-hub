#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const migration = read(
  'supabase/migrations/202608130001_refund_nayax_outcome_resolution.sql'
);
const databaseTests = read('supabase/tests/refund_nayax_outcome_resolution.sql');
const concurrencyTests = read(
  'supabase/tests/refund_nayax_outcome_resolution_concurrency.sql'
);
const stepUpEdge = read('supabase/functions/refund-manager-action-step-up/index.ts');
const messageSendEdge = read('supabase/functions/refund-case-message-send/index.ts');
const nayaxExecutionEdge = read('supabase/functions/nayax-card-refund/index.ts');
const nayaxGates = read('supabase/functions/_shared/nayax-refund-gates.ts');
const nayaxGatesTests = read('supabase/functions/_shared/nayax-refund-gates.test.ts');
const nayaxCompletion = read('supabase/functions/_shared/nayax-resolution-completion.ts');
const nayaxCompletionTests = read('supabase/functions/_shared/nayax-resolution-completion.test.ts');
const nayaxMessageLane = read('supabase/functions/_shared/nayax-resolution-message-lane.ts');
const operations = read('src/lib/refundOperations.ts');
const portal = read('src/pages/admin/Refunds.tsx');
const portalUat = read('scripts/refunds/validate-refund-portal-uat.mjs');
const evidenceManifest = read('scripts/refunds/refund-uat-evidence.mjs');
const currentStatus = read('Docs/CURRENT_STATUS.md');
const decisions = read('Docs/DECISIONS.md');
const runbook = read('Docs/PRODUCTION_RUNBOOK.md');
const smoke = read('Docs/QA_SMOKE_TEST_CHECKLIST.md');
const providerNotes = read('Docs/NAYAX_LYNX_API.md');

const consumeStart = migration.indexOf(
  'create or replace function public.admin_consume_refund_nayax_resolution_intent('
);
const consumeEnd = migration.indexOf(
  'revoke execute on function public.refund_nayax_outcome_resolution_enabled()',
  consumeStart
);
const consume = migration.slice(consumeStart, consumeEnd);

assert(
  migration.includes('create or replace function public.refund_nayax_outcome_resolution_enabled()') &&
    migration.includes('select false;') &&
    migration.includes('refund_nayax_resolution_operators') &&
    !/insert into public\.refund_nayax_resolution_operators[\s\S]*values\s*\(/i.test(migration) &&
    !migration.includes('grant execute on function public.refund_nayax_outcome_resolution_enabled'),
  'Payment-support resolution must be hard off with no seeded operator or runtime setter.'
);

assert(
  migration.includes('alter table public.refund_nayax_resolution_operators enable row level security') &&
    migration.includes('alter table public.refund_nayax_resolution_intents enable row level security') &&
    migration.includes('alter table public.refund_nayax_outcome_resolutions enable row level security') &&
    migration.includes('refund_nayax_outcome_resolution_immutable') &&
    migration.includes('before update or delete on public.refund_nayax_outcome_resolutions') &&
    migration.includes("capability = 'payment_support_resolution'") &&
    migration.includes('user_is_active_refund_manager_only(p_user_id)'),
  'Private authorization, intent, and immutable evidence tables must stay privilege-locked and mapping-bound.'
);

assert(
  consumeStart >= 0 && consumeEnd > consumeStart &&
    consume.includes("pg_advisory_xact_lock(hashtextextended(current_actor_user_id::text, 767))") &&
    migration.includes('and current_user = database_owner') &&
    migration.includes('and current_user = resolver_owner') &&
    consume.includes("'provider_confirmed_success'") &&
    consume.includes("'documented_manual_completion'") &&
    consume.includes("normalized_result = 'provider_confirmed_retry_safe'") &&
    consume.includes("'providerCallMade', false") &&
    consume.includes("'customerMessageCreated', completion_committed") &&
    consume.includes("'refund_nayax_completion_v2'") &&
    consume.includes("completion_gmail_thread_id = completion_thread_row.id") &&
    !consume.includes('http_post') &&
    !consume.includes('net.http') &&
    !consume.includes('fetch('),
  'Consume must serialize the exact actor, make no provider call, and bind completed outcomes to one pending original-thread customer message.'
);

assert(
  migration.includes("resolution_result = 'provider_confirmed_success'") &&
    migration.includes("evidence_type = 'nayax_dtm_transaction' and reason_code = 'nayax_dtm_settled'") &&
    migration.includes("evidence_type = 'nayax_support_ticket'") &&
    migration.includes("reason_code = 'nayax_support_confirmed_success'") &&
    migration.includes("resolution_result = 'provider_confirmed_retry_safe'") &&
    migration.includes("reason_code = 'nayax_support_retry_safe'") &&
    migration.includes("resolution_result = 'documented_manual_completion'") &&
    migration.includes("evidence_type = 'documented_manual_refund'") &&
    migration.includes("resolution_result = 'remain_on_hold'") &&
    migration.includes('refund_nayax_resolution_reference_is_safe') &&
    migration.includes('evidence_reference_digest') &&
    !migration.includes('evidence_reference text not null') &&
    migration.includes('evidence_occurred_at') &&
    migration.includes('attempt_evidence_hash'),
  'Only four exact evidence/result pairs, a privacy-safe digest, and truthful action time may be authorized.'
);

assert(
  databaseTests.includes('select plan(82)') &&
    databaseTests.includes("select '2026-08-14 00:05:00+00'::timestamptz as now_at") &&
    databaseTests.includes("occurred_at <= now_at + interval '30 seconds'") &&
    databaseTests.includes(
      "Previous-day UTC evidence stays in the past and crosses the LA date at 00:05 UTC"
    ) &&
    (databaseTests.match(/- interval '1 day' \+ interval '15 minutes'/g) ?? []).length === 3 &&
    databaseTests.includes('The default-off gate blocks preparation before any write') &&
    databaseTests.includes('PAN, phone, account, and other long digit-shaped references are rejected') &&
    databaseTests.includes('Grouped card, phone, and account digit shapes are rejected') &&
    databaseTests.includes('eight-digit Nayax support-ticket shape remains usable') &&
    databaseTests.includes('nine-digit Nayax DTM transaction shape remains usable') &&
    databaseTests.includes('stores only a one-way evidence-reference digest') &&
    databaseTests.includes('A generic AAL2 token cannot replace the trusted exact-factor proof') &&
    databaseTests.includes('A session-local resolution ID cannot bypass the provider hold') &&
    databaseTests.includes('A direct generic customer-message insert cannot bypass delivery-unknown reconciliation') &&
    databaseTests.includes('Success atomically binds one pending original-thread completion without calling the provider') &&
    databaseTests.includes('The exact safely failed completion can be reopened once for original-thread delivery') &&
    databaseTests.includes('A failed bounded retry is durably marked exhausted') &&
    databaseTests.includes('A second customer-completion retry is impossible') &&
    databaseTests.includes('A stale completion with no Gmail claim is proven safe without sending') &&
    databaseTests.includes('A stale completion with an unconfirmed Gmail claim becomes reconciliation-only') &&
    databaseTests.includes('Exact sent Gmail evidence settles an interrupted completion without another send') &&
    databaseTests.includes('Sent-evidence recovery durably reconciles the exact attempt and message') &&
    databaseTests.includes('Sent evidence with later manager-route drift becomes reconciliation-only without another send') &&
    databaseTests.includes('Manager-route drift cannot strand sent evidence or permit a customer-message retry') &&
    databaseTests.includes('Recovery refuses a message that is not bound to the exact authorized case') &&
    databaseTests.includes('Wrong-case recovery leaves the exact completion pending and unchanged') &&
    databaseTests.includes('Delivery-unknown interruption recovery cannot be retried') &&
    databaseTests.includes('Customer and reporting dates preserve the UTC action time across a local-date boundary') &&
    databaseTests.includes('Retry-safe returns through the real manager step-up preparation path with generation one frozen') &&
    databaseTests.includes('A new manager approval can reserve one fresh attempt after retry-safe generation') &&
    databaseTests.includes('Manual completion preserves the original rejected outcome and exact evidence classification'),
  'pgTAP must prove the default-off, factor-bound, immutable, provider-free resolution and bounded completion boundary.'
);

assert(
  migration.includes('nayax_refund_attempt_generation') &&
    migration.includes('guard_refund_nayax_attempt_generation') &&
    migration.includes("resolution_row.next_attempt_generation") &&
    nayaxExecutionEdge.includes('nayax_refund_attempt_generation') &&
    nayaxGates.includes('attemptGeneration') &&
    nayaxGatesTests.includes('support-approved retry generation must create a fresh key'),
  'Retry-safe must advance one guarded generation included in both reviewed evidence and HMAC idempotency.'
);

assert(
  concurrencyTests.includes('select plan(15)') &&
    concurrencyTests.includes('dblink_send_query') &&
    concurrencyTests.includes('Exactly one database session can consume the same verified resolution intent') &&
    concurrencyTests.includes('The race commits exactly one immutable support-resolution record') &&
    concurrencyTests.includes('Concurrency creates one adjustment, one bound message, and no additional provider attempt') &&
    concurrencyTests.includes('A concurrent direct generic customer-message insert loses to the unresolved completion guard') &&
    concurrencyTests.includes('The concurrent generic-message loser creates no second customer-message row') &&
    concurrencyTests.includes('A committed generic message blocks the reverse-order resolution consume') &&
    concurrencyTests.includes('Reverse-order rejection creates no resolution, completion, or provider attempt') &&
    concurrencyTests.includes('First-contact delivery-unknown state blocks completed resolution') &&
    concurrencyTests.includes('Automation delivery-reconciliation state blocks completed resolution') &&
    concurrencyTests.includes('Concurrent regression restores the production hard-off gate'),
  'Two-session pgTAP must prove one winner, one immutable result, and zero duplicate action.'
);

assert(
  stepUpEdge.includes('targetFunction === "refund-nayax-outcome-resolve"') &&
    stepUpEdge.includes('admin_get_refund_nayax_resolution_intent') &&
    stepUpEdge.includes('admin_refund_nayax_resolution_factor_is_approved') &&
    stepUpEdge.includes('service_mark_refund_nayax_resolution_factor_verified') &&
    stepUpEdge.includes('admin_consume_refund_nayax_resolution_intent') &&
    stepUpEdge.includes('p_evidence_occurred_at: frozenPayload.evidenceOccurredAt') &&
    stepUpEdge.includes('dispatchRefundCaseGmailReply') &&
    stepUpEdge.includes('gmailThreadId: attempt.completion_gmail_thread_id') &&
    stepUpEdge.includes('service_finish_nayax_refund_completion') &&
    stepUpEdge.includes('deliverPreparedNayaxCompletionOnce') &&
    nayaxCompletionTests.includes('post-commit lookup failure settles failed before any Gmail call') &&
    stepUpEdge.includes('The payment-support resolution could not be committed. The provider hold remains in place.'),
  'The shared step-up endpoint must use the frozen exact-factor RPC chain and one original-thread completion attempt.'
);

assert(
  messageSendEdge.includes('service_prepare_nayax_completion_retry') &&
    messageSendEdge.includes('nayaxCompletionMessageId') &&
    messageSendEdge.includes('Object.keys(body ?? {}).some') &&
    messageSendEdge.includes('gmailThreadId: retryGmailThreadId') &&
    messageSendEdge.includes('service_finish_nayax_refund_completion') &&
    messageSendEdge.includes('deliverNayaxCompletionOnce') &&
    !messageSendEdge.includes('nayaxCompletionRecipient') &&
    migration.includes('completion_delivery_retry_count between 0 and 1') &&
    migration.includes('Nayax completion delivery requires reconciliation, not retry') &&
    nayaxCompletion.includes('deliveryReturned || isDeliveryUncertain(error)') &&
    nayaxCompletionTests.includes('post-send settlement failure cannot be downgraded to safe failure') &&
    nayaxCompletionTests.includes('deliveryCalls, 1'),
  'Only the exact safely failed attempt-bound completion may receive one non-editable original-thread retry.'
);

assert(
  migration.includes('service_recover_stale_nayax_completion') &&
    migration.includes('p_refund_case_id uuid') &&
    migration.includes('guard_refund_nayax_completion_message_lane') &&
    migration.includes('Unresolved Nayax completion blocks every other customer message') &&
    migration.includes('Settle the existing customer message before recording a completed Nayax resolution') &&
    migration.includes("outbound.status in ('pending_send', 'delivery_unknown')") &&
    migration.includes("first_contact.status in ('pending_send', 'delivery_unknown')") &&
    migration.includes("'gmail_delivery_reconciliation_required'") &&
    migration.includes("statement_timestamp() - interval '5 minutes'") &&
    migration.includes("when outbound_row.id is null then 'failed'") &&
    migration.includes("else 'delivery_unknown'") &&
    messageSendEdge.includes('nayaxCompletionRecoveryMessageId') &&
    messageSendEdge.includes('service_recover_stale_nayax_completion') &&
    messageSendEdge.includes('service_refund_nayax_completion_message_lane_open') &&
    messageSendEdge.indexOf('service_refund_nayax_completion_message_lane_open') <
      messageSendEdge.indexOf('.from("refund_case_messages")') &&
    messageSendEdge.includes('assertOpenNayaxCompletionMessageLane') &&
    messageSendEdge.includes('p_refund_case_id: caseId') &&
    messageSendEdge.includes('recovery.refundCaseId !== caseId') &&
    nayaxMessageLane.includes('RefundNayaxCompletionMessageLaneBlockedError') &&
    nayaxCompletionTests.includes('unresolved completion blocks generic message, outbound, and Gmail work') &&
    nayaxCompletionTests.includes('assertEquals(messageInsertCalls, 0)') &&
    nayaxCompletionTests.includes('assertEquals(outboundClaimCalls, 0)') &&
    messageSendEdge.includes('recovery.providerCallMade !== false') &&
    stepUpEdge.includes('deliverPreparedNayaxCompletionOnce') &&
    stepUpEdge.includes('messageResult.error || attemptResult.error') &&
    nayaxCompletionTests.includes('assertEquals(gmailCalls, 0)') &&
    nayaxCompletionTests.includes('assertEquals(finishCalls, ["failed"])') &&
    operations.includes('recoverRefundNayaxCompletion') &&
    portal.includes('Recover interrupted completion') &&
    portal.includes('Bloomjoy will either confirm it was sent or make one safe retry available') &&
    portal.includes('latestPendingNayaxCompletionMessage || latestFailedNayaxCompletionMessage'),
  'Every interrupted pending completion must become exact sent evidence, one safe retry, or reconciliation-only without sending during recovery.'
);

assert(
  operations.includes("| 'nayax_resolve'") &&
    operations.includes("targetFunction: 'refund-nayax-outcome-resolve'") &&
    operations.includes("'admin_prepare_refund_nayax_resolution_intent'") &&
    portal.includes('data-testid="refund-nayax-resolution-panel"') &&
    portal.includes('data-testid="refund-nayax-resolution-result"') &&
    portal.includes('data-testid="refund-nayax-resolution-evidence-type"') &&
    portal.includes('data-testid="refund-nayax-resolution-reason"') &&
    portal.includes('data-testid="refund-nayax-resolution-reference"') &&
    portal.includes('data-testid="refund-nayax-resolution-occurred-at"') &&
    portal.includes('data-testid="refund-nayax-resolution-step-up-summary"') &&
    portal.includes('Enter the reference from the transaction record or payment support') &&
    portal.includes('Do not include customer or card details') &&
    portal.includes('Refund date and time') &&
    portal.includes('Retry completion email') &&
    portal.includes('gmail_completion_retry_exhausted') &&
    portal.includes("normalized === 'gmail_completion_delivery_unknown'") &&
    portal.includes('Customer completion retry is exhausted') &&
    portal.includes('It does not retry or change the refund.') &&
    migration.includes('mark_refund_nayax_completion_retry_exhausted') &&
    portal.includes('If the refund succeeded, Bloomjoy records it and emails the') &&
    portal.includes('customer in the original thread') &&
    portal.includes('This records the result shown below. It does not retry the refund or contact the customer.') &&
    !portal.includes('refund-nayax-resolution-recipient') &&
    !portal.includes('refund-nayax-resolution-body') &&
    !portal.includes('refund-nayax-resolution-recipient'),
  'The manager surface must expose structured UTC evidence, outcome-specific customer-contact consent, and only one exact non-editable completion retry.'
);

assert(
  portalUat.includes("if (arg === '--nayax-resolution-only')") &&
    portalUat.includes('runNayaxResolutionChecks') &&
    portalUat.includes('Payment support sees exactly four structured outcomes and no arbitrary communication controls') &&
    portalUat.includes('Verified ${scenario.result} submits one frozen result with no provider or separate message endpoint') &&
    portalUat.includes('Pending Nayax completion blocks generic customer messages and exposes only no-send recovery') &&
    portalUat.includes('Uncertain Nayax completion blocks recovery, retry, and generic customer messaging') &&
    portalUat.includes('Payment-support verification remains usable without mobile horizontal overflow') &&
    evidenceManifest.includes("'refund-nayax-support-resolution-desktop.png'") &&
    evidenceManifest.includes("'refund-nayax-support-resolution-mobile.png'"),
  'Synthetic desktop/mobile UAT must prove structured support review and zero provider/customer side effects.'
);

assert(
  currentStatus.includes("P0 `#767`'s audited provider-outcome resolution is deployed default-off") &&
    decisions.includes('Uncertain Nayax outcomes require a separate immutable support decision (`#767`)') &&
    runbook.includes('Default-off Nayax outcome resolution (`#767`)') &&
    runbook.includes('current strict production release is the reviewed ten-function/51-migration default-off foundation') &&
    runbook.includes('Deploy only the ten functions listed in the release manifest from the exact immutable, reviewed canonical-main commit') &&
    !runbook.includes('For the unmerged candidate') &&
    !runbook.includes('The later `#767` outcome-resolution migration and function deployment') &&
    smoke.includes('npm run refunds:validate-nayax-resolution') &&
    smoke.includes('deployed ten-function/51-migration default-off foundation') &&
    smoke.includes('`#767` audited outcome-resolution foundation') &&
    smoke.includes('`#829` default-off production deployment') &&
    smoke.includes('Gmail intake-shadow foundation are complete') &&
    !smoke.includes('deployed ten-function/49-migration safe foundation') &&
    !smoke.includes('The `#767` candidate adds one default-off outcome-resolution migration') &&
    providerNotes.includes('Transaction Status ID `12` as **Approved**') &&
    providerNotes.includes('do not remove the account-specific contract blocker') &&
    providerNotes.includes('no automatic or ad hoc "mark successful" shortcut') &&
    providerNotes.includes('audited structured resolver foundation exists and is deployed default-off') &&
    providerNotes.includes('activation and use remain blocked') &&
    !providerNotes.includes('an audited state-changing resolver remains blocked'),
  'Status, decision, provider-contract, runbook, and QA docs must preserve the default-off launch boundary.'
);

console.log('Refund Nayax outcome-resolution boundary validated.');
