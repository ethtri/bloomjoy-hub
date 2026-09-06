-- #990: retain bounded business Result/Status diagnostics and permit one
-- evidence-bound approval continuation on the same current journal-v3 attempt.
-- No request-stage call can be made by the continuation surface.

create table public.refund_nayax_provider_business_outcomes (
  provider_stage_journal_id uuid primary key
    references public.refund_nayax_provider_stage_journal(id) on delete restrict,
  nayax_refund_attempt_id uuid not null
    references public.refund_case_nayax_refund_attempts(id) on delete restrict,
  stage text not null check (stage in ('request', 'approve')),
  business_result text,
  business_status text,
  business_pair_retained boolean not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_nayax_business_outcome_pair_shape check (
    (business_pair_retained and business_result is not null and business_status is not null)
    or (not business_pair_retained and business_result is null and business_status is null)
  ),
  constraint refund_nayax_business_outcome_safe_text check (
    not business_pair_retained or (
      length(business_result) between 1 and 80
      and length(business_status) between 1 and 80
      and business_result = btrim(business_result)
      and business_status = btrim(business_status)
      and business_result !~ '[[:cntrl:]]'
      and business_status !~ '[[:cntrl:]]'
      and business_result !~* '@|https?://'
      and business_status !~* '@|https?://'
      and business_result !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      and business_status !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      and business_result !~ '[[:digit:]]'
      and business_status !~ '[[:digit:]]'
    )
  )
);

alter table public.refund_nayax_provider_business_outcomes enable row level security;
revoke all on table public.refund_nayax_provider_business_outcomes
  from public, anon, authenticated, service_role;

create function public.guard_refund_nayax_provider_business_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  journal_row public.refund_nayax_provider_stage_journal%rowtype;
begin
  select journal.* into strict journal_row
  from public.refund_nayax_provider_stage_journal journal
  where journal.id = new.provider_stage_journal_id;
  if journal_row.nayax_refund_attempt_id is distinct from new.nayax_refund_attempt_id
    or journal_row.pending_approval_recovery_id is not null
    or journal_row.stage is distinct from new.stage
    or journal_row.event is distinct from 'result'
    or journal_row.journal_contract_version is distinct from 'nayax-provider-journal-v3'
    or (new.business_pair_retained and journal_row.schema_matched is distinct from true) then
    raise exception 'Business outcome must bind one current journal-v3 result'
      using errcode = 'P4628';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_refund_nayax_provider_business_outcome()
  from public, anon, authenticated, service_role;
create trigger refund_nayax_provider_business_outcome_guard
before insert on public.refund_nayax_provider_business_outcomes
for each row execute function public.guard_refund_nayax_provider_business_outcome();
create trigger refund_nayax_provider_business_outcome_immutable
before update or delete on public.refund_nayax_provider_business_outcomes
for each row execute function public.guard_refund_nayax_provider_stage_immutable();

