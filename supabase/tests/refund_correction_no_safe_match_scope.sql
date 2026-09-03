-- Integrated contract: preserves historical cycle[] while the sent message
-- carries only current, safe candidate-derived customer fields.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(14);
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values('de000000-0000-4000-8000-000000000001','authenticated','authenticated','correction-scope@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type) values('de000000-0000-4000-8000-000000000002','No-match scope fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status) values('de000000-0000-4000-8000-000000000003','de000000-0000-4000-8000-000000000002','No-match fixture location','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values('de000000-0000-4000-8000-000000000004','de000000-0000-4000-8000-000000000002','de000000-0000-4000-8000-000000000003','No-match scope machine','active');
insert into public.admin_roles(user_id,role,active) values('de000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason) values('de000000-0000-4000-8000-000000000004','de000000-0000-4000-8000-000000000001','correction-scope@example.invalid','Scoped wallet fixture');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true,correction_links_enabled=true where singleton;
insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,incident_timezone,
 incident_time_resolution,payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_wallet_used,status,correlation_status,correlation_source,
 nayax_lookup_status,nayax_lookup_generation,nayax_recommendation_state,nayax_recommendation_policy_version,nayax_recommendation_evaluated_at,nayax_match_execution_eligible,intake_source)
values('de000000-0000-4000-8000-000000000005','de000000-0000-4000-8000-000000000004','de000000-0000-4000-8000-000000000003','scope-customer@example.invalid',
 'Scoped candidate correction fixture',statement_timestamp()-interval '2 hours',to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
 'America/Los_Angeles','exact','card','tap_card',700,'1234','physical_card',false,'needs_review','no_match','nayax','no_match',1,'no_safe_match','nayax_refund_match_v7',statement_timestamp(),false,'form');
insert into public.refund_nayax_lookup_candidates(refund_case_id,actor_user_id,reporting_machine_id,lookup_generation,provider_transaction_id,site_id,machine_authorization_time,amount_cents,
 card_last4,currency_code,evidence_summary,expires_at)
values('de000000-0000-4000-8000-000000000005','de000000-0000-4000-8000-000000000001','de000000-0000-4000-8000-000000000004',1,'provider-scope-fixture',1,
 statement_timestamp()-interval '2 hours',900,'1234','USD','{"is_top_ranked":true,"reason_codes":["amount_mismatch"],"hard_exclusions":[]}',statement_timestamp()+interval '30 minutes');
select is(public.refund_purchase_correction_request_fields('de000000-0000-4000-8000-000000000005'),array['amount']::text[],'Only the fresh candidate amount conflict is a customer correction');
create temp table scope_cycle as select public.service_claim_refund_follow_up_cycle('de000000-0000-4000-8000-000000000005','no_safe_match','refund_follow_up_v2',repeat('e',64),null) as value;
select is((select value#>'{cycle,requestedFields}' from scope_cycle),'[]'::jsonb,'Existing no-safe-match cycle retains historical empty requested fields');
select lives_ok($$insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
 values('de000000-0000-4000-8000-000000000006','de000000-0000-4000-8000-000000000005','no_safe_match','pending','scope-customer@example.invalid','Review purchase amount',
 '[Secure refund correction link included at delivery]','deterministic_template','automatic','no_safe_match','refund_follow_up_v2',(select(value#>>'{cycle,id}')::uuid from scope_cycle),array['amount'])$$,
 'Scoped message persists current correction fields without rewriting cycle identity');
select lives_ok($$select public.service_issue_refund_purchase_correction('de000000-0000-4000-8000-000000000006',repeat('e',64),
 (select deterministic_fact_version from public.refund_cases where id='de000000-0000-4000-8000-000000000005'))$$,'Message fields issue the exact same-case capability');
select is((select requested_fields from public.refund_follow_up_cycles where id=(select(value#>>'{cycle,id}')::uuid from scope_cycle)),'{}'::text[],'Issuance preserves the original immutable cycle[]');
select lives_ok($$update public.refund_case_messages set status='sent',sent_at=statement_timestamp() where id='de000000-0000-4000-8000-000000000006'$$,'Tracked sent state accepts the matching current capability');
select is(public.service_get_refund_purchase_correction(repeat('e',64))->>'state','ready','Only sent scoped message opens its correction page');
update public.refund_cases set nayax_lookup_generation=2 where id='de000000-0000-4000-8000-000000000005';
insert into public.refund_nayax_lookup_candidates(refund_case_id,actor_user_id,reporting_machine_id,lookup_generation,provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select refund_case_id,actor_user_id,reporting_machine_id,2,'provider-scope-expired',site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,statement_timestamp()-interval '1 second'
from public.refund_nayax_lookup_candidates where refund_case_id='de000000-0000-4000-8000-000000000005' and lookup_generation=1;
select is(public.refund_purchase_correction_request_fields('de000000-0000-4000-8000-000000000005'),'{}'::text[],'Expired candidate evidence cannot authorize another question');
update public.refund_cases set nayax_lookup_generation=3 where id='de000000-0000-4000-8000-000000000005';
select is(public.refund_purchase_correction_request_fields('de000000-0000-4000-8000-000000000005'),'{}'::text[],'Older generation cannot supply a fresh no-match question');
insert into public.refund_nayax_lookup_candidates(refund_case_id,actor_user_id,reporting_machine_id,lookup_generation,provider_transaction_id,site_id,machine_authorization_time,amount_cents,card_last4,currency_code,evidence_summary,expires_at)
select refund_case_id,actor_user_id,reporting_machine_id,3,'provider-scope-internal',site_id,machine_authorization_time,amount_cents,card_last4,currency_code,
 '{"is_top_ranked":true,"reason_codes":["amount_mismatch"],"hard_exclusions":["missing_canonical_machine_mapping"]}',statement_timestamp()+interval '30 minutes'
from public.refund_nayax_lookup_candidates where refund_case_id='de000000-0000-4000-8000-000000000005' and lookup_generation=1;
select is(public.refund_purchase_correction_request_fields('de000000-0000-4000-8000-000000000005'),'{}'::text[],'Internal machine mapping failures never become customer homework');
insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,
 payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_wallet_used,status,correlation_status,intake_source)
values('de000000-0000-4000-8000-000000000007','de000000-0000-4000-8000-000000000004','de000000-0000-4000-8000-000000000003','scope-customer@example.invalid','Wallet context correction fixture',
 statement_timestamp()-interval '2 hours',to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
 'America/Los_Angeles','exact','card','phone_watch_wallet',700,'1234','wallet_device_token',true,'needs_review','manual_review','form');
select is(public.refund_purchase_correction_request_fields('de000000-0000-4000-8000-000000000007'),array['wallet_provider']::text[],'Original wallet request asks only its missing provider');
create temp table wallet_message as select public.service_enqueue_refund_manual_message_intent('de000000-0000-4000-8000-000000000007',
 (select official_action_version from public.refund_cases where id='de000000-0000-4000-8000-000000000007'),gen_random_uuid(),'de000000-0000-4000-8000-000000000001',
 'more_info','scope-customer@example.invalid','Review wallet detail','[Secure refund correction link included at delivery]',
 'refund_more_info_editable_v1','manager_authored','missing_information',array['wallet_provider'],null,false,null) as value;
select public.service_issue_refund_purchase_correction((select(value->>'messageId')::uuid from wallet_message),repeat('f',64),
 (select deterministic_fact_version from public.refund_cases where id='de000000-0000-4000-8000-000000000007'));
create temp table wallet_claim as select * from public.service_claim_refund_manual_message_deliveries((select(value->>'messageId')::uuid from wallet_message),1);
select public.service_mark_refund_manual_message_provider_attempt((select refund_case_message_id from wallet_claim),(select claim_token from wallet_claim));
select public.service_finish_refund_manual_message_delivery((select refund_case_message_id from wallet_claim),(select claim_token from wallet_claim),'sent','gmail_thread',null,1,'mapped_manager');
select lives_ok($$select public.service_submit_refund_purchase_correction(repeat('f',64),(select correction_fact_version from public.refund_wallet_correction_contexts where token_hash=repeat('f',64)),
 '{"payment_interaction":{"disposition":"changed","value":"tap_card"},"card_last4":{"disposition":"confirmed"}}')$$,
 'Changing wallet to physical card drops wallet question and explicitly reconfirms same digits');
select ok((select payment_interaction='tap_card' and card_wallet_used=false and wallet_provider is null and card_last4='1234' and card_last4_provenance='physical_card' and decision is null from public.refund_cases where id='de000000-0000-4000-8000-000000000007'),
 'New physical payment provenance is explicit without inventing wallet provider or approval');
select ok((select correction_requested_fields=array['wallet_provider']::text[] and not correction_response ? 'wallet_provider' from public.refund_wallet_correction_contexts where token_hash=repeat('f',64)),
 'History keeps the original question without inventing an unknown answer to an inapplicable field');
select * from finish();
rollback;
