begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(43);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then
    return sqlerrm;
end;
$$;

create function pg_temp.resolve_rate(
  account_id uuid,
  operator_profile_id uuid,
  machine_id uuid,
  effective_date date,
  rate_type text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.operator_compensation_rate_at(
    account_id,
    operator_profile_id,
    machine_id,
    effective_date,
    rate_type
  );
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'data-rules-tech@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'data-rules-other-tech@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'data-rules-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'data-rules-outsider@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '91000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'data-rules-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('92000000-0000-0000-0000-000000000001', 'Timekeeping data-rules account', 'customer');

insert into public.customer_account_memberships (
  id, account_id, user_id, email, role, active
)
values (
  '92100000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000005',
  'data-rules-owner@example.test',
  'owner',
  true
);

insert into public.reporting_locations (id, account_id, name)
values (
  '93000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  'Data-rules location'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values
  ('94000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 'Data Machine A'),
  ('94000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001', 'Data Machine B');

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values
  ('94100000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000003', 'data-rules-manager@example.test', 'Data-rules manager fixture'),
  ('94100000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000004', 'data-rules-outsider@example.test', 'Out-of-scope manager fixture');

insert into public.payout_policies (
  id, account_id, name, frequency, period_anchor_type, monthly_period_type,
  submission_due_offset_days, lock_offset_days, target_payout_offset_days,
  rounding_rule, review_model
)
values (
  '95000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  'Data-rules monthly policy',
  'monthly',
  'calendar',
  'calendar_month',
  4,
  4,
  5,
  'round_up_60_minutes',
  'no_review_required'
);

update public.customer_accounts
set default_payout_policy_id = '95000000-0000-0000-0000-000000000001'
where id = '92000000-0000-0000-0000-000000000001';

insert into public.operator_payout_profiles (
  id, account_id, user_id, display_name, worker_type, payout_policy_id
)
values
  ('96000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'Data Rules Technician', 'contractor_1099', '95000000-0000-0000-0000-000000000001'),
  ('96000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000002', 'Other Technician', 'contractor_1099', '95000000-0000-0000-0000-000000000001');

insert into public.operator_machine_assignments (
  id, operator_profile_id, account_id, reporting_machine_id,
  effective_start_date, grant_reason
)
values
  ('96100000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', '2020-01-01', 'Data-rules assignment fixture'),
  ('96100000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000002', '2020-01-01', 'Data-rules assignment fixture'),
  ('96100000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000002', '2020-01-01', 'Other Technician assignment fixture');

select is(public.operator_paid_shift_count(1), 1, '1-60 minutes is one paid shift');
select is(public.operator_paid_shift_count(60), 1, '60 minutes remains one paid shift');
select is(public.operator_paid_shift_count(61), 2, '61-120 minutes is two paid shifts');
select is(public.operator_paid_shift_count(120), 2, '120 minutes remains two paid shifts');
select is(
  public.operator_time_entry_cutoff_at('2026-12-31'::date),
  '2027-01-05 08:00:00+00'::timestamptz,
  'December Technician time locks at the start of January 5 Pacific time'
);
select is(
  public.operator_worker_notice_code('contractor_1099'),
  'independent_contractor_no_withholding',
  'contractor classification selects the no-withholding notice'
);
select ok(
  not has_table_privilege('authenticated', 'public.time_entries', 'insert'),
  'browser callers cannot insert time directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.time_entries', 'update'),
  'browser callers cannot update time directly'
);
select ok(
  not has_function_privilege('anon', 'public.save_operator_time_entry(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text)', 'execute'),
  'anonymous callers cannot save time'
);
select ok(
  has_function_privilege('authenticated', 'public.save_operator_time_entry(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text)', 'execute'),
  'authenticated callers can reach the audited Technician save RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.manager_correct_operator_time_entry(uuid,uuid,timestamp with time zone,timestamp with time zone,text,boolean)', 'execute'),
  'authenticated callers can reach the scoped manager correction RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.operator_compensation_rate_at(uuid,uuid,uuid,date,text)', 'execute'),
  'browser callers cannot invoke the internal rate resolver directly'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);

select is(
  pg_temp.capture_error(format(
    $sql$
      select public.save_operator_time_entry(
        null,
        '96000000-0000-0000-0000-000000000001',
        '94000000-0000-0000-0000-000000000001',
        %L::timestamptz,
        %L::timestamptz,
        null
      )
    $sql$,
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '08:00') at time zone 'America/Los_Angeles',
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '08:20') at time zone 'America/Los_Angeles'
  )),
  null,
  'a Technician can save completed assigned-machine time'
);
select is(
  (select paid_shift_count from public.time_entries order by created_at desc limit 1),
  1,
  'a 20-minute entry stores one paid shift'
);
select is(
  pg_temp.capture_error(format(
    $sql$
      select public.save_operator_time_entry(
        null,
        '96000000-0000-0000-0000-000000000001',
        '94000000-0000-0000-0000-000000000002',
        %L::timestamptz,
        %L::timestamptz,
        null
      )
    $sql$,
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '08:20') at time zone 'America/Los_Angeles',
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '08:40') at time zone 'America/Los_Angeles'
  )),
  null,
  'adjacent entries are accepted'
);
select is(
  pg_temp.capture_error(format(
    $sql$
      select public.save_operator_time_entry(
        null,
        '96000000-0000-0000-0000-000000000001',
        '94000000-0000-0000-0000-000000000001',
        %L::timestamptz,
        %L::timestamptz,
        null
      )
    $sql$,
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '08:40') at time zone 'America/Los_Angeles',
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '09:00') at time zone 'America/Los_Angeles'
  )),
  null,
  'a third separate 20-minute entry is accepted'
);
select is(
  (select sum(paid_shift_count)::integer from public.time_entries where operator_profile_id = '96000000-0000-0000-0000-000000000001'),
  3,
  'three separate 20-minute entries produce three paid shifts'
);
select is(
  pg_temp.capture_error(format(
    $sql$
      select public.save_operator_time_entry(
        null,
        '96000000-0000-0000-0000-000000000001',
        '94000000-0000-0000-0000-000000000002',
        %L::timestamptz,
        %L::timestamptz,
        null
      )
    $sql$,
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '08:10') at time zone 'America/Los_Angeles',
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '08:30') at time zone 'America/Los_Angeles'
  )),
  'Time entry overlaps another Technician entry',
  'cross-machine overlap is rejected'
);
select is(
  pg_temp.capture_error(format(
    $sql$
      select public.save_operator_time_entry(
        null,
        '96000000-0000-0000-0000-000000000002',
        '94000000-0000-0000-0000-000000000002',
        %L::timestamptz,
        %L::timestamptz,
        null
      )
    $sql$,
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '10:00') at time zone 'America/Los_Angeles',
    (((now() at time zone 'America/Los_Angeles')::date - 1)::timestamp + time '11:00') at time zone 'America/Los_Angeles'
  )),
  'Technician timekeeping access required',
  'a Technician cannot save time for another Technician'
);

