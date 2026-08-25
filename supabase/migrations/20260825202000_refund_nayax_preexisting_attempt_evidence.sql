-- #961: reconcile authoritative Nayax DTM refunds that completed after the
-- matched sale but before Bloomjoy recorded its later held provider attempt.
-- This remains a provider-free evidence action and records the timing
-- distinction explicitly instead of claiming the later Bloomjoy attempt caused
-- the successful refund.

alter table public.refund_nayax_resolution_intents
  drop constraint if exists refund_nayax_resolution_intents_reason_code_check,
  drop constraint if exists refund_nayax_resolution_intent_result_shape_check,
  add constraint refund_nayax_resolution_intents_reason_code_check check (
    reason_code in (
      'nayax_dtm_settled',
      'nayax_dtm_preexisting_settled',
      'nayax_support_confirmed_success',
      'nayax_dtm_not_refunded',
      'nayax_support_retry_safe',
      'manual_nayax_completion',
      'evidence_incomplete',
      'provider_still_pending',
      'evidence_conflict'
    )
  ),
  add constraint refund_nayax_resolution_intent_result_shape_check check (
    (
      resolution_result = 'provider_confirmed_success'
      and (
        (
          evidence_type = 'nayax_dtm_transaction'
          and reason_code in (
            'nayax_dtm_settled',
            'nayax_dtm_preexisting_settled'
          )
        )
        or (
          evidence_type = 'nayax_support_ticket'
          and reason_code = 'nayax_support_confirmed_success'
        )
      )
    )
    or (
      resolution_result = 'provider_confirmed_retry_safe'
      and (
        (
          evidence_type = 'nayax_dtm_transaction'
          and reason_code = 'nayax_dtm_not_refunded'
        )
        or (
          evidence_type = 'nayax_support_ticket'
          and reason_code = 'nayax_support_retry_safe'
        )
      )
    )
    or (
      resolution_result = 'documented_manual_completion'
      and evidence_type = 'documented_manual_refund'
      and reason_code = 'manual_nayax_completion'
    )
    or (
      resolution_result = 'remain_on_hold'
      and reason_code in (
        'evidence_incomplete',
        'provider_still_pending',
        'evidence_conflict'
      )
    )
  );

alter table public.refund_nayax_outcome_resolutions
  drop constraint if exists refund_nayax_outcome_resolution_result_shape_check,
  add constraint refund_nayax_outcome_resolution_result_shape_check check (
    (
      resolution_result = 'provider_confirmed_success'
      and (
        (
          evidence_type = 'nayax_dtm_transaction'
          and reason_code in (
            'nayax_dtm_settled',
            'nayax_dtm_preexisting_settled'
          )
        )
        or (
          evidence_type = 'nayax_support_ticket'
          and reason_code = 'nayax_support_confirmed_success'
        )
      )
    )
    or (
      resolution_result = 'provider_confirmed_retry_safe'
      and (
        (
          evidence_type = 'nayax_dtm_transaction'
          and reason_code = 'nayax_dtm_not_refunded'
        )
        or (
          evidence_type = 'nayax_support_ticket'
          and reason_code = 'nayax_support_retry_safe'
        )
      )
    )
    or (
      resolution_result = 'documented_manual_completion'
      and evidence_type = 'documented_manual_refund'
      and reason_code = 'manual_nayax_completion'
    )
    or (
      resolution_result = 'remain_on_hold'
      and evidence_type in ('nayax_dtm_transaction', 'nayax_support_ticket')
      and reason_code in (
        'evidence_incomplete',
        'provider_still_pending',
        'evidence_conflict'
      )
    )
  );

-- A single authoritative provider reference may close at most one case. The
-- resolver also emits a calm domain error; this index is the concurrency-safe
-- final boundary if two different cases race with the same evidence.
create unique index if not exists refund_nayax_resolution_one_success_evidence_idx
  on public.refund_nayax_outcome_resolutions (
    evidence_type,
    evidence_reference_digest
  )
  where resolution_result = 'provider_confirmed_success';

