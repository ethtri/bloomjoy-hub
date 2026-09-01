import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (relativePath) =>
  fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

const checks = [];
const check = (name, condition) => checks.push({ name, pass: Boolean(condition) });

const migration = read('supabase/migrations/202607210005_refund_automation_scheduler_health.sql');
const schedulerReliabilityMigration = read(
  'supabase/migrations/20260830175740_refund_automation_scheduler_reliability.sql'
);
const schedulerCadenceMigration = read(
  'supabase/migrations/20260830205449_refund_automation_scheduler_30_minute_cadence.sql'
);
const schedulerIncidentMigration = read(
  'supabase/migrations/20260901172459_refund_scheduler_incident_1069.sql'
);
const followUpMigration = read('supabase/migrations/202608030005_refund_deterministic_follow_up_cycles.sql');
const managerAgingMigration = read('supabase/migrations/202608040001_refund_manager_aging_reminders.sql');
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
const intake = read('supabase/functions/refund-case-intake/index.ts');
const deterministicFollowUp = read('supabase/functions/_shared/refund-deterministic-follow-up.ts');
const gmailTransport = read('supabase/functions/_shared/refund-gmail-transport.ts');
const managerNotification = read('supabase/functions/_shared/refund-manager-notification.ts');
const schedulerWorkflow = read('.github/workflows/refund-automation-sweep.yml');
const healthWorkflow = read('.github/workflows/refund-automation-health.yml');

