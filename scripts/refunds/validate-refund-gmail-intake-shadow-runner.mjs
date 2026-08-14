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
const concurrencyTests = read('supabase/tests/refund_gmail_intake_shadow_concurrency.sql');
const migrationValidator = read('scripts/validate-supabase-migrations.mjs');
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
assert.match(config, /fs\.realpathSync\(repoRoot\)/u);
assert.match(config, /fs\.realpathSync\(absolutePath\)/u);
assert.match(config, /PRIVATE_PACKET_NAMES/u);
assert.match(config, /Object\.hasOwn\(values, name\)/u);
assert.match(config, /return parsed/u);
assert.doesNotMatch(config, /return \{ \.\.\.parentEnv, \.\.\.parsed \}/u);
assert.match(config, /REFUND_GMAIL_INTAKE_SHADOW_INITIAL_LABEL_ID/u);
assert.match(config, /REFUND_GMAIL_INTAKE_SHADOW_INITIALIZE_CONFIRMATION/u);
assert.match(cli, /runWithTimeout/u);
assert.match(cli, /SIGINT/u);
assert.match(cli, /SIGTERM/u);
assert.match(cli, /phase: 'failed_closed'/u);
assert.match(cli, /metadataReconciliationRequired/u);
assert.match(cli, /closedStateVerified/u);
assert.match(cli, /error\.safeDetails\.cleanupTaskHandle/u);
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
assert.match(library, /database\.authorizeDispatch/u);
assert.match(library, /database\.closeDispatch/u);
assert.match(library, /database\.recoverExpiredDispatches/u);
assert.doesNotMatch(library, /control\.(?:openIntake|safeClose)/u);
assert.match(library, /gatesConclusivelyClosed/u);
assert.match(library, /initializeClosed/u);
assert.match(library, /initialization_outcome_unknown/u);
assert.match(library, /metadataReconciliationRequired: true/u);
assert.match(library, /closedStateVerified/u);
assert.match(library, /earliestRetentionDueAt/u);
assert.match(library, /latestRetentionDueAt/u);
assert.match(library, /exactNoticeCount === 1/u);
assert.match(library, /exactFirstContactOperationCount === 1/u);
assert.match(library, /cleanupObligationCount === 1/u);
assert.match(library, /UUID_PATTERN\.test\(postflight\.cleanupTaskHandle/u);
assert.match(library, /withCleanupTaskHandle/u);
assert.match(library, /exactThreadMessageCount === 2/u);
assert.match(library, /managerNoticeOutboundAttemptDelta !== 0/u);
assert.match(runnerTests, /unreadable postflight emits outcome_unknown/u);
assert.match(runnerTests, /nonterminal run preserves its cleanup handle in outcome_unknown/u);
assert.match(runnerTests, /later reconciliation read failure preserves the last verified cleanup handle/u);
assert.match(runnerTests, /exact local v1 contract before any client call/u);
assert.match(runnerTests, /zero secret writes/u);
assert.match(runnerTests, /bounded idempotent recovery/u);
assert.match(runnerTests, /delayed terminal state/u);
assert.match(runnerTests, /cancelled dispatch with no DB run becomes no_effect/u);
assert.match(runnerTests, /cleanup verification is DB-only/u);
assert.match(runnerTests, /known partial incident emits and propagates the PII-free cleanup task handle/u);
assert.match(runnerTests, /expired hard-stop recovery is DB-only/u);
assert.match(runnerTests, /seeds and re-proves only the closed state/u);
assert.match(runnerTests, /timed-out initialization performs no retry/u);
assert.match(runnerTests, /outside junction that resolves into the repository/u);

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
assert.match(clients, /owner_authorize_refund_gmail_intake_shadow_dispatch/u);
assert.match(clients, /owner_cancel_refund_gmail_intake_shadow_dispatch/u);
assert.match(clients, /owner_recover_expired_refund_gmail_intake_shadow_dispatches/u);
assert.match(clients, /owner_complete_due_refund_gmail_intake_shadow_cleanup/u);
assert.match(clients, /cleanupTaskHandle/u);
assert.match(clients, /assignedOutstanding/u);
assert.match(clients, /select cleanup_task_handle::text from exact_cleanup limit 1/u);
assert.doesNotMatch(clients, /min\(cleanup_task_handle\)/u);
assert.match(clients, /coalesce\(\(select min\(status\) from exact_dispatch\), 'absent'\)/u);
assert.match(clients, /exact_first_contact_operation_count/u);
assert.match(clients, /cleanup_obligation_count/u);
assert.match(clients, /EDGE_REQUEST_TIMEOUT_MS = 150_000/u);
assert.match(clients, /GMAIL_REFUND_INTAKE_SHADOW_LABEL_ID/u);
assert.match(clientTests, /owner query registry is closed, immutable/u);
assert.match(clientTests, /JWT whose normalized email is not the armed owner sender/u);
assert.match(clientTests, /malformed, multirow, 429, 500, rejection, and abort/u);
assert.match(clientTests, /exposes no live secret mutation/u);

assert.match(intake, /REFUND_GMAIL_INTAKE_SHADOW_LIST_LIMIT = 2/u);
assert.match(intake, /REFUND_GMAIL_INTAKE_SHADOW_RETENTION_POLICY_VERSION =[\s\S]*"refund_gmail_retention_v1"/u);
assert.match(intake, /messages\.length !== 2/u);
assert.match(intake, /mailboxAcknowledgement\.receivedAtMs <= ownerInbound\.receivedAtMs/u);
assert.match(intake, /firstContact\.mode !== "disabled"/u);
assert.match(intake, /bindRefundGmailIntakeShadowDispatch/u);
assert.match(intake, /return \{ \.\.\.intake, active: true, ownerSenderDigest, startAt \}/u);
assert.match(intake, /ownerSenderDigest !== REFUND_GMAIL_INTAKE_SHADOW_ZERO_DIGEST/u);
assert.match(intake, /intakeEnabled\) fail\("gmail_intake_shadow_gate_must_remain_disabled"\)/u);
assert.match(intakeTests, /same time as the owner inbound/u);
assert.match(intakeTests, /zero threads/u);
assert.match(intakeTests, /two threads/u);
assert.match(intakeTests, /continuation/u);

