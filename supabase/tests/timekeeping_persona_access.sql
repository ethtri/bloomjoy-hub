begin;

select plan(36);

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

create function pg_temp.can_manage_for(actor_user_id uuid, machine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_operator_payout_machine(actor_user_id, machine_id);
$$;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'time-worker-one@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'time-worker-two@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'time-manager-assigned@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'time-manager-unassigned@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'time-plus-no-grant@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'time-partner-no-grant@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.customer_accounts (id, name, account_type)
values ('20000000-0000-0000-0000-000000000001', 'Timekeeping persona test account', 'customer');

insert into public.customer_account_memberships (
  id,
  account_id,
  user_id,
  email,
  role,
  active
)
values (
  '21000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000006',
  'time-partner-no-grant@example.test',
  'partner',
  true
);

insert into public.plus_access_grants (
  id,
  user_id,
  starts_at,
  expires_at,
  grant_reason
)
values (
  '22000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000005',
  now() - interval '1 day',
  now() + interval '30 days',
  'Timekeeping persona test fixture'
);

insert into public.reporting_locations (id, account_id, name)
values (
  '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Timekeeping test location'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values
  (
    '40000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'Machine A'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'Machine B'
  );

insert into public.reporting_machine_refund_managers (
  id,
  reporting_machine_id,
  manager_user_id,
  manager_email,
  grant_reason
)
values (
  '41000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003',
  'time-manager-assigned@example.test',
  'Timekeeping persona test fixture'
);

insert into public.payout_policies (
  id,
  account_id,
  name,
  frequency,
  period_anchor_type,
  monthly_period_type,
  rounding_rule
)
values (
  '50000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Timekeeping persona monthly policy',
  'monthly',
  'calendar',
  'calendar_month',
  'round_up_60_minutes'
);

update public.customer_accounts
set default_payout_policy_id = '50000000-0000-0000-0000-000000000001'
where id = '20000000-0000-0000-0000-000000000001';

insert into public.operator_payout_profiles (
  id,
  account_id,
  user_id,
  display_name,
  payout_policy_id
)
values
  (
    '60000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Time Worker One',
    '50000000-0000-0000-0000-000000000001'
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'Time Worker Two',
    '50000000-0000-0000-0000-000000000001'
  );

insert into public.operator_machine_assignments (
  id,
  operator_profile_id,
  account_id,
  reporting_machine_id,
  effective_start_date,
  grant_reason
)
values
  (
    '61000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    current_date - 30,
    'Timekeeping persona test fixture'
  ),
  (
    '61000000-0000-0000-0000-000000000002',
    '60000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    current_date - 30,
    'Timekeeping persona test fixture'
  );

insert into public.payout_periods (
  id,
  account_id,
  payout_policy_id,
  period_start_date,
  period_end_date,
  submission_due_date,
  lock_date,
  target_payout_date
)
values (
  '70000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  date_trunc('month', current_date)::date,
  (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
  (date_trunc('month', current_date) + interval '1 month + 1 day')::date,
  (date_trunc('month', current_date) + interval '1 month + 2 days')::date,
  (date_trunc('month', current_date) + interval '1 month + 4 days')::date
);

insert into public.time_entries (
  id,
  account_id,
  operator_profile_id,
  reporting_machine_id,
  reporting_location_id,
  payout_policy_id,
  payout_period_id,
  work_date,
  start_time,
  end_time,
  raw_duration_minutes,
  rounded_paid_minutes,
  status
)
values
  (
    '80000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    current_date - 1,
    '09:00',
    '10:30',
    90,
    120,
    'submitted'
  ),
  (
    '80000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    current_date - 1,
    '11:00',
    '12:00',
    60,
    60,
    'submitted'
  );

select ok(
  not has_function_privilege('anon', 'public.get_my_time_review_context(date)', 'execute'),
  'unauthenticated callers cannot execute the review queue RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.review_operator_time_entry(uuid,text,text,date)',
    'execute'
  ),
  'unauthenticated callers cannot execute the review action RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_my_time_review_context(date)',
    'execute'
  ),
  'authenticated callers can reach the review queue RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.time_entries', 'insert'),
  'authenticated callers cannot insert time entries directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.time_entries', 'update'),
  'authenticated callers cannot update time entries directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.time_entries', 'delete'),
  'authenticated callers cannot delete time entries directly'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

