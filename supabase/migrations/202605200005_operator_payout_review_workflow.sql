-- Operator payout review workflow: scoped manager review, blocker-aware
-- finalization, reopen/void controls, and immutable review snapshots.

create table if not exists public.payout_run_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  payout_run_id uuid not null references public.payout_runs (id) on delete cascade,
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  payout_period_id uuid not null references public.payout_periods (id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  action text not null
    check (action in ('marked_reviewed', 'finalized', 'reopened', 'voided')),
  previous_status text not null,
  revision_reason text not null,
  run_snapshot jsonb not null default '{}'::jsonb,
  item_snapshots jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payout_run_review_snapshots_reason_present check (
    length(trim(revision_reason)) > 0
  )
);

create unique index if not exists payout_run_review_snapshots_run_revision_idx
  on public.payout_run_review_snapshots (payout_run_id, revision_number);

create index if not exists payout_run_review_snapshots_account_idx
  on public.payout_run_review_snapshots (account_id, created_at desc);

alter table public.payout_run_review_snapshots enable row level security;

drop policy if exists "payout_run_review_snapshots_select_accessible"
  on public.payout_run_review_snapshots;
create policy "payout_run_review_snapshots_select_accessible"
on public.payout_run_review_snapshots
for select
using (public.can_access_payout_run_current_user(payout_run_id));

create or replace function public.operator_can_finalize_payout_run(
  p_user_id uuid,
  p_payout_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_payout_run_id is not null
    and exists (
      select 1
      from public.payout_runs run
      where run.id = p_payout_run_id
        and (
          public.can_manage_operator_payout_account(p_user_id, run.account_id)
          or (
            exists (
              select 1
              from public.payout_run_items item
              join public.payout_run_item_machines item_machine
                on item_machine.payout_run_item_id = item.id
              where item.payout_run_id = run.id
                and item.status <> 'voided'
                and public.can_manage_operator_payout_machine(
                  p_user_id,
                  item_machine.reporting_machine_id
                )
            )
            and not exists (
              select 1
              from public.payout_run_items item
              join public.payout_run_item_machines item_machine
                on item_machine.payout_run_item_id = item.id
              where item.payout_run_id = run.id
                and item.status <> 'voided'
                and not public.can_manage_operator_payout_machine(
                  p_user_id,
                  item_machine.reporting_machine_id
                )
            )
          )
        )
    );
$$;

create or replace function public.operator_capture_payout_run_review_snapshot(
  p_payout_run_id uuid,
  p_created_by uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_action text;
  normalized_reason text;
  run_row public.payout_runs;
  next_revision_number integer;
  item_snapshots jsonb;
  snapshot_row public.payout_run_review_snapshots;
begin
  normalized_action := lower(trim(coalesce(p_action, '')));
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_action not in ('marked_reviewed', 'finalized', 'reopened', 'voided') then
    raise exception 'Unsupported payout review snapshot action';
  end if;

  if normalized_reason = '' then
    raise exception 'Payout review snapshot reason is required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  limit 1;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  select coalesce(max(snapshot.revision_number), 0) + 1
  into next_revision_number
  from public.payout_run_review_snapshots snapshot
  where snapshot.payout_run_id = run_row.id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item', to_jsonb(item),
      'machines', coalesce((
        select jsonb_agg(to_jsonb(item_machine) order by item_machine.created_at)
        from public.payout_run_item_machines item_machine
        where item_machine.payout_run_item_id = item.id
      ), '[]'::jsonb),
      'adjustments', coalesce((
        select jsonb_agg(to_jsonb(adjustment) order by adjustment.created_at)
        from public.payout_adjustments adjustment
        where adjustment.payout_run_id = run_row.id
          and adjustment.operator_profile_id = item.operator_profile_id
      ), '[]'::jsonb)
    )
    order by item.created_at, item.id
  ), '[]'::jsonb)
  into item_snapshots
  from public.payout_run_items item
  where item.payout_run_id = run_row.id;

  insert into public.payout_run_review_snapshots (
    payout_run_id,
    account_id,
    payout_period_id,
    revision_number,
    action,
    previous_status,
    revision_reason,
    run_snapshot,
    item_snapshots,
    created_by
  )
  values (
    run_row.id,
    run_row.account_id,
    run_row.payout_period_id,
    next_revision_number,
    normalized_action,
    run_row.status,
    normalized_reason,
    to_jsonb(run_row),
    item_snapshots,
    p_created_by
  )
  returning * into snapshot_row;

  return jsonb_build_object(
    'id', snapshot_row.id,
    'payoutRunId', snapshot_row.payout_run_id,
    'revisionNumber', snapshot_row.revision_number,
    'action', snapshot_row.action,
    'previousStatus', snapshot_row.previous_status,
    'revisionReason', snapshot_row.revision_reason,
    'createdAt', snapshot_row.created_at
  );