reset role;

insert into public.payout_periods (
  id, account_id, payout_policy_id, period_start_date, period_end_date,
  submission_due_date, lock_date, target_payout_date, status
)
values (
  '97000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000001',
  '2026-01-01', '2026-01-31', '2026-02-04', '2026-02-04', '2026-02-05', 'locked'
);

select set_config('app.timekeeping_manager_correction', 'true', true);
insert into public.time_entries (
  id, account_id, operator_profile_id, reporting_machine_id, reporting_location_id,
  payout_policy_id, payout_period_id, work_date, start_time, end_time,
  actual_start_at, actual_end_at, raw_duration_minutes, rounded_paid_minutes,
  paid_shift_count, status
)
values (
  '98000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000001',
  '2026-01-15', '09:00', '10:00',
  '2026-01-15 17:00:00+00', '2026-01-15 18:00:00+00',
  60, 60, 1, 'submitted'
);
select set_config('app.timekeeping_manager_correction', '', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000003', true);

select is(
  pg_temp.capture_error($$
    select public.manager_correct_operator_time_entry(
      '98000000-0000-0000-0000-000000000001',
      '94000000-0000-0000-0000-000000000001',
      '2026-01-15 17:00:00+00',
      '2026-01-15 18:01:00+00',
      'Corrected by manager',
      false
    )
  $$),
  null,
  'manager correction works after the Technician cutoff without a reason'
);
select is(
  (select concat(raw_duration_minutes, ':', paid_shift_count) from public.time_entries where id = '98000000-0000-0000-0000-000000000001'),
  '61:2',
  'manager correction recalculates actual minutes and paid shifts'
);
select is(
  (select count(*)::integer from public.time_entry_change_events where time_entry_id = '98000000-0000-0000-0000-000000000001' and change_kind = 'manager_corrected'),
  1,
  'manager correction retains immutable before and after evidence'
);

reset role;
select is(
  (select meta->>'reason_required' from public.admin_audit_log where entity_id = '98000000-0000-0000-0000-000000000001' and action = 'operator_time_entry.manager_corrected' order by created_at desc limit 1),
  'false',
  'manager correction audit confirms no edit reason is required'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000004', true);
select is(
  pg_temp.capture_error($$
    select public.manager_correct_operator_time_entry(
      '98000000-0000-0000-0000-000000000001',
      '94000000-0000-0000-0000-000000000001',
      '2026-01-15 17:00:00+00',
      '2026-01-15 18:02:00+00',
      null,
      false
    )
  $$),
  'Machine manager access required',
  'out-of-scope manager correction fails closed'
);

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000005', true);

select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_machine_assignment(null, '96000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001', '2026-01-01', '2026-06-30')
  $$),
  null,
  'an authorized manager can create an effective machine assignment window'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_machine_assignment(null, '96000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001', '2026-07-01', null)
  $$),
  null,
  'sequential machine assignment windows are accepted'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_machine_assignment(null, '96000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001', '2026-06-30', '2026-07-15')
  $$),
  'Machine assignment overlaps an existing effective window',
  'overlapping machine assignment windows are rejected'
);