select is(
  auth.uid(),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'the worker-one JWT fixture resolves to the intended actor'
);
select is(
  pg_temp.can_manage_for(
    auth.uid(),
    '40000000-0000-0000-0000-000000000002'
  ),
  false,
  'a worker has no implicit manager authority over another machine'
);
select is(
  (select count(*)::integer from public.time_entries),
  1,
  'a worker sees only their own time entry through RLS'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000002',
      'approved',
      null,
      current_date - 1
    )
  $$),
  'Machine manager access required',
  'another worker cannot review another worker entry'
);
select is(
  pg_temp.capture_error($$
    select public.update_operator_time_entry(
      '80000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000002',
      current_date - 1,
      '11:00',
      '12:30',
      null,
      'submitted'
    )
  $$),
  'Operator timekeeping access required',
  'another worker cannot edit another worker entry'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000004',
  true
);

select is(
  auth.uid(),
  '10000000-0000-0000-0000-000000000004'::uuid,
  'the unassigned-manager JWT fixture resolves to the intended actor'
);
select is(
  pg_temp.can_manage_for(
    auth.uid(),
    '40000000-0000-0000-0000-000000000001'
  ),
  false,
  'an unassigned Machine Manager has no machine authority'
);
select is(
  public.get_my_time_review_context(current_date - 1)->>'hasAccess',
  'false',
  'an unassigned Machine Manager has no review access'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(current_date - 1)->'entries'),
  0,
  'an unassigned Machine Manager receives no entries'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      'approved',
      null,
      current_date - 1
    )
  $$),
  'Machine manager access required',
  'an unassigned Machine Manager cannot review a shift'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000005',
  true
);

select is(
  auth.uid(),
  '10000000-0000-0000-0000-000000000005'::uuid,
  'the Plus JWT fixture resolves to the intended actor'
);
select is(
  pg_temp.can_manage_for(
    auth.uid(),
    '40000000-0000-0000-0000-000000000001'
  ),
  false,
  'Plus access without a machine grant creates no machine authority'
);
select ok(
  (select has_plus_access from public.get_my_plus_access()),
  'the Plus test persona has active Plus access'
);
select is(
  public.get_my_time_review_context(current_date - 1)->>'hasAccess',
  'false',
  'Plus access without a machine grant does not grant review access'
);
select is(
  (select count(*)::integer from public.time_entries),
  0,
  'Plus access without a machine grant exposes no time entries'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000006',
  true
);

select is(
  auth.uid(),
  '10000000-0000-0000-0000-000000000006'::uuid,
  'the partner JWT fixture resolves to the intended actor'
);
select is(
  pg_temp.can_manage_for(
    auth.uid(),
    '40000000-0000-0000-0000-000000000001'
  ),
  false,
  'a partner membership without a machine grant creates no machine authority'
);
select is(
  public.get_my_time_review_context(current_date - 1)->>'hasAccess',
  'false',
  'a partner membership without a machine grant does not grant review access'
);
select is(
  (select count(*)::integer from public.time_entries),
  0,
  'a partner membership without a machine grant exposes no time entries'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000003',
  true
);

select is(
  auth.uid(),
  '10000000-0000-0000-0000-000000000003'::uuid,
  'the assigned-manager JWT fixture resolves to the intended actor'
);
select is(
  pg_temp.can_manage_for(
    auth.uid(),
    '40000000-0000-0000-0000-000000000001'
  ),
  true,
  'an assigned Machine Manager has authority over the assigned machine'
);
select is(
  pg_temp.can_manage_for(
    auth.uid(),
    '40000000-0000-0000-0000-000000000002'
  ),
  false,
  'an assigned Machine Manager has no authority over an unassigned machine'
);
select is(
  public.get_my_time_review_context(current_date - 1)->>'hasAccess',
  'true',
  'an assigned Machine Manager has review access'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(current_date - 1)->'machines'),
  1,
  'an assigned Machine Manager receives only their managed machine'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(current_date - 1)->'entries'),
  1,
  'an assigned Machine Manager receives only entries on their managed machine'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000002',
      'approved',
      null,
      current_date - 1
    )
  $$),
  'Machine manager access required',
  'an assigned Machine Manager cannot review an out-of-scope machine'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      'approved',
      null,
      current_date - 1
    )
  $$),
  null,
  'an assigned Machine Manager can approve an in-scope shift'
);
select is(
  (
    select manager_review_status
    from public.time_entries
    where id = '80000000-0000-0000-0000-000000000001'
  ),
  'approved',
  'the approved review state is persisted'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.time_entry_review_events
    where time_entry_id = '80000000-0000-0000-0000-000000000001'
      and decision = 'approved'
  ),
  1,
  'the review action records an immutable review event'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000003',
  true
);

select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      'needs_correction',
      null,
      current_date - 1
    )
  $$),
  'A correction reason is required',
  'requesting correction requires a reason'
);

select * from finish();
rollback;
