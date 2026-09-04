-- Integrated contract: preserves historical cycle[] while the sent message
-- carries only current, safe candidate-derived customer fields.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
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
 statement_timestamp()-interval '2 hours',900,'5678','USD','{"is_top_ranked":true,"reason_codes":["amount_mismatch","card_last4_mismatch"],"hard_exclusions":[]}',statement_timestamp()+interval '30 minutes');
select is(public.refund_purchase_correction_request_fields('de000000-0000-4000-8000-000000000005'),array['amount','card_last4']::text[],'Fresh candidate conflicts supply two eligible fields for a manager-selected subset');
create temp table scope_cycle as select public.service_claim_refund_follow_up_cycle('de000000-0000-4000-8000-000000000005','no_safe_match','refund_follow_up_v2',repeat('e',64),null) as value;
select is((select value#>'{cycle,requestedFields}' from scope_cycle),'[]'::jsonb,'Existing no-safe-match cycle retains historical empty requested fields');
select lives_ok($$insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
 values('de000000-0000-4000-8000-000000000006','de000000-0000-4000-8000-000000000005','no_safe_match','pending','scope-customer@example.invalid','Review purchase amount',
 '[Secure refund correction link included at delivery]','deterministic_template','automatic','no_safe_match','refund_follow_up_v2',(select(value#>>'{cycle,id}')::uuid from scope_cycle),array['amount'])$$,
 'Scoped message persists one selected current field without rewriting cycle identity');
select lives_ok($$select public.service_issue_refund_purchase_correction('de000000-0000-4000-8000-000000000006',repeat('e',64),
 (select deterministic_fact_version from public.refund_cases where id='de000000-0000-4000-8000-000000000005'))$$,'Message fields issue the exact same-case capability');
select is((select requested_fields from public.refund_follow_up_cycles where id=(select(value#>>'{cycle,id}')::uuid from scope_cycle)),'{}'::text[],'Issuance preserves the original immutable cycle[]');
select lives_ok($$update public.refund_case_messages set status='sent',sent_at=statement_timestamp() where id='de000000-0000-4000-8000-000000000006'$$,'Tracked sent state accepts the matching current capability');
select is(public.service_get_refund_purchase_correction(repeat('e',64))->>'state','ready','Only sent scoped message opens its correction page');

create temp table revision_identity as select id as request_id,(select official_action_version from public.refund_cases where id=refund_case_id) as case_version from public.refund_wallet_correction_contexts where token_hash=repeat('e',64);
create function pg_temp.revise(fields text[], intent uuid default 'de000000-0000-4000-8000-000000000008', actor uuid default 'de000000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.service_revise_refund_purchase_correction('de000000-0000-4000-8000-000000000005',(select case_version from revision_identity),intent,actor,(select request_id from revision_identity),'scope-customer@example.invalid','Review corrected details','[Secure refund correction link included at delivery]',fields);
$$;
select ok(not has_function_privilege('authenticated','public.service_revise_refund_purchase_correction(uuid,bigint,uuid,uuid,uuid,text,text,text,text[])','execute'),'Browser cannot directly revise a request');
select throws_like($$select pg_temp.revise(array['amount'])$$,'%different current set%','Unchanged fields cannot consume another contact');
select throws_like($$select pg_temp.revise(array['card_last4','card_last4'])$$,'%Canonical correction fields%','Duplicate field set rejected');
select throws_like($$select pg_temp.revise(array['wallet_provider'])$$,'%different current set%','Unsupported field rejected');
select throws_like($$select pg_temp.revise(array['card_last4'],'de000000-0000-4000-8000-000000000008','de000000-0000-4000-8000-000000000009')$$,'%Current case access%','Current assignment authorization required');
create function pg_temp.claimed_reminder_race() returns text language plpgsql as $$ begin
 update public.refund_follow_up_cycles set reminder_claimed_at=reminder_due_at where refund_case_id='de000000-0000-4000-8000-000000000005';
 perform pg_temp.revise(array['card_last4']); return 'unexpected success';
 exception when others then return sqlerrm; end; $$;
select like(pg_temp.claimed_reminder_race(),'%already being prepared%','Already-claimed reminder interleaving blocks revision before revocation');
select is((select status from public.refund_wallet_correction_contexts where id=(select request_id from revision_identity)),'pending','Failed revision leaves original capability active');

create temp table revision_result as select pg_temp.revise(array['card_last4']) as value;
select is((select status from public.refund_wallet_correction_contexts where id=(select request_id from revision_identity)),'revoked','Explicit changed request atomically revokes original scope');
select is((select status from public.refund_case_messages where id='de000000-0000-4000-8000-000000000006'),'sent','Original sent history stays immutable');
select is((select status from public.refund_follow_up_cycles where refund_case_id='de000000-0000-4000-8000-000000000005'),'manual_review','Old reminder cycle retired');
select is((select official_action_version from public.refund_cases where id='de000000-0000-4000-8000-000000000005'),(select case_version from revision_identity),'Queued official version remains usable');
select is(public.service_get_refund_purchase_correction(repeat('e',64))->>'state','unavailable','Old link cannot accept another response');
select ok((pg_temp.revise(array['card_last4'])->>'replayed')::boolean,'Same intent replays without another queued message');
select is((select count(*)::integer from public.refund_purchase_correction_revisions),1,'Only one replacement binding exists');
select throws_like($$select public.service_issue_refund_wallet_correction('de000000-0000-4000-8000-000000000005',repeat('a',64),statement_timestamp()+interval '48 hours')$$,'%owns customer follow-up%','Legacy wallet issuer cannot race queued manager replacement');
select lives_ok($$select public.service_issue_refund_purchase_correction((select(value->>'messageId')::uuid from revision_result),repeat('b',64),(select deterministic_fact_version from public.refund_cases where id='de000000-0000-4000-8000-000000000005'))$$,'Replacement obtains existing second-contact scope');
create temp table replacement_claim as select * from public.service_claim_refund_manual_message_deliveries((select(value->>'messageId')::uuid from revision_result),1);
select is((select count(*)::integer from replacement_claim),1,'Existing outbox can claim replacement');
select public.service_mark_refund_manual_message_provider_attempt((select refund_case_message_id from replacement_claim),(select claim_token from replacement_claim));
select public.service_finish_refund_manual_message_delivery((select refund_case_message_id from replacement_claim),(select claim_token from replacement_claim),'sent','gmail_thread',null,1,'mapped_manager');
select is(public.service_get_refund_purchase_correction(repeat('b',64))->>'state','ready','Replacement becomes usable only after actual sender settlement');
select like(public.refund_correction_revision_reason('de000000-0000-4000-8000-000000000005',(select id from public.refund_wallet_correction_contexts where token_hash=repeat('b',64)),'de000000-0000-4000-8000-000000000001'),'%two-contact limit%','Second delivered request cannot be revoked for a forbidden third contact');
update public.refund_cases set issue_summary='Later manager progress' where id='de000000-0000-4000-8000-000000000005';
select ok((pg_temp.revise(array['card_last4'])->>'replayed')::boolean,'Exact original intent replay survives later official version progress');
select throws_like($$select pg_temp.revise(array['amount','card_last4'])$$,'%already bound%','Changed payload cannot replay existing revision intent');
select * from finish();
rollback;