end;
$$;

create or replace function public.can_access_admin_surface(
  uid uuid,
  surface text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_super_admin(uid)
    or (
      public.is_scoped_admin(uid)
      and lower(coalesce(nullif(trim(surface), ''), 'access')) in (
        'access',
        'reporting_access',
        'payouts'
      )
    )
    or (
      lower(coalesce(nullif(trim(surface), ''), 'access')) = 'payouts'
      and (
        exists (
          select 1
          from public.customer_accounts account
          where public.can_manage_operator_payout_account(uid, account.id)
        )
        or exists (
          select 1
          from public.reporting_machines machine
          where public.can_manage_operator_payout_machine(uid, machine.id)
        )
      )
    );
$$;

create or replace function public.get_my_admin_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  actor_is_scoped_admin boolean;
  actor_is_refund_manager boolean;
  actor_can_manage_payouts boolean;
  allowed_surfaces text[];
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    return jsonb_build_object(
      'isSuperAdmin', false,
      'isScopedAdmin', false,
      'canAccessAdmin', false,
      'allowedSurfaces', '[]'::jsonb,
      'scopedMachineIds', '[]'::jsonb
    );
  end if;

  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);
  actor_is_scoped_admin := coalesce(array_length(actor_machine_ids, 1), 0) > 0;
  actor_is_refund_manager := public.user_is_refund_manager(actor_user_id);
  actor_can_manage_payouts := exists (
    select 1
    from public.customer_accounts account
    where public.can_manage_operator_payout_account(actor_user_id, account.id)
  ) or exists (
    select 1
    from public.reporting_machines machine
    where public.can_manage_operator_payout_machine(actor_user_id, machine.id)
  );

  if actor_is_super_admin then
    allowed_surfaces := array['*'];
  else
    allowed_surfaces := '{}'::text[];

    if actor_is_scoped_admin then
      allowed_surfaces := allowed_surfaces || array['access', 'reporting_access', 'refunds'];
    end if;

    if actor_is_refund_manager then
      allowed_surfaces := allowed_surfaces || array['refunds'];
    end if;

    if actor_can_manage_payouts then
      allowed_surfaces := allowed_surfaces || array['payouts'];
    end if;
  end if;

  return jsonb_build_object(
    'isSuperAdmin', actor_is_super_admin,
    'isScopedAdmin', actor_is_scoped_admin,
    'canAccessAdmin',
      actor_is_super_admin
      or actor_is_scoped_admin
      or actor_is_refund_manager
      or actor_can_manage_payouts,
    'allowedSurfaces', to_jsonb(array(
      select distinct surface
      from unnest(allowed_surfaces) as surface
    )),
    'scopedMachineIds', to_jsonb(actor_machine_ids)
  );
end;
$$;

