-- Operator payout revenue snapshots: sanitized payout-period machine summaries
-- sourced from normalized sales and refund adjustment facts.

create table if not exists public.payout_period_machine_revenue_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.customer_accounts (id) on delete cascade,
  payout_period_id uuid not null references public.payout_periods (id) on delete cascade,
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete restrict,
  reporting_location_id uuid not null references public.reporting_locations (id) on delete restrict,
  period_start_date date not null,
  period_end_date date not null,
  gross_sales_cents integer not null default 0 check (gross_sales_cents >= 0),
  refund_adjustment_cents integer not null default 0 check (refund_adjustment_cents >= 0),
  net_revenue_cents integer not null default 0,
  eligible_commission_revenue_cents integer not null default 0
    check (eligible_commission_revenue_cents >= 0),
  transaction_count integer not null default 0 check (transaction_count >= 0),
  source_sales_row_count integer not null default 0 check (source_sales_row_count >= 0),
  source_adjustment_row_count integer not null default 0
    check (source_adjustment_row_count >= 0),
  source_latest_sale_date date,
  source_latest_adjustment_date date,
  source_metadata jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  status text not null default 'source_generated'
    check (status in ('source_generated', 'manual_override', 'voided')),
  manual_override_reason text,
  generated_at timestamptz not null default now(),
  regenerated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_revenue_snapshots_valid_window check (period_end_date >= period_start_date),
  constraint payout_revenue_snapshots_manual_reason check (
    status <> 'manual_override'
    or length(trim(coalesce(manual_override_reason, ''))) > 0
  )
);

create unique index if not exists payout_revenue_snapshots_period_machine_idx
  on public.payout_period_machine_revenue_snapshots (
    payout_period_id,
    reporting_machine_id
  )
  where status <> 'voided';

create index if not exists payout_revenue_snapshots_account_period_idx
  on public.payout_period_machine_revenue_snapshots (
    account_id,
    payout_period_id,
    reporting_machine_id
  );

create index if not exists payout_revenue_snapshots_machine_period_idx
  on public.payout_period_machine_revenue_snapshots (
    reporting_machine_id,
    period_start_date desc
  );

drop trigger if exists payout_revenue_snapshots_set_updated_at
  on public.payout_period_machine_revenue_snapshots;
create trigger payout_revenue_snapshots_set_updated_at
before update on public.payout_period_machine_revenue_snapshots
for each row execute function public.set_updated_at();

