-- #1252: same-source exact duplicate reviews must block before provider
-- execution; a confirmed sibling duplicate must not block canonical settlement.

create or replace function public.reconcile_refund_email_case_candidates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_ids uuid[] := '{}';
  new_scope_key bigint;
  old_scope_key bigint;
begin
  if nullif(lower(btrim(coalesce(new.customer_email, ''))), '') is not null
    and new.reporting_machine_id is not null then
    new_scope_key := public.refund_reconciliation_scope_lock_key(
      new.customer_email,
      new.reporting_machine_id
    );
  end if;
  if tg_op = 'UPDATE'
    and nullif(lower(btrim(coalesce(old.customer_email, ''))), '') is not null
    and old.reporting_machine_id is not null then
    old_scope_key := public.refund_reconciliation_scope_lock_key(
      old.customer_email,
      old.reporting_machine_id
    );
  end if;

  if old_scope_key is not null and new_scope_key is not null
    and old_scope_key <> new_scope_key then
    perform pg_advisory_xact_lock(least(old_scope_key, new_scope_key));
    perform pg_advisory_xact_lock(greatest(old_scope_key, new_scope_key));
  elsif coalesce(new_scope_key, old_scope_key) is not null then
    perform pg_advisory_xact_lock(coalesce(new_scope_key, old_scope_key));
  end if;

  if new.duplicate_of_refund_case_id is not null then
    return new;
  end if;

  if new.status = 'draft'
    or nullif(lower(btrim(coalesce(new.customer_email, ''))), '') is null
    or new.reporting_machine_id is null
    or new.incident_at is null then
    update public.refund_case_reconciliation_reviews review
    set status = 'superseded', updated_at = now()
    where review.status in ('pending', 'confirmed_distinct')
      and new.id in (review.left_refund_case_id, review.right_refund_case_id);
    return new;
  end if;

  select coalesce(array_agg(candidate.id), '{}')
  into candidate_ids
  from public.refund_cases candidate
  where candidate.id <> new.id
    and candidate.status <> 'draft'
    and candidate.duplicate_of_refund_case_id is null
    and candidate.status not in ('denied', 'closed')
    and candidate.intake_source in ('form', 'gmail')
    and new.intake_source in ('form', 'gmail')
    and lower(btrim(candidate.customer_email)) = lower(btrim(new.customer_email))
    and candidate.reporting_machine_id = new.reporting_machine_id
    and candidate.incident_at is not null
    and abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 21600
    and (
      candidate.payment_amount_cents = new.payment_amount_cents
      or (
        candidate.payment_method = 'card'
        and new.payment_method = 'card'
        and candidate.card_last4 is not null
        and candidate.card_last4 = new.card_last4
      )
    );

  update public.refund_case_reconciliation_reviews review
  set status = 'superseded', updated_at = now()
  where review.status = 'pending'
    and new.id in (review.left_refund_case_id, review.right_refund_case_id)
    and case
      when review.left_refund_case_id = new.id then review.right_refund_case_id
      else review.left_refund_case_id
    end <> all(candidate_ids);

  insert into public.refund_case_reconciliation_reviews (
    left_refund_case_id,
    right_refund_case_id,
    match_class,
    reason_codes,
    policy_version,
    left_fact_fingerprint,
    right_fact_fingerprint
  )
  select
    least(new.id, candidate.id),
    greatest(new.id, candidate.id),
    case
      when abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 900
        and candidate.payment_amount_cents is not null
        and candidate.payment_amount_cents = new.payment_amount_cents
        and candidate.payment_method = new.payment_method
        and candidate.card_wallet_used = new.card_wallet_used
        and (
          candidate.payment_method <> 'card'
          or (
            candidate.card_last4 is not null
            and candidate.card_last4 = new.card_last4
          )
        )
      then 'exact'
      else 'possible'
    end,
    array_remove(array[
      'customer_email_exact',
      'machine_exact',
      case
        when abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 900
          then 'incident_within_15_minutes'
        else 'incident_within_6_hours'
      end,
      case when candidate.payment_amount_cents = new.payment_amount_cents then 'amount_exact' end,
      case when candidate.payment_method = new.payment_method then 'payment_method_exact' end,
      case when candidate.card_last4 is not null and candidate.card_last4 = new.card_last4 then 'card_last4_exact' end,
      case when candidate.card_wallet_used = new.card_wallet_used then 'wallet_state_exact' end
    ]::text[], null),
    '2026-08-05.email.v1',
    case when new.id < candidate.id then
      public.refund_reconciliation_fact_fingerprint(
        new.customer_email, new.reporting_machine_id, new.incident_at,
        new.payment_method, new.payment_amount_cents, new.card_last4,
        new.card_wallet_used
      )
    else
      public.refund_reconciliation_fact_fingerprint(
        candidate.customer_email, candidate.reporting_machine_id,
        candidate.incident_at, candidate.payment_method,
        candidate.payment_amount_cents, candidate.card_last4,
        candidate.card_wallet_used
      )
    end,
    case when new.id < candidate.id then
      public.refund_reconciliation_fact_fingerprint(
        candidate.customer_email, candidate.reporting_machine_id,
        candidate.incident_at, candidate.payment_method,
        candidate.payment_amount_cents, candidate.card_last4,
        candidate.card_wallet_used
      )
    else
      public.refund_reconciliation_fact_fingerprint(
        new.customer_email, new.reporting_machine_id, new.incident_at,
        new.payment_method, new.payment_amount_cents, new.card_last4,
        new.card_wallet_used
      )
    end
  from public.refund_cases candidate
  where candidate.id = any(candidate_ids)
  on conflict (left_refund_case_id, right_refund_case_id) do update
  set
    match_class = excluded.match_class,
    reason_codes = excluded.reason_codes,
    policy_version = excluded.policy_version,
    left_fact_fingerprint = excluded.left_fact_fingerprint,
    right_fact_fingerprint = excluded.right_fact_fingerprint,
    status = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then 'pending'
      else refund_case_reconciliation_reviews.status
    end,
    canonical_refund_case_id = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then null
      else refund_case_reconciliation_reviews.canonical_refund_case_id
    end,
    resolved_by = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then null
      else refund_case_reconciliation_reviews.resolved_by
    end,
    resolved_at = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then null
      else refund_case_reconciliation_reviews.resolved_at
    end,
    resolution_reason_code = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then null
      else refund_case_reconciliation_reviews.resolution_reason_code
    end,
    updated_at = now()
  where refund_case_reconciliation_reviews.status = 'pending'
    or (
      refund_case_reconciliation_reviews.status = 'confirmed_distinct'
      and (
        refund_case_reconciliation_reviews.left_fact_fingerprint
          is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
      )
    );

  return new;
end;
$$;

create or replace function public.assert_refund_case_reconciliation_safe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_scope_key bigint;
  old_scope_key bigint;