create or replace function public.operator_payout_calculation_payload(
  p_payout_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_can_manage_account boolean;
  actor_can_finalize_run boolean;
  run_row public.payout_runs;
  visible_totals record;
  visible_item_filter text;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  limit 1;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  if not public.can_access_payout_run(actor_user_id, run_row.id) then
    raise exception 'Payout run access required';
  end if;

  actor_can_manage_account :=
    public.can_manage_operator_payout_account(actor_user_id, run_row.account_id);
  actor_can_finalize_run :=
    public.operator_can_finalize_payout_run(actor_user_id, run_row.id);
  visible_item_filter := 'scoped_items_only';

  select
    coalesce(sum(item.raw_minutes), 0)::integer as total_raw_minutes,
    coalesce(sum(item.rounded_paid_minutes), 0)::integer as total_rounded_paid_minutes,
    coalesce(sum(item.hourly_pay_cents), 0)::integer as total_hourly_pay_cents,
    coalesce(sum(item.commission_pay_cents), 0)::integer as total_commission_pay_cents,
    coalesce(sum(item.adjustments_total_cents), 0)::integer as total_adjustments_cents,
    coalesce(sum(item.total_payout_cents), 0)::integer as total_payout_cents
  into visible_totals
  from public.payout_run_items item
  where item.payout_run_id = run_row.id
    and item.status <> 'voided'
    and (
      actor_can_manage_account
      or actor_can_finalize_run
      or not exists (
        select 1
        from public.payout_run_item_machines item_machine
        where item_machine.payout_run_item_id = item.id
          and not public.can_manage_operator_payout_machine(
            actor_user_id,
            item_machine.reporting_machine_id
          )
      )
    );

  select jsonb_build_object(
    'id', run_row.id,
    'accountId', run_row.account_id,
    'payoutPeriodId', run_row.payout_period_id,
    'status', run_row.status,
    'totalRawMinutes', visible_totals.total_raw_minutes,
    'totalRoundedPaidMinutes', visible_totals.total_rounded_paid_minutes,
    'totalHourlyPayCents', visible_totals.total_hourly_pay_cents,
    'totalCommissionPayCents', visible_totals.total_commission_pay_cents,
    'totalAdjustmentsCents', visible_totals.total_adjustments_cents,
    'totalPayoutCents', visible_totals.total_payout_cents,
    'warnings', case
      when actor_can_manage_account or actor_can_finalize_run then run_row.warnings
      else '[]'::jsonb
    end,
    'notes', run_row.notes,
    'createdAt', run_row.created_at,
    'updatedAt', run_row.updated_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'operatorProfileId', item.operator_profile_id,
          'operatorDisplayName', profile.display_name,
          'workerType', item.worker_type,
          'rawMinutes', item.raw_minutes,
          'roundedPaidMinutes', item.rounded_paid_minutes,
          'shiftCount', item.shift_count,
          'hourlyRateCents', item.hourly_rate_cents,
          'hourlyPayCents', item.hourly_pay_cents,
          'eligibleNetRevenueCents', item.eligible_net_revenue_cents,
          'commissionBasisPoints', item.commission_basis_points,
          'commissionPayCents', item.commission_pay_cents,
          'adjustmentsTotalCents', item.adjustments_total_cents,
          'totalPayoutCents', item.total_payout_cents,
          'status', item.status,
          'warnings', item.warnings,
          'calculationNotes', item.calculation_notes || jsonb_build_object(
            'visibilityFilter', visible_item_filter
          ),
          'machines', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', item_machine.id,
                'machineId', item_machine.reporting_machine_id,
                'machineLabel', machine.machine_label,
                'locationId', item_machine.reporting_location_id,
                'locationName', location.name,
                'netRevenueCents', item_machine.net_revenue_cents,
                'eligibleNetRevenueCents', item_machine.eligible_net_revenue_cents,
                'commissionBasisPoints', item_machine.commission_basis_points,
                'commissionPayCents', item_machine.commission_pay_cents,
                'shiftCount', item_machine.shift_count,
                'rawMinutes', item_machine.raw_minutes,
                'roundedPaidMinutes', item_machine.rounded_paid_minutes,
                'includedInCommissionBasis', item_machine.included_in_commission_basis,
                'inclusionReason', item_machine.inclusion_reason
              )
              order by location.name, machine.machine_label
            )
            from public.payout_run_item_machines item_machine
            join public.reporting_machines machine
              on machine.id = item_machine.reporting_machine_id
            join public.reporting_locations location
              on location.id = item_machine.reporting_location_id
            where item_machine.payout_run_item_id = item.id
              and (
                actor_can_manage_account
                or actor_can_finalize_run
                or public.can_manage_operator_payout_machine(
                  actor_user_id,
                  item_machine.reporting_machine_id
                )
              )
          ), '[]'::jsonb),
          'adjustments', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', adjustment.id,
                'amountCents', adjustment.amount_cents,
                'adjustmentType', adjustment.adjustment_type,
                'description', adjustment.description,
                'visibleToOperator', adjustment.visible_to_operator,
                'createdAt', adjustment.created_at
              )
              order by adjustment.created_at
            )
            from public.payout_adjustments adjustment
            where adjustment.payout_run_id = run_row.id
              and adjustment.operator_profile_id = item.operator_profile_id
              and (
                adjustment.visible_to_operator
                or actor_can_manage_account
                or actor_can_finalize_run
              )
          ), '[]'::jsonb)
        )
        order by profile.display_name, item.created_at
      )
      from public.payout_run_items item
      join public.operator_payout_profiles profile
        on profile.id = item.operator_profile_id
      where item.payout_run_id = run_row.id
        and item.status <> 'voided'
        and (
          actor_can_manage_account
          or actor_can_finalize_run
          or not exists (
            select 1
            from public.payout_run_item_machines item_machine
            where item_machine.payout_run_item_id = item.id
              and not public.can_manage_operator_payout_machine(
                actor_user_id,
                item_machine.reporting_machine_id
              )
          )
        )
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.get_payout_review_context()
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
          'id', account.id,
          'name', account.name
        )
        order by account.name
      )
      from public.customer_accounts account
      where public.can_manage_operator_payout_account(actor_user_id, account.id)
        or exists (
          select 1
          from public.payout_runs run
          where run.account_id = account.id
            and public.can_access_payout_run(actor_user_id, run.id)
        )
    ), '[]'::jsonb),
    'periods', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', period.id,
          'accountId', period.account_id,
          'accountName', account.name,
          'periodStartDate', period.period_start_date,
          'periodEndDate', period.period_end_date,
          'submissionDueDate', period.submission_due_date,
          'lockDate', period.lock_date,
          'targetPayoutDate', period.target_payout_date,
          'status', period.status,
          'payoutRun', case
            when latest_run.id is null then null::jsonb
            else public.operator_payout_calculation_payload(latest_run.id)
          end,
          'canReview', latest_run.id is not null
            and public.can_access_payout_run(actor_user_id, latest_run.id),
          'canFinalize', latest_run.id is not null
            and public.operator_can_finalize_payout_run(actor_user_id, latest_run.id),
          'hasBlockers', latest_run.id is not null and (
            exists (
              select 1
              from jsonb_array_elements(coalesce(latest_run.warnings, '[]'::jsonb)) warning
              where warning ->> 'severity' = 'blocker'
            )
            or exists (
              select 1
              from public.payout_run_items item
              cross join lateral jsonb_array_elements(coalesce(item.warnings, '[]'::jsonb)) warning
              where item.payout_run_id = latest_run.id
                and item.status <> 'voided'
                and warning ->> 'severity' = 'blocker'
            )
          ),
          'issuedStatementCount', coalesce((
            select count(*)::integer
            from public.pay_statements statement
            where statement.payout_run_id = latest_run.id
              and statement.status in ('issued', 'revised')
          ), 0),
          'revisionCount', coalesce((
            select count(*)::integer
            from public.payout_run_review_snapshots snapshot
            where snapshot.payout_run_id = latest_run.id
          ), 0)
        )
        order by period.period_start_date desc, period.period_end_date desc
      )
      from public.payout_periods period
      join public.customer_accounts account on account.id = period.account_id
      left join lateral (
        select run.*
        from public.payout_runs run
        where run.payout_period_id = period.id
          and run.status <> 'voided'
        order by run.created_at desc
        limit 1
      ) latest_run on true
      where public.can_manage_operator_payout_account(actor_user_id, period.account_id)
        or (
          latest_run.id is not null
          and public.can_access_payout_run(actor_user_id, latest_run.id)
        )
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

