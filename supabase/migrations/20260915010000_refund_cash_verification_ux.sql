-- #1353: expose safe Sunze evidence to managers and bind selected-sale amount
-- at completion. Evidence remains advisory; the manager's external Zelle
-- confirmation is still the single cash decision.

create or replace function public.service_get_sunze_cash_correlation(
  p_refund_case_id uuid,
  p_actor_user_id uuid,
  p_candidate_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_sunze_cash_correlation_attempts%rowtype;
  link_row public.refund_sunze_cash_sale_links%rowtype;
  expected_link_version bigint;
  candidates jsonb;
begin
  if p_candidate_limit not between 1 and 100 then
    raise exception 'Sunze candidate read limit must be between 1 and 100';
  end if;
  select * into case_row from public.refund_cases c where c.id = p_refund_case_id;
  if not found then raise exception 'Refund case not found'; end if;
  if p_actor_user_id is null
    or not public.can_manage_refund_case(p_actor_user_id, p_refund_case_id) then
    raise exception 'Authorized refund manager actor required' using errcode = '42501';
  end if;

  select * into attempt_row
  from public.refund_sunze_cash_correlation_attempts attempt
  where attempt.refund_case_id = p_refund_case_id
    and attempt.case_fact_version = case_row.deterministic_fact_version
    and case_row.cash_match_evaluated_fact_version = case_row.deterministic_fact_version
    and attempt.invalidated_at is null
  order by attempt.evaluated_at desc, attempt.id desc
  limit 1;
  select * into link_row from public.refund_sunze_cash_sale_links link
  where link.refund_case_id = p_refund_case_id and link.released_at is null;
  select coalesce(max(link.link_version), 0) into expected_link_version
  from public.refund_sunze_cash_sale_links link
  where link.refund_case_id = p_refund_case_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'salesFactId', candidate.sales_fact_id,
    'rank', candidate.deterministic_rank,
    'paymentTime', candidate.payment_time,
    'amountCents', candidate.amount_cents,
    'actualAmountCents', sale.net_sales_cents,
    'timeDeltaSeconds', candidate.time_delta_seconds,
    'amountDeltaCents', candidate.amount_delta_cents,
    'evidenceCodes', candidate.evidence_codes,
    'selectionConflict', candidate.selection_conflict,
    'machineLabel', left(coalesce(
      nullif(btrim(machine.refund_public_display_label), ''),
      machine.machine_label
    ), 120),
    'locationName', left(location.name, 120),
    'tradeLabel', left(nullif(btrim(sale.source_trade_name), ''), 120)
  ) order by candidate.deterministic_rank), '[]'::jsonb) into candidates
  from (
    select evidence.*
    from public.refund_sunze_cash_correlation_candidates evidence
    where evidence.attempt_id = attempt_row.id
    order by evidence.deterministic_rank
    limit p_candidate_limit
  ) candidate
  join public.machine_sales_facts sale on sale.id = candidate.sales_fact_id
  left join public.reporting_machines machine on machine.id = sale.reporting_machine_id
  left join public.reporting_locations location on location.id = sale.reporting_location_id;

  return jsonb_build_object(
    'caseFactVersion', case_row.deterministic_fact_version,
    'attemptId', attempt_row.id,
    'policyVersion', attempt_row.policy_version,
    'state', coalesce(attempt_row.match_state, case_row.cash_match_state, 'checking_sales_history'),
    'reason', case when attempt_row.id is null then 'correlation_pending' else attempt_row.reason_code end,
    'sourceReadiness', case
      when attempt_row.id is null then 'correlation_pending'
      when attempt_row.reason_code = 'sales_history_stale' then 'stale'
      when attempt_row.match_state = 'checking_sales_history' then 'awaiting_coverage'
      when attempt_row.match_state = 'sales_history_unavailable' then 'unavailable'
      else 'complete_coverage'
    end,
    'coverageStartedAt', attempt_row.coverage_started_at,
    'coveredThrough', attempt_row.covered_through,
    'freshnessExpiresAt', attempt_row.freshness_expires_at,
    'evaluatedAt', attempt_row.evaluated_at,
    'candidateCount', coalesce(attempt_row.candidate_count, 0),
    'returnedCandidateCount', jsonb_array_length(candidates),
    'candidatesTruncated', coalesce(attempt_row.candidate_count, 0) > jsonb_array_length(candidates),
    'candidates', candidates,
    'selectedSalesFactId', link_row.sales_fact_id,
    'selectedLinkVersion', coalesce(link_row.link_version, 0),
    'expectedLinkVersion', expected_link_version,
    'selectedSale', (
      select jsonb_build_object(
        'salesFactId', sale.id,
        'paymentTime', sale.payment_time,
        'actualAmountCents', sale.net_sales_cents,
        'machineLabel', left(coalesce(
          nullif(btrim(machine.refund_public_display_label), ''),
          machine.machine_label
        ), 120),
        'locationName', left(location.name, 120),
        'tradeLabel', left(nullif(btrim(sale.source_trade_name), ''), 120)
      )
      from public.machine_sales_facts sale
      left join public.reporting_machines machine on machine.id = sale.reporting_machine_id
      left join public.reporting_locations location on location.id = sale.reporting_location_id
      where sale.id = link_row.sales_fact_id
    ),
    'evidenceOnly', true
  );