do $$
declare
  resolver_definition text;
  classification_anchor text := $anchor$  if p_evidence_occurred_at is not null$anchor$;
  classification_replacement text := $replacement$  if normalized_result = 'provider_confirmed_success'
    and normalized_type = 'nayax_dtm_transaction'
    and normalized_reason = 'nayax_dtm_settled'
    and attempt_row.execution_mode <> 'evidence_only'
    and p_evidence_occurred_at is not null
    and p_evidence_occurred_at < attempt_row.created_at
    and case_row.matched_nayax_machine_auth_time is not null
    and p_evidence_occurred_at >= case_row.matched_nayax_machine_auth_time then
    normalized_reason := 'nayax_dtm_preexisting_settled';
  end if;

  if p_evidence_occurred_at is not null$replacement$;
  historical_time_anchor text := $anchor$attempt_row.execution_mode <> 'evidence_only'
        and p_evidence_occurred_at < attempt_row.created_at$anchor$;
  historical_time_replacement text := $replacement$attempt_row.execution_mode <> 'evidence_only'
        and p_evidence_occurred_at < attempt_row.created_at
        and normalized_reason <> 'nayax_dtm_preexisting_settled'$replacement$;
  reference_anchor text := $anchor$  reference_digest := public.refund_nayax_resolution_reference_digest(
    normalized_reference
  );

  insert into public.refund_nayax_resolution_intents ($anchor$;
  reference_replacement text := $replacement$  reference_digest := public.refund_nayax_resolution_reference_digest(
    normalized_reference
  );

  if normalized_result = 'provider_confirmed_success'
    and exists (
      select 1
      from public.refund_nayax_outcome_resolutions existing_resolution
      where existing_resolution.resolution_result = 'provider_confirmed_success'
        and existing_resolution.evidence_type = normalized_type
        and existing_resolution.evidence_reference_digest = reference_digest
    ) then
    raise exception 'This provider evidence reference already completed another refund case';
  end if;

  insert into public.refund_nayax_resolution_intents ($replacement$;
  attempt_audit_anchor text := $anchor$        'evidence_action_time_present', true,
        'authorization_method', 'manager_session',$anchor$;
  attempt_audit_replacement text := $replacement$        'evidence_action_time_present', true,
        'support_resolution_reason_code', normalized_reason,
        'evidence_predated_bloomjoy_attempt',
          normalized_reason = 'nayax_dtm_preexisting_settled',
        'provider_call_made', false,
        'authorization_method', 'manager_session',$replacement$;
  completion_copy_anchor text := $anchor$      'We issued your ' ||
        to_char(case_row.refund_amount_cents::numeric / 100, 'FM$999999990.00') ||
        ' refund' ||
        case
          when case_row.matched_nayax_card_last4 ~ '^[0-9]{4}$'
            then ' to the card ending in ' || case_row.matched_nayax_card_last4
          else ''
        end ||
        ' on ' ||$anchor$;
  completion_copy_replacement text := $replacement$      case
        when normalized_reason = 'nayax_dtm_preexisting_settled'
          then 'Your '
        else 'We issued your '
      end ||
        to_char(case_row.refund_amount_cents::numeric / 100, 'FM$999999990.00') ||
        ' refund' ||
        case
          when case_row.matched_nayax_card_last4 ~ '^[0-9]{4}$'
            then ' to the card ending in ' || case_row.matched_nayax_card_last4
          else ''
        end ||
        case
          when normalized_reason = 'nayax_dtm_preexisting_settled'
            then ' was completed on '
          else ' on '
        end ||$replacement$;
  event_type_anchor text := $anchor$      when normalized_result = 'provider_confirmed_retry_safe'
        then 'nayax_support_resolution_retry_safe'
      else 'nayax_support_resolution_completed'$anchor$;
  event_type_replacement text := $replacement$      when normalized_result = 'provider_confirmed_retry_safe'
        then 'nayax_support_resolution_retry_safe'
      when normalized_reason = 'nayax_dtm_preexisting_settled'
        then 'nayax_preexisting_refund_reconciled'
      else 'nayax_support_resolution_completed'$replacement$;
  event_message_anchor text := $anchor$      when normalized_result = 'provider_confirmed_retry_safe'
        then 'Authoritative payment evidence released the hold to a fresh review. No provider call or customer message was made.'
      else 'Authoritative payment evidence recorded the refund, reporting adjustment, and one pending customer completion.'$anchor$;
  event_message_replacement text := $replacement$      when normalized_result = 'provider_confirmed_retry_safe'
        then 'Authoritative payment evidence released the hold to a fresh review. No provider call or customer message was made.'
      when normalized_reason = 'nayax_dtm_preexisting_settled'
        then 'Authoritative Nayax evidence proved the refund completed before Bloomjoy recorded its later held attempt. Reporting and one pending customer completion were recorded without a provider call.'
      else 'Authoritative payment evidence recorded the refund, reporting adjustment, and one pending customer completion.'$replacement$;
begin
  resolver_definition := pg_get_functiondef(
    'public.admin_resolve_refund_nayax_outcome_manager_session(uuid,uuid,text,text,text,timestamptz,text,bigint)'::regprocedure
  );
  -- Earlier migrations were authored on Windows, so PostgreSQL may preserve
  -- CRLF inside the stored function body. Normalize only the in-memory source
  -- copy before matching and replacing reviewed anchors.
  resolver_definition := replace(resolver_definition, E'\r\n', E'\n');

  if length(resolver_definition) - length(replace(
      resolver_definition,
      classification_anchor,
      ''
    )) <> length(classification_anchor)
    or length(resolver_definition) - length(replace(
      resolver_definition,
      historical_time_anchor,
      ''
    )) <> length(historical_time_anchor)
    or length(resolver_definition) - length(replace(
      resolver_definition,
      reference_anchor,
      ''
    )) <> length(reference_anchor)
    or length(resolver_definition) - length(replace(
      resolver_definition,
      attempt_audit_anchor,
      ''
    )) <> length(attempt_audit_anchor)
    or length(resolver_definition) - length(replace(
      resolver_definition,
      completion_copy_anchor,
      ''
    )) <> length(completion_copy_anchor)
    or length(resolver_definition) - length(replace(
      resolver_definition,
      event_type_anchor,
      ''
    )) <> length(event_type_anchor)
    or length(resolver_definition) - length(replace(
      resolver_definition,
      event_message_anchor,
      ''
    )) <> length(event_message_anchor) then
    raise exception 'Expected manager-session resolver anchors required';
  end if;

  resolver_definition := replace(
    resolver_definition,
    classification_anchor,
    classification_replacement
  );
  resolver_definition := replace(
    resolver_definition,
    historical_time_anchor,
    historical_time_replacement
  );
  resolver_definition := replace(
    resolver_definition,
    reference_anchor,
    reference_replacement
  );
  resolver_definition := replace(
    resolver_definition,
    attempt_audit_anchor,
    attempt_audit_replacement
  );
  resolver_definition := replace(
    resolver_definition,
    completion_copy_anchor,
    completion_copy_replacement
  );
  resolver_definition := replace(
    resolver_definition,
    event_type_anchor,
    event_type_replacement
  );
  resolver_definition := replace(
    resolver_definition,
    event_message_anchor,
    event_message_replacement
  );

  execute resolver_definition;
end;
$$;

comment on index public.refund_nayax_resolution_one_success_evidence_idx is
  'Prevents one authoritative provider evidence reference from completing more than one refund case, including concurrent manager actions.';

comment on function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz,
  text,
  bigint
) is
  'Records one mapped-manager payment-result decision without a provider call. Exact DTM success after the matched sale may predate a later held Bloomjoy attempt and is classified distinctly; references, reporting, and customer completion remain exactly once.';
