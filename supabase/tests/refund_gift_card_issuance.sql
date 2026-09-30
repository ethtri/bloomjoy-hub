begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
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
select is(public.service_get_refund_gift_card_offer('fc740000-0000-4000-8000-000000000001',1100)->>'value','1500','Launch rounds $11 to $15');
select is(public.service_get_refund_gift_card_offer('fc740000-0000-4000-8000-000000000001',1500)->>'value','1500','Exact $5 multiple stays the same');
select is(public.service_get_refund_gift_card_offer('fc740000-0000-4000-8000-000000000001',1501),null::jsonb,'Unverified template cannot promise a new denomination');
select is((select count(*) from public.refund_gift_card_pools),1::bigint,'Quote never materializes a pool or provider value');
select ok(not (public.service_get_refund_gift_card_offer('fc740000-0000-4000-8000-000000000001',1100) ? 'code'),'Public terms never contain codes');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
 values('fc760000-0000-4000-8000-000000000001','RF-GIFT-FIRST','fc740000-0000-4000-8000-000000000001',
 'fc730000-0000-4000-8000-000000000001','  Gift-Fixture@Example.Invalid  ','Synthetic problem',now(),'card',1100,1100,
 'gift_card','fc750000-0000-4000-8000-000000000001',1500,now()+interval '30 days','pending_inventory');
select is((select gift_card_state from public.refund_cases where id='fc760000-0000-4000-8000-000000000001'),'issued','First eligible form insertion issues automatically');
select results_eq($$select purchase_amount_cents,face_value_cents,goodwill_amount_cents,normalized_email
 from public.refund_gift_card_issuances where refund_case_id='fc760000-0000-4000-8000-000000000001'$$,
 $$select 1100::integer,1500::integer,400::integer,'gift-fixture@example.invalid'::text$$,'Receipt separates purchase, face and goodwill and normalizes email');
select is((select count(*) from public.refund_case_messages where refund_case_id='fc760000-0000-4000-8000-000000000001'),1::bigint,'Exactly one existing outbox message');
select is(public.refund_gift_card_case_projection('fc760000-0000-4000-8000-000000000001')->>'delivery_state','queued',
 'Fresh provider-ledger default unknown is correctly projected as queued before an attempt');
select lives_ok($$select public.service_issue_refund_gift_card('fc760000-0000-4000-8000-000000000001')$$,'Same-case replay works');
select is((select count(*) from public.refund_gift_card_issuances),1::bigint,'Replay never creates another issuance');
select ok(not (public.refund_gift_card_case_projection('fc760000-0000-4000-8000-000000000001') ? 'code'),'Status projection hides assigned code');
select ok(public.refund_gift_card_automatic_eligible('gift-fixture@example.invalid',
 (select issued_at+interval '12 months' from public.refund_gift_card_issuances where refund_case_id='fc760000-0000-4000-8000-000000000001')),
 'Exact calendar anniversary permits automatic issuance');
select ok(not public.refund_gift_card_automatic_eligible('gift-fixture@example.invalid',
 (select issued_at+interval '12 months'-interval '1 microsecond' from public.refund_gift_card_issuances where refund_case_id='fc760000-0000-4000-8000-000000000001')),
 'Just before anniversary still requires approval');
select ok(not public.refund_gift_card_automatic_eligible(' GIFT-FIXTURE@example.invalid ',now()+interval '4 months'),'Same-year normalized-email repeat requires approval');
select ok(public.refund_gift_card_automatic_eligible('gift-fixture+new@example.invalid',now()),'No aggressive plus-alias collapsing');
select throws_ok($$update public.refund_cases set status='denied',decision='denied' where id='fc760000-0000-4000-8000-000000000001'$$,
 'P4670',null,'Issued gift card cannot later be denied and reverse request deduction');
select throws_ok($$update public.refund_cases set refund_completed_at=now(),manual_refund_reference='cash-test' where id='fc760000-0000-4000-8000-000000000001'$$,
 'P4670',null,'Stale cash completion cannot settle issued gift card');
