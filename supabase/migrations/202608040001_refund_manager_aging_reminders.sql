-- Manager-only refund aging notices. This migration does not enable schedules,
-- customer contact, Gmail delivery, or official refund actions.

create extension if not exists pgcrypto with schema extensions;

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
    'manager_reminder',
    'manager_escalation',
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
    'manager_reminder',
    'manager_escalation',
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

create table if not exists public.refund_manager_attention_states (
  refund_case_id uuid primary key
    references public.refund_cases (id) on delete cascade,
  attention_version bigint not null default 1,
  attention_started_at timestamptz,
  case_status text not null,
  correlation_status text not null,
  decision text,
  deterministic_fact_version bigint not null,
  source_customer_message_id uuid
    references public.refund_gmail_messages (id) on delete set null,
  source_customer_message_received_at timestamptz,
  source_customer_message_created_at timestamptz,
  reminder_sent_at timestamptz,
  escalation_sent_at timestamptz,
  reminder_resolved_at timestamptz,
  escalation_resolved_at timestamptz,
  last_notice_milestone text,
  last_notice_outcome text,
  last_notice_at timestamptz,
  notice_attempt_key text,
  notice_attempt_attention_version bigint,
  notice_attempt_milestone text,
  notice_attempt_started_at timestamptz,
  notice_attempt_expected_outcome text,
  notice_attempt_business_day_age integer,
  notice_attempt_manager_recipient_count integer,
  notice_attempt_recipient_count integer,
  notice_attempt_resolution_status text,
  notice_attempt_mapping_fingerprint text,
  delivery_review_required_at timestamptz,
  delivery_review_reason text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint refund_manager_attention_version_check
    check (attention_version >= 1),
  constraint refund_manager_attention_source_check
    check (
      source_customer_message_id is null
      or (
        source_customer_message_received_at is not null
        and source_customer_message_created_at is not null
      )
    ),
  constraint refund_manager_attention_milestone_check
    check (last_notice_milestone is null or last_notice_milestone in ('reminder', 'escalation')),
  constraint refund_manager_attention_outcome_check
    check (
      last_notice_outcome is null
      or last_notice_outcome in (
        'delivered',
        'operations_exception',
        'delivery_unknown',
        'known_not_sent'
      )
    ),
  constraint refund_manager_attention_resolution_check
    check (
      (reminder_sent_at is null or reminder_resolved_at is not null)
      and (escalation_sent_at is null or escalation_resolved_at is not null)
    ),
  constraint refund_manager_attention_attempt_check
    check (
      (
        notice_attempt_key is null
        and notice_attempt_attention_version is null
        and notice_attempt_milestone is null
        and notice_attempt_started_at is null
        and notice_attempt_expected_outcome is null
        and notice_attempt_business_day_age is null
        and notice_attempt_manager_recipient_count is null
        and notice_attempt_recipient_count is null
        and notice_attempt_resolution_status is null
        and notice_attempt_mapping_fingerprint is null
      )
      or (
        length(notice_attempt_key) between 8 and 220
        and notice_attempt_key ~ '^[A-Za-z0-9:._-]+$'
        and notice_attempt_attention_version >= 1
        and notice_attempt_milestone in ('reminder', 'escalation')
        and notice_attempt_started_at is not null
        and notice_attempt_expected_outcome in ('delivered', 'operations_exception')
        and notice_attempt_business_day_age between 0 and 3650
        and notice_attempt_manager_recipient_count between 0 and 3
        and notice_attempt_recipient_count between 1 and 5
        and notice_attempt_recipient_count >= notice_attempt_manager_recipient_count
        and length(notice_attempt_resolution_status) between 1 and 80
        and notice_attempt_resolution_status ~ '^[a-z0-9_]+$'
        and length(notice_attempt_mapping_fingerprint) = 64
        and notice_attempt_mapping_fingerprint ~ '^[a-f0-9]{64}$'
        and (
          (
            notice_attempt_expected_outcome = 'delivered'
            and notice_attempt_manager_recipient_count between 1 and 3
            and notice_attempt_recipient_count = notice_attempt_manager_recipient_count
          )
          or (
            notice_attempt_expected_outcome = 'operations_exception'
            and notice_attempt_manager_recipient_count = 0
          )
        )
      )
    ),
  constraint refund_manager_attention_delivery_review_check
    check (
      (
        delivery_review_required_at is null
        and delivery_review_reason is null
        and notice_attempt_key is null
      )
      or (
        delivery_review_required_at is not null
        and delivery_review_reason in ('notice_attempt_in_flight', 'delivery_unknown')
        and notice_attempt_key is not null
      )
    )
);

create index if not exists refund_manager_attention_due_idx
  on public.refund_manager_attention_states (attention_started_at, attention_version)
  where attention_started_at is not null
    and delivery_review_required_at is null;

create unique index if not exists refund_manager_attention_attempt_key_idx
  on public.refund_manager_attention_states (notice_attempt_key)
  where notice_attempt_key is not null;

