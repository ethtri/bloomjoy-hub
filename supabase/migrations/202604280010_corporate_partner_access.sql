-- Corporate Partner access, capability helpers, and scalable access context.
--
-- This keeps admin UX preset-first while the database stays source-aware:
-- Corporate Partner membership is distinct from Plus access, partnership
-- participation must explicitly enable portal access, and downstream checks use
-- capabilities instead of broad role labels.

alter table public.reporting_partnership_parties
  add column if not exists portal_access_enabled boolean not null default false;

create index if not exists reporting_partnership_parties_portal_enabled_idx
  on public.reporting_partnership_parties (partner_id, partnership_id)
  where portal_access_enabled;

create table if not exists public.corporate_partner_memberships (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.reporting_partners (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  member_email text not null,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  grant_reason text not null,
  granted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corporate_partner_memberships_email_present
    check (length(trim(member_email)) > 0),
  constraint corporate_partner_memberships_reason_present
    check (length(trim(grant_reason)) > 0),
  constraint corporate_partner_memberships_valid_window
    check (expires_at is null or expires_at > starts_at),
  constraint corporate_partner_memberships_revoke_reason_required
    check (revoked_at is null or length(trim(coalesce(revoke_reason, ''))) > 0),
  constraint corporate_partner_memberships_revoked_status_check
    check (
      (revoked_at is null and status <> 'revoked')
      or (revoked_at is not null and status = 'revoked')
    )
);

alter table public.corporate_partner_memberships
  add column if not exists partner_id uuid references public.reporting_partners (id) on delete cascade,
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists member_email text,
  add column if not exists status text not null default 'active',
  add column if not exists starts_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists grant_reason text not null default 'Corporate Partner access',
  add column if not exists granted_by uuid references auth.users (id) on delete set null,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users (id) on delete set null,
  add column if not exists revoke_reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists corporate_partner_memberships_one_open_email_idx
  on public.corporate_partner_memberships (partner_id, lower(member_email))
  where revoked_at is null;

create index if not exists corporate_partner_memberships_user_idx
  on public.corporate_partner_memberships (user_id)
  where revoked_at is null;

create index if not exists corporate_partner_memberships_email_idx
  on public.corporate_partner_memberships (lower(member_email))
  where revoked_at is null;

drop trigger if exists corporate_partner_memberships_set_updated_at
  on public.corporate_partner_memberships;
create trigger corporate_partner_memberships_set_updated_at
before update on public.corporate_partner_memberships
for each row execute function public.set_updated_at();

alter table public.corporate_partner_memberships enable row level security;

drop policy if exists "corporate_partner_memberships_select_related"
  on public.corporate_partner_memberships;
create policy "corporate_partner_memberships_select_related"
on public.corporate_partner_memberships
for select
to authenticated
using (
  public.is_super_admin((select auth.uid()))
  or user_id = (select auth.uid())
  or exists (
    select 1
    from auth.users current_auth_user
    where current_auth_user.id = (select auth.uid())
      and lower(current_auth_user.email) = lower(member_email)
  )
);

drop policy if exists "corporate_partner_memberships_super_admin_all"
  on public.corporate_partner_memberships;
create policy "corporate_partner_memberships_super_admin_all"
on public.corporate_partner_memberships
for all
to authenticated
using (public.is_super_admin((select auth.uid())))
with check (public.is_super_admin((select auth.uid())));

create or replace function public.normalize_corporate_partner_email(email_input text)
returns text
language sql
immutable
as $$
  select lower(trim(coalesce(email_input, '')));
$$;

create or replace function public.corporate_partner_membership_is_active(
  starts_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  membership_status text
)
returns boolean
language sql
stable
as $$
  select membership_status = 'active'
    and revoked_at is null
    and starts_at <= now()
    and (expires_at is null or expires_at > now());
$$;

create or replace function public.corporate_partner_ids_for_user(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(array_agg(distinct membership.partner_id), '{}'::uuid[])
  from auth.users auth_user
  join public.corporate_partner_memberships membership
    on (
      membership.user_id = auth_user.id
      or public.normalize_corporate_partner_email(membership.member_email)
        = public.normalize_corporate_partner_email(auth_user.email)
    )
  join public.reporting_partners partner on partner.id = membership.partner_id
  where auth_user.id = p_user_id
    and partner.status = 'active'
    and public.corporate_partner_membership_is_active(
      membership.starts_at,
      membership.expires_at,
      membership.revoked_at,
      membership.status
    );
$$;

create or replace function public.is_active_corporate_partner_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_length(public.corporate_partner_ids_for_user(p_user_id), 1), 0) > 0;
$$;

create or replace function public.corporate_partner_partnership_ids_for_user(
  p_user_id uuid,
  p_live_only boolean default true
)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct partnership.id), '{}'::uuid[])
  from public.reporting_partnerships partnership
  join public.reporting_partnership_parties party
    on party.partnership_id = partnership.id
  where party.portal_access_enabled
    and party.partner_id = any(public.corporate_partner_ids_for_user(p_user_id))
    and (
      not coalesce(p_live_only, true)
      or partnership.status = 'active'
    );
$$;

create or replace function public.corporate_partner_machine_ids_for_user(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct machine.id), '{}'::uuid[])
  from public.reporting_machines machine
  join public.reporting_machine_partnership_assignments assignment
    on assignment.machine_id = machine.id
  where machine.status = 'active'
    and assignment.assignment_role = 'primary_reporting'
    and assignment.status = 'active'
    and assignment.effective_start_date <= current_date
    and (assignment.effective_end_date is null or assignment.effective_end_date >= current_date)
    and assignment.partnership_id = any(
      public.corporate_partner_partnership_ids_for_user(p_user_id, true)
    );
$$;

create or replace function public.corporate_partner_partner_id_for_machine(
  p_user_id uuid,
  p_machine_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select party.partner_id
  from public.reporting_machine_partnership_assignments assignment
  join public.reporting_partnership_parties party
    on party.partnership_id = assignment.partnership_id
  join public.reporting_partnerships partnership
    on partnership.id = assignment.partnership_id
  where assignment.machine_id = p_machine_id
    and assignment.assignment_role = 'primary_reporting'
    and assignment.status = 'active'
    and assignment.effective_start_date <= current_date
    and (assignment.effective_end_date is null or assignment.effective_end_date >= current_date)
    and partnership.status = 'active'
    and party.portal_access_enabled
    and party.partner_id = any(public.corporate_partner_ids_for_user(p_user_id))
  order by party.created_at desc
  limit 1;
$$;

create or replace function public.corporate_partner_account_ids_for_user(p_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct machine.account_id), '{}'::uuid[])
  from public.reporting_machines machine
  where machine.id = any(public.corporate_partner_machine_ids_for_user(p_user_id));
$$;

