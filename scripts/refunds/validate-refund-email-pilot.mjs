import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [
  linkageMigration,
  duplicateMigration,
  queueMigration,
  linkageTest,
  duplicateTest,
  firstContact,
  gmailSync,
  gmailTransport,
  emailContextHelper,
  emailContextTest,
  intake,
  publicForm,
  client,
  portal,
  envExample,
  emailRunbook,
] = await Promise.all([
  read('supabase/migrations/202608050001_refund_email_pilot_linkage.sql'),
  read('supabase/migrations/202608050002_refund_email_duplicate_reconciliation.sql'),
  read('supabase/migrations/202608050003_refund_email_queue_state.sql'),
  read('supabase/tests/refund_gmail_first_contact_manager_cc.sql'),
  read('supabase/tests/refund_email_duplicate_reconciliation.sql'),
  read('supabase/functions/_shared/refund-first-contact.ts'),
  read('supabase/functions/refund-gmail-sync/index.ts'),
  read('supabase/functions/_shared/refund-gmail.ts'),
  read('supabase/functions/_shared/refund-email-context.ts'),
  read('supabase/functions/_shared/refund-email-context.test.ts'),
  read('supabase/functions/refund-case-intake/index.ts'),
  read('src/pages/RefundRequest.tsx'),
  read('src/lib/refundOperations.ts'),
  read('src/pages/admin/Refunds.tsx'),
  read('.env.example'),
  read('Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md'),
]);

