-- Retain weak fingerprints for audit, but do not veto an exact, source-bound
-- Nayax success because a different original purchase shares machine/day/amount.
-- The existing service reconciler may finish held current System journal success;
-- this migration performs no recovery, provider call, or customer-message write.

create or replace function public.refund_nayax_unsettled_api_success_journal_proved(
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
    left join public.refund_manager_action_step_up_intents intent
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
      "machineAuthorizationTimeInstant" timestamptz,
      "machineAuthorizationTime" text,
      "machineAuthorizationTimeWire" text,
      "machineAuthorizationTimeSerializationMode" text,
      "machineAuthorizationTimeSerializationSource" text,
      "refundEmailListMode" text
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
      and attempt.amount_cents = refund_case.refund_amount_cents
      and attempt.amount_cents = refund_case.matched_nayax_amount_cents
      and attempt.currency_code = 'USD'
      and attempt.currency_code = refund_case.matched_nayax_currency_code
      and attempt.idempotency_key ~ '^nayax-refund-[a-f0-9]{64}$'
      and authz.status = 'consumed' and authz.consumed_at is not null
      and authz.refund_case_id = refund_case.id
      and (
        (attempt.actor_user_id = authz.actor_user_id
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
      and authz.nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'
      and intent.status = 'consumed'
      and intent.action = 'nayax_execute'
      and intent.target_function = 'nayax-card-refund'
      and intent.refund_case_id = refund_case.id
      and intent.actor_user_id = authz.actor_user_id
      and intent.verified_totp_at = authz.verified_totp_at
      and intent.nayax_execution_evidence_hash = authz.nayax_execution_evidence_hash
         and authz.expected_case_version = context."caseVersion")
        or
        (attempt.actor_user_id is null and attempt.step_up_intent_id is null
          and authz.step_up_intent_id is null
          and authz.action = 'approve' and authz.authorization_method = 'manager_session'
          and authz.actor_user_id = refund_case.decided_by
          and authz.selected_nayax_candidate_token is not null
          and authz.selected_nayax_candidate_evidence_hash ~ '^[a-f0-9]{64}$'
          and authz.expected_case_version + 1 = context."caseVersion"
          and attempt.execution_plan = 'request_and_approve'
          and attempt.provider_execution_generation = 1
          and request_journal.provider_execution_generation = attempt.provider_execution_generation
          and approve_journal.provider_execution_generation = attempt.provider_execution_generation
          and saved.context->>'providerContractVersion' = 'nayax-production-account-contract-v2'
          and saved.context->>'journalContractVersion' = 'nayax-provider-journal-v3'
          and attempt.idempotency_key = 'nayax-refund-' || encode(extensions.digest(convert_to(
            authz.id::text || '|' || refund_case.id::text || '|' || context."contextHash", 'UTF8'
          ), 'sha256'), 'hex')
          and attempt.request_fingerprint = encode(extensions.digest(convert_to(
            attempt.idempotency_key || '|' || context."contextHash", 'UTF8'
          ), 'sha256'), 'hex'))
      )
      and context."caseId" = refund_case.id
      and context."reportingMachineId" = machine.id
      -- The official-action evidence hash and selected-context hash are two
      -- independent immutable contracts. The former binds authorization to
      -- the intent and request fingerprint; the latter is a self-hash over
      -- the exact request context persisted by the current Woodland path.
      and context."contextHash" ~ '^[a-f0-9]{64}$'
      and context."contextHash" = encode(extensions.digest(convert_to(
        (saved.context - 'contextHash')::text, 'UTF8'
      ), 'sha256'), 'hex')
      and context."machineAuthorizationTimeSerializationMode" = 'exact_source'
      and context."machineAuthorizationTimeSerializationSource" = 'exact_source'
      and context."refundEmailListMode" = 'empty_string'
      and context."machineAuthorizationTimeWire" = context."machineAuthorizationTime"
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

revoke all on function public.refund_nayax_unsettled_api_success_journal_proved(uuid,uuid)
  from public,anon,authenticated,service_role;

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
      and coalesce(new.match_status, '') = 'applied'
      -- A shared machine/day/amount is audit context, not a second original card sale.
      -- Only exact case/source-row/provider success proof bypasses this legacy heuristic.
      and not coalesce(new.source = 'refund_case'
        and new.source_reference = 'refund_cases'
        and new.source_row_hash = refund_case_row.id::text
        and new.source_row_reference = refund_case_row.public_reference
        and new.reporting_machine_id = refund_case_row.reporting_machine_id
        and new.reporting_location_id = refund_case_row.reporting_location_id
        and new.amount_cents = refund_case_row.refund_amount_cents
        and refund_case_row.payment_method = 'card'
        and new.raw_payload->>'nayax_provider_attempt_id' ~
          '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        and public.refund_nayax_unsettled_api_success_journal_proved(
          refund_case_row.id,
          case when new.raw_payload->>'nayax_provider_attempt_id' ~
            '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
            then (new.raw_payload->>'nayax_provider_attempt_id')::uuid else null end), false) then
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