check(
  'Scheduler run and once-only action ledgers are versioned',
  migration.includes('create table if not exists public.refund_automation_runs') &&
    migration.includes('create table if not exists public.refund_automation_actions') &&
    migration.includes('action_key text not null unique')
);
check(
  'Browser roles cannot mutate scheduler ledgers or call service claim functions',
  migration.includes('revoke all on table public.refund_automation_runs from public, anon, authenticated') &&
    migration.includes('revoke all on table public.refund_automation_actions from public, anon, authenticated') &&
    migration.includes('service_claim_refund_automation_action') &&
    migration.includes('from public, anon, authenticated')
);
check(
  'Authorized managers receive a redacted health projection',
  migration.includes('create or replace function public.get_refund_automation_health()') &&
    migration.includes("'payloadRedacted', true") &&
    migration.includes('grant execute on function public.get_refund_automation_health()')
);
check(
  'Automation is fail-closed until its server-side enable flag is true',
  sweep.includes('REFUND_AUTOMATION_ENABLED') &&
    sweep.includes('const automationEnabled') &&
    sweep.includes('if (!automationEnabled)') &&
    sweep.includes('automation_disabled')
);
check(
  'Automatic customer contact requires both the environment gate and the database kill switch',
  deterministicFollowUp.includes('REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED') &&
    sweep.includes('automaticCustomerContactAllowed') &&
    sweep.includes('.from("refund_customer_contact_settings")') &&
    intake.includes('automaticCustomerContactAllowed') &&
    intake.includes('.from("refund_customer_contact_settings")') &&
    followUpMigration.includes('automatic_customer_contact_enabled boolean not null default false') &&
    followUpMigration.includes("raise exception 'Automatic customer contact is disabled'")
);
check(
  'Deterministic follow-up claims are bounded, versioned, and service-only',
  followUpMigration.includes('create table if not exists public.refund_follow_up_cycles') &&
    followUpMigration.includes('cycle_number between 1 and 2') &&
    followUpMigration.includes("template_version = 'refund_follow_up_v1'") &&
    followUpMigration.includes('service_claim_refund_follow_up_cycle') &&
    followUpMigration.includes('service_claim_due_refund_follow_up_reminders') &&
    followUpMigration.includes('service_claim_refund_follow_up_customer_reply') &&
    followUpMigration.includes('from public, anon, authenticated')
);
check(
  'Automatic delivery revalidates kill switch, terminal state, manager CC, and source Gmail thread at transport time',
  followUpMigration.includes('service_authorize_refund_customer_outbound') &&
    followUpMigration.includes('service_claim_refund_gmail_outbound_v3') &&
    followUpMigration.includes("'source_thread_required'") &&
    followUpMigration.includes("'automatic_contact_disabled'") &&
    followUpMigration.includes("'terminal_case'") &&
    followUpMigration.includes('p_target_gmail_thread_id') &&
    followUpMigration.includes('from public, anon, authenticated, service_role') &&
    gmailTransport.includes('service_claim_refund_gmail_outbound_v3') &&
    gmailTransport.includes('p_target_gmail_thread_id: targetGmailThreadId') &&
    gmailTransport.includes(
      'verifyRefundSyntheticGmailProofTransport({',
    ) &&
    sweep.includes('resolveFollowUpGmailThreadId')
);
check(
  'Abandoned customer-delivery claims fail closed into durable manager review without blind resend',
  followUpMigration.includes('service_settle_stale_refund_follow_up_claims') &&
    followUpMigration.includes("status = 'delivery_unknown'") &&
    followUpMigration.includes("'refund_follow_up_delivery_reconciled'") &&
    followUpMigration.includes("'known_gmail_delivery_reconciled'") &&
    followUpMigration.includes("status = 'manual_review'") &&
    followUpMigration.includes("'refund_follow_up_claim_settled'") &&
    sweep.includes('settleStaleFollowUpClaims(counters)') &&
    sweep.includes('stale_follow_up_claim_settled')
);
check(
  'Reminder and verified-customer reply workers consume the exact database contract',
  sweep.includes('Array.isArray(claim.reminders) ? claim.reminders : []') &&
    sweep.includes('.in("status", ["waiting", "customer_replied"])') &&
    sweep.includes('.is("recheck_claimed_at", null)') &&
    !sweep.includes('.is("reply_message_id", null)') &&
    followUpMigration.includes("message.participant_role = 'customer'") &&
    followUpMigration.includes("message.participant_trust = 'verified'") &&
    followUpMigration.includes("message.message_kind = 'message'") &&
    followUpMigration.includes('message.content_deleted_at is null')
);
check(
  'Provider exceptions are redacted manager-only actions',
  sweep.includes('service_claim_refund_provider_exception_action') &&
    sweep.includes('No customer or payment action was taken by this notice.') &&
    followUpMigration.includes("'provider_exception'") &&
    followUpMigration.includes("'payload_redacted', true")
);
check(
  'Customer-touching work is constrained to a named local policy window',
  sweep.includes('REFUND_AUTOMATION_TIMEZONE') &&
    sweep.includes('REFUND_AUTOMATION_START_HOUR') &&
    sweep.includes('REFUND_AUTOMATION_END_HOUR') &&
    sweep.includes('policyWindowIsOpen') &&
    sweep.includes('outside_policy_window')
);
check(
  'Every reminder, lookup, escalation, and alert uses a deterministic action claim',
  sweep.includes('service_claim_refund_automation_action') &&
    sweep.includes('nayax_lookup:') &&
    sweep.includes('reminder:') &&
    sweep.includes('manager_aging:') &&
    managerAgingMigration.includes("'manager_reminder'") &&
    managerAgingMigration.includes("'manager_escalation'") &&
    sweep.includes('ops_alert:')
);
check(
  'Supabase owns a default-off primary clock while GitHub uses the same idempotent buckets',
  schedulerReliabilityMigration.includes('create table if not exists public.refund_automation_scheduler_settings') &&
    schedulerReliabilityMigration.includes('enabled boolean not null default false') &&
    schedulerReliabilityMigration.includes("'refund-automation-sweep-primary-v1'") &&
    schedulerReliabilityMigration.includes("'refund-automation-health-primary-v1'") &&
    schedulerReliabilityMigration.includes('service_dispatch_refund_automation_scheduler') &&
    schedulerReliabilityMigration.includes("'refund_automation_scheduler_url'") &&
    schedulerReliabilityMigration.includes("'refund_automation_scheduler_secret'") &&
    schedulerReliabilityMigration.includes("'scheduled:'") &&
    schedulerReliabilityMigration.includes("'health_check:'") &&
    schedulerCadenceMigration.includes("default interval '30 minutes'") &&
    schedulerCadenceMigration.includes('/ 1800) * 1800') &&
    schedulerCadenceMigration.includes("stale_after_minutes integer := 90") &&
    schedulerCadenceMigration.includes("'7,37 * * * *'") &&
    schedulerCadenceMigration.includes("'13,43 * * * *'")
);
check(
  'Scheduler incidents limit noise to one opening alert, daily reminders, and stable recovery',
  schedulerReliabilityMigration.includes('create table if not exists public.refund_automation_alert_incidents') &&
    schedulerReliabilityMigration.includes('refund_automation_alert_incidents_one_open_idx') &&
    schedulerReliabilityMigration.includes("default interval '24 hours'") &&
    schedulerReliabilityMigration.includes("default interval '60 minutes'") &&
    schedulerReliabilityMigration.includes("'notificationType', 'initial'") &&
    schedulerReliabilityMigration.includes("'notificationType', 'reminder'") &&
    schedulerReliabilityMigration.includes("'notificationType', 'recovery'") &&
    sweep.includes('service_claim_refund_automation_health_notification') &&
    sweep.includes('[Recovered] Refund automation scheduler healthy')
);
check(
  'Provider-delay status uses a service-only projection instead of direct protected-table access',
  schedulerIncidentMigration.includes(
    'service_list_due_refund_provider_delay_attempts'
  ) &&
    schedulerIncidentMigration.includes('security definer') &&
    schedulerIncidentMigration.includes('to service_role') &&
    schedulerIncidentMigration.includes('from public, anon, authenticated') &&
    sweep.includes('service_list_due_refund_provider_delay_attempts') &&
    !sweep.includes('.from("refund_case_nayax_refund_attempts")')
);
check(
  'Outside-policy clock heartbeats cannot clear an unresolved processing failure',
  schedulerIncidentMigration.includes("reason_counts ? 'outside_policy_window'") &&
    schedulerIncidentMigration.includes('latest_scheduler_heartbeat') &&
    schedulerIncidentMigration.includes('when consecutive_failures > 0 then \'failing\'') &&
    /await finishRun\(\s*runId,\s*"suppressed",\s*counters,\s*"outside_policy_window"/.test(
      sweep
    ) &&
    sweep.includes('failed_stage_${failureStage}') &&
    sweep.includes('failureStage = "provider_delay_status"')
);
check(
  'The response and alert paths expose aggregate redacted fields only',
  sweep.includes('payloadRedacted: true') &&
    sweep.includes('reasonCounts') &&
    managerNotification.includes('Customer PII, payment details, complaint text, and provider payloads are intentionally omitted')
);
check(
  'A safe failure-test mode exercises the ops alert without customer actions',
  sweep.includes('runFailureTest') &&
    sweep.includes('synthetic_failure_test') &&
    schedulerWorkflow.includes('failure_test')
);
check(
  'The scheduled sweep is versioned, serialized, and disabled by default',
  schedulerWorkflow.includes("cron: '7,37 * * * *'") &&
    schedulerWorkflow.includes('30 * 60 * 1000') &&
    sweep.includes('const intervalMs = 30 * 60 * 1000') &&
    schedulerWorkflow.includes('cancel-in-progress: false') &&
    schedulerWorkflow.includes("REFUND_AUTOMATION_SWEEP_ENABLED: ${{ vars.REFUND_AUTOMATION_SWEEP_ENABLED || 'false' }}") &&
    schedulerWorkflow.includes('REFUND_AUTOMATION_SWEEP_URL') &&
    schedulerWorkflow.includes('REFUND_AUTOMATION_SWEEP_TOKEN')
);
check(
  'Manual runs require a safe reusable key for executable duplicate-suppression proof',
  /run_key:\r?\n\s+description:[^\n]+\r?\n\s+required: true\r?\n\s+type: string/.test(schedulerWorkflow) &&
    schedulerWorkflow.includes("SWEEP_RUN_KEY: ${{ inputs.run_key || '' }}") &&
    schedulerWorkflow.includes("const manualRunKey = (process.env.SWEEP_RUN_KEY || '').trim()") &&
    schedulerWorkflow.includes("/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i") &&
    schedulerWorkflow.includes("triggerSource === 'scheduled'") &&
    schedulerWorkflow.includes('scheduledBucketKey') &&
    schedulerWorkflow.includes('.slice(0, 16)') &&
    schedulerWorkflow.includes('`scheduled:${scheduledBucketKey}`') &&
    schedulerWorkflow.includes("`${mode === 'failure_test' ? 'failure_test' : 'manual'}:${manualRunKey}`") &&
    !schedulerWorkflow.includes('`scheduled:${process.env.GITHUB_RUN_ID}`') &&
    !schedulerWorkflow.includes("`${mode === 'failure_test' ? 'failure_test' : triggerSource}:${process.env.GITHUB_RUN_ID}`")
);
check(
  'An independent 30-minute health workflow checks freshness and alerts stale runs',
  healthWorkflow.includes("cron: '13,43 * * * *'") &&
    healthWorkflow.includes('30 * 60 * 1000') &&
    healthWorkflow.includes("mode: 'health_check'") &&
    healthWorkflow.includes('.slice(0, 16)') &&
    healthWorkflow.includes('health_check:${scheduledBucketKey}') &&
    healthWorkflow.includes('lastSuccessAt') &&
    healthWorkflow.includes('notificationType') &&
    !healthWorkflow.includes('health_check:${process.env.GITHUB_RUN_ID}')
);
check(
  'Workflow logs are restricted to aggregate, non-customer fields',
  !schedulerWorkflow.includes('customerEmail') &&
    !schedulerWorkflow.includes('customerName') &&
    !schedulerWorkflow.includes('paymentReference') &&
    !healthWorkflow.includes('customerEmail')
);

for (const result of checks) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}`);
}

const failed = checks.filter((result) => !result.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} refund automation validation check(s) failed.`);
  process.exit(1);
}

console.log('\nRefund automation scheduler and health guardrails validated.');
