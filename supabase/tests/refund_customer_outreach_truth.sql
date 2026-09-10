begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(35);

create function pg_temp.capture_error(statement text) returns text language plpgsql as $$
begin execute statement; return null; exception when others then return sqlstate||':'||sqlerrm; end; $$;

create function pg_temp.set_auth_claims(p_user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',p_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',p_user_id,'role','authenticated','is_anonymous',false
  )::text,true);
end; $$;

select has_function('public','refund_customer_outreach_contract',array['uuid'],'Outreach contract exists');
select ok(has_function_privilege('service_role','public.refund_customer_outreach_contract(uuid)','execute')
  and not has_function_privilege('authenticated','public.refund_customer_outreach_contract(uuid)','execute'),'Raw outreach truth remains server-only');
select ok(has_function_privilege('service_role','public.service_settle_refund_follow_up_pre_message_suppression(uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated','public.service_settle_refund_follow_up_pre_message_suppression(uuid,uuid,text)','execute'),'Only service role can settle exact suppression');

insert into public.customer_accounts(id,name,account_type) values('b8800000-0000-4000-8000-000000000001','Outreach supported fixtures','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status) values('b8800000-0000-4000-8000-000000000002','b8800000-0000-4000-8000-000000000001','Outreach place','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,refund_intake_enabled,refund_public_display_label)
values('b8800000-0000-4000-8000-000000000003','b8800000-0000-4000-8000-000000000001','b8800000-0000-4000-8000-000000000002','Outreach machine','commercial','active',true,'Outreach machine');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','b8800000-0000-4000-8005-000000000001','authenticated','authenticated','outreach-manager@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','b8800000-0000-4000-8005-000000000002','authenticated','authenticated','outreach-operations@example.invalid','',now(),'{}','{}',now(),now());
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('b8800000-0000-4000-8000-000000000003','b8800000-0000-4000-8005-000000000001','outreach-manager@example.invalid','Outreach overview fixture');
insert into public.admin_roles(user_id,role,active)
values('b8800000-0000-4000-8005-000000000002','super_admin',true);
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true,correction_links_enabled=true where singleton;

create function pg_temp.make_case(n integer,mapped boolean default false) returns uuid language plpgsql as $$
declare cid uuid:=('b8800000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;
begin
  insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,status,intake_source,
    incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,
    card_last4,card_last4_provenance,card_wallet_used,card_network,correlation_status)
  values(cid,'RF-OUT-'||n,case when mapped then 'b8800000-0000-4000-8000-000000000003'::uuid end,
    case when mapped then 'b8800000-0000-4000-8000-000000000002'::uuid end,'outreach-'||n||'@example.invalid','Supported outreach fixture','draft','gmail',
    case when mapped then statement_timestamp()-interval '2 hours' end,
    case when mapped then to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI') end,
    case when mapped then 'America/Los_Angeles' end,case when mapped then 'exact' end,case when mapped then 'exact' else 'rough' end,
    case when mapped then 'card' end,case when mapped then 'tap_card' else 'unsure' end,case when mapped then '1234' end,
    case when mapped then 'physical_card' end,false,case when mapped then 'visa' end,'manual_review');
  return cid;
end; $$;

create function pg_temp.claim_cycle(cid uuid,seed text) returns uuid language plpgsql as $$
declare result jsonb;
begin
  result:=public.service_claim_refund_follow_up_cycle(cid,'missing_information',
    (select template_version from public.refund_customer_contact_settings where singleton),encode(extensions.digest(seed,'sha256'),'hex'),null);
  if not coalesce((result->>'claimed')::boolean,false) then raise exception 'claim failed: %',result; end if;
  return (result#>>'{cycle,id}')::uuid;
end; $$;

create function pg_temp.queue_request(cid uuid,cycle_id uuid,mid uuid) returns void language plpgsql as $$
begin
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,
    reason_code,template_version,follow_up_cycle_id,requested_fields)
  select mid,cid,'more_info','pending',c.customer_email,'Please update your request','[Secure refund correction link included at delivery]',
    'deterministic_template','automatic',
    cycle.reason_code,cycle.template_version,cycle.id,cycle.requested_fields
  from public.refund_follow_up_cycles cycle join public.refund_cases c on c.id=cycle.refund_case_id where cycle.id=cycle_id and c.id=cid;
end; $$;