create or replace function public.operator_can_access_payout_revenue_snapshot_row(
  p_user_id uuid,
  p_account_id uuid,
  p_reporting_machine_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_account_id is not null
    and p_reporting_machine_id is not null
    and p_period_start_date is not null
    and p_period_end_date is not null
    and (
      public.can_manage_operator_payout_account(p_user_id, p_account_id)
      or public.can_manage_operator_payout_machine(p_user_id, p_reporting_machine_id)
      or exists (
        select 1
        from public.operator_payout_profiles profile
        join public.operator_machine_assignments assignment
          on assignment.operator_profile_id = profile.id
        where profile.user_id = p_user_id
          and profile.account_id = p_account_id
          and profile.status = 'active'
          and assignment.reporting_machine_id = p_reporting_machine_id
          and assignment.status = 'active'
          and assignment.revoked_at is null
          and assignment.effective_start_date <= p_period_end_date
          and (
            assignment.effective_end_date is null
            or assignment.effective_end_date >= p_period_start_date
          )
      )
    );
$$;

create or replace function public.operator_can_access_payout_revenue_snapshot_row_current_user(
  p_account_id uuid,
  p_reporting_machine_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.operator_can_access_payout_revenue_snapshot_row(
    (select auth.uid()),
    p_account_id,
    p_reporting_machine_id,
    p_period_start_date,
    p_period_end_date
  );
$$;

alter table public.payout_period_machine_revenue_snapshots enable row level security;

drop policy if exists "payout_revenue_snapshots_select_accessible"
  on public.payout_period_machine_revenue_snapshots;
create policy "payout_revenue_snapshots_select_accessible"
on public.payout_period_machine_revenue_snapshots
for select
using (
  public.operator_can_access_payout_revenue_snapshot_row_current_user(
    account_id,
    reporting_machine_id,
    period_start_date,
    period_end_date
  )
);

create or replace function public.payout_revenue_snapshot_payload(
  p_snapshot_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'id', snapshot.id,
    'accountId', snapshot.account_id,
    'payoutPeriodId', snapshot.payout_period_id,
    'machineId', snapshot.reporting_machine_id,
    'machineLabel', machine.machine_label,
    'locationId', snapshot.reporting_location_id,
    'locationName', location.name,
    'periodStartDate', snapshot.period_start_date,
    'periodEndDate', snapshot.period_end_date,
    'grossSalesCents', snapshot.gross_sales_cents,
    'refundAdjustmentCents', snapshot.refund_adjustment_cents,
    'netRevenueCents', snapshot.net_revenue_cents,
    'eligibleCommissionRevenueCents', snapshot.eligible_commission_revenue_cents,
    'transactionCount', snapshot.transaction_count,
    'sourceSalesRowCount', snapshot.source_sales_row_count,
    'sourceAdjustmentRowCount', snapshot.source_adjustment_row_count,
    'sourceLatestSaleDate', snapshot.source_latest_sale_date,
    'sourceLatestAdjustmentDate', snapshot.source_latest_adjustment_date,
    'sourceMetadata', snapshot.source_metadata,
    'warnings', snapshot.warnings,
    'status', snapshot.status,
    'manualOverrideReason', snapshot.manual_override_reason,
    'generatedAt', snapshot.generated_at,
    'regeneratedAt', snapshot.regenerated_at,
    'createdAt', snapshot.created_at,
    'updatedAt', snapshot.updated_at
  )
  from public.payout_period_machine_revenue_snapshots snapshot
  join public.reporting_machines machine on machine.id = snapshot.reporting_machine_id
  join public.reporting_locations location on location.id = snapshot.reporting_location_id
  where snapshot.id = p_snapshot_id
    and public.operator_can_access_payout_revenue_snapshot_row(
      (select auth.uid()),
      snapshot.account_id,
      snapshot.reporting_machine_id,
      snapshot.period_start_date,
      snapshot.period_end_date
    );
$$;

create or replace function public.operator_revenue_snapshot_source_values(
  p_payout_period_id uuid,
  p_reporting_machine_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  period_row public.payout_periods;
  machine_row public.reporting_machines;
  gross_sales_cents integer := 0;
  refund_adjustment_cents integer := 0;
  net_revenue_cents integer := 0;
  eligible_commission_revenue_cents integer := 0;
  transaction_count integer := 0;
  source_sales_row_count integer := 0;
  source_adjustment_row_count integer := 0;
  source_latest_sale_date date;
  source_latest_adjustment_date date;
  source_metadata jsonb := '{}'::jsonb;
  warnings jsonb := '[]'::jsonb;
begin
  select *
  into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id
  limit 1;

  if period_row.id is null then
    raise exception 'Payout period not found';
  end if;

  select *
  into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = period_row.account_id
  limit 1;

  if machine_row.id is null then
    raise exception 'Reporting machine not found for payout account';
  end if;

  select
    coalesce(sum(fact.net_sales_cents), 0)::integer,
    coalesce(sum(fact.transaction_count), 0)::integer,
    count(*)::integer,
    max(fact.sale_date)
  into
    gross_sales_cents,
    transaction_count,
    source_sales_row_count,
    source_latest_sale_date
  from public.machine_sales_facts fact
  where fact.reporting_machine_id = machine_row.id
    and fact.sale_date between period_row.period_start_date and period_row.period_end_date;

  select
    coalesce(sum(adjustment.amount_cents), 0)::integer,
    count(*)::integer,
    max(adjustment.adjustment_date)
  into
    refund_adjustment_cents,
    source_adjustment_row_count,
    source_latest_adjustment_date
  from public.sales_adjustment_facts adjustment
  where adjustment.reporting_machine_id = machine_row.id
    and adjustment.adjustment_date between period_row.period_start_date and period_row.period_end_date
    and adjustment.adjustment_type in ('refund', 'complaint_refund')
    and adjustment.amount_cents > 0;

  net_revenue_cents := gross_sales_cents - refund_adjustment_cents;
  eligible_commission_revenue_cents := greatest(net_revenue_cents, 0);

  select jsonb_build_object(
    'sourceWindow', jsonb_build_object(
      'periodStartDate', period_row.period_start_date,
      'periodEndDate', period_row.period_end_date
    ),
    'salesSources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'source', sales.source,
          'rowCount', sales.row_count,
          'transactionCount', sales.transaction_count,
          'grossSalesCents', sales.gross_sales_cents,
          'latestSaleDate', sales.latest_sale_date
        )
        order by sales.source
      )
      from (
        select
          fact.source,
          count(*)::integer as row_count,
          coalesce(sum(fact.transaction_count), 0)::integer as transaction_count,
          coalesce(sum(fact.net_sales_cents), 0)::integer as gross_sales_cents,
          max(fact.sale_date) as latest_sale_date
        from public.machine_sales_facts fact
        where fact.reporting_machine_id = machine_row.id
          and fact.sale_date between period_row.period_start_date and period_row.period_end_date
        group by fact.source
      ) sales
    ), '[]'::jsonb),
    'adjustmentSources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'source', adjustments.source,
          'adjustmentType', adjustments.adjustment_type,
          'rowCount', adjustments.row_count,
          'amountCents', adjustments.amount_cents,
          'latestAdjustmentDate', adjustments.latest_adjustment_date
        )
        order by adjustments.source, adjustments.adjustment_type
      )
      from (
        select
          adjustment.source,
          adjustment.adjustment_type,
          count(*)::integer as row_count,
          coalesce(sum(adjustment.amount_cents), 0)::integer as amount_cents,
          max(adjustment.adjustment_date) as latest_adjustment_date
        from public.sales_adjustment_facts adjustment
        where adjustment.reporting_machine_id = machine_row.id
          and adjustment.adjustment_date between period_row.period_start_date and period_row.period_end_date
          and adjustment.adjustment_type in ('refund', 'complaint_refund')
          and adjustment.amount_cents > 0
        group by adjustment.source, adjustment.adjustment_type
      ) adjustments
    ), '[]'::jsonb),
    'rawProviderPayloadsIncluded', false,
    'sourceRowHashesIncluded', false
  )
  into source_metadata;

  if source_sales_row_count = 0 then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'code', 'missing_sales_source',
      'severity', 'blocker',
      'message', 'No sales facts were found for this machine in the payout period.'
    ));
  end if;

  if source_latest_sale_date is not null
    and source_latest_sale_date < period_row.period_end_date then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'code', 'stale_sales_source',
      'severity', 'warning',
      'message', 'Latest sales fact is before the payout period end date.',
      'latestSaleDate', source_latest_sale_date
    ));
  end if;

  if source_latest_sale_date is null then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'code', 'stale_sales_source',
      'severity', 'warning',
      'message', 'Sales freshness could not be confirmed for this payout period.'
    ));
  end if;

  if net_revenue_cents < 0 then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'code', 'negative_net_revenue_clamped',
      'severity', 'warning',
      'message', 'Refund adjustments exceed sales; eligible commission revenue was clamped to zero.'
    ));
  end if;

  return jsonb_build_object(
    'accountId', period_row.account_id,
    'payoutPeriodId', period_row.id,
    'payoutPolicyId', period_row.payout_policy_id,
    'machineId', machine_row.id,
    'locationId', machine_row.location_id,
    'periodStartDate', period_row.period_start_date,
    'periodEndDate', period_row.period_end_date,
    'grossSalesCents', gross_sales_cents,
    'refundAdjustmentCents', refund_adjustment_cents,
    'netRevenueCents', net_revenue_cents,
    'eligibleCommissionRevenueCents', eligible_commission_revenue_cents,
    'transactionCount', transaction_count,
    'sourceSalesRowCount', source_sales_row_count,
    'sourceAdjustmentRowCount', source_adjustment_row_count,
    'sourceLatestSaleDate', source_latest_sale_date,
    'sourceLatestAdjustmentDate', source_latest_adjustment_date,
    'sourceMetadata', source_metadata,
    'warnings', warnings
  );
