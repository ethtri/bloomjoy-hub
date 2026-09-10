-- Disposable database only: committed fixtures are required by dblink sessions.
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;

do $$ declare c text:='host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable';
begin perform extensions.dblink_connect('outreach_guard',c); perform extensions.dblink_disconnect('outreach_guard'); end; $$;

begin;
drop schema if exists refund_outreach_race_test cascade;
create schema refund_outreach_race_test;
create table refund_outreach_race_test.fixture(cycle_id uuid primary key);
create table refund_outreach_race_test.results(lane text primary key,payload jsonb not null);
insert into public.customer_accounts(id,name,account_type) values('b8900000-0000-4000-8000-000000000001','Outreach race','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status) values('b8900000-0000-4000-8000-000000000002','b8900000-0000-4000-8000-000000000001','Race place','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,refund_intake_enabled,refund_public_display_label)
values('b8900000-0000-4000-8000-000000000003','b8900000-0000-4000-8000-000000000001','b8900000-0000-4000-8000-000000000002','Race machine','commercial','active',true,'Race machine');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,
  incident_local_datetime,incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_amount_cents,
  zelle_payment_contact,card_wallet_used,status,correlation_status,correlation_source,correlation_summary,cash_match_evaluated_fact_version,intake_source)
values('b8900000-0000-4000-8000-000000000010','RF-OUTREACH-RACE','b8900000-0000-4000-8000-000000000003','b8900000-0000-4000-8000-000000000002',
  'race@example.invalid','Exact message/suppression race',statement_timestamp()-interval '2 hours',
  to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
  'America/Los_Angeles','exact','exact','cash',700,'race@example.invalid',false,'needs_review','no_match','sunze','No matching local cash sale.',1,'form');
insert into refund_outreach_race_test.fixture
select (public.service_claim_refund_follow_up_cycle('b8900000-0000-4000-8000-000000000010','no_safe_match',
  (select template_version from public.refund_customer_contact_settings where singleton),repeat('c',64),null)#>>'{cycle,id}')::uuid;

create function refund_outreach_race_test.insert_message() returns jsonb language plpgsql as $$
begin
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,
    reason_code,template_version,follow_up_cycle_id,requested_fields)
  select 'b8900000-0000-4000-8000-000000000020','b8900000-0000-4000-8000-000000000010','no_safe_match','pending','race@example.invalid',
    'Update on your request','Safe fixture','deterministic_template','automatic',cycle.reason_code,cycle.template_version,cycle.id,cycle.requested_fields
  from public.refund_follow_up_cycles cycle where cycle.id=(select cycle_id from refund_outreach_race_test.fixture);
  return jsonb_build_object('ok',true,'outcome','message');
exception when others then return jsonb_build_object('ok',false,'sqlstate',sqlstate); end; $$;
create function refund_outreach_race_test.settle() returns jsonb language plpgsql as $$
begin
  return public.service_settle_refund_follow_up_pre_message_suppression('b8900000-0000-4000-8000-000000000010',
    (select cycle_id from refund_outreach_race_test.fixture),'no_customer_correctable_fact')||jsonb_build_object('ok',true,'outcome','settlement');
exception when others then return jsonb_build_object('ok',false,'sqlstate',sqlstate); end; $$;
commit;

select plan(6);
select extensions.dblink_connect('outreach_message','host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_connect('outreach_settle','host=db port='||current_setting('port')||' dbname='||current_database()||' user=postgres password=postgres sslmode=disable');
select extensions.dblink_send_query('outreach_message','select refund_outreach_race_test.insert_message()');
select extensions.dblink_send_query('outreach_settle','select refund_outreach_race_test.settle()');
insert into refund_outreach_race_test.results select 'message',payload from extensions.dblink_get_result('outreach_message') result(payload jsonb);
insert into refund_outreach_race_test.results select 'settle',payload from extensions.dblink_get_result('outreach_settle') result(payload jsonb);

select is((select count(*)::integer from refund_outreach_race_test.results where (payload->>'ok')::boolean),1,
  'Exactly one of real message creation or pre-message settlement wins');
select is((select count(*)::integer from public.refund_case_messages where id='b8900000-0000-4000-8000-000000000020')+
  (select count(*)::integer from public.refund_case_events where refund_case_id='b8900000-0000-4000-8000-000000000010' and event_type='refund_follow_up_pre_message_suppressed'),1,
  'Race persists exactly one causal effect');
select ok((select (status='claimed' and request_message_id='b8900000-0000-4000-8000-000000000020')
    or (status='manual_review' and request_message_id is null)
  from public.refund_follow_up_cycles where id=(select cycle_id from refund_outreach_race_test.fixture)),
  'Cycle truth agrees with the winning writer');
select ok(public.refund_customer_outreach_contract('b8900000-0000-4000-8000-000000000010')->>'state' in('queued','policy_suppressed'),
  'Projection reports the winning durable state');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id='b8900000-0000-4000-8000-000000000010'),
  (select count(*)::integer from public.refund_case_messages where id='b8900000-0000-4000-8000-000000000020'),'No unrelated message is created');
select is((select count(*)::integer from public.refund_case_events where refund_case_id='b8900000-0000-4000-8000-000000000010'
  and event_type='refund_follow_up_pre_message_suppressed'),
  case when exists(select 1 from public.refund_case_messages where id='b8900000-0000-4000-8000-000000000020') then 0 else 1 end,
  'Settlement event exists only when settlement wins');

select extensions.dblink_disconnect('outreach_message');
select extensions.dblink_disconnect('outreach_settle');
select * from finish();
begin;
delete from public.refund_cases where id='b8900000-0000-4000-8000-000000000010';
delete from public.reporting_machines where id='b8900000-0000-4000-8000-000000000003';
delete from public.reporting_locations where id='b8900000-0000-4000-8000-000000000002';
delete from public.customer_accounts where id='b8900000-0000-4000-8000-000000000001';
drop schema refund_outreach_race_test cascade;
commit;
