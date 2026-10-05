begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create function pg_temp.require_ok(result text) returns text language plpgsql as $$
begin
  if result is null or result !~ '^ok\M' then
    raise exception 'Assertion failed: %',result;
  end if;
  return result;
end; $$;

insert into public.customer_accounts(id,name,account_type)
values('e5800000-0000-4000-8000-000000000001','Exhausted contact fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status)
values('e5800000-0000-4000-8000-000000000002','e5800000-0000-4000-8000-000000000001',
  'Exhausted contact fixture','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
values('e5800000-0000-4000-8000-000000000003','e5800000-0000-4000-8000-000000000001',
  'e5800000-0000-4000-8000-000000000002','Exhausted contact fixture','active');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,status,payment_method,incident_at,incident_timezone,
  incident_time_resolution,payment_amount_cents,correlation_status,intake_source)
values('e5800000-0000-4000-8001-000000000001','RF-EXHAUSTED-CONTACT',
  'e5800000-0000-4000-8000-000000000003','e5800000-0000-4000-8000-000000000002',
  'exhausted-customer@example.invalid','Scoped read-model regression','waiting_on_customer',
  'cash',statement_timestamp()-interval '8 days','America/Los_Angeles','exact',800,'manual_review','form');

-- Supply the already-established historical question at the missing-fields
-- seam; purchase matching and question creation are outside this read-model
-- regression. This replacement and every synthetic row roll back together.
create temp table original_missing_fields_definition as
select pg_get_functiondef('public.refund_missing_follow_up_fields(uuid)'::regprocedure) body;
create or replace function public.refund_missing_follow_up_fields(p_refund_case_id uuid)
returns text[] language sql stable security definer set search_path='' as $$
  select array['zelle_payment_contact']::text[];
$$;
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;

insert into public.refund_follow_up_cycles(id,refund_case_id,cycle_number,trigger_fingerprint,
  reason_code,requested_fields,template_version,case_fact_version,reminder_delay_hours,status)
select 'e5800000-0000-4000-8002-000000000001',id,1,repeat('a',64),'missing_information',
  array['zelle_payment_contact']::text[],'refund_follow_up_v2',deterministic_fact_version,72,'claimed'
from public.refund_cases where id='e5800000-0000-4000-8001-000000000001';
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,
  subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
values('e5800000-0000-4000-8003-000000000001','e5800000-0000-4000-8001-000000000001',
  'more_info','pending','exhausted-customer@example.invalid','Existing question','Existing question',
  'deterministic_template','automatic','missing_information','refund_follow_up_v2',
  'e5800000-0000-4000-8002-000000000001',array['zelle_payment_contact']::text[]);
update public.refund_case_messages set status='sent',sent_at=statement_timestamp()-interval '7 days',
  delivery_transport='resend',provider_message_id='fixture-original',delivery_state='delivered',
  delivery_state_updated_at=statement_timestamp()-interval '7 days'
where id='e5800000-0000-4000-8003-000000000001';
insert into public.refund_payout_destination_follow_ups(id,refund_case_id,request_message_id,
  reminder_delay_hours,status,reminder_due_at,reminder_claim_token,reminder_claimed_at)
values('e5800000-0000-4000-8004-000000000001','e5800000-0000-4000-8001-000000000001',
  'e5800000-0000-4000-8003-000000000001',72,'reminder_claimed',
  statement_timestamp()-interval '4 days','e5800000-0000-4000-8004-000000000002',statement_timestamp()-interval '4 days');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,
  subject,body,content_source,delivery_kind,reason_code,template_version,template_key,
  requested_fields,payout_destination_follow_up_id,sent_at,delivery_transport,provider_message_id,
  delivery_state,delivery_state_updated_at)