end;
$$;

create or replace function public.admin_generate_payout_revenue_snapshot(
  p_payout_period_id uuid,
  p_reporting_machine_id uuid,
  p_regenerate boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  normalized_reason text;
  source_values jsonb;
  period_row public.payout_periods;
  machine_row public.reporting_machines;
  before_row public.payout_period_machine_revenue_snapshots;
  after_row public.payout_period_machine_revenue_snapshots;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id
  limit 1;

  if period_row.id is null then
    raise exception 'Payout period not found';
  end if;

  select *
  into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = period_row.account_id
  limit 1;

  if machine_row.id is null then
    raise exception 'Reporting machine not found for payout account';
  end if;

  if not (
    public.can_manage_operator_payout_account(actor_user_id, period_row.account_id)
    or public.can_manage_operator_payout_machine(actor_user_id, machine_row.id)
  ) then
    raise exception 'Operator payout revenue snapshot access required';
  end if;

  select *
  into before_row
  from public.payout_period_machine_revenue_snapshots snapshot
  where snapshot.payout_period_id = period_row.id
    and snapshot.reporting_machine_id = machine_row.id
    and snapshot.status <> 'voided'
  limit 1;

  if before_row.id is not null and not coalesce(p_regenerate, false) then
    return jsonb_build_object(
      'snapshot', public.payout_revenue_snapshot_payload(before_row.id),
      'idempotent', true
    );
  end if;

  if before_row.id is not null and normalized_reason = '' then
    raise exception 'Regeneration reason is required';
  end if;

  source_values := public.operator_revenue_snapshot_source_values(period_row.id, machine_row.id);

  if before_row.id is null then
    insert into public.payout_period_machine_revenue_snapshots (
      account_id,
      payout_period_id,
      reporting_machine_id,
      reporting_location_id,
      period_start_date,
      period_end_date,
      gross_sales_cents,
      refund_adjustment_cents,
      net_revenue_cents,
      eligible_commission_revenue_cents,
      transaction_count,
      source_sales_row_count,
      source_adjustment_row_count,
      source_latest_sale_date,
      source_latest_adjustment_date,
      source_metadata,
      warnings,
      status,
      generated_at,
      created_by,
      updated_by
    )
    values (
      period_row.account_id,
      period_row.id,
      machine_row.id,
      machine_row.location_id,
      period_row.period_start_date,
      period_row.period_end_date,
      (source_values ->> 'grossSalesCents')::integer,
      (source_values ->> 'refundAdjustmentCents')::integer,
      (source_values ->> 'netRevenueCents')::integer,
      (source_values ->> 'eligibleCommissionRevenueCents')::integer,
      (source_values ->> 'transactionCount')::integer,
      (source_values ->> 'sourceSalesRowCount')::integer,
      (source_values ->> 'sourceAdjustmentRowCount')::integer,
      nullif(source_values ->> 'sourceLatestSaleDate', '')::date,
      nullif(source_values ->> 'sourceLatestAdjustmentDate', '')::date,
      source_values -> 'sourceMetadata',
      source_values -> 'warnings',
      'source_generated',
      now(),
      actor_user_id,
      actor_user_id
    )
    returning * into after_row;
  else
    update public.payout_period_machine_revenue_snapshots
    set
      reporting_location_id = machine_row.location_id,
      period_start_date = period_row.period_start_date,
      period_end_date = period_row.period_end_date,
      gross_sales_cents = (source_values ->> 'grossSalesCents')::integer,
      refund_adjustment_cents = (source_values ->> 'refundAdjustmentCents')::integer,
      net_revenue_cents = (source_values ->> 'netRevenueCents')::integer,
      eligible_commission_revenue_cents = (source_values ->> 'eligibleCommissionRevenueCents')::integer,
      transaction_count = (source_values ->> 'transactionCount')::integer,
      source_sales_row_count = (source_values ->> 'sourceSalesRowCount')::integer,
      source_adjustment_row_count = (source_values ->> 'sourceAdjustmentRowCount')::integer,
      source_latest_sale_date = nullif(source_values ->> 'sourceLatestSaleDate', '')::date,
      source_latest_adjustment_date = nullif(source_values ->> 'sourceLatestAdjustmentDate', '')::date,
      source_metadata = source_values -> 'sourceMetadata',
      warnings = source_values -> 'warnings',
      status = 'source_generated',
      manual_override_reason = null,
      regenerated_at = now(),
      updated_by = actor_user_id
    where id = before_row.id
    returning * into after_row;
  end if;

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
    case when before_row.id is null
      then 'operator_payout_revenue_snapshot.created'
      else 'operator_payout_revenue_snapshot.regenerated'
    end,
    'payout_period_machine_revenue_snapshot',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', nullif(normalized_reason, ''),
      'payout_period_id', period_row.id,
      'reporting_machine_id', machine_row.id,
      'raw_provider_payloads_included', false
    )
  );

  return jsonb_build_object(
    'snapshot', public.payout_revenue_snapshot_payload(after_row.id),
    'idempotent', false
  );
