-- Secure, bounded correction flow for tokenized wallet card details.
--
-- The public link contains only a high-entropy bearer token. The database
-- stores its SHA-256 hash, locks the machine/QR evidence, and permits one
-- customer correction submission before the token is consumed.

alter table public.public_intake_rate_limit_events
  drop constraint if exists public_intake_rate_limit_events_scope_check;

alter table public.public_intake_rate_limit_events
  add constraint public_intake_rate_limit_events_scope_check
  check (
    event_scope in (
      'submission',
      'notification',
      'refund_qr_claim',
      'refund_wallet_correction'
    )
  );

create or replace function public.record_public_intake_rate_limit_event(
  p_event_scope text,
  p_key_type text,
  p_key_hash text,
  p_window_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_window_started_at timestamptz;
  v_event_count integer;
begin
  if p_event_scope not in (
    'submission',
    'notification',
    'refund_qr_claim',
    'refund_wallet_correction'
  ) then
    raise exception 'Unsupported public intake event scope.';
  end if;

  if p_key_type not in ('ip', 'email', 'source', 'global') then
    raise exception 'Unsupported public intake key type.';
  end if;

  if p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid public intake key hash.';
  end if;

  if p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid public intake rate-limit window.';
  end if;

  v_window_started_at :=
    to_timestamp(
      floor(extract(epoch from v_now) / p_window_seconds)
      * p_window_seconds
    );

  insert into public.public_intake_rate_limit_events (
    event_scope,
    key_type,
    key_hash,
    window_started_at,
    window_seconds,
    event_count,
    created_at,
    updated_at
  )
  values (
    p_event_scope,
    p_key_type,
    p_key_hash,
    v_window_started_at,
    p_window_seconds,
    1,
    v_now,
    v_now
  )
  on conflict (
    event_scope,
    key_type,
    key_hash,
    window_started_at,
    window_seconds
  )
  do update
  set
    event_count =
      public.public_intake_rate_limit_events.event_count + 1,
    updated_at = excluded.updated_at
  returning event_count into v_event_count;

  delete from public.public_intake_rate_limit_events
  where updated_at < v_now - interval '2 days';

  return v_event_count;
end;
$$;

revoke all on function public.record_public_intake_rate_limit_event(
  text,
  text,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.record_public_intake_rate_limit_event(
  text,
  text,
  text,
  integer
) to service_role;

alter table public.refund_cases
  add column if not exists wallet_correction_state text not null default 'not_needed',
  add column if not exists wallet_correction_version integer not null default 0,
  add column if not exists wallet_correction_requested_at timestamptz,
  add column if not exists wallet_correction_received_at timestamptz;

alter table public.refund_cases
  drop constraint if exists refund_cases_wallet_correction_state_check,
  add constraint refund_cases_wallet_correction_state_check
  check (
    wallet_correction_state in (
      'not_needed',
      'needed',
      'sent',
      'received',
      'expired',
      'fallback_eligible'
    )
  ),
  drop constraint if exists refund_cases_wallet_correction_version_check,
  add constraint refund_cases_wallet_correction_version_check
  check (wallet_correction_version between 0 and 2);

alter table public.refund_cases
  drop constraint if exists refund_cases_automation_state_check;

alter table public.refund_cases
  add constraint refund_cases_automation_state_check
  check (automation_state in (
    'submitted',
    'under_review',
    'more_info_needed',
    'customer_replied',
    'wallet_correction_needed',
    'wallet_correction_sent',
    'wallet_correction_received',
    'fallback_eligible',
    'approved',
    'denied',
    'completed',
    'closed_incomplete',
    'escalated'
  ));

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_message_type_check;

alter table public.refund_case_messages
  add constraint refund_case_messages_message_type_check
  check (message_type in (
    'confirmation',
    'more_info',
    'reminder',
    'wallet_correction',
    'wallet_correction_reminder',
    'status_update',
    'approved',
    'denied',
    'completed',
    'escalation',
    'manual_note'
  ));

alter table public.refund_automation_actions
  drop constraint if exists refund_automation_actions_type_check;

alter table public.refund_automation_actions
  add constraint refund_automation_actions_type_check
  check (
    action_type in (
      'nayax_lookup',
      'customer_reminder',
      'customer_more_info',
      'wallet_correction_request',
      'wallet_correction_reminder',
      'internal_escalation',
      'ops_alert'
    )
  );

create or replace function public.service_claim_refund_automation_action(
  p_run_id uuid,
  p_refund_case_id uuid,
  p_action_key text,
  p_action_type text,
  p_case_state text default null,
  p_policy_window_start timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_action_key text;
  action_row public.refund_automation_actions;
  claimed boolean := false;
begin
  if not exists (
    select 1
    from public.refund_automation_runs automation_run
    where automation_run.id = p_run_id
      and automation_run.status = 'running'
  ) then
    raise exception 'An active refund automation run is required';
  end if;

  if p_refund_case_id is not null
    and not exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = p_refund_case_id
    ) then
    raise exception 'Refund case not found';
  end if;

  normalized_action_key := nullif(btrim(coalesce(p_action_key, '')), '');
  if normalized_action_key is null
    or length(normalized_action_key) not between 8 and 220
    or normalized_action_key !~ '^[A-Za-z0-9:._-]+$' then
    raise exception 'A safe refund automation action key is required';
  end if;

  if p_action_type not in (
    'nayax_lookup',
    'customer_reminder',
    'customer_more_info',
    'wallet_correction_request',
    'wallet_correction_reminder',
    'internal_escalation',
    'ops_alert'
  ) then
    raise exception 'Unsupported refund automation action type';
  end if;

  insert into public.refund_automation_actions (
    run_id,
    refund_case_id,
    action_key,
    action_type,
    case_state,
    policy_window_start,
    metadata
  )
  values (
    p_run_id,
    p_refund_case_id,
    normalized_action_key,
    p_action_type,
    nullif(btrim(coalesce(p_case_state, '')), ''),
    p_policy_window_start,
    jsonb_build_object('payload_redacted', true)
  )
  on conflict (action_key) do nothing
  returning * into action_row;

  if action_row.id is not null then
    claimed := true;
  else
    select *
    into action_row
    from public.refund_automation_actions
    where action_key = normalized_action_key;
  end if;

  return jsonb_build_object(
    'actionId', action_row.id,
    'claimed', claimed,
    'status', action_row.status,
    'reasonCategory', action_row.reason_category
  );
end;
$$;

revoke execute on function public.service_claim_refund_automation_action(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamp with time zone
) from public, anon, authenticated;

grant execute on function public.service_claim_refund_automation_action(
  uuid,
  uuid,
  text,
  text,
  text,
  timestamp with time zone
) to service_role;

create table if not exists public.refund_wallet_correction_contexts (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null
    references public.refund_cases (id) on delete cascade,
  token_hash text not null,
  version integer not null check (version between 1 and 2),
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'expired', 'revoked')),
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint refund_wallet_correction_contexts_token_hash_format
    check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint refund_wallet_correction_contexts_token_hash_unique
    unique (token_hash),
  constraint refund_wallet_correction_contexts_expiry_window
    check (
      expires_at > issued_at
      and expires_at <= issued_at + interval '49 hours'
    ),
  constraint refund_wallet_correction_contexts_state_consistent
    check (
      (status = 'pending' and consumed_at is null and revoked_at is null)
      or (status = 'submitted' and consumed_at is not null and revoked_at is null)
      or (status in ('expired', 'revoked') and consumed_at is null)
    )
);