select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_compensation_rate(null, '92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', null, 'shift', 2000, '2026-01-01', '2026-06-30', 'active', null)
  $$),
  null,
  'an authorized owner can create an effective Technician shift rate'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_compensation_rate(null, '92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', null, 'shift', 2500, '2026-07-01', null, 'active', null)
  $$),
  null,
  'a later non-overlapping Technician shift rate preserves the earlier period'
);
select is(
  (pg_temp.resolve_rate('92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', '2026-02-01', 'shift')->>'shiftRateCents')::integer,
  2000,
  'the earlier period keeps its effective shift rate'
);
select is(
  (pg_temp.resolve_rate('92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', '2026-08-01', 'shift')->>'shiftRateCents')::integer,
  2500,
  'the later period uses the raised shift rate'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_compensation_rate(null, '92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', null, 'commission', 500, '2026-01-01', null, 'active', null)
  $$),
  null,
  'an authorized owner can create a Technician commission default'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_compensation_rate(null, '92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', 'commission', 750, '2026-01-01', null, 'active', null)
  $$),
  null,
  'an authorized owner can create an explicit Technician-machine commission override'
);
select is(
  (pg_temp.resolve_rate('92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', '2026-08-01', 'commission')->>'commissionBasisPoints')::integer,
  750,
  'machine-specific commission overrides the Technician default'
);
select is(
  (pg_temp.resolve_rate('92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000002', '2026-08-01', 'commission')->>'commissionBasisPoints')::integer,
  500,
  'another machine falls back to the Technician commission default'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_compensation_rate(null, '92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', null, 'commission', 600, '2026-05-01', null, 'active', null)
  $$),
  'Compensation rate overlaps an existing effective rate',
  'overlapping effective compensation rates are rejected'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_recurring_item(null, '92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', 'supply_credit', 'Monthly supplies', 5000, '2026-01-01', null, 'active')
  $$),
  null,
  'an effective recurring supply credit can be configured'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_recurring_item(null, '92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', 'supply_credit', 'Invalid deduction', -5000, '2026-01-01', null, 'active')
  $$),
  'Recurring compensation item is invalid',
  'recurring earnings and credits cannot silently become deductions'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_ytd_opening_balance('92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', 2026, '2026-06-30', 600, 10, 100000, 20000, 5000, 0, 5000, 0)
  $$),
  null,
  'an opening YTD balance can be created for a midyear launch'
);
select is(
  pg_temp.capture_error($$
    select public.admin_upsert_operator_ytd_opening_balance('92000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', 2026, '2026-06-30', 660, 11, 110000, 22000, 5500, 0, 5000, 0)
  $$),
  null,
  'opening YTD balance is idempotently replaceable'
);
select is(
  (select concat(count(*), ':', max(paid_shift_count)) from public.operator_ytd_opening_balances where operator_profile_id = '96000000-0000-0000-0000-000000000001' and calendar_year = 2026),
  '1:11',
  'opening YTD replacement retains one current audited row'
);

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000004', true);
select is(
  (select count(*)::integer from public.operator_ytd_opening_balances),
  0,
  'an out-of-scope manager cannot read opening YTD balances'
);

reset role;
select is(
  (select review_model from public.payout_policies where id = '95000000-0000-0000-0000-000000000001'),
  'no_review_required',
  'the canonical monthly policy has no approval requirement'
);

select * from finish();
rollback;
