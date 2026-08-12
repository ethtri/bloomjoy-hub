create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

-- Refuse to run the committed two-session fixture anywhere except the
-- disposable Supabase CLI database.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('manager_assignment_local_guard', local_connection);
  perform extensions.dblink_disconnect('manager_assignment_local_guard');
end;
$$;

begin;

drop schema if exists refund_manager_assignment_race_test cascade;
create schema refund_manager_assignment_race_test;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '88500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'assignment-race-manager-one@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '88500000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'assignment-race-manager-two@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('88510000-0000-4000-8000-000000000001', 'Refund assignment race', 'customer');
insert into public.reporting_locations (id, account_id, name, timezone)
values ('88520000-0000-4000-8000-000000000001', '88510000-0000-4000-8000-000000000001', 'Refund assignment race location', 'America/Los_Angeles');
insert into public.reporting_machines (id, account_id, location_id, machine_label)
values ('88530000-0000-4000-8000-000000000001', '88510000-0000-4000-8000-000000000001', '88520000-0000-4000-8000-000000000001', 'Refund assignment race machine');
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values ('88540000-0000-4000-8000-000000000001', '88530000-0000-4000-8000-000000000001', '88500000-0000-4000-8000-000000000001', 'assignment-race-manager-one@example.test', 'Assignment race');

insert into public.refund_cases (
  id, customer_email, issue_summary, status, intake_source
)
values ('88550000-0000-4000-8000-000000000001', 'assignment-race-customer@example.test', 'Synthetic assignment race.', 'draft', 'gmail');

create function refund_manager_assignment_race_test.bind_case()
returns text
language plpgsql
set search_path = public
as $$
begin
  update public.refund_cases
  set
    reporting_machine_id = '88530000-0000-4000-8000-000000000001',
    reporting_location_id = '88520000-0000-4000-8000-000000000001',
    incident_at = now(),
    payment_method = 'card',
    status = 'needs_review'
  where id = '88550000-0000-4000-8000-000000000001';
  return 'bound';
end;
$$;

commit;

select plan(6);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('manager_assignment_race_a', local_connection);
end;
$$;

create temporary table manager_assignment_remote_backend as
select pid
from extensions.dblink(
  'manager_assignment_race_a',
  'select pg_backend_pid()'
) as response(pid integer);

-- Hold the mapping lock, start case binding in another session, then replace
-- the mapping before release. The binding session must wait and re-read the
-- committed replacement rather than persist the stale manager.
begin;
select pg_advisory_xact_lock(hashtext('machine_manager:88530000-0000-4000-8000-000000000001'));
select extensions.dblink_send_query(
  'manager_assignment_race_a',
  'select refund_manager_assignment_race_test.bind_case()'
);
select pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('manager_assignment_race_a'),
  1,
  'The independent case-binding session is still blocked before mapping replacement commits'
);
select is(
  (
    select lower(coalesce(activity.wait_event, ''))
    from pg_catalog.pg_stat_activity activity
    where activity.pid = (select pid from manager_assignment_remote_backend)
  ),
  'advisory',
  'The independent case-binding session is waiting on the shared advisory lock'
);

-- Perform the replacement in this lock-owning transaction so the binding
-- session observes one coherent post-commit mapping set.
update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = now(), revoke_reason = 'Assignment race replacement'
where id = '88540000-0000-4000-8000-000000000001';
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  '88540000-0000-4000-8000-000000000002',
  '88530000-0000-4000-8000-000000000001',
  '88500000-0000-4000-8000-000000000002',
  'assignment-race-manager-two@example.test',
  'Assignment race replacement'
);
commit;

create temporary table manager_assignment_race_results (
  connection_name text primary key,
  result text not null
);
insert into manager_assignment_race_results
select 'bind', result
from extensions.dblink_get_result('manager_assignment_race_a') as response(result text);

select is((select result from manager_assignment_race_results where connection_name = 'bind'), 'bound',
  'The independent case-binding session completes after lock release');
select is((select assigned_manager_id from public.refund_cases where id = '88550000-0000-4000-8000-000000000001'),
  '88500000-0000-4000-8000-000000000002'::uuid,
  'Case binding re-reads and assigns the replacement manager after contention');
select is((select intake_meta ->> 'manager_assignment_active_mapping_count' from public.refund_cases where id = '88550000-0000-4000-8000-000000000001'),
  '1',
  'The contended case records one coherent current mapping');
select ok(not exists (
    select 1
    from public.refund_cases
    where id = '88550000-0000-4000-8000-000000000001'
      and assigned_manager_id = '88500000-0000-4000-8000-000000000001'
  ),
  'The revoked manager is never persisted as stale case ownership');

do $$
begin
  perform extensions.dblink_disconnect('manager_assignment_race_a');
end;
$$;

begin;
delete from public.refund_cases where id = '88550000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers where reporting_machine_id = '88530000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id = '88530000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id = '88520000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id = '88510000-0000-4000-8000-000000000001';
delete from auth.users where id in ('88500000-0000-4000-8000-000000000001', '88500000-0000-4000-8000-000000000002');
drop schema refund_manager_assignment_race_test cascade;
commit;

select * from finish();
