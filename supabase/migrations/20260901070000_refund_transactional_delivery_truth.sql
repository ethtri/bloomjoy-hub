-- #917: persist direct transactional-email provider acceptance and delivery truth.
-- Webhook events are redacted, replay-safe, and can only update the existing
-- message ledger. They never send a message or touch payment/provider actions.

alter table public.refund_case_messages
  add column if not exists delivery_transport text,
  add column if not exists provider_message_id text,
  add column if not exists delivery_state text not null default 'unknown',
  add column if not exists delivery_state_updated_at timestamptz;

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_delivery_transport_check,
  add constraint refund_case_messages_delivery_transport_check check (
    delivery_transport is null or delivery_transport = 'resend'
  ),
  drop constraint if exists refund_case_messages_provider_message_id_check,
  add constraint refund_case_messages_provider_message_id_check check (
    provider_message_id is null
    or provider_message_id ~ '^[A-Za-z0-9_-]{8,255}$'
  ),
  drop constraint if exists refund_case_messages_delivery_state_check,
  add constraint refund_case_messages_delivery_state_check check (
    delivery_state in (
      'unknown', 'accepted', 'deferred', 'delivered',
      'failed', 'bounced', 'complained'
    )
  ),
  drop constraint if exists refund_case_messages_delivery_evidence_check,
  add constraint refund_case_messages_delivery_evidence_check check (
    (delivery_transport is null and provider_message_id is null)
    or delivery_transport = 'resend'
  );

create unique index if not exists refund_case_messages_resend_provider_unique
  on public.refund_case_messages (provider_message_id)
  where delivery_transport = 'resend' and provider_message_id is not null;

-- Historical non-Gmail sends have no provider identifier. Make that absence
-- explicit without guessing delivery or modifying the application send result.
update public.refund_case_messages message
set
  delivery_transport = 'resend',
  delivery_state = 'unknown',
  delivery_state_updated_at = coalesce(message.sent_at, message.created_at)
where message.status = 'sent'
  and message.delivery_transport is null
  and not exists (
    select 1
    from public.refund_cases refund_case
    where refund_case.id = message.refund_case_id
      and refund_case.case_population = 'internal_test'
  )
  and not exists (
    select 1
    from public.refund_gmail_messages gmail_message
    where gmail_message.refund_case_message_id = message.id
  );

create table if not exists public.refund_transactional_delivery_events (
  event_key_digest text primary key
    check (event_key_digest ~ '^[a-f0-9]{64}$'),
  provider_message_id text not null
    check (provider_message_id ~ '^[A-Za-z0-9_-]{8,255}$'),
  delivery_state text not null check (
    delivery_state in (
      'accepted', 'deferred', 'delivered',
      'failed', 'bounced', 'complained'
    )
  ),
  event_at timestamptz not null,
  matched_refund_case_message_id uuid
    references public.refund_case_messages(id) on delete restrict,
  applied_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_transactional_delivery_event_time_check check (
    event_at >= '2026-01-01T00:00:00Z'::timestamptz
    and event_at <= created_at + interval '5 minutes'
  )
);

create index if not exists refund_transactional_delivery_events_provider_idx
  on public.refund_transactional_delivery_events (
    provider_message_id, event_at, event_key_digest
  );

alter table public.refund_transactional_delivery_events enable row level security;
revoke all on table public.refund_transactional_delivery_events
  from public, anon, authenticated;
revoke all on table public.refund_transactional_delivery_events
  from service_role;

create or replace function public.refund_transactional_delivery_state_rank(
  p_state text
)
returns smallint
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_state
    when 'accepted' then 1
    when 'deferred' then 2
    when 'delivered' then 3
    when 'failed' then 4
    when 'bounced' then 5
    when 'complained' then 6
    else 0
  end::smallint;
$$;