create or replace function public.has_user_capability(
  p_user_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_capability text;
begin
  if p_user_id is null then
    return false;
  end if;

  normalized_capability := lower(trim(coalesce(p_capability, '')));

  case normalized_capability
    when 'admin.global' then
      return public.is_super_admin(p_user_id);
    when 'admin.access.manage_reporting' then
      return public.is_super_admin(p_user_id) or public.is_scoped_admin(p_user_id);
    when 'training.view' then
      return public.is_super_admin(p_user_id)
        or public.has_plus_access(p_user_id)
        or public.is_scoped_admin(p_user_id)
        or public.has_active_operator_training_grant(p_user_id)
        or public.is_active_corporate_partner_user(p_user_id);
    when 'support.request' then
      return public.is_super_admin(p_user_id)
        or public.has_plus_access(p_user_id)
        or public.is_active_corporate_partner_user(p_user_id);
    when 'supplies.member_discount' then
      return public.is_super_admin(p_user_id)
        or public.has_plus_access(p_user_id)
        or public.is_active_corporate_partner_user(p_user_id);
    when 'reports.machine.view' then
      return exists (
        select 1
        from public.reporting_machines machine
        where public.has_reporting_machine_access(p_user_id, machine.id)
      );
    when 'reports.partner.view' then
      return public.is_super_admin(p_user_id)
        or public.is_scoped_admin(p_user_id)
        or coalesce(
          array_length(public.corporate_partner_partnership_ids_for_user(p_user_id, true), 1),
          0
        ) > 0;
    when 'technicians.manage' then
      return public.is_super_admin(p_user_id)
        or exists (
          select 1
          from public.customer_account_memberships membership
          join public.customer_accounts account on account.id = membership.account_id
          where membership.user_id = p_user_id
            and membership.active
            and membership.role = 'owner'
            and account.status = 'active'
            and public.has_plus_access(p_user_id)
        )
        or coalesce(
          array_length(public.corporate_partner_machine_ids_for_user(p_user_id), 1),
          0
        ) > 0;
    else
      return false;
  end case;
end;
$$;

create or replace function public.get_plus_access_for_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object(
      'hasPlusAccess', false,
      'source', 'none',
      'membershipStatus', 'none',
      'paidSubscriptionActive', false,
      'freeGrantActive', false
    );
  end if;

  with subscription_candidates as (
    select
      subscription.status,
      subscription.current_period_end,
      subscription.cancel_at_period_end,
      subscription.updated_at,
      (
        subscription.status in ('active', 'trialing')
        and (
          subscription.current_period_end is null
          or subscription.current_period_end > now()
        )
      ) as is_active
    from public.subscriptions subscription
    where subscription.user_id = p_user_id
  ),
  selected_subscription as (
    select *
    from subscription_candidates candidate
    order by candidate.is_active desc, candidate.updated_at desc
    limit 1
  ),
  selected_grant as (
    select
      grant_row.id,
      grant_row.starts_at,
      grant_row.expires_at,
      (
        grant_row.revoked_at is null
        and grant_row.starts_at <= now()
        and grant_row.expires_at > now()
      ) as is_active
    from public.plus_access_grants grant_row
    where grant_row.user_id = p_user_id
      and grant_row.revoked_at is null
    order by grant_row.updated_at desc
    limit 1
  ),
  resolved as (
    select
      coalesce(selected_subscription.is_active, false) as paid_active,
      coalesce(selected_grant.is_active, false) as grant_active,
      public.is_super_admin(p_user_id) as admin_active,
      selected_subscription.status,
      selected_subscription.current_period_end,
      selected_subscription.cancel_at_period_end,
      selected_grant.id as grant_id,
      selected_grant.starts_at as grant_starts_at,
      selected_grant.expires_at as grant_expires_at
    from (select 1) anchor
    left join selected_subscription on true
    left join selected_grant on true
  )
  select jsonb_build_object(
    'hasPlusAccess', (resolved.paid_active or resolved.grant_active or resolved.admin_active),
    'source', case
      when resolved.paid_active then 'paid_subscription'
      when resolved.grant_active then 'free_grant'
      when resolved.admin_active then 'admin'
      else 'none'
    end,
    'membershipStatus', coalesce(resolved.status, 'none'),
    'currentPeriodEnd', resolved.current_period_end,
    'cancelAtPeriodEnd', coalesce(resolved.cancel_at_period_end, false),
    'paidSubscriptionActive', resolved.paid_active,
    'freeGrantId', resolved.grant_id,
    'freeGrantStartsAt', resolved.grant_starts_at,
    'freeGrantExpiresAt', resolved.grant_expires_at,
    'freeGrantActive', resolved.grant_active
  )
  into result
  from resolved;

  return coalesce(
    result,
    jsonb_build_object(
      'hasPlusAccess', false,
      'source', 'none',
      'membershipStatus', 'none',
      'paidSubscriptionActive', false,
      'freeGrantActive', false
    )
  );
end;
$$;

create or replace function public.get_user_supply_discount_tier(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.has_user_capability(p_user_id, 'supplies.member_discount') then 'member'
    else 'standard'
  end;
$$;

create or replace function public.can_request_support_for_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_user_capability(p_user_id, 'support.request');
$$;

create or replace function public.get_effective_access_context_for_user(
  p_user_id uuid,
  p_email text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  normalized_email text;
  resolved_user_id uuid;
  capability_names text[] := array[
    'training.view',
    'support.request',
    'supplies.member_discount',
    'reports.partner.view',
    'reports.machine.view',
    'technicians.manage',
    'admin.access.manage_reporting',
    'admin.global'
  ];
  active_capabilities jsonb;
  active_presets jsonb;
  partner_ids uuid[];
  partnership_ids uuid[];
  machine_ids uuid[];
begin
  normalized_email := public.normalize_corporate_partner_email(p_email);
  resolved_user_id := p_user_id;

  if resolved_user_id is null and normalized_email <> '' then
    select auth_user.id
    into resolved_user_id
    from auth.users auth_user
    where public.normalize_corporate_partner_email(auth_user.email) = normalized_email
    limit 1;
  end if;

  if resolved_user_id is null then
    return jsonb_build_object(
      'userId', null,
      'email', nullif(normalized_email, ''),
      'presets', '[]'::jsonb,
      'capabilities', '[]'::jsonb,
      'sources', jsonb_build_object(
        'corporatePartnerMemberships', '[]'::jsonb
      ),
      'scopes', jsonb_build_object(
        'partnershipIds', '[]'::jsonb,
        'machineIds', '[]'::jsonb
      ),
      'warnings', jsonb_build_array('No auth user exists yet; email-based grants can still be created.')
    );
  end if;

  select auth_user.email
  into normalized_email
  from auth.users auth_user
  where auth_user.id = resolved_user_id
  limit 1;

  partner_ids := public.corporate_partner_ids_for_user(resolved_user_id);
  partnership_ids := public.corporate_partner_partnership_ids_for_user(resolved_user_id, true);
  machine_ids := public.corporate_partner_machine_ids_for_user(resolved_user_id);

  select coalesce(jsonb_agg(capability order by capability), '[]'::jsonb)
  into active_capabilities
  from unnest(capability_names) as capability
  where public.has_user_capability(resolved_user_id, capability);

  select coalesce(jsonb_agg(preset order by preset), '[]'::jsonb)
  into active_presets
  from (
    select 'Super Admin' as preset where public.is_super_admin(resolved_user_id)
    union all
    select 'Scoped Admin' where public.is_scoped_admin(resolved_user_id)
    union all
    select 'Plus Customer' where public.has_plus_access(resolved_user_id)
    union all
    select 'Corporate Partner' where public.is_active_corporate_partner_user(resolved_user_id)
    union all
    select 'Technician' where public.has_active_operator_training_grant(resolved_user_id)
  ) presets;

  return jsonb_build_object(
    'userId', resolved_user_id,
    'email', normalized_email,
    'presets', active_presets,
    'capabilities', active_capabilities,
    'sources', jsonb_build_object(
      'plusAccess', public.get_plus_access_for_user(resolved_user_id),
      'corporatePartnerMemberships', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', membership.id,
            'partnerId', membership.partner_id,
            'partnerName', partner.name,
            'status', membership.status,
            'startsAt', membership.starts_at,
            'expiresAt', membership.expires_at,
            'grantReason', membership.grant_reason,
            'revokedAt', membership.revoked_at,
            'isActive', public.corporate_partner_membership_is_active(
              membership.starts_at,
              membership.expires_at,
              membership.revoked_at,
              membership.status
            )
          )
          order by partner.name, membership.created_at desc
        )
        from public.corporate_partner_memberships membership
        join public.reporting_partners partner on partner.id = membership.partner_id
        where (
          membership.user_id = resolved_user_id
          or public.normalize_corporate_partner_email(membership.member_email)
            = public.normalize_corporate_partner_email(normalized_email)
        )
      ), '[]'::jsonb)
    ),
    'scopes', jsonb_build_object(
      'partnerIds', to_jsonb(partner_ids),
      'partnershipIds', to_jsonb(partnership_ids),
      'machineIds', to_jsonb(machine_ids),
      'scopedAdminMachineIds', to_jsonb(public.scoped_admin_machine_ids(resolved_user_id))
    ),
    'warnings', coalesce((
      select jsonb_agg(warning)
      from (
        select 'Corporate Partner has no active portal-enabled partnerships.' as warning
        where public.is_active_corporate_partner_user(resolved_user_id)
          and coalesce(array_length(partnership_ids, 1), 0) = 0
        union all
        select 'Corporate Partner has portal-enabled partnerships but no active derived machines.'
        where public.is_active_corporate_partner_user(resolved_user_id)
          and coalesce(array_length(partnership_ids, 1), 0) > 0
          and coalesce(array_length(machine_ids, 1), 0) = 0
      ) warnings
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_my_effective_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return public.get_effective_access_context_for_user(auth.uid(), null);
end;
$$;

create or replace function public.admin_get_effective_access_context(p_target_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin access required';
  end if;

  return public.get_effective_access_context_for_user(null, p_target_email);
end;
$$;

create or replace function public.admin_get_corporate_partner_access_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin access required';
  end if;

  select jsonb_build_object(
    'partners',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'partnerId', partner.id,
          'partnerName', partner.name,
          'partnerType', partner.partner_type,
          'status', partner.status,
          'memberships', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', membership.id,
                'userId', membership.user_id,
                'memberEmail', membership.member_email,
                'status', membership.status,
                'startsAt', membership.starts_at,
                'expiresAt', membership.expires_at,
                'grantReason', membership.grant_reason,
                'revokedAt', membership.revoked_at,
                'revokeReason', membership.revoke_reason,
                'isActive', public.corporate_partner_membership_is_active(
                  membership.starts_at,
                  membership.expires_at,
                  membership.revoked_at,
                  membership.status
                )
              )
              order by membership.created_at desc
            )
            from public.corporate_partner_memberships membership
            where membership.partner_id = partner.id
          ), '[]'::jsonb),
          'portalPartnerships', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'partyId', party.id,
                'partnershipId', partnership.id,
                'partnershipName', partnership.name,
                'partnershipStatus', partnership.status,
                'portalAccessEnabled', party.portal_access_enabled,
                'machineCount', (
                  select count(distinct assignment.machine_id)::integer
                  from public.reporting_machine_partnership_assignments assignment
                  join public.reporting_machines machine on machine.id = assignment.machine_id
                  where assignment.partnership_id = partnership.id
                    and assignment.assignment_role = 'primary_reporting'
                    and assignment.status = 'active'
                    and machine.status = 'active'
                ),
                'machines', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'machineId', machine.id,
                      'machineLabel', machine.machine_label,
                      'accountId', account.id,
                      'accountName', account.name,
                      'locationId', location.id,
                      'locationName', location.name,
                      'status', machine.status
                    )
                    order by account.name, location.name, machine.machine_label
                  )
                  from public.reporting_machine_partnership_assignments assignment
                  join public.reporting_machines machine on machine.id = assignment.machine_id
                  join public.customer_accounts account on account.id = machine.account_id
                  left join public.reporting_locations location on location.id = machine.location_id
                  where assignment.partnership_id = partnership.id
                    and assignment.assignment_role = 'primary_reporting'
                    and assignment.status = 'active'
                    and machine.status = 'active'
                ), '[]'::jsonb)
              )
              order by partnership.name
            )
            from public.reporting_partnership_parties party
            join public.reporting_partnerships partnership on partnership.id = party.partnership_id
            where party.partner_id = partner.id
              and partnership.status = 'active'
          ), '[]'::jsonb)
        )
        order by partner.name
      ),
      '[]'::jsonb
    )
  )
  into result
  from public.reporting_partners partner
  where partner.status = 'active';

  return coalesce(result, jsonb_build_object('partners', '[]'::jsonb));