select pg_temp.make_case(n,n=5) from generate_series(1,9)n;
select pg_temp.make_case(10,true);
create temp table fixture(case_no integer primary key,cid uuid,cycle_id uuid,mid uuid);
insert into fixture select n,('b8800000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,
  pg_temp.claim_cycle(('b8800000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'outreach-'||n),
  ('b8800000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid from generate_series(1,7)n;

select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=1))->>'state','preparing','Supported cycle claim projects preparing');
select pg_temp.queue_request(cid,cycle_id,mid) from fixture where case_no between 2 and 7;
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=2))->>'state','queued','Real guarded message insert projects queued');
select public.service_mark_refund_transactional_delivery_attempt(mid) from fixture where case_no in(3,4,6);
select public.service_bind_refund_transactional_delivery(mid,'outreachprovider'||case_no,statement_timestamp()) from fixture where case_no in(3,4,6);
update public.refund_case_messages set status='sent',sent_at=statement_timestamp() where id in(select mid from fixture where case_no in(3,4,6));
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=3))->>'state','sent_unconfirmed','Provider acceptance is sent but not waiting');
select public.service_record_refund_transactional_delivery_event(repeat('d',63)||'4','outreachprovider4','delivered',statement_timestamp());
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=4))->>'state','waiting_for_customer','Only confirmed delivery projects waiting for customer');
update public.refund_case_messages set status='failed',error_message='synthetic_pretransport_failure' where id=(select mid from fixture where case_no=5);
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=5))->>'state','delivery_failed','Guarded failed message projects Refund Operations failure');
select ok(
  public.refund_customer_outreach_contract((select cid from fixture where case_no=5))->>'owner' = 'Refund Operations'
  and not (public.refund_customer_outreach_contract((select cid from fixture where case_no=5))->>'manualFallbackEligible')::boolean,
  'Durable delivery failure stays with Refund Operations and never invents manager authority'
);
select public.service_record_refund_transactional_delivery_event(repeat('d',63)||'6','outreachprovider6','deferred',statement_timestamp());
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=6))->>'state','delivery_unknown','Deferred provider outcome projects unknown');

insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('b8800000-0000-4000-8003-000000000007',(select cid from fixture where case_no=7),repeat('7',64),'outreach-reply-thread','Refund help',statement_timestamp()-interval '1 hour',statement_timestamp(),statement_timestamp()+interval '30 days');
update public.refund_case_messages set status='sent',sent_at=statement_timestamp()-interval '2 minutes' where id=(select mid from fixture where case_no=7);
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,direction,message_kind,status,sender_email,recipient_email,
  participant_role,participant_trust,subject,plain_body,received_at,retention_expires_at)
select 'b8800000-0000-4000-8004-000000000007','b8800000-0000-4000-8003-000000000007',cid,'outreach-verified-reply','inbound','message','received',
  'outreach-7@example.invalid','support@example.invalid','customer','verified','Re: Refund help','Safe reply fixture',statement_timestamp(),statement_timestamp()+interval '30 days'
from fixture where case_no=7;
select public.service_claim_refund_follow_up_customer_reply((select cid from fixture where case_no=7),(select cycle_id from fixture where case_no=7));
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=7))->>'state','customer_replied','Verified reply RPC projects customer replied');
create temp table run as select public.service_start_refund_automation_run('outreach:truth:recheck','manual',null) value;
select public.service_claim_refund_automation_action((select(value->>'runId')::uuid from run),(select cid from fixture where case_no=7),
  'customer_reply_recheck:'||(select cycle_id from fixture where case_no=7)::text,'customer_reply_recheck','draft',null);
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=7))->>'state','rechecking','Exact cycle-bound action claim projects rechecking');

select like(pg_temp.capture_error(format($q$select public.service_settle_refund_follow_up_pre_message_suppression(%L,%L,'automatic_customer_contact_disabled')$q$,
  (select cid from fixture where case_no=1),(select cycle_id from fixture where case_no=1))),'P0001:%not durably disabled%','Enabled policy rejects a false disabled assertion');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=false where singleton;
select is((public.service_settle_refund_follow_up_pre_message_suppression((select cid from fixture where case_no=1),(select cycle_id from fixture where case_no=1),
  'automatic_customer_contact_disabled')->>'settled')::boolean,true,'Durably disabled policy settles the exact still-claimed cycle');
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=1))->>'state','policy_suppressed','Settled suppression is no longer preparing');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;

insert into fixture values(10,'b8800000-0000-4000-8001-000000000010',pg_temp.claim_cycle('b8800000-0000-4000-8001-000000000010','outreach-10a'),'b8800000-0000-4000-8002-000000000010');
select pg_temp.queue_request(cid,cycle_id,mid) from fixture where case_no=10;
select public.service_issue_refund_purchase_correction((select mid from fixture where case_no=10),repeat('a',64),
  (select deterministic_fact_version from public.refund_cases where id=(select cid from fixture where case_no=10)));
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=10))->>'requestMessageId',(select mid::text from fixture where case_no=10),
  'Current correction remains bound to its exact request');
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=10))->>'cycleId',null,
  'The selected correction workflow does not splice in its older cycle');
