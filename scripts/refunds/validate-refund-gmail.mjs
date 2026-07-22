import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [migration, gmailHelper, gmailTransport, syncFunction, sendFunction, adminUpdate, workflow, ui, client, preflight] =
  await Promise.all([
    read('supabase/migrations/202607210006_refund_gmail_thread_linkage.sql'),
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

console.log('Refund Gmail validation passed: label-only intake, idempotent thread linkage, safe manager replies, quarantine, retention, health, and least-privilege boundaries are present.');
