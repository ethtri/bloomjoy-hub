-- A configured machine must still belong to the case's reported location.
-- Keep the protected begin writer as the final gate for every lookup caller;
-- unresolved two-machine intake remains eligible until a machine is bound.
alter function public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)
  rename to service_begin_refund_nayax_lookup_pre_location_guard_v1;
revoke all on function public.service_begin_refund_nayax_lookup_pre_location_guard_v1(
  uuid,bigint,text,uuid) from public,anon,authenticated,service_role;

create function public.service_begin_refund_nayax_lookup(
  p_refund_case_id uuid,p_expected_fact_version bigint,p_trigger_source text,
  p_actor_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare case_row public.refund_cases;
begin
  if p_refund_case_id is null then
    raise exception 'Exact refund lookup context is required' using errcode='P4620';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-nayax-lookup-v1|'||p_refund_case_id::text,0));
  select * into case_row from public.refund_cases
    where id=p_refund_case_id for update;
  if case_row.id is null then
    raise exception 'Refund case not found' using errcode='P4620';
  end if;
  if case_row.reporting_machine_id is not null and not exists (
    select 1 from public.reporting_machines machine
    where machine.id=case_row.reporting_machine_id
      and machine.location_id=case_row.reporting_location_id
  ) then
    raise exception 'Current reported machine and location do not agree'
      using errcode='P4622';
  end if;
  return public.service_begin_refund_nayax_lookup_pre_location_guard_v1(
    p_refund_case_id,p_expected_fact_version,p_trigger_source,p_actor_user_id);
end;
$$;
revoke all on function public.service_begin_refund_nayax_lookup(
  uuid,bigint,text,uuid) from public,anon,authenticated;
grant execute on function public.service_begin_refund_nayax_lookup(
  uuid,bigint,text,uuid) to service_role;
comment on function public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid) is
  'Starts a guarded read-only Nayax lookup only when an assigned machine still belongs to the reported location; no payment authority.';

-- Preserve current lookup scheduling while excluding mismatched scope before
-- LIMIT and again under the case lock, so a bad row cannot starve due work.
-- Reuse the existing atomic case claimant for the canonical results_expired state.
-- Legacy completion events may be absent even though the lifecycle proves that
-- the current selectable evidence has expired. This refresh is read-only.

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
          and (public.refund_lifecycle_contract(c.id) -> 'lookup')
            @> '{"status":"results_expired","safeRetryEligible":true}'::jsonb
          and (
            c.nayax_lookup_status <> 'manual_exception'
            or (
              c.nayax_lookup_started_at is not null
              and c.nayax_lookup_correlation_digest ~ '^[a-f0-9]{64}$'
              and nullif(c.nayax_recommendation_policy_version, '') is not null
              and c.nayax_recommendation_policy_version <> 'manual-nayax-portal-v1'
              and not exists (
                select 1 from public.refund_case_events manual_event
                where manual_event.refund_case_id = c.id
                  and manual_event.event_type in (
                    'manual_nayax_evidence_entered',
                    'nayax_match_preselection_disputed'
                  )
                  and manual_event.created_at >= c.nayax_lookup_finished_at
              )
            )
          )
        )
      )
      and c.reporting_location_id is not null
      and (c.reporting_machine_id is null or exists (
        select 1 from public.reporting_machines scope_machine
        where scope_machine.id=c.reporting_machine_id
          and scope_machine.location_id=c.reporting_location_id))
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
          and (public.refund_lifecycle_contract(c.id) -> 'lookup')
            @> '{"status":"results_expired","safeRetryEligible":true}'::jsonb
          and (
            c.nayax_lookup_status <> 'manual_exception'
            or (
              c.nayax_lookup_started_at is not null
              and c.nayax_lookup_correlation_digest ~ '^[a-f0-9]{64}$'
              and nullif(c.nayax_recommendation_policy_version, '') is not null
              and c.nayax_recommendation_policy_version <> 'manual-nayax-portal-v1'
              and not exists (
                select 1 from public.refund_case_events manual_event
                where manual_event.refund_case_id = c.id
                  and manual_event.event_type in (
                    'manual_nayax_evidence_entered',
                    'nayax_match_preselection_disputed'
                  )
                  and manual_event.created_at >= c.nayax_lookup_finished_at
              )
            )
          )
        )
      )
      and c.reporting_location_id is not null
      and (c.reporting_machine_id is null or exists (
        select 1 from public.reporting_machines scope_machine
        where scope_machine.id=c.reporting_machine_id
          and scope_machine.location_id=c.reporting_location_id))
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
  'Claims due read-only work directly from refund_cases, including canonically expired results without relying on a legacy completion event. Manual portal evidence and every payment-authority path remain excluded.';



