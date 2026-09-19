-- Recover only legacy manager selections whose current saved candidate still
-- proves the same top-ranked, recommended transaction. This adds audit proof;
-- it never approves or issues a refund.

create or replace function public.service_recover_safe_legacy_refund_selection_proofs_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovered_count integer := 0;
begin
  with recoverable as (
    select
      c.id as refund_case_id,
      c.nayax_lookup_generation as lookup_generation,
      c.deterministic_fact_version,
      k.token as candidate_token,
      public.refund_nayax_candidate_evidence_hash(
        k.refund_case_id,
        k.actor_user_id,
        k.provider_transaction_id,
        k.site_id,
        k.machine_authorization_time,
        k.amount_cents,
        k.card_last4,
        k.currency_code,
        k.evidence_summary,
        k.expires_at,
        k.created_at
      ) as candidate_evidence_hash,
      e.id as source_event_id,
      e.created_at as source_event_created_at
    from public.refund_cases c
    join public.refund_nayax_lookup_candidates k
      on k.refund_case_id = c.id
      and k.lookup_generation = c.nayax_lookup_generation
      and k.reporting_machine_id = c.reporting_machine_id
      and k.provider_transaction_id is not distinct from c.matched_nayax_transaction_id
      and k.site_id is not distinct from c.matched_nayax_site_id
      and k.machine_authorization_time is not distinct from c.matched_nayax_machine_auth_time
      and k.amount_cents is not distinct from c.matched_nayax_amount_cents
      and k.card_last4 is not distinct from c.matched_nayax_card_last4
      and k.currency_code is not distinct from c.matched_nayax_currency_code
    join public.refund_case_events e
      on e.refund_case_id = c.id
      and e.event_type = 'nayax_match_selected'
      and e.actor_user_id is not null
    where c.case_population = 'customer'
      and c.status in ('needs_review', 'correlated')
      and c.decision is null
      and c.nayax_refund_execution_status = 'not_requested'
      and c.reporting_adjustment_id is null
      and c.refund_completed_at is null
      and c.correlation_status = 'matched'
      and c.correlation_source = 'nayax'
      and c.nayax_match_execution_eligible
      and c.nayax_recommendation_policy_version is not null
      and public.is_review_safe_nayax_transaction_reference(c.matched_nayax_transaction_id)
      and c.matched_nayax_site_id is not null
      and c.matched_nayax_machine_auth_time is not null
      and c.matched_nayax_amount_cents is not null
      and c.matched_nayax_amount_cents > 0
      and c.matched_nayax_currency_code = 'USD'
      and c.refund_amount_cents = c.matched_nayax_amount_cents
      and not public.refund_case_has_unresolved_reconciliation(c.id)
      and not exists (
        select 1
        from public.refund_cases other
        where other.id <> c.id
          and other.matched_nayax_transaction_id = c.matched_nayax_transaction_id
      )
      and coalesce(k.evidence_summary ->> 'source', '') <> 'manual_nayax_portal'
      and k.evidence_summary ->> 'selection_allowed' = 'true'
      and k.evidence_summary ->> 'is_recommended' = 'true'
      and k.evidence_summary ->> 'is_top_ranked' = 'true'
      and k.evidence_summary ->> 'recommendation_rank' = '1'
      and k.evidence_summary ->> 'payment_status' = 'approved'
      and k.evidence_summary ->> 'provider_refund_state' = 'clear'
      and coalesce((k.evidence_summary ->> 'duplicate_provider_record')::boolean, false) = false
      and coalesce(k.evidence_summary -> 'hard_exclusions', '[]'::jsonb) = '[]'::jsonb
      and coalesce(k.evidence_summary ->> 'customer_fact_version', '') ~ '^[0-9]+$'
      and (k.evidence_summary ->> 'customer_fact_version')::bigint = c.deterministic_fact_version
      and k.evidence_summary ->> 'policy_version' = c.nayax_recommendation_policy_version
      and public.refund_nayax_candidate_identifier_evidence_state(
        k.refund_case_id,
        k.reporting_machine_id,
        k.site_id,
        k.machine_authorization_time,
        k.amount_cents,
        k.card_last4,
        k.currency_code,
        k.evidence_summary
      ) = 'valid'
      and e.created_at < timestamptz '2026-09-13 09:00:00+00'
      and not (e.metadata ? 'candidate_token')
      and not (e.metadata ? 'candidate_evidence_hash')
      and not (e.metadata ? 'lookup_generation')
      and not (e.metadata ? 'deterministic_fact_version')
      and e.metadata ->> 'policy_version' = k.evidence_summary ->> 'policy_version'
      and e.metadata ->> 'selected_rank' = k.evidence_summary ->> 'recommendation_rank'
      and e.metadata ->> 'scorer_recommendation_state' =
        k.evidence_summary ->> 'recommendation_state'
      and e.metadata ->> 'execution_eligible' = 'true'
      and e.metadata ->> 'provider_call_made' = 'false'
      and e.metadata ->> 'customer_message_created' = 'false'
      and coalesce(e.metadata ->> 'manual_portal_candidate', 'false') = 'false'
      and 1 = (
        select count(*)
        from public.refund_case_events legacy_event
        where legacy_event.refund_case_id = c.id
          and legacy_event.event_type = 'nayax_match_selected'
          and legacy_event.actor_user_id is not null
          and legacy_event.created_at < timestamptz '2026-09-13 09:00:00+00'
          and not (legacy_event.metadata ? 'candidate_token')
      )
      and 1 = (
        select count(*)
        from public.refund_nayax_lookup_candidates candidate_count
        where candidate_count.refund_case_id = c.id
          and candidate_count.lookup_generation = c.nayax_lookup_generation
          and candidate_count.reporting_machine_id = c.reporting_machine_id
          and candidate_count.provider_transaction_id is not distinct from c.matched_nayax_transaction_id
          and candidate_count.site_id is not distinct from c.matched_nayax_site_id
          and candidate_count.machine_authorization_time is not distinct from c.matched_nayax_machine_auth_time
          and candidate_count.amount_cents is not distinct from c.matched_nayax_amount_cents
          and candidate_count.card_last4 is not distinct from c.matched_nayax_card_last4
          and candidate_count.currency_code is not distinct from c.matched_nayax_currency_code
      )
      and not exists (
        select 1
        from public.refund_case_events recovered
        where recovered.refund_case_id = c.id
          and recovered.event_type = 'nayax_match_selection_proof_recovered'
      )
  ), inserted as (
    insert into public.refund_case_events (
      refund_case_id,
      actor_user_id,
      event_type,
      message,
      metadata
    )
    select
      recoverable.refund_case_id,
      null,
      'nayax_match_selection_proof_recovered',
      'System restored verifiable transaction-selection proof from the saved candidate and original manager audit event. No refund was approved or issued.',
      jsonb_build_object(
        'candidate_token', recoverable.candidate_token,
        'candidate_evidence_hash', recoverable.candidate_evidence_hash,
        'lookup_generation', recoverable.lookup_generation,
        'deterministic_fact_version', recoverable.deterministic_fact_version,
        'source_selection_event_digest', encode(
          extensions.digest(
            convert_to(recoverable.source_event_id::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ),
        'source_selection_created_at', recoverable.source_event_created_at,
        'recovery_contract_version', 'refund_legacy_selection_proof_recovery_v1',
        'execution_eligible', true,
        'provider_call_made', false,
        'approval_created', false,
        'customer_message_created', false,
        'payload_redacted', true
      )
    from recoverable
    returning id
  )
  select count(*) into recovered_count from inserted;

  return jsonb_build_object(
    'schemaVersion', 'refund_legacy_selection_proof_recovery_v1',
    'recoveredCount', recovered_count,
    'providerCallMade', false,
    'approvalCreated', false,
    'customerMessageCreated', false,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_recover_safe_legacy_refund_selection_proofs_v1()
  from public, anon, authenticated, service_role;

create or replace function public.refund_case_nayax_manager_readiness(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.refund_cases%rowtype;
  machine public.reporting_machines%rowtype;
  transaction_confirmed boolean := false;
  block_reason text := null;
begin
  select * into c from public.refund_cases where id = p_refund_case_id;
  if not found then
    return jsonb_build_object(
      'transactionConfirmed', false,
      'approvalContinuationReady', false,
      'canIssueCardRefund', false,
      'blockReason', 'case_not_found',
      'refundAmountCents', null,
      'machineLimitCents', null,
      'caseVersion', null
    );
  end if;

  if c.reporting_machine_id is not null then
    select * into machine
    from public.reporting_machines
    where id = c.reporting_machine_id;
  end if;

  transaction_confirmed := c.correlation_status = 'matched'
    and c.correlation_source = 'nayax'
    and c.nayax_match_execution_eligible
    and c.nayax_recommendation_policy_version is not null
    and public.is_review_safe_nayax_transaction_reference(c.matched_nayax_transaction_id)
    and c.matched_nayax_site_id is not null
    and c.matched_nayax_machine_auth_time is not null
    and c.matched_nayax_amount_cents is not null
    and c.matched_nayax_amount_cents > 0
    and c.matched_nayax_currency_code = 'USD'
    and c.refund_amount_cents = c.matched_nayax_amount_cents
    and exists (
      select 1
      from public.refund_nayax_lookup_candidates k
      join public.refund_case_events e
        on e.refund_case_id = k.refund_case_id
      where k.refund_case_id = c.id
        and k.lookup_generation = c.nayax_lookup_generation
        and k.reporting_machine_id = c.reporting_machine_id
        and k.provider_transaction_id is not distinct from c.matched_nayax_transaction_id
        and k.site_id is not distinct from c.matched_nayax_site_id
        and k.machine_authorization_time is not distinct from c.matched_nayax_machine_auth_time
        and k.amount_cents is not distinct from c.matched_nayax_amount_cents
        and k.card_last4 is not distinct from c.matched_nayax_card_last4
        and k.currency_code is not distinct from c.matched_nayax_currency_code
        and coalesce(k.evidence_summary ->> 'source', '') <> 'manual_nayax_portal'
        and k.evidence_summary ->> 'selection_allowed' = 'true'
        and public.refund_nayax_candidate_identifier_evidence_state(
          k.refund_case_id,
          k.reporting_machine_id,
          k.site_id,
          k.machine_authorization_time,
          k.amount_cents,
          k.card_last4,
          k.currency_code,
          k.evidence_summary
        ) = 'valid'
        and e.metadata ->> 'candidate_token' = k.token::text
        and e.metadata ->> 'candidate_evidence_hash' =
          public.refund_nayax_candidate_evidence_hash(
            k.refund_case_id,
            k.actor_user_id,
            k.provider_transaction_id,
            k.site_id,
            k.machine_authorization_time,
            k.amount_cents,
            k.card_last4,
            k.currency_code,
            k.evidence_summary,
            k.expires_at,
            k.created_at
          )
        and e.metadata ->> 'lookup_generation' = c.nayax_lookup_generation::text
        and e.metadata ->> 'deterministic_fact_version' = c.deterministic_fact_version::text
        and (
          (
            e.event_type = 'nayax_match_preselected'
            and e.actor_user_id is null
            and e.metadata ->> 'execution_eligible' = 'true'
          )
          or (
            e.event_type = 'nayax_match_selected'
            and e.actor_user_id is not null
          )
          or (
            e.event_type = 'nayax_match_selection_proof_recovered'
            and e.actor_user_id is null
            and e.metadata ->> 'recovery_contract_version' =
              'refund_legacy_selection_proof_recovery_v1'
            and e.metadata ->> 'execution_eligible' = 'true'
            and e.metadata ->> 'provider_call_made' = 'false'
            and e.metadata ->> 'approval_created' = 'false'
            and e.metadata ->> 'customer_message_created' = 'false'
            and e.metadata ->> 'payload_redacted' = 'true'
            and e.metadata ->> 'source_selection_event_digest' ~ '^[0-9a-f]{64}$'
          )
        )
    );

  block_reason := case
    when p_user_id is null
      or not public.can_perform_refund_official_action(p_user_id, c.id)
      then 'unauthorized'
    when not transaction_confirmed then 'transaction_not_confirmed'
    when c.reporting_adjustment_id is not null
      or c.refund_completed_at is not null
      or c.nayax_refund_execution_status = 'succeeded'
      then 'already_refunded'
    when public.refund_case_has_unresolved_reconciliation(c.id)
      or c.nayax_refund_execution_status in ('requested', 'ambiguous', 'manual_review')
      then 'reconciliation_hold'
    when exists (
      select 1
      from public.refund_cases other
      where other.id <> c.id
        and other.matched_nayax_transaction_id = c.matched_nayax_transaction_id
    ) then 'duplicate_transaction'
    when c.payment_method <> 'card'
      or c.status not in ('needs_review', 'correlated')
      or c.decision is not null
      or c.nayax_refund_execution_status <> 'not_requested'
      then 'case_not_refundable'
    when machine.id is null
      or machine.status <> 'active'
      or nullif(btrim(machine.nayax_machine_id), '') is null
      or nullif(btrim(machine.nayax_account_key), '') is null
      then 'provider_unavailable'
    when not machine.nayax_refunds_enabled then 'machine_not_enabled'
    else null
  end;

  return jsonb_build_object(
    'transactionConfirmed', transaction_confirmed,
    'approvalContinuationReady', false,
    'canIssueCardRefund', block_reason is null,
    'blockReason', block_reason,
    'refundAmountCents', c.matched_nayax_amount_cents,
    'machineLimitCents', null,
    'caseVersion', c.official_action_version,
    'accountCircuitBreakerActive', false
  );
end;
$$;

revoke execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_case_nayax_manager_readiness(uuid, uuid)
  to service_role;

select public.service_recover_safe_legacy_refund_selection_proofs_v1();

comment on function public.service_recover_safe_legacy_refund_selection_proofs_v1() is
  'One-time replay-safe recovery for legacy manager selections whose unchanged, unique, top-ranked candidate still satisfies all current review-safety invariants. It records proof only and never approves or issues a refund.';

comment on function public.refund_case_nayax_manager_readiness(uuid, uuid) is
  'Private, side-effect-free readiness contract for the explicit manager Nayax refund action, including audited proof recovered from one strictly verifiable legacy selection.';