create or replace function public.admin_mark_payout_run_reviewed(
  p_payout_run_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  run_row public.payout_runs;
  before_row public.payout_runs;
  snapshot_payload jsonb;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_reason = '' then
    raise exception 'Payout review reason is required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  limit 1;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  if run_row.status not in ('draft', 'review', 'reopened') then
    raise exception 'Only draft, review, or reopened payout runs can be marked reviewed';
  end if;

  if not public.operator_can_finalize_payout_run(actor_user_id, run_row.id) then
    raise exception 'Payout review access required';
  end if;

  before_row := run_row;
  snapshot_payload := public.operator_capture_payout_run_review_snapshot(
    run_row.id,
    actor_user_id,
    'marked_reviewed',
    normalized_reason
  );

  update public.payout_runs
  set
    status = 'review',
    notes = coalesce(notes, 'Manager review started.')
  where id = run_row.id
  returning * into run_row;

  update public.payout_run_items
  set status = 'reviewed'
  where payout_run_id = run_row.id
    and status in ('draft', 'reviewed');

  update public.payout_periods
  set
    status = 'review',
    updated_by = actor_user_id
  where id = run_row.payout_period_id
    and status in ('open', 'grace_period', 'locked', 'draft_payout', 'review', 'reopened');

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'operator_payout_run.marked_reviewed',
    'payout_run',
    run_row.id::text,
    to_jsonb(before_row),
    to_jsonb(run_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'reviewSnapshot', snapshot_payload,
      'account_id', run_row.account_id
    )
  );

  return jsonb_build_object(
    'payoutRun', public.operator_payout_calculation_payload(run_row.id),
    'reviewSnapshot', snapshot_payload
  );