alter table public.refund_manager_attention_states enable row level security;
revoke all on table public.refund_manager_attention_states from public, anon, authenticated;
grant select, insert, update, delete on table public.refund_manager_attention_states to service_role;

create or replace function public.refund_case_requires_manager_attention(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_status, '') in (
    'submitted',
    'needs_review',
    'correlated',
    'approved',
    'card_refund_pending',
    'cash_zelle_pending'
  );
$$;

insert into public.refund_manager_attention_states (
  refund_case_id,
  attention_version,
  attention_started_at,
  case_status,
  correlation_status,
  decision,
  deterministic_fact_version,
  source_customer_message_id,
  source_customer_message_received_at,
  source_customer_message_created_at
)
select
  refund_case.id,
  1,
  case
    when public.refund_case_requires_manager_attention(refund_case.status)
      then greatest(
        refund_case.created_at,
        refund_case.deterministic_facts_updated_at,
        coalesce(latest_customer.safe_created_at, '-infinity'::timestamptz)
      )
    else null
  end,
  refund_case.status,
  refund_case.correlation_status,
  refund_case.decision,
  refund_case.deterministic_fact_version,
  latest_customer.id,
  latest_customer.safe_received_at,
  latest_customer.safe_created_at
from public.refund_cases refund_case
left join lateral (
  select
    message.id,
    least(message.received_at, message.created_at, statement_timestamp()) as safe_received_at,
    least(message.created_at, statement_timestamp()) as safe_created_at
  from public.refund_gmail_messages message
  where message.refund_case_id = refund_case.id
    and message.direction = 'inbound'
    and message.message_kind = 'message'
    and message.participant_role = 'customer'
    and message.participant_trust = 'verified'
  order by message.created_at desc, message.id desc
  limit 1
) latest_customer on true
on conflict (refund_case_id) do nothing;

create or replace function public.sync_refund_manager_attention_from_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requires_attention boolean;
  meaningful_change boolean;
begin
  requires_attention := public.refund_case_requires_manager_attention(new.status);

  if tg_op = 'INSERT' then
    insert into public.refund_manager_attention_states (
      refund_case_id,
      attention_version,
      attention_started_at,
      case_status,
      correlation_status,
      decision,
      deterministic_fact_version
    ) values (
      new.id,
      1,
      case when requires_attention then statement_timestamp() else null end,
      new.status,
      new.correlation_status,
      new.decision,
      new.deterministic_fact_version
    )
    on conflict (refund_case_id) do nothing;
    return new;
  end if;

  meaningful_change :=
    new.status is distinct from old.status
    or new.correlation_status is distinct from old.correlation_status
    or new.decision is distinct from old.decision
    or new.deterministic_fact_version is distinct from old.deterministic_fact_version;

  if meaningful_change then
    insert into public.refund_manager_attention_states (
      refund_case_id,
      attention_version,
      attention_started_at,
      case_status,
      correlation_status,
      decision,
      deterministic_fact_version
    ) values (
      new.id,
      1,
      case when requires_attention then statement_timestamp() else null end,
      new.status,
      new.correlation_status,
      new.decision,
      new.deterministic_fact_version
    )
    on conflict (refund_case_id) do update
    set
      attention_version = public.refund_manager_attention_states.attention_version + 1,
      attention_started_at = case
        when requires_attention then statement_timestamp()
        else null
      end,
      case_status = excluded.case_status,
      correlation_status = excluded.correlation_status,
      decision = excluded.decision,
      deterministic_fact_version = excluded.deterministic_fact_version,
      reminder_sent_at = null,
      escalation_sent_at = null,
      reminder_resolved_at = null,
      escalation_resolved_at = null,
      last_notice_milestone = null,
      last_notice_outcome = null,
      last_notice_at = null,
      -- An attempt hold is global to the case, not the attention version. A
      -- reply or manager re-evaluation cannot make an uncertain send safe to retry.
      delivery_review_required_at = case
        when public.refund_manager_attention_states.notice_attempt_key is null then null
        else public.refund_manager_attention_states.delivery_review_required_at
      end,
      delivery_review_reason = case
        when public.refund_manager_attention_states.notice_attempt_key is null then null
        else public.refund_manager_attention_states.delivery_review_reason
      end,
      updated_at = statement_timestamp();
  end if;

  return new;
end;
$$;

drop trigger if exists refund_cases_sync_manager_attention on public.refund_cases;
create trigger refund_cases_sync_manager_attention
after insert or update of
  status,
  correlation_status,
  decision,
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
  deterministic_fact_version
on public.refund_cases
for each row execute function public.sync_refund_manager_attention_from_case();

create or replace function public.sync_refund_manager_attention_from_customer_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  safe_received_at timestamptz;
  safe_created_at timestamptz;
