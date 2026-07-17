begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(73);

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

create function pg_temp.is_corporate_partner_for(actor_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_corporate_partner_user(actor_user_id);
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

insert into public.reporting_partners (
  id,
  name,
  partner_type,
  status
)
values (
  '21000000-0000-0000-0000-000000000001',
  'Timekeeping persona corporate partner',
  'platform_partner',
  'active'
);

insert into public.corporate_partner_memberships (
  id,
  partner_id,
  user_id,
  member_email,
  status,
  starts_at,
  grant_reason
)
values (
  '21100000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000006',
  'time-partner-no-grant@example.test',
  'active',
  now() - interval '1 day',
  'Timekeeping persona test fixture'
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
values
  (
    '41000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000003',
    'time-manager-assigned@example.test',
    'Timekeeping persona test fixture'
  ),
  (
    '41000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000004',
    'time-manager-unassigned@example.test',
    'Other-machine manager test fixture'
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
    date_trunc('month', current_date)::date,
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
    date_trunc('month', current_date)::date,
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

set local role anon;
select is(
  (select count(*)::integer from public.time_entries),
  0,
  'an anonymous actor receives no time entries through direct-table RLS'
);
select ok(
  pg_temp.capture_error($$
    select public.get_my_operator_timekeeping_context(current_date)
  $$) like '%permission denied for function get_my_operator_timekeeping_context%',
  'an anonymous actor is behaviorally denied the worker context RPC'
);
select ok(
  pg_temp.capture_error($$
    select public.submit_operator_time_entry(
      '60000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      date_trunc('month', current_date)::date,
      '08:00',
      '09:00',
      null,
      'submitted'
    )
  $$) like '%permission denied for function submit_operator_time_entry%',
  'an anonymous actor is behaviorally denied worker submission'
);
select ok(
  pg_temp.capture_error($$
    select public.update_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      date_trunc('month', current_date)::date,
      '08:00',
      '09:00',
      null,
      'submitted'
    )
  $$) like '%permission denied for function update_operator_time_entry%',
  'an anonymous actor is behaviorally denied worker updates'
);
select ok(
  pg_temp.capture_error($$
    select public.void_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      'Anonymous delete attempt'
    )
  $$) like '%permission denied for function void_operator_time_entry%',
  'an anonymous actor is behaviorally denied worker voids'
);
select ok(
  pg_temp.capture_error($$
    select public.get_my_time_review_context(current_date)
  $$) like '%permission denied for function get_my_time_review_context%',
  'an anonymous actor is behaviorally denied the review queue RPC'
);
select ok(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      'approved',
      null,
      current_date
    )
  $$) like '%permission denied for function review_operator_time_entry%',
  'an anonymous actor is behaviorally denied the review action RPC'
);
reset role;

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
  (select string_agg(id::text, ',' order by id) from public.time_entries),
  '80000000-0000-0000-0000-000000000001',
  'a worker sees the exact expected own entry through RLS'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000002',
      'approved',
      null,
      date_trunc('month', current_date)::date
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
      date_trunc('month', current_date)::date,
      '11:00',
      '12:30',
      null,
      'submitted'
    )
  $$),
  'Operator timekeeping access required',
  'another worker cannot edit another worker entry'
);
select is(
  pg_temp.capture_error($$
    select public.submit_operator_time_entry(
      '60000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002',
      date_trunc('month', current_date)::date,
      '13:00',
      '14:00',
      null,
      'submitted'
    )
  $$),
  'Operator is not assigned to this machine for the work date',
  'a worker cannot submit time to an unassigned machine'
);
select is(
  pg_temp.capture_error($$
    select public.submit_operator_time_entry(
      '60000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000002',
      date_trunc('month', current_date)::date,
      '13:00',
      '14:00',
      null,
      'submitted'
    )
  $$),
  'Operator payout profile not found',
  'a worker cannot submit time against another worker profile'
);
select is(
  pg_temp.capture_error($$
    select public.void_operator_time_entry(
      '80000000-0000-0000-0000-000000000002',
      'Unauthorized cross-worker delete test'
    )
  $$),
  'Operator timekeeping access required',
  'another worker cannot void another worker entry'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000004',
  true
);

