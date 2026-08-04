-- Manager-only refund aging notices. This migration does not enable schedules,
-- customer contact, Gmail delivery, or official refund actions.

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
  reminder_sent_at timestamptz,
  escalation_sent_at timestamptz,
  last_notice_milestone text,
  last_notice_outcome text,
  last_notice_at timestamptz,
  delivery_review_required_at timestamptz,
  delivery_review_reason text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint refund_manager_attention_version_check
    check (attention_version >= 1),
  constraint refund_manager_attention_source_check
    check (
      source_customer_message_id is null
      or source_customer_message_received_at is not null
    ),
  constraint refund_manager_attention_milestone_check
    check (last_notice_milestone is null or last_notice_milestone in ('reminder', 'escalation')),
  constraint refund_manager_attention_outcome_check
    check (
      last_notice_outcome is null
      or last_notice_outcome in ('delivered', 'operations_exception', 'delivery_unknown')
    ),
  constraint refund_manager_attention_delivery_review_check
    check (
      (delivery_review_required_at is null and delivery_review_reason is null)
      or (
        delivery_review_required_at is not null
        and delivery_review_reason = 'delivery_unknown'
      )
    )
);

create index if not exists refund_manager_attention_due_idx
  on public.refund_manager_attention_states (attention_started_at, attention_version)
  where attention_started_at is not null
    and delivery_review_required_at is null;

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
  source_customer_message_received_at
)
select
  refund_case.id,
  1,
  case
    when public.refund_case_requires_manager_attention(refund_case.status)
      then greatest(
        refund_case.created_at,
        refund_case.deterministic_facts_updated_at,
        coalesce(latest_customer.received_at, '-infinity'::timestamptz)
      )
    else null
  end,
  refund_case.status,
  refund_case.correlation_status,
  refund_case.decision,
  refund_case.deterministic_fact_version,
  latest_customer.id,
  latest_customer.received_at