begin
  if new.direction <> 'inbound'
    or new.message_kind <> 'message'
    or new.participant_role <> 'customer'
    or new.participant_trust <> 'verified' then
    return new;
  end if;

  select * into case_row
  from public.refund_cases
  where id = new.refund_case_id;
  if case_row.id is null then return new; end if;

  -- Provider timestamps are evidence only. The database-created tuple is the
  -- trusted monotonic replay key, and both timestamps are clamped before use.
  safe_created_at := least(new.created_at, statement_timestamp());
  safe_received_at := least(new.received_at, safe_created_at);
  insert into public.refund_manager_attention_states (
    refund_case_id,
    attention_version,
    attention_started_at,
    case_status,
    correlation_status,
    decision,
    deterministic_fact_version,
    source_customer_message_id,
    source_customer_message_received_at,
    source_customer_message_created_at
  ) values (
    case_row.id,
    1,
    null,
    case_row.status,
    case_row.correlation_status,
    case_row.decision,
    case_row.deterministic_fact_version,
    new.id,
    safe_received_at,
    safe_created_at
  )
  on conflict (refund_case_id) do update
  set
    attention_version = public.refund_manager_attention_states.attention_version + 1,
    -- A verified customer reply always pauses reminders. Only a later,
    -- manager-relevant case re-evaluation may start a new attention clock.
    attention_started_at = null,
    case_status = case_row.status,
    correlation_status = case_row.correlation_status,
    decision = case_row.decision,
    deterministic_fact_version = case_row.deterministic_fact_version,
    source_customer_message_id = new.id,
    source_customer_message_received_at = safe_received_at,
    source_customer_message_created_at = safe_created_at,
    reminder_sent_at = null,
    escalation_sent_at = null,
    reminder_resolved_at = null,
    escalation_resolved_at = null,
    last_notice_milestone = null,
    last_notice_outcome = null,
    last_notice_at = null,
    delivery_review_required_at = case
      when public.refund_manager_attention_states.notice_attempt_key is null then null
      else public.refund_manager_attention_states.delivery_review_required_at
    end,
    delivery_review_reason = case
      when public.refund_manager_attention_states.notice_attempt_key is null then null
      else public.refund_manager_attention_states.delivery_review_reason
    end,
    updated_at = statement_timestamp()
  where (safe_created_at, new.id) > (
    coalesce(
      public.refund_manager_attention_states.source_customer_message_created_at,
      '-infinity'::timestamptz
    ),
    coalesce(
      public.refund_manager_attention_states.source_customer_message_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

  return new;
end;
$$;

drop trigger if exists refund_gmail_messages_sync_manager_attention
  on public.refund_gmail_messages;
create trigger refund_gmail_messages_sync_manager_attention
after insert or update of participant_role, participant_trust
on public.refund_gmail_messages
for each row execute function public.sync_refund_manager_attention_from_customer_message();

create or replace function public.service_refund_business_days_elapsed(
  p_started_at timestamptz,
  p_observed_at timestamptz,
  p_timezone text default 'America/Los_Angeles'
)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  start_local timestamp;
  observed_local timestamp;
  candidate_date date;
  elapsed integer := 0;
begin
  if p_started_at is null or p_observed_at is null or p_observed_at < p_started_at then
    return 0;
  end if;
  if length(coalesce(p_timezone, '')) not between 1 and 80
    or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A supported automation timezone is required';
  end if;

  start_local := timezone(p_timezone, p_started_at);
  observed_local := timezone(p_timezone, p_observed_at);
  if observed_local::date <= start_local::date then return 0; end if;

  candidate_date := start_local::date + 1;
  while candidate_date <= observed_local::date loop
    if extract(isodow from candidate_date) between 1 and 5 then
      elapsed := elapsed + 1;
    end if;
    candidate_date := candidate_date + 1;
  end loop;

  if elapsed > 0
    and extract(isodow from observed_local::date) between 1 and 5
    and observed_local::time < start_local::time then
    elapsed := elapsed - 1;
  end if;
  return greatest(0, elapsed);
end;
$$;

create or replace function public.service_list_due_refund_manager_aging_notices(
  p_observed_at timestamptz,
  p_timezone text,
  p_reminder_business_days integer,
  p_escalation_business_days integer,
  p_template_version text,
  p_limit integer default 100
)
returns table (
  refund_case_id uuid,
  attention_version bigint,
  attention_started_at timestamptz,
  milestone text,
  business_day_age integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_template_version <> 'refund_manager_aging_v1' then
    raise exception 'Unsupported manager aging template';
  end if;
  if p_reminder_business_days not between 1 and 10
    or p_escalation_business_days not between 2 and 20
    or p_escalation_business_days <= p_reminder_business_days then
    raise exception 'Safe manager aging thresholds are required';
  end if;
  if p_limit not between 1 and 500 then
    raise exception 'A bounded manager aging candidate limit is required';
  end if;
  if length(coalesce(p_timezone, '')) not between 1 and 80
    or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'A supported automation timezone is required';
  end if;

  return query
  with eligible as (
    select
      attention.refund_case_id,
      attention.attention_version,
      attention.attention_started_at,
      age.business_day_age,
      case
        when attention.escalation_resolved_at is null
          and age.business_day_age >= p_escalation_business_days
          then 'escalation'
        when attention.reminder_resolved_at is null
          and attention.escalation_resolved_at is null
          and age.business_day_age >= p_reminder_business_days
          then 'reminder'
        else null
      end as milestone
    from public.refund_manager_attention_states attention
    join public.refund_cases refund_case
      on refund_case.id = attention.refund_case_id
    cross join lateral (
      select public.service_refund_business_days_elapsed(
        attention.attention_started_at,
        coalesce(p_observed_at, statement_timestamp()),
        p_timezone
      ) as business_day_age
    ) age
    where attention.attention_started_at is not null
      and attention.delivery_review_required_at is null
      and attention.notice_attempt_key is null
      and public.refund_case_requires_manager_attention(refund_case.status)
      and refund_case.status not in (
        'draft', 'waiting_on_customer', 'denied', 'completed', 'closed'
      )
      and attention.case_status = refund_case.status
      and attention.correlation_status = refund_case.correlation_status
      and attention.decision is not distinct from refund_case.decision
      and attention.deterministic_fact_version = refund_case.deterministic_fact_version
      and not exists (
        select 1
        from public.refund_gmail_threads gmail_thread
        where gmail_thread.refund_case_id = refund_case.id
          and gmail_thread.automatic_customer_contact_paused_at is not null
      )
  ), due as (
    select eligible.*
    from eligible
    where eligible.milestone is not null
      and not exists (
        select 1
        from public.refund_automation_actions automation_action
        where automation_action.action_key = format(
          'manager_aging:%s:%s:v%s',
          eligible.milestone,
          eligible.refund_case_id,
          eligible.attention_version
        )
      )
  )
  select
    due.refund_case_id,
    due.attention_version,
    due.attention_started_at,
    due.milestone,
    due.business_day_age
  from due
  order by
    (due.milestone = 'escalation') desc,
    due.attention_started_at,
    due.refund_case_id
  limit p_limit;
end;
$$;

create or replace function public.service_authorize_refund_manager_aging_notice(
  p_refund_case_id uuid,
  p_attention_version bigint,
  p_milestone text,
  p_observed_at timestamptz,
  p_timezone text,
  p_reminder_business_days integer,
  p_escalation_business_days integer,
  p_template_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  attention_row public.refund_manager_attention_states;
  case_row public.refund_cases;
  business_age integer;
  required_age integer;
begin
  if p_milestone not in ('reminder', 'escalation') then
    raise exception 'Unsupported manager aging milestone';
  end if;
  if p_template_version <> 'refund_manager_aging_v1' then
    raise exception 'Unsupported manager aging template';
  end if;
  if p_reminder_business_days not between 1 and 10
    or p_escalation_business_days not between 2 and 20
    or p_escalation_business_days <= p_reminder_business_days then
    raise exception 'Safe manager aging thresholds are required';
  end if;

  select * into attention_row
  from public.refund_manager_attention_states
  where refund_case_id = p_refund_case_id
  for update;
  if attention_row.refund_case_id is null then
    return jsonb_build_object('authorized', false, 'reason', 'attention_state_missing');
  end if;
  if attention_row.attention_version <> p_attention_version then
    return jsonb_build_object('authorized', false, 'reason', 'stale_attention_version');
  end if;
  if attention_row.attention_started_at is null then
    return jsonb_build_object('authorized', false, 'reason', 'manager_attention_paused');
  end if;
  if attention_row.delivery_review_required_at is not null then
    return jsonb_build_object('authorized', false, 'reason', 'delivery_review_required');
  end if;

  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id
  for share;
  if case_row.id is null then
    return jsonb_build_object('authorized', false, 'reason', 'case_missing');
  end if;
  if not public.refund_case_requires_manager_attention(case_row.status)
    or case_row.status in ('draft', 'waiting_on_customer', 'denied', 'completed', 'closed') then
    return jsonb_build_object('authorized', false, 'reason', 'case_not_manager_actionable');
  end if;
  if attention_row.case_status <> case_row.status
    or attention_row.correlation_status <> case_row.correlation_status
    or attention_row.decision is distinct from case_row.decision
    or attention_row.deterministic_fact_version <> case_row.deterministic_fact_version then
    return jsonb_build_object('authorized', false, 'reason', 'attention_state_stale');
  end if;
  if exists (
    select 1
    from public.refund_gmail_threads thread
    where thread.refund_case_id = case_row.id
      and thread.automatic_customer_contact_paused_at is not null
  ) then
    return jsonb_build_object('authorized', false, 'reason', 'customer_bounce_hold');
  end if;
  if p_milestone = 'reminder' and attention_row.reminder_resolved_at is not null then
    return jsonb_build_object('authorized', false, 'reason', 'reminder_already_resolved');
  end if;
  if p_milestone = 'reminder' and attention_row.escalation_resolved_at is not null then
    return jsonb_build_object('authorized', false, 'reason', 'higher_milestone_already_resolved');
  end if;
  if p_milestone = 'escalation' and attention_row.escalation_resolved_at is not null then
    return jsonb_build_object('authorized', false, 'reason', 'escalation_already_resolved');
  end if;

  business_age := public.service_refund_business_days_elapsed(
    attention_row.attention_started_at,
    coalesce(p_observed_at, statement_timestamp()),
    p_timezone
  );
  required_age := case
    when p_milestone = 'reminder' then p_reminder_business_days
    else p_escalation_business_days
  end;
  if business_age < required_age then
    return jsonb_build_object(
      'authorized', false,
      'reason', 'milestone_not_due',
      'businessDayAge', business_age
    );
  end if;

  return jsonb_build_object(
    'authorized', true,
    'reason', 'authorized',
    'attentionVersion', attention_row.attention_version,
    'attentionStartedAt', attention_row.attention_started_at,
    'businessDayAge', business_age,
    'caseStatus', case_row.status,
    'payloadRedacted', true
  );
end;
$$;

drop function if exists public.service_begin_refund_manager_aging_notice_attempt(
  uuid, bigint, text, timestamptz, text, integer, integer, text, text,
  text, integer, integer, text
);

create or replace function public.service_begin_refund_manager_aging_notice_attempt(
  p_refund_case_id uuid,
  p_attention_version bigint,
  p_milestone text,
  p_observed_at timestamptz,
  p_timezone text,
  p_reminder_business_days integer,
  p_escalation_business_days integer,
  p_template_version text,
  p_action_key text,
  p_mailbox_identities text[],
  p_ops_fallback_recipients text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  authorization_result jsonb;
  case_row public.refund_cases;
  recipient_resolution jsonb;
  mailbox_identities text[];
  manager_recipients text[] := '{}'::text[];
  ops_recipients text[] := '{}'::text[];
  route_recipients text[] := '{}'::text[];
  active_mapping_ids uuid[] := '{}'::uuid[];
  expected_outcome text;
  route_type text;
  manager_recipient_count integer := 0;
  recipient_count integer := 0;
  resolution_status text;
  mapping_fingerprint text;
  fingerprint_material text;
  expected_action_key text;
  updated_count integer;
begin
  if p_milestone not in ('reminder', 'escalation') then
    raise exception 'Unsupported manager aging milestone';
  end if;
  expected_action_key := format(
    'manager_aging:%s:%s:v%s',
    p_milestone,
    p_refund_case_id,
    p_attention_version
  );
  if p_action_key is distinct from expected_action_key then
    raise exception 'The manager aging attempt key is not bound to this milestone';
  end if;
  if not exists (
    select 1
    from public.refund_automation_actions automation_action
    where automation_action.action_key = p_action_key
      and automation_action.refund_case_id = p_refund_case_id
      and automation_action.action_type = case
        when p_milestone = 'reminder' then 'manager_reminder'
        else 'manager_escalation'
      end
      and automation_action.status = 'claimed'
  ) then
    raise exception 'A claimed manager aging automation action is required';
  end if;

  -- The authorization row lock remains held for this transaction, so the
  -- delivery hold below is the final atomic gate before provider invocation.
  authorization_result := public.service_authorize_refund_manager_aging_notice(
    p_refund_case_id,
    p_attention_version,
    p_milestone,
    p_observed_at,
    p_timezone,
    p_reminder_business_days,
    p_escalation_business_days,
    p_template_version
  );
  if coalesce((authorization_result ->> 'authorized')::boolean, false) is not true then
    return authorization_result;
  end if;

  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id;
  if case_row.id is null or case_row.reporting_machine_id is null then
    return jsonb_build_object(
      'authorized', false,
      'reason', 'manager_route_machine_missing'
    );
  end if;

  mailbox_identities := public.normalize_refund_mailbox_identities(
    p_mailbox_identities
  );
  if cardinality(mailbox_identities) not between 1 and 10 then
    return jsonb_build_object(
      'authorized', false,
      'reason', 'mailbox_identity_policy_invalid'
    );
  end if;

  -- The same advisory and parent-row lock order used by the manager-assignment
  -- RPC makes the active mapping snapshot canonical. The parent lock also
  -- blocks new FK-backed mappings until this short reservation commits.
  perform pg_advisory_xact_lock(
    hashtext('machine_manager:' || case_row.reporting_machine_id::text)
  );
  perform 1
  from public.reporting_machines machine
  where machine.id = case_row.reporting_machine_id
  for update;
  if not found then
    return jsonb_build_object(
      'authorized', false,
      'reason', 'manager_route_machine_missing'
    );
  end if;

  -- Lock all existing mapping rows in one deterministic order. Direct mapping
  -- updates are serialized even if they did not use the assignment RPC.
  perform 1
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = case_row.reporting_machine_id
  order by manager.id
  for update;

  select coalesce(array_agg(manager.id order by manager.id), '{}'::uuid[])
  into active_mapping_ids
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = case_row.reporting_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  recipient_resolution := public.service_resolve_refund_customer_manager_cc(
    p_refund_case_id,
    case_row.customer_email,
    mailbox_identities
  );
  resolution_status := lower(btrim(coalesce(
    recipient_resolution ->> 'status',
    'resolution_failed'
  )));
  if length(resolution_status) not between 1 and 80
    or resolution_status !~ '^[a-z0-9_]+$' then
    resolution_status := 'resolution_contract_invalid';
  end if;

  if jsonb_typeof(recipient_resolution -> 'managerCcEmails') = 'array' then
    select coalesce(array_agg(candidate.email order by candidate.email), '{}'::text[])
    into manager_recipients
    from (
      select distinct lower(btrim(value)) as email
      from jsonb_array_elements_text(
        recipient_resolution -> 'managerCcEmails'
      ) value
      where public.refund_email_address_is_valid(value)
        and lower(btrim(value)) <> lower(btrim(case_row.customer_email))
        and not (lower(btrim(value)) = any(mailbox_identities))
    ) candidate;
  end if;

  if cardinality(manager_recipients) between 1 and 3
    and coalesce((recipient_resolution ->> 'managerCcCount')::integer, -1) =
      cardinality(manager_recipients) then
    route_recipients := manager_recipients;
    route_type := 'manager';
    expected_outcome := 'delivered';
    manager_recipient_count := cardinality(manager_recipients);
  else
    manager_recipients := '{}'::text[];
    manager_recipient_count := 0;

    select coalesce(array_agg(candidate.email order by candidate.email), '{}'::text[])
    into ops_recipients
    from (
      select distinct lower(btrim(entry)) as email
      from unnest(coalesce(p_ops_fallback_recipients, '{}'::text[])) entry
      where public.refund_email_address_is_valid(entry)
        and lower(btrim(entry)) <> lower(btrim(case_row.customer_email))
        and not (lower(btrim(entry)) = any(mailbox_identities))
    ) candidate;

    if cardinality(ops_recipients) not between 1 and 5 then
      return authorization_result || jsonb_build_object(
        'authorized', false,
        'reason', 'ops_fallback_policy_invalid'
      );
    end if;
    route_recipients := ops_recipients;
    route_type := 'operations';
    expected_outcome := 'operations_exception';
  end if;

  recipient_count := cardinality(route_recipients);
  fingerprint_material := concat_ws(
    '|',
    'refund_manager_route_v1',
    'case=' || p_refund_case_id::text,
    'attention=' || p_attention_version::text,
    'milestone=' || p_milestone,
    'template=' || p_template_version,
    'mapping_ids=' || coalesce(array_to_string(active_mapping_ids, ','), ''),
    'route_type=' || route_type,
    'resolution=' || resolution_status,
    'manager_count=' || manager_recipient_count::text,
    'recipient_count=' || recipient_count::text
  );
  mapping_fingerprint := encode(
    extensions.digest(convert_to(fingerprint_material, 'UTF8'), 'sha256'),
    'hex'
  );

  update public.refund_manager_attention_states
  set
    notice_attempt_key = p_action_key,
    notice_attempt_attention_version = p_attention_version,
    notice_attempt_milestone = p_milestone,
    notice_attempt_started_at = statement_timestamp(),
    notice_attempt_expected_outcome = expected_outcome,
    notice_attempt_business_day_age = (authorization_result ->> 'businessDayAge')::integer,
    notice_attempt_manager_recipient_count = manager_recipient_count,
    notice_attempt_recipient_count = recipient_count,
    notice_attempt_resolution_status = resolution_status,
    notice_attempt_mapping_fingerprint = mapping_fingerprint,
    delivery_review_required_at = statement_timestamp(),
    delivery_review_reason = 'notice_attempt_in_flight',
    updated_at = statement_timestamp()
  where refund_case_id = p_refund_case_id
    and attention_version = p_attention_version
    and notice_attempt_key is null
    and delivery_review_required_at is null;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    return jsonb_build_object(
      'authorized', false,
      'reason', 'notice_attempt_conflict'
    );
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    p_refund_case_id,
    'refund_manager_aging_notice_attempt_started',
    'A manager aging notice attempt was reserved before provider delivery; later notices are held until settlement.',
    jsonb_build_object(
      'milestone', p_milestone,
      'attention_version', p_attention_version,
      'template_version', p_template_version,
      'business_day_age', (authorization_result ->> 'businessDayAge')::integer,
      'expected_outcome', expected_outcome,
      'route_type', route_type,
      'recipient_count', recipient_count,
      'machine_manager_recipient_count', manager_recipient_count,
      'manager_resolution_status', resolution_status,
      'mapping_fingerprint', mapping_fingerprint,
      'payload_redacted', true
    )
  );

  return authorization_result || jsonb_build_object(
    'attemptStarted', true,
    'attemptKey', p_action_key,
    'recipientRoute', jsonb_build_object(
      'recipients', to_jsonb(route_recipients),
      'routeType', route_type,
      'managerRecipientCount', manager_recipient_count,
      'recipientCount', recipient_count,
      'resolutionStatus', resolution_status,
      'mappingFingerprint', mapping_fingerprint
    )
  );
end;
$$;

create or replace function public.service_complete_refund_manager_aging_notice(
  p_refund_case_id uuid,
  p_action_key text,
  p_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  attention_row public.refund_manager_attention_states;
  settles_current_version boolean;
  is_known_sent boolean;
  event_type text;
  event_message text;
begin
  if p_outcome not in (
    'delivered',
    'operations_exception',
    'delivery_unknown',
    'known_not_sent'
  ) then
    raise exception 'Unsupported manager aging delivery outcome';
  end if;
  if length(coalesce(p_action_key, '')) not between 8 and 220
    or p_action_key !~ '^[A-Za-z0-9:._-]+$' then
    raise exception 'A safe manager aging attempt key is required';
  end if;

  select * into attention_row
  from public.refund_manager_attention_states
  where refund_case_id = p_refund_case_id
  for update;
  if attention_row.refund_case_id is null
    or attention_row.notice_attempt_key is distinct from p_action_key then
    return false;
  end if;
  if p_outcome in ('delivered', 'operations_exception')
    and p_outcome is distinct from attention_row.notice_attempt_expected_outcome then
    raise exception 'Known-sent settlement must match the reserved recipient route';
  end if;
  if p_outcome = 'delivery_unknown'
    and attention_row.delivery_review_reason = 'delivery_unknown' then
    return true;
  end if;

  settles_current_version :=
    attention_row.attention_version = attention_row.notice_attempt_attention_version;
  is_known_sent := p_outcome in ('delivered', 'operations_exception');

  update public.refund_manager_attention_states
  set
    reminder_sent_at = case
      when settles_current_version
        and attention_row.notice_attempt_milestone = 'reminder'
        and is_known_sent then statement_timestamp()
      else reminder_sent_at
    end,
    escalation_sent_at = case
      when settles_current_version
        and attention_row.notice_attempt_milestone = 'escalation'
        and is_known_sent then statement_timestamp()
      else escalation_sent_at
    end,
    reminder_resolved_at = case
      when settles_current_version
        and attention_row.notice_attempt_milestone = 'reminder'
        and p_outcome <> 'delivery_unknown' then statement_timestamp()
      else reminder_resolved_at
    end,
    escalation_resolved_at = case
      when settles_current_version
        and attention_row.notice_attempt_milestone = 'escalation'
        and p_outcome <> 'delivery_unknown' then statement_timestamp()
      else escalation_resolved_at
    end,
    last_notice_milestone = case
      when settles_current_version then attention_row.notice_attempt_milestone
      else last_notice_milestone
    end,
    last_notice_outcome = case
      when settles_current_version then p_outcome
      else last_notice_outcome
    end,
    last_notice_at = case
      when settles_current_version then statement_timestamp()
      else last_notice_at
    end,
    notice_attempt_key = case
      when p_outcome = 'delivery_unknown' then notice_attempt_key
      else null
    end,
    notice_attempt_attention_version = case
      when p_outcome = 'delivery_unknown' then notice_attempt_attention_version
      else null
    end,
    notice_attempt_milestone = case
      when p_outcome = 'delivery_unknown' then notice_attempt_milestone
      else null
    end,
    notice_attempt_started_at = case
      when p_outcome = 'delivery_unknown' then notice_attempt_started_at
      else null
    end,
    notice_attempt_expected_outcome = case
      when p_outcome = 'delivery_unknown' then notice_attempt_expected_outcome
      else null
    end,
    notice_attempt_business_day_age = case
      when p_outcome = 'delivery_unknown' then notice_attempt_business_day_age
      else null
    end,
    notice_attempt_manager_recipient_count = case
      when p_outcome = 'delivery_unknown' then notice_attempt_manager_recipient_count
      else null
    end,
    notice_attempt_recipient_count = case
      when p_outcome = 'delivery_unknown' then notice_attempt_recipient_count
      else null
    end,
    notice_attempt_resolution_status = case
      when p_outcome = 'delivery_unknown' then notice_attempt_resolution_status
      else null
    end,
    notice_attempt_mapping_fingerprint = case
      when p_outcome = 'delivery_unknown' then notice_attempt_mapping_fingerprint
      else null
    end,
    delivery_review_required_at = case
      when p_outcome = 'delivery_unknown'
        then coalesce(delivery_review_required_at, statement_timestamp())
      else null
    end,
    delivery_review_reason = case
      when p_outcome = 'delivery_unknown' then 'delivery_unknown'
      else null
    end,
    updated_at = statement_timestamp()
  where refund_case_id = p_refund_case_id;

  event_type := case
    when p_outcome = 'delivered' then 'refund_manager_aging_notice_sent'
    when p_outcome = 'operations_exception' then 'refund_manager_aging_routing_exception'
    when p_outcome = 'known_not_sent' then 'refund_manager_aging_notice_not_sent'
    else 'refund_manager_aging_delivery_uncertain'
  end;
  event_message := case
    when p_outcome = 'delivered' then 'A manager aging notice was sent to the current mapped Machine Managers.'
    when p_outcome = 'operations_exception' then 'A redacted operations exception was sent because no eligible current Machine Manager was resolved.'
    when p_outcome = 'known_not_sent' then 'The reserved manager aging notice is confirmed not sent; its global delivery hold was cleared without an automatic retry.'
    else 'Manager aging notice delivery is uncertain and requires review; no automatic retry will occur.'
  end;
  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    p_refund_case_id,
    event_type,
    event_message,
    jsonb_build_object(
      'milestone', attention_row.notice_attempt_milestone,
      'attempt_attention_version', attention_row.notice_attempt_attention_version,
      'current_attention_version', attention_row.attention_version,
      'settled_current_attention_version', settles_current_version,
      'template_version', 'refund_manager_aging_v1',
      'business_day_age', attention_row.notice_attempt_business_day_age,
      'recipient_count', attention_row.notice_attempt_recipient_count,
      'machine_manager_recipient_count', attention_row.notice_attempt_manager_recipient_count,
      'manager_resolution_status', attention_row.notice_attempt_resolution_status,
      'mapping_fingerprint', attention_row.notice_attempt_mapping_fingerprint,
      'delivery_outcome', p_outcome,
      'used_ops_fallback', attention_row.notice_attempt_expected_outcome = 'operations_exception',
      'payload_redacted', true
    )
  );
  return true;
end;
$$;

revoke execute on function public.refund_case_requires_manager_attention(text)
  from public, anon, authenticated;
revoke execute on function public.sync_refund_manager_attention_from_case()
  from public, anon, authenticated;
revoke execute on function public.sync_refund_manager_attention_from_customer_message()
  from public, anon, authenticated;
revoke execute on function public.service_refund_business_days_elapsed(timestamptz, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.service_list_due_refund_manager_aging_notices(timestamptz, text, integer, integer, text, integer)
  from public, anon, authenticated;
revoke execute on function public.service_authorize_refund_manager_aging_notice(uuid, bigint, text, timestamptz, text, integer, integer, text)
  from public, anon, authenticated;
revoke execute on function public.service_begin_refund_manager_aging_notice_attempt(uuid, bigint, text, timestamptz, text, integer, integer, text, text, text[], text[])
  from public, anon, authenticated;
revoke execute on function public.service_complete_refund_manager_aging_notice(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.refund_case_requires_manager_attention(text)
  to service_role;
grant execute on function public.service_refund_business_days_elapsed(timestamptz, timestamptz, text)
  to service_role;
grant execute on function public.service_list_due_refund_manager_aging_notices(timestamptz, text, integer, integer, text, integer)
  to service_role;
grant execute on function public.service_authorize_refund_manager_aging_notice(uuid, bigint, text, timestamptz, text, integer, integer, text)
  to service_role;
grant execute on function public.service_begin_refund_manager_aging_notice_attempt(uuid, bigint, text, timestamptz, text, integer, integer, text, text, text[], text[])
  to service_role;
grant execute on function public.service_complete_refund_manager_aging_notice(uuid, text, text)
  to service_role;

comment on table public.refund_manager_attention_states is
  'Service-only manager-attention clock, bounded reminder/escalation state, and global pre-send attempt hold. Contains no customer content, payment details, provider identifiers, or recipient addresses.';
comment on function public.service_list_due_refund_manager_aging_notices(timestamptz, text, integer, integer, text, integer) is
  'Returns only due, current, unclaimed manager aging milestones before applying the bounded scheduler limit, preventing completed or non-due rows from starving later cases.';
comment on function public.service_authorize_refund_manager_aging_notice(uuid, bigint, text, timestamptz, text, integer, integer, text) is
  'Fail-closed send-time authorization for one versioned manager-only reminder or escalation. Rechecks state, business-day age, terminal/waiting state, and case-wide bounce holds.';
comment on function public.service_begin_refund_manager_aging_notice_attempt(uuid, bigint, text, timestamptz, text, integer, integer, text, text, text[], text[]) is
  'Atomically reauthorizes, locks and re-resolves the current manager mapping, binds non-address route evidence, and returns the exact transient service-only recipient route before provider invocation. The global hold survives attention-version changes until explicit settlement.';
comment on function public.service_complete_refund_manager_aging_notice(uuid, text, text) is
  'Settles one exact reserved attempt with redacted evidence. Known sent/not-sent outcomes clear the global hold; unknown delivery remains held. An old attempt never marks a newer attention version.';