select throws_ok($$update public.refund_cases set resolution_method='original_payment' where id='fc760000-0000-4000-8000-000000000001'$$,
 'P4670',null,'Accepted resolution cannot switch to money settlement');
select throws_ok($$update public.refund_cases set duplicate_of_refund_case_id=id where id='fc760000-0000-4000-8000-000000000001'$$,
 'P4670',null,'Issued gift card cannot be marked duplicate to reverse its purchase deduction');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
 values('fc760000-0000-4000-8000-000000000002','RF-GIFT-REPEAT','fc740000-0000-4000-8000-000000000001',
 'fc730000-0000-4000-8000-000000000001','gift-fixture@example.invalid','Synthetic repeat',now(),'cash',1200,1200,
 'gift_card','fc750000-0000-4000-8000-000000000001',1500,now()+interval '30 days','pending_inventory');
select is((select gift_card_state from public.refund_cases where id='fc760000-0000-4000-8000-000000000002'),'manager_review','Cash and card share annual allowance');
select throws_ok($$update public.refund_cases set status='denied',decision='denied',decision_reason='customer_nonresponse'
 where id='fc760000-0000-4000-8000-000000000002'$$,'P4670',null,
 'A system or Manager waiting state cannot be denied as customer nonresponse');
select throws_ok($$select public.admin_decide_refund_gift_card('fc760000-0000-4000-8000-000000000002',true)$$,'42501',null,'No anonymous Manager decision');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"fc710000-0000-4000-8000-000000000001"}',true);
select is(public.get_refund_gift_card_case('fc760000-0000-4000-8000-000000000002')->>'prior_issued_count','1','Authorized case view shows previous issuance');
select lives_ok($$select public.admin_decide_refund_gift_card('fc760000-0000-4000-8000-000000000002',true)$$,'Assigned Manager approves once into same allocator');
select is((select gift_card_state from public.refund_cases where id='fc760000-0000-4000-8000-000000000002'),'issued','Approved repeat issues automatically');
select is((select count(distinct code_id) from public.refund_gift_card_issuances),2::bigint,'Distinct cases cannot share a code');
select is((select goodwill_amount_cents from public.refund_gift_card_issuances where refund_case_id='fc760000-0000-4000-8000-000000000002'),300,'Goodwill varies with purchase');
select is((select count(*) from public.sales_adjustment_facts where refund_case_id in
 ('fc760000-0000-4000-8000-000000000001','fc760000-0000-4000-8000-000000000002')),0::bigint,'Issuance creates no cash-paid adjustment');
select ok(not has_table_privilege('authenticated','public.refund_gift_card_codes','SELECT'),'Private stock is not exposed to signed-in customer clients');
select ok(not has_function_privilege('anon','public.service_issue_refund_gift_card(uuid)','EXECUTE'),'Anonymous clients cannot allocate');
select lives_ok($$select public.admin_resend_refund_gift_card('fc760000-0000-4000-8000-000000000001',
 'fc770000-0000-4000-8000-000000000001','corrected-gift@example.invalid')$$,'Assigned Manager corrects delivery destination using the same gift');
select lives_ok($$select public.admin_resend_refund_gift_card('fc760000-0000-4000-8000-000000000001',
 'fc770000-0000-4000-8000-000000000001','corrected-gift@example.invalid')$$,'Same delivery intent retry is idempotent');
select is((select count(*) from public.refund_gift_card_issuances),2::bigint,'Recovery preserves original issuance count');
select is((select count(*) from public.refund_case_messages where gift_card_issuance_id is not null),1::bigint,'Delivery recovery creates one linked intent');
select ok(not public.refund_gift_card_automatic_eligible('corrected-gift@example.invalid',now()),'Corrected recipient retains the same annual allowance history');
select is(public.refund_gift_card_case_projection('fc760000-0000-4000-8000-000000000001')->>'delivery_state','queued','Status follows latest recovery message');
update public.refund_case_messages set status='failed',manual_delivery_state='delivery_unknown',delivery_state='unknown'
 where manual_delivery_intent_id='fc770000-0000-4000-8000-000000000001';
