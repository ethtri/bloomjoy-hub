import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const envExample = read('.env.example');
const cli = read('scripts/refunds/refund-gmail-intake-shadow-runner.mjs');
const config = read('scripts/refunds/refund-gmail-intake-shadow-runner-config.mjs');
const clients = read('scripts/refunds/refund-gmail-intake-shadow-runner-clients.mjs');
const clientTests = read('scripts/refunds/refund-gmail-intake-shadow-runner-clients.test.mjs');
const library = read('scripts/refunds/refund-gmail-intake-shadow-runner-lib.mjs');
const runnerTests = read('scripts/refunds/refund-gmail-intake-shadow-runner.test.mjs');
const edge = read('supabase/functions/refund-gmail-sync/index.ts');
const intake = read('supabase/functions/refund-gmail-sync/intake-shadow.ts');
const intakeTests = read('supabase/functions/refund-gmail-sync/intake-shadow.test.ts');
const migration = read('supabase/migrations/202608140001_refund_gmail_intake_shadow.sql');
const dbTests = read('supabase/tests/refund_gmail_intake_shadow.sql');
const runbook = read('Docs/REFUND_GMAIL_INTAKE_SHADOW_RUNBOOK.md');
const emailRunbook = read('Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md');
const checklist = read('Docs/QA_SMOKE_TEST_CHECKLIST.md');
const currentStatus = read('Docs/CURRENT_STATUS.md');

assert.equal(
  packageJson.scripts['refunds:gmail-intake-shadow'],
  'node scripts/refunds/refund-gmail-intake-shadow-runner.mjs',
);
assert.equal(
  packageJson.scripts['refunds:validate-gmail-intake-shadow-runner'],
  'deno test --allow-env --no-lock supabase/functions/refund-gmail-sync/intake-shadow.test.ts && node --test scripts/refunds/refund-gmail-intake-shadow-runner.test.mjs scripts/refunds/refund-gmail-intake-shadow-runner-clients.test.mjs && node scripts/refunds/validate-refund-gmail-intake-shadow-runner.mjs',
);
assert.match(packageJson.scripts.test, /refunds:validate-gmail-intake-shadow-runner/u);

assert.match(config, /--mode/u);
assert.match(config, /--env-file/u);
assert.match(config, /--timeout-seconds/u);
assert.doesNotMatch(config, /--(?:label|sender|thread|recipient|address|body|subject|case|schedule|endpoint)/iu);
assert.match(config, /REFUND_GMAIL_INTAKE_SHADOW_RETENTION_POLICY_VERSION/u);
assert.match(config, /REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_LABEL_SHA256/u);
assert.match(config, /REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_OWNER_SENDER_SHA256/u);
assert.match(config, /path\.isAbsolute\(envFile\)/u);
assert.match(config, /REFUND_GMAIL_INTAKE_SHADOW_INITIAL_LABEL_ID/u);
assert.match(config, /REFUND_GMAIL_INTAKE_SHADOW_INITIALIZE_CONFIRMATION/u);
assert.match(cli, /runWithTimeout/u);
assert.match(cli, /SIGINT/u);
assert.match(cli, /SIGTERM/u);
assert.match(cli, /phase: 'failed_closed'/u);
assert.doesNotMatch(cli, /console\.(?:log|error)/u);