create table public.refund_nayax_attempt_approval_continuations (
  nayax_refund_attempt_id uuid primary key
    references public.refund_case_nayax_refund_attempts(id) on delete restrict,
  refund_case_id uuid not null references public.refund_cases(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  official_action_authorization_id uuid not null
    references public.refund_case_official_action_authorizations(id) on delete restrict,
  attempt_generation integer not null check (attempt_generation >= 0),
  execution_context_hash text not null check (execution_context_hash ~ '^[a-f0-9]{64}$'),
  provider_claim_digest text not null check (provider_claim_digest ~ '^[a-f0-9]{64}$'),
  provider_claim_expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_nayax_approval_continuation_generation_unique
    unique (refund_case_id, attempt_generation)
);

alter table public.refund_nayax_attempt_approval_continuations enable row level security;
revoke all on table public.refund_nayax_attempt_approval_continuations
  from public, anon, authenticated, service_role;
create trigger refund_nayax_attempt_approval_continuation_immutable
before update or delete on public.refund_nayax_attempt_approval_continuations
for each row execute function public.guard_refund_nayax_provider_stage_immutable();

-- The prior v3 recorder stays available to database-owner tests and rollback,
-- but service_role must use the outcome-retaining wrapper below.
revoke execute on function public.service_record_nayax_refund_provider_stage_v3(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text,
  boolean, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, text, boolean
) from service_role;

create function public.service_record_nayax_refund_provider_stage_v3_outcomes(
  p_executor_assertion text,
  p_attempt_id uuid,
  p_provider_claim_token text,
  p_stage text,
  p_event text,
  p_http_status integer,
  p_outcome text,
  p_contract_matched boolean,
  p_failure_type text,
  p_classification_digest text,
  p_provider_contract_version text,
  p_journal_contract_version text,
  p_http_accepted boolean,
  p_media_type_class text,
  p_body_kind text,
  p_body_length_bucket text,
  p_json_parsed boolean,
  p_json_object boolean,
  p_schema_matched boolean,
  p_result_key_present boolean,
  p_status_key_present boolean,
  p_result_value_type text,
  p_status_value_type text,
  p_semantic_pair_matched boolean,
  p_business_result text,
  p_business_status text,
  p_business_pair_retained boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  journal_id uuid;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if lower(btrim(coalesce(p_event, ''))) = 'started' and (
    p_business_result is not null or p_business_status is not null
    or p_business_pair_retained is distinct from false
  ) then
    raise exception 'A started stage cannot retain a business outcome'
      using errcode = 'P4628';
  end if;
  if lower(btrim(coalesce(p_event, ''))) = 'result' and (
    p_business_pair_retained is null
    or (p_business_pair_retained and (
      p_business_result is null or p_business_status is null
      or length(p_business_result) not between 1 and 80
      or length(p_business_status) not between 1 and 80
      or p_business_result is distinct from btrim(p_business_result)
      or p_business_status is distinct from btrim(p_business_status)
      or p_business_result ~ '[[:cntrl:]]'
      or p_business_status ~ '[[:cntrl:]]'
      or p_business_result ~* '@|https?://'
      or p_business_status ~* '@|https?://'
      or p_business_result ~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      or p_business_status ~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      or p_business_result ~ '[[:digit:]]'
      or p_business_status ~ '[[:digit:]]'
    ))
    or (not p_business_pair_retained and (
      p_business_result is not null or p_business_status is not null
    ))
    or (p_business_pair_retained and p_schema_matched is distinct from true)
  ) then
    raise exception 'Invalid sanitized Nayax business outcome'
      using errcode = 'P4628';
  end if;

  result := public.service_record_nayax_refund_provider_stage_v3(
    p_executor_assertion, p_attempt_id, p_provider_claim_token, p_stage, p_event,
    p_http_status, p_outcome, p_contract_matched, p_failure_type,
    p_classification_digest, p_provider_contract_version,
    p_journal_contract_version, p_http_accepted, p_media_type_class,
    p_body_kind, p_body_length_bucket, p_json_parsed, p_json_object,
    p_schema_matched, p_result_key_present, p_status_key_present,
    p_result_value_type, p_status_value_type, p_semantic_pair_matched
  );

  if lower(btrim(coalesce(p_event, ''))) = 'result' then
    select journal.id into strict journal_id
    from public.refund_nayax_provider_stage_journal journal
    where journal.nayax_refund_attempt_id = p_attempt_id
      and journal.pending_approval_recovery_id is null
      and journal.stage = lower(btrim(p_stage))
      and journal.event = 'result';
    insert into public.refund_nayax_provider_business_outcomes (
      provider_stage_journal_id, nayax_refund_attempt_id, stage,
      business_result, business_status, business_pair_retained
    ) values (
      journal_id, p_attempt_id, lower(btrim(p_stage)),
      case when p_business_pair_retained then p_business_result else null end,
      case when p_business_pair_retained then p_business_status else null end,
      p_business_pair_retained
    );
  end if;
  return result || jsonb_build_object(
    'businessOutcomeRecordVersion', 'nayax-business-outcome-v1',
    'businessPairRetained', coalesce(p_business_pair_retained, false)
  );
end;
$$;
revoke execute on function public.service_record_nayax_refund_provider_stage_v3_outcomes(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text,
  boolean, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, text, boolean, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.service_record_nayax_refund_provider_stage_v3_outcomes(
  text, uuid, text, text, text, integer, text, boolean, text, text, text, text,
  boolean, text, text, text, boolean, boolean, boolean, boolean, boolean,
  text, text, boolean, text, text, boolean
) to service_role;

create function public.service_reserve_nayax_refund_approval_continuation_v1(
  p_executor_assertion text,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_idempotency_key text,
  p_amount_cents integer,
  p_currency_code text,
  p_provider_contract_version text,
  p_journal_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  mapping_row public.reporting_machine_refund_managers%rowtype;
  machine_row public.reporting_machines%rowtype;
  execution_context jsonb;
  current_context jsonb;
  continuation_claim_token text;
  continuation_claim_digest text;
  continuation_claim_expires_at timestamptz;
  reservation jsonb;
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  if p_actor_user_id is null or p_case_id is null
    or p_idempotency_key !~ '^nayax-refund-[a-f0-9]{64}$'
    or p_amount_cents is null or p_amount_cents <= 0
    or upper(btrim(coalesce(p_currency_code, ''))) <> 'USD'
    or btrim(coalesce(p_provider_contract_version, '')) <> 'nayax-production-account-contract-v2'
    or btrim(coalesce(p_journal_contract_version, '')) <> 'nayax-provider-journal-v3' then
    raise exception 'Exact current Nayax continuation context is required'
      using errcode = 'P4628';
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case where refund_case.id = p_case_id for update;
  if not found then
    raise exception 'Refund case not found' using errcode = 'P4628';
  end if;
  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.idempotency_key = p_idempotency_key for update;
  if not found or attempt_row.refund_case_id is distinct from case_row.id
    or attempt_row.actor_user_id is distinct from p_actor_user_id
    or attempt_row.amount_cents is distinct from p_amount_cents
    or attempt_row.currency_code is distinct from 'USD'
    or attempt_row.execution_mode is distinct from 'request_and_approve' then
    raise exception 'Continuation does not match the immutable Nayax attempt'
      using errcode = 'P4628';
  end if;

  select context into strict execution_context
  from public.refund_nayax_execution_contexts
  where attempt_id = attempt_row.id and refund_case_id = case_row.id;
  select * into strict authorization_row
  from public.refund_case_official_action_authorizations
  where id = attempt_row.official_action_authorization_id;
  select * into strict mapping_row
  from public.reporting_machine_refund_managers
  where id = authorization_row.manager_mapping_id for share;
  select * into strict machine_row
  from public.reporting_machines where id = case_row.reporting_machine_id for share;

  if (execution_context->>'caseVersion')::bigint is distinct from p_expected_case_version
    or authorization_row.refund_case_id is distinct from case_row.id
    or authorization_row.actor_user_id is distinct from p_actor_user_id
    or authorization_row.action is distinct from 'nayax_execute'
    or authorization_row.status is distinct from 'consumed'
    or authorization_row.consumed_at is null
    or authorization_row.expected_case_version is distinct from
      (execution_context->>'caseVersion')::bigint + 1
    or case_row.official_action_version is distinct from
      authorization_row.expected_case_version + 1
    or mapping_row.reporting_machine_id is distinct from case_row.reporting_machine_id
    or mapping_row.manager_user_id is distinct from p_actor_user_id
    or mapping_row.mapping_version is distinct from authorization_row.manager_mapping_version
    or mapping_row.status is distinct from 'active' or mapping_row.revoked_at is not null
    or case_row.status is distinct from 'card_refund_pending'
    or case_row.decision is distinct from 'approved'
    or case_row.nayax_refund_execution_status is distinct from 'requested'
    or case_row.refund_completed_at is not null or case_row.reporting_adjustment_id is not null
    or case_row.refund_amount_cents is distinct from p_amount_cents
    or case_row.nayax_refund_attempt_generation is distinct from (execution_context->>'attemptGeneration')::integer
    or case_row.matched_nayax_transaction_id is distinct from execution_context->>'transactionId'
    or case_row.matched_nayax_site_id is distinct from (execution_context->>'siteId')::integer
    or case_row.matched_nayax_amount_cents is distinct from (execution_context->>'originalAmountCents')::integer
    or case_row.matched_nayax_currency_code is distinct from execution_context->>'currencyCode'
    or machine_row.status is distinct from 'active'
    or machine_row.nayax_refunds_enabled is distinct from true
    or machine_row.nayax_machine_id is distinct from execution_context->>'providerMachineId'
    or machine_row.nayax_account_key is distinct from execution_context->>'accountScope' then
    raise exception 'Selected Nayax purchase or current manager authority changed'
      using errcode = 'P4628';
  end if;

  current_context := public.refund_nayax_selected_execution_context(case_row.id);
  if current_context is null
    or current_context->>'transactionId' is distinct from execution_context->>'transactionId'
    or current_context->>'siteId' is distinct from execution_context->>'siteId'
    or current_context->>'machineAuthorizationTime' is distinct from execution_context->>'machineAuthorizationTime'
    or current_context->>'machineAuthorizationTimeSource' is distinct from 'MachineAuthorizationTime'
    or current_context->>'originalAmountCents' is distinct from execution_context->>'originalAmountCents'
    or current_context->>'currencyCode' is distinct from execution_context->>'currencyCode' then
    raise exception 'Original Nayax execution evidence changed'
      using errcode = 'P4628';
  end if;

  -- Active original workers retain their claim. A continuation is considered
  -- only after that claim expires, and only one continuation reservation can
  -- ever be inserted for the immutable attempt.
  if attempt_row.status is distinct from 'in_progress'
    or attempt_row.provider_outcome is not null
    or attempt_row.provider_claim_consumed_at is not null
    or attempt_row.provider_claim_expires_at > statement_timestamp()
    or exists (
      select 1 from public.refund_nayax_attempt_approval_continuations continuation
      where continuation.nayax_refund_attempt_id = attempt_row.id
    )
    or exists (
      select 1 from public.refund_nayax_provider_stage_journal approval_stage
      where approval_stage.nayax_refund_attempt_id = attempt_row.id
        and approval_stage.pending_approval_recovery_id is null
        and approval_stage.stage = 'approve'
    )
    or not exists (
      select 1
      from public.refund_nayax_provider_stage_journal request_result
      join public.refund_nayax_provider_business_outcomes business
        on business.provider_stage_journal_id = request_result.id
      where request_result.nayax_refund_attempt_id = attempt_row.id
        and request_result.pending_approval_recovery_id is null
        and request_result.stage = 'request' and request_result.event = 'result'
        and request_result.http_status = 200 and request_result.http_accepted is true
        and request_result.media_type_class = 'application_json'
        and request_result.body_kind = 'json_object'
        and request_result.json_parsed is true and request_result.body_json_object is true
        and request_result.schema_matched is true
        and request_result.semantic_pair_matched is true
        and request_result.contract_matched is true
        and request_result.outcome = 'accepted'
        and request_result.failure_type is null
        and request_result.approval_authorized is true
        and request_result.provider_contract_version = p_provider_contract_version
        and request_result.journal_contract_version = p_journal_contract_version
        and business.nayax_refund_attempt_id = attempt_row.id
        and business.stage = 'request' and business.business_pair_retained is true
    ) then
    reservation := public.refund_nayax_attempt_reservation_payload(attempt_row.id, false, null);
    return jsonb_set(
      reservation,
      '{attempt,executionPlan}',
      to_jsonb('approval_continuation'::text),
      true
    );
  end if;

  continuation_claim_token := encode(extensions.gen_random_bytes(32), 'hex');
  continuation_claim_digest := encode(
    extensions.digest(convert_to(continuation_claim_token, 'UTF8'), 'sha256'), 'hex'
  );
  continuation_claim_expires_at := statement_timestamp() + interval '15 minutes';
  insert into public.refund_nayax_attempt_approval_continuations (
    nayax_refund_attempt_id, refund_case_id, actor_user_id,
    official_action_authorization_id, attempt_generation,
    execution_context_hash, provider_claim_digest, provider_claim_expires_at
  ) values (
    attempt_row.id, case_row.id, p_actor_user_id, authorization_row.id,
    (execution_context->>'attemptGeneration')::integer,
    execution_context->>'contextHash', continuation_claim_digest,
    continuation_claim_expires_at
  );
  update public.refund_case_nayax_refund_attempts
  set provider_claim_digest = continuation_claim_digest,
      provider_claim_expires_at = continuation_claim_expires_at,
      safe_transport_stage = 'request_result',
      safe_failure_class = null,
      refund_operations_due_at = null
  where id = attempt_row.id;

  reservation := public.refund_nayax_attempt_reservation_payload(
    attempt_row.id, true, continuation_claim_token
  );
  return jsonb_set(
    reservation,
    '{attempt,executionPlan}',
    to_jsonb('approval_continuation'::text),
    true
  );
end;
$$;
revoke execute on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text, uuid, uuid, bigint, text, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text, uuid, uuid, bigint, text, integer, text, text, text
) to service_role;

create or replace function public.service_get_nayax_refund_provider_journal_capability_v3(
  p_executor_assertion text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_nayax_provider_executor(p_executor_assertion);
  return jsonb_build_object(
    'journalContractVersion', 'nayax-provider-journal-v3',
    'approvalPolicyVersion', 'db-authoritative-exact-200-json-v1',
    'responseEnvelopeVersion', 'nayax-response-envelope-v1',
    'businessOutcomeRecordVersion', 'nayax-business-outcome-v1',
    'approvalContinuationVersion', 'same-attempt-approval-continuation-v1',
    'supportedProviderContractVersions', jsonb_build_array(
      'nayax-production-account-contract-v2'
    ),
    'providerContractConfirmationRequired', true,
    'payloadRedacted', true
  );
end;
$$;

comment on table public.refund_nayax_provider_business_outcomes is
  'Service-only immutable bounded Result/Status diagnostics. No response body, customer/card identifier, or manager/browser read grant is retained.';
comment on table public.refund_nayax_attempt_approval_continuations is
  'One immutable same-attempt continuation reservation after exact request acceptance and original provider-claim expiry.';
comment on function public.service_reserve_nayax_refund_approval_continuation_v1(
  text, uuid, uuid, bigint, text, integer, text, text, text
) is 'Issues one approval-only claim for the current journal-v3 attempt. It cannot create or repeat a refund request and never admits unknown request evidence.';

select pg_notify('pgrst', 'reload schema');