end;
$$;

create or replace function public.admin_grant_corporate_partner_membership(
  p_target_email text,
  p_partner_id uuid,
  p_reason text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_email text;
  normalized_reason text;
  target_user_id uuid;
  before_row public.corporate_partner_memberships;
  after_row public.corporate_partner_memberships;
  action_name text;
begin
  current_user_id := auth.uid();

  if not public.is_super_admin(current_user_id) then
    raise exception 'Super-admin access required';
  end if;

  normalized_email := public.normalize_corporate_partner_email(p_target_email);
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_email = '' then
    raise exception 'Member email is required';
  end if;

  if p_partner_id is null then
    raise exception 'Partner is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Grant reason is required';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future';
  end if;

  if not exists (
    select 1 from public.reporting_partners partner
    where partner.id = p_partner_id
      and partner.status = 'active'
  ) then
    raise exception 'Active partner not found';
  end if;

  select auth_user.id
  into target_user_id
  from auth.users auth_user
  where public.normalize_corporate_partner_email(auth_user.email) = normalized_email
  limit 1;

  select *
  into before_row
  from public.corporate_partner_memberships membership
  where membership.partner_id = p_partner_id
    and public.normalize_corporate_partner_email(membership.member_email) = normalized_email
    and membership.revoked_at is null
  limit 1
  for update;

  if before_row.id is null then
    insert into public.corporate_partner_memberships (
      partner_id,
      user_id,
      member_email,
      status,
      starts_at,
      expires_at,
      grant_reason,
      granted_by
    )
    values (
      p_partner_id,
      target_user_id,
      normalized_email,
      'active',
      now(),
      p_expires_at,
      normalized_reason,
      current_user_id
    )
    returning * into after_row;

    action_name := 'corporate_partner_membership.granted';
  else
    update public.corporate_partner_memberships
    set
      user_id = coalesce(target_user_id, user_id),
      member_email = normalized_email,
      status = 'active',
      expires_at = p_expires_at,
      grant_reason = normalized_reason,
      granted_by = current_user_id
    where id = before_row.id
    returning * into after_row;

    action_name := 'corporate_partner_membership.updated';
  end if;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    current_user_id,
    action_name,
    'corporate_partner_membership',
    after_row.id::text,
    after_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'partner_id', after_row.partner_id,
      'member_email', after_row.member_email,
      'reason', normalized_reason
    )
  );

  return jsonb_build_object(
    'id', after_row.id,
    'partnerId', after_row.partner_id,
    'userId', after_row.user_id,
    'memberEmail', after_row.member_email,
    'status', after_row.status,
    'startsAt', after_row.starts_at,
    'expiresAt', after_row.expires_at,
    'grantReason', after_row.grant_reason
  );
end;
$$;

create or replace function public.admin_revoke_corporate_partner_membership(
  p_membership_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  before_row public.corporate_partner_memberships;
  after_row public.corporate_partner_memberships;
begin
  current_user_id := auth.uid();

  if not public.is_super_admin(current_user_id) then
    raise exception 'Super-admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_membership_id is null then
    raise exception 'Membership is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Revoke reason is required';
  end if;

  select *
  into before_row
  from public.corporate_partner_memberships membership
  where membership.id = p_membership_id
    and membership.revoked_at is null
  limit 1
  for update;

  if before_row.id is null then
    raise exception 'Active Corporate Partner membership not found';
  end if;

  update public.corporate_partner_memberships
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by = current_user_id,
    revoke_reason = normalized_reason
  where id = before_row.id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    current_user_id,
    'corporate_partner_membership.revoked',
    'corporate_partner_membership',
    after_row.id::text,
    after_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'partner_id', after_row.partner_id,
      'member_email', after_row.member_email,
      'reason', normalized_reason
    )
  );

  return jsonb_build_object(
    'id', after_row.id,
    'partnerId', after_row.partner_id,
    'userId', after_row.user_id,
    'memberEmail', after_row.member_email,
    'status', after_row.status,
    'revokedAt', after_row.revoked_at,
    'revokeReason', after_row.revoke_reason
  );
