-- Refund decisions are a Machine Manager action, not an admin or service action.
--
-- Browser-authenticated managers authorize one exact, short-lived action. The
-- service workflow may consume that authorization, but it cannot choose an
-- actor, change the authorized action, or mint a replacement authorization.

create extension if not exists pgcrypto with schema extensions;

alter table public.reporting_machine_refund_managers
  add column if not exists mapping_version bigint not null default 1;

alter table public.reporting_machine_refund_managers
  drop constraint if exists reporting_machine_refund_managers_mapping_version_positive;
alter table public.reporting_machine_refund_managers
  add constraint reporting_machine_refund_managers_mapping_version_positive
  check (mapping_version > 0);

create or replace function public.bump_refund_manager_mapping_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.mapping_version := old.mapping_version + 1;
  return new;
end;
$$;

drop trigger if exists reporting_machine_refund_managers_bump_mapping_version
  on public.reporting_machine_refund_managers;
create trigger reporting_machine_refund_managers_bump_mapping_version
before update on public.reporting_machine_refund_managers
for each row execute function public.bump_refund_manager_mapping_version();

alter table public.refund_cases
  add column if not exists official_action_version bigint not null default 1;

alter table public.refund_cases
  drop constraint if exists refund_cases_official_action_version_positive;
alter table public.refund_cases
  add constraint refund_cases_official_action_version_positive
  check (official_action_version > 0);

create or replace function public.bump_refund_case_official_action_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if row(
    new.reporting_machine_id,
    new.reporting_location_id,
    new.public_reference,
    new.customer_email,
    new.customer_name,
    new.customer_phone,
    new.issue_summary,
    new.zelle_payment_contact,
    new.incident_at,
    new.incident_local_datetime,
    new.incident_timezone,
    new.incident_time_resolution,
    new.refund_qr_claim_context_id,
    new.status,
    new.decision,
    new.decision_reason,
    new.decided_by,
    new.decided_at,
    new.assigned_manager_id,
    new.payment_method,
    new.payment_amount_cents,
    new.refund_amount_cents,
    new.card_last4,
    new.card_wallet_used,
    new.correlation_status,
    new.correlation_source,
    new.correlation_confidence,
    new.correlation_summary,
    new.matched_sales_fact_id,
    new.matched_nayax_transaction_id,
    new.matched_nayax_site_id,
    new.matched_nayax_machine_auth_time,
    new.matched_nayax_amount_cents,
    new.matched_nayax_card_last4,
    new.matched_nayax_currency_code,
    new.nayax_recommendation_state,
    new.nayax_recommendation_policy_version,
    new.nayax_recommendation_evaluated_at,
    new.nayax_match_execution_eligible,
    new.nayax_refund_execution_status,
    new.manual_refund_reference,
    new.refund_completed_by,
    new.refund_completed_at,
    new.reporting_adjustment_id
  ) is distinct from row(
    old.reporting_machine_id,
    old.reporting_location_id,
    old.public_reference,
    old.customer_email,
    old.customer_name,
    old.customer_phone,
    old.issue_summary,
    old.zelle_payment_contact,
    old.incident_at,
    old.incident_local_datetime,
    old.incident_timezone,
    old.incident_time_resolution,
    old.refund_qr_claim_context_id,
    old.status,
    old.decision,
    old.decision_reason,
    old.decided_by,
    old.decided_at,
    old.assigned_manager_id,
    old.payment_method,
    old.payment_amount_cents,
    old.refund_amount_cents,
    old.card_last4,
    old.card_wallet_used,
    old.correlation_status,
    old.correlation_source,
    old.correlation_confidence,
    old.correlation_summary,
    old.matched_sales_fact_id,
    old.matched_nayax_transaction_id,
    old.matched_nayax_site_id,
    old.matched_nayax_machine_auth_time,
    old.matched_nayax_amount_cents,
    old.matched_nayax_card_last4,
    old.matched_nayax_currency_code,
    old.nayax_recommendation_state,
    old.nayax_recommendation_policy_version,
    old.nayax_recommendation_evaluated_at,
    old.nayax_match_execution_eligible,
    old.nayax_refund_execution_status,
    old.manual_refund_reference,
    old.refund_completed_by,
    old.refund_completed_at,
    old.reporting_adjustment_id
  ) then
    new.official_action_version := old.official_action_version + 1;
  else
    new.official_action_version := old.official_action_version;
  end if;

  return new;
end;
$$;

drop trigger if exists refund_cases_bump_official_action_version
  on public.refund_cases;
create trigger refund_cases_bump_official_action_version
before update on public.refund_cases
for each row execute function public.bump_refund_case_official_action_version();

create or replace function public.enforce_refund_case_official_transition_boundary()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  official_state_involved boolean;
  official_transition_requested boolean;
  official_insert_requested boolean;
  payment_finalization_requested boolean;
  execution_eligibility_elevated boolean;
  official_evidence_changed boolean;
