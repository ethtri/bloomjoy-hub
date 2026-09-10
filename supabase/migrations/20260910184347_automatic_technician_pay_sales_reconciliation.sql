-- Keep the Technician Pay Report current without asking a manager to maintain
-- internal revenue snapshots. The existing read-only report remains available
-- as the calculation layer; this manager-facing wrapper repairs only missing or
-- fact-mismatched snapshots before returning that report.

create function public.get_current_technician_pay_report_context(
  p_month date default current_date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid;
  period_start date;
  period_end date;
  profile_id uuid;
  scope_row record;
  snapshot_row public.payout_period_machine_revenue_snapshots;
  refreshed_snapshot_row public.payout_period_machine_revenue_snapshots;
  refreshed_snapshot_id uuid;
  current_values jsonb;
begin
  actor_user_id := auth.uid();
  period_start := date_trunc('month', coalesce(p_month, current_date)::timestamp)::date;
  period_end := (period_start + interval '1 month - 1 day')::date;

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.customer_accounts account
    where coalesce(
      public.can_manage_operator_payout_account(actor_user_id, account.id),
      false
    )
  ) then
    raise exception 'Account pay authority required';
  end if;

  -- A report can exist before any time entry creates its monthly period. Only
  -- invoke the existing ensure contract when an account truly has no period so
  -- repeated report reads do not rewrite period metadata.
  for profile_id in
    select distinct on (profile.account_id) profile.id
    from public.operator_payout_profiles profile
    where public.can_manage_operator_payout_account(actor_user_id, profile.account_id)
      and exists (
        select 1
        from public.operator_machine_assignments assignment
        where assignment.operator_profile_id = profile.id
          and assignment.account_id = profile.account_id
          and assignment.effective_start_date <= period_end
          and coalesce(assignment.effective_end_date, 'infinity'::date) >= period_start
      )
      and not exists (
        select 1
        from public.payout_periods period
        where period.account_id = profile.account_id
          and period.period_start_date = period_start
          and period.period_end_date = period_end
          and period.status <> 'voided'
      )
    order by profile.account_id, profile.id
  loop
    perform public.ensure_operator_payout_period_for_date(profile_id, period_start);
  end loop;

  -- Rebuild only missing snapshots or snapshots whose financial totals no longer
  -- match the imported sales, refunds, and effective-dated tax facts.
  for scope_row in
    select distinct
      period.id as payout_period_id,
      assignment.reporting_machine_id
    from public.payout_periods period
    join public.operator_machine_assignments assignment
      on assignment.account_id = period.account_id
      and assignment.effective_start_date <= period.period_end_date
      and coalesce(assignment.effective_end_date, 'infinity'::date) >= period.period_start_date
    where period.period_start_date = period_start
      and period.period_end_date = period_end
      and period.status <> 'voided'
      and public.can_manage_operator_payout_account(actor_user_id, period.account_id)
    order by period.id, assignment.reporting_machine_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'technician_pay_report_snapshot:'
          || scope_row.payout_period_id::text
          || ':'
          || scope_row.reporting_machine_id::text,
        0
      )
    );

    select snapshot.*
    into snapshot_row
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.payout_period_id = scope_row.payout_period_id
      and snapshot.reporting_machine_id = scope_row.reporting_machine_id
      and snapshot.status <> 'voided'
    order by snapshot.created_at desc, snapshot.id
    limit 1;

    current_values := private.operator_machine_tax_snapshot(
      scope_row.reporting_machine_id,
      period_start,
      period_end
    );

    if snapshot_row.id is null
      or snapshot_row.gross_sales_cents is distinct from (current_values ->> 'grossSalesCents')::integer
      or snapshot_row.refund_adjustment_cents is distinct from (current_values ->> 'refundAdjustmentCents')::integer
      or snapshot_row.tax_cents is distinct from (current_values ->> 'taxCents')::integer
      or snapshot_row.eligible_commission_revenue_cents is distinct from (current_values ->> 'commissionableSalesCents')::integer
    then
      refreshed_snapshot_id := public.service_refresh_pay_stub_revenue_snapshot(
        scope_row.payout_period_id,
        scope_row.reporting_machine_id
      );

      select snapshot.*
      into refreshed_snapshot_row
      from public.payout_period_machine_revenue_snapshots snapshot
      where snapshot.id = refreshed_snapshot_id;

      insert into public.admin_audit_log (
        actor_user_id,
        action,
        entity_type,
        entity_id,
        before,
        after,
        meta
      ) values (
        actor_user_id,
        case when snapshot_row.id is null
          then 'operator_payout_revenue_snapshot.created'
          else 'operator_payout_revenue_snapshot.regenerated'
        end,
        'payout_period_machine_revenue_snapshot',
        refreshed_snapshot_id::text,
        coalesce(to_jsonb(snapshot_row), '{}'::jsonb),
        to_jsonb(refreshed_snapshot_row),
        jsonb_build_object(
          'reason', 'Technician Pay Report automatic sales reconciliation',
          'payout_period_id', scope_row.payout_period_id,
          'reporting_machine_id', scope_row.reporting_machine_id,
          'raw_provider_payloads_included', false
        )
      );
    end if;

    snapshot_row := null;
    refreshed_snapshot_row := null;
    refreshed_snapshot_id := null;
  end loop;

  return public.get_technician_pay_report_context(period_start);
