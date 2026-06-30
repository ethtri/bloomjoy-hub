create or replace function public.admin_get_payout_register_export(
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
  run_row record;
  register_rows jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    run.*,
    account.name as account_name,
    period.period_start_date,
    period.period_end_date,
    period.target_payout_date
  into run_row
  from public.payout_runs run
  join public.customer_accounts account
    on account.id = run.account_id
  join public.payout_periods period
    on period.id = run.payout_period_id
  where run.id = p_payout_run_id
  limit 1;

  if not found then
    raise exception 'Payout run not found';
  end if;

  if run_row.status not in ('finalized', 'issued', 'closed') then
    raise exception 'Payout register export is available only for finalized or issued payout runs';
  end if;

  if not public.operator_can_finalize_payout_run(actor_user_id, run_row.id) then
    raise exception 'Payout register export access required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'payoutRunItemId', item.id,
        'operatorProfileId', item.operator_profile_id,
        'operatorDisplayName', profile.display_name,
        'workerType', item.worker_type,
        'statement', jsonb_build_object(
          'id', latest_statement.id,
          'statementNumber', latest_statement.statement_number,
          'statementLabel', latest_statement.statement_label,
          'status', latest_statement.status,
          'version', latest_statement.version,
          'issuedAt', latest_statement.issued_at,
          'revisionReason', latest_statement.revision_reason
        ),
        'time', jsonb_build_object(
          'rawMinutes', item.raw_minutes,
          'roundedPaidMinutes', item.rounded_paid_minutes,
          'shiftCount', item.shift_count
        ),
        'revenueBasis', jsonb_build_object(
          'eligibleNetRevenueCents', item.eligible_net_revenue_cents,
          'commissionBasisPoints', item.commission_basis_points
        ),
        'totals', jsonb_build_object(
          'hourlyRateCents', item.hourly_rate_cents,
          'hourlyPayCents', item.hourly_pay_cents,
          'commissionPayCents', item.commission_pay_cents,
          'adjustmentsTotalCents', item.adjustments_total_cents,
          'totalPayoutCents', item.total_payout_cents
        ),
        'status', item.status,
        'warnings', coalesce(item.warnings, '[]'::jsonb),
        'machines', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'machineId', item_machine.reporting_machine_id,
              'machineLabel', machine.machine_label,
              'locationId', item_machine.reporting_location_id,
              'locationName', location.name,
              'rawMinutes', item_machine.raw_minutes,
              'roundedPaidMinutes', item_machine.rounded_paid_minutes,
              'shiftCount', item_machine.shift_count,
              'netRevenueCents', item_machine.net_revenue_cents,
              'eligibleNetRevenueCents', item_machine.eligible_net_revenue_cents,
              'commissionBasisPoints', item_machine.commission_basis_points,
              'commissionPayCents', item_machine.commission_pay_cents,
              'includedInCommissionBasis', item_machine.included_in_commission_basis,
              'inclusionReason', item_machine.inclusion_reason
            )
            order by machine.machine_label, item_machine.id
          )
          from public.payout_run_item_machines item_machine
          join public.reporting_machines machine
            on machine.id = item_machine.reporting_machine_id
          join public.reporting_locations location
            on location.id = item_machine.reporting_location_id
          where item_machine.payout_run_item_id = item.id
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
            order by adjustment.created_at, adjustment.id
          )
          from public.payout_adjustments adjustment
          where adjustment.payout_run_id = run_row.id
            and adjustment.operator_profile_id = item.operator_profile_id
        ), '[]'::jsonb)
      )
      order by profile.display_name, item.id
    ),
    '[]'::jsonb
  )
  into register_rows
  from public.payout_run_items item
  join public.operator_payout_profiles profile
    on profile.id = item.operator_profile_id
  left join lateral (
    select statement.*
    from public.pay_statements statement
    where statement.payout_run_item_id = item.id
      and statement.status in ('issued', 'revised')
    order by statement.version desc, statement.issued_at desc nulls last, statement.created_at desc
    limit 1
  ) latest_statement on true
  where item.payout_run_id = run_row.id
    and item.status <> 'voided'
    and public.can_access_payout_run_item(actor_user_id, item.id);

  return jsonb_build_object(
    'schemaVersion', 'operator-payout-register-v1',
    'exportType', 'approved_external_payout_register',
    'generatedAt', now(),
    'payoutRun', jsonb_build_object(
      'id', run_row.id,
      'accountId', run_row.account_id,
      'accountName', run_row.account_name,
      'payoutPeriodId', run_row.payout_period_id,
      'periodStartDate', run_row.period_start_date,
      'periodEndDate', run_row.period_end_date,
      'targetPayoutDate', run_row.target_payout_date,
      'status', run_row.status,
      'finalizedAt', run_row.finalized_at,
      'issuedAt', run_row.issued_at,
      'updatedAt', run_row.updated_at
    ),
    'totals', jsonb_build_object(
      'rawMinutes', run_row.total_raw_minutes,
      'roundedPaidMinutes', run_row.total_rounded_paid_minutes,
      'hourlyPayCents', run_row.total_hourly_pay_cents,
      'commissionPayCents', run_row.total_commission_pay_cents,
      'adjustmentsTotalCents', run_row.total_adjustments_cents,
      'totalPayoutCents', run_row.total_payout_cents
    ),
    'warnings', coalesce(run_row.warnings, '[]'::jsonb),
    'rows', register_rows,
    'rowCount', jsonb_array_length(register_rows),
    'disclaimer',
      'Bloomjoy Hub records approved payout totals for external payroll or payment execution. It does not calculate tax withholding, file payroll forms, execute direct deposit, or store bank or SSN data.',
    'automation', jsonb_build_object(
      'taxComplianceEngine', false,
      'payrollProviderExecution', false,
      'directDepositExecution', false,
      'bankDataIncluded', false,
      'ssnIncluded', false
    )
  );
end;
$$;

comment on function public.admin_get_payout_register_export(uuid) is
  'Returns an approved payout register for finalized or issued runs only, scoped to authorized payout managers, for external payroll/payment execution without tax, bank, SSN, or payroll-provider automation.';

revoke execute on function public.admin_get_payout_register_export(uuid)
  from public, anon;

grant execute on function public.admin_get_payout_register_export(uuid)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
