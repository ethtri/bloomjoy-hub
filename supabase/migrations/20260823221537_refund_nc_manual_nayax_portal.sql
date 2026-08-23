-- Temporary refund path for Adam-managed BloomJoy NC machines that are visible
-- to customers but are not yet available through Bloomjoy's Nayax API account.
--
-- This path never calls Nayax. A mapped manager must first enter and confirm an
-- exact transaction from the Nayax portal, separately approve the refund, then
-- complete the refund in Nayax and record the exact result through the existing
-- held-attempt resolution boundary. Customer email and reporting happen only
-- after that final result is recorded.

alter table public.reporting_machines
  add column if not exists nayax_manual_portal_enabled boolean not null default false,
  add column if not exists nayax_manual_account_scope text;

alter table public.reporting_machines
  drop constraint if exists reporting_machines_nayax_manual_account_scope_check,
  add constraint reporting_machines_nayax_manual_account_scope_check check (
    (
      nayax_manual_portal_enabled = false
      and nayax_manual_account_scope is null
    )
    or (
      nayax_manual_portal_enabled = true
      and nayax_manual_account_scope ~ '^[a-z0-9][a-z0-9_-]{2,63}$'
      and nayax_refunds_enabled = false
      and nayax_machine_id is null
      and nayax_account_key is null
    )
  );

comment on column public.reporting_machines.nayax_manual_portal_enabled is
  'Temporary manager-operated Nayax portal path. It never enables a Bloomjoy provider API call.';
comment on column public.reporting_machines.nayax_manual_account_scope is
  'Internal duplicate-protection scope for a manager-operated Nayax account; not a provider API account key.';

