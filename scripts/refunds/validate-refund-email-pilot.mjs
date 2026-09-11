import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const repoRoot = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, repoRoot), 'utf8');

const collectFiles = async (directory, include) => {
  const entries = await readdir(new URL(`${directory}/`, repoRoot), { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...await collectFiles(path, include));
    } else if (include(path)) {
      paths.push(path);
    }
  }

  return paths;
};

const [
  linkageMigration,
  formOnlyMigration,
  duplicateMigration,
  queueMigration,
  linkageTest,
  formOnlyTest,
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
  customerMessagesRunbook,
  gmailCutoverRunbook,
  smokeChecklist,
  decisions,
  currentStatus,
  mvpPlan,
  sponsorReview,
  demoPacket,
] = await Promise.all([
  read('supabase/migrations/202608050001_refund_email_pilot_linkage.sql'),
  read('supabase/migrations/20260821090000_refund_form_only_case_creation.sql'),
  read('supabase/migrations/202608050002_refund_email_duplicate_reconciliation.sql'),
  read('supabase/migrations/202608050003_refund_email_queue_state.sql'),
  read('supabase/tests/refund_gmail_first_contact_manager_cc.sql'),
  read('supabase/tests/refund_form_only_case_creation.sql'),
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
  read('Docs/REFUND_CUSTOMER_MESSAGES_RUNBOOK.md'),
  read('Docs/REFUND_GMAIL_FIRST_CONTACT_CUTOVER.md'),
  read('Docs/QA_SMOKE_TEST_CHECKLIST.md'),
  read('Docs/DECISIONS.md'),
  read('Docs/CURRENT_STATUS.md'),
  read('Docs/REFUND_MVP_PLAN.md'),
  read('Docs/REFUND_EMAIL_PILOT_SPONSOR_REVIEW.md'),
  read('Docs/REFUND_EMAIL_PILOT_DEMO_PACKET.md'),
]);

