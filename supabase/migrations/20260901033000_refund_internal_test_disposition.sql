-- #1048: quarantine internal and test submissions without customer-facing denial.
--
-- Classification is intentionally one-way in this slice. It is available only
-- to Refund Operations (Super Admin), preserves the original case evidence, and
-- refuses any case whose provider outcome is unresolved or whose refund/reporting
-- effects have already completed.

alter table public.refund_cases
  add column if not exists case_population text not null default 'customer',
  add column if not exists internal_test_reason text,
  add column if not exists internal_test_classified_at timestamptz,
  add column if not exists internal_test_classified_by uuid
    references auth.users (id) on delete restrict;

alter table public.refund_cases
  drop constraint if exists refund_cases_case_population_check,
  add constraint refund_cases_case_population_check check (
    case_population in ('customer', 'internal_test')
  ),
  drop constraint if exists refund_cases_internal_test_reason_check,
  add constraint refund_cases_internal_test_reason_check check (
    internal_test_reason is null
    or internal_test_reason in (
      'employee_technician_test',
      'machine_setup_commissioning',
      'provider_test',
      'duplicate_synthetic_record',
      'other_internal_test'
    )
  ),
  drop constraint if exists refund_cases_internal_test_shape_check,
  add constraint refund_cases_internal_test_shape_check check (
    (
      case_population = 'customer'
      and internal_test_reason is null
      and internal_test_classified_at is null
      and internal_test_classified_by is null
    )
    or (
      case_population = 'internal_test'
      and internal_test_reason is not null
      and internal_test_classified_at is not null
      and internal_test_classified_by is not null
      and status = 'closed'
      and automation_state = 'closed_incomplete'
      and automation_follow_up_due_at is null
      and decision is null
      and decided_by is null
      and decided_at is null
      and reporting_adjustment_id is null
      and refund_completed_by is null
      and refund_completed_at is null
    )
  );

create index if not exists refund_cases_internal_test_archive_idx
  on public.refund_cases (internal_test_classified_at desc, id)
  where case_population = 'internal_test';

create unique index if not exists refund_case_internal_test_event_unique
  on public.refund_case_events (refund_case_id)
  where event_type = 'internal_test_classified';