create unique index if not exists refund_wallet_correction_one_pending_idx
  on public.refund_wallet_correction_contexts (refund_case_id)
  where status = 'pending';

create index if not exists refund_wallet_correction_expiry_idx
  on public.refund_wallet_correction_contexts (expires_at)
  where status = 'pending';

alter table public.refund_wallet_correction_contexts enable row level security;
revoke all on table public.refund_wallet_correction_contexts
  from public, anon, authenticated;
grant select, insert, update on table public.refund_wallet_correction_contexts
  to service_role;

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

  if case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.decision is not null then
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
begin
  update public.refund_wallet_correction_contexts
  set
    status = 'revoked',
    revoked_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where token_hash = p_token_hash
    and status = 'pending'
  returning * into context_row;

  if context_row.id is null then
    return false;
  end if;

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
  result jsonb;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('state', 'invalid');
  end if;

  select *
  into context_row
  from public.refund_wallet_correction_contexts
  where token_hash = p_token_hash;

  if context_row.id is null then
    return jsonb_build_object('state', 'invalid');
  end if;

  if context_row.status <> 'pending' then
    return jsonb_build_object('state', context_row.status);
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
    and refund_case.status not in ('approved', 'denied', 'completed', 'closed')
    and refund_case.decision is null;

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
    or case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.decision is not null then
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

revoke all on function public.service_issue_refund_wallet_correction(
  uuid,
  text,
  timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.service_cancel_refund_wallet_correction(text)
  from public, anon, authenticated;
revoke all on function public.service_get_refund_wallet_correction(text)
  from public, anon, authenticated;
revoke all on function public.service_apply_refund_wallet_correction(
  text,
  text,
  text,
  timestamp with time zone,
  text,
  boolean
) from public, anon, authenticated;

grant execute on function public.service_issue_refund_wallet_correction(
  uuid,
  text,
  timestamp with time zone
) to service_role;
grant execute on function public.service_cancel_refund_wallet_correction(text)
  to service_role;
grant execute on function public.service_get_refund_wallet_correction(text)
  to service_role;
grant execute on function public.service_apply_refund_wallet_correction(
  text,
  text,
  text,
  timestamp with time zone,
  text,
  boolean
) to service_role;

comment on table public.refund_wallet_correction_contexts is
  'Server-only, single-use wallet correction link contexts. Stores token hashes and workflow state only; never raw tokens or full payment credentials.';
comment on column public.refund_cases.wallet_correction_state is
  'Bounded customer wallet correction lifecycle; fallback_eligible means automated matching attempts are exhausted.';

select pg_notify('pgrst', 'reload schema');