create or replace function public.apply_refund_transactional_delivery_events(
  p_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.refund_case_messages%rowtype;
  event_row public.refund_transactional_delivery_events%rowtype;
  next_state text;
  next_event_at timestamptz;
begin
  select message.* into message_row
  from public.refund_case_messages message
  where message.delivery_transport = 'resend'
    and message.provider_message_id = p_provider_message_id
  for update;

  if not found then
    return jsonb_build_object(
      'matched', false,
      'applied', false,
      'payloadRedacted', true
    );
  end if;

  if exists (
    select 1
    from public.refund_cases refund_case
    where refund_case.id = message_row.refund_case_id
      and refund_case.case_population = 'internal_test'
  ) then
    return jsonb_build_object(
      'matched', true,
      'applied', false,
      'internalTestSuppressed', true,
      'payloadRedacted', true
    );
  end if;

  select event.* into event_row
  from public.refund_transactional_delivery_events event
  where event.provider_message_id = p_provider_message_id
  order by
    public.refund_transactional_delivery_state_rank(event.delivery_state) desc,
    event.event_at desc,
    event.event_key_digest
  limit 1;

  if not found then
    return jsonb_build_object(
      'matched', true,
      'applied', false,
      'payloadRedacted', true
    );
  end if;
  if public.refund_transactional_delivery_state_rank(event_row.delivery_state)
      >= public.refund_transactional_delivery_state_rank(message_row.delivery_state) then
    next_state := event_row.delivery_state;
    next_event_at := event_row.event_at;
  else
    next_state := message_row.delivery_state;
    next_event_at := message_row.delivery_state_updated_at;
  end if;

  update public.refund_case_messages message
  set
    delivery_state = next_state,
    delivery_state_updated_at = greatest(
      coalesce(message.delivery_state_updated_at, '-infinity'::timestamptz),
      coalesce(next_event_at, '-infinity'::timestamptz)
    ),
    status = case
      when next_state in ('failed', 'bounced', 'complained') then 'failed'
      else message.status
    end,
    error_message = case next_state
      when 'failed' then 'transactional_delivery_failed'
      when 'bounced' then 'transactional_delivery_bounced'
      when 'complained' then 'transactional_delivery_complained'
      else message.error_message
    end
  where message.id = message_row.id;

  update public.refund_transactional_delivery_events event
  set
    matched_refund_case_message_id = message_row.id,
    applied_at = coalesce(event.applied_at, statement_timestamp())
  where event.provider_message_id = p_provider_message_id;

  return jsonb_build_object(
    'matched', true,
    'applied', true,
    'deliveryState', next_state,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.guard_refund_transactional_delivery_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.delivery_transport = 'resend'
    and old.delivery_state in ('failed', 'bounced', 'complained')
    and new.status = 'sent' then
    new.status := 'failed';
    new.error_message := case old.delivery_state
      when 'bounced' then 'transactional_delivery_bounced'
      when 'complained' then 'transactional_delivery_complained'
      else 'transactional_delivery_failed'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_zz_transactional_delivery_status_guard
  on public.refund_case_messages;
create trigger refund_zz_transactional_delivery_status_guard
before update of status on public.refund_case_messages
for each row execute function public.guard_refund_transactional_delivery_status();

create or replace function public.sync_refund_transactional_delivery_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.delivery_transport = 'resend' and new.provider_message_id is not null then
    perform public.apply_refund_transactional_delivery_events(
      new.provider_message_id
    );
  end if;
  return null;
end;
$$;

drop trigger if exists refund_transactional_delivery_bind_sync
  on public.refund_case_messages;
create trigger refund_transactional_delivery_bind_sync
after update of provider_message_id on public.refund_case_messages
for each row
when (new.provider_message_id is not null)
execute function public.sync_refund_transactional_delivery_events();

create or replace function public.service_mark_refund_transactional_delivery_attempt(
  p_refund_case_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.refund_case_messages%rowtype;
begin
  select message.* into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;

  if not found or message_row.status not in ('pending', 'failed') then
    raise exception 'Refund customer message is not ready for delivery'
      using errcode = 'P4651';
  end if;
  if exists (
    select 1
    from public.refund_cases refund_case
    where refund_case.id = message_row.refund_case_id
      and refund_case.case_population = 'internal_test'
  ) then
    raise exception 'Customer delivery is suppressed for Internal/test cases'
      using errcode = 'P4640';
  end if;
  if exists (
    select 1 from public.refund_gmail_messages gmail_message
    where gmail_message.refund_case_message_id = message_row.id
  ) then
    raise exception 'Refund customer message already uses Gmail transport'
      using errcode = 'P4651';
  end if;

  update public.refund_case_messages message
  set
    delivery_transport = 'resend',
    delivery_state = 'unknown',
    delivery_state_updated_at = coalesce(
      message.delivery_state_updated_at,
      statement_timestamp()
    )
  where message.id = message_row.id;

  return jsonb_build_object(
    'marked', true,
    'deliveryState', 'unknown',
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_bind_refund_transactional_delivery(
  p_refund_case_message_id uuid,
  p_provider_message_id text,
  p_accepted_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.refund_case_messages%rowtype;
  normalized_provider_message_id text := btrim(coalesce(p_provider_message_id, ''));
  result jsonb;
begin
  if p_refund_case_message_id is null
    or normalized_provider_message_id !~ '^[A-Za-z0-9_-]{8,255}$'
    or p_accepted_at is null
    or p_accepted_at > statement_timestamp() + interval '5 minutes'
    or p_accepted_at < statement_timestamp() - interval '1 day' then
    raise exception 'Exact transactional delivery evidence is required'
      using errcode = 'P4650';
  end if;

  select message.* into message_row
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;

  if not found then
    raise exception 'Refund customer message not found' using errcode = 'P4650';
  end if;
  if exists (
    select 1
    from public.refund_cases refund_case
    where refund_case.id = message_row.refund_case_id
      and refund_case.case_population = 'internal_test'
  ) then
    raise exception 'Customer delivery evidence is suppressed for Internal/test cases'
      using errcode = 'P4640';
  end if;
  if message_row.status not in ('pending', 'sent', 'failed') then
    raise exception 'Refund customer message cannot bind provider delivery'
      using errcode = 'P4651';
  end if;
  if message_row.provider_message_id is not null
    and message_row.provider_message_id <> normalized_provider_message_id then
    raise exception 'Refund customer message already has different provider evidence'
      using errcode = 'P4651';
  end if;
  if exists (
    select 1 from public.refund_gmail_messages gmail_message
    where gmail_message.refund_case_message_id = message_row.id
  ) then
    raise exception 'Refund customer message already uses Gmail transport'
      using errcode = 'P4651';
  end if;

  update public.refund_case_messages message
  set
    delivery_transport = 'resend',
    provider_message_id = normalized_provider_message_id,
    delivery_state = case
      when public.refund_transactional_delivery_state_rank(message.delivery_state) > 1
        then message.delivery_state
      else 'accepted'
    end,
    delivery_state_updated_at = greatest(
      coalesce(message.delivery_state_updated_at, '-infinity'::timestamptz),
      p_accepted_at
    )
  where message.id = message_row.id;

  result := public.apply_refund_transactional_delivery_events(
    normalized_provider_message_id
  );
  return result || jsonb_build_object(
    'bound', true,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_record_refund_transactional_delivery_event(
  p_event_key_digest text,
  p_provider_message_id text,
  p_delivery_state text,
  p_event_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  result jsonb;
begin
  if p_event_key_digest !~ '^[a-f0-9]{64}$'
    or btrim(coalesce(p_provider_message_id, '')) !~ '^[A-Za-z0-9_-]{8,255}$'
    or p_delivery_state not in (
      'accepted', 'deferred', 'delivered',
      'failed', 'bounced', 'complained'
    )
    or p_event_at is null
    or p_event_at > statement_timestamp() + interval '5 minutes'
    or p_event_at < '2026-01-01T00:00:00Z'::timestamptz then
    raise exception 'Valid redacted delivery event evidence is required'
      using errcode = 'P4650';
  end if;

  insert into public.refund_transactional_delivery_events (
    event_key_digest, provider_message_id, delivery_state, event_at
  ) values (
    p_event_key_digest, btrim(p_provider_message_id), p_delivery_state,
    p_event_at
  ) on conflict (event_key_digest) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    return jsonb_build_object(
      'duplicate', true,
      'matched', exists (
        select 1 from public.refund_transactional_delivery_events event
        where event.event_key_digest = p_event_key_digest
          and event.matched_refund_case_message_id is not null
      ),
      'applied', false,
      'payloadRedacted', true
    );
  end if;

  result := public.apply_refund_transactional_delivery_events(
    btrim(p_provider_message_id)
  );
  return result || jsonb_build_object(
    'duplicate', false,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.refund_transactional_delivery_state_rank(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.apply_refund_transactional_delivery_events(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.guard_refund_transactional_delivery_status()
  from public, anon, authenticated, service_role;
revoke execute on function public.sync_refund_transactional_delivery_events()
  from public, anon, authenticated, service_role;
revoke execute on function public.service_mark_refund_transactional_delivery_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.service_mark_refund_transactional_delivery_attempt(uuid)
  to service_role;
revoke execute on function public.service_bind_refund_transactional_delivery(
  uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.service_bind_refund_transactional_delivery(
  uuid, text, timestamptz
) to service_role;
revoke execute on function public.service_record_refund_transactional_delivery_event(
  text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.service_record_refund_transactional_delivery_event(
  text, text, text, timestamptz
) to service_role;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_delivery_truth_v1;

revoke execute on function
  public.admin_get_refund_operations_overview_pre_delivery_truth_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  projected_cases jsonb;
begin
  base_result := public.admin_get_refund_operations_overview_pre_delivery_truth_v1();

  select coalesce(jsonb_agg(
    case
      when latest_delivery.actionable then
        item.case_json || jsonb_build_object(
          'messages', message_projection.messages_json,
          'customerDeliveryException', jsonb_build_object(
            'schemaVersion', 'refund_transactional_delivery_v1',
            'state', latest_delivery.effective_state,
            'messageType', latest_delivery.message_type,
            'occurredAt', latest_delivery.state_at,
            'recoveryOwner', 'refund_operations',
            'nextAction', 'review_delivery_no_resend',
            'customerMessageReplayAllowed', false,
            'paymentReplayAllowed', false,
            'payloadRedacted', true
          ),
          'lifecycle', (item.case_json -> 'lifecycle') || jsonb_build_object(
            'managerNextAction', 'review_customer_delivery',
            'managerQueue', coalesce(
              item.case_json -> 'lifecycle' -> 'managerQueue', '{}'::jsonb
            ) || jsonb_build_object(
              'bucket', 'needs_action',
              'label', 'Delivery review',
              'nextAction', 'review_customer_delivery',
              'safeRetryEligible', false,
              'payloadRedacted', true
            )
          )
        )
      else item.case_json || jsonb_build_object(
        'messages', message_projection.messages_json,
        'customerDeliveryException', null
      )
    end order by item.case_order
  ), '[]'::jsonb)
  into projected_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order)
  left join lateral (
    select coalesce(jsonb_agg(
      message_item.message_json || jsonb_build_object(
        'deliveryTransport', message_row.delivery_transport,
        'deliveryState', case
          when message_row.delivery_transport = 'resend'
            and message_row.delivery_state = 'accepted'
            and message_row.delivery_state_updated_at <
              statement_timestamp() - interval '15 minutes'
            then 'unknown'
          else message_row.delivery_state
        end,
        'deliveryStateUpdatedAt', message_row.delivery_state_updated_at,
        'providerEvidenceAvailable', message_row.provider_message_id is not null
      ) order by message_item.message_order
    ), '[]'::jsonb) as messages_json
    from jsonb_array_elements(coalesce(item.case_json -> 'messages', '[]'::jsonb))
      with ordinality message_item(message_json, message_order)
    left join public.refund_case_messages message_row
      on message_row.id = (message_item.message_json ->> 'id')::uuid
  ) message_projection on true
  left join lateral (
    select
      message.message_type,
      case
        when message.delivery_state = 'accepted'
          and message.delivery_state_updated_at <
            statement_timestamp() - interval '15 minutes'
          then 'unknown'
        else message.delivery_state
      end as effective_state,
      coalesce(message.delivery_state_updated_at, message.created_at) as state_at,
      case
        when message.delivery_state = 'accepted'
          and message.delivery_state_updated_at >=
            statement_timestamp() - interval '15 minutes'
          then false
        when message.delivery_state = 'delivered' then false
        else true
      end as actionable
    from public.refund_case_messages message
    where message.refund_case_id = (item.case_json ->> 'id')::uuid
      and message.delivery_transport = 'resend'
    order by coalesce(message.delivery_state_updated_at, message.created_at) desc,
      message.id
    limit 1
  ) latest_delivery on true;

  return jsonb_set(
    base_result || jsonb_build_object(
      'transactionalDeliveryContractVersion',
      'refund_transactional_delivery_v1'
    ),
    '{cases}', projected_cases, true
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with redacted direct-email acceptance/delivery truth and no-resend manager recovery.';

select pg_notify('pgrst', 'reload schema');
