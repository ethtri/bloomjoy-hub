-- Cash reimbursements happen outside Bloomjoy Hub during the interim workflow.
-- The manager's one explicit confirmation is the durable business record; the
-- case amount, actor, and confirmation time are always derived on the server.

create or replace function public.assert_refund_official_action_payload_shape(
  p_action text,
  p_target_status text,
  p_target_decision text,
  p_assigned_manager_email text,
  p_decision_reason text,
  p_internal_note text,
  p_refund_amount_cents integer,
  p_manual_refund_reference text,
  p_cash_payout_sent_at timestamptz,
  p_cash_payment_confirmed boolean,
  p_matched_nayax_candidate_token uuid,
  p_nayax_disagreement_reason text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  normalized_status text := lower(btrim(coalesce(p_target_status, '')));
  normalized_decision text := lower(btrim(coalesce(p_target_decision, '')));
  normalized_disagreement_reason text := nullif(
    lower(btrim(coalesce(p_nayax_disagreement_reason, ''))),
    ''
  );
begin
  if normalized_action not in ('approve', 'decline', 'cash_complete', 'nayax_execute') then
    raise exception 'Official refund action is invalid';
  end if;

  if normalized_disagreement_reason is not null
    and normalized_disagreement_reason not in (
      'closer_time',
      'correct_amount',
      'correct_card',
      'customer_confirmation',
      'provider_data_issue',
      'other_review_reason'
    ) then
    raise exception 'Nayax disagreement reason is invalid';
  end if;

  if normalized_action = 'approve' then
    if normalized_status not in ('approved', 'card_refund_pending', 'cash_zelle_pending')
      or normalized_decision <> 'approved' then
      raise exception 'Approval authorization does not match the requested case state';
    end if;

    if p_refund_amount_cents is null or p_refund_amount_cents <= 0 then
      raise exception 'Approval requires a positive reviewed refund amount';
    end if;

    if nullif(btrim(coalesce(p_manual_refund_reference, '')), '') is not null
      or p_cash_payout_sent_at is not null
      or coalesce(p_cash_payment_confirmed, false) then
      raise exception 'Approval cannot include payment-completion fields';
    end if;

    if p_matched_nayax_candidate_token is null
      and normalized_disagreement_reason is not null then
      raise exception 'Nayax disagreement reason requires a selected candidate';
    end if;
  elsif normalized_action = 'decline' then
    if normalized_status <> 'denied' or normalized_decision <> 'denied' then
      raise exception 'Decline authorization does not match the requested case state';
    end if;

    if p_refund_amount_cents is not null
      or nullif(btrim(coalesce(p_manual_refund_reference, '')), '') is not null
      or p_cash_payout_sent_at is not null
      or coalesce(p_cash_payment_confirmed, false)
      or p_matched_nayax_candidate_token is not null
      or normalized_disagreement_reason is not null then
      raise exception 'Decline cannot include payment or Nayax selection fields';
    end if;
  elsif normalized_action = 'cash_complete' then
    if normalized_status <> 'completed' or normalized_decision <> 'approved' then
      raise exception 'Cash completion authorization does not match the requested case state';
    end if;

    if p_refund_amount_cents is null
      or p_refund_amount_cents <= 0
      or nullif(btrim(coalesce(p_manual_refund_reference, '')), '') is not null
      or p_cash_payout_sent_at is not null
      or coalesce(p_cash_payment_confirmed, false) = false
      or p_matched_nayax_candidate_token is not null
      or normalized_disagreement_reason is not null then
      raise exception 'Cash completion requires only the server-derived amount and manager confirmation';
    end if;
  else
    if normalized_status <> 'card_refund_pending' or normalized_decision <> 'approved' then
      raise exception 'Nayax execution authorization does not match the approved case state';
    end if;

    if p_refund_amount_cents is null
      or p_refund_amount_cents <= 0
      or p_assigned_manager_email is not null
      or p_decision_reason is not null
      or p_internal_note is not null
      or p_manual_refund_reference is not null
      or p_cash_payout_sent_at is not null
      or coalesce(p_cash_payment_confirmed, false)
      or p_matched_nayax_candidate_token is not null
      or p_nayax_disagreement_reason is not null then
      raise exception 'Nayax execution accepts only the frozen approved amount and state';
    end if;
  end if;
end;
$$;

create or replace function public.assert_sales_adjustment_refund_calculation_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := coalesce(new.raw_payload, '{}'::jsonb);
  normalized_status text := public.normalize_reporting_match_text(payload ->> 'source_status');
  normalized_decision text := public.normalize_reporting_match_text(payload ->> 'source_decision');
  refund_case_row public.refund_cases;
  is_manual_external_cash boolean := false;
begin
  if new.source = 'google_sheets'
    and new.adjustment_type in ('refund', 'complaint_refund') then
    if coalesce(new.amount_cents, 0) <= 0 then
      raise exception 'Approved refund adjustments require a positive amount before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(new.source_reference, '')), '') is null
      or nullif(trim(coalesce(new.source_row_reference, '')), '') is null then
      raise exception 'Approved refund adjustments require source references before settlement'
        using errcode = '23514';
    end if;

    if new.refund_review_row_id is null then
      raise exception 'Approved refund adjustments require a linked review row before settlement'
        using errcode = '23514';
    end if;

    if coalesce(new.match_status, '') <> 'applied' then
      raise exception 'Approved refund adjustments require applied match status before settlement'
        using errcode = '23514';
    end if;

    if coalesce(new.match_confidence, 0) <= 0 then
      raise exception 'Approved refund adjustments require positive match confidence before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(payload ->> 'source_location', '')), '') is null then
      raise exception 'Approved refund adjustments require source location before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(payload ->> 'refund_date', '')), '') is null then
      raise exception 'Approved refund adjustments require refund date before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(payload ->> 'amount_source', '')), '') is null then
      raise exception 'Approved refund adjustments require an amount source before settlement'
        using errcode = '23514';
    end if;

    if normalized_status <> 'closed' then
      raise exception 'Approved refund adjustments require closed source status before settlement'
        using errcode = '23514';
    end if;

    if normalized_decision not in ('approve', 'approved', 'refund approved', 'refund approve') then
      raise exception 'Approved refund adjustments require approve source decision before settlement'
        using errcode = '23514';
    end if;
  end if;

  if new.source = 'refund_case'
    and new.adjustment_type in ('refund', 'complaint_refund') then
    if coalesce(new.amount_cents, 0) <= 0 then
      raise exception 'Refund case adjustments require a positive amount before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(new.source_reference, '')), '') is null
      or nullif(trim(coalesce(new.source_row_reference, '')), '') is null then
      raise exception 'Refund case adjustments require source references before settlement'
        using errcode = '23514';
    end if;

    if new.refund_case_id is null then
      raise exception 'Refund case adjustments require a linked refund case'
        using errcode = '23514';
    end if;

    if coalesce(new.match_status, '') <> 'applied' then
      raise exception 'Refund case adjustments require applied match status before settlement'
        using errcode = '23514';
    end if;

    select *
    into refund_case_row
    from public.refund_cases refund_case
    where refund_case.id = new.refund_case_id;

    is_manual_external_cash :=
      refund_case_row.payment_method = 'cash'
      and refund_case_row.status = 'completed'
      and refund_case_row.decision = 'approved'
      and refund_case_row.refund_completed_by is not null
      and refund_case_row.refund_completed_at is not null
      and payload ->> 'completion_method' = 'manual_external';

    if coalesce(new.match_confidence, 0) <= 0
      and not is_manual_external_cash then
      raise exception 'Refund case adjustments require positive match confidence before settlement'
        using errcode = '23514';
    end if;

    if refund_case_row.id is null
      or refund_case_row.status <> 'completed'
      or refund_case_row.decision <> 'approved'
      or (
        not is_manual_external_cash
        and (
          refund_case_row.correlation_status <> 'matched'
          or refund_case_row.correlation_source is null
          or (
            refund_case_row.matched_sales_fact_id is null
            and not public.is_review_safe_nayax_transaction_reference(
              refund_case_row.matched_nayax_transaction_id
            )
          )
        )
      ) then
      raise exception 'Refund case adjustments require an approved, completed case with valid settlement evidence'
        using errcode = '23514';
    end if;

    if not is_manual_external_cash
      and refund_case_row.correlation_source = 'nayax'
      and (
        refund_case_row.payment_method <> 'card'
        or not public.is_review_safe_nayax_transaction_reference(
          refund_case_row.matched_nayax_transaction_id
        )
        or refund_case_row.matched_nayax_machine_auth_time is null
      ) then
      raise exception 'Refund case card adjustments require complete Nayax transaction evidence'
        using errcode = '23514';
    end if;

    if coalesce(payload ->> 'refund_case_status', '') <> 'completed'
      or coalesce(payload ->> 'refund_case_decision', '') <> 'approved' then
      raise exception 'Refund case adjustments require completed/approved payload proof'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

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
  confirmation_time timestamptz := statement_timestamp();
  server_refund_amount_cents integer;
begin
  if p_actor_user_id is null then
    raise exception 'Actor is required';
  end if;

  select *
  into before_row
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

  server_refund_amount_cents := before_row.payment_amount_cents;
  if coalesce(server_refund_amount_cents, 0) <= 0 then
    raise exception 'Confirm the customer payment amount before completing the cash refund';
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
    refund_completed_at = confirmation_time
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
      'internal_note_present', nullif(btrim(coalesce(p_internal_note, '')), '') is not null,
      'audit_payload_redacted', true
    )
  );

  return jsonb_build_object(
    'refundCase', to_jsonb(after_row),
    'updateApplied', true
  );
