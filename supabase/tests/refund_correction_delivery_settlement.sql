begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(12);
insert into public.customer_accounts(id,name,account_type) values('de000000-0000-4000-8000-000000000001','Correction delivery fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status) values('de000000-0000-4000-8000-000000000002','de000000-0000-4000-8000-000000000001','Delivery fixture location','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,refund_intake_enabled,refund_public_display_label)
values('de000000-0000-4000-8000-000000000003','de000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000002','Delivery fixture machine','commercial','active',true,'Delivery fixture machine');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true,correction_links_enabled=true where singleton;
insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,
  incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_network,status,correlation_status,intake_source)
values('de000000-0000-4000-8000-000000000004','de000000-0000-4000-8000-000000000003','de000000-0000-4000-8000-000000000002',
  'delivery-customer@example.invalid','Scoped delivery test',statement_timestamp()-interval '2 hours',
  to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
  'America/Los_Angeles','exact','exact','card','tap_card',null,'1234','physical_card','visa','needs_review','manual_review','form');
do $$ declare cycle jsonb; begin
  cycle:=public.service_claim_refund_follow_up_cycle('de000000-0000-4000-8000-000000000004','missing_information','refund_follow_up_v2',repeat('e',64),null);
  if not coalesce((cycle->>'claimed')::boolean,false) then raise exception 'Fixture cycle rejected: %',cycle; end if;
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
  values('de000000-0000-4000-8000-000000000005','de000000-0000-4000-8000-000000000004','more_info','pending','delivery-customer@example.invalid',
    'Update your request','[Secure refund correction link included at delivery]','deterministic_template','automatic','missing_information','refund_follow_up_v2',(cycle#>>'{cycle,id}')::uuid,array['amount']);
end; $$;
select public.service_issue_refund_purchase_correction('de000000-0000-4000-8000-000000000005',repeat('e',64),
 (select deterministic_fact_version from public.refund_cases where id='de000000-0000-4000-8000-000000000004'));
select public.service_mark_refund_transactional_delivery_attempt('de000000-0000-4000-8000-000000000005');
select public.service_bind_refund_transactional_delivery('de000000-0000-4000-8000-000000000005','synthetic-correction-accepted',statement_timestamp());
-- Provider already accepted this exact immutable message. Facts advance and
-- scope expires before local sent bookkeeping finishes; there is no new send.
update public.refund_cases set payment_amount_cents=900 where id='de000000-0000-4000-8000-000000000004';
update public.refund_wallet_correction_contexts set issued_at=statement_timestamp()-interval '49 hours',expires_at=statement_timestamp()-interval '1 hour' where token_hash=repeat('e',64);
select lives_ok($$update public.refund_case_messages set status='sent',sent_at=statement_timestamp() where id='de000000-0000-4000-8000-000000000005'$$,'Exact accepted delivery settles despite expired/stale write scope');
select is((select status from public.refund_case_messages where id='de000000-0000-4000-8000-000000000005'),'sent','Actual delivered message history remains truthful');
select is((select status from public.refund_cases where id='de000000-0000-4000-8000-000000000004'),'needs_review','Late settlement does not put case back in customer waiting');
select is((select status from public.refund_follow_up_cycles where refund_case_id='de000000-0000-4000-8000-000000000004'),'claimed','Late settlement does not restart old follow-up cycle');
select is(public.service_get_refund_purchase_correction(repeat('e',64))->>'state','unavailable','Recording delivery does not reactivate the stale expired write link');
select is((select count(*)::integer from public.refund_wallet_correction_contexts where refund_case_id='de000000-0000-4000-8000-000000000004'),1,'Settlement issues no replacement capability');
-- Exercise the real claimed manual outbox settlement, including the bookkeeping
-- fields cleared by its RPC. A direct status-only UPDATE is not sufficient.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('de000000-0000-4000-8000-000000000006','authenticated','authenticated','delivery-manager@example.invalid','{}','{}');
insert into public.admin_roles(user_id,role,active) values('de000000-0000-4000-8000-000000000006','super_admin',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('de000000-0000-4000-8000-000000000003','de000000-0000-4000-8000-000000000006','delivery-manager@example.invalid','Scoped delivery fixture');
insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,
  incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_network,status,correlation_status,intake_source)
select 'de000000-0000-4000-8000-000000000007',reporting_machine_id,reporting_location_id,customer_email,'Manual scoped delivery test',incident_at,incident_local_datetime,
  incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,null,card_last4,card_last4_provenance,card_network,'needs_review','manual_review',intake_source
from public.refund_cases where id='de000000-0000-4000-8000-000000000004';
create temp table manual_message as select public.service_enqueue_refund_manual_message_intent(
 'de000000-0000-4000-8000-000000000007',(select official_action_version from public.refund_cases where id='de000000-0000-4000-8000-000000000007'),
 gen_random_uuid(),'de000000-0000-4000-8000-000000000006','more_info','delivery-customer@example.invalid','Update your request','[Secure refund correction link included at delivery]',
 'refund_more_info_editable_v1','manager_authored','missing_information',array['amount'],null,false,null) as value;
create temp table manual_claim as select * from public.service_claim_refund_manual_message_deliveries((select(value->>'messageId')::uuid from manual_message),1);
select public.service_issue_refund_purchase_correction((select refund_case_message_id from manual_claim),repeat('f',64),
 (select deterministic_fact_version from public.refund_cases where id='de000000-0000-4000-8000-000000000007'));
select public.service_mark_refund_manual_message_provider_attempt((select refund_case_message_id from manual_claim),(select claim_token from manual_claim));
select public.service_mark_refund_transactional_delivery_attempt((select refund_case_message_id from manual_claim));
select public.service_bind_refund_transactional_delivery((select refund_case_message_id from manual_claim),'synthetic-manual-correction-accepted',statement_timestamp());
update public.refund_cases set payment_amount_cents=950 where id='de000000-0000-4000-8000-000000000007';
update public.refund_wallet_correction_contexts set issued_at=statement_timestamp()-interval '49 hours',expires_at=statement_timestamp()-interval '1 hour' where token_hash=repeat('f',64);
select throws_like($$update public.refund_case_messages set body=body||' changed',status='sent',sent_at=statement_timestamp(),manual_delivery_state='sent',manual_delivery_claim_token=null,manual_delivery_claimed_at=null,error_message=null
 where id=(select refund_case_message_id from manual_claim)$$,'%Scoped correction requires current specific customer fields%','Accepted delivery exception cannot change the immutable message body');
select lives_ok($$select public.service_finish_refund_manual_message_delivery((select refund_case_message_id from manual_claim),(select claim_token from manual_claim),'sent','transactional_email',null,1,'mapped_manager')$$,
 'Real manual outbox finish records its exact accepted delivery after facts and expiry advance');
select ok((select status='sent' and manual_delivery_state='sent' and manual_delivery_claim_token is null from public.refund_case_messages where id=(select refund_case_message_id from manual_claim)),
 'Manual delivery claim finishes once and retains SENT truth');
select is((select status from public.refund_cases where id='de000000-0000-4000-8000-000000000007'),'needs_review','Manual late finish does not restore customer waiting');
select is(public.service_get_refund_purchase_correction(repeat('f',64))->>'state','unavailable','Actual manual settlement cannot reactivate stale expired scope');
select is((public.service_finish_refund_manual_message_delivery((select refund_case_message_id from manual_claim),(select claim_token from manual_claim),'sent','transactional_email',null,1,'mapped_manager')->>'replayed')::boolean,true,
 'Repeating the actual finish replays existing outcome without another send or capability');
select * from finish();
rollback;