begin
  if tg_op = 'DELETE' then
    if current_user in ('anon', 'authenticated', 'service_role')
      and (
        old.status in ('approved', 'denied', 'card_refund_pending', 'cash_zelle_pending', 'completed', 'closed')
        or old.decision in ('approved', 'denied')
        or old.decided_by is not null
        or old.decided_at is not null
        or nullif(btrim(coalesce(old.manual_refund_reference, '')), '') is not null
        or old.refund_completed_by is not null
        or old.refund_completed_at is not null
        or old.reporting_adjustment_id is not null
        or old.nayax_refund_execution_status is distinct from 'not_requested'
        or old.nayax_match_execution_eligible = true
      ) then
      raise exception 'Official or terminal refund cases cannot be deleted by a browser or service identity';
    end if;

    return old;
  end if;

  if tg_op = 'INSERT' then
    official_insert_requested :=
      new.status in ('approved', 'denied', 'card_refund_pending', 'cash_zelle_pending', 'completed', 'closed')
      or new.decision in ('approved', 'denied')
      or new.decided_by is not null
      or new.decided_at is not null
      or nullif(btrim(coalesce(new.manual_refund_reference, '')), '') is not null
      or new.refund_completed_by is not null
      or new.refund_completed_at is not null
      or new.reporting_adjustment_id is not null
      or new.nayax_refund_execution_status is distinct from 'not_requested'
      or new.nayax_match_execution_eligible = true;

    if current_user in ('anon', 'authenticated', 'service_role')
      and official_insert_requested then
      raise exception 'Official refund state cannot be inserted by a browser or service identity';
    end if;

    return new;
  end if;

  official_state_involved :=
    old.status in ('approved', 'denied', 'card_refund_pending', 'cash_zelle_pending', 'completed', 'closed')
    or new.status in ('approved', 'denied', 'card_refund_pending', 'cash_zelle_pending', 'completed', 'closed')
    or old.decision in ('approved', 'denied')
    or new.decision in ('approved', 'denied');

  official_transition_requested :=
    (
      old.status is distinct from new.status
      and (
        old.status in ('approved', 'denied', 'card_refund_pending', 'cash_zelle_pending', 'completed', 'closed')
        or new.status in ('approved', 'denied', 'card_refund_pending', 'cash_zelle_pending', 'completed', 'closed')
      )
    )
    or (
      old.decision is distinct from new.decision
      and (
        old.decision in ('approved', 'denied')
        or new.decision in ('approved', 'denied')
      )
    );

  payment_finalization_requested := row(
    old.decision_reason,
    old.decided_by,
    old.decided_at,
    old.manual_refund_reference,
    old.refund_completed_by,
    old.refund_completed_at,
    old.reporting_adjustment_id,
    old.nayax_refund_execution_status
  ) is distinct from row(
    new.decision_reason,
    new.decided_by,
    new.decided_at,
    new.manual_refund_reference,
    new.refund_completed_by,
    new.refund_completed_at,
    new.reporting_adjustment_id,
    new.nayax_refund_execution_status
  );

  execution_eligibility_elevated :=
    old.nayax_match_execution_eligible = false
    and new.nayax_match_execution_eligible = true;

  official_evidence_changed :=
    official_state_involved
    and row(
      old.reporting_machine_id,
      old.reporting_location_id,
      old.public_reference,
      old.customer_email,
      old.customer_name,
      old.customer_phone,
      old.issue_summary,
      old.zelle_payment_contact,
      old.incident_at,
      old.incident_local_datetime,
      old.incident_timezone,
      old.incident_time_resolution,
      old.refund_qr_claim_context_id,
      old.payment_method,
      old.payment_amount_cents,
      old.refund_amount_cents,
      old.card_last4,
      old.card_wallet_used,
      old.decision_reason,
      old.decided_by,
      old.decided_at,
      old.assigned_manager_id,
      old.correlation_status,
      old.correlation_source,
      old.correlation_confidence,
      old.correlation_summary,
      old.matched_sales_fact_id,
      old.matched_nayax_transaction_id,
      old.matched_nayax_site_id,
      old.matched_nayax_machine_auth_time,
      old.matched_nayax_amount_cents,
      old.matched_nayax_card_last4,
      old.matched_nayax_currency_code,
      old.nayax_recommendation_state,
      old.nayax_recommendation_policy_version,
      old.nayax_recommendation_evaluated_at,
      old.nayax_match_execution_eligible
    ) is distinct from row(
      new.reporting_machine_id,
      new.reporting_location_id,
      new.public_reference,
      new.customer_email,
      new.customer_name,
      new.customer_phone,
      new.issue_summary,
      new.zelle_payment_contact,
      new.incident_at,
      new.incident_local_datetime,
      new.incident_timezone,
      new.incident_time_resolution,
      new.refund_qr_claim_context_id,
      new.payment_method,
      new.payment_amount_cents,
      new.refund_amount_cents,
      new.card_last4,
      new.card_wallet_used,
      new.decision_reason,
      new.decided_by,
      new.decided_at,
      new.assigned_manager_id,
      new.correlation_status,
      new.correlation_source,
      new.correlation_confidence,
      new.correlation_summary,
      new.matched_sales_fact_id,
      new.matched_nayax_transaction_id,
      new.matched_nayax_site_id,
      new.matched_nayax_machine_auth_time,
      new.matched_nayax_amount_cents,
      new.matched_nayax_card_last4,
      new.matched_nayax_currency_code,
      new.nayax_recommendation_state,
      new.nayax_recommendation_policy_version,
      new.nayax_recommendation_evaluated_at,
      new.nayax_match_execution_eligible
    );

  if current_user in ('anon', 'authenticated', 'service_role')
    and (
      official_transition_requested
      or payment_finalization_requested
      or execution_eligibility_elevated
      or official_evidence_changed
    ) then
    raise exception 'Official refund transitions require a browser-authenticated Machine Manager receipt';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_cases_enforce_official_transition_boundary
  on public.refund_cases;
create trigger refund_cases_enforce_official_transition_boundary
before insert or update or delete on public.refund_cases
for each row execute function public.enforce_refund_case_official_transition_boundary();

create or replace function public.enforce_refund_official_event_boundary()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_is_reserved boolean := false;
  new_is_reserved boolean := false;
begin
  if tg_op <> 'INSERT' then
    old_is_reserved := old.event_type in (
      'admin_update',
      'cash_payout_confirmed',
      'nayax_match_selected',
      'official_action_committed',
      'nayax_official_action_revalidated',
      'nayax_official_action_finalized'
    );
  end if;

  if tg_op <> 'DELETE' then
    new_is_reserved := new.event_type in (
      'admin_update',
      'cash_payout_confirmed',
      'nayax_match_selected',
      'official_action_committed',
      'nayax_official_action_revalidated',
      'nayax_official_action_finalized'
    );
  end if;

  if current_user in ('anon', 'authenticated', 'service_role')
    and (old_is_reserved or new_is_reserved) then
    raise exception 'Official refund audit events are wrapper-owned and append-only';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists refund_case_events_enforce_official_boundary
  on public.refund_case_events;
create trigger refund_case_events_enforce_official_boundary
before insert or update or delete on public.refund_case_events
for each row execute function public.enforce_refund_official_event_boundary();

revoke update, delete on table public.refund_case_events from service_role;

create or replace function public.refund_official_actions_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$
  -- #692 replaces this protocol stub only after action-bound TOTP intent
  -- enrollment, challenge, and one-time consumption are deployed.
  select false;
$$;

create or replace function public.refund_official_action_has_recent_human_step_up()
returns boolean
language sql
stable
set search_path = public, auth
as $$
  select auth.role() = 'authenticated'
    and auth.jwt() ->> 'aal' = 'aal2'
    and exists (
      select 1
      from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) method
      where method ->> 'method' = 'totp'
        and coalesce(method ->> 'timestamp', '') ~ '^[0-9]+([.][0-9]+)?$'
        and (method ->> 'timestamp')::numeric
          >= extract(epoch from statement_timestamp() - interval '2 minutes')
        and (method ->> 'timestamp')::numeric
          <= extract(epoch from statement_timestamp() + interval '30 seconds')
    );
$$;

