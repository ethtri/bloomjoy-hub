begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(25);

insert into public.customer_accounts(id,name,account_type) values('dd000000-0000-4000-8000-000000000001','Scoped correction fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status) values('dd000000-0000-4000-8000-000000000002','dd000000-0000-4000-8000-000000000001','Correction fixture location','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,refund_intake_enabled,refund_public_display_label)
values('dd000000-0000-4000-8000-000000000003','dd000000-0000-4000-8000-000000000001','dd000000-0000-4000-8000-000000000002','Scoped fixture machine','commercial','active',true,'Correction fixture machine');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
create function pg_temp.make_scope(n integer, deliver boolean default true) returns uuid language plpgsql as $$
declare cid uuid:=('dd000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid; mid uuid:=gen_random_uuid(); cycle jsonb; c public.refund_cases;
begin
  insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,
    incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_network,status,correlation_status,intake_source)
  values(cid,'dd000000-0000-4000-8000-000000000003','dd000000-0000-4000-8000-000000000002','scope-customer@example.invalid','Scoped correction test',
    statement_timestamp()-interval '2 hours',to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
    'America/Los_Angeles','exact','exact','card','tap_card',null,'1234','physical_card','visa','needs_review','manual_review','form');
  cycle:=public.service_claim_refund_follow_up_cycle(cid,'missing_information','refund_follow_up_v2',md5(n::text)||md5(n::text),null);
  if not coalesce((cycle->>'claimed')::boolean,false) then raise exception 'Fixture cycle rejected: %',cycle; end if;
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
  values(mid,cid,'more_info','pending','scope-customer@example.invalid','Please review your purchase','Scoped correction fixture','deterministic_template','automatic','missing_information','refund_follow_up_v2',(cycle#>>'{cycle,id}')::uuid,array['amount']);
  select * into c from public.refund_cases where id=cid;
  perform public.service_issue_refund_purchase_correction(mid,lpad(to_hex(n),64,'0'),c.deterministic_fact_version);
  if deliver then update public.refund_case_messages set status='sent',sent_at=statement_timestamp() where id=mid; end if;
  return cid;
end; $$;
create function pg_temp.submit(n integer,answers jsonb) returns jsonb language sql as $$
 select public.service_submit_refund_purchase_correction(lpad(to_hex(n),64,'0'),
  (select correction_fact_version from public.refund_wallet_correction_contexts where token_hash=lpad(to_hex(n),64,'0')),answers);
$$;
select pg_temp.make_scope(n,n<>2) from generate_series(1,8) n;

select ok(not has_function_privilege('anon','public.service_submit_refund_purchase_correction(text,bigint,jsonb)','execute')
 and not has_function_privilege('authenticated','public.service_get_refund_purchase_correction(text)','execute'),'Public roles cannot invoke correction service RPCs');
select ok(not has_table_privilege('anon','public.refund_wallet_correction_contexts','select'),'Capability table remains private');
select is(public.service_get_refund_purchase_correction(repeat('f',64))->>'state','unavailable','Unknown capability reveals no case');
select is(public.service_get_refund_purchase_correction(lpad('2',64,'0'))->>'state','unavailable','Prepared but unsent link cannot view or submit');
select throws_like($$select pg_temp.submit(2,'{"amount":{"disposition":"changed","value":"7.00"}}')$$,'%stale or unavailable%','Unsent scope cannot write');
select is(public.service_get_refund_purchase_correction(lpad('1',64,'0'))->>'state','ready','Sent current scope opens');
select ok(not (public.service_get_refund_purchase_correction(lpad('1',64,'0')) ?| array['customerEmail','refundCaseId','reportingMachineId']),'Inspection does not reveal recipient or internal identifiers');
select throws_like($$select pg_temp.submit(1,'{"amount":{"disposition":"changed","value":"7.00"},"decision":{"disposition":"changed","value":"approved"}}')$$,'%Unsupported correction answer%','Client cannot approve or write arbitrary fields');
select throws_like($$select pg_temp.submit(1,'{"amount":{"disposition":"changed","value":"7.00"},"card_last4":{"disposition":"changed","value":"1234567890123456"}}')$$,'%Invalid correction value%','Full card values are rejected atomically');
select lives_ok($$select pg_temp.submit(1,'{"amount":{"disposition":"changed","value":"7.00"},"payment_interaction":{"disposition":"changed","value":"phone_watch_wallet"},"card_last4":{"disposition":"changed","value":"1234"},"wallet_provider":{"disposition":"changed","value":"apple_pay"}}')$$,'Same digits explicitly re-entered for wallet preserve new provenance');
select ok((select card_last4='1234' and card_last4_provenance='wallet_device_token' and wallet_provider='apple_pay' and decision is null and refund_amount_cents is null
 from public.refund_cases where id='dd000000-0000-4000-8001-000000000001'),'Wallet context changes without approval or payment amount side effects');
select is(public.service_get_refund_purchase_correction(lpad('1',64,'0'))->>'state','received','Submission consumes write scope');
select is(pg_temp.submit(1,'{}')->>'state','received','Replay returns the saved result without new case or mutation');
select is((select count(*)::integer from public.refund_case_events where refund_case_id='dd000000-0000-4000-8001-000000000001' and event_type='purchase_correction_received'),1,'Replay creates one durable response event');
select lives_ok($$select pg_temp.submit(3,'{"amount":{"disposition":"cannot_provide"}}')$$,'Uncertainty is a valid same-case response');
select ok((select correction_next_action='review' and correction_recheck_state is null from public.refund_wallet_correction_contexts where token_hash=lpad('3',64,'0')),'Unknown answer remains human-owned without automatic lookup');
select is(public.refund_purchase_correction_request_fields('dd000000-0000-4000-8001-000000000003'),'{}'::text[],'Do not ask answered uncertain field again');
select lives_ok($$select pg_temp.submit(4,jsonb_build_object('amount',jsonb_build_object('disposition','changed','value','7.00'),'incident_time',jsonb_build_object('disposition','changed','value',to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','HH24:MI'),'confidence','rough')))$$,'A rough corrected time is accepted as uncertainty');
select ok((select incident_time_confidence='rough' and decision is null from public.refund_cases where id='dd000000-0000-4000-8001-000000000004')
 and (select correction_next_action='review' from public.refund_wallet_correction_contexts where token_hash=lpad('4',64,'0')),'New rough time never inherits precise matching confidence');
update public.refund_cases set payment_amount_cents=900 where id='dd000000-0000-4000-8001-000000000005';
select is(public.service_get_refund_purchase_correction(lpad('5',64,'0'))->>'state','unavailable','Concurrent fact edit invalidates old scope');
select throws_like($$select pg_temp.submit(5,'{"amount":{"disposition":"changed","value":"7.00"}}')$$,'%stale or unavailable%','Stale submission cannot overwrite newer facts');
update public.refund_wallet_correction_contexts set issued_at=statement_timestamp()-interval '49 hours',expires_at=statement_timestamp()-interval '1 hour' where token_hash=lpad('6',64,'0');
select is(public.service_get_refund_purchase_correction(lpad('6',64,'0'))->>'state','unavailable','Expired link has no active read/write scope');
select ok((select status='manual_review' from public.refund_follow_up_cycles where refund_case_id='dd000000-0000-4000-8001-000000000003'),'Customer response stops the existing reminder cycle');
update public.refund_cases set incident_timezone='America/New_York' where id='dd000000-0000-4000-8001-000000000003';
select is(public.refund_purchase_correction_request_fields('dd000000-0000-4000-8001-000000000003'),'{}'::text[],'Unrelated Operations timezone correction does not repeat an unanswered customer amount');
create temporary table before_confidence as select deterministic_fact_version as version from public.refund_cases where id='dd000000-0000-4000-8001-000000000008';
update public.refund_cases set incident_time_confidence='rough' where id='dd000000-0000-4000-8001-000000000008';
select is((select deterministic_fact_version from public.refund_cases where id='dd000000-0000-4000-8001-000000000008'),(select version+1 from before_confidence),'Confidence-only change invalidates old matching version exactly once');
select * from finish();
rollback;