end;
$$;

create or replace function public.admin_finalize_payout_run(
  p_payout_run_id uuid,
  p_reason text,
  p_override_blockers boolean default false,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  normalized_override_reason text;
  run_row public.payout_runs;
  before_row public.payout_runs;
  has_blockers boolean;
  issued_statement_count integer;
  item_count integer;
  snapshot_payload jsonb;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));
  normalized_override_reason := trim(coalesce(p_override_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_reason = '' then
    raise exception 'Payout finalization reason is required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  limit 1;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  if run_row.status not in ('draft', 'review', 'reopened') then
    raise exception 'Only draft, review, or reopened payout runs can be finalized';
  end if;

  if not public.operator_can_finalize_payout_run(actor_user_id, run_row.id) then
    raise exception 'Payout finalization access required';
  end if;

  select count(*)::integer
  into item_count
  from public.payout_run_items item
  where item.payout_run_id = run_row.id
    and item.status <> 'voided';

  if item_count = 0 then
    raise exception 'Payout run has no payable operators';
  end if;

  select count(*)::integer
  into issued_statement_count
  from public.pay_statements statement
  where statement.payout_run_id = run_row.id
    and statement.status in ('issued', 'revised');

  if issued_statement_count > 0 then
    raise exception 'Finalization blocked because issued pay statements already exist for this payout run';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(run_row.warnings, '[]'::jsonb)) warning
    where warning ->> 'severity' = 'blocker'
  ) or exists (
    select 1
    from public.payout_run_items item
    cross join lateral jsonb_array_elements(coalesce(item.warnings, '[]'::jsonb)) warning
    where item.payout_run_id = run_row.id
      and item.status <> 'voided'
      and warning ->> 'severity' = 'blocker'
  )
  into has_blockers;

  if has_blockers and not coalesce(p_override_blockers, false) then
    raise exception 'Critical payout warnings must be resolved or explicitly overridden before finalization';
  end if;

  if has_blockers and normalized_override_reason = '' then
    raise exception 'Override reason is required when finalizing with critical warnings';
  end if;

  before_row := run_row;
  snapshot_payload := public.operator_capture_payout_run_review_snapshot(
    run_row.id,
    actor_user_id,
    'finalized',
    normalized_reason
  );

  update public.payout_runs
  set
    status = 'finalized',
    finalized_by = actor_user_id,
    finalized_at = now(),
    notes = coalesce(notes, 'Finalized after manager review.')
  where id = run_row.id
  returning * into run_row;

  update public.payout_run_items
  set status = 'finalized'
  where payout_run_id = run_row.id
    and status in ('draft', 'reviewed', 'finalized');

  update public.time_entries entry
  set
    status = 'included_in_payout',
    locked_at = coalesce(entry.locked_at, now()),
    locked_by = coalesce(entry.locked_by, actor_user_id),
    updated_by = actor_user_id
  where entry.payout_period_id = run_row.payout_period_id
    and entry.status in ('submitted', 'locked')
    and exists (
      select 1
      from public.payout_run_items item
      join public.payout_run_item_machines item_machine
        on item_machine.payout_run_item_id = item.id
      where item.payout_run_id = run_row.id
        and item.operator_profile_id = entry.operator_profile_id
        and item_machine.reporting_machine_id = entry.reporting_machine_id
    );

  update public.payout_periods
  set
    status = 'finalized',
    locked_at = coalesce(locked_at, now()),
    locked_by = coalesce(locked_by, actor_user_id),
    updated_by = actor_user_id
  where id = run_row.payout_period_id;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'operator_payout_run.finalized',
    'payout_run',
    run_row.id::text,
    to_jsonb(before_row),
    to_jsonb(run_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'override_blockers', coalesce(p_override_blockers, false),
      'override_reason', nullif(normalized_override_reason, ''),
      'reviewSnapshot', snapshot_payload,
      'issued_statement_duplicate_guard', true,
      'payroll_provider_execution', false,
      'account_id', run_row.account_id
    )
  );

  return jsonb_build_object(
    'payoutRun', public.operator_payout_calculation_payload(run_row.id),
    'reviewSnapshot', snapshot_payload,
    'finalized', true,
    'overrideBlockers', coalesce(p_override_blockers, false)
  );
