-- #1574: a refund adjustment without purchase attribution stays visible as an
-- allocation exception, but it must not zero commission already earned from
-- separately purchase-attributed sales. It remains unallocated in machine
-- reporting/context and is never assigned to a current or replacement Technician.

alter function private.operator_machine_tax_commission_shared(
  uuid, uuid, uuid, date, date
)
  rename to operator_machine_tax_commission_shared_before_null_date_compat;

create function private.operator_machine_tax_commission_shared(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  calculation jsonb;
  has_unattributed_component boolean;
  has_unattributed_sale_or_unresolved_basis boolean;
  attributable_segments jsonb;
  attributable_totals record;
begin
  calculation := private.operator_machine_tax_commission_shared_before_null_date_compat(
    p_account_id,
    p_operator_profile_id,
    p_reporting_machine_id,
    p_period_start_date,
    p_period_end_date
  );

  select
    coalesce(bool_or(
      component.purchase_attribution_date is null
        and (
          component.recorded_sales_cents <> 0
          or component.request_deduction_ex_tax_cents <> 0
          or component.legacy_paid_deduction_ex_tax_cents <> 0
          or component.refund_reversal_ex_tax_cents <> 0
          or component.paid_context_ex_tax_cents <> 0
          or component.outstanding_context_ex_tax_cents <> 0
          or component.unresolved_sales_count > 0
          or component.unresolved_refund_count > 0
          or component.unresolved_paid_context_count > 0
        )
    ), false),
    coalesce(bool_or(
      component.purchase_attribution_date is null
        and (
          component.recorded_sales_cents <> 0
          or component.unresolved_sales_count > 0
          or component.unresolved_refund_count > 0
        )
    ), false)
  into has_unattributed_component, has_unattributed_sale_or_unresolved_basis
  from private.machine_sales_daily_components(
    p_reporting_machine_id,
    p_period_start_date,
    p_period_end_date
  ) component;

  if has_unattributed_component
    and not has_unattributed_sale_or_unresolved_basis
  then
    select
      coalesce(jsonb_agg(segment.value order by segment.ordinality), '[]'::jsonb)
    into attributable_segments
    from jsonb_array_elements(coalesce(calculation -> 'segments', '[]'::jsonb))
      with ordinality segment(value, ordinality)
    where segment.value ->> 'purchaseAttributionDate' is not null;

    select
      case when coalesce(bool_or(
        jsonb_typeof(segment.value -> 'grossSalesCents') is distinct from 'number'
      ), false) then null else
        coalesce(sum((segment.value ->> 'grossSalesCents')::bigint), 0)::bigint end
        as gross_sales_cents,
      case when coalesce(bool_or(
        jsonb_typeof(segment.value -> 'refundAdjustmentCents') is distinct from 'number'
      ), false) then null else
        coalesce(sum((segment.value ->> 'refundAdjustmentCents')::bigint), 0)::bigint end
        as refund_adjustment_cents,
      coalesce(sum((segment.value ->> 'refundRequestDeductionCents')::bigint), 0)::bigint
        as request_deduction_cents,
      coalesce(sum((segment.value ->> 'legacyPaidDeductionCents')::bigint), 0)::bigint
        as legacy_paid_deduction_cents,
      coalesce(sum((segment.value ->> 'refundReversalCents')::bigint), 0)::bigint
        as refund_reversal_cents,
      coalesce(sum((segment.value ->> 'refundPaidContextCents')::bigint), 0)::bigint
        as paid_context_cents,
      coalesce(sum((segment.value ->> 'refundOutstandingContextCents')::bigint), 0)::bigint
        as outstanding_context_cents,
      coalesce(sum((segment.value ->> 'unresolvedPaidContextCount')::bigint), 0)::bigint
        as unresolved_paid_context_count,
      case when coalesce(bool_or(
        jsonb_typeof(segment.value -> 'taxCents') is distinct from 'number'
      ), false) then null else
        coalesce(sum((segment.value ->> 'taxCents')::bigint), 0)::bigint end
        as tax_cents,
      case when coalesce(bool_or(
        jsonb_typeof(segment.value -> 'netRevenueCents') is distinct from 'number'
      ), false) then null else
        coalesce(sum((segment.value ->> 'netRevenueCents')::bigint), 0)::bigint end
        as net_revenue_cents,
      case when coalesce(bool_or(
        jsonb_typeof(segment.value -> 'commissionableSalesCents') is distinct from 'number'
      ), false) then null else
        coalesce(sum((segment.value ->> 'commissionableSalesCents')::bigint), 0)::bigint end
        as commissionable_sales_cents,
      coalesce(sum((segment.value ->> 'commissionEarningsCents')::bigint), 0)::bigint
        as commission_earnings_cents,
      coalesce(sum((segment.value ->> 'sourceSalesRowCount')::integer), 0)::integer
        as source_sales_row_count,
      coalesce(sum((segment.value ->> 'sourceAdjustmentRowCount')::integer), 0)::integer
        as source_adjustment_row_count,
      max((segment.value ->> 'sourceLatestSaleDate')::date)
        as source_latest_sale_date
    into attributable_totals
    from jsonb_array_elements(attributable_segments) segment(value);

    calculation := calculation || jsonb_build_object(
      'grossSalesCents', attributable_totals.gross_sales_cents,
      'refundAdjustmentCents', attributable_totals.refund_adjustment_cents,
      'refundRequestDeductionCents', attributable_totals.request_deduction_cents,
      'legacyPaidDeductionCents', attributable_totals.legacy_paid_deduction_cents,
      'refundReversalCents', attributable_totals.refund_reversal_cents,
      'refundPaidContextCents', attributable_totals.paid_context_cents,
      'refundOutstandingContextCents', attributable_totals.outstanding_context_cents,
      'unresolvedPaidContextCount', attributable_totals.unresolved_paid_context_count,
      'taxCents', attributable_totals.tax_cents,
      'netRevenueCents', attributable_totals.net_revenue_cents,
      'commissionableSalesCents', attributable_totals.commissionable_sales_cents,
      'commissionEarningsCents', attributable_totals.commission_earnings_cents,
      'commissionAllocationResolved', true,
      'sourceSalesRowCount', attributable_totals.source_sales_row_count,
      'sourceAdjustmentRowCount', attributable_totals.source_adjustment_row_count,
      'sourceLatestSaleDate', attributable_totals.source_latest_sale_date,
      'segments', attributable_segments
    );
  end if;

  return calculation;
end;
$$;

revoke all on function private.operator_machine_tax_commission_shared(
  uuid, uuid, uuid, date, date
) from public, anon, authenticated;
grant execute on function private.operator_machine_tax_commission_shared(
  uuid, uuid, uuid, date, date
) to service_role;

comment on function private.operator_machine_tax_commission_shared(
  uuid, uuid, uuid, date, date
) is
  'Shared commission calculation. Null-purchase-date non-sales rows stay in machine reporting but are excluded from Technician totals and segments; dated assigned sales and refunds retain their original Technician attribution. Missing sales/refund basis and unattributed sales remain unavailable.';

-- Restore the normal rollout-aware consumer after the temporary production
-- commission-only rollback. The rollout row and every recognition event remain
-- untouched.
create or replace function private.operator_machine_tax_commission(
  p_account_id uuid,
  p_operator_profile_id uuid,
  p_reporting_machine_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from private.refund_request_recognition_rollout rollout
    where rollout.singleton
      and rollout.activated_at is not null
  ) then private.operator_machine_tax_commission_shared(
    p_account_id,
    p_operator_profile_id,
    p_reporting_machine_id,
    p_period_start_date,
    p_period_end_date
  ) else private.operator_machine_tax_commission_before_shared_basis(
    p_account_id,
    p_operator_profile_id,
    p_reporting_machine_id,
    p_period_start_date,
    p_period_end_date
  ) end;
$$;

comment on function private.operator_machine_tax_commission(
  uuid, uuid, uuid, date, date
) is
  'Rollout-aware Technician commission consumer. Uses the reviewed legacy calculation before activation and the shared source-aware calculation after activation.';

select pg_notify('pgrst', 'reload schema');