end;
$$;

create or replace function public.admin_set_partnership_party_portal_access(
  p_party_id uuid,
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  normalized_reason text;
  before_row public.reporting_partnership_parties;
  after_row public.reporting_partnership_parties;
begin
  current_user_id := auth.uid();

  if not public.is_super_admin(current_user_id) then
    raise exception 'Super-admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_party_id is null then
    raise exception 'Partnership party is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Reason is required';
  end if;

  select *
  into before_row
  from public.reporting_partnership_parties party
  where party.id = p_party_id
  limit 1
  for update;

  if before_row.id is null then
    raise exception 'Partnership party not found';
  end if;

  update public.reporting_partnership_parties
  set portal_access_enabled = coalesce(p_enabled, false)
  where id = before_row.id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    current_user_id,
    'reporting_partnership_party.portal_access_updated',
    'reporting_partnership_party',
    after_row.id::text,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'partner_id', after_row.partner_id,
      'partnership_id', after_row.partnership_id,
      'portal_access_enabled', after_row.portal_access_enabled,
      'reason', normalized_reason
    )
  );

  return jsonb_build_object(
    'partyId', after_row.id,
    'partnerId', after_row.partner_id,
    'partnershipId', after_row.partnership_id,
    'portalAccessEnabled', after_row.portal_access_enabled
  );
end;
$$;

create or replace function public.get_portal_access_tier_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is null then 'baseline'
    when public.is_super_admin(p_user_id) then 'plus'
    when public.has_plus_access(p_user_id) then 'plus'
    when public.is_active_corporate_partner_user(p_user_id) then 'plus'
    when public.is_scoped_admin(p_user_id) then 'training'
    when public.has_active_operator_training_grant(p_user_id) then 'training'
    else 'baseline'
  end;
$$;

drop function if exists public.get_my_portal_access_context();

