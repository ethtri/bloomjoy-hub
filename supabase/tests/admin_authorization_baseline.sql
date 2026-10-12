begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Matrix: anonymous; ordinary; Technician; Report Viewer; existing account-scoped
-- administrator; global administrator; expired/revoked grants; absent, invalid,
-- unknown identity and uncertain decisions. Exercise database entry points under
-- their actual API roles. Disposable fixtures; no delivery or production credentials.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('aa185600-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'authenticated','authenticated','auth-boundary-'||n||'@example.invalid',now(),'{}','{}'
from generate_series(1,9) n;
insert into public.admin_roles(user_id,role,active) values
 ('aa185600-0000-4000-8000-000000000001','super_admin',true),
 ('aa185600-0000-4000-8000-000000000007','super_admin',false);
insert into public.customer_accounts(id,name,account_type)
values('aa185601-0000-4000-8000-000000000001','Authorization fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('aa185602-0000-4000-8000-000000000001','aa185601-0000-4000-8000-000000000001','Authorization fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
select ('aa185603-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'aa185601-0000-4000-8000-000000000001','aa185602-0000-4000-8000-000000000001','Authorization machine '||n,'active'
from generate_series(1,2) n;
insert into public.technician_grants(id,account_id,sponsor_user_id,technician_email,technician_user_id,status,starts_at,grant_reason)
values('aa185604-0000-4000-8000-000000000001','aa185601-0000-4000-8000-000000000001',
 'aa185600-0000-4000-8000-000000000001','auth-boundary-3@example.invalid',
 'aa185600-0000-4000-8000-000000000003','active','2020-01-01','Authorization fixture');
insert into public.technician_machine_assignments(technician_grant_id,machine_id,status,starts_at,grant_reason)
values('aa185604-0000-4000-8000-000000000001','aa185603-0000-4000-8000-000000000001','active','2020-01-01','Authorization fixture');
insert into public.reporting_machine_entitlements(user_id,machine_id,starts_at)
values('aa185600-0000-4000-8000-000000000004','aa185603-0000-4000-8000-000000000001','2020-01-01');
-- Existing account-scoped administrator is the prerequisite Company Admin persona.
-- This test does not introduce the proposed company-role contract.
insert into public.admin_scoped_access_grants(id,user_id,starts_at,expires_at,grant_reason,revoked_at,revoke_reason)
values
 ('aa185605-0000-4000-8000-000000000005','aa185600-0000-4000-8000-000000000005','2020-01-01',null,'Authorization fixture',null,null),
 ('aa185605-0000-4000-8000-000000000006','aa185600-0000-4000-8000-000000000006','2020-01-01','2021-01-01','Authorization fixture',null,null),
 ('aa185605-0000-4000-8000-000000000008','aa185600-0000-4000-8000-000000000008','2020-01-01',null,'Authorization fixture',now(),'Revoked fixture');
insert into public.admin_scoped_access_scopes(grant_id,scope_type,account_id,grant_reason)
select id,'account','aa185601-0000-4000-8000-000000000001','Authorization fixture'
from public.admin_scoped_access_grants where id::text like 'aa185605-%';
select ok(public.scoped_admin_machine_ids('aa185600-0000-4000-8000-000000000005') @> array['aa185603-0000-4000-8000-000000000001'::uuid],'Active company scope fixture resolves machines');
insert into public.reporting_partnerships(id,name,effective_start_date,status)
values('aa185607-0000-4000-8000-000000000001','Authorization report fixture','2020-01-01','active');
insert into public.reporting_machine_partnership_assignments(machine_id,partnership_id,effective_start_date,status)
values('aa185603-0000-4000-8000-000000000001','aa185607-0000-4000-8000-000000000001','2020-01-01','active');

create temporary table boundary_calls(label text, statement text, signature text, denial text);
insert into boundary_calls values
 ('global grant', $$select public.admin_grant_super_admin_by_email('auth-boundary-9@example.invalid','Synthetic boundary')$$,
  'public.admin_grant_super_admin_by_email(text,text)','Admin access required'),
 ('global list', $$select * from public.admin_list_super_admin_roles()$$,
  'public.admin_list_super_admin_roles()','Admin access required'),
 ('global revoke', $$select public.admin_revoke_super_admin('aa185600-0000-4000-8000-000000000001','Synthetic boundary')$$,
  'public.admin_revoke_super_admin(uuid,text)','Admin access required'),
 ('scoped grant', $$select public.admin_grant_scoped_admin_by_email('auth-boundary-9@example.invalid',array['aa185603-0000-4000-8000-000000000001'::uuid],'Synthetic boundary')$$,
  'public.admin_grant_scoped_admin_by_email(text,uuid[],text)','Super-admin access required'),
 ('scoped list', $$select public.admin_list_scoped_admin_grants()$$,
  'public.admin_list_scoped_admin_grants()','Super-admin access required'),
 ('scoped revoke', $$select public.admin_revoke_scoped_admin('aa185605-0000-4000-8000-000000000005','Synthetic boundary')$$,
  'public.admin_revoke_scoped_admin(uuid,text)','Super-admin access required'),
 ('invite create', $$select public.admin_create_scoped_admin_invite('boundary-invite@example.invalid',array['aa185603-0000-4000-8000-000000000001'::uuid],'Synthetic boundary',null)$$,
  'public.admin_create_scoped_admin_invite(text,uuid[],text,timestamp with time zone)','Super Admin access required'),
 ('invite list', $$select public.admin_list_scoped_admin_invites()$$,
  'public.admin_list_scoped_admin_invites()','Super Admin access required'),
 ('invite revoke', $$select public.admin_revoke_scoped_admin_invite('aa185606-0000-4000-8000-000000000001','Synthetic boundary')$$,
  'public.admin_revoke_scoped_admin_invite(uuid,text)','Super Admin access required');
grant select on boundary_calls to authenticated, anon, service_role;

create function pg_temp.boundary_claims(uid text, claim_role text default 'authenticated')
returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',coalesce(uid,''),true);
 perform set_config('request.jwt.claim.role',coalesce(claim_role,''),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role',claim_role)::text,true);
end;
$$;

select ok(not has_function_privilege('anon',signature,'execute'),label||' excludes anonymous callers') from boundary_calls;
set local role anon;
select pg_temp.boundary_claims(null,'anon');
select throws_ok(statement,'42501',null,'Anonymous: '||label) from boundary_calls;
reset role;

set local role authenticated;
-- Exercise actual RPC entry points under the browser database role.
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000002');
select is(public.is_super_admin(auth.uid()),false,'Ordinary caller has a definite denial');
select throws_ok(statement,'P0001',denial,'Ordinary: '||label) from boundary_calls;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000003');
select throws_ok(statement,'P0001',denial,'Technician: '||label) from boundary_calls;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000004');
select throws_ok(statement,'P0001',denial,'Report Viewer: '||label) from boundary_calls;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000005');
select throws_ok(statement,'P0001',denial,'Company scope: '||label) from boundary_calls;
select throws_ok($$select public.admin_grant_scoped_admin_by_email('auth-boundary-5@example.invalid',array['aa185603-0000-4000-8000-000000000002'::uuid],'Synthetic self expansion')$$,
 'P0001','Super-admin access required','Company scope cannot expand itself');
select throws_ok($$insert into public.admin_roles(user_id,role,active) values('aa185600-0000-4000-8000-000000000009','super_admin',true)$$,'42501',null,'Direct global role insert denied');
select throws_ok($$insert into public.admin_scoped_access_scopes(grant_id,scope_type,machine_id,grant_reason) values('aa185605-0000-4000-8000-000000000005','machine','aa185603-0000-4000-8000-000000000002','Synthetic self expansion')$$,'42501',null,'Direct scope expansion denied');
select is((select count(*) from public.admin_roles where active),0::bigint,'Global access records remain private');
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000006');
select throws_ok(statement,'P0001',denial,'Expired scope: '||label) from boundary_calls;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000007');
select throws_ok(statement,'P0001',denial,'Revoked global role: '||label) from boundary_calls;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000008');
select throws_ok(statement,'P0001',denial,'Revoked scope: '||label) from boundary_calls;
select pg_temp.boundary_claims(null);
select throws_ok(statement,'P0001',denial,'Absent identity: '||label) from boundary_calls;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000099');
select throws_ok(statement,'P0001',denial,'Unknown identity: '||label) from boundary_calls;
select pg_temp.boundary_claims('not-a-uuid');
select throws_ok(statement,'22P02',null,'Invalid identity: '||label) from boundary_calls;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000002',null);
select throws_ok(statement,'P0001',denial,'Absent role: '||label) from boundary_calls;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000002');
select set_config('app.partner_report_scheduler_scope','service_role',true);
select is(public.is_super_admin(auth.uid()),false,'Client role cannot acquire internal service context');
select throws_ok(statement,'P0001',denial,'Browser with internal setting: '||label) from boundary_calls;
select throws_ok($$select public.partner_report_scheduler_preview_partner_period_report('aa185607-0000-4000-8000-000000000001','2026-02-01','2026-02-28','calendar_month')$$,
 '42501',null,'Browser cannot invoke the scheduler wrapper');
reset role;

-- Authorized owner mutations and audit continuity; all remain rolled back.
set local role authenticated;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000001');
select lives_ok($$select * from public.admin_list_super_admin_roles()$$,'Owner lists global roles');
select lives_ok($$select public.admin_grant_super_admin_by_email('auth-boundary-9@example.invalid','Synthetic owner grant')$$,'Owner grants global role');
select lives_ok($$select public.admin_revoke_super_admin('aa185600-0000-4000-8000-000000000009','Synthetic owner revoke')$$,'Owner revokes global role');
select throws_ok($$select public.admin_revoke_super_admin('aa185600-0000-4000-8000-000000000001','Synthetic owner revoke')$$,'Cannot revoke the last active super-admin','Last owner protection survives');
select lives_ok($$select public.admin_grant_scoped_admin_by_email('auth-boundary-9@example.invalid',array['aa185603-0000-4000-8000-000000000001'::uuid],'Synthetic owner grant')$$,'Owner grants scoped role');
select lives_ok($$select public.admin_list_scoped_admin_grants()$$,'Owner lists scoped roles');
select lives_ok($$select public.admin_revoke_scoped_admin((select id from public.admin_scoped_access_grants where user_id='aa185600-0000-4000-8000-000000000009' and revoked_at is null),'Synthetic owner revoke')$$,'Owner revokes scoped role');
select lives_ok($$select public.admin_create_scoped_admin_invite('boundary-invite@example.invalid',array['aa185603-0000-4000-8000-000000000001'::uuid],'Synthetic owner invitation',null)$$,'Owner creates staged invitation');
select lives_ok($$select public.admin_list_scoped_admin_invites()$$,'Owner lists staged invitations');
reset role;
create temporary table created_invite as select id from public.admin_scoped_access_invites where target_email='boundary-invite@example.invalid';
grant select on created_invite to authenticated;
set local role authenticated;
select lives_ok($$select public.admin_revoke_scoped_admin_invite((select id from created_invite),'Synthetic owner revoke')$$,'Owner revokes staged invitation');
reset role;
select ok((select count(*) from public.admin_audit_log where actor_user_id='aa185600-0000-4000-8000-000000000001') >= 6,'Owner changes retain audit evidence');
select is((select count(*) from public.admin_audit_log where actor_user_id::text like 'aa185600-%' and actor_user_id <> 'aa185600-0000-4000-8000-000000000001'),0::bigint,'Denied actors produce no administrative changes');
select is((select count(*) from public.admin_roles where user_id='aa185600-0000-4000-8000-000000000009' and active),0::bigint,'Owner global revocation takes effect');
select ok(not exists(select 1 from public.admin_scoped_access_grants where user_id='aa185600-0000-4000-8000-000000000009' and revoked_at is null),'Owner scoped revocation takes effect');
select ok((select revoked_at is not null from public.admin_scoped_access_invites where target_email='boundary-invite@example.invalid'),'Owner staged invitation revocation takes effect');

-- Existing trusted scheduler behavior remains separate from browser authority.
set local role service_role;
select pg_temp.boundary_claims(null,'service_role');
select set_config('app.partner_report_scheduler_scope','',true);
select is(public.is_super_admin(null),false,'Service role alone is not global authority');
select set_config('app.partner_report_scheduler_scope','service_role',true);
select is(public.is_super_admin(null),true,'Existing trusted scheduler context is preserved');
select throws_ok(statement,'P0001',denial,'Internal service without owner identity: '||label) from boundary_calls;
select ok(has_function_privilege('service_role','public.partner_report_scheduler_preview_partner_period_report(uuid,date,date,text)','execute'), 'Scheduler API retains service execution');
select ok(not has_function_privilege('authenticated','public.partner_report_scheduler_preview_partner_period_report(uuid,date,date,text)','execute'),'Scheduler API remains unavailable to browser roles');
select set_config('app.partner_report_scheduler_scope','',true);
select ok(public.partner_report_scheduler_preview_partner_period_report('aa185607-0000-4000-8000-000000000001','2026-02-01','2026-02-28','calendar_month')
 @> '{"machine_periods":[{"reporting_machine_id":"aa185603-0000-4000-8000-000000000001"}]}',
 'Actual scheduler wrapper produces the synthetic machine report without owner identity');
select is(current_setting('app.partner_report_scheduler_scope',true),'service_role','Scheduler wrapper establishes its existing internal context');
reset role;

-- Exercise uncertain decisions independently of the normal helper result.
create or replace function public.is_super_admin(uid uuid) returns boolean
language sql stable security definer set search_path=public,auth as $$select null::boolean$$;
set local role authenticated;
select pg_temp.boundary_claims('aa185600-0000-4000-8000-000000000002');
select throws_ok(statement,'P0001',denial,'Unknown authorization: '||label) from boundary_calls;
reset role;
select * from finish();
rollback;
