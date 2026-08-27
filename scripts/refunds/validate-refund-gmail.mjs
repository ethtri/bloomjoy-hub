import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

assert.equal(
  process.argv.length,
  2,
  'Static Gmail validation does not write evidence; use npm run refunds:evidence-gmail.',
);

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [
  migration,
  firstContactMigration,
  participantMigration,
  managerRouteMigration,
  firstContactCcMigration,
  pilotLinkageMigration,
  formOnlyMigration,
  followUpMigration,
  firstContactHelper,
  retentionMigration,
  schedulerMigration,
  attachmentOffCopyGateMigration,
  syntheticProofMigration,
  gmailHelper,
  retentionHelper,
  gmailTransport,
  syntheticProofHelper,
  refundEmail,
  managerNotification,
  syncFunction,
  sendFunction,
  adminUpdate,
  automationSweep,
  intakeFunction,
  workflow,
  ui,
  client,
  preflight,
  transportTest,
  syntheticProofTest,
  syntheticProofDbTest,
  syntheticProofConcurrencyTest,
  firstContactCcTest,
  formOnlyTest,
  evidenceHarness,
  packageJson,
  envExample,
  qaChecklist,
] =
  await Promise.all([
    read('supabase/migrations/202607210006_refund_gmail_thread_linkage.sql'),
    read('supabase/migrations/202608030001_refund_gmail_first_contact.sql'),
    read('supabase/migrations/202608030003_refund_gmail_participant_cc.sql'),
    read('supabase/migrations/20260825231621_refund_manager_recipient_route_v2.sql'),
    read('supabase/migrations/202608040003_refund_first_contact_manager_cc.sql'),
    read('supabase/migrations/202608050001_refund_email_pilot_linkage.sql'),
    read('supabase/migrations/20260821090000_refund_form_only_case_creation.sql'),
    read('supabase/migrations/202608030005_refund_deterministic_follow_up_cycles.sql'),
    read('supabase/functions/_shared/refund-first-contact.ts'),
    read('supabase/migrations/202608040002_refund_gmail_retention_safety.sql'),
    read('supabase/migrations/20260827041000_refund_gmail_scheduler_watchdog.sql'),
    read('supabase/migrations/20260812053417_refund_gmail_attachment_off_copy_gate.sql'),
    read('supabase/migrations/20260812230000_refund_synthetic_gmail_proof_authorization.sql'),
    read('supabase/functions/_shared/refund-gmail.ts'),
    read('supabase/functions/_shared/refund-gmail-retention.ts'),
    read('supabase/functions/_shared/refund-gmail-transport.ts'),
    read('supabase/functions/_shared/refund-synthetic-gmail-proof.ts'),
    read('supabase/functions/_shared/refund-email.ts'),
    read('supabase/functions/_shared/refund-manager-notification.ts'),
    read('supabase/functions/refund-gmail-sync/index.ts'),
    read('supabase/functions/refund-case-message-send/index.ts'),
    read('supabase/functions/refund-case-admin-update/index.ts'),
    read('supabase/functions/refund-case-automation-sweep/index.ts'),
    read('supabase/functions/refund-case-intake/index.ts'),
    read('.github/workflows/refund-gmail-sync.yml'),
    read('src/pages/admin/Refunds.tsx'),
    read('src/lib/refundOperations.ts'),
    read('scripts/refunds/refund-gmail-preflight.mjs'),
    read('supabase/functions/_shared/refund-gmail-transport.test.ts'),
    read('supabase/functions/_shared/refund-synthetic-gmail-proof.test.ts'),
    read('supabase/tests/refund_synthetic_gmail_proof_authorization.sql'),
    read('supabase/tests/refund_synthetic_gmail_proof_concurrency.sql'),
    read('supabase/tests/refund_gmail_first_contact_manager_cc.sql'),
    read('supabase/tests/refund_form_only_case_creation.sql'),
    read('scripts/refunds/generate-refund-gmail-evidence.ts'),
    read('package.json'),
    read('.env.example'),
    read('Docs/QA_SMOKE_TEST_CHECKLIST.md'),
  ]);

const requiredTables = [
  'refund_gmail_threads',
  'refund_gmail_messages',
  'refund_gmail_attachments',
  'refund_gmail_sync_runs',
  'refund_gmail_sync_state',
];
for (const table of requiredTables) {
  assert(migration.includes(`create table if not exists public.${table}`), `${table} must exist`);
  assert(migration.includes(`alter table public.${table} enable row level security`), `${table} must use RLS`);
  assert(
    migration.includes(`revoke all on table public.${table} from anon, authenticated`),
    `${table} must be unavailable to browser roles`,
  );
}

assert(migration.includes("'draft'"), 'Email intake must create true draft refund cases');
assert(
  migration.includes('refund_cases_processing_fields_complete'),
  'Non-draft cases must retain required transaction fields',
);
assert(
  migration.includes('constraint refund_gmail_threads_provider_unique unique (mailbox_hash, provider_thread_id)'),
  'Provider thread delivery must be idempotent',
);
assert(
  migration.includes('constraint refund_gmail_messages_provider_unique unique (gmail_thread_id, provider_message_id)'),
  'Provider message delivery must be idempotent',
);
assert(
  migration.includes("'refund-gmail-quarantine'") && migration.includes('public = false'),
  'Gmail attachments must land in a private quarantine bucket',
);
assert(
  migration.includes('service_purge_refund_gmail_expired_message_content'),
  'Gmail copies must have an executable retention purge',
);
assert(
  migration.includes("provider_attachment_id = case when normalized_status = 'deleted'") &&
    migration.includes("thread_subject = '[Deleted after Gmail retention period]'"),
  'Retention must redact residual attachment and thread metadata after content expiry',
);
assert(
  migration.includes('providerThreadId') && migration.includes("'providerThreadId', thread_row.provider_thread_id"),
  'Only the service reply claim may receive the provider thread ID',
);

