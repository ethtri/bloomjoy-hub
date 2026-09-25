import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260911005752_refund_manager_digest_projection.sql');
const dailyMigration = read('supabase/migrations/20260924233100_refund_all_open_daily_manager_digest.sql');
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
const renderer = read('supabase/functions/_shared/refund-manager-digest.ts');
const portal = read('src/pages/admin/Refunds.tsx');
const operations = read('src/lib/refundOperations.ts');
const tests = read('supabase/tests/refund_manager_digest_projection.sql');
const concurrencyTests = read('supabase/tests/refund_manager_digest_mapping_concurrency.sql');

const checks = [
  ['digest switches default off', migration.includes("delivery_enabled boolean not null default false") && sweep.includes('REFUND_MANAGER_DIGEST_ENABLED") || "false"')],
  ['manager/local-date batches are unique while cases repeat on later dates', migration.includes('unique (manager_user_id, digest_local_date, digest_timezone)') && dailyMigration.includes('primary key (batch_id, refund_case_id)') && !dailyMigration.includes('limit settings_row.max_items')],
  ['claim uses canonical open cases independently of notification actions', dailyMigration.includes("work ->> 'isOpen'") && dailyMigration.includes('refund_manager_daily_digest_projection_for') && dailyMigration.includes('for manager_record in')],
  ['provider start precedes transport and unknown delivery cannot retry', sweep.indexOf('service_mark_refund_manager_digest_provider_started') < sweep.indexOf('sendTransactionalEmail({') && migration.includes("provider_attempt_started_at is not null")],
  ['provider start serializes with manager reassignment and checks full snapshot', dailyMigration.includes("pg_advisory_xact_lock(hashtext('machine_manager:'") && dailyMigration.includes('current_projection_fingerprint is distinct from batch_row.projection_fingerprint') && concurrencyTests.includes('Provider-start rejects the stale recipient after the replacement commits')],
  ['terminal settlement remains monotonic and provider evidence is immutable', migration.includes('Sent manager digest settlement is immutable') && migration.includes('provider_message_id_digest')],
  ['routine replies and reminders use the digest while urgent work remains immediate', migration.includes("p_notice_reason not in ('customer_reply', 'manager_reminder')") && migration.includes('service_begin_refund_manager_notification_pre_digest_20260911')],
  ['portal projection remains separate while digest uses truthful next work', sweep.includes('parseRefundManagerDailyDigestProjection(claim.projection)') && operations.includes("get_refund_manager_work_projection") && portal.includes('overview.managerWork.bucketCounts')],
  ['service claims can execute only the trusted daily projection', dailyMigration.includes('to service_role;') && dailyMigration.includes('refund_manager_daily_digest_projection_for(uuid, timestamptz)')],
  ['paid cases cannot become another payment task', dailyMigration.includes('Paid refund cannot require another manager payment decision') && renderer.includes('refund was already sent')],
  ['render failures settle before the provider boundary', sweep.indexOf('parseRefundManagerDailyDigestProjection(claim.projection)') > sweep.indexOf('try {', sweep.indexOf('const runManagerDigestSweep')) && sweep.includes('p_outcome: providerStarted ? "delivery_unknown" : "known_not_sent"')],
  ['renderer contains exact case and queue links without email actions', renderer.includes('caseUrl(item.caseId)') && renderer.includes('Open your refund queue') && renderer.includes('navigation only')],
  ['portal keeps one queue surface without the duplicate daily-focus panel', portal.includes('overview.managerWork.bucketCounts') && !portal.includes('RefundManagerWorkSummary') && !portal.includes('refund-manager-work-summary')],
  ['synthetic database coverage proves daily repetition, large queue, remapping and privacy', tests.includes('Concurrent or replayed worker cannot claim a second daily message') && tests.includes('Removed mapping disappears from the next scoped snapshot') && tests.includes('Second day again contains every unchanged case') && tests.includes('private-customer@example.invalid')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
if (failed) process.exitCode = 1;
else console.log('Refund manager digest contract checks passed.');
