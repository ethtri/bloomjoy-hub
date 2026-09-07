-- #1222: the manager overview always uses the established Pacific automation
-- timezone. Avoid rescanning pg_timezone_names once per attention row while
-- retaining catalog validation for every other accepted timezone name.
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
  if length(coalesce(p_timezone, '')) not between 1 and 80 then
    raise exception 'A supported automation timezone is required';
  end if;
  if p_timezone <> 'America/Los_Angeles' then
    if not exists (
      select 1
      from pg_catalog.pg_timezone_names timezone_name
      where timezone_name.name = p_timezone
    ) then
      raise exception 'A supported automation timezone is required';
    end if;
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
  if length(coalesce(p_timezone, '')) not between 1 and 80 then
    raise exception 'A supported automation timezone is required';
  end if;
  if p_timezone <> 'America/Los_Angeles' then
    if not exists (
      select 1
      from pg_catalog.pg_timezone_names timezone_name
      where timezone_name.name = p_timezone
    ) then
      raise exception 'A supported automation timezone is required';
    end if;
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
      and not exists (
        select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id = refund_case.id
      )
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