values('e5800000-0000-4000-8003-000000000002','e5800000-0000-4000-8001-000000000001',
  'reminder','sent','exhausted-customer@example.invalid','Existing reminder','Existing reminder',
  'deterministic_template','automatic','missing_information','refund_payout_destination_v1',
  'refund_payout_destination_reminder_v1',array['zelle_payment_contact']::text[],
  'e5800000-0000-4000-8004-000000000001',statement_timestamp()-interval '4 days',
  'resend','fixture-reminder','delivered',statement_timestamp()-interval '4 days');
update public.refund_payout_destination_follow_ups set status='manual_review',
  reminder_claim_token=null,reminder_message_id='e5800000-0000-4000-8003-000000000002',
  reminder_sent_at=statement_timestamp()-interval '4 days',escalation_due_at=statement_timestamp()-interval '1 day',
  manual_review_at=statement_timestamp()
where id='e5800000-0000-4000-8004-000000000001';

-- Restore the real missing-fields function before evaluating any production
-- chain. The latest actual correction context is bound to the sent reminder,
-- just as in the saved live symptom. It has no useful response.
do $$ begin execute (select body from original_missing_fields_definition); end $$;
insert into public.refund_wallet_correction_contexts(id,refund_case_id,token_hash,version,
  status,issued_at,expires_at,correction_kind,correction_message_id,
  correction_fact_version,correction_requested_fields,correction_snapshot)
select 'e5800000-0000-4000-8005-000000000001',id,repeat('c',64),1,'pending',
  statement_timestamp()+interval '1 second',statement_timestamp()+interval '1 day',
  'purchase','e5800000-0000-4000-8003-000000000002',deterministic_fact_version,
  array['zelle_payment_contact']::text[],'{"zelle_payment_contact":null}'::jsonb
from public.refund_cases where id='e5800000-0000-4000-8001-000000000001';
do $prior_projection$
declare body text; first_anchor integer; second_anchor integer;
begin
  body:=replace(pg_get_functiondef('public.refund_customer_outreach_contract(uuid)'::regprocedure),E'\r\n',E'\n');
  first_anchor:=strpos(body,$a$  if result ->> 'state' = 'waiting_for_customer'$a$);
  second_anchor:=strpos(body,'  select context.* into context_row');
  if first_anchor=0 or second_anchor<=first_anchor then raise exception 'Missing exact exhaustion block'; end if;
  execute replace(left(body,first_anchor-1)||substr(body,second_anchor),
    'public.refund_customer_outreach_contract(', 'pg_temp.prior_outreach(');
end;
$prior_projection$;
create function pg_temp.actual_chain_probe(mutation text) returns jsonb language plpgsql as $$
declare observed jsonb;
begin
  begin
    execute mutation;
    observed:=public.refund_customer_outreach_contract('e5800000-0000-4000-8001-000000000001');
    raise exception using errcode='P9999',message='Rollback actual-chain input';
  exception when sqlstate 'P9999' then return observed;
  end;
end; $$;
create temp table integrated_before as select
  (select jsonb_agg(to_jsonb(c) order by id) from public.refund_cases c) cases,
  (select jsonb_agg(to_jsonb(m) order by id) from public.refund_case_messages m) messages,
  (select jsonb_agg(to_jsonb(f) order by id) from public.refund_payout_destination_follow_ups f) followups;
select pg_temp.require_ok(is(pg_temp.prior_outreach('e5800000-0000-4000-8001-000000000001')->>'state',
  'waiting_for_customer','Real prior outreach chain reproduces exhausted reminder Customer wait'));
select pg_temp.require_ok(is(public.refund_customer_outreach_contract('e5800000-0000-4000-8001-000000000001')->>'state',
  'clarification_exhausted','Actual current missing-fields/outreach chain consumes exact exhaustion'));
select pg_temp.require_ok(is(public.refund_lifecycle_contract('e5800000-0000-4000-8001-000000000001')#>>'{nextWork,actor}',
  'agent','Real canonical lifecycle routes exhausted contact to Agent'));