assert.match(edge, /service_complete_refund_gmail_intake_shadow/u);
assert.ok(
  edge.indexOf('await startRefundGmailIntakeShadowDatabaseBoundary({') <
    edge.indexOf('preflight: authorizeRefundGmailIntakeShadowDatabase'),
  'The intake run must consume its DB authorization before posture preflight.',
);
assert.ok(
  edge.indexOf('preflight: authorizeRefundGmailIntakeShadowDatabase') <
    edge.indexOf('const preflight = await preflightRefundGmailIntakeShadowLabel({ config })'),
  'The post-consume DB posture preflight must still precede OAuth/provider access.',
);
assert.match(intakeTests, /post-consume preflight failure terminally fails the exact run before OAuth/u);
assert.ok(
  edge.indexOf('completeRefundGmailIntakeShadowFirstContact') <
    edge.indexOf('if (!claim?.eligible)'),
  'Intake completion must precede the generic eligible/claimed branch.',
);
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
assert.match(migration, /refund_gmail_intake_shadow_dispatch_authorizations/u);
assert.match(
  migration,
  /pg_advisory_xact_lock\(\s*hashtextextended\('refund-gmail-intake-shadow-dispatch-authorize', 854\)\s*\)/u,
);
assert.match(migration, /refund_gmail_intake_shadow_one_armed_dispatch_idx/u);
assert.match(migration, /refund_gmail_intake_shadow_dispatch_control/u);
assert.match(migration, /authorization_requested_at timestamptz := clock_timestamp\(\)/u);
assert.match(migration, /authorization_requested_at <= last_recovery_at_value/u);
assert.match(migration, /set last_recovery_at = clock_timestamp\(\)/u);
assert.match(migration, /expires_at <= clock_timestamp\(\)/u);
assert.match(migration, /Exact intake-shadow dispatch was already closed or used/u);
assert.match(migration, /repeat\('0', 64\), statement_timestamp\(\), 'cancelled'/u);
assert.match(migration, /owner_recover_expired_refund_gmail_intake_shadow_dispatches/u);
assert.match(
  migration,
  /dispatch\.status = 'armed'[\s\S]*dispatch\.status = 'consumed'[\s\S]*run\.status = 'running'/u,
);
assert.match(migration, /for update;[\s\S]*Active owner intake-shadow dispatch authorization required/u);
assert.match(migration, /status = 'consumed',[\s\S]*consumed_run_id = run_row\.id/u);
assert.match(migration, /dispatch_row\.owner_sender_digest/u);
assert.match(migration, /source_row\.received_at < dispatch_row\.start_at/u);
assert.match(migration, /owner_complete_due_refund_gmail_intake_shadow_cleanup/u);
const cleanupCompletionBlock = migration.slice(
  migration.indexOf('create or replace function public.owner_complete_due_refund_gmail_intake_shadow_cleanup'),
  migration.indexOf('revoke execute on function public.refund_gmail_workflow_run_key_is_valid'),
);
assert.match(
  cleanupCompletionBlock,
  /refund-gmail-intake-shadow-dispatch-authorize/u,
);
assert.match(
  cleanupCompletionBlock,
  /dispatch\.status = 'armed'[\s\S]*run\.status = 'running'[\s\S]*Intake-shadow cleanup requires a closed dispatch lane/u,
);
assert.match(
  cleanupCompletionBlock,
  /refund_gmail_intake_shadow_dispatch_control[\s\S]*last_recovery_at = clock_timestamp\(\)/u,
);
assert.equal(
  migration.match(/refund-gmail-intake-shadow-cleanup-obligations/g)?.length,
  2,
  'Obligation creation and completion must share one fixed global cleanup lock.',
);
for (const purgeField of [
  'sender_name',
  'provider_message_header',
  'references_header',
  'recipient_cc_emails',
  'recipient_cc_count',
  'thread_subject',
]) assert.match(migration, new RegExp(purgeField, 'u'));
assert.doesNotMatch(migration, /service_record_refund_gmail_intake_shadow_(?:notice|first_contact)/u);
assert.match(migration, /Hub sent no customer first-contact message/u);
assert.match(migration, /mailbox_acknowledgement_observed/u);
assert.match(migration, /later_hub_first_contact_excluded/u);
assert.match(migration, /revoke execute on function public\.refund_gmail_workflow_run_key_is_valid/u);
assert.match(migration, /grant execute on function public\.service_complete_refund_gmail_intake_shadow/u);
assert.match(dbTests, /late gateway worker is rejected after owner cancellation/u);
assert.match(dbTests, /durable global recovery epoch/u);
assert.match(dbTests, /Recovery epoch state is RLS-enabled and unavailable/u);
assert.match(dbTests, /source sender not bound to the consumed authorization/u);
assert.match(dbTests, /Cleanup rejects a retained sender name/u);
assert.match(dbTests, /Cleanup rejects a retained provider message header/u);
assert.match(dbTests, /Cleanup rejects a retained references header/u);
assert.match(dbTests, /Cleanup rejects a retained CC address array/u);
assert.match(dbTests, /Cleanup rejects a retained CC recipient count/u);
assert.match(dbTests, /Cleanup rejects a retained linked Gmail thread subject/u);
assert.match(dbTests, /stale completed task handle cannot hide the newer assigned cleanup/u);
assert.match(dbTests, /ambiguous successful cleanup B completion can be verified idempotently/u);
assert.match(dbTests, /Cleanup rejects an armed intake authorization/u);
assert.match(dbTests, /Cleanup rejects a consumed nonterminal intake run/u);
assert.match(dbTests, /different or prior cleanup handle cannot satisfy/u);
assert.match(dbTests, /superseded caller-trusted notice recorder is absent/u);
assert.match(dbTests, /durable PII-free assigned cleanup obligation/u);
assert.match(dbTests, /Missing owner-approved cleanup policy blocks intake/u);
assert.match(dbTests, /pending retention action blocks intake/u);
assert.match(dbTests, /manager-visible first-contact event truthfully records durable exclusion/u);
assert.match(concurrencyTests, /dblink_send_query/u);
assert.match(concurrencyTests, /Exactly one concurrent owner authorization succeeds/u);
assert.match(concurrencyTests, /The concurrent loser fails closed before arming a second digest/u);
assert.match(concurrencyTests, /Concurrency teardown leaves no armed intake-shadow authorization/u);
assert.match(concurrencyTests, /Delayed authorization cannot arm after close created an absent-row tombstone/u);
assert.match(concurrencyTests, /Recovery-first ordering rejects the already-pending authorization/u);
assert.match(concurrencyTests, /Cleanup-first ordering rejects the already-pending authorization/u);
assert.match(migrationValidator, /writeRefundGmailIntakeShadowAdapterTest/u);
assert.match(migrationValidator, /Exact Gmail intake-shadow owner postflight adapter query executes on PostgreSQL/u);

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
  'REFUND_GMAIL_INTAKE_SHADOW_CLEANUP_TASK_HANDLE',
]) assert.match(envExample, new RegExp(`^${name}=`, 'mu'));

