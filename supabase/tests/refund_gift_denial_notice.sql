begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
 ('fd710000-0000-4000-8000-000000000001','gift-denial-manager@example.invalid'),
 ('fd710000-0000-4000-8000-000000000002','gift-denial-other@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('fd720000-0000-4000-8000-000000000001','Gift denial fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('fd730000-0000-4000-8000-000000000001','fd720000-0000-4000-8000-000000000001','Denial fixture','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 values('fd740000-0000-4000-8000-000000000001','fd720000-0000-4000-8000-000000000001',
 'fd730000-0000-4000-8000-000000000001','Denial fixture','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
 values('fd740000-0000-4000-8000-000000000001','fd710000-0000-4000-8000-000000000001','gift-denial-manager@example.invalid','Synthetic denial');
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
 eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
 values('fd750000-0000-4000-8000-000000000001','kemore','gift-denial-fixture',1500,
 array['fd740000-0000-4000-8000-000000000001']::uuid[],array['Denial fixture'],
 now()+interval '30 days',true,'Enter the synthetic code.');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state,issue_category,intake_meta)
select ('fd760000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-GIFT-DENIAL-'||n,
 'fd740000-0000-4000-8000-000000000001','fd730000-0000-4000-8000-000000000001',
 'gift-denial-'||n||'@example.invalid','Synthetic partial delivery',now(),'cash',1100,1100,'gift_card',
 'fd750000-0000-4000-8000-000000000001',1500,now()+interval '30 days','manager_review','partial_items',
 jsonb_build_object('customer_locale',case when n=2 then 'es' else 'en' end)
from generate_series(1,3)n;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fd710000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.admin_decide_refund_gift_card('fd760000-0000-4000-8000-000000000001',false,'Reviewed reason')$$,
 '42501',null,'An unassigned user cannot decide or queue customer contact');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fd710000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.admin_decide_refund_gift_card('fd760000-0000-4000-8000-000000000001',false,' ')$$,
 'P4681',null,'Denial requires an explicit customer explanation before saving');
select is((select gift_card_state from public.refund_cases where public_reference='RF-GIFT-DENIAL-1'),
 'manager_review','A rejected empty explanation leaves decision untouched');
select lives_ok($$select public.admin_decide_refund_gift_card('fd760000-0000-4000-8000-000000000001',false,'The reviewed request is not eligible. <script>example</script>')$$,
 'One Manager action saves denial and the durable customer notice');