from public.refund_cases refund_case
left join lateral (
  select message.id, message.received_at
  from public.refund_gmail_messages message
  where message.refund_case_id = refund_case.id
    and message.direction = 'inbound'
    and message.message_kind = 'message'
    and message.participant_role = 'customer'
    and message.participant_trust = 'verified'
  order by message.received_at desc, message.id desc
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
      last_notice_milestone = null,
      last_notice_outcome = null,
      last_notice_at = null,
      delivery_review_required_at = null,
      delivery_review_reason = null,
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

  safe_received_at := least(new.received_at, statement_timestamp());
  insert into public.refund_manager_attention_states (
    refund_case_id,
    attention_version,
    attention_started_at,
    case_status,
    correlation_status,
    decision,
    deterministic_fact_version,
    source_customer_message_id,
    source_customer_message_received_at
  ) values (
    case_row.id,
    1,
    null,
    case_row.status,
    case_row.correlation_status,
    case_row.decision,
    case_row.deterministic_fact_version,
    new.id,
    safe_received_at
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
    reminder_sent_at = null,
    escalation_sent_at = null,
    last_notice_milestone = null,
    last_notice_outcome = null,
    last_notice_at = null,
    delivery_review_required_at = null,
    delivery_review_reason = null,
    updated_at = statement_timestamp()
  where new.received_at > coalesce(
    public.refund_manager_attention_states.source_customer_message_received_at,
    '-infinity'::timestamptz
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
  if p_milestone = 'reminder' and attention_row.reminder_sent_at is not null then
    return jsonb_build_object('authorized', false, 'reason', 'reminder_already_sent');
  end if;
  if p_milestone = 'reminder' and attention_row.escalation_sent_at is not null then
    return jsonb_build_object('authorized', false, 'reason', 'higher_milestone_already_sent');
  end if;
  if p_milestone = 'escalation' and attention_row.escalation_sent_at is not null then
    return jsonb_build_object('authorized', false, 'reason', 'escalation_already_sent');
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

create or replace function public.service_complete_refund_manager_aging_notice(
  p_refund_case_id uuid,
  p_attention_version bigint,
  p_milestone text,
  p_outcome text,
  p_template_version text,
  p_business_day_age integer,
  p_manager_recipient_count integer,
  p_recipient_count integer,
  p_resolution_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  attention_row public.refund_manager_attention_states;
  event_type text;
  event_message text;
begin
  if p_milestone not in ('reminder', 'escalation') then
    raise exception 'Unsupported manager aging milestone';
  end if;
  if p_outcome not in ('delivered', 'operations_exception', 'delivery_unknown') then
    raise exception 'Unsupported manager aging delivery outcome';
  end if;
  if p_template_version <> 'refund_manager_aging_v1' then
    raise exception 'Unsupported manager aging template';
  end if;
  if p_business_day_age not between 0 and 3650
    or p_manager_recipient_count not between 0 and 3
    or p_recipient_count not between 0 and 5
    or p_recipient_count < p_manager_recipient_count
    or length(coalesce(p_resolution_status, '')) not between 1 and 80
    or p_resolution_status !~ '^[a-z0-9_]+$' then
    raise exception 'Safe redacted manager notice evidence is required';
  end if;
  if p_outcome = 'delivered'
    and not (
      p_manager_recipient_count between 1 and 3
      and p_recipient_count = p_manager_recipient_count
    ) then
    raise exception 'Delivered manager notices require mapped-manager recipients only';
  end if;
  if p_outcome = 'operations_exception'
    and not (
      p_manager_recipient_count = 0
      and p_recipient_count between 1 and 5
    ) then
    raise exception 'Operations exceptions require bounded internal recipients only';
  end if;
  if p_outcome = 'delivery_unknown'
    and not (p_manager_recipient_count = 0 and p_recipient_count = 0) then
    raise exception 'Unknown delivery evidence cannot assert recipients';
  end if;

  select * into attention_row
  from public.refund_manager_attention_states
  where refund_case_id = p_refund_case_id
  for update;
  if attention_row.refund_case_id is null
    or attention_row.attention_version <> p_attention_version
    or attention_row.attention_started_at is null
    or attention_row.delivery_review_required_at is not null
    or (p_milestone = 'reminder' and attention_row.reminder_sent_at is not null)
    or (p_milestone = 'escalation' and attention_row.escalation_sent_at is not null) then
    return false;
  end if;

  update public.refund_manager_attention_states
  set
    reminder_sent_at = case
      when p_milestone = 'reminder' and p_outcome <> 'delivery_unknown'
        then statement_timestamp()
      else reminder_sent_at
    end,
    escalation_sent_at = case
      when p_milestone = 'escalation' and p_outcome <> 'delivery_unknown'
        then statement_timestamp()
      else escalation_sent_at
    end,
    last_notice_milestone = p_milestone,
    last_notice_outcome = p_outcome,
    last_notice_at = statement_timestamp(),
    delivery_review_required_at = case
      when p_outcome = 'delivery_unknown' then statement_timestamp()
      else delivery_review_required_at
    end,
    delivery_review_reason = case
      when p_outcome = 'delivery_unknown' then 'delivery_unknown'
      else delivery_review_reason
    end,
    updated_at = statement_timestamp()
  where refund_case_id = p_refund_case_id;

  event_type := case
    when p_outcome = 'delivered' then 'refund_manager_aging_notice_sent'
    when p_outcome = 'operations_exception' then 'refund_manager_aging_routing_exception'
    else 'refund_manager_aging_delivery_uncertain'
  end;
  event_message := case
    when p_outcome = 'delivered' then 'A manager aging notice was sent to the current mapped Machine Managers.'
    when p_outcome = 'operations_exception' then 'A redacted operations exception was sent because no eligible current Machine Manager was resolved.'
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
      'milestone', p_milestone,
      'attention_version', p_attention_version,
      'template_version', p_template_version,
      'business_day_age', p_business_day_age,
      'recipient_count', p_recipient_count,
      'machine_manager_recipient_count', p_manager_recipient_count,
      'manager_resolution_status', p_resolution_status,
      'used_ops_fallback', p_outcome = 'operations_exception',
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
revoke execute on function public.service_authorize_refund_manager_aging_notice(uuid, bigint, text, timestamptz, text, integer, integer, text)
  from public, anon, authenticated;
revoke execute on function public.service_complete_refund_manager_aging_notice(uuid, bigint, text, text, text, integer, integer, integer, text)
  from public, anon, authenticated;

grant execute on function public.refund_case_requires_manager_attention(text)
  to service_role;
grant execute on function public.service_refund_business_days_elapsed(timestamptz, timestamptz, text)
  to service_role;
grant execute on function public.service_authorize_refund_manager_aging_notice(uuid, bigint, text, timestamptz, text, integer, integer, text)
  to service_role;
grant execute on function public.service_complete_refund_manager_aging_notice(uuid, bigint, text, text, text, integer, integer, integer, text)
  to service_role;

comment on table public.refund_manager_attention_states is
  'Service-only manager-attention clock and bounded reminder/escalation delivery state. Contains no customer content, payment details, provider identifiers, or recipient addresses.';
comment on function public.service_authorize_refund_manager_aging_notice(uuid, bigint, text, timestamptz, text, integer, integer, text) is
  'Fail-closed send-time authorization for one versioned manager-only reminder or escalation. Rechecks state, business-day age, terminal/waiting state, and case-wide bounce holds.';
comment on function public.service_complete_refund_manager_aging_notice(uuid, bigint, text, text, text, integer, integer, integer, text) is
  'Records only redacted delivery evidence. Unknown delivery requires manual review and is never retried automatically.';
