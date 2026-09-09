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
  perform extensions.dblink_connect('pay_stub_freshness_local_guard', local_connection);
  perform extensions.dblink_disconnect('pay_stub_freshness_local_guard');
end;
$$;

begin;

drop schema if exists pay_stub_freshness_race_test cascade;
create schema pay_stub_freshness_race_test;

insert into public.customer_accounts (id, name, account_type)
values ('b2000000-0000-4000-8000-000000000001', 'Pay Stub freshness race', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Freshness race location', 'America/Los_Angeles');

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values ('b4000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'Freshness race machine');

insert into public.payout_policies (
  id, account_id, name, frequency, period_anchor_type, monthly_period_type,
  submission_due_offset_days, lock_offset_days, target_payout_offset_days,
  rounding_rule, review_model
)
values (
  'b5000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'Freshness race policy', 'monthly', 'calendar', 'calendar_month', 4, 4, 5,
  'round_up_60_minutes', 'no_review_required'
);

update public.customer_accounts
set default_payout_policy_id = 'b5000000-0000-4000-8000-000000000001'
where id = 'b2000000-0000-4000-8000-000000000001';

insert into public.operator_payout_profiles (
  id, account_id, display_name, worker_type, payout_policy_id
)
values (
  'b6000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'Freshness Race Technician', 'contractor_1099',
  'b5000000-0000-4000-8000-000000000001'
);

insert into public.operator_machine_assignments (
  id, operator_profile_id, account_id, reporting_machine_id,
  effective_start_date, effective_end_date, grant_reason
)
values (
  'b6100000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  '2026-01-01', '2026-12-31', 'Freshness concurrency fixture'
);

insert into public.payout_periods (
  id, account_id, payout_policy_id, period_start_date, period_end_date,
  submission_due_date, lock_date, target_payout_date, status
)
values (
  'b7000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  '2026-07-01', '2026-07-31', '2026-08-04', '2026-08-04', '2026-08-05', 'locked'
);

insert into public.payout_runs (id, account_id, payout_period_id, status)
values ('bc000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'issued');

insert into public.payout_run_items (
  id, payout_run_id, account_id, operator_profile_id, worker_type,
  raw_minutes, rounded_paid_minutes, shift_count, hourly_pay_cents,
  eligible_net_revenue_cents, commission_pay_cents, total_payout_cents, status
)
values (
  'bc100000-0000-4000-8000-000000000001',
  'bc000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001',
  'contractor_1099', 0, 0, 0, 0, 0, 0, 0, 'finalized'
);

insert into public.pay_statements (
  id, payout_run_id, payout_run_item_id, account_id, operator_profile_id,
  statement_number, statement_label, status, version, issued_at,
  statement_payload, operator_notification_status
)
values (
  'bc300000-0000-4000-8000-000000000001',
  'bc000000-0000-4000-8000-000000000001',
  'bc100000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001',
  'BJ-STUB-202607-RACE-V1', 'Pay Stub', 'issued', 1, now(),
  '{"schemaVersion":"operator-pay-stub-v2","calculationMeta":{"paySourceRevision":0}}'::jsonb,
  'portal_published'
);

create function pay_stub_freshness_race_test.insert_time()
returns text
language plpgsql
set search_path = public
as $$
begin
  perform set_config('app.timekeeping_manager_correction', 'true', true);
  perform set_config('app.timekeeping_change_kind', 'manager_created', true);
  insert into public.time_entries (
    id, account_id, operator_profile_id, reporting_machine_id, reporting_location_id,
    payout_policy_id, payout_period_id, work_date, start_time, end_time,
    actual_start_at, actual_end_at, raw_duration_minutes, rounded_paid_minutes,
    paid_shift_count, status
  ) values (
    'b9000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-4000-8000-000000000001',
    'b7000000-0000-4000-8000-000000000001',
    '2026-07-30', '08:00', '09:00',
    '2026-07-30 15:00:00+00', '2026-07-30 16:00:00+00',
    60, 60, 1, 'submitted'
  );
  return 'inserted';
end;
$$;

create function pay_stub_freshness_race_test.wait_for_advisory(p_pid integer)
returns boolean
language plpgsql
set search_path = pg_catalog
as $$
declare
  attempt integer;
begin
  for attempt in 1..40 loop
    if exists (
      select 1
      from pg_catalog.pg_stat_activity activity
      where activity.pid = p_pid
        and lower(coalesce(activity.wait_event, '')) = 'advisory'
    ) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
  return false;
end;
$$;

commit;

select plan(5);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('pay_stub_freshness_race_a', local_connection);
end;
$$;

create temporary table pay_stub_freshness_remote_backend as
select pid
from extensions.dblink(
  'pay_stub_freshness_race_a',
  'select pg_backend_pid()'
) as response(pid integer);

begin;
select pg_advisory_xact_lock(private.operator_pay_time_source_lock_key(
  'b6000000-0000-4000-8000-000000000001', 2026
));
select extensions.dblink_send_query(
  'pay_stub_freshness_race_a',
  'select pay_stub_freshness_race_test.insert_time()'
);

select ok(
  pay_stub_freshness_race_test.wait_for_advisory(
    (select pid from pay_stub_freshness_remote_backend)
  ),
  'the independent time-entry transaction waits on the shared Technician/year lock'
);
select is(
  extensions.dblink_is_busy('pay_stub_freshness_race_a'),
  1,
  'the independent time-entry transaction remains blocked during statement calculation'
);

-- This is the exact source watermark a serialized statement calculation can
-- record while it owns the shared lock.
update public.pay_statements statement
set statement_payload = statement.statement_payload || jsonb_build_object(
  'calculationMeta', jsonb_build_object(
    'paySourceRevision', private.operator_pay_time_source_revision(
      statement.operator_profile_id,
      '2026-07-31'
    )
  )
)
where statement.id = 'bc300000-0000-4000-8000-000000000001';
commit;

create temporary table pay_stub_freshness_race_results (result text not null);
insert into pay_stub_freshness_race_results
select result
from extensions.dblink_get_result('pay_stub_freshness_race_a') as response(result text);

select is(
  (select result from pay_stub_freshness_race_results),
  'inserted',
  'the time-entry transaction completes after statement calculation releases the lock'
);
select ok(
  private.operator_pay_time_source_revision(
    'b6000000-0000-4000-8000-000000000001',
    '2026-07-31'
  ) > 0,
  'the later-committing time entry receives a newer source revision'
);
select ok(
  private.operator_pay_stub_regeneration_required(
    'b6000000-0000-4000-8000-000000000001',
    '2026-07-01',
    '2026-07-31'
  ),
  'a time change absent from the serialized calculation cannot appear current'
);

do $$
begin
  perform extensions.dblink_disconnect('pay_stub_freshness_race_a');
end;
$$;

begin;
delete from public.time_entries where id = 'b9000000-0000-4000-8000-000000000001';
delete from public.pay_statements where id = 'bc300000-0000-4000-8000-000000000001';
delete from public.payout_run_items where id = 'bc100000-0000-4000-8000-000000000001';
delete from public.payout_runs where id = 'bc000000-0000-4000-8000-000000000001';
delete from public.payout_periods where id = 'b7000000-0000-4000-8000-000000000001';
delete from public.operator_machine_assignments where id = 'b6100000-0000-4000-8000-000000000001';
delete from public.operator_payout_profiles where id = 'b6000000-0000-4000-8000-000000000001';
delete from public.payout_policies where id = 'b5000000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id = 'b4000000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id = 'b3000000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id = 'b2000000-0000-4000-8000-000000000001';
drop schema pay_stub_freshness_race_test cascade;
commit;

select * from finish();