update public.refund_case_messages
set status='failed',error_message='supported_stale_workflow_fixture'
where id=(select mid from fixture where case_no=10);
update public.refund_cases set incident_time_confidence='rough' where id=(select cid from fixture where case_no=10);
update fixture set cycle_id=pg_temp.claim_cycle(cid,'outreach-10b'),mid='b8800000-0000-4000-8002-000000000011' where case_no=10;
select pg_temp.queue_request(cid,cycle_id,mid) from fixture where case_no=10;
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=10))->>'requestMessageId','b8800000-0000-4000-8002-000000000011',
  'Newer-fact cycle wins over stale correction evidence');
select is(public.refund_customer_outreach_contract((select cid from fixture where case_no=10))->>'cycleId',(select cycle_id::text from fixture where case_no=10),
  'The newer cycle is the one selected causal workflow');

insert into fixture values(8,'b8800000-0000-4000-8001-000000000008',pg_temp.claim_cycle('b8800000-0000-4000-8001-000000000008','outreach-8a'),
  'b8800000-0000-4000-8002-000000000008');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=false where singleton;
select public.service_settle_refund_follow_up_pre_message_suppression(
  (select cid from fixture where case_no=8),(select cycle_id from fixture where case_no=8),'automatic_customer_contact_disabled'
);
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
update public.refund_cases set payment_method='cash',payment_interaction='cash' where id=(select cid from fixture where case_no=8);
update fixture set cycle_id=pg_temp.claim_cycle(cid,'outreach-8b') where case_no=8;
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=false where singleton;
select public.service_settle_refund_follow_up_pre_message_suppression(
  (select cid from fixture where case_no=8),(select cycle_id from fixture where case_no=8),'automatic_customer_contact_disabled'
);
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true where singleton;
select ok(
  public.refund_customer_outreach_contract((select cid from fixture where case_no=8))->>'state' = 'clarification_exhausted'
  and public.refund_customer_outreach_contract((select cid from fixture where case_no=8))->>'owner' = 'Refund Operations',
  'Two supported settled cycles project exhausted with Refund Operations ownership'
);

update public.refund_cases
set payment_method='cash',payment_interaction='cash',correlation_status='no_match',correlation_source='sunze',
  correlation_summary='No matching local cash sale.'
where id='b8800000-0000-4000-8001-000000000009';
update public.refund_cases
set cash_match_evaluated_fact_version=deterministic_fact_version
where id='b8800000-0000-4000-8001-000000000009';
create temp table fallback_run as
select public.service_start_refund_automation_run('outreach:truth:fallback','manual',null) value;
create temp table stale_fallback_action as
select public.service_claim_refund_automation_action(
  (select(value->>'runId')::uuid from fallback_run),'b8800000-0000-4000-8001-000000000009',
  'follow_up_review:b8800000-0000-4000-8001-000000000009:cash-no-match-incomplete:' ||
    (select deterministic_fact_version::text from public.refund_cases where id='b8800000-0000-4000-8001-000000000009'),
  'internal_escalation','needs_review',null
) value;
select ok(public.service_finish_refund_automation_action(
  (select(value->>'actionId')::uuid from stale_fallback_action),'completed','cash_no_match_incomplete',null
),'Existing service claim/finish writers durably complete the bounded escalation');
update public.refund_cases set payment_amount_cents=700
where id='b8800000-0000-4000-8001-000000000009';
update public.refund_cases set cash_match_evaluated_fact_version=deterministic_fact_version
where id='b8800000-0000-4000-8001-000000000009';
select is(public.refund_customer_outreach_contract('b8800000-0000-4000-8001-000000000009')->>'state','none',
  'A completed escalation for a stale fact version grants no manual fallback');
create temp table current_fallback_action as
select public.service_claim_refund_automation_action(
  (select(value->>'runId')::uuid from fallback_run),'b8800000-0000-4000-8001-000000000009',
  'follow_up_review:b8800000-0000-4000-8001-000000000009:cash-no-match-incomplete:' ||
    (select deterministic_fact_version::text from public.refund_cases where id='b8800000-0000-4000-8001-000000000009'),
  'internal_escalation','needs_review',null
) value;
select ok(public.service_finish_refund_automation_action(
  (select(value->>'actionId')::uuid from current_fallback_action),'completed','cash_no_match_incomplete',null
),'Current exact escalation completes through the same production writer');
select ok(
  public.refund_customer_outreach_contract('b8800000-0000-4000-8001-000000000009')->>'state'='manual_fallback'
  and public.refund_customer_outreach_contract('b8800000-0000-4000-8001-000000000009')->>'owner'='Machine Manager'
  and (public.refund_customer_outreach_contract('b8800000-0000-4000-8001-000000000009')->>'manualFallbackEligible')::boolean
  and public.refund_customer_outreach_contract('b8800000-0000-4000-8001-000000000009')->'requestedFields'=
    to_jsonb(public.refund_purchase_correction_request_fields('b8800000-0000-4000-8001-000000000009')),
  'Exact current cash review exposes only current useful fields to the Machine Manager'
);
insert into fixture values(9,'b8800000-0000-4000-8001-000000000009',
  pg_temp.claim_cycle('b8800000-0000-4000-8001-000000000009','outreach-9-current'),
  'b8800000-0000-4000-8002-000000000009');
