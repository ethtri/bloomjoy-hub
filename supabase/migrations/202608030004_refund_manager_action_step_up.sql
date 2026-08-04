-- #692: fresh, action-bound human TOTP step-up for every official refund action.
--
-- Production execution intentionally remains hard-disabled in this migration.
-- The owner-controlled enrollment window is also closed by default and cannot
-- be changed through an authenticated or service-role RPC.

create table if not exists public.refund_manager_security_config (
  singleton boolean primary key default true check (singleton),
  totp_enrollment_enabled boolean not null default false,
  totp_enrollment_approved_manager_user_id uuid references auth.users (id) on delete restrict,
  totp_enrollment_approved_by_owner_user_id uuid references auth.users (id) on delete restrict,
  totp_enrollment_approval_expires_at timestamptz,
  totp_enrollment_approval_version bigint not null default 0 check (
    totp_enrollment_approval_version >= 0
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint refund_manager_security_config_enrollment_window_valid check (
    not totp_enrollment_enabled
    or (
      totp_enrollment_approved_manager_user_id is not null
      and totp_enrollment_approved_by_owner_user_id is not null
      and totp_enrollment_approval_expires_at is not null
      and totp_enrollment_approval_version > 0
    )
  )
);

insert into public.refund_manager_security_config (
  singleton,
  totp_enrollment_enabled
)
values (true, false)
on conflict (singleton) do nothing;

alter table public.refund_manager_security_config enable row level security;
revoke all on table public.refund_manager_security_config
  from public, anon, authenticated, service_role;

-- This is deliberately not connected to a mutable config row. A future
-- owner-reviewed migration is required to replace the hard false gate.
create or replace function public.refund_official_actions_enabled()
returns boolean
language sql
immutable
set search_path = public
as $$
  select false;
$$;

create or replace function public.refund_manager_totp_enrollment_window_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select config.totp_enrollment_enabled
      and config.totp_enrollment_approved_manager_user_id is not null
      and config.totp_enrollment_approved_by_owner_user_id is not null
      and config.totp_enrollment_approval_expires_at > statement_timestamp()
      and config.totp_enrollment_approval_version > 0
    from public.refund_manager_security_config config
    where config.singleton = true
  ), false);
$$;

create or replace function public.user_is_active_refund_manager_only(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.reporting_machine_refund_managers manager
      where manager.manager_user_id = p_user_id
        and manager.status = 'active'
        and manager.revoked_at is null
    )
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
    );
$$;

create or replace function public.can_enroll_refund_manager_totp_current_user()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.role() = 'authenticated'
    and auth.uid() is not null
    and public.refund_manager_totp_enrollment_window_enabled()
    and exists (
      select 1
      from public.refund_manager_security_config config
      where config.singleton = true
        and config.totp_enrollment_approved_manager_user_id = auth.uid()
    )
    and public.user_is_active_refund_manager_only(auth.uid());
$$;

