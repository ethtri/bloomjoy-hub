import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [
  migration,
  participantMigration,
  gmailHelper,
  gmailTransport,
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
] =
  await Promise.all([
    read('supabase/migrations/202607210006_refund_gmail_thread_linkage.sql'),
    read('supabase/migrations/202608030003_refund_gmail_participant_cc.sql'),
    read('supabase/functions/_shared/refund-gmail.ts'),
    read('supabase/functions/_shared/refund-gmail-transport.ts'),
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
const managerContext = migration.slice(migration.indexOf('create or replace function public.admin_get_refund_gmail_case_context'));
assert(
  !managerContext.slice(0, managerContext.indexOf('create or replace function public.get_refund_gmail_health')).includes("'providerThreadId'"),
  'The manager case context must not expose provider thread IDs',
);

assert(gmailHelper.includes('GMAIL_SUPPORT_CLIENT_ID'), 'Gmail client ID must be server-only configuration');
assert(gmailHelper.includes('GMAIL_SUPPORT_REFRESH_TOKEN'), 'Gmail refresh token must be server-only configuration');
assert(gmailHelper.includes('GMAIL_SUPPORT_MAILBOX'), 'The designated mailbox must be explicit');
assert(gmailHelper.includes('GMAIL_REFUND_LABEL_ID'), 'The refund label ID must be explicit');
assert(gmailHelper.includes('labelIds: config.labelId'), 'Only labeled Gmail threads may be listed');
assert(gmailHelper.includes('verifyRefundGmailMailbox'), 'The authenticated mailbox must be verified');
assert(gmailHelper.includes('redactPaymentCardNumbers'), 'Inbound possible card numbers must be redacted');
assert(gmailHelper.includes('containsPaymentCardNumber'), 'Outbound full card numbers must be rejected');
assert(!gmailHelper.includes('/messages/modify'), 'The integration must not modify Gmail message state');
assert(!gmailHelper.includes('/trash'), 'The integration must not trash Gmail messages');
assert(!gmailHelper.includes('/delete'), 'The integration must not delete Gmail messages');
assert(gmailHelper.includes('/messages/send'), 'Manager-approved replies must use Gmail send');
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
assert(gmailHelper.includes('threadId: providerThreadId'), 'Gmail sends must pin the original provider thread');
assert(gmailHelper.includes('internal_case_link_blocked'), 'Customer-visible Gmail must reject internal case links');

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
  !syncFunction.includes('console.log(message)') && !syncFunction.includes('console.error(error)'),
  'Raw messages and provider errors must not be logged',
);

assert(gmailTransport.includes('dispatchRefundCaseGmailReply'), 'Case-aware Gmail transport must exist');
assert(sendFunction.includes('dispatchRefundCaseGmailReply'), 'Manual portal replies must use linked Gmail threads');
assert(adminUpdate.includes('dispatchRefundCaseGmailReply'), 'Status-action replies must use linked Gmail threads');
assert(
  automationSweep.includes('dispatchRefundCaseGmailReply') &&
    automationSweep.includes('deliveryKind: "automatic"'),
  'Scheduled Gmail-linked customer mail must stay in the original thread and obey automatic-contact pauses',
);
assert(
  syncFunction.includes('p_provider_sent: providerSentEvidence') &&
    syncFunction.includes('p_is_hard_bounce: isHardBounce') &&
    syncFunction.includes('p_failed_recipient_emails: participantSignals.failedRecipientEmails'),
  'Gmail sync must pass provider Sent proof and DSN recipient proof into participant-safe ingestion',
);
assert(
  sendFunction.includes('Gmail delivery could not be confirmed. Check the original thread before retrying.'),
  'Uncertain Gmail sends must stop automatic retry and tell the manager what to check',
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
  ui.includes('refund-gmail-contact-paused') && ui.includes('Not customer evidence'),
  'Managers must see hard-bounce recovery and unverified participant warnings',
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
    intakeFunction.includes('cc: gmailDelivery.managerCcEmails'),
  'Hosted-form customer acknowledgement must resolve and visibly copy the current manager set before transactional delivery',
);
assert(
  !adminUpdate.includes('sendRefundManagerActionNotice') &&
    !sendFunction.includes('sendRefundManagerActionNotice'),
  'Completion and ordinary customer-message paths must not emit a duplicate manager-only completion notice',
);

console.log('Refund Gmail validation passed: label-only intake, participant-safe original threading, current mapped-manager CC, bounce recovery, quarantine, retention, health, and least-privilege boundaries are present.');