const refundRuntimePaths = [
  ...await collectFiles('src', (path) => /refund/i.test(path) && /\.(?:js|mjs|ts|tsx)$/.test(path)),
  ...await collectFiles('supabase/functions', (path) => /refund/i.test(path) && /\.(?:js|mjs|ts|tsx)$/.test(path)),
  ...await collectFiles('.github/workflows', (path) => /refund/i.test(path) && /\.ya?ml$/.test(path)),
  'package.json',
  'package-lock.json',
  '.env.example',
  'supabase/config.toml',
];
const forbiddenRefundSmsPatterns = [
  { label: 'SMS provider dependency', pattern: /\b(?:easytext|ez[\s_-]*texting|twilio|messagebird|vonage|plivo|telnyx|sinch|clicksend|textbelt|bandwidth|client-sns)\b/i },
  { label: 'SMS provider secret', pattern: /\b(?:sms|easytext|eztexting|twilio)[_-][a-z0-9_]*(?:token|secret|key|sid)\b/i },
  { label: 'SMS webhook', pattern: /\b(?:sms|text(?:ing)?)[\s_-]*webhook\b/i },
  { label: 'SMS inbound reply or transport', pattern: /\b(?:sendSms|sendTextMessage|inboundSms|inboundTextMessage|handleInboundText|smsReply|textReply|smsTransport|textMessageTransport|refundSms)\b/i },
  { label: 'SMS transport import', pattern: /\bfrom\s+['"][^'"]*(?:sms|text-message)[^'"]*['"]/i },
];
const refundRuntimeContents = await Promise.all(
  refundRuntimePaths.map(async (path) => ({ path, content: await read(path) })),
);

for (const { path, content } of refundRuntimeContents) {
  for (const { label, pattern } of forbiddenRefundSmsPatterns) {
    assert(!pattern.test(content), `${label} must not be present in refund runtime/package/config surface: ${path}`);
  }
}

assert(
  firstContact.includes('Open the refund request form') &&
    !firstContact.includes('forms.gle') &&
    !firstContact.includes('backup refund form'),
  'Email first contact must expose exactly the Bloomjoy hosted refund path.',
);
assert(
  gmailSync.includes('createRefundGmailIntakeContextToken') &&
    gmailSync.includes('service_register_refund_gmail_contact_link') &&
    gmailSync.includes('recipientPolicy: "premapping_acknowledgement"') &&
    gmailSync.includes('ccEmails: []'),
  'First contact must use a private context and the explicit no-CC pre-mapping exception.',
);
assert(
  gmailTransport.includes('| "automatic_portal_only"') &&
    gmailTransport.includes('| "premapping_acknowledgement"') &&
    gmailTransport.includes('operationKey.startsWith("refund-contact-first-response:")') &&
    gmailTransport.includes('operationKey.startsWith("refund-case-message:")') &&
    gmailTransport.includes('effectiveDeliveryKind === "automatic"') &&
    gmailTransport.includes('normalizedCc.length === 0') &&
    gmailTransport.includes('managerRecipientCount! <= 4'),
  'No-CC transport must stay limited to automatic pre-mapping contact or authorized refund-case messages.',
);
assert(
  formOnlyMigration.includes('create table if not exists public.refund_gmail_intake_contacts') &&
    formOnlyMigration.includes('status in (\'awaiting_form\', \'linked\', \'expired\')') &&
    formOnlyMigration.includes('service_create_refund_case_from_gmail_contact_form') &&
    formOnlyMigration.includes("'contact_alone_created_case', false") &&
    formOnlyTest.includes('Customer contact creates zero refund cases') &&
    formOnlyTest.includes('Submitting the hosted form creates exactly one refund case') &&
    intake.includes('service_create_refund_case_from_gmail_contact_form'),
  'The pilot must keep pre-form contact context private and create exactly one case only when the Bloomjoy form is submitted.',
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
    publicForm.includes('second form.') &&
    publicForm.includes('Sending an email does not') &&
    publicForm.includes('submit a refund request.') &&
    publicForm.includes('mailto:info@bloomjoysweets.com') &&
    !publicForm.includes('forms.gle') &&
    !publicForm.includes('docs.google.com/forms') &&
    !publicForm.includes('current customer service form'),
  'The public form must keep email-linked failures in the original thread, remove every old Google Form fallback, and explain that customer contact alone does not submit a refund request.',
);
assert(
  publicForm.includes("/^\\S+@\\S+\\.\\S+$/.test(form.customerEmail.trim())") &&
    publicForm.includes("errors.customerEmail = 'Enter a valid email address.'") &&
    intake.includes('if (!customerEmail || !isEmail(customerEmail))') &&
    intake.includes('Please enter a valid email address.'),
  'The hosted refund form and server intake must both require a valid customer email address.',
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
    emailRunbook.includes('may record a private pre-form contact but creates zero `refund_cases`') &&
    emailRunbook.includes('the customer is never a recipient of an internal notice') &&
    emailRunbook.includes('The owner-controlled case-specific original-thread proof has also passed') &&
    emailRunbook.includes('explicit production-label and legacy-responder cutover approval') &&
    emailRunbook.includes('customer contact alone never creates a Hub case') &&
    !emailRunbook.includes('with no outbound delivery') &&
    !emailRunbook.includes('until the remaining case-specific CC proof'),
  'The email runbook must preserve zero-case pre-form contact, distinguish internal notices, and record the completed case-specific proof.',
);
assert(
  decisions.includes('Existing one-way link handoff starts a required-email refund flow (`#704`)') &&
    decisions.includes('the existing one-way link handoff supplies the Bloomjoy hosted `/refunds/request` form') &&
    decisions.includes('it is not assigned to a staff/manual text reply') &&
    decisions.includes('creates no `refund_cases` row') &&
    decisions.includes('Existing guarded system automation sends request receipts, clarification requests and reply receipts, status updates, completion notices') &&
    decisions.includes('Managers or humans make the final business decision and handle only named exception paths') &&
    decisions.includes('There is no post-form SMS, SMS reply ingestion, SMS completion notice, or SMS fallback') &&
    decisions.includes('does not depend on EasyText, Twilio, an SMS plan, text-platform access, or an SMS activation/cutover') &&
    decisions.includes('supersedes the 2026-07-21 Gmail draft-on-contact rule') &&
    decisions.includes('earlier 2026-08-21 plan to change the link in an automated EasyText/SMS response population'),
  'The authoritative decision must preserve the existing one-way link handoff and automated routine email continuation without a Hub SMS dependency.',
);
assert(
  emailRunbook.includes('the existing one-way link handoff supplies the form outside the Hub') &&
    emailRunbook.includes('existing guarded automation sends routine supported customer email') &&
    customerMessagesRunbook.includes('The existing one-way link handoff supplies the Bloomjoy hosted refund-form link outside the Hub') &&
    customerMessagesRunbook.includes('Existing guarded automation sends routine supported email') &&
    gmailCutoverRunbook.includes('existing one-way link handoff outside the Hub') &&
    smokeChecklist.includes('existing one-way link handoff outside the Hub') &&
    smokeChecklist.includes('existing guarded automation sends routine supported email receipts') &&
    smokeChecklist.includes('No Hub SMS provider, reply ingestion, case continuation, status/completion, delivery recovery, or fallback exists'),
  'Active refund communication runbooks must preserve the existing one-way link handoff and automated routine email continuation contract.',
);
for (const [path, content] of [
  ['Docs/DECISIONS.md', decisions],
  ['Docs/CURRENT_STATUS.md', currentStatus],
  ['Docs/REFUND_MVP_PLAN.md', mvpPlan],
  ['Docs/REFUND_CUSTOMER_MESSAGES_RUNBOOK.md', customerMessagesRunbook],
  ['Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md', emailRunbook],
  ['Docs/REFUND_GMAIL_FIRST_CONTACT_CUTOVER.md', gmailCutoverRunbook],
  ['Docs/QA_SMOKE_TEST_CHECKLIST.md', smokeChecklist],
  ['Docs/REFUND_EMAIL_PILOT_SPONSOR_REVIEW.md', sponsorReview],
  ['Docs/REFUND_EMAIL_PILOT_DEMO_PACKET.md', demoPacket],
]) {
  assert(
    !/(?:staff manually (?:repl(?:y|ies)|answers?|sends?|supplies?|provides?)|manual staff reply|staff may manually send)/i.test(content),
    `The current link handoff must not be assigned to staff/manual texting in ${path}.`,
  );
}
assert(
  currentStatus.includes('Historical Gmail proof checkpoint (superseded for current channel scope)') &&
    currentStatus.includes('existing guarded automation carries routine supported email after submission') &&
    mvpPlan.includes('preserving the existing one-way link handoff outside the Hub') &&
    mvpPlan.includes('automation carries routine supported email after submission'),
  'Current status and delivery planning must preserve the one-way link handoff and automated email continuation.',
);
assert(
  sponsorReview.includes('Historical review packet') &&
    sponsorReview.includes('Hub SMS conversation or continuation is not deferred work') &&
    demoPacket.includes('Historical pilot packet') &&
    demoPacket.includes('Hub SMS importer, conversation, and provider-integration work is now retired, not deferred') &&
    demoPacket.includes('existing one-way link handoff remains external to the Hub'),
  'Historical SMS pilot packets must be explicitly labeled, preserve the one-way link handoff, and retire Hub SMS continuation work.',
);

console.log('Refund email pilot validation passed: existing one-way link handoff, required-email form submission, automated routine email continuation, zero-case pre-form contact, duplicate guards, and production-off switches are present.');