end;
$$;

create or replace function public.admin_generate_payout_revenue_snapshots_for_period(
  p_payout_period_id uuid,
  p_regenerate boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  period_row public.payout_periods;
  machine_id uuid;
  snapshot_results jsonb := '[]'::jsonb;
  generated_result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id
  limit 1;

  if period_row.id is null then
    raise exception 'Payout period not found';
  end if;

  if not public.can_manage_operator_payout_account(actor_user_id, period_row.account_id) then
    raise exception 'Operator payout revenue snapshot access required';
  end if;

  for machine_id in
    select distinct assignment.reporting_machine_id
    from public.operator_machine_assignments assignment
    where assignment.account_id = period_row.account_id
      and assignment.status = 'active'
      and assignment.revoked_at is null
      and assignment.effective_start_date <= period_row.period_end_date
      and (
        assignment.effective_end_date is null
        or assignment.effective_end_date >= period_row.period_start_date
      )
    order by assignment.reporting_machine_id
  loop
    generated_result := public.admin_generate_payout_revenue_snapshot(
      period_row.id,
      machine_id,
      coalesce(p_regenerate, false),
      p_reason
    );
    snapshot_results := snapshot_results || jsonb_build_array(generated_result -> 'snapshot');
  end loop;

  return jsonb_build_object(
    'payoutPeriodId', period_row.id,
    'snapshotCount', jsonb_array_length(snapshot_results),
    'snapshots', snapshot_results
  );
end;
$$;

create or replace function public.admin_override_payout_revenue_snapshot(
  p_payout_period_id uuid,
  p_reporting_machine_id uuid,
  p_gross_sales_cents integer,
  p_refund_adjustment_cents integer,
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
  period_row public.payout_periods;
  machine_row public.reporting_machines;
  before_row public.payout_period_machine_revenue_snapshots;
  after_row public.payout_period_machine_revenue_snapshots;
  normalized_gross_sales_cents integer;
  normalized_refund_adjustment_cents integer;
  override_net_revenue_cents integer;
  override_eligible_commission_revenue_cents integer;
  override_warnings jsonb;
begin
  actor_user_id := auth.uid();
  normalized_reason := trim(coalesce(p_reason, ''));
  normalized_gross_sales_cents := coalesce(p_gross_sales_cents, 0);
  normalized_refund_adjustment_cents := coalesce(p_refund_adjustment_cents, 0);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_reason = '' then
    raise exception 'Manual revenue snapshot override reason is required';
  end if;

  if normalized_gross_sales_cents < 0 or normalized_refund_adjustment_cents < 0 then
    raise exception 'Revenue override amounts cannot be negative';
  end if;

  select *
  into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id
  limit 1;

  if period_row.id is null then
    raise exception 'Payout period not found';
  end if;

  select *
  into machine_row
  from public.reporting_machines machine
  where machine.id = p_reporting_machine_id
    and machine.account_id = period_row.account_id
  limit 1;

  if machine_row.id is null then
    raise exception 'Reporting machine not found for payout account';
  end if;

  if not (
    public.can_manage_operator_payout_account(actor_user_id, period_row.account_id)
    or public.can_manage_operator_payout_machine(actor_user_id, machine_row.id)
  ) then
    raise exception 'Operator payout revenue snapshot override access required';
  end if;

  select *
  into before_row
  from public.payout_period_machine_revenue_snapshots snapshot
  where snapshot.payout_period_id = period_row.id
    and snapshot.reporting_machine_id = machine_row.id
    and snapshot.status <> 'voided'
  limit 1;

  override_net_revenue_cents := normalized_gross_sales_cents - normalized_refund_adjustment_cents;
  override_eligible_commission_revenue_cents := greatest(override_net_revenue_cents, 0);
  override_warnings := jsonb_build_array(jsonb_build_object(
    'code', 'manual_revenue_override',
    'severity', 'warning',
    'message', 'Manager-entered revenue override is being used for payout commission basis.'
  ));

  if override_net_revenue_cents < 0 then
    override_warnings := override_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'negative_net_revenue_clamped',
      'severity', 'warning',
      'message', 'Refund adjustments exceed sales; eligible commission revenue was clamped to zero.'
    ));
  end if;

  if before_row.id is null then
    insert into public.payout_period_machine_revenue_snapshots (
      account_id,
      payout_period_id,
      reporting_machine_id,
      reporting_location_id,
      period_start_date,
      period_end_date,
      gross_sales_cents,
      refund_adjustment_cents,
      net_revenue_cents,
      eligible_commission_revenue_cents,
      transaction_count,
      source_sales_row_count,
      source_adjustment_row_count,
      source_metadata,
      warnings,
      status,
      manual_override_reason,
      generated_at,
      created_by,
      updated_by
    )
    values (
      period_row.account_id,
      period_row.id,
      machine_row.id,
      machine_row.location_id,
      period_row.period_start_date,
      period_row.period_end_date,
      normalized_gross_sales_cents,
      normalized_refund_adjustment_cents,
      override_net_revenue_cents,
      override_eligible_commission_revenue_cents,
      0,
      0,
      0,
      jsonb_build_object(
        'manualOverride', true,
        'reasonCaptured', true,
        'rawProviderPayloadsIncluded', false,
        'sourceRowHashesIncluded', false
      ),
      override_warnings,
      'manual_override',
      normalized_reason,
      now(),
      actor_user_id,
      actor_user_id
    )
    returning * into after_row;
  else
    update public.payout_period_machine_revenue_snapshots
    set
      reporting_location_id = machine_row.location_id,
      period_start_date = period_row.period_start_date,
      period_end_date = period_row.period_end_date,
      gross_sales_cents = normalized_gross_sales_cents,
      refund_adjustment_cents = normalized_refund_adjustment_cents,
      net_revenue_cents = override_net_revenue_cents,
      eligible_commission_revenue_cents = override_eligible_commission_revenue_cents,
      source_metadata = coalesce(before_row.source_metadata, '{}'::jsonb) || jsonb_build_object(
        'manualOverride', true,
        'reasonCaptured', true,
        'rawProviderPayloadsIncluded', false,
        'sourceRowHashesIncluded', false
      ),
      warnings = override_warnings,
      status = 'manual_override',
      manual_override_reason = normalized_reason,
      regenerated_at = now(),
      updated_by = actor_user_id
    where id = before_row.id
    returning * into after_row;
  end if;

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
    'operator_payout_revenue_snapshot.manual_override',
    'payout_period_machine_revenue_snapshot',
    after_row.id::text,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'reason', normalized_reason,
      'payout_period_id', period_row.id,
      'reporting_machine_id', machine_row.id,
      'raw_provider_payloads_included', false
    )
  );

  return jsonb_build_object(
    'snapshot', public.payout_revenue_snapshot_payload(after_row.id),
    'manualOverride', true
  );