end;
$$;

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
  manager_mapping_id uuid;
  manager_mapping_version bigint;
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
  manager_mapping_id := (authorization_context ->> 'managerMappingId')::uuid;
  manager_mapping_version := (authorization_context ->> 'managerMappingVersion')::bigint;

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
        'refund_amount_cents', (completion_case ->> 'refund_amount_cents')::integer,
        'confirmed_at', completion_case ->> 'refund_completed_at',
        'manager_mapping_id', manager_mapping_id,
        'manager_mapping_version', manager_mapping_version,
        'payload_redacted', true
      )
    );
  end if;

  return completion_result;
end;
$$;

revoke execute on function public.assert_refund_official_action_payload_shape(
  text, text, text, text, text, text, integer, text, timestamp with time zone,
  boolean, uuid, text
) from public, anon, authenticated;

revoke execute on function public.service_complete_cash_refund_as_actor(
  uuid, uuid, integer, text, timestamp with time zone, text, text, text
) from public, anon, authenticated, service_role;

revoke execute on function public.service_complete_cash_refund_official(
  uuid, uuid, integer, text, timestamp with time zone, text, text, text
) from public, anon, authenticated;

grant execute on function public.service_complete_cash_refund_official(
  uuid, uuid, integer, text, timestamp with time zone, text, text, text
) to service_role;

comment on function public.service_complete_cash_refund_as_actor(
  uuid, uuid, integer, text, timestamp with time zone, text, text, text
) is
  'Internal idempotent cash completion. Derives amount, actor, and confirmation time on the server; accepts active cash cases without requiring transaction correlation.';

comment on function public.service_complete_cash_refund_official(
  uuid, uuid, integer, text, timestamp with time zone, text, text, text
) is
  'Service-role-only boundary that consumes one exact mapped-manager authorization and records a channel-neutral manual_external cash completion.';

select pg_notify('pgrst', 'reload schema');
