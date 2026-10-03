begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('ea710000-0000-4000-8000-000000000001','manager@example.invalid'),
 ('ea710000-0000-4000-8000-000000000002','outsider@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('ea720000-0000-4000-8000-000000000001','Email synthetic','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('ea730000-0000-4000-8000-000000000001','ea720000-0000-4000-8000-000000000001','Email fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status) values
 ('ea740000-0000-4000-8000-000000000001','ea720000-0000-4000-8000-000000000001','ea730000-0000-4000-8000-000000000001','Assigned','active'),
 ('ea740000-0000-4000-8000-000000000002','ea720000-0000-4000-8000-000000000001','ea730000-0000-4000-8000-000000000001','Hidden','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('ea740000-0000-4000-8000-000000000001','ea710000-0000-4000-8000-000000000001','manager@example.invalid','active');
set local session_replication_role=origin;
select set_config('request.jwt.claim.sub','ea710000-0000-4000-8000-000000000001',true);
create temporary table alert_fixture as select public.get_my_email_alert_preferences() payload;
select is((select payload->>'schemaVersion' from alert_fixture),'email_alert_preferences_v1','Versioned preference contract');
select is((select count(*)::int from alert_fixture,jsonb_array_elements(payload->'alerts') a where (a->>'enabled')::boolean),1,'Exactly daily enabled by default');
select is((select a->>'id' from alert_fixture,jsonb_array_elements(payload->'alerts') a where (a->>'enabled')::boolean),'daily','Daily default applies to existing manager');
select is((select jsonb_array_length(payload->'machines') from alert_fixture),1,'Current assignment scope only');
select is((select payload#>>'{machines,0,canViewSales}' from alert_fixture),'false','Manager assignment does not grant reporting permission');
select ok(not has_function_privilege('anon','public.get_my_email_alert_preferences()','execute'),'Anonymous preferences rejected');
select ok(not has_function_privilege('authenticated','private.email_alert_machine_scope(uuid)','execute'),'Arbitrary actor scope is private');
select ok(not has_table_privilege('authenticated','public.email_alert_preferences','insert'),'Clients cannot bypass save validation');
select ok(not has_table_privilege('authenticated','private.email_alert_signals','select'),'Signal evidence is private');
update alert_fixture set payload=jsonb_set(payload,'{alerts}',(select jsonb_agg(a||'{"enabled":false}'::jsonb) from jsonb_array_elements(payload->'alerts') a));
select lives_ok($$select public.save_my_email_alert_preferences((select payload from alert_fixture),0)$$,'Full save persists opt-out');
select is((public.get_my_email_alert_preferences()->>'revision')::int,1,'Save advances revision');
select throws_ok($$select public.save_my_email_alert_preferences((select payload from alert_fixture),0)$$,'40001',null,'Stale tab cannot overwrite newer preferences');
select is((select count(*)::int from jsonb_array_elements(public.get_my_email_alert_preferences()->'alerts') a where (a->>'enabled')::boolean),0,'Explicit daily opt-out wins over dynamic defaults');
update alert_fixture set payload=jsonb_set(payload,'{alerts,0,machineIds}','["ea740000-0000-4000-8000-000000000002"]');
select throws_ok($$select public.save_my_email_alert_preferences((select payload from alert_fixture),1)$$,'42501',null,'Forged machine selection rejected even while disabled');
select set_config('request.jwt.claim.sub','ea710000-0000-4000-8000-000000000002',true);
select is((public.get_my_email_alert_preferences()->>'eligible')::boolean,false,'Unassigned user is ineligible');
select is((select count(*)::int from jsonb_array_elements(public.get_my_email_alert_preferences()->'alerts') a where (a->>'enabled')::boolean),0,'Unassigned user has no default subscriptions');
set local role authenticated;
select is((select count(*)::int from public.email_alert_preferences),0,'RLS hides another user preferences');
reset role;
set local session_replication_role=replica;
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 values('ea740000-0000-4000-8000-000000000002','ea710000-0000-4000-8000-000000000002','outsider@example.invalid','active');
set local session_replication_role=origin;
select is((select count(*)::int from jsonb_array_elements(public.get_my_email_alert_preferences()->'alerts') a where (a->>'enabled')::boolean),1,'Future eligible manager gets daily without backfill');
select * from finish();
rollback;
