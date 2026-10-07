begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local session_replication_role=replica;
insert into auth.users(id,email) values
 ('e9810000-0000-4000-8000-000000000001','metadata-manager@example.invalid'),
 ('e9810000-0000-4000-8000-000000000002','metadata-tech@example.invalid'),
 ('e9810000-0000-4000-8000-000000000003','metadata-sales@example.invalid');
insert into public.customer_accounts(id,name,account_type) values
 ('e9820000-0000-4000-8000-000000000001',E'Company\nOne','internal');
insert into public.reporting_locations(id,account_id,name,timezone) values
 ('e9830000-0000-4000-8000-000000000001','e9820000-0000-4000-8000-000000000001','Metadata location','Pacific/Kiritimati');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 select ('e9840000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'e9820000-0000-4000-8000-000000000001','e9830000-0000-4000-8000-000000000001','Metadata machine '||n,
 case when n=2 then 'inactive' else 'active' end from generate_series(1,3) n;
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,status)
 select ('e9840000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e9810000-0000-4000-8000-000000000001',
 'metadata-manager@example.invalid','active' from generate_series(1,2) n;
insert into public.technician_grants(id,account_id,sponsor_user_id,technician_email,technician_user_id,status,starts_at,grant_reason) values
 ('e9850000-0000-4000-8000-000000000001','e9820000-0000-4000-8000-000000000001','e9810000-0000-4000-8000-000000000001',
 'metadata-tech@example.invalid','e9810000-0000-4000-8000-000000000002','active','2020-01-01','Synthetic metadata scope test');
insert into public.technician_machine_assignments(technician_grant_id,machine_id,status,starts_at,grant_reason)
 select 'e9850000-0000-4000-8000-000000000001',('e9840000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'active','2020-01-01','Synthetic metadata scope test' from generate_series(1,2) n;
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at) values
 ('e9810000-0000-4000-8000-000000000003','e9840000-0000-4000-8000-000000000001','2020-01-01');
set local session_replication_role=origin;
-- Evaluate the actual private metadata endpoint, including its denial path.
create function pg_temp.metadata_allowed(actor uuid,machine uuid) returns boolean language plpgsql as $$
begin
 return (private.email_alert_digest_metadata(actor,machine,'2026-10-06','2026-10-06')->>'requestAmountsAllowed')::boolean;
exception when insufficient_privilege then return false;
end $$;
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000001','e9840000-0000-4000-8000-000000000001'),true,'Active manager gets metadata');
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000001','e9840000-0000-4000-8000-000000000002'),true,'Existing manager scope on inactive machine is preserved');
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000001'),true,'Active technician gets metadata without sales');
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000002'),false,'Technician helper still excludes inactive machine');
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000001','e9840000-0000-4000-8000-000000000003'),false,'Unassigned machine in same company denied');
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000003','e9840000-0000-4000-8000-000000000001'),false,'Sales-only entitlement never grants refund metadata');
select is(pg_temp.metadata_allowed(null,'e9840000-0000-4000-8000-000000000001'),false,'Null actor denied');
select is(private.email_alert_digest_metadata('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000001','2026-10-06','2026-10-06')->>'accountName','Company One','Company display sanitization preserved');
select is(private.email_alert_digest_metadata('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000001','2026-10-06','2026-10-06')->>'requestedAmountCents','0','Assigned empty period remains known zero');
select ok((select bool_and(pg_temp.metadata_allowed(u.id,m.id)=exists(select 1 from private.email_alert_machine_scope(u.id) s where s.machine_id=m.id))
 from auth.users u cross join public.reporting_machines m where u.id::text like 'e9810000-%' and m.id::text like 'e9840000-%'),
 'Targeted lookup and original email scope agree across manager, technician, sales and unassigned machine matrix');
update public.technician_machine_assignments set expires_at=now()-interval '1 day' where technician_grant_id='e9850000-0000-4000-8000-000000000001';
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000001'),false,'Expired assignment denied');
update public.technician_machine_assignments set expires_at=null,starts_at=now()+interval '1 day' where technician_grant_id='e9850000-0000-4000-8000-000000000001';
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000001'),false,'Future assignment denied');
update public.technician_machine_assignments set starts_at='2020-01-01',status='revoked',revoked_at=now(),revoke_reason='Synthetic test' where technician_grant_id='e9850000-0000-4000-8000-000000000001';
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000001'),false,'Revoked assignment denied');
update public.technician_machine_assignments set status='active',revoked_at=null where technician_grant_id='e9850000-0000-4000-8000-000000000001';
update public.technician_grants set expires_at=now()-interval '1 day' where id='e9850000-0000-4000-8000-000000000001';
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000001'),false,'Expired parent grant denied');
update public.technician_grants set expires_at=null,starts_at=now()+interval '1 day' where id='e9850000-0000-4000-8000-000000000001';
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000001'),false,'Future parent grant denied');
update public.technician_grants set starts_at='2020-01-01',status='revoked',revoked_at=now(),revoke_reason='Synthetic test' where id='e9850000-0000-4000-8000-000000000001';
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000002','e9840000-0000-4000-8000-000000000001'),false,'Revoked parent grant denied');
update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),revoke_reason='Synthetic test' where manager_user_id='e9810000-0000-4000-8000-000000000001';
select is(pg_temp.metadata_allowed('e9810000-0000-4000-8000-000000000001','e9840000-0000-4000-8000-000000000001'),false,'Revoked manager denied');
select ok(not has_function_privilege('authenticated','private.email_alert_digest_metadata(uuid,uuid,date,date)','execute'),'Metadata stays private from clients');
select ok(not has_function_privilege('service_role','private.email_alert_digest_metadata(uuid,uuid,date,date)','execute'),'No new direct service API exposure');
select * from finish();
rollback;