assert(
  firstContactMigration.includes('create table if not exists public.refund_gmail_first_contact_operations'),
  'First-contact acknowledgements need a durable service-only operation ledger',
);
assert(
  firstContactMigration.includes('constraint refund_gmail_first_contact_thread_unique unique (gmail_thread_id)'),
  'A Gmail thread must have at most one first-contact operation',
);
assert(
  firstContactMigration.includes('service_claim_refund_gmail_first_contact') &&
    firstContactMigration.includes('service_finish_refund_gmail_first_contact'),
  'First-contact claim and completion must be database-controlled',
);
assert(
  firstContactMigration.includes("'later_thread_message'") &&
    firstContactMigration.includes("'before_cutover'") &&
    firstContactMigration.includes("'source_message_not_eligible'") &&
    firstContactMigration.includes("'prior_mailbox_reply'"),
  'Later replies, pre-cutover mail, prior mailbox replies, and ineligible sources must be suppressed',
);
assert(
  firstContactMigration.includes("status in ('shadowed', 'pending_send', 'sent', 'failed', 'delivery_unknown')"),
  'First-contact delivery must distinguish shadow, known failure, and uncertain delivery',
);
assert(
  firstContactMigration.includes('from public, anon, authenticated') &&
    firstContactMigration.includes('to service_role'),
  'First-contact operations must not be callable from browser identities',
);
assert(
  firstContactMigration.includes("p_plain_body ~* '/refunds\\?case='"),
  'Customer acknowledgements must reject internal case links at the database boundary',
);
assert(
  firstContactMigration.includes('service_mark_stale_refund_gmail_first_contacts_unknown') &&
    firstContactMigration.includes("'stale_pending_reconciliation_required'"),
  'Abandoned send claims must become visible reconciliation work without automatic resend',
);
assert(
  firstContactMigration.includes('reconciliation_no_match_version integer not null default 0') &&
    firstContactMigration.includes(
      'reconciliation_no_match_version <= reconciliation_attempt_count',
    ),
  'Both Gmail delivery ledgers must constrain no-match receipts to completed attempt versions',
);
const firstContactReconciliationMigration = firstContactMigration.slice(
  firstContactMigration.indexOf(
    'create or replace function public.service_claim_refund_gmail_first_contact_reconciliation_batch',
  ),
  firstContactMigration.indexOf(
    'create or replace function public.service_mark_stale_refund_gmail_outbound_unknown',
  ),
);
const firstContactFinishMigration = firstContactMigration.slice(
  firstContactMigration.indexOf(
    'create or replace function public.service_finish_refund_gmail_first_contact',
  ),
  firstContactMigration.indexOf(
    'create or replace function public.service_mark_stale_refund_gmail_first_contacts_unknown',
  ),
);
const firstContactNoMatchMigration = firstContactReconciliationMigration.slice(
  firstContactReconciliationMigration.indexOf(
    'create or replace function public.service_finish_refund_gmail_first_contact_no_match',
  ),
);
assert(
  firstContactReconciliationMigration.includes('attempt_version integer') &&
    firstContactReconciliationMigration.includes('reconciliation_checked_at nulls first') &&
    firstContactReconciliationMigration.includes(
      'operation.reconciliation_attempt_count = operation.reconciliation_no_match_version',
    ) &&
    firstContactReconciliationMigration.includes(
      "operation.reconciliation_checked_at <= now() - interval '5 minutes'",
    ) &&
    firstContactReconciliationMigration.includes(
      'reconciliation_attempt_count = operation.reconciliation_attempt_count + 1',
    ) &&
    firstContactReconciliationMigration.includes('claimed.reconciliation_attempt_count'),
  'First-contact reconciliation claims must rotate and return the exact incremented attempt version',
);
assert(
  firstContactFinishMigration.includes('p_attempt_version integer default null') &&
    firstContactFinishMigration.includes(
      'operation_row.reconciliation_attempt_count <> p_attempt_version',
    ) &&
    firstContactFinishMigration.includes(
      "operation_row.status = 'delivery_unknown' and p_attempt_version is null",
    ),
  'First-contact positive reconciliation must be fenced to the active attempt version while live send completion remains supported',
);
assert(
  firstContactNoMatchMigration.includes('p_attempt_version integer') &&
    firstContactNoMatchMigration.includes(
      'set reconciliation_no_match_version = p_attempt_version',
    ) &&
    firstContactNoMatchMigration.includes("status = 'delivery_unknown'") &&
    firstContactNoMatchMigration.includes(
      'reconciliation_attempt_count = p_attempt_version',
    ),
  'A first-contact no-match receipt must match the current delivery-unknown attempt version',
);
assert(
  firstContactMigration.includes('service_count_refund_gmail_first_contact_reconciliation') &&
    firstContactMigration.includes("where operation.status in ('pending_send', 'delivery_unknown')"),
  'Outstanding first-contact delivery must remain countable for Gmail health',
);
assert(
  firstContactMigration.includes(
    'revoke execute on function public.service_claim_refund_gmail_first_contact_reconciliation_batch(integer)',
  ) &&
    firstContactMigration.includes(
      'grant execute on function public.service_claim_refund_gmail_first_contact_reconciliation_batch(integer)',
    ) &&
    firstContactMigration.includes(
      'revoke execute on function public.service_count_refund_gmail_first_contact_reconciliation()',
    ) &&
    firstContactMigration.includes(
      'grant execute on function public.service_count_refund_gmail_first_contact_reconciliation()',
    ),
  'Reconciliation batch and health count must remain service-role-only',
);
assert(
  firstContactMigration.includes('guard_refund_gmail_outbound_during_uncertain_delivery') &&
    firstContactMigration.includes('create trigger refund_gmail_outbound_uncertain_delivery_guard') &&
    firstContactMigration.includes('before insert on public.refund_gmail_messages') &&
    firstContactMigration.includes("existing.status in ('pending_send', 'delivery_unknown')") &&
    firstContactMigration.includes("raise exception 'refund_gmail_delivery_reconciliation_required'"),
  'The central Gmail message ledger must block a new outbound send while thread delivery is unresolved',
);
assert(
  firstContactMigration.includes(
    'revoke execute on function public.guard_refund_gmail_outbound_during_uncertain_delivery()',
  ),
  'The outbound reconciliation guard must not be directly callable by browser identities',
);
const outboundReconciliationMigration = firstContactMigration.slice(
  firstContactMigration.indexOf(
    'create or replace function public.service_mark_stale_refund_gmail_outbound_unknown',
  ),
  firstContactMigration.indexOf(
    'create or replace function public.admin_resolve_refund_gmail_delivery_not_found',
  ),
);
const outboundStaleMigration = outboundReconciliationMigration.slice(
  0,
  outboundReconciliationMigration.indexOf(
    'create or replace function public.service_claim_refund_gmail_outbound_reconciliation_batch',
  ),
);
const outboundBatchMigration = outboundReconciliationMigration.slice(
  outboundReconciliationMigration.indexOf(
    'create or replace function public.service_claim_refund_gmail_outbound_reconciliation_batch',
  ),
  outboundReconciliationMigration.indexOf(
    'create or replace function public.service_finish_refund_gmail_outbound_reconciliation',
  ),
);
const outboundFinishMigration = outboundReconciliationMigration.slice(
  outboundReconciliationMigration.indexOf(
    'create or replace function public.service_finish_refund_gmail_outbound_reconciliation',
  ),
  outboundReconciliationMigration.indexOf(
    'create or replace function public.service_count_refund_gmail_outbound_reconciliation',
  ),
);
const outboundCountMigration = outboundReconciliationMigration.slice(
  outboundReconciliationMigration.indexOf(
    'create or replace function public.service_count_refund_gmail_outbound_reconciliation',
  ),
  outboundReconciliationMigration.indexOf(
    'create or replace function public.service_finish_refund_gmail_outbound_reconciliation_no_match',
  ),
);
const outboundNoMatchMigration = outboundReconciliationMigration.slice(
  outboundReconciliationMigration.indexOf(
    'create or replace function public.service_finish_refund_gmail_outbound_reconciliation_no_match',
  ),
);
assert(
  outboundStaleMigration.includes("message.status = 'pending_send'") &&
    outboundStaleMigration.includes(
      'first_contact.transport_message_id = message.id',
    ) &&
    firstContactMigration.includes('service_mark_stale_refund_gmail_outbound_unknown'),
  'Stale manager replies must become reconciliation work without including first-contact transports',
);
assert(
  outboundBatchMigration.includes("message.status = 'delivery_unknown'") &&
    !outboundBatchMigration.includes("message.status = 'pending_send'") &&
    outboundBatchMigration.includes('attempt_version integer') &&
    outboundBatchMigration.includes(
      'message.reconciliation_attempt_count = message.reconciliation_no_match_version',
    ) &&
    outboundBatchMigration.includes(
      "message.reconciliation_checked_at <= now() - interval '5 minutes'",
    ) &&
    outboundBatchMigration.includes(
      'order by message.reconciliation_checked_at nulls first, message.created_at, message.id',
    ) &&
    outboundBatchMigration.includes(
      'reconciliation_attempt_count = message.reconciliation_attempt_count + 1',
    ) &&
    outboundBatchMigration.includes('claimed.reconciliation_attempt_count'),
  'Generic outbound reconciliation must rotate only after stale work becomes delivery-unknown',
);
assert(
  outboundFinishMigration.includes('p_attempt_version integer') &&
    outboundFinishMigration.includes(
      'message_row.reconciliation_attempt_count <> p_attempt_version',
    ) &&
    outboundFinishMigration.includes(
      "expected_provider_message_header := '<refund-' || safe_operation_key || '@bloomjoyusa.com>'",
    ) &&
    outboundFinishMigration.includes(
      'normalized_provider_message_header is distinct from expected_provider_message_header',
    ) &&
    outboundFinishMigration.includes("message_row.status <> 'delivery_unknown'") &&
    outboundFinishMigration.includes("and status = 'delivery_unknown'") &&
    !outboundFinishMigration.includes("and status in ('pending_send', 'delivery_unknown')"),
  'Only delivery-unknown manager replies may reconcile with exact deterministic Gmail Message-ID evidence',
);
assert(
  outboundCountMigration.includes("message.status = 'delivery_unknown'") &&
    !outboundCountMigration.includes("message.status = 'pending_send'") &&
    outboundCountMigration.includes(
      'first_contact.transport_message_id = message.id',
    ),
  'Only delivery-unknown non-first-contact replies count as reconciliation health debt',
);
assert(
  outboundNoMatchMigration.includes('p_attempt_version integer') &&
    outboundNoMatchMigration.includes(
      'set reconciliation_no_match_version = p_attempt_version',
    ) &&
    outboundNoMatchMigration.includes("message.status = 'delivery_unknown'") &&
    outboundNoMatchMigration.includes(
      'message.reconciliation_attempt_count = p_attempt_version',
    ) &&
    outboundNoMatchMigration.includes(
      'first_contact.transport_message_id = message.id',
    ),
  'A generic no-match receipt must match the current non-first-contact delivery-unknown version',
);
assert(
  firstContactMigration.includes(
    'revoke execute on function public.service_mark_stale_refund_gmail_outbound_unknown(timestamptz)',
  ) &&
    firstContactMigration.includes(
      'revoke execute on function public.service_claim_refund_gmail_outbound_reconciliation_batch(integer)',
    ) &&
    firstContactMigration.includes(
      'revoke execute on function public.service_finish_refund_gmail_outbound_reconciliation(uuid,text,text,integer)',
    ) &&
    firstContactMigration.includes(
      'revoke execute on function public.service_count_refund_gmail_outbound_reconciliation()',
    ) &&
    firstContactMigration.includes(
      'revoke execute on function public.service_finish_refund_gmail_first_contact_no_match(uuid,integer)',
    ) &&
    firstContactMigration.includes(
      'revoke execute on function public.service_finish_refund_gmail_outbound_reconciliation_no_match(uuid,integer)',
    ) &&
    firstContactMigration.includes(
      'grant execute on function public.service_mark_stale_refund_gmail_outbound_unknown(timestamptz)',
    ) &&
    firstContactMigration.includes(
      'grant execute on function public.service_claim_refund_gmail_outbound_reconciliation_batch(integer)',
    ) &&
    firstContactMigration.includes(
      'grant execute on function public.service_finish_refund_gmail_outbound_reconciliation(uuid,text,text,integer)',
    ) &&
    firstContactMigration.includes(
      'grant execute on function public.service_count_refund_gmail_outbound_reconciliation()',
    ) &&
    firstContactMigration.includes(
      'grant execute on function public.service_finish_refund_gmail_first_contact_no_match(uuid,integer)',
    ) &&
    firstContactMigration.includes(
      'grant execute on function public.service_finish_refund_gmail_outbound_reconciliation_no_match(uuid,integer)',
    ),
  'All versioned reconciliation helpers must remain service-role-only',
);
const humanDeliveryResolutionMigration = firstContactMigration.slice(
  firstContactMigration.indexOf(
    'create or replace function public.admin_resolve_refund_gmail_delivery_not_found',
  ),
  firstContactMigration.indexOf(
    'create or replace function public.service_purge_refund_gmail_expired_message_content',
  ),
);
assert(
  humanDeliveryResolutionMigration.includes("coalesce(auth.role(), '') <> 'authenticated'") &&
    humanDeliveryResolutionMigration.includes("message_row.status <> 'delivery_unknown'") &&
    humanDeliveryResolutionMigration.includes(
      'A completed latest-version Gmail no-match check is required before human resolution',
    ) &&
    humanDeliveryResolutionMigration.includes(
      'first_contact_row.reconciliation_no_match_version <>',
    ) &&
    humanDeliveryResolutionMigration.includes(
      'message_row.reconciliation_no_match_version <>',
    ) &&
    humanDeliveryResolutionMigration.includes(
      'public.can_manage_refund_case(actor_id, message_row.refund_case_id)',
    ),
  'Human negative-delivery resolution must require case access and a latest-version automatic no-match receipt',
);
assert(
  humanDeliveryResolutionMigration.includes("error_code = 'human_verified_not_delivered'") &&
    humanDeliveryResolutionMigration.includes("event_type") &&
    humanDeliveryResolutionMigration.includes("'gmail_delivery_verified_not_delivered'") &&
    humanDeliveryResolutionMigration.includes("'payload_redacted', true") &&
    humanDeliveryResolutionMigration.includes("'resolution', 'verified_not_delivered'"),
  'Human negative-delivery resolution must fail the ledger and record a redacted actor audit',
);
assert(
  firstContactMigration.includes(
    'revoke execute on function public.admin_resolve_refund_gmail_delivery_not_found(uuid)',
  ) &&
    firstContactMigration.includes('from public, anon, service_role') &&
    firstContactMigration.includes(
      'grant execute on function public.admin_resolve_refund_gmail_delivery_not_found(uuid)',
    ) &&
    firstContactMigration.includes('to authenticated'),
  'Only authenticated humans may invoke negative-delivery resolution',
);
assert(
  firstContactMigration.includes("operation_row.status = 'delivery_unknown' and normalized_status = 'sent'") &&
    firstContactMigration.includes('expected_provider_message_header'),
  'Only deterministic Gmail Message-ID evidence may reconcile uncertain delivery to sent',
);
assert(
  firstContactMigration.includes("recipient_email = '[Deleted after Gmail retention period]'") &&
    firstContactMigration.includes('expired_case_message_ids'),
  'Gmail retention must also redact linked canonical customer message copies',
);

