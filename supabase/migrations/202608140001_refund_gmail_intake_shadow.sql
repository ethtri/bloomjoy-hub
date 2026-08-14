-- #854: one owner-controlled Gmail intake-only shadow lane.
--
-- This migration adds durable provenance and idempotent audit state only. It
-- does not enable Gmail intake, delivery, schedules, customer contact, manager
-- notices, official actions, or Nayax execution.

alter table public.refund_gmail_sync_runs
  drop constraint if exists refund_gmail_sync_runs_trigger_source_check,
  add constraint refund_gmail_sync_runs_trigger_source_check check (
    trigger_source in ('scheduled', 'manual', 'failure_test', 'intake_shadow')
  );

create or replace function public.refund_gmail_workflow_run_key_is_valid(
  p_run_key text,
  p_trigger_source text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_trigger_source, '')))
    when 'scheduled' then btrim(coalesce(p_run_key, ''))
      ~ '^github-scheduled:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'
    when 'manual' then btrim(coalesce(p_run_key, ''))
      ~ '^github-manual:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'
    when 'failure_test' then btrim(coalesce(p_run_key, ''))
      ~ '^github-failure-test:[1-9][0-9]{0,19}:[1-9][0-9]{0,5}$'
    when 'intake_shadow' then btrim(coalesce(p_run_key, ''))
      ~ '^owner-intake-shadow:[a-f0-9]{64}$'
    else false
  end;
$$;

create table if not exists public.refund_gmail_intake_shadow_dispatch_authorizations (
  run_key_digest text primary key
    check (run_key_digest ~ '^[a-f0-9]{64}$'),
  owner_sender_digest text not null
    check (owner_sender_digest ~ '^[a-f0-9]{64}$'),
  start_at timestamptz not null,
  status text not null default 'armed'
    check (status in ('armed', 'consumed', 'cancelled')),
  expires_at timestamptz not null,
  consumed_run_id uuid unique
    references public.refund_gmail_sync_runs (id) on delete restrict,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  cancelled_at timestamptz,
  constraint refund_gmail_intake_shadow_dispatch_state_check check (
    (status = 'armed' and consumed_run_id is null and consumed_at is null and cancelled_at is null)
    or (status = 'consumed' and consumed_run_id is not null and consumed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and consumed_run_id is null and consumed_at is null and cancelled_at is not null)
  )
);

alter table public.refund_gmail_intake_shadow_dispatch_authorizations
  enable row level security;
revoke all on table public.refund_gmail_intake_shadow_dispatch_authorizations
  from public, anon, authenticated, service_role;

create unique index if not exists refund_gmail_intake_shadow_one_armed_dispatch_idx
  on public.refund_gmail_intake_shadow_dispatch_authorizations (status)
  where status = 'armed';

create table if not exists public.refund_gmail_intake_shadow_dispatch_control (
  singleton boolean primary key default true check (singleton),
  last_recovery_at timestamptz not null default '-infinity'::timestamptz
);
insert into public.refund_gmail_intake_shadow_dispatch_control (singleton)
values (true)
on conflict (singleton) do nothing;
alter table public.refund_gmail_intake_shadow_dispatch_control enable row level security;
revoke all on table public.refund_gmail_intake_shadow_dispatch_control
  from public, anon, authenticated, service_role;

alter table public.refund_gmail_intake_shadow_dispatch_authorizations
  add constraint refund_gmail_intake_shadow_dispatch_owner_digest_check check (
    owner_sender_digest ~ '^[a-f0-9]{64}$'
    and (owner_sender_digest <> repeat('0', 64) or status = 'cancelled')
  );