end;
$$;

revoke all on function public.service_get_sunze_cash_correlation(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.service_get_sunze_cash_correlation(uuid, uuid, integer)
  to service_role;

-- Replace the existing cash completion RPC in place so legacy callers cannot
-- bypass selected-sale amount binding. An active link derives its amount from
-- Sunze; no link retains the reviewed customer estimate/manual path.
create or replace function public.service_complete_cash_refund_as_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_refund_amount_cents integer,
  p_manual_refund_reference text,
  p_cash_payout_sent_at timestamptz,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_assigned_manager_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.refund_cases;
  after_row public.refund_cases;
  adjustment_row public.sales_adjustment_facts;
  selected_sale public.machine_sales_facts;
  selected_sale_id uuid;
  confirmation_time timestamptz := statement_timestamp();
  server_refund_amount_cents integer;
  amount_source text := 'customer_estimate_manual_review';
begin
  if p_actor_user_id is null then
    raise exception 'Actor is required';
  end if;

  select * into before_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if before_row.id is null then
    raise exception 'Refund case not found';
  end if;

  if not public.can_manage_refund_case(p_actor_user_id, before_row.id) then
    raise exception 'Refund case access required';
  end if;

  if before_row.status = 'completed' then
    return jsonb_build_object(
      'refundCase', to_jsonb(before_row),
      'updateApplied', false
    );
  end if;

  if before_row.status in ('denied', 'closed') then
    raise exception 'This cash refund case is already closed';
  end if;

  if before_row.payment_method <> 'cash' then
    raise exception 'External completion is only available for cash refund cases';
  end if;

  if before_row.status not in (
    'draft',
    'submitted',
    'needs_review',
    'waiting_on_customer',
    'correlated',
    'approved',
    'cash_zelle_pending'
  ) then
    raise exception 'This cash refund case is not eligible for completion';
  end if;

  select sale.* into selected_sale
  from public.refund_sunze_cash_sale_links link
  join public.machine_sales_facts sale on sale.id = link.sales_fact_id
  where link.refund_case_id = before_row.id
    and link.released_at is null
  for share of sale;

  if exists (
    select 1 from public.refund_sunze_cash_sale_links link
    where link.refund_case_id = before_row.id and link.released_at is null
  ) and selected_sale.id is null then
    raise exception 'The selected Sunze sale is unavailable; refresh before completing the cash refund';
  end if;

  if selected_sale.id is not null then
    selected_sale_id := selected_sale.id;
    server_refund_amount_cents := selected_sale.net_sales_cents;
    amount_source := 'sunze_selected_sale';
    if exists (
      select 1
      from public.refund_cases completed_case
      where completed_case.matched_sales_fact_id = selected_sale_id
        and completed_case.id <> before_row.id
        and completed_case.payment_method = 'cash'
        and completed_case.duplicate_of_refund_case_id is null
        and (
          completed_case.refund_completed_at is not null
          or completed_case.reporting_adjustment_id is not null
        )
    ) then
      raise exception 'Sunze sale is already completed against another refund case'
        using errcode = '23505';
    end if;
  else
    server_refund_amount_cents := before_row.payment_amount_cents;
  end if;

  if coalesce(server_refund_amount_cents, 0) <= 0 then
    raise exception 'Confirm the customer payment amount before completing the cash refund';
  end if;

  if p_refund_amount_cents is distinct from server_refund_amount_cents then
    raise exception 'The reviewed cash amount changed. Refresh the case before completing the cash refund'
      using errcode = '40001';
  end if;

  update public.refund_cases
  set
    status = 'completed',
    decision = 'approved',
    decision_reason = coalesce(
      nullif(btrim(p_decision_reason), ''),
      nullif(btrim(before_row.decision_reason), ''),
      'Manager confirmed the customer was refunded outside Bloomjoy Hub.'
    ),
    decided_by = p_actor_user_id,
    decided_at = confirmation_time,
    assigned_manager_id = coalesce(before_row.assigned_manager_id, p_actor_user_id),
    refund_amount_cents = server_refund_amount_cents,
    refund_completed_by = p_actor_user_id,
    refund_completed_at = confirmation_time,
    matched_sales_fact_id = coalesce(selected_sale_id, before_row.matched_sales_fact_id)
  where id = before_row.id
  returning * into after_row;

  insert into public.sales_adjustment_facts (
    reporting_machine_id,
    reporting_location_id,
    adjustment_date,
    adjustment_type,
    amount_cents,
    complaint_count,
    source,
    source_row_hash,
    source_reference,
    source_row_reference,
    refund_case_id,
    match_status,
    match_confidence,
    notes,
    raw_payload
  )
  values (
    after_row.reporting_machine_id,
    after_row.reporting_location_id,
    after_row.refund_completed_at::date,
    'refund',
    server_refund_amount_cents,
    1,
    'refund_case',
    after_row.id::text,
    'refund_cases',
    after_row.public_reference,
    after_row.id,
    'applied',
    greatest(coalesce(after_row.correlation_confidence, 0), 0),
    'Bloomjoy refund case ' || after_row.public_reference,
    jsonb_build_object(
      'refund_case_id', after_row.id,
      'refund_case_reference', after_row.public_reference,
      'refund_case_status', after_row.status,
      'refund_case_decision', after_row.decision,
      'payment_method', after_row.payment_method,
      'completion_method', 'manual_external',
      'cash_amount_source', amount_source,
      'selected_sales_fact_id', selected_sale_id,
      'correlation_status', after_row.correlation_status,
      'correlation_source', after_row.correlation_source,
      'payload_redacted', true
    )
  )
  on conflict (source, source_reference, source_row_reference)
  do update set
    reporting_machine_id = excluded.reporting_machine_id,
    reporting_location_id = excluded.reporting_location_id,
    adjustment_date = excluded.adjustment_date,
    amount_cents = excluded.amount_cents,
    refund_case_id = excluded.refund_case_id,
    match_status = excluded.match_status,
    match_confidence = excluded.match_confidence,
    notes = excluded.notes,
    raw_payload = excluded.raw_payload
  returning * into adjustment_row;

  update public.refund_cases
  set reporting_adjustment_id = adjustment_row.id
  where id = after_row.id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    p_actor_user_id,
    'refund_case.manual_external_completed',
    'refund_case',
    after_row.id::text,
    jsonb_build_object(
      'status', before_row.status,
      'decision', before_row.decision,
      'refund_amount_cents', before_row.refund_amount_cents,
      'reporting_adjustment_present', before_row.reporting_adjustment_id is not null
    ),
    jsonb_build_object(
      'status', after_row.status,
      'decision', after_row.decision,
      'refund_amount_cents', after_row.refund_amount_cents,
      'reporting_adjustment_present', after_row.reporting_adjustment_id is not null
    ),
    jsonb_build_object(
      'completion_method', 'manual_external',
      'cash_amount_source', amount_source,
      'selected_sales_fact_id', selected_sale_id,
      'internal_note_present', nullif(btrim(coalesce(p_internal_note, '')), '') is not null,
      'audit_payload_redacted', true
    )
  );

  return jsonb_build_object(
    'refundCase', to_jsonb(after_row),
    'updateApplied', true,
    'cashAmountSource', amount_source,
    'selectedSalesFactId', selected_sale_id
  );