create or replace function public.refund_system_attempt_case_change_allowed_v1(
  p_old jsonb,p_new jsonb
) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1
    from public.refund_case_nayax_refund_attempts attempt
    join public.refund_case_official_action_authorizations approval
      on approval.id=attempt.official_action_authorization_id
    where attempt.id=nullif(current_setting(
        'bloomjoy.nayax_settlement_attempt_id',true),'')::uuid
      and attempt.refund_case_id=(p_old->>'id')::uuid
      and attempt.actor_user_id is null and attempt.step_up_intent_id is null
      and approval.action='approve' and approval.status='consumed'
      and approval.authorization_method='manager_session'
      and (p_old->>'status'='card_refund_pending'
        or (p_old->>'status'='completed' and p_new->>'status'='completed'
          and p_new->>'decision'='approved'
          and p_new->>'nayax_refund_execution_status'='approved'
          and p_old->>'reporting_adjustment_id' is null
          and attempt.status='manual_review' and attempt.provider_outcome='unknown'
          and attempt.reconciliation_required
          and public.refund_nayax_unsettled_api_success_journal_proved(attempt.refund_case_id,attempt.id)
          and (p_old - array['reporting_adjustment_id','official_action_version','updated_at',
            'lifecycle_revision','lifecycle_integrity_status','lifecycle_integrity_code']::text[])
            is not distinct from (p_new - array['reporting_adjustment_id','official_action_version','updated_at',
              'lifecycle_revision','lifecycle_integrity_status','lifecycle_integrity_code']::text[])))
      and p_old->>'decision'='approved'
      and (
        (attempt.status='created' and attempt.provider_claim_digest is null
          and not exists(select 1 from public.refund_nayax_provider_stage_journal journal
            where journal.nayax_refund_attempt_id=attempt.id
              and journal.provider_execution_generation=attempt.provider_execution_generation
              and journal.event='started')
          and p_new->>'status'='card_refund_pending'
          and p_new->>'decision'='approved'
          and p_new->>'nayax_refund_execution_status'='not_requested')
        or
        (attempt.status='in_progress'
          and attempt.provider_claim_consumed_at is null
          and attempt.provider_claim_expires_at>statement_timestamp()
          and attempt.provider_claim_digest=encode(extensions.digest(convert_to(
            nullif(current_setting('bloomjoy.nayax_settlement_provider_claim',true),''),
            'UTF8'),'sha256'),'hex')
          and (
            (p_new->>'status'='completed' and p_new->>'decision'='approved'
              and p_new->>'nayax_refund_execution_status'='approved')
            or
            (p_new->>'status'='card_refund_pending' and p_new->>'decision'='approved'
              and p_new->>'nayax_refund_execution_status'='ambiguous')
          ))
        or
        (attempt.status='manual_review' and attempt.provider_outcome='unknown'
          and attempt.reconciliation_required
          and p_new->>'status'='card_refund_pending'
          and p_new->>'decision'='approved'
          and p_new->>'nayax_refund_execution_status'='ambiguous')
        or
        (attempt.status in ('manual_review','ambiguous')
          and attempt.provider_outcome in ('rejected','timeout','unknown')
          and attempt.reconciliation_required
          and exists(select 1 from public.refund_nayax_system_success_evidence evidence
            where evidence.id=nullif(current_setting(
                'bloomjoy.nayax_system_success_evidence_id',true),'')::uuid
              and evidence.refund_case_id=attempt.refund_case_id
              and evidence.nayax_refund_attempt_id=attempt.id
              and evidence.official_action_authorization_id=approval.id)
          and p_new->>'status'='completed'
          and p_new->>'decision'='approved'
          and p_new->>'nayax_refund_execution_status'='approved')

        or
        (attempt.status='manual_review' and attempt.provider_outcome='unknown'
          and attempt.reconciliation_required
          and attempt.reporting_adjustment_id is null
          and attempt.case_finalization_committed_at is null
          and public.refund_nayax_unsettled_api_success_journal_proved(attempt.refund_case_id,attempt.id)
          and p_new->>'status'='completed' and p_new->>'decision'='approved'
          and p_new->>'nayax_refund_execution_status'='approved'
          and (p_new->>'refund_completed_by')::uuid=approval.actor_user_id
          and coalesce((p_new->>'nayax_match_execution_eligible')::boolean,false)=false
          and (p_old - array['status','manual_refund_reference','refund_completed_by','refund_completed_at',
            'reporting_adjustment_id','automation_state','nayax_refund_execution_status',
            'nayax_match_execution_eligible','official_action_version','updated_at',
            'lifecycle_revision','lifecycle_integrity_status','lifecycle_integrity_code']::text[])
            is not distinct from (p_new - array['status','manual_refund_reference','refund_completed_by','refund_completed_at',
            'reporting_adjustment_id','automation_state','nayax_refund_execution_status',
            'nayax_match_execution_eligible','official_action_version','updated_at',
            'lifecycle_revision','lifecycle_integrity_status','lifecycle_integrity_code']::text[]))
      )
  ),false);
