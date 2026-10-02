-- Disposable proof for the reviewed one-off original gift notice repair.
-- No production migration/RPC is installed and no provider, claim, drain or send is called.
-- The temporary test function uses the identical locked guard/update/audit body.
begin;
set local lock_timeout='2s';
set local idle_in_transaction_session_timeout='30s';
set local statement_timeout='20s';
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.require_ok(result text) returns text language plpgsql as $$
begin if result is null or result like 'not ok%' then raise exception 'Failed strict assertion: %',result; end if; return result; end $$;
insert into auth.users(id,email) values('fc710000-0000-4000-8000-000000000001','gift-manager@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('fc720000-0000-4000-8000-000000000001','Gift-card fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('fc730000-0000-4000-8000-000000000001','fc720000-0000-4000-8000-000000000001','Fixture location','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 values('fc740000-0000-4000-8000-000000000001','fc720000-0000-4000-8000-000000000001',
 'fc730000-0000-4000-8000-000000000001','Gift fixture machine','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
 values('fc740000-0000-4000-8000-000000000001','fc710000-0000-4000-8000-000000000001','gift-manager@example.invalid','Gift fixture');
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
 eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
 values('fc750000-0000-4000-8000-000000000001','kemore','gift-fixture',1500,
 array['fc740000-0000-4000-8000-000000000001']::uuid[],array['Fixture location'],
 now()+interval '30 days',true,'Enter your code at the fixture machine.');
insert into public.refund_gift_card_codes(pool_id,provider,provider_account_id,provider_code_id,code,valid_from,expires_at)
 select 'fc750000-0000-4000-8000-000000000001','kemore','gift-fixture','fixture-'||n,lpad(n::text,9,'0'),
 now()-interval '1 day',now()+interval '30 days' from generate_series(1,4)n;
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
 values('fc760000-0000-4000-8000-000000000001','RF-GIFT-FIRST','fc740000-0000-4000-8000-000000000001',
 'fc730000-0000-4000-8000-000000000001','  Gift-Fixture@Example.Invalid  ','Synthetic problem',now(),'card',1100,1100,
 'gift_card','fc750000-0000-4000-8000-000000000001',1500,now()+interval '30 days','pending_inventory');
create function pg_temp.recover_original(p_expected jsonb) returns void language plpgsql set search_path='' as $test$
declare
  expected_case_id uuid := (p_expected->>'expected_case_id')::uuid;
  expected_message_id uuid := (p_expected->>'expected_message_id')::uuid;
  expected_issuance_id uuid := (p_expected->>'expected_issuance_id')::uuid;
  expected_code_id uuid := (p_expected->>'expected_code_id')::uuid;
  expected_pool_id uuid := (p_expected->>'expected_pool_id')::uuid;
  expected_machine_id uuid := (p_expected->>'expected_machine_id')::uuid;
  expected_location_id uuid := (p_expected->>'expected_location_id')::uuid;
  expected_intent_id uuid := (p_expected->>'expected_intent_id')::uuid;
  expected_identity_digest text := (p_expected->>'expected_identity_digest')::text;
  expected_action_version bigint := (p_expected->>'expected_action_version')::bigint;
  expected_fact_version bigint := (p_expected->>'expected_fact_version')::bigint;
 c public.refund_cases; m public.refund_case_messages; i public.refund_gift_card_issuances;
 card public.refund_gift_card_codes; before_message jsonb;
begin

  if current_user in ('anon','authenticated','service_role') then
    raise exception 'Owner-held reviewed technical repair required' using errcode='42501';
  end if;
  select * into c from public.refund_cases where id=expected_case_id for update;
  select * into m from public.refund_case_messages where id=expected_message_id for update;
  select * into i from public.refund_gift_card_issuances where id=expected_issuance_id for update;
  select * into card from public.refund_gift_card_codes where id=expected_code_id for share;
  if c.id is null or m.id is null or i.id is null or card.id is null
    or c.case_population is distinct from 'customer'
    or c.resolution_method is distinct from 'gift_card'
    or c.gift_card_state is distinct from 'issued'
    or c.status is distinct from 'completed'
    or c.decision is not null
    or c.official_action_version is distinct from expected_action_version
    or c.deterministic_fact_version is distinct from expected_fact_version
    or c.reporting_machine_id is distinct from expected_machine_id
    or c.reporting_location_id is distinct from expected_location_id
    or c.gift_card_pool_id is distinct from expected_pool_id
    or i.refund_case_id is distinct from expected_case_id
    or i.message_id is distinct from expected_message_id
    or i.code_id is distinct from expected_code_id
    or i.pool_id is distinct from expected_pool_id
    or i.message_identity_digest is distinct from expected_identity_digest
    or i.normalized_email is distinct from m.recipient_email
    or i.normalized_email is distinct from lower(btrim(c.customer_email))
    or card.pool_id is distinct from expected_pool_id
    or card.issued_case_id is distinct from expected_case_id
    or card.status is distinct from 'issued'
    or i.expires_at <= statement_timestamp()
    or card.valid_from > statement_timestamp()
    or card.expires_at <= statement_timestamp()
    or m.refund_case_id is distinct from expected_case_id
    or m.manual_delivery_intent_id is distinct from expected_intent_id
    or m.manual_delivery_expected_case_version is distinct from expected_action_version
    or m.created_by is not null
    or m.delivery_kind is distinct from 'automatic'
    or m.message_type is distinct from 'completed'
    or m.content_source is distinct from 'deterministic_template'
    or m.template_version is distinct from 'refund_gift_card_v1'
    or m.gift_card_issuance_id is not null
    or m.status is distinct from 'failed'
    or m.manual_delivery_state is distinct from 'failed'
    or m.manual_delivery_attempt_count is distinct from 3
    or m.error_message is distinct from 'manual_delivery_claims_exhausted'
    or m.manual_delivery_claim_token is not null
    or m.manual_delivery_claimed_at is not null
    or m.manual_delivery_provider_attempted_at is not null
    or m.provider_message_id is not null or m.sent_at is not null
    or m.delivery_transport is not null
    or m.transactional_provider_message_header is not null
    or m.delivery_state is distinct from 'unknown'
    or m.delivery_state_updated_at is not null
    or public.refund_receipt_completion_message_digest(to_jsonb(m))
       is distinct from expected_identity_digest
    or not coalesce(public.is_refund_gift_card_message(to_jsonb(m)),false)
    or exists(select 1 from public.refund_case_events e where e.refund_case_id=expected_case_id
      and e.metadata->>'technical_repair_key'='system-gift-null-author-original-message-v1')
    or not exists(select 1 from public.refund_case_events e where e.refund_case_id=expected_case_id
      and e.event_type='customer_message_failed'
      and e.metadata->>'message_id'=expected_message_id::text
      and e.metadata->>'error_code'='manual_delivery_claims_exhausted'
      and e.metadata->>'provider_result'='not_started')
    or exists(select 1 from public.refund_case_events e where e.refund_case_id=expected_case_id
      and e.metadata->>'message_id'=expected_message_id::text
      and (e.metadata->>'provider_result' in ('unknown','accepted','sent','delivered')
        or e.metadata->>'provider_accessed'='true'))
    or exists(select 1 from public.refund_transactional_delivery_events e
      where e.matched_refund_case_message_id=expected_message_id)
    or exists(select 1 from public.refund_gmail_threads t where t.refund_case_id=expected_case_id)
    or exists(select 1 from public.refund_gmail_messages g where g.refund_case_id=expected_case_id)
    or exists(select 1 from public.refund_case_nayax_refund_attempts a where a.refund_case_id=expected_case_id)
    or exists(select 1 from public.refund_authoritative_receipts r where r.refund_case_id=expected_case_id)
    or exists(select 1 from public.refund_case_messages sibling
      where sibling.refund_case_id=expected_case_id and sibling.id<>expected_message_id
      and (sibling.gift_card_issuance_id=expected_issuance_id or sibling.template_version='refund_gift_card_v1')) then
    raise exception 'Exact exhausted zero-transport original gift proof changed' using errcode='P4655';
  end if;
  before_message:=to_jsonb(m);
  update public.refund_case_messages
    set status='pending',manual_delivery_state='queued',
      manual_delivery_attempt_count=2,error_message=null
    where id=expected_message_id returning * into m;
  if to_jsonb(m)-array['status','manual_delivery_state','manual_delivery_attempt_count','error_message']::text[]
      is distinct from before_message-array['status','manual_delivery_state','manual_delivery_attempt_count','error_message']::text[]
    or not coalesce(public.is_refund_receipt_automatic_completion_message(expected_message_id),false) then
    raise exception 'Existing original delivery authority or immutable identity failed' using errcode='P4655';
  end if;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(expected_case_id,null,'gift_card_delivery_requeued',
      'The original gift notice was restored after a verified pre-transport technical rejection.',
      jsonb_build_object('technical_repair_key','system-gift-null-author-original-message-v1',
        'message_id',expected_message_id,'intent_id',expected_intent_id,'issuance_id',expected_issuance_id,
        'previous_attempt_count',3,'restored_attempt_count',2,'additional_existing_claim_allowance',1,
        'previous_failure','manual_delivery_claims_exhausted','provider_accessed',false,
        'provider_result','not_started','new_message',false,'new_issuance',false,'payload_redacted',true));
end;
$test$;

create temp table original_snapshot as select to_jsonb(c) case_row,to_jsonb(i) issuance_row,
 to_jsonb(m) message_row,(select jsonb_agg(to_jsonb(x) order by id) from public.refund_gift_card_codes x)codes,
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]'::jsonb) from public.sales_adjustment_facts x)ledger
 from public.refund_cases c join public.refund_gift_card_issuances i on i.refund_case_id=c.id
 join public.refund_case_messages m on m.id=i.message_id where c.public_reference='RF-GIFT-FIRST';
update public.refund_case_messages set status='failed',manual_delivery_state='failed',
 manual_delivery_attempt_count=3,error_message='manual_delivery_claims_exhausted'
 where id=(select (message_row->>'id')::uuid from original_snapshot);
insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
 select (case_row->>'id')::uuid,'customer_message_failed','Synthetic pre-transport exhaustion.',
 jsonb_build_object('message_id',message_row->>'id','error_code','manual_delivery_claims_exhausted','provider_result','not_started') from original_snapshot;
create temp table args as select jsonb_build_object(
 'expected_case_id',c.id,'expected_message_id',m.id,'expected_issuance_id',i.id,'expected_code_id',i.code_id,
 'expected_pool_id',i.pool_id,'expected_machine_id',c.reporting_machine_id,'expected_location_id',c.reporting_location_id,
 'expected_intent_id',m.manual_delivery_intent_id,'expected_identity_digest',i.message_identity_digest,
 'expected_action_version',c.official_action_version,'expected_fact_version',c.deterministic_fact_version) expected,
 to_jsonb(m) exhausted_message
 from public.refund_cases c join public.refund_gift_card_issuances i on i.refund_case_id=c.id
 join public.refund_case_messages m on m.id=i.message_id where c.public_reference='RF-GIFT-FIRST';
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_action_version',(expected->>'expected_action_version')::bigint+1) from args))$guard$,'P4655',null,'Changed action is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_fact_version',(expected->>'expected_fact_version')::bigint+1) from args))$guard$,'P4655',null,'Changed fact is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_case_id','fc770000-0000-4000-8000-000000000099') from args))$guard$,'P4655',null,'Foreign expected_case_id is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_message_id','fc770000-0000-4000-8000-000000000099') from args))$guard$,'P4655',null,'Foreign expected_message_id is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_issuance_id','fc770000-0000-4000-8000-000000000099') from args))$guard$,'P4655',null,'Foreign expected_issuance_id is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_intent_id','fc770000-0000-4000-8000-000000000099') from args))$guard$,'P4655',null,'Foreign expected_intent_id is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_machine_id','fc770000-0000-4000-8000-000000000099') from args))$guard$,'P4655',null,'Foreign expected_machine_id is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_location_id','fc770000-0000-4000-8000-000000000099') from args))$guard$,'P4655',null,'Foreign expected_location_id is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_code_id','fc770000-0000-4000-8000-000000000099') from args))$guard$,'P4655',null,'Foreign expected_code_id is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_pool_id','fc770000-0000-4000-8000-000000000099') from args))$guard$,'P4655',null,'Foreign expected_pool_id is rejected'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected||jsonb_build_object('expected_identity_digest',repeat('0',64)) from args))$guard$,'P4655',null,'Altered immutable digest is rejected'));
update public.refund_case_messages set manual_delivery_provider_attempted_at=statement_timestamp() where id=(select (expected->>'expected_message_id')::uuid from args);
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected from args))$guard$,'P4655',null,'Any manual_delivery_provider_attempted_at evidence is rejected'));
update public.refund_case_messages set manual_delivery_provider_attempted_at=null where id=(select (expected->>'expected_message_id')::uuid from args);
update public.refund_case_messages set provider_message_id='fc770000-0000-4000-8000-000000000098' where id=(select (expected->>'expected_message_id')::uuid from args);
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected from args))$guard$,'P4655',null,'Any provider_message_id evidence is rejected'));
update public.refund_case_messages set provider_message_id=null where id=(select (expected->>'expected_message_id')::uuid from args);
update public.refund_case_messages set delivery_transport='resend' where id=(select (expected->>'expected_message_id')::uuid from args);
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected from args))$guard$,'P4655',null,'Any delivery_transport evidence is rejected'));
update public.refund_case_messages set delivery_transport=null where id=(select (expected->>'expected_message_id')::uuid from args);
update public.refund_case_messages set delivery_state='accepted' where id=(select (expected->>'expected_message_id')::uuid from args);
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected from args))$guard$,'P4655',null,'Any delivery_state evidence is rejected'));
update public.refund_case_messages set delivery_state='unknown' where id=(select (expected->>'expected_message_id')::uuid from args);
insert into public.refund_case_events(refund_case_id,event_type,message,metadata) select (expected->>'expected_case_id')::uuid,'customer_message_failed','Synthetic ambiguous outcome.',jsonb_build_object('message_id',expected->>'expected_message_id','provider_result','unknown') from args;
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected from args))$guard$,'P4655',null,'An unknown historical outcome is rejected'));
delete from public.refund_case_events where message='Synthetic ambiguous outcome.';
create temp table held_event as select * from public.refund_case_events where message='Synthetic pre-transport exhaustion.';
delete from public.refund_case_events where message='Synthetic pre-transport exhaustion.';
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected from args))$guard$,'P4655',null,'Missing exact not-started failure event is rejected'));
insert into public.refund_case_events select * from held_event;
select pg_temp.require_ok(ok((select to_jsonb(m)=a.exhausted_message from public.refund_case_messages m,args a where m.id=(a.expected->>'expected_message_id')::uuid),'All rejected paths leave exact original message intact'));
update public.refund_gift_card_codes set valid_from=statement_timestamp()+interval '1 day'
 where id=(select (expected->>'expected_code_id')::uuid from args);
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected from args))$guard$,'P4655',null,'A future-valid code cannot spend the restored claim'));
update public.refund_gift_card_codes set valid_from=(select (x->>'valid_from')::timestamptz
 from original_snapshot s cross join lateral jsonb_array_elements(s.codes)x where (x->>'id')::uuid=refund_gift_card_codes.id)
 where id=(select (expected->>'expected_code_id')::uuid from args);