assert(
  firstContactHelper.includes('REFUND_FIRST_CONTACT_TEMPLATE_KEY = "refund_first_contact_v1"'),
  'The first-contact acknowledgement must use versioned deterministic copy',
);
assert(
  firstContactHelper.includes('REFUND_GMAIL_LEGACY_RESPONDER_DISABLED') &&
    firstContactHelper.includes('REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED') &&
    firstContactHelper.includes('REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED') &&
    firstContactHelper.includes('REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID') &&
    firstContactHelper.includes('REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS'),
  'Send modes must require non-overlapping legacy or isolated-test gates',
);
assert(
  firstContactHelper.includes('ACTIVE_DELIVERY_POLICY_INSTALLED = true') &&
    firstContactHelper.includes('first_contact_active_dependencies_pending'),
  'Active first-contact delivery may be configured only after the integrated participant and manager-CC policy is installed',
);
assert(
  firstContactHelper.includes('If you already submitted a form, there is no need to submit it again.') &&
    !firstContactHelper.includes('forms.gle') &&
    !firstContactHelper.includes('backup refund form') &&
    firstContactHelper.includes('never email complete payment-card details'),
  'First-contact copy must be humble, preserve transitional links, and discourage sensitive-data email',
);
assert(
  !firstContactHelper.includes('/refunds?case='),
  'Customer first-contact copy must not contain the internal case route',
);
const managerContext = migration.slice(migration.indexOf('create or replace function public.admin_get_refund_gmail_case_context'));
assert(
  !managerContext.slice(0, managerContext.indexOf('create or replace function public.get_refund_gmail_health')).includes("'providerThreadId'"),
  'The manager case context must not expose provider thread IDs',
);

assert(gmailHelper.includes('GMAIL_SUPPORT_CLIENT_ID'), 'Gmail client ID must be server-only configuration');
assert(gmailHelper.includes('GMAIL_SUPPORT_REFRESH_TOKEN'), 'Gmail refresh token must be server-only configuration');
assert(gmailHelper.includes('GMAIL_SUPPORT_MAILBOX'), 'The designated mailbox must be explicit');
assert(
  gmailHelper.includes('GMAIL_SUPPORT_SEND_AS_ALIASES') &&
    gmailHelper.includes('isRefundGmailMailboxIdentity'),
  'Configured Gmail send-as aliases must be treated as mailbox-origin identities',
);
assert(gmailHelper.includes('GMAIL_REFUND_LABEL_ID'), 'The refund label ID must be explicit');
assert(gmailHelper.includes('labelIds: config.labelId'), 'Only labeled Gmail threads may be listed');
assert(gmailHelper.includes('verifyRefundGmailMailbox'), 'The authenticated mailbox must be verified');
assert(gmailHelper.includes('redactPaymentCardNumbers'), 'Inbound possible card numbers must be redacted');
assert(gmailHelper.includes('containsPaymentCardNumber'), 'Outbound full card numbers must be rejected');
assert(
  gmailHelper.includes('isRefundGmailAutomatedMessage') &&
    gmailHelper.includes('List-Id') && gmailHelper.includes('List-Unsubscribe'),
  'Automated responders and list mail must be excluded before first-contact eligibility',
);
assert(!gmailHelper.includes('/messages/modify'), 'The integration must not modify Gmail message state');
assert(!gmailHelper.includes('/trash'), 'The integration must not trash Gmail messages');
assert(!gmailHelper.includes('/delete'), 'The integration must not delete Gmail messages');
assert(gmailHelper.includes('/messages/send'), 'Manager-approved replies must use Gmail send');
assert(
  gmailHelper.includes('Auto-Submitted: auto-generated') &&
    gmailHelper.includes('X-Auto-Response-Suppress: All'),
  'Automatic Gmail replies must carry loop-suppression headers',
);
assert(
  gmailHelper.includes('findRefundGmailReplyByMessageHeader') &&
    gmailHelper.includes('rfc822msgid:'),
  'Uncertain sends must reconcile through the deterministic Gmail Message-ID',
);
assert(
  gmailHelper.includes('inspectRefundGmailReplyByMessageHeader') &&
    gmailHelper.includes('if (response.nextPageToken) return { status: "ambiguous" as const }') &&
    gmailHelper.includes('if (messages.length === 0)') &&
    gmailHelper.includes('return { status: "no_match" as const }') &&
    gmailHelper.includes('return { status: "ambiguous" as const }'),
  'Only a complete zero-result Gmail search may be classified as no-match; pagination or non-exact results stay ambiguous',
);
assert(
  gmailHelper.includes('parseRefundGmailSuccessResponse') &&
    gmailHelper.includes('"gmail_response_invalid"') &&
    gmailHelper.includes('init.method === "POST"'),
  'Invalid Gmail POST success payloads must be classified as delivery-uncertain',
);
assert(gmailHelper.includes('GMAIL_SUPPORT_SEND_AS_ALIASES'), 'Approved mailbox aliases must be explicit server configuration');
assert(
  gmailHelper.includes('providerSentEvidence') && gmailHelper.includes('labelIds') && gmailHelper.includes('"SENT"'),
  'Mailbox aliases must require Gmail Sent-label evidence rather than trusting the From header',
);
assert(
  gmailHelper.includes('message/delivery-status') &&
    gmailHelper.includes('hasAuthenticatedDeliveryReporter') &&
    gmailHelper.includes('failedRecipientEmails') &&
    gmailHelper.includes('isHardBounce'),
  'Hard-bounce detection must require trustworthy DSN evidence and extract failed recipients',
);
assert(gmailHelper.includes('Cc: ${safeCc.join(", ")}'), 'Gmail MIME must support visible mapped-manager CC');
assert(
  gmailHelper.includes('normalizedCc.length === 0'),
  'The low-level refund Gmail sender must reject a customer message with no manager CC',
);
assert(gmailHelper.includes('threadId: providerThreadId'), 'Gmail sends must pin the original provider thread');
assert(gmailHelper.includes('internal_case_link_blocked'), 'Customer-visible Gmail must reject internal case links');
const lowLevelGmailSender = gmailHelper.slice(
  gmailHelper.indexOf('export const sendRefundGmailReply'),
  gmailHelper.indexOf('export const findRefundGmailReplyByMessageHeader'),
);
assert(
  gmailHelper.includes('REFUND_GMAIL_DISABLED_CODE = "gmail_integration_disabled"') &&
    gmailHelper.includes('REFUND_GMAIL_DISABLED_MESSAGE = "Gmail delivery is disabled."') &&
    lowLevelGmailSender.indexOf('requireRefundGmailEnabled();') >= 0 &&
    lowLevelGmailSender.indexOf('requireRefundGmailEnabled();') <
      lowLevelGmailSender.indexOf('await gmailRequest<{ id?: string; threadId?: string }>'),
  'The low-level Gmail sender must fail with one redacted disabled error before OAuth or provider access',
);