-- This is the durable authorization boundary between a generic Auth TOTP
-- factor and the refund-specific factor that an owner approved during a
-- short, single-manager enrollment window. Only a purpose-bound one-way hash
-- of the Auth factor identifier is persisted; the identifier itself is never
-- stored in public application tables, events, or audit rows.
create table if not exists public.refund_manager_totp_enrollments (
  actor_user_id uuid primary key references auth.users (id) on delete restrict,
  approved_factor_binding_hash text not null check (
    approved_factor_binding_hash ~ '^[a-f0-9]{64}$'
  ),
  owner_approved_by_user_id uuid not null references auth.users (id) on delete restrict,
  owner_approval_version bigint not null check (owner_approval_version > 0),
  enrollment_version bigint not null default 1 check (enrollment_version > 0),
  status text not null default 'active' check (status in ('active', 'revoked')),
  approved_at timestamptz not null default statement_timestamp(),
  last_step_up_verified_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint refund_manager_totp_enrollments_lifecycle_valid check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

alter table public.refund_manager_totp_enrollments enable row level security;
revoke all on table public.refund_manager_totp_enrollments
  from public, anon, authenticated, service_role;

create table if not exists public.refund_manager_action_step_up_intents (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  refund_case_id uuid not null references public.refund_cases (id) on delete restrict,
  action text not null check (action in ('approve', 'decline', 'cash_complete', 'nayax_execute')),
  target_function text not null check (
    target_function in ('refund-case-admin-update', 'nayax-card-refund')
  ),
  manager_mapping_id uuid not null references public.reporting_machine_refund_managers (id) on delete restrict,
  manager_mapping_version bigint not null check (manager_mapping_version > 0),
  manager_totp_enrollment_version bigint not null check (manager_totp_enrollment_version > 0),
  expected_case_version bigint not null check (expected_case_version > 0),
  action_context_hash text not null check (action_context_hash ~ '^[a-f0-9]{64}$'),
  candidate_evidence_hash text check (
    candidate_evidence_hash is null or candidate_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  nayax_execution_evidence_hash text check (
    nayax_execution_evidence_hash is null
    or nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  status text not null default 'pending' check (
    status in ('pending', 'consumed', 'cancelled', 'superseded', 'expired')
  ),
  not_before timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '2 minutes'),
  factor_verified_at timestamptz,
  factor_verification_proof_hash text check (
    factor_verification_proof_hash is null
    or factor_verification_proof_hash ~ '^[a-f0-9]{64}$'
  ),
  verified_totp_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_manager_action_step_up_intents_expiry_valid
    check (expires_at > not_before and expires_at <= not_before + interval '2 minutes 5 seconds'),
  constraint refund_manager_action_step_up_intents_factor_proof_valid
    check (
      (factor_verified_at is null and factor_verification_proof_hash is null)
      or (
        factor_verified_at is not null
        and factor_verified_at >= not_before
        and factor_verified_at <= expires_at
        and (
          factor_verification_proof_hash is null
          or status = 'pending'
        )
      )
    ),
  constraint refund_manager_action_step_up_intents_lifecycle_valid
    check (
      (status = 'pending' and verified_totp_at is null and consumed_at is null and cancelled_at is null)
      or (status = 'consumed' and verified_totp_at is not null and consumed_at is not null and cancelled_at is null)
      or (status = 'cancelled' and consumed_at is null and cancelled_at is not null)
      or (status in ('superseded', 'expired') and consumed_at is null)
    ),
  constraint refund_manager_action_step_up_intents_nayax_evidence_valid check (
    (action = 'nayax_execute' and nayax_execution_evidence_hash is not null)
    or (action <> 'nayax_execute' and nayax_execution_evidence_hash is null)
  )
);

create unique index if not exists refund_manager_action_step_up_one_live_actor_idx
  on public.refund_manager_action_step_up_intents (actor_user_id)
  where status = 'pending';

create unique index if not exists refund_manager_action_step_up_one_use_totp_idx
  on public.refund_manager_action_step_up_intents (actor_user_id, verified_totp_at)
  where status = 'consumed' and verified_totp_at is not null;

create index if not exists refund_manager_action_step_up_case_idx
  on public.refund_manager_action_step_up_intents (refund_case_id, created_at desc);

create index if not exists refund_manager_action_step_up_expiry_idx
  on public.refund_manager_action_step_up_intents (expires_at)
  where status = 'pending';

alter table public.refund_manager_action_step_up_intents enable row level security;
revoke all on table public.refund_manager_action_step_up_intents
  from public, anon, authenticated, service_role;

create table if not exists public.refund_manager_step_up_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  refund_case_id uuid references public.refund_cases (id) on delete restrict,
  intent_id uuid references public.refund_manager_action_step_up_intents (id) on delete restrict,
  action text check (action is null or action in ('approve', 'decline', 'cash_complete', 'nayax_execute')),
  event_type text not null check (
    event_type in (
      'intent_created',
      'intent_cancelled',
      'intent_consumed',
      'totp_enrollment_verified',
      'totp_enrollment_compensated'
    )
  ),
  verified_totp_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  payload_redacted boolean not null default true check (payload_redacted)
);

create index if not exists refund_manager_step_up_audit_actor_idx
  on public.refund_manager_step_up_audit (actor_user_id, created_at desc);

alter table public.refund_manager_step_up_audit enable row level security;
revoke all on table public.refund_manager_step_up_audit
  from public, anon, authenticated, service_role;

alter table public.refund_case_official_action_authorizations
  add column if not exists step_up_intent_id uuid
    references public.refund_manager_action_step_up_intents (id) on delete restrict;

alter table public.refund_case_official_action_authorizations
  add column if not exists verified_totp_at timestamptz;

alter table public.refund_case_official_action_authorizations
  add column if not exists nayax_execution_evidence_hash text check (
    nayax_execution_evidence_hash is null
    or nayax_execution_evidence_hash ~ '^[a-f0-9]{64}$'
  );

alter table public.refund_case_official_action_authorizations
  add constraint refund_case_official_action_nayax_evidence_valid check (
    (action = 'nayax_execute' and nayax_execution_evidence_hash is not null)
    or (action <> 'nayax_execute' and nayax_execution_evidence_hash is null)
  );

create unique index if not exists refund_case_official_action_step_up_intent_idx
  on public.refund_case_official_action_authorizations (step_up_intent_id)
  where step_up_intent_id is not null;

create or replace function public.enforce_refund_authorization_step_up_binding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.step_up_intent_id is null or new.verified_totp_at is null then
    raise exception 'Official action authorization requires a consumed human step-up intent';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_authorization_require_step_up
  on public.refund_case_official_action_authorizations;
create trigger refund_authorization_require_step_up
before insert on public.refund_case_official_action_authorizations
for each row execute function public.enforce_refund_authorization_step_up_binding();

-- Return the only unambiguous TOTP AMR timestamp that is strictly newer than
-- the intent's second. Supabase AMR timestamps have second resolution, so a
-- same-second verification is deliberately rejected rather than guessed.
create or replace function public.refund_verified_totp_after_intent(
  p_not_before timestamptz
)
returns timestamptz
language sql
stable
set search_path = public, auth
as $$
  with totp_entries as (
    select method
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) method
    where method ->> 'method' = 'totp'
  ),
  parsed as (
    select (method ->> 'timestamp')::numeric as verified_epoch
    from totp_entries
    where coalesce(method ->> 'timestamp', '') ~ '^[0-9]+([.][0-9]+)?$'
  ),
  summary as (
    select
      (select count(*) from totp_entries) as raw_count,
      count(*) as parsed_count,
      max(verified_epoch) as newest_epoch,
      count(*) filter (
        where verified_epoch = (select max(inner_parsed.verified_epoch) from parsed inner_parsed)
      ) as newest_count
    from parsed
  )
  select case
    when auth.role() <> 'authenticated'
      or auth.jwt() ->> 'aal' <> 'aal2'
      or p_not_before is null
      or summary.raw_count = 0
      or summary.raw_count <> summary.parsed_count
      or summary.newest_count <> 1
      or summary.newest_epoch <= extract(epoch from date_trunc('second', p_not_before))
      or summary.newest_epoch > extract(epoch from statement_timestamp() + interval '30 seconds')
      then null
    else to_timestamp(summary.newest_epoch::double precision)
  end
  from summary;
