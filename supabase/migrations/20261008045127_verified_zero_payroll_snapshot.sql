-- A manager can attest verified zero revenue using the existing audited override.
-- Empty generated snapshots alone cannot distinguish zero sales from missing imports.
alter function private.normalize_technician_pay_report_status(jsonb,date,date,date)
  rename to normalize_technician_pay_report_status_before_verified_zero;

create function private.normalize_technician_pay_report_status(
  p_calculation jsonb, p_period_start date, p_period_end date, p_as_of_date date
) returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  normalized jsonb;
  blockers jsonb;
  verified_machine_ids jsonb;
begin
  normalized := private.normalize_technician_pay_report_status_before_verified_zero(
    p_calculation,p_period_start,p_period_end,p_as_of_date);
  select coalesce(jsonb_agg(machine.item->>'machineId'),'[]'::jsonb)
  into verified_machine_ids
  from jsonb_array_elements(coalesce(normalized->'machines','[]'::jsonb)) machine(item)
  join public.payout_period_machine_revenue_snapshots snapshot
    on snapshot.id = (machine.item->>'revenueSnapshotId')::uuid
    and snapshot.reporting_machine_id = (machine.item->>'machineId')::uuid
    and snapshot.account_id = (normalized->>'accountId')::uuid
    and snapshot.period_start_date = p_period_start
    and snapshot.period_end_date = p_period_end
  where snapshot.status = 'manual_override'
    and nullif(trim(snapshot.manual_override_reason),'') is not null
    and snapshot.gross_sales_cents = 0
    and snapshot.refund_adjustment_cents = 0
    and snapshot.eligible_commission_revenue_cents = 0
    and (machine.item->>'snapshotMatchesFacts')::boolean is true
    and (machine.item->>'sourceSalesRowCount')::bigint = 0
    and (machine.item->>'sourceAdjustmentRowCount')::bigint = 0
    and (machine.item->>'commissionableSalesCents')::bigint = 0;

  select coalesce(jsonb_agg(blocker.item order by blocker.position),'[]'::jsonb)
  into blockers
  from jsonb_array_elements(coalesce(normalized->'blockers','[]'::jsonb))
    with ordinality blocker(item,position)
  where not (
    blocker.item->>'code' in ('missing_sales_source','missing_commission_sales_facts')
    and coalesce(verified_machine_ids ? (blocker.item->>'machineId'),false)
  );
  normalized := jsonb_set(normalized,'{blockers}',blockers);
  normalized := jsonb_set(normalized,'{publishable}',to_jsonb(
    not coalesce((normalized->'calculationMeta'->>'periodInProgress')::boolean,false)
    and not (
      not coalesce((normalized->'calculationMeta'->>'hasAssignmentInPeriod')::boolean,false)
      and coalesce((normalized->>'currentTotalCents')::bigint,0) = 0
    )
    and jsonb_array_length(blockers)=0));
  normalized := jsonb_set(normalized,'{calculationMeta}',
    coalesce(normalized->'calculationMeta','{}'::jsonb)
    || jsonb_build_object('verifiedZeroRevenueMachineIds',verified_machine_ids));
  return normalized;
end;
$$;
revoke execute on function private.normalize_technician_pay_report_status_before_verified_zero(jsonb,date,date,date) from public,anon,authenticated;
grant execute on function private.normalize_technician_pay_report_status_before_verified_zero(jsonb,date,date,date) to service_role;
revoke execute on function private.normalize_technician_pay_report_status(jsonb,date,date,date) from public,anon,authenticated;
grant execute on function private.normalize_technician_pay_report_status(jsonb,date,date,date) to service_role;
comment on function private.normalize_technician_pay_report_status(jsonb,date,date,date)
is 'Recognizes existing manager-attested zero monthly snapshots only when they match empty sales and adjustment facts; retains all other payroll blockers.';
