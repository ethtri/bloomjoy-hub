-- A person's separate admin access must neither grant nor revoke refund-payment
-- authority. Official actions derive only from a current machine-manager mapping
-- for the exact case, plus the existing step-up, receipt, provider, and cap gates.

create or replace function public.user_is_active_refund_manager(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.reporting_machine_refund_managers manager
      where manager.manager_user_id = p_user_id
        and manager.status = 'active'
        and manager.revoked_at is null
    );
$$;

-- Preserve the existing private helper signature used by the enrollment and
-- action-bound step-up functions. "Only" means the mapping is the only source
-- of payment authority; it no longer means the person may not also be an admin.
create or replace function public.user_is_active_refund_manager_only(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_is_active_refund_manager(p_user_id);
$$;

-- Preserve the later duplicate/reconciliation safety checks while removing the
-- unrelated negative admin-entitlement tests.
create or replace function public.can_perform_refund_official_action(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      join public.reporting_machine_refund_managers manager
        on manager.reporting_machine_id = refund_case.reporting_machine_id
      where refund_case.id = p_refund_case_id
        and refund_case.duplicate_of_refund_case_id is null
        and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
        and manager.manager_user_id = p_user_id
        and manager.status = 'active'
        and manager.revoked_at is null
    );
$$;

revoke execute on function public.user_is_active_refund_manager(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.user_is_active_refund_manager_only(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.can_perform_refund_official_action(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_perform_refund_official_action(uuid, uuid)
  to service_role;

comment on function public.user_is_active_refund_manager(uuid) is
  'Private mapping predicate. A current active, unrevoked machine assignment is the sole source of refund-manager authority; other admin access neither grants nor revokes it.';
comment on function public.user_is_active_refund_manager_only(uuid) is
  'Compatibility helper: payment authority comes only from a current active machine-manager mapping, regardless of separate admin access.';
comment on function public.can_perform_refund_official_action(uuid, uuid) is
  'Service-only predicate requiring a current exact-machine manager mapping and a duplicate/reconciliation-safe case. Admin access alone grants no payment authority and does not invalidate a real manager mapping.';
