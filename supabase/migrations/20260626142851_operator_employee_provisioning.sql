-- Operator employee provisioning: service-role Auth-user handoff, guided
-- machine assignment, invite evidence, and deactivation controls.

alter table public.access_invite_deliveries
  drop constraint if exists access_invite_deliveries_invite_type_check;

alter table public.access_invite_deliveries
  add constraint access_invite_deliveries_invite_type_check
    check (invite_type in ('corporate_partner', 'technician', 'machine_manager', 'operator_payout'));

alter table public.access_invite_deliveries
  drop constraint if exists access_invite_deliveries_source_type_check;

alter table public.access_invite_deliveries
  add constraint access_invite_deliveries_source_type_check
    check (source_type in (
      'corporate_partner_membership',
      'technician_grant',
      'reporting_machine',
      'operator_payout_profile'
    ));

create or replace function public.operator_payout_can_manage_machine_set(
  p_actor_user_id uuid,
  p_account_id uuid,
  p_machine_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with requested as (
    select distinct machine_id
    from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as machine_ids(machine_id)
    where machine_id is not null
  ),
  counts as (
    select
      (select count(*) from requested)::integer as requested_count,
      (
        select count(*)::integer
        from public.reporting_machines machine
        join requested on requested.machine_id = machine.id
        where machine.account_id = p_account_id
          and machine.status = 'active'
      ) as account_machine_count,
      (
        select count(*)::integer
        from public.reporting_machines machine
        join requested on requested.machine_id = machine.id
        where machine.account_id = p_account_id
          and machine.status = 'active'
          and public.can_manage_operator_payout_machine(p_actor_user_id, machine.id)
      ) as manageable_machine_count
  )
  select p_actor_user_id is not null
    and p_account_id is not null
    and exists (select 1 from requested)
    and (
      public.can_manage_operator_payout_account(p_actor_user_id, p_account_id)
      or (
        (select requested_count from counts) = (select account_machine_count from counts)
        and (select requested_count from counts) = (select manageable_machine_count from counts)
      )
    );
$$;

create or replace function public.can_send_operator_payout_invite(
  p_user_id uuid,
  p_operator_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_operator_profile_id is not null
    and exists (
      select 1
      from public.operator_payout_profiles profile
      where profile.id = p_operator_profile_id
        and profile.status = 'active'
        and (
          public.can_manage_operator_payout_account(p_user_id, profile.account_id)
          or (
            exists (
              select 1
              from public.operator_machine_assignments assignment
              where assignment.operator_profile_id = profile.id
                and assignment.status = 'active'
                and assignment.revoked_at is null
                and public.can_manage_operator_payout_machine(
                  p_user_id,
                  assignment.reporting_machine_id
                )
            )
            and not exists (
              select 1
              from public.operator_machine_assignments assignment
              where assignment.operator_profile_id = profile.id
                and assignment.status = 'active'
                and assignment.revoked_at is null
                and not public.can_manage_operator_payout_machine(
                  p_user_id,
                  assignment.reporting_machine_id
                )
            )
          )
        )
    );
$$;

create or replace function public.can_send_operator_payout_invite_current_user(
  p_operator_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_send_operator_payout_invite((select auth.uid()), p_operator_profile_id);
$$;

create or replace function public.admin_find_auth_user_by_email(
  p_email text
)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select case when users.id is null then null::jsonb else jsonb_build_object(
    'id', users.id,
    'email', users.email,
    'emailConfirmedAt', users.email_confirmed_at,
    'createdAt', users.created_at
  ) end
  from (select lower(trim(coalesce(p_email, ''))) as normalized_email) input
  left join auth.users users
    on lower(users.email) = input.normalized_email
  where input.normalized_email <> ''
  order by users.created_at asc nulls last
  limit 1;
$$;

create or replace function public.get_operator_payout_setup_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', account_scope.account_id,
          'name', account_scope.account_name,
          'canManageAccount', public.can_manage_operator_payout_account(
            actor_user_id,
            account_scope.account_id
          ),
          'machines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', machine.id,
                'label', machine.machine_label,
                'machineType', machine.machine_type,
                'locationId', machine.location_id,
                'locationName', location.name,
                'status', machine.status,
                'canManage', public.can_manage_operator_payout_machine(actor_user_id, machine.id)
              )
              order by location.name, machine.machine_label, machine.id
            )
            from public.reporting_machines machine
            join public.reporting_locations location
              on location.id = machine.location_id
            where machine.account_id = account_scope.account_id
              and machine.status = 'active'
              and (
                public.can_manage_operator_payout_account(actor_user_id, account_scope.account_id)
                or public.can_manage_operator_payout_machine(actor_user_id, machine.id)
              )
          ), '[]'::jsonb),
          'policies', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', policy.id,
                'name', policy.name,
                'frequency', policy.frequency,
                'roundingRule', policy.rounding_rule,
                'reviewModel', policy.review_model
              )
              order by policy.name, policy.id
            )
            from public.payout_policies policy
            where policy.account_id = account_scope.account_id
              and policy.active
          ), '[]'::jsonb)
        )
        order by account_scope.account_name
      )
      from (
        select distinct account.id as account_id, account.name as account_name
        from public.customer_accounts account
        where public.can_manage_operator_payout_account(actor_user_id, account.id)
          or exists (
            select 1
            from public.reporting_machines machine
            where machine.account_id = account.id
              and machine.status = 'active'
              and public.can_manage_operator_payout_machine(actor_user_id, machine.id)
          )
      ) account_scope
    ), '[]'::jsonb),
    'operators', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', profile.id,
          'accountId', profile.account_id,
          'accountName', account.name,
          'userId', profile.user_id,
          'email', users.email,
          'displayName', profile.display_name,
          'workerType', profile.worker_type,
          'status', profile.status,
          'payoutPolicyId', profile.payout_policy_id,
          'createdAt', profile.created_at,
          'updatedAt', profile.updated_at,
          'canSendInvite', public.can_send_operator_payout_invite(actor_user_id, profile.id),
          'activeAssignments', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'assignmentId', assignment.id,
                'machineId', machine.id,
                'machineLabel', machine.machine_label,
                'locationId', machine.location_id,
                'locationName', location.name,
                'effectiveStartDate', assignment.effective_start_date,
                'effectiveEndDate', assignment.effective_end_date,
                'canManage', public.can_manage_operator_payout_machine(actor_user_id, machine.id)
              )
              order by location.name, machine.machine_label, assignment.id
            )
            from public.operator_machine_assignments assignment
            join public.reporting_machines machine
              on machine.id = assignment.reporting_machine_id
            join public.reporting_locations location
              on location.id = machine.location_id
            where assignment.operator_profile_id = profile.id
              and assignment.status = 'active'
              and assignment.revoked_at is null
          ), '[]'::jsonb),
          'latestInvite', (
            select case when delivery.id is null then null::jsonb else jsonb_build_object(
              'id', delivery.id,
              'sentAt', delivery.sent_at,
              'deliveryStatus', delivery.delivery_status,
              'errorMessage', delivery.error_message
            ) end
            from public.access_invite_deliveries delivery
            where delivery.invite_type = 'operator_payout'
              and delivery.source_type = 'operator_payout_profile'
              and delivery.source_id = profile.id
            order by delivery.sent_at desc
            limit 1
          )
        )
        order by account.name, profile.display_name, profile.id
      )
      from public.operator_payout_profiles profile
      join public.customer_accounts account
        on account.id = profile.account_id
      left join auth.users users
        on users.id = profile.user_id
      where public.can_access_operator_payout_profile(actor_user_id, profile.id)
        and (
          public.can_manage_operator_payout_account(actor_user_id, profile.account_id)
          or public.can_send_operator_payout_invite(actor_user_id, profile.id)
        )
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.admin_provision_operator_payout_for_user(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_user_email text,
  p_account_id uuid,
  p_display_name text,
  p_worker_type text,
  p_payout_policy_id uuid,
  p_machine_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  normalized_display_name text;
  normalized_worker_type text;
  normalized_reason text;
  normalized_machine_ids uuid[];
  account_row public.customer_accounts;
  target_user auth.users;
  policy_row public.payout_policies;
  before_profile public.operator_payout_profiles;
  after_profile public.operator_payout_profiles;
  before_assignments jsonb;
  after_assignments jsonb;
  requested_count integer;
  account_machine_count integer;
  manageable_count integer;
begin
  normalized_email := lower(trim(coalesce(p_user_email, '')));
  normalized_display_name := trim(coalesce(p_display_name, ''));
  normalized_reason := trim(coalesce(p_reason, ''));

  if p_actor_user_id is null then
    raise exception 'Actor user is required';
  end if;

  if p_target_user_id is null then
    raise exception 'Target user is required';
  end if;

  if normalized_email = '' then
    raise exception 'Operator email is required';
  end if;

  if normalized_display_name = '' then
    normalized_display_name := normalized_email;
  end if;

  if normalized_reason = '' then
    raise exception 'Operator provisioning reason is required';
  end if;

  select coalesce(array_agg(distinct machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as machine_ids(machine_id)
  where machine_id is not null;

  if cardinality(normalized_machine_ids) = 0 then
    raise exception 'Assign at least one machine';
  end if;

  select *
  into account_row
  from public.customer_accounts account
  where account.id = p_account_id
  limit 1;

  if account_row.id is null then
    raise exception 'Account not found';
  end if;

  select *
  into target_user
  from auth.users users
  where users.id = p_target_user_id
  limit 1;

  if target_user.id is null then
    raise exception 'Target Auth user not found';
  end if;

  if lower(coalesce(target_user.email, '')) <> normalized_email then
    raise exception 'Target Auth user email does not match operator email';
  end if;

  select count(*)
  into requested_count
  from unnest(normalized_machine_ids) as requested(machine_id);

  select count(*)
  into account_machine_count
  from public.reporting_machines machine
  where machine.id = any(normalized_machine_ids)
    and machine.account_id = account_row.id
    and machine.status = 'active';

  if account_machine_count <> requested_count then
    raise exception 'Every assigned machine must be active and belong to the selected account';
  end if;

  select count(*)
  into manageable_count
  from public.reporting_machines machine
  where machine.id = any(normalized_machine_ids)
    and public.can_manage_operator_payout_machine(p_actor_user_id, machine.id);

  if not public.can_manage_operator_payout_account(p_actor_user_id, account_row.id)
    and manageable_count <> requested_count then
    raise exception 'Operator payout setup access is missing for one or more machines';
  end if;

  normalized_worker_type := lower(coalesce(nullif(trim(p_worker_type), ''), account_row.default_worker_type));

  if normalized_worker_type not in (
    'contractor_1099',
    'employee_w2',
    'part_time_employee',
    'owner_operator',
    'partner',
    'other',
    'unspecified'
  ) then
    raise exception 'Invalid worker type';
  end if;

  if p_payout_policy_id is not null then
    select *
    into policy_row
    from public.payout_policies policy
    where policy.id = p_payout_policy_id
      and policy.account_id = account_row.id
      and policy.active
    limit 1;

    if policy_row.id is null then
      raise exception 'Payout policy not found for account';
    end if;
  else
    select *
    into policy_row
    from public.payout_policies policy
    where policy.id = account_row.default_payout_policy_id
      and policy.account_id = account_row.id
      and policy.active
    limit 1;

    if policy_row.id is null then
      select *
      into policy_row
      from public.payout_policies policy
      where policy.account_id = account_row.id
        and policy.active
      order by policy.created_at asc
      limit 1;
    end if;

    if policy_row.id is null then
      begin
        insert into public.payout_policies (
          account_id,
          name,
          frequency,
          period_anchor_type,
          monthly_period_type,
          submission_due_offset_days,
          grace_period_days,
          lock_offset_days,
          target_payout_offset_days,
          rounding_rule,
          review_model,
          created_by,
          updated_by
        )
        values (
          account_row.id,
          'Monthly operator payouts',
          'monthly',
          'calendar',
          'calendar_month',
          2,
          0,
          3,
          5,
          'round_up_60_minutes',
          'final_review_only',
          p_actor_user_id,
          p_actor_user_id
        )
        returning * into policy_row;
      exception
        when unique_violation then
          select *
          into policy_row
          from public.payout_policies policy
          where policy.account_id = account_row.id
            and lower(policy.name) = lower('Monthly operator payouts')
            and policy.active
          order by policy.created_at asc
          limit 1;
      end;
    end if;

    update public.customer_accounts
    set default_payout_policy_id = policy_row.id
    where id = account_row.id
      and default_payout_policy_id is null;
  end if;

  select *
  into before_profile
  from public.operator_payout_profiles profile
  where profile.account_id = account_row.id
    and profile.user_id = p_target_user_id
  limit 1;

  if before_profile.id is not null then
    select count(*)
    into manageable_count
    from public.operator_machine_assignments assignment
    where assignment.operator_profile_id = before_profile.id
      and assignment.status = 'active'
      and assignment.revoked_at is null
      and public.can_manage_operator_payout_machine(p_actor_user_id, assignment.reporting_machine_id);

    select count(*)
    into account_machine_count
    from public.operator_machine_assignments assignment
    where assignment.operator_profile_id = before_profile.id
      and assignment.status = 'active'
      and assignment.revoked_at is null;

    if manageable_count <> account_machine_count
      and not public.can_manage_operator_payout_account(p_actor_user_id, account_row.id) then
      raise exception 'Existing out-of-scope assignments must be changed by a broader admin';
    end if;
  end if;

  insert into public.operator_payout_profiles (
    account_id,
    user_id,
    display_name,
    worker_type,
    status,
    payout_policy_id,
    created_by,
    updated_by
  )
  values (
    account_row.id,
    p_target_user_id,
    normalized_display_name,
    normalized_worker_type,
    'active',
    policy_row.id,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (account_id, user_id)
  do update set
    display_name = excluded.display_name,
    worker_type = excluded.worker_type,
    status = 'active',
    payout_policy_id = excluded.payout_policy_id,
    updated_by = p_actor_user_id
  returning * into after_profile;

  select coalesce(jsonb_agg(to_jsonb(assignment) order by assignment.created_at), '[]'::jsonb)
  into before_assignments
  from public.operator_machine_assignments assignment
  where assignment.operator_profile_id = after_profile.id
    and assignment.status = 'active'
    and assignment.revoked_at is null;

  update public.operator_machine_assignments assignment
  set
    status = 'revoked',
    effective_end_date = current_date,
    revoked_at = now(),
    revoked_by = p_actor_user_id,
    revoke_reason = normalized_reason
  where assignment.operator_profile_id = after_profile.id
    and assignment.status = 'active'
    and assignment.revoked_at is null
    and not (assignment.reporting_machine_id = any(normalized_machine_ids));

  insert into public.operator_machine_assignments (
    operator_profile_id,
    account_id,
    reporting_machine_id,
    effective_start_date,
    status,
    grant_reason,
    created_by
  )
  select
    after_profile.id,
    account_row.id,
    machine_id,
    current_date,
    'active',
    normalized_reason,
    p_actor_user_id
  from unnest(normalized_machine_ids) as requested(machine_id)
  where not exists (
    select 1
    from public.operator_machine_assignments assignment
    where assignment.operator_profile_id = after_profile.id
      and assignment.reporting_machine_id = requested.machine_id
      and assignment.status = 'active'
      and assignment.revoked_at is null
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'assignmentId', assignment.id,
        'machineId', assignment.reporting_machine_id,
        'machineLabel', machine.machine_label,
        'locationId', machine.location_id,
        'locationName', location.name,
        'effectiveStartDate', assignment.effective_start_date,
        'effectiveEndDate', assignment.effective_end_date
      )
      order by location.name, machine.machine_label, assignment.id
    ),
    '[]'::jsonb
  )
  into after_assignments
  from public.operator_machine_assignments assignment
  join public.reporting_machines machine
    on machine.id = assignment.reporting_machine_id
  join public.reporting_locations location
    on location.id = machine.location_id
  where assignment.operator_profile_id = after_profile.id
    and assignment.status = 'active'
    and assignment.revoked_at is null;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    p_actor_user_id,
    'operator_employee_access.provisioned',
    'operator_payout_profile',
    after_profile.id::text,
    p_target_user_id,
    jsonb_build_object(
      'profile', coalesce(to_jsonb(before_profile), '{}'::jsonb),
      'assignments', before_assignments
    ),
    jsonb_build_object(
      'profile', to_jsonb(after_profile),
      'assignments', after_assignments
    ),
    jsonb_build_object(
      'account_id', account_row.id,
      'email', normalized_email,
      'reason', normalized_reason,
      'requested_machine_count', cardinality(normalized_machine_ids),
      'tax_compliance_engine', false,
      'payroll_provider_execution', false
    )
  );

  return jsonb_build_object(
    'operatorProfile', jsonb_build_object(
      'id', after_profile.id,
      'accountId', after_profile.account_id,
      'accountName', account_row.name,
      'userId', after_profile.user_id,
      'email', normalized_email,
      'displayName', after_profile.display_name,
      'workerType', after_profile.worker_type,
      'status', after_profile.status,
      'payoutPolicyId', after_profile.payout_policy_id
    ),
    'assignments', after_assignments,
    'activeAssignmentCount', jsonb_array_length(after_assignments)
  );
end;
$$;

create or replace function public.admin_deactivate_operator_payout_profile_for_user(
  p_actor_user_id uuid,
  p_operator_profile_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_reason text;
  before_profile public.operator_payout_profiles;
  after_profile public.operator_payout_profiles;
  before_assignments jsonb;
  after_assignments jsonb;
  manageable_count integer;
  assignment_count integer;
begin
  normalized_reason := trim(coalesce(p_reason, ''));

  if p_actor_user_id is null then
    raise exception 'Actor user is required';
  end if;

  if p_operator_profile_id is null then
    raise exception 'Operator profile is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Operator deactivation reason is required';
  end if;

  select *
  into before_profile
  from public.operator_payout_profiles profile
  where profile.id = p_operator_profile_id
  limit 1;

  if before_profile.id is null then
    raise exception 'Operator payout profile not found';
  end if;

  select count(*)
  into manageable_count
  from public.operator_machine_assignments assignment
  where assignment.operator_profile_id = before_profile.id
    and assignment.status = 'active'
    and assignment.revoked_at is null
    and public.can_manage_operator_payout_machine(p_actor_user_id, assignment.reporting_machine_id);

  select count(*)
  into assignment_count
  from public.operator_machine_assignments assignment
  where assignment.operator_profile_id = before_profile.id
    and assignment.status = 'active'
    and assignment.revoked_at is null;

  if not public.can_manage_operator_payout_account(p_actor_user_id, before_profile.account_id)
    and manageable_count <> assignment_count then
    raise exception 'Existing out-of-scope assignments must be changed by a broader admin';
  end if;

  if assignment_count = 0
    and not public.can_manage_operator_payout_account(p_actor_user_id, before_profile.account_id) then
    raise exception 'Operator payout setup access required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(assignment) order by assignment.created_at), '[]'::jsonb)
  into before_assignments
  from public.operator_machine_assignments assignment
  where assignment.operator_profile_id = before_profile.id
    and assignment.status = 'active'
    and assignment.revoked_at is null;

  update public.operator_payout_profiles
  set
    status = 'inactive',
    updated_by = p_actor_user_id
  where id = before_profile.id
  returning * into after_profile;

  update public.operator_machine_assignments assignment
  set
    status = 'revoked',
    effective_end_date = current_date,
    revoked_at = now(),
    revoked_by = p_actor_user_id,
    revoke_reason = normalized_reason
  where assignment.operator_profile_id = before_profile.id
    and assignment.status = 'active'
    and assignment.revoked_at is null;

  select coalesce(jsonb_agg(to_jsonb(assignment) order by assignment.created_at), '[]'::jsonb)
  into after_assignments
  from public.operator_machine_assignments assignment
  where assignment.operator_profile_id = before_profile.id
    and assignment.status = 'active'
    and assignment.revoked_at is null;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    p_actor_user_id,
    'operator_employee_access.deactivated',
    'operator_payout_profile',
    before_profile.id::text,
    before_profile.user_id,
    jsonb_build_object(
      'profile', to_jsonb(before_profile),
      'assignments', before_assignments
    ),
    jsonb_build_object(
      'profile', to_jsonb(after_profile),
      'assignments', after_assignments
    ),
    jsonb_build_object(
      'account_id', before_profile.account_id,
      'reason', normalized_reason
    )
  );

  return jsonb_build_object(
    'operatorProfileId', after_profile.id,
    'status', after_profile.status,
    'activeAssignmentCount', 0
  );
end;
$$;

drop policy if exists "access_invite_deliveries_select_operator_payout_managers"
  on public.access_invite_deliveries;
create policy "access_invite_deliveries_select_operator_payout_managers"
on public.access_invite_deliveries
for select
to authenticated
using (
  invite_type = 'operator_payout'
  and source_type = 'operator_payout_profile'
  and public.can_send_operator_payout_invite_current_user(source_id)
);

comment on column public.access_invite_deliveries.invite_type is
  'User-facing invite preset. Supports Corporate Partner, Technician, Machine Manager, and Operator Payout signup emails.';

comment on column public.access_invite_deliveries.source_type is
  'Source behind the invite: corporate_partner_membership, technician_grant, reporting_machine, or operator_payout_profile.';

comment on function public.operator_payout_can_manage_machine_set(uuid, uuid, uuid[]) is
  'Internal helper for validating operator provisioning machine scopes without exposing arbitrary user-id checks to browser callers.';

comment on function public.can_send_operator_payout_invite(uuid, uuid) is
  'Returns true when the actor may send or view invite evidence for an active operator payout profile they manage.';

comment on function public.can_send_operator_payout_invite_current_user(uuid) is
  'Current-user wrapper for operator payout invite evidence RLS.';

comment on function public.admin_find_auth_user_by_email(text) is
  'Service-role-only helper for operator provisioning Edge Functions to resolve an Auth user without exposing auth.users to browsers.';

comment on function public.get_operator_payout_setup_context() is
  'Admin/scoped-manager setup context for provisioning operator payout profiles and assigned machines.';

comment on function public.admin_provision_operator_payout_for_user(uuid, uuid, text, uuid, text, text, uuid, uuid[], text) is
  'Service-role-only helper that provisions an operator payout profile for an already resolved Auth user with audited machine assignments.';

comment on function public.admin_deactivate_operator_payout_profile_for_user(uuid, uuid, text) is
  'Service-role-only helper that deactivates an operator payout profile and revokes active assignments with audit history.';

revoke execute on function public.operator_payout_can_manage_machine_set(uuid, uuid, uuid[])
  from public, anon, authenticated;
revoke execute on function public.can_send_operator_payout_invite(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.can_send_operator_payout_invite_current_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_find_auth_user_by_email(text)
  from public, anon, authenticated;
revoke execute on function public.get_operator_payout_setup_context()
  from public, anon;
revoke execute on function public.admin_provision_operator_payout_for_user(uuid, uuid, text, uuid, text, text, uuid, uuid[], text)
  from public, anon, authenticated;
revoke execute on function public.admin_deactivate_operator_payout_profile_for_user(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.operator_payout_can_manage_machine_set(uuid, uuid, uuid[])
  to service_role;
grant execute on function public.can_send_operator_payout_invite(uuid, uuid)
  to service_role;
grant execute on function public.can_send_operator_payout_invite_current_user(uuid)
  to authenticated;
grant execute on function public.admin_find_auth_user_by_email(text)
  to service_role;
grant execute on function public.get_operator_payout_setup_context()
  to authenticated;
grant execute on function public.admin_provision_operator_payout_for_user(uuid, uuid, text, uuid, text, text, uuid, uuid[], text)
  to service_role;
grant execute on function public.admin_deactivate_operator_payout_profile_for_user(uuid, uuid, text)
  to service_role;

select pg_notify('pgrst', 'reload schema');