select is((select count(*) from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000001' and message_type='denied'),
 1::bigint,'A committed denial has exactly one outbox message even before a worker runs');
select is(public.refund_lifecycle_contract('fd760000-0000-4000-8000-000000000001')#>>'{nextWork,isOpen}',
 'true','Decision is final while queued customer contact remains open');
select is(public.refund_lifecycle_contract('fd760000-0000-4000-8000-000000000001')#>>'{nextWork,actor}',
 'system','No second Manager decision is requested for delivery');
select lives_ok($$select public.admin_decide_refund_gift_card('fd760000-0000-4000-8000-000000000001',false,'A retry must not rewrite the explanation')$$,
 'Lost response safely replays the original decision');
select lives_ok($$select public.admin_decide_refund_gift_card('fd760000-0000-4000-8000-000000000001',true)$$,
 'Opposite replay returns the saved decision without issuing a code');
select is((select count(*) from public.refund_case_events where refund_case_id='fd760000-0000-4000-8000-000000000001' and event_type='gift_card_exception_decided'),
 1::bigint,'Repeated and opposite actions preserve one decision event');
select is((select count(*) from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000001' and message_type='denied'),
 1::bigint,'Response loss never creates another customer notice');
select throws_ok($$update public.refund_case_messages set body='Changed private note' where refund_case_id='fd760000-0000-4000-8000-000000000001'$$,
 'P4682',null,'Committed customer-facing denial content is immutable');
create temp table denial_claim as select * from public.service_claim_refund_manual_message_deliveries(
 (select id from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000001'),1);
select is((select count(*) from denial_claim),1::bigint,'The existing actual claim function can deliver the atomic notice');
select public.service_mark_refund_manual_message_provider_attempt(refund_case_message_id,claim_token) from denial_claim;
update public.refund_case_messages set manual_delivery_claimed_at=statement_timestamp()-interval '11 minutes'
 where refund_case_id='fd760000-0000-4000-8000-000000000001';
select is((select count(*) from public.service_claim_refund_manual_message_deliveries(
 (select id from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000001'),1)),
 0::bigint,'Crash after provider access without receipt cannot blindly reclaim a denial');
select is((select manual_delivery_state from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000001'),
 'delivery_unknown','Interrupted provider access is held for reconciliation');
select is(public.refund_lifecycle_contract('fd760000-0000-4000-8000-000000000001')->>'terminal',
 'false','Unknown customer contact cannot close the case');
select public.service_bind_refund_transactional_delivery(
 (select id from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000001'),
 'synthetic-denial-accepted',statement_timestamp());
select is((select count(*) from public.service_claim_refund_manual_message_deliveries(
 (select id from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000001'),1)),
 0::bigint,'Late exact provider acceptance reconciles without another provider call');
select is((select manual_delivery_state from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000001'),
 'sent','Existing accepted receipt settles the same denial notice');
select is(public.refund_gift_card_case_projection('fd760000-0000-4000-8000-000000000001')->>'delivery_state',
 'accepted','Known acceptance is never called delivered');
select is(public.refund_lifecycle_contract('fd760000-0000-4000-8000-000000000001')->>'terminal',
 'true','Supported provider acceptance completes customer contact without webhook prerequisite');
select public.service_record_refund_transactional_delivery_event(repeat('d',64),'synthetic-denial-accepted','bounced',statement_timestamp());
select is(public.refund_lifecycle_contract('fd760000-0000-4000-8000-000000000001')->>'terminal',
 'false','A later bounce returns customer contact to visible recovery without changing denial');
select lives_ok($$select public.admin_decide_refund_gift_card('fd760000-0000-4000-8000-000000000002',false,'Explicación revisada para el cliente.')$$,
 'Spanish denial uses the same durable notice path');
select ok((select body like '%No necesita enviar otro formulario.%' and body like '%Explicación revisada%'
 from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000002'),
 'Spanish customer framing preserves the reviewed explanation');
create temp table retry_claim as select * from public.service_claim_refund_manual_message_deliveries(
 (select id from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000002'),1);
select public.service_finish_refund_manual_message_delivery(refund_case_message_id,claim_token,'failed',null,'synthetic_pre_provider_failure',0,null) from retry_claim;
select is((select count(*) from public.service_claim_refund_manual_message_deliveries(
 (select id from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000002'),1)),
 1::bigint,'Definite pre-provider failure resumes the same notice automatically');
select is((select count(*) from public.refund_case_messages where refund_case_id='fd760000-0000-4000-8000-000000000002'),
 1::bigint,'Automatic retry retains one immutable message and provider idempotency identity');
select is((select count(*) from public.refund_gift_card_issuances where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-GIFT-DENIAL-%')),0::bigint,'Denial and recovery create no codes, allowance use or goodwill');
select is((select count(*) from public.refund_authoritative_receipts where refund_case_id in
 (select id from public.refund_cases where public_reference like 'RF-GIFT-DENIAL-%')),0::bigint,'Customer notice cannot settle a money refund');
select public.service_enqueue_refund_manual_message_intent(c.id,c.official_action_version,
 'fd770000-0000-4000-8000-000000000003'::uuid,'fd710000-0000-4000-8000-000000000001'::uuid,
 'status_update',c.customer_email,'Synthetic current update','Synthetic saved text',
 'refund_status_update_editable_v1','manager_authored',null,'{}'::text[],null,false,null)
 from public.refund_cases c where c.id='fd760000-0000-4000-8000-000000000003';
select throws_ok($$select public.admin_decide_refund_gift_card('fd760000-0000-4000-8000-000000000003',false,'Reviewed reason')$$,
 'P4657',null,'An outbox persistence conflict rolls the decision back atomically');
select is((select gift_card_state from public.refund_cases where public_reference='RF-GIFT-DENIAL-3'),
 'manager_review','There is never a committed denial without its required durable notice');
delete from public.refund_case_messages where manual_delivery_intent_id='fd770000-0000-4000-8000-000000000003';
update public.refund_cases set case_population='internal_test' where id='fd760000-0000-4000-8000-000000000003';
select throws_ok($$select public.admin_decide_refund_gift_card('fd760000-0000-4000-8000-000000000003',false,'Reviewed reason')$$,
 'P4640',null,'Internal/test cases cannot queue a customer denial');
select * from finish();
rollback;