assert(
  syncFunction.includes('refundGmailEnabled') && gmailHelper.includes('Deno.env.get("REFUND_GMAIL_ENABLED")'),
  'Server-side Gmail enable flag must use the shared default-closed parser',
);
assert(syncFunction.includes('REFUND_GMAIL_SYNC_SECRET'), 'Scheduled Gmail sync must authenticate independently');
assert(
  syncFunction.includes('REFUND_GMAIL_SCHEDULER_SECRET') &&
    syncFunction.includes('trigger === "scheduler_recovery"'),
  'Independent recovery must use a dedicated Edge secret bound to its exact trigger',
);
assert(
  retentionHelper.includes('scheduler_recovery: /^supabase-recovery:') &&
    schedulerMigration.includes("when 'scheduler_recovery'") &&
    schedulerMigration.includes("'scheduler_recovery'"),
  'Recovery dispatches must use one trigger-bound, timestamp-only idempotency key',
);
assert(
  schedulerMigration.includes('enabled boolean not null default false') &&
    schedulerMigration.includes("'*/5 * * * *'") &&
    schedulerMigration.includes("interval '20 minutes'") &&
    schedulerMigration.includes("interval '30 minutes'"),
  'The independent five-minute watchdog must default off and recover before the 30-minute health limit',
);
assert(
  schedulerMigration.includes('vault.decrypted_secrets') &&
    schedulerMigration.includes("name = 'refund_gmail_scheduler_url'") &&
    schedulerMigration.includes("name = 'refund_gmail_scheduler_secret'") &&
    schedulerMigration.includes("'payloadRedacted', true"),
  'The watchdog must use exact named Vault secrets and return only redacted health',
);
assert(
  schedulerMigration.includes('pg_try_advisory_xact_lock(628, 1009)') &&
    schedulerMigration.includes('on conflict (bucket_at) do nothing') &&
    schedulerMigration.includes("state_row.last_attempt_at >= clock_timestamp() - interval '10 minutes'"),
  'Concurrent, replayed, or recently attempted recovery dispatches must suppress safely',
);
assert(
  schedulerMigration.includes('revoke all on table public.refund_gmail_scheduler_settings') &&
    schedulerMigration.includes('revoke all on table public.refund_gmail_scheduler_dispatches') &&
    schedulerMigration.includes('revoke execute on function public.service_dispatch_refund_gmail_scheduler_watchdog()') &&
    !schedulerMigration.includes('nayax-card-refund'),
  'Browser roles and the recovery scheduler must have no provider/refund execution path',
);
assert(
  ui.includes('Email intake catching up') &&
    ui.includes('refetchInterval: 15_000') &&
    client.includes("| 'recovering'") &&
    client.includes('schedulerLastDispatchAt'),
  'Managers must see a clear recovery state without raw scheduler evidence',
);
assert(syncFunction.includes('failure_test'), 'A PII-free Gmail failure test must exist');
assert(
  syncFunction.includes('triggerSource === "failure_test" ||'),
  'The PII-free failure test must run without enabling real Gmail access',
);
assert(syncFunction.includes('collectAttachmentDescriptors'), 'Attachment type, extension, size, and count must be checked');
assert(
  syncFunction.includes('service_reserve_refund_gmail_attachment_upload') &&
    syncFunction.includes('isRefundGmailQuarantineStorageTarget'),
  'Permitted attachments must use a DB-derived private quarantine target',
);
assert(syncFunction.includes('payloadRedacted: true'), 'Gmail logs and responses must be aggregate-only');
const ordinaryPreSyncStart = syncFunction.indexOf(
  'if (triggerSource !== "failure_test" && !intakeShadow)',
);
const intakeShadowCopyAuthorization = syncFunction.indexOf(
  'preflight: authorizeRefundGmailIntakeShadowDatabase',
);
const resolvedGmailConfig = syncFunction.indexOf('let config = baseConfig && intakeShadow');
const intakeShadowStartBoundary = syncFunction.indexOf(
  'await startRefundGmailIntakeShadowDatabaseBoundary({',
);
const intakeShadowProviderAccess = syncFunction.indexOf(
  'const preflight = await preflightRefundGmailIntakeShadowLabel({ config })',
  intakeShadowStartBoundary,
);
assert(
  ordinaryPreSyncStart >= 0 &&
    syncFunction.indexOf('const summary = await runRetentionSweep({', ordinaryPreSyncStart) <
      syncFunction.indexOf('await authorizeNewGmailCopies()', ordinaryPreSyncStart) &&
    syncFunction.indexOf('await authorizeNewGmailCopies()') <
      resolvedGmailConfig &&
    resolvedGmailConfig >= 0 &&
    resolvedGmailConfig < intakeShadowStartBoundary &&
    intakeShadowStartBoundary < intakeShadowCopyAuthorization &&
    intakeShadowCopyAuthorization < intakeShadowProviderAccess,
  'Ordinary retention must precede configuration, while intake authorization consumption and narrow DB preflight must precede Gmail OAuth access',
);
assert(
  syncFunction.includes('triggerSource === "retention"') &&
    syncFunction.includes('triggerSource: "retention"') &&
    syncFunction.includes('retentionOnly: true'),
  'Retention-only cleanup must be callable without the provider sync path',
);
assert(
  syncFunction.indexOf('service_reserve_refund_gmail_attachment_upload') <
      syncFunction.indexOf('.upload(storagePath, attachment.bytes') &&
    syncFunction.indexOf('.upload(storagePath, attachment.bytes') <
      syncFunction.indexOf('service_settle_refund_gmail_attachment_upload') &&
    syncFunction.includes('p_outcome: "upload_unknown"') &&
    !syncFunction.includes('service_mark_refund_gmail_attachment'),
  'A durable tokenized upload intent must exist before Storage transport and uncertain outcomes must retain it',
);
assert(
  syncFunction.includes('service_claim_refund_gmail_retention_run') &&
    syncFunction.includes('service_claim_refund_gmail_retention_attachment') &&
    syncFunction.includes('service_settle_refund_gmail_retention_attachment') &&
    syncFunction.includes('service_purge_refund_gmail_retention_content') &&
    syncFunction.includes('service_settle_refund_gmail_retention_run') &&
    syncFunction.includes('service_abandon_refund_gmail_retention_run') &&
    !syncFunction.includes('service_list_refund_gmail_expired_attachments') &&
    !syncFunction.includes('service_purge_refund_gmail_expired_message_content'),
  'Retention must use the durable claim/settle boundary and reject the legacy unclaimed deletion path',
);
assert(
  syncFunction.includes('classifyRefundGmailStorageDelete') &&
    syncFunction.includes('outcome = "delete_unknown"') &&
    syncFunction.indexOf('p_outcome: outcome') <
      syncFunction.indexOf('service_purge_refund_gmail_retention_content'),
  'Storage bytes must have a known per-item outcome before copied metadata can purge',
);
assert(
  syncFunction.includes('processFirstContact') &&
    syncFunction.includes('service_claim_refund_gmail_contact_first_response') &&
    syncFunction.includes('service_register_refund_gmail_contact_link') &&
    syncFunction.includes('service_prepare_refund_gmail_contact_first_response') &&
    syncFunction.includes('ccEmails: []') &&
    syncFunction.includes('deliveryKind: "automatic"') &&
    syncFunction.indexOf('service_prepare_refund_gmail_contact_first_response') <
      syncFunction.indexOf('sent = await sendRefundGmailReply'),
  'Gmail sync must claim one private pre-form contact link and deliver the no-CC response on the original thread',
);
assert(
  formOnlyMigration.includes('create table if not exists public.refund_gmail_intake_contacts') &&
    formOnlyMigration.includes('contact_alone_created_case') &&
    formOnlyMigration.includes('service_create_refund_case_from_gmail_contact_form') &&
    formOnlyMigration.includes("intake_source, intake_meta") &&
    intakeFunction.includes('service_create_refund_case_from_gmail_contact_form') &&
    !syncFunction.includes('"service_ingest_refund_gmail_message_v2",\n                {'),
  'Normal Gmail contact must stay outside refund_cases until the hosted Bloomjoy form creates one case',
);
assert(
  pilotLinkageMigration.includes('service_prepare_refund_gmail_first_contact_delivery') &&
    pilotLinkageMigration.includes("source_row.participant_role <> 'customer'") &&
    pilotLinkageMigration.includes("source_row.participant_trust <> 'verified'") &&
    pilotLinkageMigration.includes('automatic_customer_contact_paused_at is not null') &&
    pilotLinkageMigration.includes("recipient_cc_emails = '{}'::text[]") &&
    pilotLinkageMigration.includes("recipient_resolution_status = 'premapping_acknowledgement'") &&
    pilotLinkageMigration.includes('service_link_refund_gmail_draft_from_hosted_form') &&
    pilotLinkageMigration.includes('to service_role'),
  'First-contact preparation must preserve verified-customer and pause gates while limiting the sole pre-mapping exception to a private hosted-form link with no CC',
);
assert(
  syncFunction.includes('ingestRefundGmailThreadBeforeFirstContact') &&
    syncFunction.indexOf('ingestMessage: async') < syncFunction.indexOf('processFirstContact: async'),
  'Gmail sync must ingest the complete fetched thread before deciding first contact',
);
assert(
  syncFunction.includes('service_claim_refund_gmail_first_contact_reconciliation_batch') &&
    syncFunction.includes('service_count_refund_gmail_first_contact_reconciliation') &&
    syncFunction.includes('service_claim_refund_gmail_contact_reconciliation_batch') &&
    syncFunction.includes('service_count_refund_gmail_contact_response_reconciliation') &&
    syncFunction.indexOf('await reconcileOutstandingFirstContacts') <
      syncFunction.indexOf('while (counters.threadsScanned < maxThreads)'),
  'Outstanding first-contact delivery must rotate and reconcile independently of new-send mode and sender eligibility',
);
assert(
  formOnlyMigration.includes('service_purge_refund_gmail_intake_contacts') &&
    formOnlyMigration.includes("retention_expires_at = clock_timestamp()") &&
    syncFunction.includes('service_purge_refund_gmail_intake_contacts') &&
    syncFunction.indexOf('service_purge_refund_gmail_intake_contacts') <
      syncFunction.indexOf('service_settle_refund_gmail_retention_run'),
  'Private pre-form contact copies must join the independently gated Gmail retention run',
);
const firstContactReconciliationSync = syncFunction.slice(
  syncFunction.indexOf('const reconcileOutstandingFirstContacts'),
  syncFunction.indexOf('const reconcileOutstandingOutbound'),
);
const outboundReconciliationSync = syncFunction.slice(
  syncFunction.indexOf('const reconcileOutstandingOutbound'),
  syncFunction.indexOf('const processFirstContact'),
);
const firstContactNoMatchBranch = firstContactReconciliationSync.indexOf(
  'if (providerResult.status === "no_match")',
);
const firstContactNoMatchReceipt = firstContactReconciliationSync.indexOf(
  'service_finish_refund_gmail_first_contact_no_match',
);
const firstContactAmbiguousBranch = firstContactReconciliationSync.indexOf(
  'if (providerResult.status === "ambiguous")',
);
const firstContactProviderCatch = firstContactReconciliationSync.indexOf(
  '} catch {',
  firstContactAmbiguousBranch,
);
assert(
  syncFunction.includes('attempt_version?: number') &&
    firstContactReconciliationSync.includes('const attemptVersion = Number(row.attempt_version)') &&
    firstContactReconciliationSync.includes('Number.isInteger(attemptVersion)') &&
    firstContactNoMatchBranch >= 0 &&
    firstContactNoMatchBranch < firstContactNoMatchReceipt &&
    firstContactNoMatchReceipt < firstContactAmbiguousBranch &&
    firstContactReconciliationSync.includes('p_attempt_version: attemptVersion') &&
    firstContactAmbiguousBranch < firstContactProviderCatch &&
    !firstContactReconciliationSync.slice(firstContactProviderCatch).includes(
      'service_finish_refund_gmail_first_contact_no_match',
    ),
  'First-contact sync may mint a versioned receipt only in the explicit no-match branch, never for ambiguity or provider errors',
);
assert(
  formOnlyTest.includes('Customer contact creates zero refund cases') &&
    formOnlyTest.includes('Submitting the hosted form creates exactly one refund case') &&
    formOnlyTest.includes('A consumed email context cannot create a second case') &&
    formOnlyTest.includes('The original inbound message and sent response move to the new case thread'),
  'The form-only database fixture must prove zero cases on contact, one case on submit, replay safety, and original-thread linkage',
);
assert(
  syncFunction.includes('counters.firstContactReconciliationOutstanding === 0') &&
    syncFunction.includes('gmail_first_contact_reconciliation_required') &&
    syncFunction.includes('delivery_reconciliation'),
  'Unresolved first-contact delivery must keep Gmail health failed until reconciliation completes',
);
assert(
  syncFunction.includes('service_mark_stale_refund_gmail_outbound_unknown') &&
    syncFunction.includes('service_claim_refund_gmail_outbound_reconciliation_batch') &&
    syncFunction.includes('service_finish_refund_gmail_outbound_reconciliation') &&
    syncFunction.includes('service_count_refund_gmail_outbound_reconciliation') &&
    syncFunction.indexOf('await reconcileOutstandingOutbound') <
      syncFunction.indexOf('while (counters.threadsScanned < maxThreads)'),
  'Gmail sync must reconcile generic manager replies before scanning for new customer work',
);
const outboundNoMatchBranch = outboundReconciliationSync.indexOf(
  'if (providerResult.status === "no_match")',
);
const outboundNoMatchReceipt = outboundReconciliationSync.indexOf(
  'service_finish_refund_gmail_outbound_reconciliation_no_match',
);
const outboundAmbiguousBranch = outboundReconciliationSync.indexOf(
  'if (providerResult.status === "ambiguous")',
);
const outboundProviderCatch = outboundReconciliationSync.indexOf(
  '} catch {',
  outboundAmbiguousBranch,
);
assert(
  syncFunction.includes('attempt_version?: number') &&
    outboundReconciliationSync.includes('const attemptVersion = Number(row.attempt_version)') &&
    outboundReconciliationSync.includes('Number.isInteger(attemptVersion)') &&
    outboundNoMatchBranch >= 0 &&
    outboundNoMatchBranch < outboundNoMatchReceipt &&
    outboundNoMatchReceipt < outboundAmbiguousBranch &&
    outboundReconciliationSync.includes('p_attempt_version: attemptVersion') &&
    outboundAmbiguousBranch < outboundProviderCatch &&
    !outboundReconciliationSync.slice(outboundProviderCatch).includes(
      'service_finish_refund_gmail_outbound_reconciliation_no_match',
    ),
  'Manager-reply sync may mint a versioned receipt only for an explicit no-match, never ambiguity or provider errors',
);
assert(
  syncFunction.includes('outboundReconciled') &&
    syncFunction.includes('outboundReconciliationFailed') &&
    syncFunction.includes('outboundReconciliationOutstanding') &&
    syncFunction.includes('counters.outboundReconciliationOutstanding === 0') &&
    syncFunction.includes('gmail_outbound_delivery_reconciliation_required') &&
    syncFunction.includes('gmail_outbound_reconciliation_failed') &&
    syncFunction.includes('delivery_reconciliation'),
  'Generic reconciliation counters and outstanding work must keep Gmail health degraded',
);
assert(
  syncFunction.includes('threadHasOutbound') &&
    syncFunction.includes('p_thread_has_outbound: threadHasOutbound'),
  'Fetched legacy or manual mailbox replies must suppress a new automatic acknowledgement',
);
assert(
  syncFunction.includes('mailboxOrigin && providerSentEvidence') &&
    syncFunction.indexOf('mailboxOrigin && providerSentEvidence') <
      syncFunction.indexOf(': isAutomated'),
  'Only provider-SENT messages from the mailbox or configured aliases may become outbound evidence',
);
assert(
  syncFunction.includes('firstContact.mode === "blocked"') &&
    syncFunction.includes('counters.firstContactFailed += 1') &&
    syncFunction.includes('counters.messagesFailed += 1'),
  'Unsafe first-contact configuration must block sending without blocking safe Gmail intake',
);
assert(
  !syncFunction.includes('console.log(message)') && !syncFunction.includes('console.error(error)'),
  'Raw messages and provider errors must not be logged',
);

