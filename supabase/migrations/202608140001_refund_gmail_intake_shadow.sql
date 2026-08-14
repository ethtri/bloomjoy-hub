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
  normalized_run_key text := btrim(coalesce(p_run_key, ''));
  normalized_trigger text := lower(btrim(coalesce(p_trigger_source, '')));
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
    'lastHistoryId', state_row.last_history_id
  );
end;
$$;

create table if not exists public.refund_gmail_intake_shadow_notices (
  source_message_id uuid primary key
    references public.refund_gmail_messages (id) on delete restrict,
  refund_case_id uuid not null
    references public.refund_cases (id) on delete restrict,
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
  unresolved_gmail_count integer := 0;
  unresolved_first_contact_count integer := 0;
  active_official_authorization_count integer := 0;
  pending_step_up_intent_count integer := 0;
  nayax_operator_count integer := 0;
  nayax_resolution_intent_count integer := 0;
  nayax_provider_attempt_count integer := 0;
  unresolved_nayax_provider_attempt_count integer := 0;
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

  if active_proof_count <> 0 then
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
  elsif not retention_healthy then
    status := 'retention_policy_unhealthy';
  end if;

  allowed := status = 'authorized';
  return jsonb_build_object(
    'allowed', allowed,
    'status', status,
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
    'retentionPolicyHealthy', retention_healthy,
    'attachmentsEnabled', coalesce(p_attachments_enabled, false),
    'scannerEnabled', coalesce(p_scanner_enabled, false),
    'scannerVersionPresent', nullif(btrim(coalesce(p_scanner_version, '')), '') is not null,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_record_refund_gmail_intake_shadow_notice(
  p_source_message_id uuid,
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row public.refund_gmail_messages;
  case_row public.refund_cases;
  existing_notice public.refund_gmail_intake_shadow_notices;
  route_resolution jsonb;
  route_status text;
  route_class text;
  event_id_value uuid;
begin
  if p_source_message_id is null or p_refund_case_id is null then
    raise exception 'Exact Gmail source message and refund case required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_source_message_id::text, 0));

  select * into source_row
  from public.refund_gmail_messages
  where id = p_source_message_id
  for update;
  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id;

  if source_row.id is null
    or case_row.id is null
    or source_row.refund_case_id <> case_row.id
    or source_row.direction <> 'inbound'
    or source_row.message_kind <> 'message'
    or source_row.status <> 'received'
    or source_row.participant_role <> 'customer'
    or case_row.intake_source <> 'gmail'
    or case_row.status <> 'draft' then
    raise exception 'Eligible Gmail intake-shadow source required';
  end if;

  select * into existing_notice
  from public.refund_gmail_intake_shadow_notices
  where source_message_id = p_source_message_id;
  if existing_notice.source_message_id is not null then
    if existing_notice.refund_case_id <> p_refund_case_id then
      raise exception 'Gmail intake-shadow source case mismatch';
    end if;
    return jsonb_build_object(
      'recorded', false,
      'eventPresent', true,
      'routeClass', existing_notice.route_class,
      'payloadRedacted', true
    );
  end if;

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
    refund_case_id,
    event_type,
    message,
    metadata
  )
  values (
    case_row.id,
    'gmail_manager_action_notice_shadowed',
    'The intake-only shadow recorded action-needed work without sending an internal or customer message.',
    jsonb_build_object(
      'route_class', route_class,
      'payload_redacted', true
    )
  )
  returning id into event_id_value;

  insert into public.refund_gmail_intake_shadow_notices (
    source_message_id,
    refund_case_id,
    event_id,
    route_class
  )
  values (
    source_row.id,
    case_row.id,
    event_id_value,
    route_class
  );

  return jsonb_build_object(
    'recorded', true,
    'eventPresent', true,
    'routeClass', route_class,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_record_refund_gmail_intake_shadow_first_contact(
  p_source_message_id uuid,
  p_template_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_result jsonb;
  operation_row public.refund_gmail_first_contact_operations;
  truthful_message constant text :=
    'Hub sent no customer first-contact message. A mailbox acknowledgement was already observed, and this thread is durably excluded from later Hub first contact.';
begin
  if p_source_message_id is null or length(btrim(coalesce(p_template_key, ''))) not between 8 and 120 then
    raise exception 'Exact intake-shadow first-contact source and template required';
  end if;

  claim_result := public.service_claim_refund_gmail_first_contact(
    p_source_message_id,
    'shadow',
    null,
    p_template_key,
    '',
    '',
    true
  );

  select * into operation_row
  from public.refund_gmail_first_contact_operations operation
  where operation.source_message_id = p_source_message_id;

  if coalesce((claim_result ->> 'eligible')::boolean, false) is not true
    or operation_row.id is null
    or operation_row.source_message_id <> p_source_message_id
    or operation_row.mode <> 'shadow'
    or operation_row.status <> 'shadowed'
    or operation_row.prior_mailbox_reply_present is not true then
    raise exception 'Eligible mailbox-acknowledged intake-shadow source required';
  end if;

  update public.refund_case_events event
  set
    message = truthful_message,
    metadata = jsonb_build_object(
      'payload_redacted', true,
      'template_key', operation_row.template_key,
      'mode', 'shadow',
      'prior_mailbox_reply_present', true,
      'mailbox_acknowledgement_observed', true,
      'hub_customer_delivery_sent', false,
      'later_hub_first_contact_excluded', true
    )
  where event.refund_case_id = operation_row.refund_case_id
    and event.event_type = 'gmail_first_contact_shadowed'
    and event.metadata ->> 'template_key' = operation_row.template_key;

  if not found then
    raise exception 'Truthful intake-shadow first-contact event required';
  end if;

  return jsonb_build_object(
    'eligible', true,
    'claimed', coalesce((claim_result ->> 'claimed')::boolean, false),
    'operationId', operation_row.id,
    'status', operation_row.status,
    'mode', operation_row.mode,
    'templateKey', operation_row.template_key,
    'priorMailboxReplyPresent', true,
    'mailboxAcknowledgementObserved', true,
    'hubCustomerDeliverySent', false,
    'laterHubFirstContactExcluded', true,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.refund_gmail_workflow_run_key_is_valid(text, text)
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

revoke execute on function public.service_record_refund_gmail_intake_shadow_notice(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_record_refund_gmail_intake_shadow_notice(uuid, uuid)
  to service_role;
revoke execute on function public.service_record_refund_gmail_intake_shadow_first_contact(uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_record_refund_gmail_intake_shadow_first_contact(uuid, text)
  to service_role;

comment on table public.refund_gmail_intake_shadow_notices is
  'Service-only idempotency ledger for the owner-controlled Gmail intake-shadow notice event.';
comment on function public.service_preflight_refund_gmail_intake_shadow(
  boolean, text, boolean, boolean, text
) is
  'Service-only redacted DB safety preflight for the default-off Gmail intake-shadow lane.';
comment on function public.service_record_refund_gmail_intake_shadow_notice(uuid, uuid) is
  'Service-only idempotent PII-free action-work shadow event for one received customer Gmail message.';
comment on function public.service_record_refund_gmail_intake_shadow_first_contact(uuid, text) is
  'Service-only atomic truthful shadow exclusion for a mailbox-acknowledged owner intake thread; sends no message.';

select pg_notify('pgrst', 'reload schema');
