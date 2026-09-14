import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('./fixtures/refund-populated-delivery-upgrade.sql', import.meta.url));
const familiesFixturePath = fileURLToPath(new URL('./fixtures/refund-populated-message-families.sql', import.meta.url));
export const HISTORICAL_MESSAGE_GUARDS = [
  ['202608040004_refund_nayax_provider_orchestration.sql', 'guard_nayax_attempt_completion_message'],
  ['20260812210000_refund_legacy_card_state_normalization.sql', 'guard_refund_legacy_state_message'],
  ['20260821100000_refund_branded_appeals.sql', 'guard_refund_denial_appeal_message'],
  ['202608030005_refund_deterministic_follow_up_cycles.sql', 'guard_refund_follow_up_message'],
  ['202608030005_refund_deterministic_follow_up_cycles.sql', 'guard_refund_follow_up_cycle'],
  ['202608030005_refund_deterministic_follow_up_cycles.sql', 'sync_refund_follow_up_cycle_from_message'],
  ['202608030005_refund_deterministic_follow_up_cycles.sql', 'service_claim_due_refund_follow_up_reminders'],
];

export function readHistoricalMessageGuards(repoRoot) {
  return HISTORICAL_MESSAGE_GUARDS.map(([file, name]) => {
    const source = fs.readFileSync(path.join(repoRoot, 'supabase/migrations', file), 'utf8').replaceAll('\r\n', '\n');
    const start = source.indexOf(`create or replace function public.${name}(`);
    const end = source.indexOf('\n$$;', start);
    if (start < 0 || end < start) throw new Error(`Historical message guard boundary missing: ${name}`);
    return source.slice(start, end + 4);
  }).join('\n\n');
}
export const POPULATED_DELIVERY_UPGRADE_TEST = 'refund_populated_delivery_upgrade.sql';
export const SETTLED_COMPLETION_DELIVERY_TEST = 'refund_settled_completion_delivery.sql';

