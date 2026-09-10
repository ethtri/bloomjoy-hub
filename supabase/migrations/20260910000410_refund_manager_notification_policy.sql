-- One privacy-safe, server-owned ledger for manager notification decisions.
-- Raw recipient addresses are returned only to the service worker that wins an
-- immediate-delivery reservation; the database retains one-way fingerprints.

create table public.refund_manager_notification_actions (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  attention_version bigint not null check (attention_version >= 1),
  notice_reason text not null check (notice_reason in (
    'intake_created',
    'wallet_match_ready',
    'customer_reply',
    'hard_bounce',
    'provider_setup',
    'provider_outage',
    'provider_rejection',
    'provider_timeout',
    'provider_unknown',
    'follow_up_manual_review',
    'manager_reminder',
    'manager_escalation',
    'routine_customer_message',
    'manager_authored_conversation',
    'customer_completion_copy'
  )),
  channel text not null check (channel in ('immediate', 'daily_digest', 'portal_only')),
  urgency text not null check (urgency in ('routine', 'actionable', 'urgent')),
  delivery_state text not null check (delivery_state in (
    'reserved',
    'sent',
    'delivery_unknown',
    'known_not_sent',
    'digest_eligible',
    'portal_only'
  )),
  claim_token uuid,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  route_type text check (route_type is null or route_type in ('manager', 'operations')),
  resolution_status text check (
    resolution_status is null or resolution_status ~ '^[a-z0-9_]{1,80}$'
  ),
  mapping_fingerprint text check (
    mapping_fingerprint is null or mapping_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  manager_recipient_count integer check (
    manager_recipient_count is null or manager_recipient_count between 0 and 4
  ),
  recipient_count integer check (recipient_count is null or recipient_count between 1 and 5),
  provider_message_id_digest text check (
    provider_message_id_digest is null or provider_message_id_digest ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  settled_at timestamptz,
  unique (refund_case_id, attention_version, notice_reason),
  constraint refund_manager_notification_action_shape check (
    (
      channel = 'immediate'
      and delivery_state in ('reserved', 'sent', 'delivery_unknown', 'known_not_sent')
      and claim_token is not null
      and attempt_count between 1 and 3
      and route_type is not null
      and resolution_status is not null
      and mapping_fingerprint is not null
      and manager_recipient_count is not null
      and recipient_count is not null
    )
    or (
      channel = 'daily_digest'
      and delivery_state = 'digest_eligible'
      and claim_token is null
      and attempt_count = 0
      and route_type is null
      and resolution_status is null
      and mapping_fingerprint is null
      and manager_recipient_count is null
      and recipient_count is null
    )
    or (
      channel = 'portal_only'
      and delivery_state = 'portal_only'
      and claim_token is null
      and attempt_count = 0
      and route_type is null
      and resolution_status is null
      and mapping_fingerprint is null
      and manager_recipient_count is null
      and recipient_count is null
    )
  )
);

create table public.refund_manager_notification_recipients (
  action_id uuid not null references public.refund_manager_notification_actions (id) on delete cascade,
  recipient_fingerprint text not null check (recipient_fingerprint ~ '^[a-f0-9]{64}$'),
  delivery_state text not null check (delivery_state in (
    'reserved', 'sent', 'delivery_unknown', 'known_not_sent'
  )),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (action_id, recipient_fingerprint)
);

create index refund_manager_notification_digest_idx
  on public.refund_manager_notification_actions (created_at, refund_case_id)
  where delivery_state = 'digest_eligible';

create index refund_manager_notification_review_idx
  on public.refund_manager_notification_actions (updated_at, refund_case_id)
  where delivery_state = 'delivery_unknown';

alter table public.refund_manager_notification_actions enable row level security;
alter table public.refund_manager_notification_recipients enable row level security;
revoke all on table public.refund_manager_notification_actions from public, anon, authenticated;
revoke all on table public.refund_manager_notification_recipients from public, anon, authenticated;
grant select, insert, update on table public.refund_manager_notification_actions to service_role;
grant select, insert, update, delete on table public.refund_manager_notification_recipients to service_role;

create or replace function public.service_begin_refund_manager_notification(
  p_refund_case_id uuid,
  p_notice_reason text,
  p_customer_email text,
  p_mailbox_identities text[],
  p_ops_fallback_recipients text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  case_row public.refund_cases;
  action_row public.refund_manager_notification_actions;
  attention_version_value bigint;
  channel_value text;
  urgency_value text;
  route_resolution jsonb;
  resolution_status_value text;
  route_type_value text;
  route_recipients text[] := '{}'::text[];
  manager_recipient_count_value integer := 0;
  mapping_fingerprint_value text;
  claim_token_value uuid := gen_random_uuid();
  inserted boolean := false;
begin
  channel_value := case p_notice_reason
    when 'intake_created' then 'portal_only'
    when 'customer_reply' then 'daily_digest'
    when 'manager_reminder' then 'daily_digest'
    when 'routine_customer_message' then 'portal_only'
    when 'manager_authored_conversation' then 'portal_only'
    when 'customer_completion_copy' then 'portal_only'
    when 'wallet_match_ready' then 'immediate'
    when 'hard_bounce' then 'immediate'
    when 'provider_setup' then 'immediate'
    when 'provider_outage' then 'immediate'
    when 'provider_rejection' then 'immediate'
    when 'provider_timeout' then 'immediate'
    when 'provider_unknown' then 'immediate'
    when 'follow_up_manual_review' then 'immediate'
    when 'manager_escalation' then 'immediate'
    else null
  end;
  if channel_value is null then
    raise exception 'Unsupported refund manager notification reason';
  end if;

  urgency_value := case
    when p_notice_reason in ('hard_bounce', 'provider_unknown', 'manager_escalation') then 'urgent'
    when channel_value = 'immediate' then 'actionable'
    else 'routine'
  end;

  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id
  for update;
  if case_row.id is null then raise exception 'Refund case not found'; end if;
  if lower(btrim(case_row.customer_email)) <> lower(btrim(coalesce(p_customer_email, ''))) then
    raise exception 'Customer recipient must match the refund case';
  end if;

  select coalesce(attention.attention_version, 1)
  into attention_version_value
  from (select 1) singleton
  left join public.refund_manager_attention_states attention
    on attention.refund_case_id = p_refund_case_id;

  if channel_value <> 'immediate' then
    insert into public.refund_manager_notification_actions (
      refund_case_id, attention_version, notice_reason, channel, urgency,
      delivery_state, settled_at
    ) values (
      p_refund_case_id, attention_version_value, p_notice_reason, channel_value,
      urgency_value,
      case when channel_value = 'daily_digest' then 'digest_eligible' else 'portal_only' end,
      statement_timestamp()
    )
    on conflict (refund_case_id, attention_version, notice_reason) do nothing
    returning * into action_row;

    inserted := action_row.id is not null;
    if not inserted then
      select * into action_row
      from public.refund_manager_notification_actions
      where refund_case_id = p_refund_case_id
        and attention_version = attention_version_value
        and notice_reason = p_notice_reason;
    end if;
    return jsonb_build_object(
      'actionId', action_row.id,
      'claimed', false,
      'created', inserted,
      'channel', action_row.channel,
      'urgency', action_row.urgency,
      'deliveryState', action_row.delivery_state,
      'attentionVersion', action_row.attention_version,
      'reason', case when inserted then 'policy_suppressed' else 'duplicate_coalesced' end,
      'payloadRedacted', true
    );
  end if;

  route_resolution := public.service_resolve_refund_customer_manager_cc(
    p_refund_case_id,
    lower(btrim(p_customer_email)),
    p_mailbox_identities
  );
  resolution_status_value := coalesce(route_resolution ->> 'status', 'resolution_failed');
  select coalesce(array_agg(lower(btrim(value)) order by lower(btrim(value))), '{}'::text[])
  into route_recipients
  from jsonb_array_elements_text(coalesce(route_resolution -> 'managerCcEmails', '[]'::jsonb)) value
  where public.refund_email_address_is_valid(value)
    and lower(btrim(value)) <> lower(btrim(p_customer_email))
    and not (lower(btrim(value)) = any(public.normalize_refund_mailbox_identities(p_mailbox_identities)));

  if resolution_status_value = 'resolved' and cardinality(route_recipients) between 1 and 4 then
    route_type_value := 'manager';
    manager_recipient_count_value := cardinality(route_recipients);
  else
    route_type_value := 'operations';
    manager_recipient_count_value := 0;
    select coalesce(array_agg(email order by email), '{}'::text[])
    into route_recipients
    from (
      select distinct lower(btrim(value)) as email
      from unnest(coalesce(p_ops_fallback_recipients, '{}'::text[])) value
      where public.refund_email_address_is_valid(value)
        and lower(btrim(value)) <> lower(btrim(p_customer_email))
        and not (lower(btrim(value)) = any(public.normalize_refund_mailbox_identities(p_mailbox_identities)))
    ) eligible;
    if cardinality(route_recipients) not between 1 and 5 then
      raise exception 'No eligible refund action-notice recipients are configured';
    end if;
  end if;

  mapping_fingerprint_value := encode(
    extensions.digest(
      convert_to(
        concat_ws('|', route_type_value, resolution_status_value, array_to_string(route_recipients, ',')),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.refund_manager_notification_actions (
    refund_case_id, attention_version, notice_reason, channel, urgency,
    delivery_state, claim_token, attempt_count, route_type, resolution_status,
    mapping_fingerprint, manager_recipient_count, recipient_count
  ) values (
    p_refund_case_id, attention_version_value, p_notice_reason, channel_value,
    urgency_value, 'reserved', claim_token_value, 1, route_type_value,
    resolution_status_value, mapping_fingerprint_value,
    manager_recipient_count_value, cardinality(route_recipients)
  )
  on conflict (refund_case_id, attention_version, notice_reason) do nothing
  returning * into action_row;

  inserted := action_row.id is not null;
  if not inserted then
    select * into action_row
    from public.refund_manager_notification_actions
    where refund_case_id = p_refund_case_id
      and attention_version = attention_version_value
      and notice_reason = p_notice_reason
    for update;

    if action_row.delivery_state = 'known_not_sent' and action_row.attempt_count < 3 then
      update public.refund_manager_notification_actions
      set delivery_state = 'reserved',
          claim_token = claim_token_value,
          attempt_count = attempt_count + 1,
          route_type = route_type_value,
          resolution_status = resolution_status_value,
          mapping_fingerprint = mapping_fingerprint_value,
          manager_recipient_count = manager_recipient_count_value,
          recipient_count = cardinality(route_recipients),
          settled_at = null,
          updated_at = statement_timestamp()
      where id = action_row.id
      returning * into action_row;
      delete from public.refund_manager_notification_recipients where action_id = action_row.id;
      inserted := true;
    else
      return jsonb_build_object(
        'actionId', action_row.id,
        'claimed', false,
        'created', false,
        'channel', action_row.channel,
        'urgency', action_row.urgency,
        'deliveryState', action_row.delivery_state,
        'attentionVersion', action_row.attention_version,
        'reason', 'duplicate_coalesced',
        'payloadRedacted', true
      );
    end if;
  end if;

  insert into public.refund_manager_notification_recipients (
    action_id, recipient_fingerprint, delivery_state
  )
  select action_row.id,
    encode(extensions.digest(convert_to(email, 'UTF8'), 'sha256'), 'hex'),
    'reserved'
  from unnest(route_recipients) email;

  return jsonb_build_object(
    'actionId', action_row.id,
    'claimToken', action_row.claim_token,
    'claimed', true,
    'created', inserted,
    'channel', action_row.channel,
    'urgency', action_row.urgency,
    'deliveryState', action_row.delivery_state,
    'attentionVersion', action_row.attention_version,
    'reason', 'immediate_reserved',
    'recipientRoute', jsonb_build_object(
      'recipients', to_jsonb(route_recipients),
      'routeType', route_type_value,
      'managerRecipientCount', manager_recipient_count_value,
      'recipientCount', cardinality(route_recipients),
      'resolutionStatus', resolution_status_value,
      'mappingFingerprint', mapping_fingerprint_value
    ),
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_complete_refund_manager_notification(
  p_action_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider_message_id text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  action_row public.refund_manager_notification_actions;
  provider_digest text;
begin
  if p_outcome not in ('sent', 'delivery_unknown', 'known_not_sent') then
    raise exception 'Unsupported refund manager notification outcome';
  end if;
  select * into action_row
  from public.refund_manager_notification_actions
  where id = p_action_id
  for update;
  if action_row.id is null then raise exception 'Refund manager notification action not found'; end if;
  if action_row.delivery_state <> 'reserved' or action_row.claim_token <> p_claim_token then
    return false;
  end if;
  if p_outcome = 'sent' then
    if coalesce(btrim(p_provider_message_id), '') = '' then
      raise exception 'Provider message id is required for sent notification';
    end if;
    provider_digest := encode(
      extensions.digest(convert_to(btrim(p_provider_message_id), 'UTF8'), 'sha256'),
      'hex'
    );
  end if;

  update public.refund_manager_notification_actions
  set delivery_state = p_outcome,
      provider_message_id_digest = provider_digest,
      settled_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = p_action_id;
  update public.refund_manager_notification_recipients
  set delivery_state = p_outcome,
      updated_at = statement_timestamp()
  where action_id = p_action_id;
  return true;
end;
$$;

alter table public.refund_manager_attention_states
  drop constraint refund_manager_attention_outcome_check;
alter table public.refund_manager_attention_states
  add constraint refund_manager_attention_outcome_check check (
    last_notice_outcome is null
    or last_notice_outcome in (
      'delivered',
      'operations_exception',
      'delivery_unknown',
      'known_not_sent',
      'digest_eligible'
    )
  );

create or replace function public.service_mark_refund_manager_reminder_digest_eligible(
  p_refund_case_id uuid,
  p_attention_version bigint,
  p_notification_action_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  attention_row public.refund_manager_attention_states;
begin
  select * into attention_row
  from public.refund_manager_attention_states
  where refund_case_id = p_refund_case_id
  for update;
  if attention_row.refund_case_id is null
    or attention_row.attention_version <> p_attention_version
    or attention_row.attention_started_at is null
    or attention_row.reminder_resolved_at is not null
    or attention_row.delivery_review_required_at is not null then
    return false;
  end if;
  if not exists (
    select 1
    from public.refund_manager_notification_actions action
    where action.id = p_notification_action_id
      and action.refund_case_id = p_refund_case_id
      and action.attention_version = p_attention_version
      and action.notice_reason = 'manager_reminder'
      and action.delivery_state = 'digest_eligible'
  ) then
    raise exception 'Matching manager reminder digest eligibility is required';
  end if;

  update public.refund_manager_attention_states
  set reminder_resolved_at = statement_timestamp(),
      last_notice_milestone = 'reminder',
      last_notice_outcome = 'digest_eligible',
      last_notice_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where refund_case_id = p_refund_case_id;

  insert into public.refund_case_events (
    refund_case_id, event_type, message, metadata
  ) values (
    p_refund_case_id,
    'refund_manager_reminder_digest_eligible',
    'The two-business-day reminder was coalesced into the manager digest instead of sending another immediate email.',
    jsonb_build_object(
      'attention_version', p_attention_version,
      'notification_action_id', p_notification_action_id,
      'notice_reason', 'manager_reminder',
      'notification_channel', 'daily_digest',
      'delivery_state', 'digest_eligible',
      'payload_redacted', true
    )
  );
  return true;
end;
$$;

revoke execute on function public.service_begin_refund_manager_notification(
  uuid, text, text, text[], text[]
) from public, anon, authenticated;
revoke execute on function public.service_complete_refund_manager_notification(
  uuid, uuid, text, text
) from public, anon, authenticated;
revoke execute on function public.service_mark_refund_manager_reminder_digest_eligible(
  uuid, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.service_begin_refund_manager_notification(
  uuid, text, text, text[], text[]
) to service_role;
grant execute on function public.service_complete_refund_manager_notification(
  uuid, uuid, text, text
) to service_role;
grant execute on function public.service_mark_refund_manager_reminder_digest_eligible(
  uuid, bigint, uuid
) to service_role;

comment on table public.refund_manager_notification_actions is
  'PII-free canonical manager notification decisions. One case/attention/reason action coalesces replays and concurrent workers.';
comment on table public.refund_manager_notification_recipients is
  'One-way recipient fingerprints for per-recipient refund manager notification dedupe and delivery audit.';
comment on function public.service_begin_refund_manager_notification(uuid, text, text, text[], text[]) is
  'Service-only policy classifier and atomic reservation. Resolves immediate recipients at send time and stores no raw address.';
comment on function public.service_complete_refund_manager_notification(uuid, uuid, text, text) is
  'Service-only settlement for a claimed manager notification; unknown delivery remains non-retryable.';
comment on function public.service_mark_refund_manager_reminder_digest_eligible(uuid, bigint, uuid) is
  'Moves the two-business-day manager reminder into digest eligibility without reserving or sending an immediate email.';

select pg_notify('pgrst', 'reload schema');
