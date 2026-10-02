begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values('dd000000-0000-4000-8000-000000000004','authenticated','authenticated','correction-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type) values('dd000000-0000-4000-8000-000000000001','Scoped correction fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status) values('dd000000-0000-4000-8000-000000000002','dd000000-0000-4000-8000-000000000001','Correction fixture location','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,refund_intake_enabled,refund_public_display_label)
values('dd000000-0000-4000-8000-000000000003','dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','Scoped fixture machine','commercial','active',true,'Correction fixture machine');
insert into public.admin_roles(user_id,role,active) values('dd000000-0000-4000-8000-000000000004','super_admin',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason) values('dd000000-0000-4000-8000-000000000003','dd000000-0000-4000-8000-000000000004','correction-manager@example.invalid','Scoped correction fixture');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
create function pg_temp.make_scope(n integer, deliver boolean default true) returns uuid language plpgsql as $$
declare cid uuid:=('dd000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid; mid uuid:=gen_random_uuid(); cycle jsonb; c public.refund_cases;
begin
  insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,
    incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_wallet_used,card_network,status,correlation_status,intake_source)
  values(cid,'dd000000-0000-4000-8000-000000000003','dd000000-0000-4000-8000-000000000002','scope-customer-'||n||'@example.invalid','Scoped correction test',
    statement_timestamp()-interval '2 hours',to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
    'America/Los_Angeles','exact','exact','card','tap_card',
    case when n=12 then 700 else null end,case when n=12 then null else '1234' end,
    case when n=12 then null else 'physical_card' end,false,'visa','needs_review','manual_review','form');
  cycle:=public.service_claim_refund_follow_up_cycle(cid,'missing_information','refund_follow_up_v2',md5(n::text)||md5(n::text),null);
  if not coalesce((cycle->>'claimed')::boolean,false) then raise exception 'Fixture cycle rejected: %',cycle; end if;
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
  values(mid,cid,'more_info','pending','scope-customer-'||n||'@example.invalid','Please review your purchase','Scoped correction fixture','deterministic_template','automatic','missing_information','refund_follow_up_v2',(cycle#>>'{cycle,id}')::uuid,public.refund_missing_follow_up_fields(cid));
  select * into c from public.refund_cases where id=cid;
  perform public.service_issue_refund_purchase_correction(mid,lpad(to_hex(n),64,'0'),c.deterministic_fact_version);
  if deliver then update public.refund_case_messages set status='sent',sent_at=statement_timestamp() where id=mid; end if;
  if n=8 then
    -- Reproduce a legacy wallet-token assumption after the generic request was
    -- delivered, then rebind only this test capability to the current fact
    -- version. The production claim path correctly keeps wallet outreach on
    -- its dedicated secure flow.
    update public.refund_cases set payment_interaction='phone_watch_wallet',card_wallet_used=true,
      card_last4_provenance='wallet_device_token' where id=cid returning * into c;
    update public.refund_wallet_correction_contexts set correction_fact_version=c.deterministic_fact_version,
      correction_snapshot=public.refund_purchase_correction_values(c) where correction_message_id=mid;
  end if;
  return cid;
end; $$;
create function pg_temp.submit(n integer,answers jsonb) returns jsonb language sql as $$
 select public.service_submit_refund_purchase_correction(lpad(to_hex(n),64,'0'),
  (select correction_fact_version from public.refund_wallet_correction_contexts where token_hash=lpad(to_hex(n),64,'0')),answers);
$$;
select pg_temp.make_scope(1,true);
select pg_temp.submit(1,'{"amount":{"disposition":"changed","value":"7.00"},"card_network":{"disposition":"confirmed"},"payment_method":{"disposition":"confirmed"}}');
update public.refund_wallet_correction_contexts set correction_recheck_state='completed'
where token_hash=lpad('1',64,'0');

-- Observe only the value lookup in the submitted-response proof. The retained
-- earlier outreach layers still run unchanged and are not instrumented here.
create temporary sequence correction_value_evaluations;
create function pg_temp.read_values(c public.refund_cases) returns jsonb
language plpgsql stable as $$
begin
  perform nextval('pg_temp.correction_value_evaluations');
  return public.refund_purchase_correction_values(c);
end;
$$;
do $instrument$
declare
  definition text := replace(pg_get_functiondef('public.refund_customer_outreach_contract(uuid)'::regprocedure),E'\r\n',E'\n');
  prior_definition text;
  reuse_block text := $reuse$  -- Invalid dispositions already make this proof false. Do not build the
  -- catalog when no current-value comparison can make the response complete.
  if not exists (
    select 1 from jsonb_each(context_row.correction_response) answer
    where coalesce(answer.value ->> 'disposition', '')
      not in ('changed', 'confirmed')
  ) then
    correction_values := public.refund_purchase_correction_values(case_row);
  end if;

  response_complete := not exists ($reuse$;
begin
  if cardinality(string_to_array(definition,reuse_block))<>2 then
    raise exception 'Expected current outreach reuse definition';
  end if;
  prior_definition := replace(definition,E'\n  correction_values jsonb;','');
  prior_definition := replace(prior_definition,reuse_block,'  response_complete := not exists (');
  prior_definition := replace(prior_definition,'correction_values ->> answer.key',
    'public.refund_purchase_correction_values(case_row) ->> answer.key');
  execute replace(replace(prior_definition,
    'public.refund_customer_outreach_contract(', 'pg_temp.prior_outreach('),
    'public.refund_purchase_correction_values(case_row)', 'pg_temp.read_values(case_row)');
  execute replace(replace(definition,
    'public.refund_customer_outreach_contract(', 'pg_temp.current_outreach('),
    'public.refund_purchase_correction_values(case_row)', 'pg_temp.read_values(case_row)');
end;
$instrument$;
create function pg_temp.require_ok(value text) returns text language plpgsql as $$
begin
  if value is null or value not like 'ok %' then raise exception 'TAP assertion failed: %',value; end if;
  return value;
end;
$$;
create function pg_temp.parity(label text,expected_calls bigint,minimum_prior_calls bigint default 0)
returns setof text language plpgsql as $$
declare
  cid uuid := 'dd000000-0000-4000-8001-000000000001';
  prior jsonb; current_result jsonb; prior_calls bigint; current_calls bigint;
begin
  perform setval('pg_temp.correction_value_evaluations',1,false);
  prior := pg_temp.prior_outreach(cid);
  select case when is_called then last_value else 0 end into prior_calls from correction_value_evaluations;
  perform setval('pg_temp.correction_value_evaluations',1,false);
  current_result := pg_temp.current_outreach(cid);
  select case when is_called then last_value else 0 end into current_calls from correction_value_evaluations;
  return next pg_temp.require_ok(extensions.is(current_result,prior,label||': complete JSON parity'));
  return next pg_temp.require_ok(extensions.is(current_calls,expected_calls,label||': exact current value evaluations'));
  return next pg_temp.require_ok(extensions.ok(prior_calls>=minimum_prior_calls,label||': original evaluation reproduction'));
end;
$$;
create temporary table business_before as select
  (select jsonb_agg(to_jsonb(c) order by id) from public.refund_cases c) cases,
  (select jsonb_agg(to_jsonb(m) order by id) from public.refund_case_messages m) messages,
  (select jsonb_agg(to_jsonb(e) order by id) from public.refund_case_events e) events;
select * from pg_temp.parity('Three matching changed/confirmed answers',1,3);
select pg_temp.require_ok(is(pg_temp.current_outreach('dd000000-0000-4000-8001-000000000001')->>'reasonCode',
  'verified_form_response_applied','Completed current response retains verified continuation'));

savepoint confirmed_null;
update public.refund_wallet_correction_contexts
set correction_response=correction_response||'{"wallet_device_kind":{"disposition":"confirmed"}}'
where token_hash=lpad('1',64,'0');
select * from pg_temp.parity('Confirmed missing/null snapshot value',1,4);
rollback to confirmed_null;

savepoint changed_mismatch;
update public.refund_wallet_correction_contexts
set correction_response='{"amount":{"disposition":"changed","value":"8.00"}}'
where token_hash=lpad('1',64,'0');
select * from pg_temp.parity('Changed value differs from saved case',1,1);
select pg_temp.require_ok(isnt(pg_temp.current_outreach('dd000000-0000-4000-8001-000000000001')->>'reasonCode',
  'verified_form_response_applied','Mismatched value cannot complete the proof'));
rollback to changed_mismatch;

savepoint confirmed_mismatch;
update public.refund_wallet_correction_contexts
set correction_response='{"amount":{"disposition":"confirmed"}}',
  correction_snapshot=jsonb_set(correction_snapshot,'{amount}','"8.00"')
where token_hash=lpad('1',64,'0');
select * from pg_temp.parity('Confirmed value differs from original snapshot',1,1);
rollback to confirmed_mismatch;

savepoint malformed;
update public.refund_wallet_correction_contexts
set correction_response=correction_response||'{"legacy_missing_disposition":{}}'
where token_hash=lpad('1',64,'0');
select * from pg_temp.parity('Missing disposition still rejects without catalog work',0);
rollback to malformed;

savepoint cannot_provide;
update public.refund_wallet_correction_contexts
set correction_response='{"amount":{"disposition":"cannot_provide"}}'
where token_hash=lpad('1',64,'0');
select * from pg_temp.parity('Cannot-provide remains unfinished',0);
rollback to cannot_provide;

savepoint empty_response;
update public.refund_wallet_correction_contexts set correction_response='{}'
where token_hash=lpad('1',64,'0');
select * from pg_temp.parity('Empty response retains earlier result',0);
rollback to empty_response;

savepoint missing_required_answer;
update public.refund_cases set payment_amount_cents=null
where id='dd000000-0000-4000-8001-000000000001';
update public.refund_wallet_correction_contexts
set correction_response=correction_response-'amount',
  correction_resulting_fact_version=(select deterministic_fact_version
    from public.refund_cases where id='dd000000-0000-4000-8001-000000000001')
where token_hash=lpad('1',64,'0');
select pg_temp.require_ok(ok('amount'=any(public.refund_purchase_correction_request_fields(
  'dd000000-0000-4000-8001-000000000001')),
  'Current required amount answer remains missing in the fixture'));
select * from pg_temp.parity('Still-required missing answer retains early return',0);
select pg_temp.require_ok(isnt(pg_temp.current_outreach(
  'dd000000-0000-4000-8001-000000000001')->>'reasonCode',
  'verified_form_response_applied','Missing required answer cannot complete the proof'));
rollback to missing_required_answer;

savepoint stale_fact;
update public.refund_wallet_correction_contexts
set correction_resulting_fact_version=correction_resulting_fact_version-1
where token_hash=lpad('1',64,'0');
select * from pg_temp.parity('Stale fact retains earlier result',0);
rollback to stale_fact;

select pg_temp.require_ok(is(
  (select jsonb_agg(to_jsonb(c) order by id) from public.refund_cases c),
  (select cases from business_before),'Read-model optimization preserves all case facts/decisions'));
select pg_temp.require_ok(is(
  (select jsonb_agg(to_jsonb(m) order by id) from public.refund_case_messages m),
  (select messages from business_before),'No message or delivery mutation'));
select pg_temp.require_ok(is(
  (select jsonb_agg(to_jsonb(e) order by id) from public.refund_case_events e),
  (select events from business_before),'No business event mutation'));
select pg_temp.require_ok(ok(has_function_privilege('service_role',
  'public.refund_customer_outreach_contract(uuid)','execute')
  and not has_function_privilege('anon','public.refund_customer_outreach_contract(uuid)','execute')
  and not has_function_privilege('authenticated','public.refund_customer_outreach_contract(uuid)','execute'),
  'Existing outreach service-only authority is preserved'));
select * from finish();
rollback;
