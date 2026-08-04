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
const portalUi = read('src/pages/admin/Refunds.tsx');
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
const routeInputsIndex = managerSweep.indexOf(
  'getRefundManagerNoticeReservationRouteInputs',
);
const finalAuthorizationIndex = managerSweep.indexOf(
  '"service_begin_refund_manager_aging_notice_attempt"',
  routeInputsIndex,
);
const reservationBindingIndex = managerSweep.indexOf(
  'bindRefundManagerNoticeReservationRouting',
  finalAuthorizationIndex,
);
const sendIndex = managerSweep.indexOf(
  'const notice = await sendRefundManagerActionNotice',
  reservationBindingIndex,
);
const fingerprintStart = migration.indexOf("fingerprint_material := concat_ws(");
const fingerprintEnd = migration.indexOf("mapping_fingerprint := encode(", fingerprintStart);
const fingerprintMaterial = fingerprintStart >= 0 && fingerprintEnd > fingerprintStart
  ? migration.slice(fingerprintStart, fingerprintEnd)
  : '';

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
    migration.includes('source_customer_message_created_at timestamptz') &&
    migration.includes('where (safe_created_at, new.id) >') &&
    databaseTest.includes('same provider timestamp advances by trusted created_at and id') &&
    databaseTest.includes('same future-dated provider message does not create another version')
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
    migration.includes("'reminder_already_resolved'") &&
    migration.includes("'escalation_already_resolved'") &&
    migration.includes("'higher_milestone_already_resolved'") &&
    managerSweep.includes('`manager_aging:${milestone}:${refundCase.id}:v${attentionVersion}`') &&
    migration.includes('reminder_resolved_at') &&
    migration.includes('escalation_resolved_at') &&
    databaseTest.includes('settled attempt key cannot be replayed') &&
    databaseTest.includes('resolved escalation suppresses a late lower-priority reminder')
);

check(
  'The final reservation resolves and binds the only route accepted by provider transport',
  routeInputsIndex >= 0 &&
    finalAuthorizationIndex > routeInputsIndex &&
    reservationBindingIndex > finalAuthorizationIndex &&
    sendIndex > reservationBindingIndex &&
    !managerSweep.includes('resolveRefundManagerActionNoticeRouting') &&
    managerSweep.includes('resolvedRouting: reservedRouting') &&
    managerNotification.includes('No earlier manager lookup is accepted here') &&
    managerNotification.includes('routing.refundCaseId !== refundCaseId') &&
    managerNotification.includes('routing.customerEmail !== normalizedCustomerEmail')
);

check(
  'The reservation locks, re-resolves, and fingerprints the current mapping without address-derived evidence',
  migration.includes("hashtext('machine_manager:' || case_row.reporting_machine_id::text)") &&
    migration.includes('order by manager.id\n  for update') &&
    migration.includes('service_resolve_refund_customer_manager_cc(') &&
    migration.includes("'recipientRoute', jsonb_build_object(") &&
    migration.includes('notice_attempt_mapping_fingerprint = mapping_fingerprint') &&
    migration.includes('extensions.digest(convert_to(fingerprint_material') &&
    fingerprintMaterial.includes("'mapping_ids=' ||") &&
    !fingerprintMaterial.includes('manager_email') &&
    !fingerprintMaterial.includes('route_recipients') &&
    databaseTest.includes('An earlier, stale manager lookup resolves manager A') &&
    databaseTest.includes('final reservation re-resolves manager B and manager A cannot reach transport') &&
    databaseTest.includes('not unsalted hashes of recipient addresses')
);

check(
  'Zero-manager routes use a bounded transient internal exception and fail closed over cap',
  managerNotification.includes('MAX_OPS_FALLBACK_RECIPIENTS = 5') &&
    migration.includes("expected_outcome := 'operations_exception'") &&
    migration.includes("'ops_fallback_policy_invalid'") &&
    databaseTest.includes('over-cap operations route fails closed before reserving delivery') &&
    databaseTest.includes('No active manager returns one bounded transient operations route')
);

check(
  'Delivery settlement uses a durable global hold and supports auditable cross-version recovery',
    migration.includes('notice_attempt_recipient_count >= notice_attempt_manager_recipient_count') &&
    migration.includes('notice_attempt_mapping_fingerprint') &&
    migration.includes("delivery_review_reason = 'notice_attempt_in_flight'") &&
    migration.includes("delivery_review_reason = 'delivery_unknown'") &&
    migration.includes("'delivery_review_required'") &&
    migration.includes("'known_not_sent'") &&
    databaseTest.includes('old in-flight attempt blocks every newer attention version') &&
    databaseTest.includes('Old-attempt settlement clears the hold without marking the newer milestone') &&
    databaseTest.includes('Unknown recovery also leaves the newer attention version untouched') &&
    databaseTest.includes('Known-not-sent recovery does not consume the newer version milestone')
);

check(
  'The bounded scheduler cap is applied after due/pending filtering',
  managerSweep.includes('"service_list_due_refund_manager_aging_notices"') &&
    !managerSweep.includes('.from("refund_manager_attention_states")') &&
    migration.includes('where eligible.milestone is not null') &&
    migration.includes('limit p_limit') &&
    databaseTest.includes('101st due case is returned even when 100 earlier rows are resolved') &&
    databaseTest.includes('worker contract processes the 101st case through its durable pre-send hold')
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
    portalUi.includes("selectionOrigin === 'case_link'") &&
    portalUi.includes("handleSelectCase(caseFromUrl, 'case_link')") &&
    portalUat.includes("/refunds?case=${encodeURIComponent('case-card-pending')}") &&
    portalUat.includes("name === 'nayax-transaction-lookup'") &&
    portalUat.includes("name === 'nayax-card-refund'") &&
    portalUat.includes("name === 'refund-case-admin-update'") &&
    portalUat.includes('Eligible card case link is navigation-only with no lookup or official action') &&
    portalUat.includes('Search and filter changes remain independent after an eligible case link')
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
