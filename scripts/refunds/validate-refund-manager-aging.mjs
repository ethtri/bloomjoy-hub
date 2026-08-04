import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const migration = read('supabase/migrations/202608040001_refund_manager_aging_reminders.sql');
const databaseTest = read('supabase/tests/refund_manager_aging_safety.sql');
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
const agingTemplate = read('supabase/functions/_shared/refund-manager-aging.ts');
const managerNotification = read('supabase/functions/_shared/refund-manager-notification.ts');
const environmentExample = read('.env.example');
const portalUat = read('scripts/refunds/validate-refund-portal-uat.mjs');
const decisions = read('Docs/DECISIONS.md');
const currentStatus = read('Docs/CURRENT_STATUS.md');
const qaChecklist = read('Docs/QA_SMOKE_TEST_CHECKLIST.md');
const productionRunbook = read('Docs/PRODUCTION_RUNBOOK.md');

const checks = [];
const check = (name, condition) => checks.push({ name, pass: Boolean(condition) });

const managerSweepStart = sweep.indexOf('const runManagerAgingSweep = async');
const managerSweepEnd = sweep.indexOf('const runHealthCheck = async', managerSweepStart);
const managerSweep = managerSweepStart >= 0 && managerSweepEnd > managerSweepStart
  ? sweep.slice(managerSweepStart, managerSweepEnd)
  : '';
const routingIndex = managerSweep.indexOf(
  'const resolvedRouting = await resolveRefundManagerActionNoticeRouting',
);
const finalAuthorizationIndex = managerSweep.indexOf(
  'const authorization = await authorizeNotice()',
  routingIndex,
);
const sendIndex = managerSweep.indexOf(
  'const notice = await sendRefundManagerActionNotice',
  finalAuthorizationIndex,
);

check(
  'Manager aging delivery has its own default-off switch and business-day thresholds',
  sweep.includes('Deno.env.get("REFUND_MANAGER_AGING_NOTICES_ENABLED") || "false"') &&
    sweep.includes('REFUND_MANAGER_REMINDER_BUSINESS_DAYS') &&
    sweep.includes('REFUND_MANAGER_ESCALATION_BUSINESS_DAYS') &&
    environmentExample.includes('REFUND_MANAGER_AGING_NOTICES_ENABLED=false') &&
    environmentExample.includes('REFUND_MANAGER_REMINDER_BUSINESS_DAYS=2') &&
    environmentExample.includes('REFUND_MANAGER_ESCALATION_BUSINESS_DAYS=5') &&
    !environmentExample.includes('REFUND_MORE_INFO_REMINDER_DAYS') &&
    !environmentExample.includes('REFUND_ESCALATION_DAYS')
);

check(
  'Durable attention state is service-only and version-invalidated by case facts and replies',
  migration.includes('create table if not exists public.refund_manager_attention_states') &&
    migration.includes('attention_version bigint not null default 1') &&
    migration.includes('revoke all on table public.refund_manager_attention_states from public, anon, authenticated') &&
    migration.includes('grant select, insert, update, delete on table public.refund_manager_attention_states to service_role') &&
    migration.includes('refund_cases_sync_manager_attention') &&
    migration.includes('refund_gmail_messages_sync_manager_attention') &&
    migration.includes('attention_started_at = null') &&
    migration.includes('new.received_at > coalesce')
);

check(
  'Only manager-actionable cases age and waiting or terminal cases remain paused',
  migration.includes("'submitted'") &&
    migration.includes("'needs_review'") &&
    migration.includes("'card_refund_pending'") &&
    migration.includes("case_row.status in ('draft', 'waiting_on_customer', 'denied', 'completed', 'closed')") &&
    databaseTest.includes('Waiting on the customer cancels the stale manager attention clock') &&
    databaseTest.includes('Completion terminates manager aging')
);

check(
  'Business-day aging is timezone-aware, weekend-only, and tested at local-clock boundaries',
  migration.includes('service_refund_business_days_elapsed') &&
    migration.includes('pg_timezone_names') &&
    migration.includes('extract(isodow from candidate_date) between 1 and 5') &&
    agingTemplate.includes('refundBusinessDaysElapsed') &&
    databaseTest.includes('Business-day aging skips Saturday and Sunday') &&
    databaseTest.includes('matching local time')
);