end;
$$;

revoke execute on function public.get_current_technician_pay_report_context(date)
  from public, anon;
grant execute on function public.get_current_technician_pay_report_context(date)
  to authenticated;

comment on function public.get_current_technician_pay_report_context(date) is
  'Account-pay-authorized Technician Pay Report that idempotently creates a missing month and reconciles changed sales, refunds, and tax before returning current calculations. It does not publish a Pay Stub or execute payment.';

-- Sales reconciliation can happen after a Pay Stub was issued. Keep the issued
-- payload immutable and surface the existing explicit regeneration workflow.
create or replace function private.operator_pay_stub_regeneration_required(
  p_operator_profile_id uuid,
  p_period_start date,
  p_period_end date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with latest_statement as (
    select
      statement.account_id,
      coalesce(statement.statement_generated_at, statement.issued_at, statement.created_at) as generated_at,
      nullif(
        statement.statement_payload #>> '{calculationMeta,paySourceRevision}',
        ''
      )::bigint as source_revision
    from public.pay_statements statement
    join public.payout_runs run on run.id = statement.payout_run_id
    join public.payout_periods period on period.id = run.payout_period_id
    where statement.operator_profile_id = p_operator_profile_id
      and statement.status = 'issued'
      and statement.statement_payload ->> 'schemaVersion' = 'operator-pay-stub-v2'
      and period.period_start_date = p_period_start
      and period.period_end_date = p_period_end
    order by statement.version desc, statement.issued_at desc nulls last, statement.created_at desc
    limit 1
  )
  select coalesce(
    (
      select latest.source_revision is null
        or latest.source_revision < private.operator_pay_time_source_revision(
          p_operator_profile_id,
          p_period_end
        )
        or exists (
          select 1
          from public.payout_period_machine_revenue_snapshots snapshot
          join public.admin_audit_log audit
            on audit.entity_type = 'payout_period_machine_revenue_snapshot'
           and audit.entity_id = snapshot.id::text
           and audit.action in (
             'operator_payout_revenue_snapshot.created',
             'operator_payout_revenue_snapshot.regenerated',
             'operator_payout_revenue_snapshot.overridden'
           )
          where snapshot.account_id = latest.account_id
            and snapshot.period_start_date = p_period_start
            and snapshot.period_end_date = p_period_end
            and snapshot.status <> 'voided'
            and audit.created_at > latest.generated_at
            and exists (
              select 1
              from public.operator_machine_assignments assignment
              where assignment.operator_profile_id = p_operator_profile_id
                and assignment.account_id = latest.account_id
                and assignment.reporting_machine_id = snapshot.reporting_machine_id
                and assignment.effective_start_date <= p_period_end
                and coalesce(assignment.effective_end_date, 'infinity'::date) >= p_period_start
            )
        )
      from latest_statement latest
    ),
    false
  );
$$;

revoke execute on function private.operator_pay_stub_regeneration_required(uuid, date, date)
  from public, anon, authenticated;
grant execute on function private.operator_pay_stub_regeneration_required(uuid, date, date)
  to service_role;

comment on function private.operator_pay_stub_regeneration_required(uuid, date, date) is
  'Returns true when audited time changes or an automatic sales snapshot reconciliation occurred after the current Pay Stub calculation; issuing a newer immutable stub clears the derived condition.';

select pg_notify('pgrst', 'reload schema');