assert.match(library, /refund_gmail_retention_v1/u);
assert.match(library, /ENABLE_REVIEWED_RETENTION_BEFORE_EARLIEST_VERIFY_AFTER_LATEST_OR_PURGE_AT_DUE/u);
assert.match(library, /effectsClassification = 'outcome_unknown'/u);
assert.match(library, /'no_effect', 'complete_exact', 'partial_incident', 'outcome_unknown'/u);
assert.match(library, /replayAllowed: false/u);
assert.match(library, /closeAttempts \+= 1/u);
assert.match(library, /REFUND_INTAKE_SHADOW_RECONCILIATION_BOUND_MS = 420 \* 1000/u);
assert.match(library, /stableReads >= 2/u);
assert.match(library, /runFinishedAt/u);
assert.match(library, /gatesConclusivelyClosed/u);
assert.match(library, /initializeClosed/u);
assert.match(library, /earliestRetentionDueAt/u);
assert.match(library, /latestRetentionDueAt/u);
assert.match(library, /exactNoticeCount === 1/u);
assert.match(library, /exactFirstContactOperationCount === 1/u);
assert.match(library, /cleanupObligationCount === 1/u);
assert.match(library, /exactThreadMessageCount === 2/u);
assert.match(library, /managerNoticeOutboundAttemptDelta !== 0/u);
assert.match(runnerTests, /unreadable postflight emits outcome_unknown/u);
assert.match(runnerTests, /exact local v1 contract before any client call/u);
assert.match(runnerTests, /exactly two close attempts/u);
assert.match(runnerTests, /delayed run start and delayed finish/u);
assert.match(runnerTests, /cannot become no_effect until the full quiescence bound/u);
assert.match(runnerTests, /seeds and re-proves only the closed state/u);

