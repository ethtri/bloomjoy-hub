begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
update public.refund_customer_contact_settings set correction_links_enabled=true where singleton;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('ec000000-0000-4000-8000-000000000004','authenticated','authenticated','cash-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type) values('ec000000-0000-4000-8000-000000000001','Cash clarification fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status)
values('ec000000-0000-4000-8000-000000000002','ec000000-0000-4000-8000-000000000001','Cash fixture','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,refund_intake_enabled,refund_public_display_label)
values('ec000000-0000-4000-8000-000000000003','ec000000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000002','Cash fixture','commercial','active',true,'Cash fixture');
insert into public.admin_roles(user_id,role,active) values('ec000000-0000-4000-8000-000000000004','super_admin',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('ec000000-0000-4000-8000-000000000003','ec000000-0000-4000-8000-000000000004','cash-manager@example.invalid','Cash fixture');
create function pg_temp.cash_case(n integer) returns uuid language plpgsql as $$
declare cid uuid:=('ec000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;
begin
  insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,issue_category,
    incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,incident_time_confidence,
    payment_method,payment_interaction,payment_amount_cents,refund_amount_cents,status,correlation_status,intake_source,resolution_method)
  values(cid,'ec000000-0000-4000-8000-000000000003','ec000000-0000-4000-8000-000000000002','cash-'||n||'@example.invalid','','wrong_amount',
    statement_timestamp()-interval '2 hours',to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
    'America/Los_Angeles','exact','exact','cash','cash',4000,4000,'needs_review','manual_review','form','original_payment');
  return cid;
end $$;
create function pg_temp.cash_scope(n integer,fields text[]) returns jsonb language plpgsql as $$
declare c public.refund_cases; queued jsonb; claim record;
begin
  select * into c from public.refund_cases where id=('ec000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;
  queued:=public.service_enqueue_refund_manual_message_intent(c.id,c.official_action_version,gen_random_uuid(),'ec000000-0000-4000-8000-000000000004',
    'more_info',c.customer_email,'Clarify this cash request','Please clarify what happened and your cash amounts. [Secure refund correction link included at delivery]',
    'refund_more_info_editable_v1','manager_authored','missing_information',fields,null,false,null);
  perform public.service_issue_refund_purchase_correction((queued->>'messageId')::uuid,md5('cash-'||n)||md5('cash-'||n),c.deterministic_fact_version);
  select * into claim from public.service_claim_refund_manual_message_deliveries((queued->>'messageId')::uuid,1);
  perform public.service_mark_refund_manual_message_provider_attempt(claim.refund_case_message_id,claim.claim_token);
  perform public.service_finish_refund_manual_message_delivery(claim.refund_case_message_id,claim.claim_token,'sent','fixture-thread',null,1,'mapped_manager');
  return public.service_get_refund_purchase_correction(md5('cash-'||n)||md5('cash-'||n));
end $$;
create function pg_temp.cash_submit(n integer,answers jsonb) returns jsonb language sql as $$
  select public.service_submit_refund_purchase_correction(md5('cash-'||n)||md5('cash-'||n),
    (select correction_fact_version from public.refund_wallet_correction_contexts where token_hash=md5('cash-'||n)||md5('cash-'||n)),answers,'es');
$$;
select pg_temp.cash_case(n) from generate_series(1,8) n;
select ok(public.refund_purchase_correction_request_fields('ec000000-0000-4000-8001-000000000001') @> array['issue_summary','cash_inserted_amount','expected_change_amount','zelle_payment_contact'],'Ambiguous cash offers one combined clarification');
select is(pg_temp.cash_scope(1,array['issue_summary','cash_inserted_amount','expected_change_amount','zelle_payment_contact'])->>'state','ready','Real manager enqueue, issue and delivered inspection accepts mixed scope');
select ok(public.service_get_refund_purchase_correction(md5('cash-1')||md5('cash-1'))->'allowedFields' @> '["issue_summary","cash_inserted_amount","expected_change_amount","zelle_payment_contact"]','Delivered scope authorizes cash facts and its requested contact');
select ok(not (public.service_get_refund_purchase_correction(md5('cash-1')||md5('cash-1')) ?| array['customerEmail','refundCaseId','reportingMachineId']),'Public capability excludes internal identity');
select throws_like($$select pg_temp.cash_submit(1,'{"issue_summary":{"disposition":"changed","value":"Received the case, no change"},"cash_inserted_amount":{"disposition":"changed","value":"40.00"},"expected_change_amount":{"disposition":"changed","value":"40.00"},"zelle_payment_contact":{"disposition":"cannot_provide"}}')$$,'%Invalid correction value%','Change cannot equal cash inserted');
select throws_like($$select pg_temp.cash_submit(1,'{"issue_summary":{"disposition":"changed","value":"Received the case, no change"},"cash_inserted_amount":{"disposition":"changed","value":"40.00"},"expected_change_amount":{"disposition":"changed","value":"-15.00"},"zelle_payment_contact":{"disposition":"cannot_provide"}}')$$,'%Invalid correction value%','Negative cash rejected');
select throws_like($$select pg_temp.cash_submit(1,'{"issue_summary":{"disposition":"cannot_provide"},"cash_inserted_amount":{"disposition":"cannot_provide"},"expected_change_amount":{"disposition":"cannot_provide"},"zelle_payment_contact":{"disposition":"cannot_provide"},"payment_method":{"disposition":"changed","value":"card"}}')$$,'%Invalid correction value%','Mixed cash scope cannot become a card purchase');
create temp table cash_before as select deterministic_fact_version as version from public.refund_cases where id='ec000000-0000-4000-8001-000000000001';
select is(pg_temp.cash_submit(1,'{"issue_summary":{"disposition":"changed","value":"The case was $25. I received it but no change. Please return $15."},"cash_inserted_amount":{"disposition":"changed","value":"40.00"},"expected_change_amount":{"disposition":"changed","value":"15.00"},"zelle_payment_contact":{"disposition":"changed","value":"customer@example.invalid"}}')->>'nextAction','review','Cash explanation requires internal review');
select ok((select payment_amount_cents=4000 and refund_amount_cents=4000 and affected_amount_cents is null and cash_inserted_amount_cents=4000 and expected_change_amount_cents=1500 and decision is null and resolution_method='original_payment' and issue_category='wrong_amount' and refund_completed_at is null and reporting_adjustment_id is null from public.refund_cases where id='ec000000-0000-4000-8001-000000000001'),'Forty and fifteen are evidence; original purchase/request/route/decision remain intact');
select is((select deterministic_fact_version from public.refund_cases where id='ec000000-0000-4000-8001-000000000001'),(select version+1 from cash_before),'Combined evidence increments version once');
select is(pg_temp.cash_submit(1,'{}')->>'state','received','Retry returns saved response');
select is((select count(*)::integer from public.refund_case_events where refund_case_id='ec000000-0000-4000-8001-000000000001' and event_type='purchase_correction_received'),1,'Retry does not create a second response');
select is((select intake_meta->>'customer_locale' from public.refund_cases where id='ec000000-0000-4000-8001-000000000001'),'es','Four-argument locale contract survives');
select ok(not exists(select 1 from public.refund_authoritative_receipts where refund_case_id='ec000000-0000-4000-8001-000000000001'),'Clarification creates no payment receipt');
select is(pg_temp.cash_scope(2,array['zelle_payment_contact'])->'allowedFields','["zelle_payment_contact"]'::jsonb,'Historical payout-only scope stays exact');
select throws_like($$select pg_temp.cash_submit(2,'{"zelle_payment_contact":{"disposition":"cannot_provide"},"issue_summary":{"disposition":"changed","value":"Missing change"}}')$$,'%Unsupported correction answer%','Payout-only scope rejects injected explanation');
select is(pg_temp.cash_scope(3,array['issue_summary','cash_inserted_amount','expected_change_amount'])->>'state','ready','Cash clarification can omit payout contact');
select throws_like($$select pg_temp.cash_submit(3,'{"issue_summary":{"disposition":"cannot_provide"},"cash_inserted_amount":{"disposition":"cannot_provide"},"expected_change_amount":{"disposition":"cannot_provide"},"zelle_payment_contact":{"disposition":"changed","value":"customer@example.invalid"}}')$$,'%Unsupported correction answer%','Unrequested Zelle cannot be injected into a cash-only scope');
select lives_ok($$select pg_temp.cash_submit(3,'{"issue_summary":{"disposition":"cannot_provide"},"cash_inserted_amount":{"disposition":"cannot_provide"},"expected_change_amount":{"disposition":"cannot_provide"}}')$$,'Uncertainty is valid evidence without invented values');
select ok(not public.refund_purchase_correction_request_fields('ec000000-0000-4000-8001-000000000003') && array['issue_summary','cash_inserted_amount','expected_change_amount'],'Do not repeat fields answered as unknown');
select pg_temp.cash_scope(4,array['issue_summary','cash_inserted_amount','expected_change_amount']);
update public.refund_cases set issue_summary='Staff recorded a newer explanation' where id='ec000000-0000-4000-8001-000000000004';
select is(public.service_get_refund_purchase_correction(md5('cash-4')||md5('cash-4'))->>'state','unavailable','New explanation invalidates old capability');
select throws_like($$select pg_temp.cash_submit(4,'{"issue_summary":{"disposition":"cannot_provide"},"cash_inserted_amount":{"disposition":"cannot_provide"},"expected_change_amount":{"disposition":"cannot_provide"}}')$$,'%stale or unavailable%','Stale cash submit cannot overwrite facts');
update public.refund_cases set payment_method='card',payment_interaction='tap_card',card_last4='1234',card_last4_source='physical_card',card_last4_provenance='physical_card',card_network='visa' where id='ec000000-0000-4000-8001-000000000005';
select ok(not public.refund_purchase_correction_request_fields('ec000000-0000-4000-8001-000000000005') && array['issue_summary','cash_inserted_amount','expected_change_amount'],'Card case does not acquire cash facts');
update public.refund_cases set decision='approved',status='cash_zelle_pending',decided_by='ec000000-0000-4000-8000-000000000004',decided_at=statement_timestamp() where id='ec000000-0000-4000-8001-000000000006';
select is(public.refund_purchase_correction_request_fields('ec000000-0000-4000-8001-000000000006'),array['zelle_payment_contact'],'Approved cash requests only payout destination');
update public.refund_cases set issue_category='other' where id='ec000000-0000-4000-8001-000000000007';
select ok(not public.refund_purchase_correction_request_fields('ec000000-0000-4000-8001-000000000007') && array['issue_summary','cash_inserted_amount','expected_change_amount'],'Unrelated cash issue does not trigger change questions');
update public.refund_cases set resolution_method='gift_card' where id='ec000000-0000-4000-8001-000000000008';
select ok(not 'zelle_payment_contact'=any(public.refund_purchase_correction_request_fields('ec000000-0000-4000-8001-000000000008')),'Gift-card cash does not acquire Zelle');
select is(pg_temp.cash_scope(8,array['issue_summary','cash_inserted_amount','expected_change_amount'])->>'state','ready','Gift-card cash clarification opens without payout contact');
select * from finish();
rollback;