select is(public.refund_customer_outreach_contract('b8800000-0000-4000-8001-000000000009')->>'state','preparing',
  'A current outreach cycle preempts the otherwise eligible manual fallback');

select is((public.refund_customer_outreach_contract((select cid from fixture where case_no=2))->>'manualFallbackEligible')::boolean,false,'No unsupported writer grants manager outreach authority');
select ok(pg_get_functiondef('public.refund_customer_outreach_contract(uuid)'::regprocedure) not like '%customer_outreach_manual_fallback%',
  'Projection has no unsupported manual-fallback authority');
select is((public.refund_project_customer_outreach_cases_for_manager(jsonb_build_array(jsonb_build_object('id','b8800000-0000-4000-8001-000000000009',
  'nayaxLookupRecovery',jsonb_build_object('state','system'),'lifecycle',jsonb_build_object('lookup',jsonb_build_object('status','automatic_recovery')))),false)
  ->0->'nayaxLookupRecovery'->>'state'),'system','#1290 top-level lookup recovery survives outreach projection');
select is((public.refund_project_customer_outreach_cases_for_manager(jsonb_build_array(jsonb_build_object('id','b8800000-0000-4000-8001-000000000009',
  'nayaxLookupRecovery',jsonb_build_object('state','system'),'lifecycle',jsonb_build_object('lookup',jsonb_build_object('status','automatic_recovery')))),false)
  ->0->'lifecycle'->'lookup'->>'status'),'automatic_recovery','#1290 lifecycle lookup truth is not recomputed away');
select ok(public.refund_customer_outreach_contract((select cid from fixture where case_no=3)) ?&
  array['state','owner','nextAction','requestedFields','clarificationAttemptCount','clarificationLimit','payloadRedacted'],'Strict redacted contract retains retry bounds and ownership');
select is((public.refund_customer_outreach_contract((select cid from fixture where case_no=3))->>'clarificationLimit')::integer,2,'Existing two-attempt bound remains explicit');
select is((public.refund_customer_outreach_contract((select cid from fixture where case_no=3))->>'payloadRedacted')::boolean,true,'Projection is explicitly redacted');

update public.refund_cases
set payment_amount_cents=700,status='needs_review'
where id=(select cid from fixture where case_no=5);
select ok(public.service_enqueue_refund_nayax_lookup(
  (select cid from fixture where case_no=5),
  (select deterministic_fact_version from public.refund_cases where id=(select cid from fixture where case_no=5))
)->>'status' in ('scheduled','deduplicated'),'Real failed-outreach case enters the #1290 server lookup path');
set local role authenticated;
select pg_temp.set_auth_claims('b8800000-0000-4000-8005-000000000001');
select ok((select
    item->'nayaxLookupRecovery'->>'state'='system'
    and item->'lifecycle'->'lookup'->>'status'='checking'
    and item->'lifecycle'->'customerOutreach'->>'state'='delivery_failed'
    and item->'lifecycle'->'customerOutreach'->'failureCode'='null'::jsonb
  from jsonb_array_elements(public.admin_get_refund_operations_overview()->'cases') item
  where item->>'id'='b8800000-0000-4000-8001-000000000005'),
  'Final ordinary overview coexists with #1290 and redacts outreach failure detail');
select pg_temp.set_auth_claims('b8800000-0000-4000-8005-000000000002');
select ok((select
    item->'nayaxLookupRecovery'->>'state'='system'
    and item->'lifecycle'->'lookup'->>'status'='checking'
    and item->'lifecycle'->'customerOutreach'->>'state'='delivery_failed'
    and item->'lifecycle'->'customerOutreach'->>'failureCode'='customer_message_failed'
  from jsonb_array_elements(public.admin_get_refund_operations_overview()->'cases') item
  where item->>'id'='b8800000-0000-4000-8001-000000000005'),
  'Final Operations overview coexists with #1290 and retains redacted-class failure detail');
reset role;

select * from finish();
rollback;
