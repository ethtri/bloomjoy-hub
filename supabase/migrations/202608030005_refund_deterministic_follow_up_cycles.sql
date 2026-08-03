-- Deterministic, bounded customer follow-up cycles for refund inbox assistance.
--
-- This migration is production-off by default. It gives service code a narrow,
-- versioned contract for requesting missing facts, reporting a confirmed safe
-- no-match, sending one reminder, and acknowledging one verified customer
-- reply. It does not grant payment authority or permit GPT prose to auto-send.

create table if not exists public.refund_customer_contact_settings (
  singleton boolean primary key default true check (singleton),
  automatic_customer_contact_enabled boolean not null default false,
  template_version text not null default 'refund_follow_up_v1'
    check (template_version = 'refund_follow_up_v1'),
  reminder_delay_hours integer not null default 72
    check (reminder_delay_hours between 24 and 168),
  updated_at timestamptz not null default statement_timestamp(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.refund_customer_contact_settings (singleton)
values (true)
on conflict (singleton) do nothing;

drop trigger if exists refund_customer_contact_settings_set_updated_at
  on public.refund_customer_contact_settings;
create trigger refund_customer_contact_settings_set_updated_at
before update on public.refund_customer_contact_settings
for each row execute function public.set_updated_at();

alter table public.refund_customer_contact_settings enable row level security;
revoke all on table public.refund_customer_contact_settings
  from public, anon, authenticated;
grant select, update on table public.refund_customer_contact_settings
  to service_role;

alter function public.service_issue_refund_wallet_correction(uuid, text, timestamptz)
  rename to service_issue_refund_wallet_correction_pre_followup_20260803;

revoke execute on function public.service_issue_refund_wallet_correction_pre_followup_20260803(
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;
revoke execute on function public.service_issue_refund_wallet_correction_pre_followup_20260803(
  uuid,
  text,
  timestamptz
) from service_role;

create function public.service_issue_refund_wallet_correction(
  p_refund_case_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.refund_customer_contact_settings settings
    where settings.singleton
      and settings.automatic_customer_contact_enabled
  ) then
    raise exception 'Automatic customer contact is disabled'
      using errcode = '23514';
  end if;

  return public.service_issue_refund_wallet_correction_pre_followup_20260803(
    p_refund_case_id,
    p_token_hash,
    p_expires_at
  );
end;
$$;

revoke execute on function public.service_issue_refund_wallet_correction(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_issue_refund_wallet_correction(uuid, text, timestamptz)
  to service_role;

alter table public.refund_cases
  add column if not exists deterministic_fact_version bigint not null default 1,
  add column if not exists deterministic_facts_updated_at timestamptz not null
    default statement_timestamp(),
  add column if not exists cash_match_evaluated_fact_version bigint;

alter table public.refund_cases
  drop constraint if exists refund_cases_deterministic_fact_version_check,
  add constraint refund_cases_deterministic_fact_version_check
    check (deterministic_fact_version >= 1),
  drop constraint if exists refund_cases_cash_match_evaluated_fact_version_check,
  add constraint refund_cases_cash_match_evaluated_fact_version_check
    check (
      cash_match_evaluated_fact_version is null
      or cash_match_evaluated_fact_version between 1 and deterministic_fact_version
    );

alter table public.refund_cases
  drop constraint if exists refund_cases_automation_state_check;

alter table public.refund_cases
  add constraint refund_cases_automation_state_check
  check (automation_state in (
    'submitted',
    'under_review',
    'more_info_needed',
    'customer_replied',
    'customer_reply_review',
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

create or replace function public.guard_refund_deterministic_fact_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reporting_machine_id is distinct from old.reporting_machine_id
    or new.reporting_location_id is distinct from old.reporting_location_id
    or new.incident_at is distinct from old.incident_at
    or new.incident_local_datetime is distinct from old.incident_local_datetime
    or new.incident_timezone is distinct from old.incident_timezone
    or new.incident_time_resolution is distinct from old.incident_time_resolution
    or new.payment_method is distinct from old.payment_method
    or new.payment_amount_cents is distinct from old.payment_amount_cents
    or new.card_last4 is distinct from old.card_last4
    or new.card_wallet_used is distinct from old.card_wallet_used then
    new.deterministic_fact_version := old.deterministic_fact_version + 1;
    new.deterministic_facts_updated_at := statement_timestamp();
    new.cash_match_evaluated_fact_version := null;
  else
    -- The version is derived evidence, never a caller-controlled counter.
    new.deterministic_fact_version := old.deterministic_fact_version;
    new.deterministic_facts_updated_at := old.deterministic_facts_updated_at;
  end if;

  return new;
end;
$$;

drop trigger if exists refund_cases_guard_deterministic_fact_version
  on public.refund_cases;
create trigger refund_cases_guard_deterministic_fact_version
before update of
  reporting_machine_id,
  reporting_location_id,
  incident_at,
  incident_local_datetime,
  incident_timezone,
  incident_time_resolution,
  payment_method,
  payment_amount_cents,
  card_last4,
  card_wallet_used,
  deterministic_fact_version,
  deterministic_facts_updated_at
on public.refund_cases
for each row execute function public.guard_refund_deterministic_fact_version();

create or replace function public.canonical_refund_follow_up_fields(p_fields text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  with allowed(value, position) as (
    values
      ('location_or_machine'::text, 1),
      ('incident_date'::text, 2),
      ('incident_time'::text, 3),
      ('payment_method'::text, 4),
      ('amount'::text, 5),
      ('card_last4'::text, 6)
  ), selected as (
    select distinct allowed.value, allowed.position
    from unnest(coalesce(p_fields, '{}'::text[])) entry
    join allowed on allowed.value = entry
  )
  select coalesce(array_agg(value order by position), '{}'::text[])
  from selected;
$$;

create or replace function public.refund_missing_follow_up_fields(p_refund_case_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select public.canonical_refund_follow_up_fields(array[
    case
      when refund_case.reporting_machine_id is null
        and refund_case.reporting_location_id is null
      then 'location_or_machine'
    end,
    case when refund_case.incident_at is null then 'incident_date' end,
    case
      when refund_case.incident_at is null
        or refund_case.incident_time_resolution is null
        or refund_case.incident_time_resolution not in ('exact', 'legacy_absolute')
      then 'incident_time'
    end,
    case when refund_case.payment_method is null then 'payment_method' end,
    case
      when refund_case.payment_amount_cents is null
        or refund_case.payment_amount_cents <= 0
      then 'amount'
    end,
    case
      when refund_case.payment_method = 'card'
        and refund_case.card_wallet_used is false
        and refund_case.card_last4 is null
      then 'card_last4'
    end
  ]::text[])
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;
$$;

create or replace function public.refund_gmail_message_is_verified_customer(
  p_message_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_message_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_gmail_messages message
      where message.id = p_message_id
        and message.refund_case_id = p_refund_case_id
        and message.direction = 'inbound'
        and message.message_kind = 'message'
        and message.status = 'received'
        and message.participant_role = 'customer'
        and message.participant_trust = 'verified'
        and message.content_deleted_at is null
    );
$$;

create table if not exists public.refund_follow_up_cycles (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null
    references public.refund_cases (id) on delete cascade,
  cycle_number smallint not null check (cycle_number between 1 and 2),
  trigger_fingerprint text not null
    check (trigger_fingerprint ~ '^[a-f0-9]{64}$'),
  reason_code text not null
    check (reason_code in ('missing_information', 'no_safe_match')),
  requested_fields text[] not null default '{}'::text[],
  template_version text not null
    check (template_version = 'refund_follow_up_v1'),
  case_fact_version bigint not null check (case_fact_version >= 1),
  reminder_delay_hours integer not null check (reminder_delay_hours between 24 and 168),
  source_customer_message_id uuid,
  status text not null default 'claimed'
    check (status in ('claimed', 'waiting', 'customer_replied', 'closed', 'failed', 'manual_review')),
  request_message_id uuid,
  request_created_at timestamptz,
  request_sent_at timestamptz,
  reminder_due_at timestamptz,
  reminder_claimed_at timestamptz,
  reminder_message_id uuid,
  reminder_created_at timestamptz,
  reminder_sent_at timestamptz,
  reply_customer_message_id uuid,
  reply_received_at timestamptz,
  recheck_claimed_at timestamptz,
  receipt_message_id uuid,
  receipt_created_at timestamptz,
  receipt_sent_at timestamptz,
  failed_message_id uuid,
  failed_at timestamptz,
  failure_code text check (
    failure_code is null or failure_code ~ '^[a-z0-9_:-]{3,80}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint refund_follow_up_cycles_case_number_unique
    unique (refund_case_id, cycle_number),
  constraint refund_follow_up_cycles_case_fingerprint_unique
    unique (refund_case_id, trigger_fingerprint),
  constraint refund_follow_up_cycles_request_message_unique
    unique (request_message_id),
  constraint refund_follow_up_cycles_reminder_message_unique
    unique (reminder_message_id),
  constraint refund_follow_up_cycles_reply_message_unique
    unique (reply_customer_message_id),
  constraint refund_follow_up_cycles_receipt_message_unique
    unique (receipt_message_id),
  constraint refund_follow_up_cycles_requested_fields_canonical check (
    requested_fields = public.canonical_refund_follow_up_fields(requested_fields)
  ),
  constraint refund_follow_up_cycles_reason_fields_shape check (
    (reason_code = 'missing_information' and cardinality(requested_fields) > 0)
    or (reason_code = 'no_safe_match' and cardinality(requested_fields) = 0)
  )
);

create unique index if not exists refund_follow_up_one_active_cycle_per_case_idx
  on public.refund_follow_up_cycles (refund_case_id)
  where status in ('claimed', 'waiting', 'customer_replied');

create index if not exists refund_follow_up_cycles_due_reminder_idx
  on public.refund_follow_up_cycles (reminder_due_at, id)
  where status = 'waiting'
    and reminder_message_id is null
    and reminder_claimed_at is null
    and reply_customer_message_id is null;

alter table public.refund_follow_up_cycles enable row level security;
revoke all on table public.refund_follow_up_cycles
  from public, anon, authenticated;
grant select, insert, update on table public.refund_follow_up_cycles
  to service_role;

alter table public.refund_case_messages
  add column if not exists content_source text,
  add column if not exists delivery_kind text,
  add column if not exists reason_code text,
  add column if not exists template_version text,
  add column if not exists follow_up_cycle_id uuid
    references public.refund_follow_up_cycles (id) on delete restrict,
  add column if not exists requested_fields text[] not null default '{}'::text[];

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_message_type_check,
  add constraint refund_case_messages_message_type_check
    check (message_type in (
      'confirmation',
      'more_info',
      'no_safe_match',
      'reminder',
      'information_received',
      'wallet_correction',
      'wallet_correction_reminder',
      'status_update',
      'approved',
      'denied',
      'completed',
      'escalation',
      'manual_note'
    )),
  drop constraint if exists refund_case_messages_content_source_check,
  add constraint refund_case_messages_content_source_check check (
    content_source is null
    or content_source in ('deterministic_template', 'manager_reviewed_gpt', 'manager_authored')
  ),
  drop constraint if exists refund_case_messages_delivery_kind_check,
  add constraint refund_case_messages_delivery_kind_check check (
    delivery_kind is null or delivery_kind in ('automatic', 'manual')
  ),
  drop constraint if exists refund_case_messages_reason_code_check,
  add constraint refund_case_messages_reason_code_check check (
    reason_code is null or reason_code in ('missing_information', 'no_safe_match')
  ),
  drop constraint if exists refund_case_messages_requested_fields_canonical,
  add constraint refund_case_messages_requested_fields_canonical check (
    requested_fields = public.canonical_refund_follow_up_fields(requested_fields)
  ),
  drop constraint if exists refund_case_messages_safe_evidence_shape,
  add constraint refund_case_messages_safe_evidence_shape check (
    (
      delivery_kind is null
      and content_source is null
      and reason_code is null
      and template_version is null
      and follow_up_cycle_id is null
      and cardinality(requested_fields) = 0
    )
    or (
      delivery_kind = 'manual'
      and content_source in ('deterministic_template', 'manager_reviewed_gpt', 'manager_authored')
      and follow_up_cycle_id is null
      and (
        (
          message_type = 'more_info'
          and content_source in ('manager_reviewed_gpt', 'manager_authored')
          and reason_code = 'missing_information'
          and cardinality(requested_fields) > 0
          and template_version is null
        )
        or (
          message_type <> 'more_info'
          and reason_code is null
          and cardinality(requested_fields) = 0
          and (
            (content_source = 'deterministic_template' and template_version is not null)
            or (content_source <> 'deterministic_template' and template_version is null)
          )
        )
      )
    )
    or (
      delivery_kind = 'automatic'
      and content_source = 'deterministic_template'
      and (
        (
          reason_code in ('missing_information', 'no_safe_match')
          and template_version = 'refund_follow_up_v1'
          and follow_up_cycle_id is not null
          and message_type in ('more_info', 'no_safe_match', 'reminder', 'information_received')
        )
        or (
          message_type in ('wallet_correction', 'wallet_correction_reminder')
          and reason_code is null
          and template_version = case message_type
            when 'wallet_correction' then 'refund_wallet_correction_v1'
            else 'refund_wallet_correction_reminder_v1'
          end
          and follow_up_cycle_id is null
          and cardinality(requested_fields) = 0
        )
      )
    )
  );

create unique index if not exists refund_case_messages_one_cycle_request_idx
  on public.refund_case_messages (follow_up_cycle_id)
  where follow_up_cycle_id is not null
    and message_type in ('more_info', 'no_safe_match');

create unique index if not exists refund_case_messages_one_cycle_reminder_idx
  on public.refund_case_messages (follow_up_cycle_id)
  where follow_up_cycle_id is not null
    and message_type = 'reminder';

create unique index if not exists refund_case_messages_one_cycle_receipt_idx
  on public.refund_case_messages (follow_up_cycle_id)
  where follow_up_cycle_id is not null
    and message_type = 'information_received';

create or replace function public.guard_refund_follow_up_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  existing_count integer;
  existing_max smallint;
  existing_fact_version bigint;
  expected_missing text[] := '{}'::text[];
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(
      hashtextextended('refund_follow_up_cycle:' || new.refund_case_id::text, 0)
    );

    select * into case_row
    from public.refund_cases
    where id = new.refund_case_id
    for update;

    if case_row.id is null then
      raise exception 'Refund case not found';
    end if;

    select
      count(*)::integer,
      coalesce(max(cycle_number), 0)::smallint,
      coalesce(max(case_fact_version), 0)::bigint
    into existing_count, existing_max, existing_fact_version
    from public.refund_follow_up_cycles
    where refund_case_id = new.refund_case_id;

    if existing_count >= 2 then
      raise exception 'Refund follow-up contact limit reached'
        using errcode = '23514';
    end if;
    if new.cycle_number <> existing_max + 1 then
      raise exception 'Refund follow-up cycle number must be sequential'
        using errcode = '23514';
    end if;
    if existing_count > 0 and new.case_fact_version <= existing_fact_version then
      raise exception 'A new refund follow-up cycle requires material fact progress'
        using errcode = '23514';
    end if;
    if new.case_fact_version <> case_row.deterministic_fact_version then
      raise exception 'Refund follow-up cycle facts are stale'
        using errcode = '23514';
    end if;
    if new.source_customer_message_id is not null
      and not public.refund_gmail_message_is_verified_customer(
        new.source_customer_message_id,
        new.refund_case_id
      ) then
      raise exception 'Verified customer source message required'
        using errcode = '23514';
    end if;

    expected_missing := coalesce(
      public.refund_missing_follow_up_fields(new.refund_case_id),
      '{}'::text[]
    );

    if new.reason_code = 'missing_information' then
      if case_row.card_wallet_used is true then
        raise exception 'Wallet cases must use the secure correction flow'
          using errcode = '23514';
      end if;
      if cardinality(expected_missing) = 0
        or new.requested_fields <> expected_missing then
        raise exception 'Missing-information cycle must request every and only missing fact'
          using errcode = '23514';
      end if;
    elsif new.reason_code = 'no_safe_match' then
      if cardinality(expected_missing) <> 0
        or not (
          (
            case_row.payment_method = 'card'
            and case_row.card_wallet_used is false
            and case_row.correlation_status = 'no_match'
            and case_row.correlation_source = 'nayax'
            and case_row.nayax_recommendation_state = 'no_safe_match'
            and nullif(
              btrim(coalesce(case_row.nayax_recommendation_policy_version, '')),
              ''
            ) is not null
            and case_row.nayax_recommendation_evaluated_at is not null
            and case_row.nayax_recommendation_evaluated_at >= case_row.deterministic_facts_updated_at
            and case_row.nayax_match_execution_eligible is not true
            and case_row.matched_nayax_transaction_id is null
          )
          or (
            case_row.payment_method = 'cash'
            and case_row.card_wallet_used is false
            and case_row.correlation_status = 'no_match'
            and case_row.correlation_source = 'sunze'
            and nullif(btrim(coalesce(case_row.correlation_summary, '')), '') is not null
            and case_row.matched_sales_fact_id is null
            and case_row.cash_match_evaluated_fact_version = case_row.deterministic_fact_version
            and case_row.matched_nayax_transaction_id is null
            and case_row.nayax_match_execution_eligible is not true
          )
        ) then
        raise exception 'Confirmed deterministic no-safe-match evidence required'
          using errcode = '23514';
      end if;
    end if;

    if case_row.status in ('approved', 'denied', 'completed', 'closed')
      or case_row.decision is not null then
      raise exception 'Terminal refund case cannot start customer follow-up'
        using errcode = '23514';
    end if;

    if new.status <> 'claimed'
      or new.request_message_id is not null
      or new.request_created_at is not null
      or new.request_sent_at is not null
      or new.reminder_due_at is not null
      or new.reminder_claimed_at is not null
      or new.reminder_message_id is not null
      or new.reminder_created_at is not null
      or new.reminder_sent_at is not null
      or new.reply_customer_message_id is not null
      or new.reply_received_at is not null
      or new.recheck_claimed_at is not null
      or new.receipt_message_id is not null
      or new.receipt_created_at is not null
      or new.receipt_sent_at is not null
      or new.failed_message_id is not null
      or new.failed_at is not null
      or new.failure_code is not null then
      raise exception 'New refund follow-up cycle must start unclaimed by transport'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.refund_case_id is distinct from old.refund_case_id
    or new.cycle_number is distinct from old.cycle_number
    or new.trigger_fingerprint is distinct from old.trigger_fingerprint
    or new.reason_code is distinct from old.reason_code
    or new.requested_fields is distinct from old.requested_fields
    or new.template_version is distinct from old.template_version
    or new.case_fact_version is distinct from old.case_fact_version
    or new.reminder_delay_hours is distinct from old.reminder_delay_hours
    or new.source_customer_message_id is distinct from old.source_customer_message_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Refund follow-up cycle evidence is immutable'
      using errcode = '23514';
  end if;

  if old.request_message_id is not null
    and new.request_message_id is distinct from old.request_message_id
    or old.request_created_at is not null
      and new.request_created_at is distinct from old.request_created_at
    or old.request_sent_at is not null
      and new.request_sent_at is distinct from old.request_sent_at
    or old.reminder_due_at is not null
      and new.reminder_due_at is distinct from old.reminder_due_at
    or old.reminder_claimed_at is not null
      and new.reminder_claimed_at is distinct from old.reminder_claimed_at
    or old.reminder_message_id is not null
      and new.reminder_message_id is distinct from old.reminder_message_id
    or old.reminder_created_at is not null
      and new.reminder_created_at is distinct from old.reminder_created_at
    or old.reminder_sent_at is not null
      and new.reminder_sent_at is distinct from old.reminder_sent_at
    or old.reply_customer_message_id is not null
      and new.reply_customer_message_id is distinct from old.reply_customer_message_id
    or old.reply_received_at is not null
      and new.reply_received_at is distinct from old.reply_received_at
    or old.recheck_claimed_at is not null
      and new.recheck_claimed_at is distinct from old.recheck_claimed_at
    or old.receipt_message_id is not null
      and new.receipt_message_id is distinct from old.receipt_message_id
    or old.receipt_created_at is not null
      and new.receipt_created_at is distinct from old.receipt_created_at
    or old.receipt_sent_at is not null
      and new.receipt_sent_at is distinct from old.receipt_sent_at
    or old.failed_message_id is not null
      and new.failed_message_id is distinct from old.failed_message_id
    or old.failed_at is not null
      and new.failed_at is distinct from old.failed_at
    or old.failure_code is not null
      and new.failure_code is distinct from old.failure_code then
    raise exception 'Refund follow-up delivery evidence cannot be replaced or cleared'
      using errcode = '23514';
  end if;

  if old.status = 'claimed' and new.status not in ('claimed', 'waiting', 'failed', 'manual_review')
    or old.status = 'waiting' and new.status not in ('waiting', 'customer_replied', 'failed', 'manual_review')
    or old.status = 'customer_replied' and new.status not in ('customer_replied', 'closed', 'failed', 'manual_review')
    or old.status in ('closed', 'failed', 'manual_review') and new.status <> old.status then
    raise exception 'Invalid refund follow-up cycle transition'
      using errcode = '23514';
  end if;

  if new.request_message_id is not null and not exists (
    select 1
    from public.refund_case_messages message
    where message.id = new.request_message_id
      and message.refund_case_id = new.refund_case_id
      and message.follow_up_cycle_id = new.id
      and message.delivery_kind = 'automatic'
      and message.message_type in ('more_info', 'no_safe_match')
      and message.created_at = new.request_created_at
      and (
        new.request_sent_at is null
        or (message.status = 'sent' and message.sent_at = new.request_sent_at)
      )
  ) then
    raise exception 'Valid immutable request message evidence required'
      using errcode = '23514';
  end if;

  if new.reminder_message_id is not null and not exists (
    select 1
    from public.refund_case_messages message
    where message.id = new.reminder_message_id
      and message.refund_case_id = new.refund_case_id
      and message.follow_up_cycle_id = new.id
      and message.delivery_kind = 'automatic'
      and message.message_type = 'reminder'
      and message.created_at = new.reminder_created_at
      and (
        new.reminder_sent_at is null
        or (message.status = 'sent' and message.sent_at = new.reminder_sent_at)
      )
  ) then
    raise exception 'Valid immutable reminder message evidence required'
      using errcode = '23514';
  end if;

  if new.reply_customer_message_id is not null and (
    not public.refund_gmail_message_is_verified_customer(
      new.reply_customer_message_id,
      new.refund_case_id
    )
    or not exists (
      select 1
      from public.refund_gmail_messages message
      where message.id = new.reply_customer_message_id
        and message.received_at = new.reply_received_at
    )
  ) then
    raise exception 'Valid immutable verified customer reply evidence required'
      using errcode = '23514';
  end if;

  if new.receipt_message_id is not null and not exists (
    select 1
    from public.refund_case_messages message
    where message.id = new.receipt_message_id
      and message.refund_case_id = new.refund_case_id
      and message.follow_up_cycle_id = new.id
      and message.delivery_kind = 'automatic'
      and message.message_type = 'information_received'
      and message.created_at = new.receipt_created_at
      and (
        new.receipt_sent_at is null
        or (message.status = 'sent' and message.sent_at = new.receipt_sent_at)
      )
  ) then
    raise exception 'Valid immutable information-received message evidence required'
      using errcode = '23514';
  end if;

  if new.failed_message_id is not null and not exists (
    select 1
    from public.refund_case_messages message
    where message.id = new.failed_message_id
      and message.refund_case_id = new.refund_case_id
      and message.follow_up_cycle_id = new.id
      and message.delivery_kind = 'automatic'
      and message.status in ('failed', 'skipped')
  ) then
    raise exception 'Valid immutable failed message evidence required'
      using errcode = '23514';
  end if;

  if old.reminder_claimed_at is null
    and new.reminder_claimed_at is not null
    and (
      old.status <> 'waiting'
      or old.reminder_due_at is null
      or new.reminder_claimed_at < old.reminder_due_at
    ) then
    raise exception 'Reminder can be claimed only once after it becomes due'
      using errcode = '23514';
  end if;

  if new.recheck_claimed_at is not null and (
    new.reply_customer_message_id is null
    or new.reply_received_at is null
  ) then
    raise exception 'Recheck claim requires a verified customer reply'
      using errcode = '23514';
  end if;

  if new.status = 'claimed' and (
    new.request_sent_at is not null
    or new.reply_customer_message_id is not null
    or new.receipt_message_id is not null
    or new.failed_message_id is not null
  ) then
    raise exception 'Claimed follow-up cycle has incompatible delivery evidence'
      using errcode = '23514';
  elsif new.status = 'waiting' and (
    new.request_message_id is null
    or new.request_sent_at is null
    or new.reminder_due_at is null
    or new.reply_customer_message_id is not null
    or new.receipt_message_id is not null
    or new.failed_message_id is not null
  ) then
    raise exception 'Waiting follow-up cycle requires one delivered request'
      using errcode = '23514';
  elsif new.status = 'customer_replied' and (
    new.request_sent_at is null
    or new.reply_customer_message_id is null
    or new.reply_received_at is null
  ) then
    raise exception 'Customer-replied cycle requires one verified reply'
      using errcode = '23514';
  elsif new.status = 'closed' and (
    new.request_sent_at is null
    or new.reply_customer_message_id is null
    or new.recheck_claimed_at is null
    or new.receipt_message_id is null
    or new.receipt_sent_at is null
    or new.failed_message_id is not null
  ) then
    raise exception 'Closed follow-up cycle requires one delivered receipt'
      using errcode = '23514';
  elsif new.status = 'failed' and (
    new.failed_message_id is null
    or new.failed_at is null
    or new.failure_code is null
  ) then
    raise exception 'Failed follow-up cycle requires immutable failure evidence'
      using errcode = '23514';
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

drop trigger if exists refund_follow_up_cycles_guard
  on public.refund_follow_up_cycles;
create trigger refund_follow_up_cycles_guard
before insert or update on public.refund_follow_up_cycles
for each row execute function public.guard_refund_follow_up_cycle();

create or replace function public.guard_refund_follow_up_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_row public.refund_follow_up_cycles;
  case_row public.refund_cases;
  expected_missing text[] := '{}'::text[];
  expected_request_type text;
  automatic_contact_enabled boolean := false;
  attempting_automatic_delivery boolean := false;
begin
  if tg_op = 'UPDATE' and old.delivery_kind = 'automatic' then
    if new.refund_case_id is distinct from old.refund_case_id
      or new.message_type is distinct from old.message_type
      or new.recipient_email is distinct from old.recipient_email
      or new.subject is distinct from old.subject
      or new.body is distinct from old.body
      or new.template_key is distinct from old.template_key
      or new.content_source is distinct from old.content_source
      or new.delivery_kind is distinct from old.delivery_kind
      or new.reason_code is distinct from old.reason_code
      or new.template_version is distinct from old.template_version
      or new.follow_up_cycle_id is distinct from old.follow_up_cycle_id
      or new.requested_fields is distinct from old.requested_fields
      or new.created_at is distinct from old.created_at then
      raise exception 'Automatic customer message evidence is immutable'
        using errcode = '23514';
    end if;

    if old.status <> 'pending' and new.status is distinct from old.status then
      raise exception 'Delivered or failed automatic message cannot be retried'
        using errcode = '23514';
    end if;
    if old.status = 'pending'
      and new.status not in ('pending', 'sent', 'failed', 'skipped') then
      raise exception 'Invalid automatic message delivery transition'
        using errcode = '23514';
    end if;
    if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
      raise exception 'Automatic message sent timestamp is immutable'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT'
    and new.message_type in ('no_safe_match', 'information_received')
    and new.delivery_kind is distinct from 'automatic' then
    raise exception 'Reserved deterministic follow-up class requires automatic cycle evidence'
      using errcode = '23514';
  end if;

  if new.delivery_kind is distinct from 'automatic' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    attempting_automatic_delivery := new.status in ('pending', 'sent');
  elsif tg_op = 'UPDATE' then
    attempting_automatic_delivery := old.status = 'pending' and new.status = 'sent';
  end if;

  if attempting_automatic_delivery then
    select settings.automatic_customer_contact_enabled
    into automatic_contact_enabled
    from public.refund_customer_contact_settings settings
    where settings.singleton
    for share;

    if not coalesce(automatic_contact_enabled, false) then
      raise exception 'Automatic customer contact is disabled'
        using errcode = '23514';
    end if;
  end if;

  if new.message_type in ('wallet_correction', 'wallet_correction_reminder') then
    if not attempting_automatic_delivery then
      return new;
    end if;
    select * into case_row
    from public.refund_cases
    where id = new.refund_case_id
    for share;

    if case_row.id is null
      or lower(btrim(new.recipient_email)) <> lower(btrim(case_row.customer_email))
      or case_row.payment_method <> 'card'
      or case_row.card_wallet_used is not true
      or case_row.status in ('approved', 'denied', 'completed', 'closed')
      or case_row.decision is not null
      or case_row.wallet_correction_state <> 'sent'
      or case_row.wallet_correction_version not between 1 and 2
      or new.content_source <> 'deterministic_template'
      or new.reason_code is not null
      or new.follow_up_cycle_id is not null
      or cardinality(new.requested_fields) <> 0
      or new.template_version <> (case new.message_type
        when 'wallet_correction' then 'refund_wallet_correction_v1'
        else 'refund_wallet_correction_reminder_v1'
      end)
      or not exists (
        select 1
        from public.refund_wallet_correction_contexts context
        where context.refund_case_id = case_row.id
          and context.version = case_row.wallet_correction_version
          and context.status = 'pending'
          and context.expires_at > statement_timestamp()
      ) then
      raise exception 'Automatic wallet-correction message requires current versioned secure-link evidence'
        using errcode = '23514';
    end if;
    if new.status = 'sent' and new.sent_at is null then
      raise exception 'Sent automatic wallet-correction message requires a sent timestamp'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select * into cycle_row
  from public.refund_follow_up_cycles
  where id = new.follow_up_cycle_id
  for update;

  if cycle_row.id is null then
    raise exception 'Automatic follow-up message requires a valid cycle'
      using errcode = '23514';
  end if;

  select * into case_row
  from public.refund_cases
  where id = new.refund_case_id
  for share;

  if attempting_automatic_delivery and (
    case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.decision is not null
  ) then
    raise exception 'Terminal refund case cannot receive automatic follow-up'
      using errcode = '23514';
  end if;

  if cycle_row.refund_case_id <> new.refund_case_id
    or lower(btrim(new.recipient_email)) <> lower(btrim(case_row.customer_email))
    or new.content_source <> 'deterministic_template'
    or new.reason_code <> cycle_row.reason_code
    or new.template_version <> cycle_row.template_version
    or new.requested_fields <> cycle_row.requested_fields then
    raise exception 'Automatic follow-up message evidence does not match its cycle'
      using errcode = '23514';
  end if;

  expected_request_type := case cycle_row.reason_code
    when 'missing_information' then 'more_info'
    when 'no_safe_match' then 'no_safe_match'
  end;

  if attempting_automatic_delivery
    and new.message_type in (expected_request_type, 'reminder') then
    if case_row.deterministic_fact_version <> cycle_row.case_fact_version then
      raise exception 'Automatic follow-up message facts became stale before delivery'
        using errcode = '23514';
    end if;
    expected_missing := coalesce(
      public.refund_missing_follow_up_fields(new.refund_case_id),
      '{}'::text[]
    );
    if cycle_row.reason_code = 'missing_information'
      and (
        case_row.card_wallet_used is true
        or expected_missing <> cycle_row.requested_fields
      ) then
      raise exception 'Automatic missing-information evidence became stale before delivery'
        using errcode = '23514';
    end if;
    if cycle_row.reason_code = 'no_safe_match'
      and (
        cardinality(expected_missing) <> 0
        or not (
          (
            case_row.payment_method = 'card'
            and case_row.card_wallet_used is false
            and case_row.correlation_status = 'no_match'
            and case_row.correlation_source = 'nayax'
            and case_row.nayax_recommendation_state = 'no_safe_match'
            and nullif(btrim(coalesce(case_row.nayax_recommendation_policy_version, '')), '') is not null
            and case_row.nayax_recommendation_evaluated_at is not null
            and case_row.nayax_recommendation_evaluated_at >= case_row.deterministic_facts_updated_at
            and case_row.nayax_match_execution_eligible is not true
            and case_row.matched_nayax_transaction_id is null
          )
          or (
            case_row.payment_method = 'cash'
            and case_row.card_wallet_used is false
            and case_row.correlation_status = 'no_match'
            and case_row.correlation_source = 'sunze'
            and nullif(btrim(coalesce(case_row.correlation_summary, '')), '') is not null
            and case_row.matched_sales_fact_id is null
            and case_row.cash_match_evaluated_fact_version = case_row.deterministic_fact_version
            and case_row.matched_nayax_transaction_id is null
            and case_row.nayax_match_execution_eligible is not true
          )
        )
      ) then
      raise exception 'Automatic no-safe-match evidence became stale before delivery'
        using errcode = '23514';
    end if;
  end if;

  if new.message_type = expected_request_type then
    if cycle_row.status <> 'claimed'
      or (cycle_row.request_message_id is not null and cycle_row.request_message_id <> new.id) then
      raise exception 'Follow-up request is no longer claimable'
        using errcode = '23514';
    end if;
    if attempting_automatic_delivery
      and cycle_row.source_customer_message_id is not null and exists (
      select 1
      from public.refund_gmail_messages newer_message
      join public.refund_gmail_messages source_message
        on source_message.id = cycle_row.source_customer_message_id
      where newer_message.refund_case_id = cycle_row.refund_case_id
        and newer_message.direction = 'inbound'
        and newer_message.message_kind = 'message'
        and newer_message.status = 'received'
        and newer_message.participant_role = 'customer'
        and newer_message.participant_trust = 'verified'
        and newer_message.content_deleted_at is null
        and (newer_message.received_at, newer_message.id)
          > (source_message.received_at, source_message.id)
    ) then
      raise exception 'A newer verified customer message superseded this request'
        using errcode = '23514';
    end if;
    if attempting_automatic_delivery
      and cycle_row.source_customer_message_id is null and exists (
      select 1
      from public.refund_gmail_messages newer_message
      where newer_message.refund_case_id = cycle_row.refund_case_id
        and newer_message.direction = 'inbound'
        and newer_message.message_kind = 'message'
        and newer_message.status = 'received'
        and newer_message.participant_role = 'customer'
        and newer_message.participant_trust = 'verified'
        and newer_message.content_deleted_at is null
        and newer_message.received_at > cycle_row.created_at
    ) then
      raise exception 'A newer verified customer message superseded this request'
        using errcode = '23514';
    end if;
  elsif new.message_type = 'reminder' then
    if cycle_row.status <> 'waiting'
      or cycle_row.request_sent_at is null
      or cycle_row.reminder_due_at is null
      or cycle_row.reminder_due_at > statement_timestamp()
      or cycle_row.reminder_claimed_at is null
      or cycle_row.reply_customer_message_id is not null
      or (cycle_row.reminder_message_id is not null and cycle_row.reminder_message_id <> new.id) then
      raise exception 'Follow-up reminder is not due or was already claimed'
        using errcode = '23514';
    end if;
    if attempting_automatic_delivery and exists (
      select 1
      from public.refund_gmail_messages newer_message
      where newer_message.refund_case_id = cycle_row.refund_case_id
        and newer_message.direction = 'inbound'
        and newer_message.message_kind = 'message'
        and newer_message.status = 'received'
        and newer_message.participant_role = 'customer'
        and newer_message.participant_trust = 'verified'
        and newer_message.content_deleted_at is null
        and newer_message.received_at > cycle_row.request_sent_at
    ) then
      raise exception 'A verified customer reply superseded this reminder'
        using errcode = '23514';
    end if;
  elsif new.message_type = 'information_received' then
    if cycle_row.status <> 'customer_replied'
      or cycle_row.reply_customer_message_id is null
      or (cycle_row.receipt_message_id is not null and cycle_row.receipt_message_id <> new.id) then
      raise exception 'Information-received receipt requires one verified customer reply'
        using errcode = '23514';
    end if;
  else
    raise exception 'Unsupported automatic follow-up message class'
      using errcode = '23514';
  end if;

  if new.status = 'sent' and new.sent_at is null then
    raise exception 'Sent automatic message requires a sent timestamp'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_case_messages_follow_up_guard
  on public.refund_case_messages;
create trigger refund_case_messages_follow_up_guard
before insert or update on public.refund_case_messages
for each row execute function public.guard_refund_follow_up_message();

create or replace function public.sync_refund_follow_up_cycle_from_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle_row public.refund_follow_up_cycles;
  is_request boolean;
begin
  if new.delivery_kind is distinct from 'automatic'
    or new.follow_up_cycle_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.status is not distinct from old.status
    and new.sent_at is not distinct from old.sent_at then
    return new;
  end if;

  select * into cycle_row
  from public.refund_follow_up_cycles
  where id = new.follow_up_cycle_id
  for update;

  is_request := new.message_type in ('more_info', 'no_safe_match');

  if is_request then
    update public.refund_follow_up_cycles
    set
      request_message_id = coalesce(request_message_id, new.id),
      request_created_at = coalesce(request_created_at, new.created_at),
      request_sent_at = case
        when new.status = 'sent' then coalesce(request_sent_at, new.sent_at)
        else request_sent_at
      end,
      reminder_due_at = case
        when new.status = 'sent' then coalesce(
          reminder_due_at,
          new.sent_at + make_interval(hours => reminder_delay_hours)
        )
        else reminder_due_at
      end,
      status = case
        when new.status = 'sent' then 'waiting'
        when new.status in ('failed', 'skipped') then 'failed'
        else status
      end,
      failed_message_id = case
        when new.status in ('failed', 'skipped') then coalesce(failed_message_id, new.id)
        else failed_message_id
      end,
      failed_at = case
        when new.status in ('failed', 'skipped') then coalesce(failed_at, statement_timestamp())
        else failed_at
      end,
      failure_code = case
        when new.status in ('failed', 'skipped') then coalesce(
          failure_code,
          replace(new.message_type, '-', '_') || '_' || new.status
        )
        else failure_code
      end
    where id = cycle_row.id;
  elsif new.message_type = 'reminder' then
    update public.refund_follow_up_cycles
    set
      reminder_message_id = coalesce(reminder_message_id, new.id),
      reminder_created_at = coalesce(reminder_created_at, new.created_at),
      reminder_sent_at = case
        when new.status = 'sent' then coalesce(reminder_sent_at, new.sent_at)
        else reminder_sent_at
      end,
      status = case
        when new.status in ('failed', 'skipped') then 'failed'
        else status
      end,
      failed_message_id = case
        when new.status in ('failed', 'skipped') then coalesce(failed_message_id, new.id)
        else failed_message_id
      end,
      failed_at = case
        when new.status in ('failed', 'skipped') then coalesce(failed_at, statement_timestamp())
        else failed_at
      end,
      failure_code = case
        when new.status in ('failed', 'skipped') then coalesce(failure_code, 'reminder_' || new.status)
        else failure_code
      end
    where id = cycle_row.id;
  elsif new.message_type = 'information_received' then
    update public.refund_follow_up_cycles
    set
      receipt_message_id = coalesce(receipt_message_id, new.id),
      receipt_created_at = coalesce(receipt_created_at, new.created_at),
      receipt_sent_at = case
        when new.status = 'sent' then coalesce(receipt_sent_at, new.sent_at)
        else receipt_sent_at
      end
    where id = cycle_row.id;
  end if;

  if new.status = 'sent' and is_request then
    update public.refund_cases
    set
      -- Gmail drafts intentionally remain drafts until their required intake
      -- facts are complete. automation_state is the waiting-state source of
      -- truth for those incomplete cases.
      status = case
        when status = 'draft' then status
        else 'waiting_on_customer'
      end,
      automation_state = case
        when new.message_type = 'no_safe_match' then 'under_review'
        else 'more_info_needed'
      end,
      automation_follow_up_due_at = new.sent_at + make_interval(hours => cycle_row.reminder_delay_hours),
      customer_last_contacted_at = new.sent_at,
      last_customer_message_type = new.message_type
    where id = cycle_row.refund_case_id
      and status not in ('approved', 'denied', 'completed', 'closed');
  elsif new.status = 'sent' and new.message_type = 'reminder' then
    update public.refund_cases
    set
      automation_follow_up_due_at = null,
      customer_last_contacted_at = new.sent_at,
      last_customer_message_type = new.message_type
    where id = cycle_row.refund_case_id
      and status not in ('approved', 'denied', 'completed', 'closed');
  elsif new.status = 'sent' and new.message_type = 'information_received' then
    update public.refund_cases
    set
      status = case when status = 'waiting_on_customer' then 'needs_review' else status end,
      automation_state = case
        when status = 'draft' then 'customer_reply_review'
        else 'under_review'
      end,
      automation_follow_up_due_at = null,
      customer_last_contacted_at = new.sent_at,
      last_customer_message_type = new.message_type
    where id = cycle_row.refund_case_id
      and status not in ('approved', 'denied', 'completed', 'closed');
  elsif new.status in ('failed', 'skipped') then
    update public.refund_cases
    set automation_follow_up_due_at = null
    where id = cycle_row.refund_case_id;
  end if;

  return new;
end;
$$;

drop trigger if exists refund_case_messages_follow_up_sync
  on public.refund_case_messages;
create trigger refund_case_messages_follow_up_sync
after insert or update on public.refund_case_messages
for each row execute function public.sync_refund_follow_up_cycle_from_message();

create or replace function public.refund_follow_up_cycle_json(
  p_cycle public.refund_follow_up_cycles
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p_cycle.id,
    'refundCaseId', p_cycle.refund_case_id,
    'cycleNumber', p_cycle.cycle_number,
    'triggerFingerprint', p_cycle.trigger_fingerprint,
    'reasonCode', p_cycle.reason_code,
    'requestedFields', to_jsonb(p_cycle.requested_fields),
    'templateVersion', p_cycle.template_version,
    'caseFactVersion', p_cycle.case_fact_version,
    'status', p_cycle.status,
    'sourceCustomerMessageId', p_cycle.source_customer_message_id,
    'requestMessageId', p_cycle.request_message_id,
    'requestSentAt', p_cycle.request_sent_at,
    'reminderDueAt', p_cycle.reminder_due_at,
    'reminderClaimedAt', p_cycle.reminder_claimed_at,
    'reminderMessageId', p_cycle.reminder_message_id,
    'reminderSentAt', p_cycle.reminder_sent_at,
    'replyCustomerMessageId', p_cycle.reply_customer_message_id,
    'replyReceivedAt', p_cycle.reply_received_at,
    'receiptMessageId', p_cycle.receipt_message_id,
    'receiptSentAt', p_cycle.receipt_sent_at
  );
$$;

create or replace function public.service_claim_refund_follow_up_cycle(
  p_refund_case_id uuid,
  p_reason_code text,
  p_template_version text,
  p_trigger_fingerprint text,
  p_source_customer_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_customer_contact_settings;
  case_row public.refund_cases;
  cycle_row public.refund_follow_up_cycles;
  active_cycle public.refund_follow_up_cycles;
  normalized_reason text := lower(btrim(coalesce(p_reason_code, '')));
  expected_missing text[] := '{}'::text[];
  existing_count integer;
  latest_cycle_fact_version bigint := 0;
  next_cycle_number smallint;
begin
  select * into settings_row
  from public.refund_customer_contact_settings
  where singleton;

  if not coalesce(settings_row.automatic_customer_contact_enabled, false) then
    return jsonb_build_object(
      'enabled', false,
      'claimed', false,
      'reason', 'automatic_customer_contact_disabled',
      'cycle', null
    );
  end if;

  if normalized_reason not in ('missing_information', 'no_safe_match') then
    raise exception 'Approved deterministic follow-up reason required';
  end if;
  if p_template_version is distinct from settings_row.template_version then
    raise exception 'Approved deterministic follow-up template version required';
  end if;
  if coalesce(p_trigger_fingerprint, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Valid deterministic follow-up trigger fingerprint required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refund_follow_up_cycle:' || p_refund_case_id::text, 0)
  );

  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id
  for update;

  if case_row.id is null then
    raise exception 'Refund case not found';
  end if;

  if exists (
    select 1
    from public.refund_gmail_threads thread
    where thread.refund_case_id = p_refund_case_id
      and thread.automatic_customer_contact_paused_at is not null
  ) then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'automatic_customer_contact_paused',
      'cycle', null
    );
  end if;

  select * into cycle_row
  from public.refund_follow_up_cycles
  where refund_case_id = p_refund_case_id
    and trigger_fingerprint = p_trigger_fingerprint;

  if cycle_row.id is not null then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'duplicate_trigger',
      'cycle', public.refund_follow_up_cycle_json(cycle_row)
    );
  end if;

  select * into active_cycle
  from public.refund_follow_up_cycles
  where refund_case_id = p_refund_case_id
    and status in ('claimed', 'waiting', 'customer_replied')
  order by cycle_number desc
  limit 1;

  if active_cycle.id is not null then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'active_cycle_exists',
      'cycle', public.refund_follow_up_cycle_json(active_cycle)
    );
  end if;

  select
    count(*)::integer,
    (coalesce(max(cycle_number), 0) + 1)::smallint,
    coalesce(max(case_fact_version), 0)::bigint
  into existing_count, next_cycle_number, latest_cycle_fact_version
  from public.refund_follow_up_cycles
  where refund_case_id = p_refund_case_id;

  if existing_count >= 2 then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'contact_limit_reached',
      'cycle', null
    );
  end if;

  if existing_count > 0
    and case_row.deterministic_fact_version <= latest_cycle_fact_version then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'no_material_fact_progress',
      'cycle', null
    );
  end if;

  if case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.decision is not null then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'terminal_case',
      'cycle', null
    );
  end if;

  if p_source_customer_message_id is not null
    and not public.refund_gmail_message_is_verified_customer(
      p_source_customer_message_id,
      p_refund_case_id
    ) then
    raise exception 'Verified customer source message required';
  end if;

  expected_missing := coalesce(
    public.refund_missing_follow_up_fields(p_refund_case_id),
    '{}'::text[]
  );

  if normalized_reason = 'missing_information' then
    if case_row.card_wallet_used is true then
      return jsonb_build_object(
        'enabled', true,
        'claimed', false,
        'reason', 'secure_wallet_correction_required',
        'cycle', null
      );
    end if;
    if cardinality(expected_missing) = 0 then
      return jsonb_build_object(
        'enabled', true,
        'claimed', false,
        'reason', 'no_missing_information',
        'cycle', null
      );
    end if;
  elsif cardinality(expected_missing) <> 0
    or not (
      (
        case_row.payment_method = 'card'
        and case_row.card_wallet_used is false
        and case_row.correlation_status = 'no_match'
        and case_row.correlation_source = 'nayax'
        and case_row.nayax_recommendation_state = 'no_safe_match'
        and nullif(
          btrim(coalesce(case_row.nayax_recommendation_policy_version, '')),
          ''
        ) is not null
        and case_row.nayax_recommendation_evaluated_at is not null
        and case_row.nayax_recommendation_evaluated_at >= case_row.deterministic_facts_updated_at
        and case_row.nayax_match_execution_eligible is not true
        and case_row.matched_nayax_transaction_id is null
      )
      or (
        -- Cash is correlated against the local Sunze sales ledger, not Nayax.
        -- A zero-candidate result is persisted by intake in these structured
        -- fields; customer-facing copy never depends on free-text wording or
        -- the optional intake event.
        case_row.payment_method = 'cash'
        and case_row.card_wallet_used is false
        and case_row.correlation_status = 'no_match'
        and case_row.correlation_source = 'sunze'
        and nullif(btrim(coalesce(case_row.correlation_summary, '')), '') is not null
        and case_row.matched_sales_fact_id is null
        and case_row.cash_match_evaluated_fact_version = case_row.deterministic_fact_version
        and case_row.matched_nayax_transaction_id is null
        and case_row.nayax_match_execution_eligible is not true
      )
    ) then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'confirmed_no_safe_match_required',
      'cycle', null
    );
  end if;

  insert into public.refund_follow_up_cycles (
    refund_case_id,
    cycle_number,
    trigger_fingerprint,
    reason_code,
    requested_fields,
    template_version,
    case_fact_version,
    reminder_delay_hours,
    source_customer_message_id
  )
  values (
    p_refund_case_id,
    next_cycle_number,
    p_trigger_fingerprint,
    normalized_reason,
    case when normalized_reason = 'missing_information' then expected_missing else '{}'::text[] end,
    settings_row.template_version,
    case_row.deterministic_fact_version,
    settings_row.reminder_delay_hours,
    p_source_customer_message_id
  )
  returning * into cycle_row;

  return jsonb_build_object(
    'enabled', true,
    'claimed', true,
    'cycle', public.refund_follow_up_cycle_json(cycle_row)
  );
end;
$$;

create or replace function public.service_claim_due_refund_follow_up_reminders(
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_customer_contact_settings;
  cycle_row public.refund_follow_up_cycles;
  claimed_cycle public.refund_follow_up_cycles;
  reminders jsonb := '[]'::jsonb;
  normalized_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  select * into settings_row
  from public.refund_customer_contact_settings
  where singleton;

  if not coalesce(settings_row.automatic_customer_contact_enabled, false) then
    return jsonb_build_object(
      'enabled', false,
      'reminders', reminders,
      'reason', 'automatic_customer_contact_disabled'
    );
  end if;

  for cycle_row in
    select cycle.*
    from public.refund_follow_up_cycles cycle
    where cycle.status = 'waiting'
      and cycle.request_sent_at is not null
      and cycle.reminder_due_at <= statement_timestamp()
      and cycle.reminder_claimed_at is null
      and cycle.reminder_message_id is null
      and cycle.reply_customer_message_id is null
      and not exists (
        select 1
        from public.refund_gmail_threads thread
        where thread.refund_case_id = cycle.refund_case_id
          and thread.automatic_customer_contact_paused_at is not null
      )
    order by cycle.reminder_due_at, cycle.id
    limit normalized_limit
    for update skip locked
  loop
    update public.refund_follow_up_cycles
    set reminder_claimed_at = statement_timestamp()
    where id = cycle_row.id
      and reminder_claimed_at is null
    returning * into claimed_cycle;

    if claimed_cycle.id is not null then
      reminders := reminders || jsonb_build_array(
        public.refund_follow_up_cycle_json(claimed_cycle)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'enabled', true,
    'reminders', reminders
  );
end;
$$;

create or replace function public.service_claim_refund_follow_up_customer_reply(
  p_refund_case_id uuid,
  p_follow_up_cycle_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_customer_contact_settings;
  cycle_row public.refund_follow_up_cycles;
  reply_row public.refund_gmail_messages;
  case_row public.refund_cases;
  facts_changed boolean;
begin
  select * into settings_row
  from public.refund_customer_contact_settings
  where singleton;

  select * into cycle_row
  from public.refund_follow_up_cycles
  where id = p_follow_up_cycle_id
    and refund_case_id = p_refund_case_id
  for update;

  if cycle_row.id is null then
    raise exception 'Refund follow-up cycle not found';
  end if;

  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id;

  facts_changed := case_row.deterministic_fact_version > cycle_row.case_fact_version;

  if cycle_row.reply_customer_message_id is not null then
    return jsonb_build_object(
      'enabled', true,
      'claimed', cycle_row.recheck_claimed_at is null,
      'reason', case
        when cycle_row.recheck_claimed_at is null then 'reply_recheck_resumed'
        else 'reply_recheck_completed'
      end,
      'cycleId', cycle_row.id,
      'refundCaseId', cycle_row.refund_case_id,
      'sourceMessageId', cycle_row.reply_customer_message_id,
      'sourceReceivedAt', cycle_row.reply_received_at,
      'factsChanged', facts_changed,
      'caseFactVersion', case_row.deterministic_fact_version,
      'cycleFactVersion', cycle_row.case_fact_version,
      'reasonCode', cycle_row.reason_code,
      'requestedFields', to_jsonb(cycle_row.requested_fields),
      'templateVersion', cycle_row.template_version,
      'nextAction', 'manual_review'
    );
  end if;

  if cycle_row.status <> 'waiting' or cycle_row.request_sent_at is null then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'cycle_not_waiting'
    );
  end if;

  -- A claimed reminder owns the outbound lease until its immutable delivery
  -- row settles. This prevents a customer reply from racing a stale reminder
  -- into the same Gmail conversation.
  if cycle_row.reminder_message_id is not null
    and cycle_row.reminder_sent_at is null then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'reminder_delivery_in_progress'
    );
  end if;

  select * into reply_row
  from public.refund_gmail_messages message
  where message.refund_case_id = p_refund_case_id
    and message.direction = 'inbound'
    and message.message_kind = 'message'
    and message.status = 'received'
    and message.participant_role = 'customer'
    and message.participant_trust = 'verified'
    and message.content_deleted_at is null
    and message.received_at > cycle_row.request_sent_at
    and not exists (
      select 1
      from public.refund_follow_up_cycles used_cycle
      where used_cycle.reply_customer_message_id = message.id
    )
  order by message.received_at, message.id
  limit 1
  for update skip locked;

  if reply_row.id is null then
    return jsonb_build_object(
      'enabled', true,
      'claimed', false,
      'reason', 'no_verified_customer_reply'
    );
  end if;

  update public.refund_follow_up_cycles
  set
    status = 'customer_replied',
    reply_customer_message_id = reply_row.id,
    reply_received_at = reply_row.received_at
  where id = cycle_row.id
  returning * into cycle_row;

  update public.refund_cases
  set
    status = case when status = 'waiting_on_customer' then 'needs_review' else status end,
    automation_state = 'customer_reply_review',
    automation_follow_up_due_at = null
  where id = p_refund_case_id
    and status not in ('approved', 'denied', 'completed', 'closed')
  returning * into case_row;

  facts_changed := case_row.deterministic_fact_version > cycle_row.case_fact_version;

  return jsonb_build_object(
    'enabled', true,
    'claimed', true,
    'cycleId', cycle_row.id,
    'refundCaseId', cycle_row.refund_case_id,
    'sourceMessageId', cycle_row.reply_customer_message_id,
    'sourceReceivedAt', cycle_row.reply_received_at,
    'factsChanged', facts_changed,
    'caseFactVersion', case_row.deterministic_fact_version,
    'cycleFactVersion', cycle_row.case_fact_version,
    'reasonCode', cycle_row.reason_code,
    'requestedFields', to_jsonb(cycle_row.requested_fields),
    'templateVersion', cycle_row.template_version,
    'customerContactEnabled', coalesce(settings_row.automatic_customer_contact_enabled, false),
    'nextAction', case
      when facts_changed then 'send_information_received_and_recheck'
      else 'send_information_received_then_manual_review'
    end
  );
end;
$$;

alter table public.refund_automation_actions
  drop constraint if exists refund_automation_actions_type_check;

alter table public.refund_automation_actions
  add constraint refund_automation_actions_type_check
  check (action_type in (
    'nayax_lookup',
    'customer_reminder',
    'customer_more_info',
    'wallet_correction_request',
    'wallet_correction_reminder',
    'customer_information_received',
    'customer_reply_recheck',
    'provider_exception',
    'internal_escalation',
    'ops_alert'
  ));

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

  if p_refund_case_id is not null and not exists (
    select 1 from public.refund_cases where id = p_refund_case_id
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
    'customer_information_received',
    'customer_reply_recheck',
    'provider_exception',
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
  ) values (
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
    select * into action_row
    from public.refund_automation_actions
    where action_key = normalized_action_key;

    if action_row.action_type <> p_action_type
      or action_row.refund_case_id is distinct from p_refund_case_id then
      raise exception 'Refund automation action key collision';
    end if;
  end if;

  return jsonb_build_object(
    'actionId', action_row.id,
    'claimed', claimed,
    'status', action_row.status,
    'reasonCategory', action_row.reason_category
  );
end;
$$;

create or replace function public.service_claim_refund_provider_exception_action(
  p_run_id uuid,
  p_refund_case_id uuid,
  p_action_key text,
  p_reason_category text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_reason text := lower(btrim(coalesce(p_reason_category, '')));
  claim_result jsonb;
  action_row public.refund_automation_actions;
begin
  if normalized_reason not in (
    'provider_setup',
    'provider_outage',
    'provider_rejection',
    'provider_timeout',
    'provider_unknown'
  ) then
    raise exception 'Approved redacted provider exception reason required';
  end if;

  claim_result := public.service_claim_refund_automation_action(
    p_run_id,
    p_refund_case_id,
    p_action_key,
    'provider_exception',
    null,
    null
  );

  select * into action_row
  from public.refund_automation_actions
  where id = nullif(claim_result ->> 'actionId', '')::uuid
  for update;

  if action_row.reason_category is not null
    and action_row.reason_category <> normalized_reason then
    raise exception 'Refund provider exception action reason collision';
  end if;

  update public.refund_automation_actions
  set
    reason_category = coalesce(reason_category, normalized_reason),
    metadata = jsonb_build_object(
      'payload_redacted', true,
      'provider_exception_reason', normalized_reason
    )
  where id = action_row.id
  returning * into action_row;

  return jsonb_build_object(
    'actionId', action_row.id,
    'claimed', coalesce((claim_result ->> 'claimed')::boolean, false),
    'status', action_row.status,
    'reasonCategory', action_row.reason_category
  );
end;
$$;

create or replace function public.guard_refund_gpt_verified_customer_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.refund_gmail_message_is_verified_customer(
    new.source_message_id,
    new.refund_case_id
  ) then
    raise exception 'Refund GPT source must be a verified direct customer message'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_gpt_triage_jobs_verified_customer_source
  on public.refund_gpt_triage_jobs;
create trigger refund_gpt_triage_jobs_verified_customer_source
before insert or update of refund_case_id, source_message_id
on public.refund_gpt_triage_jobs
for each row execute function public.guard_refund_gpt_verified_customer_source();

drop trigger if exists refund_gpt_triage_runs_verified_customer_source
  on public.refund_gpt_triage_runs;
create trigger refund_gpt_triage_runs_verified_customer_source
before insert or update of refund_case_id, source_message_id
on public.refund_gpt_triage_runs
for each row execute function public.guard_refund_gpt_verified_customer_source();

create or replace function public.service_claim_refund_gpt_triage_jobs(
  p_run_key text,
  p_model_name text,
  p_prompt_version text,
  p_schema_version text,
  p_limit integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_row public.refund_gpt_triage_settings;
  source_row public.refund_gmail_messages;
  job_row public.refund_gpt_triage_jobs;
  context_messages jsonb;
  jobs jsonb := '[]'::jsonb;
  normalized_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
begin
  select * into settings_row
  from public.refund_gpt_triage_settings
  where singleton;

  if not coalesce(settings_row.enabled, false) then
    return jsonb_build_object('enabled', false, 'jobs', jobs);
  end if;
  if coalesce(settings_row.auto_send_enabled, false)
    or not coalesce(settings_row.human_review_required, true) then
    raise exception 'Refund GPT triage must remain human reviewed';
  end if;
  if p_prompt_version <> settings_row.prompt_version
    or p_schema_version <> settings_row.schema_version then
    raise exception 'Approved refund GPT prompt and schema versions required';
  end if;
  if length(btrim(coalesce(p_run_key, ''))) not between 8 and 160
    or length(btrim(coalesce(p_model_name, ''))) not between 1 and 120 then
    raise exception 'Valid refund GPT run key and model required';
  end if;

  for source_row in
    select message.*
    from public.refund_gmail_messages message
    join public.refund_cases refund_case
      on refund_case.id = message.refund_case_id
    where message.direction = 'inbound'
      and message.participant_role = 'customer'
      and message.participant_trust = 'verified'
      and message.message_kind = 'message'
      and message.status = 'received'
      and message.content_deleted_at is null
      and refund_case.status not in ('denied', 'completed', 'closed')
      and not exists (
        select 1
        from public.refund_gmail_messages newer
        where newer.refund_case_id = message.refund_case_id
          and newer.direction = 'inbound'
          and newer.participant_role = 'customer'
          and newer.participant_trust = 'verified'
          and newer.message_kind = 'message'
          and newer.status = 'received'
          and newer.content_deleted_at is null
          and (newer.received_at, newer.id) > (message.received_at, message.id)
      )
      and not exists (
        select 1
        from public.refund_gpt_triage_jobs existing_job
        where existing_job.source_message_id = message.id
          and existing_job.prompt_version = p_prompt_version
          and existing_job.model_name = btrim(p_model_name)
      )
    order by message.received_at, message.id
    limit normalized_limit
  loop
    insert into public.refund_gpt_triage_jobs (
      refund_case_id,
      source_message_id,
      run_key,
      model_name,
      prompt_version,
      schema_version
    ) values (
      source_row.refund_case_id,
      source_row.id,
      left(btrim(p_run_key), 160) || ':' || source_row.id::text,
      btrim(p_model_name),
      p_prompt_version,
      p_schema_version
    )
    on conflict (source_message_id, prompt_version, model_name) do nothing
    returning * into job_row;

    if job_row.id is null then
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'direction', 'inbound',
      'kind', 'message',
      'body', context_message.plain_body,
      'receivedAt', context_message.received_at,
      'sensitiveDataRedacted', context_message.sensitive_data_redacted
    ) order by context_message.received_at, context_message.id), '[]'::jsonb)
    into context_messages
    from (
      select
        message.id,
        message.plain_body,
        message.received_at,
        message.sensitive_data_redacted
      from public.refund_gmail_messages message
      where message.refund_case_id = source_row.refund_case_id
        and message.direction = 'inbound'
        and message.participant_role = 'customer'
        and message.participant_trust = 'verified'
        and message.message_kind = 'message'
        and message.status = 'received'
        and message.content_deleted_at is null
        and (message.received_at, message.id) <= (source_row.received_at, source_row.id)
      order by message.received_at desc, message.id desc
      limit 8
    ) context_message;

    jobs := jobs || jsonb_build_array(jsonb_build_object(
      'jobId', job_row.id,
      'refundCaseId', source_row.refund_case_id,
      'sourceMessageId', source_row.id,
      'publicReference', (
        select refund_case.public_reference
        from public.refund_cases refund_case
        where refund_case.id = source_row.refund_case_id
      ),
      'subject', source_row.subject,
      'messages', context_messages
    ));
  end loop;

  return jsonb_build_object('enabled', true, 'jobs', jobs);
end;
$$;

create or replace function public.service_complete_refund_gpt_triage_job(
  p_job_id uuid,
  p_input_fingerprint text,
  p_model_snapshot text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.refund_gpt_triage_jobs;
  source_message_row public.refund_gmail_messages;
  triage_result jsonb;
  triage_id uuid;
  source_text text;
  any_sensitive_redaction boolean := false;
  provided_policy_values text[] := '{}'::text[];
  expected_policy_values text[] := '{}'::text[];
  amount_cents integer;
begin
  select * into job_row
  from public.refund_gpt_triage_jobs
  where id = p_job_id
  for update;

  if job_row.id is null then
    raise exception 'Refund GPT triage job not found';
  end if;

  select * into source_message_row
  from public.refund_gmail_messages message
  where message.id = job_row.source_message_id
    and message.refund_case_id = job_row.refund_case_id
    and message.direction = 'inbound'
    and message.participant_role = 'customer'
    and message.participant_trust = 'verified'
    and message.message_kind = 'message'
    and message.status = 'received'
    and message.content_deleted_at is null;

  if source_message_row.id is null then
    raise exception 'Verified customer source message required for GPT completion';
  end if;

  if job_row.status = 'succeeded' then
    select jsonb_build_object(
      'created', false,
      'triageId', triage.id,
      'status', triage.status
    ) into triage_result
    from public.refund_gpt_triage_runs triage
    where triage.run_key = job_row.run_key;

    return coalesce(
      triage_result,
      jsonb_build_object('created', false, 'status', 'succeeded')
    );
  end if;
  if job_row.status <> 'processing' then
    raise exception 'Refund GPT triage job is not processing';
  end if;
  if coalesce(p_input_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or length(btrim(coalesce(p_model_snapshot, ''))) not between 1 and 160 then
    raise exception 'Valid refund GPT fingerprint and model snapshot required';
  end if;

  if exists (
    select 1
    from public.refund_gmail_messages newer
    where newer.refund_case_id = job_row.refund_case_id
      and newer.direction = 'inbound'
      and newer.participant_role = 'customer'
      and newer.participant_trust = 'verified'
      and newer.message_kind = 'message'
      and newer.status = 'received'
      and newer.content_deleted_at is null
      and (newer.received_at, newer.id) > (
        source_message_row.received_at,
        source_message_row.id
      )
  ) then
    update public.refund_gpt_triage_jobs
    set
      status = 'failed',
      failure_category = 'database_validation',
      error_code = 'stale_source_message',
      finished_at = now()
    where id = job_row.id;

    return jsonb_build_object('created', false, 'status', 'stale');
  end if;

  if jsonb_typeof(coalesce(p_result, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(p_result -> 'policyFlags') <> 'array' then
    raise exception 'Structured refund GPT result required';
  end if;

  select
    string_agg(
      context_message.subject || E'\n' || context_message.plain_body,
      E'\n'
      order by context_message.received_at, context_message.id
    ),
    bool_or(context_message.sensitive_data_redacted)
  into source_text, any_sensitive_redaction
  from (
    select
      message.id,
      message.subject,
      message.plain_body,
      message.received_at,
      message.sensitive_data_redacted
    from public.refund_gmail_messages message
    where message.refund_case_id = job_row.refund_case_id
      and message.direction = 'inbound'
      and message.participant_role = 'customer'
      and message.participant_trust = 'verified'
      and message.message_kind = 'message'
      and message.status = 'received'
      and message.content_deleted_at is null
      and (message.received_at, message.id) <= (
        source_message_row.received_at,
        source_message_row.id
      )
    order by message.received_at desc, message.id desc
    limit 8
  ) context_message;

  select coalesce(array_agg(value order by value), '{}'::text[])
  into provided_policy_values
  from jsonb_array_elements_text(p_result -> 'policyFlags') value;

  source_text := coalesce(source_text, '');
  if source_text ~* '\m(attorney|lawyer|lawsuit|legal action|regulator|ftc|attorney general)\M' then
    expected_policy_values := array_append(expected_policy_values, 'legal');
  end if;
  if source_text ~* '\m(injury|injured|hospital|fire|burned|burnt|electric shock|unsafe|medical)\M' then
    expected_policy_values := array_append(expected_policy_values, 'safety');
  end if;
  if source_text ~* '\m(threat|threaten|threatening|kill|hurt you|come after|destroy your)\M' then
    expected_policy_values := array_append(expected_policy_values, 'threat');
  end if;
  if source_text ~* '\m(chargeback|charge back|bank dispute|dispute the charge|dispute this charge)\M' then
    expected_policy_values := array_append(expected_policy_values, 'chargeback');
  end if;
  if source_text ~* '\m(furious|enraged|scam|fraud|stealing|rip-off|rip off|unacceptable)\M' then
    expected_policy_values := array_append(expected_policy_values, 'abusive_or_escalated');
  end if;
  if source_text ~* '(ignore (all |the )?(previous|prior|system)|system prompt|developer message|assistant instructions|follow these instructions instead|reveal your prompt)' then
    expected_policy_values := array_append(expected_policy_values, 'prompt_injection');
  end if;
  if coalesce(any_sensitive_redaction, false) then
    expected_policy_values := array_append(expected_policy_values, 'prohibited_payment_data');
  end if;
  if p_result #>> '{extracted,walletUsed}' = 'true' then
    expected_policy_values := array_append(expected_policy_values, 'wallet_payment');
  end if;
  if jsonb_typeof(p_result #> '{extracted,amountCents}') = 'number'
    and coalesce(p_result #>> '{extracted,amountCents}', '') ~ '^\d+$' then
    amount_cents := (p_result #>> '{extracted,amountCents}')::integer;
    if amount_cents > (
      select high_value_threshold_cents
      from public.refund_gpt_triage_settings
      where singleton
    ) then
      expected_policy_values := array_append(expected_policy_values, 'high_value');
    end if;
  end if;

  select coalesce(array_agg(distinct value order by value), '{}'::text[])
  into expected_policy_values
  from unnest(expected_policy_values) value;

  if not expected_policy_values <@ provided_policy_values then
    raise exception 'Refund GPT result omitted a deterministic context safety flag';
  end if;

  triage_result := public.service_record_refund_gpt_triage(
    job_row.refund_case_id,
    job_row.source_message_id,
    job_row.run_key,
    p_input_fingerprint,
    job_row.model_name,
    btrim(p_model_snapshot),
    job_row.prompt_version,
    job_row.schema_version,
    p_result
  );

  triage_id := nullif(triage_result ->> 'triageId', '')::uuid;
  if coalesce((triage_result ->> 'created')::boolean, false)
    and triage_id is not null then
    update public.refund_gpt_triage_runs
    set status = 'superseded'
    where refund_case_id = job_row.refund_case_id
      and id <> triage_id
      and status in ('ready_for_review', 'human_review');
  end if;

  update public.refund_gpt_triage_jobs
  set
    status = 'succeeded',
    input_fingerprint = p_input_fingerprint,
    model_snapshot = btrim(p_model_snapshot),
    finished_at = now(),
    failure_category = null,
    error_code = null
  where id = job_row.id;

  return triage_result;
end;
$$;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_overview_pre_followup_20260803;

revoke execute on function public.admin_get_refund_overview_pre_followup_20260803()
  from public, anon, authenticated;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  base_result jsonb;
  enriched_cases jsonb;
begin
  -- The wrapped projection retains the established redacted contract:
  -- nayaxLookupCandidates, oneClickEligible, incidentAt, qrClaimOpenedAt,
  -- confidenceClass, reasonCodes, and qrTimeDeltaMinutes. Its verified QR join
  -- still requires consumed_at is not null and
  -- reporting_machine_id = refund_case.reporting_machine_id.
  base_result := public.admin_get_refund_overview_pre_followup_20260803();

  select coalesce(jsonb_agg(
    case_item.case_json || jsonb_build_object(
      'structuredIncidentAt', (
        select refund_case.incident_at
        from public.refund_cases refund_case
        where refund_case.id = (case_item.case_json ->> 'id')::uuid
      ),
      'incidentTimeResolution', (
        select refund_case.incident_time_resolution
        from public.refund_cases refund_case
        where refund_case.id = (case_item.case_json ->> 'id')::uuid
      ),
      'messages', coalesce((
        select jsonb_agg(
          message_item.message_json || jsonb_build_object(
            'contentSource', message_row.content_source,
            'deliveryKind', message_row.delivery_kind,
            'reasonCode', message_row.reason_code,
            'templateVersion', message_row.template_version,
            'requestedFields', to_jsonb(message_row.requested_fields),
            'followUpCycleId', message_row.follow_up_cycle_id
          )
          order by message_item.message_order
        )
        from jsonb_array_elements(
          coalesce(case_item.case_json -> 'messages', '[]'::jsonb)
        ) with ordinality as message_item(message_json, message_order)
        left join public.refund_case_messages message_row
          on message_row.id = (message_item.message_json ->> 'id')::uuid
      ), '[]'::jsonb)
    )
    order by case_item.case_order
  ), '[]'::jsonb)
  into enriched_cases
  from jsonb_array_elements(
    coalesce(base_result -> 'cases', '[]'::jsonb)
  ) with ordinality as case_item(case_json, case_order);

  return jsonb_set(base_result, '{cases}', enriched_cases, true);
end;
$$;

alter function public.admin_get_refund_gmail_draft_cases()
  rename to admin_get_refund_gmail_draft_cases_pre_followup_20260803;

revoke execute on function public.admin_get_refund_gmail_draft_cases_pre_followup_20260803()
  from public, anon, authenticated;

create function public.admin_get_refund_gmail_draft_cases()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  base_result jsonb;
  enriched_cases jsonb;
begin
  base_result := public.admin_get_refund_gmail_draft_cases_pre_followup_20260803();

  select coalesce(jsonb_agg(
    case_item.case_json || jsonb_build_object(
      'structuredIncidentAt', refund_case.incident_at,
      'incidentTimeResolution', refund_case.incident_time_resolution,
      'messages', coalesce((
        select jsonb_agg(
          message_item.message_json || jsonb_build_object(
            'contentSource', message_row.content_source,
            'deliveryKind', message_row.delivery_kind,
            'reasonCode', message_row.reason_code,
            'templateVersion', message_row.template_version,
            'requestedFields', to_jsonb(message_row.requested_fields),
            'followUpCycleId', message_row.follow_up_cycle_id
          )
          order by message_item.message_order
        )
        from jsonb_array_elements(
          coalesce(case_item.case_json -> 'messages', '[]'::jsonb)
        ) with ordinality as message_item(message_json, message_order)
        left join public.refund_case_messages message_row
          on message_row.id = (message_item.message_json ->> 'id')::uuid
      ), '[]'::jsonb)
    )
    order by case_item.case_order
  ), '[]'::jsonb)
  into enriched_cases
  from jsonb_array_elements(coalesce(base_result, '[]'::jsonb))
    with ordinality as case_item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (case_item.case_json ->> 'id')::uuid;

  return enriched_cases;
end;
$$;

revoke execute on function public.admin_get_refund_gmail_draft_cases()
  from public, anon;
grant execute on function public.admin_get_refund_gmail_draft_cases()
  to authenticated;

revoke execute on function public.guard_refund_deterministic_fact_version()
  from public, anon, authenticated;
revoke execute on function public.canonical_refund_follow_up_fields(text[])
  from public, anon, authenticated;
revoke execute on function public.refund_missing_follow_up_fields(uuid)
  from public, anon, authenticated;
revoke execute on function public.refund_gmail_message_is_verified_customer(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.guard_refund_follow_up_cycle()
  from public, anon, authenticated;
revoke execute on function public.guard_refund_follow_up_message()
  from public, anon, authenticated;
revoke execute on function public.sync_refund_follow_up_cycle_from_message()
  from public, anon, authenticated;
revoke execute on function public.refund_follow_up_cycle_json(public.refund_follow_up_cycles)
  from public, anon, authenticated;
revoke execute on function public.guard_refund_gpt_verified_customer_source()
  from public, anon, authenticated;

grant execute on function public.canonical_refund_follow_up_fields(text[])
  to service_role;
grant execute on function public.refund_missing_follow_up_fields(uuid)
  to service_role;
grant execute on function public.refund_gmail_message_is_verified_customer(uuid, uuid)
  to service_role;
grant execute on function public.refund_follow_up_cycle_json(public.refund_follow_up_cycles)
  to service_role;

revoke execute on function public.service_claim_refund_follow_up_cycle(uuid, text, text, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.service_claim_due_refund_follow_up_reminders(integer)
  from public, anon, authenticated;
revoke execute on function public.service_claim_refund_follow_up_customer_reply(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.service_claim_refund_provider_exception_action(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.service_claim_refund_automation_action(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.service_claim_refund_gpt_triage_jobs(text, text, text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.service_complete_refund_gpt_triage_job(uuid, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.service_claim_refund_follow_up_cycle(uuid, text, text, text, uuid)
  to service_role;
grant execute on function public.service_claim_due_refund_follow_up_reminders(integer)
  to service_role;
grant execute on function public.service_claim_refund_follow_up_customer_reply(uuid, uuid)
  to service_role;
grant execute on function public.service_claim_refund_provider_exception_action(uuid, uuid, text, text)
  to service_role;
grant execute on function public.service_claim_refund_automation_action(uuid, uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.service_claim_refund_gpt_triage_jobs(text, text, text, text, integer)
  to service_role;
grant execute on function public.service_complete_refund_gpt_triage_job(uuid, text, text, jsonb)
  to service_role;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on table public.refund_customer_contact_settings is
  'Service-only shared kill switch and approved deterministic refund follow-up template settings. Automatic customer contact defaults off.';
comment on table public.refund_follow_up_cycles is
  'Immutable, bounded request/reminder/reply/receipt evidence for at most two explicit deterministic customer follow-up cycles per refund case.';
comment on function public.service_claim_refund_follow_up_cycle(uuid, text, text, text, uuid) is
  'Claims one default-off deterministic missing-information or confirmed no-safe-match cycle from versioned Nayax card evidence or complete persisted Sunze cash zero-candidate state; exact requested fields are computed server-side.';
comment on function public.service_claim_due_refund_follow_up_reminders(integer) is
  'Claims each due reminder once under row locks; a failed or abandoned claim is not retried automatically.';
comment on function public.service_claim_refund_follow_up_customer_reply(uuid, uuid) is
  'Claims one verified direct customer Gmail reply and one deterministic recheck per follow-up cycle.';
comment on function public.service_claim_refund_provider_exception_action(uuid, uuid, text, text) is
  'Claims one redacted internal provider exception action without generating customer correction or success copy.';
comment on function public.admin_get_refund_operations_overview() is
  'Scoped Refund Operations overview enriched only with safe deterministic follow-up evidence; no raw provider or model payloads.';
comment on function public.service_claim_refund_gpt_triage_jobs(text, text, text, text, integer) is
  'Claims only the latest verified direct customer Gmail message and returns only verified customer context to the human-reviewed GPT runner.';
comment on function public.service_complete_refund_gpt_triage_job(uuid, text, text, jsonb) is
  'Completes human-reviewed GPT triage only from verified direct customer source/context and ignores untrusted messages for stale checks.';

select pg_notify('pgrst', 'reload schema');
