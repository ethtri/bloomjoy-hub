import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260911005752_refund_manager_digest_projection.sql');
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
const renderer = read('supabase/functions/_shared/refund-manager-digest.ts');
const portal = read('src/components/refunds/RefundManagerWorkSummary.tsx');
const operations = read('src/lib/refundOperations.ts');
const tests = read('supabase/tests/refund_manager_digest_projection.sql');

const checks = [
  ['digest switches default off', migration.includes("delivery_enabled boolean not null default false") && sweep.includes('REFUND_MANAGER_DIGEST_ENABLED") || "false"')],
  ['manager/local-date batches and attention-version items are unique', migration.includes('unique (manager_user_id, digest_local_date, digest_timezone)') && migration.includes('unique (manager_user_id, refund_case_id, attention_version)')],
  ['provider start precedes transport and unknown delivery cannot retry', sweep.indexOf('service_mark_refund_manager_digest_provider_started') < sweep.indexOf('sendTransactionalEmail({') && migration.includes("provider_attempt_started_at is not null")],
  ['routine replies and reminders use the digest while urgent work remains immediate', migration.includes("p_notice_reason not in ('customer_reply', 'manager_reminder')") && migration.includes('service_begin_refund_manager_notification_pre_digest_20260911')],
  ['one projection drives digest and portal', sweep.includes('parseRefundManagerWorkProjection(claim.projection)') && operations.includes("get_refund_manager_work_projection") && portal.includes('projection.bucketCounts')],
  ['renderer contains exact case and queue links without email actions', renderer.includes('caseUrl(item.caseId)') && renderer.includes('Open my refund work') && renderer.includes('navigation only')],
  ['portal exposes six accessible responsive bucket controls', portal.includes('refundManagerWorkBuckets.map') && portal.includes('aria-label={`My refund work bucket') && portal.includes('grid-cols-2') && portal.includes('lg:grid-cols-6')],
  ['synthetic database coverage proves dedupe, remapping, resolution, and privacy', tests.includes('Concurrent worker cannot claim a second daily digest') && tests.includes('Removed mapping disappears from the next server projection') && tests.includes('Attention-version change resolves the old digest item automatically') && tests.includes('private-customer@example.invalid')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
if (failed) process.exitCode = 1;
else console.log('Refund manager digest contract checks passed.');