-- A source-bound reply that supplies directional purchase evidence may require
-- one fresh provider read even when the previous lookup ended in no_match.
-- Reuse the existing Nayax begin/persist worker; this claimant cannot pay.
create or replace function public.service_claim_due_refund_reply_nayax_lookups(
  p_limit integer default 2
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  due record;
  case_row public.refund_cases;
  ctx public.refund_wallet_correction_contexts;
  source public.refund_gmail_messages;
  result jsonb;
  claims jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit not between 1 and 4 then
    raise exception 'Reply research claim limit must be between 1 and 4'
      using errcode='22023';
  end if;
  for due in
    select r.id request_id,c.id case_id
    from public.refund_wallet_correction_contexts r
    join public.refund_cases c on c.id=r.refund_case_id
    join public.refund_gmail_messages m on m.id=r.reply_message_id
    join public.reporting_machines machine on machine.id=c.reporting_machine_id
    where r.correction_kind='purchase'
      and (r.status='pending' or (r.status='submitted'
        and r.reply_review_result_code='inexact_purchase_time_requires_research'))
      and r.reply_review_state='resolved'
      and r.reply_lookup_generation is null
      and r.reply_review_result_code in (
        'customer_cannot_provide','no_supported_new_fact',
        'conflicting_reply_evidence','inexact_purchase_time_requires_research',
        'wallet_token_requires_research')
      and r.reply_review_action_version=c.official_action_version
      and r.correction_fact_version=c.deterministic_fact_version
      and r.reply_received_at is not null
      and r.reply_body_sha256=public.refund_scoped_verified_reply_set(r.id)->>'bodySha256'
      and m.refund_case_id=c.id and m.direction='inbound'
      and m.status='received' and m.participant_role='customer'
      and m.participant_trust='verified' and m.content_deleted_at is null
      and m.sensitive_data_redacted is false
      and m.received_at=r.reply_received_at
      and c.payment_method='card' and c.decision is null
      and c.status in ('submitted','needs_review','correlated')
      and public.refund_purchase_correction_eligible(c)
      and c.reporting_location_id is not null
      and c.incident_at is not null and c.incident_time_resolution is not null
      and c.payment_amount_cents>0
      and c.matched_nayax_transaction_id is null
      and c.nayax_refund_execution_status='not_requested'
      and c.refund_completed_at is null
      and c.reporting_adjustment_id is null
      and c.manual_refund_reference is null
      and c.duplicate_of_refund_case_id is null
      and not public.refund_case_has_unresolved_reconciliation(c.id)
      and not exists (select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id=c.id)
      and not exists (select 1 from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id=c.id)
      and machine.status='active'
      and machine.location_id=c.reporting_location_id
      and machine.nayax_manual_portal_enabled is not true
      and nullif(btrim(machine.nayax_machine_id),'') is not null
      and nullif(btrim(machine.nayax_account_key),'') is not null
      and (c.nayax_lookup_status='not_started' or (
        c.nayax_lookup_status in ('no_match','match_found','multiple_matches')
        and c.nayax_lookup_finished_at is not null
        and c.nayax_lookup_started_at is not null
        and c.nayax_lookup_started_at<=r.reply_received_at
        and c.nayax_lookup_correlation_digest ~ '^[a-f0-9]{64}$'
        and nullif(c.nayax_recommendation_policy_version,'') is not null
        and c.nayax_recommendation_policy_version<>'manual-nayax-portal-v1'))
    order by r.reply_received_at,r.id
    limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'refund-nayax-lookup-v1|'||due.case_id::text,0)) then
      continue;
    end if;
    select * into case_row from public.refund_cases where id=due.case_id for update;
    select * into ctx from public.refund_wallet_correction_contexts
      where id=due.request_id for update;
    select * into source from public.refund_gmail_messages
      where id=ctx.reply_message_id for update;
    -- Under the case lock, recheck the reply identity and read scope. The
    -- selector above contains all stable safety predicates before LIMIT.
    if case_row.id is null or ctx.id is null
      or not (ctx.status='pending' or (ctx.status='submitted'
        and ctx.reply_review_result_code='inexact_purchase_time_requires_research'))
      or ctx.reply_review_state is distinct from 'resolved'
      or ctx.reply_lookup_generation is not null
      or coalesce(ctx.reply_review_result_code,'') not in (
        'customer_cannot_provide','no_supported_new_fact',
        'conflicting_reply_evidence','inexact_purchase_time_requires_research',
        'wallet_token_requires_research')
      or ctx.reply_review_action_version is distinct from case_row.official_action_version
      or ctx.correction_fact_version is distinct from case_row.deterministic_fact_version
      or ctx.reply_body_sha256 is distinct from
        public.refund_scoped_verified_reply_set(ctx.id)->>'bodySha256'
      or source.id is null or source.refund_case_id is distinct from case_row.id
      or source.direction is distinct from 'inbound'
      or source.status is distinct from 'received'
      or source.participant_role is distinct from 'customer'
      or source.participant_trust is distinct from 'verified'
      or source.content_deleted_at is not null
      or source.sensitive_data_redacted is distinct from false
      or source.received_at is distinct from ctx.reply_received_at
      or case_row.decision is not null
      or not public.refund_purchase_correction_eligible(case_row)
      or case_row.payment_method is distinct from 'card'
      or coalesce(case_row.status,'') not in ('submitted','needs_review','correlated')
      or case_row.reporting_location_id is null or case_row.incident_at is null
      or case_row.incident_time_resolution is null or coalesce(case_row.payment_amount_cents,0)<=0
      or case_row.matched_nayax_transaction_id is not null
      or case_row.nayax_refund_execution_status is distinct from 'not_requested'
      or case_row.refund_completed_at is not null
      or case_row.reporting_adjustment_id is not null
      or case_row.manual_refund_reference is not null
      or case_row.duplicate_of_refund_case_id is not null
      or not (coalesce(case_row.nayax_lookup_status,'')='not_started' or (
        coalesce(case_row.nayax_lookup_status,'') in ('no_match','match_found','multiple_matches')
        and case_row.nayax_lookup_finished_at is not null
        and case_row.nayax_lookup_started_at is not null
        and case_row.nayax_lookup_started_at<=ctx.reply_received_at
        and coalesce(case_row.nayax_lookup_correlation_digest,'') ~ '^[a-f0-9]{64}$'
        and nullif(case_row.nayax_recommendation_policy_version,'') is not null
        and case_row.nayax_recommendation_policy_version<>'manual-nayax-portal-v1'))
      or exists (select 1 from public.refund_case_nayax_refund_attempts a
        where a.refund_case_id=case_row.id)
      or exists (select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id=case_row.id)
      or public.refund_case_has_unresolved_reconciliation(case_row.id)
      or not exists (select 1 from public.reporting_machines machine
        where machine.id=case_row.reporting_machine_id and machine.status='active'
          and machine.location_id=case_row.reporting_location_id
          and machine.nayax_manual_portal_enabled is not true
          and nullif(btrim(machine.nayax_machine_id),'') is not null
          and nullif(btrim(machine.nayax_account_key),'') is not null)
    then continue; end if;
    result:=public.service_begin_refund_nayax_lookup(
      case_row.id,case_row.deterministic_fact_version,'scheduled',null);
    if result->>'status'='checking' then
      update public.refund_wallet_correction_contexts set
        reply_lookup_generation=(result->>'lookupGeneration')::bigint,
        reply_review_action_version=(select official_action_version
          from public.refund_cases where id=case_row.id),
        updated_at=statement_timestamp()
        where id=ctx.id and reply_lookup_generation is null;
      claims:=claims||jsonb_build_array(jsonb_build_object(
        'caseId',case_row.id,'factVersion',case_row.deterministic_fact_version,
        'lookupGeneration',(result->>'lookupGeneration')::bigint,
        'retryCount',case_row.nayax_lookup_retry_count,
        'source','verified_reply_research',
        'directionalEvidence',ctx.reply_directional_evidence,
        'payloadRedacted',true));
    end if;
  end loop;
  return claims;
end;
$$;
revoke all on function public.service_claim_due_refund_reply_nayax_lookups(integer)
  from public,anon,authenticated;
grant execute on function public.service_claim_due_refund_reply_nayax_lookups(integer)
  to service_role;
comment on function public.service_claim_due_refund_reply_nayax_lookups(integer) is
  'Claims one new read-only Nayax generation for verified same-request reply research only within current machine-location scope. Uses the existing provider worker and does not grant payment authority.';

select pg_notify('pgrst','reload schema');