assert(gmailTransport.includes('dispatchRefundCaseGmailReply'), 'Case-aware Gmail transport must exist');
const transportKillSwitchCall = gmailTransport.indexOf('requireRefundGmailEnabled();');
assert(
  transportKillSwitchCall > gmailTransport.indexOf('if (!link)') &&
    transportKillSwitchCall < gmailTransport.indexOf('service_claim_refund_gmail_outbound_v3'),
  'The shared Gmail-only transport must preserve the non-Gmail route and stop before any Gmail delivery claim',
);
const firstContactProcess = syncFunction.slice(
  syncFunction.indexOf('const processFirstContact'),
  syncFunction.indexOf('const sendGmailCaseActionNotice'),
);
assert(
  firstContactProcess.indexOf('requireRefundGmailEnabled();') >= 0 &&
    firstContactProcess.indexOf('requireRefundGmailEnabled();') <
      firstContactProcess.indexOf('service_claim_refund_gmail_contact_first_response') &&
    firstContactProcess.includes('claimRefundGmailDeliveryWhenEnabled'),
  'First-contact send mode must obey the same Gmail switch before creating its delivery claim',
);
assert(
  transportTest.includes('assertEquals(claimCalls, 0)') &&
    transportTest.includes('assertEquals(firstContactClaimCalls, 0)') &&
    transportTest.includes('assertEquals(fetchCalls, 0)') &&
    transportTest.includes('deliveryKind: "manual"') &&
    transportTest.includes('assertEquals(caught.code, "automatic_contact_disabled")') &&
    transportTest.includes('assertEquals(providerRequest.threadId, providerThreadId)') &&
    transportTest.includes('assertEquals(result.managerCcCount, 2)') &&
    transportTest.includes('assert(!mime.includes("/refunds?case="))'),
  'Synthetic transport evidence must cover disabled zero-call shutdown and enabled two-manager original-thread MIME',
);
assert(
  firstContactCcTest.includes('first-contact-manager-a@example.test') &&
    firstContactCcTest.includes('first-contact-manager-b@example.test') &&
    firstContactCcTest.includes('service_register_refund_gmail_intake_link') &&
    firstContactCcTest.includes('service_link_refund_gmail_draft_from_hosted_form') &&
    firstContactCcTest.includes("'premapping_acknowledgement'") &&
    firstContactCcTest.includes('service_finish_refund_gmail_first_contact') &&
    firstContactCcTest.includes('operation_already_exists') &&
    firstContactCcTest.includes('later_thread_message') &&
    firstContactCcTest.includes('exactly one case, thread, acknowledgement operation, and sent outbound message'),
  'The database fixture must prove one no-CC pre-mapping acknowledgement, one linked Gmail case, and no replay or later-reply duplicate',
);
assert(
  packageJson.includes('"refunds:evidence-gmail"') &&
    packageJson.includes('generate-refund-gmail-evidence.ts') &&
    packageJson.includes('--allow-write') &&
    evidenceHarness.includes('refund-gmail-kill-fragment.json') &&
    !evidenceHarness.includes('refund-kill-switches.json'),
  'Evidence generation must use the dedicated executable Deno harness',
);
const executableFirstContactHarness = evidenceHarness.slice(
  evidenceHarness.indexOf('const runFirstContactMimeAssertions'),
  evidenceHarness.indexOf('const collectStringValues'),
);
assert(
  executableFirstContactHarness.includes('service_claim_refund_gmail_first_contact') &&
    executableFirstContactHarness.includes('service_register_refund_gmail_intake_link') &&
    executableFirstContactHarness.includes('service_prepare_refund_gmail_first_contact_delivery') &&
    executableFirstContactHarness.includes('service_finish_refund_gmail_first_contact') &&
    !executableFirstContactHarness.includes('service_claim_refund_gmail_outbound_v3') &&
    executableFirstContactHarness.includes('FIRST_CONTACT_FIXTURE.providerThreadId') &&
    evidenceHarness.includes('assertSqlFixtureAlignment') &&
    executableFirstContactHarness.includes('operation_already_exists') &&
    executableFirstContactHarness.includes('later_thread_message'),
  'The executable MIME harness must correlate one SQL-aligned first-contact claim, prepare, send, finalize, replay, and later reply',
);
assert(
  evidenceHarness.includes('firstContactManagerCcCount: ccRecipients.length') &&
    evidenceHarness.includes('caseSpecificManagerCcCount: caseSpecificCcRecipients.length') &&
    evidenceHarness.includes('partialManagerRouteRejected,') &&
    evidenceHarness.includes('status: "resolved_with_exclusions"') &&
    evidenceHarness.includes('error.code === "manager_cc_required"') &&
    evidenceHarness.includes('replyHeadersPresent,') &&
    evidenceHarness.includes('automaticHeadersPresent,') &&
    evidenceHarness.includes('internalLinkCount,') &&
    evidenceHarness.includes('providerSendCount,') &&
    evidenceHarness.includes('caseSpecificOutboundCount: caseSpecificProviderSendCount') &&
    evidenceHarness.includes('duplicateMessageCount,') &&
    evidenceHarness.includes('assertEquals(providerSendCount, 2)') &&
    evidenceHarness.includes('assertEquals(firstContactProviderSendCount, 1)') &&
    evidenceHarness.includes('assertEquals(caseSpecificProviderSendCount, 1)') &&
    evidenceHarness.includes('assertEquals(duplicateMessageCount, 0)'),
  'The MIME artifact must separately prove the no-CC pre-mapping acknowledgement and the mapped-manager case-specific reply',
);
assert(
  evidenceHarness.includes('deliveryClaimCount += 1') &&
    evidenceHarness.includes('firstContactClaimCount += 1') &&
    evidenceHarness.includes('providerFetchCount += 1') &&
    evidenceHarness.includes('providerSendCount += 1') &&
    evidenceHarness.includes('assertEquals(deliveryClaimCount, 0)') &&
    evidenceHarness.includes('assertEquals(firstContactClaimCount, 0)') &&
    evidenceHarness.includes('assertEquals(providerFetchCount, 0)') &&
    evidenceHarness.includes('managerAging: false') &&
    evidenceHarness.includes('requiresIntegrationAggregation: true') &&
    !evidenceHarness.includes('intakeAvailable: true') &&
    !evidenceHarness.includes('portalAvailable: true'),
  'Kill-switch evidence must use executable counters and declare aging/intake/portal as integration-only coverage',
);
const evidenceAssertionCall = evidenceHarness.indexOf('await runRefundGmailEvidenceHarness();');
const firstEvidenceWrite = evidenceHarness.indexOf('await Deno.writeTextFile(');
const evidenceSanitization = evidenceHarness.indexOf(
  'assertEvidenceIsSanitized(mimeRoleAssertions);',
);
const passedMarker = evidenceHarness.indexOf(
  'mimeRoleEvidence: { ...mimeRoleAssertions, passed: true }',
);
assert(
  evidenceAssertionCall >= 0 &&
    firstEvidenceWrite > evidenceAssertionCall &&
    evidenceHarness.includes('assertEvidenceIsSanitized(killSwitchAssertions)') &&
    evidenceSanitization >= 0 &&
    passedMarker > evidenceSanitization &&
    evidenceHarness.includes('{ createNew: true }'),
  'No Gmail evidence file may be written until every executable and sanitization assertion passes',
);
assert(sendFunction.includes('dispatchRefundCaseGmailReply'), 'Manual portal replies must use linked Gmail threads');
assert(adminUpdate.includes('dispatchRefundCaseGmailReply'), 'Status-action replies must use linked Gmail threads');
assert(
  gmailTransport.includes('refund_gmail_delivery_reconciliation_required') &&
    gmailTransport.includes('gmail_delivery_reconciliation_required') &&
    gmailTransport.includes('claim.status === "pending_send" || claim.status === "delivery_unknown"'),
  'The shared Gmail transport must preserve the database duplicate-send block for every portal path',
);
assert(
  gmailHelper.includes('REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE') &&
    gmailHelper.includes('Gmail delivery could not be confirmed. Check the original thread before retrying.') &&
    sendFunction.includes('REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE') &&
    adminUpdate.includes('REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE'),
  'Every customer-send endpoint must share the same reconciliation-required uncertainty state',
);
assert(
  ui.includes('isRefundCustomerDeliveryUncertain') &&
    ui.includes("normalized.includes('delivery could not be confirmed')") &&
    ui.includes("label: 'Resolve uncertain Gmail delivery'") &&
    ui.includes("mode: 'resolve_delivery_not_found'") &&
    ui.includes("latestMessage.messageType === 'confirmation'") &&
    ui.includes("messageType: 'status_update'"),
  'Portal recovery must separate uncertain delivery resolution from retrying a known failure',
);
assert(
    client.includes('resolveRefundGmailDeliveryNotFound') &&
    client.includes('admin_resolve_refund_gmail_delivery_not_found') &&
    client.includes('Run Gmail sync until the latest check completes with no matching message') &&
    ui.includes('customerDeliveryNeedsReconciliation') &&
    ui.includes('Gmail delivery is uncertain. Check the original Gmail thread before sending anything else.') &&
    ui.includes('refund-gmail-not-delivered-dialog') &&
    ui.includes('refund-gmail-confirm-not-delivered') &&
    ui.includes('I checked; no message was sent'),
  'The portal must block all replies until an explicit audited not-delivered confirmation succeeds',
);
assert(
  automationSweep.includes('dispatchRefundCaseGmailReply') &&
    automationSweep.includes('deliveryKind: "automatic"'),
  'Scheduled Gmail-linked customer mail must stay in the original thread and obey automatic-contact pauses',
);
assert(
  syncFunction.includes('p_provider_sent: providerSentEvidence') &&
    syncFunction.includes('p_is_hard_bounce: isHardBounce') &&
    syncFunction.includes('p_failed_recipient_emails:') &&
    syncFunction.includes('participantSignals.failedRecipientEmails'),
  'Gmail sync must pass provider Sent proof and DSN recipient proof into participant-safe ingestion',
);
assert(
  sendFunction.includes('deliveryUncertain') &&
    sendFunction.includes('REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE'),
  'Uncertain Gmail sends must stop automatic retry and tell the manager what to check',
);

assert(workflow.includes('vars.REFUND_GMAIL_SYNC_ENABLED'), 'Scheduled Gmail sync must be disabled by default');
assert(
  workflow.includes('vars.REFUND_GMAIL_RETENTION_ENABLED') &&
    workflow.includes('vars.REFUND_GMAIL_SYNC_ENABLED !=') &&
    workflow.includes('\\"trigger\\":\\"retention\\"') &&
    workflow.includes('github.run_attempt') &&
    workflow.includes('RUN_KEY="github-${KEY_TRIGGER}:') &&
    workflow.includes('RUN_KEY="github-retention:'),
  'A default-off independent retention job must remain retry-safe while provider sync is disabled',
);
assert(workflow.includes('secrets.REFUND_GMAIL_SYNC_URL'), 'Gmail sync URL must be encrypted');
assert(workflow.includes('secrets.REFUND_GMAIL_SYNC_TOKEN'), 'Gmail sync token must be encrypted');
assert(workflow.includes('cancel-in-progress: false'), 'A running Gmail sync must not be cancelled mid-delivery');

