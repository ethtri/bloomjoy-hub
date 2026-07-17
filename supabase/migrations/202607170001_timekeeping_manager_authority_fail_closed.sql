-- Timekeeping manager authority must return false, never null, for ungranted users.
--
-- The scheduler-aware is_super_admin helper can return null when its optional
-- session setting is absent. Without the outer coalesce, PL/pgSQL checks such as
-- `if not can_manage_operator_payout_machine(...)` do not enter the denial branch
-- because `not null` is still null. Keep the shared machine authority predicate
-- explicitly fail-closed for every caller.

create or replace function public.can_manage_operator_payout_machine(
  p_user_id uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_user_id is not null
    and p_machine_id is not null
    and (
      public.is_super_admin(p_user_id)
      or p_machine_id = any(coalesce(public.scoped_admin_machine_ids(p_user_id), '{}'::uuid[]))
      or exists (
        select 1
        from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id = p_machine_id
          and manager.manager_user_id = p_user_id
          and manager.status = 'active'
          and manager.revoked_at is null
      )
      or exists (
        select 1
        from public.reporting_machines machine
        join public.customer_account_memberships membership
          on membership.account_id = machine.account_id
        where machine.id = p_machine_id
          and membership.user_id = p_user_id
          and membership.active
          and membership.role in ('owner', 'account_admin', 'report_manager')
      )
      or exists (
        select 1
        from public.reporting_machines machine
        join public.reporting_machine_entitlements entitlement
          on entitlement.user_id = p_user_id
        where machine.id = p_machine_id
          and entitlement.access_level = 'report_manager'
          and public.reporting_entitlement_is_active(
            entitlement.starts_at,
            entitlement.expires_at,
            entitlement.revoked_at
          )
          and (
            entitlement.machine_id = machine.id
            or entitlement.location_id = machine.location_id
            or entitlement.account_id = machine.account_id
          )
      )
    ),
    false
  );
$$;

comment on function public.can_manage_operator_payout_machine(uuid, uuid) is
  'Fail-closed machine-scoped operator payout authority for Super Admins, Scoped Admins, Machine Managers, authorized account managers, and explicit report-manager entitlements.';

revoke execute on function public.can_manage_operator_payout_machine(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_manage_operator_payout_machine(uuid, uuid)
  to service_role;

select pg_notify('pgrst', 'reload schema');