create table if not exists public.refund_case_official_action_authorizations (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete restrict,
  action text not null check (action in ('approve', 'decline', 'cash_complete', 'nayax_execute')),
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  manager_mapping_id uuid not null references public.reporting_machine_refund_managers (id) on delete restrict,
  manager_mapping_version bigint not null check (manager_mapping_version > 0),
  expected_case_version bigint not null check (expected_case_version > 0),
  action_context_hash text not null check (action_context_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'authorized' check (status in ('authorized', 'consumed')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_case_official_action_authorizations_expiry_valid
    check (expires_at > created_at),
  constraint refund_case_official_action_authorizations_consumption_valid
    check (
      (status = 'authorized' and consumed_at is null)
      or (status = 'consumed' and consumed_at is not null)
    )
);

create index if not exists refund_case_official_action_authorizations_case_idx
  on public.refund_case_official_action_authorizations (refund_case_id, created_at desc);

create index if not exists refund_case_official_action_authorizations_expiry_idx
  on public.refund_case_official_action_authorizations (status, expires_at)
  where status = 'authorized';

alter table public.refund_case_official_action_authorizations enable row level security;

revoke all on table public.refund_case_official_action_authorizations
  from public, anon, authenticated, service_role;

-- Lookup rows are replaceable as a set, but each token's reviewed evidence is
-- immutable. The service may delete expired rows and insert fresh tokens; it
-- cannot rewrite a token after a manager has reviewed it.
create or replace function public.reject_refund_nayax_candidate_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Nayax candidate evidence is immutable; create a new lookup token';
end;
$$;

drop trigger if exists refund_nayax_lookup_candidate_immutable
  on public.refund_nayax_lookup_candidates;
create trigger refund_nayax_lookup_candidate_immutable
before update on public.refund_nayax_lookup_candidates
for each row execute function public.reject_refund_nayax_candidate_update();

revoke update on table public.refund_nayax_lookup_candidates from service_role;

-- Wallet-correction RPCs are SECURITY DEFINER and therefore execute as their
-- owner. Re-check official/payment state under a case-row lock inside every
-- mutating path so an old customer token or service retry cannot reopen or
-- rewrite a case after a manager decision.
create or replace function public.refund_case_official_payment_locked(
  p_case public.refund_cases
)
returns boolean
language sql
immutable
strict
set search_path = public
as $$
  select coalesce(p_case.status in (
      'approved',
      'denied',
      'card_refund_pending',
      'cash_zelle_pending',
      'completed',
      'closed'
    )
    or p_case.decision in ('approved', 'denied')
    or p_case.decided_by is not null
    or p_case.decided_at is not null
    or nullif(btrim(coalesce(p_case.manual_refund_reference, '')), '') is not null
    or p_case.refund_completed_by is not null
    or p_case.refund_completed_at is not null
    or p_case.reporting_adjustment_id is not null
    or coalesce(p_case.nayax_refund_execution_status, 'not_requested') <> 'not_requested'
    or p_case.nayax_match_execution_eligible = true, false);
$$;

create or replace function public.service_issue_refund_wallet_correction(
  p_refund_case_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases;
  next_version integer;
  context_row public.refund_wallet_correction_contexts;
begin
  select *
  into case_row
  from public.refund_cases
  where id = p_refund_case_id
  for update;

  if case_row.id is null then
    raise exception 'Refund case not found';
  end if;

  if case_row.payment_method <> 'card' or case_row.card_wallet_used is not true then
    raise exception 'Wallet correction is available only for wallet card cases';
  end if;

  if public.refund_case_official_payment_locked(case_row) then
    raise exception 'This refund case can no longer be corrected';
  end if;

  if p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid wallet correction token hash';
  end if;

  if p_expires_at <= statement_timestamp()
    or p_expires_at > statement_timestamp() + interval '49 hours' then
    raise exception 'Invalid wallet correction expiry';
  end if;

  next_version := case_row.wallet_correction_version + 1;
  if next_version > 2 then
    raise exception 'Wallet correction contact limit reached';
  end if;

  update public.refund_wallet_correction_contexts
  set
    status = 'revoked',
    revoked_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where refund_case_id = case_row.id
    and status = 'pending';

  insert into public.refund_wallet_correction_contexts (
    refund_case_id,
    token_hash,
    version,
    expires_at
  )
  values (
    case_row.id,
    p_token_hash,
    next_version,
    p_expires_at
  )
  returning * into context_row;

  update public.refund_cases
  set
    status = 'waiting_on_customer',
    automation_state = 'wallet_correction_sent',
    automation_follow_up_due_at = p_expires_at,
    wallet_correction_state = 'sent',
    wallet_correction_version = next_version,
    wallet_correction_requested_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = case_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  )
  values (
    case_row.id,
    'wallet_correction_link_issued',
    'A secure wallet-detail correction link was issued automatically.',
    jsonb_build_object(
      'version', next_version,
      'expires_at', p_expires_at,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'contextId', context_row.id,
    'version', next_version,
    'expiresAt', context_row.expires_at
  );
end;
$$;

create or replace function public.service_cancel_refund_wallet_correction(
  p_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row public.refund_wallet_correction_contexts;
  case_row public.refund_cases;
begin
  select *
  into context_row
  from public.refund_wallet_correction_contexts
  where token_hash = p_token_hash
    and status = 'pending'
  for update;

  if context_row.id is null then
    return false;
  end if;

  select *
  into case_row
  from public.refund_cases
  where id = context_row.refund_case_id
  for update;

  if case_row.id is null
    or public.refund_case_official_payment_locked(case_row) then
    raise exception 'This refund case can no longer be corrected';
  end if;

  update public.refund_wallet_correction_contexts
  set
    status = 'revoked',
    revoked_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = context_row.id;

  update public.refund_cases
  set
    status = 'needs_review',
    automation_state = 'under_review',
    automation_follow_up_due_at = null,
    wallet_correction_state = 'needed',
    updated_at = statement_timestamp()
  where id = context_row.refund_case_id;

  return true;
end;
$$;

create or replace function public.service_get_refund_wallet_correction(
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row public.refund_wallet_correction_contexts;
  case_row public.refund_cases;
  result jsonb;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('state', 'invalid');
  end if;

  select *
  into context_row
  from public.refund_wallet_correction_contexts
  where token_hash = p_token_hash
  for update;

  if context_row.id is null then
    return jsonb_build_object('state', 'invalid');
  end if;

  if context_row.status <> 'pending' then
    return jsonb_build_object('state', context_row.status);
  end if;

  select *
  into case_row
  from public.refund_cases
  where id = context_row.refund_case_id
  for update;

  if case_row.id is null
    or public.refund_case_official_payment_locked(case_row) then
    return jsonb_build_object('state', 'invalid');
  end if;

  if context_row.expires_at <= statement_timestamp() then
    update public.refund_wallet_correction_contexts
    set
      status = 'expired',
      updated_at = statement_timestamp()
    where id = context_row.id;

    update public.refund_cases
    set
      status = case
        when wallet_correction_version >= 2 then 'needs_review'
        else status
      end,
      wallet_correction_state = case
        when wallet_correction_version >= 2 then 'fallback_eligible'
        else 'expired'
      end,
      automation_state = case
        when wallet_correction_version >= 2 then 'fallback_eligible'
        else 'wallet_correction_needed'
      end,
      automation_follow_up_due_at = case
        when wallet_correction_version >= 2 then null
        else automation_follow_up_due_at
      end,
      updated_at = statement_timestamp()
    where id = context_row.refund_case_id;

    return jsonb_build_object('state', 'expired');
  end if;

  select jsonb_build_object(
    'state', 'ready',
    'expiresAt', context_row.expires_at,
    'version', context_row.version,
    'publicReference', refund_case.public_reference,
    'machineLabel', coalesce(
      nullif(btrim(machine.refund_public_display_label), ''),
      machine.machine_label
    ),
    'locationName', location.name,
    'locationTimezone', location.timezone,
    'paymentAmountCents', refund_case.payment_amount_cents,
    'incidentLocalDateTime', refund_case.incident_local_datetime,
    'incidentAt', refund_case.incident_at
  )
  into result
  from public.refund_cases refund_case
  join public.reporting_machines machine
    on machine.id = refund_case.reporting_machine_id
  join public.reporting_locations location
    on location.id = refund_case.reporting_location_id
  where refund_case.id = context_row.refund_case_id
    and refund_case.payment_method = 'card'
    and refund_case.card_wallet_used is true
    and not public.refund_case_official_payment_locked(refund_case);

  return coalesce(result, jsonb_build_object('state', 'invalid'));
end;
$$;

create or replace function public.service_apply_refund_wallet_correction(
  p_token_hash text,
  p_wallet_type text,
  p_card_last4 text,
  p_incident_at timestamptz,
  p_incident_local_datetime text,
  p_amount_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row public.refund_wallet_correction_contexts;
  case_row public.refund_cases;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid wallet correction link';
  end if;

  if p_wallet_type not in ('apple_pay', 'google_pay', 'other_wallet') then
    raise exception 'Choose the mobile wallet used for this purchase';
  end if;

  if p_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'Enter the four wallet card digits';
  end if;

  if p_incident_at is null
    or p_incident_at < statement_timestamp() - interval '45 days'
    or p_incident_at > statement_timestamp() + interval '1 hour' then
    raise exception 'Enter a valid approximate purchase time';
  end if;

  if coalesce(p_amount_confirmed, false) is not true then
    raise exception 'Confirm the purchase amount';
  end if;

  select *
  into context_row
  from public.refund_wallet_correction_contexts
  where token_hash = p_token_hash
  for update;

  if context_row.id is null
    or context_row.status <> 'pending'
    or context_row.expires_at <= statement_timestamp() then
    raise exception 'This wallet correction link is invalid or has expired';
  end if;

  select *
  into case_row
  from public.refund_cases
  where id = context_row.refund_case_id
  for update;

  if case_row.id is null
    or case_row.payment_method <> 'card'
    or case_row.card_wallet_used is not true
    or public.refund_case_official_payment_locked(case_row) then
    raise exception 'This refund case can no longer be corrected';
  end if;

  update public.refund_wallet_correction_contexts
  set
    status = 'submitted',
    consumed_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = context_row.id;

  delete from public.refund_nayax_lookup_candidates
  where refund_case_id = case_row.id;

  update public.refund_cases
  set
    card_last4 = p_card_last4,
    card_wallet_used = true,
    incident_at = p_incident_at,
    incident_local_datetime = p_incident_local_datetime,
    incident_time_resolution = 'exact',
    status = 'needs_review',
    correlation_status = 'needs_nayax',
    correlation_source = null,
    correlation_confidence = 0,
    correlation_summary = 'Customer corrected tokenized wallet details; automatic Nayax re-match is pending.',
    matched_nayax_transaction_id = null,
    matched_nayax_site_id = null,
    matched_nayax_machine_auth_time = null,
    matched_nayax_amount_cents = null,
    matched_nayax_card_last4 = null,
    matched_nayax_currency_code = null,
    nayax_recommendation_state = null,
    nayax_recommendation_policy_version = null,
    nayax_recommendation_evaluated_at = null,
    nayax_match_execution_eligible = false,
    wallet_correction_state = 'received',
    wallet_correction_received_at = statement_timestamp(),
    automation_state = 'wallet_correction_received',
    automation_follow_up_due_at = null,
    updated_at = statement_timestamp()
  where id = case_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  )
  values (
    case_row.id,
    'wallet_correction_received',
    'Customer submitted corrected wallet details; automatic Nayax re-match was requested.',
    jsonb_build_object(
      'version', context_row.version,
      'wallet_type', p_wallet_type,
      'changed_fields', jsonb_build_array(
        'card_last4',
        'incident_at',
        'incident_local_datetime'
      ),
      'machine_context_changed', false,
      'qr_context_changed', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'refundCaseId', case_row.id,
    'publicReference', case_row.public_reference,
    'state', 'submitted'
  );
end;
$$;

create or replace function public.refund_nayax_candidate_evidence_hash(
  p_refund_case_id uuid,
  p_actor_user_id uuid,
  p_provider_transaction_id text,
  p_site_id integer,
  p_machine_authorization_time timestamptz,
  p_amount_cents integer,
  p_card_last4 text,
  p_currency_code text,
  p_evidence_summary jsonb,
  p_expires_at timestamptz,
  p_created_at timestamptz
)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(
    extensions.digest(
      jsonb_build_array(
        p_refund_case_id,
        p_actor_user_id,
        p_provider_transaction_id,
        p_site_id,
        p_machine_authorization_time,
        p_amount_cents,
        p_card_last4,
        p_currency_code,
        p_evidence_summary,
        p_expires_at,
        p_created_at
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.refund_official_action_context_hash(
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
  p_nayax_disagreement_reason text,
  p_candidate_evidence_hash text default null
)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(
    extensions.digest(
      jsonb_build_array(
        case when p_action is null then null else lower(btrim(p_action)) end,
        case when p_target_status is null then null else lower(btrim(p_target_status)) end,
        case when p_target_decision is null then null else lower(btrim(p_target_decision)) end,
        case when p_assigned_manager_email is null then null else lower(btrim(p_assigned_manager_email)) end,
        case when p_decision_reason is null then null else btrim(p_decision_reason) end,
        case when p_internal_note is null then null else btrim(p_internal_note) end,
        p_refund_amount_cents,
        case when p_manual_refund_reference is null then null else btrim(p_manual_refund_reference) end,
        p_cash_payout_sent_at,
        p_cash_payment_confirmed,
        p_matched_nayax_candidate_token,
        case when p_nayax_disagreement_reason is null then null else lower(btrim(p_nayax_disagreement_reason)) end,
        p_candidate_evidence_hash
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

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
set search_path = public
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
      or nullif(btrim(coalesce(p_manual_refund_reference, '')), '') is null
      or p_cash_payout_sent_at is null
      or coalesce(p_cash_payment_confirmed, false) = false
      or p_matched_nayax_candidate_token is not null
      or normalized_disagreement_reason is not null then
      raise exception 'Cash completion requires only the confirmed cash payment context';
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

create or replace function public.can_perform_refund_official_action(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and not exists (
      select 1
      from public.admin_roles admin_role
      where admin_role.user_id = p_user_id
        and admin_role.active = true
    )
    and not exists (
      select 1
      from public.admin_scoped_access_grants admin_grant
      where admin_grant.user_id = p_user_id
        and public.admin_scoped_grant_is_active(
          admin_grant.starts_at,
          admin_grant.expires_at,
          admin_grant.revoked_at
        )
    )
    and exists (
      select 1
      from public.refund_cases refund_case
      join public.reporting_machine_refund_managers manager
        on manager.reporting_machine_id = refund_case.reporting_machine_id
      where refund_case.id = p_refund_case_id
        and manager.manager_user_id = p_user_id
        and manager.status = 'active'
        and manager.revoked_at is null
    );
$$;

create or replace function public.can_perform_refund_official_action_current_user(
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.refund_official_actions_enabled() then false
    else auth.role() = 'authenticated'
      and public.refund_official_action_has_recent_human_step_up()
      and public.can_perform_refund_official_action((select auth.uid()), p_refund_case_id)
  end;
$$;

create or replace function public.admin_authorize_refund_official_action(
  p_case_id uuid,
  p_action text,
  p_expected_case_version bigint,
  p_target_status text default null,
  p_target_decision text default null,
  p_assigned_manager_email text default null,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_refund_amount_cents integer default null,
  p_manual_refund_reference text default null,
  p_cash_payout_sent_at timestamptz default null,
  p_cash_payment_confirmed boolean default false,
  p_matched_nayax_candidate_token uuid default null,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  authenticated_actor_user_id uuid := auth.uid();
  refund_case public.refund_cases%rowtype;
  manager_mapping public.reporting_machine_refund_managers%rowtype;
  nayax_candidate public.refund_nayax_lookup_candidates%rowtype;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  normalized_status text := lower(btrim(coalesce(p_target_status, '')));
  normalized_decision text := lower(btrim(coalesce(p_target_decision, '')));
  candidate_evidence_hash text;
  context_hash text;
begin
  if auth.role() is distinct from 'authenticated' or authenticated_actor_user_id is null then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  if not public.refund_official_actions_enabled() then
    raise exception 'Official refund actions are disabled until manager step-up verification is deployed';
  end if;

  if not public.refund_official_action_has_recent_human_step_up() then
    raise exception 'A fresh authenticator verification is required for this official action';
  end if;

  perform public.assert_refund_official_action_payload_shape(
    normalized_action,
    normalized_status,
    normalized_decision,
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_cash_payout_sent_at,
    p_cash_payment_confirmed,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason
  );

  select case_row.*
  into refund_case
  from public.refund_cases case_row
  where case_row.id = p_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;

  if not public.can_perform_refund_official_action(authenticated_actor_user_id, refund_case.id) then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;

  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before taking an official action';
  end if;

  if normalized_action = 'cash_complete' and refund_case.payment_method <> 'cash' then
    raise exception 'Cash completion is available only for cash refund cases';
  end if;

  if normalized_action = 'approve' then
    if refund_case.payment_method = 'card'
      and normalized_status <> 'card_refund_pending' then
      raise exception 'Card approval must enter the card refund pending state';
    elsif refund_case.payment_method = 'cash'
      and normalized_status <> 'cash_zelle_pending' then
      raise exception 'Cash approval must enter the cash refund pending state';
    elsif refund_case.payment_method not in ('card', 'cash') then
      raise exception 'This payment method cannot be approved for a refund';
    end if;
  end if;

  if normalized_action = 'nayax_execute' and refund_case.payment_method <> 'card' then
    raise exception 'Nayax execution is available only for card refund cases';
  end if;

  if normalized_action = 'nayax_execute'
    and p_refund_amount_cents is distinct from refund_case.refund_amount_cents then
    raise exception 'Nayax execution amount changed since manager review';
  end if;

  select manager.*
  into manager_mapping
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = refund_case.reporting_machine_id
    and manager.manager_user_id = authenticated_actor_user_id
    and manager.status = 'active'
    and manager.revoked_at is null
  for share;

  if not found then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;

  if p_matched_nayax_candidate_token is not null then
    if normalized_action <> 'approve'
      or refund_case.payment_method <> 'card'
      or normalized_status <> 'card_refund_pending' then
      raise exception 'Nayax candidate selection is available only during card approval';
    end if;

    select candidate.*
    into nayax_candidate
    from public.refund_nayax_lookup_candidates candidate
    where candidate.token = p_matched_nayax_candidate_token
      and candidate.refund_case_id = refund_case.id
      and candidate.actor_user_id = authenticated_actor_user_id
      and candidate.expires_at > statement_timestamp()
    for share;

    if not found then
      raise exception 'Nayax lookup evidence expired or belongs to another review session';
    end if;

    candidate_evidence_hash := public.refund_nayax_candidate_evidence_hash(
      nayax_candidate.refund_case_id,
      nayax_candidate.actor_user_id,
      nayax_candidate.provider_transaction_id,
      nayax_candidate.site_id,
      nayax_candidate.machine_authorization_time,
      nayax_candidate.amount_cents,
      nayax_candidate.card_last4,
      nayax_candidate.currency_code,
      nayax_candidate.evidence_summary,
      nayax_candidate.expires_at,
      nayax_candidate.created_at
    );
  end if;

  context_hash := public.refund_official_action_context_hash(
    normalized_action,
    normalized_status,
    normalized_decision,
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_cash_payout_sent_at,
    p_cash_payment_confirmed,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason,
    candidate_evidence_hash
  );

  insert into public.refund_case_official_action_authorizations (
    refund_case_id,
    action,
    actor_user_id,
    manager_mapping_id,
    manager_mapping_version,
    expected_case_version,
    action_context_hash,
    expires_at
  )
  values (
    refund_case.id,
    normalized_action,
    authenticated_actor_user_id,
    manager_mapping.id,
    manager_mapping.mapping_version,
    refund_case.official_action_version,
    context_hash,
    statement_timestamp() + interval '5 minutes'
  )
  returning * into authorization_row;

  return jsonb_build_object(
    'authorizationId', authorization_row.id,
    'action', authorization_row.action,
    'expectedCaseVersion', authorization_row.expected_case_version,
    'mappingVersion', authorization_row.manager_mapping_version,
    'expiresAt', authorization_row.expires_at
  );
end;
$$;

create or replace function public.consume_refund_official_action_authorization(
  p_authorization_id uuid,
  p_case_id uuid,
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
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  refund_case public.refund_cases%rowtype;
  manager_mapping public.reporting_machine_refund_managers%rowtype;
  nayax_candidate public.refund_nayax_lookup_candidates%rowtype;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  candidate_evidence_hash text;
  expected_context_hash text;
begin
  select action_authorization.*
  into authorization_row
  from public.refund_case_official_action_authorizations action_authorization
  where action_authorization.id = p_authorization_id
  for update;

  if not found then
    raise exception 'Official action authorization not found';
  end if;

  if authorization_row.status <> 'authorized' or authorization_row.consumed_at is not null then
    raise exception 'Official action authorization was already used';
  end if;

  if authorization_row.expires_at <= statement_timestamp() then
    raise exception 'Official action authorization expired';
  end if;

  if authorization_row.refund_case_id is distinct from p_case_id
    or authorization_row.action is distinct from normalized_action then
    raise exception 'Official action authorization does not match this request';
  end if;

  perform public.assert_refund_official_action_payload_shape(
    normalized_action,
    p_target_status,
    p_target_decision,
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_cash_payout_sent_at,
    p_cash_payment_confirmed,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason
  );

  select case_row.*
  into refund_case
  from public.refund_cases case_row
  where case_row.id = authorization_row.refund_case_id
  for update;

  if not found
    or refund_case.official_action_version is distinct from authorization_row.expected_case_version then
    raise exception 'Refund case changed since authorization; reload before taking an official action';
  end if;

  if not public.can_perform_refund_official_action(
    authorization_row.actor_user_id,
    refund_case.id
  ) then
    raise exception 'Machine Manager mapping or admin authority changed before the official action';
  end if;

  select manager.*
  into manager_mapping
  from public.reporting_machine_refund_managers manager
  where manager.id = authorization_row.manager_mapping_id
    and manager.reporting_machine_id = refund_case.reporting_machine_id
    and manager.manager_user_id = authorization_row.actor_user_id
    and manager.mapping_version = authorization_row.manager_mapping_version
    and manager.status = 'active'
    and manager.revoked_at is null
  for share;

  if not found then
    raise exception 'Machine Manager mapping changed before the official action';
  end if;

  if p_matched_nayax_candidate_token is not null then
    select candidate.*
    into nayax_candidate
    from public.refund_nayax_lookup_candidates candidate
    where candidate.token = p_matched_nayax_candidate_token
      and candidate.refund_case_id = p_case_id
      and candidate.actor_user_id = authorization_row.actor_user_id
      and candidate.expires_at > statement_timestamp()
    for share;

    if not found then
      raise exception 'Nayax lookup evidence expired or belongs to another review session';
    end if;

    candidate_evidence_hash := public.refund_nayax_candidate_evidence_hash(
      nayax_candidate.refund_case_id,
      nayax_candidate.actor_user_id,
      nayax_candidate.provider_transaction_id,
      nayax_candidate.site_id,
      nayax_candidate.machine_authorization_time,
      nayax_candidate.amount_cents,
      nayax_candidate.card_last4,
      nayax_candidate.currency_code,
      nayax_candidate.evidence_summary,
      nayax_candidate.expires_at,
      nayax_candidate.created_at
    );
  end if;

  expected_context_hash := public.refund_official_action_context_hash(
    normalized_action,
    p_target_status,
    p_target_decision,
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_cash_payout_sent_at,
    p_cash_payment_confirmed,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason,
    candidate_evidence_hash
  );

  if authorization_row.action_context_hash is distinct from expected_context_hash then
    raise exception 'Official action authorization payload changed';
  end if;

  update public.refund_case_official_action_authorizations
  set
    status = 'consumed',
    consumed_at = statement_timestamp()
  where id = authorization_row.id;

  return jsonb_build_object(
    'actorUserId', authorization_row.actor_user_id,
    'managerMappingId', authorization_row.manager_mapping_id,
    'managerMappingVersion', authorization_row.manager_mapping_version,
    'expectedCaseVersion', authorization_row.expected_case_version,
    'action', authorization_row.action
  );
end;
$$;

create or replace function public.service_apply_refund_official_case_update(
  p_authorization_id uuid,
  p_case_id uuid,
  p_action text,
  p_status text,
  p_assigned_manager_email text default null,
  p_decision text default null,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_refund_amount_cents integer default null,
  p_manual_refund_reference text default null,
  p_matched_nayax_candidate_token uuid default null,
  p_nayax_disagreement_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  authorization_context jsonb;
  actor_user_id uuid;
  manager_mapping_id uuid;
  manager_mapping_version bigint;
  candidate public.refund_nayax_lookup_candidates%rowtype;
  candidate_recommended boolean := false;
  candidate_selection_allowed boolean := false;
  recommendation_state text;
  policy_version text;
  one_click_eligible boolean := false;
  updated_case jsonb;
begin
  authorization_context := public.consume_refund_official_action_authorization(
    p_authorization_id,
    p_case_id,
    p_action,
    p_status,
    p_decision,
    p_assigned_manager_email,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    null,
    false,
    p_matched_nayax_candidate_token,
    p_nayax_disagreement_reason
  );

  if lower(btrim(coalesce(p_action, ''))) not in ('approve', 'decline') then
    raise exception 'This endpoint accepts only approve or decline actions';
  end if;

  actor_user_id := (authorization_context ->> 'actorUserId')::uuid;
  manager_mapping_id := (authorization_context ->> 'managerMappingId')::uuid;
  manager_mapping_version := (authorization_context ->> 'managerMappingVersion')::bigint;

  if p_matched_nayax_candidate_token is not null then
    select lookup_candidate.*
    into candidate
    from public.refund_nayax_lookup_candidates lookup_candidate
    where lookup_candidate.token = p_matched_nayax_candidate_token
      and lookup_candidate.refund_case_id = p_case_id
      and lookup_candidate.expires_at > statement_timestamp()
    for share;

    if not found then
      raise exception 'Nayax lookup evidence expired; run lookup again';
    end if;

    candidate_selection_allowed := candidate.evidence_summary ->> 'selection_allowed' = 'true';
    candidate_recommended := candidate.evidence_summary ->> 'is_recommended' = 'true';

    if not candidate_selection_allowed then
      raise exception 'This Nayax transaction has a safety block and cannot be selected';
    end if;

    if not candidate_recommended
      and lower(btrim(coalesce(p_nayax_disagreement_reason, ''))) not in (
        'closer_time',
        'correct_amount',
        'correct_card',
        'customer_confirmation',
        'provider_data_issue',
        'other_review_reason'
      ) then
      raise exception 'Choose why this alternate Nayax transaction is the correct one';
    end if;

    if exists (
      select 1
      from public.refund_cases duplicate_case
      where duplicate_case.id <> p_case_id
        and duplicate_case.matched_nayax_transaction_id = candidate.provider_transaction_id
    ) then
      raise exception 'This Nayax transaction is already linked to another refund case'
        using errcode = '23505';
    end if;
  end if;

  if not public.can_perform_refund_official_action(actor_user_id, p_case_id) then
    raise exception 'Machine Manager mapping or admin authority changed before the official mutation';
  end if;

  perform set_config('request.jwt.claim.sub', actor_user_id::text, true);

  updated_case := public.admin_update_refund_case(
    p_case_id,
    p_status,
    p_assigned_manager_email,
    p_decision,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    false,
    candidate.provider_transaction_id,
    candidate.site_id,
    candidate.machine_authorization_time,
    candidate.amount_cents,
    candidate.card_last4,
    candidate.currency_code
  );

  if candidate.token is not null then
    recommendation_state := coalesce(
      nullif(btrim(candidate.evidence_summary ->> 'recommendation_state'), ''),
      'manual_exception'
    );
    policy_version := nullif(btrim(candidate.evidence_summary ->> 'policy_version'), '');
    one_click_eligible := recommendation_state = 'high_confidence'
      and candidate_recommended
      and candidate.evidence_summary ->> 'one_click_eligible' = 'true';

    update public.refund_cases
    set
      nayax_recommendation_state = recommendation_state,
      nayax_recommendation_policy_version = policy_version,
      nayax_recommendation_evaluated_at = statement_timestamp(),
      nayax_match_execution_eligible = one_click_eligible,
      correlation_confidence = 0,
      correlation_summary = case
        when one_click_eligible
          then 'Machine Manager confirmed the recommended Nayax transaction using versioned evidence.'
        else 'Machine Manager selected a Nayax transaction for manual review; one-click execution remains unavailable.'
      end
    where id = p_case_id;

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
      'nayax_match_selected',
      case
        when candidate_recommended then 'Machine Manager confirmed the recommended Nayax transaction.'
        else 'Machine Manager selected an alternate Nayax transaction after review.'
      end,
      jsonb_build_object(
        'policy_version', policy_version,
        'recommendation_state', recommendation_state,
        'selected_recommended', candidate_recommended,
        'disagreement_reason_code', case
          when candidate_recommended then null
          else lower(btrim(coalesce(p_nayax_disagreement_reason, '')))
        end,
        'execution_eligible', one_click_eligible,
        'payload_redacted', true
      )
    );
  end if;

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
    case
      when lower(btrim(p_action)) = 'approve' then 'Mapped Machine Manager approved the refund action.'
      else 'Mapped Machine Manager declined the refund request.'
    end,
    jsonb_build_object(
      'action', lower(btrim(p_action)),
      'manager_mapping_id', manager_mapping_id,
      'manager_mapping_version', manager_mapping_version,
      'payload_redacted', true
    )
  );

  return updated_case;
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
set search_path = public, auth
as $$
declare
  authorization_context jsonb;
  actor_user_id uuid;
  manager_mapping_id uuid;
  manager_mapping_version bigint;
  completion_result jsonb;
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
    p_manual_refund_reference,
    p_cash_payout_sent_at,
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
    p_manual_refund_reference,
    p_cash_payout_sent_at,
    p_decision_reason,
    p_internal_note,
    p_assigned_manager_email
  );

  if coalesce((completion_result ->> 'updateApplied')::boolean, false) then
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
      'Mapped Machine Manager completed the cash refund.',
      jsonb_build_object(
        'action', 'cash_complete',
        'manager_mapping_id', manager_mapping_id,
        'manager_mapping_version', manager_mapping_version,
        'payload_redacted', true
      )
    );
  end if;

  return completion_result;
end;
$$;

create or replace function public.service_consume_nayax_refund_official_action(
  p_authorization_id uuid,
  p_case_id uuid,
  p_status text,
  p_decision text,
  p_refund_amount_cents integer,
  p_matched_nayax_candidate_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  authorization_context jsonb;
  actor_user_id uuid;
begin
  if p_matched_nayax_candidate_token is not null then
    raise exception 'Nayax execution uses the persisted approved match and does not accept a candidate token';
  end if;

  authorization_context := public.consume_refund_official_action_authorization(
    p_authorization_id,
    p_case_id,
    'nayax_execute',
    p_status,
    p_decision,
    null,
    null,
    null,
    p_refund_amount_cents,
    null,
    null,
    false,
    p_matched_nayax_candidate_token,
    null
  );

  actor_user_id := (authorization_context ->> 'actorUserId')::uuid;
  if not public.can_prepare_nayax_refund_execution(actor_user_id, p_case_id) then
    raise exception 'Nayax refund preparation is no longer safe for this case';
  end if;

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
    'nayax_official_action_revalidated',
    'Mapped Machine Manager authority was revalidated immediately before Nayax preparation.',
    jsonb_build_object(
      'action', 'nayax_execute',
      'manager_mapping_id', authorization_context ->> 'managerMappingId',
      'manager_mapping_version', (authorization_context ->> 'managerMappingVersion')::bigint,
      'payload_redacted', true
    )
  );

  return authorization_context;
end;
$$;

-- Service identities retain triage updates, but cannot turn that path into an
-- approval, decline, payment completion, or manager-selected Nayax match.
create or replace function public.service_update_refund_case_as_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_status text default null,
  p_assigned_manager_email text default null,
  p_decision text default null,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_refund_amount_cents integer default null,
  p_manual_refund_reference text default null,
  p_clear_nayax_match boolean default false,
  p_matched_nayax_transaction_id text default null,
  p_matched_nayax_site_id integer default null,
  p_matched_nayax_machine_auth_time timestamptz default null,
  p_matched_nayax_amount_cents integer default null,
  p_matched_nayax_card_last4 text default null,
  p_matched_nayax_currency_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  before_row public.refund_cases%rowtype;
  normalized_status text;
  normalized_decision text;
begin
  if p_actor_user_id is null then
    raise exception 'Actor is required';
  end if;

  select refund_case.*
  into before_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if not found then
    raise exception 'Refund case not found';
  end if;

  if not public.can_manage_refund_case(p_actor_user_id, p_case_id) then
    raise exception 'Refund case access required';
  end if;

  normalized_status := lower(btrim(coalesce(p_status, before_row.status)));
  normalized_decision := nullif(lower(btrim(coalesce(p_decision, ''))), '');

  if public.refund_case_official_payment_locked(before_row)
    or normalized_status in ('approved', 'denied', 'card_refund_pending', 'cash_zelle_pending', 'completed', 'closed')
    or normalized_decision in ('approved', 'denied')
    or nullif(btrim(coalesce(p_manual_refund_reference, '')), '') is not null
    or p_matched_nayax_transaction_id is not null
    or p_matched_nayax_site_id is not null
    or p_matched_nayax_machine_auth_time is not null
    or p_matched_nayax_amount_cents is not null
    or p_matched_nayax_card_last4 is not null
    or p_matched_nayax_currency_code is not null then
    raise exception 'Official refund actions require a browser-authenticated Machine Manager authorization';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

  return public.admin_update_refund_case(
    p_case_id,
    p_status,
    p_assigned_manager_email,
    p_decision,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_clear_nayax_match,
    p_matched_nayax_transaction_id,
    p_matched_nayax_site_id,
    p_matched_nayax_machine_auth_time,
    p_matched_nayax_amount_cents,
    p_matched_nayax_card_last4,
    p_matched_nayax_currency_code
  );
end;
$$;

create or replace function public.can_prepare_nayax_refund_execution(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = p_refund_case_id
        and public.can_perform_refund_official_action(p_user_id, refund_case.id)
        and refund_case.payment_method = 'card'
        and refund_case.decision = 'approved'
        and refund_case.status in ('approved', 'card_refund_pending')
        and refund_case.correlation_status = 'matched'
        and refund_case.correlation_source = 'nayax'
        and refund_case.nayax_recommendation_state = 'high_confidence'
        and refund_case.nayax_match_execution_eligible = true
        and refund_case.card_wallet_used = false
        and refund_case.nayax_recommendation_policy_version is not null
        and public.is_review_safe_nayax_transaction_reference(refund_case.matched_nayax_transaction_id)
        and refund_case.matched_nayax_site_id is not null
        and refund_case.matched_nayax_machine_auth_time is not null
        and refund_case.matched_nayax_currency_code = 'USD'
        and refund_case.refund_amount_cents is not null
        and refund_case.payment_amount_cents is not null
        and refund_case.matched_nayax_amount_cents is not null
        and refund_case.refund_amount_cents > 0
        and refund_case.refund_amount_cents = refund_case.payment_amount_cents
        and refund_case.refund_amount_cents = refund_case.matched_nayax_amount_cents
        and refund_case.reporting_adjustment_id is null
        and not exists (
          select 1
          from public.refund_cases duplicate_case
          where duplicate_case.id <> refund_case.id
            and duplicate_case.matched_nayax_transaction_id = refund_case.matched_nayax_transaction_id
        )
        and exists (
          select 1
          from public.reporting_machines machine
          where machine.id = refund_case.reporting_machine_id
            and machine.status = 'active'
            and machine.nayax_refunds_enabled = true
            and machine.nayax_machine_id is not null
            and btrim(machine.nayax_machine_id) <> ''
            and (
              machine.nayax_refund_max_amount_cents is null
              or refund_case.refund_amount_cents <= machine.nayax_refund_max_amount_cents
            )
        )
    );
$$;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_ops_overview_pre_official;

revoke execute on function public.admin_get_refund_ops_overview_pre_official()
  from public, anon, authenticated;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  base_result jsonb;
  enriched_cases jsonb;
begin
  base_result := public.admin_get_refund_ops_overview_pre_official();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'canPerformOfficialAction', case
          when not public.refund_official_actions_enabled() then false
          else public.can_perform_refund_official_action(actor_user_id, refund_case.id)
            and public.refund_official_action_has_recent_human_step_up()
        end,
        'officialActionBlockReason', case
          when not public.refund_official_actions_enabled()
            then 'official_actions_disabled'
          when not public.can_perform_refund_official_action(actor_user_id, refund_case.id)
            then 'manager_mapping_required'
          when not public.refund_official_action_has_recent_human_step_up()
            then 'manager_verification_required'
          else null
        end,
        'officialActionVersion', refund_case.official_action_version
      )
      order by item.case_order
    ),
    '[]'::jsonb
  )
  into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality as item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid;

  return jsonb_set(base_result, '{cases}', enriched_cases, true);
end;
$$;

revoke execute on function public.bump_refund_manager_mapping_version()
  from public, anon, authenticated, service_role;
revoke execute on function public.bump_refund_case_official_action_version()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_refund_case_official_transition_boundary()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_refund_official_event_boundary()
  from public, anon, authenticated, service_role;
revoke execute on function public.reject_refund_nayax_candidate_update()
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_case_official_payment_locked(public.refund_cases)
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_official_actions_enabled()
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_official_action_has_recent_human_step_up()
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_candidate_evidence_hash(
  uuid, uuid, text, integer, timestamptz, integer, text, text, jsonb, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke execute on function public.refund_official_action_context_hash(
  text, text, text, text, text, text, integer, text, timestamptz, boolean, uuid, text, text
) from public, anon, authenticated, service_role;
revoke execute on function public.assert_refund_official_action_payload_shape(
  text, text, text, text, text, text, integer, text, timestamptz, boolean, uuid, text
) from public, anon, authenticated, service_role;

revoke insert, update, delete on table public.reporting_machine_refund_managers
  from service_role;
grant select on table public.reporting_machine_refund_managers
  to service_role;
revoke update on table public.refund_nayax_lookup_candidates
  from service_role;

drop function if exists public.service_finalize_nayax_refund_official_action(
  uuid, uuid, text, text
);
revoke execute on function public.can_perform_refund_official_action(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_perform_refund_official_action(uuid, uuid)
  to service_role;
revoke execute on function public.can_perform_refund_official_action_current_user(uuid)
  from public, anon;
grant execute on function public.can_perform_refund_official_action_current_user(uuid)
  to authenticated;
revoke execute on function public.admin_authorize_refund_official_action(
  uuid, text, bigint, text, text, text, text, text, integer, text, timestamptz, boolean, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_authorize_refund_official_action(
  uuid, text, bigint, text, text, text, text, text, integer, text, timestamptz, boolean, uuid, text
) to authenticated;
revoke execute on function public.consume_refund_official_action_authorization(
  uuid, uuid, text, text, text, text, text, text, integer, text, timestamptz, boolean, uuid, text
) from public, anon, authenticated, service_role;
revoke execute on function public.service_apply_refund_official_case_update(
  uuid, uuid, text, text, text, text, text, text, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.service_apply_refund_official_case_update(
  uuid, uuid, text, text, text, text, text, text, integer, text, uuid, text) to service_role;
revoke execute on function public.service_complete_cash_refund_official(
  uuid, uuid, integer, text, timestamp with time zone, text, text, text) from public, anon, authenticated;
grant execute on function public.service_complete_cash_refund_official(
  uuid, uuid, integer, text, timestamp with time zone, text, text, text) to service_role;
revoke execute on function public.service_consume_nayax_refund_official_action(
  uuid, uuid, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.service_consume_nayax_refund_official_action(
  uuid, uuid, text, text, integer, uuid) to service_role;
-- The actor-supplied completion RPC remains an internal implementation detail.
revoke execute on function public.service_complete_cash_refund_as_actor(
  uuid, uuid, integer, text, timestamptz, text, text, text
) from service_role;
revoke execute on function public.admin_update_refund_case(
  uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamptz, integer, text, text
) from public, anon, authenticated, service_role;

revoke execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)
  to service_role;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on column public.reporting_machine_refund_managers.mapping_version is
  'Monotonic row revision captured whenever a Machine Manager authorization is granted, changed, or revoked.';
comment on column public.refund_cases.official_action_version is
  'Monotonic review version for fields that can change the safety of a refund decision or payment action.';
comment on table public.refund_case_official_action_authorizations is
  'Content-free, five-minute, single-use authorizations minted only from an authenticated active Machine Manager session.';
comment on function public.can_perform_refund_official_action(uuid, uuid) is
  'Service-only authorization predicate requiring a current Machine Manager mapping and rejecting every active admin entitlement.';
comment on function public.admin_authorize_refund_official_action(
  uuid, text, bigint, text, text, text, text, text, integer, text, timestamptz, boolean, uuid, text
) is
  'Authenticated-browser boundary for one exact official refund action. The actor is always auth.uid().';
comment on function public.service_apply_refund_official_case_update(
  uuid, uuid, text, text, text, text, text, text, integer, text, uuid, text) is
  'Service-only receipt consumer for an exact approve or decline action authorized by the mapped Machine Manager in the browser.';
comment on function public.service_complete_cash_refund_official(
  uuid, uuid, integer, text, timestamp with time zone, text, text, text) is
  'Service-only cash completion boundary that consumes one exact mapped-manager authorization receipt.';
comment on function public.service_consume_nayax_refund_official_action(
  uuid, uuid, text, text, integer, uuid) is
  'Service-only last-mile Nayax authorization consumer; provider integration must preserve the frozen evidence behind this boundary.';
comment on function public.service_update_refund_case_as_actor(
  uuid, uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamptz, integer, text, text
) is
  'Service-only non-official triage update. Approve, decline, completion, and Nayax selection require a browser authorization receipt.';
comment on function public.can_prepare_nayax_refund_execution(uuid, uuid) is
  'Fail-closed readiness predicate requiring the actor to remain an active mapped Machine Manager.';

select pg_notify('pgrst', 'reload schema');
