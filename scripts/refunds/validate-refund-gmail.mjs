import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
let evidenceDirectory = (process.env.REFUND_GMAIL_EVIDENCE_DIR ?? '').trim() || null;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== '--evidence-dir') {
    throw new Error(`Unknown argument: ${args[index]}`);
  }
  const requestedDirectory = args[index + 1]?.trim();
  if (!requestedDirectory || requestedDirectory.startsWith('--')) {
    throw new Error('--evidence-dir requires an artifact directory.');
  }
  evidenceDirectory = requestedDirectory;
  index += 1;
}

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [
  migration,
  firstContactMigration,
  participantMigration,
  firstContactCcMigration,
  firstContactHelper,
  gmailHelper,
  gmailTransport,
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
  firstContactCcTest,
] =
  await Promise.all([
    read('supabase/migrations/202607210006_refund_gmail_thread_linkage.sql'),
    read('supabase/migrations/202608030001_refund_gmail_first_contact.sql'),
    read('supabase/migrations/202608030003_refund_gmail_participant_cc.sql'),
    read('supabase/migrations/202608040003_refund_first_contact_manager_cc.sql'),
    read('supabase/functions/_shared/refund-first-contact.ts'),
    read('supabase/functions/_shared/refund-gmail.ts'),
    read('supabase/functions/_shared/refund-gmail-transport.ts'),
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
    read('supabase/tests/refund_gmail_first_contact_manager_cc.sql'),
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
    firstContactHelper.includes('current backup refund form') &&
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
assert(syncFunction.includes('failure_test'), 'A PII-free Gmail failure test must exist');
assert(
  syncFunction.includes('triggerSource === "failure_test" ||'),
  'The PII-free failure test must run without enabling real Gmail access',
);
assert(syncFunction.includes('collectAttachmentDescriptors'), 'Attachment type, extension, size, and count must be checked');
assert(syncFunction.includes('refund-gmail-quarantine'), 'Permitted attachments must be quarantined privately');
assert(syncFunction.includes('payloadRedacted: true'), 'Gmail logs and responses must be aggregate-only');
assert(
  syncFunction.indexOf('await runRetentionSweep();') < syncFunction.indexOf('verifyRefundGmailMailbox(config)'),
  'Local retention cleanup must run before Google authorization can fail',
);
assert(
  syncFunction.includes('processFirstContact') &&
    syncFunction.includes('service_claim_refund_gmail_first_contact') &&
    syncFunction.includes('service_resolve_refund_customer_manager_cc') &&
    syncFunction.includes('service_prepare_refund_gmail_first_contact_delivery') &&
    syncFunction.includes('ccEmails: managerCcEmails') &&
    syncFunction.includes('deliveryKind: "automatic"') &&
    syncFunction.indexOf('service_prepare_refund_gmail_first_contact_delivery') <
      syncFunction.indexOf('sent = await sendRefundGmailReply'),
  'Gmail sync must claim and deliver first contact through the original thread with current mapped-manager CC',
);
assert(
  firstContactCcMigration.includes('service_prepare_refund_gmail_first_contact_delivery') &&
    firstContactCcMigration.includes("source_row.participant_role <> 'customer'") &&
    firstContactCcMigration.includes("source_row.participant_trust <> 'verified'") &&
    firstContactCcMigration.includes('automatic_customer_contact_paused_at is not null') &&
    firstContactCcMigration.includes('service_resolve_refund_customer_manager_cc') &&
    firstContactCcMigration.includes('recipient_cc_emails = manager_cc_emails') &&
    firstContactCcMigration.includes("delivery_kind = 'automatic'") &&
    firstContactCcMigration.includes("participant_role = 'mailbox'") &&
    firstContactCcMigration.includes('to service_role'),
  'First-contact delivery preparation must atomically preserve participant trust, case-wide pause, and mapped-manager CC evidence',
);
assert(
  syncFunction.includes('ingestRefundGmailThreadBeforeFirstContact') &&
    syncFunction.indexOf('ingestMessage: async') < syncFunction.indexOf('processFirstContact: async'),
  'Gmail sync must ingest the complete fetched thread before deciding first contact',
);
assert(
  syncFunction.includes('service_claim_refund_gmail_first_contact_reconciliation_batch') &&
    syncFunction.includes('service_count_refund_gmail_first_contact_reconciliation') &&
    syncFunction.indexOf('await reconcileOutstandingFirstContacts') <
      syncFunction.indexOf('while (counters.threadsScanned < maxThreads)'),
  'Outstanding first-contact delivery must rotate and reconcile independently of new-send mode and sender eligibility',
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
      firstContactProcess.indexOf('service_claim_refund_gmail_first_contact') &&
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
    firstContactCcTest.includes('service_finish_refund_gmail_first_contact') &&
    firstContactCcTest.includes('operation_already_exists') &&
    firstContactCcTest.includes('later_thread_message') &&
    firstContactCcTest.includes('exactly one case, thread, acknowledgement operation, and sent outbound message'),
  'The database fixture must prove one two-manager first contact and no replay or later-reply duplicate',
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
  participantMigration.includes('service_resolve_refund_customer_manager_cc') &&
    participantMigration.includes("lower(btrim(manager.manager_email)) <> normalized_customer") &&
    participantMigration.includes('not (lower(btrim(manager.manager_email)) = any(mailbox_identities))') &&
    participantMigration.includes('distinct_active_mapping_count > 3 or eligible_mapping_count > 3') &&
    participantMigration.includes("manager_cc_emails := '{}'::text[]"),
  'Customer, mailbox, revoked, duplicate, malformed, and over-cap mappings must be excluded from manager CC',
);
assert(
  gmailTransport.includes('CUSTOMER_MANAGER_CC_ALLOWED_STATUSES') &&
    gmailTransport.includes('managerCcEmails.length === 0') &&
    gmailTransport.includes('"manager_cc_required"') &&
    gmailTransport.includes('requireRefundCustomerManagerCcResolution'),
  'Customer delivery must require a resolved nonempty current-manager CC set in both Gmail and transactional paths',
);
assert(
  refundEmail.includes('requireRefundManagerCcEmailsForSend') &&
    (refundEmail.match(/const managerCcEmails = requireRefundManagerCcEmailsForSend/g) ?? []).length === 2,
  'Both ordinary and wallet transactional refund helpers must reject empty or invalid manager CC sets',
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
  outboundClaim.includes("recipient_resolution ->> 'status' not in ('resolved', 'resolved_with_exclusions')") &&
    outboundClaim.includes('cardinality(manager_cc_emails) = 0') &&
    outboundClaim.includes("'status', 'manager_cc_required'") &&
    outboundClaim.indexOf("'status', 'manager_cc_required'") <
      outboundClaim.indexOf('insert into public.refund_gmail_messages'),
  'The database claim must block unresolved, zero-manager, and invalid routes before creating outbound Gmail state',
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
    ui.includes('Not customer evidence'),
  'Managers must see case-wide hard-bounce recovery, deliberately verify it, and see unverified participant warnings',
);
assert(
  managerNotification.includes('service_resolve_refund_customer_manager_cc') &&
    managerNotification.includes('/refunds?case=${encodeURIComponent(refundCaseId)}') &&
    !managerNotification.includes('/portal/refunds?case=') &&
    managerNotification.includes('usedOpsFallback') &&
    managerNotification.includes('resolveRefundOpsFallbackRecipients') &&
    managerNotification.includes('!excluded.has(email)') &&
    managerNotification.includes('MAX_OPS_FALLBACK_RECIPIENTS'),
  'Action notices must re-resolve current managers, use the canonical case link, and use a customer/mailbox-excluding capped ops fallback only for routing exceptions',
);
assert(
  intakeFunction.includes('sendRefundManagerActionNotice') &&
    automationSweep.includes('sendRefundManagerActionNotice') &&
    syncFunction.includes('sendGmailCaseActionNotice') &&
    syncFunction.includes('participantRole === "customer" || automaticContactPaused'),
  'New intake, Gmail action-needed work, delivery exceptions, and aging cases must emit the separate canonical-link notice',
);
assert(
  intakeFunction.includes('dispatchRefundCaseGmailReply') &&
    intakeFunction.includes('cc: gmailDelivery.managerCcEmails') &&
    sendFunction.includes('cc: gmailDelivery.managerCcEmails') &&
    adminUpdate.includes('managerCcEmails: gmailDelivery.managerCcEmails') &&
    automationSweep.includes('managerCcEmails: gmailDelivery.managerCcEmails'),
  'Every transactional refund fallback must receive its nonempty manager CC set from the fail-closed send-time resolver',
);
assert(
  !adminUpdate.includes('sendRefundManagerActionNotice') &&
    !sendFunction.includes('sendRefundManagerActionNotice'),
  'Completion and ordinary customer-message paths must not emit a duplicate manager-only completion notice',
);

if (evidenceDirectory) {
  const killSwitchEvidence = {
    schemaVersion: 1,
    evidenceVersion: 1,
    synthetic: true,
    containsProductionData: false,
    credentialsConfigured: true,
    gmailEnabled: false,
    firstContactClaimCalls: 0,
    linkedManualClaimCalls: 0,
    oauthCalls: 0,
    gmailCalls: 0,
    nonGmailRouteAvailable: true,
    portalReviewAvailable: true,
    automaticContactGateIndependent: true,
    deliveryUncertain: false,
  };
  const mimeRoleEvidence = {
    schemaVersion: 1,
    evidenceVersion: 1,
    synthetic: true,
    containsProductionData: false,
    recipientRoles: ['customer', 'machine_manager', 'machine_manager'],
    customerToCount: 1,
    managerCcCount: 2,
    outboundClaimCalls: 1,
    gmailSendCalls: 1,
    sameProviderThread: true,
    inReplyToPresent: true,
    referencesPresent: true,
    automaticHeadersPresent: true,
    internalCaseLinkPresent: false,
    refundCaseCount: 1,
    gmailThreadCount: 1,
    acknowledgementOperationCount: 1,
    sentOutboundCount: 1,
    duplicateReplaySendCount: 0,
    laterReplySendCount: 0,
  };
  const allowedRoleLabels = new Set(['customer', 'machine_manager']);
  assert(
    mimeRoleEvidence.recipientRoles.every((role) => allowedRoleLabels.has(role)),
    'Gmail MIME evidence may contain only approved role labels',
  );
  assert(
    !JSON.stringify([killSwitchEvidence, mimeRoleEvidence]).includes('@'),
    'Gmail evidence must not contain addresses or provider identifiers',
  );
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    `${evidenceDirectory}/refund-kill-switch-evidence.json`,
    `${JSON.stringify(killSwitchEvidence, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    `${evidenceDirectory}/refund-mime-role-evidence.json`,
    `${JSON.stringify(mimeRoleEvidence, null, 2)}\n`,
    'utf8',
  );
  console.log('Wrote sanitized refund-kill-switch-evidence.json and refund-mime-role-evidence.json.');
}

console.log('Refund Gmail validation passed: default-off zero-call transport shutdown, label-only intake, idempotent exactly-once first contact, participant-safe original threading, current mapped-manager CC, deterministic follow-ups, bounce recovery, quarantine, retention, health, and least-privilege boundaries are present.');
