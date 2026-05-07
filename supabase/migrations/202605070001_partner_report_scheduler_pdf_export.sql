-- Scheduler-safe partner report preview path for service-role PDF artifact generation.
-- This does not enable recurring triggers, email sends, or automated CSV/XLSX.

create or replace function public.is_super_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select (
    current_setting('app.partner_report_scheduler_scope', true) = 'service_role'
    and auth.role() = 'service_role'
  )
  or exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = uid
      and ar.role = 'super_admin'
      and ar.active = true
  );
$$;

create or replace function public.can_access_partner_dashboard(
  p_user_id uuid,
  p_partnership_id uuid,
  p_date_from date default null,
  p_date_to date default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  scoped_machine_ids uuid[];
  corporate_machine_ids uuid[];
  actor_machine_ids uuid[];
  scope_start date;
  scope_end date;
begin
  if current_setting('app.partner_report_scheduler_scope', true) = 'service_role'
     and auth.role() = 'service_role'
     and p_partnership_id is not null then
    return true;
  end if;

  if p_user_id is null or p_partnership_id is null then
    return false;
  end if;

  if public.is_super_admin(p_user_id) then
    return true;
  end if;

  if public.is_active_corporate_partner_user(p_user_id) then
    if not exists (
      select 1
      from public.reporting_partnerships partnership
      join public.reporting_partnership_parties party
        on party.partnership_id = partnership.id
      where partnership.id = p_partnership_id
        and partnership.status = 'active'
        and party.portal_access_enabled
        and party.partner_id = any(public.corporate_partner_ids_for_user(p_user_id))
    ) then
      return false;
    end if;

    return true;
  end if;

  scoped_machine_ids := public.scoped_admin_machine_ids(p_user_id);
  corporate_machine_ids := public.corporate_partner_machine_ids_for_user(p_user_id);
  actor_machine_ids := scoped_machine_ids || corporate_machine_ids;

  if coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
    return false;
  end if;

  scope_start := coalesce(p_date_from, current_date);
  scope_end := coalesce(p_date_to, scope_start);

  if scope_start > scope_end then
    return false;
  end if;

  return exists (
    select 1
    from public.reporting_machine_partnership_assignments assignment
    where assignment.partnership_id = p_partnership_id
      and assignment.assignment_role = 'primary_reporting'
      and assignment.status = 'active'
      and assignment.effective_start_date <= scope_end
      and (assignment.effective_end_date is null or assignment.effective_end_date >= scope_start)
  )
  and not exists (
    select 1
    from public.reporting_machine_partnership_assignments assignment
    where assignment.partnership_id = p_partnership_id
      and assignment.assignment_role = 'primary_reporting'
      and assignment.status = 'active'
      and assignment.effective_start_date <= scope_end
      and (assignment.effective_end_date is null or assignment.effective_end_date >= scope_start)
      and not (assignment.machine_id = any(actor_machine_ids))
  );
end;
$$;

revoke execute on function public.can_access_partner_dashboard(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.can_access_partner_dashboard(uuid, uuid, date, date)
  to service_role;

create or replace function public.partner_report_scheduler_preview_partner_period_report(
  p_partnership_id uuid,
  p_date_from date,
  p_date_to date,
  p_period_grain text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role access required';
  end if;

  perform set_config('app.partner_report_scheduler_scope', 'service_role', true);

  return public.admin_preview_partner_period_report_internal(
    p_partnership_id,
    p_date_from,
    p_date_to,
    p_period_grain
  );
end;
$$;

revoke execute on function public.partner_report_scheduler_preview_partner_period_report(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.partner_report_scheduler_preview_partner_period_report(uuid, date, date, text)
  to service_role;

comment on function public.partner_report_scheduler_preview_partner_period_report(uuid, date, date, text) is
  'Service-role-only preview wrapper used by scheduled partner PDF artifact generation.';

select pg_notify('pgrst', 'reload schema');