assert(client.includes('admin_get_refund_gmail_draft_cases'), 'Gmail draft cases must join the manager queue');
assert(client.includes('admin_get_refund_gmail_case_context'), 'Managers must be able to load safe thread context');
assert(
  client.includes('admin_recover_refund_gmail_customer_contact') &&
    client.includes("p_confirmation: 'customer_address_verified'"),
  'The portal must use the explicit manager recovery boundary after customer-address verification',
);
assert(client.includes('get_refund_gmail_health'), 'Managers must be able to see Gmail sync health');
assert(ui.includes('refund-gmail-draft-workbench'), 'Gmail draft cases need a simple dedicated workbench');
assert(ui.includes('refund-gmail-ask-for-details'), 'Gmail draft workbench needs one clear reply action');
assert(ui.includes('refund-gmail-thread'), 'The safe Gmail conversation must appear with case history');
assert(ui.includes('refund-gmail-health'), 'Gmail sync failures must be visible to managers');
assert(preflight.includes('VITE_GMAIL_'), 'Gmail preflight must reject browser-exposed secret names');
assert(preflight.includes("'REFUND_GMAIL_ENABLED'"), 'Gmail preflight must verify the server enable switch');

assert(
  retentionMigration.includes('add column if not exists copied_at timestamptz') &&
    retentionMigration.includes('preserve_refund_gmail_copied_at') &&
    retentionMigration.includes('make_interval(days => run_row.retention_days)'),
  'Retention eligibility must use a database-trusted immutable local copied timestamp',
);
for (const table of [
  'refund_gmail_retention_settings',
  'refund_gmail_retention_runs',
  'refund_gmail_quarantine_upload_intents',
  'refund_gmail_retention_actions',
  'refund_gmail_retention_state',
]) {
  assert(retentionMigration.includes(`create table if not exists public.${table}`), `${table} must exist`);
  assert(
    retentionMigration.includes(`alter table public.${table} enable row level security`),
    `${table} must use RLS`,
  );
  assert(
    retentionMigration.includes(`revoke all on table public.${table} from public, anon, authenticated, service_role`),
    `${table} must be inaccessible outside guarded service RPCs`,
  );
}
assert(
  retentionMigration.includes("cleanup_enabled boolean not null default false") &&
    retentionMigration.includes('approved_retention_days integer') &&
    retentionMigration.includes('owner_approved_at timestamptz') &&
    retentionMigration.includes('attachment_quarantine_approved boolean not null default false'),
  'Retention duration and attachment safety policy must remain owner-unapproved and default off',
);
assert(
  retentionMigration.includes('refund_gmail_workflow_run_key_is_valid') &&
    retentionMigration.includes('refund_gmail_retention_run_key_is_valid') &&
    retentionMigration.includes("'^github-scheduled:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'") &&
    retentionMigration.includes("'^retention:github-retention:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'") &&
    retentionMigration.includes("'^pre-sync:github-(scheduled|manual):") &&
    syncFunction.includes('isRefundGmailWorkflowRunKey') &&
    !retentionMigration.includes("left(btrim(coalesce(p_run_key"),
  'Edge and SQL run keys must bind numeric GitHub run/attempt values to the exact trigger',
);
const syncRunKeyConstraintBlock = retentionMigration.slice(
  retentionMigration.indexOf('drop constraint if exists refund_gmail_sync_runs_trigger_key_check'),
  retentionMigration.indexOf('create or replace function public.service_start_refund_gmail_sync'),
);
assert(
  syncRunKeyConstraintBlock.includes('add constraint refund_gmail_sync_runs_trigger_key_check') &&
    !syncRunKeyConstraintBlock.includes('not valid'),
  'Exact trigger-bound sync run keys must be validated against every legacy ledger row',
);
assert(
  retentionMigration.includes("settings_row.policy_version,") &&
    !retentionMigration.includes("coalesce(nullif(normalized_policy, ''), settings_row.policy_version)"),
  'A policy mismatch may persist only the configured policy version and a redacted code',
);
assert(
  retentionMigration.includes("action.status = 'manual_review'") &&
    retentionMigration.includes("action.status = 'delete_failed'") &&
    retentionMigration.includes("when global_manual_count > 0 then 'manual_review'") &&
    retentionMigration.includes("when global_retry_count > 0 then 'retry_required'"),
  'Older unresolved outcomes must remain durable in global cleanup health and block a false healthy state',
);
const retentionAuthorizeBlock = retentionMigration.slice(
  retentionMigration.indexOf('create or replace function public.service_authorize_refund_gmail_copy'),
  retentionMigration.indexOf('create or replace function public.service_get_refund_gmail_retention_health'),
);
assert(
  attachmentOffCopyGateMigration.includes('p_attachments_enabled boolean') &&
    attachmentOffCopyGateMigration.includes('approved_retention_days = 180') &&
    attachmentOffCopyGateMigration.includes('owner_approved_at = coalesce(owner_approved_at, clock_timestamp())') &&
    attachmentOffCopyGateMigration.includes('attachment_quarantine_approved = false') &&
    attachmentOffCopyGateMigration.includes('coalesce(p_attachments_enabled, false) and (') &&
    attachmentOffCopyGateMigration.includes(
      'revoke execute on function public.service_authorize_refund_gmail_copy(boolean,text,boolean,text)',
    ) &&
    syncFunction.includes('p_attachments_enabled: refundEmailPilotAttachmentsEnabled'),
  'The attachment-free pilot may copy sanitized text without fake scanner approval, while attachment-capable copying remains gated',
);
const retentionHealthBlock = retentionMigration.slice(
  retentionMigration.indexOf('create or replace function public.service_get_refund_gmail_retention_health'),
  retentionMigration.indexOf('-- Disable the legacy unclaimed cleanup surface'),
);
assert(
  !retentionAuthorizeBlock.includes('\nstable\n') &&
    !retentionHealthBlock.includes('\nstable\n'),
  'Clock- and global-state retention health gates must not be declared STABLE',
);
assert(
  retentionMigration.includes('service_record_refund_gmail_attachment_not_uploaded') &&
    retentionMigration.includes('service_reserve_refund_gmail_attachment_upload') &&
    retentionMigration.includes('service_settle_refund_gmail_attachment_upload') &&
    retentionMigration.includes("'legacy_upload_state_unknown'") &&
    retentionMigration.includes('refund_gmail_quarantine_upload_intents_target_check') &&
    retentionMigration.includes('refund_gmail_attachments_quarantine_location_check') &&
    retentionMigration.includes('revoke execute on function public.service_mark_refund_gmail_attachment') &&
    retentionMigration.includes('revoke execute on function public.service_list_refund_gmail_expired_attachments(integer)') &&
    retentionMigration.includes('revoke execute on function public.service_purge_refund_gmail_expired_message_content(integer)'),
  'An old worker or corrupt target cannot bypass tokenized quarantine and byte-delete claims',
);
assert(
  retentionMigration.includes("intent.status in ('reserved', 'uploaded', 'upload_failed', 'upload_unknown')") &&
    retentionMigration.includes("intent.storage_bucket = 'refund-gmail-quarantine'") &&
    retentionMigration.includes('attachment.storage_path = intent.storage_path') &&
    retentionMigration.includes('and attachment.storage_bucket is null') &&
    retentionMigration.includes('and attachment.storage_path is null') &&
    retentionMigration.includes("intent.status <> 'deleted'") &&
    !retentionMigration.includes("'attachment_cleanup_incomplete'"),
  'Retention deletes only canonical intent targets while unrelated storage-free metadata purges independently',
);
assert(
  retentionHelper.includes('classifyRefundGmailStorageUpload') &&
    retentionHelper.includes('return "uploaded"') &&
    retentionHelper.includes('return "upload_unknown"') &&
    retentionHelper.includes('classifyRefundGmailStorageDelete') &&
    retentionHelper.includes('? "deleted"') &&
    retentionHelper.includes(': "delete_unknown"') &&
    retentionHelper.includes('redactedRefundGmailRetentionSummary') &&
    !retentionHelper.includes('storagePath:') &&
    !retentionHelper.includes('recipientEmail:'),
  'The worker helper must require exact delete evidence and emit only allowlisted aggregate fields',
);
assert(
  preflight.includes('REFUND_GMAIL_FIRST_CONTACT_MODE') &&
    preflight.includes('REFUND_GMAIL_LEGACY_RESPONDER_DISABLED') &&
    preflight.includes('REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED') &&
    preflight.includes('REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID') &&
    preflight.includes('REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS'),
  'Gmail preflight must validate first-contact mode and legacy cutover controls',
);
assert(
  migration.includes('or public.is_scoped_admin(p_user_id)') &&
    !migration.includes("refund_case.status = 'draft'\n            and (\n              public.is_super_admin(p_user_id)\n              or public.user_is_refund_manager(p_user_id)"),
  'Unassigned Gmail drafts must be limited to central internal admins',
);