assert(
  firstContact.includes('Open the refund request form') &&
    !firstContact.includes('forms.gle') &&
    !firstContact.includes('backup refund form'),
  'Email first contact must expose exactly the Bloomjoy hosted refund path.',
);
assert(
  gmailSync.includes('createRefundGmailIntakeContextToken') &&
    gmailSync.includes('service_register_refund_gmail_intake_link') &&
    gmailSync.includes('recipientPolicy: "premapping_acknowledgement"') &&
    gmailSync.includes('ccEmails: []'),
  'First contact must use a private context and the explicit no-CC pre-mapping exception.',
);
assert(
  gmailTransport.includes('recipientPolicy?: "manager_cc_required" | "premapping_acknowledgement"') &&
    gmailTransport.includes('operationKey.startsWith("refund-first-contact:")'),
  'The no-CC transport exception must be structurally limited to automatic first contact.',
);
assert(
  linkageMigration.includes('create table if not exists public.refund_gmail_intake_links') &&
    linkageMigration.includes('token_hash text not null unique') &&
    linkageMigration.includes('used_at timestamptz') &&
    linkageMigration.includes('service_link_refund_gmail_draft_from_hosted_form') &&
    linkageMigration.includes("case_row.status <> 'draft'") &&
    linkageMigration.includes("case_row.intake_source <> 'gmail'"),
  'The hosted form must consume a private, expiring, one-time Gmail draft context.',
);
assert(
  linkageTest.includes('completes the original Gmail case instead of creating a second case') &&
    linkageTest.includes('A consumed email context cannot be replayed') &&
    emailContextHelper.includes('RefundEmailContextUnavailableError') &&
    emailContextHelper.includes('requireLinkedRefundEmailCase') &&
    emailContextTest.includes('expired, replayed, or mismatched email context fails closed') &&
    intake.includes('error instanceof RefundEmailContextUnavailableError') &&
    intake.includes('requireLinkedRefundEmailCase'),
  'Executable coverage must prove one linked case and fail closed for expired, replayed, or mismatched email context.',
);
assert(
    publicForm.includes("safeUrl.searchParams.delete('emailContext')") &&
    publicForm.includes('window.history.replaceState') &&
    publicForm.includes('{hasEmailContext ? (') &&
    publicForm.includes('Please reply in the same email conversation') &&
    publicForm.includes('You do not need to complete a') &&
    publicForm.includes('second form.'),
  'The browser must strip the private token and keep email-linked failures in the original thread instead of exposing Google Forms.',
);
assert(
  gmailSync.includes('const refundEmailPilotAttachmentsEnabled = false') &&
    intake.includes('const refundEmailPilotAttachmentsEnabled = false') &&
    intake.includes('Photo attachments are not available during the email refund pilot') &&
    !publicForm.includes('id="photos"') &&
    !publicForm.includes('type="file"'),
  'Website and Gmail attachment ingestion must be disabled for the pilot.',
);
assert(
  duplicateMigration.includes('candidate.intake_source <> new.intake_source') &&
    duplicateMigration.includes("candidate.intake_source in ('form', 'gmail')") &&
    duplicateMigration.includes('refund_reconciliation_scope_lock_key') &&
    duplicateMigration.includes('refund_reconciliation_fact_fingerprint') &&
    duplicateMigration.includes('left_fact_fingerprint') &&
    duplicateMigration.includes("status = 'pending'") &&
    duplicateMigration.includes('refund_cases_reconciliation_action_guard') &&
    duplicateMigration.includes('refund_case_nayax_reconciliation_guard') &&
    duplicateMigration.includes('sales_adjustment_refund_reconciliation_guard'),
  'Email-only reconciliation must use stable scope locks, reopen stale decisions, and guard case, provider, and settlement actions.',
);
assert(
  duplicateMigration.includes('create or replace function public.can_perform_refund_official_action') &&
    duplicateMigration.includes('not public.refund_case_has_unresolved_reconciliation') &&
    !duplicateMigration.includes('create or replace function public.can_prepare_nayax_refund_execution'),
  'Duplicate readiness must extend PR 701 manager authority without replacing its stricter Nayax predicate.',
);
for (const proof of [
  'A different machine does not create a false-positive review',
  'A different customer does not create a false-positive review',
  'outside the six-hour window',
  'wallet/last-four mismatch',
  'Concurrent intake is serialized',
  'Changing comparison facts reopens a stale distinct resolution',
  'The reconciliation lock key is case-insensitive and independent of incident date',
  "dblink_connect",
]) {
  assert(duplicateTest.includes(proof), `Missing reconciliation proof: ${proof}`);
}
assert(
  queueMigration.includes('admin_get_refund_email_queue_states') &&
    queueMigration.includes("'exactCasePath', '/refunds?case='") &&
    queueMigration.includes("'possibleDuplicate'") &&
    queueMigration.includes("'aging'") &&
    queueMigration.includes("'providerHold'") &&
    queueMigration.includes("'payloadRedacted', true") &&
    queueMigration.includes('service_refund_business_days_elapsed') &&
    queueMigration.includes(') >= 2'),
  'The manager queue contract must expose only authorized, PII-free operational signals and use the two-business-day attention rule.',
);
for (const proof of [
  'Support email',
  'Website form',
  'Possible duplicate',
  'Ask for missing details',
  'Overdue',
  'Refund status not confirmed',
  'Same incident — keep this case',
  'Different purchases',
]) {
  assert(portal.includes(proof), `Manager portal is missing: ${proof}`);
}
assert(
  client.includes("supabaseClient.rpc('admin_get_refund_email_queue_states')") &&
    client.includes("supabaseClient.rpc('admin_get_refund_case_reconciliation'") &&
    client.includes("supabaseClient.rpc('admin_resolve_refund_case_reconciliation'"),
  'The portal must use the scoped queue and reconciliation RPCs.',
);
assert(
  /^REFUND_GMAIL_ENABLED=false$/m.test(envExample) &&
    /^REFUND_GMAIL_SYNC_ENABLED=false$/m.test(envExample) &&
    /^REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED=false$/m.test(envExample) &&
    /^REFUND_GMAIL_FIRST_CONTACT_MODE=disabled$/m.test(envExample) &&
    /^NAYAX_REFUND_EXECUTION_ENABLED=false$/m.test(envExample) &&
    !envExample.includes('REFUND_GMAIL_FIRST_CONTACT_LEGACY_URL='),
  'All production-sensitive switches must remain off and email copy must not configure Google Forms.',
);
assert(
  emailRunbook.includes('with no Hub customer first-contact Gmail delivery') &&
    emailRunbook.includes('send the deterministic internal action-needed notice to the resolved current manager route or the operations fallback') &&
    emailRunbook.includes('the customer is never a recipient of that internal notice') &&
    emailRunbook.includes('The owner-controlled case-specific original-thread proof has also passed') &&
    emailRunbook.includes('explicit production-label and legacy-responder cutover approval') &&
    !emailRunbook.includes('with no outbound delivery') &&
    !emailRunbook.includes('until the remaining case-specific CC proof'),
  'The email runbook must distinguish customer first-contact shadow delivery from internal manager notices and record the completed case-specific proof.',
);

console.log('Refund email pilot validation passed: one-link pre-mapping acknowledgement, private email-to-form linkage, attachment-off intake, duplicate guards, and manager queue signals are present with production switches off.');