end;
$$;

revoke all on function public.service_complete_cash_refund_as_actor(
  uuid, uuid, integer, text, timestamptz, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.service_complete_cash_refund_official(
  p_authorization_id uuid,
  p_case_id uuid,
  p_refund_amount_cents integer,
  p_manual_refund_reference text,
  p_cash_payout_sent_at timestamptz,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_assigned_manager_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authorization_context jsonb;
  actor_user_id uuid;
  authority_kind text;
  authority_record_id uuid;
  authority_version bigint;
  completion_result jsonb;
  completion_case jsonb;
begin
  authorization_context := public.consume_refund_official_action_authorization(
    p_authorization_id,
    p_case_id,
    'cash_complete',
    'completed',
    'approved',
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    null,
    null,
    true,
    null,
    null
  );

  actor_user_id := (authorization_context ->> 'actorUserId')::uuid;
  authority_kind := authorization_context ->> 'authorityKind';
  authority_record_id := (authorization_context ->> 'authorityRecordId')::uuid;
  authority_version := (authorization_context ->> 'authorityVersion')::bigint;

  if not public.can_perform_refund_official_action(actor_user_id, p_case_id) then
    raise exception 'Machine Manager mapping or admin authority changed before the official mutation';
  end if;

  completion_result := public.service_complete_cash_refund_as_actor(
    actor_user_id,
    p_case_id,
    p_refund_amount_cents,
    null,
    null,
    p_decision_reason,
    p_internal_note,
    p_assigned_manager_email
  );

  if coalesce((completion_result ->> 'updateApplied')::boolean, false) then
    completion_case := completion_result -> 'refundCase';

    insert into public.refund_case_events (
      refund_case_id,
      actor_user_id,
      event_type,
      message,
      metadata
    )
    values (
      p_case_id,
      actor_user_id,
      'official_action_committed',
      'Mapped Machine Manager confirmed an external cash refund was completed.',
      jsonb_build_object(
        'action', 'cash_complete',
        'completion_method', 'manual_external',
        'cash_amount_source', completion_result ->> 'cashAmountSource',
        'selected_sales_fact_id', completion_result ->> 'selectedSalesFactId',
        'refund_amount_cents', (completion_case ->> 'refund_amount_cents')::integer,
        'confirmed_at', completion_case ->> 'refund_completed_at',
        'authority_kind', authority_kind,
        'authority_record_id', authority_record_id,
        'authority_version', authority_version,
        'payload_redacted', true
      )
    );
  end if;

  return completion_result;
end;
$$;

revoke all on function public.service_complete_cash_refund_official(
  uuid, uuid, integer, text, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.service_complete_cash_refund_official(
  uuid, uuid, integer, text, timestamptz, text, text, text
) to service_role;

comment on function public.service_complete_cash_refund_official(
  uuid, uuid, integer, text, timestamptz, text, text, text
) is
  'Official cash completion that preserves the mapped-manager authorization and derives a selected Sunze sale amount server-side when evidence is bound; otherwise uses the reviewed customer estimate.';

-- Legacy cash approvals predate the one-decision manager flow. Return only
-- active, nonterminal cases to review, retaining all customer messages and
-- recording the prior official-looking state before Sunze correlation runs.
create function public.service_prepare_legacy_cash_case_for_correlation(
  p_refund_case_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  before_case_row public.refund_cases%rowtype;
  normalized_event public.refund_case_events%rowtype;
  correlation_result jsonb;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;
  if p_actor_user_id is null
    or not public.can_manage_refund_case(p_actor_user_id, p_refund_case_id) then
    raise exception 'Authorized refund manager actor required' using errcode = '42501';
  end if;

  if case_row.payment_method <> 'cash'
    or case_row.status in ('completed', 'denied', 'closed')
    or case_row.refund_completed_at is not null
    or case_row.reporting_adjustment_id is not null then
    return jsonb_build_object(
      'normalized', false,
      'immutable', true,
      'caseFactVersion', case_row.deterministic_fact_version,
      'payloadRedacted', true
    );
  end if;

  select event.* into normalized_event
  from public.refund_case_events event
  where event.refund_case_id = case_row.id
    and event.event_type = 'legacy_cash_state_normalized'
  order by event.created_at desc, event.id desc
  limit 1;
  if normalized_event.id is not null then
    return jsonb_build_object(
      'normalized', false,
      'alreadyNormalized', true,
      'caseFactVersion', case_row.deterministic_fact_version,
      'payloadRedacted', true
    );
  end if;

  if case_row.status not in ('approved', 'cash_zelle_pending')
    or case_row.decision is distinct from 'approved' then
    return jsonb_build_object(
      'normalized', false,
      'caseFactVersion', case_row.deterministic_fact_version,
      'payloadRedacted', true
    );
  end if;

  before_case_row := case_row;
  update public.refund_cases
  set
    status = 'needs_review',
    decision = null,
    decision_reason = null,
    decided_by = null,
    decided_at = null,
    refund_amount_cents = null,
    correlation_status = 'manual_review',
    correlation_source = null,
    correlation_confidence = 0,
    correlation_summary = 'A historical cash decision requires a fresh Sunze sales-history review.'
  where id = case_row.id
  returning * into case_row;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    p_actor_user_id,
    'legacy_cash_state_normalized',
    'A historical cash decision returned to manager review; no customer message or payment was sent by this operation.',
    jsonb_build_object(
      'previousStatus', before_case_row.status,
      'previousDecision', before_case_row.decision,
      'previousDecisionReasonPresent', nullif(btrim(coalesce(before_case_row.decision_reason, '')), '') is not null,
      'previousDecidedByPresent', before_case_row.decided_by is not null,
      'previousDecidedAt', before_case_row.decided_at,
      'previousRefundAmountCents', before_case_row.refund_amount_cents,
      'existingMessageCount', (
        select count(*) from public.refund_case_messages message
        where message.refund_case_id = case_row.id
      ),
      'paymentReceiptPreserved', true,
      'customerMessageSent', false,
      'payloadRedacted', true
    )
  );

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  ) values (
    p_actor_user_id,
    'refund_case.legacy_cash_state_normalized',
    'refund_case',
    case_row.id::text,
    jsonb_build_object(
      'status', before_case_row.status,
      'decision', before_case_row.decision,
      'decidedAt', before_case_row.decided_at,
      'refundAmountCents', before_case_row.refund_amount_cents
    ),
    jsonb_build_object(
      'status', 'needs_review',
      'decision', null,
      'refundAmountCents', null
    ),
    jsonb_build_object(
      'operation', 'cash_verification_ux_forward_repair',
      'paymentReceiptPreserved', true,
      'customerMessageSent', false,
      'payloadRedacted', true
    )
  );

  -- Keep the forward repair and first evidence attempt in one transaction. If
  -- correlation fails, the state and its audit evidence roll back together;
  -- a retry can safely perform the complete operation again.
  correlation_result := public.service_correlate_sunze_cash_case(
    case_row.id,
    case_row.deterministic_fact_version,
    'backfill',
    null,
    statement_timestamp()
  );

  return jsonb_build_object(
    'normalized', true,
    'alreadyNormalized', false,
    'caseFactVersion', case_row.deterministic_fact_version,
    'status', 'needs_review',
    'decision', null,
    'correlation', correlation_result,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_prepare_legacy_cash_case_for_correlation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_prepare_legacy_cash_case_for_correlation(uuid, uuid)
  to service_role;

comment on function public.service_prepare_legacy_cash_case_for_correlation(uuid, uuid) is
  'Audited service-only forward repair for active legacy cash decisions; terminal outcomes and payment/customer records remain immutable.';

-- Serialize payout-destination request creation with the case and treat both
-- a scoped correction capability and an already queued/sent targeted request
-- as active coverage. This keeps concurrent callers from creating a second
-- customer question while leaving unrelated delivery history irrelevant.
alter function public.service_enqueue_refund_manual_message_intent(
  uuid, bigint, uuid, uuid, text, text, text, text, text, text, text,
  text[], uuid, boolean, uuid
) rename to service_enqueue_refund_manual_message_intent_pre_cash_verification_ux;
revoke all on function public.service_enqueue_refund_manual_message_intent_pre_cash_verification_ux(
  uuid, bigint, uuid, uuid, text, text, text, text, text, text, text,
  text[], uuid, boolean, uuid
) from public, anon, authenticated, service_role;

create function public.service_enqueue_refund_manual_message_intent(
  p_refund_case_id uuid,
  p_expected_case_version bigint,
  p_intent_id uuid,
  p_actor_user_id uuid,
  p_message_type text,
  p_recipient_email text,
  p_subject text,
  p_body text,
  p_template_key text,
  p_content_source text,
  p_reason_code text,
  p_requested_fields text[],
  p_synthetic_proof_authorization_id uuid,
  p_status_link_requested boolean,
  p_triage_suggestion_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_case public.refund_cases%rowtype;
begin
  if p_requested_fields is not distinct from array['zelle_payment_contact']::text[] then
    select refund_case.* into locked_case
    from public.refund_cases refund_case
    where refund_case.id = p_refund_case_id
    for update;
    if not found then
      raise exception 'Refund case not found';
    end if;

    if exists (
      select 1
      from public.refund_wallet_correction_contexts correction
      where correction.refund_case_id = locked_case.id
        and correction.correction_kind = 'purchase'
        and correction.status = 'pending'
        and correction.expires_at > statement_timestamp()
        and 'zelle_payment_contact' = any(coalesce(
          correction.correction_requested_fields,
          array[]::text[]
        ))
    ) or exists (
      select 1
      from public.refund_case_messages request_message
      where request_message.refund_case_id = locked_case.id
        and request_message.message_type = 'more_info'
        and 'zelle_payment_contact' = any(coalesce(
          request_message.requested_fields,
          array[]::text[]
        ))
        and request_message.status in ('pending', 'sent')
        and request_message.manual_delivery_intent_id is distinct from p_intent_id
        and not public.is_refund_message_recorded_delivery_failure(to_jsonb(request_message))
    ) then
      raise exception 'Payout destination contact already has an active customer request; Refund Operations review is required before any new request'
        using errcode = 'P4662';
    end if;
  end if;

  return public.service_enqueue_refund_manual_message_intent_pre_cash_verification_ux(
    p_refund_case_id,
    p_expected_case_version,
    p_intent_id,
    p_actor_user_id,
    p_message_type,
    p_recipient_email,
    p_subject,
    p_body,
    p_template_key,
    p_content_source,
    p_reason_code,
    p_requested_fields,
    p_synthetic_proof_authorization_id,
    p_status_link_requested,
    p_triage_suggestion_id
  );
end;
$$;

revoke execute on function public.service_enqueue_refund_manual_message_intent(
  uuid, bigint, uuid, uuid, text, text, text, text, text, text, text,
  text[], uuid, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.service_enqueue_refund_manual_message_intent(
  uuid, bigint, uuid, uuid, text, text, text, text, text, text, text,
  text[], uuid, boolean, uuid
) to service_role;

-- Project payout-destination eligibility from the dedicated request ledger.
-- Generic customer delivery messages (including delivery_unknown) are never
-- consulted here, so they cannot suppress or replay this targeted question.
alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_cash_verification_ux_v1;
revoke all on function public.admin_get_refund_operations_overview_pre_cash_verification_ux_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb := public.admin_get_refund_operations_overview_pre_cash_verification_ux_v1();
  projected_cases jsonb;
  projected_internal_test_cases jsonb;
begin
  select coalesce(jsonb_agg(
    item.case_json || jsonb_build_object(
      'payoutDestinationRequest', jsonb_build_object(
        'state', coalesce(ledger.status, 'not_started'),
        'canRequest', ledger.status is null and (
          item.case_json ->> 'paymentMethod' = 'cash'
          and nullif(btrim(coalesce(item.case_json ->> 'zellePaymentContact', '')), '') is null
          and item.case_json ->> 'status' not in ('completed', 'denied', 'closed')
          and not exists (
            select 1
            from public.refund_wallet_correction_contexts correction
            where correction.refund_case_id = (item.case_json ->> 'id')::uuid
              and correction.correction_kind = 'purchase'
              and correction.status = 'pending'
              and correction.expires_at > statement_timestamp()
              and 'zelle_payment_contact' = any(coalesce(
                correction.correction_requested_fields,
                array[]::text[]
              ))
          )
          and not exists (
            select 1
            from public.refund_case_messages request_message
            where request_message.refund_case_id = (item.case_json ->> 'id')::uuid
              and request_message.message_type = 'more_info'
              and 'zelle_payment_contact' = any(coalesce(
                request_message.requested_fields,
                array[]::text[]
              ))
              and request_message.status in ('pending', 'sent')
              and not public.is_refund_message_recorded_delivery_failure(to_jsonb(request_message))
          )
          and (
            item.case_json ->> 'decision' = 'approved'
            or item.case_json ->> 'status' in ('approved', 'cash_zelle_pending')
            or item.case_json -> 'lifecycle' ->> 'stage' = 'awaiting_payout'
            or item.case_json -> 'lifecycle' -> 'managerAction' ->> 'action' =
              'request_payout_destination'
          )
        ),
        'payloadRedacted', true
      )
    ) order by item.case_order
  ), '[]'::jsonb)
  into projected_cases
  from jsonb_array_elements(coalesce(base -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order)
  left join lateral (
    select follow_up.status
    from public.refund_payout_destination_follow_ups follow_up
    where follow_up.refund_case_id = (item.case_json ->> 'id')::uuid
  ) ledger on true;

  select coalesce(jsonb_agg(
    item.case_json || jsonb_build_object(
      'payoutDestinationRequest', jsonb_build_object(
        'state', coalesce(ledger.status, 'not_started'),
        'canRequest', ledger.status is null and (
          item.case_json ->> 'paymentMethod' = 'cash'
          and nullif(btrim(coalesce(item.case_json ->> 'zellePaymentContact', '')), '') is null
          and item.case_json ->> 'status' not in ('completed', 'denied', 'closed')
          and not exists (
            select 1
            from public.refund_wallet_correction_contexts correction
            where correction.refund_case_id = (item.case_json ->> 'id')::uuid
              and correction.correction_kind = 'purchase'
              and correction.status = 'pending'
              and correction.expires_at > statement_timestamp()
              and 'zelle_payment_contact' = any(coalesce(
                correction.correction_requested_fields,
                array[]::text[]
              ))
          )
          and not exists (
            select 1
            from public.refund_case_messages request_message
            where request_message.refund_case_id = (item.case_json ->> 'id')::uuid
              and request_message.message_type = 'more_info'
              and 'zelle_payment_contact' = any(coalesce(
                request_message.requested_fields,
                array[]::text[]
              ))
              and request_message.status in ('pending', 'sent')
              and not public.is_refund_message_recorded_delivery_failure(to_jsonb(request_message))
          )
          and (
            item.case_json ->> 'decision' = 'approved'
            or item.case_json ->> 'status' in ('approved', 'cash_zelle_pending')
            or item.case_json -> 'lifecycle' ->> 'stage' = 'awaiting_payout'
            or item.case_json -> 'lifecycle' -> 'managerAction' ->> 'action' =
              'request_payout_destination'
          )
        ),
        'payloadRedacted', true
      )
    ) order by item.case_order
  ), '[]'::jsonb)
  into projected_internal_test_cases
  from jsonb_array_elements(coalesce(base -> 'internalTestCases', '[]'::jsonb))
    with ordinality item(case_json, case_order)
  left join lateral (
    select follow_up.status
    from public.refund_payout_destination_follow_ups follow_up
    where follow_up.refund_case_id = (item.case_json ->> 'id')::uuid
  ) ledger on true;

  base := jsonb_set(base, '{cases}', projected_cases, true);
  if jsonb_typeof(base -> 'internalTestCases') = 'array' then
    base := jsonb_set(base, '{internalTestCases}', projected_internal_test_cases, true);
  end if;
  return base || jsonb_build_object(
    'payoutDestinationRequestContractVersion', 'refund_payout_destination_request_v1'
  );
end;
$$;

revoke all on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with safe Sunze cash evidence and payout-destination eligibility from the dedicated request ledger.';

select pg_notify('pgrst', 'reload schema');