assert(
  participantMigration.includes("participant_role in ('customer', 'assigned_manager', 'mailbox', 'automated_system', 'unknown')"),
  'Gmail messages must use an explicit participant model',
);
assert(
  participantMigration.includes("manager.status = 'active'") &&
    participantMigration.includes('manager.revoked_at is null'),
  'Manager CC and participant classification must use current active non-revoked mappings',
);
assert(
  managerRouteMigration.includes('service_resolve_refund_customer_manager_cc') &&
    managerRouteMigration.includes('distinct_active_mapping_count not between 1 and 4') &&
    managerRouteMigration.includes('manager_recipient_overlap') &&
    managerRouteMigration.includes('valid_active_mapping_count <> distinct_active_mapping_count') &&
    managerRouteMigration.includes("when mailbox_collision_count > 0 then 'invalid_manager_mapping'") &&
    managerRouteMigration.includes("manager_cc_emails := '{}'::text[]"),
  'The complete manager route must support four identities, count a customer-manager once, and fail closed for malformed, mailbox-colliding, or over-cap mappings',
);
assert(
  gmailTransport.includes('CUSTOMER_MANAGER_CC_ALLOWED_STATUS = "resolved"') &&
    gmailTransport.includes('recipientResolutionStatus !== CUSTOMER_MANAGER_CC_ALLOWED_STATUS') &&
    gmailTransport.includes('managerRecipientOverlap') &&
    gmailTransport.includes('managerRecipientCount') &&
    gmailTransport.includes('"manager_cc_required"') &&
    gmailTransport.includes('requireRefundCustomerManagerCcResolution'),
  'Customer delivery must require a complete one-to-four manager recipient route in both Gmail and transactional paths',
);
assert(
  refundEmail.includes('requireRefundManagerCcEmailsForSend') &&
    (refundEmail.match(/const managerCcEmails = requireRefundManagerCcEmailsForSend/g) ?? []).length === 2 &&
    refundEmail.includes('managerRecipientOverlap ? 1 : 0') &&
    refundEmail.includes('> 4'),
  'Transactional refund helpers must reject incomplete manager recipient routes while allowing a represented customer-manager',
);
assert(
  !adminUpdate.includes('managerCcEmails: [] as string[]') &&
    adminUpdate.includes('"customer_message_record_required"'),
  'Status-action customer delivery cannot bypass the tracked send-time manager resolution path',
);
assert(
  gmailTransport.includes('"gmail_link_changed"') &&
    !gmailTransport.includes('if (!claim?.linked) {\n    return { usedGmail: false as const }') &&
    gmailTransport.includes('deliveryKind,') &&
    gmailHelper.includes('"Auto-Submitted: auto-generated"') &&
    gmailHelper.includes('"X-Auto-Response-Suppress: All"'),
  'A linked-thread race must fail closed, and only automatic replies must carry responder-loop suppression headers',
);
assert(
  participantMigration.includes("participant_role := 'assigned_manager'") &&
    participantMigration.includes("normalized_trust = 'direct_human' and exists") &&
    participantMigration.includes("stored_direction := 'system'") &&
    participantMigration.includes("if participant_role = 'customer' then"),
  'Manager and unknown replies must not enter customer state or GPT inbound processing',
);
const customerClassificationIndex = participantMigration.indexOf(
  "and normalized_sender_email = lower(btrim(case_row.customer_email)) then",
);
const managerClassificationIndex = participantMigration.indexOf(
  "manager.reporting_machine_id = case_row.reporting_machine_id",
  customerClassificationIndex,
);
assert(
  customerClassificationIndex >= 0 &&
    managerClassificationIndex > customerClassificationIndex &&
    participantMigration.includes("case_row.id is null and exists ("),
  'The exact case customer must outrank a conflicting active manager mapping in linked and referenced threads',
);
assert(
  participantMigration.includes('automatic_customer_contact_paused_at') &&
    participantMigration.includes('coalesce(p_is_hard_bounce, false)') &&
    participantMigration.includes('any(normalized_failed_recipient_emails)') &&
    participantMigration.includes("'automatic_contact_paused'"),
  'Only a trusted hard bounce for the exact case customer may pause subsequent automatic contact',
);
const outboundClaim = participantMigration.slice(
  participantMigration.indexOf('create or replace function public.service_claim_refund_gmail_outbound_v2'),
  participantMigration.indexOf('create or replace function public.admin_recover_refund_gmail_customer_contact'),
);
assert(
  outboundClaim.includes('perform thread.id') &&
    outboundClaim.includes('where thread.refund_case_id = p_refund_case_id') &&
    outboundClaim.includes('select min(thread.automatic_customer_contact_paused_at)') &&
    outboundClaim.includes('normalized_delivery_kind = \'automatic\' and case_pause_at is not null') &&
    !outboundClaim.includes('thread_row.automatic_customer_contact_paused_at is not null'),
  'Every automatic outbound claim must lock and enforce hard-bounce pauses across all case-linked threads',
);
assert(
  outboundClaim.includes("recipient_resolution ->> 'status' is distinct from 'resolved'") &&
    !outboundClaim.includes('resolved_with_exclusions') &&
    outboundClaim.includes('cardinality(manager_cc_emails) = 0') &&
    outboundClaim.includes("'status', 'manager_cc_required'") &&
    outboundClaim.includes("'gmail_manager_cc_resolved'") &&
    !outboundClaim.includes("'gmail_manager_cc_exception'") &&
    !outboundClaim.includes('The customer Gmail reply has no manager CC because') &&
    !outboundClaim.includes('excluded invalid manager mappings') &&
    outboundClaim.indexOf("'status', 'manager_cc_required'") <
      outboundClaim.indexOf('insert into public.refund_gmail_messages'),
  'The database claim must block unresolved, zero-manager, and invalid routes before creating outbound Gmail state',
);
assert(
  pilotLinkageMigration.includes("'case_specific_message', false") &&
    followUpMigration.includes("recipient_resolution ->> 'status' is distinct from 'resolved'") &&
    !followUpMigration.includes("'resolved_with_exclusions'") &&
    !followUpMigration.includes('unsafe or duplicate recipients were excluded'),
  'The generic first-contact exception must be explicitly non-case-specific, while every deterministic follow-up requires the exact complete manager route',
);
const recoveryStart = participantMigration.indexOf(
  'create or replace function public.admin_recover_refund_gmail_customer_contact',
);
const recoveryEnd = participantMigration.indexOf(
  'create or replace function public.service_purge_refund_gmail_expired_message_content',
);
const recoveryBlock = participantMigration.slice(recoveryStart, recoveryEnd);
assert(
  recoveryStart >= 0 &&
    recoveryBlock.includes('actor_user_id uuid := auth.uid()') &&
    recoveryBlock.includes('public.can_manage_refund_case(actor_user_id, p_refund_case_id)') &&
    recoveryBlock.includes("btrim(coalesce(p_confirmation, '')) <> 'customer_address_verified'") &&
    recoveryBlock.includes('where thread.refund_case_id = p_refund_case_id') &&
    recoveryBlock.includes('automatic_customer_contact_paused_at = null') &&
    recoveryBlock.includes("'gmail_customer_contact_recovered'") &&
    recoveryBlock.includes('actor_user_id'),
  'Recovery must be explicit, authenticated, case-wide, atomic, and actor-audited',
);
assert(
  (participantMigration.match(/automatic_customer_contact_paused_at = null/g) ?? []).length === 1 &&
    (participantMigration.match(/automatic_customer_contact_pause_reason = null/g) ?? []).length === 1 &&
    participantMigration.includes(
      'revoke insert, update, delete on table public.refund_gmail_threads from service_role',
    ) &&
    participantMigration.includes(
      'revoke execute on function public.admin_recover_refund_gmail_customer_contact(uuid,text,text)',
    ) &&
    participantMigration.includes('from public, anon, service_role'),
  'Only the authenticated manager recovery RPC may clear pause evidence; service and scheduler paths must fail closed',
);
assert(
  gmailHelper.includes('parsePermanentDsnFailureRecipients') &&
    gmailHelper.includes('/^mx\\.google\\.com\\s*;/i') &&
    gmailHelper.includes('authIdentityDomain(method, clause) !== reporterDomain') &&
    gmailHelper.includes('["fail", "softfail", "temperror", "permerror"]') &&
    gmailHelper.includes('!/^failed(?:\\s|$)/i') &&
    gmailHelper.includes('!/^5\\.\\d{1,3}\\.\\d{1,3}(?:\\s|$)/') &&
    !gmailHelper.includes('...parseEmailAddressList(getGmailHeader(headers, "X-Failed-Recipients"))'),
  'Hard-bounce evidence must bind trusted Google reporter auth and permanent action/status to one DSN recipient block',
);
assert(
  participantMigration.includes('recipient_cc_emails = \'{}\'::text[]') &&
    participantMigration.includes("subject = '[Deleted after Gmail retention period]'"),
  'Raw CC recipients must purge with the approved Gmail copy',
);
assert(
  participantMigration.includes('revoke execute on function public.service_ingest_refund_gmail_message(') &&
    participantMigration.includes('from service_role'),
  'The participant-blind legacy ingestion RPC must fail closed after migration',
);
const participantManagerContext = participantMigration.slice(
  participantMigration.indexOf('create or replace function public.admin_get_refund_gmail_case_context'),
);
assert(
  !participantManagerContext.includes("'senderEmail'") &&
    !participantManagerContext.includes("'recipientEmail'") &&
    participantManagerContext.includes("'participantRole'") &&
    participantManagerContext.includes("'managerCcCount'"),
  'Safe browser views must expose participant roles and recipient counts, never raw To or CC addresses',
);
assert(
  participantManagerContext.includes('min(thread.automatic_customer_contact_paused_at)') &&
    participantManagerContext.includes("'automaticCustomerContactPaused', case_pause_at is not null") &&
    participantManagerContext.includes("'pausedThreadCount', paused_thread_count") &&
    !participantManagerContext.includes(
      "'automaticCustomerContactPaused', latest_thread.automatic_customer_contact_paused_at is not null",
    ),
  'Manager context must surface the aggregate case-wide pause even when the newest thread is unpaused',
);
assert(
  ui.includes('refund-gmail-contact-paused') &&
    ui.includes('refund-gmail-recovery-dialog') &&
    ui.includes('refund-gmail-recovery-verified') &&
    ui.includes('Resume all linked threads') &&
    ui.includes('Not from customer'),
  'Managers must see case-wide hard-bounce recovery, deliberately verify it, and see unverified participant warnings',
);
assert(
  managerNotification.includes('service_resolve_refund_customer_manager_cc') &&
    managerNotification.includes('/refunds?case=${encodeURIComponent(refundCaseId)}') &&
    !managerNotification.includes('/portal/refunds?case=') &&
    managerNotification.includes('usedOpsFallback') &&
    managerNotification.includes('resolveRefundOpsFallbackRecipients') &&
    managerNotification.includes('resolutionStatus === "resolved"') &&
    managerNotification.includes('resolutionStatus !== "resolved"') &&
    managerNotification.includes('!excluded.has(email)') &&
    managerNotification.includes('MAX_OPS_FALLBACK_RECIPIENTS') &&
    managerNotification.includes(
      'the complete current Machine Manager route could not be safely resolved',
    ) &&
    intakeFunction.includes(
      'the complete current Machine Manager route could not be safely resolved',
    ) &&
    syncFunction.includes(
      'the complete current Machine Manager route could not be safely resolved',
    ) &&
    !managerNotification.includes('no eligible active Machine Manager was resolved') &&
    !intakeFunction.includes('no eligible current Machine Manager was resolved') &&
    !syncFunction.includes('no eligible current Machine Manager was resolved'),
  'Action notices must re-resolve current managers, use the canonical case link, and use a customer/mailbox-excluding capped ops fallback only for routing exceptions',
);

