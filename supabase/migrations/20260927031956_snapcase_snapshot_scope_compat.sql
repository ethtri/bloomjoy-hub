-- Keep a legacy cross-account revenue snapshot from aborting a mapped
-- SnapCase replay. Only snapshots that the canonical refresh service can
-- refresh belong in this late-correction loop.

create or replace function private.refresh_snapcase_payout_snapshots(
  p_reporting_machine_ids jsonb,
  p_local_start date,
  p_local_end_exclusive date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  scope_row record;
  before_snapshot public.payout_period_machine_revenue_snapshots;
  after_snapshot public.payout_period_machine_revenue_snapshots;
  refreshed_id uuid;
  refreshed_count integer := 0;
begin
  if p_local_start is null or p_local_end_exclusive <= p_local_start then
    return 0;
  end if;

  for scope_row in
    select snapshot.id, snapshot.payout_period_id, snapshot.reporting_machine_id
    from public.payout_period_machine_revenue_snapshots snapshot
    join public.payout_periods period
      on period.id = snapshot.payout_period_id
      and period.account_id = snapshot.account_id
    join public.reporting_machines machine
      on machine.id = snapshot.reporting_machine_id
      and machine.account_id = period.account_id
    where snapshot.status <> 'voided'
      and snapshot.period_start_date < p_local_end_exclusive
      and snapshot.period_end_date >= p_local_start
      and snapshot.reporting_machine_id in (
        select value::uuid
        from jsonb_array_elements_text(coalesce(p_reporting_machine_ids, '[]'::jsonb)) value
      )
    order by snapshot.payout_period_id, snapshot.reporting_machine_id, snapshot.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'technician_pay_report_snapshot:' || scope_row.payout_period_id::text
          || ':' || scope_row.reporting_machine_id::text,
        0
      )
    );

    select snapshot.* into before_snapshot
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.id = scope_row.id;

    refreshed_id := public.service_refresh_pay_stub_revenue_snapshot(
      scope_row.payout_period_id,
      scope_row.reporting_machine_id
    );

    select snapshot.* into after_snapshot
    from public.payout_period_machine_revenue_snapshots snapshot
    where snapshot.id = refreshed_id;

    insert into public.admin_audit_log (
      actor_user_id, action, entity_type, entity_id, before, after, meta
    ) values (
      null,
      'operator_payout_revenue_snapshot.regenerated',
      'payout_period_machine_revenue_snapshot',
      refreshed_id::text,
      to_jsonb(before_snapshot),
      to_jsonb(after_snapshot),
      jsonb_build_object(
        'reason', 'SnapCase cash import changed source sales',
        'payout_period_id', scope_row.payout_period_id,
        'reporting_machine_id', scope_row.reporting_machine_id,
        'raw_provider_payloads_included', false
      )
    );
    refreshed_count := refreshed_count + 1;
  end loop;

  return refreshed_count;
end;
$$;

revoke all on function private.refresh_snapcase_payout_snapshots(jsonb, date, date)
  from public, anon, authenticated, service_role;
