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
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
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
    sweep.includes('escalation:') &&
    sweep.includes('ops_alert:')
);
check(
  'The response and alert paths expose aggregate redacted fields only',
  sweep.includes('payloadRedacted: true') &&
    sweep.includes('reasonCounts') &&
    sweep.includes('Customer PII, payment details, complaint text, and provider payloads are intentionally omitted')
);
check(
  'A safe failure-test mode exercises the ops alert without customer actions',
  sweep.includes('runFailureTest') &&
    sweep.includes('synthetic_failure_test') &&
    schedulerWorkflow.includes('failure_test')
);
check(
  'The scheduled sweep is versioned, serialized, and disabled by default',
  schedulerWorkflow.includes("cron: '7,22,37,52 * * * *'") &&
    schedulerWorkflow.includes('cancel-in-progress: false') &&
    schedulerWorkflow.includes("REFUND_AUTOMATION_SWEEP_ENABLED: ${{ vars.REFUND_AUTOMATION_SWEEP_ENABLED || 'false' }}") &&
    schedulerWorkflow.includes('REFUND_AUTOMATION_SWEEP_URL') &&
    schedulerWorkflow.includes('REFUND_AUTOMATION_SWEEP_TOKEN')
);
check(
  'An independent hourly health workflow checks freshness and alerts stale runs',
  healthWorkflow.includes("cron: '43 * * * *'") &&
    healthWorkflow.includes("mode: 'health_check'") &&
    healthWorkflow.includes('health_check:${process.env.GITHUB_RUN_ID}') &&
    healthWorkflow.includes('lastSuccessAt')
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