select is(
  auth.uid(),
  '10000000-0000-0000-0000-000000000004'::uuid,
  'the other-machine manager JWT fixture resolves to the intended actor'
);
select is(
  pg_temp.can_manage_for(
    auth.uid(),
    '40000000-0000-0000-0000-000000000001'
  ),
  false,
  'a Machine Manager assigned elsewhere has no authority over the target machine'
);
select is(
  pg_temp.can_manage_for(
    auth.uid(),
    '40000000-0000-0000-0000-000000000002'
  ),
  true,
  'the other-machine persona is an active Machine Manager'
);
select is(
  public.get_my_time_review_context(date_trunc('month', current_date)::date)->>'hasAccess',
  'true',
  'the other-machine manager can reach only their own review scope'
);
select is(
  public.get_my_time_review_context(date_trunc('month', current_date)::date)->'machines'->0->>'machineId',
  '40000000-0000-0000-0000-000000000002',
  'the other-machine manager receives the exact assigned machine'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(date_trunc('month', current_date)::date)->'machines'),
  1,
  'the other-machine manager queue contains no extra machines'
);
select is(
  public.get_my_time_review_context(date_trunc('month', current_date)::date)->'entries'->0->>'id',
  '80000000-0000-0000-0000-000000000002',
  'the other-machine manager receives only their assigned-machine entry'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(date_trunc('month', current_date)::date)->'entries'),
  1,
  'the other-machine manager queue contains no extra entries'
);
select is(
  (select string_agg(id::text, ',' order by id) from public.time_entries),
  '80000000-0000-0000-0000-000000000002',
  'the other-machine manager RLS read exposes only their assigned-machine entry'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      'approved',
      null,
      date_trunc('month', current_date)::date
    )
  $$),
  'Machine manager access required',
  'a Machine Manager assigned elsewhere cannot review the target shift'
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
  public.get_my_time_review_context(date_trunc('month', current_date)::date)->>'hasAccess',
  'false',
  'Plus access without a machine grant does not grant review access'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(date_trunc('month', current_date)::date)->'machines'),
  0,
  'Plus access without a machine grant receives no review machines'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(date_trunc('month', current_date)::date)->'entries'),
  0,
  'Plus access without a machine grant receives no review entries'
);
select is(
  (select count(*)::integer from public.time_entries),
  0,
  'Plus access without a machine grant exposes no time entries'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      'approved',
      null,
      date_trunc('month', current_date)::date
    )
  $$),
  'Machine manager access required',
  'Plus access without a machine grant cannot mutate a review'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000006',
  true
);