$$;

revoke all on function public.refund_system_attempt_case_change_allowed_v1(jsonb,jsonb)
  from public,anon,authenticated,service_role;

-- Receipt-only recovery of an already-issued direct System refund. The normal
-- completed-case receipt adoption remains unchanged. No claim, replay, message
-- creation, or provider interface is reachable from this function.
create or replace function public.service_reconcile_proved_nayax_api_terminal(
  p_case_id uuid,p_attempt_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  a public.refund_case_nayax_refund_attempts%rowtype;
  z public.refund_case_official_action_authorizations%rowtype;
  adjustment public.sales_adjustment_facts%rowtype;
  approved_at timestamptz;
  receipt_id uuid;
  x jsonb;
  reference text;
  recovery_at timestamptz:=statement_timestamp();
  old_marker text:=current_setting('bloomjoy.nayax_settlement_attempt_id',true);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  select * into c from public.refund_cases where id=p_case_id for update;
  select * into a from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id and refund_case_id=p_case_id for update;
  if c.id is null or a.id is null then
    raise exception 'Exact case and attempt required' using errcode='P4670';
  end if;
  if c.status='completed' then
    receipt_id:=public.refund_ensure_proved_nayax_api_terminal_receipt(c.id,a.id);
  else
    select * into z from public.refund_case_official_action_authorizations
      where id=a.official_action_authorization_id for share;
    perform 1 from public.reporting_machines where id=c.reporting_machine_id for share;
    select context into x from public.refund_nayax_execution_contexts
      where attempt_id=a.id and refund_case_id=c.id for share;
    if c.status<>'card_refund_pending' or c.decision<>'approved'
      or c.reporting_adjustment_id is not null
      or c.refund_completed_at is not null
      or c.nayax_refund_execution_status<>'ambiguous'
      or a.actor_user_id is not null or a.step_up_intent_id is not null
      or a.status<>'manual_review' or a.provider_outcome<>'unknown'
      or not a.reconciliation_required
      or a.reporting_adjustment_id is not null
      or a.case_finalization_committed_at is not null
      or exists(select 1 from public.refund_authoritative_receipts where refund_case_id=c.id)
      or not public.refund_nayax_unsettled_api_success_journal_proved(c.id,a.id) then
      raise exception 'Exact held System approval and immutable provider success required'
        using errcode='P4670';
    end if;
    -- The unique exact success pair was proved above. Its observed time is not
    -- a bank-settlement timestamp; preserve that distinction in the ledger.
    select created_at into strict approved_at from public.refund_nayax_provider_stage_journal
      where nayax_refund_attempt_id=a.id and stage='approve' and event='result'
        and pending_approval_recovery_id is null
        and provider_execution_generation=a.provider_execution_generation;
    reference:='nayax-evidence-'||encode(extensions.digest(convert_to(
      'bloomjoy-nayax-provider-correlation-v1|nayax-production-account-contract-v2|'
        ||a.idempotency_key,'UTF8'),'sha256'),'hex');
    perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',a.id::text,true);
    update public.refund_cases set status='completed',manual_refund_reference=reference,
      refund_completed_by=z.actor_user_id,refund_completed_at=approved_at,
      automation_state='completed',nayax_refund_execution_status='approved',
      nayax_match_execution_eligible=false where id=c.id;
    insert into public.sales_adjustment_facts(reporting_machine_id,reporting_location_id,
      adjustment_date,adjustment_type,amount_cents,complaint_count,source,source_row_hash,
      source_reference,source_row_reference,refund_case_id,match_status,match_confidence,
      notes,raw_payload)
    values(c.reporting_machine_id,c.reporting_location_id,
      (approved_at at time zone 'America/Los_Angeles')::date,'refund',a.amount_cents,1,
      'refund_case',c.id::text,'refund_cases',c.public_reference,c.id,'applied',
      greatest(c.correlation_confidence,0.01),'Bloomjoy refund case '||c.public_reference,
      jsonb_build_object('refund_case_id',c.id,'refund_case_reference',c.public_reference,
        'refund_case_status','completed','refund_case_decision','approved',
        'payment_method',c.payment_method,'correlation_source',c.correlation_source,
        'correlation_has_card_lookup',true,'nayax_provider_attempt_id',a.id,
        'provider_reference_present',true,'api_provider_approved_at',approved_at,
        'accounting_date_meaning','provider_approval_response_date_not_bank_settlement',
        'provider_call_made',false,'customer_message_created',false,'payload_redacted',true))
    on conflict(source,source_reference,source_row_reference) do update set
      match_status=excluded.match_status,raw_payload=excluded.raw_payload
    -- A prior source row must describe this exact case and original amount.
    -- A conflict with another identity is not silently overwritten.
    where sales_adjustment_facts.refund_case_id=excluded.refund_case_id
      and sales_adjustment_facts.reporting_machine_id=excluded.reporting_machine_id
      and sales_adjustment_facts.reporting_location_id=excluded.reporting_location_id
      and sales_adjustment_facts.amount_cents=excluded.amount_cents
      and sales_adjustment_facts.adjustment_type=excluded.adjustment_type
      and sales_adjustment_facts.source_row_hash=excluded.source_row_hash
    returning * into adjustment;
    if adjustment.id is null then
      raise exception 'Exact same-source reporting identity required' using errcode='P4670';
    end if;
    update public.refund_cases set reporting_adjustment_id=adjustment.id where id=c.id;
    update public.refund_case_nayax_refund_attempts set status='succeeded',
      provider_reference=reference,provider_status='approve_succeeded_contract_match',
      error_code=null,sanitized_response=jsonb_build_object('provider_outcome','success',
        'provider_reference_present',true,'payload_redacted',true),
      provider_claim_consumed_at=coalesce(provider_claim_consumed_at,recovery_at),
      provider_outcome='success',provider_outcome_recorded_at=approved_at,
      reconciliation_required=false,reporting_adjustment_id=adjustment.id,
      case_finalization_committed_at=recovery_at,completed_at=recovery_at
      where id=a.id;
    update public.refund_nayax_transaction_allocations set allocation_state='refunded'
      where account_scope=x->>'accountScope' and provider_machine_id=x->>'providerMachineId'
        and original_transaction_id=x->>'transactionId' and refund_case_id=c.id
        and allocation_state='reserved';
    receipt_id:=public.refund_ensure_proved_nayax_api_terminal_receipt(c.id,a.id);
    perform pg_catalog.set_config('bloomjoy.nayax_settlement_attempt_id',coalesce(old_marker,''),true);
  end if;
  return jsonb_build_object('status','receipt_recorded','caseCompleted',true,
    'accountingState','applied','receiptId',receipt_id,
    'providerCallMade',false,'customerMessageCreated',false,
    'customerMessageSent',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_reconcile_proved_nayax_api_terminal(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_reconcile_proved_nayax_api_terminal(uuid,uuid) to service_role;
select pg_notify('pgrst','reload schema');
