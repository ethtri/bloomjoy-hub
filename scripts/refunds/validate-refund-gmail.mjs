import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [
  migration,
  firstContactMigration,
  firstContactHelper,
  gmailHelper,
  gmailTransport,
  syncFunction,
  sendFunction,
  adminUpdate,
  workflow,
  ui,
  client,
  preflight,
] =
  await Promise.all([
    read('supabase/migrations/202607210006_refund_gmail_thread_linkage.sql'),
    read('supabase/migrations/202608030001_refund_gmail_first_contact.sql'),
    read('supabase/functions/_shared/refund-first-contact.ts'),
    read('supabase/functions/_shared/refund-gmail.ts'),
    read('supabase/functions/_shared/refund-gmail-transport.ts'),
    read('supabase/functions/refund-gmail-sync/index.ts'),
    read('supabase/functions/refund-case-message-send/index.ts'),
    read('supabase/functions/refund-case-admin-update/index.ts'),
    read('.github/workflows/refund-gmail-sync.yml'),
    read('src/pages/admin/Refunds.tsx'),
    read('src/lib/refundOperations.ts'),
    read('scripts/refunds/refund-gmail-preflight.mjs'),
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
  firstContactHelper.includes('ACTIVE_DELIVERY_POLICY_INSTALLED = false') &&
    firstContactHelper.includes('first_contact_active_dependencies_pending'),
  'Production active delivery must remain code-blocked until participant and manager-CC policy is installed',
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
  gmailHelper.includes('Auto-Submitted: auto-replied') &&
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

assert(syncFunction.includes('REFUND_GMAIL_ENABLED'), 'Server-side Gmail enable flag must default closed');
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
    syncFunction.includes('automatic: true'),
  'Gmail sync must claim and deliver first contact through the original thread transport',
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
  syncFunction.indexOf('isRefundGmailMailboxIdentity(config, from.email)') <
      syncFunction.indexOf('isBounce || isAutomated'),
  'Messages sent by the mailbox or configured aliases must remain outbound, not become inbound evidence',
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

assert(workflow.includes('vars.REFUND_GMAIL_SYNC_ENABLED'), 'Scheduled Gmail sync must be disabled by default');
assert(workflow.includes('secrets.REFUND_GMAIL_SYNC_URL'), 'Gmail sync URL must be encrypted');
assert(workflow.includes('secrets.REFUND_GMAIL_SYNC_TOKEN'), 'Gmail sync token must be encrypted');
assert(workflow.includes('cancel-in-progress: false'), 'A running Gmail sync must not be cancelled mid-delivery');

assert(client.includes('admin_get_refund_gmail_draft_cases'), 'Gmail draft cases must join the manager queue');
assert(client.includes('admin_get_refund_gmail_case_context'), 'Managers must be able to load safe thread context');
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

console.log('Refund Gmail validation passed: label-only intake, idempotent thread linkage, exactly-once first contact, safe manager replies, quarantine, retention, health, and least-privilege boundaries are present.');
