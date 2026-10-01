-- A historical empty research cycle is not a current purchase verdict. Keep
-- its suppression until an explicit reviewed cash link has current proof.
do $$
declare
  definition text := pg_get_functiondef(
    'public.refund_payout_destination_case_current(public.refund_cases)'::regprocedure);
begin
  if strpos(definition,'public.refund_follow_up_cycles')=0
    or strpos(definition,'public.refund_purchase_correction_eligible')=0
    or strpos(definition,'refund_manager_preparation_snapshot')<>0 then
    raise exception 'Payout eligibility source changed before reviewed selection repair'
      using errcode='P4681';
  end if;
end
$$;

create or replace function public.refund_payout_destination_case_current(
  p_case public.refund_cases
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preparation jsonb;
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
    select 1 from public.refund_follow_up_cycles cycle
    where cycle.refund_case_id=p_case.id
      and cycle.case_fact_version=p_case.deterministic_fact_version
      and cycle.reason_code='no_safe_match'
      and cardinality(cycle.requested_fields)=0
  ) then
    if p_case.resolution_method is distinct from 'original_payment' then
      return false;
    end if;
    preparation := public.refund_manager_preparation_snapshot(
      p_case.id,p_case.official_action_version);
    if coalesce(preparation->>'evidenceBasis','') not in (
      'cash_sale_found','cash_multiple_reviewed'
    ) then
      return false;
    end if;

    return exists (
      select 1 from public.refund_sunze_cash_sale_links link
      join public.refund_sunze_cash_correlation_candidates candidate
        on candidate.attempt_id=link.correlation_attempt_id
        and candidate.sales_fact_id=link.sales_fact_id
      where link.refund_case_id=p_case.id
        and link.released_at is null
        and link.link_origin='reviewed'
        and link.case_fact_version=p_case.deterministic_fact_version
        and link.sales_fact_id=p_case.matched_sales_fact_id
        and candidate.selection_conflict is false
        and link.correlation_attempt_id::text=preparation->>'proofId'
    );
  end if;

  return true;
end;
$$;

revoke all on function public.refund_payout_destination_case_current(
  public.refund_cases
) from public, anon, authenticated, service_role;

comment on function public.refund_payout_destination_case_current(
  public.refund_cases
) is 'Current cash payout eligibility; historical empty research holds lift only for an explicit reviewed link with current preparation and source proof. Contact authority and delivery budget remain enforced by existing writers.';

select pg_notify('pgrst','reload schema');