create or replace function public.get_my_portal_access_context()
returns table (
  access_tier text,
  is_plus_member boolean,
  is_training_operator boolean,
  is_admin boolean,
  can_manage_operator_training boolean,
  is_corporate_partner boolean,
  has_supply_discount boolean,
  can_request_support boolean,
  can_manage_technicians boolean,
  capabilities jsonb,
  effective_presets jsonb
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  resolved_tier text;
  effective_context jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  resolved_tier := public.get_portal_access_tier_for_user(current_user_id);
  effective_context := public.get_effective_access_context_for_user(current_user_id, null);

  return query
  select
    resolved_tier as access_tier,
    public.has_plus_access(current_user_id) as is_plus_member,
    (
      public.has_active_operator_training_grant(current_user_id)
      or public.is_scoped_admin(current_user_id)
    ) as is_training_operator,
    (
      public.is_super_admin(current_user_id)
      or public.is_scoped_admin(current_user_id)
    ) as is_admin,
    public.can_manage_operator_training_grants_for_user(current_user_id)
      as can_manage_operator_training,
    public.is_active_corporate_partner_user(current_user_id) as is_corporate_partner,
    public.has_user_capability(current_user_id, 'supplies.member_discount')
      as has_supply_discount,
    public.has_user_capability(current_user_id, 'support.request')
      as can_request_support,
    public.has_user_capability(current_user_id, 'technicians.manage')
      as can_manage_technicians,
    coalesce(effective_context -> 'capabilities', '[]'::jsonb) as capabilities,
    coalesce(effective_context -> 'presets', '[]'::jsonb) as effective_presets;
end;
$$;

create or replace function public.has_active_operator_training_grant(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    join public.operator_training_grants g
      on (
        g.operator_user_id = u.id
        or lower(g.operator_email) = lower(u.email)
      )
    where u.id = uid
      and g.revoked_at is null
      and g.starts_at <= now()
      and (g.expires_at is null or g.expires_at > now())
      and (
        public.has_plus_access(g.sponsor_user_id)
        or public.is_active_corporate_partner_user(g.sponsor_user_id)
        or public.is_super_admin(g.sponsor_user_id)
      )
  );
$$;

create or replace function public.has_reporting_machine_access(
  p_user_id uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_machine_id is not null
    and (
      public.is_super_admin(p_user_id)
      or p_machine_id = any(public.scoped_admin_machine_ids(p_user_id))
      or p_machine_id = any(public.corporate_partner_machine_ids_for_user(p_user_id))
      or exists (
        select 1
        from public.reporting_machines machine
        where machine.id = p_machine_id
          and public.is_reporting_account_member(p_user_id, machine.account_id)
      )
      or exists (
        select 1
        from public.reporting_machines machine
        join public.reporting_machine_entitlements entitlement
          on entitlement.user_id = p_user_id
        where machine.id = p_machine_id
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
    );
$$;

create or replace function public.get_my_reporting_access_context()
returns table (
  has_reporting_access boolean,
  accessible_machine_count bigint,
  accessible_location_count bigint,
  can_manage_reporting boolean,
  latest_sale_date date,
  latest_import_completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_scoped_machine_ids uuid[];
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  current_scoped_machine_ids := public.scoped_admin_machine_ids(current_user_id);

  return query
  with accessible_machines as (
    select machine.id, machine.location_id
    from public.reporting_machines machine
    where public.has_reporting_machine_access(current_user_id, machine.id)
  )
  select
    exists (select 1 from accessible_machines) as has_reporting_access,
    (select count(*) from accessible_machines)::bigint as accessible_machine_count,
    (select count(distinct location_id) from accessible_machines)::bigint
      as accessible_location_count,
    (
      public.is_super_admin(current_user_id)
      or coalesce(array_length(current_scoped_machine_ids, 1), 0) > 0
    ) as can_manage_reporting,
    (
      select max(fact.sale_date)
      from public.machine_sales_facts fact
      join accessible_machines machine on machine.id = fact.reporting_machine_id
    ) as latest_sale_date,
    (
      select max(run.completed_at)
      from public.sales_import_runs run
      where run.status = 'completed'
    ) as latest_import_completed_at;
end;
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
set search_path = public
as $$
declare
  scoped_machine_ids uuid[];
  corporate_machine_ids uuid[];
  actor_machine_ids uuid[];
  scope_start date;
  scope_end date;
begin
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

create or replace function public.get_partner_dashboard_partnerships()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  result jsonb;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_user_capability(actor_user_id, 'reports.partner.view') then
    raise exception 'Partner dashboard access required';
  end if;

  select jsonb_build_object(
    'partnerships',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', partnership.id,
          'name', partnership.name,
          'status', partnership.status,
          'reporting_week_end_day', partnership.reporting_week_end_day,
          'timezone', partnership.timezone
        )
        order by partnership.name
      ),
      '[]'::jsonb
    )
  )
  into result
  from public.reporting_partnerships partnership
  where partnership.status = 'active'
    and public.can_access_partner_dashboard(
      actor_user_id,
      partnership.id,
      current_date,
      current_date
    );

  return result;
end;
$$;

create or replace function public.scoped_admin_machine_ids(uid uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with scoped_machines as (
    select distinct machine.id as machine_id
    from public.admin_scoped_access_grants grant_row
    join public.admin_scoped_access_scopes scope_row
      on scope_row.grant_id = grant_row.id
    join public.reporting_machines machine
      on (
        scope_row.scope_type = 'machine'
        and machine.id = scope_row.machine_id
      )
      or (
        scope_row.scope_type = 'account'
        and machine.account_id = scope_row.account_id
      )
    where grant_row.user_id = uid
      and grant_row.role = 'scoped_admin'
      and public.admin_scoped_grant_is_active(
        grant_row.starts_at,
        grant_row.expires_at,
        grant_row.revoked_at
      )
      and scope_row.revoked_at is null
  ),
  corporate_partner_machines as (
    select unnest(public.corporate_partner_machine_ids_for_user(uid)) as machine_id
    where current_setting('app.partner_dashboard_actor_scope', true) = 'include_corporate_partner'
  )
  select coalesce(array_agg(distinct machine_id), '{}'::uuid[])
  from (
    select machine_id from scoped_machines
    union
    select machine_id from corporate_partner_machines
  ) combined;
$$;

do $$
begin
  if to_regprocedure('public.admin_preview_partner_period_report(uuid,date,date,text)') is not null
     and to_regprocedure('public.admin_preview_partner_period_report_internal(uuid,date,date,text)') is null then
    alter function public.admin_preview_partner_period_report(uuid, date, date, text)
      rename to admin_preview_partner_period_report_internal;
  end if;
end $$;

create or replace function public.admin_preview_partner_period_report(
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
declare
  actor_user_id uuid;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if public.is_active_corporate_partner_user(actor_user_id) then
    perform set_config(
      'app.partner_dashboard_actor_scope',
      'include_corporate_partner',
      true
    );
  end if;

  return public.admin_preview_partner_period_report_internal(
    p_partnership_id,
    p_date_from,
    p_date_to,
    p_period_grain
  );
end;
$$;

alter table public.technician_grants
  add column if not exists sponsor_type text not null default 'plus_customer_account',
  add column if not exists partner_id uuid references public.reporting_partners (id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'technician_grants_sponsor_type_check'
      and conrelid = 'public.technician_grants'::regclass
  ) then
    alter table public.technician_grants
      add constraint technician_grants_sponsor_type_check
      check (sponsor_type in ('plus_customer_account', 'corporate_partner'));
  end if;
end;
$$;

create index if not exists technician_grants_partner_id_idx
  on public.technician_grants (partner_id)
  where revoked_at is null;

create or replace function public.has_plus_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.subscriptions subscription
      where subscription.user_id = uid
        and subscription.status in ('active', 'trialing')
        and (
          subscription.current_period_end is null
          or subscription.current_period_end > now()
        )
    )
    or public.has_active_plus_grant(uid)
    or (
      current_setting('app.technician_resolution_scope', true) = 'include_corporate_partner'
      and public.is_active_corporate_partner_user(uid)
    );
$$;

create or replace function public.can_manage_technician_grants_for_account(
  p_user_id uuid,
  p_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_account_id is not null
    and (
      public.is_super_admin(p_user_id)
      or (
        public.has_plus_access(p_user_id)
        and exists (
          select 1
          from public.customer_account_memberships membership
          where membership.user_id = p_user_id
            and membership.account_id = p_account_id
            and membership.active
            and membership.role = 'owner'
        )
      )
      or p_account_id = any(public.corporate_partner_account_ids_for_user(p_user_id))
    );
$$;

create or replace function public.can_manage_technician_grants_for_machine(
  p_user_id uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_machine_id is not null
    and exists (
      select 1
      from public.reporting_machines machine
      where machine.id = p_machine_id
        and machine.status = 'active'
        and (
          public.is_super_admin(p_user_id)
          or (
            public.can_manage_technician_grants_for_account(p_user_id, machine.account_id)
            and (
              public.has_plus_access(p_user_id)
              or machine.id = any(public.corporate_partner_machine_ids_for_user(p_user_id))
            )
          )
        )
    );
$$;

create or replace function public.can_access_technician_grant(
  p_user_id uuid,
  p_technician_grant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select p_user_id is not null
    and p_technician_grant_id is not null
    and (
      public.is_super_admin(p_user_id)
      or exists (
        select 1
        from public.technician_grants grant_row
        left join auth.users auth_user on auth_user.id = p_user_id
        where grant_row.id = p_technician_grant_id
          and (
            grant_row.sponsor_user_id = p_user_id
            or grant_row.technician_user_id = p_user_id
            or lower(grant_row.technician_email) = lower(auth_user.email)
            or (
              grant_row.sponsor_type = 'corporate_partner'
              and grant_row.partner_id = any(public.corporate_partner_ids_for_user(p_user_id))
            )
          )
      )
    );
$$;

create or replace function public.technician_actor_authority_path(
  p_actor_user_id uuid,
  p_account_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_actor_user_id is null or p_account_id is null then
    return null;
  end if;

  if public.has_plus_access(p_actor_user_id)
    and exists (
      select 1
      from public.customer_account_memberships membership
      where membership.user_id = p_actor_user_id
        and membership.account_id = p_account_id
        and membership.active
        and membership.role = 'owner'
    ) then
    return 'plus_account_owner';
  end if;

  if p_account_id = any(public.corporate_partner_account_ids_for_user(p_actor_user_id)) then
    return 'corporate_partner';
  end if;

  if public.is_super_admin(p_actor_user_id) then
    return 'super_admin';
  end if;

  return null;
end;
$$;

create or replace function public.technician_pick_sponsor_user_id(
  p_actor_user_id uuid,
  p_account_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_sponsor_user_id uuid;
  authority_path text;
begin
  if p_actor_user_id is null or p_account_id is null then
    return null;
  end if;

  authority_path := public.technician_actor_authority_path(p_actor_user_id, p_account_id);

  if authority_path in ('plus_account_owner', 'corporate_partner') then
    return p_actor_user_id;
  end if;

  if authority_path <> 'super_admin' then
    return null;
  end if;

  select membership.user_id
  into selected_sponsor_user_id
  from public.customer_account_memberships membership
  where membership.account_id = p_account_id
    and membership.active
    and membership.role = 'owner'
    and public.has_plus_access(membership.user_id)
  order by membership.created_at asc, membership.id asc
  limit 1;

  return selected_sponsor_user_id;
end;
$$;

do $$
begin
  if to_regprocedure('public.technician_reuse_or_create_operator_training_grant(uuid,text,uuid,text,uuid)') is not null
     and to_regprocedure('public.technician_reuse_or_create_operator_training_grant_internal(uuid,text,uuid,text,uuid)') is null then
    alter function public.technician_reuse_or_create_operator_training_grant(uuid, text, uuid, text, uuid)
      rename to technician_reuse_or_create_operator_training_grant_internal;
  end if;
end $$;

create or replace function public.technician_reuse_or_create_operator_training_grant(
  p_sponsor_user_id uuid,
  p_technician_email text,
  p_technician_user_id uuid,
  p_reason text,
  p_actor_user_id uuid
)
returns public.operator_training_grants
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  grant_row public.operator_training_grants;
begin
  grant_row := public.technician_reuse_or_create_operator_training_grant_internal(
    p_sponsor_user_id,
    p_technician_email,
    p_technician_user_id,
    p_reason,
    p_actor_user_id
  );

  update public.operator_training_grants
  set expires_at = now() + interval '1 year'
  where id = grant_row.id
  returning * into grant_row;

  return grant_row;
end;
$$;

do $$
begin
  if to_regprocedure('public.grant_technician_access(text,uuid[],text)') is not null
     and to_regprocedure('public.grant_technician_access_internal(text,uuid[],text)') is null then
    alter function public.grant_technician_access(text, uuid[], text)
      rename to grant_technician_access_internal;
  end if;
end $$;

create or replace function public.grant_technician_access(
  p_technician_email text,
  p_machine_ids uuid[] default '{}'::uuid[],
  p_reason text default 'Technician access',
  p_account_id uuid default null,
  p_partner_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_user_email text;
  normalized_email text;
  normalized_reason text;
  normalized_machine_ids uuid[];
  target_account_id uuid;
  target_partner_id uuid;
  target_user_id uuid;
  selected_sponsor_user_id uuid;
  sponsor_email text;
  actor_authority_path text;
  operator_grant public.operator_training_grants;
  before_grant public.technician_grants;
  after_grant public.technician_grants;
  internal_result jsonb;
  resolved_grant_id uuid;
  grant_expiry timestamptz := now() + interval '1 year';
  invalid_machine_count integer;
  account_count integer;
  action_name text;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  normalized_email := public.normalize_technician_email(p_technician_email);
  normalized_reason := public.technician_assert_reason(p_reason);

  if normalized_email = '' then
    raise exception 'Technician email is required';
  end if;

  select public.normalize_technician_email(auth_user.email)
  into current_user_email
  from auth.users auth_user
  where auth_user.id = current_user_id
  limit 1;

  if current_user_email = normalized_email then
    raise exception 'Use a different email for Technician access';
  end if;

  select coalesce(array_agg(distinct requested.machine_id), '{}'::uuid[])
  into normalized_machine_ids
  from unnest(coalesce(p_machine_ids, '{}'::uuid[])) as requested(machine_id)
  where requested.machine_id is not null;

  if coalesce(array_length(normalized_machine_ids, 1), 0) > 0 then
    internal_result := public.grant_technician_access_internal(
      normalized_email,
      normalized_machine_ids,
      normalized_reason
    );

    select (internal_result ->> 'grantId')::uuid
    into resolved_grant_id;

    select *
    into after_grant
    from public.technician_grants grant_row
    where grant_row.id = resolved_grant_id
    limit 1;

    target_partner_id := coalesce(
      p_partner_id,
      public.corporate_partner_partner_id_for_machine(current_user_id, normalized_machine_ids[1])
    );

    update public.technician_grants
    set
      sponsor_type = case
        when public.technician_actor_authority_path(current_user_id, account_id) = 'corporate_partner'
          then 'corporate_partner'
        else 'plus_customer_account'
      end,
      partner_id = case
        when public.technician_actor_authority_path(current_user_id, account_id) = 'corporate_partner'
          then target_partner_id
        else null
      end,
      expires_at = grant_expiry
    where id = after_grant.id
    returning * into after_grant;

    update public.technician_machine_assignments
    set expires_at = grant_expiry
    where technician_grant_id = after_grant.id
      and revoked_at is null;

    update public.reporting_machine_entitlements
    set expires_at = grant_expiry
    where source_type = 'technician_grant'
      and source_id = after_grant.id
      and revoked_at is null;

    return internal_result
      || jsonb_build_object(
        'expiresAt', after_grant.expires_at,
        'sponsorType', after_grant.sponsor_type,
        'partnerId', after_grant.partner_id
      );
  end if;

  target_account_id := p_account_id;

  if target_account_id is null then
    raise exception 'Select an account before saving training-only Technician access';
  end if;

  actor_authority_path := public.technician_actor_authority_path(current_user_id, target_account_id);

  if actor_authority_path is null then
    raise exception 'Technician management access required';
  end if;

  if actor_authority_path = 'corporate_partner' then
    target_partner_id := p_partner_id;

    if target_partner_id is null then
      select party.partner_id
      into target_partner_id
      from public.reporting_machines machine
      join public.reporting_machine_partnership_assignments assignment
        on assignment.machine_id = machine.id
      join public.reporting_partnership_parties party
        on party.partnership_id = assignment.partnership_id
      join public.reporting_partnerships partnership
        on partnership.id = assignment.partnership_id
      where machine.account_id = target_account_id
        and machine.status = 'active'
        and assignment.assignment_role = 'primary_reporting'
        and assignment.status = 'active'
        and partnership.status = 'active'
        and party.portal_access_enabled
        and party.partner_id = any(public.corporate_partner_ids_for_user(current_user_id))
      order by party.created_at desc
      limit 1;
    end if;

    if target_partner_id is null
      or not target_partner_id = any(public.corporate_partner_ids_for_user(current_user_id)) then
      raise exception 'Corporate Partner context is required';
    end if;
  else
    target_partner_id := null;
  end if;

  if not exists (
    select 1
    from public.customer_accounts account
    where account.id = target_account_id
      and account.status = 'active'
  ) then
    raise exception 'Active account not found';
  end if;

  select auth_user.id
  into target_user_id
  from auth.users auth_user
  where public.normalize_technician_email(auth_user.email) = normalized_email
  limit 1;

  selected_sponsor_user_id := public.technician_pick_sponsor_user_id(
    current_user_id,
    target_account_id
  );

  if selected_sponsor_user_id is null then
    raise exception 'No active Technician sponsor found for this account';
  end if;

  select public.normalize_technician_email(auth_user.email)
  into sponsor_email
  from auth.users auth_user
  where auth_user.id = selected_sponsor_user_id
  limit 1;

  if sponsor_email = normalized_email then
    raise exception 'Use a different email for Technician access';
  end if;

  select *
  into before_grant
  from public.technician_grants grant_row
  where grant_row.account_id = target_account_id
    and lower(grant_row.technician_email) = normalized_email
    and grant_row.revoked_at is null
  limit 1
  for update;

  if before_grant.id is null
    and not public.has_available_technician_grant_seat(
      target_account_id,
      normalized_email,
      target_user_id,
      10
    ) then
    raise exception 'Technician grant cap exceeded for this account';
  end if;

  operator_grant := public.technician_reuse_or_create_operator_training_grant(
    selected_sponsor_user_id,
    normalized_email,
    target_user_id,
    normalized_reason,
    current_user_id
  );

  if before_grant.id is null then
    insert into public.technician_grants (
      account_id,
      sponsor_user_id,
      sponsor_type,
      partner_id,
      technician_email,
      technician_user_id,
      operator_training_grant_id,
      status,
      starts_at,
      expires_at,
      grant_reason,
      granted_by_user_id
    )
    values (
      target_account_id,
      selected_sponsor_user_id,
      case when actor_authority_path = 'corporate_partner'
        then 'corporate_partner'
        else 'plus_customer_account'
      end,
      target_partner_id,
      normalized_email,
      target_user_id,
      operator_grant.id,
      case when target_user_id is null then 'pending' else 'active' end,
      now(),
      grant_expiry,
      normalized_reason,
      current_user_id
    )
    returning * into after_grant;

    action_name := 'technician_access.granted';
  else
    update public.technician_grants
    set
      sponsor_user_id = selected_sponsor_user_id,
      sponsor_type = case when actor_authority_path = 'corporate_partner'
        then 'corporate_partner'
        else 'plus_customer_account'
      end,
      partner_id = target_partner_id,
      technician_user_id = coalesce(target_user_id, technician_user_id),
      operator_training_grant_id = operator_grant.id,
      status = case
        when coalesce(target_user_id, technician_user_id) is null then 'pending'
        else 'active'
      end,
      expires_at = grant_expiry,
      grant_reason = normalized_reason,
      granted_by_user_id = current_user_id,
      revoked_at = null,
      revoked_by_user_id = null,
      revoke_reason = null
    where id = before_grant.id
    returning * into after_grant;

    action_name := 'technician_access.updated';
  end if;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    current_user_id,
    action_name,
    'technician_grant',
    after_grant.id::text,
    after_grant.technician_user_id,
    coalesce(to_jsonb(before_grant), '{}'::jsonb),
    to_jsonb(after_grant),
    jsonb_build_object(
      'actor_authority_path', actor_authority_path,
      'account_id', after_grant.account_id,
      'partner_id', after_grant.partner_id,
      'sponsor_type', after_grant.sponsor_type,
      'sponsor_user_id', after_grant.sponsor_user_id,
      'technician_email', normalized_email,
      'technician_user_id', after_grant.technician_user_id,
      'operator_training_grant_id', after_grant.operator_training_grant_id,
      'reason', normalized_reason,
      'machine_ids_requested', normalized_machine_ids,
      'source_type', 'technician_grant',
      'source_id', after_grant.id
    )
  );

  return jsonb_build_object(
    'grantId', after_grant.id,
    'accountId', after_grant.account_id,
    'partnerId', after_grant.partner_id,
    'sponsorType', after_grant.sponsor_type,
    'technicianEmail', after_grant.technician_email,
    'technicianUserId', after_grant.technician_user_id,
    'status', after_grant.status,
    'expiresAt', after_grant.expires_at,
    'operatorTrainingGrantId', after_grant.operator_training_grant_id,
    'machineResult', jsonb_build_object(
      'grantId', after_grant.id,
      'accountId', after_grant.account_id,
      'machineIdsBefore', '[]'::jsonb,
      'machineIdsAfter', '[]'::jsonb,
      'machineIdsAdded', '[]'::jsonb,
      'machineIdsRemoved', '[]'::jsonb,
      'assignmentsRevoked', 0,
      'reportingEntitlementsUpserted', 0,
      'reportingEntitlementsRevoked', 0
    )
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.update_technician_machines(uuid,uuid[],text)') is not null
     and to_regprocedure('public.update_technician_machines_internal(uuid,uuid[],text)') is null then
    alter function public.update_technician_machines(uuid, uuid[], text)
      rename to update_technician_machines_internal;
  end if;
end $$;

create or replace function public.update_technician_machines(
  p_grant_id uuid,
  p_machine_ids uuid[],
  p_reason text default 'Technician machine assignments updated'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  result jsonb;
  grant_expiry timestamptz := now() + interval '1 year';
begin
  result := public.update_technician_machines_internal(
    p_grant_id,
    coalesce(p_machine_ids, '{}'::uuid[]),
    p_reason
  );

  update public.technician_grants
  set expires_at = grant_expiry
  where id = p_grant_id
    and revoked_at is null;

  update public.technician_machine_assignments
  set expires_at = grant_expiry
  where technician_grant_id = p_grant_id
    and revoked_at is null;

  update public.reporting_machine_entitlements
  set expires_at = grant_expiry
  where source_type = 'technician_grant'
    and source_id = p_grant_id
    and revoked_at is null;

  return result || jsonb_build_object('expiresAt', grant_expiry);
end;
$$;

do $$
begin
  if to_regprocedure('public.resolve_my_technician_entitlements(text)') is not null
     and to_regprocedure('public.resolve_my_technician_entitlements_internal(text)') is null then
    alter function public.resolve_my_technician_entitlements(text)
      rename to resolve_my_technician_entitlements_internal;
  end if;
end $$;

create or replace function public.resolve_my_technician_entitlements(
  p_reason text default 'Technician invite accepted'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform set_config(
    'app.technician_resolution_scope',
    'include_corporate_partner',
    true
  );

  return public.resolve_my_technician_entitlements_internal(p_reason);
end;
$$;

drop function if exists public.get_my_technician_management_context();

create or replace function public.get_my_technician_management_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  with plus_owner_accounts as (
    select
      account.id as account_id,
      account.name as account_name,
      account.status as account_status,
      null::uuid as partner_id,
      null::text as partner_name,
      'plus_customer_account'::text as authority_path
    from public.customer_account_memberships membership
    join public.customer_accounts account on account.id = membership.account_id
    where membership.user_id = current_user_id
      and membership.active
      and membership.role = 'owner'
      and account.status = 'active'
      and public.has_plus_access(current_user_id)
  ),
  corporate_partner_accounts as (
    select distinct
      account.id as account_id,
      account.name as account_name,
      account.status as account_status,
      partner.id as partner_id,
      partner.name as partner_name,
      'corporate_partner'::text as authority_path
    from public.reporting_machines machine
    join public.customer_accounts account on account.id = machine.account_id
    join public.reporting_machine_partnership_assignments assignment
      on assignment.machine_id = machine.id
    join public.reporting_partnerships partnership
      on partnership.id = assignment.partnership_id
    join public.reporting_partnership_parties party
      on party.partnership_id = partnership.id
    join public.reporting_partners partner on partner.id = party.partner_id
    where machine.status = 'active'
      and account.status = 'active'
      and assignment.assignment_role = 'primary_reporting'
      and assignment.status = 'active'
      and assignment.effective_start_date <= current_date
      and (assignment.effective_end_date is null or assignment.effective_end_date >= current_date)
      and partnership.status = 'active'
      and party.portal_access_enabled
      and party.partner_id = any(public.corporate_partner_ids_for_user(current_user_id))
  ),
  manageable_accounts as (
    select * from plus_owner_accounts
    union
    select * from corporate_partner_accounts
  ),
  account_payloads as (
    select
      manageable_accounts.account_name,
      manageable_accounts.partner_name,
      jsonb_build_object(
        'accountId', manageable_accounts.account_id,
        'accountName', manageable_accounts.account_name,
        'accountStatus', manageable_accounts.account_status,
        'partnerId', manageable_accounts.partner_id,
        'partnerName', manageable_accounts.partner_name,
        'authorityPath', manageable_accounts.authority_path,
        'seatCap', 10,
        'activeSeatCount', public.count_active_technician_grants(
          manageable_accounts.account_id
        ),
        'machineCount', (
          select count(*)::integer
          from public.reporting_machines machine
          where machine.account_id = manageable_accounts.account_id
            and machine.status = 'active'
            and (
              manageable_accounts.authority_path = 'plus_customer_account'
              or machine.id = any(public.corporate_partner_machine_ids_for_user(current_user_id))
            )
        ),
        'machines', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'machineId', machine.id,
              'machineLabel', machine.machine_label,
              'machineType', machine.machine_type,
              'locationId', location.id,
              'locationName', location.name,
              'status', machine.status
            )
            order by location.name, machine.machine_label, machine.id
          )
          from public.reporting_machines machine
          join public.reporting_locations location on location.id = machine.location_id
          where machine.account_id = manageable_accounts.account_id
            and machine.status = 'active'
            and (
              manageable_accounts.authority_path = 'plus_customer_account'
              or machine.id = any(public.corporate_partner_machine_ids_for_user(current_user_id))
            )
        ), '[]'::jsonb)
      ) as payload
    from manageable_accounts
  )
  select jsonb_build_object(
    'canManage', exists (select 1 from manageable_accounts),
    'seatCap', 10,
    'accounts', coalesce(
      jsonb_agg(
        account_payloads.payload
        order by account_payloads.partner_name nulls first, account_payloads.account_name
      ),
      '[]'::jsonb
    )
  )
  into result
  from account_payloads;

  return coalesce(
    result,
    jsonb_build_object(
      'canManage', false,
      'seatCap', 10,
      'accounts', '[]'::jsonb
    )
  );
end;
$$;

drop function if exists public.get_my_technician_grants();

create or replace function public.get_my_technician_grants()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  result jsonb;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'grantId', grant_row.id,
      'accountId', grant_row.account_id,
      'sponsorUserId', grant_row.sponsor_user_id,
      'sponsorType', grant_row.sponsor_type,
      'partnerId', grant_row.partner_id,
      'partnerName', partner.name,
      'technicianEmail', grant_row.technician_email,
      'technicianUserId', grant_row.technician_user_id,
      'operatorTrainingGrantId', grant_row.operator_training_grant_id,
      'status', grant_row.status,
      'startsAt', grant_row.starts_at,
      'expiresAt', grant_row.expires_at,
      'grantReason', grant_row.grant_reason,
      'revokedAt', grant_row.revoked_at,
      'revokeReason', grant_row.revoke_reason,
      'createdAt', grant_row.created_at,
      'updatedAt', grant_row.updated_at,
      'isActive', public.technician_grant_is_active(
        grant_row.starts_at,
        grant_row.expires_at,
        grant_row.revoked_at,
        grant_row.status
      ),
      'canManage', (
        public.is_super_admin(current_user_id)
        or (
          grant_row.sponsor_type = 'plus_customer_account'
          and public.has_plus_access(current_user_id)
          and exists (
            select 1
            from public.customer_account_memberships membership
            where membership.account_id = grant_row.account_id
              and membership.user_id = current_user_id
              and membership.active
              and membership.role = 'owner'
          )
        )
        or (
          grant_row.sponsor_type = 'corporate_partner'
          and grant_row.partner_id = any(public.corporate_partner_ids_for_user(current_user_id))
        )
      ),
      'authorityPath', case
        when public.is_super_admin(current_user_id) then 'super_admin'
        when grant_row.sponsor_type = 'corporate_partner'
          and grant_row.partner_id = any(public.corporate_partner_ids_for_user(current_user_id))
          then 'corporate_partner'
        when public.has_plus_access(current_user_id)
          and exists (
            select 1
            from public.customer_account_memberships membership
            where membership.account_id = grant_row.account_id
              and membership.user_id = current_user_id
              and membership.active
              and membership.role = 'owner'
          )
          then 'plus_account_owner'
        else 'technician'
      end,
      'seatCap', 10,
      'activeSeatCount', public.count_active_technician_grants(grant_row.account_id),
      'machines', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'assignmentId', assignment.id,
            'machineId', assignment.machine_id,
            'machineLabel', machine.machine_label,
            'locationId', machine.location_id,
            'locationName', location.name,
            'status', assignment.status,
            'startsAt', assignment.starts_at,
            'expiresAt', assignment.expires_at,
            'revokedAt', assignment.revoked_at,
            'revokeReason', assignment.revoke_reason,
            'isActive', public.technician_assignment_is_active(
              assignment.starts_at,
              assignment.expires_at,
              assignment.revoked_at,
              assignment.status
            )
          )
          order by machine.machine_label, assignment.created_at
        )
        from public.technician_machine_assignments assignment
        left join public.reporting_machines machine on machine.id = assignment.machine_id
        left join public.reporting_locations location on location.id = machine.location_id
        where assignment.technician_grant_id = grant_row.id
          and assignment.revoked_at is null
      ), '[]'::jsonb),
      'activeReportingEntitlementCount', (
        select count(*)::integer
        from public.reporting_machine_entitlements entitlement
        where entitlement.source_type = 'technician_grant'
          and entitlement.source_id = grant_row.id
          and public.reporting_entitlement_is_active(
            entitlement.starts_at,
            entitlement.expires_at,
            entitlement.revoked_at
          )
      )
    )
    order by
      case when grant_row.revoked_at is null then 0 else 1 end,
      grant_row.updated_at desc
  ), '[]'::jsonb)
  into result
  from public.technician_grants grant_row
  left join public.reporting_partners partner on partner.id = grant_row.partner_id
  where public.is_super_admin(current_user_id)
    or public.can_access_technician_grant(current_user_id, grant_row.id)
    or (
      grant_row.sponsor_type = 'plus_customer_account'
      and public.has_plus_access(current_user_id)
      and exists (
        select 1
        from public.customer_account_memberships membership
        where membership.account_id = grant_row.account_id
          and membership.user_id = current_user_id
          and membership.active
          and membership.role = 'owner'
      )
    )
    or (
      grant_row.sponsor_type = 'corporate_partner'
      and grant_row.partner_id = any(public.corporate_partner_ids_for_user(current_user_id))
    );

  return result;