begin
  if (
      new.status is distinct from old.status
      or new.decision is distinct from old.decision
      or new.refund_completed_at is distinct from old.refund_completed_at
      or new.reporting_adjustment_id is distinct from old.reporting_adjustment_id
    ) and (
      new.status in (
        'approved', 'card_refund_pending', 'cash_zelle_pending', 'completed'
      )
      or new.decision = 'approved'
      or new.refund_completed_at is not null
      or new.reporting_adjustment_id is not null
    ) then
    if (
        new.customer_email is distinct from old.customer_email
        or new.reporting_machine_id is distinct from old.reporting_machine_id
        or new.incident_at is distinct from old.incident_at
        or new.payment_method is distinct from old.payment_method
        or new.payment_amount_cents is distinct from old.payment_amount_cents
        or new.card_last4 is distinct from old.card_last4
        or new.card_wallet_used is distinct from old.card_wallet_used
      ) and exists (
        select 1
        from public.refund_cases candidate
        where candidate.id <> new.id
          and candidate.status <> 'draft'
          and candidate.duplicate_of_refund_case_id is null
          and candidate.status not in ('denied', 'closed')
          and candidate.intake_source in ('form', 'gmail')
          and new.intake_source in ('form', 'gmail')
          and lower(btrim(candidate.customer_email)) = lower(btrim(new.customer_email))
          and candidate.reporting_machine_id = new.reporting_machine_id
          and candidate.incident_at is not null
          and new.incident_at is not null
          and abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 21600
          and (
            candidate.payment_amount_cents = new.payment_amount_cents
            or (
              candidate.payment_method = 'card'
              and new.payment_method = 'card'
              and candidate.card_last4 is not null
              and candidate.card_last4 = new.card_last4
            )
          )
      ) then
      raise exception 'Save changed refund facts and reconcile duplicates before taking an official action';
    end if;

    if nullif(lower(btrim(coalesce(old.customer_email, ''))), '') is not null
      and old.reporting_machine_id is not null then
      old_scope_key := public.refund_reconciliation_scope_lock_key(
        old.customer_email,
        old.reporting_machine_id
      );
    end if;
    if nullif(lower(btrim(coalesce(new.customer_email, ''))), '') is not null
      and new.reporting_machine_id is not null then
      new_scope_key := public.refund_reconciliation_scope_lock_key(
        new.customer_email,
        new.reporting_machine_id
      );
    end if;
    if old_scope_key is not null and new_scope_key is not null
      and old_scope_key <> new_scope_key then
      perform pg_advisory_xact_lock(least(old_scope_key, new_scope_key));
      perform pg_advisory_xact_lock(greatest(old_scope_key, new_scope_key));
    elsif coalesce(new_scope_key, old_scope_key) is not null then
      perform pg_advisory_xact_lock(coalesce(new_scope_key, old_scope_key));
    end if;

    if new.duplicate_of_refund_case_id is not null then
      raise exception 'Official refund actions are blocked for a confirmed duplicate case';
    end if;
    if public.refund_case_has_unresolved_reconciliation(new.id) then
      raise exception 'Resolve possible duplicate refund cases before taking an official action';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.set_sales_adjustment_refund_business_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_case_row public.refund_cases;
  fingerprint_date date;
  duplicate_adjustment_id uuid;
  duplicate_case_id uuid;
