-- Quiet daily manager digest and the shared, privacy-safe work projection.
-- Delivery is independently disabled in both database and Edge configuration.

create table public.refund_manager_digest_settings (
  singleton boolean primary key default true check (singleton),
  delivery_enabled boolean not null default false,
  digest_timezone text not null default 'America/Los_Angeles'
    check (char_length(digest_timezone) between 1 and 80),
  send_local_hour smallint not null default 8 check (send_local_hour between 0 and 23),
  max_items smallint not null default 8 check (max_items between 1 and 12),
  updated_at timestamptz not null default statement_timestamp()
);

insert into public.refund_manager_digest_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table public.refund_manager_digest_batches (
  id uuid primary key default gen_random_uuid(),
  manager_user_id uuid not null references auth.users (id) on delete cascade,
  digest_local_date date not null,
  digest_timezone text not null check (char_length(digest_timezone) between 1 and 80),
  status text not null check (status in (
    'reserved', 'sent', 'delivery_unknown', 'known_not_sent'
  )),
  claim_token uuid not null,
  attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  mapping_fingerprint text not null check (mapping_fingerprint ~ '^[a-f0-9]{64}$'),
  recipient_fingerprint text not null check (recipient_fingerprint ~ '^[a-f0-9]{64}$'),
  item_count integer not null default 0 check (item_count between 0 and 12),
  duplicate_suppressed_count integer not null default 0
    check (duplicate_suppressed_count between 0 and 1000000),
  oldest_actionable_age_minutes integer
    check (oldest_actionable_age_minutes is null or oldest_actionable_age_minutes >= 0),
  provider_attempt_started_at timestamptz,
  provider_message_id_digest text
    check (provider_message_id_digest is null or provider_message_id_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  settled_at timestamptz,
  unique (manager_user_id, digest_local_date, digest_timezone),
  check (
    (status in ('reserved', 'known_not_sent') and provider_attempt_started_at is null)
    or (status in ('sent', 'delivery_unknown') and provider_attempt_started_at is not null)
  )
);

create table public.refund_manager_digest_items (
  batch_id uuid not null references public.refund_manager_digest_batches (id) on delete cascade,
  manager_user_id uuid not null references auth.users (id) on delete cascade,
  notification_action_id uuid not null
    references public.refund_manager_notification_actions (id) on delete cascade,
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  attention_version bigint not null check (attention_version >= 1),
  item_state text not null default 'included' check (item_state in ('included', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  primary key (batch_id, notification_action_id),
  unique (manager_user_id, refund_case_id, attention_version),
  check (
    (item_state = 'included' and resolved_at is null)
    or (item_state = 'resolved' and resolved_at is not null)
  )
);

create index refund_manager_digest_batch_review_idx
  on public.refund_manager_digest_batches (status, updated_at)
  where status in ('reserved', 'delivery_unknown');
create index refund_manager_digest_item_current_idx
  on public.refund_manager_digest_items (manager_user_id, refund_case_id, attention_version)
  where item_state = 'included';

alter table public.refund_manager_digest_settings enable row level security;
alter table public.refund_manager_digest_batches enable row level security;
alter table public.refund_manager_digest_items enable row level security;
revoke all on table public.refund_manager_digest_settings from public, anon, authenticated;
revoke all on table public.refund_manager_digest_batches from public, anon, authenticated;
revoke all on table public.refund_manager_digest_items from public, anon, authenticated;
grant select on table public.refund_manager_digest_settings to service_role;
grant select, insert, update, delete on table public.refund_manager_digest_batches to service_role;
grant select, insert, update, delete on table public.refund_manager_digest_items to service_role;

alter function public.service_begin_refund_manager_notification(uuid, text, text, text[], text[])
  rename to service_begin_refund_manager_notification_pre_digest_20260911;

revoke all on function public.service_begin_refund_manager_notification_pre_digest_20260911(uuid, text, text, text[], text[])
  from public, anon, authenticated;
grant execute on function public.service_begin_refund_manager_notification_pre_digest_20260911(uuid, text, text, text[], text[])
  to service_role;

create function public.service_begin_refund_manager_notification(
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
  inserted boolean := false;
begin
  if p_notice_reason not in ('customer_reply', 'manager_reminder') then
    return public.service_begin_refund_manager_notification_pre_digest_20260911(
      p_refund_case_id,
      p_notice_reason,
      p_customer_email,
      p_mailbox_identities,
      p_ops_fallback_recipients
    );
  end if;

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

  insert into public.refund_manager_notification_actions (
    refund_case_id, attention_version, notice_reason, channel, urgency,
    delivery_state, settled_at
  ) values (
    p_refund_case_id, attention_version_value, p_notice_reason, 'daily_digest',
    'routine', 'digest_eligible', statement_timestamp()
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
    'reason', case when inserted then 'digest_eligible' else 'duplicate_coalesced' end,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_begin_refund_manager_notification(uuid, text, text, text[], text[])
  from public, anon, authenticated;
grant execute on function public.service_begin_refund_manager_notification(uuid, text, text, text[], text[])
  to service_role;

create function public.refund_manager_work_projection_for(
  p_manager_user_id uuid,
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  original_claims text := current_setting('request.jwt.claims', true);
  original_claim_sub text := current_setting('request.jwt.claim.sub', true);
  case_record record;
  lifecycle jsonb;
  lifecycle_bucket text;
  visible_bucket text;
  action_record record;
  attention_version_value bigint;
  age_minutes_value integer;
  location_label text;
  machine_label text;
  what_changed_value text;
  digest_eligible_value boolean;
  urgent_notice_state_value text;
  items jsonb := '[]'::jsonb;
  bucket_counts jsonb := jsonb_build_object(
    'needs_action', 0, 'ready_to_pay', 0, 'in_progress', 0,
    'provider_hold', 0, 'waiting_on_customer', 0, 'completed', 0
  );
  digest_counts jsonb := jsonb_build_object(
    'needsDecision', 0, 'newInformation', 0,
    'aging', 0, 'exceptionsBeingHandled', 0
  );
  oldest_actionable integer;
  oldest_decision integer;
  recent_change_count integer := 0;
  email_count_today integer := 0;
  duplicates_today integer := 0;
begin
  if p_manager_user_id is null or p_observed_at is null then
    raise exception 'Manager and observation time are required' using errcode = '22023';
  end if;

  perform set_config('request.jwt.claim.sub', p_manager_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_manager_user_id,
      'role', 'authenticated',
      'is_anonymous', false
    )::text,
    true
  );

  for case_record in
    select distinct
      refund_case.id,
      refund_case.public_reference,
      refund_case.created_at,
      refund_case.refund_amount_cents,
      refund_case.matched_nayax_amount_cents,
      refund_case.payment_amount_cents,
      refund_case.matched_nayax_currency_code,
      refund_case.payment_method,
      machine.refund_public_display_label,
      location.name as reporting_location_name
    from public.refund_cases refund_case
    join public.reporting_machine_refund_managers mapping
      on mapping.reporting_machine_id = refund_case.reporting_machine_id
      and mapping.manager_user_id = p_manager_user_id
      and mapping.status = 'active'
      and mapping.revoked_at is null
    join public.reporting_machines machine
      on machine.id = refund_case.reporting_machine_id
    join public.reporting_locations location
      on location.id = refund_case.reporting_location_id
    order by refund_case.created_at, refund_case.id
  loop
    lifecycle := public.refund_lifecycle_contract(case_record.id);
    if lifecycle ->> 'schemaVersion' <> 'refund_lifecycle_v2'
      or lifecycle -> 'managerAction' ->> 'payloadRedacted' <> 'true'
      or lifecycle -> 'managerQueue' ->> 'payloadRedacted' <> 'true' then
      raise exception 'Unsupported refund lifecycle contract' using errcode = 'P4652';
    end if;

    lifecycle_bucket := lifecycle -> 'managerQueue' ->> 'bucket';
    if lifecycle_bucket = 'internal_archive' then continue; end if;
    visible_bucket := case
      when lifecycle_bucket in ('accounting_review', 'integrity_hold') then 'provider_hold'
      else lifecycle_bucket
    end;
    if visible_bucket not in (
      'needs_action', 'ready_to_pay', 'in_progress', 'provider_hold',
      'waiting_on_customer', 'completed'
    ) then
      raise exception 'Unsupported refund manager queue bucket' using errcode = 'P4652';
    end if;

    attention_version_value := 1;
    select coalesce(attention.attention_version, 1)
    into attention_version_value
    from (select 1) singleton
    left join public.refund_manager_attention_states attention
      on attention.refund_case_id = case_record.id;

    select action.id, action.notice_reason, action.channel, action.delivery_state,
      action.urgency, action.attention_version, action.created_at
    into action_record
    from public.refund_manager_notification_actions action
    where action.refund_case_id = case_record.id
      and action.attention_version = attention_version_value
    order by
      case
        when action.channel = 'daily_digest'
          and action.delivery_state = 'digest_eligible'
          and action.notice_reason in ('customer_reply', 'manager_reminder') then 0
        else 1
      end,
      action.created_at desc,
      action.id desc
    limit 1;

    digest_eligible_value := action_record.id is not null
      and action_record.channel = 'daily_digest'
      and action_record.delivery_state = 'digest_eligible'
      and action_record.notice_reason in ('customer_reply', 'manager_reminder');

    select case
      when count(*) filter (where action.delivery_state in ('reserved', 'delivery_unknown', 'known_not_sent')) > 0
        then 'immediate_unresolved'
      when count(*) filter (where action.delivery_state = 'sent') > 0
        then 'immediate_sent'
      else 'none'
    end
    into urgent_notice_state_value
    from public.refund_manager_notification_actions action
    where action.refund_case_id = case_record.id
      and action.attention_version = attention_version_value
      and action.channel = 'immediate'
      and action.urgency = 'urgent';

    age_minutes_value := greatest(
      0,
      floor(extract(epoch from (p_observed_at - case_record.created_at)) / 60)::integer
    );
    machine_label := coalesce(
      nullif(btrim(case_record.refund_public_display_label), ''),
      'Machine not recorded'
    );
    location_label := case
      when lower(btrim(case_record.reporting_location_name)) like 'unmapped %'
        or lower(btrim(case_record.reporting_location_name)) like 'unknown %'
        or lower(btrim(case_record.reporting_location_name)) in ('unmapped', 'unknown')
      then coalesce(nullif(btrim(case_record.refund_public_display_label), ''), 'Bloomjoy location')
      else coalesce(nullif(btrim(case_record.reporting_location_name), ''), 'Location not recorded')
    end;
    what_changed_value := case action_record.notice_reason
      when 'customer_reply' then 'The server recorded a verified customer reply on the linked case.'
      when 'manager_reminder' then 'The server recorded that the manager-attention reminder milestone was reached.'
      when 'hard_bounce' then 'The server recorded a trusted hard delivery failure and paused automatic customer contact.'
      when 'provider_setup' then 'The server recorded that payment-provider mapping is required.'
      when 'provider_outage' then 'The server recorded a temporary payment-provider outage.'
      when 'provider_rejection' then 'The server recorded a rejected payment-provider lookup.'
      when 'provider_timeout' then 'The server recorded a timed-out payment-provider lookup.'
      when 'provider_unknown' then 'The server recorded an inconclusive payment-provider result.'
      when 'manager_escalation' then 'The server recorded that the manager-attention escalation milestone was reached.'
      else 'The current server-owned queue state is ' || (lifecycle -> 'managerQueue' ->> 'label') || '.'
    end;

    bucket_counts := jsonb_set(
      bucket_counts,
      array[visible_bucket],
      to_jsonb((bucket_counts ->> visible_bucket)::integer + 1)
    );
    if visible_bucket in ('needs_action', 'ready_to_pay') then
      digest_counts := jsonb_set(digest_counts, '{needsDecision}',
        to_jsonb((digest_counts ->> 'needsDecision')::integer + 1));
      oldest_decision := greatest(coalesce(oldest_decision, 0), age_minutes_value);
    end if;
    if digest_eligible_value and action_record.notice_reason = 'customer_reply' then
      digest_counts := jsonb_set(digest_counts, '{newInformation}',
        to_jsonb((digest_counts ->> 'newInformation')::integer + 1));
    end if;
    if digest_eligible_value and action_record.notice_reason = 'manager_reminder' then
      digest_counts := jsonb_set(digest_counts, '{aging}',
        to_jsonb((digest_counts ->> 'aging')::integer + 1));
    end if;
    if visible_bucket = 'provider_hold' then
      digest_counts := jsonb_set(digest_counts, '{exceptionsBeingHandled}',
        to_jsonb((digest_counts ->> 'exceptionsBeingHandled')::integer + 1));
    end if;
    if visible_bucket not in ('completed', 'waiting_on_customer') then
      oldest_actionable := greatest(coalesce(oldest_actionable, 0), age_minutes_value);
    end if;
    if action_record.created_at >= p_observed_at - interval '24 hours' then
      recent_change_count := recent_change_count + 1;
    end if;

    if visible_bucket <> 'completed' then
      items := items || jsonb_build_array(jsonb_build_object(
        'caseId', case_record.id,
        'publicReference', case_record.public_reference,
        'amountCents', coalesce(
          case_record.refund_amount_cents,
          case_record.matched_nayax_amount_cents,
          case_record.payment_amount_cents
        ),
        'currencyCode', case_record.matched_nayax_currency_code,
        'machineLabel', machine_label,
        'locationName', location_label,
        'ageMinutes', age_minutes_value,
        'queueBucket', visible_bucket,
        'queueLabel', lifecycle -> 'managerQueue' ->> 'label',
        'actionCode', lifecycle -> 'managerAction' ->> 'action',
        'actionOwner', lifecycle -> 'managerAction' ->> 'owner',
        'lifecycleActor', lifecycle ->> 'actor',
        'whatChanged', what_changed_value,
        'noticeReason', case when digest_eligible_value then action_record.notice_reason else null end,
        'attentionVersion', attention_version_value,
        'digestEligible', digest_eligible_value,
        'urgentNoticeState', urgent_notice_state_value,
        'payloadRedacted', true
      ));
    end if;
  end loop;

  select count(*)::integer, coalesce(sum(batch.duplicate_suppressed_count), 0)::integer
  into email_count_today, duplicates_today
  from public.refund_manager_digest_batches batch
  where batch.manager_user_id = p_manager_user_id
    and batch.digest_local_date = (p_observed_at at time zone batch.digest_timezone)::date
    and batch.status = 'sent';

  select coalesce(jsonb_agg(item order by
    case item ->> 'queueBucket'
      when 'needs_action' then 1 when 'ready_to_pay' then 2
      when 'provider_hold' then 3 when 'in_progress' then 4
      when 'waiting_on_customer' then 5 else 6 end,
    (item ->> 'ageMinutes')::integer desc,
    item ->> 'publicReference'
  ), '[]'::jsonb)
  into items
  from jsonb_array_elements(items) item;

  perform set_config('request.jwt.claims', coalesce(original_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(original_claim_sub, ''), true);

  return jsonb_build_object(
    'schemaVersion', 'refund_manager_work_v1',
    'observedAt', p_observed_at,
    'bucketCounts', bucket_counts,
    'digestCounts', digest_counts,
    'oldestActionableAgeMinutes', oldest_actionable,
    'recentMaterialChangeCount', recent_change_count,
    'items', items,
    'metrics', jsonb_build_object(
      'emailsSentToday', email_count_today,
      'digestEligibleCount', (digest_counts ->> 'newInformation')::integer +
        (digest_counts ->> 'aging')::integer,
      'duplicatesSuppressedToday', duplicates_today,
      'oldestActionableAgeMinutes', oldest_actionable,
      'oldestDecisionAgeMinutes', oldest_decision,
      'payloadRedacted', true
    ),
    'payloadRedacted', true
  );
exception when others then
  perform set_config('request.jwt.claims', coalesce(original_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(original_claim_sub, ''), true);
  raise;
end;
$$;

revoke all on function public.refund_manager_work_projection_for(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_manager_work_projection_for(uuid, timestamptz)
  to service_role;

create function public.get_refund_manager_work_projection(
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  manager_user_id uuid := auth.uid();
begin
  if manager_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reporting_machine_refund_managers mapping
    where mapping.manager_user_id = manager_user_id
      and mapping.status = 'active'
      and mapping.revoked_at is null
  ) then
    return jsonb_build_object(
      'schemaVersion', 'refund_manager_work_v1',
      'observedAt', p_observed_at,
      'bucketCounts', jsonb_build_object(
        'needs_action', 0, 'ready_to_pay', 0, 'in_progress', 0,
        'provider_hold', 0, 'waiting_on_customer', 0, 'completed', 0
      ),
      'digestCounts', jsonb_build_object(
        'needsDecision', 0, 'newInformation', 0,
        'aging', 0, 'exceptionsBeingHandled', 0
      ),
      'oldestActionableAgeMinutes', null,
      'recentMaterialChangeCount', 0,
      'items', '[]'::jsonb,
      'metrics', jsonb_build_object(
        'emailsSentToday', 0, 'digestEligibleCount', 0,
        'duplicatesSuppressedToday', 0,
        'oldestActionableAgeMinutes', null,
        'oldestDecisionAgeMinutes', null,
        'payloadRedacted', true
      ),
      'payloadRedacted', true
    );
  end if;
  return public.refund_manager_work_projection_for(manager_user_id, p_observed_at);
end;
$$;

revoke all on function public.get_refund_manager_work_projection(timestamptz)
  from public, anon;
grant execute on function public.get_refund_manager_work_projection(timestamptz)
  to authenticated;

create function public.service_resolve_refund_manager_digest_items(
  p_observed_at timestamptz default statement_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  resolved_count integer;
begin
  update public.refund_manager_digest_items item
  set item_state = 'resolved', resolved_at = p_observed_at
  where item.item_state = 'included'
    and (
      not exists (
        select 1 from public.reporting_machine_refund_managers mapping
        join public.refund_cases refund_case
          on refund_case.id = item.refund_case_id
          and refund_case.reporting_machine_id = mapping.reporting_machine_id
        where mapping.manager_user_id = item.manager_user_id
          and mapping.status = 'active'
          and mapping.revoked_at is null
      )
      or coalesce((
        select attention.attention_version
        from public.refund_manager_attention_states attention
        where attention.refund_case_id = item.refund_case_id
      ), 1) <> item.attention_version
    );
  get diagnostics resolved_count = row_count;
  return resolved_count;
end;
$$;

create function public.service_begin_next_refund_manager_digest(
  p_observed_at timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  settings_row public.refund_manager_digest_settings;
  manager_record record;
  batch_row public.refund_manager_digest_batches;
  claim_token_value uuid;
  local_date_value date;
  recipient_value text;
  recipient_fingerprint_value text;
  mapping_fingerprint_value text;
  item_count_value integer;
  projection_value jsonb;
  selected_case_ids uuid[];
begin
  select * into settings_row from public.refund_manager_digest_settings where singleton;
  if settings_row.singleton is null or not settings_row.delivery_enabled then
    return jsonb_build_object('claimed', false, 'reason', 'digest_disabled', 'payloadRedacted', true);
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = settings_row.digest_timezone) then
    raise exception 'Configured digest timezone is invalid';
  end if;
  if extract(hour from p_observed_at at time zone settings_row.digest_timezone)::integer
      <> settings_row.send_local_hour then
    return jsonb_build_object('claimed', false, 'reason', 'outside_digest_hour', 'payloadRedacted', true);
  end if;
  perform public.service_resolve_refund_manager_digest_items(p_observed_at);
  local_date_value := (p_observed_at at time zone settings_row.digest_timezone)::date;

  for manager_record in
    select action_manager.manager_user_id
    from (
      select distinct mapping.manager_user_id
      from public.refund_manager_notification_actions action
      join public.refund_cases refund_case on refund_case.id = action.refund_case_id
      join public.reporting_machine_refund_managers mapping
        on mapping.reporting_machine_id = refund_case.reporting_machine_id
        and mapping.status = 'active'
        and mapping.revoked_at is null
      where action.channel = 'daily_digest'
        and action.delivery_state = 'digest_eligible'
        and action.notice_reason in ('customer_reply', 'manager_reminder')
        and action.attention_version = coalesce((
          select attention.attention_version
          from public.refund_manager_attention_states attention
          where attention.refund_case_id = refund_case.id
        ), 1)
    ) action_manager
    order by action_manager.manager_user_id
  loop
    select min(lower(btrim(mapping.manager_email))),
      count(distinct lower(btrim(mapping.manager_email)))
    into recipient_value, item_count_value
    from public.reporting_machine_refund_managers mapping
    where mapping.manager_user_id = manager_record.manager_user_id
      and mapping.status = 'active'
      and mapping.revoked_at is null
      and public.refund_email_address_is_valid(mapping.manager_email);
    if item_count_value <> 1 or recipient_value is null then continue; end if;

    select encode(extensions.digest(convert_to(
      manager_record.manager_user_id::text || '|' || recipient_value || '|' ||
      coalesce(string_agg(mapping.reporting_machine_id::text, ',' order by mapping.reporting_machine_id), ''),
      'UTF8'), 'sha256'), 'hex')
    into mapping_fingerprint_value
    from public.reporting_machine_refund_managers mapping
    where mapping.manager_user_id = manager_record.manager_user_id
      and mapping.status = 'active'
      and mapping.revoked_at is null;
    recipient_fingerprint_value := encode(
      extensions.digest(convert_to(recipient_value, 'UTF8'), 'sha256'), 'hex'
    );
    claim_token_value := gen_random_uuid();

    insert into public.refund_manager_digest_batches (
      manager_user_id, digest_local_date, digest_timezone, status, claim_token,
      mapping_fingerprint, recipient_fingerprint
    ) values (
      manager_record.manager_user_id, local_date_value, settings_row.digest_timezone,
      'reserved', claim_token_value, mapping_fingerprint_value, recipient_fingerprint_value
    )
    on conflict (manager_user_id, digest_local_date, digest_timezone) do nothing
    returning * into batch_row;

    if batch_row.id is null then
      update public.refund_manager_digest_batches batch
      set duplicate_suppressed_count = least(1000000, duplicate_suppressed_count + 1),
          updated_at = p_observed_at
      where batch.manager_user_id = manager_record.manager_user_id
        and batch.digest_local_date = local_date_value
        and batch.digest_timezone = settings_row.digest_timezone
        and batch.status <> 'known_not_sent';

      select * into batch_row
      from public.refund_manager_digest_batches batch
      where batch.manager_user_id = manager_record.manager_user_id
        and batch.digest_local_date = local_date_value
        and batch.digest_timezone = settings_row.digest_timezone
      for update;
      if batch_row.status <> 'known_not_sent' or batch_row.attempt_count >= 3 then
        batch_row := null;
        continue;
      end if;
      delete from public.refund_manager_digest_items item where item.batch_id = batch_row.id;
      update public.refund_manager_digest_batches batch
      set status = 'reserved', claim_token = claim_token_value,
          attempt_count = attempt_count + 1,
          mapping_fingerprint = mapping_fingerprint_value,
          recipient_fingerprint = recipient_fingerprint_value,
          item_count = 0, oldest_actionable_age_minutes = null,
          settled_at = null, updated_at = p_observed_at
      where batch.id = batch_row.id
      returning * into batch_row;
    end if;

    insert into public.refund_manager_digest_items (
      batch_id, manager_user_id, notification_action_id,
      refund_case_id, attention_version
    )
    select batch_row.id, manager_record.manager_user_id, candidate.id,
      candidate.refund_case_id, candidate.attention_version
    from (
      select distinct on (action.refund_case_id)
        action.id, action.refund_case_id, action.attention_version,
        refund_case.created_at
      from public.refund_manager_notification_actions action
      join public.refund_cases refund_case on refund_case.id = action.refund_case_id
      join public.reporting_machine_refund_managers mapping
        on mapping.reporting_machine_id = refund_case.reporting_machine_id
        and mapping.manager_user_id = manager_record.manager_user_id
        and mapping.status = 'active'
        and mapping.revoked_at is null
      where action.channel = 'daily_digest'
        and action.delivery_state = 'digest_eligible'
        and action.notice_reason in ('customer_reply', 'manager_reminder')
        and action.attention_version = coalesce((
          select attention.attention_version
          from public.refund_manager_attention_states attention
          where attention.refund_case_id = refund_case.id
        ), 1)
        and not exists (
          select 1 from public.refund_manager_digest_items existing
          where existing.manager_user_id = manager_record.manager_user_id
            and existing.refund_case_id = refund_case.id
            and existing.attention_version = action.attention_version
        )
      order by action.refund_case_id,
        case action.notice_reason when 'customer_reply' then 1 else 2 end,
        refund_case.created_at,
        action.created_at desc
    ) candidate
    order by candidate.created_at, candidate.refund_case_id
    limit settings_row.max_items
    on conflict (manager_user_id, refund_case_id, attention_version) do nothing;

    select count(*)::integer, array_agg(item.refund_case_id order by item.refund_case_id)
    into item_count_value, selected_case_ids
    from public.refund_manager_digest_items item
    where item.batch_id = batch_row.id and item.item_state = 'included';
    if item_count_value = 0 then
      delete from public.refund_manager_digest_batches where id = batch_row.id;
      batch_row := null;
      continue;
    end if;

    projection_value := public.refund_manager_work_projection_for(
      manager_record.manager_user_id, p_observed_at
    );
    projection_value := jsonb_set(
      projection_value,
      '{items}',
      coalesce((
        select jsonb_agg(value order by ordinality)
        from jsonb_array_elements(projection_value -> 'items') with ordinality entries(value, ordinality)
        where (value ->> 'caseId')::uuid = any(selected_case_ids)
      ), '[]'::jsonb),
      true
    );
    if jsonb_array_length(projection_value -> 'items') = 0 then
      delete from public.refund_manager_digest_batches where id = batch_row.id;
      batch_row := null;
      continue;
    end if;

    update public.refund_manager_digest_batches batch
    set item_count = item_count_value,
        oldest_actionable_age_minutes = (projection_value -> 'metrics' ->> 'oldestActionableAgeMinutes')::integer,
        updated_at = p_observed_at
    where batch.id = batch_row.id;

    return jsonb_build_object(
      'claimed', true,
      'batchId', batch_row.id,
      'claimToken', claim_token_value,
      'recipient', recipient_value,
      'mappingFingerprint', mapping_fingerprint_value,
      'digestLocalDate', local_date_value,
      'digestTimezone', settings_row.digest_timezone,
      'projection', projection_value,
      'payloadRedacted', true
    );
  end loop;

  return jsonb_build_object('claimed', false, 'reason', 'empty', 'payloadRedacted', true);
end;
$$;

create function public.service_mark_refund_manager_digest_provider_started(
  p_batch_id uuid,
  p_claim_token uuid,
  p_mapping_fingerprint text,
  p_recipient text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  batch_row public.refund_manager_digest_batches;
  current_mapping_fingerprint text;
  current_recipient text;
  current_recipient_count integer;
  current_item_count integer;
  machine_id_value uuid;
begin
  select * into batch_row from public.refund_manager_digest_batches
  where id = p_batch_id and claim_token = p_claim_token for update;
  if batch_row.id is null or batch_row.status <> 'reserved' then return false; end if;

  -- Serialize the final authority check with the canonical manager-assignment
  -- mutation. The shared advisory lock is acquired before the same machine row
  -- lock, in stable order, so a concurrent revoke/reassignment commits before
  -- this function re-reads the mapping or waits until provider-start is durable.
  for machine_id_value in
    select distinct refund_case.reporting_machine_id
    from public.refund_manager_digest_items item
    join public.refund_cases refund_case on refund_case.id = item.refund_case_id
    where item.batch_id = batch_row.id and item.item_state = 'included'
      and refund_case.reporting_machine_id is not null
    order by refund_case.reporting_machine_id
  loop
    perform pg_advisory_xact_lock(hashtext('machine_manager:' || machine_id_value::text));
    perform 1 from public.reporting_machines machine
    where machine.id = machine_id_value
    for update;
  end loop;

  select min(lower(btrim(mapping.manager_email))),
    count(distinct lower(btrim(mapping.manager_email))),
    encode(extensions.digest(convert_to(
      batch_row.manager_user_id::text || '|' || min(lower(btrim(mapping.manager_email))) || '|' ||
      coalesce(string_agg(mapping.reporting_machine_id::text, ',' order by mapping.reporting_machine_id), ''),
      'UTF8'), 'sha256'), 'hex')
  into current_recipient, current_recipient_count, current_mapping_fingerprint
  from public.reporting_machine_refund_managers mapping
  where mapping.manager_user_id = batch_row.manager_user_id
    and mapping.status = 'active'
    and mapping.revoked_at is null
    and public.refund_email_address_is_valid(mapping.manager_email);

  update public.refund_manager_digest_items item
  set item_state = 'resolved', resolved_at = statement_timestamp()
  where item.batch_id = batch_row.id and item.item_state = 'included'
    and (
      not exists (
        select 1 from public.refund_cases refund_case
        join public.reporting_machine_refund_managers mapping
          on mapping.reporting_machine_id = refund_case.reporting_machine_id
          and mapping.manager_user_id = batch_row.manager_user_id
          and mapping.status = 'active' and mapping.revoked_at is null
        where refund_case.id = item.refund_case_id
      )
      or coalesce((select attention.attention_version
        from public.refund_manager_attention_states attention
        where attention.refund_case_id = item.refund_case_id), 1) <> item.attention_version
      or not exists (
        select 1 from public.refund_manager_notification_actions action
        where action.id = item.notification_action_id
          and action.delivery_state = 'digest_eligible'
      )
    );
  select count(*)::integer into current_item_count
  from public.refund_manager_digest_items item
  where item.batch_id = batch_row.id and item.item_state = 'included';

  if current_recipient_count <> 1
    or current_recipient is distinct from lower(btrim(coalesce(p_recipient, '')))
    or current_mapping_fingerprint is distinct from p_mapping_fingerprint
    or current_mapping_fingerprint is distinct from batch_row.mapping_fingerprint
    or encode(extensions.digest(convert_to(current_recipient, 'UTF8'), 'sha256'), 'hex')
      is distinct from batch_row.recipient_fingerprint
    or current_item_count <> batch_row.item_count then
    update public.refund_manager_digest_batches
    set status = 'known_not_sent', settled_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where id = batch_row.id;
    return false;
  end if;

  update public.refund_manager_digest_batches
  set status = 'delivery_unknown', provider_attempt_started_at = statement_timestamp(),
      settled_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = batch_row.id;
  return true;
end;
$$;

create function public.service_complete_refund_manager_digest(
  p_batch_id uuid,
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
  batch_row public.refund_manager_digest_batches;
  provider_message_id_value text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  provider_message_id_digest_value text;
begin
  if p_outcome not in ('sent', 'delivery_unknown', 'known_not_sent') then
    raise exception 'Unsupported manager digest outcome';
  end if;
  if p_outcome = 'sent' and provider_message_id_value is null then
    raise exception 'Sent manager digest requires a provider message id';
  end if;
  if p_outcome <> 'sent' and provider_message_id_value is not null then
    raise exception 'Only sent manager digests may record a provider message id';
  end if;
  provider_message_id_digest_value := case when provider_message_id_value is null then null
    else encode(extensions.digest(convert_to(provider_message_id_value, 'UTF8'), 'sha256'), 'hex') end;
  select * into batch_row from public.refund_manager_digest_batches
  where id = p_batch_id and claim_token = p_claim_token for update;
  if batch_row.id is null then return false; end if;

  if batch_row.status = 'sent' then
    if p_outcome = 'sent'
      and batch_row.provider_message_id_digest = provider_message_id_digest_value then
      return true;
    end if;
    raise exception 'Sent manager digest settlement is immutable';
  end if;
  if batch_row.status = 'known_not_sent' then
    if p_outcome = 'known_not_sent' then return true; end if;
    raise exception 'Known-not-sent manager digest settlement is immutable';
  end if;

  if p_outcome = 'known_not_sent' then
    if batch_row.status <> 'reserved' or batch_row.provider_attempt_started_at is not null then
      raise exception 'Only an unstarted reservation may settle known-not-sent';
    end if;
  elsif batch_row.status <> 'delivery_unknown'
    or batch_row.provider_attempt_started_at is null then
    raise exception 'Manager digest must be delivery-unknown after provider start';
  elsif p_outcome = 'delivery_unknown' then
    return true;
  end if;

  update public.refund_manager_digest_batches
  set status = p_outcome,
      provider_message_id_digest = provider_message_id_digest_value,
      settled_at = statement_timestamp(), updated_at = statement_timestamp()
  where id = batch_row.id
    and status = case when p_outcome = 'known_not_sent' then 'reserved' else 'delivery_unknown' end;
  if not found then raise exception 'Manager digest settlement state changed'; end if;
  return true;
end;
$$;

revoke all on function public.service_resolve_refund_manager_digest_items(timestamptz)
  from public, anon, authenticated;
revoke all on function public.service_begin_next_refund_manager_digest(timestamptz)
  from public, anon, authenticated;
revoke all on function public.service_mark_refund_manager_digest_provider_started(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.service_complete_refund_manager_digest(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.service_resolve_refund_manager_digest_items(timestamptz) to service_role;
grant execute on function public.service_begin_next_refund_manager_digest(timestamptz) to service_role;
grant execute on function public.service_mark_refund_manager_digest_provider_started(uuid, uuid, text, text) to service_role;
grant execute on function public.service_complete_refund_manager_digest(uuid, uuid, text, text) to service_role;

comment on table public.refund_manager_digest_settings is
  'Digest-only database kill switch and local schedule. Disabled by default.';
comment on function public.get_refund_manager_work_projection(timestamptz) is
  'Current-mapping, privacy-safe manager work summary using the canonical lifecycle queue and action.';
comment on function public.service_begin_next_refund_manager_digest(timestamptz) is
  'Claims at most one nonempty manager/local-date digest and returns only the exact current recipient plus redacted projection.';

select pg_notify('pgrst', 'reload schema');