end;
$$;

comment on table public.corporate_partner_memberships is
  'Explicit Corporate Partner membership source. This is separate from Plus access and resolves reporting through portal-enabled partnership participation.';

comment on column public.reporting_partnership_parties.portal_access_enabled is
  'Controls whether this partner participant can receive Corporate Partner portal reporting access. Legal or payout participation alone does not grant portal access.';

comment on function public.get_my_effective_access_context() is
  'Returns the signed-in user effective presets, capabilities, sources, scopes, and access warnings for UI previews and route guards.';

comment on function public.admin_get_effective_access_context(text) is
  'Super-admin lookup of effective access by email for the person-first Admin Access console.';

comment on function public.admin_get_corporate_partner_access_options() is
  'Super-admin Corporate Partner grant context, including active partners, memberships, portal-enabled partnerships, and derived machines.';

comment on function public.grant_technician_access(text, uuid[], text, uuid, uuid) is
  'Grant or renew Technician access with optional machine assignments. Zero machines means training-only Technician. New grants default to one-year expiry.';

comment on function public.get_user_supply_discount_tier(uuid) is
  'Server-side supply discount resolver. Plus Customer and Corporate Partner resolve to member; Technician alone resolves to standard.';

revoke execute on function public.normalize_corporate_partner_email(text)
  from public;