$$;

-- Freeze the persisted transaction match and the machine/provider controls
-- that the Nayax endpoint will use. The digest is stored on the intent and is
-- recomputed from locked rows at consumption, so a configuration or evidence
-- swap always requires a new human review and TOTP proof.
create or replace function public.refund_nayax_execution_evidence_hash(
  p_case public.refund_cases,
  p_machine public.reporting_machines
)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select encode(
    extensions.digest(
      jsonb_build_array(
        'refund_nayax_execution_evidence_v1',
        p_case.id,
        p_case.official_action_version,
        p_case.reporting_machine_id,
        p_case.status,
        p_case.decision,
        p_case.payment_method,
        p_case.incident_at,
        p_case.incident_local_datetime,
        p_case.card_last4,
        p_case.payment_amount_cents,
        p_case.refund_amount_cents,
        p_case.card_wallet_used,
        p_case.correlation_status,
        p_case.correlation_source,
        p_case.nayax_recommendation_state,
        p_case.nayax_recommendation_policy_version,
        p_case.nayax_recommendation_evaluated_at,
        p_case.nayax_match_execution_eligible,
        p_case.matched_nayax_transaction_id,
        p_case.matched_nayax_site_id,
        p_case.matched_nayax_machine_auth_time,
        p_case.matched_nayax_amount_cents,
        p_case.matched_nayax_card_last4,
        p_case.matched_nayax_currency_code,
        p_case.reporting_adjustment_id,
        p_case.nayax_refund_execution_status,
        p_machine.id,
        p_machine.status,
        p_machine.nayax_machine_id,
        p_machine.nayax_account_key,
        p_machine.nayax_refunds_enabled,
        p_machine.nayax_refund_max_amount_cents
      )::text,
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.refund_validate_official_action_context(
  p_actor_user_id uuid,
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
set search_path = public
as $$
declare
  refund_case public.refund_cases%rowtype;
  manager_mapping public.reporting_machine_refund_managers%rowtype;
  nayax_candidate public.refund_nayax_lookup_candidates%rowtype;
  nayax_machine public.reporting_machines%rowtype;
  normalized_action text := lower(btrim(coalesce(p_action, '')));
  normalized_status text := lower(btrim(coalesce(p_target_status, '')));
  normalized_decision text := lower(btrim(coalesce(p_target_decision, '')));
  candidate_evidence_hash text;
  nayax_execution_evidence_hash text;
  context_hash text;
begin
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

  if not public.can_perform_refund_official_action(p_actor_user_id, refund_case.id) then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;

  if refund_case.official_action_version is distinct from p_expected_case_version then
    raise exception 'Refund case changed since review; reload before taking an official action';
  end if;

  if normalized_action = 'cash_complete' and refund_case.payment_method <> 'cash' then
    raise exception 'Cash completion is available only for cash refund cases';
  end if;

  if normalized_action = 'approve' then
    if refund_case.payment_method = 'card' and normalized_status <> 'card_refund_pending' then
      raise exception 'Card approval must enter the card refund pending state';
    elsif refund_case.payment_method = 'cash' and normalized_status <> 'cash_zelle_pending' then
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
    and manager.manager_user_id = p_actor_user_id
    and manager.status = 'active'
    and manager.revoked_at is null
  for share;

  if not found then
    raise exception 'Active Machine Manager mapping required; admin identities are review-only';
  end if;

  if normalized_action = 'nayax_execute' then
    select machine.*
    into nayax_machine
    from public.reporting_machines machine
    where machine.id = refund_case.reporting_machine_id
    for share;

    if not found then
      raise exception 'Nayax machine configuration is unavailable';
    end if;

    if not public.can_prepare_nayax_refund_execution(p_actor_user_id, refund_case.id) then
      raise exception 'Nayax refund preparation is no longer safe for this case';
    end if;

    nayax_execution_evidence_hash := public.refund_nayax_execution_evidence_hash(
      refund_case,
      nayax_machine
    );
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
      and candidate.actor_user_id = p_actor_user_id
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

  return jsonb_build_object(
    'refundCaseId', refund_case.id,
    'action', normalized_action,
    'expectedCaseVersion', refund_case.official_action_version,
    'mappingId', manager_mapping.id,
    'mappingVersion', manager_mapping.mapping_version,
    'candidateEvidenceHash', candidate_evidence_hash,
    'nayaxExecutionEvidenceHash', nayax_execution_evidence_hash,
    'contextHash', context_hash
  );
end;
$$;

create or replace function public.admin_prepare_refund_action_step_up_intent(
  p_case_id uuid,
  p_action text,
  p_target_function text,
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
  normalized_target text := lower(btrim(coalesce(p_target_function, '')));
  context jsonb;
  manager_totp_enrollment public.refund_manager_totp_enrollments%rowtype;
  intent public.refund_manager_action_step_up_intents%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or authenticated_actor_user_id is null then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  if not public.refund_official_actions_enabled() then
    raise exception 'Official refund actions are disabled pending owner approval and controlled UAT';
  end if;

  if normalized_target not in ('refund-case-admin-update', 'nayax-card-refund') then
    raise exception 'Official action target is invalid';
  end if;

  if (lower(btrim(coalesce(p_action, ''))) = 'nayax_execute')
      is distinct from (normalized_target = 'nayax-card-refund') then
    raise exception 'Official action does not match the approved target function';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(authenticated_actor_user_id::text, 692));

  context := public.refund_validate_official_action_context(
    authenticated_actor_user_id,
    p_case_id,
    p_action,
    p_expected_case_version,
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

  select enrollment.*
  into manager_totp_enrollment
  from public.refund_manager_totp_enrollments enrollment
  where enrollment.actor_user_id = authenticated_actor_user_id
    and enrollment.status = 'active'
    and enrollment.revoked_at is null
  for share;

  if not found then
    raise exception 'Owner-approved refund authenticator enrollment is required';
  end if;

  update public.refund_manager_action_step_up_intents existing
  set
    status = case when existing.expires_at <= statement_timestamp() then 'expired' else 'superseded' end,
    factor_verified_at = null,
    factor_verification_proof_hash = null
  where existing.actor_user_id = authenticated_actor_user_id
    and existing.status = 'pending';

  insert into public.refund_manager_action_step_up_intents (
    actor_user_id,
    refund_case_id,
    action,
    target_function,
    manager_mapping_id,
    manager_mapping_version,
    manager_totp_enrollment_version,
    expected_case_version,
    action_context_hash,
    candidate_evidence_hash,
    nayax_execution_evidence_hash,
    not_before,
    expires_at
  )
  values (
    authenticated_actor_user_id,
    (context ->> 'refundCaseId')::uuid,
    context ->> 'action',
    normalized_target,
    (context ->> 'mappingId')::uuid,
    (context ->> 'mappingVersion')::bigint,
    manager_totp_enrollment.enrollment_version,
    (context ->> 'expectedCaseVersion')::bigint,
    context ->> 'contextHash',
    context ->> 'candidateEvidenceHash',
    context ->> 'nayaxExecutionEvidenceHash',
    statement_timestamp(),
    statement_timestamp() + interval '2 minutes'
  )
  returning * into intent;

  insert into public.refund_manager_step_up_audit (
    actor_user_id,
    refund_case_id,
    intent_id,
    action,
    event_type
  ) values (
    authenticated_actor_user_id,
    intent.refund_case_id,
    intent.id,
    intent.action,
    'intent_created'
  );

  return jsonb_build_object(
    'intentId', intent.id,
    'action', intent.action,
    'targetFunction', intent.target_function,
    'expiresAt', intent.expires_at
  );
end;
$$;

create or replace function public.admin_get_refund_action_step_up_intent(
  p_intent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  authenticated_actor_user_id uuid := auth.uid();
  intent public.refund_manager_action_step_up_intents%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or authenticated_actor_user_id is null then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  select existing.*
  into intent
  from public.refund_manager_action_step_up_intents existing
  where existing.id = p_intent_id
    and existing.actor_user_id = authenticated_actor_user_id;

  if not found or intent.status <> 'pending' or intent.expires_at <= statement_timestamp() then
    raise exception 'Manager verification request expired; review the action again';
  end if;

  return jsonb_build_object(
    'intentId', intent.id,
    'action', intent.action,
    'targetFunction', intent.target_function,
    'expiresAt', intent.expires_at
  );
end;
$$;

create or replace function public.admin_cancel_refund_action_step_up_intent(
  p_intent_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  authenticated_actor_user_id uuid := auth.uid();
  intent public.refund_manager_action_step_up_intents%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or authenticated_actor_user_id is null then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(authenticated_actor_user_id::text, 692));

  update public.refund_manager_action_step_up_intents existing
  set
    status = 'cancelled',
    cancelled_at = statement_timestamp(),
    factor_verified_at = null,
    factor_verification_proof_hash = null
  where existing.id = p_intent_id
    and existing.actor_user_id = authenticated_actor_user_id
    and existing.status = 'pending'
  returning * into intent;

  if not found then
    return jsonb_build_object('cancelled', false);
  end if;

  insert into public.refund_manager_step_up_audit (
    actor_user_id,
    refund_case_id,
    intent_id,
    action,
    event_type
  ) values (
    authenticated_actor_user_id,
    intent.refund_case_id,
    intent.id,
    intent.action,
    'intent_cancelled'
  );

  return jsonb_build_object('cancelled', true);
end;
$$;

create or replace function public.admin_consume_refund_action_step_up_intent(
  p_intent_id uuid,
  p_case_id uuid,
  p_action text,
  p_target_function text,
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
  p_nayax_disagreement_reason text default null,
  p_factor_verification_proof text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  authenticated_actor_user_id uuid := auth.uid();
  normalized_target text := lower(btrim(coalesce(p_target_function, '')));
  intent public.refund_manager_action_step_up_intents%rowtype;
  manager_totp_enrollment public.refund_manager_totp_enrollments%rowtype;
  context jsonb;
  verified_at_value timestamptz;
  authorization_row public.refund_case_official_action_authorizations%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or authenticated_actor_user_id is null then
    raise exception 'Authenticated Machine Manager session required';
  end if;

  if not public.refund_official_actions_enabled() then
    raise exception 'Official refund actions are disabled pending owner approval and controlled UAT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(authenticated_actor_user_id::text, 692));

  select existing.*
  into intent
  from public.refund_manager_action_step_up_intents existing
  where existing.id = p_intent_id
  for update;

  if not found
    or intent.actor_user_id is distinct from authenticated_actor_user_id
    or intent.status <> 'pending' then
    raise exception 'Manager verification request is invalid or already used';
  end if;

  if intent.expires_at <= statement_timestamp() then
    update public.refund_manager_action_step_up_intents
    set
      status = 'expired',
      factor_verified_at = null,
      factor_verification_proof_hash = null
    where id = intent.id;
    raise exception 'Manager verification request expired; review the action again';
  end if;

  select enrollment.*
  into manager_totp_enrollment
  from public.refund_manager_totp_enrollments enrollment
  where enrollment.actor_user_id = authenticated_actor_user_id
    and enrollment.status = 'active'
    and enrollment.revoked_at is null
  for update;

  if not found
    or manager_totp_enrollment.enrollment_version
      is distinct from intent.manager_totp_enrollment_version then
    raise exception 'Owner-approved refund authenticator enrollment changed; review with the owner';
  end if;

  verified_at_value := public.refund_verified_totp_after_intent(intent.not_before);
  if verified_at_value is null then
    raise exception 'A new authenticator code entered after reviewing this action is required';
  end if;

  if exists (
    select 1
    from public.refund_manager_action_step_up_intents used_intent
    where used_intent.actor_user_id = authenticated_actor_user_id
      and used_intent.status = 'consumed'
      and used_intent.verified_totp_at = verified_at_value
  ) then
    raise exception 'This authenticator verification already authorized a different official action';
  end if;

  context := public.refund_validate_official_action_context(
    authenticated_actor_user_id,
    p_case_id,
    p_action,
    p_expected_case_version,
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

  if intent.refund_case_id is distinct from (context ->> 'refundCaseId')::uuid
    or intent.action is distinct from context ->> 'action'
    or intent.target_function is distinct from normalized_target
    or intent.manager_mapping_id is distinct from (context ->> 'mappingId')::uuid
    or intent.manager_mapping_version is distinct from (context ->> 'mappingVersion')::bigint
    or intent.expected_case_version is distinct from (context ->> 'expectedCaseVersion')::bigint
    or intent.action_context_hash is distinct from context ->> 'contextHash'
    or intent.candidate_evidence_hash is distinct from context ->> 'candidateEvidenceHash'
    or intent.nayax_execution_evidence_hash
      is distinct from context ->> 'nayaxExecutionEvidenceHash' then
    raise exception 'Reviewed official action changed; review it and verify again';
  end if;

  if not coalesce(p_factor_verification_proof ~ '^[a-f0-9]{64}$', false)
    or intent.factor_verified_at is null
    or intent.factor_verified_at < intent.not_before
    or intent.factor_verified_at > intent.expires_at
    or intent.factor_verification_proof_hash is distinct from encode(
      extensions.digest(
        convert_to(
          'bloomjoy-refund-manager-step-up-proof-v1:' || p_factor_verification_proof,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) then
    raise exception 'Exact owner-approved authenticator verification proof is required';
  end if;

  update public.refund_manager_action_step_up_intents
  set
    status = 'consumed',
    factor_verification_proof_hash = null,
    verified_totp_at = verified_at_value,
    consumed_at = statement_timestamp()
  where id = intent.id;

  update public.refund_manager_totp_enrollments
  set
    last_step_up_verified_at = verified_at_value,
    updated_at = statement_timestamp()
  where actor_user_id = authenticated_actor_user_id
    and enrollment_version = intent.manager_totp_enrollment_version
    and status = 'active';

  insert into public.refund_case_official_action_authorizations (
    refund_case_id,
    action,
    actor_user_id,
    manager_mapping_id,
    manager_mapping_version,
    expected_case_version,
    action_context_hash,
    status,
    expires_at,
    step_up_intent_id,
    verified_totp_at,
    nayax_execution_evidence_hash
  ) values (
    intent.refund_case_id,
    intent.action,
    authenticated_actor_user_id,
    intent.manager_mapping_id,
    intent.manager_mapping_version,
    intent.expected_case_version,
    intent.action_context_hash,
    'authorized',
    least(intent.expires_at, statement_timestamp() + interval '30 seconds'),
    intent.id,
    verified_at_value,
    intent.nayax_execution_evidence_hash
  )
  returning * into authorization_row;

  insert into public.refund_manager_step_up_audit (
    actor_user_id,
    refund_case_id,
    intent_id,
    action,
    event_type,
    verified_totp_at
  ) values (
    authenticated_actor_user_id,
    intent.refund_case_id,
    intent.id,
    intent.action,
    'intent_consumed',
    verified_at_value
  );

  return jsonb_build_object(
    'authorizationId', authorization_row.id,
    'action', authorization_row.action,
    'expectedCaseVersion', authorization_row.expected_case_version,
    'mappingVersion', authorization_row.manager_mapping_version,
    'expiresAt', authorization_row.expires_at
  );
end;
$$;

create or replace function public.admin_refund_manager_step_up_factor_is_approved(
  p_intent_id uuid,
  p_factor_binding_hash text
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.role() = 'authenticated'
    and auth.uid() is not null
    and coalesce(p_factor_binding_hash ~ '^[a-f0-9]{64}$', false)
    and public.user_is_active_refund_manager_only(auth.uid())
    and exists (
      select 1
      from public.refund_manager_action_step_up_intents intent
      join public.refund_manager_totp_enrollments enrollment
        on enrollment.actor_user_id = intent.actor_user_id
       and enrollment.enrollment_version = intent.manager_totp_enrollment_version
      where intent.id = p_intent_id
        and intent.actor_user_id = auth.uid()
        and intent.status = 'pending'
        and intent.expires_at > statement_timestamp()
        and enrollment.status = 'active'
        and enrollment.revoked_at is null
        and enrollment.approved_factor_binding_hash = p_factor_binding_hash
    );
$$;

-- The trusted step-up Edge Function calls this only after Auth accepts a new
-- challenge from the exact owner-approved factor. The raw random proof is
-- returned once to that Edge Function and forwarded only on its internal
-- request to the frozen target. Browsers can call target functions directly,
-- but cannot mint or read this proof; the database stores only its digest.
create or replace function public.service_mark_refund_manager_step_up_factor_verified(
  p_actor_user_id uuid,
  p_intent_id uuid,
  p_factor_binding_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  intent public.refund_manager_action_step_up_intents%rowtype;
  manager_totp_enrollment public.refund_manager_totp_enrollments%rowtype;
  verification_proof text;
  marked_at timestamptz := statement_timestamp();
begin
  if auth.role() is distinct from 'service_role'
    or p_actor_user_id is null
    or p_intent_id is null
    or not coalesce(p_factor_binding_hash ~ '^[a-f0-9]{64}$', false) then
    raise exception 'Refund authenticator verification marker is not authorized';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 692));

  select existing.*
  into intent
  from public.refund_manager_action_step_up_intents existing
  where existing.id = p_intent_id
  for update;

  if not found
    or intent.actor_user_id is distinct from p_actor_user_id
    or intent.status <> 'pending'
    or intent.expires_at <= marked_at then
    raise exception 'Manager verification request is invalid or expired';
  end if;

  select enrollment.*
  into manager_totp_enrollment
  from public.refund_manager_totp_enrollments enrollment
  where enrollment.actor_user_id = p_actor_user_id
    and enrollment.status = 'active'
    and enrollment.revoked_at is null
  for update;

  if not found
    or manager_totp_enrollment.enrollment_version
      is distinct from intent.manager_totp_enrollment_version
    or manager_totp_enrollment.approved_factor_binding_hash
      is distinct from p_factor_binding_hash
    or not public.user_is_active_refund_manager_only(p_actor_user_id) then
    raise exception 'Owner-approved refund authenticator enrollment changed; review with the owner';
  end if;

  verification_proof := encode(extensions.gen_random_bytes(32), 'hex');

  update public.refund_manager_action_step_up_intents
  set
    factor_verified_at = marked_at,
    factor_verification_proof_hash = encode(
      extensions.digest(
        convert_to(
          'bloomjoy-refund-manager-step-up-proof-v1:' || verification_proof,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  where id = intent.id;

  return jsonb_build_object(
    'factorVerificationProof', verification_proof,
    'expiresAt', intent.expires_at
  );
end;
$$;

-- Only the trusted enrollment Edge Function can convert an owner-targeted,
-- unexpired enrollment window into an active refund-specific factor binding.
-- State and sanitized audit evidence commit atomically, and the one-manager
-- window closes on success so it cannot be reused for another factor.
create or replace function public.service_record_refund_manager_totp_enrollment(
  p_actor_user_id uuid,
  p_factor_binding_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  enrollment_config public.refund_manager_security_config%rowtype;
  manager_totp_enrollment public.refund_manager_totp_enrollments%rowtype;
begin
  if auth.role() is distinct from 'service_role'
    or p_actor_user_id is null
    or not coalesce(p_factor_binding_hash ~ '^[a-f0-9]{64}$', false) then
    raise exception 'Supervised Machine Manager authenticator enrollment is not authorized';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 692));

  select config.*
  into enrollment_config
  from public.refund_manager_security_config config
  where config.singleton = true
  for update;

  if not found
    or enrollment_config.totp_enrollment_enabled is distinct from true
    or enrollment_config.totp_enrollment_approved_manager_user_id is distinct from p_actor_user_id
    or enrollment_config.totp_enrollment_approved_by_owner_user_id is null
    or enrollment_config.totp_enrollment_approval_expires_at <= statement_timestamp()
    or enrollment_config.totp_enrollment_approval_version <= 0
    or not public.user_is_active_refund_manager_only(p_actor_user_id) then
    raise exception 'Supervised Machine Manager authenticator enrollment is not authorized';
  end if;

  insert into public.refund_manager_totp_enrollments as existing_enrollment (
    actor_user_id,
    approved_factor_binding_hash,
    owner_approved_by_user_id,
    owner_approval_version,
    enrollment_version,
    status,
    approved_at,
    last_step_up_verified_at,
    revoked_at,
    updated_at
  ) values (
    p_actor_user_id,
    p_factor_binding_hash,
    enrollment_config.totp_enrollment_approved_by_owner_user_id,
    enrollment_config.totp_enrollment_approval_version,
    1,
    'active',
    statement_timestamp(),
    null,
    null,
    statement_timestamp()
  )
  on conflict (actor_user_id) do update
  set
    approved_factor_binding_hash = excluded.approved_factor_binding_hash,
    owner_approved_by_user_id = excluded.owner_approved_by_user_id,
    owner_approval_version = excluded.owner_approval_version,
    enrollment_version = existing_enrollment.enrollment_version + 1,
    status = 'active',
    approved_at = statement_timestamp(),
    last_step_up_verified_at = null,
    revoked_at = null,
    updated_at = statement_timestamp()
  returning * into manager_totp_enrollment;

  insert into public.refund_manager_step_up_audit (
    actor_user_id,
    event_type,
    verified_totp_at
  ) values (
    p_actor_user_id,
    'totp_enrollment_verified',
    statement_timestamp()
  );

  update public.refund_manager_security_config
  set
    totp_enrollment_enabled = false,
    totp_enrollment_approved_manager_user_id = null,
    totp_enrollment_approved_by_owner_user_id = null,
    totp_enrollment_approval_expires_at = null,
    updated_at = statement_timestamp()
  where singleton = true;

  return jsonb_build_object(
    'recorded', true,
    'enrollmentVersion', manager_totp_enrollment.enrollment_version
  );
end;
$$;

-- If Auth enrollment succeeded but the Edge Function did not receive a
-- trustworthy state/audit result, invalidate any matching durable approval.
-- Deleting the Auth factor is attempted separately by the Edge Function.
create or replace function public.service_compensate_refund_manager_totp_enrollment(
  p_actor_user_id uuid,
  p_factor_binding_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  compensated_enrollment public.refund_manager_totp_enrollments%rowtype;
begin
  if auth.role() is distinct from 'service_role'
    or p_actor_user_id is null
    or not coalesce(p_factor_binding_hash ~ '^[a-f0-9]{64}$', false) then
    raise exception 'Refund authenticator compensation is not authorized';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 692));

  update public.refund_manager_totp_enrollments enrollment
  set
    status = 'revoked',
    enrollment_version = enrollment.enrollment_version + 1,
    revoked_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where enrollment.actor_user_id = p_actor_user_id
    and enrollment.status = 'active'
    and enrollment.approved_factor_binding_hash = p_factor_binding_hash
  returning * into compensated_enrollment;

  if not found then
    return jsonb_build_object('compensated', false);
  end if;

  update public.refund_manager_action_step_up_intents intent
  set
    status = 'cancelled',
    cancelled_at = statement_timestamp(),
    factor_verified_at = null,
    factor_verification_proof_hash = null
  where intent.actor_user_id = p_actor_user_id
    and intent.status = 'pending';

  insert into public.refund_manager_step_up_audit (
    actor_user_id,
    event_type
  ) values (
    p_actor_user_id,
    'totp_enrollment_compensated'
  );

  return jsonb_build_object('compensated', true);
end;
$$;

-- Carry the frozen Nayax evidence through the short-lived authorization and
-- compare it again inside the service-consumption transaction. A valid-to-
-- valid provider configuration change (for example, changing account keys)
-- therefore cannot redirect an already verified refund.
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
  authorization_row public.refund_case_official_action_authorizations%rowtype;
  refund_case public.refund_cases%rowtype;
  nayax_machine public.reporting_machines%rowtype;
  actor_user_id uuid;
  current_execution_evidence_hash text;
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

  select action_authorization.*
  into authorization_row
  from public.refund_case_official_action_authorizations action_authorization
  where action_authorization.id = p_authorization_id
  for update;

  select case_row.*
  into refund_case
  from public.refund_cases case_row
  where case_row.id = p_case_id
  for update;

  select machine.*
  into nayax_machine
  from public.reporting_machines machine
  where machine.id = refund_case.reporting_machine_id
  for share;

  if not found then
    raise exception 'Nayax machine configuration changed after manager verification';
  end if;

  current_execution_evidence_hash := public.refund_nayax_execution_evidence_hash(
    refund_case,
    nayax_machine
  );

  if authorization_row.nayax_execution_evidence_hash is distinct from
      current_execution_evidence_hash then
    raise exception 'Nayax execution evidence changed after manager verification; review and verify again';
  end if;

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
    'Mapped Machine Manager authority and frozen execution evidence were revalidated immediately before Nayax preparation.',
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

-- The #689 authorizer can no longer mint a receipt from a merely recent AAL2
-- session. Only the exact intent consumer above can mint a usable receipt.
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
begin
  raise exception 'Action-bound manager step-up intent required for every official refund action';
end;
$$;

revoke execute on function public.refund_manager_totp_enrollment_window_enabled()
  from public, anon, authenticated, service_role;
revoke execute on function public.user_is_active_refund_manager_only(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_verified_totp_after_intent(timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.refund_nayax_execution_evidence_hash(
  public.refund_cases, public.reporting_machines
) from public, anon, authenticated, service_role;
revoke execute on function public.refund_validate_official_action_context(
  uuid, uuid, text, bigint, text, text, text, text, text, integer, text,
  timestamptz, boolean, uuid, text
) from public, anon, authenticated, service_role;
revoke execute on function public.enforce_refund_authorization_step_up_binding()
  from public, anon, authenticated, service_role;

revoke execute on function public.can_enroll_refund_manager_totp_current_user()
  from public, anon, service_role;
grant execute on function public.can_enroll_refund_manager_totp_current_user()
  to authenticated;

revoke execute on function public.admin_prepare_refund_action_step_up_intent(
  uuid, text, text, bigint, text, text, text, text, text, integer, text,
  timestamptz, boolean, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_prepare_refund_action_step_up_intent(
  uuid, text, text, bigint, text, text, text, text, text, integer, text,
  timestamptz, boolean, uuid, text
) to authenticated;

revoke execute on function public.admin_get_refund_action_step_up_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_refund_action_step_up_intent(uuid)
  to authenticated;

revoke execute on function public.admin_cancel_refund_action_step_up_intent(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_cancel_refund_action_step_up_intent(uuid)
  to authenticated;

revoke execute on function public.admin_refund_manager_step_up_factor_is_approved(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_refund_manager_step_up_factor_is_approved(uuid, text)
  to authenticated;

revoke execute on function public.admin_consume_refund_action_step_up_intent(
  uuid, uuid, text, text, bigint, text, text, text, text, text, integer, text,
  timestamptz, boolean, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_consume_refund_action_step_up_intent(
  uuid, uuid, text, text, bigint, text, text, text, text, text, integer, text,
  timestamptz, boolean, uuid, text, text
) to authenticated;

revoke execute on function public.service_mark_refund_manager_step_up_factor_verified(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_mark_refund_manager_step_up_factor_verified(
  uuid, uuid, text
) to service_role;

revoke execute on function public.service_record_refund_manager_totp_enrollment(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_record_refund_manager_totp_enrollment(uuid, text)
  to service_role;

revoke execute on function public.service_compensate_refund_manager_totp_enrollment(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_compensate_refund_manager_totp_enrollment(uuid, text)
  to service_role;

revoke execute on function public.service_consume_nayax_refund_official_action(
  uuid, uuid, text, text, integer, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.service_consume_nayax_refund_official_action(
  uuid, uuid, text, text, integer, uuid
) to service_role;

comment on table public.refund_manager_security_config is
  'Owner-targeted refund security approvals. Defaults closed; no authenticated or service setter can open an enrollment window.';
comment on table public.refund_manager_totp_enrollments is
  'Private durable owner approvals for refund-specific Auth TOTP factor bindings. Stores only purpose-bound one-way hashes, never raw factor identifiers.';
comment on table public.refund_manager_action_step_up_intents is
  'Two-minute, single-use human TOTP intents bound to one owner-approved enrollment, one exact official refund action, and one internal factor-verification proof.';
comment on table public.refund_manager_step_up_audit is
  'Sanitized manager step-up evidence. Never stores codes, factor identifiers, secrets, QR material, JWTs, customer text, payment payloads, or recipient addresses.';
comment on function public.admin_consume_refund_action_step_up_intent(
  uuid, uuid, text, text, bigint, text, text, text, text, text, integer, text,
  timestamptz, boolean, uuid, text, text
) is
  'Atomically consumes one exact intent only when the owner-approved enrollment remains active, a trusted Edge flow supplied its one-use opaque proof, and the caller JWT contains an unambiguous TOTP AMR strictly newer than the intent.';