select pg_temp.require_ok(is(public.refund_lifecycle_contract('e5800000-0000-4000-8001-000000000001')#>>'{nextWork,actionCode}',
  'research_purchase','Real canonical nextWork does not ask customer to answer'));
select pg_temp.require_ok(is((select jsonb_agg(to_jsonb(c) order by id) from public.refund_cases c),
  (select cases from integrated_before),'Real-chain projection changes no business facts'));
select pg_temp.require_ok(is((select jsonb_agg(to_jsonb(m) order by id) from public.refund_case_messages m),
  (select messages from integrated_before),'Real-chain projection changes no message or delivery'));
select pg_temp.require_ok(is((select jsonb_agg(to_jsonb(f) order by id) from public.refund_payout_destination_follow_ups f),
  (select followups from integrated_before),'Real-chain projection changes no consumed contact budget'));
select pg_temp.require_ok(isnt(pg_temp.actual_chain_probe($q$
  update public.refund_wallet_correction_contexts set status='submitted',consumed_at=statement_timestamp(),
    correction_next_action='review',correction_response='{"zelle_payment_contact":{"disposition":"cannot_provide"}}'
  where id='e5800000-0000-4000-8005-000000000001'
$q$)->>'reasonCode','payout_follow_up_exhausted','Real current submitted limitation retains existing reply review'));
select pg_temp.require_ok(is(pg_temp.actual_chain_probe($q$
  update public.refund_cases set zelle_payment_contact='saved-destination@example.invalid'
  where id='e5800000-0000-4000-8001-000000000001';
  update public.refund_wallet_correction_contexts set status='submitted',consumed_at=statement_timestamp(),
    correction_resulting_fact_version=(select deterministic_fact_version from public.refund_cases
      where id='e5800000-0000-4000-8001-000000000001'),
    correction_response='{"zelle_payment_contact":{"disposition":"changed","value":"saved-destination@example.invalid"}}'
  where id='e5800000-0000-4000-8005-000000000001'
$q$)->>'reasonCode','verified_form_response_applied','Real valid submitted destination wins over historical exhaustion'));

insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
  eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
values('e5800000-0000-4000-8006-000000000001','kemore','fixture',1000,
  array['e5800000-0000-4000-8000-000000000003']::uuid[],array['Exhausted contact fixture'],
  statement_timestamp()+interval '30 days',false,'Synthetic redemption instructions');
select pg_temp.require_ok(isnt(pg_temp.actual_chain_probe($q$
  update public.refund_cases set resolution_method='gift_card',
    gift_card_pool_id='e5800000-0000-4000-8006-000000000001',gift_card_value_cents=1000,
    gift_card_expires_at=statement_timestamp()+interval '30 days',gift_card_state='pending_inventory'
  where id='e5800000-0000-4000-8001-000000000001'
$q$)->>'reasonCode','payout_follow_up_exhausted','Accepted new gift resolution does not inherit the old payout exhaustion'));

-- Isolate the current outer projection from prior workflow precedence. The
-- production symptom is this exact delivered-reminder result from that seam;
-- all binding/status checks below still execute the real current SQL on real rows.
create temp table earlier_outreach(result jsonb);
insert into earlier_outreach select jsonb_build_object(
  'schemaVersion','refund_customer_outreach_v1','state','waiting_for_customer',
  'owner','Customer','nextAction','wait_for_customer','reasonCode','request_delivered',
  'requestMessageId','e5800000-0000-4000-8003-000000000002',
  'caseFactVersion',deterministic_fact_version,'requestedFields',array['zelle_payment_contact'],
  'deliveryState','delivered','requestSentAt',statement_timestamp()-interval '4 days',
  'replyReceivedAt',null,'payloadRedacted',true)