select pg_temp.require_ok(lives_ok($guard$select pg_temp.recover_original((select expected from args))$guard$,'One exact zero-transport original message can be restored'));
select pg_temp.require_ok(ok((select m.status='pending' and m.manual_delivery_state='queued' and m.manual_delivery_attempt_count=2 and m.error_message is null and m.manual_delivery_provider_attempted_at is null and m.provider_message_id is null and m.sent_at is null from public.refund_case_messages m,args a where m.id=(a.expected->>'expected_message_id')::uuid),'Restoration grants only one existing claim and does not deliver'));
select pg_temp.require_ok(ok((select to_jsonb(m)-array['status','manual_delivery_state','manual_delivery_attempt_count','error_message']::text[]=a.exhausted_message-array['status','manual_delivery_state','manual_delivery_attempt_count','error_message']::text[] from public.refund_case_messages m,args a where m.id=(a.expected->>'expected_message_id')::uuid),'All non-repair message fields remain exact'));
select pg_temp.require_ok(ok(public.is_refund_receipt_automatic_completion_message((select (expected->>'expected_message_id')::uuid from args)),'Existing automatic gift authority proves the restored original message'));
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected from args))$guard$,'P4655',null,'Exact repair replay is rejected'));
select pg_temp.require_ok(is((select count(*) from public.refund_case_events where metadata->>'technical_repair_key'='system-gift-null-author-original-message-v1'),1::bigint,'Exactly one durable existing audit marker retains prior and restored claim counts'));
select pg_temp.require_ok(ok((select to_jsonb(c)-array['updated_at','lifecycle_revision']::text[]=s.case_row-array['updated_at','lifecycle_revision']::text[] from public.refund_cases c,original_snapshot s where c.id=(s.case_row->>'id')::uuid),'Business case and all current fact/action fields are exact'));
select pg_temp.require_ok(ok((select to_jsonb(i)=s.issuance_row from public.refund_gift_card_issuances i,original_snapshot s where i.id=(s.issuance_row->>'id')::uuid),'Original issuance and promise are exact'));
select pg_temp.require_ok(ok((select jsonb_agg(to_jsonb(x) order by id) from public.refund_gift_card_codes x)=(select codes from original_snapshot),'All private code stock is exact'));
select pg_temp.require_ok(ok((select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]'::jsonb) from public.sales_adjustment_facts x)=(select ledger from original_snapshot),'Reporting ledger is exact'));
select pg_temp.require_ok(is((select count(*) from public.refund_case_messages),1::bigint,'No second message or intent is created'));
select pg_temp.require_ok(is((select count(*) from public.refund_gift_card_issuances),1::bigint,'No second gift is created'));
select pg_temp.require_ok(is((select count(*) from public.refund_transactional_delivery_events),0::bigint,'No provider event or transport action occurred'));

-- A separately seeded immutable historical promise proves that issuance expiry,
-- not merely the still-valid underlying code, is part of the recovery boundary.
update public.refund_gift_card_pools set enabled=false where id='fc750000-0000-4000-8000-000000000001';
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
 values('fc760000-0000-4000-8000-000000000003','RF-EXPIRED-PROMISE','fc740000-0000-4000-8000-000000000001',
 'fc730000-0000-4000-8000-000000000001','expired-promise@example.invalid','Synthetic expired immutable promise',
 now(),'card',1500,1500,'gift_card','fc750000-0000-4000-8000-000000000001',1500,
 now()-interval '1 hour','pending_inventory');
update public.refund_gift_card_pools set enabled=true where id='fc750000-0000-4000-8000-000000000001';
do $seed$ declare c public.refund_cases; m public.refund_case_messages; card public.refund_gift_card_codes; begin
 select * into c from public.refund_cases where id='fc760000-0000-4000-8000-000000000003';
 select * into card from public.refund_gift_card_codes where pool_id=c.gift_card_pool_id and status='available' order by id limit 1;
 update public.refund_gift_card_codes set status='issued',issued_case_id=c.id where id=card.id;
 update public.refund_cases set gift_card_state='issued',status='completed' where id=c.id returning * into c;
 select message.* into m from public.refund_case_messages message,args a where message.id=(a.expected->>'expected_message_id')::uuid;
 m.id:=gen_random_uuid();m.refund_case_id:=c.id;m.recipient_email:=c.customer_email;
 m.manual_delivery_intent_id:=gen_random_uuid();m.manual_delivery_expected_case_version:=c.official_action_version;
 m.status:='failed';m.manual_delivery_state:='failed';m.manual_delivery_attempt_count:=3;m.error_message:='manual_delivery_claims_exhausted';
 insert into public.refund_gift_card_issuances(refund_case_id,code_id,pool_id,normalized_email,purchase_amount_cents,
 face_value_cents,goodwill_amount_cents,currency,eligible_locations,expires_at,redemption_instructions,issued_at,message_id,message_identity_digest)
 values(c.id,card.id,c.gift_card_pool_id,c.customer_email,1500,1500,0,'USD',array['Fixture location'],
 c.gift_card_expires_at,'Synthetic redemption instructions',now()-interval '2 days',m.id,
 public.refund_receipt_completion_message_digest(to_jsonb(m)));
 insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
 template_key,template_version,content_source,delivery_kind,requested_fields,manual_delivery_intent_id,
 manual_delivery_state,manual_delivery_expected_case_version,manual_delivery_status_link_requested,manual_delivery_attempt_count,error_message)
 values(m.id,c.id,'completed','failed',m.recipient_email,m.subject,m.body,m.template_key,m.template_version,
 m.content_source,m.delivery_kind,m.requested_fields,m.manual_delivery_intent_id,'failed',c.official_action_version,false,3,m.error_message);
 insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
 values(c.id,'customer_message_failed','Synthetic expired proof exhaustion.',
 jsonb_build_object('message_id',m.id,'error_code','manual_delivery_claims_exhausted','provider_result','not_started'));
end $seed$;
create temp table expired_args as select jsonb_build_object(
 'expected_case_id',c.id,'expected_message_id',m.id,'expected_issuance_id',i.id,'expected_code_id',i.code_id,
 'expected_pool_id',i.pool_id,'expected_machine_id',c.reporting_machine_id,'expected_location_id',c.reporting_location_id,
 'expected_intent_id',m.manual_delivery_intent_id,'expected_identity_digest',i.message_identity_digest,
 'expected_action_version',c.official_action_version,'expected_fact_version',c.deterministic_fact_version) expected
 from public.refund_cases c join public.refund_gift_card_issuances i on i.refund_case_id=c.id
 join public.refund_case_messages m on m.id=i.message_id where c.public_reference='RF-EXPIRED-PROMISE';
select pg_temp.require_ok(throws_ok($guard$select pg_temp.recover_original((select expected from expired_args))$guard$,
 'P4655',null,'An expired immutable issuance promise cannot spend the restored claim'));
select pg_temp.require_ok(is((select manual_delivery_attempt_count from public.refund_case_messages
 where id=(select (expected->>'expected_message_id')::uuid from expired_args)),3::smallint,'Expired promise retains its exact failed claim count'));
select * from finish(true);
rollback;
