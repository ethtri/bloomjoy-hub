-- Aggregate-only, read-only clean Machine Manager UAT account audit.
--
-- This file is a template. manager-uat-readiness.mjs replaces the single
-- pilot-machine marker with validated UUID literals (or an empty SELECT) before
-- sending the query to the linked Supabase project. The result intentionally
-- contains counts only: no names, emails, user IDs, machine IDs, or case data.

with
pilot_machines(machine_id) as (
  /*__PILOT_MACHINE_ROWS__*/
),
active_manager_assignments as (
  select
    manager.manager_user_id,
    lower(trim(manager.manager_email)) as manager_email,
    manager.reporting_machine_id
  from public.reporting_machine_refund_managers manager
  where manager.status = 'active'
    and manager.revoked_at is null
),
manager_identities as (
  select
    assignment.manager_user_id,
    min(assignment.manager_email) as manager_email,
    count(distinct assignment.reporting_machine_id)::integer as assigned_machine_count
  from active_manager_assignments assignment
  group by assignment.manager_user_id
),
current_admin_roles as (
  select distinct role.user_id, role.role
  from public.admin_roles role
  where role.active = true
),
current_scoped_admins as (
  select distinct access_grant.user_id
  from public.admin_scoped_access_grants access_grant
  where access_grant.role = 'scoped_admin'
    and access_grant.revoked_at is null
    and access_grant.starts_at <= now()
    and (access_grant.expires_at is null or access_grant.expires_at > now())
),
current_corporate_partners as (
  select distinct identity.manager_user_id
  from manager_identities identity
  join public.corporate_partner_memberships membership
    on membership.user_id = identity.manager_user_id
    or lower(trim(membership.member_email)) = identity.manager_email
  join public.reporting_partners partner on partner.id = membership.partner_id
  where membership.status = 'active'
    and membership.revoked_at is null
    and membership.starts_at <= now()
    and (membership.expires_at is null or membership.expires_at > now())
    and partner.status = 'active'
),
current_customer_account_memberships as (
  select distinct membership.user_id
  from public.customer_account_memberships membership
  where membership.active = true
),
current_reporting_entitlements as (
  select distinct entitlement.user_id
  from public.reporting_machine_entitlements entitlement
  where entitlement.revoked_at is null
    and entitlement.starts_at <= now()
    and (entitlement.expires_at is null or entitlement.expires_at > now())
),
current_plus_access as (
  select distinct access_grant.user_id
  from public.plus_access_grants access_grant
  where access_grant.revoked_at is null
    and access_grant.starts_at <= now()
    and access_grant.expires_at > now()
),
current_training_access as (
  select distinct identity.manager_user_id
  from manager_identities identity
  join public.operator_training_grants training_grant
    on training_grant.operator_user_id = identity.manager_user_id
    or lower(trim(training_grant.operator_email)) = identity.manager_email
  where training_grant.revoked_at is null
    and training_grant.starts_at <= now()
    and (training_grant.expires_at is null or training_grant.expires_at > now())
),
current_technician_access as (
  select distinct identity.manager_user_id
  from manager_identities identity
  join public.technician_grants technician_grant
    on technician_grant.technician_user_id = identity.manager_user_id
    or lower(trim(technician_grant.technician_email)) = identity.manager_email
  where technician_grant.status = 'active'
    and technician_grant.revoked_at is null
    and technician_grant.starts_at <= now()
    and (technician_grant.expires_at is null or technician_grant.expires_at > now())
),
current_operator_profiles as (
  select distinct profile.user_id
  from public.operator_payout_profiles profile
  where profile.status = 'active'
),
shadow_ready_machines as (
  select machine.id
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.status = 'active'
    and machine.machine_type in ('commercial', 'mini')
    and machine.refund_intake_enabled = true
    and location.status = 'active'
    and nullif(trim(machine.nayax_machine_id), '') is not null
    and coalesce(machine.nayax_refunds_enabled, false) = false
),
identity_access as (
  select
    identity.manager_user_id,
    identity.assigned_machine_count,
    exists (
      select 1
      from current_admin_roles role
      where role.user_id = identity.manager_user_id
        and role.role = 'super_admin'
    ) as has_super_admin,
    (
      exists (
        select 1
        from current_admin_roles role
        where role.user_id = identity.manager_user_id
          and role.role = 'scoped_admin'
      )
      or exists (
        select 1
        from current_scoped_admins scoped_admin
        where scoped_admin.user_id = identity.manager_user_id
      )
    ) as has_scoped_admin,
    exists (
      select 1
      from current_corporate_partners corporate_partner
      where corporate_partner.manager_user_id = identity.manager_user_id
    ) as has_corporate_partner,
    exists (
      select 1
      from current_customer_account_memberships membership
      where membership.user_id = identity.manager_user_id
    ) as has_customer_account_membership,
    exists (
      select 1
      from current_reporting_entitlements entitlement
      where entitlement.user_id = identity.manager_user_id
    ) as has_reporting_entitlement,
    exists (
      select 1
      from current_plus_access plus_access
      where plus_access.user_id = identity.manager_user_id
    ) as has_plus_access,
    exists (
      select 1
      from current_training_access training_access
      where training_access.manager_user_id = identity.manager_user_id
    ) as has_training_access,
    exists (
      select 1
      from current_technician_access technician_access
      where technician_access.manager_user_id = identity.manager_user_id
    ) as has_technician_access,
    exists (
      select 1
      from current_operator_profiles operator_profile
      where operator_profile.user_id = identity.manager_user_id
    ) as has_operator_profile,
    (
      select count(distinct assignment.reporting_machine_id)::integer
      from active_manager_assignments assignment
      join shadow_ready_machines machine on machine.id = assignment.reporting_machine_id
      where assignment.manager_user_id = identity.manager_user_id
    ) as shadow_ready_assignment_count,
    (
      select count(distinct assignment.reporting_machine_id)::integer
      from active_manager_assignments assignment
      join pilot_machines pilot on pilot.machine_id = assignment.reporting_machine_id
      where assignment.manager_user_id = identity.manager_user_id
    ) as pilot_assignment_count,
    (
      select count(distinct assignment.reporting_machine_id)::integer
      from active_manager_assignments assignment
      left join pilot_machines pilot on pilot.machine_id = assignment.reporting_machine_id
      where assignment.manager_user_id = identity.manager_user_id
        and pilot.machine_id is null
    ) as outside_pilot_assignment_count,
    (
      select count(distinct assignment.reporting_machine_id)::integer
      from active_manager_assignments assignment
      join pilot_machines pilot on pilot.machine_id = assignment.reporting_machine_id
      join shadow_ready_machines machine on machine.id = assignment.reporting_machine_id
      where assignment.manager_user_id = identity.manager_user_id
    ) as shadow_ready_pilot_assignment_count
  from manager_identities identity
),
assessed_identities as (
  select
    access.*,
    not (
      access.has_super_admin
      or access.has_scoped_admin
      or access.has_corporate_partner
      or access.has_customer_account_membership
      or access.has_reporting_entitlement
      or access.has_plus_access
      or access.has_training_access
      or access.has_technician_access
      or access.has_operator_profile
    ) as is_manager_only
  from identity_access access
),
pilot_summary as (
  select count(*)::integer as selected_pilot_machine_count
  from pilot_machines
)
select
  true as read_only,
  (select selected_pilot_machine_count from pilot_summary) as selected_pilot_machine_count,
  (select count(*)::integer from active_manager_assignments) as active_manager_assignment_count,
  count(*)::integer as active_manager_identity_count,
  count(*) filter (where identity.is_manager_only)::integer as manager_only_identity_count,
  count(*) filter (
    where identity.is_manager_only
      and identity.shadow_ready_assignment_count > 0
  )::integer as manager_only_with_shadow_ready_assignment_count,
  case
    when (select selected_pilot_machine_count from pilot_summary) = 0 then null
    else count(*) filter (
      where identity.is_manager_only
        and identity.pilot_assignment_count > 0
        and identity.outside_pilot_assignment_count = 0
        and identity.shadow_ready_pilot_assignment_count = identity.pilot_assignment_count
    )::integer
  end as exact_pilot_eligible_identity_count,
  count(*) filter (where identity.has_super_admin)::integer as super_admin_overlap_count,
  count(*) filter (where identity.has_scoped_admin)::integer as scoped_admin_overlap_count,
  count(*) filter (where identity.has_corporate_partner)::integer as corporate_partner_overlap_count,
  count(*) filter (where identity.has_customer_account_membership)::integer as customer_account_membership_overlap_count,
  count(*) filter (where identity.has_reporting_entitlement)::integer as reporting_entitlement_overlap_count,
  count(*) filter (where identity.has_plus_access)::integer as plus_access_overlap_count,
  count(*) filter (where identity.has_training_access)::integer as training_access_overlap_count,
  count(*) filter (where identity.has_technician_access)::integer as technician_access_overlap_count,
  count(*) filter (where identity.has_operator_profile)::integer as operator_profile_overlap_count
from assessed_identities identity;
