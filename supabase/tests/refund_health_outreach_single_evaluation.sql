begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create function pg_temp.health() returns jsonb language sql volatile as $$
  select public.service_get_refund_workflow_health(
    true,true,true,true,true,'{}'::text[],statement_timestamp());
$$;
create function pg_temp.health_at(p_observed_at timestamptz)
returns jsonb language sql volatile as $$
  select public.service_get_refund_workflow_health(
    true,true,true,true,true,'{}'::text[],p_observed_at);
$$;
insert into public.refund_automation_runs(
  run_key,trigger_source,scheduled_for,started_at,finished_at,status,reason_counts)
values('scheduled:clarification-health','scheduled',now(),now(),now(),
  'succeeded','{}'::jsonb);
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true where singleton;

insert into public.customer_accounts(id,name,account_type)
values('e1100000-0000-4000-8000-000000000001','Clarification health test','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values('e1200000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001','Clarification health location',
  'America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label)
values('e1300000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001','Clarification health machine');
insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,status,intake_source,incident_at,
  incident_local_datetime,incident_timezone,incident_time_resolution,
  incident_time_confidence,payment_method,payment_interaction,card_last4,
  card_last4_provenance,card_wallet_used,card_network,correlation_status
) values (
  'e1400000-0000-4000-8000-000000000001','RF-CLARIFICATION-HEALTH',
  'e1300000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001',
  'clarification-health@example.invalid','Synthetic clarification',
  'needs_review','gmail',now()-interval '2 hours',
  to_char((now()-interval '2 hours') at time zone 'America/Los_Angeles',
    'YYYY-MM-DD"T"HH24:MI'),
  'America/Los_Angeles','exact','exact','card','tap_card','1234',
  'physical_card',false,'visa','manual_review'
);
create temp table clarification_fixture as
select public.service_claim_refund_follow_up_cycle(
  'e1400000-0000-4000-8000-000000000001','missing_information',
  (select template_version from public.refund_customer_contact_settings
   where singleton),repeat('e',64),null) value;
select is((select value->>'claimed' from clarification_fixture),'true',
  'The existing follow-up cycle claims the current missing-information request');

-- Instrument the retained outreach contract inside this disposable transaction.
-- A stable contract may be copied into many predicates when its lateral SQL
-- subquery is pulled up. The sequence observes those real executor invocations.
create temporary sequence outreach_evaluations;
do $instrument$
declare definition text;
begin
  definition := pg_get_functiondef('public.refund_customer_outreach_contract(uuid)'::regprocedure);
  execute replace(definition,'public.refund_customer_outreach_contract(', 'pg_temp.original_outreach_contract(');
  definition := pg_get_functiondef('public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamptz)'::regprocedure);
  execute replace(replace(definition,
    'public.service_get_refund_clarification_contact_obligation_health(', 'pg_temp.health_before_barrier('),
    'truth offset 0) o', 'truth) o');
end;
$instrument$;
create or replace function public.refund_customer_outreach_contract(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform nextval('pg_temp.outreach_evaluations');
  return pg_temp.original_outreach_contract(p_refund_case_id);
end;
$$;
create function pg_temp.clarification_health(p_enabled boolean default true,
  p_observed_at timestamptz default statement_timestamp())
returns jsonb language sql volatile as $$
  select public.service_get_refund_clarification_contact_obligation_health(true,p_enabled,p_observed_at);
$$;
create temp table prior_health as
select pg_temp.health_before_barrier(true,true,statement_timestamp()) value;
create temp table prior_evaluations as select last_value calls from outreach_evaluations;
select setval('pg_temp.outreach_evaluations',1,false);
create temp table current_health as select pg_temp.clarification_health() value;
select is((select value from current_health),(select value from prior_health),
  'Single evaluation preserves the complete clarification health payload');
select is((select last_value from outreach_evaluations),1::bigint,
  'One eligible case evaluates its outreach contract exactly once');
select ok((select calls from prior_evaluations) > (select last_value from outreach_evaluations),
  'The former inlined projection demonstrably repeated the same outreach work');
select is(pg_temp.clarification_health(false)->>'policySuppressedCount','1',
  'Disabled required contact remains an actionable obligation');
select is(pg_temp.clarification_health(true,statement_timestamp()+interval '2 hours')->>'agingPreparingCount','1',
  'Aging preparation keeps its existing delivery obligation');
select is(pg_temp.clarification_health()->>'payloadRedacted','true',
  'Single evaluation keeps health evidence redacted');
select ok(not has_function_privilege('authenticated',
  'public.service_get_refund_clarification_contact_obligation_health(boolean,boolean,timestamptz)','execute'),
  'The optimized health contract remains service-only');
select * from finish();
rollback;
