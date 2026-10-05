-- A reviewed legacy payout request remains current during customer wait.
-- The general Manager preparation status policy and all contact writers stay unchanged.
do $$
declare
  definition text := pg_get_functiondef(
    'public.refund_payout_destination_case_current(public.refund_cases)'::regprocedure);
begin
  if strpos(definition,'preparation := public.refund_manager_preparation_snapshot(')=0
    or strpos(definition,'link.correlation_attempt_id::text=preparation->>''proofId''')=0
    or strpos(definition,'public.refund_purchase_correction_eligible')=0 then
    raise exception 'Reviewed payout currentness source changed before customer-wait repair'
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
  case_row public.refund_cases%rowtype;
  cash_attempt public.refund_sunze_cash_correlation_attempts%rowtype;
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
    -- Customer wait is not Manager decision readiness. Retain the same
    -- current proof checks without changing the Manager preparation policy.
    select c.* into case_row from public.refund_cases c where c.id=p_case.id;
    if not found
      or case_row.official_action_version is distinct from p_case.official_action_version
      or case_row.deterministic_fact_version is distinct from p_case.deterministic_fact_version
      or case_row.decision is not null
      or case_row.status not in ('needs_review','waiting_on_customer')
      or case_row.refund_completed_at is not null
      or case_row.reporting_adjustment_id is not null
      or case_row.duplicate_of_refund_case_id is not null
      or public.refund_case_has_unresolved_reconciliation(case_row.id)
    then return false; end if;

    select attempt.* into cash_attempt
    from public.refund_sunze_cash_correlation_attempts attempt
    where attempt.refund_case_id=case_row.id
      and attempt.case_fact_version=case_row.deterministic_fact_version
      and attempt.policy_version='sunze_cash_correlation_v1'
      and attempt.source_snapshot_key=public.refund_current_sunze_cash_source_key(
        case_row.reporting_machine_id,case_row.incident_at,statement_timestamp())
      and attempt.invalidated_at is null
      and attempt.match_state in (
        'sale_found','multiple_possible_sales',
        'no_sale_found_with_complete_coverage','sales_history_unavailable')
    order by attempt.evaluated_at desc,attempt.id desc limit 1;
    -- Choose the latest proof before testing its positive state; an older
    -- selected sale must not override a newer unavailable/no-sale result.
    if not found
      or cash_attempt.match_state not in ('sale_found','multiple_possible_sales')
      or case_row.cash_match_evaluated_fact_version is distinct from case_row.deterministic_fact_version
      or case_row.cash_match_state is distinct from cash_attempt.match_state
    then return false; end if;

    if cash_attempt.source_snapshot_key like 'positive:%' then
      if not exists (
        select 1 from public.reporting_machines machine
        join public.reporting_locations location on location.id=machine.location_id
        where machine.id=case_row.reporting_machine_id and machine.status='active'
          and location.id=case_row.reporting_location_id and location.status='active'
          and location.timezone=case_row.incident_timezone
      ) then return false; end if;
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
        and link.correlation_attempt_id=cash_attempt.id
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
) is 'Current cash payout eligibility; historical empty research holds lift only for an explicit reviewed link with current cash attempt and source proof during customer wait. Contact authority and delivery budget remain enforced by existing writers.';

-- Continuing customer wait is not permission to rewrite a sent transport.
-- Valid event-bound receipt changes have already returned above this insertion;
-- retain satisfaction of the original request through the existing lower guard.
do $migration$
declare
  definition text := replace(pg_get_functiondef(
    'public.guard_refund_payout_destination_message()'::regprocedure),E'\r\n',E'\n');
  anchor text := $anchor$  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = new.refund_case_id
  for share;$anchor$;
  protection text := $guard$  if tg_op='UPDATE'
    and old.delivery_kind='manual'
    and old.message_type='more_info'
    and old.requested_fields=array['zelle_payment_contact']::text[]
    and old.manual_delivery_state='sent'
    and old.status in ('sent','failed')
    and old.sent_at is not null
    and old.delivery_transport='resend'
    and old.provider_message_id is not null
    and old.delivery_state in ('accepted','deferred','delivered','failed','bounced','complained')
    and (
      new.provider_message_id is distinct from old.provider_message_id
      or new.delivery_transport is distinct from old.delivery_transport
      or new.transactional_provider_message_header is distinct from old.transactional_provider_message_header
      or new.delivery_state is distinct from old.delivery_state
      or new.delivery_state_updated_at is distinct from old.delivery_state_updated_at
      or new.status is distinct from old.status
      or new.sent_at is distinct from old.sent_at
      or new.error_message is distinct from old.error_message
    ) then
    raise exception 'Sent protected payout receipt requires exact immutable provider evidence'
      using errcode='23514';
  end if;

$guard$;
begin
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
    or strpos(definition,'old.manual_delivery_state = ''sent''')=0
    or strpos(definition,'public.refund_transactional_delivery_state_rank')=0
    or strpos(definition,'header_event.applied_at is not null')=0 then
    raise exception 'Sent payout receipt guard changed before currentness repair'
      using errcode='P4681';
  end if;
  execute replace(definition,anchor,protection||anchor);
end;
$migration$;

select pg_notify('pgrst','reload schema');