create or replace function public.owner_authorize_refund_gmail_intake_shadow_dispatch(
  p_run_key_digest text,
  p_owner_sender_digest text,
  p_start_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_digest text := lower(btrim(coalesce(p_run_key_digest, '')));
  normalized_owner_digest text := lower(btrim(coalesce(p_owner_sender_digest, '')));
  authorization_requested_at timestamptz := clock_timestamp();
  authorization_clock timestamptz;
  last_recovery_at_value timestamptz;
begin
  if normalized_digest !~ '^[a-f0-9]{64}$'
    or normalized_owner_digest !~ '^[a-f0-9]{64}$'
    or normalized_owner_digest = repeat('0', 64) then
    raise exception 'Exact fresh intake-shadow dispatch authorization required';
  end if;

  -- Serialize the global one-thread lane before checking the active state.
  -- The transaction-scoped lock is released automatically on commit/rollback,
  -- and the partial unique index is a second database invariant against more
  -- than one armed authorization.
  perform pg_advisory_xact_lock(
    hashtextextended('refund-gmail-intake-shadow-dispatch-authorize', 854)
  );
  authorization_clock := clock_timestamp();
  select control.last_recovery_at into last_recovery_at_value
  from public.refund_gmail_intake_shadow_dispatch_control control
  where control.singleton
  for update;
  if authorization_requested_at <= last_recovery_at_value
    or p_start_at is null
    or p_start_at < authorization_clock - interval '15 minutes'
    or p_start_at > authorization_clock + interval '30 seconds' then
    raise exception 'Exact fresh intake-shadow dispatch authorization required';
  end if;
  if exists (
    select 1
    from public.refund_gmail_intake_shadow_dispatch_authorizations dispatch
    where dispatch.run_key_digest = normalized_digest
  ) then
    raise exception 'Exact intake-shadow dispatch was already closed or used';
  end if;
  if exists (
    select 1
    from public.refund_gmail_intake_shadow_dispatch_authorizations dispatch
    left join public.refund_gmail_sync_runs run
      on run.id = dispatch.consumed_run_id
    where dispatch.status = 'armed'
       or (
         dispatch.status = 'consumed'
         and run.trigger_source = 'intake_shadow'
         and run.status = 'running'
       )
  ) then
    raise exception 'Another intake-shadow dispatch is active';
  end if;

  insert into public.refund_gmail_intake_shadow_dispatch_authorizations (
    run_key_digest, owner_sender_digest, start_at, status, expires_at
  ) values (
    normalized_digest, normalized_owner_digest, p_start_at,
    'armed', authorization_clock + interval '10 minutes'
  );
  return jsonb_build_object(
    'authorized', true,
    'status', 'armed',
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.owner_cancel_refund_gmail_intake_shadow_dispatch(
  p_run_key_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_digest text := lower(btrim(coalesce(p_run_key_digest, '')));
  authorization_row public.refund_gmail_intake_shadow_dispatch_authorizations;
begin
  if normalized_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Exact intake-shadow run digest required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('refund-gmail-intake-shadow-dispatch-authorize', 854)
  );
  select * into authorization_row
  from public.refund_gmail_intake_shadow_dispatch_authorizations dispatch
  where dispatch.run_key_digest = normalized_digest
  for update;
  if authorization_row.run_key_digest is null then
    insert into public.refund_gmail_intake_shadow_dispatch_authorizations (
      run_key_digest, owner_sender_digest, start_at, status, expires_at,
      cancelled_at
    ) values (
      normalized_digest, repeat('0', 64), statement_timestamp(), 'cancelled',
      statement_timestamp(), statement_timestamp()
    )
    returning * into authorization_row;
  end if;
  if authorization_row.status = 'armed' then
    update public.refund_gmail_intake_shadow_dispatch_authorizations
    set status = 'cancelled', cancelled_at = statement_timestamp()
    where run_key_digest = normalized_digest;
    authorization_row.status := 'cancelled';
  end if;
  return jsonb_build_object(
    'closed', authorization_row.status in ('cancelled', 'consumed'),
    'status', authorization_row.status,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.owner_recover_expired_refund_gmail_intake_shadow_dispatches()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recovered_expired_count integer := 0;
  armed_authorization_count integer := 0;
  consumed_running_count integer := 0;
begin
  -- This no-target hard-stop recovery uses the same global lane lock as
  -- authorization. It cannot race a new owner arm and returns no digest.
  perform pg_advisory_xact_lock(
    hashtextextended('refund-gmail-intake-shadow-dispatch-authorize', 854)
  );

  update public.refund_gmail_intake_shadow_dispatch_control
  set last_recovery_at = clock_timestamp()
  where singleton;

  update public.refund_gmail_intake_shadow_dispatch_authorizations
  set status = 'cancelled', cancelled_at = clock_timestamp()
  where status = 'armed'
    and expires_at <= clock_timestamp();
  get diagnostics recovered_expired_count = row_count;

  select count(*)::integer into armed_authorization_count
  from public.refund_gmail_intake_shadow_dispatch_authorizations dispatch
  where dispatch.status = 'armed';

  select count(*)::integer into consumed_running_count
  from public.refund_gmail_intake_shadow_dispatch_authorizations dispatch
  join public.refund_gmail_sync_runs run
    on run.id = dispatch.consumed_run_id
  where dispatch.status = 'consumed'
    and run.trigger_source = 'intake_shadow'
    and run.status = 'running';

  return jsonb_build_object(
    'recoveredExpiredCount', recovered_expired_count,
    'armedAuthorizationCount', armed_authorization_count,
    'consumedRunningCount', consumed_running_count,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_start_refund_gmail_sync(
  p_run_key text,
  p_trigger_source text,
  p_started_at timestamptz,
  p_mailbox_hash text,
  p_label_hash text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.refund_gmail_sync_runs;
  state_row public.refund_gmail_sync_state;
  dispatch_authorization public.refund_gmail_intake_shadow_dispatch_authorizations;
  normalized_run_key text := btrim(coalesce(p_run_key, ''));
  normalized_trigger text := lower(btrim(coalesce(p_trigger_source, '')));
  normalized_run_key_digest text;
begin
  if not public.refund_gmail_workflow_run_key_is_valid(
    normalized_run_key,
    normalized_trigger
  ) then
    raise exception 'Valid trigger-bound Gmail sync run key required';
  end if;

  if coalesce(p_mailbox_hash, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_label_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Redacted Gmail configuration fingerprints required';
  end if;

  if normalized_trigger = 'intake_shadow' then
    if not coalesce(p_enabled, false) then
      raise exception 'Enabled exact intake-shadow run required';
    end if;
    normalized_run_key_digest := encode(
      extensions.digest(convert_to(normalized_run_key, 'UTF8'), 'sha256'),
      'hex'
    );
    select * into dispatch_authorization
    from public.refund_gmail_intake_shadow_dispatch_authorizations dispatch
    where dispatch.run_key_digest = normalized_run_key_digest
    for update;
    if dispatch_authorization.run_key_digest is null
      or dispatch_authorization.status <> 'armed'
      or dispatch_authorization.expires_at <= clock_timestamp() then
      raise exception 'Active owner intake-shadow dispatch authorization required';
    end if;
  end if;

  insert into public.refund_gmail_sync_runs (
    run_key,
    trigger_source,
    status,
    started_at,
    finished_at,
    error_code
  )
  values (
    normalized_run_key,
    normalized_trigger,
    case when p_enabled then 'running' else 'suppressed' end,
    coalesce(p_started_at, now()),
    case when p_enabled then null else coalesce(p_started_at, now()) end,
    case when p_enabled then null else 'integration_disabled' end
  )
  on conflict (run_key) do nothing
  returning * into run_row;

  if run_row.id is null then
    if normalized_trigger = 'intake_shadow' then
      raise exception 'Exact intake-shadow run key already used';
    end if;
    select * into run_row
    from public.refund_gmail_sync_runs
    where run_key = normalized_run_key;

    return jsonb_build_object(
      'claimed', false,
      'runId', run_row.id,
      'status', run_row.status,
      'reason', 'duplicate_run_key'
    );
  end if;

  if normalized_trigger = 'intake_shadow' then
    update public.refund_gmail_intake_shadow_dispatch_authorizations
    set
      status = 'consumed',
      consumed_run_id = run_row.id,
      consumed_at = clock_timestamp()
    where run_key_digest = normalized_run_key_digest;
  end if;

  select * into state_row
  from public.refund_gmail_sync_state
  where singleton
  for update;

  if p_enabled
    and state_row.connection_status = 'running'
    and state_row.last_attempt_at > coalesce(p_started_at, now()) - interval '20 minutes' then
    update public.refund_gmail_sync_runs
    set
      status = 'suppressed',
      finished_at = now(),
      error_code = 'sync_already_running'
    where id = run_row.id;

    return jsonb_build_object(
      'claimed', false,
      'runId', run_row.id,
      'status', 'suppressed',
      'reason', 'sync_already_running'
    );
  end if;

  update public.refund_gmail_sync_state
  set
    mailbox_hash = p_mailbox_hash,
    label_hash = p_label_hash,
    enabled = p_enabled,
    connection_status = case when p_enabled then 'running' else 'paused' end,
    last_attempt_at = coalesce(p_started_at, now()),
    last_run_id = run_row.id,
    last_error_code = case when p_enabled then null else 'integration_disabled' end
  where singleton;

  return jsonb_build_object(
    'claimed', p_enabled,
    'runId', run_row.id,
    'status', case when p_enabled then 'running' else 'suppressed' end,
    'intakeShadowAuthorized', normalized_trigger = 'intake_shadow',
    'intakeShadowOwnerSenderDigest', case
      when normalized_trigger = 'intake_shadow'
        then dispatch_authorization.owner_sender_digest
      else null
    end,
    'intakeShadowStartAt', case
      when normalized_trigger = 'intake_shadow'
        then dispatch_authorization.start_at
      else null
    end,
    'payloadRedacted', true,
    'lastHistoryId', state_row.last_history_id
  );
end;
$$;

create table if not exists public.refund_gmail_intake_shadow_notices (
  source_message_id uuid primary key
    references public.refund_gmail_messages (id) on delete restrict,
  run_id uuid not null unique
    references public.refund_gmail_sync_runs (id) on delete restrict,
  refund_case_id uuid not null
    references public.refund_cases (id) on delete restrict,
  first_contact_operation_id uuid not null unique
    references public.refund_gmail_first_contact_operations (id) on delete restrict,
  first_contact_event_id uuid not null unique
    references public.refund_case_events (id) on delete restrict,
  event_id uuid not null unique
    references public.refund_case_events (id) on delete restrict,
  route_class text not null check (
    route_class in (
      'assigned_managers',
      'operations_fallback',
      'unassigned_owner_ops_queue'
    )
  ),
  created_at timestamptz not null default now(),
  constraint refund_gmail_intake_shadow_notice_source_case_unique
    unique (source_message_id, refund_case_id)
);

alter table public.refund_gmail_intake_shadow_notices enable row level security;
revoke all on table public.refund_gmail_intake_shadow_notices
  from public, anon, authenticated, service_role;

create table if not exists public.refund_gmail_intake_shadow_cleanup_obligations (
  run_id uuid primary key
    references public.refund_gmail_sync_runs (id) on delete restrict,
  cleanup_task_handle uuid not null default gen_random_uuid() unique,
  source_message_id uuid not null unique
    references public.refund_gmail_messages (id) on delete restrict,
  refund_case_id uuid not null
    references public.refund_cases (id) on delete restrict,
  earliest_retention_due_at timestamptz not null,
  latest_retention_due_at timestamptz not null,
  assigned_owner_role text not null default 'refund_operations_owner'
    check (assigned_owner_role = 'refund_operations_owner'),
  assigned_task_key text not null default 'refund-gmail-intake-shadow-retention-cleanup'
    check (assigned_task_key = 'refund-gmail-intake-shadow-retention-cleanup'),
  status text not null default 'assigned'
    check (status in ('assigned', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint refund_gmail_intake_shadow_cleanup_due_order check (
    latest_retention_due_at >= earliest_retention_due_at
  ),
  constraint refund_gmail_intake_shadow_cleanup_completion_check check (
    (status = 'assigned' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

alter table public.refund_gmail_intake_shadow_cleanup_obligations enable row level security;
revoke all on table public.refund_gmail_intake_shadow_cleanup_obligations
  from public, anon, authenticated, service_role;

create or replace function public.service_preflight_refund_gmail_intake_shadow(
  p_retention_worker_enabled boolean,
  p_retention_policy_version text,
  p_attachments_enabled boolean,
  p_scanner_enabled boolean,
  p_scanner_version text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  retention_settings public.refund_gmail_retention_settings;
  retention_state public.refund_gmail_retention_state;
  active_proof_count integer := 0;
  armed_dispatch_authorization_count integer := 0;
  unresolved_gmail_count integer := 0;
  unresolved_first_contact_count integer := 0;
  active_official_authorization_count integer := 0;
  pending_step_up_intent_count integer := 0;
  nayax_operator_count integer := 0;
  nayax_resolution_intent_count integer := 0;
  nayax_provider_attempt_count integer := 0;
  unresolved_nayax_provider_attempt_count integer := 0;
  overdue_cleanup_obligation_count integer := 0;
  contact_enabled boolean := false;
  gpt_enabled boolean := false;
  gpt_auto_send_enabled boolean := false;
  retention_healthy boolean := false;
  allowed boolean := false;
  status text := 'authorized';
begin
  select * into retention_settings
  from public.refund_gmail_retention_settings
  where singleton;
  select * into retention_state
  from public.refund_gmail_retention_state
  where singleton;

  select count(*)::integer into active_proof_count
  from public.refund_synthetic_gmail_proof_authorizations
  where cancelled_at is null;
  select count(*)::integer into armed_dispatch_authorization_count
  from public.refund_gmail_intake_shadow_dispatch_authorizations dispatch
  where dispatch.status = 'armed';
  select count(*)::integer into unresolved_gmail_count
  from public.refund_gmail_messages gmail_message
  where gmail_message.status in ('pending_send', 'delivery_unknown');
  select count(*)::integer into unresolved_first_contact_count
  from public.refund_gmail_first_contact_operations first_contact
  where first_contact.status in ('pending_send', 'delivery_unknown');
  select count(*)::integer into active_official_authorization_count
  from public.refund_case_official_action_authorizations action_authorization
  where action_authorization.status = 'authorized'
    and action_authorization.expires_at > statement_timestamp();
  select count(*)::integer into pending_step_up_intent_count
  from public.refund_manager_action_step_up_intents intent
  where intent.status = 'pending';
  select count(*)::integer into nayax_operator_count
  from public.refund_nayax_resolution_operators resolution_operator
  where resolution_operator.status = 'active'
    and resolution_operator.revoked_at is null;
  select count(*)::integer into nayax_resolution_intent_count
  from public.refund_nayax_resolution_intents intent
  where intent.status = 'pending';
  select count(*)::integer into nayax_provider_attempt_count
  from public.refund_case_nayax_refund_attempts;
  select count(*)::integer into unresolved_nayax_provider_attempt_count
  from public.refund_case_nayax_refund_attempts attempt
  where attempt.status in ('created', 'in_progress', 'requested', 'approved', 'ambiguous', 'manual_review')
    or coalesce(attempt.reconciliation_required, false);
  select count(*)::integer into overdue_cleanup_obligation_count
  from public.refund_gmail_intake_shadow_cleanup_obligations obligation
  where obligation.status = 'assigned'
    and obligation.latest_retention_due_at <= statement_timestamp();
  select coalesce(automatic_customer_contact_enabled, false)
  into contact_enabled
  from public.refund_customer_contact_settings
  where singleton;
  select coalesce(enabled, false), coalesce(auto_send_enabled, false)
  into gpt_enabled, gpt_auto_send_enabled
  from public.refund_gpt_triage_settings
  where singleton;

  -- This narrow copy authorization deliberately does not require the general
  -- retention worker gate. That independently callable worker stays disabled
  -- throughout the owner-only intake window, while every other copy-health
  -- predicate remains identical to the ordinary copy boundary.
  retention_healthy := not coalesce(p_retention_worker_enabled, false)
    and not coalesce(p_attachments_enabled, false)
    and not coalesce(p_scanner_enabled, false)
    and btrim(coalesce(p_retention_policy_version, '')) = retention_settings.policy_version
    and retention_settings.cleanup_enabled
    and retention_settings.owner_approved_at is not null
    and retention_settings.approved_retention_days is not null
    and retention_state.status = 'healthy'
    and retention_state.last_success_at is not null
    and retention_state.last_success_at
      >= clock_timestamp()
        - make_interval(hours => retention_settings.cleanup_overdue_after_hours)
    and not exists (
      select 1
      from public.refund_gmail_attachments attachment
      where attachment.deleted_at is null
        and attachment.copied_at
          + make_interval(days => retention_settings.approved_retention_days)
            <= clock_timestamp()
    )
    and not exists (
      select 1
      from public.refund_gmail_messages message
      where message.content_deleted_at is null
        and message.copied_at
          + make_interval(days => retention_settings.approved_retention_days)
            <= clock_timestamp()
    )
    and not exists (
      select 1 from public.refund_gmail_retention_actions action
      where action.status in ('claimed', 'delete_failed', 'manual_review')
    )
    and not exists (
      select 1 from public.refund_gmail_quarantine_upload_intents intent
      where intent.status in ('reserved', 'upload_failed', 'upload_unknown')
    )
    and not exists (
      select 1
      from public.refund_gmail_attachments attachment
      left join public.refund_gmail_quarantine_upload_intents intent
        on attachment.id = intent.gmail_attachment_id
      where attachment.deleted_at is null
        and (
          attachment.storage_bucket is not null
          or attachment.storage_path is not null
          or intent.id is not null
        )
        and (
          intent.id is null
          or intent.status = 'deleted'
          or intent.storage_bucket is distinct from 'refund-gmail-quarantine'
          or attachment.storage_bucket is distinct from 'refund-gmail-quarantine'
          or attachment.storage_bucket is distinct from intent.storage_bucket
          or attachment.storage_path is distinct from intent.storage_path
          or intent.storage_path is distinct from public.refund_gmail_quarantine_path(
            intent.refund_case_id,
            intent.gmail_message_id,
            intent.gmail_attachment_id,
            intent.storage_extension
          )
        )
    );

  if armed_dispatch_authorization_count <> 0 then
    status := 'intake_shadow_dispatch_armed';
  elsif active_proof_count <> 0 then
    status := 'synthetic_proof_open';
  elsif unresolved_gmail_count <> 0 or unresolved_first_contact_count <> 0 then
    status := 'gmail_delivery_unresolved';
  elsif contact_enabled or gpt_enabled or gpt_auto_send_enabled then
    status := 'customer_contact_or_gpt_enabled';
  elsif public.refund_official_actions_enabled()
    or active_official_authorization_count <> 0
    or pending_step_up_intent_count <> 0 then
    status := 'official_actions_enabled';
  elsif public.refund_nayax_outcome_resolution_enabled()
    or nayax_operator_count <> 0
    or nayax_resolution_intent_count <> 0
    or unresolved_nayax_provider_attempt_count <> 0 then
    status := 'nayax_resolution_enabled';
  elsif overdue_cleanup_obligation_count <> 0 then
    status := 'intake_shadow_cleanup_overdue';
  elsif not retention_healthy then
    status := 'retention_policy_unhealthy';
  end if;

  allowed := status = 'authorized';
  return jsonb_build_object(
    'allowed', allowed,
    'status', status,
    'armedDispatchAuthorizationCount', armed_dispatch_authorization_count,
    'activeProofAuthorizationCount', active_proof_count,
    'unresolvedGmailOutboundCount', unresolved_gmail_count,
    'unresolvedFirstContactCount', unresolved_first_contact_count,
    'automaticCustomerContactEnabled', contact_enabled,
    'gptTriageEnabled', gpt_enabled,
    'gptAutoSendEnabled', gpt_auto_send_enabled,
    'officialActionsEnabled', public.refund_official_actions_enabled(),
    'activeOfficialAuthorizationCount', active_official_authorization_count,
    'pendingStepUpIntentCount', pending_step_up_intent_count,
    'nayaxResolutionEnabled', public.refund_nayax_outcome_resolution_enabled(),
    'nayaxOperatorCount', nayax_operator_count,
    'nayaxResolutionIntentCount', nayax_resolution_intent_count,
    'nayaxProviderAttemptCount', nayax_provider_attempt_count,
    'unresolvedNayaxProviderAttemptCount', unresolved_nayax_provider_attempt_count,
    'overdueCleanupObligationCount', overdue_cleanup_obligation_count,
    'retentionPolicyHealthy', retention_healthy,
    'attachmentsEnabled', coalesce(p_attachments_enabled, false),
    'scannerEnabled', coalesce(p_scanner_enabled, false),
    'scannerVersionPresent', nullif(btrim(coalesce(p_scanner_version, '')), '') is not null,
    'payloadRedacted', true
  );
end;
$$;

-- This is the only intake-shadow completion boundary. It binds the exact run,
-- stored provider evidence, both audit events, and cleanup obligation in one
-- transaction without trusting caller-supplied template or outbound flags.
create or replace function public.service_complete_refund_gmail_intake_shadow(
  p_run_id uuid,
  p_source_message_id uuid,
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  exact_template constant text := 'refund_first_contact_v1';
  truthful_message constant text :=
    'Hub sent no customer first-contact message. A mailbox acknowledgement was already observed, and this thread is durably excluded from later Hub first contact.';
  run_row public.refund_gmail_sync_runs;
  dispatch_row public.refund_gmail_intake_shadow_dispatch_authorizations;
  source_row public.refund_gmail_messages;
  case_row public.refund_cases;
  operation_row public.refund_gmail_first_contact_operations;
  existing_notice public.refund_gmail_intake_shadow_notices;
  route_resolution jsonb;
  route_status text;
  route_class text;
  first_contact_event_id_value uuid;
  action_event_id_value uuid;
  thread_message_count integer := 0;
  acknowledgement_count integer := 0;
  earliest_due_at timestamptz;
  latest_due_at timestamptz;
begin
  if p_run_id is null or p_source_message_id is null or p_refund_case_id is null then
    raise exception 'Exact run, source message, and refund case required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refund-gmail-intake-shadow-cleanup-obligations', 854)
  );
  perform pg_advisory_xact_lock(hashtextextended(p_source_message_id::text, 0));

  select * into run_row
  from public.refund_gmail_sync_runs
  where id = p_run_id
  for update;
  select * into source_row
  from public.refund_gmail_messages
  where id = p_source_message_id
  for update;
  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id;
  select * into dispatch_row
  from public.refund_gmail_intake_shadow_dispatch_authorizations dispatch
  where dispatch.consumed_run_id = p_run_id;

  if run_row.id is null
    or run_row.trigger_source <> 'intake_shadow'
    or run_row.status <> 'running'
    or not public.refund_gmail_workflow_run_key_is_valid(
      run_row.run_key,
      run_row.trigger_source
    )
    or dispatch_row.run_key_digest is null
    or dispatch_row.status <> 'consumed'
    or dispatch_row.consumed_run_id <> run_row.id
    or source_row.id is null
    or case_row.id is null
    or source_row.refund_case_id <> case_row.id
    or source_row.direction <> 'inbound'
    or source_row.message_kind <> 'message'
    or source_row.status <> 'received'
    or source_row.participant_role <> 'customer'
    or source_row.participant_trust <> 'verified'
    or source_row.sender_email is null
    or encode(
      extensions.digest(
        convert_to(lower(btrim(source_row.sender_email)), 'UTF8'),
        'sha256'
      ),
      'hex'
    ) <> dispatch_row.owner_sender_digest
    or source_row.received_at < dispatch_row.start_at
    or source_row.received_at > statement_timestamp() + interval '30 seconds'
    or source_row.content_deleted_at is not null
    or case_row.intake_source <> 'gmail'
    or case_row.status <> 'draft' then
    raise exception 'Exact active intake-shadow run and customer source required';
  end if;

  select count(*)::integer, min(message.retention_expires_at),
    max(message.retention_expires_at)
  into thread_message_count, earliest_due_at, latest_due_at
  from public.refund_gmail_messages message
  where message.gmail_thread_id = source_row.gmail_thread_id;

  select count(*)::integer
  into acknowledgement_count
  from public.refund_gmail_messages message
  where message.gmail_thread_id = source_row.gmail_thread_id
    and message.refund_case_id = source_row.refund_case_id
    and message.direction = 'outbound'
    and message.message_kind = 'message'
    and message.status = 'sent'
    and message.participant_role = 'mailbox'
    and message.operation_key is null
    and message.sent_at is not null
    and message.received_at > source_row.received_at
    and lower(btrim(coalesce(message.recipient_email, '')))
      = lower(btrim(source_row.sender_email))
    and coalesce(message.recipient_cc_count, 0) = 0
    and message.content_deleted_at is null;

  if thread_message_count <> 2 or acknowledgement_count <> 1
    or earliest_due_at is null or latest_due_at is null then
    raise exception 'Exact two-message mailbox-acknowledged thread required';
  end if;

  select * into existing_notice
  from public.refund_gmail_intake_shadow_notices
  where source_message_id = source_row.id;
  if existing_notice.source_message_id is not null then
    if existing_notice.run_id <> run_row.id
      or existing_notice.refund_case_id <> case_row.id then
      raise exception 'Gmail intake-shadow source run or case mismatch';
    end if;
    return jsonb_build_object(
      'recorded', false,
      'eventPresent', true,
      'firstContactPresent', true,
      'cleanupAssigned', true,
      'routeClass', existing_notice.route_class,
      'mailboxAcknowledgementObserved', true,
      'hubCustomerDeliverySent', false,
      'laterHubFirstContactExcluded', true,
      'payloadRedacted', true
    );
  end if;

  select * into operation_row
  from public.refund_gmail_first_contact_operations operation
  where operation.gmail_thread_id = source_row.gmail_thread_id
  for update;
  if operation_row.id is null then
    insert into public.refund_gmail_first_contact_operations (
      gmail_thread_id,
      refund_case_id,
      source_message_id,
      operation_key,
      mode,
      template_key,
      prior_mailbox_reply_present,
      status,
      cutover_at
    ) values (
      source_row.gmail_thread_id,
      case_row.id,
      source_row.id,
      'refund-first-contact:' || source_row.gmail_thread_id::text,
      'shadow',
      exact_template,
      true,
      'shadowed',
      null
    ) returning * into operation_row;
  elsif operation_row.refund_case_id <> case_row.id
    or operation_row.source_message_id <> source_row.id
    or operation_row.mode <> 'shadow'
    or operation_row.template_key <> exact_template
    or operation_row.status <> 'shadowed'
    or operation_row.prior_mailbox_reply_present is not true then
    raise exception 'Exact intake-shadow first-contact operation required';
  end if;

  insert into public.refund_case_events (
    refund_case_id, event_type, message, metadata
  ) values (
    case_row.id,
    'gmail_first_contact_shadowed',
    truthful_message,
    jsonb_build_object(
      'payload_redacted', true,
      'template_key', exact_template,
      'mode', 'shadow',
      'prior_mailbox_reply_present', true,
      'mailbox_acknowledgement_observed', true,
      'hub_customer_delivery_sent', false,
      'later_hub_first_contact_excluded', true,
      'exact_run_bound', true
    )
  ) returning id into first_contact_event_id_value;

  route_resolution := public.service_resolve_refund_customer_manager_cc(
    case_row.id,
    case_row.customer_email,
    array[
      'info@bloomjoysweets.com',
      'support@bloomjoysweets.com',
      'refunds@bloomjoysweets.com'
    ]::text[]
  );
  route_status := coalesce(route_resolution ->> 'status', '');
  route_class := case
    when route_status = 'resolved' then 'assigned_managers'
    when route_status = 'machine_unresolved' then 'unassigned_owner_ops_queue'
    else 'operations_fallback'
  end;

  insert into public.refund_case_events (
    refund_case_id, event_type, message, metadata
  ) values (
    case_row.id,
    'gmail_manager_action_notice_shadowed',
    'The intake-only shadow recorded action-needed work without sending an internal or customer message.',
    jsonb_build_object('route_class', route_class, 'payload_redacted', true)
  ) returning id into action_event_id_value;

  insert into public.refund_gmail_intake_shadow_notices (
    source_message_id, run_id, refund_case_id, first_contact_operation_id,
    first_contact_event_id, event_id, route_class
  ) values (
    source_row.id, run_row.id, case_row.id, operation_row.id,
    first_contact_event_id_value, action_event_id_value, route_class
  );

  insert into public.refund_gmail_intake_shadow_cleanup_obligations (
    run_id, source_message_id, refund_case_id,
    earliest_retention_due_at, latest_retention_due_at,
    assigned_owner_role, assigned_task_key, status
  ) values (
    run_row.id, source_row.id, case_row.id,
    earliest_due_at, latest_due_at,
    'refund_operations_owner',
    'refund-gmail-intake-shadow-retention-cleanup', 'assigned'
  );

  return jsonb_build_object(
    'recorded', true,
    'eventPresent', true,
    'firstContactPresent', true,
    'cleanupAssigned', true,
    'routeClass', route_class,
    'mailboxAcknowledgementObserved', true,
    'hubCustomerDeliverySent', false,
    'laterHubFirstContactExcluded', true,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.owner_complete_due_refund_gmail_intake_shadow_cleanup(
  p_cleanup_task_handle uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_now integer := 0;
  assigned_overdue integer := 0;
  assigned_outstanding integer := 0;
  task_found boolean := false;
  task_status text := 'absent';
begin
  perform pg_advisory_xact_lock(
    hashtextextended('refund-gmail-intake-shadow-dispatch-authorize', 854)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('refund-gmail-intake-shadow-cleanup-obligations', 854)
  );
  if exists (
    select 1
    from public.refund_gmail_intake_shadow_dispatch_authorizations dispatch
    left join public.refund_gmail_sync_runs run
      on run.id = dispatch.consumed_run_id
    where dispatch.status = 'armed'
       or (
         dispatch.status = 'consumed'
         and run.trigger_source = 'intake_shadow'
         and run.status = 'running'
       )
  ) then
    raise exception 'Intake-shadow cleanup requires a closed dispatch lane';
  end if;
  with verified_due as (
    select obligation.run_id
    from public.refund_gmail_intake_shadow_cleanup_obligations obligation
    join public.refund_gmail_intake_shadow_notices notice
      on notice.run_id = obligation.run_id
      and notice.source_message_id = obligation.source_message_id
      and notice.refund_case_id = obligation.refund_case_id
    join public.refund_gmail_messages source
      on source.id = notice.source_message_id
    join public.refund_gmail_threads thread
      on thread.id = source.gmail_thread_id
    where obligation.status = 'assigned'
      and obligation.cleanup_task_handle = p_cleanup_task_handle
      and obligation.latest_retention_due_at <= statement_timestamp()
      and (
        select count(*)
        from public.refund_gmail_messages message
        where message.gmail_thread_id = source.gmail_thread_id
      ) = 2
      and not exists (
        select 1
        from public.refund_gmail_messages message
        where message.gmail_thread_id = source.gmail_thread_id
          and (
            message.content_deleted_at is null
            or message.sender_email is not null
            or message.sender_name is not null
            or message.recipient_email is not null
            or cardinality(message.recipient_cc_emails) <> 0
            or message.recipient_cc_count <> 0
            or message.provider_message_id is not null
            or message.provider_message_header is not null
            or message.references_header is not null
            or message.subject <> '[Deleted after Gmail retention period]'
            or message.plain_body <> '[Deleted after Gmail retention period]'
          )
      )
      and thread.thread_subject = '[Deleted after Gmail retention period]'
    for update of obligation
  )
  update public.refund_gmail_intake_shadow_cleanup_obligations obligation
  set status = 'completed', completed_at = statement_timestamp()
  from verified_due
  where obligation.run_id = verified_due.run_id;
  get diagnostics completed_now = row_count;

  select count(*)::integer into assigned_overdue
  from public.refund_gmail_intake_shadow_cleanup_obligations obligation
  where obligation.status = 'assigned'
    and obligation.latest_retention_due_at <= statement_timestamp();
  select count(*)::integer into assigned_outstanding
  from public.refund_gmail_intake_shadow_cleanup_obligations obligation
  where obligation.status = 'assigned';
  select true, obligation.status
  into task_found, task_status
  from public.refund_gmail_intake_shadow_cleanup_obligations obligation
  where obligation.cleanup_task_handle = p_cleanup_task_handle;

  -- Invalidate every authorization request that began before or while this
  -- dispatch-locked cleanup proof ran. A request already waiting behind the
  -- lock must not arm immediately after cleanup reports a closed lane.
  update public.refund_gmail_intake_shadow_dispatch_control
  set last_recovery_at = clock_timestamp()
  where singleton;

  return jsonb_build_object(
    'completedNow', completed_now,
    'assignedOverdue', assigned_overdue,
    'assignedOutstanding', assigned_outstanding,
    'taskFound', coalesce(task_found, false),
    'taskStatus', coalesce(task_status, 'absent'),
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.refund_gmail_workflow_run_key_is_valid(text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.owner_authorize_refund_gmail_intake_shadow_dispatch(
  text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke execute on function public.owner_cancel_refund_gmail_intake_shadow_dispatch(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.owner_recover_expired_refund_gmail_intake_shadow_dispatches()
  from public, anon, authenticated, service_role;
revoke execute on function public.owner_complete_due_refund_gmail_intake_shadow_cleanup(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.service_start_refund_gmail_sync(
  text, text, timestamptz, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.service_start_refund_gmail_sync(
  text, text, timestamptz, text, text, boolean
) to service_role;

revoke execute on function public.service_preflight_refund_gmail_intake_shadow(
  boolean, text, boolean, boolean, text
) from public, anon, authenticated;
grant execute on function public.service_preflight_refund_gmail_intake_shadow(
  boolean, text, boolean, boolean, text
) to service_role;

revoke execute on function public.service_complete_refund_gmail_intake_shadow(
  uuid, uuid, uuid
)
  from public, anon, authenticated;
grant execute on function public.service_complete_refund_gmail_intake_shadow(
  uuid, uuid, uuid
)
  to service_role;

comment on table public.refund_gmail_intake_shadow_notices is
  'Service-only exact-run ledger binding the owner intake source, first-contact operation/event, and action-work event.';
comment on table public.refund_gmail_intake_shadow_cleanup_obligations is
  'PII-free exact-run owner obligation for reviewed retention cleanup after one intake-shadow copy.';
comment on table public.refund_gmail_intake_shadow_dispatch_authorizations is
  'Owner-only expiring dispatch authorization atomically consumed by one exact intake-shadow run or cancelled before any late start.';
comment on function public.owner_recover_expired_refund_gmail_intake_shadow_dispatches() is
  'Owner-only no-target recovery that cancels expired armed intake-shadow dispatches under the global lane lock and returns aggregate counts only.';
comment on function public.service_preflight_refund_gmail_intake_shadow(
  boolean, text, boolean, boolean, text
) is
  'Service-only redacted DB safety preflight for the default-off Gmail intake-shadow lane.';
comment on function public.service_complete_refund_gmail_intake_shadow(
  uuid, uuid, uuid
) is
  'Service-only atomic run-bound two-message proof, truthful exclusion, PII-free action-work event, and assigned cleanup obligation; sends no message.';

select pg_notify('pgrst', 'reload schema');