assert.match(clients, /read_only: false/u);
assert.match(clients, /SQL_MUTATION_PATTERN/u);
assert.match(clients, /manager_notice_outbound_attempts/u);
assert.match(clients, /where event_type in \(\s*'gmail_customer_action_notice_sent',[\s\S]*'gmail_manager_action_notice_failed'/u);
assert.match(clients, /\(select count\(\*\) from public\.refund_case_messages\) as case_delivery_messages/u);
assert.match(clients, /sha256Hex\(normalizedEmail\) !== ownerSenderDigest/u);
assert.match(clients, /exact_thread_message_count/u);
assert.match(clients, /exact_customer_inbound_count/u);
assert.match(clients, /exact_provider_sent_mailbox_count/u);
assert.match(clients, /notice\.run_id/u);
assert.match(clients, /exact_first_contact_operation_count/u);
assert.match(clients, /cleanup_obligation_count/u);
assert.match(clients, /EDGE_REQUEST_TIMEOUT_MS = 150_000/u);
assert.match(clients, /GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID/u);
assert.match(clientTests, /owner query registry is closed, immutable/u);
assert.match(clientTests, /JWT whose normalized email is not the armed owner sender/u);
assert.match(clientTests, /malformed, multirow, 429, 500, rejection, and abort/u);

assert.match(intake, /REFUND_GMAIL_INTAKE_SHADOW_LIST_LIMIT = 2/u);
assert.match(intake, /REFUND_GMAIL_INTAKE_SHADOW_RETENTION_POLICY_VERSION =[\s\S]*"refund_gmail_retention_v1"/u);
assert.match(intake, /messages\.length !== 2/u);
assert.match(intake, /mailboxAcknowledgement\.receivedAtMs <= ownerInbound\.receivedAtMs/u);
assert.match(intake, /firstContact\.mode !== "shadow"/u);
assert.match(intake, /constantTimeDigestEqual\(await sha256Hex\(runKey\), intake\.runKeyDigest\)/u);
assert.match(intakeTests, /same time as the owner inbound/u);
assert.match(intakeTests, /zero threads/u);
assert.match(intakeTests, /two threads/u);
assert.match(intakeTests, /continuation/u);

assert.match(edge, /service_complete_refund_gmail_intake_shadow/u);
assert.match(edge, /claim\?\.hubCustomerDeliverySent !== false/u);
assert.doesNotMatch(edge, /service_record_refund_gmail_intake_shadow_(?:notice|first_contact)/u);
assert.match(edge, /!intakeShadow && ingestion\?\.created/u);
assert.match(edge, /intakeShadow[\s\S]*?authorizeRefundGmailIntakeShadowDatabase/u);
assert.match(edge, /gate\?\.unresolvedNayaxProviderAttemptCount !== 0/u);
assert.doesNotMatch(edge, /gate\?\.nayaxProviderAttemptCount !== 0/u);

assert.match(migration, /trigger_source in \('scheduled', 'manual', 'failure_test', 'intake_shadow'\)/u);
assert.match(
  migration,
  /refund_gmail_workflow_run_key_is_valid\(\s*normalized_run_key,\s*normalized_trigger\s*\)/u,
);
assert.match(migration, /service_preflight_refund_gmail_intake_shadow/u);
assert.match(migration, /service_complete_refund_gmail_intake_shadow/u);
assert.match(migration, /exact_template constant text := 'refund_first_contact_v1'/u);
assert.match(migration, /notice\.run_id/u);
assert.match(migration, /refund_gmail_intake_shadow_cleanup_obligations/u);
assert.doesNotMatch(migration, /service_record_refund_gmail_intake_shadow_(?:notice|first_contact)/u);
assert.match(migration, /Hub sent no customer first-contact message/u);
assert.match(migration, /mailbox_acknowledgement_observed/u);
assert.match(migration, /later_hub_first_contact_excluded/u);
assert.match(migration, /revoke execute on function public\.refund_gmail_workflow_run_key_is_valid/u);
assert.match(migration, /grant execute on function public\.service_complete_refund_gmail_intake_shadow/u);
assert.match(dbTests, /select plan\(50\)/u);
assert.match(dbTests, /superseded caller-trusted notice recorder is absent/u);
assert.match(dbTests, /durable PII-free assigned cleanup obligation/u);
assert.match(dbTests, /Missing owner-approved cleanup policy blocks intake/u);
assert.match(dbTests, /pending retention action blocks intake/u);
assert.match(dbTests, /manager-visible first-contact event truthfully records durable exclusion/u);

for (const name of [
  'REFUND_GMAIL_INTAKE_ENABLED',
  'GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID',
  'REFUND_GMAIL_INTAKE_SHADOW_OWNER_SENDER_SHA256',
  'REFUND_GMAIL_INTAKE_SHADOW_RUN_KEY_SHA256',
  'REFUND_GMAIL_INTAKE_SHADOW_RETENTION_POLICY_VERSION',
  'REFUND_GMAIL_INTAKE_SHADOW_CONFIRM_LABEL_SHA256',
  'REFUND_GMAIL_INTAKE_SHADOW_INITIAL_LABEL_ID',
  'REFUND_GMAIL_INTAKE_SHADOW_INITIALIZE_CONFIRMATION',
  'REFUND_GMAIL_INTAKE_SHADOW_CLEANUP_COMMITMENT',
]) assert.match(envExample, new RegExp(`^${name}=`, 'mu'));

assert.match(runbook, /exactly two ordered messages/u);
assert.match(runbook, /exactly one matching thread/u);
assert.match(runbook, /One-time closed-state initialization/u);
assert.match(runbook, /one authenticated `intake_shadow` POST with no retry/u);
assert.match(runbook, /420-second dispatch-to-quiescence bound/u);
assert.match(runbook, /safe-close is not rollback/iu);
assert.match(runbook, /partial_incident/u);
assert.match(runbook, /outcome_unknown/u);
assert.match(runbook, /earliest reported expiry/u);
assert.match(runbook, /verify cleanup after the latest/u);
assert.match(runbook, /emergency independent gate verification/u);
assert.match(runbook, /without exposing its identifier/u);
assert.match(emailRunbook, /REFUND_GMAIL_INTAKE_SHADOW_RUNBOOK\.md/u);
assert.match(checklist, /refunds:validate-gmail-intake-shadow-runner/u);
assert.match(checklist, /Any live run is separately authorized and never replayed/u);
assert.match(currentStatus, /P0 `#854` is the in-review, default-off owner-only Gmail intake-shadow/u);
assert.match(currentStatus, /10-function\/50-migration/u);

console.log('PASS Gmail intake-shadow runner static contract');