create or replace function public.refund_internal_test_contract(
  p_case_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when refund_case.case_population <> 'internal_test' then null
    else jsonb_build_object(
      'schemaVersion', 'refund_internal_test_v1',
      'classification', 'internal_test_no_customer_refund',
      'reason', refund_case.internal_test_reason,
      'reasonLabel', case refund_case.internal_test_reason
        when 'employee_technician_test' then 'Employee or technician test'
        when 'machine_setup_commissioning' then 'Machine setup or commissioning'
        when 'provider_test' then 'Payment provider test'
        when 'duplicate_synthetic_record' then 'Duplicate synthetic record'
        else 'Other internal test'
      end,
      'classifiedAt', refund_case.internal_test_classified_at,
      'suppressesCustomerMessages', true,
      'suppressesRefunds', true,
      'suppressesReportingAdjustments', true,
      'suppressesReminders', true,
      'suppressesCustomerSla', true,
      'payloadRedacted', true
    )
  end
  from public.refund_cases refund_case
  where refund_case.id = p_case_id;
$$;

revoke execute on function public.refund_internal_test_contract(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.guard_refund_internal_test_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.case_population = 'internal_test' then
    if new.case_population is distinct from old.case_population
      or new.internal_test_reason is distinct from old.internal_test_reason
      or new.internal_test_classified_at is distinct from old.internal_test_classified_at
      or new.internal_test_classified_by is distinct from old.internal_test_classified_by
      or new.status is distinct from 'closed'
      or new.automation_state is distinct from 'closed_incomplete'
      or new.automation_follow_up_due_at is not null
      or new.decision is not null
      or new.decided_by is not null
      or new.decided_at is not null
      or new.reporting_adjustment_id is not null
      or new.refund_completed_by is not null
      or new.refund_completed_at is not null then
      raise exception using errcode = 'P4638',
        message = 'Internal/test classification is immutable and customer actions remain suppressed';
    end if;
  elsif new.case_population = 'internal_test'
    and current_user in ('anon', 'authenticated', 'service_role') then
    raise exception using errcode = 'P4639',
      message = 'Use the authorized Internal/test disposition';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_cases_guard_internal_test
  on public.refund_cases;
create trigger refund_cases_guard_internal_test
before update on public.refund_cases
for each row execute function public.guard_refund_internal_test_case();

create or replace function public.guard_refund_internal_test_child_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_case_id uuid;
  target_is_internal boolean;
begin
  target_case_id := new.refund_case_id;

  select refund_case.case_population = 'internal_test'
  into target_is_internal
  from public.refund_cases refund_case
  where refund_case.id = target_case_id
  for share;

  if coalesce(target_is_internal, false) then
    if tg_table_name = 'refund_case_messages'
      and new.status not in ('pending', 'sent') then
      return new;
    end if;

    if tg_table_name = 'refund_follow_up_cycles'
      and tg_op = 'UPDATE'
      and new.status = 'manual_review' then
      return new;
    end if;

    raise exception using errcode = 'P4640',
      message = 'Customer, reminder, and refund actions are suppressed for Internal/test cases';
  end if;

  return new;
end;
$$;

drop trigger if exists refund_case_messages_guard_internal_test
  on public.refund_case_messages;
create trigger refund_case_messages_guard_internal_test
before insert or update on public.refund_case_messages
for each row execute function public.guard_refund_internal_test_child_action();

drop trigger if exists refund_follow_up_cycles_guard_internal_test
  on public.refund_follow_up_cycles;
create trigger refund_follow_up_cycles_guard_internal_test
before insert or update on public.refund_follow_up_cycles
for each row execute function public.guard_refund_internal_test_child_action();

drop trigger if exists refund_nayax_attempts_guard_internal_test
  on public.refund_case_nayax_refund_attempts;
create trigger refund_nayax_attempts_guard_internal_test
before insert on public.refund_case_nayax_refund_attempts
for each row execute function public.guard_refund_internal_test_child_action();

drop trigger if exists refund_status_capabilities_guard_internal_test
  on public.refund_case_status_capabilities;
create trigger refund_status_capabilities_guard_internal_test
before insert on public.refund_case_status_capabilities
for each row execute function public.guard_refund_internal_test_child_action();

create or replace function public.admin_classify_refund_case_internal_test(
  p_case_id uuid,
  p_expected_case_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_reason text := lower(btrim(coalesce(p_reason, '')));
  case_row public.refund_cases%rowtype;
  updated_case public.refund_cases%rowtype;
  existing_event public.refund_case_events%rowtype;
  skipped_message_count integer := 0;
  closed_cycle_count integer := 0;
  revoked_capability_count integer := 0;
  classified_at timestamptz := statement_timestamp();
begin
  if auth.role() is distinct from 'authenticated'
    or actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or not public.is_super_admin(actor_user_id) then
    raise exception using errcode = 'P4630',
      message = 'Refund Operations administrator required';
  end if;

  if normalized_reason not in (
    'employee_technician_test',
    'machine_setup_commissioning',
    'provider_test',
    'duplicate_synthetic_record',
    'other_internal_test'
  ) then
    raise exception using errcode = 'P4631',
      message = 'Choose a required Internal/test reason';
  end if;

  select refund_case.*
  into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if case_row.id is null then
    raise exception using errcode = 'P4632',
      message = 'Refund case not found';
  end if;

  select event.*
  into existing_event
  from public.refund_case_events event
  where event.refund_case_id = p_case_id
    and event.event_type = 'internal_test_classified'
  limit 1;

  if case_row.case_population = 'internal_test'
    and existing_event.id is not null
    and case_row.internal_test_reason = normalized_reason then
    return jsonb_build_object(
      'classified', false,
      'replayed', true,
      'caseVersion', case_row.official_action_version,
      'classification', public.refund_internal_test_contract(p_case_id),
      'payloadRedacted', true
    );
  end if;

  if case_row.case_population <> 'customer' then
    raise exception using errcode = 'P4633',
      message = 'Refund case classification is immutable';
  end if;

  if p_expected_case_version is null
    or case_row.official_action_version is distinct from p_expected_case_version then
    raise exception using errcode = 'P4634',
      message = 'Refund case changed; refresh before classifying it';
  end if;

  if case_row.status in ('completed', 'cash_zelle_pending', 'card_refund_pending')
    or case_row.reporting_adjustment_id is not null
    or case_row.refund_completed_at is not null
    or nullif(btrim(coalesce(case_row.manual_refund_reference, '')), '') is not null
    or exists (
      select 1
      from public.refund_case_nayax_refund_attempts attempt
      where attempt.refund_case_id = p_case_id
        and (
          attempt.status in ('in_progress', 'requested', 'approved', 'succeeded', 'ambiguous', 'manual_review')
          or attempt.provider_outcome in ('success', 'timeout', 'unknown')
          or attempt.reconciliation_required
          or attempt.reporting_adjustment_id is not null
        )
    ) then
    raise exception using errcode = 'P4635',
      message = 'Reconcile or complete the existing payment evidence before Internal/test classification';
  end if;

  update public.refund_cases
  set
    case_population = 'internal_test',
    internal_test_reason = normalized_reason,
    internal_test_classified_at = classified_at,
    internal_test_classified_by = actor_user_id,
    status = 'closed',
    automation_state = 'closed_incomplete',
    automation_follow_up_due_at = null,
    decision = null,
    decision_reason = null,
    decided_by = null,
    decided_at = null,
    nayax_match_execution_eligible = false
  where id = p_case_id
  returning * into updated_case;

  update public.refund_case_messages message
  set
    status = 'skipped',
    error_message = 'internal_test_customer_contact_suppressed'
  where message.refund_case_id = p_case_id
    and message.status = 'pending';
  get diagnostics skipped_message_count = row_count;

  update public.refund_follow_up_cycles cycle
  set status = 'manual_review'
  where cycle.refund_case_id = p_case_id
    and cycle.status in ('claimed', 'waiting', 'customer_replied');
  get diagnostics closed_cycle_count = row_count;

  update public.refund_case_status_capabilities capability
  set
    revoked_at = classified_at,
    revoked_reason = 'case_closed'
  where capability.refund_case_id = p_case_id
    and capability.revoked_at is null;
  get diagnostics revoked_capability_count = row_count;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  ) values (
    p_case_id,
    actor_user_id,
    'internal_test_classified',
    'Refund Operations classified this record as Internal/test — no customer refund.',
    jsonb_build_object(
      'classification', 'internal_test_no_customer_refund',
      'reason', normalized_reason,
      'previous_case_version', p_expected_case_version,
      'result_case_version', updated_case.official_action_version,
      'queued_messages_suppressed', skipped_message_count,
      'follow_up_cycles_closed', closed_cycle_count,
      'status_capabilities_revoked', revoked_capability_count,
      'customer_message_sent', false,
      'provider_call_made', false,
      'reporting_adjustment_created', false,
      'payload_redacted', true
    )
  );

  return jsonb_build_object(
    'classified', true,
    'replayed', false,
    'caseVersion', updated_case.official_action_version,
    'classification', public.refund_internal_test_contract(p_case_id),
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function
  public.admin_classify_refund_case_internal_test(uuid, bigint, text)
  from public, anon, service_role;
grant execute on function
  public.admin_classify_refund_case_internal_test(uuid, bigint, text)
  to authenticated;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_internal_test_v1;

revoke execute on function
  public.admin_get_refund_operations_overview_pre_internal_test_v1()
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
  customer_cases jsonb;
  internal_test_cases jsonb := '[]'::jsonb;
  has_refund_operations_access boolean;
begin
  base_result :=
    public.admin_get_refund_operations_overview_pre_internal_test_v1();
  has_refund_operations_access :=
    coalesce((base_result ->> 'refundOperationsAccess')::boolean, false);

  select
    coalesce(jsonb_agg(item.case_json order by item.case_order)
      filter (where refund_case.case_population = 'customer'), '[]'::jsonb),
    coalesce(jsonb_agg(
      item.case_json || jsonb_build_object(
        'internalTest', public.refund_internal_test_contract(refund_case.id)
      ) order by item.case_order
    ) filter (
      where has_refund_operations_access
        and refund_case.case_population = 'internal_test'
    ), '[]'::jsonb)
  into customer_cases, internal_test_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid;

  return jsonb_set(
    jsonb_set(
      base_result || jsonb_build_object(
        'internalTestContractVersion', 'refund_internal_test_v1',
        'internalTestCases', internal_test_cases
      ),
      '{cases}', customer_cases, true
    ),
    '{internalTestCases}', internal_test_cases, true
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function
  public.admin_classify_refund_case_internal_test(uuid, bigint, text) is
  'One-way Refund Operations disposition for a no-money Internal/test case. It requires a fixed reason and current case version, suppresses customer work, and records only redacted audit metadata.';
comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview that excludes Internal/test records from customer queues and exposes a separate redacted archive only to Refund Operations.';

revoke execute on function public.guard_refund_internal_test_case()
  from public, anon, authenticated, service_role;
revoke execute on function public.guard_refund_internal_test_child_action()
  from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