end;
$$;

create or replace function public.get_payout_revenue_snapshot_context(
  p_payout_period_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  period_row public.payout_periods;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into period_row
  from public.payout_periods period
  where period.id = p_payout_period_id
  limit 1;

  if period_row.id is null then
    raise exception 'Payout period not found';
  end if;

  if not public.can_manage_operator_payout_account(actor_user_id, period_row.account_id)
    and not exists (
      select 1
      from public.payout_period_machine_revenue_snapshots snapshot
      where snapshot.payout_period_id = period_row.id
        and public.operator_can_access_payout_revenue_snapshot_row(
          actor_user_id,
          snapshot.account_id,
          snapshot.reporting_machine_id,
          snapshot.period_start_date,
          snapshot.period_end_date
        )
    ) then
    raise exception 'Operator payout revenue snapshot access required';
  end if;

  select jsonb_build_object(
    'payoutPeriodId', period_row.id,
    'periodStartDate', period_row.period_start_date,
    'periodEndDate', period_row.period_end_date,
    'snapshots', coalesce(jsonb_agg(
      public.payout_revenue_snapshot_payload(snapshot.id)
      order by location.name, machine.machine_label
    ) filter (where snapshot.id is not null), '[]'::jsonb),
    'totals', jsonb_build_object(
      'grossSalesCents', coalesce(sum(snapshot.gross_sales_cents), 0),
      'refundAdjustmentCents', coalesce(sum(snapshot.refund_adjustment_cents), 0),
      'netRevenueCents', coalesce(sum(snapshot.net_revenue_cents), 0),
      'eligibleCommissionRevenueCents', coalesce(sum(snapshot.eligible_commission_revenue_cents), 0),
      'transactionCount', coalesce(sum(snapshot.transaction_count), 0),
      'warningCount', coalesce(sum(jsonb_array_length(snapshot.warnings)), 0)
    )
  )
  into result
  from public.payout_period_machine_revenue_snapshots snapshot
  join public.reporting_machines machine on machine.id = snapshot.reporting_machine_id
  join public.reporting_locations location on location.id = snapshot.reporting_location_id
  where snapshot.payout_period_id = period_row.id
    and snapshot.status <> 'voided'
    and public.operator_can_access_payout_revenue_snapshot_row(
      actor_user_id,
      snapshot.account_id,
      snapshot.reporting_machine_id,
      snapshot.period_start_date,
      snapshot.period_end_date
    );

  return coalesce(result, jsonb_build_object(
    'payoutPeriodId', period_row.id,
    'periodStartDate', period_row.period_start_date,
    'periodEndDate', period_row.period_end_date,
    'snapshots', '[]'::jsonb,
    'totals', jsonb_build_object(
      'grossSalesCents', 0,
      'refundAdjustmentCents', 0,
      'netRevenueCents', 0,
      'eligibleCommissionRevenueCents', 0,
      'transactionCount', 0,
      'warningCount', 0
    )
  ));
end;
$$;

comment on table public.payout_period_machine_revenue_snapshots is
  'Sanitized payout-period machine revenue summaries used as the commission basis for Operator Payouts; raw provider payloads and source row hashes stay in reporting fact tables.';
comment on function public.operator_can_access_payout_revenue_snapshot_row(uuid, uuid, uuid, date, date) is
  'Service-only helper for payout revenue snapshot RLS checks; browser code uses the current-user wrapper or context RPC instead.';
comment on function public.operator_revenue_snapshot_source_values(uuid, uuid) is
  'Service-only aggregation helper that derives sanitized payout revenue snapshot values from normalized reporting facts.';
comment on function public.admin_generate_payout_revenue_snapshot(uuid, uuid, boolean, text) is
  'Creates or returns an idempotent sanitized machine revenue snapshot for a payout period; explicit regeneration requires a reason.';
comment on function public.admin_generate_payout_revenue_snapshots_for_period(uuid, boolean, text) is
  'Generates sanitized revenue snapshots for machines assigned to active operators in a payout period.';
comment on function public.admin_override_payout_revenue_snapshot(uuid, uuid, integer, integer, text) is
  'Manual manager/admin revenue snapshot override for missing or incomplete source data; requires an audit reason.';
comment on function public.get_payout_revenue_snapshot_context(uuid) is
  'Returns sanitized payout-period revenue snapshots and totals visible to the current actor.';

revoke insert, update, delete on public.payout_period_machine_revenue_snapshots
  from anon, authenticated;
grant select on public.payout_period_machine_revenue_snapshots to authenticated;

revoke execute on function public.operator_can_access_payout_revenue_snapshot_row(uuid, uuid, uuid, date, date)
  from public, anon, authenticated;
revoke execute on function public.operator_can_access_payout_revenue_snapshot_row_current_user(uuid, uuid, date, date)
  from public, anon;
revoke execute on function public.payout_revenue_snapshot_payload(uuid)
  from public, anon;
revoke execute on function public.operator_revenue_snapshot_source_values(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_generate_payout_revenue_snapshot(uuid, uuid, boolean, text)
  from public, anon;
revoke execute on function public.admin_generate_payout_revenue_snapshots_for_period(uuid, boolean, text)
  from public, anon;
revoke execute on function public.admin_override_payout_revenue_snapshot(uuid, uuid, integer, integer, text)
  from public, anon;
revoke execute on function public.get_payout_revenue_snapshot_context(uuid)
  from public, anon;

grant execute on function public.operator_can_access_payout_revenue_snapshot_row(uuid, uuid, uuid, date, date)
  to service_role;
grant execute on function public.operator_can_access_payout_revenue_snapshot_row_current_user(uuid, uuid, date, date)
  to authenticated;
grant execute on function public.payout_revenue_snapshot_payload(uuid)
  to authenticated;
grant execute on function public.operator_revenue_snapshot_source_values(uuid, uuid)
  to service_role;
grant execute on function public.admin_generate_payout_revenue_snapshot(uuid, uuid, boolean, text)
  to authenticated;
grant execute on function public.admin_generate_payout_revenue_snapshots_for_period(uuid, boolean, text)
  to authenticated;
grant execute on function public.admin_override_payout_revenue_snapshot(uuid, uuid, integer, integer, text)
  to authenticated;
grant execute on function public.get_payout_revenue_snapshot_context(uuid)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
