-- Assign refund ownership only when the current machine mapping is unambiguous.
--
-- This migration does not enable Gmail, automation, customer contact, or Nayax.
-- It makes the database boundary shared by direct intake and email-linked form
-- completion resolve ownership under the same lock used by Admin > Machines.

create or replace function public.assign_refund_case_manager_on_machine_binding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_mapping_count integer := 0;
  sole_manager_user_id uuid;
  explicit_assignment_is_current boolean := false;
  assignment_status text;
begin
  if new.reporting_machine_id is null then
    new.assigned_manager_id := null;
    new.intake_meta := coalesce(new.intake_meta, '{}'::jsonb) || jsonb_build_object(
      'manager_assignment_rule', 'sole_current_active_mapping_v1',
      'manager_assignment_status', 'admin_review_machine_unresolved',
      'manager_assignment_active_mapping_count', 0
    );
    return new;
  end if;

  -- Admin > Machines takes this exact transaction lock before changing the
  -- mapping set. Taking it here makes the following read and case write one
  -- serial boundary with concurrent grants/revocations.
  perform pg_advisory_xact_lock(
    hashtext('machine_manager:' || new.reporting_machine_id::text)
  );

  select
    count(*)::integer,
    case
      when count(*) = 1 then (array_agg(manager.manager_user_id order by manager.id))[1]
      else null
    end
  into active_mapping_count, sole_manager_user_id
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = new.reporting_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  if new.assigned_manager_id is not null then
    select exists (
      select 1
      from public.reporting_machine_refund_managers manager
      where manager.reporting_machine_id = new.reporting_machine_id
        and manager.manager_user_id = new.assigned_manager_id
        and manager.status = 'active'
        and manager.revoked_at is null
    )
    into explicit_assignment_is_current;
  end if;

  if explicit_assignment_is_current then
    assignment_status := 'preserved_explicit_current_manager';
  elsif active_mapping_count = 1 then
    new.assigned_manager_id := sole_manager_user_id;
    assignment_status := 'assigned_sole_current_manager';
  else
    new.assigned_manager_id := null;
    assignment_status := case
      when active_mapping_count = 0 then 'admin_review_no_current_manager'
      else 'admin_review_multiple_current_managers'
    end;
  end if;

  new.intake_meta := coalesce(new.intake_meta, '{}'::jsonb) || jsonb_build_object(
    'manager_assignment_rule', 'sole_current_active_mapping_v1',
    'manager_assignment_status', assignment_status,
    'manager_assignment_active_mapping_count', active_mapping_count
  );

  return new;
end;
$$;

revoke execute on function public.assign_refund_case_manager_on_machine_binding()
  from public, anon, authenticated;

drop trigger if exists refund_cases_assign_manager_on_insert on public.refund_cases;
create trigger refund_cases_assign_manager_on_insert
before insert on public.refund_cases
for each row
execute function public.assign_refund_case_manager_on_machine_binding();

drop trigger if exists refund_cases_assign_manager_on_machine_change on public.refund_cases;
create trigger refund_cases_assign_manager_on_machine_change
before update of reporting_machine_id on public.refund_cases
for each row
when (new.reporting_machine_id is distinct from old.reporting_machine_id)
execute function public.assign_refund_case_manager_on_machine_binding();

comment on function public.assign_refund_case_manager_on_machine_binding() is
  'Serializes with Admin > Machines and assigns a refund case only for one current active machine mapping or a still-current explicit owner. Zero or multiple mappings remain unassigned for admin review.';

create or replace function public.service_backfill_open_refund_case_manager_assignments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  locked_case_id uuid;
  locked_machine_id uuid;
  active_mapping_count integer;
  sole_manager_user_id uuid;
  updated_case_id uuid;
  backfilled_count integer := 0;
begin
  for candidate in
    select refund_case.id
    from public.refund_cases refund_case
    where refund_case.assigned_manager_id is null
      and refund_case.reporting_machine_id is not null
      and refund_case.status in (
        'submitted',
        'needs_review',
        'waiting_on_customer',
        'correlated',
        'approved',
        'card_refund_pending',
        'cash_zelle_pending'
      )
    order by refund_case.reporting_machine_id, refund_case.id
  loop
    locked_case_id := null;
    locked_machine_id := null;
    updated_case_id := null;

    -- Match the runtime update path's lock order: lock the case row first, then
    -- serialize its current machine mapping with Admin > Machines.
    select refund_case.id, refund_case.reporting_machine_id
    into locked_case_id, locked_machine_id
    from public.refund_cases refund_case
    where refund_case.id = candidate.id
      and refund_case.assigned_manager_id is null
      and refund_case.reporting_machine_id is not null
      and refund_case.status in (
        'submitted',
        'needs_review',
        'waiting_on_customer',
        'correlated',
        'approved',
        'card_refund_pending',
        'cash_zelle_pending'
      )
    for update;

    if locked_case_id is null then
      continue;
    end if;

    perform pg_advisory_xact_lock(
      hashtext('machine_manager:' || locked_machine_id::text)
    );

    select
      count(*)::integer,
      case
        when count(*) = 1 then (array_agg(manager.manager_user_id order by manager.id))[1]
        else null
      end
    into active_mapping_count, sole_manager_user_id
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = locked_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null;

    if active_mapping_count <> 1 or sole_manager_user_id is null then
      continue;
    end if;

    update public.refund_cases refund_case
    set
      assigned_manager_id = sole_manager_user_id,
      intake_meta = coalesce(refund_case.intake_meta, '{}'::jsonb) || jsonb_build_object(
        'manager_assignment_rule', 'sole_current_active_mapping_v1',
        'manager_assignment_status', 'backfilled_sole_current_manager',
        'manager_assignment_active_mapping_count', 1
      )
    where refund_case.id = locked_case_id
      and refund_case.assigned_manager_id is null
      and refund_case.reporting_machine_id = locked_machine_id
    returning refund_case.id into updated_case_id;

    if updated_case_id is null then
      continue;
    end if;

    insert into public.refund_case_events (
      refund_case_id,
      event_type,
      message,
      metadata
    )
    values (
      updated_case_id,
      'manager_assignment_backfilled',
      'A sole current Machine Manager was assigned to an existing open case.',
      jsonb_build_object(
        'payload_redacted', true,
        'official_action', false,
        'assignment_rule', 'sole_current_active_mapping_v1',
        'prior_assignment_present', false
      )
    );

    backfilled_count := backfilled_count + 1;
  end loop;

  return backfilled_count;
end;
$$;

revoke execute on function public.service_backfill_open_refund_case_manager_assignments()
  from public, anon, authenticated;

comment on function public.service_backfill_open_refund_case_manager_assignments() is
  'Idempotently assigns and audits existing open unassigned cases only when the machine has exactly one current active manager. It never changes zero/multiple-manager cases or performs an official action.';

-- Repair eligible existing open cases, including email-origin cases completed
-- before the machine-binding trigger existed. The function is idempotent and
-- records one redacted event only for rows it actually changes.
select public.service_backfill_open_refund_case_manager_assignments();

-- Retain no runtime mutation capability. The migration owner can still invoke
-- this helper in disposable pgTAP validation, but API roles cannot call it.
revoke execute on function public.service_backfill_open_refund_case_manager_assignments()
  from service_role;