export function buildSettledCompletionDeliveryTest(singleGateTest) {
  const normalized = singleGateTest.replaceAll('\r\n', '\n');
  const boundary = normalized.indexOf('create temp table second_claim as');
  if (boundary < 0 || !normalized.slice(0, boundary).includes("'no-start reclaim keeps the same created row'")) {
    throw new Error('Exact current System-attempt fixture boundary is required.');
  }
  const prefix = normalized.slice(0, boundary).replace(/select plan\(\d+\);/u, 'select no_plan();');
  if (/select plan\(/u.test(prefix) || /session_replication_role|disable\s+trigger/iu.test(prefix)) {
    throw new Error('System-attempt fixture must retain all enabled guards and use a dynamic plan.');
  }
  const settlement = `
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,
  thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('a3490000-0000-4000-8000-000000000001','a3470000-0000-4000-8000-000000000001',
  repeat('b',64),'single-gate-original-thread','Original customer thread',
  statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days',
  statement_timestamp()+interval '180 days');
create temporary table pg_temp.nayax_provider_results(result_key text primary key,result jsonb not null);
grant select on pg_temp.nayax_provider_results to service_role;
insert into pg_temp.nayax_provider_results
select 'success-reserve',(public.service_claim_due_nayax_refund_attempts_v1(
  'single-gate-executor','SINGLE_GATE_ACCOUNT','exact_source','empty_string',1)->'claims'->0);
create function pg_temp.record_single_gate_success_stage(
  p_stage text,p_event text,p_outcome text
) returns jsonb language sql as $$
select public.service_record_nayax_refund_provider_stage_v4_diagnostics(
  p_executor_assertion=>'single-gate-executor',
  p_attempt_id=>(select (result->>'attemptId')::uuid from pg_temp.nayax_provider_results where result_key='success-reserve'),
  p_provider_claim_token=>(select result->>'providerClaimToken' from pg_temp.nayax_provider_results where result_key='success-reserve'),
  p_stage=>p_stage,p_event=>p_event,
  p_http_status=>case when p_event='result' then 200 end,
  p_outcome=>case when p_event='result' then p_outcome end,
  p_contract_matched=>case when p_event='result' then true end,
  p_failure_type=>null,
  p_classification_digest=>md5(p_stage||'|'||p_event)||md5(p_stage||'|'||p_event),
  p_provider_contract_version=>'nayax-production-account-contract-v2',
  p_journal_contract_version=>'nayax-provider-journal-v3',
  p_http_accepted=>case when p_event='result' then true end,
  p_media_type_class=>case when p_event='result' then 'application_json' end,
  p_body_kind=>case when p_event='result' then 'json_object' end,
  p_body_length_bucket=>case when p_event='result' then '1_256' end,
  p_json_parsed=>case when p_event='result' then true end,
  p_json_object=>case when p_event='result' then true end,
  p_schema_matched=>case when p_event='result' then true end,
  p_result_key_present=>case when p_event='result' then true end,
  p_status_key_present=>case when p_event='result' then true end,
  p_result_value_type=>case when p_event='result' then 'string' end,
  p_status_value_type=>case when p_event='result' then 'string' end,
  p_semantic_pair_matched=>case when p_event='result' then true end,
  p_business_result=>case when p_event='result'
    then 'Refund status updated successfully, but the email could not be sent' end,
  p_business_status=>case when p_event='result' then 'Partial success' end,
  p_business_pair_retained=>(p_event='result'),
  p_observed_result_scalar=>case when p_event='result'
    then 'Refund status updated successfully, but the email could not be sent' end,
  p_observed_status_scalar=>case when p_event='result' then 'Partial success' end,
  p_observed_scalar_pair_retained=>(p_event='result'),
  p_result_diagnostic_text=>case when p_event='result'
    then 'Refund status updated successfully, but the email could not be sent' end,
  p_result_diagnostic_disposition=>case when p_event='result' then 'exact' end,
  p_result_diagnostic_length_bucket=>case when p_event='result' then '1_80' end,
  p_status_diagnostic_text=>case when p_event='result' then 'Partial success' end,
  p_status_diagnostic_disposition=>case when p_event='result' then 'exact' end,
  p_status_diagnostic_length_bucket=>case when p_event='result' then '1_80' end)
$$;
select pg_temp.record_single_gate_success_stage('request','started',null);
select pg_temp.record_single_gate_success_stage('request','result','accepted');
select pg_temp.record_single_gate_success_stage('approve','started',null);
select pg_temp.record_single_gate_success_stage('approve','result','succeeded');
insert into pg_temp.nayax_provider_results
select 'success-settle',public.service_settle_nayax_refund_attempt(
  'single-gate-executor',(select (result->>'attemptId')::uuid from pg_temp.nayax_provider_results where result_key='success-reserve'),
  (select (result->'authorization'->>'authorizationId')::uuid from pg_temp.nayax_provider_results where result_key='success-reserve'),
  'a3470000-0000-4000-8000-000000000001',
  (select result#>>'{providerWireContext,idempotencyKey}' from pg_temp.nayax_provider_results where result_key='success-reserve'),
  1090,'USD',(select result->>'providerClaimToken' from pg_temp.nayax_provider_results where result_key='success-reserve'),
  'success','SINGLE-GATE-SUCCESS-1','approve_succeeded_contract_match',null);
insert into pg_temp.nayax_provider_results
select 'completion-claim',public.service_claim_nayax_refund_completion(
  'single-gate-executor',(select (result->>'attemptId')::uuid from pg_temp.nayax_provider_results where result_key='success-reserve'));
insert into pg_temp.nayax_provider_results
select 'completion-claim-replay',public.service_claim_nayax_refund_completion(
  'single-gate-executor',(select (result->>'attemptId')::uuid from pg_temp.nayax_provider_results where result_key='success-reserve'));
`;
  const delivery = fs.readFileSync(fileURLToPath(new URL('./fixtures/refund-settled-completion-delivery.sql', import.meta.url)), 'utf8')
    .replaceAll('\r\n', '\n')
    .replaceAll('9a600000-0000-4000-8000-000000000001', 'a3470000-0000-4000-8000-000000000001')
    .replaceAll('9aa00000-0000-4000-8000-000000000001', 'a3490000-0000-4000-8000-000000000001')
    .replaceAll('$7.00', '$10.90');
  return `${prefix}${settlement}${delivery}`;
}

export function writeSettledCompletionDeliveryTest(repoRoot, tempRoot) {
  const source = buildSettledCompletionDeliveryTest(fs.readFileSync(path.join(repoRoot, 'supabase/tests/refund_single_manager_gate.sql'), 'utf8'));
  const testPath = path.join(tempRoot, 'supabase', 'tests', SETTLED_COMPLETION_DELIVERY_TEST);
  fs.writeFileSync(testPath, source, { encoding: 'utf8', flag: 'wx' });
  return { testPath, testRelativePath: path.posix.join('supabase', 'tests', SETTLED_COMPLETION_DELIVERY_TEST) };
}

export function buildPopulatedDeliveryUpgradeTest({ historicalGuardMigration, deliveryMigration, historicalMessageGuards = readHistoricalMessageGuards(fileURLToPath(new URL('../../', import.meta.url))) }) {
  const guardStart = historicalGuardMigration.indexOf('create or replace function public.guard_refund_customer_status_message()');
  const guardEnd = historicalGuardMigration.indexOf('\nrevoke all on function public.guard_refund_customer_status_message()', guardStart);
  const backfillStart = deliveryMigration.indexOf('update public.refund_case_messages message\nset\n');
  const backfillEnd = deliveryMigration.indexOf('\ncreate table if not exists public.refund_transactional_delivery_events', backfillStart);
  if (guardStart < 0 || guardEnd < guardStart || backfillStart < 0 || backfillEnd < backfillStart) {
    throw new Error('Exact historical guard and populated delivery migration boundaries are required.');
  }
  const replacements = {
    HISTORICAL_GUARD: historicalGuardMigration.slice(guardStart, guardEnd).trim(),
    ORIGINAL_BACKFILL: deliveryMigration.slice(backfillStart, backfillEnd).trim(),
    CURRENT_DELIVERY_PREFIX: deliveryMigration.slice(0, backfillEnd).trim(),
    HISTORICAL_FAMILY_GUARDS: historicalMessageGuards,
    FAMILY_ORIGINAL_BACKFILL: deliveryMigration.slice(backfillStart, backfillEnd).trim(),
    FAMILY_CURRENT_DELIVERY_PREFIX: deliveryMigration.slice(0, backfillEnd).trim(),
  };
  let fixture = fs.readFileSync(fixturePath, 'utf8').replaceAll('\r\n', '\n');
  fixture = fixture.replace('select * from finish();', () => `${fs.readFileSync(familiesFixturePath, 'utf8').replaceAll('\r\n', '\n')}\nselect * from finish();`);
  for (const [name, sql] of Object.entries(replacements)) {
    const marker = `/* __${name}__ */`;
    if (fixture.split(marker).length !== 2 || sql.includes('$delivery_upgrade$')) {
      throw new Error(`Unsafe or ambiguous populated-upgrade fixture source: ${name}.`);
    }
    fixture = fixture.replace(marker, () => sql);
  }
  if (/\/\* __[A-Z_]+__ \*\//u.test(fixture)) {
    throw new Error('Unresolved populated-upgrade fixture source.');
  }
  return fixture;
}

export function writePopulatedDeliveryUpgradeTest(repoRoot, tempRoot) {
  const readMigration = (name) => fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', name), 'utf8').replaceAll('\r\n', '\n');
  const source = buildPopulatedDeliveryUpgradeTest({
    historicalGuardMigration: readMigration('20260901202359_refund_provider_delay_evidence_1069.sql'),
    deliveryMigration: readMigration('20260901070000_refund_transactional_delivery_truth.sql'),
    historicalMessageGuards: readHistoricalMessageGuards(repoRoot),
  });
  const testPath = path.join(tempRoot, 'supabase', 'tests', POPULATED_DELIVERY_UPGRADE_TEST);
  fs.writeFileSync(testPath, source, { encoding: 'utf8', flag: 'wx' });
  return { testPath, testRelativePath: path.posix.join('supabase', 'tests', POPULATED_DELIVERY_UPGRADE_TEST) };
}