const canonicalGmailEnvironmentNames = [
  'GMAIL_SUPPORT_CLIENT_ID',
  'GMAIL_SUPPORT_CLIENT_SECRET',
  'GMAIL_SUPPORT_REFRESH_TOKEN',
  'GMAIL_SUPPORT_MAILBOX',
  'GMAIL_SUPPORT_SEND_AS_ALIASES',
  'GMAIL_REFUND_LABEL_ID',
  'GMAIL_REFUND_START_AT',
  'GMAIL_REFUND_MAX_THREADS_PER_RUN',
  'REFUND_GMAIL_SYNC_SECRET',
  'REFUND_GMAIL_ENABLED',
  'REFUND_GMAIL_SYNC_ENABLED',
  'REFUND_GMAIL_RETENTION_ENABLED',
  'REFUND_GMAIL_RETENTION_POLICY_VERSION',
  'REFUND_GMAIL_ATTACHMENT_SCANNER_ENABLED',
  'REFUND_GMAIL_ATTACHMENT_SCANNER_VERSION',
  'REFUND_GMAIL_FIRST_CONTACT_MODE',
  'REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT',
  'REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID',
  'REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID',
  'REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS',
  'REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED',
  'REFUND_GMAIL_LEGACY_RESPONDER_DISABLED',
  'REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED',
  'REFUND_GMAIL_FIRST_CONTACT_REFUND_URL',
  'REFUND_GMAIL_FIRST_CONTACT_SUPPORT_URL',
];
for (const name of canonicalGmailEnvironmentNames) {
  const matches = envExample.match(new RegExp(`^${name}=`, 'gm')) ?? [];
  assert.equal(matches.length, 1, `.env.example must define ${name} exactly once`);
}
assert(
  /^GMAIL_SUPPORT_SEND_AS_ALIASES=$/m.test(envExample) &&
    !/^GMAIL_SUPPORT_SEND_AS_ALIASES=.+$/m.test(envExample),
  'Unverified Gmail send-as aliases must not be implied by .env.example defaults',
);
assert(
  intakeFunction.includes('sendRefundManagerActionNotice') &&
    automationSweep.includes('sendRefundManagerActionNotice') &&
    syncFunction.includes('sendGmailCaseActionNotice') &&
    syncFunction.includes('participantRole === "customer" || automaticContactPaused'),
  'New intake, Gmail action-needed work, delivery exceptions, and aging cases must emit the separate canonical-link notice',
);
const intakeManagerSummary = intakeFunction.slice(
  intakeFunction.indexOf('const buildManagerNotificationSummary'),
  intakeFunction.indexOf('const sendManagerIntakeNotification')
);
assert(
  intakeManagerSummary.includes('`Reference: ${publicReference}`') &&
    intakeManagerSummary.includes('`Machine: ${machineLabel}`') &&
    intakeManagerSummary.includes('`Location: ${locationName}`') &&
    intakeManagerSummary.includes('`Current status: ${status}`') &&
    !intakeManagerSummary.includes('Reported amount:') &&
    !intakeManagerSummary.includes('Incident time:') &&
    !intakeManagerSummary.includes('Payment method:'),
  'Intake action notices must keep payment amount, incident timestamp, and payment method behind the authenticated portal link',
);
const walletReadyManagerNotice = intakeFunction.slice(
  intakeFunction.indexOf('const sendWalletMatchReadyNotification'),
  intakeFunction.indexOf('const persistWalletCorrectionLookup')
);
assert(
  walletReadyManagerNotice.includes('found one high-confidence transaction') &&
    !walletReadyManagerNotice.includes('Confidence class:'),
  'Wallet-ready action notices must keep the raw confidence class behind the authenticated portal link',
);
assert(
  qaChecklist.includes('complete current assigned Machine Manager route') &&
    qaChecklist.includes('amount, incident time, payment method, and raw confidence remain in the authenticated portal') &&
    qaChecklist.includes('whenever the complete current manager route cannot be safely resolved') &&
    qaChecklist.includes('Duplicate normalized valid rows appear once only when every distinct active identity remains covered') &&
    qaChecklist.includes('counts that address once when the customer is also a mapped manager') &&
    qaChecklist.includes('a fifth manager, zero managers, malformed mappings, or a mailbox collision makes the complete route fail closed') &&
    !qaChecklist.includes('with reference, machine, amount, incident time, payment method, case link, and status only'),
  'QA guidance must preserve private manager-notice fields and exact complete-route fallback semantics',
);
assert(
  intakeFunction.includes('dispatchRefundCaseGmailReply') &&
    intakeFunction.includes('cc: gmailDelivery.managerCcEmails') &&
    sendFunction.includes('cc: gmailDelivery.managerCcEmails') &&
    adminUpdate.includes('managerCcEmails: gmailDelivery.managerCcEmails') &&
    automationSweep.includes('managerCcEmails: gmailDelivery.managerCcEmails'),
  'Every transactional refund fallback must receive its complete manager recipient route from the fail-closed send-time resolver',
);
assert(
  !adminUpdate.includes('sendRefundManagerActionNotice') &&
    !sendFunction.includes('sendRefundManagerActionNotice'),
  'Completion and ordinary customer-message paths must not emit a duplicate manager-only completion notice',
);

const proofAuthorizationCall = sendFunction.indexOf(
  'authorizeRefundSyntheticGmailProof({',
);
const proofMessageInsert = sendFunction.indexOf(
  '.from("refund_case_messages")',
  proofAuthorizationCall,
);
const proofDatabaseBinding = sendFunction.indexOf(
  'synthetic_gmail_proof_authorization_id:',
  proofMessageInsert,
);
const proofTransportCall = sendFunction.indexOf(
  'dispatchRefundCaseGmailReply({',
  proofDatabaseBinding,
);
assert(
  proofAuthorizationCall >= 0 &&
    proofMessageInsert > proofAuthorizationCall &&
    proofDatabaseBinding > proofMessageInsert &&
    proofTransportCall > proofDatabaseBinding &&
    sendFunction.includes('runToken: body?.syntheticProofRunToken') &&
    sendFunction.includes('defaultTemplateOnly: !triageSuggestionId') &&
    sendFunction.includes('syntheticProofAuthorizationId: syntheticProof.authorizationId'),
  'The case-message Edge path must authorize before insert, then pass its internal binding through the shared database boundary before transport',
);
const proofTransportVerification = gmailTransport.indexOf(
  'verifyRefundSyntheticGmailProofTransport({',
);
assert(
  proofTransportVerification >= 0 &&
    proofTransportVerification < gmailTransport.indexOf('.from("refund_gmail_threads")') &&
    proofTransportVerification < gmailTransport.indexOf('getRefundGmailConfig()') &&
    proofTransportVerification < gmailTransport.indexOf(
      'service_claim_refund_gmail_outbound_v3',
    ) &&
    proofTransportVerification < gmailTransport.indexOf(
      'sendRefundGmailReply({',
    ) &&
    gmailTransport.includes(
      'config.mailbox.trim().toLowerCase() !== "info@bloomjoysweets.com"',
    ) &&
    gmailTransport.includes('syntheticProof.expectedManagerCount') &&
    gmailTransport.includes('syntheticProof.managerRouteDigest'),
  'Exclusive proof transport verification must precede link/config/OAuth/claim/send and pin Info plus the complete route',
);
assert(
  syntheticProofMigration.includes(
    'refund_synthetic_gmail_proof_one_unclosed_idx',
  ) &&
    syntheticProofMigration.includes('where cancelled_at is null') &&
    syntheticProofMigration.includes(
      "^etrifari\\+refundpilot([._-][a-z0-9][a-z0-9._-]{0,48})?@bloomjoysweets\\.com$",
    ) &&
    syntheticProofMigration.includes("expires_at <= prepared_at + interval '5 minutes'") &&
    syntheticProofMigration.includes('expected_message_type = \'status_update\'') &&
    syntheticProofMigration.includes(
      'guard_refund_synthetic_gmail_proof_message_insert',
    ) &&
    syntheticProofMigration.includes(
      'before insert on public.refund_case_messages',
    ) &&
    syntheticProofMigration.includes(
      'synthetic_gmail_proof_authorization_id',
    ) &&
    syntheticProofMigration.includes(
      'Synthetic Gmail proof window blocks every unbound customer message insert',
    ) &&
    syntheticProofMigration.includes(
      "if auth.role() is distinct from 'service_role' then",
    ) &&
    syntheticProofMigration.includes(
      'Synthetic Gmail proof message binding is service-only',
    ) &&
    syntheticProofMigration.includes('baseline_global_case_message_count') &&
    syntheticProofMigration.includes("'activeAuthorizationCount'") &&
    syntheticProofMigration.includes("'proofPassed'") &&
    syntheticProofMigration.includes("'payloadRedacted', true"),
  'The private database boundary must allow only one short owner-controlled status send with redacted pre/post and teardown evidence',
);
assert(
  syntheticProofMigration.includes(
    'revoke all on table public.refund_synthetic_gmail_proof_authorizations',
  ) &&
    syntheticProofMigration.includes(
      'from public, anon, authenticated, service_role',
    ) &&
    !syntheticProofMigration.includes('p_recipient_email text,\n  p_expires_at') &&
    !syntheticProofMigration.includes('p_expected_manager_emails') &&
    !syntheticProofMigration.includes('p_manager_route_digest'),
  'No browser or service caller can set an arbitrary proof case, recipient, manager route, or expiry',
);
assert(
  syntheticProofHelper.includes('RUN_TOKEN_PATTERN') &&
    syntheticProofHelper.includes('await sha256Hex(normalizedToken)') &&
    syntheticProofHelper.includes('if (normalizedToken) throw proofError("unexpected_token")') &&
    syntheticProofTest.includes('JSON.stringify(calls).includes(RUN_TOKEN), false') &&
    syntheticProofTest.includes('invalid or missing opaque token is never forwarded in clear text'),
  'The proof run token must be opaque, hashed before RPC, and never logged or persisted in clear text',
);
assert(
  transportTest.includes('before link lookup, claim, OAuth, or send') &&
    transportTest.includes('approved one-shot synthetic proof pins one original-thread send') &&
    transportTest.includes('changed manager route after claim and before OAuth or send') &&
    syntheticProofDbTest.includes('Rejected proof requests create zero case messages') &&
    syntheticProofDbTest.includes('admin-update lane cannot insert') &&
    syntheticProofDbTest.includes('Gmail intake/first-contact lane cannot insert') &&
    syntheticProofDbTest.includes('automatic follow-up lane cannot insert') &&
    syntheticProofDbTest.includes('provider-completion automation lane cannot insert') &&
    syntheticProofDbTest.includes(
      'An authenticated caller cannot forge the exact internal proof authorization id',
    ) &&
    syntheticProofDbTest.includes(
      'The forged authenticated insert creates zero message binding',
    ) &&
    syntheticProofDbTest.includes(
      'All blocked creator lanes reach zero transport, OAuth, or Gmail claim work',
    ) &&
    syntheticProofDbTest.includes('The approved path adds no attachment') &&
    syntheticProofDbTest.includes('Final teardown verifies every exclusive proof gate is closed') &&
    syntheticProofConcurrencyTest.includes(
      'Exactly one of two concurrent sessions consumes the one-shot authorization',
    ),
  'Executable Edge, database, and two-session tests must cover reject-before-send, one approved send, no attachments, replay, and teardown',
);
assert(
  !ui.includes('syntheticProofRunToken') &&
    !client.includes('syntheticProofRunToken') &&
    !ui.includes('refundpilot') &&
    !client.includes('refundpilot'),
  'The manager portal and client expose no arbitrary synthetic proof target or token setter',
);

console.log('Refund Gmail validation passed: default-off zero-call transport shutdown, label-only intake, idempotent no-CC pre-mapping acknowledgement, private email-to-form linkage, participant-safe original threading, current mapped-manager CC for case-specific mail, deterministic follow-ups, bounce recovery, retention, health, and least-privilege boundaries are present.');
