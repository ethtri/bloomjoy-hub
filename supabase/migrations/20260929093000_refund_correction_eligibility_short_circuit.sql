-- SQL boolean expressions may be reordered by the planner. The current
-- correction and payout predicates therefore reached receipt/attempt checks
-- even for closed, non-customer, or unrelated payment cases. Preserve the
-- exact allow conditions while making the cheap rejection order explicit.

do $$
declare
  correction_source text := pg_get_functiondef(
    'public.refund_purchase_correction_eligible(public.refund_cases)'
      ::regprocedure);
  payout_source text := pg_get_functiondef(
    'public.refund_payout_destination_case_current(public.refund_cases)'
      ::regprocedure);
begin
  if strpos(correction_source,'public.refund_authoritative_receipts')=0
    or strpos(correction_source,'public.refund_case_nayax_refund_attempts')=0
    or strpos(correction_source,'''cash_zelle_pending''')=0 then
    raise exception 'Correction eligibility source changed before short circuit'
      using errcode='P4680';
  end if;

  if (length(payout_source)-length(replace(payout_source,
      'public.refund_purchase_correction_eligible(','')))
      /length('public.refund_purchase_correction_eligible(') <> 1
    or strpos(payout_source,'public.refund_follow_up_cycles')=0 then
    raise exception 'Payout eligibility source changed before short circuit'
      using errcode='P4681';
  end if;
end
$$;

create or replace function public.refund_purchase_correction_eligible(
  p_case public.refund_cases
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_case.case_population is distinct from 'customer' then
    return false;
  end if;

  if not coalesce(
    p_case.status in ('draft','needs_review','waiting_on_customer')
      or (
        p_case.status='cash_zelle_pending'
        and p_case.decision='approved'
        and p_case.payment_method='cash'
      ),
    false
  ) then
    return false;
  end if;

  if p_case.decision is not null
    and not (
      p_case.decision='approved'
      and p_case.payment_method='cash'
      and nullif(btrim(p_case.zelle_payment_contact),'') is null
    ) then
    return false;
  end if;

  if not coalesce(
    p_case.nayax_refund_execution_status in (
      'not_requested','ready','disabled','failed','declined'
    ),
    false
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.refund_authoritative_receipts receipt
    where receipt.refund_case_id=p_case.id
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.refund_case_nayax_refund_attempts attempt
    where attempt.refund_case_id=p_case.id
      and (
        attempt.reconciliation_required
        or attempt.status in (
          'in_progress','requested','approved','ambiguous','manual_review'
        )
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.refund_purchase_correction_eligible(
  public.refund_cases
) from public, anon, authenticated, service_role;

create or replace function public.refund_payout_destination_case_current(
  p_case public.refund_cases
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_case.payment_method is distinct from 'cash' then
    return false;
  end if;

  if p_case.decision='approved' then
    return true;
  end if;

  if p_case.decision is not null
    or p_case.status not in ('needs_review','waiting_on_customer')
    or coalesce(p_case.payment_amount_cents,0)<=0 then
    return false;
  end if;

  if public.refund_purchase_correction_eligible(p_case) is not true then
    return false;
  end if;

  if exists (
    select 1
    from public.refund_follow_up_cycles cycle
    where cycle.refund_case_id=p_case.id
      and cycle.case_fact_version=p_case.deterministic_fact_version
      and cycle.reason_code='no_safe_match'
      and cardinality(cycle.requested_fields)=0
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.refund_payout_destination_case_current(
  public.refund_cases
) from public, anon, authenticated, service_role;

comment on function public.refund_purchase_correction_eligible(
  public.refund_cases
) is
  'Fail-closed current correction eligibility with explicit cheap case-state rejection before receipt and attempt checks.';

comment on function public.refund_payout_destination_case_current(
  public.refund_cases
) is
  'Total current cash payout-destination eligibility with explicit state and amount rejection before correction research.';

select pg_notify('pgrst','reload schema');