assert.match(runbook, /exactly two ordered messages/u);
assert.match(runbook, /exactly one matching thread/u);
assert.match(runbook, /One-time closed-state initialization and release rollover/u);
assert.match(runbook, /After any initialization write attempt, including a client timeout/u);
assert.match(runbook, /makes no blind retry/u);
assert.match(runbook, /metadataReconciliationRequired=true/u);
assert.match(runbook, /one authenticated Edge POST with no retry/u);
assert.match(runbook, /Live execution performs \*\*zero project-secret writes/u);
assert.match(runbook, /strict local plus read-only production `10\/51`/u);
assert.match(runbook, /cancel and service start lock the same exact row/iu);
assert.match(runbook, /fixed transaction-scoped global advisory lock/iu);
assert.match(runbook, /durable cancelled tombstone/iu);
assert.match(runbook, /cancelled authorization with zero run proves `no_effect`/u);
assert.match(runbook, /safe close is not rollback/iu);
assert.match(runbook, /partial_incident/u);
assert.match(runbook, /outcome_unknown/u);
assert.match(runbook, /earliest reported expiry/u);
assert.match(runbook, /verify cleanup after the latest/u);
assert.match(runbook, /five-minute fresh query lookback is anchored at owner DB authorization/u);
assert.match(runbook, /random PII-free cleanup task handle/u);
assert.match(runbook, /assignedOutstanding=0/u);
assert.match(runbook, /exact already-completed handle may idempotently re-prove completion/u);
assert.match(runbook, /same global dispatch lock used by authorization/u);
assert.match(runbook, /advances the durable dispatch epoch/u);
assert.match(runbook, /--mode cleanup-verify/u);
assert.match(runbook, /--mode recover-expired/u);
assert.match(runbook, /no-target function takes the same global advisory lock/iu);
assert.match(runbook, /emergency independent verification/u);
assert.match(runbook, /without exposing an ID/u);
assert.match(emailRunbook, /REFUND_GMAIL_INTAKE_SHADOW_RUNBOOK\.md/u);
assert.match(checklist, /refunds:validate-gmail-intake-shadow-runner/u);
assert.match(checklist, /Any partial\/unknown\/unverified closure is HOLD; never replay/u);
assert.match(checklist, /no project-secret\/version mutation/u);
assert.match(currentStatus, /P0 `#854` is the in-review, default-off owner-only Gmail intake-shadow/u);
assert.match(currentStatus, /Live execution never changes project secrets/u);
assert.match(currentStatus, /strict `10\/51` canonical release/u);

console.log('PASS Gmail intake-shadow runner static contract');
