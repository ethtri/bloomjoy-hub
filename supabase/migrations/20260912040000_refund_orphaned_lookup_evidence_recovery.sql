-- Completed automatic lookup evidence is durable now, but a small set of
-- legacy cases lost their short-lived candidate rows before that boundary was
-- introduced. Treat those cases as due work on the case itself so the normal
-- read-only worker refreshes them once. Manual Nayax portal evidence remains
-- intentionally outside automatic recovery.

create index if not exists refund_cases_nayax_lookup_orphan_due_idx
  on public.refund_cases (
    nayax_lookup_status,
    nayax_lookup_finished_at,
    created_at,
    id
  )
  where payment_method = 'card'
    and decision is null
    and status in ('submitted','needs_review','correlated')
    and nayax_lookup_status in ('match_found','multiple_matches','manual_exception');

create or replace function public.service_claim_due_refund_nayax_lookups(
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_id uuid;
  case_row public.refund_cases%rowtype;
  begin_result jsonb;
  claims jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'Lookup claim limit must be between 1 and 25'
      using errcode = '22023';
  end if;

  perform public.service_recover_stale_refund_nayax_lookups();

  for candidate_id in
    select c.id
    from public.refund_cases c
    where c.payment_method = 'card'
      and c.status in ('submitted','needs_review','correlated')
      and c.decision is null
      and (
        c.nayax_lookup_status = 'not_started'
        or (
          c.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
          and c.nayax_lookup_safe_retry_eligible
          and c.nayax_lookup_retry_count < 1
          and c.nayax_lookup_finished_at <= statement_timestamp() - interval '2 minutes'
        )
        or (
          c.nayax_lookup_status in ('match_found','multiple_matches','manual_exception')
          and c.nayax_lookup_finished_at is not null
          and exists (
            select 1
            from public.reporting_machines machine
            where machine.id = c.reporting_machine_id
              and machine.nayax_manual_portal_enabled is not true
          )
          and not exists (
            select 1
            from public.refund_nayax_lookup_candidates lookup_candidate
            where lookup_candidate.refund_case_id = c.id
              and lookup_candidate.lookup_generation = c.nayax_lookup_generation
              and lookup_candidate.expires_at > statement_timestamp()
          )
          and (
            c.nayax_lookup_status <> 'manual_exception'
            or exists (
              select 1
              from public.refund_case_events completed_event
              where completed_event.refund_case_id = c.id
                and completed_event.event_type = 'nayax_lookup_completed'
                and completed_event.metadata ->> 'lookup_generation' ~ '^[0-9]+$'
                and (completed_event.metadata ->> 'lookup_generation')::bigint =
                  c.nayax_lookup_generation
                and completed_event.metadata ->> 'candidate_count' ~ '^[0-9]+$'
                and (completed_event.metadata ->> 'candidate_count')::integer > 0
            )
          )
        )
      )
      and c.reporting_location_id is not null
      and (c.reporting_machine_id is not null or (
        c.intake_selection_kind = 'livermore_pair'
        and c.intake_selection_key is not null
        and coalesce(array_length(c.intake_selection_machine_ids, 1), 0) = 2
      ))
      and c.incident_at is not null
      and c.incident_time_resolution is not null
      and c.payment_amount_cents > 0
      and (c.card_wallet_used or c.card_last4 ~ '^[0-9]{4}$')
      and c.matched_nayax_transaction_id is null
      and c.nayax_refund_execution_status = 'not_requested'
      and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.manual_refund_reference is null
      and c.duplicate_of_refund_case_id is null
      and not public.refund_case_has_unresolved_reconciliation(c.id)
      and not exists (
        select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = c.id
      )
      and not exists (
        select 1 from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = c.id
      )
    order by
      case
        when c.nayax_lookup_status = 'not_started'
          then coalesce(c.deterministic_facts_updated_at,c.created_at)
        else c.nayax_lookup_finished_at + interval '2 minutes'
      end,
      c.created_at,
      c.id
    limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'refund-nayax-lookup-v1|' || candidate_id::text, 0
    )) then
      continue;
    end if;

    case_row := null;
    select c.* into case_row
    from public.refund_cases c
    where c.id = candidate_id
      and c.payment_method = 'card'
      and c.status in ('submitted','needs_review','correlated')
      and c.decision is null
      and (
        c.nayax_lookup_status = 'not_started'
        or (
          c.nayax_lookup_status in ('lookup_failed','lookup_timed_out')
          and c.nayax_lookup_safe_retry_eligible
          and c.nayax_lookup_retry_count < 1
          and c.nayax_lookup_finished_at <= statement_timestamp() - interval '2 minutes'
        )
        or (
          c.nayax_lookup_status in ('match_found','multiple_matches','manual_exception')
          and c.nayax_lookup_finished_at is not null
          and exists (
            select 1
            from public.reporting_machines machine
            where machine.id = c.reporting_machine_id
              and machine.nayax_manual_portal_enabled is not true
          )
          and not exists (
            select 1
            from public.refund_nayax_lookup_candidates lookup_candidate
            where lookup_candidate.refund_case_id = c.id
              and lookup_candidate.lookup_generation = c.nayax_lookup_generation
              and lookup_candidate.expires_at > statement_timestamp()
          )
          and (
            c.nayax_lookup_status <> 'manual_exception'
            or exists (
              select 1
              from public.refund_case_events completed_event
              where completed_event.refund_case_id = c.id
                and completed_event.event_type = 'nayax_lookup_completed'
                and completed_event.metadata ->> 'lookup_generation' ~ '^[0-9]+$'
                and (completed_event.metadata ->> 'lookup_generation')::bigint =
                  c.nayax_lookup_generation
                and completed_event.metadata ->> 'candidate_count' ~ '^[0-9]+$'
                and (completed_event.metadata ->> 'candidate_count')::integer > 0
            )
          )
        )
      )
      and c.reporting_location_id is not null
      and (c.reporting_machine_id is not null or (
        c.intake_selection_kind = 'livermore_pair'
        and c.intake_selection_key is not null
        and coalesce(array_length(c.intake_selection_machine_ids, 1), 0) = 2
      ))
      and c.incident_at is not null
      and c.incident_time_resolution is not null
      and c.payment_amount_cents > 0
      and (c.card_wallet_used or c.card_last4 ~ '^[0-9]{4}$')
      and c.matched_nayax_transaction_id is null
      and c.nayax_refund_execution_status = 'not_requested'
      and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.manual_refund_reference is null
      and c.duplicate_of_refund_case_id is null
      and not public.refund_case_has_unresolved_reconciliation(c.id)
      and not exists (
        select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = c.id
      )
      and not exists (
        select 1 from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id = c.id
      )
    for update of c skip locked;

    if not found then
      continue;
    end if;

    begin_result := public.service_begin_refund_nayax_lookup(
      case_row.id,
      case_row.deterministic_fact_version,
      'scheduled',
      null
    );

    if begin_result ->> 'status' = 'checking' then
      claims := claims || jsonb_build_array(jsonb_build_object(
        'caseId', case_row.id,
        'factVersion', case_row.deterministic_fact_version,
        'lookupGeneration', (begin_result ->> 'lookupGeneration')::bigint,
        'retryCount', case
          when coalesce((begin_result ->> 'safeRetryConsumed')::boolean,false)
            then case_row.nayax_lookup_retry_count + 1
          else case_row.nayax_lookup_retry_count
        end,
        'payloadRedacted', true
      ));
    end if;
  end loop;

  return claims;
end;
$$;

revoke all on function public.service_claim_due_refund_nayax_lookups(integer)
  from public, anon, authenticated;
grant execute on function public.service_claim_due_refund_nayax_lookups(integer)
  to service_role;

comment on function public.service_claim_due_refund_nayax_lookups(integer) is
  'Claims due read-only work directly from refund_cases, including legacy automatic results whose selectable evidence is missing. Manual portal evidence and every payment-authority path remain excluded.';

select pg_notify('pgrst', 'reload schema');