check(
  'Reminder and escalation milestones are once-only per attention version',
  migration.includes("'manager_reminder'") &&
    migration.includes("'manager_escalation'") &&
    migration.includes("'reminder_already_sent'") &&
    migration.includes("'escalation_already_sent'") &&
    migration.includes("'higher_milestone_already_sent'") &&
    managerSweep.includes('`manager_aging:${milestone}:${refundCase.id}:v${attentionVersion}`') &&
    managerSweep.includes('!state.reminder_sent_at && !state.escalation_sent_at') &&
    databaseTest.includes('Replaying the schedule cannot duplicate the manager escalation action') &&
    databaseTest.includes('A direct escalation suppresses a late lower-priority reminder')
);

check(
  'Current mapped recipients are bound before the final case authorization and provider send',
  routingIndex >= 0 &&
    finalAuthorizationIndex > routingIndex &&
    sendIndex > finalAuthorizationIndex &&
    managerSweep.includes('resolvedRouting,') &&
    managerNotification.includes('routing.refundCaseId !== refundCaseId') &&
    managerNotification.includes('routing.customerEmail !== normalizedCustomerEmail')
);

check(
  'Zero-manager routes use a bounded internal exception and mapping changes are re-resolved',
  managerNotification.includes('MAX_OPS_FALLBACK_RECIPIENTS = 5') &&
    managerNotification.includes('usedOpsFallback = managerRecipients.length === 0') &&
    migration.includes("p_outcome = 'operations_exception'") &&
    migration.includes('Operations exceptions require bounded internal recipients only') &&
    databaseTest.includes('A mapping repair is used by the next send-time resolution') &&
    databaseTest.includes('Revocation is reflected immediately')
);

check(
  'Delivery settlement enforces recipient/outcome consistency and never blindly retries uncertainty',
  migration.includes('p_recipient_count < p_manager_recipient_count') &&
    migration.includes('Delivered manager notices require mapped-manager recipients only') &&
    migration.includes('Unknown delivery evidence cannot assert recipients') &&
    migration.includes("delivery_review_reason = 'delivery_unknown'") &&
    migration.includes("'delivery_review_required'") &&
    databaseTest.includes('Unknown delivery is never retried automatically')
);

check(
  'Manager notice content is deterministic, redacted, action-bounded, and versioned',
  agingTemplate.includes('REFUND_MANAGER_AGING_TEMPLATE_VERSION = "refund_manager_aging_v1"') &&
    agingTemplate.includes('Only the current mapped Machine Manager may perform an official refund action') &&
    agingTemplate.includes('Opening the case link is navigation only') &&
    managerNotification.includes('Customer PII, payment details, complaint text, and provider payloads are intentionally omitted') &&
    migration.includes("'payload_redacted', true")
);

check(
  'Canonical case links are encoded and browser-tested as navigation-only',
  managerNotification.includes('/refunds?case=${encodeURIComponent(refundCaseId)}') &&
    portalUat.includes("/refunds?case=${encodeURIComponent('case-wait')}") &&
    portalUat.includes('officialActionCallsAfterLinkNavigation === officialActionCallsBeforeLinkNavigation') &&
    portalUat.includes("name === 'nayax-card-refund' || name === 'refund-case-admin-update'")
);

check(
  'The old calendar-day stale escalation path is removed',
  !sweep.includes('runEscalationSweep') &&
    !sweep.includes('daysAgoIso') &&
    !sweep.includes('REFUND_MORE_INFO_REMINDER_DAYS') &&
    !sweep.includes('REFUND_ESCALATION_DAYS')
);

check(
  'Owner-facing documentation records the contract, production-off gate, and synthetic rollout proof',
  decisions.includes('Manager aging notices use business-day attention versions') &&
    currentStatus.includes('manager aging reminder') &&
    qaChecklist.includes('REFUND_MANAGER_AGING_NOTICES_ENABLED') &&
    productionRunbook.includes('REFUND_MANAGER_REMINDER_BUSINESS_DAYS') &&
    productionRunbook.includes('No holiday calendar is inferred')
);

for (const result of checks) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}`);
}

const failed = checks.filter((result) => !result.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} manager aging validation check(s) failed.`);
  process.exit(1);
}

console.log('\nRefund manager aging guardrails validated.');
