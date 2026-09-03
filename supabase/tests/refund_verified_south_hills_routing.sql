begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select is(public.reconcile_verified_south_hills_refund_routing()->>'skipped','true','Clean databases skip the production-specific data repair');
insert into public.customer_accounts(id,name,account_type) values('ba100000-0000-4000-8000-000000000001','Routing synthetic fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('5101aee2-69bd-474e-9f87-ad50b5072b09','ba100000-0000-4000-8000-000000000001','South Hills Village','America/New_York');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,nayax_machine_id,nayax_account_key,refund_intake_enabled,refund_public_display_label)
values('b9ec0e18-2b56-4c07-b47d-84e7613bc777','ba100000-0000-4000-8000-000000000001','5101aee2-69bd-474e-9f87-ad50b5072b09',
 'Simon1302-South Hill Village','commercial','545814962','TGPACI_USA_DB',true,'South Hills Village — Cotton Candy'),
 ('1608ca48-9b3a-4dec-a228-71a9cfbecbb7','ba100000-0000-4000-8000-000000000001','5101aee2-69bd-474e-9f87-ad50b5072b09',
 'Snapcase 03','unknown','40390734','TGPACI_USA_DB',true,'South Hills Village — Phone cases (SnapCase)');
insert into public.refund_nayax_machine_inventory(account_key,nayax_machine_id,machine_name,machine_number,provider_is_active,refund_category,reporting_machine_id,reconciliation_state)
values('TGPACI_USA_DB','545814962','Simon1302-South Hill Village','4434330125144394AutoFwp$r',true,'cotton_candy','b9ec0e18-2b56-4c07-b47d-84e7613bc777','published'),
 ('TGPACI_USA_DB','40390734','Snapcase 03','434333524111967Auto(8Jvj',true,'snapcase','1608ca48-9b3a-4dec-a228-71a9cfbecbb7','published');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
 incident_at,payment_method,payment_amount_cents,status,correlation_status,intake_selection_kind,intake_selection_machine_ids)
values('ba400000-0000-4000-8000-000000000001','RF-ROUTING-FIXTURE','1608ca48-9b3a-4dec-a228-71a9cfbecbb7',
 '5101aee2-69bd-474e-9f87-ad50b5072b09','routing-customer@example.invalid','Synthetic preserved case',now()-interval '1 day',
 'card',700,'needs_review','no_match','exact_machine',array['1608ca48-9b3a-4dec-a228-71a9cfbecbb7'::uuid]);
select lives_ok($$select public.reconcile_verified_south_hills_refund_routing()$$,'Both public routing changes apply atomically');
select is((select count(*)::integer from public.public_refund_machine_options() where location_id='5101aee2-69bd-474e-9f87-ad50b5072b09'),1,'Exactly one public machine remains');
select ok(exists(select 1 from public.public_refund_selections_v2() where machine_id='b9ec0e18-2b56-4c07-b47d-84e7613bc777'),
 'The actual customer selector reaches the verified machine');
select ok(not exists(select 1 from public.public_refund_selections_v2() where machine_id='1608ca48-9b3a-4dec-a228-71a9cfbecbb7'),
 'The conflicting selector is withdrawn');
select ok((select reporting_machine_id='1608ca48-9b3a-4dec-a228-71a9cfbecbb7'::uuid and matched_nayax_transaction_id is null
 and status='needs_review' from public.refund_cases where id='ba400000-0000-4000-8000-000000000001'),'Existing cases are not automatically rebound');
select is(public.reconcile_verified_south_hills_refund_routing()->>'alreadyApplied','true','Exact replay is harmless');
select is((select count(*)::integer from public.admin_audit_log where action='refund_nayax_inventory.verified_south_hills_routing'),1,'Replay creates no second audit event');
select ok((select nayax_machine_id='40390734' and nayax_refunds_enabled is false and refund_intake_enabled is false
 from public.reporting_machines where id='1608ca48-9b3a-4dec-a228-71a9cfbecbb7'),'Unverified route is paused while identity remains intact');
select ok(not has_function_privilege('service_role','public.reconcile_verified_south_hills_refund_routing()','execute')
 and not has_function_privilege('authenticated','public.reconcile_verified_south_hills_refund_routing()','execute'),'Data repair is not a customer or service RPC');
select * from finish();
rollback;
