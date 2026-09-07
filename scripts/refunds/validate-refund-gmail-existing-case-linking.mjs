import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const migration = read(
  'supabase', 'migrations', '20260901080000_refund_gmail_existing_case_linking.sql'
);
const formOnlyMigration = read(
  'supabase', 'migrations', '20260821090000_refund_form_only_case_creation.sql'
);
const pgTap = read('supabase', 'tests', 'refund_gmail_existing_case_linking.sql');
const gmailSync = read('supabase', 'functions', 'refund-gmail-sync', 'index.ts');
const operations = read('src', 'lib', 'refundOperations.ts');
const managerUi = read('src', 'pages', 'admin', 'Refunds.tsx');
const runbook = read('Docs', 'REFUND_EMAIL_ASSISTANT_RUNBOOK.md');
const smoke = read('Docs', 'QA_SMOKE_TEST_CHECKLIST.md');

for (const requiredMigrationContract of [
  'service_ingest_refund_gmail_contact_v2',
  'normalized_sender_recent_open_cases',
  'refund_gmail_case_link_reviews',
  'refund_gmail_contact_case_associations',
  'customer_message_sent',
  'provider_call_made',
  'payment_action_taken',
  'inbound_link_review_required',
  "'nextAction', 'review_inbound_case_link'",
  "'bucket', 'needs_action'",
  'Current manager access to every candidate case is required',
]) {
  assert(
    migration.includes(requiredMigrationContract),
    `Existing-case Gmail migration is missing: ${requiredMigrationContract}`
  );
}

assert.match(
  migration,
  /status in \('awaiting_form', 'link_review', 'linked', 'expired'\)/,
  'The intake contact lifecycle must have an explicit non-sendable link-review state'
);
assert.match(
  formOnlyMigration,
  /contact_row\.status <> 'awaiting_form'/,
  'The inherited first-contact claim must continue to require awaiting_form'
);
assert.match(
  migration,
  /refund_case\.status not in \('denied', 'completed', 'closed'\)/,
  'Candidate discovery must exclude terminal customer cases'
);
assert.match(
  migration,
  /refund_case\.case_population = 'customer'/,
  'Internal/test records must never become customer email-link candidates'
);

for (const requiredFixture of [
  'two-cases@example.test',
  'Two plausible cases create one manager task and suppress the form response',
  'No form-link delivery operation is claimed for ambiguous existing cases',
  'The complete two-cases-then-email flow creates no competing case',
  'Linking and replay create no provider or payment attempt',
]) {
  assert(pgTap.includes(requiredFixture), `Regression fixture is missing: ${requiredFixture}`);
}

assert.match(
  gmailSync,
  /service_ingest_refund_gmail_contact_v2/,
  'The Gmail worker must use the existing-case-first intake RPC'
);
assert.match(
  gmailSync,
  /p_contextual_facts:/,
  'The Gmail worker must pass only bounded deterministic contextual facts'
);
assert.match(
  operations,
  /refund_gmail_case_link_review_v1/,
  'The browser client must validate the versioned redacted review contract'
);
assert.match(
  managerUi,
  /Link to \{selectedCase\.publicReference\} as primary; keep the others related/,
  'The manager workflow must name the primary/related resolution explicitly'
);
assert.match(
  managerUi,
  /No customer message or refund was sent/,
  'The manager receipt must not imply a send or money movement'
);
assert.match(
  runbook,
  /existing-case-first Gmail linking/i,
  'The operator runbook must document existing-case-first Gmail linking'
);
assert.match(
  smoke,
  /two existing Website cases/i,
  'The smoke checklist must retain the production regression fixture'
);

console.info(
  'Refund existing-case Gmail linking validation passed: single-case linking, ambiguous manager review, no-repeat contact, primary/related audit association, and replay/payment safety are present.'
);