create table public.refund_manual_nayax_evidence (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete restrict,
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete restrict,
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  account_scope text not null check (account_scope ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  portal_machine_reference text not null,
  provider_transaction_id text not null,
  machine_authorization_time timestamptz not null,
  amount_cents integer not null check (amount_cents > 0),
  card_last4 text not null check (card_last4 ~ '^[0-9]{4}$'),
  currency_code text not null default 'USD' check (currency_code = 'USD'),
  candidate_token uuid not null references public.refund_nayax_lookup_candidates (token) on delete restrict,
  selected_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_manual_nayax_machine_reference_safe check (
    portal_machine_reference ~ '^[A-Za-z0-9][A-Za-z0-9 ._:/#()-]{2,79}$'
    and portal_machine_reference !~ '[[:cntrl:]<>@]'
  ),
  constraint refund_manual_nayax_transaction_reference_safe check (
    public.is_review_safe_nayax_transaction_reference(provider_transaction_id)
  ),
  constraint refund_manual_nayax_case_once unique (refund_case_id),
  constraint refund_manual_nayax_candidate_once unique (candidate_token),
  constraint refund_manual_nayax_account_transaction_once unique (account_scope, provider_transaction_id)
);

create index refund_manual_nayax_evidence_machine_created_idx
  on public.refund_manual_nayax_evidence (reporting_machine_id, created_at desc);

alter table public.refund_manual_nayax_evidence enable row level security;
revoke all on table public.refund_manual_nayax_evidence
  from public, anon, authenticated, service_role;

comment on table public.refund_manual_nayax_evidence is
  'Private exact transaction evidence entered from a manager-owned Nayax portal. Access is only through audited SECURITY DEFINER functions.';

create function public.admin_create_refund_manual_nayax_candidate(
  p_case_id uuid,
  p_expected_case_version bigint,
  p_portal_machine_reference text,
  p_provider_transaction_id text,
  p_machine_authorization_local_time text,
  p_amount_cents integer,
  p_card_last4 text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  candidate_row public.refund_nayax_lookup_candidates%rowtype;
  normalized_machine_reference text := btrim(coalesce(p_portal_machine_reference, ''));
  normalized_transaction_id text := btrim(coalesce(p_provider_transaction_id, ''));
  normalized_last4 text := btrim(coalesce(p_card_last4, ''));
  location_timezone text;
  machine_authorization_local_time timestamp;
  machine_authorization_time timestamptz;
begin
  if auth.role() is distinct from 'authenticated'
    or current_actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-manual-nayax-evidence-v1|' || p_case_id::text, 0)
  );

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if not found then raise exception 'Refund case not found'; end if;
  if case_row.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before entering the transaction';
  end if;
  if not public.can_perform_refund_official_action(current_actor_user_id, case_row.id) then
    raise exception 'Active Machine Manager mapping required';
  end if;

  select machine.* into machine_row
  from public.reporting_machines machine
  where machine.id = case_row.reporting_machine_id
  for share;

  if not found
    or machine_row.status is distinct from 'active'
    or machine_row.nayax_manual_portal_enabled is distinct from true
    or machine_row.nayax_manual_account_scope is null
    or machine_row.nayax_refunds_enabled is distinct from false
    or machine_row.nayax_machine_id is not null
    or machine_row.nayax_account_key is not null then
    raise exception 'Manual Nayax portal review is not enabled for this machine';
  end if;

  select location.timezone into location_timezone
  from public.reporting_locations location
  where location.id = case_row.reporting_location_id;
  if location_timezone is null
    or not exists (select 1 from pg_catalog.pg_timezone_names timezone where timezone.name = location_timezone) then
    raise exception 'The machine location timezone is not configured safely';
  end if;

  if case_row.payment_method is distinct from 'card'
    or case_row.status is distinct from 'needs_review'
    or case_row.decision is not null
    or case_row.nayax_refund_execution_status is distinct from 'not_requested'
    or case_row.matched_nayax_transaction_id is not null
    or case_row.reporting_adjustment_id is not null
    or case_row.refund_completed_at is not null
    or public.refund_case_has_unresolved_reconciliation(case_row.id) then
    raise exception 'This refund case is not safe for manual Nayax transaction review';
  end if;

  if normalized_machine_reference !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/#()-]{2,79}$'
    or normalized_machine_reference ~ '[[:cntrl:]<>@]' then
    raise exception 'Enter a safe Nayax portal machine reference';
  end if;
  if not public.is_review_safe_nayax_transaction_reference(normalized_transaction_id) then
    raise exception 'Enter a safe Nayax transaction reference';
  end if;
  if coalesce(p_machine_authorization_local_time, '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$' then
    raise exception 'Enter the exact local transaction date and time shown in Nayax';
  end if;
  begin
    machine_authorization_local_time := p_machine_authorization_local_time::timestamp;
  exception when others then
    raise exception 'Enter the exact local transaction date and time shown in Nayax';
  end;
  machine_authorization_time := machine_authorization_local_time at time zone location_timezone;
  if machine_authorization_time at time zone location_timezone is distinct from machine_authorization_local_time then
    raise exception 'That local transaction time does not exist because of daylight saving time';
  end if;
  if (machine_authorization_time - interval '1 hour') at time zone location_timezone = machine_authorization_local_time
    or (machine_authorization_time + interval '1 hour') at time zone location_timezone = machine_authorization_local_time then
    raise exception 'That local transaction time is ambiguous because of daylight saving time';
  end if;
  if machine_authorization_time > statement_timestamp() + interval '5 minutes'
    or machine_authorization_time < case_row.incident_at - interval '7 days'
    or machine_authorization_time > case_row.incident_at + interval '7 days' then
    raise exception 'Transaction time must be within the reviewed incident window';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0
    or (case_row.payment_amount_cents is not null and p_amount_cents is distinct from case_row.payment_amount_cents) then
    raise exception 'Transaction amount must exactly match the reviewed customer payment';
  end if;
  if machine_row.nayax_refund_max_amount_cents is not null
    and p_amount_cents > machine_row.nayax_refund_max_amount_cents then
    raise exception 'Refund amount exceeds the machine limit';
  end if;
  if normalized_last4 !~ '^[0-9]{4}$'
    or (case_row.card_last4 is not null and normalized_last4 is distinct from case_row.card_last4) then
    raise exception 'Card ending must exactly match the reviewed customer payment';
  end if;

  if exists (
    select 1 from public.refund_cases duplicate_case
    where duplicate_case.id <> case_row.id
      and duplicate_case.matched_nayax_transaction_id = normalized_transaction_id
  ) or exists (
    select 1 from public.refund_manual_nayax_evidence evidence
    where evidence.account_scope = machine_row.nayax_manual_account_scope
      and evidence.provider_transaction_id = normalized_transaction_id
  ) then
    raise exception 'This Nayax transaction is already linked to another refund case'
      using errcode = '23505';
  end if;

  insert into public.refund_nayax_lookup_candidates (
    refund_case_id, actor_user_id, provider_transaction_id, site_id,
    machine_authorization_time, amount_cents, card_last4, currency_code,
    evidence_summary, expires_at, reporting_machine_id
  ) values (
    case_row.id, current_actor_user_id, normalized_transaction_id, null,
    machine_authorization_time, p_amount_cents, normalized_last4, 'USD',
    jsonb_build_object(
      'source', 'manual_nayax_portal',
      'machine_display_label', machine_row.refund_public_display_label,
      'portal_machine_reference_present', true,
      'selection_allowed', true,
      'is_recommended', true,
      'recommendation_state', 'manual_exception',
      'confidence_class', 'ambiguous_manual',
      'reason_codes', jsonb_build_array('manager_entered_exact_portal_evidence'),
      'one_click_eligible', false,
      'recommendation_rank', 1,
      'policy_version', 'manual-nayax-portal-v1',
      'match_reason', 'Entered from the manager-owned Nayax portal; confirm the exact transaction before approval.',
      'payload_redacted', true
    ),
    statement_timestamp() + interval '24 hours',
    case_row.reporting_machine_id
  ) returning * into candidate_row;

  insert into public.refund_manual_nayax_evidence (
    refund_case_id, reporting_machine_id, actor_user_id, account_scope,
    portal_machine_reference, provider_transaction_id,
    machine_authorization_time, amount_cents, card_last4, candidate_token
  ) values (
    case_row.id, case_row.reporting_machine_id, current_actor_user_id,
    machine_row.nayax_manual_account_scope, normalized_machine_reference,
    normalized_transaction_id, machine_authorization_time, p_amount_cents,
    normalized_last4, candidate_row.token
  );

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id, current_actor_user_id, 'manual_nayax_evidence_entered',
    'The mapped manager entered exact transaction evidence from the Nayax portal. No refund, approval, reporting, or customer email occurred.',
    jsonb_build_object(
      'candidate_token', candidate_row.token,
      'account_scope', machine_row.nayax_manual_account_scope,
      'provider_call_made', false,
      'customer_message_created', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'candidateToken', candidate_row.token,
    'expiresAt', candidate_row.expires_at,
    'providerCallMade', false,
    'customerMessageCreated', false,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.admin_create_refund_manual_nayax_candidate(
  uuid, bigint, text, text, text, integer, text
) from public, anon, service_role;
grant execute on function public.admin_create_refund_manual_nayax_candidate(
  uuid, bigint, text, text, text, integer, text
) to authenticated;

-- The existing candidate selector remains the only transaction-confirmation
-- mutation. It now accepts a NULL site only for an exact private manual record.
create or replace function public.service_select_refund_nayax_candidate_as_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_case_version bigint,
  p_candidate_token uuid,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  refund_case public.refund_cases%rowtype;
  candidate public.refund_nayax_lookup_candidates%rowtype;
  candidate_machine_id uuid;
  normalized_disagreement_reason text := lower(btrim(coalesce(p_nayax_disagreement_reason, '')));
  candidate_recommended boolean := false;
  candidate_selection_allowed boolean := false;
  manual_portal_candidate boolean := false;
  recommendation_state text;
  policy_version text;
  one_click_eligible boolean := false;
  updated_case public.refund_cases%rowtype;
begin
  if p_actor_user_id is null or p_case_id is null or p_candidate_token is null then
    raise exception 'Actor, refund case, and Nayax candidate are required';
  end if;
  select case_row.* into refund_case from public.refund_cases case_row
  where case_row.id = p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;

  if refund_case.reporting_machine_id is null then
    if not public.can_manage_refund_case(p_actor_user_id, refund_case.id) then
      raise exception 'Complete active manager authority over the grouped selection is required';
    end if;
  elsif not public.can_perform_refund_official_action(p_actor_user_id, refund_case.id) then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;
  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before selecting a transaction';
  end if;
  if refund_case.payment_method <> 'card' or refund_case.status <> 'needs_review'
    or refund_case.decision is not null
    or refund_case.nayax_refund_execution_status <> 'not_requested'
    or refund_case.reporting_adjustment_id is not null
    or refund_case.refund_completed_at is not null
    or public.refund_case_has_unresolved_reconciliation(refund_case.id) then
    raise exception 'This refund case is not safe for Nayax evidence selection';
  end if;

  select lookup_candidate.* into candidate
  from public.refund_nayax_lookup_candidates lookup_candidate
  where lookup_candidate.token = p_candidate_token
    and lookup_candidate.refund_case_id = refund_case.id
    and lookup_candidate.actor_user_id = p_actor_user_id
    and lookup_candidate.expires_at > statement_timestamp()
  for share;
  if not found then raise exception 'Nayax lookup evidence expired or belongs to another review session'; end if;

  candidate_machine_id := coalesce(candidate.reporting_machine_id, refund_case.reporting_machine_id);
  if candidate_machine_id is null then raise exception 'The candidate is missing its exact machine identity'; end if;
  if refund_case.reporting_machine_id is not null and candidate_machine_id <> refund_case.reporting_machine_id then
    raise exception 'The candidate belongs to a different machine';
  end if;
  if refund_case.reporting_machine_id is null and (
    refund_case.intake_selection_kind <> 'livermore_pair'
    or refund_case.intake_selection_key <> public.refund_livermore_selection_key()
    or refund_case.intake_selection_machine_ids <> public.refund_livermore_selection_machine_ids()
    or candidate_machine_id <> all(refund_case.intake_selection_machine_ids)
    or not public.refund_livermore_selection_is_valid()
  ) then raise exception 'The grouped machine scope changed and requires administrator review'; end if;

  manual_portal_candidate := coalesce(candidate.evidence_summary ->> 'source' = 'manual_nayax_portal', false);
  candidate_selection_allowed := coalesce(candidate.evidence_summary ->> 'selection_allowed' = 'true', false);
  candidate_recommended := coalesce(candidate.evidence_summary ->> 'is_recommended' = 'true', false);
  if not candidate_selection_allowed then raise exception 'This Nayax transaction has a safety block and cannot be selected'; end if;
  if not candidate_recommended and normalized_disagreement_reason not in (
    'closer_time', 'correct_amount', 'correct_card', 'customer_confirmation',
    'provider_data_issue', 'other_review_reason'
  ) then raise exception 'Choose why this alternate Nayax transaction is the correct one'; end if;
  if not public.is_review_safe_nayax_transaction_reference(candidate.provider_transaction_id)
    or (candidate.site_id is null and not manual_portal_candidate)
    or candidate.machine_authorization_time is null
    or candidate.amount_cents is null or candidate.amount_cents <= 0
    or candidate.currency_code <> 'USD' then
    raise exception 'This Nayax transaction does not contain safe refundable evidence';
  end if;
  if manual_portal_candidate and not exists (
    select 1
    from public.refund_manual_nayax_evidence evidence
    join public.reporting_machines machine on machine.id = evidence.reporting_machine_id
    where evidence.candidate_token = candidate.token
      and evidence.refund_case_id = refund_case.id
      and evidence.reporting_machine_id = candidate_machine_id
      and evidence.actor_user_id = p_actor_user_id
      and evidence.provider_transaction_id = candidate.provider_transaction_id
      and evidence.machine_authorization_time = candidate.machine_authorization_time
      and evidence.amount_cents = candidate.amount_cents
      and evidence.card_last4 = candidate.card_last4
      and evidence.selected_at is null
      and machine.nayax_manual_portal_enabled = true
      and machine.nayax_manual_account_scope = evidence.account_scope
      and machine.nayax_refunds_enabled = false
      and machine.nayax_machine_id is null
      and machine.nayax_account_key is null
  ) then raise exception 'Manual Nayax portal evidence changed and must be reviewed again'; end if;
  if exists (
    select 1 from public.refund_cases duplicate_case
    where duplicate_case.id <> refund_case.id
      and duplicate_case.matched_nayax_transaction_id = candidate.provider_transaction_id
  ) then raise exception 'This Nayax transaction is already linked to another refund case' using errcode = '23505'; end if;

  recommendation_state := coalesce(nullif(btrim(candidate.evidence_summary ->> 'recommendation_state'), ''), 'manual_exception');
  policy_version := nullif(btrim(candidate.evidence_summary ->> 'policy_version'), '');
  if policy_version is null then raise exception 'This Nayax transaction is missing versioned recommendation evidence'; end if;
  one_click_eligible := not manual_portal_candidate
    and recommendation_state = 'high_confidence' and candidate_recommended
    and candidate.evidence_summary ->> 'one_click_eligible' = 'true';

  update public.refund_cases set
    reporting_machine_id = candidate_machine_id,
    status = 'needs_review', decision = null, decision_reason = null,
    decided_by = null, decided_at = null,
    refund_amount_cents = candidate.amount_cents,
    matched_nayax_transaction_id = candidate.provider_transaction_id,
    matched_nayax_site_id = candidate.site_id,
    matched_nayax_machine_auth_time = candidate.machine_authorization_time,
    matched_nayax_amount_cents = candidate.amount_cents,
    matched_nayax_card_last4 = candidate.card_last4,
    matched_nayax_currency_code = candidate.currency_code,
    correlation_status = 'matched', correlation_source = 'nayax',
    correlation_confidence = 0,
    correlation_summary = case when manual_portal_candidate
      then 'Machine Manager confirmed exact transaction evidence entered from the Nayax portal. Manual refund approval is still required.'
      when one_click_eligible then 'Machine Manager confirmed the recommended Nayax transaction using versioned evidence.'
      else 'Machine Manager selected a Nayax transaction for manual review; one-click execution remains unavailable.' end,
    nayax_recommendation_state = recommendation_state,
    nayax_recommendation_policy_version = policy_version,
    nayax_recommendation_evaluated_at = statement_timestamp(),
    nayax_match_execution_eligible = one_click_eligible
  where id = refund_case.id returning * into updated_case;

  if manual_portal_candidate then
    update public.refund_manual_nayax_evidence
    set selected_at = statement_timestamp()
    where candidate_token = candidate.token and selected_at is null;
  end if;

  insert into public.refund_case_events (refund_case_id, actor_user_id, event_type, message, metadata)
  values (
    refund_case.id, p_actor_user_id, 'nayax_match_selected',
    case when manual_portal_candidate
      then 'Machine Manager confirmed the exact Nayax portal transaction. No refund, approval, reporting, or customer email occurred.'
      when candidate_recommended then 'Machine Manager confirmed the recommended Nayax transaction.'
      else 'Machine Manager selected an alternate Nayax transaction after review.' end,
    jsonb_build_object(
      'policy_version', policy_version, 'recommendation_state', recommendation_state,
      'selected_recommended', candidate_recommended,
      'disagreement_reason_code', case when candidate_recommended then null else normalized_disagreement_reason end,
      'execution_eligible', one_click_eligible,
      'manual_portal_candidate', manual_portal_candidate,
      'provider_call_made', false, 'customer_message_created', false,
      'payload_redacted', true
    )
  );
  return to_jsonb(updated_case);
end;
$$;

revoke execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.service_select_refund_nayax_candidate_as_actor(
  uuid, uuid, bigint, uuid, text
) to service_role;

alter table public.refund_case_nayax_refund_attempts
  drop constraint if exists refund_case_nayax_refund_attempts_execution_mode_check,
  add constraint refund_case_nayax_refund_attempts_execution_mode_check check (
    execution_mode in ('preflight', 'request', 'approve', 'decline', 'request_and_approve', 'manual_portal')
  ),
  drop constraint if exists refund_nayax_attempt_bound_lifecycle_check,
  add constraint refund_nayax_attempt_bound_lifecycle_check check (
    official_action_authorization_id is null
    or (
      execution_mode = 'manual_portal'
      and step_up_intent_id is null
      and request_fingerprint is not null
      and provider_claim_digest is null
      and provider_claim_expires_at is null
      and provider_claim_consumed_at is null
      and (
        (
          provider_outcome = 'unknown'
          and provider_outcome_recorded_at is not null
          and status = 'manual_review'
          and reconciliation_required = true
          and reporting_adjustment_id is null
          and case_finalization_committed_at is null
        )
        or (
          provider_outcome = 'success'
          and provider_outcome_recorded_at is not null
          and status = 'succeeded'
          and reconciliation_required = false
          and reporting_adjustment_id is not null
          and case_finalization_committed_at is not null
        )
      )
    )
    or (
      execution_mode <> 'manual_portal'
      and step_up_intent_id is not null
      and request_fingerprint is not null
      and provider_claim_digest is not null
      and provider_claim_expires_at is not null
      and ((provider_outcome is null and provider_outcome_recorded_at is null)
        or (provider_outcome is not null and provider_outcome_recorded_at is not null))
      and (provider_outcome = 'success' or reporting_adjustment_id is null)
      and (case_finalization_committed_at is null or (
        provider_outcome = 'success' and reporting_adjustment_id is not null and status = 'succeeded'
      ))
    )
  );

create function public.admin_begin_refund_manual_nayax_portal(
  p_case_id uuid,
  p_expected_case_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  current_actor_user_id uuid := auth.uid();
  case_row public.refund_cases%rowtype;
  machine_row public.reporting_machines%rowtype;
  evidence_row public.refund_manual_nayax_evidence%rowtype;
  authorization_result jsonb;
  authorization_id uuid;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  idempotency_key text;
  request_fingerprint text;
begin
  if auth.role() is distinct from 'authenticated'
    or current_actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund-manual-nayax-approval-v1|' || p_case_id::text, 0)
  );
  select refund_case.* into case_row from public.refund_cases refund_case
  where refund_case.id = p_case_id for update;
  if not found then raise exception 'Refund case not found'; end if;

  select attempt.* into attempt_row
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = case_row.id and attempt.execution_mode = 'manual_portal'
  order by attempt.created_at desc, attempt.id desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'attemptId', attempt_row.id, 'created', false,
      'status', attempt_row.status, 'providerOutcome', attempt_row.provider_outcome,
      'providerCallMade', false, 'customerMessageCreated', false,
      'expectedCaseVersion', case_row.official_action_version, 'payloadRedacted', true
    );
  end if;

  if case_row.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before approving';
  end if;
  if not public.can_perform_refund_official_action(current_actor_user_id, case_row.id) then
    raise exception 'Active Machine Manager mapping required';
  end if;
  select machine.* into machine_row from public.reporting_machines machine
  where machine.id = case_row.reporting_machine_id for share;
  select evidence.* into evidence_row from public.refund_manual_nayax_evidence evidence
  where evidence.refund_case_id = case_row.id for share;

  if machine_row.id is null or evidence_row.id is null
    or machine_row.nayax_manual_portal_enabled is distinct from true
    or machine_row.nayax_manual_account_scope is distinct from evidence_row.account_scope
    or machine_row.nayax_refunds_enabled is distinct from false
    or machine_row.nayax_machine_id is not null or machine_row.nayax_account_key is not null
    or evidence_row.selected_at is null
    or case_row.payment_method is distinct from 'card'
    or case_row.status is distinct from 'needs_review'
    or case_row.decision is not null
    or case_row.correlation_status is distinct from 'matched'
    or case_row.correlation_source is distinct from 'nayax'
    or case_row.nayax_recommendation_state is distinct from 'manual_exception'
    or case_row.nayax_recommendation_policy_version is distinct from 'manual-nayax-portal-v1'
    or case_row.nayax_match_execution_eligible is distinct from false
    or case_row.matched_nayax_transaction_id is distinct from evidence_row.provider_transaction_id
    or case_row.matched_nayax_site_id is not null
    or case_row.matched_nayax_machine_auth_time is distinct from evidence_row.machine_authorization_time
    or case_row.matched_nayax_amount_cents is distinct from evidence_row.amount_cents
    or case_row.refund_amount_cents is distinct from evidence_row.amount_cents
    or case_row.payment_amount_cents is distinct from evidence_row.amount_cents
    or case_row.matched_nayax_card_last4 is distinct from evidence_row.card_last4
    or case_row.matched_nayax_currency_code is distinct from 'USD'
    or case_row.nayax_refund_execution_status is distinct from 'not_requested'
    or case_row.reporting_adjustment_id is not null or case_row.refund_completed_at is not null
    or public.refund_case_has_unresolved_reconciliation(case_row.id) then
    raise exception 'The selected manual Nayax transaction is not safe to approve';
  end if;

  idempotency_key := 'manual-nayax-' || encode(extensions.digest(
    convert_to(case_row.id::text || '|' || evidence_row.account_scope || '|' ||
      evidence_row.provider_transaction_id, 'UTF8'), 'sha256'
  ), 'hex');

  authorization_result := public.admin_authorize_refund_official_action(
    case_row.id, 'approve', case_row.official_action_version,
    'card_refund_pending', 'approved', null,
    'Exact transaction confirmed; mapped manager approved a manual Nayax portal refund.',
    null, evidence_row.amount_cents, null, null, false, null, null
  );
  authorization_id := (authorization_result ->> 'authorizationId')::uuid;

  perform public.service_apply_refund_official_case_update(
    authorization_id, case_row.id, 'approve', 'card_refund_pending',
    null, 'approved',
    'Exact transaction confirmed; mapped manager approved a manual Nayax portal refund.',
    null, evidence_row.amount_cents, null, null, null
  );

  request_fingerprint := encode(extensions.digest(
    convert_to(authorization_id::text || '|' || idempotency_key || '|USD|' || evidence_row.amount_cents::text, 'UTF8'),
    'sha256'
  ), 'hex');

  insert into public.refund_case_nayax_refund_attempts (
    refund_case_id, actor_user_id, execution_mode, status, idempotency_key,
    amount_cents, transaction_id_present, site_id_present,
    machine_auth_time_present, sanitized_request, sanitized_response,
    official_action_authorization_id, step_up_intent_id, request_fingerprint,
    currency_code, provider_outcome, provider_outcome_recorded_at,
    reconciliation_required
  ) values (
    case_row.id, current_actor_user_id, 'manual_portal', 'manual_review', idempotency_key,
    evidence_row.amount_cents, true, false, true,
    jsonb_build_object(
      'account_scope', evidence_row.account_scope,
      'portal_machine_reference_present', true,
      'transaction_id_present', true, 'site_id_present', false,
      'machine_authorization_time_present', true,
      'amount_cents', evidence_row.amount_cents, 'currency_code', 'USD',
      'provider_call_made', false, 'payload_redacted', true
    ),
    jsonb_build_object(
      'manual_portal_action_required', true,
      'provider_outcome', 'unknown', 'provider_call_made', false,
      'customer_message_created', false, 'payload_redacted', true
    ),
    authorization_id, null, request_fingerprint, 'USD', 'unknown',
    statement_timestamp(), true
  ) returning * into attempt_row;

  update public.refund_cases set
    nayax_refund_execution_status = 'manual_review',
    nayax_match_execution_eligible = false
  where id = case_row.id;

  insert into public.refund_case_events (refund_case_id, actor_user_id, event_type, message, metadata)
  values (
    case_row.id, current_actor_user_id, 'manual_nayax_refund_approved',
    'The mapped manager approved this refund for manual completion in Nayax. No provider call, reporting adjustment, or customer email occurred.',
    jsonb_build_object(
      'attempt_id', attempt_row.id, 'authorization_id', authorization_id,
      'execution_mode', 'manual_portal', 'provider_outcome', 'unknown',
      'provider_call_made', false, 'customer_message_created', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'attemptId', attempt_row.id, 'created', true,
    'status', attempt_row.status, 'providerOutcome', attempt_row.provider_outcome,
    'providerCallMade', false, 'customerMessageCreated', false,
    'expectedCaseVersion', (select official_action_version from public.refund_cases where id = case_row.id),
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.admin_begin_refund_manual_nayax_portal(uuid, bigint)
  from public, anon, service_role;
grant execute on function public.admin_begin_refund_manual_nayax_portal(uuid, bigint)
  to authenticated;

-- Keep the established overview function byte-for-byte compatible. The UI
-- reads this narrow companion contract and merges it by case ID. It exposes no
-- account scope, portal reference, or raw transaction reference.
create function public.admin_get_refund_manual_nayax_context()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'caseId', refund_case.id,
    'manualNayaxPortalEnabled', machine.nayax_manual_portal_enabled,
    'manualNayaxEvidenceSelected', evidence.selected_at is not null,
    'manualNayaxLocationTimezone', location.timezone
  ) order by refund_case.created_at desc), '[]'::jsonb)
  from public.refund_cases refund_case
  join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
  join public.reporting_locations location on location.id = refund_case.reporting_location_id
  left join public.refund_manual_nayax_evidence evidence on evidence.refund_case_id = refund_case.id
  where machine.nayax_manual_portal_enabled = true
    and public.can_manage_refund_case(auth.uid(), refund_case.id);
$$;
revoke execute on function public.admin_get_refund_manual_nayax_context()
  from public, anon, service_role;
grant execute on function public.admin_get_refund_manual_nayax_context()
  to authenticated;

create or replace function public.admin_get_refund_nayax_resolution_readiness(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_actor_user_id uuid := auth.uid();
  case_row public.refund_cases%rowtype;
  attempt_row public.refund_case_nayax_refund_attempts%rowtype;
  has_manager_authority boolean := false;
begin
  if current_actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated Machine Manager session required';
  end if;
  select refund_case.* into case_row from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;
  if not found then return jsonb_build_object('visible', false, 'available', false, 'payloadRedacted', true); end if;
  has_manager_authority := public.can_perform_refund_official_action(current_actor_user_id, case_row.id);
  if not has_manager_authority then return jsonb_build_object('visible', false, 'available', false, 'payloadRedacted', true); end if;
  select attempt.* into attempt_row from public.refund_case_nayax_refund_attempts attempt
  where attempt.refund_case_id = case_row.id
    and attempt.provider_outcome in ('rejected', 'timeout', 'unknown')
  order by attempt.created_at desc, attempt.id desc limit 1;
  return jsonb_build_object(
    'visible', true,
    'available', public.refund_nayax_outcome_resolution_enabled()
      and attempt_row.id is not null
      and public.refund_nayax_provider_outcome_state(case_row.nayax_refund_execution_status) in ('unconfirmed', 'rejected')
      and attempt_row.support_resolution_id is null,
    'blockReason', case
      when not public.refund_nayax_outcome_resolution_enabled() then 'resolution_disabled'
      when attempt_row.id is null then 'exact_attempt_required'
      when attempt_row.support_resolution_id is not null then 'already_resolved'
      when public.refund_nayax_provider_outcome_state(case_row.nayax_refund_execution_status) not in ('unconfirmed', 'rejected') then 'provider_hold_required'
      else null end,
    'attemptId', attempt_row.id,
    'providerOutcome', attempt_row.provider_outcome,
    'manualPortalAttempt', attempt_row.execution_mode = 'manual_portal',
    'expectedCaseVersion', case_row.official_action_version,
    'allowedResults', jsonb_build_array('provider_confirmed_success', 'provider_confirmed_retry_safe', 'documented_manual_completion', 'remain_on_hold'),
    'authorizationMethod', 'manager_session', 'payloadRedacted', true
  );
end;
$$;
revoke execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  from public, anon, service_role;
grant execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  to authenticated;

-- Exact, audited production cohort. Atlanta remains on automatic Nayax; Oscar's
-- Playground is intentionally excluded because it is not Adam-managed.
do $$
declare
  target_labels text[] := array[
    'Altamonte Mall', 'Asheville Mall', 'Carolina Place', 'Columbiana Centre',
    'Commerce Tanger Outlet', 'Gonzales Tanger Outlet', 'Locust Grove Tanger Outlet',
    'Nashville Tanger Outlets', 'Norfolk Premium Outlets', 'Oakwood Mall Gretna',
    'Southridge Mall', 'Uptown Christiansburg'
  ];
  target_count integer;
  present_label_count integer;
begin
  select count(*) into present_label_count
  from public.reporting_machines machine
  where machine.refund_public_display_label = any(target_labels);

  -- Disposable migration-test databases contain no production inventory.
  -- A production-like database that contains any cohort label must contain and
  -- validate the complete exact set before this migration can proceed.
  if present_label_count = 0 then
    return;
  end if;

  select count(*) into target_count
  from public.reporting_machines machine
  where machine.refund_public_display_label = any(target_labels)
    and machine.status = 'active'
    and machine.nayax_machine_id is null
    and machine.nayax_account_key is null
    and machine.nayax_refunds_enabled = false
    and exists (
      select 1
      from public.reporting_machine_refund_managers mapping
      join auth.users manager_user on manager_user.id = mapping.manager_user_id
      where mapping.reporting_machine_id = machine.id
        and mapping.status = 'active' and mapping.revoked_at is null
        and lower(manager_user.email) = 'adam@bloomjoysweets.com'
    );
  if target_count <> 12 then
    raise exception 'Expected 12 exact Adam-managed API-pending machines; found %', target_count;
  end if;

  update public.reporting_machines
  set nayax_manual_portal_enabled = true,
      nayax_manual_account_scope = 'bloomjoy_nc_adam'
  where refund_public_display_label = any(target_labels);

  if exists (
    select 1 from public.reporting_machines
    where refund_public_display_label in ('Bubble Planet - Atlanta', 'Oscar''s Playground')
      and nayax_manual_portal_enabled = true
  ) then raise exception 'Automatic Atlanta or non-Adam Oscar machine entered the manual cohort'; end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