select throws_ok($$select public.admin_resend_refund_gift_card('fc760000-0000-4000-8000-000000000001',
 'fc770000-0000-4000-8000-000000000002')$$,'P4672',null,'Unknown delivery cannot blindly create another send');
select ok(strpos(pg_get_functiondef('public.refund_completion_outbox_postcommit_wakeup()'::regprocedure),'refund_gift_card_v1')>0,
 'Immediate postcommit wakeup includes the same immutable gift message');
-- Seed an immutable historical receipt as the disposable database owner. This
-- exercises the actual eligibility query against the leap-day anniversary.
update public.refund_gift_card_pools set enabled=false where id='fc750000-0000-4000-8000-000000000001';
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state)
 values('fc760000-0000-4000-8000-000000000003','RF-GIFT-LEAP','fc740000-0000-4000-8000-000000000001',
 'fc730000-0000-4000-8000-000000000001','gift-leap@example.invalid','Historical synthetic leap-day receipt',
 '2024-02-29T12:00:00Z','cash',1500,1500,'gift_card','fc750000-0000-4000-8000-000000000001',1500,
 now()+interval '30 days','pending_inventory');
update public.refund_gift_card_pools set enabled=true where id='fc750000-0000-4000-8000-000000000001';
do $$ declare c public.refund_cases; m public.refund_case_messages; card public.refund_gift_card_codes; begin
  select * into c from public.refund_cases where id='fc760000-0000-4000-8000-000000000003';
  select * into card from public.refund_gift_card_codes where pool_id=c.gift_card_pool_id and status='available' order by id limit 1;
  update public.refund_gift_card_codes set status='issued',issued_case_id=c.id where id=card.id;
  update public.refund_cases set gift_card_state='issued',status='completed' where id=c.id returning * into c;
  select message.* into m from public.refund_case_messages message join public.refund_gift_card_issuances i on i.message_id=message.id
    where i.refund_case_id='fc760000-0000-4000-8000-000000000001';
  m.id:=gen_random_uuid(); m.refund_case_id:=c.id; m.recipient_email:=c.customer_email;
  m.manual_delivery_intent_id:=gen_random_uuid(); m.manual_delivery_expected_case_version:=c.official_action_version;
  insert into public.refund_gift_card_issuances(refund_case_id,code_id,pool_id,normalized_email,purchase_amount_cents,
    face_value_cents,goodwill_amount_cents,currency,eligible_locations,expires_at,redemption_instructions,
    issued_at,message_id,message_identity_digest)
    values(c.id,card.id,c.gift_card_pool_id,c.customer_email,1500,1500,0,'USD',array['Fixture location'],
      c.gift_card_expires_at,'Enter your code at the fixture machine.','2024-02-29T12:00:00Z',m.id,
      public.refund_receipt_completion_message_digest(to_jsonb(m)));
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
    template_key,template_version,content_source,delivery_kind,requested_fields,manual_delivery_intent_id,
    manual_delivery_state,manual_delivery_expected_case_version,manual_delivery_status_link_requested)
    values(m.id,c.id,'completed','pending',m.recipient_email,m.subject,m.body,m.template_key,m.template_version,
      m.content_source,m.delivery_kind,m.requested_fields,m.manual_delivery_intent_id,'queued',c.official_action_version,false);
end $$;
select ok(public.refund_gift_card_automatic_eligible('gift-leap@example.invalid','2025-02-28T12:00:00Z'),
 'Leap-day issuance is eligible exactly at the clamped next-year anniversary');
select ok(not public.refund_gift_card_automatic_eligible('gift-leap@example.invalid','2025-02-28T11:59:59.999999Z'),
 'Leap-day issuance remains approval-required just before the anniversary');
select * from finish();
rollback;