revoke execute on function public.corporate_partner_membership_is_active(timestamptz, timestamptz, timestamptz, text)
  from public;
revoke execute on function public.corporate_partner_ids_for_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.is_active_corporate_partner_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.corporate_partner_partnership_ids_for_user(uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.corporate_partner_machine_ids_for_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.corporate_partner_partner_id_for_machine(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.corporate_partner_account_ids_for_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.has_user_capability(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.get_plus_access_for_user(uuid)
  from public, anon, authenticated;
revoke execute on function public.scoped_admin_machine_ids(uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_preview_partner_period_report_internal(uuid, date, date, text)
  from public, anon, authenticated;
revoke execute on function public.grant_technician_access_internal(text, uuid[], text)
  from public, anon, authenticated;
revoke execute on function public.update_technician_machines_internal(uuid, uuid[], text)
  from public, anon, authenticated;
revoke execute on function public.resolve_my_technician_entitlements_internal(text)
  from public, anon, authenticated;
revoke execute on function public.technician_reuse_or_create_operator_training_grant_internal(uuid, text, uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.get_my_portal_access_context()
  to authenticated, service_role;
grant execute on function public.get_my_effective_access_context()
  to authenticated, service_role;
grant execute on function public.get_my_reporting_access_context()
  to authenticated, service_role;
grant execute on function public.get_partner_dashboard_partnerships()
  to authenticated, service_role;
grant execute on function public.admin_preview_partner_period_report(uuid, date, date, text)
  to authenticated, service_role;
grant execute on function public.can_access_partner_dashboard(uuid, uuid, date, date)
  to service_role;
grant execute on function public.get_user_supply_discount_tier(uuid)
  to service_role;
grant execute on function public.can_request_support_for_user(uuid)
  to service_role;
grant execute on function public.admin_get_effective_access_context(text)
  to authenticated;
grant execute on function public.admin_get_corporate_partner_access_options()
  to authenticated;
grant execute on function public.admin_grant_corporate_partner_membership(text, uuid, text, timestamptz)
  to authenticated;
grant execute on function public.admin_revoke_corporate_partner_membership(uuid, text)
  to authenticated;
grant execute on function public.admin_set_partnership_party_portal_access(uuid, boolean, text)
  to authenticated;
grant execute on function public.grant_technician_access(text, uuid[], text, uuid, uuid)
  to authenticated;
grant execute on function public.update_technician_machines(uuid, uuid[], text)
  to authenticated;
grant execute on function public.resolve_my_technician_entitlements(text)
  to authenticated;
grant execute on function public.get_my_technician_management_context()
  to authenticated;
grant execute on function public.get_my_technician_grants()
  to authenticated;

select pg_notify('pgrst', 'reload schema');