end;
$$;

create or replace function public.admin_reopen_payout_run(
  p_payout_run_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  run_row public.payout_runs;
  before_row public.payout_runs;
  issued_statement_count integer;
  snapshot_payload jsonb;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_reason = '' then
    raise exception 'Payout reopen reason is required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  limit 1;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  if run_row.status not in ('review', 'finalized', 'reopened') then
    raise exception 'Only reviewed, finalized, or reopened payout runs can be reopened';
  end if;

  if not public.operator_can_finalize_payout_run(actor_user_id, run_row.id) then
    raise exception 'Payout reopen access required';
  end if;

  select count(*)::integer
  into issued_statement_count
  from public.pay_statements statement
  where statement.payout_run_id = run_row.id
    and statement.status in ('issued', 'revised');

  if issued_statement_count > 0 then
    raise exception 'Issued pay statements require a statement revision flow instead of reopening the payout run';
  end if;

  before_row := run_row;
  snapshot_payload := public.operator_capture_payout_run_review_snapshot(
    run_row.id,
    actor_user_id,
    'reopened',
    normalized_reason
  );

  update public.payout_runs
  set
    status = 'reopened',
    reopened_at = now(),
    reopened_by = actor_user_id,
    reopen_reason = normalized_reason,
    finalized_at = null,
    finalized_by = null
  where id = run_row.id
  returning * into run_row;

  update public.payout_run_items
  set status = 'draft'
  where payout_run_id = run_row.id
    and status in ('reviewed', 'finalized');

  update public.time_entries entry
  set
    status = 'locked',
    updated_by = actor_user_id
  where entry.payout_period_id = run_row.payout_period_id
    and entry.status = 'included_in_payout';

  update public.payout_periods
  set
    status = 'reopened',
    reopened_at = now(),
    reopened_by = actor_user_id,
    reopen_reason = normalized_reason,
    updated_by = actor_user_id
  where id = run_row.payout_period_id;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'operator_payout_run.reopened',
    'payout_run',
    run_row.id::text,
    to_jsonb(before_row),
    to_jsonb(run_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'reviewSnapshot', snapshot_payload,
      'issued_statement_guard', true,
      'account_id', run_row.account_id
    )
  );

  return jsonb_build_object(
    'payoutRun', public.operator_payout_calculation_payload(run_row.id),
    'reviewSnapshot', snapshot_payload,
    'reopened', true
  );
end;
$$;