select is(
  auth.uid(),
  '10000000-0000-0000-0000-000000000006'::uuid,
  'the Corporate Partner JWT fixture resolves to the intended actor'
);
select ok(
  pg_temp.is_corporate_partner_for(auth.uid()),
  'the Corporate Partner fixture uses an active canonical membership'
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
  public.get_my_time_review_context(date_trunc('month', current_date)::date)->>'hasAccess',
  'false',
  'a partner membership without a machine grant does not grant review access'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(date_trunc('month', current_date)::date)->'machines'),
  0,
  'a Corporate Partner without a machine grant receives no review machines'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(date_trunc('month', current_date)::date)->'entries'),
  0,
  'a Corporate Partner without a machine grant receives no review entries'
);
select is(
  (select count(*)::integer from public.time_entries),
  0,
  'a Corporate Partner membership without a machine grant exposes no time entries'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      'approved',
      null,
      date_trunc('month', current_date)::date
    )
  $$),
  'Machine manager access required',
  'a Corporate Partner without a machine grant cannot mutate a review'
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
  public.get_my_time_review_context(date_trunc('month', current_date)::date)->>'hasAccess',
  'true',
  'an assigned Machine Manager has review access'
);
select is(
  public.get_my_time_review_context(date_trunc('month', current_date)::date)->'machines'->0->>'machineId',
  '40000000-0000-0000-0000-000000000001',
  'an assigned Machine Manager receives the exact managed machine'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(date_trunc('month', current_date)::date)->'machines'),
  1,
  'the assigned Machine Manager queue contains no extra machines'
);
select is(
  public.get_my_time_review_context(date_trunc('month', current_date)::date)->'entries'->0->>'id',
  '80000000-0000-0000-0000-000000000001',
  'an assigned Machine Manager receives the exact in-scope entry'
);
select is(
  jsonb_array_length(public.get_my_time_review_context(date_trunc('month', current_date)::date)->'entries'),
  1,
  'the assigned Machine Manager queue contains no extra entries'
);
select is(
  (select string_agg(id::text, ',' order by id) from public.time_entries),
  '80000000-0000-0000-0000-000000000001',
  'the assigned Machine Manager RLS read exposes only the in-scope entry'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000002',
      'approved',
      null,
      date_trunc('month', current_date)::date
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
      date_trunc('month', current_date)::date
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
select is(
  (
    select manager_reviewed_by
    from public.time_entries
    where id = '80000000-0000-0000-0000-000000000001'
  ),
  '10000000-0000-0000-0000-000000000003'::uuid,
  'the approved review records the assigned manager actor'
);
select ok(
  not has_table_privilege('authenticated', 'public.time_entry_review_events', 'insert'),
  'authenticated callers cannot insert review events directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.time_entry_review_events', 'update'),
  'authenticated callers cannot update review events'
);
select ok(
  not has_table_privilege('authenticated', 'public.time_entry_review_events', 'delete'),
  'authenticated callers cannot delete review events'
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
select is(
  (
    select concat(decision, ':', reviewed_by::text)
    from public.time_entry_review_events
    where time_entry_id = '80000000-0000-0000-0000-000000000001'
      and decision = 'approved'
  ),
  'approved:10000000-0000-0000-0000-000000000003',
  'the approval event records the exact decision and manager actor'
);
select is(
  (
    select concat(
      action,
      ':',
      actor_user_id::text,
      ':',
      meta->>'machine_manager_review',
      ':',
      meta->>'payment_behavior_changed'
    )
    from public.admin_audit_log
    where entity_type = 'time_entry'
      and entity_id = '80000000-0000-0000-0000-000000000001'
      and action = 'operator_time_entry.manager_approved'
  ),
  'operator_time_entry.manager_approved:10000000-0000-0000-0000-000000000003:true:false',
  'the approval audit log records actor, manager scope, and unchanged payment behavior'
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
      date_trunc('month', current_date)::date
    )
  $$),
  'A correction reason is required',
  'requesting correction requires a reason'
);
select is(
  pg_temp.capture_error($$
    select public.review_operator_time_entry(
      '80000000-0000-0000-0000-000000000001',
      'needs_correction',
      'Correct the shift end time',
      date_trunc('month', current_date)::date
    )
  $$),
  null,
  'an assigned Machine Manager can request a correction with a reason'
);
select is(
  (
    select concat(manager_review_status, ':', manager_review_reason)
    from public.time_entries
    where id = '80000000-0000-0000-0000-000000000001'
  ),
  'needs_correction:Correct the shift end time',
  'the correction state and reason are persisted'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.time_entry_review_events
    where time_entry_id = '80000000-0000-0000-0000-000000000001'
  ),
  2,
  'approval and correction each create an immutable review event'
);
select is(
  (
    select concat(decision, ':', reason, ':', reviewed_by::text)
    from public.time_entry_review_events
    where time_entry_id = '80000000-0000-0000-0000-000000000001'
      and decision = 'needs_correction'
  ),
  'needs_correction:Correct the shift end time:10000000-0000-0000-0000-000000000003',
  'the correction event records the reason and manager actor'
);
select is(
  (
    select concat(
      action,
      ':',
      actor_user_id::text,
      ':',
      meta->>'reason',
      ':',
      meta->>'machine_manager_review',
      ':',
      meta->>'payment_behavior_changed'
    )
    from public.admin_audit_log
    where entity_type = 'time_entry'
      and entity_id = '80000000-0000-0000-0000-000000000001'
      and action = 'operator_time_entry.correction_requested'
  ),
  'operator_time_entry.correction_requested:10000000-0000-0000-0000-000000000003:Correct the shift end time:true:false',
  'the correction audit row records actor, reason, manager scope, and unchanged payment behavior'
);
select is(
  (
    select concat(
      count(*)::text,
      ':',
      bool_and((meta->>'payment_behavior_changed')::boolean = false)::text,
      ':',
      count(distinct actor_user_id)::text
    )
    from public.admin_audit_log
    where entity_type = 'time_entry'
      and entity_id = '80000000-0000-0000-0000-000000000001'
      and action in (
        'operator_time_entry.manager_approved',
        'operator_time_entry.correction_requested'
      )
  ),
  '2:true:1',
  'both manager decisions are audited without changing payment behavior'
);

select * from finish();
rollback;