begin
  if new.source in ('google_sheets', 'refund_case')
    and new.adjustment_type in ('refund', 'complaint_refund') then
    if new.refund_case_id is not null then
      select *
      into refund_case_row
      from public.refund_cases refund_case
      where refund_case.id = new.refund_case_id;

      new.refund_business_fingerprint := public.build_refund_business_fingerprint(
        coalesce(refund_case_row.reporting_machine_id, new.reporting_machine_id),
        coalesce(refund_case_row.incident_at::date, new.adjustment_date),
        coalesce(new.amount_cents, refund_case_row.refund_amount_cents, refund_case_row.payment_amount_cents),
        refund_case_row.payment_method
      );
    else
      fingerprint_date := coalesce(
        public.refund_raw_payload_date_or_null(new.raw_payload, 'original_order_date'),
        public.refund_raw_payload_date_or_null(new.raw_payload, 'incident_date'),
        new.adjustment_date
      );

      new.refund_business_fingerprint := public.build_refund_business_fingerprint(
        new.reporting_machine_id,
        fingerprint_date,
        new.amount_cents,
        coalesce(new.raw_payload ->> 'payment_method', 'unknown')
      );
    end if;

    if new.refund_business_fingerprint is not null
      and coalesce(new.match_status, '') = 'applied' then
      select refund_case.id
      into duplicate_case_id
      from public.refund_cases refund_case
      where refund_case.id <> coalesce(new.refund_case_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and refund_case.refund_business_fingerprint = new.refund_business_fingerprint
        and refund_case.status not in ('denied', 'closed')
        and (
          new.refund_case_id is null
          or refund_case.duplicate_of_refund_case_id is distinct from new.refund_case_id
        )
      limit 1;

      if duplicate_case_id is not null then
        raise exception 'Potential duplicate refund settlement adjustment requires review'
          using errcode = '23505';
      end if;

      select adjustment.id
      into duplicate_adjustment_id
      from public.sales_adjustment_facts adjustment
      where adjustment.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and adjustment.source in ('google_sheets', 'refund_case')
        and adjustment.adjustment_type in ('refund', 'complaint_refund')
        and adjustment.match_status = 'applied'
        and adjustment.refund_business_fingerprint = new.refund_business_fingerprint
      limit 1;

      if duplicate_adjustment_id is not null then
        raise exception 'Potential duplicate refund settlement adjustment requires review'
          using errcode = '23505';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- Immutable provider-stage evidence is sufficient to prove the already-issued
-- refund even when the ordinary database settlement transaction rolled back.
-- This predicate is deliberately limited to the direct one-decision request and
-- approve chain: its execution authorization version equals the frozen context,
-- while the case was advanced once when that authorization was consumed.
-- Mutable settlement state is deliberately checked by the recovery RPC, not
-- by this evidence-only predicate.
create function public.refund_nayax_unsettled_api_success_journal_proved(
  p_case_id uuid,
  p_attempt_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.refund_cases refund_case
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id = p_attempt_id
      and attempt.refund_case_id = refund_case.id
    join public.refund_case_official_action_authorizations authz
      on authz.id = attempt.official_action_authorization_id
    join public.refund_manager_action_step_up_intents intent
      on intent.id = attempt.step_up_intent_id
      and intent.id = authz.step_up_intent_id
    join public.refund_nayax_execution_contexts saved
      on saved.attempt_id = attempt.id
      and saved.refund_case_id = refund_case.id
    cross join lateral jsonb_to_record(saved.context) as context(
      "caseId" uuid,
      "reportingMachineId" uuid,
      "caseVersion" bigint,
      "contextHash" text,
      "attemptGeneration" integer,
      "accountScope" text,
      "providerMachineId" text,
      "transactionId" text,
      "siteId" integer,
      "originalAmountCents" integer,
      "currencyCode" text,
      "cardLast4" text,
      "machineAuthorizationTimeInstant" timestamptz
    )
    join public.refund_nayax_provider_stage_journal request_journal
      on request_journal.nayax_refund_attempt_id = attempt.id
      and request_journal.pending_approval_recovery_id is null
      and request_journal.stage = 'request'
      and request_journal.event = 'result'
    join public.refund_nayax_provider_business_outcomes request_outcome
      on request_outcome.provider_stage_journal_id = request_journal.id
      and request_outcome.nayax_refund_attempt_id = attempt.id
      and request_outcome.stage = 'request'
    join public.refund_nayax_provider_stage_journal approve_journal
      on approve_journal.nayax_refund_attempt_id = attempt.id
      and approve_journal.pending_approval_recovery_id is null
      and approve_journal.stage = 'approve'
      and approve_journal.event = 'result'
    join public.refund_nayax_provider_business_outcomes approve_outcome
      on approve_outcome.provider_stage_journal_id = approve_journal.id
      and approve_outcome.nayax_refund_attempt_id = attempt.id
      and approve_outcome.stage = 'approve'
    where refund_case.id = p_case_id
      and refund_case.case_population = 'customer'
      and refund_case.payment_method = 'card'
      and refund_case.decision = 'approved'
      and attempt.execution_mode = 'request_and_approve'
      and attempt.actor_user_id = authz.actor_user_id
      and attempt.amount_cents = refund_case.refund_amount_cents
      and attempt.amount_cents = refund_case.matched_nayax_amount_cents
      and attempt.currency_code = 'USD'
      and attempt.currency_code = refund_case.matched_nayax_currency_code
      and attempt.idempotency_key ~ '^nayax-refund-[a-f0-9]{64}$'
      and attempt.request_fingerprint = public.refund_nayax_attempt_request_fingerprint(
        authz.id,
        refund_case.id,
        attempt.idempotency_key,
        attempt.amount_cents,
        attempt.currency_code,
        authz.nayax_execution_evidence_hash
      )
      and authz.status = 'consumed'
      and authz.consumed_at is not null
      and authz.action = 'nayax_execute'
      and authz.refund_case_id = refund_case.id
      and authz.verified_totp_at is not null
      and authz.nayax_execution_evidence_hash is not null
      and intent.status = 'consumed'
      and intent.action = 'nayax_execute'
      and intent.target_function = 'nayax-card-refund'
      and intent.refund_case_id = refund_case.id
      and intent.actor_user_id = authz.actor_user_id
      and intent.verified_totp_at = authz.verified_totp_at
      and intent.nayax_execution_evidence_hash = authz.nayax_execution_evidence_hash
      and context."caseId" = refund_case.id
      and context."reportingMachineId" = machine.id
      and authz.expected_case_version = context."caseVersion"
      and context."contextHash" = authz.nayax_execution_evidence_hash
      and context."attemptGeneration" = refund_case.nayax_refund_attempt_generation
      and context."accountScope" = machine.nayax_account_key
      and context."providerMachineId" = machine.nayax_machine_id
      and context."transactionId" = refund_case.matched_nayax_transaction_id
      and context."siteId" = refund_case.matched_nayax_site_id
      and context."originalAmountCents" = attempt.amount_cents
      and context."currencyCode" = attempt.currency_code
      and context."cardLast4" = refund_case.matched_nayax_card_last4
      and context."machineAuthorizationTimeInstant" = refund_case.matched_nayax_machine_auth_time
      and request_journal.http_status = 200
      and request_journal.http_accepted
      and request_journal.outcome = 'accepted'
      and request_journal.contract_matched
      and request_journal.approval_authorized
      and request_journal.schema_matched
      and request_journal.semantic_pair_matched
      and request_journal.journal_contract_version = 'nayax-provider-journal-v3'
      and request_journal.provider_contract_version = 'nayax-production-account-contract-v2'
      and approve_journal.http_status = 200
      and approve_journal.http_accepted
      and approve_journal.outcome = 'succeeded'
      and approve_journal.contract_matched
      and approve_journal.schema_matched
      and approve_journal.semantic_pair_matched
      and approve_journal.journal_contract_version = 'nayax-provider-journal-v3'
      and approve_journal.provider_contract_version = 'nayax-production-account-contract-v2'
      and request_outcome.business_pair_retained
      and request_outcome.observed_scalar_pair_retained
      and approve_outcome.business_pair_retained
      and approve_outcome.observed_scalar_pair_retained
      and request_outcome.business_result =
        'Refund status updated successfully, but the email could not be sent'
      and request_outcome.business_status = 'Partial success'
      and request_outcome.observed_result_scalar = request_outcome.business_result
      and request_outcome.observed_status_scalar = request_outcome.business_status
      and approve_outcome.business_result = request_outcome.business_result
      and approve_outcome.business_status = request_outcome.business_status
      and approve_outcome.observed_result_scalar = approve_outcome.business_result
      and approve_outcome.observed_status_scalar = approve_outcome.business_status
      and request_journal.created_at < approve_journal.created_at
      and (select count(*) from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id = attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.stage = 'request'
          and journal.event = 'result') = 1
      and (select count(*) from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id = attempt.id
          and journal.pending_approval_recovery_id is null
          and journal.stage = 'approve'
          and journal.event = 'result') = 1
      and not exists (
        select 1 from public.refund_nayax_provider_stage_journal journal
        where journal.nayax_refund_attempt_id = attempt.id
          and journal.pending_approval_recovery_id is not null
      )
      and not exists (
        select 1
        from public.refund_case_nayax_refund_attempts other_attempt
        where other_attempt.id <> attempt.id
          and other_attempt.refund_case_id = refund_case.id
          and (
            other_attempt.status in ('in_progress', 'requested', 'approved', 'succeeded')
            or other_attempt.provider_outcome = 'success'
          )
      )
  );
$$;

revoke all on function public.refund_nayax_unsettled_api_success_journal_proved(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.refund_nayax_unsettled_api_success_duplicate_proved(
  p_case_id uuid,
  p_attempt_id uuid,
  p_duplicate_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.refund_nayax_unsettled_api_success_journal_proved(p_case_id, p_attempt_id)
    and exists (
      select 1
      from public.refund_cases canonical
      join public.refund_cases duplicate
        on duplicate.id = p_duplicate_case_id
      join public.refund_case_nayax_refund_attempts attempt
        on attempt.id = p_attempt_id
        and attempt.refund_case_id = canonical.id
      join public.refund_case_official_action_authorizations authz
        on authz.id = attempt.official_action_authorization_id
      where canonical.id = p_case_id
        and canonical.status in ('approved', 'card_refund_pending')
        and canonical.decision = 'approved'
        and canonical.nayax_refund_execution_status = 'requested'
        and canonical.official_action_version = authz.expected_case_version + 1
        and not canonical.nayax_match_execution_eligible
        and canonical.refund_completed_at is null
        and canonical.reporting_adjustment_id is null
        and canonical.manual_refund_reference is null
        and canonical.duplicate_of_refund_case_id is null
        and attempt.status = 'in_progress'
        and attempt.provider_outcome is null
        and attempt.provider_outcome_recorded_at is null
        and attempt.provider_claim_consumed_at is null
        and attempt.reconciliation_required
        and attempt.safe_transport_stage = 'approval_result'
        and attempt.provider_status is null
        and attempt.provider_reference is null
        and attempt.error_code is null
        and attempt.reporting_adjustment_id is null
        and attempt.case_finalization_committed_at is null
        and attempt.completed_at is null
        and attempt.completion_message_id is null
        and attempt.completion_gmail_thread_id is null
        and attempt.completion_delivery_status = 'not_claimed'
        and duplicate.id <> canonical.id
        and duplicate.case_population = 'customer'
        and duplicate.intake_source = canonical.intake_source
        and duplicate.status in ('submitted', 'needs_review', 'correlated')
        and duplicate.decision is null
        and duplicate.duplicate_of_refund_case_id = canonical.id
        and duplicate.refund_completed_at is null
        and duplicate.reporting_adjustment_id is null
        and duplicate.manual_refund_reference is null
        and duplicate.nayax_refund_execution_status = 'not_requested'
        and not duplicate.nayax_match_execution_eligible
        and duplicate.matched_nayax_transaction_id is null
        and duplicate.matched_nayax_site_id is null
        and duplicate.matched_nayax_amount_cents is null
        and duplicate.matched_nayax_currency_code is null
        and duplicate.refund_business_fingerprint is not null
        and duplicate.refund_business_fingerprint = canonical.refund_business_fingerprint
        and lower(btrim(duplicate.customer_email)) = lower(btrim(canonical.customer_email))
        and duplicate.reporting_machine_id = canonical.reporting_machine_id
        and duplicate.reporting_location_id = canonical.reporting_location_id
        and duplicate.incident_at = canonical.incident_at
        and duplicate.payment_method = canonical.payment_method
        and duplicate.payment_amount_cents = canonical.payment_amount_cents
        and duplicate.card_last4 = canonical.card_last4
        and duplicate.card_network is not distinct from canonical.card_network
        and duplicate.card_wallet_used = canonical.card_wallet_used
        and duplicate.wallet_provider is not distinct from canonical.wallet_provider
        and duplicate.wallet_device_kind is not distinct from canonical.wallet_device_kind
        and duplicate.payment_interaction is not distinct from canonical.payment_interaction
        and duplicate.issue_category is not distinct from canonical.issue_category
        and exists (
          select 1
          from public.refund_case_reconciliation_reviews review
          where review.left_refund_case_id = least(canonical.id, duplicate.id)
            and review.right_refund_case_id = greatest(canonical.id, duplicate.id)
            and review.status = 'confirmed_duplicate'
            and review.canonical_refund_case_id = canonical.id
            and review.resolution_reason_code = 'same_incident'
            and review.resolved_at is not null
            and review.resolved_by = duplicate.duplicate_marked_by
        )
        and not public.refund_case_has_official_action(duplicate.id)
        and not exists (select 1 from public.refund_case_nayax_refund_attempts other_attempt
          where other_attempt.refund_case_id = duplicate.id)
        and not exists (select 1 from public.refund_authoritative_receipts receipt
          where receipt.refund_case_id in (canonical.id, duplicate.id))
        and not exists (select 1 from public.sales_adjustment_facts adjustment
          where adjustment.refund_case_id in (canonical.id, duplicate.id))
        and not exists (select 1 from public.refund_case_messages message
          where message.refund_case_id in (canonical.id, duplicate.id))
        and not exists (select 1 from public.refund_case_official_action_authorizations other_authorization
          where other_authorization.refund_case_id = duplicate.id)
    ),
    false
  );
$$;

revoke all on function public.refund_nayax_unsettled_api_success_duplicate_proved(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Shared database-owned claim kernel. The public service wrapper keeps its
-- executor assertion; the exact journal recovery can call this private kernel
-- only after payment/accounting/receipt evidence commits in the same transaction.
create function public.refund_claim_nayax_refund_completion_internal(
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  case_row public.refund_cases%rowtype;
  thread_row public.refund_gmail_threads%rowtype;
  message_row public.refund_case_messages%rowtype;
  completion_subject text;
  completion_body text;
begin
  if p_attempt_id is null then
    raise exception 'Nayax provider attempt required';
  end if;

  select attempt.*
  into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.id = p_attempt_id
  for update;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = attempt_row.refund_case_id
  for share;

  if attempt_row.id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reconciliation_required
    or attempt_row.reporting_adjustment_id is null
    or attempt_row.case_finalization_committed_at is null
    or case_row.status is distinct from 'completed'
    or case_row.refund_completed_at is null
    or case_row.reporting_adjustment_id is distinct from attempt_row.reporting_adjustment_id then
    raise exception 'Fully committed Nayax success required before customer completion';
  end if;

  select thread.*
  into thread_row
  from public.refund_gmail_threads thread
  where thread.refund_case_id = case_row.id
  order by thread.first_message_at, thread.id
  limit 1
  for update;

  if thread_row.id is null then
    raise exception 'Original case-bound Gmail thread required for Nayax completion';
  end if;

  completion_subject :=
    'Your ' ||
    to_char(case_row.refund_amount_cents::numeric / 100, 'FM$999999990.00') ||
    ' Bloomjoy refund is on its way';
  completion_body := concat_ws(
    E'\n\n',
    'Hi there,',
    'We issued your ' ||
      to_char(case_row.refund_amount_cents::numeric / 100, 'FM$999999990.00') ||
      ' refund' ||
      case
        when case_row.matched_nayax_card_last4 ~ '^[0-9]{4}$'
          then ' to the card ending in ' || case_row.matched_nayax_card_last4
        else ''
      end ||
      ' on ' ||
      to_char(
        case_row.refund_completed_at at time zone 'America/Los_Angeles',
        'Mon FMDD, YYYY'
      ) || '.',
    'Your bank or card issuer may take up to 4 business days to show the credit. If it is not visible after that, reply to this email with the reference below. We are sorry this needed a refund, and we appreciate the chance to make it right.',
    'Reference: ' || case_row.public_reference,
    E'Warmly,\nBloomjoy Sweets'
  );

  if attempt_row.completion_message_id is not null then
    select message.*
    into message_row
    from public.refund_case_messages message
    where message.id = attempt_row.completion_message_id;

    if message_row.id is null
      or message_row.refund_case_id is distinct from case_row.id
      or message_row.nayax_refund_attempt_id is distinct from attempt_row.id
      or attempt_row.completion_gmail_thread_id is distinct from thread_row.id then
      raise exception 'Nayax completion claim evidence changed';
    end if;

    return jsonb_build_object(
      'claimed', false,
      'refundCaseId', case_row.id,
      'refundCaseMessageId', message_row.id,
      'gmailThreadId', thread_row.id,
      'recipientEmail', case_row.customer_email,
      'subject', message_row.subject,
      'body', message_row.body,
      'status', attempt_row.completion_delivery_status,
      'originalThread', true
    );
  end if;

  insert into public.refund_case_messages (
    refund_case_id,
    message_type,
    status,
    recipient_email,
    subject,
    body,
    template_key,
    created_by,
    content_source,
    delivery_kind,
    template_version,
    requested_fields,
    nayax_refund_attempt_id
  ) values (
    case_row.id,
    'completed',
    'pending',
    case_row.customer_email,
    completion_subject,
    completion_body,
    'refund_nayax_completed_v2',
    attempt_row.actor_user_id,
    'deterministic_template',
    'manual',
    'refund_nayax_completion_v2',
    '{}'::text[],
    attempt_row.id
  )
  returning * into message_row;

  update public.refund_case_nayax_refund_attempts
  set
    completion_message_id = message_row.id,
    completion_gmail_thread_id = thread_row.id,
    completion_delivery_status = 'pending'
  where id = attempt_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    attempt_row.actor_user_id,
    'nayax_customer_completion_claimed',
    'The post-refund customer reply was bound to the original Gmail thread.',
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'refund_case_message_id', message_row.id,
      'original_thread', true,
      'manager_completion_notice_sent', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'claimed', true,
    'refundCaseId', case_row.id,
    'refundCaseMessageId', message_row.id,
    'gmailThreadId', thread_row.id,
    'recipientEmail', case_row.customer_email,
    'subject', message_row.subject,
    'body', message_row.body,
    'status', 'pending',
    'originalThread', true
  );
end;
$$;

revoke all on function public.refund_claim_nayax_refund_completion_internal(uuid)
  from public, anon, authenticated, service_role;

-- Form-origin refunds do not have a Gmail thread to reply to. Once the same
-- immutable API receipt exists, use the canonical receipt-completion intent and
-- automatic outbox instead. This function only queues durable delivery work;
-- the outbox owns the first provider attempt with its existing row-lock claim.
create function public.refund_claim_nayax_form_receipt_completion_internal(
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  receipt_row public.refund_authoritative_receipts%rowtype;
  authority_row public.refund_receipt_completion_automation_authorities%rowtype;
  intent_row public.refund_receipt_completion_intents%rowtype;
  message_row public.refund_case_messages%rowtype;
  completion_copy jsonb;
  intent_id uuid;
begin
  select refund_case.* into case_row
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_cases refund_case on refund_case.id = attempt.refund_case_id
  where attempt.id = p_attempt_id
  for update of refund_case;
  select * into attempt_row from public.refund_case_nayax_refund_attempts
    where id = p_attempt_id and refund_case_id = case_row.id for share;
  select * into receipt_row from public.refund_authoritative_receipts
    where refund_case_id = case_row.id and nayax_refund_attempt_id = attempt_row.id
      and confirmation_source = 'api_stage_contract' for share;

  if case_row.id is null or attempt_row.id is null or receipt_row.id is null
    or case_row.intake_source is distinct from 'form'
    or case_row.case_population is distinct from 'customer'
    or case_row.payment_method is distinct from 'card'
    or case_row.status is distinct from 'completed'
    or case_row.refund_completed_at is null
    or case_row.reporting_adjustment_id is null
    or attempt_row.status is distinct from 'succeeded'
    or attempt_row.provider_outcome is distinct from 'success'
    or attempt_row.reconciliation_required
    or attempt_row.reporting_adjustment_id is distinct from case_row.reporting_adjustment_id
    or attempt_row.case_finalization_committed_at is null
    or receipt_row.attempt_binding_kind is distinct from 'proved_terminal_api'
    or receipt_row.provider_status is not null
    or receipt_row.refunded_amount_cents is distinct from case_row.refund_amount_cents
    or receipt_row.refunded_amount_cents is distinct from receipt_row.original_amount_cents
    or receipt_row.currency_code is distinct from 'USD'
    or not public.refund_nayax_api_terminal_evidence_proved(case_row.id, attempt_row.id) then
    raise exception 'Fully committed form refund with exact API receipt required';
  end if;

  select * into intent_row from public.refund_receipt_completion_intents
    where receipt_id = receipt_row.id;
  if intent_row.receipt_id is not null then
    select * into message_row from public.refund_case_messages
      where id = intent_row.message_id;
    if message_row.id is null
      or not public.is_refund_receipt_completion_message(to_jsonb(message_row))
      or message_row.delivery_kind is distinct from 'automatic' then
      raise exception 'Canonical form receipt completion binding is inconsistent'
        using errcode = 'P4668';
    end if;
    return jsonb_build_object(
      'claimed', false, 'refundCaseId', case_row.id,
      'refundCaseMessageId', message_row.id, 'gmailThreadId', null,
      'recipientEmail', message_row.recipient_email,
      'subject', message_row.subject, 'body', message_row.body,
      'status', case when message_row.status = 'sent' then 'already_sent'
        else coalesce(message_row.manual_delivery_state, message_row.status) end,
      'transport', 'transactional_email', 'originalThread', false,
      'noticeDeferred', message_row.manual_delivery_state = 'queued'
        and message_row.manual_delivery_provider_attempted_at is null,
      'payloadRedacted', true
    );
  end if;

  if exists(select 1 from public.refund_completion_notice_adoptions notice
      where notice.receipt_id = receipt_row.id)
    or exists(select 1 from public.refund_external_notice_observations notice
      where notice.receipt_id = receipt_row.id)
    or exists(select 1 from public.refund_case_messages message
      where message.refund_case_id = case_row.id and message.message_type = 'completed') then
    return jsonb_build_object(
      'claimed', false, 'refundCaseId', case_row.id,
      'refundCaseMessageId', null, 'gmailThreadId', null,
      'status', 'notice_deferred', 'transport', null,
      'originalThread', false, 'noticeDeferred', true,
      'payloadRedacted', true
    );
  end if;

  completion_copy := public.refund_receipt_completion_copy(case_row.id);
  if completion_copy is null
    or lower(btrim(coalesce(completion_copy ->> 'recipientEmail', ''))) is distinct from
      lower(btrim(coalesce(case_row.customer_email, '')))
    or lower(btrim(coalesce(case_row.customer_email, ''))) !~
      '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    return jsonb_build_object(
      'claimed', false, 'refundCaseId', case_row.id,
      'refundCaseMessageId', null, 'gmailThreadId', null,
      'status', 'notice_deferred', 'transport', null,
      'originalThread', false, 'noticeDeferred', true,
      'payloadRedacted', true
    );
  end if;

  select * into authority_row
  from public.refund_receipt_completion_automation_authorities
  where receipt_id = receipt_row.id;
  if authority_row.id is null then
    insert into public.refund_receipt_completion_automation_authorities(
      receipt_id, refund_case_id, expected_case_version,
      authorized_actor_user_id, source_kind, source_policy,
      source_event_digest, receipt_observed_at
    ) values (
      receipt_row.id, case_row.id, case_row.official_action_version,
      receipt_row.recorded_by, 'nayax_api_terminal',
      'verified_terminal_refund_v1', receipt_row.evidence_reference_digest,
      receipt_row.observed_at
    ) returning * into authority_row;
  elsif authority_row.refund_case_id is distinct from case_row.id
    or authority_row.expected_case_version is distinct from case_row.official_action_version
    or authority_row.authorized_actor_user_id is distinct from receipt_row.recorded_by
    or authority_row.source_kind is distinct from 'nayax_api_terminal'
    or authority_row.source_policy is distinct from 'verified_terminal_refund_v1'
    or authority_row.source_event_digest is distinct from receipt_row.evidence_reference_digest
    or authority_row.receipt_observed_at is distinct from receipt_row.observed_at then
    raise exception 'Form receipt completion authority conflicts with payment evidence'
      using errcode = 'P4668';
  end if;

  intent_id := gen_random_uuid();
  message_row.id := gen_random_uuid();
  message_row.refund_case_id := case_row.id;
  message_row.message_type := 'completed';
  message_row.status := 'pending';
  message_row.recipient_email := completion_copy ->> 'recipientEmail';
  message_row.subject := completion_copy ->> 'subject';
  message_row.body := completion_copy ->> 'body';
  message_row.template_key := 'refund_receipt_completed';
  message_row.template_version := 'refund_receipt_completion_v1';
  message_row.created_by := authority_row.authorized_actor_user_id;
  message_row.content_source := 'deterministic_template';
  message_row.delivery_kind := 'automatic';
  message_row.requested_fields := '{}'::text[];
  message_row.manual_delivery_intent_id := intent_id;
  message_row.manual_delivery_state := 'queued';
  message_row.manual_delivery_expected_case_version := case_row.official_action_version;
  message_row.manual_delivery_status_link_requested := false;

  insert into public.refund_receipt_completion_intents(
    receipt_id, refund_case_id, message_id, intent_id, expected_case_version,
    actor_user_id, message_identity_digest, reviewed_no_existing_notice,
    automation_authority_id
  ) values (
    receipt_row.id, case_row.id, message_row.id, intent_id,
    case_row.official_action_version, authority_row.authorized_actor_user_id,
    public.refund_receipt_completion_message_digest(to_jsonb(message_row)),
    false, authority_row.id
  );
  if not public.is_refund_receipt_completion_message(to_jsonb(message_row)) then
    raise exception 'Form receipt completion identity changed' using errcode = 'P4668';
  end if;
  insert into public.refund_case_messages(
    id, refund_case_id, message_type, status, recipient_email, subject, body,
    template_key, template_version, created_by, content_source, delivery_kind,
    requested_fields, manual_delivery_intent_id, manual_delivery_state,
    manual_delivery_expected_case_version, manual_delivery_status_link_requested
  ) values (
    message_row.id, message_row.refund_case_id, message_row.message_type,
    message_row.status, message_row.recipient_email, message_row.subject,
    message_row.body, message_row.template_key, message_row.template_version,
    message_row.created_by, message_row.content_source, message_row.delivery_kind,
    message_row.requested_fields, message_row.manual_delivery_intent_id,
    message_row.manual_delivery_state,
    message_row.manual_delivery_expected_case_version, false
  );
  insert into public.refund_case_events(
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id, authority_row.authorized_actor_user_id,
    'customer_message_queued',
    'Confirmed-refund notice entered the existing delivery queue from immutable API receipt authority.',
    jsonb_build_object(
      'message_id', message_row.id, 'receipt_id', receipt_row.id,
      'automation_authority_id', authority_row.id,
      'message_type', 'completed', 'provider_call_made', false,
      'payload_redacted', true
    )
  );
  return jsonb_build_object(
    'claimed', true, 'refundCaseId', case_row.id,
    'refundCaseMessageId', message_row.id, 'gmailThreadId', null,
    'recipientEmail', message_row.recipient_email,
    'subject', message_row.subject, 'body', message_row.body,
    'status', 'queued', 'transport', 'transactional_email',
    'originalThread', false, 'noticeDeferred', false,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.refund_claim_nayax_form_receipt_completion_internal(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.service_claim_nayax_refund_completion(
  p_executor_assertion text,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  use_form_receipt_outbox boolean := false;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  select refund_case.* into case_row
  from public.refund_case_nayax_refund_attempts attempt
  join public.refund_cases refund_case on refund_case.id = attempt.refund_case_id
  where attempt.id = p_attempt_id
  for update of refund_case;
  select case_row.id is not null and case_row.intake_source = 'form'
    and exists(select 1 from public.refund_authoritative_receipts receipt
      where receipt.refund_case_id = case_row.id
        and receipt.nayax_refund_attempt_id = p_attempt_id
        and receipt.confirmation_source = 'api_stage_contract'
        and receipt.attempt_binding_kind = 'proved_terminal_api')
    and not exists(select 1 from public.refund_gmail_threads thread
      where thread.refund_case_id = case_row.id)
  into use_form_receipt_outbox;
  if use_form_receipt_outbox then
    return public.refund_claim_nayax_form_receipt_completion_internal(p_attempt_id);
  end if;
  return public.refund_claim_nayax_refund_completion_internal(p_attempt_id);
end;
$$;

revoke all on function public.service_claim_nayax_refund_completion(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_claim_nayax_refund_completion(text, uuid)
  to service_role;

-- The case and attempt guards may admit this transition only when the stored
-- request/approve journal still proves success and the duplicate and accounting
-- rows already have the exact recovery binding. A caller-controlled setting is
-- therefore only an identifier, never authorization by itself.
create function public.refund_journal_duplicate_recovery_case_change_allowed(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_old ->> 'id' = p_new ->> 'id'
    and nullif(current_setting('bloomjoy.nayax_journal_recovery_attempt_id', true), '') is not null
    and nullif(current_setting('bloomjoy.nayax_journal_recovery_duplicate_id', true), '') is not null
    and public.refund_nayax_unsettled_api_success_journal_proved(
      (p_old ->> 'id')::uuid,
      current_setting('bloomjoy.nayax_journal_recovery_attempt_id', true)::uuid
    )
    and p_old ->> 'status' in ('approved', 'card_refund_pending')
    and p_old ->> 'decision' = 'approved'
    and p_old ->> 'nayax_refund_execution_status' = 'requested'
    and nullif(p_old ->> 'reporting_adjustment_id', '') is null
    and p_new ->> 'status' = 'completed'
    and p_new ->> 'decision' = 'approved'
    and p_new ->> 'nayax_refund_execution_status' = 'approved'
    and coalesce((p_new ->> 'nayax_match_execution_eligible')::boolean, false) = false
    and nullif(p_new ->> 'reporting_adjustment_id', '') is not null
    and nullif(p_new ->> 'manual_refund_reference', '') is not null
    and nullif(p_new ->> 'refund_completed_by', '') is not null
    and nullif(p_new ->> 'refund_completed_at', '') is not null
    and p_new ->> 'automation_state' = 'completed'
    and exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      join public.refund_case_official_action_authorizations authz
        on authz.id = attempt.official_action_authorization_id
      join public.refund_cases duplicate
        on duplicate.id = current_setting(
          'bloomjoy.nayax_journal_recovery_duplicate_id', true
        )::uuid
      join public.sales_adjustment_facts adjustment
        on adjustment.id = (p_new ->> 'reporting_adjustment_id')::uuid
      where attempt.id = current_setting(
          'bloomjoy.nayax_journal_recovery_attempt_id', true
        )::uuid
        and attempt.refund_case_id = (p_old ->> 'id')::uuid
        and attempt.status = 'in_progress'
        and attempt.provider_outcome is null
        and attempt.provider_outcome_recorded_at is null
        and attempt.reporting_adjustment_id is null
        and (p_old ->> 'official_action_version')::bigint
          = authz.expected_case_version + 1
        and duplicate.duplicate_of_refund_case_id = (p_old ->> 'id')::uuid
        and duplicate.duplicate_marked_at is not null
        and duplicate.duplicate_marked_by is not null
        and exists (
          select 1 from public.refund_case_reconciliation_reviews review
          where review.left_refund_case_id = least((p_old ->> 'id')::uuid, duplicate.id)
            and review.right_refund_case_id = greatest((p_old ->> 'id')::uuid, duplicate.id)
            and review.status = 'confirmed_duplicate'
            and review.canonical_refund_case_id = (p_old ->> 'id')::uuid
            and review.resolution_reason_code = 'same_incident'
            and review.resolved_by = duplicate.duplicate_marked_by
            and review.resolved_at is not null
        )
        and adjustment.refund_case_id = (p_old ->> 'id')::uuid
        and adjustment.reporting_machine_id = (p_new ->> 'reporting_machine_id')::uuid
        and adjustment.reporting_location_id = (p_new ->> 'reporting_location_id')::uuid
        and adjustment.amount_cents = (p_new ->> 'refund_amount_cents')::integer
        and adjustment.source = 'refund_case'
        and adjustment.adjustment_type = 'refund'
        and adjustment.match_status = 'applied'
    )
    and (p_new - array[
      'status', 'manual_refund_reference', 'refund_completed_by',
      'refund_completed_at', 'automation_state', 'nayax_refund_execution_status',
      'reporting_adjustment_id', 'updated_at', 'official_action_version'
    ]::text[]) is not distinct from (p_old - array[
      'status', 'manual_refund_reference', 'refund_completed_by',
      'refund_completed_at', 'automation_state', 'nayax_refund_execution_status',
      'reporting_adjustment_id', 'updated_at', 'official_action_version'
    ]::text[]),
    false
  );
$$;

revoke all on function public.refund_journal_duplicate_recovery_case_change_allowed(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create function public.refund_journal_duplicate_recovery_attempt_change_allowed(
  p_old jsonb,
  p_new jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_old ->> 'id' = p_new ->> 'id'
    and p_old ->> 'id' = current_setting(
      'bloomjoy.nayax_journal_recovery_attempt_id', true
    )
    and public.refund_nayax_unsettled_api_success_journal_proved(
      (p_old ->> 'refund_case_id')::uuid,
      (p_old ->> 'id')::uuid
    )
    and p_old ->> 'status' = 'in_progress'
    and nullif(p_old ->> 'provider_outcome', '') is null
    and nullif(p_old ->> 'provider_outcome_recorded_at', '') is null
    and nullif(p_old ->> 'provider_claim_consumed_at', '') is null
    and nullif(p_old ->> 'reporting_adjustment_id', '') is null
    and p_new ->> 'status' = 'succeeded'
    and p_new ->> 'provider_outcome' = 'success'
    and p_new ->> 'provider_status' = 'approve_succeeded_contract_match'
    -- The authoritative receipt guard runs before the existing safe-state
    -- normalizer, so this guard sees the unchanged approval_result stage. The
    -- later normalizer deterministically publishes settled for success.
    and p_old ->> 'safe_transport_stage' = 'approval_result'
    and p_new ->> 'safe_transport_stage' = 'approval_result'
    and nullif(p_new ->> 'provider_reference', '') is not null
    and nullif(p_new ->> 'provider_claim_consumed_at', '') is not null
    and nullif(p_new ->> 'provider_outcome_recorded_at', '') is not null
    and coalesce((p_new ->> 'reconciliation_required')::boolean, true) = false
    and nullif(p_new ->> 'reporting_adjustment_id', '') is not null
    and nullif(p_new ->> 'case_finalization_committed_at', '') is not null
    and nullif(p_new ->> 'completed_at', '') is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      join public.refund_case_official_action_authorizations authz
        on authz.id = (p_old ->> 'official_action_authorization_id')::uuid
      join public.refund_cases duplicate
        on duplicate.id = current_setting(
          'bloomjoy.nayax_journal_recovery_duplicate_id', true
        )::uuid
      join public.sales_adjustment_facts adjustment
        on adjustment.id = (p_new ->> 'reporting_adjustment_id')::uuid
      where refund_case.id = (p_old ->> 'refund_case_id')::uuid
        and refund_case.status = 'completed'
        and refund_case.decision = 'approved'
        and refund_case.official_action_version = authz.expected_case_version + 2
        and refund_case.nayax_refund_execution_status = 'approved'
        and refund_case.reporting_adjustment_id = adjustment.id
        and duplicate.duplicate_of_refund_case_id = refund_case.id
        and adjustment.refund_case_id = refund_case.id
    )
    and (p_new - array[
      'status', 'provider_reference', 'provider_status', 'error_code',
      'sanitized_response', 'provider_claim_consumed_at', 'provider_outcome',
      'provider_outcome_recorded_at', 'reconciliation_required',
      'reporting_adjustment_id', 'case_finalization_committed_at', 'completed_at',
      'safe_transport_stage', 'safe_failure_class', 'refund_operations_due_at',
      'updated_at'
    ]::text[]) is not distinct from (p_old - array[
      'status', 'provider_reference', 'provider_status', 'error_code',
      'sanitized_response', 'provider_claim_consumed_at', 'provider_outcome',
      'provider_outcome_recorded_at', 'reconciliation_required',
      'reporting_adjustment_id', 'case_finalization_committed_at', 'completed_at',
      'safe_transport_stage', 'safe_failure_class', 'refund_operations_due_at',
      'updated_at'
    ]::text[]),
    false
  );
$$;

revoke all on function public.refund_journal_duplicate_recovery_attempt_change_allowed(jsonb, jsonb)
  from public, anon, authenticated, service_role;

do $migration$
declare body text; anchor text; replacement text;
begin
  body := replace(pg_get_functiondef(
    'public.guard_refund_authoritative_receipt_effects()'::regprocedure
  ), E'\r\n', E'\n');
  anchor := E'begin\n  if tg_table_name=';
  replacement := E'begin\n  if tg_table_name=''refund_cases'' and tg_op=''UPDATE''\n'
    || E'    and public.refund_journal_duplicate_recovery_case_change_allowed(to_jsonb(old),to_jsonb(new)) then return new; end if;\n'
    || E'  if tg_table_name=''refund_case_nayax_refund_attempts'' and tg_op=''UPDATE''\n'
    || E'    and public.refund_journal_duplicate_recovery_attempt_change_allowed(to_jsonb(old),to_jsonb(new)) then return new; end if;\n'
    || E'  if tg_table_name=';
  if cardinality(string_to_array(body, anchor)) <> 2 then
    raise exception 'Unexpected authoritative receipt guard shape for journal recovery';
  end if;
  execute replace(body, anchor, replacement);

  body := replace(pg_get_functiondef(
    'public.guard_refund_case_active_nayax_attempt()'::regprocedure
  ), E'\r\n', E'\n');
  anchor := E'begin\n  if public.refund_terminal_receipt_case_change_allowed';
  replacement := E'begin\n  if public.refund_journal_duplicate_recovery_case_change_allowed(to_jsonb(old),to_jsonb(new)) then return new; end if;\n'
    || E'  if public.refund_terminal_receipt_case_change_allowed';
  if cardinality(string_to_array(body, anchor)) <> 2 then
    raise exception 'Unexpected active Nayax attempt guard shape for journal recovery';
  end if;
  execute replace(body, anchor, replacement);

  body := replace(pg_get_functiondef(
    'public.guard_refund_provider_hold_case_update()'::regprocedure
  ), E'\r\n', E'\n');
  anchor := E'begin\n  if public.refund_terminal_receipt_case_change_allowed';
  replacement := E'begin\n  if public.refund_journal_duplicate_recovery_case_change_allowed(to_jsonb(old),to_jsonb(new)) then return new; end if;\n'
    || E'  if public.refund_terminal_receipt_case_change_allowed';
  if cardinality(string_to_array(body, anchor)) <> 2 then
    raise exception 'Unexpected provider hold case guard shape for journal recovery';
  end if;
  execute replace(body, anchor, replacement);
end;
$migration$;

create function public.service_recover_proved_nayax_api_success_with_duplicate(
  p_refund_case_id uuid,
  p_nayax_refund_attempt_id uuid,
  p_duplicate_refund_case_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical public.refund_cases%rowtype;
  duplicate public.refund_cases%rowtype;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  authz public.refund_case_official_action_authorizations%rowtype;
  approve_journal public.refund_nayax_provider_stage_journal%rowtype;
  adjustment public.sales_adjustment_facts%rowtype;
  receipt_id uuid;
  review_id uuid;
  recovery_at timestamptz := statement_timestamp();
  recovered_provider_reference text;
  completion_claim jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_refund_case_id is null or p_nayax_refund_attempt_id is null
    or p_duplicate_refund_case_id is null
    or p_refund_case_id = p_duplicate_refund_case_id then
    raise exception 'Exact canonical case, attempt, and sibling duplicate are required';
  end if;

  perform 1 from public.refund_cases refund_case
    where refund_case.id in (p_refund_case_id, p_duplicate_refund_case_id)
    order by refund_case.id for update;
  select * into canonical from public.refund_cases where id = p_refund_case_id;
  select * into duplicate from public.refund_cases where id = p_duplicate_refund_case_id;
  select * into attempt from public.refund_case_nayax_refund_attempts
    where id = p_nayax_refund_attempt_id and refund_case_id = p_refund_case_id
    for update;

  if canonical.id is null or duplicate.id is null or attempt.id is null then
    raise exception 'Recovery target was not found';
  end if;

  if public.refund_nayax_api_terminal_evidence_proved(canonical.id, attempt.id)
    and duplicate.duplicate_of_refund_case_id = canonical.id
    and exists (
      select 1 from public.refund_case_reconciliation_reviews review
      where review.left_refund_case_id = least(canonical.id, duplicate.id)
        and review.right_refund_case_id = greatest(canonical.id, duplicate.id)
        and review.status = 'confirmed_duplicate'
        and review.canonical_refund_case_id = canonical.id
        and review.resolution_reason_code = 'same_incident'
        and review.resolved_by = duplicate.duplicate_marked_by
    )
    and exists (
      select 1 from public.refund_case_events event
      where event.refund_case_id = canonical.id
        and event.event_type = 'nayax_journal_success_recovery_completed'
        and event.metadata ->> 'attempt_id' = attempt.id::text
        and event.metadata ->> 'duplicate_case_id' = duplicate.id::text
        and event.metadata ->> 'payload_redacted' = 'true'
    ) then
    select receipt.id into receipt_id
    from public.refund_authoritative_receipts receipt
    where receipt.refund_case_id = canonical.id
      and receipt.nayax_refund_attempt_id = attempt.id
      and receipt.confirmation_source = 'api_stage_contract';
    if receipt_id is null then
      raise exception 'Completed recovery is missing its authoritative receipt';
    end if;
    select jsonb_build_object(
      'refundCaseMessageId', message.id,
      'status', case when message.status = 'sent' then 'already_sent'
        else coalesce(message.manual_delivery_state, message.status) end,
      'noticeDeferred', false
    ) into completion_claim
    from public.refund_receipt_completion_intents intent
    join public.refund_case_messages message on message.id = intent.message_id
    where intent.receipt_id = receipt_id
      and public.is_refund_receipt_completion_message(to_jsonb(message));
    completion_claim := coalesce(completion_claim, jsonb_build_object(
      'refundCaseMessageId', null, 'status', 'notice_deferred',
      'noticeDeferred', true
    ));
    return jsonb_build_object(
      'recovered', false, 'replayed', true,
      'refundCaseId', canonical.id, 'duplicateRefundCaseId', duplicate.id,
      'nayaxRefundAttemptId', attempt.id, 'terminalReceiptId', receipt_id,
      'refundCaseMessageId', completion_claim -> 'refundCaseMessageId',
      'completionMessageStatus', completion_claim ->> 'status',
      'providerCallMade', false, 'customerMessageSent', false
    );
  end if;

  if not public.refund_nayax_unsettled_api_success_duplicate_proved(
      canonical.id, attempt.id, duplicate.id
    ) then
    raise exception 'Exact journal-proved success and untouched sibling duplicate required'
      using errcode = 'P4674';
  end if;

  select * into authz
  from public.refund_case_official_action_authorizations action_authorization
  where action_authorization.id = attempt.official_action_authorization_id;
  select * into approve_journal
  from public.refund_nayax_provider_stage_journal journal
  where journal.nayax_refund_attempt_id = attempt.id
    and journal.pending_approval_recovery_id is null
    and journal.stage = 'approve' and journal.event = 'result';

  recovered_provider_reference := 'nayax-evidence-' || encode(extensions.digest(convert_to(
    'bloomjoy-nayax-provider-correlation-v1|nayax-production-account-contract-v2|'
      || attempt.idempotency_key, 'UTF8'
  ), 'sha256'), 'hex');

  select review.id into review_id
  from public.refund_case_reconciliation_reviews review
  where review.left_refund_case_id = least(canonical.id, duplicate.id)
    and review.right_refund_case_id = greatest(canonical.id, duplicate.id)
    and review.status = 'confirmed_duplicate'
    and review.canonical_refund_case_id = canonical.id
    and review.resolution_reason_code = 'same_incident'
    and review.resolved_at is not null
    and review.resolved_by = duplicate.duplicate_marked_by
  for share;
  if review_id is null or duplicate.duplicate_of_refund_case_id is distinct from canonical.id then
    raise exception 'An explicit same-incident manager reconciliation is required'
      using errcode = 'P4675';
  end if;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  )
  select case_id, null, 'nayax_journal_success_duplicate_recovery',
    'Service recovery honored the manager-confirmed same-incident link after immutable provider approval evidence was already recorded.',
    jsonb_build_object(
      'review_id', review_id, 'canonical_case_id', canonical.id,
      'duplicate_case_id', duplicate.id, 'attempt_id', attempt.id,
      'authorization_id', authz.id,
      'original_approval_actor_id', authz.actor_user_id,
      'resolution_reason_code', 'same_incident',
      'provider_call_made', false, 'customer_message_sent', false,
      'recovery_authority', 'service_role_with_confirmed_duplicate_and_proved_provider_approval',
      'payload_redacted', true
    )
  from unnest(array[canonical.id, duplicate.id]) case_id;

  insert into public.sales_adjustment_facts (
    reporting_machine_id, reporting_location_id, adjustment_date,
    adjustment_type, amount_cents, complaint_count, source, source_row_hash,
    source_reference, source_row_reference, refund_case_id, match_status,
    match_confidence, notes, raw_payload
  ) values (
    canonical.reporting_machine_id, canonical.reporting_location_id,
    (approve_journal.created_at at time zone 'America/Los_Angeles')::date,
    'refund', attempt.amount_cents, 1, 'refund_case', canonical.id::text,
    'refund_cases', canonical.public_reference, canonical.id, 'applied',
    greatest(canonical.correlation_confidence, 0.01),
    'Bloomjoy refund case ' || canonical.public_reference,
    jsonb_build_object(
      'refund_case_id', canonical.id, 'refund_case_reference', canonical.public_reference,
      'refund_case_status', 'completed', 'refund_case_decision', 'approved',
      'payment_method', canonical.payment_method,
      'correlation_source', canonical.correlation_source,
      'correlation_has_card_lookup', true,
      'nayax_provider_attempt_id', attempt.id,
      'provider_reference_present', true,
      'api_provider_approved_at', approve_journal.created_at,
      'accounting_date_meaning', 'provider_approval_response_date_not_bank_settlement',
      'payload_redacted', true
    )
  ) returning * into adjustment;

  perform set_config('bloomjoy.nayax_journal_recovery_attempt_id', attempt.id::text, true);
  perform set_config('bloomjoy.nayax_journal_recovery_duplicate_id', duplicate.id::text, true);

  update public.refund_cases
  set status = 'completed', decision = 'approved',
      manual_refund_reference = recovered_provider_reference,
      refund_completed_by = authz.actor_user_id,
      refund_completed_at = approve_journal.created_at,
      automation_state = 'completed', nayax_refund_execution_status = 'approved',
      nayax_match_execution_eligible = false,
      reporting_adjustment_id = adjustment.id
  where id = canonical.id;

  update public.refund_case_nayax_refund_attempts
  set status = 'succeeded', provider_reference = recovered_provider_reference,
      provider_status = 'approve_succeeded_contract_match', error_code = null,
      sanitized_response = jsonb_build_object(
        'provider_outcome','success','provider_reference_present',true,
        'journal_proved_recovery',true,
        'provider_approved_at',approve_journal.created_at,
        'recovery_recorded_at',recovery_at,'payload_redacted',true),
      provider_claim_consumed_at = recovery_at,
      provider_outcome = 'success',
      provider_outcome_recorded_at = recovery_at,
      reconciliation_required = false,
      reporting_adjustment_id = adjustment.id,
      case_finalization_committed_at = recovery_at,
      completed_at = recovery_at
  where id = attempt.id;

  receipt_id := public.refund_ensure_proved_nayax_api_terminal_receipt(
    canonical.id, attempt.id
  );
  begin
    completion_claim := public.refund_claim_nayax_form_receipt_completion_internal(
      attempt.id
    );
  exception when others then
    completion_claim := jsonb_build_object(
      'refundCaseMessageId', null, 'status', 'notice_deferred',
      'noticeDeferred', true, 'payloadRedacted', true
    );
    insert into public.refund_case_events(
      refund_case_id, actor_user_id, event_type, message, metadata
    ) values (
      canonical.id, null, 'customer_message_deferred',
      'Confirmed payment was retained while completion-notice preparation was deferred for internal follow-up.',
      jsonb_build_object(
        'attempt_id', attempt.id, 'terminal_receipt_id', receipt_id,
        'provider_call_made', false, 'customer_message_sent', false,
        'reason', 'notice_preparation_failed', 'payload_redacted', true
      )
    );
  end;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    canonical.id, null, 'nayax_journal_success_recovery_completed',
    'Immutable request-and-approval evidence completed the case without another provider or customer delivery call.',
    jsonb_build_object(
      'attempt_id', attempt.id, 'authorization_id', authz.id,
      'review_id', review_id, 'duplicate_case_id', duplicate.id,
      'terminal_receipt_id', receipt_id,
      'refund_case_message_id', completion_claim -> 'refundCaseMessageId',
      'completion_notice_status', completion_claim ->> 'status',
      'provider_approved_at', approve_journal.created_at,
      'recovery_committed_at', recovery_at,
      'provider_call_made', false, 'customer_message_sent', false,
      'recovery_authority', 'service_role_with_confirmed_duplicate_and_proved_provider_approval',
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'recovered', true, 'replayed', false,
    'refundCaseId', canonical.id, 'duplicateRefundCaseId', duplicate.id,
    'nayaxRefundAttemptId', attempt.id, 'terminalReceiptId', receipt_id,
    'reportingAdjustmentId', adjustment.id,
    'refundCaseMessageId', completion_claim -> 'refundCaseMessageId',
    'completionMessageStatus', completion_claim ->> 'status',
    'completionNoticeDeferred', coalesce(
      (completion_claim ->> 'noticeDeferred')::boolean, false
    ),
    'providerApprovedAt', approve_journal.created_at,
    'providerCallMade', false, 'customerMessageSent', false
  );
end;
$$;

revoke all on function public.service_recover_proved_nayax_api_success_with_duplicate(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.service_recover_proved_nayax_api_success_with_duplicate(uuid, uuid, uuid)
  to service_role;

comment on function public.service_recover_proved_nayax_api_success_with_duplicate(uuid, uuid, uuid) is
  'Provider-free recovery of one immutable request-accepted/approval-succeeded attempt blocked by one exact same-incident sibling. Payment truth commits independently; an eligible form notice enters the existing receipt outbox without provider transport.';