create or replace function public.admin_void_payout_run(
  p_payout_run_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  run_row public.payout_runs;
  before_row public.payout_runs;
  issued_statement_count integer;
  snapshot_payload jsonb;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_reason = '' then
    raise exception 'Payout void reason is required';
  end if;

  select *
  into run_row
  from public.payout_runs run
  where run.id = p_payout_run_id
  limit 1;

  if run_row.id is null then
    raise exception 'Payout run not found';
  end if;

  if run_row.status in ('issued', 'closed', 'voided') then
    raise exception 'Issued, closed, or already voided payout runs cannot be voided here';
  end if;

  if not public.operator_can_finalize_payout_run(actor_user_id, run_row.id) then
    raise exception 'Payout void access required';
  end if;

  select count(*)::integer
  into issued_statement_count
  from public.pay_statements statement
  where statement.payout_run_id = run_row.id
    and statement.status in ('issued', 'revised');

  if issued_statement_count > 0 then
    raise exception 'Issued pay statements require a statement revision or void flow first';
  end if;

  before_row := run_row;
  snapshot_payload := public.operator_capture_payout_run_review_snapshot(
    run_row.id,
    actor_user_id,
    'voided',
    normalized_reason
  );

  update public.payout_runs
  set
    status = 'voided',
    reopened_at = now(),
    reopened_by = actor_user_id,
    reopen_reason = normalized_reason
  where id = run_row.id
  returning * into run_row;

  update public.payout_run_items
  set status = 'voided'
  where payout_run_id = run_row.id;

  update public.time_entries entry
  set
    status = 'locked',
    updated_by = actor_user_id
  where entry.payout_period_id = run_row.payout_period_id
    and entry.status = 'included_in_payout';

  update public.payout_periods
  set
    status = 'reopened',
    reopened_at = now(),
    reopened_by = actor_user_id,
    reopen_reason = normalized_reason,
    updated_by = actor_user_id
  where id = run_row.payout_period_id
    and status <> 'voided';

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'operator_payout_run.voided',
    'payout_run',
    run_row.id::text,
    to_jsonb(before_row),
    to_jsonb(run_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'reviewSnapshot', snapshot_payload,
      'issued_statement_guard', true,
      'account_id', run_row.account_id
    )
  );

  return jsonb_build_object(
    'payoutRun', public.operator_payout_calculation_payload(run_row.id),
    'reviewSnapshot', snapshot_payload,
    'voided', true
  );
end;
$$;

comment on table public.payout_run_review_snapshots is
  'Immutable manager review snapshots preserving payout run versions before review, finalization, reopen, and void actions.';
comment on function public.operator_can_finalize_payout_run(uuid, uuid) is
  'Service-only helper that confirms an actor can finalize every machine represented by a payout run.';
comment on function public.operator_capture_payout_run_review_snapshot(uuid, uuid, text, text) is
  'Service-only helper that stores immutable payout run review/revision snapshots before workflow status changes.';
comment on function public.operator_payout_calculation_payload(uuid) is
  'Returns payout run totals, operator items, machine breakdowns, adjustments, and warnings scoped to the current actor; partial machine managers do not receive full-run totals.';
comment on function public.get_payout_review_context() is
  'Returns payout periods, latest payout runs, warnings, statement guards, and scoped review permissions for the current manager.';
comment on function public.admin_mark_payout_run_reviewed(uuid, text) is
  'Marks a payout run ready for final review with an audit reason and immutable review snapshot.';
comment on function public.admin_finalize_payout_run(uuid, text, boolean, text) is
  'Finalizes a reviewed payout run, blocks critical warnings unless explicitly overridden, and prevents duplicate issued statements.';
comment on function public.admin_reopen_payout_run(uuid, text) is
  'Reopens an unissued payout run for correction while preserving the previous version in a review snapshot.';
comment on function public.admin_void_payout_run(uuid, text) is
  'Voids an unissued payout run with an audit reason and review snapshot so a corrected run can be generated.';

revoke insert, update, delete on public.payout_run_review_snapshots
  from anon, authenticated;

revoke execute on function public.operator_can_finalize_payout_run(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.operator_capture_payout_run_review_snapshot(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.get_payout_review_context()
  from public, anon;
revoke execute on function public.admin_mark_payout_run_reviewed(uuid, text)
  from public, anon;
revoke execute on function public.admin_finalize_payout_run(uuid, text, boolean, text)
  from public, anon;
revoke execute on function public.admin_reopen_payout_run(uuid, text)
  from public, anon;
revoke execute on function public.admin_void_payout_run(uuid, text)
  from public, anon;

grant execute on function public.operator_can_finalize_payout_run(uuid, uuid)
  to service_role;
grant execute on function public.operator_capture_payout_run_review_snapshot(uuid, uuid, text, text)
  to service_role;
grant execute on function public.get_payout_review_context()
  to authenticated;
grant execute on function public.admin_mark_payout_run_reviewed(uuid, text)
  to authenticated;
grant execute on function public.admin_finalize_payout_run(uuid, text, boolean, text)
  to authenticated;
grant execute on function public.admin_reopen_payout_run(uuid, text)
  to authenticated;
grant execute on function public.admin_void_payout_run(uuid, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