from public.refund_cases where id='e5800000-0000-4000-8001-000000000001';
create or replace function public.refund_outreach_pre_form_continuation_v1(uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select result from pg_temp.earlier_outreach;
$$;

create function pg_temp.current_outreach() returns jsonb language sql as $$
  select public.refund_customer_outreach_contract('e5800000-0000-4000-8001-000000000001');
$$;
do $prior_projection$
declare body text; first_anchor integer; second_anchor integer;
begin
  body:=replace(pg_get_functiondef('public.refund_customer_outreach_contract(uuid)'::regprocedure),E'\r\n',E'\n');
  first_anchor:=strpos(body,$a$  if result ->> 'state' = 'waiting_for_customer'$a$);
  second_anchor:=strpos(body,'  select context.* into context_row');
  if first_anchor=0 or second_anchor<=first_anchor then raise exception 'Missing exact exhaustion block'; end if;
  execute replace(left(body,first_anchor-1)||substr(body,second_anchor),
    'public.refund_customer_outreach_contract(', 'pg_temp.prior_outreach(');
end;
$prior_projection$;
create function pg_temp.probe(mutation text) returns jsonb language plpgsql as $$
declare observed jsonb;
begin
  begin
    execute mutation;
    observed:=pg_temp.current_outreach();
    raise exception using errcode='P9999',message='Rollback isolated negative';
  exception when sqlstate 'P9999' then return observed;
  end;
end; $$;
create temp table protected_before as select
  (select jsonb_agg(to_jsonb(c) order by id) from public.refund_cases c) cases,
  (select jsonb_agg(to_jsonb(m) order by id) from public.refund_case_messages m) messages,
  (select jsonb_agg(to_jsonb(f) order by id) from public.refund_payout_destination_follow_ups f) followups,
  (select jsonb_agg(to_jsonb(e) order by id) from public.refund_case_events e) events;

select pg_temp.require_ok(is(pg_temp.prior_outreach('e5800000-0000-4000-8001-000000000001')->>'state',
  'waiting_for_customer','Old exact contract reproduces stale delivered wait despite exhausted ledger'));

select pg_temp.require_ok(is(pg_temp.current_outreach()->>'state','clarification_exhausted',
  'Delivered current reminder with persisted exhaustion leaves Customer wait'));
select pg_temp.require_ok(is(pg_temp.current_outreach()->>'reasonCode','payout_follow_up_exhausted',
  'Exact payout ledger supplies the exhaustion reason'));
select pg_temp.require_ok(is(pg_temp.current_outreach()->>'requestMessageId',
  'e5800000-0000-4000-8003-000000000002','Delivered original reminder identity is preserved'));
select pg_temp.require_ok(is(pg_temp.current_outreach()->>'deliveryState','delivered',
  'Exhaustion does not rewrite successful delivery'));
create temp table lifecycle_after as select public.refund_apply_customer_outreach_to_lifecycle(
  jsonb_build_object('schemaVersion','refund_lifecycle_v2','stage','awaiting_payout',
    'reasonCode','payout_destination_missing','paymentState','not_requested',
    'payloadRedacted',true,'managerQueue',jsonb_build_object('bucket','in_progress')),
  pg_temp.current_outreach()) value;
select pg_temp.require_ok(is((select value#>>'{managerQueue,bucket}' from lifecycle_after),
  'provider_hold','Canonical queue routes exhausted contact internally'));
select pg_temp.require_ok(is((select public.refund_next_work_projection(value,null)->>'actor' from lifecycle_after),
  'agent','Canonical next-work no longer asks customer to answer'));
select pg_temp.require_ok(is((select public.refund_next_work_projection(value,null)->>'actionCode' from lifecycle_after),
  'research_purchase','Next-work continues existing Agent research without another request'));

select pg_temp.require_ok(is(pg_temp.probe($q$update public.refund_payout_destination_follow_ups
  set status='reminder_sent',manual_review_at=null$q$)->>'state','waiting_for_customer','Live response window remains Customer wait'));
select pg_temp.require_ok(is(pg_temp.probe($q$update public.refund_payout_destination_follow_ups
  set manual_review_at=escalation_due_at-interval '1 second'$q$)->>'state','waiting_for_customer','Early manual review is not persisted exhaustion'));
select pg_temp.require_ok(is(pg_temp.probe($q$update earlier_outreach set result=jsonb_set(result,
  '{caseFactVersion}','0')$q$)->>'state','waiting_for_customer','Stale fact cannot inherit current exhaustion'));
select pg_temp.require_ok(is(pg_temp.probe($q$update earlier_outreach set result=jsonb_set(result,
  '{requestMessageId}','"e5800000-0000-4000-8003-000000000001"')$q$)->>'state','waiting_for_customer','Original request is not mistaken for delivered reminder'));
select pg_temp.require_ok(is(pg_temp.probe($q$update earlier_outreach set result=jsonb_set(result,
  '{deliveryState}','"unknown"')$q$)->>'state','waiting_for_customer','Unknown delivery is not claimed exhausted'));
select pg_temp.require_ok(is(pg_temp.probe($q$update earlier_outreach set result=jsonb_set(result,
  '{replyReceivedAt}',to_jsonb(statement_timestamp()))$q$)->>'state','waiting_for_customer','Useful reply timestamp wins over exhaustion'));
select pg_temp.require_ok(is(pg_temp.probe($q$update earlier_outreach set result=jsonb_set(result,
  '{state}','"customer_replied"')$q$)->>'state','customer_replied','Existing reply review state is preserved'));
select pg_temp.require_ok(is(pg_temp.probe($q$update earlier_outreach set result=jsonb_set(result,
  '{state}','"rechecking"')$q$)->>'state','rechecking','Existing structured recheck state is preserved'));
select pg_temp.require_ok(isnt(pg_temp.probe($q$update public.refund_wallet_correction_contexts
set status='submitted',consumed_at=statement_timestamp(),
  correction_response='{"zelle_payment_contact":{"disposition":"cannot_provide"}}'
where id='e5800000-0000-4000-8005-000000000001'$q$)->>'reasonCode',
  'payout_follow_up_exhausted','Current submitted limitation is useful input, not unanswered exhaustion'));
select pg_temp.require_ok(is(pg_temp.probe($q$update earlier_outreach set result=jsonb_set(result,
  '{requestedFields}','["amount"]')$q$)->>'state','waiting_for_customer','Other correction fields retain original projection'));
select pg_temp.require_ok(is(pg_temp.probe($q$update public.refund_cases set
  zelle_payment_contact='already-supplied@example.invalid'$q$)->>'state','waiting_for_customer','Saved destination cannot be reclassified as missing input'));
select pg_temp.require_ok(is(pg_temp.probe($q$update public.refund_cases set status='closed'$q$)->>'state',
  'waiting_for_customer','Terminal case never acquires this exhaustion exception'));

select pg_temp.require_ok(is((select jsonb_agg(to_jsonb(c) order by id) from public.refund_cases c),
  (select cases from protected_before),'Projection preserves all case facts/decisions'));
select pg_temp.require_ok(is((select jsonb_agg(to_jsonb(m) order by id) from public.refund_case_messages m),
  (select messages from protected_before),'Projection preserves original/reminder transport and content'));
select pg_temp.require_ok(is((select jsonb_agg(to_jsonb(f) order by id) from public.refund_payout_destination_follow_ups f),
  (select followups from protected_before),'Projection preserves exhausted budget and followup ledger'));
select pg_temp.require_ok(is((select jsonb_agg(to_jsonb(e) order by id) from public.refund_case_events e),
  (select events from protected_before),'Projection emits no event, send or financial change'));
select pg_temp.require_ok(ok(has_function_privilege('service_role',
  'public.refund_customer_outreach_contract(uuid)','execute')
  and not has_function_privilege('anon','public.refund_customer_outreach_contract(uuid)','execute')
  and not has_function_privilege('authenticated','public.refund_customer_outreach_contract(uuid)','execute'),
  'Existing outreach authority remains service-only'));
select * from finish();
rollback;
